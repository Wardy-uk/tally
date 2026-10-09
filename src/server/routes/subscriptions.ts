import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { db } from '../db/schema.js';
import { current, dropCache } from './intelligence.js';
import { PERIODS_PER_YEAR } from '../intelligence/recurring.js';

/**
 * Subscriptions = the outgoing recurring payments, answered by the Build 26 intelligence engine so this
 * page, the MCP tool and Outlook can never disagree about what recurs. The response keeps its old shape
 * (merchant, typical_amount in signed pence, cadence, last_seen, next_expected, ignored); `id` is now the
 * series key, and hiding one is the "not recurring" decision Outlook uses. The old recurring_charges table
 * is no longer read.
 */
export function createSubscriptionsRoutes() {
  const router = Router();

  router.get('/', requireAuth, (_req, res) => {
    const rows = current().recurring
      .filter((s) => s.direction === 'out' && (s.state === 'strong_pattern' || s.state === 'explicit_recurring' || s.state === 'not_recurring'))
      .map((s) => ({ id: s.key, merchant: s.label, typical_amount: -s.typicalPence, cadence: s.cadence, last_seen: s.lastSeen, next_expected: s.nextExpected,
        ignored: s.state === 'not_recurring' ? 1 : 0,
        monthly_equivalent: s.cadence ? -Math.round((s.typicalPence * PERIODS_PER_YEAR[s.cadence]) / 12) : null, amount_kind: s.amountKind, range: s.range, account: s.accountName }))
      .sort((a, b) => a.ignored - b.ignored || a.typical_amount - b.typical_amount);
    res.json({ ok: true, data: rows });
  });

  router.post('/refresh', requireAuth, (_req, res) => {
    dropCache();
    res.json({ ok: true, data: { detected: current().recurring.filter((s) => s.direction === 'out' && s.state === 'strong_pattern').length } });
  });

  router.patch('/:id', requireAuth, (req, res) => {
    const key = String(req.params.id);
    if (String(req.user?.username ?? '').toLowerCase() === 'tally-api') return res.status(403).json({ ok: false, error: 'Finance decisions are made in Tally by a person, not by a connected system.' });
    const s = current().recurring.find((x) => x.key === key);
    if (!s) return res.status(404).json({ ok: false, error: 'no such recurring payment' });
    const { ignored } = req.body ?? {};
    if (ignored) db.prepare(`INSERT INTO recurring_decisions (series_key, decision, label, decided_by_user_id) VALUES (?, 'not_recurring', ?, ?)
                             ON CONFLICT(series_key) DO UPDATE SET decision = 'not_recurring', decided_at = datetime('now')`).run(key, s.label, req.user!.id);
    else db.prepare(`DELETE FROM recurring_decisions WHERE series_key = ? AND decision = 'not_recurring'`).run(key);
    dropCache();
    res.json({ ok: true, data: { id: key, ignored: !!ignored } });
  });

  return router;
}
