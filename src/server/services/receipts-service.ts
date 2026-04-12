import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { db } from '../db/schema.js';
import { getOpenAI, getModel, isConfigured } from './openai-service.js';

// Lazy-load sharp — it has no prebuilt binaries for Windows ARM64 but works fine on Pi 5.
// If sharp can't load we skip thumbnailing (fall back to copying the original).
let _sharp: any = null;
let _sharpChecked = false;
async function getSharp(): Promise<any | null> {
  if (_sharpChecked) return _sharp;
  _sharpChecked = true;
  try {
    const mod = await import('sharp');
    _sharp = (mod as any).default ?? mod;
  } catch (e) {
    console.warn('[receipts] sharp unavailable — thumbnails will be copies of originals');
    _sharp = null;
  }
  return _sharp;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RECEIPTS_ROOT = path.resolve(__dirname, '../../../receipts');

export async function ensureReceiptsDir(): Promise<string> {
  await fs.mkdir(RECEIPTS_ROOT, { recursive: true });
  return RECEIPTS_ROOT;
}

export function getReceiptsRoot(): string {
  return RECEIPTS_ROOT;
}

export interface SaveResult {
  id: number;
  filepath: string;
  thumbnailPath: string;
}

export async function saveReceipt(
  buffer: Buffer,
  originalName: string,
  mimeType: string,
  userId: number,
  transactionId: number | null = null,
): Promise<SaveResult> {
  await ensureReceiptsDir();

  const now = new Date();
  const yyyy = String(now.getFullYear());
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dir = path.join(RECEIPTS_ROOT, yyyy, mm);
  await fs.mkdir(dir, { recursive: true });

  const hash = crypto.randomBytes(8).toString('hex');
  const ext = path.extname(originalName).toLowerCase() || '.jpg';
  const base = `${Date.now()}-${hash}`;
  const filepath = path.join(dir, `${base}${ext}`);
  const thumbPath = path.join(dir, `${base}-thumb.jpg`);

  await fs.writeFile(filepath, buffer);

  // Generate thumbnail (max 400px wide) if sharp is available
  const sharp = await getSharp();
  if (sharp) {
    try {
      await sharp(buffer).rotate().resize({ width: 400, withoutEnlargement: true }).jpeg({ quality: 80 }).toFile(thumbPath);
    } catch {
      await fs.copyFile(filepath, thumbPath);
    }
  } else {
    await fs.copyFile(filepath, thumbPath);
  }

  const result = db.prepare(`
    INSERT INTO receipts (transaction_id, filepath, thumbnail_path, mime_type, size_bytes, uploaded_by_user_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(transactionId, filepath, thumbPath, mimeType, buffer.length, userId);

  return {
    id: Number(result.lastInsertRowid),
    filepath,
    thumbnailPath: thumbPath,
  };
}

/** OCR a receipt image using GPT-4o vision. Returns extracted fields. */
export async function ocrReceipt(receiptId: number): Promise<{
  merchant: string | null;
  total: number | null; // pence
  date: string | null;
  rawResponse?: string;
}> {
  if (!isConfigured()) throw new Error('OpenAI API key not set');

  const row = db.prepare(`SELECT * FROM receipts WHERE id = ?`).get(receiptId) as any;
  if (!row) throw new Error('Receipt not found');

  const buffer = await fs.readFile(row.filepath);
  const base64 = buffer.toString('base64');
  const mimeType = row.mime_type;

  const openai = getOpenAI()!;
  const res = await openai.chat.completions.create({
    model: 'gpt-4o', // needs vision capability
    messages: [
      {
        role: 'system',
        content: 'You are a receipt reader. Extract the merchant name, total amount, and date from a receipt photo. Return JSON only.',
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'Extract from this receipt: { "merchant": "...", "total_gbp": 12.34, "date": "YYYY-MM-DD" }. Use null for any field you cannot read confidently.',
          },
          {
            type: 'image_url',
            image_url: { url: `data:${mimeType};base64,${base64}`, detail: 'high' },
          },
        ] as any,
      },
    ],
    response_format: { type: 'json_object' },
    temperature: 0,
  });

  const content = res.choices[0]?.message?.content ?? '{}';
  const parsed = JSON.parse(content) as { merchant: string | null; total_gbp: number | null; date: string | null };

  const totalPence = parsed.total_gbp !== null ? Math.round(parsed.total_gbp * 100) : null;

  db.prepare(`
    UPDATE receipts SET ocr_merchant = ?, ocr_total = ?, ocr_date = ? WHERE id = ?
  `).run(parsed.merchant, totalPence, parsed.date, receiptId);

  // Try auto-match to a transaction
  if (totalPence && parsed.date && !row.transaction_id) {
    const match = db.prepare(`
      SELECT id FROM transactions
      WHERE amount = ?
        AND date BETWEEN date(?, '-3 days') AND date(?, '+3 days')
        AND is_transfer = 0
      ORDER BY ABS(julianday(?) - julianday(date))
      LIMIT 1
    `).get(-totalPence, parsed.date, parsed.date, parsed.date) as { id: number } | undefined;

    if (match) {
      db.prepare(`UPDATE receipts SET transaction_id = ? WHERE id = ?`).run(match.id, receiptId);
    }
  }

  return {
    merchant: parsed.merchant,
    total: totalPence,
    date: parsed.date,
    rawResponse: content,
  };
}

export async function deleteReceipt(id: number): Promise<void> {
  const row = db.prepare(`SELECT * FROM receipts WHERE id = ?`).get(id) as any;
  if (!row) return;
  try { await fs.unlink(row.filepath); } catch {}
  try { if (row.thumbnail_path) await fs.unlink(row.thumbnail_path); } catch {}
  db.prepare(`DELETE FROM receipts WHERE id = ?`).run(id);
}
