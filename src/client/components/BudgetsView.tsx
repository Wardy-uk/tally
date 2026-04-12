import { useCallback, useEffect, useState } from 'react';
import { PieChart, Sparkles, Plus, Trash2, Check, X } from 'lucide-react';
import { Card, CardHeader, CardTitle } from './ui/Card';
import { Button } from './ui/Button';
import { Modal } from './ui/Modal';
import { Input } from './ui/Input';
import { Select } from './ui/Select';
import { Money, formatMoney } from './ui/Money';
import { EmptyState } from './ui/EmptyState';
import { useCategories } from '../hooks/useCategories';
import { api } from '../lib/api';

interface BudgetStatus {
  id: number;
  categoryId: number;
  categoryName: string;
  categoryColor: string | null;
  categoryIcon: string | null;
  monthlyAmount: number;
  spent: number;
  remaining: number;
  percent: number;
  source: 'ai' | 'manual';
}

interface Suggestion {
  categoryId: number;
  categoryName: string;
  suggestedMonthly: number;
  average: number;
  rationale: string;
}

export function BudgetsView() {
  const { categories } = useCategories();
  const [budgets, setBudgets] = useState<BudgetStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api<BudgetStatus[]>('/budgets/status');
      setBudgets(data);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function suggest() {
    setSuggesting(true);
    setError(null);
    try {
      const data = await api<Suggestion[]>('/budgets/suggest', { method: 'POST', body: JSON.stringify({ months: 3 }) });
      setSuggestions(data);
    } catch (e: any) {
      setError(e.error ?? 'AI suggestion failed');
    } finally { setSuggesting(false); }
  }

  async function applySuggestions(items: Suggestion[]) {
    await api('/budgets/bulk', {
      method: 'POST',
      body: JSON.stringify({
        items: items.map(s => ({ categoryId: s.categoryId, monthlyAmount: s.suggestedMonthly })),
        source: 'ai',
      }),
    });
    setSuggestions([]);
    await load();
  }

  async function del(id: number) {
    if (!confirm('Delete this budget?')) return;
    await api(`/budgets/${id}`, { method: 'DELETE' });
    await load();
  }

  const totalBudget = budgets.reduce((s, b) => s + b.monthlyAmount, 0);
  const totalSpent = budgets.reduce((s, b) => s + b.spent, 0);
  const overallPct = totalBudget > 0 ? Math.round((totalSpent / totalBudget) * 100) : 0;

  return (
    <div className="flex flex-col gap-6 fade-up">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">Budgets</h1>
          <p className="text-sm text-[var(--color-text-3)] mt-1">
            {new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" icon={<Sparkles className="w-4 h-4" />} onClick={suggest} disabled={suggesting}>
            {suggesting ? 'Thinking…' : 'AI suggest'}
          </Button>
          <Button variant="primary" icon={<Plus className="w-4 h-4" />} onClick={() => setAdding(true)}>
            New budget
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-[12px] px-4 py-3 text-sm border bg-[var(--color-coral-soft)] border-[rgba(251,113,133,0.25)] text-[var(--color-coral)]">
          {error}
        </div>
      )}

      {suggestions.length > 0 && (
        <Card padding="lg" glow>
          <CardHeader>
            <CardTitle subtitle="Based on your last 3 months of spending">AI suggested budgets</CardTitle>
          </CardHeader>
          <div className="flex flex-col gap-3">
            {suggestions.map(s => (
              <div key={s.categoryId} className="flex items-center justify-between bg-[var(--color-bg-elevated)] border border-[var(--color-border)] rounded-[14px] px-4 py-3">
                <div className="flex-1 min-w-0 mr-4">
                  <div className="text-sm font-semibold">{s.categoryName}</div>
                  <div className="text-xs text-[var(--color-text-3)] mt-0.5">
                    Avg {formatMoney(s.average)}/mo · {s.rationale}
                  </div>
                </div>
                <Money pence={s.suggestedMonthly} size="lg" color="neutral" />
              </div>
            ))}
          </div>
          <div className="flex gap-2 mt-4">
            <Button variant="primary" icon={<Check className="w-4 h-4" />} onClick={() => applySuggestions(suggestions)}>
              Apply all
            </Button>
            <Button variant="ghost" icon={<X className="w-4 h-4" />} onClick={() => setSuggestions([])}>
              Dismiss
            </Button>
          </div>
        </Card>
      )}

      {budgets.length > 0 && (
        <Card glow padding="lg">
          <div className="flex items-end justify-between mb-3">
            <div>
              <div className="text-xs uppercase tracking-wider text-[var(--color-text-3)] font-semibold">Overall</div>
              <div className="flex items-baseline gap-2 mt-1">
                <Money pence={totalSpent} size="2xl" color={overallPct > 100 ? 'negative' : 'neutral'} />
                <span className="text-sm text-[var(--color-text-3)]">of {formatMoney(totalBudget)}</span>
              </div>
            </div>
            <div className={`text-sm font-bold tabular ${overallPct > 100 ? 'text-[var(--color-coral)]' : 'text-[var(--color-mint)]'}`}>
              {overallPct}%
            </div>
          </div>
          <div className="h-2 rounded-full bg-[var(--color-bg-elevated)] overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${Math.min(overallPct, 100)}%`,
                background: overallPct > 100
                  ? 'var(--color-coral)'
                  : overallPct > 80
                  ? 'var(--color-amber)'
                  : 'linear-gradient(90deg, var(--color-mint), var(--color-sky))',
              }}
            />
          </div>
        </Card>
      )}

      {loading ? (
        <div className="text-sm text-[var(--color-text-3)]">Loading…</div>
      ) : budgets.length === 0 ? (
        <Card padding="lg">
          <EmptyState
            icon={<PieChart className="w-7 h-7" />}
            title="No budgets yet"
            description="Create budgets per category to track spending. Or let Tally suggest budgets from your history."
            action={
              <div className="flex gap-2">
                <Button variant="secondary" icon={<Sparkles className="w-4 h-4" />} onClick={suggest} disabled={suggesting}>
                  AI suggest
                </Button>
                <Button variant="primary" icon={<Plus className="w-4 h-4" />} onClick={() => setAdding(true)}>
                  New budget
                </Button>
              </div>
            }
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {budgets.map(b => <BudgetCard key={b.id} b={b} onDelete={del} />)}
        </div>
      )}

      <AddBudgetModal open={adding} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); load(); }} categories={categories} />
    </div>
  );
}

function BudgetCard({ b, onDelete }: { b: BudgetStatus; onDelete: (id: number) => void }) {
  const over = b.percent > 100;
  const warning = b.percent > 80 && !over;

  return (
    <Card className="group">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{
              background: b.categoryColor ? `${b.categoryColor}22` : 'var(--color-bg-elevated)',
              color: b.categoryColor ?? 'var(--color-text-3)',
            }}
          >
            <PieChart className="w-5 h-5" />
          </div>
          <div>
            <div className="text-sm font-semibold">{b.categoryName}</div>
            <div className="text-[10px] text-[var(--color-text-4)] uppercase tracking-wider">
              {b.source === 'ai' ? 'AI suggested' : 'Manual'}
            </div>
          </div>
        </div>
        <button
          onClick={() => onDelete(b.id)}
          className="w-8 h-8 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-[var(--color-coral-soft)] text-[var(--color-text-3)] hover:text-[var(--color-coral)] flex items-center justify-center transition"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="flex items-baseline gap-2 mb-2">
        <Money pence={b.spent} size="xl" color={over ? 'negative' : 'neutral'} />
        <span className="text-sm text-[var(--color-text-3)]">of {formatMoney(b.monthlyAmount)}</span>
      </div>

      <div className="h-2 rounded-full bg-[var(--color-bg-elevated)] overflow-hidden mt-2">
        <div
          className="h-full rounded-full transition-all"
          style={{
            width: `${Math.min(b.percent, 100)}%`,
            background: over
              ? 'var(--color-coral)'
              : warning
              ? 'var(--color-amber)'
              : (b.categoryColor ?? 'var(--color-mint)'),
          }}
        />
      </div>

      <div className="flex items-center justify-between mt-2 text-xs">
        <span className={over ? 'text-[var(--color-coral)]' : warning ? 'text-[var(--color-amber)]' : 'text-[var(--color-text-3)]'}>
          {b.percent}% spent
        </span>
        <span className={over ? 'text-[var(--color-coral)]' : 'text-[var(--color-text-3)]'}>
          {over ? `${formatMoney(-b.remaining)} over` : `${formatMoney(b.remaining)} left`}
        </span>
      </div>
    </Card>
  );
}

function AddBudgetModal({
  open, onClose, onSaved, categories,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  categories: Array<{ id: number; name: string; kind: string }>;
}) {
  const expenseCategories = categories.filter(c => c.kind === 'expense');
  const [categoryId, setCategoryId] = useState<number>(expenseCategories[0]?.id ?? 0);
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      await api('/budgets', {
        method: 'POST',
        body: JSON.stringify({
          categoryId,
          monthlyAmount: Math.round(parseFloat(amount || '0') * 100),
          source: 'manual',
        }),
      });
      setAmount('');
      onSaved();
    } finally { setBusy(false); }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New budget"
      subtitle="Set a monthly limit for a category"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={!amount || !categoryId || busy}>
            {busy ? 'Saving…' : 'Create'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Select
          label="Category"
          value={String(categoryId)}
          onChange={e => setCategoryId(Number(e.target.value))}
          options={expenseCategories.map(c => ({ value: c.id, label: c.name }))}
        />
        <Input
          label="Monthly limit (£)"
          type="number"
          step="0.01"
          value={amount}
          onChange={e => setAmount(e.target.value)}
          placeholder="e.g. 300"
          autoFocus
        />
      </div>
    </Modal>
  );
}
