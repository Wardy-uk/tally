import { merchantIdentity } from './merchant.js';

/**
 * Categorisation rules must key on stable evidence about what a transaction is.
 * Dates, card numbers, amounts and very short substrings are incidental and get rejected —
 * both when a rule is created and (defensively) when legacy rules are evaluated.
 */

export type MatchField = 'merchant_key' | 'description' | 'merchant' | 'amount';
export type MatchType = 'equals' | 'contains' | 'regex' | 'startsWith';

export interface RuleLike {
  id: number;
  match_field: MatchField | string;
  match_type: MatchType | string;
  match_value: string;
  category_id: number;
  priority: number;
}

export interface TxLite {
  id: number;
  description: string;
  merchant: string | null;
  amount: number;
}

const CARD_DATE = /\b\d{4}\s+\d{2}[A-Z]{3}\d{2}\b/i;
const DATE_ONLY = /\b\d{1,2}[A-Z]{3}(\d{2,4})?\b|\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/i;
const MIN_SUBSTRING = 4;
// Wrappers / generic words that say nothing about the purchase on their own.
const TOO_GENERIC = new Set(['ZILCH', 'CARD', 'PAYMENT', 'CARD PAYMENT', 'GENERAL', 'LTD', 'LIMITED', 'GB', 'UK']);

/** Why a rule is unsafe to reuse, or null when it's acceptable. */
export function unsafeRuleReason(r: Pick<RuleLike, 'match_field' | 'match_type' | 'match_value'>): string | null {
  const v = (r.match_value ?? '').trim();
  if (!v) return 'empty match value';
  if (r.match_field === 'amount') return 'amount-only rules are not stable evidence';
  if (CARD_DATE.test(v)) return 'keys on card number + date';
  if (DATE_ONLY.test(v)) return 'keys on a date';
  if (/^[\d\s.,£-]+$/.test(v)) return 'keys on a number only';
  if (TOO_GENERIC.has(v.toUpperCase())) return 'too generic to identify a merchant';
  if (r.match_field === 'merchant_key') {
    if (r.match_type !== 'equals') return 'merchant rules must match exactly';
    return null;
  }
  if ((r.match_type === 'contains' || r.match_type === 'startsWith') && v.replace(/\s/g, '').length < MIN_SUBSTRING) {
    return `substring shorter than ${MIN_SUBSTRING} characters`;
  }
  return null;
}

export function ruleMatches(rule: RuleLike, tx: TxLite): boolean {
  if (rule.match_field === 'merchant_key') {
    const id = merchantIdentity(tx.description, tx.merchant);
    return id.key !== null && id.key === rule.match_value.toUpperCase();
  }
  const haystack = (() => {
    if (rule.match_field === 'description') return tx.description;
    if (rule.match_field === 'merchant') return tx.merchant ?? tx.description;
    return '';
  })().toLowerCase();
  const needle = rule.match_value.toLowerCase();

  switch (rule.match_type) {
    case 'contains':   return haystack.includes(needle);
    case 'equals':     return haystack === needle;
    case 'startsWith': return haystack.startsWith(needle);
    case 'regex':
      try { return new RegExp(rule.match_value, 'i').test(haystack); }
      catch { return false; }
  }
  return false;
}

/** Usable rules in evaluation order: priority, then exact merchant rules before text rules. */
export function orderRules<R extends RuleLike>(rules: R[]): R[] {
  return rules
    .filter(r => unsafeRuleReason(r) === null)
    .sort((a, b) =>
      b.priority - a.priority
      || Number(b.match_field === 'merchant_key') - Number(a.match_field === 'merchant_key')
      || a.id - b.id);
}

/** First matching rule for a transaction (rules must already be ordered). */
export function findRuleForTx<R extends RuleLike>(tx: TxLite, ordered: R[]): R | null {
  for (const r of ordered) if (ruleMatches(r, tx)) return r;
  return null;
}
