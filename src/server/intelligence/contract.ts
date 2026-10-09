/**
 * Build 26 — the outbound finance intelligence contract, `finance-intelligence-v1`.
 *
 * This is what another system (NEURO) may read. It is built FROM compose() — never a second
 * calculation — and shaped for privacy and stability:
 *   • no raw transaction lists, ever;
 *   • nothing that identifies a merchant, payee or single payment on someone else's own account
 *     (Helen's): her account appears in totals and counts, and by name in feed health only;
 *   • every section carries the same `meta` block: period, source, freshness (of the data) and
 *     confidence (of the calculation) as SEPARATE fields, an explanation, and its data coverage;
 *   • the consumer depends on this shape, never on Tally's tables. A breaking change is v2.
 */
import type { Intelligence } from './compose.js';
import type { Owner } from './ledger.js';
import { pounds } from './util.js';

export const CONTRACT = 'finance-intelligence-v1';

type Meta = { period: string | null; source: 'tally'; freshness: { state: string; asOf: string | null; why: string }; confidence: string; explanation: string[]; coverage: string };
const isPrivate = (o: Owner | null | undefined) => o === 'private';

export function toContract(intel: Intelligence) {
  const h = intel.health;
  const asOf = h.bankFeed.accounts.map((a) => a.lastRefreshAt).filter(Boolean).sort().slice(-1)[0] ?? null;
  const freshness = { state: h.bankFeed.household, asOf,
    why: h.bankFeed.household === 'healthy' ? 'every bank feed refreshed in the last 2 days' : h.bankFeed.accounts.filter((a) => a.state !== 'healthy').map((a) => `${a.name}: ${a.why}`).join('; ') || h.bankFeed.household };
  const meta = (m: Partial<Meta> & { confidence: string; explanation: string[]; coverage: string }): Meta => ({ period: null, source: 'tally', freshness, ...m });
  const privateNames = [...new Set(intel.balances.filter((b) => isPrivate(b.owner)).map((b) => `${b.ownerName}'s account`))];
  const privateIds = new Set(intel.balances.filter((b) => isPrivate(b.owner)).map((b) => b.accountId));
  const priv = (label: string, owner: Owner | null | undefined, account?: string) => (isPrivate(owner) ? `A payment on ${account ? `the ${account} account` : 'another person\'s own account'}` : label);

  const cf = intel.cashflow;
  const shapeItems = (items: typeof cf.horizons[number]['items']) => {
    const shown = items.filter((i) => !isPrivate(i.owner)).map((i) => ({ date: i.date, direction: i.direction, pence: i.pence, lowPence: i.lowPence, highPence: i.highPence, label: i.label, kind: (i as { kind?: string }).kind ?? i.source, variable: i.variable, late: i.late, cadence: i.cadence ?? null, category: i.category ?? null, seriesKey: i.seriesKey ?? null, plannedId: i.plannedId ?? null }));
    const hidden = items.filter((i) => isPrivate(i.owner));
    return { items: shown, privateAccounts: hidden.length ? { count: hidden.length, inPence: hidden.filter((i) => i.direction === 'in').reduce((a, i) => a + i.pence, 0), outPence: hidden.filter((i) => i.direction === 'out').reduce((a, i) => a + i.pence, 0), note: 'payments on another person\'s own account: totals only' } : null };
  };
  const horizon = (x: typeof cf.horizons[number]) => ({ label: x.label, days: x.days, through: x.through, openingPence: x.openingPence, moneyInPence: x.moneyInPence, moneyOutPence: x.moneyOutPence,
    projectedPence: x.projectedPence, projectedRange: x.projectedRange, lowestPoint: x.lowestPoint, dayToDayNotProjectedPence: x.dayToDayNotProjectedPence, ...shapeItems(x.items) });

  const latestComplete = intel.monthly.filter((s) => s.complete).sort((a, b) => b.month.localeCompare(a.month))[0] ?? null;
  const ct = intel.categoryTrends;
  const priceHidden = intel.priceChanges.filter((p) => isPrivate(p.owner)).length;
  const unusualShown = intel.unusual.filter((u) => !isPrivate(u.owner) && !u.explainedBy && u.decision !== 'leave' && u.decision !== 'not_duplicate');
  const recurringShown = intel.recurring.filter((s) => !isPrivate(s.owner) && (s.state === 'strong_pattern' || s.state === 'explicit_recurring'));

  return {
    contract: CONTRACT, generatedAt: intel.generatedAt, today: intel.today,
    privacy: { privateAccounts: privateNames, rule: 'Accounts belonging to someone other than the primary user appear in totals, counts and feed health only — never a merchant, payee or single payment.' },

    sourceHealth: {
      meta: meta({ confidence: 'n/a', explanation: [h.bankFeed.rule, 'Each freshness below is separate: a quiet account is not a stale one, and a fresh feed says nothing about category coverage.'], coverage: `${h.bankFeed.accounts.length} accounts` }),
      bankFeed: { household: h.bankFeed.household, accounts: h.bankFeed.accounts.map((a) => ({ accountId: a.accountId, name: a.name, owner: a.owner, state: a.state, lastRefreshAt: a.lastRefreshAt, ageDays: a.ageDays, why: a.why })) },
      balances: h.balances, transactions: h.transactions.map((t) => ({ accountId: t.accountId, name: t.name, owner: t.owner, newest: t.newest, ageDays: t.ageDays, gaps: t.gaps, why: t.why })),
      categories: h.categories, recurrence: h.recurrence, forecast: h.forecast,
    },

    coverage: {
      meta: meta({ period: `${intel.source.dataFrom} – ${intel.source.dataThrough}`, confidence: 'n/a', explanation: ['Each account\'s data runs from its first transaction to the day before its last bank refresh; a suspected gap is a quiet stretch far longer than that account\'s usual rhythm.'], coverage: `${intel.source.transactionsRead} transactions` }),
      dataFrom: intel.source.dataFrom, dataThrough: intel.source.dataThrough, completeMonths: intel.monthly.filter((s) => s.complete).map((s) => s.month),
      accounts: intel.source.coverage.map((c) => ({ accountId: c.accountId, name: c.name, owner: c.owner, from: c.from, through: c.through, gaps: c.gaps })),
    },

    balances: {
      meta: meta({ period: intel.today, confidence: intel.position.coverage === 'complete' ? 'strong' : intel.position.coverage === 'partial' ? 'partial' : 'unavailable', explanation: [intel.position.statement, 'A balance is the bank\'s own figure at its last observation.'], coverage: intel.position.coverage }),
      household: { usableLiquidPence: intel.position.usableLiquidPence, includedAccounts: intel.position.includedAccounts, excluded: intel.position.excluded, coverage: intel.position.coverage, statement: intel.position.statement },
      accounts: intel.balances.map((b) => ({ accountId: b.accountId, name: b.name, owner: b.owner, role: b.role, balancePence: isPrivate(b.owner) ? null : b.balancePence,
        inHouseholdTotalOnly: isPrivate(b.owner), observedAt: b.observedAt, ageDays: b.ageDays, fresh: b.fresh, why: b.why })),
    },

    cashflow: {
      meta: meta({ period: cf.horizons.length ? `${intel.today} – ${cf.horizons[cf.horizons.length - 1].through}` : null, confidence: cf.confidence, explanation: [...cf.explanation, ...cf.confidenceWhy.map((w) => `Confidence: ${w}.`)], coverage: `${cf.includedAccounts.length} account(s) included, ${cf.excludedAccounts.length} excluded` }),
      confidence: cf.confidence, confidenceWhy: cf.confidenceWhy, openingPence: cf.openingPence, excludedAccounts: cf.excludedAccounts, excludedUnknowns: cf.excludedUnknowns,
      horizons: cf.horizons.map(horizon), toNextIncome: cf.toNextIncome ? horizon(cf.toNextIncome) : null,
      nextIncome: cf.nextIncome ? { date: cf.nextIncome.date, pence: cf.nextIncome.pence, label: priv(cf.nextIncome.label, cf.nextIncome.owner) } : null,
    },

    monthly: {
      meta: meta({ period: latestComplete ? latestComplete.month : null, confidence: latestComplete ? 'strong' : 'unavailable', explanation: ['Spending = card and other purchases plus fees, net of refunds. Transfers between the household\'s own accounts never count. Money out adds financing, card repayments and money leaving the household.', 'Only complete calendar months are compared.'], coverage: `${intel.monthly.filter((s) => s.complete).length} complete of ${intel.monthly.length} months` }),
      months: intel.monthly.map((s) => ({ month: s.month, complete: s.complete, coverageReasons: s.coverageReasons, spendPence: s.spendPence, incomePence: s.incomePence, moneyInPence: s.moneyInPence, moneyOutPence: s.moneyOutPence,
        netMovementPence: s.netMovementPence, recurringOutPence: s.recurringOutPence, discretionaryPence: s.discretionaryPence, discretionaryCoveragePct: s.discretionaryCoveragePct, refundsPence: s.refundsPence,
        transfersExcluded: s.transfersExcluded, categorisedPct: s.categorisedPct, owners: { primaryPence: s.owners.primaryPence, sharedPence: s.owners.sharedPence, othersOwnAccountsPence: s.owners.privatePence } })),
    },

    trends: {
      meta: meta({ period: intel.trends[0]?.current ? `${intel.trends[0].previous} → ${intel.trends[0].current}` : null, confidence: intel.trends[0]?.state === 'insufficient_data' ? 'unavailable' : 'strong', explanation: ['Thresholds: materially = ±15% and at least £100; slightly = ±5% and at least £25; otherwise broadly stable. Net movement is judged on the change in pounds only.'], coverage: 'complete months only' }),
      items: intel.trends,
    },

    categories: {
      meta: meta({ period: ct.current ? `${ct.previous} → ${ct.current}` : null, confidence: ct.available ? 'strong' : 'unavailable', explanation: [ct.available ? 'Category changes between the latest two complete months; material = ±15% and £50, slight = ±5% and £15; categories under £30 are left out.' : `No category trends: ${ct.why}.`], coverage: ct.coverage ? `${ct.coverage.previousPct}% → ${ct.coverage.currentPct}% of spending categorised` : 'n/a' }),
      available: ct.available, why: ct.why, latestMonth: latestComplete ? { month: latestComplete.month, byCategory: latestComplete.byCategory } : null,
      trends: ct.items.map((i) => ({ ...i, contributors: i.contributors.filter((c) => !c.private).map(({ merchantKey, deltaPence }) => ({ merchantKey, deltaPence })),
        otherAccountsChangePence: i.contributors.filter((c) => c.private).reduce((a, c) => a + c.deltaPence, 0) || null })),
    },

    recurring: {
      meta: meta({ period: intel.source.dataFrom ? `${intel.source.dataFrom} – ${intel.source.dataThrough}` : null, confidence: h.recurrence.state === 'good' ? 'strong' : h.recurrence.state === 'partial' ? 'partial' : 'weak', explanation: ['Established = marked recurring in Tally, or at least 3 payments on a regular cadence still being paid. Weak patterns are listed by count only and never forecast. Variable bills (direct debits whose amount moves) use the median of the last 3 and their range.'], coverage: h.recurrence.why }),
      counts: intel.recurringCounts,
      established: recurringShown.map((s) => ({ key: s.key, label: s.label, category: s.category, accountId: s.accountId, accountName: s.accountName, owner: s.owner, direction: s.direction, cadence: s.cadence, amountKind: s.amountKind,
        typicalPence: s.typicalPence, range: s.range, occurrences: s.occurrences, lastSeen: s.lastSeen, nextExpected: s.nextExpected, lateDays: s.lateDays, missed: s.missed, state: s.state, why: s.why })),
      privateAccounts: intel.recurring.filter((s) => isPrivate(s.owner) && (s.state === 'strong_pattern' || s.state === 'explicit_recurring')).length,
    },

    priceChanges: {
      meta: meta({ confidence: 'strong', explanation: ['A fixed recurring payment whose amount moved by at least £1 and 5%. The annual effect is given only when the cadence is known. Tally does not judge whether a change is worth it.'], coverage: `${intel.priceChanges.length} change(s)` }),
      items: intel.priceChanges.filter((p) => !isPrivate(p.owner)).map((p) => ({ seriesKey: p.seriesKey, label: p.label, cadence: p.cadence, category: p.category, fromPence: p.fromPence, toPence: p.toPence, changePence: p.changePence,
        changePct: p.changePct, annualEffectPence: p.annualEffectPence, firstObserved: p.firstObserved, seenTimes: p.seenTimes, confirmed: p.confirmed, line: p.line })),
      privateAccounts: priceHidden,
    },

    unusual: {
      meta: meta({ period: 'last 90 days', confidence: 'n/a', explanation: ['Unusual compared with your recorded history — never a judgement about why. Payments in an established series, annual and variable bills, and planned payments are expected, not unusual.'], coverage: h.categories.why }),
      items: unusualShown.map((u) => ({ key: u.key, kind: u.kind, date: u.date, amountPence: u.amountPence, merchantKey: u.merchantKey, category: u.category, line: u.line, decision: u.decision })),
      explained: intel.unusual.filter((u) => !isPrivate(u.owner) && u.explainedBy).length,
      privateAccounts: intel.unusual.filter((u) => isPrivate(u.owner)).length,
    },

    pressure: {
      meta: meta({ period: cf.horizons.find((x) => x.days === 30)?.through ? `${intel.today} – ${cf.horizons.find((x) => x.days === 30)!.through}` : null, confidence: cf.confidence, explanation: ['A read-only reading of how tight the next 30 days look from financial evidence alone. It is not advice and says nothing about what can or cannot be bought.', ...intel.pressure.why], coverage: `forward view ${cf.confidence}` }),
      state: intel.pressure.state, why: intel.pressure.why, basis: intel.pressure.basis,
    },

    upcoming: {
      meta: meta({ period: `${intel.today} – next 30 days (annual payments 90)`, confidence: cf.confidence, explanation: ['Dated money movements Tally knows: established recurring payments on their expected dates, planned payments recorded in Tally, and established annual payments up to 90 days ahead.'], coverage: `forward view ${cf.confidence}` }),
      ...shapeItems(intel.upcoming),
      planned: intel.planned.filter((p) => p.status === 'open' && !privateIds.has(Number(p.account_id))).map((p) => ({ id: p.id, title: p.title, kind: p.kind, dueDate: p.due_date, amountPence: p.amount })),
    },

    // Build 27 — added compatibly to v1: a new section, nothing existing changed. Totals and windows
    // only — never a transaction, merchant or payee. Car spend on someone else's own account is in
    // the totals and is never offered for review.
    vehicleFinance: (() => {
      const v = intel.vehicle;
      const anyCar = v.vehicles.length > 0;
      return {
        meta: meta({ period: intel.monthly.length ? `${intel.monthly[0].month} – ${intel.monthly[intel.monthly.length - 1].month}` : null,
          confidence: !anyCar ? 'unavailable' : v.review.pending ? 'partial' : 'strong',
          explanation: [
            'Vehicle spend is what a person said is the car\'s in Tally (Outlook → Motoring), or what a rule they confirmed matches. Tally calculates every figure here.',
            `Buckets: fuel; insurance; finance repayments; maintenance (service, MOT, tyres); repairs; tax; breakdown cover; other motoring (warranty, parking, anything else).`,
            v.review.pending ? `${v.review.pending} transaction${v.review.pending === 1 ? '' : 's'} might be the car's and ${v.review.pending === 1 ? 'is' : 'are'} not yet reviewed — months that contain one are partial.` : 'Nothing is waiting for review.',
          ],
          coverage: anyCar ? `${v.vehicles.reduce((a, x) => a + x.classified.transactions, 0)} car transactions classified` : 'nothing classified as the car\'s yet' }),
        reviewIn: 'Tally → Outlook → Motoring',
        vehicles: v.vehicles.map((x) => ({
          vehicleRef: x.vehicleRef, confidence: x.confidence, explanation: x.explanation, classified: x.classified,
          currentMonth: x.currentMonth, latestCompleteMonth: x.latestCompleteMonth, months: x.months,
          last3CompleteMonths: x.last3CompleteMonths, last6CompleteMonths: x.last6CompleteMonths, rolling12m: x.rolling12m, trend: x.trend,
        })),
        review: v.review, rules: v.rules,
      };
    })(),
  };
}
export type FinanceIntelligenceV1 = ReturnType<typeof toContract>;
export const line = (p: number) => pounds(p);
