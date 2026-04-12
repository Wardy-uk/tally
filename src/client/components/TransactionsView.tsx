import { useState, useMemo } from 'react';
import { Search, Filter, X, Sparkles } from 'lucide-react';
import { Card } from './ui/Card';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { Select } from './ui/Select';
import { Money } from './ui/Money';
import { EmptyState } from './ui/EmptyState';
import { useAccounts } from '../hooks/useAccounts';
import { useTransactions, TransactionRow } from '../hooks/useTransactions';
import { useCategories } from '../hooks/useCategories';
import { ArrowLeftRight } from 'lucide-react';
import { api } from '../lib/api';

export function TransactionsView() {
  const { accounts } = useAccounts();
  const { categories } = useCategories();

  const [search, setSearch] = useState('');
  const [accountId, setAccountId] = useState<string>('');
  const [categoryId, setCategoryId] = useState<string>('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [type, setType] = useState<string>('');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiFeedback, setAiFeedback] = useState<string | null>(null);

  function showFeedback(msg: string) {
    setAiFeedback(msg);
    setTimeout(() => setAiFeedback(null), 5000);
  }

  const filter = useMemo(() => ({
    search: search || undefined,
    accountId: accountId ? Number(accountId) : undefined,
    categoryId: categoryId === 'none' ? 'none' as const : categoryId ? Number(categoryId) : undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    type: (type as 'income' | 'expense' | '') || undefined,
    limit: 200,
  }), [search, accountId, categoryId, dateFrom, dateTo, type]);

  const { rows, total, loading, refresh } = useTransactions(filter);

  const clearFilters = () => {
    setSearch(''); setAccountId(''); setCategoryId(''); setDateFrom(''); setDateTo(''); setType('');
  };
  const hasFilters = search || accountId || categoryId || dateFrom || dateTo || type;

  async function runAiCategorise() {
    setAiBusy(true);
    setAiFeedback(null);
    try {
      const res = await api<{ categorised: number; skipped: number; errors: string[] }>(
        '/ai/categorise', { method: 'POST', body: JSON.stringify({ limit: 100 }) },
      );
      if (res.errors.length > 0) {
        setAiFeedback(`Error: ${res.errors[0]}`);
      } else {
        setAiFeedback(`Categorised ${res.categorised} transaction${res.categorised !== 1 ? 's' : ''}`);
      }
      await refresh();
    } catch (e: any) {
      setAiFeedback(`Error: ${e.error ?? 'AI categorisation failed'}`);
    } finally {
      setAiBusy(false);
      setTimeout(() => setAiFeedback(null), 5000);
    }
  }

  async function runTransferDetect() {
    try {
      const res = await api<{ pairs: number }>('/ai/detect-transfers', { method: 'POST' });
      setAiFeedback(`Detected ${res.pairs} transfer pair${res.pairs !== 1 ? 's' : ''}`);
      await refresh();
      setTimeout(() => setAiFeedback(null), 5000);
    } catch {}
  }

  return (
    <div className="flex flex-col gap-6 fade-up">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">Transactions</h1>
          <p className="text-sm text-[var(--color-text-3)] mt-1">
            {total} transaction{total !== 1 && 's'} across all accounts
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" icon={<ArrowLeftRight className="w-4 h-4" />} onClick={runTransferDetect}>
            Detect transfers
          </Button>
          <Button variant="primary" icon={<Sparkles className="w-4 h-4" />} onClick={runAiCategorise} disabled={aiBusy}>
            {aiBusy ? 'Thinking…' : 'AI categorise'}
          </Button>
        </div>
      </div>

      {aiFeedback && (
        <div className={`rounded-[12px] px-4 py-3 text-sm border ${
          aiFeedback.startsWith('Error')
            ? 'bg-[var(--color-coral-soft)] border-[rgba(251,113,133,0.25)] text-[var(--color-coral)]'
            : 'bg-[var(--color-mint-soft)] border-[rgba(74,222,128,0.25)] text-[var(--color-mint)]'
        }`}>
          {aiFeedback}
        </div>
      )}

      <Card padding="md">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[220px]">
            <Input
              label="Search"
              placeholder="Description or merchant…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              icon={<Search className="w-4 h-4" />}
            />
          </div>
          <div className="min-w-[160px]">
            <Select
              label="Account"
              value={accountId}
              onChange={e => setAccountId(e.target.value)}
              options={[
                { value: '', label: 'All accounts' },
                ...accounts.map(a => ({ value: a.id, label: a.name })),
              ]}
            />
          </div>
          <div className="min-w-[160px]">
            <Select
              label="Category"
              value={categoryId}
              onChange={e => setCategoryId(e.target.value)}
              options={[
                { value: '', label: 'All categories' },
                { value: 'none', label: 'Uncategorised' },
                ...categories.map(c => ({ value: c.id, label: c.name })),
              ]}
            />
          </div>
          <div className="min-w-[140px]">
            <Select
              label="Type"
              value={type}
              onChange={e => setType(e.target.value)}
              options={[
                { value: '', label: 'All types' },
                { value: 'income', label: 'Income only' },
                { value: 'expense', label: 'Expense only' },
              ]}
            />
          </div>
          <Input
            label="From"
            type="date"
            value={dateFrom}
            onChange={e => setDateFrom(e.target.value)}
            className="w-[150px]"
          />
          <Input
            label="To"
            type="date"
            value={dateTo}
            onChange={e => setDateTo(e.target.value)}
            className="w-[150px]"
          />
          {hasFilters && (
            <button
              onClick={clearFilters}
              className="h-11 px-3 text-sm text-[var(--color-text-3)] hover:text-[var(--color-coral)] flex items-center gap-1.5"
            >
              <X className="w-4 h-4" /> Clear
            </button>
          )}
        </div>
      </Card>

      <Card padding="none">
        {loading ? (
          <div className="text-sm text-[var(--color-text-3)] py-12 text-center">Loading…</div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<Filter className="w-7 h-7" />}
            title="No transactions"
            description={hasFilters ? 'Try adjusting your filters' : 'Import a CSV to get started'}
          />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-[var(--color-text-4)] font-semibold border-b border-[var(--color-border)]">
                <th className="text-left px-5 py-3">Date</th>
                <th className="text-left px-5 py-3">Description</th>
                <th className="text-left px-5 py-3">Category</th>
                <th className="text-left px-5 py-3">Account</th>
                <th className="text-right px-5 py-3">Amount</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <TxRow key={r.id} r={r} categories={categories} onRefresh={refresh} onFeedback={showFeedback} />
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

function TxRow({
  r, categories, onRefresh, onFeedback,
}: {
  r: TransactionRow;
  categories: Array<{ id: number; name: string; color: string | null }>;
  onRefresh: () => void;
  onFeedback: (msg: string) => void;
}) {
  const [busy, setBusy] = useState(false);

  async function changeCategory(newCategoryId: number | null) {
    setBusy(true);
    try {
      const result = await api<{ appliedToSimilar: number; ruleCreated: boolean; ruleUpdated: boolean }>(
        `/transactions/${r.id}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ categoryId: newCategoryId }),
        },
      );
      if (result.ruleCreated && result.appliedToSimilar > 0) {
        onFeedback(`Rule saved — also categorised ${result.appliedToSimilar} similar transaction${result.appliedToSimilar > 1 ? 's' : ''}`);
      } else if (result.ruleCreated) {
        onFeedback(`Rule saved — future matches will auto-categorise`);
      } else if (result.ruleUpdated && result.appliedToSimilar > 0) {
        onFeedback(`Rule updated — re-categorised ${result.appliedToSimilar} similar transaction${result.appliedToSimilar > 1 ? 's' : ''}`);
      } else if (result.ruleUpdated) {
        onFeedback(`Existing rule updated for this merchant`);
      }
      await onRefresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <tr className={`border-b border-[var(--color-border)] hover:bg-[var(--color-bg-elevated)] transition ${busy ? 'opacity-50' : ''}`}>
      <td className="px-5 py-3.5 tabular text-[var(--color-text-3)] whitespace-nowrap">{r.date}</td>
      <td className="px-5 py-3.5 max-w-md">
        <div className="flex items-center gap-2 min-w-0">
          {r.is_transfer === 1 && <ArrowLeftRight className="w-3 h-3 text-[var(--color-text-4)] shrink-0" />}
          <span className="truncate">{r.description}</span>
        </div>
      </td>
      <td className="px-5 py-3.5">
        <select
          value={r.category_id ?? ''}
          onChange={e => changeCategory(e.target.value ? Number(e.target.value) : null)}
          className="bg-transparent border border-[var(--color-border)] text-xs rounded-lg px-2.5 py-1.5 cursor-pointer hover:border-[var(--color-border-strong)] focus:outline-none focus:border-[var(--color-mint)] max-w-[160px]"
          style={{ color: r.category_color ?? 'var(--color-text-3)' }}
        >
          <option value="">— none —</option>
          {categories.map(c => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </td>
      <td className="px-5 py-3.5 text-[var(--color-text-3)] text-xs">{r.account_name}</td>
      <td className="px-5 py-3.5 text-right">
        <Money pence={r.amount} signed color={r.amount >= 0 ? 'positive' : 'negative'} />
      </td>
    </tr>
  );
}
