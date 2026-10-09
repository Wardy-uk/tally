import { useCallback, useEffect, useState } from 'react';
import { Compass, RefreshCw } from 'lucide-react';
import { Card, CardHeader, CardTitle } from './ui/Card';
import { Button } from './ui/Button';
import { Money, formatMoney } from './ui/Money';
import { api } from '../lib/api';
import { MotoringPanel } from './MotoringPanel';

/**
 * Build 26 — Outlook: what is happening financially, what is changing, what is likely to happen next,
 * and what is unusual. Everything here is calculated by Tally (/api/intelligence); this page only shows
 * it. Nothing moves money.
 */

type Any = any; // the payload is large and documented server-side (src/server/intelligence)

const STATE_TONE: Record<string, string> = {
  healthy: 'mint', good: 'mint', strong: 'mint', comfortable: 'mint', broadly_stable: 'sky',
  partial: 'amber', tighter_than_usual: 'amber', slightly_up: 'amber', slightly_down: 'sky', weak: 'amber', stale: 'amber',
  stretched: 'coral', materially_up: 'coral', materially_down: 'sky', poor: 'coral', reconnect_required: 'coral', unavailable: 'coral',
  insufficient_data: 'muted', unknown: 'muted',
};
function Badge({ state, label }: { state: string; label?: string }) {
  const tone = STATE_TONE[state] ?? 'muted';
  const cls = tone === 'muted' ? 'bg-[var(--color-surface-2)] text-[var(--color-text-3)]' : `bg-[var(--color-${tone}-soft)] text-[var(--color-${tone})]`;
  return <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${cls}`}>{label ?? state.replace(/_/g, ' ')}</span>;
}
const signed = (p: number | null | undefined) => (p == null ? '—' : formatMoney(p));
const Why = ({ lines }: { lines: string[] }) => (
  <ul className="mt-2 space-y-1">{lines.map((l, i) => <li key={i} className="text-xs text-[var(--color-text-3)]">{l}</li>)}</ul>
);

export function OutlookView() {
  const [data, setData] = useState<Any | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [planned, setPlanned] = useState({ title: '', dueDate: '', amount: '', kind: 'annual_bill' });

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setData(await api<Any>('/intelligence')); } catch (e: Any) { setError(e.error ?? 'Could not load'); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function decide(path: string, decision: string) {
    try { await api(path, { method: 'POST', body: JSON.stringify({ decision }) }); await load(); } catch (e: Any) { setError(e.error ?? 'Not saved'); }
  }
  async function addPlanned() {
    const pounds = Number(planned.amount);
    if (!planned.title || !planned.dueDate || !Number.isFinite(pounds) || pounds === 0) { setError('A planned payment needs a title, a date and an amount'); return; }
    const amountPence = Math.round(Math.abs(pounds) * 100) * (planned.kind === 'income' ? 1 : -1);
    try {
      await api('/intelligence/planned', { method: 'POST', body: JSON.stringify({ title: planned.title, dueDate: planned.dueDate, amountPence, kind: planned.kind }) });
      setPlanned({ title: '', dueDate: '', amount: '', kind: 'annual_bill' }); await load();
    } catch (e: Any) { setError(e.error ?? 'Not saved'); }
  }
  async function closePlanned(id: number, status: string) {
    try { await api(`/intelligence/planned/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) }); await load(); } catch (e: Any) { setError(e.error ?? 'Not saved'); }
  }

  if (loading && !data) return <div className="text-sm text-[var(--color-text-3)]">Reading the ledger…</div>;
  if (!data) return <Card><p className="text-sm text-[var(--color-coral)]">Outlook could not be read: {error}</p></Card>;
  return <OutlookContent data={data} error={error} load={load} decide={decide} addPlanned={addPlanned} closePlanned={closePlanned} planned={planned} setPlanned={setPlanned} />;
}

/** The page itself, pure over the payload — rendered by the test against a real one. */
export function OutlookContent({ data, error = null, load = () => {}, decide = () => {}, addPlanned = () => {}, closePlanned = () => {}, planned = { title: '', dueDate: '', amount: '', kind: 'annual_bill' }, setPlanned = () => {} }:
  { data: Any; error?: string | null; load?: () => void; decide?: (p: string, d: string) => void; addPlanned?: () => void; closePlanned?: (id: number, s: string) => void; planned?: Any; setPlanned?: (p: Any) => void }) {
  const [horizon, setHorizon] = useState<number | 'income'>(30);

  const cf = data.cashflow;
  const h = horizon === 'income' ? cf.toNextIncome : cf.horizons.find((x: Any) => x.days === horizon);
  const established = data.recurring.filter((s: Any) => s.state === 'strong_pattern' || s.state === 'explicit_recurring');
  const unusual = data.unusual.filter((u: Any) => !u.explainedBy && u.decision !== 'leave' && u.decision !== 'not_duplicate');

  return (
    <div className="flex flex-col gap-6 fade-up">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2"><Compass className="w-6 h-6 text-[var(--color-mint)]" /> Outlook</h1>
          <p className="text-sm text-[var(--color-text-3)] mt-1">What is happening, what is changing, what is likely next, and what is unusual — calculated from the ledger, {data.today}.</p>
        </div>
        <Button variant="secondary" size="sm" onClick={load}><RefreshCw className="w-4 h-4" /> Refresh</Button>
      </div>
      {error && <p className="text-sm text-[var(--color-coral)]">{error}</p>}

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader><CardTitle subtitle={data.position.statement}>Current position</CardTitle></CardHeader>
          <Money pence={data.position.usableLiquidPence ?? 0} size="2xl" color={data.position.usableLiquidPence == null ? 'muted' : 'neutral'} />
          <ul className="mt-3 space-y-1">
            {data.balances.map((b: Any) => (
              <li key={b.accountId} className="flex justify-between text-sm">
                <span>{b.name} {!b.fresh && <Badge state="stale" label="not current" />}</span>
                <span className="tabular">{signed(b.balancePence)}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <CardHeader><CardTitle subtitle="How the next 30 days compare with your usual">Pressure</CardTitle><Badge state={data.pressure.state} /></CardHeader>
          <Why lines={data.pressure.why} />
        </Card>
        <Card>
          <CardHeader><CardTitle subtitle="Each one separate">Sources</CardTitle><Badge state={data.health.bankFeed.household} /></CardHeader>
          <ul className="space-y-1 text-xs">
            {data.health.bankFeed.accounts.map((a: Any) => <li key={a.accountId}><b>{a.name}</b> feed: <Badge state={a.state} /> {a.why}</li>)}
            <li>Categories: <Badge state={data.health.categories.state} /> {data.health.categories.why}</li>
            <li>Recurrence: <Badge state={data.health.recurrence.state} /> {data.health.recurrence.why}</li>
            <li>Forecast: <Badge state={data.health.forecast.state} /></li>
            {data.health.transactions.filter((t: Any) => t.gaps.length).map((t: Any) => <li key={t.accountId}>{t.name}: {t.why}</li>)}
          </ul>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle subtitle="Known payments only — day-to-day spending is shown beside it, never subtracted">Next days</CardTitle>
          <Badge state={cf.confidence} label={`${cf.confidence} confidence`} />
        </CardHeader>
        {cf.confidence === 'unavailable' ? <Why lines={cf.explanation} /> : (
          <>
            <div className="flex gap-2 mb-4">
              {[7, 14, 30].map((d) => <Button key={d} size="sm" variant={horizon === d ? 'primary' : 'ghost'} onClick={() => setHorizon(d)}>{d} days</Button>)}
              {cf.toNextIncome && <Button size="sm" variant={horizon === 'income' ? 'primary' : 'ghost'} onClick={() => setHorizon('income')}>Until next income</Button>}
            </div>
            {h && (
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between"><span>Opening balance</span><span className="tabular">{signed(h.openingPence)}</span></div>
                  <div className="flex justify-between"><span>Known money in</span><Money pence={h.moneyInPence} color="positive" /></div>
                  <div className="flex justify-between"><span>Known money out</span><span className="tabular">{formatMoney(-h.moneyOutPence)}</span></div>
                  <div className="flex justify-between font-semibold"><span>Projected ({h.through})</span><span className="tabular">{signed(h.projectedPence)}</span></div>
                  {h.projectedRange && <div className="text-xs text-[var(--color-text-3)]">Range with variable bills and income: {signed(h.projectedRange.lowPence)} – {signed(h.projectedRange.highPence)}</div>}
                  <div className="text-xs text-[var(--color-text-3)]">Lowest point {signed(h.lowestPoint.pence)} on {h.lowestPoint.date}.</div>
                  {h.dayToDayNotProjectedPence != null && <div className="text-xs text-[var(--color-amber)]">Day-to-day spending not included: usually about {formatMoney(h.dayToDayNotProjectedPence)} over this period.</div>}
                  <Why lines={[...cf.confidenceWhy.map((w: string) => `Confidence: ${w}`), ...cf.excludedUnknowns.map((u: string) => `Not included: ${u}`)]} />
                </div>
                <ul className="space-y-1 text-sm max-h-80 overflow-auto">
                  {h.items.map((i: Any, n: number) => (
                    <li key={n} className="flex justify-between gap-2">
                      <span className="truncate"><span className="text-[var(--color-text-3)] tabular">{i.date.slice(5)}</span> {i.label}{i.variable && <span className="text-xs text-[var(--color-text-3)]"> (varies)</span>}{i.late && <Badge state="partial" label="due, not seen" />}</span>
                      <span className="tabular">{i.direction === 'in' ? <Money pence={i.pence} color="positive" /> : formatMoney(-i.pence)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle subtitle="Complete calendar months only">Monthly trend</CardTitle></CardHeader>
          <ul className="space-y-2 text-sm">{data.trends.map((t: Any) => <li key={t.measure}><Badge state={t.state} /> {t.line}</li>)}</ul>
          <table className="mt-4 w-full text-xs tabular">
            <thead><tr className="text-[var(--color-text-3)]"><th className="text-left">Month</th><th className="text-right">Spending</th><th className="text-right">In</th><th className="text-right">Out</th><th className="text-right">Categorised</th></tr></thead>
            <tbody>{[...data.monthly].reverse().map((m: Any) => (
              <tr key={m.month} className={m.complete ? '' : 'text-[var(--color-text-4)]'} title={m.coverageReasons.join('; ')}>
                <td>{m.month}{m.complete ? '' : ' (partial)'}</td><td className="text-right">{formatMoney(m.spendPence)}</td><td className="text-right">{formatMoney(m.moneyInPence)}</td><td className="text-right">{formatMoney(m.moneyOutPence)}</td><td className="text-right">{m.categorisedPct ?? '—'}%</td>
              </tr>))}</tbody>
          </table>
        </Card>
        <Card>
          <CardHeader><CardTitle subtitle="Only when enough spending carries a category">Category trends</CardTitle></CardHeader>
          {data.categoryTrends.available ? (
            <ul className="space-y-2 text-sm">{data.categoryTrends.items.map((c: Any) => (
              <li key={c.category}><Badge state={c.state} /> {c.line}{c.contributors.length > 0 && <div className="text-xs text-[var(--color-text-3)]">Mostly {c.contributors.map((x: Any) => `${x.merchantKey} (${formatMoney(x.deltaPence, true)})`).join(', ')}</div>}</li>))}</ul>
          ) : <p className="text-sm text-[var(--color-text-3)]">Not available: {data.categoryTrends.why}.</p>}
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle subtitle={`${established.length} established · ${data.recurringCounts.weak_pattern ?? 0} not yet established (never forecast)`}>Recurring payments</CardTitle></CardHeader>
        <ul className="divide-y divide-[var(--color-border)] text-sm">
          {established.map((s: Any) => (
            <li key={s.key} className="py-2 flex flex-wrap items-center justify-between gap-2">
              <span>
                <b>{s.label}</b> <span className="text-xs text-[var(--color-text-3)]">{s.accountName} · {String(s.cadence).replace('_', '-')} · {s.amountKind === 'variable' ? `varies ${formatMoney(s.range.minPence)}–${formatMoney(s.range.maxPence)}` : 'fixed'} · next {s.nextExpected ?? '—'}</span>
                {s.lateDays != null && <Badge state="partial" label={`${s.lateDays}d late`} />}{s.missed && <Badge state="stale" label="did not arrive" />}{s.state === 'explicit_recurring' && <Badge state="good" label="marked recurring" />}
              </span>
              <span className="flex items-center gap-2">
                {s.direction === 'in' ? <Money pence={s.typicalPence} color="positive" /> : <span className="tabular">{formatMoney(-s.typicalPence)}</span>}
                {s.state === 'explicit_recurring'
                  ? <Button size="sm" variant="ghost" onClick={() => decide(`/intelligence/recurring/${s.key}`, 'clear')}>Undo</Button>
                  : <Button size="sm" variant="ghost" onClick={() => decide(`/intelligence/recurring/${s.key}`, 'not_recurring')}>Not recurring</Button>}
              </span>
            </li>))}
        </ul>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle subtitle="What changed, and what it adds up to over a year">Price changes</CardTitle></CardHeader>
          {data.priceChanges.length ? <ul className="space-y-2 text-sm">{data.priceChanges.map((p: Any) => <li key={p.seriesKey}><b>{p.label}</b> — {p.line} <span className="text-xs text-[var(--color-text-3)]">since {p.firstObserved}</span></li>)}</ul>
            : <p className="text-sm text-[var(--color-text-3)]">No recurring payment has changed price.</p>}
        </Card>
        <Card>
          <CardHeader><CardTitle subtitle="Compared with your recorded history — not a judgement">Unusual</CardTitle></CardHeader>
          {unusual.length ? <ul className="space-y-3 text-sm">{unusual.map((u: Any) => (
            <li key={u.key}>
              <div>{u.line} <span className="text-xs text-[var(--color-text-3)]">{u.date}</span></div>
              <div className="flex gap-2 mt-1">
                <Button size="sm" variant="ghost" onClick={() => decide(`/intelligence/unusual/${u.key}`, 'expected')}>Expected</Button>
                {u.kind === 'possible-duplicate' && <Button size="sm" variant="ghost" onClick={() => decide(`/intelligence/unusual/${u.key}`, 'not_duplicate')}>Not a duplicate</Button>}
                <Button size="sm" variant="ghost" onClick={() => decide(`/intelligence/unusual/${u.key}`, 'leave')}>Leave it</Button>
              </div>
            </li>))}</ul> : <p className="text-sm text-[var(--color-text-3)]">Nothing unusual in the last 90 days.</p>}
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle subtitle="Known future payments the forecast should include: renewals, annual bills, one-offs">Planned payments</CardTitle></CardHeader>
        <ul className="space-y-1 text-sm mb-3">
          {data.planned.filter((p: Any) => p.status === 'open').map((p: Any) => (
            <li key={p.id} className="flex justify-between items-center gap-2">
              <span>{p.due_date} — {p.title} <span className="text-xs text-[var(--color-text-3)]">{p.kind.replace('_', ' ')}</span></span>
              <span className="flex items-center gap-2"><span className="tabular">{formatMoney(p.amount)}</span>
                <Button size="sm" variant="ghost" onClick={() => closePlanned(p.id, 'done')}>Done</Button>
                <Button size="sm" variant="ghost" onClick={() => closePlanned(p.id, 'cancelled')}>Cancel</Button></span>
            </li>))}
        </ul>
        <div className="flex flex-wrap gap-2 items-end">
          <input className="bg-[var(--color-surface-2)] rounded-lg px-3 py-2 text-sm" placeholder="e.g. Car insurance renewal" value={planned.title} onChange={(e) => setPlanned({ ...planned, title: e.target.value })} />
          <input type="date" className="bg-[var(--color-surface-2)] rounded-lg px-3 py-2 text-sm" value={planned.dueDate} onChange={(e) => setPlanned({ ...planned, dueDate: e.target.value })} />
          <input inputMode="decimal" className="bg-[var(--color-surface-2)] rounded-lg px-3 py-2 text-sm w-28" placeholder="£ amount" value={planned.amount} onChange={(e) => setPlanned({ ...planned, amount: e.target.value })} />
          <select className="bg-[var(--color-surface-2)] rounded-lg px-3 py-2 text-sm" value={planned.kind} onChange={(e) => setPlanned({ ...planned, kind: e.target.value })}>
            <option value="annual_bill">Annual bill</option><option value="renewal">Renewal</option><option value="one_off">One-off</option><option value="income">Money in</option>
          </select>
          <Button size="sm" onClick={addPlanned}>Add</Button>
        </div>
      </Card>

      <MotoringPanel />
    </div>
  );
}
