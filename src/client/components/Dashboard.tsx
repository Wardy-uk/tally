import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, PieChart, Pie, Cell,
} from 'recharts';
import {
  TrendingUp, TrendingDown, Wallet, ArrowUp, ArrowDown, Briefcase, ArrowLeftRight,
} from 'lucide-react';
import { Card, CardHeader, CardTitle } from './ui/Card';
import { Money, formatMoney } from './ui/Money';
import { EmptyState } from './ui/EmptyState';
import { useDashboard } from '../hooks/useDashboard';
import { monthlyTakeHomeFromGross } from '../lib/uk-tax';

function monthLabel(month: string): string {
  const d = new Date(`${month}-01`);
  return d.toLocaleDateString('en-GB', { month: 'short' });
}

export function Dashboard() {
  const { data, loading } = useDashboard();

  if (loading || !data) {
    return (
      <div className="flex flex-col gap-6 fade-up">
        <h1 className="text-3xl font-extrabold tracking-tight">Dashboard</h1>
        <div className="text-sm text-[var(--color-text-3)]">Loading…</div>
      </div>
    );
  }

  const hasData = data.accounts.length > 0;
  if (!hasData) {
    return (
      <div className="flex flex-col gap-6 fade-up">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">Dashboard</h1>
          <p className="text-sm text-[var(--color-text-3)] mt-1">Your financial overview</p>
        </div>
        <Card padding="lg">
          <EmptyState
            icon={<Wallet className="w-7 h-7" />}
            title="Welcome to Tally"
            description="Add an account and import your first statement to see your dashboard come to life."
          />
        </Card>
      </div>
    );
  }

  const expensePct = data.prevExpense !== 0
    ? Math.round((data.expenseDelta / Math.abs(data.prevExpense)) * 100)
    : 0;

  return (
    <div className="flex flex-col gap-6 fade-up">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight">Dashboard</h1>
        <p className="text-sm text-[var(--color-text-3)] mt-1">
          {new Date(`${data.month}-01`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}
        </p>
      </div>

      {/* Net worth hero */}
      <Card glow padding="lg" className="relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-gradient-to-br from-[var(--color-mint-soft)] to-transparent rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-64 h-64 bg-gradient-to-tr from-[var(--color-violet-soft)] to-transparent rounded-full blur-3xl pointer-events-none" />
        <div className="relative flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 text-[var(--color-text-3)] text-xs uppercase tracking-wider font-semibold mb-2">
              <Wallet className="w-3.5 h-3.5" /> Net worth
            </div>
            <Money pence={data.netWorth} size="3xl" color="neutral" />
            <div className="text-sm text-[var(--color-text-3)] mt-2">
              Across {data.accounts.length} account{data.accounts.length !== 1 && 's'}
            </div>
          </div>
          <div className="hidden md:block text-right">
            <div className="text-xs uppercase tracking-wider text-[var(--color-text-3)] font-semibold mb-2">This month</div>
            <Money pence={data.net} size="2xl" signed color={data.net >= 0 ? 'positive' : 'negative'} />
          </div>
        </div>
      </Card>

      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Kpi
          icon={<TrendingUp className="w-4 h-4" />}
          label="Income this month"
          value={data.income}
          color="positive"
        />
        <Kpi
          icon={<TrendingDown className="w-4 h-4" />}
          label="Spent this month"
          value={Math.abs(data.expense)}
          color="negative"
          delta={expensePct}
        />
        <Kpi
          icon={<Wallet className="w-4 h-4" />}
          label="Saved this month"
          value={Math.max(0, data.net)}
          color="neutral"
        />
      </div>

      {/* Salary widgets */}
      {data.salaryWidgets.some(s => s.hasProfile) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {data.salaryWidgets.filter(s => s.hasProfile).map(s => (
            <SalaryCard key={s.userId} widget={s} />
          ))}
        </div>
      )}

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle subtitle="Income vs spend over the last 6 months">Trend</CardTitle>
          </CardHeader>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.trend.map(t => ({
                ...t,
                monthLabel: monthLabel(t.month),
                income: t.income / 100,
                expense: t.expense / 100,
              }))}>
                <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="monthLabel" stroke="var(--color-text-4)" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis stroke="var(--color-text-4)" fontSize={11} tickLine={false} axisLine={false} tickFormatter={v => `£${v}`} />
                <Tooltip
                  contentStyle={{
                    background: 'var(--color-surface)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 12,
                    fontSize: 13,
                  }}
                  formatter={(v: number) => `£${v.toFixed(2)}`}
                />
                <Bar dataKey="income" fill="var(--color-mint)" radius={[6, 6, 0, 0]} />
                <Bar dataKey="expense" fill="var(--color-coral)" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle subtitle="This month's spending">By category</CardTitle>
          </CardHeader>
          {data.byCategory.length > 0 ? (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={data.byCategory.map(c => ({
                      name: c.name ?? 'Uncategorised',
                      value: Math.abs(c.total) / 100,
                      color: c.color ?? '#64748b',
                    }))}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={50}
                    outerRadius={90}
                    paddingAngle={2}
                  >
                    {data.byCategory.map((c, i) => (
                      <Cell key={i} fill={c.color ?? '#64748b'} stroke="var(--color-surface)" strokeWidth={2} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      background: 'var(--color-surface)',
                      border: '1px solid var(--color-border)',
                      borderRadius: 12,
                      fontSize: 13,
                    }}
                    formatter={(v: number) => `£${v.toFixed(2)}`}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="text-sm text-[var(--color-text-3)] py-16 text-center">No spending yet</div>
          )}
        </Card>
      </div>

      {/* Top merchants + Recent */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle subtitle="Where the money went this month">Top merchants</CardTitle>
          </CardHeader>
          {data.topMerchants.length > 0 ? (
            <div className="flex flex-col gap-2">
              {data.topMerchants.map((m, i) => {
                const maxAbs = Math.abs(data.topMerchants[0].total);
                const pct = maxAbs ? Math.abs(m.total) / maxAbs : 0;
                return (
                  <div key={i} className="relative">
                    <div
                      className="absolute inset-0 rounded-[10px] bg-[var(--color-coral-soft)]"
                      style={{ width: `${pct * 100}%`, opacity: 0.4 }}
                    />
                    <div className="relative flex items-center justify-between px-3 py-2.5">
                      <div className="flex-1 min-w-0 mr-4">
                        <div className="text-sm font-medium truncate">{m.description}</div>
                        <div className="text-xs text-[var(--color-text-4)]">{m.count} transaction{m.count !== 1 && 's'}</div>
                      </div>
                      <Money pence={m.total} size="md" color="negative" />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-sm text-[var(--color-text-3)] py-12 text-center">No spending yet</div>
          )}
        </Card>

        <Card>
          <CardHeader>
            <CardTitle subtitle="Latest activity across all accounts">Recent transactions</CardTitle>
          </CardHeader>
          {data.recent.length > 0 ? (
            <div className="flex flex-col gap-1">
              {data.recent.map(r => (
                <div key={r.id} className="flex items-center gap-3 px-3 py-2.5 hover:bg-[var(--color-bg-elevated)] rounded-[10px]">
                  <div
                    className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                    style={{
                      background: r.category_color ? `${r.category_color}22` : 'var(--color-bg-elevated)',
                      color: r.category_color ?? 'var(--color-text-3)',
                    }}
                  >
                    {r.amount >= 0 ? <ArrowDown className="w-3.5 h-3.5" /> : <ArrowUp className="w-3.5 h-3.5" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{r.description}</div>
                    <div className="text-xs text-[var(--color-text-4)]">
                      {r.category_name ?? 'Uncategorised'} · {r.account_name} · {r.date}
                    </div>
                  </div>
                  <Money pence={r.amount} signed color={r.amount >= 0 ? 'positive' : 'negative'} />
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-[var(--color-text-3)] py-12 text-center">No transactions yet</div>
          )}
        </Card>
      </div>
    </div>
  );
}

function Kpi({
  icon, label, value, color, delta,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  color: 'positive' | 'negative' | 'neutral';
  delta?: number;
}) {
  return (
    <Card>
      <div className="flex items-center gap-2 text-[var(--color-text-3)] text-xs uppercase tracking-wider font-semibold mb-2">
        {icon} {label}
      </div>
      <Money pence={value} size="xl" color={color} />
      {delta !== undefined && delta !== 0 && (
        <div className={`text-xs mt-1 flex items-center gap-1 ${
          delta > 0 ? 'text-[var(--color-coral)]' : 'text-[var(--color-mint)]'
        }`}>
          {delta > 0 ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
          {Math.abs(delta)}% vs last month
        </div>
      )}
    </Card>
  );
}

function SalaryCard({
  widget,
}: {
  widget: {
    userId: number; displayName: string; baseMonthly: number; actualMonth: number;
    variance: number; payDay?: number; payDayType?: 'day' | 'last-working' | 'working-before';
  };
}) {
  // baseMonthly from the API is GROSS (pre-tax). Compare actual (what lands
  // in the bank) against estimated TAKE-HOME for a meaningful variance.
  const expectedTakeHome = widget.baseMonthly > 0 ? monthlyTakeHomeFromGross(widget.baseMonthly) : 0;
  const progress = expectedTakeHome > 0 ? Math.min(widget.actualMonth / expectedTakeHome, 1.5) : 0;
  const barWidth = Math.min(progress * 100, 100);
  const overshoot = progress > 1;
  const variance = widget.actualMonth - expectedTakeHome;

  const ordinal = (n: number) => {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  };

  const payDayLabel = (() => {
    if (widget.payDayType === 'last-working') return 'Last working day of each month';
    if (widget.payDayType === 'working-before') return `On or before the ${ordinal(widget.payDay ?? 28)} (working days)`;
    return `The ${ordinal(widget.payDay ?? 28)} of each month`;
  })();

  return (
    <Card>
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[var(--color-violet-soft)] text-[var(--color-violet)] flex items-center justify-center">
            <Briefcase className="w-5 h-5" />
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-[var(--color-text-4)] font-semibold">
              {widget.displayName}'s salary
            </div>
            <div className="text-xs text-[var(--color-text-3)]">{payDayLabel}</div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-3">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-[var(--color-text-4)] font-semibold">Gross</div>
          <Money pence={widget.baseMonthly} size="md" color="muted" />
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-[var(--color-text-4)] font-semibold">Expected</div>
          <Money pence={expectedTakeHome} size="md" color="muted" />
          <div className="text-[9px] text-[var(--color-text-4)]">after tax & NI</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-[var(--color-text-4)] font-semibold">Actual</div>
          <Money pence={widget.actualMonth} size="md" color="neutral" />
        </div>
      </div>

      <div className="h-2 rounded-full bg-[var(--color-bg-elevated)] overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{
            width: `${barWidth}%`,
            background: overshoot
              ? 'linear-gradient(90deg, var(--color-mint), var(--color-violet))'
              : 'var(--color-mint)',
          }}
        />
      </div>

      {variance !== 0 && (
        <div className="mt-2 text-xs">
          {variance > 0 ? (
            <span className="text-[var(--color-mint)]">
              +{formatMoney(variance)} vs expected take-home (overtime/bonus)
            </span>
          ) : (
            <span className="text-[var(--color-amber)]">
              {formatMoney(variance, true)} below expected take-home
            </span>
          )}
        </div>
      )}
    </Card>
  );
}
