/**
 * Build 26 — every threshold the finance intelligence uses, stated ONCE, each
 * with what it is for. Changing one is a decision about how Tally reads money;
 * the tests pin the boundaries either side of each.
 */
export const T = Object.freeze({
  // ── ledger ──────────────────────────────────────────────────────────────
  PENDING_WINDOW_DAYS: 4,          // a settled copy arrives within days of its pending one
  REFUND_LOOKBACK_DAYS: 90,        // a refund/reversal matches a spend at most this far back
  REVERSAL_DAYS: 7,                // an exact-amount credit within a week is a reversal, not a refund
  TRANSFER_PAIRED_MIN: 3,          // a counterparty Tally paired as a transfer this often…
  TRANSFER_PAIRED_SHARE: 0.6,      // …and this share of the time is a transfer counterparty
  // An account with a quiet stretch longer than max(GAP_MIN_DAYS, GAP_RATE_MULT × its median
  // gap between transaction days) is treated as a SUSPECTED DATA GAP (a dead feed), not a quiet
  // spell. Busy accounts (Joint: ~4 a day) are judged hard; sparse ones (Nick's) generously.
  GAP_MIN_DAYS: 10,
  GAP_RATE_MULT: 8,
  GAP_MIN_ROWS: 60,                // below this an account is too sparse to judge gaps at all
  GAP_P90_MULT: 1.5,               // …and never shorter than 1.5× the account's own 90th-percentile quiet spell

  // ── freshness ───────────────────────────────────────────────────────────
  FEED_FRESH_DAYS: 2,              // a bank feed that refreshed in 2 days is live
  RECONNECT_AFTER_DAYS: 3,         // no refresh for 3 days and an expired link = needs re-approving
  BALANCE_FRESH_DAYS: 2,           // a balance observed in 2 days is usable for a forecast

  // ── recurrence ──────────────────────────────────────────────────────────
  RECUR_AMOUNT_TOLERANCE: 0.10,    // occurrences of one FIXED series sit within 10% of each other
  RECUR_STRONG_MIN: 3,             // at least 3 occurrences before a pattern is established
  RECUR_PRICE_STEP: 0.5,           // a later cluster up to 50% away continues the series as a price change
  RECUR_LATE_GRACE_DAYS: 5,        // an expected payment up to 5 days late is still expected imminently
  VARIABLE_MAX_RATIO: 3,           // a variable bill's largest of the last 6 is at most 3× its smallest
  VARIABLE_LAST_N: 6,              // the range of a variable bill is read over its last 6 payments
  VARIABLE_TYPICAL_N: 3,           // its typical amount is the median of its last 3
  PRICE_CHANGE_MIN_PENCE: 100,     // a price change is at least £1…
  PRICE_CHANGE_MIN_RATIO: 0.05,    // …and at least 5%

  // ── trends (applied to complete calendar months only) ──────────────────
  TREND_MATERIAL_RATIO: 0.15,      // ±15% …
  TREND_MATERIAL_PENCE: 10000,     // … and at least £100 → materially up/down
  TREND_SLIGHT_RATIO: 0.05,        // ±5% …
  TREND_SLIGHT_PENCE: 2500,        // … and at least £25 → slightly up/down; otherwise broadly stable
  CATEGORY_MATERIAL_PENCE: 5000,   // category trends: material needs £50 and 15%
  CATEGORY_SLIGHT_PENCE: 1500,     // slight needs £15 and 5%
  CATEGORY_MIN_PENCE: 3000,        // a category needs £30 in one of the two months to be compared
  CATEGORY_COVERAGE_MIN: 0.70,     // ≥70% of spending (by value) must carry a usable category in BOTH months

  // ── unusual spend ───────────────────────────────────────────────────────
  UNUSUAL_MERCHANT_MULT: 3,        // ≥3× the merchant's median…
  UNUSUAL_MIN_PENCE: 4000,         // …and ≥£40
  UNUSUAL_HISTORY_MIN: 3,          // over at least 3 earlier payments to it
  UNUSUAL_CATEGORY_MULT: 4,        // ≥4× the category's median…
  UNUSUAL_CATEGORY_MIN_PENCE: 10000, // …and ≥£100
  UNUSUAL_CATEGORY_HISTORY_MIN: 10,  // over at least 10 earlier payments in it
  UNUSUAL_NEW_MIN_PENCE: 15000,    // a first-ever merchant is listed only at ≥£150…
  NEW_MERCHANT_WARMUP_DAYS: 30,    // …and never in the first month of data, when everything is new
  UNUSUAL_RECUR_RATIO: 0.25,       // a fixed recurring payment ≥25% off its usual amount
  FREQUENCY_WINDOW_DAYS: 30,       // frequency: payments to one merchant in the last 30 days…
  FREQUENCY_MULT: 3,               // …at least 3× its usual monthly count…
  FREQUENCY_MIN: 5,                // …and at least 5 of them
  DUPLICATE_WINDOW_DAYS: 2,        // a possible duplicate: same account/merchant/amount within 2 days
  UNUSUAL_LOOKBACK_DAYS: 90,       // only the last 90 days are listed

  // ── cashflow / confidence / pressure ───────────────────────────────────
  HORIZONS: [7, 14, 30] as const,
  RECUR_COVERAGE_STRONG: 0.8,      // ≥80% of last complete month's non-card money out is recognised recurring
  RECUR_COVERAGE_PARTIAL: 0.5,     // ≥50% partial, below that weak
  PRESSURE_STRETCHED_SHARE: 0.25,  // stretched: the next 30 days' low is worse than the usual low by ≥25% of a usual month's money out
  PRESSURE_TIGHT_SHARE: 0.10,      // tighter than usual: worse by ≥10%…
  PRESSURE_SPEND_UP_RATIO: 1.15,   // …or the latest complete month spent ≥115% of the median of the 3 before
  CATEGORY_GOOD: 0.85,             // category coverage: good ≥85%, partial ≥60%, poor below
  CATEGORY_PARTIAL: 0.6,
});

/** Tally categories that are spending you choose day to day. Only used when the category is set. */
export const DISCRETIONARY = new Set(['eating out', 'entertainment', 'shopping', 'holidays', 'gifts']);
/** Categories that carry no classification. */
export const UNUSABLE_CATEGORIES = new Set(['uncategorised', '']);
