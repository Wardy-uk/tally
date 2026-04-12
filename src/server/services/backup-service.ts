import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.resolve(__dirname, '../../../tally.db');
const BACKUPS_DIR = path.resolve(__dirname, '../../../backups');

export async function ensureBackupsDir(): Promise<void> {
  await fs.mkdir(BACKUPS_DIR, { recursive: true });
}

export async function createBackup(): Promise<string> {
  await ensureBackupsDir();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const target = path.join(BACKUPS_DIR, `tally-${stamp}.db`);
  await fs.copyFile(DB_PATH, target);
  return target;
}

export async function listBackups(): Promise<Array<{ filename: string; size: number; mtime: string }>> {
  await ensureBackupsDir();
  const entries = await fs.readdir(BACKUPS_DIR);
  const out: Array<{ filename: string; size: number; mtime: string }> = [];
  for (const f of entries) {
    if (!f.endsWith('.db')) continue;
    const stat = await fs.stat(path.join(BACKUPS_DIR, f));
    out.push({ filename: f, size: stat.size, mtime: stat.mtime.toISOString() });
  }
  return out.sort((a, b) => b.mtime.localeCompare(a.mtime));
}

/** Keep only the last `keep` backups; delete older ones. */
export async function pruneBackups(keep = 14): Promise<number> {
  const all = await listBackups();
  const toDelete = all.slice(keep);
  for (const b of toDelete) {
    await fs.unlink(path.join(BACKUPS_DIR, b.filename));
  }
  return toDelete.length;
}
