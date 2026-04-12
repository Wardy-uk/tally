import { useCallback, useEffect, useRef, useState } from 'react';
import { Upload, Receipt, Sparkles, Trash2, Camera, X } from 'lucide-react';
import { Card, CardHeader, CardTitle } from './ui/Card';
import { Button } from './ui/Button';
import { Modal } from './ui/Modal';
import { Money } from './ui/Money';
import { EmptyState } from './ui/EmptyState';
import { api, getToken } from '../lib/api';

interface ReceiptRow {
  id: number;
  transaction_id: number | null;
  filepath: string;
  thumbnail_path: string | null;
  mime_type: string;
  size_bytes: number;
  ocr_merchant: string | null;
  ocr_total: number | null;
  ocr_date: string | null;
  created_at: string;
}

export function ReceiptsView() {
  const [receipts, setReceipts] = useState<ReceiptRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [busyIds, setBusyIds] = useState<Set<number>>(new Set());
  const [detail, setDetail] = useState<ReceiptRow | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setReceipts(await api<ReceiptRow[]>('/receipts'));
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const form = new FormData();
        form.append('file', file);
        await fetch('/api/receipts/upload', {
          method: 'POST',
          headers: { Authorization: `Bearer ${getToken()}` },
          body: form,
        });
      }
      await load();
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function runOcr(id: number) {
    setBusyIds(s => new Set(s).add(id));
    try {
      await api(`/receipts/${id}/ocr`, { method: 'POST' });
      await load();
    } catch (e: any) {
      alert(e.error ?? 'OCR failed');
    } finally {
      setBusyIds(s => { const n = new Set(s); n.delete(id); return n; });
    }
  }

  async function del(id: number) {
    if (!confirm('Delete this receipt?')) return;
    await api(`/receipts/${id}`, { method: 'DELETE' });
    await load();
    if (detail?.id === id) setDetail(null);
  }

  return (
    <div className="flex flex-col gap-6 fade-up">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">Receipts</h1>
          <p className="text-sm text-[var(--color-text-3)] mt-1">
            {receipts.length} receipt{receipts.length !== 1 && 's'} — take photos on your phone and they'll auto-match to transactions
          </p>
        </div>
        <div className="flex gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={e => handleFiles(e.target.files)}
          />
          <Button
            variant="secondary"
            icon={<Camera className="w-4 h-4" />}
            onClick={() => {
              const input = document.createElement('input');
              input.type = 'file';
              input.accept = 'image/*';
              input.capture = 'environment';
              input.onchange = e => handleFiles((e.target as HTMLInputElement).files);
              input.click();
            }}
          >
            Take photo
          </Button>
          <Button
            variant="primary"
            icon={<Upload className="w-4 h-4" />}
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? 'Uploading…' : 'Upload'}
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="text-sm text-[var(--color-text-3)]">Loading…</div>
      ) : receipts.length === 0 ? (
        <Card padding="lg">
          <EmptyState
            icon={<Receipt className="w-7 h-7" />}
            title="No receipts yet"
            description="Snap a photo of a receipt — Tally uses GPT-4o vision to read the merchant, total and date, then matches it to a transaction."
            action={
              <Button variant="primary" icon={<Upload className="w-4 h-4" />} onClick={() => fileRef.current?.click()}>
                Upload receipt
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {receipts.map(r => (
            <ReceiptCard
              key={r.id}
              r={r}
              busy={busyIds.has(r.id)}
              onOcr={() => runOcr(r.id)}
              onDelete={() => del(r.id)}
              onOpen={() => setDetail(r)}
            />
          ))}
        </div>
      )}

      <ReceiptDetail receipt={detail} onClose={() => setDetail(null)} onDelete={del} />
    </div>
  );
}

function ReceiptCard({
  r, busy, onOcr, onDelete, onOpen,
}: {
  r: ReceiptRow;
  busy: boolean;
  onOcr: () => void;
  onDelete: () => void;
  onOpen: () => void;
}) {
  const token = getToken();
  return (
    <div className="group relative bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[16px] overflow-hidden hover:border-[var(--color-border-strong)] transition">
      <button onClick={onOpen} className="block w-full aspect-[3/4] bg-[var(--color-bg-elevated)] relative">
        <img
          src={`/api/receipts/file/${r.id}?thumb=1&token=${token}`}
          alt="Receipt"
          className="w-full h-full object-cover"
          loading="lazy"
        />
        {r.transaction_id && (
          <div className="absolute top-2 right-2 w-6 h-6 rounded-full bg-[var(--color-mint)] text-[#04140a] flex items-center justify-center text-[10px] font-bold">
            ✓
          </div>
        )}
      </button>
      <div className="p-3">
        <div className="text-xs font-semibold truncate">
          {r.ocr_merchant ?? '—'}
        </div>
        <div className="flex items-center justify-between mt-1">
          <span className="text-[10px] text-[var(--color-text-4)]">{r.ocr_date ?? new Date(r.created_at).toISOString().slice(0, 10)}</span>
          {r.ocr_total !== null && <Money pence={r.ocr_total} size="sm" color="negative" />}
        </div>
      </div>
      <div className="absolute top-2 left-2 flex gap-1 opacity-0 group-hover:opacity-100 transition">
        {!r.ocr_merchant && (
          <button
            onClick={e => { e.stopPropagation(); onOcr(); }}
            disabled={busy}
            className="w-7 h-7 rounded-lg bg-[var(--color-violet-soft)] text-[var(--color-violet)] hover:bg-[var(--color-violet)] hover:text-white flex items-center justify-center backdrop-blur"
            title="Read with AI"
          >
            <Sparkles className="w-3.5 h-3.5" />
          </button>
        )}
        <button
          onClick={e => { e.stopPropagation(); onDelete(); }}
          className="w-7 h-7 rounded-lg bg-[var(--color-coral-soft)] text-[var(--color-coral)] hover:bg-[var(--color-coral)] hover:text-white flex items-center justify-center backdrop-blur"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

function ReceiptDetail({
  receipt, onClose, onDelete,
}: {
  receipt: ReceiptRow | null;
  onClose: () => void;
  onDelete: (id: number) => void;
}) {
  if (!receipt) return null;
  const token = getToken();
  return (
    <Modal
      open={!!receipt}
      onClose={onClose}
      title={receipt.ocr_merchant ?? 'Receipt'}
      subtitle={receipt.ocr_date ?? new Date(receipt.created_at).toLocaleDateString()}
      maxWidth="640px"
      footer={
        <>
          <Button variant="danger" onClick={() => onDelete(receipt.id)} icon={<Trash2 className="w-4 h-4" />}>
            Delete
          </Button>
          <Button variant="ghost" onClick={onClose}>Close</Button>
        </>
      }
    >
      <div className="flex flex-col items-center gap-4">
        <img
          src={`/api/receipts/file/${receipt.id}?token=${token}`}
          alt="Receipt"
          className="max-h-[50vh] rounded-[14px] border border-[var(--color-border)]"
        />
        {receipt.ocr_total !== null && (
          <div className="flex items-center gap-4 bg-[var(--color-bg-elevated)] rounded-[14px] px-5 py-3 border border-[var(--color-border)]">
            <div className="text-[10px] uppercase tracking-wider text-[var(--color-text-4)] font-semibold">OCR total</div>
            <Money pence={receipt.ocr_total} size="xl" color="neutral" />
          </div>
        )}
        {receipt.transaction_id && (
          <div className="text-xs text-[var(--color-mint)]">Linked to transaction #{receipt.transaction_id}</div>
        )}
      </div>
    </Modal>
  );
}
