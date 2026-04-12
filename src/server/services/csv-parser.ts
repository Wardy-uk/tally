import Papa from 'papaparse';
import crypto from 'crypto';

export interface CsvProfile {
  name: string;
  delimiter?: string;
  skipRows?: number;
  dateColumn: string;
  /** Date format tokens: DD, MM, YYYY, YY */
  dateFormat: string;
  descriptionColumn: string;
  /** Single signed amount column (e.g. NatWest "Value") */
  amountColumn?: string;
  /** Or split debit/credit columns */
  debitColumn?: string;
  creditColumn?: string;
  balanceColumn?: string;
  /** Optional merchant extraction column (falls back to description) */
  merchantColumn?: string;
}

export interface ParsedRow {
  date: string; // YYYY-MM-DD
  amount: number; // pence, signed
  description: string;
  merchant: string | null;
  balanceAfter: number | null;
  dedupeHash: string;
  rawRowIndex: number;
}

export interface ParseResult {
  rows: ParsedRow[];
  errors: Array<{ rowIndex: number; error: string }>;
  headers: string[];
  totalRows: number;
}

export const NATWEST_PROFILE: CsvProfile = {
  name: 'NatWest',
  delimiter: ',',
  skipRows: 0,
  dateColumn: 'Date',
  dateFormat: 'DD/MM/YYYY',
  descriptionColumn: 'Description',
  amountColumn: 'Value',
  balanceColumn: 'Balance',
};

export const BUILTIN_PROFILES: Record<string, CsvProfile> = {
  natwest: NATWEST_PROFILE,
};

function parseDate(input: string, format: string): string | null {
  if (!input) return null;
  const v = input.trim().replace(/"/g, '');

  // Try ISO first
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);

  // Token-based parse
  const tokens: Record<string, string> = {};
  let fmtIdx = 0;
  let inputIdx = 0;
  const fmt = format;

  while (fmtIdx < fmt.length && inputIdx < v.length) {
    const t = fmt.slice(fmtIdx);
    if (t.startsWith('YYYY')) {
      tokens.YYYY = v.slice(inputIdx, inputIdx + 4);
      fmtIdx += 4;
      inputIdx += 4;
    } else if (t.startsWith('YY')) {
      tokens.YY = v.slice(inputIdx, inputIdx + 2);
      fmtIdx += 2;
      inputIdx += 2;
    } else if (t.startsWith('DD')) {
      tokens.DD = v.slice(inputIdx, inputIdx + 2);
      fmtIdx += 2;
      inputIdx += 2;
    } else if (t.startsWith('MM')) {
      tokens.MM = v.slice(inputIdx, inputIdx + 2);
      fmtIdx += 2;
      inputIdx += 2;
    } else {
      fmtIdx += 1;
      inputIdx += 1;
    }
  }

  const yyyy = tokens.YYYY ?? (tokens.YY ? `20${tokens.YY}` : null);
  if (!yyyy || !tokens.MM || !tokens.DD) return null;
  const iso = `${yyyy}-${tokens.MM.padStart(2, '0')}-${tokens.DD.padStart(2, '0')}`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return iso;
}

function parseAmount(input: string): number | null {
  if (input === null || input === undefined || input === '') return null;
  const cleaned = String(input).replace(/[£$,\s"]/g, '').replace(/[()]/g, m => m === '(' ? '-' : '');
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  return Math.round(parseFloat(cleaned) * 100);
}

function hashRow(accountId: number, date: string, amount: number, description: string): string {
  return crypto
    .createHash('sha256')
    .update(`${accountId}|${date}|${amount}|${description.trim().toLowerCase()}`)
    .digest('hex')
    .slice(0, 32);
}

export function parseCsv(
  fileBuffer: Buffer | string,
  profile: CsvProfile,
  accountId: number,
  dateFrom?: string,
  dateTo?: string,
): ParseResult {
  const text = Buffer.isBuffer(fileBuffer) ? fileBuffer.toString('utf-8') : fileBuffer;
  const content = (profile.skipRows ?? 0) > 0
    ? text.split(/\r?\n/).slice(profile.skipRows).join('\n')
    : text;

  const parsed = Papa.parse<Record<string, string>>(content, {
    header: true,
    skipEmptyLines: true,
    delimiter: profile.delimiter ?? ',',
    transformHeader: h => h.trim().replace(/^\ufeff/, ''),
  });

  const rows: ParsedRow[] = [];
  const errors: ParseResult['errors'] = [];
  const headers = parsed.meta.fields ?? [];

  parsed.data.forEach((row, i) => {
    try {
      const dateStr = row[profile.dateColumn];
      const date = parseDate(dateStr, profile.dateFormat);
      if (!date) {
        errors.push({ rowIndex: i, error: `Invalid date: "${dateStr}"` });
        return;
      }

      let amount: number | null = null;
      if (profile.amountColumn) {
        amount = parseAmount(row[profile.amountColumn]);
      } else if (profile.debitColumn && profile.creditColumn) {
        const debit = parseAmount(row[profile.debitColumn]) ?? 0;
        const credit = parseAmount(row[profile.creditColumn]) ?? 0;
        amount = credit - debit;
      }
      if (amount === null) {
        errors.push({ rowIndex: i, error: `Invalid amount` });
        return;
      }

      const description = (row[profile.descriptionColumn] ?? '').trim().replace(/\s+/g, ' ');
      if (!description) {
        errors.push({ rowIndex: i, error: `Missing description` });
        return;
      }

      // Filter by timeframe if set
      if (dateFrom && date < dateFrom) return;
      if (dateTo && date > dateTo) return;

      const merchant = profile.merchantColumn ? (row[profile.merchantColumn] ?? null) : null;
      const balanceAfter = profile.balanceColumn ? parseAmount(row[profile.balanceColumn]) : null;

      rows.push({
        date,
        amount,
        description,
        merchant,
        balanceAfter,
        dedupeHash: hashRow(accountId, date, amount, description),
        rawRowIndex: i,
      });
    } catch (e: any) {
      errors.push({ rowIndex: i, error: e.message });
    }
  });

  return { rows, errors, headers, totalRows: parsed.data.length };
}
