import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { parseCsv, BUILTIN_PROFILES, NATWEST_PROFILE, CsvProfile } from '../services/csv-parser.js';
import { TransactionQueries, ImportBatchQueries, AccountQueries } from '../db/queries.js';
import { db } from '../db/schema.js';
import { applyRulesToTxIds } from '../services/rules-engine.js';
import { detectTransfers } from '../services/transfer-detector.js';
import { refreshRecurringTable } from '../services/recurring-detector.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

export function createImportRoutes() {
  const router = Router();

  // Step 1: upload file, parse, return preview (nothing committed yet)
  router.post('/preview', requireAuth, upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ ok: false, error: 'No file uploaded' });

    const accountId = Number(req.body.accountId);
    const dateFrom = req.body.dateFrom || undefined;
    const dateTo = req.body.dateTo || undefined;
    const profileName = (req.body.profileName as string) || 'natwest';
    let profile: CsvProfile | null = null;

    if (req.body.profile) {
      try { profile = JSON.parse(req.body.profile); } catch { /* fall through */ }
    }
    if (!profile) profile = BUILTIN_PROFILES[profileName] ?? NATWEST_PROFILE;

    const account = AccountQueries.findById.get(accountId);
    if (!account) return res.status(404).json({ ok: false, error: 'Account not found' });

    const parsed = parseCsv(req.file.buffer, profile!, accountId, dateFrom, dateTo);

    // Detect dupes already in DB
    const existingHashes = new Set<string>();
    for (const r of parsed.rows) {
      const hit = TransactionQueries.findByDedupeHash.get(r.dedupeHash, accountId);
      if (hit) existingHashes.add(r.dedupeHash);
    }

    const newCount = parsed.rows.filter(r => !existingHashes.has(r.dedupeHash)).length;
    const dupeCount = parsed.rows.length - newCount;

    res.json({
      ok: true,
      data: {
        headers: parsed.headers,
        totalRows: parsed.totalRows,
        parsedCount: parsed.rows.length,
        newCount,
        dupeCount,
        errorCount: parsed.errors.length,
        errors: parsed.errors.slice(0, 20),
        preview: parsed.rows.slice(0, 25).map(r => ({
          ...r,
          isDupe: existingHashes.has(r.dedupeHash),
        })),
      },
    });
  });

  // Step 2: commit — re-parse and insert (keeps server stateless)
  const CommitSchema = z.object({
    accountId: z.number().int(),
    filename: z.string(),
    dateFrom: z.string().optional(),
    dateTo: z.string().optional(),
    profileName: z.string().optional(),
  });

  router.post('/commit', requireAuth, upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ ok: false, error: 'No file uploaded' });

    const body = {
      accountId: Number(req.body.accountId),
      filename: req.body.filename ?? req.file.originalname,
      dateFrom: req.body.dateFrom || undefined,
      dateTo: req.body.dateTo || undefined,
      profileName: req.body.profileName || 'natwest',
    };
    const parsedBody = CommitSchema.safeParse(body);
    if (!parsedBody.success) return res.status(400).json({ ok: false, error: parsedBody.error.message });

    const profile = BUILTIN_PROFILES[body.profileName] ?? NATWEST_PROFILE;
    const parsed = parseCsv(req.file.buffer, profile, body.accountId, body.dateFrom, body.dateTo);

    let imported = 0;
    let skipped = 0;
    const insertedIds: number[] = [];

    const batchResult = ImportBatchQueries.create.run(
      body.accountId,
      body.filename,
      parsed.totalRows,
      0, 0,
      body.dateFrom ?? null,
      body.dateTo ?? null,
      req.user!.id,
    );
    const batchId = Number(batchResult.lastInsertRowid);

    db.exec('BEGIN');
    try {
      for (const r of parsed.rows) {
        const existing = TransactionQueries.findByDedupeHash.get(r.dedupeHash, body.accountId);
        if (existing) {
          skipped++;
          continue;
        }
        const result = TransactionQueries.insert.run(
          body.accountId, r.date, r.amount, r.description, r.merchant,
          null, 0, batchId, r.dedupeHash, r.balanceAfter,
        );
        insertedIds.push(Number(result.lastInsertRowid));
        imported++;
      }
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }

    // Auto-apply rules to newly-imported rows
    const rulesApplied = applyRulesToTxIds(insertedIds);

    // Detect transfers across the whole DB (cheap for typical sizes)
    const transfersDetected = detectTransfers(3);

    // Refresh recurring charges table
    const recurringDetected = refreshRecurringTable();

    // Update batch counts
    db.prepare('UPDATE import_batches SET imported_count = ?, skipped_count = ? WHERE id = ?')
      .run(imported, skipped, batchId);

    res.json({
      ok: true,
      data: {
        batchId,
        imported,
        skipped,
        errors: parsed.errors.length,
        rulesApplied,
        transfersDetected,
        recurringDetected,
      },
    });
  });

  router.get('/batches', requireAuth, (_req, res) => {
    const rows = ImportBatchQueries.list.all();
    res.json({ ok: true, data: rows });
  });

  router.delete('/batches/:id', requireAuth, (req, res) => {
    const id = Number(req.params.id);
    TransactionQueries.deleteByBatch.run(id);
    ImportBatchQueries.delete.run(id);
    res.json({ ok: true, data: { deleted: id } });
  });

  router.get('/profiles', requireAuth, (_req, res) => {
    res.json({ ok: true, data: Object.entries(BUILTIN_PROFILES).map(([k, v]) => ({ id: k, ...v })) });
  });

  return router;
}
