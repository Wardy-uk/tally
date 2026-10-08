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
  const [showFilters, setShowFilters] = useState(false);

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
      <div className="flex flex-wrap items-start justify-between gap-3">
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
          <div className="flex-1 min-w-0 md:min-w-[220px]">
            <Input
              label="Search"
              placeholder="Description or merchant…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              icon={<Search className="w-4 h-4" />}
            />
          </div>
          <button
            onClick={() => setShowFilters(s => !s)}
            className={`md:hidden h-11 px-3.5 rounded-[12px] border text-sm font-medium flex items-center gap-1.5 ${
              showFilters || hasFilters
                ? 'border-[rgba(74,222,128,0.3)] text-[var(--color-mint)] bg-[var(--color-mint-soft)]'
                : 'border-[var(--color-border)] text-[var(--color-text-2)]'
            }`}
          >
            <Filter className="w-4 h-4" /> Filters
          </button>
          {/* On phones the filters fold away behind the toggle; md:contents keeps desktop layout as-is. */}
          <div className={`${showFilters ? 'grid' : 'hidden'} grid-cols-2 gap-3 w-full md:contents`}>
          <div className="min-w-0 md:min-w-[160px]">
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
          <div className="min-w-0 md:min-w-[160px]">
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
          <div className="min-w-0 md:min-w-[140px]">
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
          <div className="min-w-0">
          <Input
            label="From"
            type="date"
            value={dateFrom}
            onChange={e => setDateFrom(e.target.value)}
            className="w-full md:w-[150px]"
          />
          </div>
          <div className="min-w-0">
          <Input
            label="To"
            type="date"
            value={dateTo}
            onChange={e => setDateTo(e.target.value)}
            className="w-full md:w-[150px]"
          />
          </div>
          </div>
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
          <>
          <ul className="md:hidden">
            {rows.map(r => (
              <TxCard key={r.id} r={r} categories={categories} onRefresh={refresh} onFeedback={showFeedback} />
            ))}
          </ul>
          <table className="hidden md:table w-full text-sm">
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
          </>
        )}
      </Card>
    </div>
  );
}

type CategoryList = Array<{ id: number; name: string; color: string | null }>;

/** Category change + rule feedback, shared by the desktop row and the mobile card. */
function useCategoryChange(r: TransactionRow, onRefresh: () => void, onFeedback: (msg: string) => void) {
  const [busy, setBusy] = useState(false);

  async function changeCategory(newCategoryId: number | null) {
    setBusy(true);
    try {
      type Result = {
        appliedToSimilar: number; ruleCreated: boolean; ruleUpdated: boolean;
        needsConfirmation: { reason: string; message: string } | null; ruleSkipped: string | null;
      };
      const patch = (confirmRule: boolean) => api<Result>(`/transactions/${r.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ categoryId: newCategoryId, confirmRule }),
      });
      let result = await patch(false);
      // Merchant identity was ambiguous: the category is saved for this transaction only,
      // and a merchant-wide rule needs an explicit yes.
      if (result.needsConfirmation) {
        if (confirm(result.needsConfirmation.message)) {
          result = await patch(true);
        } else {
          onFeedback('Categorised this transaction only — no rule created');
        }
      } else if (result.ruleSkipped) {
        onFeedback(result.ruleSkipped);
      }
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

  return { busy, changeCategory };
}

function TxRow({
  r, categories, onRefresh, onFeedback,
}: {
  r: TransactionRow;
  categories: Array<{ id: number; name: string; color: string | null }>;
  onRefresh: () => void;
  onFeedback: (msg: string) => void;
}) {
  const { busy, changeCategory } = useCategoryChange(r, onRefresh, onFeedback);
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

function TxCard({
  r, categories, onRefresh, onFeedback,
}: {
  r: TransactionRow;
  categories: CategoryList;
  onRefresh: () => void;
  onFeedback: (msg: string) => void;
}) {
  const { busy, changeCategory } = useCategoryChange(r, onRefresh, onFeedback);
  return (
    <li className={`px-4 py-3.5 border-b border-[var(--color-border)] last:border-b-0 ${busy ? 'opacity-50' : ''}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-sm font-medium min-w-0">
            {r.is_transfer === 1 && <ArrowLeftRight className="w-3 h-3 text-[var(--color-text-4)] shrink-0" />}
            <span className="truncate">{r.description}</span>
          </div>
          <div className="text-xs text-[var(--color-text-4)] mt-0.5 tabular">{r.date} · {r.account_name}</div>
        </div>
        <div className="shrink-0 text-sm">
          <Money pence={r.amount} signed color={r.amount >= 0 ? 'positive' : 'negative'} />
        </div>
      </div>
      <select
        value={r.category_id ?? ''}
        onChange={e => changeCategory(e.target.value ? Number(e.target.value) : null)}
        className="mt-2.5 w-full bg-[var(--color-bg-elevated)] border border-[var(--color-border)] rounded-lg px-3 py-2 focus:outline-none focus:border-[var(--color-mint)]"
        style={{ color: r.category_color ?? 'var(--color-text-3)' }}
      >
        <option value="">— none —</option>
        {categories.map(c => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
      </select>
    </li>
  );
}
