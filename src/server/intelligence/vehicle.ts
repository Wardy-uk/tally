/**
 * Build 27 — vehicle finance: which transactions are the car's, and what the car costs. PURE.
 *
 * Moved here from NEURO (Build 21's tally-vehicle.js read this database over ssh and did the money
 * arithmetic itself). Under the Build 26 boundary Tally owns every financial number about the car;
 * NEURO only reads `vehicleFinance` in finance-intelligence-v1 and knows what the car IS.
 *
 * Classification, strongest first:
 *   1. a person's decision on the transaction (vehicle / not the vehicle / don't know);
 *   2. an ACTIVE rule a person confirmed (exact merchant, exact category, or both) — applied at read
 *      time, so a rule never overrides a decision and retiring it stops it counting;
 *   3. otherwise a hint (a fuel brand, "PFS", a tyre fitter, Tally's Fuel/Transport category) makes the
 *      row a CANDIDATE for review — never vehicle spend on its own. A category is evidence, never a
 *      classification: "CRUMBS 2GO" sits in Fuel and petrol stations sit uncategorised.
 *
 * Counting reuses the ledger: only one copy of a pending/settled pair counts (COUNTS), transfers and
 * card repayments never count, a refund on a car transaction nets. Someone else's own account (Helen's)
 * is never offered for review; a car transaction a person classified there counts in totals only.
 *
 * Nothing here moves money, and no figure is invented: a month with candidates still waiting for review
 * is PARTIAL, and a window without enough complete months is unavailable, with the reason.
 */
import { COUNTS, type Row } from './ledger.js';
import { pounds } from './util.js';

export const SPEND_TYPES = ['fuel', 'insurance', 'tax', 'service', 'mot', 'tyres', 'repair', 'breakdown_cover', 'warranty', 'finance_repayment', 'parking', 'other'] as const;
export type SpendType = typeof SPEND_TYPES[number];
export const SPEND_LABELS: Record<SpendType, string> = {
  fuel: 'Fuel', insurance: 'Insurance', tax: 'Vehicle tax', service: 'Service', mot: 'MOT', tyres: 'Tyres', repair: 'Repair',
  breakdown_cover: 'Breakdown cover', warranty: 'Warranty', finance_repayment: 'Finance repayment', parking: 'Parking', other: 'Other motoring',
};
/** The contract's buckets. Every spend type lands in exactly one. */
export const BUCKET_OF: Record<SpendType, Bucket> = {
  fuel: 'fuel', insurance: 'insurance', tax: 'tax', service: 'maintenance', mot: 'maintenance', tyres: 'maintenance',
  repair: 'repairs', breakdown_cover: 'breakdown', finance_repayment: 'financeRepayments', warranty: 'otherMotoring', parking: 'otherMotoring', other: 'otherMotoring',
};
export const BUCKETS = ['fuel', 'insurance', 'financeRepayments', 'maintenance', 'repairs', 'tax', 'breakdown', 'otherMotoring'] as const;
export type Bucket = typeof BUCKETS[number];
export const MATCH_KINDS = ['merchant', 'category', 'merchant+category'] as const;
export type MatchKind = typeof MATCH_KINDS[number];
export const DECISIONS = ['vehicle', 'not_vehicle', 'unknown'] as const;

// A trend over the car's costs (three complete months against the three before).
export const VT = Object.freeze({
  WINDOW_MONTHS: 3,
  MATERIAL_RATIO: 0.15, MATERIAL_PENCE: 3000,   // ±15% and at least £30 → materially up/down
  SLIGHT_RATIO: 0.05, SLIGHT_PENCE: 1000,       // ±5% and at least £10 → slightly up/down
});

export interface VehicleDecision { transactionId: number; decision: typeof DECISIONS[number]; spendType: SpendType | null; vehicleRef: string | null; basis: string; ruleId: number | null }
export interface VehicleRule { id: number; matchKind: MatchKind; merchantKey: string | null; categoryName: string | null; spendType: SpendType; vehicleRef: string | null; active: boolean }
export interface MonthCov { month: string; complete: boolean; coverageReasons: string[] }

// Word-bounded hints. Supermarkets on their own are groceries until a petrol marker says otherwise.
const HINTS: Array<[RegExp, SpendType, string]> = [
  [/\b(SHELL|ESSO|TEXACO|GULF|JET|BP|MURCO|VALERO)\b/, 'fuel', 'a fuel brand'],
  [/\bPFS\b/, 'fuel', 'a petrol filling station (PFS)'],
  [/\b(PETROL|MOTOR FUEL|FUEL)\b/, 'fuel', 'says petrol/fuel'],
  [/\bS\/?STN\b|\bSERVICE STATION\b/, 'fuel', 'a service station'],
  [/\b(RAC|AA BREAKDOWN|GREEN FLAG)\b/, 'breakdown_cover', 'a breakdown provider'],
  [/\bDVLA\b|\bVEHICLE TAX\b/, 'tax', 'DVLA'],
  [/\bMOT\b/, 'mot', 'says MOT'],
  [/\b(KWIK ?FIT|NATIONAL TYRES|ATS EUROMASTER|BLACK ?CIRCLES|TYRE)/, 'tyres', 'a tyre fitter'],
  [/\b(HALFORDS|AUTOCENTRE|AUTO CENTRE|GARAGE|RENAULT)\b/, 'other', 'a motoring retailer or garage'],
  [/\b(CAR PARK|PARKING|NCP|RINGGO|PAYBYPHONE)\b/, 'parking', 'parking'],
];
const MOTORING_CATEGORIES: Record<string, SpendType> = { fuel: 'fuel', transport: 'other' };

/** Why a row might be the car's, or null. Never confidence 'high' — that is a person's word. PURE. */
export function hintFor(t: Row): { proposedType: SpendType; confidence: 'low' | 'medium'; reasons: string[] } | null {
  const text = `${t.merchantKey ?? ''} ${String(t.description ?? '').toUpperCase()}`;
  const reasons: string[] = [];
  let type: SpendType | null = null;
  for (const [re, ty, why] of HINTS) if (re.test(text)) { reasons.push(`the description names ${why}`); type = type ?? ty; }
  const ct = MOTORING_CATEGORIES[String(t.category ?? '').trim().toLowerCase()];
  if (ct) { reasons.push(`Tally files it under "${t.category}"`); type = type ?? ct; }
  if (!type) return null;
  return { proposedType: type, confidence: ct && reasons.length > 1 ? 'medium' : 'low', reasons };
}

/** Does a confirmed rule match this row? Exact keys only. PURE. */
export function ruleMatches(r: VehicleRule, t: Row): boolean {
  if (!r.active) return false;
  const m = !!r.merchantKey && t.merchantKey === r.merchantKey;
  const c = !!r.categoryName && String(t.category ?? '').toLowerCase() === r.categoryName.toLowerCase();
  if (r.matchKind === 'merchant') return m;
  if (r.matchKind === 'category') return c;
  return m && c;
}

export function validateRule(b: { matchKind?: unknown; merchantKey?: unknown; categoryName?: unknown; spendType?: unknown }): string | null {
  if (!MATCH_KINDS.includes(b.matchKind as MatchKind)) return `matchKind must be one of ${MATCH_KINDS.join(', ')}`;
  if (!SPEND_TYPES.includes(b.spendType as SpendType)) return `spendType must be one of ${SPEND_TYPES.join(', ')}`;
  if (b.matchKind !== 'category' && !(typeof b.merchantKey === 'string' && b.merchantKey.trim().length >= 2)) return 'a merchant rule needs the exact merchant key';
  if (b.matchKind !== 'merchant' && !(typeof b.categoryName === 'string' && b.categoryName.trim())) return 'a category rule needs the category name';
  return null;
}

/** A row a rule may count: a counted purchase or fee. */
const RULE_ELIGIBLE = (t: Row) => COUNTS(t.status) && (t.type === 'spend' || t.type === 'fee') && t.amount < 0;
/** What a car-classified row adds to the car's cost (pence spent; a refund nets). */
export function carEffect(t: Row): number {
  if (!COUNTS(t.status)) return 0;
  if (t.type === 'spend' || t.type === 'fee' || t.type === 'financing' || t.type === 'refund' || t.type === 'reversal') return -t.amount;
  return 0;
}

export interface Classified { row: Row; spendType: SpendType; bucket: Bucket; vehicleRef: string | null; basis: 'decision' | 'rule'; ruleId: number | null; pence: number }
export interface Candidate { row: Row; proposedType: SpendType; confidence: 'low' | 'medium'; reasons: string[] }

/** Every row → car spend, a candidate for review, or nothing. PURE. */
export function classify(rows: Row[], decisions: VehicleDecision[], rules: VehicleRule[]) {
  const dec = new Map(decisions.map((d) => [d.transactionId, d]));
  const active = rules.filter((r) => r.active);
  const car: Classified[] = [];
  const candidates: Candidate[] = [];
  const decidedNotCar = { notVehicle: 0, unknown: 0 };
  const notCounted: Array<{ id: number; why: string }> = [];
  let privateHinted = 0;
  for (const t of rows) {
    const d = dec.get(t.id);
    if (d) {
      if (d.decision === 'not_vehicle') { decidedNotCar.notVehicle++; continue; }
      if (d.decision === 'unknown') { decidedNotCar.unknown++; continue; }
      const st = (SPEND_TYPES.includes(d.spendType as SpendType) ? d.spendType : 'other') as SpendType;
      const pence = carEffect(t);
      if (!pence) notCounted.push({ id: t.id, why: COUNTS(t.status) ? `a ${t.type.replace(/_/g, ' ')} never counts as spending` : 'the duplicate copy of another row' });
      car.push({ row: t, spendType: st, bucket: BUCKET_OF[st], vehicleRef: d.vehicleRef, basis: 'decision', ruleId: d.ruleId, pence });
      continue;
    }
    if (!RULE_ELIGIBLE(t)) continue;
    const r = active.find((x) => ruleMatches(x, t));
    if (r) { car.push({ row: t, spendType: r.spendType, bucket: BUCKET_OF[r.spendType], vehicleRef: r.vehicleRef, basis: 'rule', ruleId: r.id, pence: carEffect(t) }); continue; }
    if (t.type !== 'spend') continue;
    const h = hintFor(t);
    if (!h) continue;
    if (t.owner === 'private') { privateHinted++; continue; }
    candidates.push({ row: t, ...h });
  }
  return { car, candidates, decidedNotCar, notCounted, privateHinted };
}

const emptyBuckets = () => Object.fromEntries(BUCKETS.map((b) => [b, 0])) as Record<Bucket, number>;
function sumInto(items: Classified[]): { byBucket: Record<Bucket, number>; totalPence: number; transactions: number } {
  const byBucket = emptyBuckets();
  let total = 0; let n = 0;
  for (const c of items) { byBucket[c.bucket] += c.pence; total += c.pence; if (c.pence) n++; }
  return { byBucket, totalPence: total, transactions: n };
}
/** The contract's field names (pence). */
export function bucketFields(b: Record<Bucket, number>, total: number) {
  return {
    fuelSpendPence: b.fuel, insuranceSpendPence: b.insurance, financeRepaymentsPence: b.financeRepayments, maintenanceSpendPence: b.maintenance,
    repairsSpendPence: b.repairs, taxSpendPence: b.tax, breakdownSpendPence: b.breakdown, otherMotoringSpendPence: b.otherMotoring, totalVehicleSpendPence: total,
  };
}

function trendState(cur: number, prev: number): 'materially_up' | 'materially_down' | 'slightly_up' | 'slightly_down' | 'broadly_stable' {
  const diff = cur - prev; const ratio = prev ? Math.abs(diff) / prev : Infinity;
  if (Math.abs(diff) >= VT.MATERIAL_PENCE && ratio >= VT.MATERIAL_RATIO) return diff > 0 ? 'materially_up' : 'materially_down';
  if (Math.abs(diff) >= VT.SLIGHT_PENCE && ratio >= VT.SLIGHT_RATIO) return diff > 0 ? 'slightly_up' : 'slightly_down';
  return 'broadly_stable';
}

/**
 * One vehicle's finance (or the household's unassigned motoring), month by month. PURE.
 *   months: the ledger's calendar months with their coverage, oldest first.
 */
export function vehicleSummary(items: Classified[], candidates: Candidate[], months: MonthCov[], { today }: { today: string }) {
  const pendingByMonth = new Map<string, number>();
  for (const c of candidates) pendingByMonth.set(c.row.date.slice(0, 7), (pendingByMonth.get(c.row.date.slice(0, 7)) ?? 0) + 1);
  const monthly = months.map((m) => {
    const s = sumInto(items.filter((c) => c.row.date.slice(0, 7) === m.month));
    const pending = pendingByMonth.get(m.month) ?? 0;
    const reasons = [...m.coverageReasons, ...(pending ? [`${pending} transaction${pending === 1 ? '' : 's'} this month might be the car's and ${pending === 1 ? 'is' : 'are'} not yet reviewed`] : [])];
    return { month: m.month, complete: m.complete && !pending, ledgerComplete: m.complete, pendingReview: pending, reasons, transactions: s.transactions, ...bucketFields(s.byBucket, s.totalPence) };
  });
  // Windows of consecutive complete months ending at the latest complete one.
  const lastIdx = (() => { for (let i = monthly.length - 1; i >= 0; i--) if (monthly[i].complete) return i; return -1; })();
  const window = (n: number) => {
    if (lastIdx < 0) return { months: n, available: false, why: 'no complete month yet', from: null, to: null };
    const slice = monthly.slice(Math.max(0, lastIdx - n + 1), lastIdx + 1);
    const run = (() => { let k = 0; for (let i = slice.length - 1; i >= 0 && slice[i].complete; i--) k++; return k; })();
    if (slice.length < n || run < n) {
      return { months: n, available: false, why: `needs ${n} complete months in a row; ${run} available up to ${monthly[lastIdx].month}`, from: null, to: null };
    }
    const s = sumInto(items.filter((c) => c.row.date.slice(0, 7) >= slice[0].month && c.row.date.slice(0, 7) <= slice[slice.length - 1].month));
    return { months: n, available: true, why: null, from: `${slice[0].month}-01`, to: endOf(slice[slice.length - 1].month), transactions: s.transactions, ...bucketFields(s.byBucket, s.totalPence) };
  };
  const w3 = window(3); const w6 = window(6); const w12 = window(12);
  // Trend: the latest three complete months against the three before them.
  let trend: Record<string, unknown>;
  if (!w6.available) trend = { state: 'insufficient_data', why: `a trend compares three complete months with the three before — ${w6.why}`, rule: trendRule() };
  else {
    const recent = monthly.slice(lastIdx - 2, lastIdx + 1); const prior = monthly.slice(lastIdx - 5, lastIdx - 2);
    const a = prior.reduce((x, m) => x + m.totalVehicleSpendPence, 0); const b = recent.reduce((x, m) => x + m.totalVehicleSpendPence, 0);
    trend = { state: trendState(b, a), recentPence: b, priorPence: a, changePence: b - a, recent: `${recent[0].month} – ${recent[2].month}`, prior: `${prior[0].month} – ${prior[2].month}`, why: null, rule: trendRule() };
  }
  const current = monthly.find((m) => m.month === today.slice(0, 7)) ?? null;
  const latestComplete = lastIdx >= 0 ? monthly[lastIdx] : null;
  return { months: monthly.slice(-12), currentMonth: current, latestCompleteMonth: latestComplete, last3CompleteMonths: w3, last6CompleteMonths: w6, rolling12m: w12, trend };
}
const trendRule = () => `materially = ±${VT.MATERIAL_RATIO * 100}% and at least ${pounds(VT.MATERIAL_PENCE)}; slightly = ±${VT.SLIGHT_RATIO * 100}% and at least ${pounds(VT.SLIGHT_PENCE)}; otherwise broadly stable`;
function endOf(m: string): string { const x = new Date(`${m}-01T00:00:00Z`); x.setUTCMonth(x.getUTCMonth() + 1); x.setUTCDate(0); return x.toISOString().slice(0, 10); }

/** The whole vehicle-finance read: per vehicle, plus the review queue's counts. PURE. */
export function vehicleFinance(rows: Row[], decisions: VehicleDecision[], rules: VehicleRule[], months: MonthCov[], { today }: { today: string }) {
  const k = classify(rows, decisions, rules);
  const refs = [...new Set(k.car.map((c) => c.vehicleRef ?? null))];
  const vehicles = refs.map((ref) => {
    const items = k.car.filter((c) => (c.vehicleRef ?? null) === ref);
    const s = vehicleSummary(items, k.candidates, months, { today });
    const confidence = k.candidates.length ? 'partial' : s.latestCompleteMonth ? 'strong' : 'weak';
    return {
      vehicleRef: ref,
      classified: { transactions: items.length, byDecision: items.filter((i) => i.basis === 'decision').length, byRule: items.filter((i) => i.basis === 'rule').length },
      ...s, confidence,
      explanation: [
        'Counted only when a person said a transaction is the car\'s, or a rule a person confirmed matches it. A hint (a fuel brand, a category) is only a suggestion to review.',
        'One copy of a pending/settled pair counts; transfers and card repayments never count; a refund on a car purchase nets.',
        ...(k.candidates.length ? [`${k.candidates.length} transaction${k.candidates.length === 1 ? '' : 's'} might be the car's and ${k.candidates.length === 1 ? 'is' : 'are'} not yet reviewed — months containing one are partial.`] : []),
        ...(ref == null ? ['These transactions were classified as motoring without saying which vehicle.'] : []),
      ],
    };
  });
  const pendingByMonth: Record<string, number> = {};
  for (const c of k.candidates) pendingByMonth[c.row.date.slice(0, 7)] = (pendingByMonth[c.row.date.slice(0, 7)] ?? 0) + 1;
  return {
    vehicles,
    review: { pending: k.candidates.length, pendingByMonth, decidedNotVehicle: k.decidedNotCar.notVehicle, decidedUnknown: k.decidedNotCar.unknown,
      privateAccountsNotOffered: k.privateHinted, decidedButNotCounted: k.notCounted.length },
    rules: { active: rules.filter((r) => r.active).length, retired: rules.filter((r) => !r.active).length },
    _candidates: k.candidates, _car: k.car,
  };
}

/** The confirmation workflow's list (Tally's own UI): candidates grouped by merchant. PURE. */
export function reviewGroups(candidates: Candidate[]) {
  const groups = new Map<string, { merchantKey: string | null; proposedType: SpendType; reasons: Set<string>; rows: Candidate[] }>();
  for (const c of candidates) {
    const key = c.row.merchantKey ?? c.row.description;
    const g = groups.get(key) ?? { merchantKey: c.row.merchantKey, proposedType: c.proposedType, reasons: new Set<string>(), rows: [] };
    c.reasons.forEach((r) => g.reasons.add(r)); g.rows.push(c); groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => b.rows.length - a.rows.length || String(a.merchantKey).localeCompare(String(b.merchantKey)))
    .map((g) => ({ merchantKey: g.merchantKey, proposedType: g.proposedType, reasons: [...g.reasons], count: g.rows.length,
      totalPence: g.rows.reduce((a, c) => a + -c.row.amount, 0),
      rows: g.rows.sort((a, b) => b.row.date.localeCompare(a.row.date)).map((c) => ({ id: c.row.id, date: c.row.date, amountPence: c.row.amount, description: c.row.description, category: c.row.category, account: c.row.accountName })) }));
}
