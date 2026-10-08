/**
 * Plan the migration of unsafe categorisation rules (card+date keys, date fragments, very short
 * or generic substrings) to merchant-keyed rules. Pure: takes rows, returns a plan + metrics.
 *
 * Provenance caveat: before this change Tally never recorded whether a category was set by the
 * user or filled by a rule. An unsafe rule was created by one manual click; every other matching
 * transaction it filled was collateral. So a decision is only treated as proven when the evidence
 * is unambiguous (a single matching transaction, or every match being the same merchant).
 */
import { merchantIdentity } from './merchant.js';
import { orderRules, ruleMatches, unsafeRuleReason, type RuleLike } from './rule-policy.js';

export interface PlanTx {
  id: number;
  date: string;
  account_id: number;
  amount: number;
  description: string;
  merchant: string | null;
  category_id: number | null;
  is_transfer: number;
}

export interface PlanRule extends RuleLike {
  name: string;
}

export type RuleType =
  | 'reusable_merchant'
  | 'reusable_merchant_context'
  | 'transaction_specific'
  | 'card_date_accidental'
  | 'ambiguous';

export type MigrationState = 'safe_to_convert' | 'needs_confirmation' | 'transaction_specific' | 'retire';

export interface RuleAudit {
  rule: PlanRule;
  type: RuleType;
  unsafeReason: string | null;
  matches: number;
  attributed: number;        // matches carrying the rule's category
  conflicting: number;       // matches carrying a different category
  merchantKeys: string[];    // distinct merchant keys among attributed matches
  confidence: 'high' | 'medium' | 'low';
  migration?: { state: MigrationState; reason: string; merchantKey?: string; categoryId?: number };
}

export type TxOutcome = 'keep' | 'change' | 'uncategorise_unproven';

export interface TxDecision {
  txId: number;
  ruleId: number;
  from: number;
  to: number | null;
  outcome: TxOutcome;
  reason: string;
}

export interface Metrics {
  spendingTx: number;
  spendingPence: number;
  usableTx: number;
  usablePence: number;
  conflictingTx: number;      // categorised spending tx whose merchant key carries >1 category
  activeRules: number;
}

export interface Plan {
  audits: RuleAudit[];
  newRules: Array<{ merchantKey: string; categoryId: number; fromRuleIds: number[] }>;
  txDecisions: TxDecision[];
  newlyCategorised: Array<{ txId: number; categoryId: number; merchantKey: string }>;
  before: Metrics;
  after: Metrics;
}

const CARD_OR_DATE = /card number|date/;

/**
 * The phrase the pre-fix auto-rule builder derived from a description (first two words after
 * stripping bank codes and long digit runs). Used only to find which transaction a legacy rule
 * was created from — never for matching.
 */
export function legacyPhrase(description: string): string {
  const words = description
    .replace(/\b(DEB|CR|POS|DD|SO|BGC|FPI|FPO|ATM|TFR|VIS)\b/gi, '')
    .replace(/\d{6,}/g, '')
    .replace(/[^a-zA-Z0-9&\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(w => w.length > 1);
  return words.slice(0, 2).join(' ') || description.slice(0, 20);
}

function clean(key: ReturnType<typeof merchantIdentity>): string | null {
  return key.key && !key.wrapperOnly ? key.key : null;
}

export function planMigration(
  rules: PlanRule[],
  txs: PlanTx[],
  opts: { uncategorisedId?: number | null } = {},
): Plan {
  const unusable = new Set([opts.uncategorisedId ?? -1]);
  const candidates = txs.filter(t => t.is_transfer === 0);
  const keyOf = new Map<number, ReturnType<typeof merchantIdentity>>();
  for (const t of txs) keyOf.set(t.id, merchantIdentity(t.description, t.merchant));

  const unsafe = rules.filter(r => unsafeRuleReason(r) !== null);
  const unsafeIds = new Set(unsafe.map(r => r.id));

  // Transactions touched by any unsafe rule. Their categories are not independent evidence.
  const tainted = new Set<number>();
  const matchesByRule = new Map<number, PlanTx[]>();
  for (const r of rules) {
    const m = candidates.filter(t => ruleMatches(r, t));
    matchesByRule.set(r.id, m);
    // Every categorised match of an unsafe rule may be collateral from the current OR an earlier
    // category of that rule (each re-click rewrote the rule and swept the remaining blanks).
    if (unsafeIds.has(r.id)) for (const t of m) if (t.category_id !== null) tainted.add(t.id);
  }

  // Independent merchant evidence: categories on untainted, categorised transactions.
  const evidence = new Map<string, Map<number, number>>();
  for (const t of candidates) {
    const k = clean(keyOf.get(t.id)!);
    if (!k || t.category_id === null || unusable.has(t.category_id) || tainted.has(t.id)) continue;
    const m = evidence.get(k) ?? new Map<number, number>();
    m.set(t.category_id, (m.get(t.category_id) ?? 0) + 1);
    evidence.set(k, m);
  }
  const evidenceSays = (k: string): number | 'mixed' | null => {
    const m = evidence.get(k);
    if (!m || m.size === 0) return null;
    return m.size === 1 ? [...m.keys()][0] : 'mixed';
  };

  // ---- Audit every rule ----
  const audits: RuleAudit[] = rules.map(r => {
    const m = matchesByRule.get(r.id)!;
    const attributed = m.filter(t => t.category_id === r.category_id);
    const conflicting = m.filter(t => t.category_id !== null && t.category_id !== r.category_id).length;
    const keys = [...new Set(attributed.map(t => keyOf.get(t.id)!.key ?? '(none)'))];
    const reason = unsafeRuleReason(r);
    let type: RuleType;
    if (reason && CARD_OR_DATE.test(reason)) type = 'card_date_accidental';
    else if (reason) type = 'ambiguous';
    else if (m.length === 1) type = 'transaction_specific';
    else if (keys.length <= 1) type = 'reusable_merchant';
    else type = 'reusable_merchant_context';
    const confidence: RuleAudit['confidence'] =
      reason ? 'low' : conflicting === 0 && keys.length <= 1 ? 'high' : conflicting === 0 ? 'medium' : 'low';
    return { rule: r, type, unsafeReason: reason, matches: m.length, attributed: attributed.length, conflicting, merchantKeys: keys, confidence };
  });

  // ---- Decide migrations for unsafe rules ----
  const proposed = new Map<string, { categoryId: number; fromRuleIds: number[] }>();
  const contested = new Set<string>();
  const txDecisions: TxDecision[] = [];

  for (const a of audits) {
    if (!a.unsafeReason) continue;
    const r = a.rule;
    const attributed = matchesByRule.get(r.id)!.filter(t => t.category_id === r.category_id);
    if (attributed.length === 0) {
      a.migration = { state: 'retire', reason: a.matches === 0 ? 'matches no transactions' : 'no transactions carry its category any more' };
      continue;
    }
    const keys = [...new Set(attributed.map(t => clean(keyOf.get(t.id)!)))];
    // The merchant the rule was built from: attributed rows whose legacy phrase IS the rule value.
    // For card+date rules every row shares the phrase, so this only resolves non-date rules.
    const originKeys = [...new Set(attributed
      .filter(t => legacyPhrase(t.description).toLowerCase() === r.match_value.toLowerCase())
      .map(t => clean(keyOf.get(t.id)!)))];
    let single = keys.length === 1 && keys[0] !== null ? keys[0] : null;
    if (!single && originKeys.length === 1 && originKeys[0] !== null && a.type !== 'card_date_accidental') {
      single = originKeys[0];
      const rest = attributed.filter(t => clean(keyOf.get(t.id)!) !== single);
      attributed.splice(0, attributed.length, ...attributed.filter(t => clean(keyOf.get(t.id)!) === single));
      pushClusterDecisions(r, rest, false);
    }

    if (single) {
      const ev = evidenceSays(single);
      if (ev === null || ev === r.category_id) {
        a.migration = {
          state: 'safe_to_convert',
          reason: attributed.length === 1
            ? 'single transaction (the original click); merchant is clear'
            : `all ${attributed.length} matches attributed to the rule's origin merchant`,
          merchantKey: single,
          categoryId: r.category_id,
        };
        const p = proposed.get(single);
        if (p && p.categoryId !== r.category_id) contested.add(single);
        else proposed.set(single, { categoryId: r.category_id, fromRuleIds: [...(p?.fromRuleIds ?? []), r.id] });
      } else {
        a.migration = { state: 'needs_confirmation', reason: `other ${single} transactions are categorised differently`, merchantKey: single };
      }
      for (const t of attributed) {
        txDecisions.push({ txId: t.id, ruleId: r.id, from: r.category_id, to: r.category_id, outcome: 'keep', reason: 'decision is unambiguous' });
      }
      continue;
    }

    if (attributed.length === 1) {
      a.migration = { state: 'transaction_specific', reason: 'single transaction with no reusable merchant (e.g. Zilch instalment)' };
      txDecisions.push({ txId: attributed[0].id, ruleId: r.id, from: r.category_id, to: r.category_id, outcome: 'keep', reason: 'the original click' });
      continue;
    }

    a.migration = {
      state: 'needs_confirmation',
      reason: keys.every(k => k === null)
        ? 'only wrapper lines (e.g. Zilch instalments) with no underlying merchant'
        : `matched ${keys.length} different merchants — can't tell which one was the real decision`,
    };
    pushClusterDecisions(r, attributed, false);
  }

  // Older categories left behind in a cluster by earlier states of the same rule. Each distinct
  // category came from at least one click: a group of one transaction, or of one merchant, is
  // that click. Larger mixed groups are unproven unless independent history agrees.
  for (const a of audits) {
    if (!a.unsafeReason) continue;
    const r = a.rule;
    const older = new Map<number, PlanTx[]>();
    for (const t of matchesByRule.get(r.id)!) {
      if (t.category_id === null || t.category_id === r.category_id) continue;
      older.set(t.category_id, [...(older.get(t.category_id) ?? []), t]);
    }
    for (const group of older.values()) pushClusterDecisions(r, group);
  }

  /** `canBeClick` is false for rows that got the rule's category by sweep, not by a click. */
  function pushClusterDecisions(r: PlanRule, group: PlanTx[], canBeClick = true) {
    const keys = new Set(group.map(t => clean(keyOf.get(t.id)!)));
    const proven = canBeClick && (group.length === 1 || (keys.size === 1 && !keys.has(null)));
    for (const t of group) {
      const from = t.category_id!;
      if (proven) {
        txDecisions.push({ txId: t.id, ruleId: r.id, from, to: from, outcome: 'keep', reason: group.length === 1 ? 'the click that set this category' : 'every transaction in the group is the same merchant' });
        continue;
      }
      const k = clean(keyOf.get(t.id)!);
      const ev = k ? evidenceSays(k) : null;
      if (ev === from) {
        txDecisions.push({ txId: t.id, ruleId: r.id, from, to: from, outcome: 'keep', reason: 'independent history for this merchant agrees' });
      } else {
        txDecisions.push({ txId: t.id, ruleId: r.id, from, to: null, outcome: 'uncategorise_unproven', reason: k ? (ev === null ? 'no independent history' : 'independent history disagrees') : 'no merchant identity' });
      }
    }
  }

  // A merchant proposed with two different categories is not safe.
  for (const k of contested) proposed.delete(k);
  for (const a of audits) {
    if (a.migration?.state === 'safe_to_convert' && contested.has(a.migration.merchantKey!)) {
      a.migration = { state: 'needs_confirmation', reason: `rules disagree on the category for ${a.migration.merchantKey}`, merchantKey: a.migration.merchantKey };
    }
  }

  // Unproven tx that a migrated merchant rule covers: that rule's category wins.
  for (const d of txDecisions) {
    if (d.outcome !== 'uncategorise_unproven') continue;
    const k = clean(keyOf.get(d.txId)!);
    const p = k ? proposed.get(k) : undefined;
    if (p) { d.to = p.categoryId; d.outcome = p.categoryId === d.from ? 'keep' : 'change'; d.reason = `migrated merchant rule for ${k}`; }
  }

  // A tx swept by two unsafe rules (e.g. "27MAR" and "1717 27MAR26") gets one decision:
  // any proven 'keep' beats an unproven removal.
  const byTx = new Map<number, TxDecision>();
  for (const d of txDecisions) {
    const prev = byTx.get(d.txId);
    if (!prev || (prev.outcome === 'uncategorise_unproven' && d.outcome !== 'uncategorise_unproven')) byTx.set(d.txId, d);
  }
  txDecisions.length = 0;
  txDecisions.push(...byTx.values());

  const newRules = [...proposed.entries()].map(([merchantKey, v]) => ({ merchantKey, ...v }));

  // ---- Simulate after-state ----
  const after = new Map<number, number | null>(txs.map(t => [t.id, t.category_id]));
  for (const d of txDecisions) after.set(d.txId, d.to);

  const keptRules = rules.filter(r => !unsafeIds.has(r.id));
  const simRules: PlanRule[] = orderRules([
    ...keptRules,
    ...newRules.map((n, i) => ({ id: 1e9 + i, name: `Merchant: ${n.merchantKey}`, match_field: 'merchant_key', match_type: 'equals', match_value: n.merchantKey, category_id: n.categoryId, priority: 100 })),
  ]);
  const newlyCategorised: Plan['newlyCategorised'] = [];
  for (const t of candidates) {
    if (t.category_id !== null) continue;                 // only fill blanks that were already blank
    const r = simRules.find(r => r.match_field === 'merchant_key' && ruleMatches(r, t));
    if (r) { after.set(t.id, r.category_id); newlyCategorised.push({ txId: t.id, categoryId: r.category_id, merchantKey: r.match_value }); }
  }

  const metrics = (cat: (t: PlanTx) => number | null, activeRules: number): Metrics => {
    const spend = txs.filter(t => t.is_transfer === 0 && t.amount < 0);
    const usable = spend.filter(t => { const c = cat(t); return c !== null && !unusable.has(c); });
    const byKey = new Map<string, Set<number>>();
    for (const t of usable) {
      const k = clean(keyOf.get(t.id)!);
      if (!k) continue;
      (byKey.get(k) ?? byKey.set(k, new Set()).get(k)!).add(cat(t)!);
    }
    const conflictingTx = usable.filter(t => { const k = clean(keyOf.get(t.id)!); return k && byKey.get(k)!.size > 1; }).length;
    return {
      spendingTx: spend.length,
      spendingPence: spend.reduce((s, t) => s - t.amount, 0),
      usableTx: usable.length,
      usablePence: usable.reduce((s, t) => s - t.amount, 0),
      conflictingTx,
      activeRules,
    };
  };

  return {
    audits,
    newRules,
    txDecisions,
    newlyCategorised,
    before: metrics(t => t.category_id, rules.length),
    after: metrics(t => after.get(t.id) ?? null, keptRules.length + newRules.length),
  };
}
