/**
 * SOF savings-group auto-calculation engine.
 *
 * The user imports only RAW monthly inputs; this engine derives everything else.
 * Three linked layers, computed per month in chronological order:
 *
 *   Loans  → interest = rate × beginning principal;  remaining = beginning + newLoan − repayment
 *   Income → interestIncome = Σ ALL loan interest (active + deposit + group + external);
 *            gross  = totalIncome − depositInterest − fixedTermInterest − externalInterestCost
 *            net    = gross − operatingExpense − reserve(10% of totalIncome) − social(0.5% of totalIncome)
 *   Savings→ share  = beginning ÷ Σ beginning;  profit = share × netProfit;
 *            total  = beginning + deposit + profit − withdraw − penalty   (→ next month's beginning)
 *
 * Rates are configurable (loan rate becomes tiered from July 2026).
 */

export interface Rates {
  loan: number;       // monthly loan interest rate (default 1.5%)
  deposit: number;    // interest paid to deposit members (0.5%/month)
  fixedTerm: number;  // interest paid on fixed-term accounts (1%/month)
  reserve: number;    // reserve fund, % of total income (10%)
  social: number;     // social fund, % of total income (0.5%)
}

export const DEFAULT_RATES: Rates = {
  loan: 0.015,
  deposit: 0.005,
  fixedTerm: 0.01,
  reserve: 0.10,
  social: 0.005,
};

/** Parse "1,234.56" | "0.00%" | "-" | number → number. */
export function toNum(v: any): number {
  if (typeof v === 'number') return v;
  if (v === null || v === undefined || v === '-' || v === '') return 0;
  const n = parseFloat(String(v).replace(/[^0-9.-]/g, ''));
  return isNaN(n) ? 0 : n;
}

/** One loan row for a single month. `rate` may override the default (per-loan rate). */
export interface LoanInput {
  id: string;
  beginning: number;   // principal at start of month (= prior month's remaining)
  newLoan: number;     // additional disbursement this month
  repayment: number;   // principal repaid this month
  rate?: number;       // per-loan monthly rate (falls back to rates.loan)
}
export interface LoanResult extends LoanInput {
  interest: number;    // interest due = rate × beginning
  remaining: number;   // beginning + newLoan − repayment (→ next month beginning)
}

export function computeLoan(input: LoanInput, rates: Rates): LoanResult {
  const rate = input.rate ?? rates.loan;
  const interest = rate * input.beginning;
  const remaining = input.beginning + input.newLoan - input.repayment;
  return { ...input, interest, remaining };
}

/** Income statement for one month. */
export interface IncomeInput {
  loanInterestTotal: number;     // Σ interest across ALL loan categories
  otherIncome: number;
  depositBeginning: number;      // deposit balance at start of month
  fixedTermBeginning: number;    // fixed-term balance at start of month
  externalInterestCost: number;  // interest paid on borrowing from outside (cost)
  operatingExpense: number;      // from the expenses table
}
export interface IncomeResult {
  interestIncome: number;
  otherIncome: number;
  totalIncome: number;
  depositInterest: number;
  fixedTermInterest: number;
  grossProfit: number;
  operatingExpense: number;
  reserve: number;
  social: number;
  netProfit: number;
}

export function computeIncome(input: IncomeInput, rates: Rates): IncomeResult {
  const totalIncome = input.loanInterestTotal + input.otherIncome;
  const depositInterest = rates.deposit * input.depositBeginning;
  const fixedTermInterest = rates.fixedTerm * input.fixedTermBeginning;
  const grossProfit = totalIncome - depositInterest - fixedTermInterest - input.externalInterestCost;
  const reserve = rates.reserve * totalIncome;
  const social = rates.social * totalIncome;
  const netProfit = grossProfit - input.operatingExpense - reserve - social;
  return {
    interestIncome: input.loanInterestTotal, otherIncome: input.otherIncome, totalIncome,
    depositInterest, fixedTermInterest, grossProfit,
    operatingExpense: input.operatingExpense, reserve, social, netProfit,
  };
}

/** One member's savings row for a single month. */
export interface SavingInput {
  id: string;
  beginning: number;   // start-of-month total (= prior month's total)
  addSaving: number;   // imported monthly deposit
  withdraw?: number;
  penalty?: number;    // fine/membership paid in actual cash (ជាក់ស្តែង)
  deductFee?: number;  // fine/membership deducted from capital (កាត់ទុន)
}
export interface SavingResult extends SavingInput {
  share: number;       // beginning ÷ Σ beginning (fraction; ×100 for %)
  profit: number;      // share × net profit
  total: number;       // beginning + addSaving + profit − withdraw − penalty − deductFee (→ next beginning)
}

/** Distribute a month's net profit across members by share of beginning capital. */
export function computeSavings(members: SavingInput[], netProfit: number): SavingResult[] {
  const totalBeginning = members.reduce((s, m) => s + m.beginning, 0);
  return members.map((m) => {
    const share = totalBeginning > 0 ? m.beginning / totalBeginning : 0;
    const profit = share * netProfit;
    const total = m.beginning + m.addSaving + profit - (m.withdraw || 0) - (m.penalty || 0) - (m.deductFee || 0);
    return { ...m, share, profit, total };
  });
}
