import { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2, Zap, Wand2 } from 'lucide-react';
import { Card, CardHeader, CardTitle } from './ui/Card';
import { Button } from './ui/Button';
import { Modal } from './ui/Modal';
import { Input } from './ui/Input';
import { Select } from './ui/Select';
import { EmptyState } from './ui/EmptyState';
import { api } from '../lib/api';
import { useCategories } from '../hooks/useCategories';

interface Rule {
  id: number;
  name: string;
  match_field: 'description' | 'merchant' | 'amount';
  match_type: 'contains' | 'equals' | 'regex' | 'startsWith';
  match_value: string;
  category_id: number;
  priority: number;
  created_at: string;
}

export function RulesView() {
  const { categories } = useCategories();
  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [applying, setApplying] = useState(false);
  const [appliedFeedback, setAppliedFeedback] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api<Rule[]>('/rules');
      setRules(data);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  async function applyToBacklog() {
    setApplying(true);
    try {
      const r = await api<{ applied: number }>('/rules/apply', { method: 'POST' });
      setAppliedFeedback(`Categorised ${r.applied} transaction${r.applied !== 1 ? 's' : ''}`);
      setTimeout(() => setAppliedFeedback(null), 4000);
    } finally { setApplying(false); }
  }

  async function del(id: number) {
    if (!confirm('Delete this rule?')) return;
    await api(`/rules/${id}`, { method: 'DELETE' });
    refresh();
  }

  const catById = new Map(categories.map(c => [c.id, c]));

  return (
    <div className="flex flex-col gap-6 fade-up">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">Rules</h1>
          <p className="text-sm text-[var(--color-text-3)] mt-1">
            Automatic categorisation — runs on every import and when you click Apply
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" icon={<Wand2 className="w-4 h-4" />} onClick={applyToBacklog} disabled={applying}>
            {applying ? 'Applying…' : 'Apply to backlog'}
          </Button>
          <Button variant="primary" icon={<Plus className="w-4 h-4" />} onClick={() => setAdding(true)}>
            New rule
          </Button>
        </div>
      </div>

      {appliedFeedback && (
        <div className="bg-[var(--color-mint-soft)] border border-[rgba(74,222,128,0.25)] text-[var(--color-mint)] rounded-[12px] px-4 py-3 text-sm">
          {appliedFeedback}
        </div>
      )}

      <Card padding="none">
        {loading ? (
          <div className="text-sm text-[var(--color-text-3)] py-12 text-center">Loading…</div>
        ) : rules.length === 0 ? (
          <EmptyState
            icon={<Zap className="w-7 h-7" />}
            title="No rules yet"
            description="Rules automatically categorise your transactions. Create one from scratch, or tick 'Apply to similar' when editing a transaction."
            action={<Button variant="primary" icon={<Plus className="w-4 h-4" />} onClick={() => setAdding(true)}>New rule</Button>}
          />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-[var(--color-text-4)] font-semibold border-b border-[var(--color-border)]">
                <th className="text-left px-5 py-3">Rule</th>
                <th className="text-left px-5 py-3">Match</th>
                <th className="text-left px-5 py-3">Category</th>
                <th className="text-right px-5 py-3">Priority</th>
                <th className="w-12"></th>
              </tr>
            </thead>
            <tbody>
              {rules.map(r => {
                const cat = catById.get(r.category_id);
                return (
                  <tr key={r.id} className="border-b border-[var(--color-border)] hover:bg-[var(--color-bg-elevated)]">
                    <td className="px-5 py-3.5 font-medium">{r.name}</td>
                    <td className="px-5 py-3.5 text-[var(--color-text-3)]">
                      <span className="text-[var(--color-text-4)]">{r.match_field}</span>
                      <span className="mx-2 text-[var(--color-text-4)]">{r.match_type}</span>
                      <span className="mono text-xs bg-[var(--color-bg-elevated)] px-2 py-1 rounded border border-[var(--color-border)]">{r.match_value}</span>
                    </td>
                    <td className="px-5 py-3.5" style={{ color: cat?.color ?? undefined }}>{cat?.name ?? '—'}</td>
                    <td className="px-5 py-3.5 text-right tabular text-[var(--color-text-3)]">{r.priority}</td>
                    <td className="px-3 py-3.5">
                      <button
                        onClick={() => del(r.id)}
                        className="w-8 h-8 rounded-lg hover:bg-[var(--color-coral-soft)] text-[var(--color-text-3)] hover:text-[var(--color-coral)] flex items-center justify-center"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      <AddRuleModal open={adding} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); refresh(); }} categories={categories} />
    </div>
  );
}

function AddRuleModal({
  open, onClose, onSaved, categories,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  categories: Array<{ id: number; name: string }>;
}) {
  const [name, setName] = useState('');
  const [matchField, setMatchField] = useState<'description' | 'merchant' | 'amount'>('description');
  const [matchType, setMatchType] = useState<'contains' | 'equals' | 'regex' | 'startsWith'>('contains');
  const [matchValue, setMatchValue] = useState('');
  const [categoryId, setCategoryId] = useState<number>(categories[0]?.id ?? 0);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      await api('/rules', {
        method: 'POST',
        body: JSON.stringify({ name, matchField, matchType, matchValue, categoryId, priority: 100 }),
      });
      setName(''); setMatchValue('');
      onSaved();
    } finally { setBusy(false); }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New rule"
      subtitle="Match transactions and assign a category"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={!name || !matchValue || !categoryId || busy}>
            {busy ? 'Saving…' : 'Create rule'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Input label="Rule name" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Tesco" />
        <div className="grid grid-cols-2 gap-4">
          <Select
            label="Match on"
            value={matchField}
            onChange={e => setMatchField(e.target.value as any)}
            options={[
              { value: 'description', label: 'Description' },
              { value: 'merchant', label: 'Merchant' },
              { value: 'amount', label: 'Amount (pence)' },
            ]}
          />
          <Select
            label="Match type"
            value={matchType}
            onChange={e => setMatchType(e.target.value as any)}
            options={[
              { value: 'contains', label: 'Contains' },
              { value: 'startsWith', label: 'Starts with' },
              { value: 'equals', label: 'Equals' },
              { value: 'regex', label: 'Regex' },
            ]}
          />
        </div>
        <Input label="Match value" value={matchValue} onChange={e => setMatchValue(e.target.value)} placeholder="e.g. TESCO" />
        <Select
          label="Category"
          value={String(categoryId)}
          onChange={e => setCategoryId(Number(e.target.value))}
          options={categories.map(c => ({ value: c.id, label: c.name }))}
        />
      </div>
    </Modal>
  );
}
