/**
 * Build 26 — /api/intelligence: what is happening financially, what is changing, what is likely next,
 * and what is unusual. Read-only over money: nothing here moves, pays or edits a transaction.
 *
 *   GET  /                      the full intelligence (Tally's Outlook page)
 *   GET  /contract              finance-intelligence-v1, privacy-shaped for other systems (NEURO)
 *   POST /recurring/:key        a person says a series is / is not recurring (or clears it)
 *   POST /unusual/:key          a person answers an unusual or possible-duplicate item
 *   GET|POST /planned, PATCH /planned/:id   known future payments
 *   GET  /vehicle/review        Build 27: transactions that might be the car's (a person's confirmation list)
 *   POST /vehicle/decide/:id    a person says a transaction is / is not the car's
 *   POST /vehicle/rules, POST /vehicle/rules/:id/retire   reusable car-spend rules a person confirms
 *
 * Writes are refused for service accounts (TALLY_SERVICE_USERS, default "tally-api"): a finance decision
 * is made in Tally by a person, never by another system on their behalf.
 */
import { Router, type Request, type Response, type NextFunction } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { db } from '../db/schema.js';
import { readIntel } from '../intelligence/reader.js';
import { compose } from '../intelligence/compose.js';
import { toContract } from '../intelligence/contract.js';
import { londonToday } from '../intelligence/util.js';
import { DECISIONS, SPEND_TYPES, SPEND_LABELS, reviewGroups, ruleMatches, validateRule, type SpendType, type VehicleRule } from '../intelligence/vehicle.js';

const serviceUsers = () => new Set(String(process.env.TALLY_SERVICE_USERS ?? 'tally-api').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
function personOnly(req: Request, res: Response, next: NextFunction) {
  if (serviceUsers().has(String(req.user?.username ?? '').toLowerCase())) {
    return res.status(403).json({ ok: false, error: 'Finance decisions are made in Tally by a person, not by a connected system.' });
  }
  next();
}
const audit = (req: Request, action: string, target: string, meta: unknown) =>
  db.prepare(`INSERT INTO audit_log (user_id, action, target, meta) VALUES (?, ?, ?, ?)`).run(req.user?.id ?? null, action, target, JSON.stringify(meta));

// Composing costs about a second on the Pi 4, and nothing changes between bank syncs, so the result is
// reused while the database signature (rows, categories, balances, syncs, decisions, planned) and the day
// are unchanged. Any write here drops it.
let cache: { sig: string; value: ReturnType<typeof compose> } | null = null;
function signature(today: string): string {
  const r = db.prepare(`SELECT
      (SELECT COUNT(*) || ':' || COALESCE(MAX(id), 0) || ':' || COALESCE(SUM(COALESCE(category_id, 0)), 0) || ':' || COALESCE(SUM(is_transfer), 0) FROM transactions) AS t,
      (SELECT COALESCE(MAX(balance_observed_at), '') || ':' || COALESCE(SUM(opening_balance), 0) FROM accounts) AS a,
      (SELECT COALESCE(MAX(last_sync_at), '') FROM truelayer_accounts) AS s,
      (SELECT COUNT(*) || ':' || COALESCE(MAX(decided_at), '') FROM recurring_decisions) AS rd,
      (SELECT COUNT(*) || ':' || COALESCE(MAX(decided_at), '') FROM unusual_decisions) AS ud,
      (SELECT COUNT(*) || ':' || COALESCE(MAX(updated_at), '') FROM planned_payments) AS pp,
      (SELECT COUNT(*) || ':' || COALESCE(MAX(decided_at), '') || ':' || COALESCE(SUM(LENGTH(decision) + LENGTH(COALESCE(spend_type, '')) + transaction_id), 0) FROM vehicle_spend_decisions) AS vd,
      (SELECT COUNT(*) || ':' || COALESCE(SUM(active), 0) || ':' || COALESCE(MAX(id), 0) FROM vehicle_spend_rules) AS vr`).get() as Record<string, string>;
  return `${today}|${r.t}|${r.a}|${r.s}|${r.rd}|${r.ud}|${r.pp}|${r.vd}|${r.vr}`;
}
export function current(nowMs = Date.now()) {
  const today = londonToday(nowMs);
  const sig = signature(today);
  if (cache && cache.sig === sig) return cache.value;
  const value = compose(readIntel(), { now: nowMs, today });
  cache = { sig, value };
  return value;
}
export function dropCache() { cache = null; }

const KINDS = ['annual_bill', 'renewal', 'one_off', 'income'];
function validPlanned(b: any, partial = false): string | null {
  if (!partial || b.title !== undefined) if (!(typeof b.title === 'string' && b.title.trim().length >= 2)) return 'a title is needed';
  if (!partial || b.dueDate !== undefined) if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b.dueDate ?? ''))) return 'dueDate must be YYYY-MM-DD';
  if (!partial || b.amountPence !== undefined) if (!(Number.isInteger(b.amountPence) && b.amountPence !== 0)) return 'amountPence must be a non-zero whole number of pence (negative = money out)';
  if (b.kind !== undefined && !KINDS.includes(b.kind)) return `kind must be one of ${KINDS.join(', ')}`;
  if (b.accountId != null && !(db.prepare('SELECT id FROM accounts WHERE id = ?').get(Number(b.accountId)))) return 'no such account';
  if (b.status !== undefined && !['open', 'done', 'cancelled'].includes(b.status)) return 'status must be open, done or cancelled';
  return null;
}

export function createIntelligenceRoutes() {
  const router = Router();

  router.get('/', requireAuth, (_req, res) => {
    const { _rows, vehicle, ...intel } = current();
    const { _candidates, _car, ...v } = vehicle;
    res.json({ ok: true, data: { ...intel, vehicle: v } });
  });

  router.get('/contract', requireAuth, (_req, res) => {
    res.json({ ok: true, data: toContract(current()) });
  });

  router.post('/recurring/:key', requireAuth, personOnly, (req, res) => {
    const key = String(req.params.key);
    const { decision } = req.body ?? {};
    if (!['recurring', 'not_recurring', 'clear'].includes(decision)) return res.status(400).json({ ok: false, error: 'decision must be recurring, not_recurring or clear' });
    const s = current().recurring.find((x) => x.key === key);
    if (!s) return res.status(404).json({ ok: false, error: 'no such recurring series' });
    if (decision === 'clear') db.prepare('DELETE FROM recurring_decisions WHERE series_key = ?').run(key);
    else db.prepare(`INSERT INTO recurring_decisions (series_key, decision, label, decided_by_user_id) VALUES (?, ?, ?, ?)
                     ON CONFLICT(series_key) DO UPDATE SET decision = excluded.decision, label = excluded.label, decided_by_user_id = excluded.decided_by_user_id, decided_at = datetime('now')`).run(key, decision, s.label, req.user!.id);
    dropCache();
    audit(req, 'intelligence.recurring', key, { decision, label: s.label });
    res.json({ ok: true, data: { key, decision } });
  });

  router.post('/unusual/:key', requireAuth, personOnly, (req, res) => {
    const key = String(req.params.key);
    const { decision } = req.body ?? {};
    if (!['expected', 'not_duplicate', 'leave', 'clear'].includes(decision)) return res.status(400).json({ ok: false, error: 'decision must be expected, not_duplicate, leave or clear' });
    if (!current().unusual.some((u) => u.key === key)) return res.status(404).json({ ok: false, error: 'no such unusual item' });
    if (decision === 'clear') db.prepare('DELETE FROM unusual_decisions WHERE item_key = ?').run(key);
    else db.prepare(`INSERT INTO unusual_decisions (item_key, decision, decided_by_user_id) VALUES (?, ?, ?)
                     ON CONFLICT(item_key) DO UPDATE SET decision = excluded.decision, decided_by_user_id = excluded.decided_by_user_id, decided_at = datetime('now')`).run(key, decision, req.user!.id);
    dropCache();
    audit(req, 'intelligence.unusual', key, { decision });
    res.json({ ok: true, data: { key, decision } });
  });

  router.get('/planned', requireAuth, (_req, res) => {
    res.json({ ok: true, data: db.prepare('SELECT * FROM planned_payments ORDER BY due_date, id').all() });
  });

  router.post('/planned', requireAuth, personOnly, (req, res) => {
    const b = req.body ?? {};
    const bad = validPlanned(b);
    if (bad) return res.status(400).json({ ok: false, error: bad });
    const r = db.prepare(`INSERT INTO planned_payments (title, kind, due_date, amount, account_id, note, created_by_user_id) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(b.title.trim(), b.kind ?? (b.amountPence > 0 ? 'income' : 'one_off'), b.dueDate, b.amountPence, b.accountId ?? null, b.note ?? null, req.user!.id);
    dropCache();
    audit(req, 'intelligence.planned.create', String(r.lastInsertRowid), { title: b.title, dueDate: b.dueDate, amountPence: b.amountPence });
    res.json({ ok: true, data: db.prepare('SELECT * FROM planned_payments WHERE id = ?').get(Number(r.lastInsertRowid)) });
  });

  router.patch('/planned/:id', requireAuth, personOnly, (req, res) => {
    const id = Number(req.params.id);
    if (!db.prepare('SELECT id FROM planned_payments WHERE id = ?').get(id)) return res.status(404).json({ ok: false, error: 'no such planned payment' });
    const b = req.body ?? {};
    const bad = validPlanned(b, true);
    if (bad) return res.status(400).json({ ok: false, error: bad });
    const map: Record<string, string> = { title: 'title', kind: 'kind', dueDate: 'due_date', amountPence: 'amount', accountId: 'account_id', status: 'status', note: 'note' };
    const sets: string[] = []; const vals: unknown[] = [];
    for (const [k, col] of Object.entries(map)) if (b[k] !== undefined) { sets.push(`${col} = ?`); vals.push(k === 'title' ? String(b[k]).trim() : b[k]); }
    if (!sets.length) return res.status(400).json({ ok: false, error: 'nothing to change' });
    db.prepare(`UPDATE planned_payments SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = ?`).run(...(vals as any[]), id);
    dropCache();
    audit(req, 'intelligence.planned.update', String(id), b);
    res.json({ ok: true, data: db.prepare('SELECT * FROM planned_payments WHERE id = ?').get(id) });
  });

  // ── Build 27: which transactions are the car's ─────────────────────────────────────────────
  // The review list is the one place single car-candidate transactions are shown, and only to a
  // person — never to a connected system (the contract carries totals only).
  const knownVehicles = () => [...new Set((db.prepare(`SELECT vehicle_ref FROM vehicle_spend_decisions WHERE vehicle_ref IS NOT NULL
      UNION ALL SELECT vehicle_ref FROM vehicle_spend_rules WHERE vehicle_ref IS NOT NULL`).all() as Array<{ vehicle_ref: string }>).map((r) => r.vehicle_ref))];
  const rulesOut = () => (db.prepare('SELECT * FROM vehicle_spend_rules ORDER BY active DESC, id').all() as Array<Record<string, any>>);
  const VREF = /^vehicle:[a-z0-9-]{1,40}$/;

  router.get('/vehicle/review', requireAuth, personOnly, (_req, res) => {
    const v = current().vehicle;
    res.json({ ok: true, data: { groups: reviewGroups(v._candidates), review: v.review, vehicles: knownVehicles(), spendTypes: SPEND_TYPES.map((t) => ({ id: t, label: SPEND_LABELS[t] })),
      rules: rulesOut(), summary: v.vehicles.map((x) => ({ vehicleRef: x.vehicleRef, latestCompleteMonth: x.latestCompleteMonth, currentMonth: x.currentMonth, rolling12m: x.rolling12m, trend: x.trend })) } });
  });

  router.post('/vehicle/decide/:id', requireAuth, personOnly, (req, res) => {
    const id = Number(req.params.id);
    const { decision, spendType = null, vehicleRef = null } = req.body ?? {};
    if (!db.prepare('SELECT id FROM transactions WHERE id = ?').get(id)) return res.status(404).json({ ok: false, error: 'no such transaction' });
    if (decision !== 'clear' && !DECISIONS.includes(decision)) return res.status(400).json({ ok: false, error: `decision must be ${DECISIONS.join(', ')} or clear` });
    if (decision === 'vehicle' && !SPEND_TYPES.includes(spendType)) return res.status(400).json({ ok: false, error: `spendType must be one of ${SPEND_TYPES.join(', ')}` });
    if (vehicleRef != null && !VREF.test(String(vehicleRef))) return res.status(400).json({ ok: false, error: 'vehicleRef must look like vehicle:<name>' });
    if (decision === 'clear') db.prepare('DELETE FROM vehicle_spend_decisions WHERE transaction_id = ?').run(id);
    else db.prepare(`INSERT INTO vehicle_spend_decisions (transaction_id, decision, spend_type, vehicle_ref, basis, source, decided_by_user_id) VALUES (?, ?, ?, ?, 'confirmed-once', 'tally', ?)
                     ON CONFLICT(transaction_id) DO UPDATE SET decision = excluded.decision, spend_type = excluded.spend_type, vehicle_ref = excluded.vehicle_ref, basis = 'confirmed-once',
                       source = 'tally', decided_by_user_id = excluded.decided_by_user_id, decided_at = datetime('now')`)
      .run(id, decision, decision === 'vehicle' ? spendType : null, decision === 'vehicle' ? vehicleRef : null, req.user!.id);
    dropCache();
    audit(req, 'intelligence.vehicle.decide', String(id), { decision, spendType, vehicleRef });
    res.json({ ok: true, data: { id, decision } });
  });

  router.post('/vehicle/rules', requireAuth, personOnly, (req, res) => {
    const b = req.body ?? {};
    const bad = validateRule(b);
    if (bad) return res.status(400).json({ ok: false, error: bad });
    if (b.vehicleRef != null && !VREF.test(String(b.vehicleRef))) return res.status(400).json({ ok: false, error: 'vehicleRef must look like vehicle:<name>' });
    const merchantKey = b.matchKind === 'category' ? null : String(b.merchantKey).trim();
    const categoryName = b.matchKind === 'merchant' ? null : String(b.categoryName).trim();
    const same = rulesOut().find((r) => r.active && r.match_kind === b.matchKind && (r.merchant_key ?? null) === merchantKey && String(r.category_name ?? '').toLowerCase() === String(categoryName ?? '').toLowerCase());
    if (same) return res.json({ ok: true, data: { rule: same, already: true } });
    const rule: VehicleRule = { id: 0, matchKind: b.matchKind, merchantKey, categoryName, spendType: b.spendType as SpendType, vehicleRef: b.vehicleRef ?? null, active: true };
    const matches = current()._rows.filter((t) => t.amount < 0 && ruleMatches(rule, t)).length;
    const r = db.prepare(`INSERT INTO vehicle_spend_rules (match_kind, merchant_key, category_name, spend_type, vehicle_ref, source, note, created_by_user_id) VALUES (?, ?, ?, ?, ?, 'tally', ?, ?)`)
      .run(b.matchKind, merchantKey, categoryName, b.spendType, b.vehicleRef ?? null, `matched ${matches} transaction(s) when confirmed`, req.user!.id);
    dropCache();
    audit(req, 'intelligence.vehicle.rule', String(r.lastInsertRowid), { matchKind: b.matchKind, merchantKey, categoryName, spendType: b.spendType, matches });
    res.json({ ok: true, data: { rule: db.prepare('SELECT * FROM vehicle_spend_rules WHERE id = ?').get(Number(r.lastInsertRowid)), matches } });
  });

  router.post('/vehicle/rules/:id/retire', requireAuth, personOnly, (req, res) => {
    const r = db.prepare(`UPDATE vehicle_spend_rules SET active = 0, retired_at = datetime('now') WHERE id = ? AND active = 1`).run(Number(req.params.id));
    if (!r.changes) return res.status(404).json({ ok: false, error: 'no such active rule' });
    dropCache();
    audit(req, 'intelligence.vehicle.rule.retire', String(req.params.id), {});
    res.json({ ok: true, data: { id: Number(req.params.id), retired: true } });
  });

  return router;
}
