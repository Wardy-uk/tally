import { useCallback, useEffect, useState } from 'react';
import { Repeat, RefreshCw, EyeOff, Eye, Calendar } from 'lucide-react';
import { Card, CardHeader, CardTitle } from './ui/Card';
import { Button } from './ui/Button';
import { Money } from './ui/Money';
import { EmptyState } from './ui/EmptyState';
import { api } from '../lib/api';

interface Recurring {
  id: number;
  merchant: string;
  typical_amount: number;
  cadence: 'weekly' | 'monthly' | 'yearly';
  last_seen: string;
  next_expected: string | null;
  ignored: number;
}

const CADENCE_LABEL = { weekly: 'Weekly', monthly: 'Monthly', yearly: 'Yearly' };

export function SubscriptionsView() {
  const [rows, setRows] = useState<Recurring[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await api<Recurring[]>('/subscriptions'));
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function refresh() {
    setRefreshing(true);
    try {
      await api('/subscriptions/refresh', { method: 'POST' });
      await load();
    } finally { setRefreshing(false); }
  }

  async function toggleIgnore(r: Recurring) {
    await api(`/subscriptions/${r.id}`, { method: 'PATCH', body: JSON.stringify({ ignored: !r.ignored }) });
    await load();
  }

  const active = rows.filter(r => !r.ignored);
  const ignored = rows.filter(r => r.ignored);

  // Monthly total (weekly * 4.33, yearly / 12)
  const monthlyTotal = active.reduce((sum, r) => {
    if (r.cadence === 'weekly') return sum + r.typical_amount * 4.33;
    if (r.cadence === 'yearly') return sum + r.typical_amount / 12;
    return sum + r.typical_amount;
  }, 0);

  return (
    <div className="flex flex-col gap-6 fade-up">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">Subscriptions</h1>
          <p className="text-sm text-[var(--color-text-3)] mt-1">
            Recurring charges we've spotted across your transactions
          </p>
        </div>
        <Button variant="secondary" icon={<RefreshCw className="w-4 h-4" />} onClick={refresh} disabled={refreshing}>
          {refreshing ? 'Scanning…' : 'Rescan'}
        </Button>
      </div>

      {active.length > 0 && (
        <Card glow padding="lg">
          <div className="text-xs uppercase tracking-wider text-[var(--color-text-3)] font-semibold mb-2">
            Monthly subscription cost
          </div>
          <Money pence={monthlyTotal} size="3xl" color="negative" />
          <div className="text-sm text-[var(--color-text-3)] mt-2">
            {active.length} active recurring charge{active.length !== 1 && 's'}
          </div>
        </Card>
      )}

      {loading ? (
        <div className="text-sm text-[var(--color-text-3)]">Loading…</div>
      ) : rows.length === 0 ? (
        <Card padding="lg">
          <EmptyState
            icon={<Repeat className="w-7 h-7" />}
            title="No recurring charges detected"
            description="Tally looks for transactions from the same merchant with similar amounts at weekly, monthly or yearly intervals. Import more statements and click Rescan."
            action={<Button variant="primary" icon={<RefreshCw className="w-4 h-4" />} onClick={refresh}>Rescan now</Button>}
          />
        </Card>
      ) : (
        <>
          <Card padding="none">
            <div className="p-5 border-b border-[var(--color-border)]">
              <CardTitle subtitle="Click the eye to ignore a false match">Active</CardTitle>
            </div>
            {active.length === 0 ? (
              <div className="text-sm text-[var(--color-text-3)] py-8 text-center">All detected items are ignored</div>
            ) : (
              <div className="divide-y divide-[var(--color-border)]">
                {active.map(r => <Row key={r.id} r={r} onToggle={toggleIgnore} />)}
              </div>
            )}
          </Card>

          {ignored.length > 0 && (
            <Card padding="none">
              <div className="p-5 border-b border-[var(--color-border)]">
                <CardTitle subtitle="Hidden from totals">Ignored</CardTitle>
              </div>
              <div className="divide-y divide-[var(--color-border)]">
                {ignored.map(r => <Row key={r.id} r={r} onToggle={toggleIgnore} />)}
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function Row({ r, onToggle }: { r: Recurring; onToggle: (r: Recurring) => void }) {
  return (
    <div className={`flex items-center justify-between px-5 py-4 hover:bg-[var(--color-bg-elevated)] ${r.ignored ? 'opacity-50' : ''}`}>
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <div className="w-10 h-10 rounded-xl bg-[var(--color-violet-soft)] text-[var(--color-violet)] flex items-center justify-center shrink-0">
          <Repeat className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold truncate">{r.merchant}</div>
          <div className="text-xs text-[var(--color-text-3)] flex items-center gap-2 mt-0.5">
            <span>{CADENCE_LABEL[r.cadence]}</span>
            <span>·</span>
            <Calendar className="w-3 h-3" />
            <span>Last: {r.last_seen}</span>
            {r.next_expected && <><span>·</span><span>Next: {r.next_expected}</span></>}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-4">
        <Money pence={r.typical_amount} size="md" color="negative" />
        <button
          onClick={() => onToggle(r)}
          className="w-9 h-9 rounded-lg hover:bg-[var(--color-bg-elevated)] text-[var(--color-text-3)] hover:text-[var(--color-text)] flex items-center justify-center"
          title={r.ignored ? 'Unignore' : 'Ignore'}
        >
          {r.ignored ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}
