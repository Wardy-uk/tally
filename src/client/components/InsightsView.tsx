import { useCallback, useEffect, useState } from 'react';
import { Sparkles, RefreshCw, AlertTriangle, TrendingUp, Lightbulb, Star } from 'lucide-react';
import { Card, CardHeader, CardTitle } from './ui/Card';
import { Button } from './ui/Button';
import { EmptyState } from './ui/EmptyState';
import { api } from '../lib/api';

interface Insight {
  month: string;
  summary: string;
  highlights: string[];
  concerns: string[];
  wins: string[];
  advice: string[];
  generatedAt: string;
}

export function InsightsView() {
  const [insights, setInsights] = useState<Insight[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setInsights(await api<Insight[]>('/insights'));
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function generate() {
    setGenerating(true);
    setError(null);
    try {
      const month = new Date().toISOString().slice(0, 7);
      await api('/insights/generate', { method: 'POST', body: JSON.stringify({ month }) });
      await load();
    } catch (e: any) {
      setError(e.error ?? 'Failed to generate insight');
    } finally { setGenerating(false); }
  }

  return (
    <div className="flex flex-col gap-6 fade-up">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">AI Insights</h1>
          <p className="text-sm text-[var(--color-text-3)] mt-1">
            Monthly summaries, advice and things to watch
          </p>
        </div>
        <Button variant="primary" icon={<RefreshCw className="w-4 h-4" />} onClick={generate} disabled={generating}>
          {generating ? 'Thinking…' : 'Generate this month'}
        </Button>
      </div>

      {error && (
        <div className="rounded-[12px] px-4 py-3 text-sm border bg-[var(--color-coral-soft)] border-[rgba(251,113,133,0.25)] text-[var(--color-coral)]">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-sm text-[var(--color-text-3)]">Loading…</div>
      ) : insights.length === 0 ? (
        <Card padding="lg">
          <EmptyState
            icon={<Sparkles className="w-7 h-7" />}
            title="No insights yet"
            description="Generate a monthly review and Tally will analyse your spending and give specific advice."
            action={<Button variant="primary" icon={<RefreshCw className="w-4 h-4" />} onClick={generate} disabled={generating}>Generate now</Button>}
          />
        </Card>
      ) : (
        <div className="flex flex-col gap-6">
          {insights.map((ins, i) => <InsightCard key={i} ins={ins} />)}
        </div>
      )}
    </div>
  );
}

function InsightCard({ ins }: { ins: Insight }) {
  const monthLabel = new Date(`${ins.month}-01`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  return (
    <Card padding="lg">
      <CardHeader>
        <CardTitle subtitle={`Generated ${new Date(ins.generatedAt).toLocaleString()}`}>
          {monthLabel}
        </CardTitle>
      </CardHeader>

      <div className="text-[15px] text-[var(--color-text)] leading-relaxed mb-6 p-4 rounded-[14px] bg-[var(--color-mint-soft)] border border-[rgba(74,222,128,0.2)]">
        {ins.summary}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <Section icon={<Star className="w-4 h-4" />} title="Wins" color="mint" items={ins.wins} />
        <Section icon={<TrendingUp className="w-4 h-4" />} title="Highlights" color="sky" items={ins.highlights} />
        <Section icon={<AlertTriangle className="w-4 h-4" />} title="Concerns" color="amber" items={ins.concerns} />
        <Section icon={<Lightbulb className="w-4 h-4" />} title="Advice" color="violet" items={ins.advice} />
      </div>
    </Card>
  );
}

const COLOR_MAP = {
  mint: { text: 'var(--color-mint)', bg: 'var(--color-mint-soft)' },
  sky: { text: 'var(--color-sky)', bg: 'var(--color-sky-soft)' },
  amber: { text: 'var(--color-amber)', bg: 'var(--color-amber-soft)' },
  violet: { text: 'var(--color-violet)', bg: 'var(--color-violet-soft)' },
};

function Section({
  icon, title, color, items,
}: {
  icon: React.ReactNode;
  title: string;
  color: keyof typeof COLOR_MAP;
  items: string[];
}) {
  if (items.length === 0) return null;
  const c = COLOR_MAP[color];
  return (
    <div>
      <div className="flex items-center gap-2 mb-2" style={{ color: c.text }}>
        <div className="w-6 h-6 rounded-lg flex items-center justify-center" style={{ background: c.bg }}>
          {icon}
        </div>
        <span className="text-xs font-bold uppercase tracking-wider">{title}</span>
      </div>
      <ul className="flex flex-col gap-2 pl-1">
        {items.map((item, i) => (
          <li key={i} className="text-sm text-[var(--color-text-2)] leading-relaxed pl-3 relative">
            <span className="absolute left-0 top-[7px] w-1 h-1 rounded-full" style={{ background: c.text }} />
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}
