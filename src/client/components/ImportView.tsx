import { useState, useCallback, DragEvent } from 'react';
import { Upload, FileText, CheckCircle2, AlertTriangle, Copy, Trash2, X } from 'lucide-react';
import { Card, CardHeader, CardTitle } from './ui/Card';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { Select } from './ui/Select';
import { Money } from './ui/Money';
import { EmptyState } from './ui/EmptyState';
import { useAccounts } from '../hooks/useAccounts';
import { api, getToken } from '../lib/api';

interface Preview {
  headers: string[];
  totalRows: number;
  parsedCount: number;
  newCount: number;
  dupeCount: number;
  errorCount: number;
  errors: Array<{ rowIndex: number; error: string }>;
  preview: Array<{
    date: string;
    amount: number;
    description: string;
    merchant: string | null;
    balanceAfter: number | null;
    isDupe: boolean;
  }>;
}

interface Batch {
  id: number;
  filename: string;
  imported_count: number;
  skipped_count: number;
  row_count: number;
  date_from: string | null;
  date_to: string | null;
  created_at: string;
  account_name: string;
  created_by_name: string;
}

export function ImportView() {
  const { accounts } = useAccounts();
  const [file, setFile] = useState<File | null>(null);
  const [accountId, setAccountId] = useState<number | ''>('');
  const [profileName, setProfileName] = useState('natwest');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [dragOver, setDragOver] = useState(false);

  const loadBatches = useCallback(async () => {
    try {
      const data = await api<Batch[]>('/import/batches');
      setBatches(data);
    } catch {}
  }, []);

  useState(() => { loadBatches(); });

  async function doPreview() {
    if (!file || !accountId) return;
    setBusy(true);
    setError(null);
    setPreview(null);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('accountId', String(accountId));
      form.append('profileName', profileName);
      if (dateFrom) form.append('dateFrom', dateFrom);
      if (dateTo) form.append('dateTo', dateTo);

      const res = await fetch('/api/import/preview', {
        method: 'POST',
        headers: { Authorization: `Bearer ${getToken()}` },
        body: form,
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error);
      setPreview(json.data);
    } catch (e: any) {
      setError(e.message ?? 'Preview failed');
    } finally {
      setBusy(false);
    }
  }

  async function doCommit() {
    if (!file || !accountId) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('accountId', String(accountId));
      form.append('filename', file.name);
      form.append('profileName', profileName);
      if (dateFrom) form.append('dateFrom', dateFrom);
      if (dateTo) form.append('dateTo', dateTo);

      const res = await fetch('/api/import/commit', {
        method: 'POST',
        headers: { Authorization: `Bearer ${getToken()}` },
        body: form,
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error);

      await loadBatches();
      resetForm();
    } catch (e: any) {
      setError(e.message ?? 'Import failed');
    } finally {
      setBusy(false);
    }
  }

  function resetForm() {
    setFile(null);
    setPreview(null);
    setDateFrom('');
    setDateTo('');
    setError(null);
  }

  async function undoBatch(id: number) {
    if (!confirm('Delete this import and all its transactions?')) return;
    await api(`/import/batches/${id}`, { method: 'DELETE' });
    await loadBatches();
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) setFile(f);
  }

  return (
    <div className="flex flex-col gap-6 fade-up">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight">Import</h1>
        <p className="text-sm text-[var(--color-text-3)] mt-1">
          Upload a CSV bank statement — NatWest supported out of the box
        </p>
      </div>

      {accounts.length === 0 ? (
        <Card padding="lg">
          <EmptyState
            icon={<Upload className="w-7 h-7" />}
            title="Add an account first"
            description="You need at least one account before you can import transactions"
          />
        </Card>
      ) : (
        <>
          {/* Upload zone */}
          <Card padding="lg">
            <CardHeader>
              <CardTitle subtitle="Drop a CSV file or click to browse">Upload statement</CardTitle>
            </CardHeader>

            {!file ? (
              <label
                onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={onDrop}
                className={`flex flex-col items-center justify-center py-12 rounded-[16px] border-2 border-dashed cursor-pointer transition ${
                  dragOver
                    ? 'border-[var(--color-mint)] bg-[var(--color-mint-soft)]'
                    : 'border-[var(--color-border)] hover:border-[var(--color-border-strong)] hover:bg-[var(--color-bg-elevated)]'
                }`}
              >
                <input
                  type="file"
                  accept=".csv,.txt"
                  className="hidden"
                  onChange={e => setFile(e.target.files?.[0] ?? null)}
                />
                <Upload className="w-8 h-8 text-[var(--color-text-3)] mb-3" />
                <div className="text-sm font-semibold text-[var(--color-text)]">
                  Drop CSV here or click to browse
                </div>
                <div className="text-xs text-[var(--color-text-4)] mt-1">Max 10 MB</div>
              </label>
            ) : (
              <div className="flex items-center justify-between bg-[var(--color-bg-elevated)] rounded-[14px] border border-[var(--color-border)] p-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-[var(--color-mint-soft)] text-[var(--color-mint)] flex items-center justify-center">
                    <FileText className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold">{file.name}</div>
                    <div className="text-xs text-[var(--color-text-3)]">{(file.size / 1024).toFixed(1)} KB</div>
                  </div>
                </div>
                <button
                  onClick={resetForm}
                  className="w-8 h-8 rounded-lg hover:bg-[var(--color-coral-soft)] text-[var(--color-text-3)] hover:text-[var(--color-coral)] flex items-center justify-center"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}

            {file && (
              <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-4">
                <Select
                  label="Account"
                  value={accountId}
                  onChange={e => setAccountId(Number(e.target.value))}
                  options={[
                    { value: '', label: 'Select account…' },
                    ...accounts.map(a => ({ value: a.id, label: a.name })),
                  ]}
                />
                <Select
                  label="Format"
                  value={profileName}
                  onChange={e => setProfileName(e.target.value)}
                  options={[
                    { value: 'natwest', label: 'NatWest CSV' },
                  ]}
                />
                <Input
                  label="From date (optional)"
                  type="date"
                  value={dateFrom}
                  onChange={e => setDateFrom(e.target.value)}
                  hint="Skip rows before this date"
                />
                <Input
                  label="To date (optional)"
                  type="date"
                  value={dateTo}
                  onChange={e => setDateTo(e.target.value)}
                  hint="Skip rows after this date"
                />
              </div>
            )}

            {file && (
              <div className="flex items-center gap-3 mt-6">
                <Button variant="secondary" onClick={doPreview} disabled={!accountId || busy}>
                  {busy && !preview ? 'Parsing…' : 'Preview'}
                </Button>
                {preview && (
                  <Button variant="primary" onClick={doCommit} disabled={busy || preview.newCount === 0}>
                    {busy ? 'Importing…' : `Import ${preview.newCount} transactions`}
                  </Button>
                )}
              </div>
            )}

            {error && (
              <div className="mt-4 text-sm text-[var(--color-coral)] bg-[var(--color-coral-soft)] border border-[rgba(251,113,133,0.2)] rounded-[12px] px-4 py-3">
                {error}
              </div>
            )}
          </Card>

          {/* Preview */}
          {preview && (
            <Card padding="lg">
              <CardHeader>
                <CardTitle subtitle="Review before importing">Preview</CardTitle>
              </CardHeader>

              <div className="grid grid-cols-4 gap-3 mb-5">
                <Stat icon={<FileText className="w-3.5 h-3.5" />} label="Total rows" value={preview.totalRows} />
                <Stat icon={<CheckCircle2 className="w-3.5 h-3.5" />} label="New" value={preview.newCount} color="mint" />
                <Stat icon={<Copy className="w-3.5 h-3.5" />} label="Duplicates" value={preview.dupeCount} color="amber" />
                <Stat icon={<AlertTriangle className="w-3.5 h-3.5" />} label="Errors" value={preview.errorCount} color="coral" />
              </div>

              {preview.preview.length > 0 && (
                <div className="border border-[var(--color-border)] rounded-[14px] overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-[var(--color-bg-elevated)] text-[10px] uppercase tracking-wider text-[var(--color-text-4)] font-semibold">
                        <th className="text-left px-4 py-3">Date</th>
                        <th className="text-left px-4 py-3">Description</th>
                        <th className="text-right px-4 py-3">Amount</th>
                        <th className="text-right px-4 py-3">Balance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.preview.map((r, i) => (
                        <tr key={i} className={`border-t border-[var(--color-border)] ${r.isDupe ? 'opacity-40' : ''}`}>
                          <td className="px-4 py-3 tabular text-[var(--color-text-3)]">{r.date}</td>
                          <td className="px-4 py-3 truncate max-w-xs">
                            {r.description}
                            {r.isDupe && <span className="ml-2 text-[10px] text-[var(--color-amber)] uppercase">dupe</span>}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <Money pence={r.amount} signed color={r.amount >= 0 ? 'positive' : 'negative'} />
                          </td>
                          <td className="px-4 py-3 text-right text-[var(--color-text-3)]">
                            {r.balanceAfter !== null && <Money pence={r.balanceAfter} color="muted" />}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {preview.errors.length > 0 && (
                <div className="mt-4 text-xs text-[var(--color-coral)]">
                  {preview.errors.slice(0, 5).map((e, i) => (
                    <div key={i}>Row {e.rowIndex + 1}: {e.error}</div>
                  ))}
                  {preview.errors.length > 5 && <div>…and {preview.errors.length - 5} more</div>}
                </div>
              )}
            </Card>
          )}

          {/* History */}
          <Card padding="lg">
            <CardHeader>
              <CardTitle subtitle="Previous imports — click trash to undo">Import history</CardTitle>
            </CardHeader>
            {batches.length === 0 ? (
              <div className="text-sm text-[var(--color-text-3)] py-6 text-center">No imports yet</div>
            ) : (
              <div className="flex flex-col gap-2">
                {batches.map(b => (
                  <div key={b.id} className="flex items-center justify-between bg-[var(--color-bg-elevated)] border border-[var(--color-border)] rounded-[12px] px-4 py-3">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold truncate">{b.filename}</div>
                      <div className="text-xs text-[var(--color-text-3)] mt-0.5">
                        {b.account_name} · {b.created_by_name} · {new Date(b.created_at).toLocaleString()}
                        {b.date_from && ` · ${b.date_from}→${b.date_to}`}
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <div className="text-sm font-semibold text-[var(--color-mint)] tabular">+{b.imported_count}</div>
                        <div className="text-[10px] text-[var(--color-text-4)] uppercase tracking-wider">imported</div>
                      </div>
                      <button
                        onClick={() => undoBatch(b.id)}
                        className="w-8 h-8 rounded-lg hover:bg-[var(--color-coral-soft)] text-[var(--color-text-3)] hover:text-[var(--color-coral)] flex items-center justify-center"
                        title="Undo import"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

function Stat({
  icon, label, value, color = 'neutral',
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  color?: 'neutral' | 'mint' | 'amber' | 'coral';
}) {
  const colorMap = {
    neutral: 'text-[var(--color-text)]',
    mint: 'text-[var(--color-mint)]',
    amber: 'text-[var(--color-amber)]',
    coral: 'text-[var(--color-coral)]',
  };
  return (
    <div className="bg-[var(--color-bg-elevated)] rounded-[12px] border border-[var(--color-border)] px-4 py-3">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-[var(--color-text-4)] font-semibold">
        {icon} {label}
      </div>
      <div className={`text-2xl font-bold mt-1 tabular ${colorMap[color]}`}>{value}</div>
    </div>
  );
}
