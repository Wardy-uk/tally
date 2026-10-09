/** Build 26 — a synthetic household in the shapes measured on the live ledger (see intelligence.test.ts). */
import type { IntelRead } from '../../src/server/intelligence/compose.ts';
import type { RawTx } from '../../src/server/intelligence/ledger.ts';
import { addDays } from '../../src/server/intelligence/util.ts';

export const TODAY = '2026-10-09';
export const NOW = Date.parse('2026-10-09T09:00:00Z');
const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
export const card = (date: string, merchant: string) => `1717 ${date.slice(8, 10)}${MON[Number(date.slice(5, 7)) - 1]}${date.slice(2, 4)} ${merchant} GB`;

let nextId = 1;
type Over = Partial<RawTx>;
export const tx = (account_id: number, date: string, amount: number, description: string, over: Over = {}): RawTx => ({
  id: nextId++, account_id, date, amount, description, merchant: null, category_id: null, category_name: null, category_kind: null,
  is_transfer: 0, transfer_pair_id: null, balance_after: 100, created_at: `${date} 10:00:00`, ...over,
});
export const cat = (name: string, kind = 'expense') => ({ category_name: name, category_kind: kind, category_id: 1 });

/** A steady household, Jan–early Oct 2026. Every account busy enough that no gap is suspected. */
export function household(extra: (add: (t: RawTx) => void) => void = () => {}, { fresh = [1, 2, 3, 4], categorise = true } = {}): IntelRead {
  nextId = 1;
  const t: RawTx[] = [];
  const add = (r: RawTx) => t.push(r);
  for (let d = '2026-01-01'; d <= '2026-10-08'; d = addDays(d, 1)) {
    const day = Number(d.slice(8, 10));
    if (day % 2 === 0) add(tx(2, d, -3000, card(d, 'TESCO STORES'), categorise ? cat('Groceries') : {}));
    if (day % 3 === 0) add(tx(1, d, -500, card(d, 'GREGGS'), categorise ? cat('Eating Out') : {}));
    if (day % 3 === 1) add(tx(4, d, -700, card(d, 'HELENS SECRET SHOP'), categorise ? cat('Shopping') : {}));
    if (day % 4 === 0) add(tx(3, d, -250, card(d, 'BILLS CORNER SHOP'), categorise ? cat('Shopping') : {}));
    if (day === 28) add(tx(2, d, 250000, 'NURTUR LIMITED', cat('Salary', 'income')));
    if (day === 1) {
      add(tx(3, d, -52500, 'MORTGAGE', categorise ? cat('Rent / Mortgage') : {}));
      add(tx(4, d, -1500, 'HELEN GYM DD', categorise ? cat('Health') : {}));
      // a household transfer Joint → Bills, paired
      const a = tx(2, d, -60000, 'To A/C 26688719 BILLS Via Mobile Xfer', { is_transfer: 1 });
      const b = tx(3, d, 60000, 'From A/C 26620871 JOINT ACCOUNT Via Mobile', { is_transfer: 1 });
      a.transfer_pair_id = b.id; b.transfer_pair_id = a.id; add(a); add(b);
    }
  }
  // E.ON: two price steps (measured shape)
  const eon: Array<[string, number]> = [['2026-02-02', -22079], ['2026-03-02', -22079], ['2026-04-01', -18492], ['2026-05-01', -18492], ['2026-06-01', -18492],
    ['2026-07-01', -21273], ['2026-08-03', -21273], ['2026-09-01', -21273], ['2026-10-01', -21273]];
  for (const [d, a] of eon) add(tx(3, d, a, 'E.ON NEXT LTD', categorise ? cat('Bills & Utilities') : {}));
  // Virgin Media: one price rise
  const vm: Array<[string, number]> = [['2026-02-09', -6305], ['2026-03-09', -6305], ['2026-04-09', -6449], ['2026-05-11', -7215], ['2026-06-09', -7215], ['2026-07-09', -7215], ['2026-08-10', -7215], ['2026-09-09', -7215]];
  for (const [d, a] of vm) add(tx(3, d, a, 'VIRGIN MEDIA PYMTS', categorise ? cat('Bills & Utilities') : {}));
  extra(add);
  const iso = (id: number) => (fresh.includes(id) ? '2026-10-09T05:00:00.000Z' : '2026-09-20T05:00:00.000Z');
  return {
    transactions: t,
    accounts: [
      { id: 1, name: 'Nick', type: 'current', active: 1, opening_balance: 50000, owner: 'Nick', balance_observed_at: iso(1) },
      { id: 2, name: 'Joint', type: 'current', active: 1, opening_balance: 150000, owner: null, balance_observed_at: iso(2) },
      { id: 3, name: 'Bills', type: 'current', active: 1, opening_balance: 300000, owner: null, balance_observed_at: iso(3) },
      { id: 4, name: 'Helen', type: 'current', active: 1, opening_balance: 80000, owner: 'Helen', balance_observed_at: iso(4) },
    ],
    tlAccounts: [1, 2, 3, 4].map((id) => ({ id, connection_id: 1, linked_account_id: id, last_sync_at: iso(id), created_at: '2026-01-01 00:00:00' })),
    connections: [{ id: 1, provider_name: 'NATWEST', expires_at: '2026-10-10T00:00:00Z', last_sync_at: '2026-10-09T05:00:00Z', active: 1, created_at: '2026-01-01' }],
    recurringDecisions: new Map(), unusualDecisions: new Map(), planned: [],
  };
}
