import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { requireAuth, verifyToken } from '../middleware/auth.js';
import { saveReceipt, ocrReceipt, deleteReceipt } from '../services/receipts-service.js';
import { db } from '../db/schema.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15 MB
});

export function createReceiptsRoutes() {
  const router = Router();

  router.get('/', requireAuth, (req, res) => {
    const transactionId = req.query.transactionId ? Number(req.query.transactionId) : null;
    const rows = transactionId
      ? db.prepare(`SELECT * FROM receipts WHERE transaction_id = ? ORDER BY id DESC`).all(transactionId)
      : db.prepare(`SELECT * FROM receipts ORDER BY id DESC LIMIT 200`).all();
    res.json({ ok: true, data: rows });
  });

  router.post('/upload', requireAuth, upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ ok: false, error: 'No file uploaded' });
    const transactionId = req.body.transactionId ? Number(req.body.transactionId) : null;
    try {
      const result = await saveReceipt(
        req.file.buffer,
        req.file.originalname,
        req.file.mimetype,
        req.user!.id,
        transactionId,
      );
      res.json({ ok: true, data: result });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  router.post('/:id/ocr', requireAuth, async (req, res) => {
    try {
      const result = await ocrReceipt(Number(req.params.id));
      res.json({ ok: true, data: result });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  router.patch('/:id', requireAuth, (req, res) => {
    const { transactionId } = req.body ?? {};
    db.prepare(`UPDATE receipts SET transaction_id = ? WHERE id = ?`)
      .run(transactionId ?? null, Number(req.params.id));
    res.json({ ok: true, data: { id: Number(req.params.id) } });
  });

  router.delete('/:id', requireAuth, async (req, res) => {
    await deleteReceipt(Number(req.params.id));
    res.json({ ok: true, data: { deleted: Number(req.params.id) } });
  });

  // Image file serving — authenticated via ?token= query param (images can't send headers)
  router.get('/file/:id', (req, res) => {
    const token = req.query.token as string | undefined;
    if (!token || !verifyToken(token)) return res.status(401).send('Unauthorised');

    const thumb = req.query.thumb === '1';
    const row = db.prepare(`SELECT * FROM receipts WHERE id = ?`).get(Number(req.params.id)) as any;
    if (!row) return res.status(404).send('Not found');

    const filepath = thumb ? (row.thumbnail_path ?? row.filepath) : row.filepath;
    if (!fs.existsSync(filepath)) return res.status(404).send('File missing');

    res.setHeader('Content-Type', thumb ? 'image/jpeg' : row.mime_type);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    fs.createReadStream(filepath).pipe(res);
  });

  return router;
}
