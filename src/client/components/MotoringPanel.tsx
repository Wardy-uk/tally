import { useCallback, useEffect, useState } from 'react';
import { Car } from 'lucide-react';
import { Card, CardHeader, CardTitle } from './ui/Card';
import { Button } from './ui/Button';
import { formatMoney } from './ui/Money';
import { api } from '../lib/api';

/**
 * Build 27 — Motoring: which transactions are the car's, and what the car costs. Tally calculates all
 * of it (/api/intelligence/vehicle/review); NEURO reads only the totals. A hint is a suggestion — a
 * transaction counts only when you say it is the car's, or a rule you confirmed matches it.
 */
type Any = any;
const BUCKETS: Array<[string, string]> = [['fuelSpendPence', 'Fuel'], ['insuranceSpendPence', 'Insurance'], ['maintenanceSpendPence', 'Maintenance'], ['repairsSpendPence', 'Repairs'],
  ['taxSpendPence', 'Tax'], ['breakdownSpendPence', 'Breakdown'], ['financeRepaymentsPence', 'Finance'], ['otherMotoringSpendPence', 'Other']];
const nameOf = (ref: string | null) => (ref ? ref.replace(/^vehicle:/, '').replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : 'Unassigned');

export function MotoringPanel() {
  const [data, setData] = useState<Any | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try { setData(await api<Any>('/intelligence/vehicle/review')); setError(null); } catch (e: Any) { setError(e.error ?? 'Could not load'); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const send = async (path: string, body: Any) => {
    try { await api(path, { method: 'POST', body: JSON.stringify(body) }); await load(); } catch (e: Any) { setError(e.error ?? 'Not saved'); }
  };
  if (!data) return <Card><CardHeader><CardTitle>Motoring</CardTitle></CardHeader><p className="text-sm text-[var(--color-text-3)]">{error ?? 'Reading…'}</p></Card>;
  return <MotoringContent data={data} error={error} send={send} />;
}

/** Pure over the review payload — rendered by the test. */
export function MotoringContent({ data, error = null, send = () => {} }: { data: Any; error?: string | null; send?: (path: string, body: Any) => void }) {
  const vehicle = data.vehicles[0] ?? null;
  const [open, setOpen] = useState<string | null>(null);
  const [type, setType] = useState<Record<string, string>>({});
  const s = data.summary.find((x: Any) => x.vehicleRef === vehicle) ?? data.summary[0] ?? null;
  const m = s?.latestCompleteMonth ?? null;
  return (
    <Card>
      <CardHeader>
        <CardTitle subtitle={`What the car costs, from transactions you said are the car's. ${data.review.pending ? `${data.review.pending} might be and are not yet reviewed.` : 'Nothing waiting.'}`}>
          <span className="flex items-center gap-2"><Car className="w-4 h-4" /> Motoring{vehicle ? ` — ${nameOf(vehicle)}` : ''}</span>
        </CardTitle>
      </CardHeader>
      {error && <p className="text-sm text-[var(--color-coral)]">{error}</p>}
      {m ? (
        <div className="text-sm mb-3">
          <div className="font-semibold">{m.month}: {formatMoney(-m.totalVehicleSpendPence)}</div>
          <div className="text-xs text-[var(--color-text-3)]">{BUCKETS.filter(([k]) => m[k]).map(([k, l]) => `${l} ${formatMoney(-m[k])}`).join(' · ') || 'nothing recorded'}</div>
          <div className="text-xs text-[var(--color-text-3)] mt-1">12 months: {s.rolling12m.available ? formatMoney(-s.rolling12m.totalVehicleSpendPence) : `not yet — ${s.rolling12m.why}`}. Trend: {String(s.trend.state).replace(/_/g, ' ')}{s.trend.why ? ` (${s.trend.why})` : ''}.</div>
        </div>
      ) : <p className="text-sm text-[var(--color-text-3)] mb-3">{s ? 'No complete month yet — a month counts as complete when its bank data is complete and nothing in it is waiting for review.' : 'Nothing is classified as the car\'s yet.'}</p>}
      {data.groups.length > 0 && (
        <ul className="divide-y divide-[var(--color-border)] text-sm">
          {data.groups.map((g: Any) => {
            const key = g.merchantKey ?? g.rows[0].description;
            const t = type[key] ?? g.proposedType;
            return (
              <li key={key} className="py-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <button className="text-left" onClick={() => setOpen(open === key ? null : key)}>
                    <b>{g.merchantKey ?? 'Unnamed'}</b> <span className="text-xs text-[var(--color-text-3)]">{g.count} · {formatMoney(-g.totalPence)} · {g.reasons.join('; ')}</span>
                  </button>
                  <span className="flex flex-wrap items-center gap-2">
                    <select className="bg-[var(--color-surface-2)] rounded px-2 py-1 text-xs" value={t} onChange={(e) => setType({ ...type, [key]: e.target.value })}>
                      {data.spendTypes.map((x: Any) => <option key={x.id} value={x.id}>{x.label}</option>)}
                    </select>
                    <Button size="sm" variant="ghost" onClick={() => g.rows.forEach((r: Any) => send(`/intelligence/vehicle/decide/${r.id}`, { decision: 'vehicle', spendType: t, vehicleRef: vehicle }))}>The car's</Button>
                    {g.merchantKey && <Button size="sm" variant="ghost" onClick={() => send('/intelligence/vehicle/rules', { matchKind: 'merchant', merchantKey: g.merchantKey, spendType: t, vehicleRef: vehicle })}>Always</Button>}
                    <Button size="sm" variant="ghost" onClick={() => g.rows.forEach((r: Any) => send(`/intelligence/vehicle/decide/${r.id}`, { decision: 'not_vehicle' }))}>Not the car</Button>
                  </span>
                </div>
                {open === key && (
                  <ul className="mt-1 text-xs text-[var(--color-text-3)]">
                    {g.rows.map((r: Any) => <li key={r.id}>{r.date} {formatMoney(r.amountPence)} — {r.description} <span>({r.account}{r.category ? `, ${r.category}` : ''})</span></li>)}
                  </ul>
                )}
              </li>);
          })}
        </ul>
      )}
      {data.rules.length > 0 && (
        <details className="mt-3 text-xs">
          <summary className="cursor-pointer text-[var(--color-text-3)]">{data.rules.filter((r: Any) => r.active).length} rule{data.rules.filter((r: Any) => r.active).length === 1 ? '' : 's'} you confirmed</summary>
          <ul className="mt-1 space-y-1">{data.rules.filter((r: Any) => r.active).map((r: Any) => (
            <li key={r.id} className="flex justify-between gap-2"><span>{r.merchant_key ?? r.category_name} → {String(r.spend_type).replace(/_/g, ' ')}</span>
              <Button size="sm" variant="ghost" onClick={() => send(`/intelligence/vehicle/rules/${r.id}/retire`, {})}>Retire</Button></li>))}</ul>
          <p className="mt-1 text-[var(--color-text-3)]">A rule counts matching transactions when Tally reads them; one you decided yourself is never overruled. Retiring a rule stops it counting.</p>
        </details>
      )}
    </Card>
  );
}
