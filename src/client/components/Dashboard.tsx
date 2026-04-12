import { Card, CardHeader, CardTitle } from './ui/Card';
import { Money } from './ui/Money';
import { Sparkles, TrendingUp, TrendingDown, Wallet } from 'lucide-react';

export function Dashboard() {
  return (
    <div className="flex flex-col gap-6 fade-up">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight">Dashboard</h1>
        <p className="text-sm text-[var(--color-text-3)] mt-1">
          A quick view of where the money is going
        </p>
      </div>

      {/* Hero: net worth */}
      <Card glow padding="lg" className="relative overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-br from-[var(--color-mint-soft)] to-transparent rounded-full blur-3xl pointer-events-none" />
        <div className="relative">
          <div className="flex items-center gap-2 text-[var(--color-text-3)] text-xs uppercase tracking-wider font-semibold mb-2">
            <Wallet className="w-3.5 h-3.5" /> Net worth
          </div>
          <Money pence={0} size="3xl" color="neutral" />
          <div className="text-sm text-[var(--color-text-3)] mt-2">
            Add an account and import some transactions to get started
          </div>
        </div>
      </Card>

      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Kpi icon={<TrendingUp className="w-4 h-4" />} label="Income this month" value={0} color="positive" />
        <Kpi icon={<TrendingDown className="w-4 h-4" />} label="Spent this month" value={0} color="negative" />
        <Kpi icon={<Sparkles className="w-4 h-4" />} label="Available" value={0} color="neutral" />
      </div>

      {/* Placeholder sections */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle subtitle="Your top spending categories this month">By category</CardTitle>
          </CardHeader>
          <div className="text-sm text-[var(--color-text-3)] py-12 text-center">
            No data yet
          </div>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle subtitle="Latest activity across all accounts">Recent transactions</CardTitle>
          </CardHeader>
          <div className="text-sm text-[var(--color-text-3)] py-12 text-center">
            No transactions yet
          </div>
        </Card>
      </div>
    </div>
  );
}

function Kpi({
  icon, label, value, color,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  color: 'positive' | 'negative' | 'neutral';
}) {
  return (
    <Card>
      <div className="flex items-center gap-2 text-[var(--color-text-3)] text-xs uppercase tracking-wider font-semibold mb-2">
        {icon} {label}
      </div>
      <Money pence={value} size="xl" color={color} />
    </Card>
  );
}
