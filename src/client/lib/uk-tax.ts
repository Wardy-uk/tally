/**
 * Approximate UK take-home calculator (2025/26 tax year, England/Wales/NI).
 * Accounts for Income Tax, Employee NI (Class 1), and Personal Allowance taper.
 * Does NOT account for: student loans, pension contributions (salary sacrifice
 * or otherwise), Scottish rates, childcare vouchers, or company car BIK.
 *
 * All inputs/outputs are in PENCE.
 */

const PERSONAL_ALLOWANCE = 12570_00;
const BASIC_LIMIT = 50270_00;
const HIGHER_LIMIT = 125140_00;
const PA_TAPER_START = 100000_00;

const NI_PRIMARY_THRESHOLD = 12570_00;
const NI_UPPER_EARNINGS_LIMIT = 50270_00;

function calcIncomeTax(annualGrossPence: number): number {
  if (annualGrossPence <= 0) return 0;

  // Personal allowance tapers £1 for every £2 above £100k
  let allowance = PERSONAL_ALLOWANCE;
  if (annualGrossPence > PA_TAPER_START) {
    allowance = Math.max(0, PERSONAL_ALLOWANCE - (annualGrossPence - PA_TAPER_START) / 2);
  }

  let tax = 0;
  const basicBandTop = Math.max(BASIC_LIMIT, allowance);

  if (annualGrossPence > HIGHER_LIMIT) {
    tax += 0.45 * (annualGrossPence - HIGHER_LIMIT);
    tax += 0.40 * (HIGHER_LIMIT - basicBandTop);
    tax += 0.20 * (basicBandTop - allowance);
  } else if (annualGrossPence > BASIC_LIMIT) {
    tax += 0.40 * (annualGrossPence - BASIC_LIMIT);
    tax += 0.20 * (BASIC_LIMIT - allowance);
  } else if (annualGrossPence > allowance) {
    tax += 0.20 * (annualGrossPence - allowance);
  }

  return Math.max(0, Math.round(tax));
}

function calcEmployeeNi(annualGrossPence: number): number {
  if (annualGrossPence <= NI_PRIMARY_THRESHOLD) return 0;
  let ni = 0;
  if (annualGrossPence > NI_UPPER_EARNINGS_LIMIT) {
    ni += 0.08 * (NI_UPPER_EARNINGS_LIMIT - NI_PRIMARY_THRESHOLD);
    ni += 0.02 * (annualGrossPence - NI_UPPER_EARNINGS_LIMIT);
  } else {
    ni += 0.08 * (annualGrossPence - NI_PRIMARY_THRESHOLD);
  }
  return Math.round(ni);
}

export interface TakeHomeBreakdown {
  gross: number;       // pence, annual
  tax: number;         // pence, annual
  ni: number;          // pence, annual
  takeHome: number;    // pence, annual
  monthlyGross: number;
  monthlyTax: number;
  monthlyNi: number;
  monthlyTakeHome: number;
}

export function calcTakeHome(annualGrossPence: number): TakeHomeBreakdown {
  const tax = calcIncomeTax(annualGrossPence);
  const ni = calcEmployeeNi(annualGrossPence);
  const takeHome = annualGrossPence - tax - ni;
  return {
    gross: annualGrossPence,
    tax,
    ni,
    takeHome,
    monthlyGross: Math.round(annualGrossPence / 12),
    monthlyTax: Math.round(tax / 12),
    monthlyNi: Math.round(ni / 12),
    monthlyTakeHome: Math.round(takeHome / 12),
  };
}

/** Convenience: monthly gross pence → monthly take-home pence */
export function monthlyTakeHomeFromGross(monthlyGrossPence: number): number {
  return calcTakeHome(monthlyGrossPence * 12).monthlyTakeHome;
}
