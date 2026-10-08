/**
 * Merchant identity from a bank description.
 *
 * NatWest (via TrueLayer and CSV) gives no merchant field — only description text, e.g.
 *   "1717 09APR26 ZILCH W M MORRISONPLC GB GB"
 *   "9913 03APR26 AMZNMKTPLAC E*NB8W09HN4 LONDON GB"
 *   "4297 07MAR26 CD CENTRAL CO-OP RETALE67 5DT GB"
 *   "To A/C 26620871 JOINT ACCOUNT Via Mobile Xfer"
 *
 * The leading "<card last4> <DDMMMYY>" is incidental — when and on which card — and must
 * never form part of a merchant key. Normalisation is deliberately conservative: it strips
 * noise whose shape is unambiguous (card/date prefix, channel codes, country suffix, FX tail,
 * branch numbers, payment references) and otherwise keeps the merchant text as-is, so two
 * distinct merchants are never collapsed just because their names look alike.
 */

export interface MerchantIdentity {
  /** Stable merchant key for rule matching, or null when no usable identity exists. */
  key: string | null;
  /** Pay-later / processor wrapper the purchase went through, if any. */
  wrapper: 'ZILCH' | null;
  /** True when the only identity is the wrapper itself (instalments, fees) — not a real merchant. */
  wrapperOnly: boolean;
  /** Card purchase (had a card/date prefix) vs anything else. */
  kind: 'card' | 'account_transfer' | 'other';
}

const CARD_PREFIX = /^\d{4}\s+\d{2}[A-Z]{3}\d{2}\s+/;
// NatWest channel codes that sit between the card prefix and the merchant ("C", "CD", "D").
const CHANNEL_CODE = /^(?:C|CD|D)\s+(?=\S)/;
const COUNTRY = new Set(['GB', 'IE', 'US', 'LU', 'NL', 'DE', 'FR', 'ES', 'IT', 'BE', 'SE', 'DK', 'CA', 'AU']);
const DATE_TOKEN = /^(?:\d{1,2}[A-Z]{3}(?:\d{2,4})?|\d{1,2}\/\d{1,2}\/\d{2,4})$/;
const BANK_CODE = new Set(['DEB', 'CR', 'POS', 'DD', 'SO', 'BGC', 'FPI', 'FPO', 'TFR', 'VIS']);

/** A token that carries a reference rather than a name: contains digits, or a "*REF" with digits. */
function isNoiseToken(tok: string): boolean {
  if (/^\d+$/.test(tok)) return true;                    // branch / store / terminal numbers
  if (DATE_TOKEN.test(tok)) return true;
  if (/\d/.test(tok) && tok.length >= 5) return true;    // RETALE67, E*NB8W09HN4, D074B73B-…
  return false;
}

function tidy(s: string): string {
  return s
    .replace(/\s+-\s+/g, ' ')
    .replace(/[,"]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Take merchant words up to the first token that is clearly noise (reference, number, date,
 * country code). Anything after that point is location / reference detail.
 */
function leadingName(text: string): string {
  const out: string[] = [];
  for (const tok of text.split(' ')) {
    if (!tok) continue;
    if (out.length > 0 && (COUNTRY.has(tok) || isNoiseToken(tok))) break;
    if (out.length === 0 && (BANK_CODE.has(tok) || isNoiseToken(tok))) continue;
    out.push(tok);
  }
  return out.join(' ');
}

export function merchantIdentity(description: string, merchantField?: string | null): MerchantIdentity {
  // A provider-supplied merchant name is better evidence than parsed text.
  if (merchantField && merchantField.trim()) {
    const key = tidy(merchantField.toUpperCase());
    return { key: key || null, wrapper: null, wrapperOnly: false, kind: 'other' };
  }

  let text = tidy((description ?? '').toUpperCase());

  // Own-account transfers: identity is the destination account, never the date.
  const acct = text.match(/^(?:(TO|FROM)\s+)?(?:\d{1,2}[A-Z]{3}\s+)?A\/C\s+(\d{6,8})\b/);
  if (acct) {
    return { key: `${acct[1] ? acct[1] + ' ' : ''}A/C ${acct[2]}`, wrapper: null, wrapperOnly: false, kind: 'account_transfer' };
  }

  let kind: MerchantIdentity['kind'] = 'other';
  if (CARD_PREFIX.test(text)) {
    kind = 'card';
    text = text.replace(CARD_PREFIX, '').replace(CHANNEL_CODE, '');
  }

  let wrapper: MerchantIdentity['wrapper'] = null;
  if (/^ZILCH\b/.test(text)) {
    wrapper = 'ZILCH';
    text = text.replace(/^ZILCH\s*/, '');
  }

  const name = leadingName(text);

  if (wrapper) {
    // Zilch lines with no underlying merchant: instalments, snooze/late fees.
    if (!name || /^(INSTALMENT|INSTALLMENT|REPAYMENT|SNOOZE FEE|LATE FEE|FEE)\b/.test(name)) {
      return { key: `ZILCH ${name || 'UNKNOWN'}`.trim(), wrapper, wrapperOnly: true, kind };
    }
  }

  // Need a letter and 2+ alphanumerics to call it a merchant ("O2" yes, "C" or "123" no).
  if (!name || COUNTRY.has(name) || !/[A-Z]/.test(name) || name.replace(/[^A-Z0-9]/g, '').length < 2) {
    return { key: null, wrapper, wrapperOnly: false, kind };
  }
  return { key: name, wrapper, wrapperOnly: false, kind };
}
