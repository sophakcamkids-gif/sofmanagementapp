/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { db } from './lib/db';
import { loadAllCloudState, saveCloudState } from './lib/cloudStore';
import { computeSavings, computeLoan, DEFAULT_RATES } from './lib/calcEngine';
import { 
  Bell, Settings, Users, Wallet, 
  FileText, PieChart, Home, Heart, MessageSquare, 
  Menu, Bot, BarChart3, Receipt, HandCoins, 
  ShieldCheck, Calendar, BookOpen, Sparkles, TrendingUp,
  ChevronLeft, Plus, Download, Search, Upload, LogIn, UserCheck, Key, Lock, Eye, EyeOff, Save, X, Trash2, Edit
} from 'lucide-react';

const getStoredData = (key: string, defaultValue: any) => {
  if (typeof window === 'undefined') return defaultValue;
  const mappedKey = key.startsWith('sof_') ? key.replace('sof_', 'sof_live_') : key;
  const stored = localStorage.getItem(mappedKey);
  if (!stored) {
    localStorage.setItem(mappedKey, JSON.stringify(defaultValue));
    return defaultValue;
  }
  try {
    return JSON.parse(stored);
  } catch (e) {
    return defaultValue;
  }
};

const setStoredData = (key: string, value: any) => {
  if (typeof window !== 'undefined') {
    const mappedKey = key.startsWith('sof_') ? key.replace('sof_', 'sof_live_') : key;
    localStorage.setItem(mappedKey, JSON.stringify(value));
    // Mirror to Supabase cloud (fire-and-forget; local cache stays the working copy).
    saveCloudState(mappedKey, value).catch(err => console.error('Cloud sync error:', err));
  }
};

// Admin login credentials, synced across devices via the cloud (sof_ → sof_live_).
const getAdminAuth = (): { username: string; password: string } =>
  ({ username: 'sofadmin', password: 'sof2026', ...(getStoredData('sof_admin_auth', {}) || {}) });

// Parse a stored value ("0.00", "1,234.56", "0.00%", "-", number) into a number.
const num = (v: any): number => {
  if (typeof v === 'number') return v;
  if (v === null || v === undefined || v === '-' || v === '') return 0;
  const n = parseFloat(String(v).replace(/[^0-9.-]/g, ''));
  return isNaN(n) ? 0 : n;
};
// Sum one numeric field across an array of rows.
const sumField = (arr: any[], field: string): number =>
  (arr || []).reduce((s: number, r: any) => s + num(r[field]), 0);
// Format a number as money with two decimals and thousands separators.
const fmtMoney = (n: number): string =>
  n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const DEFAULT_PROFILE_DATA = [];

// Fixed-term savings accounts (គណនីសន្សំមានកាលកំណត់) — a SEPARATE roster (F-codes),
// not the active members. Roster + Jan–May 2026 figures imported from the financial
// report (external-loan sheets). Each account earns 1%/month interest on its beginning
// balance; interest is paid out (NOT compounded), so total = beginning + addSaving − withdraw.
const FIXEDTERM_ROSTER = [
  { id: 'F01', name: 'លីវ គា', gender: 'ប្រុស' },
  { id: 'F02', name: 'លីវ រដ្ឋា', gender: 'ប្រុស' },
  { id: 'F03', name: 'លីវ គង់', gender: 'ប្រុស' },
  { id: 'F04', name: 'ឃ្លាំង សៃពក', gender: 'ស្រី' },
  { id: 'F05', name: 'វី សុវណ្ណបញ្ញាវ័ន្ដ', gender: 'ប្រុស' },
  { id: 'F06', name: 'ងីម សោភា', gender: 'ស្រី' },
  { id: 'F07', name: 'លឹម ម៉េងឈុន', gender: 'ប្រុស' },
  { id: 'F08', name: 'ចេះ ឈុនលាង', gender: 'ប្រុស' },
];
// [beginning, addSaving, withdraw, rate?] per F-code, per month (codes omitted = all zero).
// rate defaults to 1%/month; F08 fully withdrew in Jan and earned 0% that month per the report.
const FIXEDTERM_RAW: Record<string, Record<string, [number, number, number, number?]>> = {
  'មករា 2026':  { F03: [1875, 0, 0],  F04: [3100, 0, 0],   F05: [3200, 300, 0], F06: [100, 0, 0], F08: [5000, 0, 5000, 0] },
  'កុម្ភៈ 2026': { F03: [1875, 50, 0], F04: [3100, 0, 100], F05: [3500, 0, 150], F06: [100, 0, 100] },
  'មីនា 2026':  { F03: [1925, 50, 0], F04: [3000, 0, 0],   F05: [3350, 0, 150] },
  'មេសា 2026':  { F03: [1975, 50, 0], F04: [3000, 0, 0],   F05: [3200, 100, 0] },
  'ឧសភា 2026':  { F03: [2025, 50, 0], F04: [3000, 0, 0],   F05: [3300, 0, 0] },
};
const FIXEDTERM_BY_MONTH: Record<string, any[]> = {};
for (const m of Object.keys(FIXEDTERM_RAW)) {
  FIXEDTERM_BY_MONTH[m] = FIXEDTERM_ROSTER.map((r) => {
    const [b, a, w, rate] = FIXEDTERM_RAW[m][r.id] || [0, 0, 0];
    const rt = rate != null ? rate : DEFAULT_RATES.fixedTerm;
    const interest = rt * b;            // 1%/month on beginning, paid out (not compounded)
    const total = b + a - w;            // end-of-month total carries to next month's beginning
    return {
      id: r.id, name: r.name, gender: r.gender, rate: rt,
      startCapital: b.toFixed(2), addSaving: a ? a.toFixed(2) : '-',
      withdraw: w ? w.toFixed(2) : '-',
      interest: interest ? interest.toFixed(2) : '-', total: total.toFixed(2), checked: true,
    };
  });
}

const DEFAULT_DEPOSIT_PROFILE_DATA = [];

const DEFAULT_MEMBER_LIST_DATA = [];

const DEFAULT_SAVING_DATA = [];

const DEFAULT_GROUP_DATA = [
  { id: 'R001', name: 'ទុនបម្រុង', gender: 'ក្រុម', startCapital: '0.00', share: '0.00%', addSaving: '-', profit: '0', withdraw: '-', deductFee: '-', actualFee: '-', total: '0.00', checked: true },
  { id: 'R002', name: 'ទុនសង្គម', gender: 'ក្រុម', startCapital: '0.00', share: '0.00%', addSaving: '-', profit: '0', withdraw: '-', deductFee: '-', actualFee: '-', total: '0.00', checked: true },
  { id: 'R003', name: 'ទុនក្រុមយេស (YES)', gender: 'ក្រុម', startCapital: '0.00', share: '0.00%', addSaving: '-', profit: '0', withdraw: '-', deductFee: '-', actualFee: '-', total: '0.00', checked: true },
  { id: 'R004', name: 'ការប្រាក់រក្សាទុក', gender: 'ក្រុម', startCapital: '0.00', share: '0.00%', addSaving: '-', profit: '0', withdraw: '-', deductFee: '-', actualFee: '-', total: '0.00', checked: true }
];

const DEFAULT_DEPOSIT_DATA: any[] = [];
const DEFAULT_LOAN_DATA: any[] = [];
const DEFAULT_DEPOSIT_LOAN_DATA: any[] = [];

// Per-month expenses imported from the expense workbook (Expense.xlsx). Jan–May 2026
// have data; Jun–Dec are empty. Each month's totals reconcile to the report
// (Jan/Mar/Apr/May 208; Feb 243). Applied once via the sof_expenses_import_v1 flag.
const EXP_CAT = 'ចំណាយប្រតិបត្តិការ';
const EXPENSE_BY_MONTH: Record<string, any[]> = {
  'មករា 2026': [
    { id: 'imp-01-1', date: '2026-01-15', supplier: 'SOF', description: 'ប្រាក់ឧបត្ថម្ភប្រចាំខែសម្រាប់លឹវ វី', category: EXP_CAT, qty: 1, price: 170, total: 170 },
    { id: 'imp-01-2', date: '2026-01-15', supplier: 'SOF', description: 'ប្រាក់ឧបត្ថម្ភប្រចាំខែសម្រាប់ផន សុភាក់', category: EXP_CAT, qty: 1, price: 30, total: 30 },
    { id: 'imp-01-3', date: '2026-01-15', supplier: 'SOF', description: 'កាតទូរស័ព្ទប្រចាំខែសម្រាប់លឹវ វី', category: EXP_CAT, qty: 2, price: 4, total: 8 },
  ],
  'កុម្ភៈ 2026': [
    { id: 'imp-02-1', date: '2026-02-15', supplier: 'SOF', description: 'ប្រាក់ឧបត្ថម្ភប្រចាំខែសម្រាប់លឹវ វី', category: EXP_CAT, qty: 1, price: 170, total: 170 },
    { id: 'imp-02-2', date: '2026-02-15', supplier: 'SOF', description: 'ប្រាក់ឧបត្ថម្ភប្រចាំខែសម្រាប់ផន សុភាក់', category: EXP_CAT, qty: 1, price: 30, total: 30 },
    { id: 'imp-02-3', date: '2026-02-15', supplier: 'SOF', description: 'កាតទូរស័ព្ទប្រចាំខែសម្រាប់លឹវ វី', category: EXP_CAT, qty: 2, price: 4, total: 8 },
    { id: 'imp-02-4', date: '2026-02-07', supplier: 'SOF', description: 'ថ្លៃជុសជុលកុំព្យួទ័រ', category: EXP_CAT, qty: 1, price: 35, total: 35 },
  ],
  'មីនា 2026': [
    { id: 'imp-03-1', date: '2026-03-15', supplier: 'SOF', description: 'ប្រាក់ឧបត្ថម្ភប្រចាំខែសម្រាប់លឹវ វី', category: EXP_CAT, qty: 1, price: 170, total: 170 },
    { id: 'imp-03-2', date: '2026-03-15', supplier: 'SOF', description: 'ប្រាក់ឧបត្ថម្ភប្រចាំខែសម្រាប់ផន សុភាក់', category: EXP_CAT, qty: 1, price: 30, total: 30 },
    { id: 'imp-03-3', date: '2026-03-15', supplier: 'SOF', description: 'កាតទូរស័ព្ទប្រចាំខែសម្រាប់លឹវ វី', category: EXP_CAT, qty: 2, price: 4, total: 8 },
  ],
  'មេសា 2026': [
    { id: 'imp-04-1', date: '2026-04-15', supplier: 'SOF', description: 'ប្រាក់ឧបត្ថម្ភប្រចាំខែសម្រាប់លឹវ វី', category: EXP_CAT, qty: 1, price: 170, total: 170 },
    { id: 'imp-04-2', date: '2026-04-15', supplier: 'SOF', description: 'ប្រាក់ឧបត្ថម្ភប្រចាំខែសម្រាប់ផន សុភាក់', category: EXP_CAT, qty: 1, price: 30, total: 30 },
    { id: 'imp-04-3', date: '2026-04-15', supplier: 'SOF', description: 'កាតទូរស័ព្ទប្រចាំខែសម្រាប់លឹវ វី', category: EXP_CAT, qty: 2, price: 4, total: 8 },
  ],
  'ឧសភា 2026': [
    { id: 'imp-05-1', date: '2026-05-15', supplier: 'SOF', description: 'ប្រាក់ឧបត្ថម្ភប្រចាំខែសម្រាប់លឹវ វី', category: EXP_CAT, qty: 1, price: 170, total: 170 },
    { id: 'imp-05-2', date: '2026-05-15', supplier: 'SOF', description: 'ប្រាក់ឧបត្ថម្ភប្រចាំខែសម្រាប់ផន សុភាក់', category: EXP_CAT, qty: 1, price: 30, total: 30 },
    { id: 'imp-05-3', date: '2026-05-15', supplier: 'SOF', description: 'កាតទូរស័ព្ទប្រចាំខែសម្រាប់លឹវ វី', category: EXP_CAT, qty: 2, price: 4, total: 8 },
  ],
  'មិថុនា 2026': [], 'កក្កដា 2026': [], 'សីហា 2026': [], 'កញ្ញា 2026': [],
  'តុលា 2026': [], 'វិច្ឆិកា 2026': [], 'ធ្នូ 2026': [],
};

// Sum one numeric field across a per-month store's rows for the given month.
const sumMonthOf = (key: string, month: string, field: string, def: any = {}): number => {
  const rows = (getStoredData(key, def) || {})[month];
  return Array.isArray(rows) ? rows.reduce((s: number, r: any) => s + num(r[field]), 0) : 0;
};

// Fixed-term account balance for a month = Σ(startCapital + addSaving − withdraw).
// Uses a stored `total` when present, but recomputes from the components when older/
// partial rows left `total` blank — so the balance sheet/dashboard are never empty.
// Falls back to the seeded Jan–May figures when a month has no stored rows.
const fixedTermBalanceOf = (month: string): number => {
  const by = getStoredData('sof_fixedterm_by_month', {}) || {};
  const sumRows = (rows: any[]) => rows.reduce((s: number, r: any) => {
    const t = num(r.total);
    return s + (t || (num(r.startCapital) + num(r.addSaving) - num(r.withdraw)));
  }, 0);
  // Carry forward: the target month's rows, else the most recent earlier month with data.
  const idx = MONTHS_2026.indexOf(month);
  for (let i = (idx < 0 ? MONTHS_2026.length - 1 : idx); i >= 0; i--) {
    const m = MONTHS_2026[i];
    if (Array.isArray(by[m]) && by[m].length) return sumRows(by[m]);
    if (Array.isArray(FIXEDTERM_BY_MONTH[m]) && FIXEDTERM_BY_MONTH[m].length) return sumRows(FIXEDTERM_BY_MONTH[m]);
  }
  return 0;
};

// Fixed-term interest for a month = Σ(each account's own rate × its beginning balance).
// Uses the PER-ROW rate (e.g. a closed account at 0% earns 0), NOT a flat 1% × total — and
// never the stored `interest` field, which some months left blank. The income statement and
// the cash-flow payout must use this SAME figure or the balance sheet drifts.
const fixedTermInterestOf = (month: string): number => {
  const stored = (getStoredData('sof_fixedterm_by_month', {}) || {})[month];
  const rows = (Array.isArray(stored) && stored.length) ? stored : (FIXEDTERM_BY_MONTH[month] || []);
  return rows.reduce((s: number, r: any) => s + (r.rate != null ? num(r.rate) : DEFAULT_RATES.fixedTerm) * num(r.startCapital), 0);
};

// Live monthly income statement — computed from this month's own data. Shared by the
// Income report and the Savings page so the two always agree.
function monthlyIncome(month: string) {
  const snapIncome: any = ((getStoredData('sof_monthly_reports', {})[month] || {}).income) || {};
  // Income = interest members actually PAID + interest from loans lent to outsiders.
  const interestPaid = sumMonthOf('sof_loans_by_month', month, 'interestPaid')
    + sumMonthOf('sof_loans_deposit_by_month', month, 'interestPaid')
    + sumMonthOf('sof_external_provided_by_month', month, 'interest');
  const interestIncome = interestPaid || num(snapIncome.interestIncome);
  const otherIncome = num(snapIncome.otherIncome);
  const totalIncome = interestIncome + otherIncome;
  const depositInterestCost = DEFAULT_RATES.deposit * sumMonthOf('sof_deposit_by_month', month, 'startCapital');
  const fixedTermInterest = fixedTermInterestOf(month);
  const externalLoanInterest = sumMonthOf('sof_external_received_by_month', month, 'interest');
  const grossProfit = totalIncome - depositInterestCost - fixedTermInterest - externalLoanInterest;
  const operatingExpense = sumMonthOf('sof_expenses_by_month', month, 'total', EXPENSE_BY_MONTH);
  const reserveAlloc = DEFAULT_RATES.reserve * totalIncome;   // 10% of total income → reserve fund
  const socialAlloc = DEFAULT_RATES.social * totalIncome;     // 0.5% of total income → social fund
  const netProfit = grossProfit - operatingExpense - reserveAlloc - socialAlloc;
  return { interestIncome, otherIncome, totalIncome, depositInterestCost, fixedTermInterest, externalLoanInterest, grossProfit, operatingExpense, reserveAlloc, socialAlloc, netProfit };
}

// ---- Live savings distribution (single source of truth) ------------------------
// The Savings page AND the balance sheet compute member/group/deposit balances the same
// way here: distribute each month's live net profit by share of beginning capital, carry
// the ending total forward as next month's beginning. Because both read from this, the
// balance sheet always ties to the savings page and the income statement — leaving no
// stale-data gap to pile up in retained earnings.
const MONTHS_2026 = ['មករា 2026', 'កុម្ភៈ 2026', 'មីនា 2026', 'មេសា 2026', 'ឧសភា 2026', 'មិថុនា 2026', 'កក្កដា 2026', 'សីហា 2026', 'កញ្ញា 2026', 'តុលា 2026', 'វិច្ឆិកា 2026', 'ធ្នូ 2026'];

// Deposit member row: flat 0.5% interest, no profit-pool share.
function computeDepositRowLive(r: any) {
  const beginning = num(r.startCapital);
  const profit = DEFAULT_RATES.deposit * beginning;
  const total = beginning + num(r.addSaving) + profit - num(r.withdraw) - num(r.actualFee) - num(r.deductFee);
  return { ...r, profit: profit.toFixed(2), total: total.toFixed(2) };
}

// Recompute ONE month's savings distribution from raw inputs (saved snapshot, else roster).
// `prevTotals` supplies the carry-forward beginnings. Mirrors the Savings page exactly.
function computeSavingsMonthLive(month: string, prevTotals: { active: Record<string, any>; group: Record<string, any>; deposit: Record<string, any> } | null) {
  const sBy = getStoredData('sof_savings_by_month', {});
  const gBy = getStoredData('sof_group_by_month', {});
  const dBy = getStoredData('sof_deposit_by_month', {});
  let active = (sBy[month] && sBy[month].length) ? sBy[month] : (getStoredData('sof_savings_data', DEFAULT_SAVING_DATA) || []);
  let group = (gBy[month] && gBy[month].length) ? gBy[month] : (getStoredData('sof_savings_group_data', DEFAULT_GROUP_DATA) || []);
  if (!group.some((r: any) => r.id === 'R004')) group = [...group, DEFAULT_GROUP_DATA.find((r) => r.id === 'R004')];
  let deposit = (dBy[month] && dBy[month].length) ? dBy[month] : (getStoredData('sof_savings_deposit_data', DEFAULT_DEPOSIT_DATA) || []);
  if (prevTotals) {
    active = active.map((r: any) => (prevTotals.active[r.id] !== undefined ? { ...r, startCapital: String(prevTotals.active[r.id]) } : r));
    group = group.map((r: any) => (prevTotals.group[r.id] !== undefined ? { ...r, startCapital: String(prevTotals.group[r.id]) } : r));
    deposit = deposit.map((r: any) => (prevTotals.deposit[r.id] !== undefined ? { ...r, startCapital: String(prevTotals.deposit[r.id]) } : r));
  }
  const incM = monthlyIncome(month);
  const net = incM.netProfit;
  const unpaidInt = Math.max(0,
    (sumMonthOf('sof_loans_by_month', month, 'interest') + sumMonthOf('sof_loans_deposit_by_month', month, 'interest'))
    - (sumMonthOf('sof_loans_by_month', month, 'interestPaid') + sumMonthOf('sof_loans_deposit_by_month', month, 'interestPaid')));
  group = group.map((r: any) => {
    const nm = r.name || '';
    if (nm.includes('បម្រុង')) return { ...r, addSaving: incM.reserveAlloc.toFixed(2) };
    if (nm.includes('សង្គម')) return { ...r, addSaving: incM.socialAlloc.toFixed(2) };
    if (r.id === 'R004') return { ...r, name: 'ការប្រាក់រក្សាទុក', addSaving: unpaidInt.toFixed(2) };
    return r;
  });
  const pool = [...active, ...group].filter((r: any) => r.id !== 'R004').map((r: any) => ({
    id: r.id, beginning: num(r.startCapital), addSaving: num(r.addSaving) + num(r.manualAdd),
    withdraw: num(r.withdraw), penalty: num(r.actualFee), deductFee: num(r.deductFee),
  }));
  const byId: Record<string, any> = {};
  computeSavings(pool, net).forEach((x) => { byId[x.id] = x; });
  const apply = (rows: any[]) => rows.map((r: any) => {
    if (r.id === 'R004') {
      const total = num(r.startCapital) + num(r.addSaving);
      return { ...r, share: '0.00%', profit: '0.00', total: total.toFixed(2) };
    }
    const c = byId[r.id];
    return c ? { ...r, share: (c.share * 100).toFixed(2) + '%', profit: c.profit.toFixed(2), total: c.total.toFixed(2) } : r;
  });
  return { active: apply(active), group: apply(group), deposit: deposit.map((r: any) => computeDepositRowLive(r)) };
}

// Chain January → targetMonth, returning that month's live ending rows (active/group/deposit).
function savingsLiveTotals(targetMonth: string) {
  const idx = MONTHS_2026.indexOf(targetMonth);
  if (idx < 0) return null;
  const colTotals = (arr: any[]) => { const m: Record<string, number> = {}; (arr || []).forEach((r: any) => { m[r.id] = num(r.total); }); return m; };
  let prev: any = null; let result: any = null;
  for (let i = 0; i <= idx; i++) {
    result = computeSavingsMonthLive(MONTHS_2026[i], prev);
    prev = { active: colTotals(result.active), group: colTotals(result.group), deposit: colTotals(result.deposit) };
  }
  return result as { active: any[]; group: any[]; deposit: any[] } | null;
}

// ---- Member portal credentials -------------------------------------------------
// Members log in with their ID (C001…/D001…) + a password. Everyone starts with a
// single shared default password; each member can then change their own. Changed
// passwords are stored per-member in sof_member_credentials (cloud-synced).
const MEMBER_DEFAULT_PASSWORD = 'sof2026';
const getMemberDefaultPassword = (): string =>
  (typeof localStorage !== 'undefined' && localStorage.getItem('sof_member_default_password')) || MEMBER_DEFAULT_PASSWORD;
const getMemberPassword = (code: string): string => {
  const creds = getStoredData('sof_member_credentials', {}) || {};
  return creds[code] || getMemberDefaultPassword();
};
const setMemberPassword = (code: string, pw: string) => {
  const creds = { ...(getStoredData('sof_member_credentials', {}) || {}) };
  creds[code] = pw;
  setStoredData('sof_member_credentials', creds);
};
const memberExists = (code: string): boolean => {
  const u = (code || '').toUpperCase();
  if (!u) return false;
  const list = getStoredData('sof_member_list_data', []) || [];
  return list.some((m: any) =>
    String(m.code || '').toUpperCase() === u || String(m.id || '').toUpperCase().endsWith(' ' + u));
};

function SidebarLink({ to, label }: { to: string, label: string }) {
  const navigate = useNavigate();
  const location = useLocation();
  const isActive = location.pathname === to || (to === '/admin' && location.pathname === '/dashboard');
  
  return (
    <button
      onClick={() => navigate(to)}
      className={`w-full flex items-center justify-between px-4 py-2.5 rounded-xl text-left font-extrabold text-xs transition-colors cursor-pointer ${
        isActive 
          ? 'bg-[#eef8f2] text-[#0a6652]' 
          : 'text-slate-600 hover:bg-slate-50 hover:text-slate-800'
      }`}
    >
      <span>{label}</span>
      {isActive && <span className="w-1.5 h-1.5 rounded-full bg-[#0a6652]"></span>}
    </button>
  );
}

export default function App() {
  const [userRole, setUserRole] = useState<string | null>(localStorage.getItem('userRole'));
  const [memberId, setMemberId] = useState<string | null>(localStorage.getItem('memberId'));
  const [hydrated, setHydrated] = useState(false);

  // Clean up bad import once based on user request
  useEffect(() => {
    if (localStorage.getItem('clear_bad_import_v2') !== 'true') {
      localStorage.removeItem('sof_profile_data');
      localStorage.removeItem('sof_member_list_data');
      localStorage.setItem('clear_bad_import_v2', 'true');
      window.location.reload();
    }
  }, []);

  // Hydrate the local cache from Supabase cloud on startup (cloud = source of truth).
  // Falls back to local-only if the table is missing or the network is unavailable.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const cloud = await loadAllCloudState();
        // Overwrite local cache with cloud values so every device sees the same data.
        for (const [k, v] of Object.entries(cloud)) {
          localStorage.setItem(k, JSON.stringify(v));
        }
        // First-time migration: push any local-only keys up to the cloud.
        const localKeys: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.startsWith('sof_live_')) localKeys.push(k);
        }
        for (const k of localKeys) {
          if (!(k in cloud)) {
            try {
              saveCloudState(k, JSON.parse(localStorage.getItem(k) || 'null'))
                .catch(err => console.error('Cloud seed error:', err));
            } catch { /* skip unparseable key */ }
          }
        }
      } catch (err) {
        console.error('Cloud hydration skipped (using local cache):', err);
      } finally {
        if (!cancelled) setHydrated(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (!hydrated) {
    return (
      <div className="min-h-screen bg-[#eef8f2] flex flex-col items-center justify-center gap-3 text-[#0a6652]">
        <div className="w-10 h-10 border-4 border-[#1fb487] border-t-transparent rounded-full animate-spin"></div>
        <p className="text-sm font-black">កំពុងទាញទិន្នន័យពី Cloud...</p>
      </div>
    );
  }

  return (
    <Router>
      <div className="min-h-screen bg-[#eef8f2] text-slate-800 font-sans flex flex-col">
        {/* Top Header Wrapper */}
        <div className="w-full bg-[#eef8f2] border-b border-slate-200/40">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 md:px-8">
            {/* Header */}
            <header className="py-4 flex justify-between items-center shrink-0 w-full">
              <div className="flex items-center gap-2.5 min-w-0 flex-1">
                <div className="w-9 h-9 bg-white rounded-xl flex items-center justify-center shadow-sm overflow-hidden p-1 border border-slate-100 shrink-0">
                  <img src="https://i.ibb.co/Kp7CxnjC/Picture1.jpg" alt="Logo" className="w-full h-full object-contain" referrerPolicy="no-referrer" />
                </div>
                <div className="min-w-0">
                  <h1 className="text-sm font-black text-[#0a6652] tracking-tight leading-tight truncate">
                    ក្រុមសន្សំប្រាក់អនាគតយើង
                  </h1>
                  <p className="text-[#1fb487] font-black text-[9px] leading-none truncate">Saving For Our Future</p>
                </div>
              </div>
              <div className="flex gap-2 items-center shrink-0">
                <div className="relative">
                  <div className="w-9 h-9 bg-white rounded-full flex items-center justify-center shadow-sm text-yellow-500 border border-slate-100">
                    <Bell className="w-4.5 h-4.5 fill-yellow-500 text-yellow-500" />
                  </div>
                  <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white text-[8px] font-bold flex items-center justify-center rounded-full">3</span>
                </div>
                {userRole && (
                  <button 
                    onClick={() => {
                      localStorage.removeItem('userRole');
                      localStorage.removeItem('memberId');
                      setUserRole(null);
                      setMemberId(null);
                      window.location.href = '/login';
                    }}
                    className="w-9 h-9 bg-red-50 text-red-600 border border-red-100 rounded-full flex items-center justify-center shadow-sm hover:bg-red-100 transition-colors"
                    title="ចាកចេញ (Logout)"
                  >
                    <LogIn size={15} className="rotate-180" />
                  </button>
                )}
              </div>
            </header>
          </div>
        </div>

        {/* Outer Split Layout Area */}
        <div className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 md:px-8 flex flex-col lg:flex-row gap-6 py-4 pb-24 lg:pb-8">
          {/* Left Sidebar for Desktop/Computer - sticky position */}
          {userRole && (
            <aside className="hidden lg:flex flex-col w-64 shrink-0 bg-white border border-slate-100 rounded-3xl p-5 shadow-sm space-y-2 sticky top-6 self-start">
              <div className="pb-4 mb-2 border-b border-slate-100">
                <span className="text-[10px] font-black tracking-wider text-slate-400 uppercase">គណនីបច្ចុប្បន្ន</span>
                <div className="flex items-center gap-2 mt-1.5 bg-slate-50 p-2 border border-slate-100 rounded-2xl">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                  <span className="text-xs font-black text-[#0a6652] truncate">
                    {userRole === 'admin' ? '🛡️ ផ្នែកគ្រប់គ្រង (Admin)' : `👤 សមាជិក [${memberId}]`}
                  </span>
                </div>
              </div>

              <div className="text-[10px] font-black tracking-wider text-slate-400 uppercase pb-1">ម៉ឺនុយប្រព័ន្ធ (Menu)</div>
              {userRole === 'admin' ? (
                <>
                  <SidebarLink to="/admin" label="📊 ផ្ទាំងគ្រប់គ្រង (Dashboard)" />
                  <SidebarLink to="/members" label="👥 ពត៌មានសមាជិក (Members)" />
                  <SidebarLink to="/savings" label="💰 ប្រាក់សន្សំ (Savings)" />
                  <SidebarLink to="/loans" label="🤝 ប្រាក់កម្ចី (Loans)" />
                  <SidebarLink to="/expenses" label="💸 ការចំណាយ (Expenses)" />
                  <SidebarLink to="/reports" label="📈 របាយការណ៍បិទបញ្ជី (Reports)" />
                  <SidebarLink to="/history" label="📜 ប្រវត្តិប្រតិបត្តិការ (Logs)" />
                  <SidebarLink to="/settings" label="⚙️ ការកំណត់ប្រព័ន្ធ (Settings)" />
                </>
              ) : (
                <>
                  <SidebarLink to={`/member-report?id=${memberId}`} label="📋 របាយការណ៍ផ្ទាល់ខ្លួន" />
                  <SidebarLink to="/settings" label="⚙️ ការកំណត់ប្រព័ន្ធ (Settings)" />
                </>
              )}

              <button 
                onClick={() => {
                  localStorage.removeItem('userRole');
                  localStorage.removeItem('memberId');
                  setUserRole(null);
                  setMemberId(null);
                  window.location.href = '/login';
                }}
                className="w-full mt-4 flex items-center gap-2 px-3 py-2 text-rose-600 hover:bg-rose-50 rounded-xl text-left font-black text-xs transition-colors cursor-pointer"
              >
                <LogIn size={14} className="rotate-180" />
                <span>ចាកចេញ (Logout)</span>
              </button>
            </aside>
          )}

          {/* Right Main Content area */}
          <main className="flex-1 min-w-0">
            <Routes>
              <Route path="/" element={<MemberLogin onLogin={(role, id) => { setUserRole(role); setMemberId(id); }} />} />
              <Route path="/login" element={<MemberLogin onLogin={(role, id) => { setUserRole(role); setMemberId(id); }} />} />
              
              <Route path="/admin" element={
                <AdminGuard userRole={userRole}>
                  <DashboardGeneral />
                </AdminGuard>
              } />
              <Route path="/dashboard" element={
                <AdminGuard userRole={userRole}>
                  <DashboardGeneral />
                </AdminGuard>
              } />
              <Route path="/members" element={
                <AdminGuard userRole={userRole}>
                  <Members />
                </AdminGuard>
              } />
              <Route path="/savings" element={
                <AdminGuard userRole={userRole}>
                  <Savings />
                </AdminGuard>
              } />
              <Route path="/loans" element={
                <AdminGuard userRole={userRole}>
                  <Loans />
                </AdminGuard>
              } />
              <Route path="/expenses" element={
                <AdminGuard userRole={userRole}>
                  <Expenses />
                </AdminGuard>
              } />
              <Route path="/reports" element={
                <AdminGuard userRole={userRole}>
                  <Reports />
                </AdminGuard>
              } />
              <Route path="/history" element={
                <AdminGuard userRole={userRole}>
                  <History />
                </AdminGuard>
              } />
              <Route path="/settings" element={
                <AdminGuard userRole={userRole}>
                  <SettingsPage />
                </AdminGuard>
              } />
              
              <Route path="/member-report" element={
                <MemberGuard userRole={userRole}>
                  <MemberReport />
                </MemberGuard>
              } />
            </Routes>
          </main>
        </div>

        {/* Bottom Navigation for mobile screens only (hidden on desktop screens) */}
        <nav className="fixed bottom-0 left-0 right-0 lg:hidden bg-white rounded-t-[32px] px-4 pt-3 pb-5 flex justify-around items-center z-50 shadow-[0_-4px_25px_rgba(0,100,50,0.05)] max-w-full">
           <div className="flex flex-col items-center gap-1 text-[#ff6b35] cursor-pointer shrink-0" onClick={() => {
             if (userRole === 'admin') window.location.href = '/admin';
             else if (userRole === 'member') window.location.href = '/member-report';
             else window.location.href = '/login';
           }}>
              <Home className="w-5 h-5" strokeWidth={2.5} />
              <span className="text-[9px] font-black">ទំព័រដើម</span>
           </div>
           <div className="flex flex-col items-center gap-1 text-slate-400 hover:text-[#ff6b35] transition-colors cursor-pointer shrink-0">
              <Heart className="w-5 h-5" strokeWidth={2.5} />
              <span className="text-[9px] font-bold">ចំណូលចិត្ត</span>
           </div>
           <div className="flex flex-col items-center gap-1 text-slate-400 hover:text-[#ff6b35] transition-colors cursor-pointer shrink-0">
              <MessageSquare className="w-5 h-5" strokeWidth={2.5} />
              <span className="text-[9px] font-bold">សារ</span>
           </div>
           <div className="flex flex-col items-center gap-1 text-slate-400 hover:text-[#ff6b35] transition-colors cursor-pointer shrink-0">
              <Menu className="w-5 h-5" strokeWidth={2.5} />
              <span className="text-[9px] font-bold">ម៉ឺនុយ</span>
           </div>

           {/* Floating Action Bot Button (Positioned gracefully as relative to not block navigation) */}
           <div className="w-[45px] h-[45px] bg-gradient-to-b from-green-50 to-green-200 rounded-full flex items-center justify-center shadow-md border-[3px] border-[#eef8f2] shrink-0 cursor-pointer hover:scale-105 transition-transform">
              <Bot className="w-5 h-5 text-[#0a6652]" />
           </div>
        </nav>
      </div>
    </Router>
  );
}

function AdminGuard({ children, userRole }: { children: React.ReactNode, userRole: string | null }) {
  const navigate = useNavigate();
  React.useEffect(() => {
    if (userRole !== 'admin') {
      navigate('/login?tab=admin');
    }
  }, [userRole, navigate]);

  if (userRole !== 'admin') {
    return (
      <div className="max-w-md mx-auto text-center py-20 bg-white rounded-3xl border border-slate-100 shadow-[0_8px_30px_rgba(0,0,0,0.04)] mt-12 p-8">
        <div className="w-16 h-16 bg-rose-50 text-rose-500 rounded-full flex items-center justify-center mx-auto mb-4 border border-rose-100">
          <Lock size={32} />
        </div>
        <h3 className="text-xl font-bold text-slate-800 mb-2">គ្មានសិទ្ធិចូលប្រើប្រាស់</h3>
        <p className="text-slate-500 mb-6 font-medium text-sm leading-relaxed">ទំព័រនេះត្រូវបានកំណត់សម្រាប់តែផ្នែកអ្នកគ្រប់គ្រង (Admin) ប៉ុណ្ណោះ។ សូមចូលគណនីជាអ្នកគ្រប់គ្រងដើម្បីបើកមើល។</p>
        <button onClick={() => navigate('/login?tab=admin')} className="bg-[#0a6652] text-white font-bold py-3 px-6 rounded-2xl text-sm transition-colors hover:bg-[#084f40] shadow-md shadow-emerald-900/10">
          ចូលគណនីអ្នកគ្រប់គ្រង (Admin)
        </button>
      </div>
    );
  }
  return <>{children}</>;
}

function MemberGuard({ children, userRole }: { children: React.ReactNode, userRole: string | null }) {
  const navigate = useNavigate();
  React.useEffect(() => {
    if (userRole !== 'member' && userRole !== 'admin') {
      navigate('/login');
    }
  }, [userRole, navigate]);

  if (userRole !== 'member' && userRole !== 'admin') {
    return (
      <div className="max-w-md mx-auto text-center py-20 bg-white rounded-3xl border border-slate-100 shadow-[0_8px_30px_rgba(0,0,0,0.04)] mt-12 p-8">
        <div className="w-16 h-16 bg-amber-50 text-amber-500 rounded-full flex items-center justify-center mx-auto mb-4 border border-amber-100">
          <Lock size={32} />
        </div>
        <h3 className="text-xl font-bold text-slate-800 mb-2">សូមចូលគណនីសមាជិក</h3>
        <p className="text-slate-500 mb-6 font-medium text-sm leading-relaxed">សូមចូលគណនីសមាជិករបស់អ្នកដើម្បីមើលព័ត៌មាន និងរបាយការណ៍សន្សំ/កម្ចីលម្អិត។</p>
        <button onClick={() => navigate('/login')} className="bg-[#0a6652] text-white font-bold py-3 px-6 rounded-2xl text-sm transition-colors hover:bg-[#084f40] shadow-md shadow-emerald-900/10">
          ចូលគណនីសមាជិក (Member)
        </button>
      </div>
    );
  }
  return <>{children}</>;
}

function PageView({ 
  title, 
  children,
  hideUpload = false,
  hideAdd = false,
  downloadLabel = "ទាញយក",
  backPath,
  hideBack = false,
  hideDownload = false,
  onBack,
  onUpload,
  onAddClick,
  onDownloadClick
}: { 
  title: React.ReactNode | string; 
  children: React.ReactNode;
  hideUpload?: boolean;
  hideAdd?: boolean;
  downloadLabel?: string;
  backPath?: string;
  hideBack?: boolean;
  hideDownload?: boolean;
  onBack?: () => void;
  onUpload?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onAddClick?: () => void;
  onDownloadClick?: () => void;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const handleUploadClick = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (onUpload) {
      onUpload(e);
      return;
    }
    
    const file = e.target.files?.[0];
    if (!file) return;

    const fileExt = file.name.split('.').pop()?.toLowerCase();

    if (fileExt === 'xlsx' || fileExt === 'xls' || fileExt === 'csv') {
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const ab = event.target?.result as ArrayBuffer;
          const wb = XLSX.read(ab, { type: 'array' });
          let importedAnyData = false;

          wb.SheetNames.forEach(sheetName => {
            if (sheetName.startsWith('sof_')) {
              const ws = wb.Sheets[sheetName];
              const sheetData = XLSX.utils.sheet_to_json(ws);
              localStorage.setItem(sheetName, JSON.stringify(sheetData));
              importedAnyData = true;
            }
          });

          // If no sheets matching 'sof_', assume it's a generic members list import
          if (!importedAnyData && wb.SheetNames.length > 0) {
             const firstSheetName = wb.SheetNames[0];
             const ws = wb.Sheets[firstSheetName];
             const data = XLSX.utils.sheet_to_json(ws) as any[];
             if (data && data.length > 0) {
               const activeProfiles = getStoredData('sof_profile_data', DEFAULT_PROFILE_DATA);
               const currentMembers = getStoredData('sof_member_list_data', DEFAULT_MEMBER_LIST_DATA);
               let count = 0;
               data.forEach(row => {
                  const name = row['ឈ្មោះ'] || row['Name'] || row['Full Name'] || Object.values(row)[0] || '';
                  if (!name) return;
                  const newIdNum = activeProfiles.length + 1;
                  const newCode = `C${String(newIdNum).padStart(3, '0')}`;
                  const idPrefix = String(newIdNum);
                  const newId = `${idPrefix} ${newCode}`;
                  
                  activeProfiles.push({
                    id: newId,
                    name: String(name),
                    gender: row['ភេទ'] || 'ប្រុស',
                    role: row['តួនាទី'] || 'សមាជិក',
                    job: row['មុខរបរ'] || '-',
                    phone: row['លេខទូរស័ព្ទ'] || '-',
                    dob: row['ថ្ងៃខែឆ្នាំកំណើត'] || '-',
                    address: row['ទីលំនៅ'] || '-',
                    joinDate: new Date().toISOString().split('T')[0],
                    spouse: '-',
                    relation: '-',
                    img: `https://i.pravatar.cc/150?u=${newIdNum}`
                  });
                  currentMembers.push({
                    id: idPrefix,
                    code: newCode,
                    name: String(name),
                    gender: row['ភេទ'] || 'ប្រុស',
                    type: row['ប្រភេទសមាជិក'] || row['ប្រភេទ'] || row['តួនាទី'] || 'សកម្ម'
                  });
                  count++;
               });
               setStoredData('sof_profile_data', activeProfiles);
               setStoredData('sof_member_list_data', currentMembers);
               alert(`បាននាំចូលសមាជិកចំនួន ${count} នាក់ពីឯកសារ Excel ដោយជោគជ័យ!`);
               window.location.reload();
               return;
             }
          }

          if (importedAnyData) {
            alert('ទិន្នន័យពី Excel ត្រូវបាននាំចូលដោយជោគជ័យ! ប្រព័ន្ធនឹងដំណើរការឡើងវិញ...');
            window.location.reload();
          } else {
            alert('ឯកសារ Excel មិនមានទិន្នន័យត្រូវគ្នាទេ។');
          }
        } catch (err) {
          alert('មានបញ្ហាក្នុងការអានឯកសារ Excel។ សូមបញ្ជាក់ថាវាពិតជាឯកសារ Excel ត្រឹមត្រូវ។');
        }
      };
      reader.readAsArrayBuffer(file);
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    // Default global JSON import
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        const data = JSON.parse(text);
        if (typeof data === 'object' && data !== null) {
          Object.keys(data).forEach(key => {
            if (key.startsWith('sof_')) {
              localStorage.setItem(key, JSON.stringify(data[key]));
            }
          });
          alert('ទិន្នន័យត្រូវបាននាំចូលដោយជោគជ័យ! ប្រព័ន្ធនឹងដំណើរការឡើងវិញ...');
          window.location.reload();
        } else {
          throw new Error("Invalid format");
        }
      } catch (err) {
        alert('ឯកសារមិនត្រឹមត្រូវ! សូមជ្រើសរើសឯកសារទម្រង់ JSON ដែលបានទាញយក ឬ Excel ត្រឹមត្រូវ។');
      }
    };
    reader.readAsText(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleDownloadClick = () => {
    if (onDownloadClick) {
      onDownloadClick();
      return;
    }
    
    // Default fallback: export visible tables to Excel
    const tables = document.querySelectorAll('table');
    if (tables.length > 0) {
      const wb = XLSX.utils.book_new();
      tables.forEach((table, index) => {
        const ws = XLSX.utils.table_to_sheet(table);
        XLSX.utils.book_append_sheet(wb, ws, `Sheet${index + 1}`);
      });
      const fileName = typeof title === 'string' 
        ? title.replace(/[^a-zA-Z0-9\u1780-\u17FF]/gi, '_').replace(/_+/g, '_').replace(/_$/, '').toLowerCase() 
        : 'export_data';
      XLSX.writeFile(wb, `${fileName || 'export'}.xlsx`);
    } else {
      window.print();
    }
  };

  const handleBack = () => {
    if (onBack) {
      onBack();
    } else if (backPath) {
      navigate(backPath);
    } else if (location.pathname === '/' || location.pathname === '/login') {
      navigate('/admin');
    } else if (location.pathname === '/member-report') {
      navigate('/login');
    } else if (location.pathname === '/admin') {
      navigate('/');
    } else {
      navigate('/admin');
    }
  };

  return (
    <div className="bg-white rounded-[24px] p-4 sm:p-6 md:p-8 shadow-[0_4px_15px_rgba(0,100,50,0.03)] min-h-[450px]">
       <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5 border-b border-green-50 pb-4">
         <h2 className="text-base sm:text-lg md:text-xl font-bold text-[#0a6652]">{title}</h2>
         <div className="flex flex-wrap gap-2">
            {!hideUpload && (
              <>
                <button onClick={handleUploadClick} type="button" className="flex text-xs items-center gap-1.5 bg-slate-100 text-slate-700 px-3 py-1.5 rounded-full font-bold hover:bg-slate-200 transition-colors cursor-pointer">
                  <Upload size={14} strokeWidth={2.5} /> នាំយកពីកុំព្យូទ័រ
                </button>
                <input type="file" ref={fileInputRef} onChange={handleFileChange} className="hidden" accept=".json,.csv,.xlsx" />
              </>
            )}
            {!hideDownload && (
              <button onClick={handleDownloadClick} className="flex text-xs items-center gap-1.5 bg-indigo-50 text-indigo-700 px-3 py-1.5 rounded-full font-bold hover:bg-indigo-100 transition-colors">
                <Download size={14} strokeWidth={2.5} /> {downloadLabel}
              </button>
            )}
            {!hideAdd && (
              <button 
                onClick={onAddClick}
                className="flex text-xs items-center gap-1.5 bg-[#0a6652] text-white px-3 py-1.5 rounded-full font-bold shadow-md hover:bg-[#084f40] transition-colors"
               >
                <Plus size={14} strokeWidth={2.5} /> បន្ថែមថ្មី
              </button>
            )}
         </div>
       </div>
       <div className="text-slate-600">
         {children}
       </div>
       {!hideBack && (
         <div className="mt-8 pt-6 border-t border-slate-100 flex justify-start">
           <button onClick={handleBack} className="flex items-center gap-2 text-slate-400 hover:text-[#0a6652] font-semibold transition-colors">
              <ChevronLeft size={16} strokeWidth={2.5} /> <span className="text-xs">ត្រឡប់ក្រោយ</span>
           </button>
         </div>
       )}
    </div>
  )
}

// ----------------------------------------------------
// Dummy Views for each section
// ----------------------------------------------------

function DashboardGeneral() {
  const navigate = useNavigate();
  const location = useLocation();

  // Active form tab
  const [entryTab, setEntryTab] = useState<'savings' | 'loan' | 'repayment' | 'member'>((location.state as any)?.tab || 'savings');
  
  // Feedback
  const [successMsg, setSuccessMsg] = useState('');

  // 1. New Member form states
  const [mName, setMName] = useState('');
  const [mGender, setMGender] = useState('ប្រុស');
  const [mType, setMType] = useState('សកម្ម'); // សកម្ម or បញ្ញើ
  const [mRole, setMRole] = useState('ម្ចាស់ភាគហ៊ុន');
  const [mJob, setMJob] = useState('');
  const [mPhone, setMPhone] = useState('');
  const [mAddress, setMAddress] = useState('');

  // 2. New Savings form
  const [sMemberId, setSMemberId] = useState('');
  const [sMonth, setSMonth] = useState('មេសា 2026');
  const [sAmount, setSAmount] = useState('');

  // 3. New Loan form
  const [lMemberId, setLMemberId] = useState('');
  const [lAmount, setLAmount] = useState('');
  const [lRate, setLRate] = useState('0.8%');
  const [lTerm, setLTerm] = useState('12');
  const [lMonth, setLMonth] = useState('មេសា 2026');

  // 4. Loan Repayment form
  const [rMemberId, setRMemberId] = useState('');
  const [rPrincipal, setRPrincipal] = useState('');
  const [rInterest, setRInterest] = useState('');
  const [rMonth, setRMonth] = useState('មេសា 2026');

  // Load existing records for dropdowns
  const membersList = getStoredData('sof_member_list_data', DEFAULT_MEMBER_LIST_DATA);
  const depositProfiles = getStoredData('sof_deposit_profile_data', DEFAULT_DEPOSIT_PROFILE_DATA);

  // Combine lists of active and deposit members for dropdown selections.
  // member_list_data already holds both types, so take only active rows from it
  // and add deposit members from depositProfiles — otherwise deposit codes appear
  // twice (duplicate React keys).
  const allMembersForSelect = [
    ...membersList.filter((m: any) => m.type !== 'បញ្ញើ').map((m: any) => ({ code: m.code, name: m.name, type: 'សកម្ម' })),
    ...depositProfiles.map((m: any) => ({ code: m.code, name: m.name, type: 'បញ្ញើ' }))
  ];

  // Initialize selected values if blank
  useEffect(() => {
    if (allMembersForSelect.length > 0) {
      if (!sMemberId) setSMemberId(allMembersForSelect[0].code);
      const activeOnly = allMembersForSelect.filter((m: any) => m.type === 'សកម្ម');
      if (activeOnly.length > 0) {
        if (!lMemberId) setLMemberId(activeOnly[0].code);
        if (!rMemberId) setRMemberId(activeOnly[0].code);
      } else {
        if (!lMemberId) setLMemberId(allMembersForSelect[0].code);
        if (!rMemberId) setRMemberId(allMembersForSelect[0].code);
      }
    }
  }, [allMembersForSelect]);

  // Handlers
  const handleAddMember = (e: React.FormEvent) => {
    e.preventDefault();
    if (!mName.trim()) return;

    const activeProfiles = getStoredData('sof_profile_data', DEFAULT_PROFILE_DATA);
    const depositProfiles = getStoredData('sof_deposit_profile_data', DEFAULT_DEPOSIT_PROFILE_DATA);

    // Global duplicate name check
    const isDuplicate = activeProfiles.some((p: any) => p.name.toLowerCase() === mName.trim().toLowerCase()) ||
                        depositProfiles.some((p: any) => p.name.toLowerCase() === mName.trim().toLowerCase());
    
    if (isDuplicate) {
      alert('សមាជិកដែលមានឈ្មោះនេះមានរួចហើយ! ឈ្មោះមិនត្រូវស្ទួនឡើយ។');
      return;
    }

    if (mType === 'សកម្ម') {
      const newIdNum = activeProfiles.length + 1;
      const newCode = `C${String(newIdNum).padStart(3, '0')}`;
      const idPrefix = String(newIdNum);
      const newId = `${idPrefix} ${newCode}`;

      // Insert active profiles
      const newProfile = {
        id: newId,
        name: mName.trim(),
        gender: mGender,
        role: mRole,
        job: mJob.trim() || '-',
        spouse: '-',
        address: mAddress.trim() || '-',
        phone: mPhone.trim() || '-',
        email: '-',
        facebook: '-',
        bankName: mPhone.trim() || '-',
        bankAcc: '-',
        dob: '-',
        idCard: '-',
        heir: '-',
        relation: '-',
        img: `https://i.pravatar.cc/150?u=${newIdNum}`
      };
      setStoredData('sof_profile_data', [...activeProfiles, newProfile]);
      db.addMember(newProfile).catch(err => console.error("Supabase error:", err));

      // Insert member list
      const memberList = getStoredData('sof_member_list_data', DEFAULT_MEMBER_LIST_DATA);
      setStoredData('sof_member_list_data', [...memberList, {
        id: idPrefix,
        code: newCode,
        name: mName.trim(),
        gender: mGender,
        type: '-'
      }]);

      // Insert blank savings row
      const savings = getStoredData('sof_savings_data', DEFAULT_SAVING_DATA);
      setStoredData('sof_savings_data', [...savings, {
        id: newCode,
        name: mName.trim(),
        gender: mGender,
        startCapital: '0.00',
        share: '0.00%',
        addSaving: '-',
        profit: '0',
        withdraw: '-',
        deductFee: '-',
        actualFee: '-',
        total: '0.00',
        checked: true
      }]);

      // Insert blank loans row
      const loans = getStoredData('sof_loans_data', DEFAULT_LOAN_DATA);
      setStoredData('sof_loans_data', [...loans, {
        id: newCode,
        name: mName.trim(),
        gender: mGender,
        loanValue: '-',
        repayment: '-',
        interest: '-',
        newLoan: '-',
        remaining: '-',
        interestPaid: '-',
        checked: true
      }]);

    } else {
      // Deposit member
      const newIdNum = depositProfiles.length + 1;
      const newCode = `D${String(newIdNum).padStart(3, '0')}`;
      const idPrefix = String(newIdNum);

      const newDepositProfile = {
        id: idPrefix,
        code: newCode,
        name: mName.trim(),
        gender: mGender,
        job: mJob.trim() || '-',
        spouse: '-',
        address: mAddress.trim() || '-',
        phone: mPhone.trim() || '-',
        facebook: '-',
        telegram: '-',
        joinDate: '-',
        dob: '-',
        idCard: '-',
        heir: '-',
        relation: '-',
        img: `https://i.pravatar.cc/150?img=${newIdNum}`
      };
      setStoredData('sof_deposit_profile_data', [...depositProfiles, newDepositProfile]);
      db.addMember(newDepositProfile).catch(err => console.error("Supabase error:", err));

      const memberList = getStoredData('sof_member_list_data', DEFAULT_MEMBER_LIST_DATA);
      setStoredData('sof_member_list_data', [...memberList, {
        id: idPrefix,
        code: newCode,
        name: mName.trim(),
        gender: mGender,
        type: 'បញ្ញើ'
      }]);

      // Insert blank savings row
      const depositSavings = getStoredData('sof_savings_deposit_data', DEFAULT_DEPOSIT_DATA);
      setStoredData('sof_savings_deposit_data', [...depositSavings, {
        id: newCode,
        name: mName.trim(),
        gender: mGender,
        village: '0',
        startCapital: '0.00',
        addSaving: '-',
        profit: '0',
        withdraw: '-',
        deductFee: '-',
        actualFee: '-',
        total: '0.00',
        checked: true
      }]);

      // Insert blank loans row
      const depositLoans = getStoredData('sof_loans_deposit_data', DEFAULT_DEPOSIT_LOAN_DATA);
      setStoredData('sof_loans_deposit_data', [...depositLoans, {
        id: newCode,
        name: mName.trim(),
        gender: mGender,
        loanValue: '-',
        repayment: '-',
        interest: '-',
        newLoan: '-',
        remaining: '-',
        interestPaid: '-',
        checked: true
      }]);
    }

    // Success log
    const logs = getStoredData('sof_query_logs', []);
    const newLog = `បានបន្ថែមសមាជិកថ្មីឈ្មោះ ${mName} (${mType})`;
    setStoredData('sof_query_logs', [newLog, ...logs].slice(0, 5));

    setSuccessMsg(`បានចុះឈ្មោះសមាជិក ${mName} ជាស្ថាពរ!`);
    setMName('');
    setMJob('');
    setMPhone('');
    setMAddress('');
    setTimeout(() => setSuccessMsg(''), 4500);
  };

  const handleAddSavings = (e: React.FormEvent) => {
    e.preventDefault();
    if (!sAmount || isNaN(parseFloat(sAmount))) return;

    const selectedM = allMembersForSelect.find(member => member.code === sMemberId);
    if (!selectedM) return;

    // Write the deposit into the SELECTED month's per-month store so the live engine
    // (Savings page, balance sheet, dashboard) picks it up for that exact month.
    const add = parseFloat(sAmount);
    const newSavRow = (extra: any) => ({
      id: sMemberId, name: selectedM.name, gender: selectedM.gender || 'ប្រុស',
      startCapital: '0.00', share: '0.00%', addSaving: add.toFixed(2), profit: '0',
      withdraw: '-', deductFee: '-', actualFee: '-', total: '0.00', checked: true, ...extra,
    });
    if (selectedM.type === 'សកម្ម') {
      const sBy = getStoredData('sof_savings_by_month', {}) || {};
      const rows = (Array.isArray(sBy[sMonth]) && sBy[sMonth].length) ? sBy[sMonth] : (savingsLiveTotals(sMonth)?.active || []);
      sBy[sMonth] = rows.some((r: any) => r.id === sMemberId)
        ? rows.map((r: any) => (r.id === sMemberId ? { ...r, addSaving: add.toFixed(2) } : r))
        : [...rows, newSavRow({})];
      setStoredData('sof_savings_by_month', sBy);
    } else {
      const dBy = getStoredData('sof_deposit_by_month', {}) || {};
      const rows = (Array.isArray(dBy[sMonth]) && dBy[sMonth].length) ? dBy[sMonth] : (savingsLiveTotals(sMonth)?.deposit || []);
      dBy[sMonth] = rows.some((r: any) => r.id === sMemberId)
        ? rows.map((r: any) => (r.id === sMemberId ? { ...r, addSaving: add.toFixed(2) } : r))
        : [...rows, newSavRow({ village: '0' })];
      setStoredData('sof_deposit_by_month', dBy);
    }

    // Success log
    const logs = getStoredData('sof_query_logs', []);
    const newLog = `បានបញ្ចូលប្រាក់សន្សំ $${sAmount} ជូន ${selectedM.name} សម្រាប់ខែ ${sMonth}`;
    setStoredData('sof_query_logs', [newLog, ...logs].slice(0, 5));

    setSuccessMsg(`បានរក្សាទុកការដាក់សន្សំ $${sAmount} ជូន ${selectedM.name}!`);
    setSAmount('');
    setTimeout(() => setSuccessMsg(''), 4500);
  };

  // A month's loan rows: the stored month, else carried forward from the most recent
  // month with data (flow fields cleared) so new entries land in the chosen month.
  const loanMonthRows = (by: any, month: string): any[] => {
    if (Array.isArray(by[month]) && by[month].length) return by[month];
    const idx = MONTHS_2026.indexOf(month);
    for (let i = idx - 1; i >= 0; i--) {
      const prev = by[MONTHS_2026[i]];
      if (Array.isArray(prev) && prev.length) return prev.map((r: any) => ({ ...r, newLoan: '-', repayment: '-', interestPaid: '-' }));
    }
    return [];
  };

  const handleAddLoan = (e: React.FormEvent) => {
    e.preventDefault();
    if (!lAmount || isNaN(parseFloat(lAmount))) return;

    const selectedM = allMembersForSelect.find(member => member.code === lMemberId);
    if (!selectedM) return;

    // New disbursement → the SELECTED month's loan store (newLoan + per-loan rate).
    const val = parseFloat(lAmount);
    const rateNum = parseFloat(lRate) || 1.5;
    const lBy = getStoredData('sof_loans_by_month', {}) || {};
    let rows = loanMonthRows(lBy, lMonth);
    if (rows.some((r: any) => r.id === lMemberId)) {
      rows = rows.map((r: any) => (r.id === lMemberId ? { ...r, newLoan: val.toFixed(2), rate: String(rateNum) } : r));
    } else {
      // Borrower has no row this month yet → add one so the disbursement is recorded.
      rows = [...rows, {
        id: lMemberId, name: selectedM.name, gender: selectedM.gender || 'ប្រុស',
        loanValue: '-', repayment: '-', interest: '-', newLoan: val.toFixed(2),
        remaining: '-', interestPaid: '-', rate: String(rateNum), checked: true,
      }];
    }
    lBy[lMonth] = rows;
    setStoredData('sof_loans_by_month', lBy);

    // Success log
    const logs = getStoredData('sof_query_logs', []);
    const newLog = `បានផ្តល់ប្រាក់កម្ចី $${lAmount} ជូន ${selectedM.name} សម្រាប់រយៈពេល ${lTerm} ខែ`;
    setStoredData('sof_query_logs', [newLog, ...logs].slice(0, 5));

    setSuccessMsg(`បានកត់ត្រាការផ្តល់កម្ចី $${lAmount} ជូន ${selectedM.name}!`);
    setLAmount('');
    setTimeout(() => setSuccessMsg(''), 4500);
  };

  const handleRepayment = (e: React.FormEvent) => {
    e.preventDefault();
    const pAmt = parseFloat(rPrincipal) || 0;
    const iAmt = parseFloat(rInterest) || 0;

    if (pAmt <= 0 && iAmt <= 0) return;

    const selectedM = allMembersForSelect.find(member => member.code === rMemberId);
    if (!selectedM) return;

    // Repayment (principal + interest paid) → the SELECTED month's loan store.
    const lBy = getStoredData('sof_loans_by_month', {}) || {};
    let rows = loanMonthRows(lBy, rMonth);
    const upd = { repayment: pAmt > 0 ? pAmt.toFixed(2) : '-', interestPaid: iAmt > 0 ? iAmt.toFixed(2) : '-' };
    rows = rows.some((r: any) => r.id === rMemberId)
      ? rows.map((r: any) => (r.id === rMemberId ? { ...r, ...upd } : r))
      : [...rows, {
          id: rMemberId, name: selectedM.name, gender: selectedM.gender || 'ប្រុស',
          loanValue: '-', interest: '-', newLoan: '-', remaining: '-', checked: true, ...upd,
        }];
    lBy[rMonth] = rows;
    setStoredData('sof_loans_by_month', lBy);

    // Success log
    const logs = getStoredData('sof_query_logs', []);
    const newLog = `បានកត់ត្រាការបង់សងកម្ចីពី ${selectedM.name}: ដើម $${pAmt} & ការ $${iAmt}`;
    setStoredData('sof_query_logs', [newLog, ...logs].slice(0, 5));

    setSuccessMsg(`បានកត់ត្រាការបង់សងមកវិញរួចរាល់សម្រាប់ ${selectedM.name}!`);
    setRPrincipal('');
    setRInterest('');
    setTimeout(() => setSuccessMsg(''), 4500);
  };

  const recentLogs = getStoredData('sof_query_logs', []);

  // Live summary figures. Prefer the latest imported monthly report snapshot
  // (from the Excel financial report); fall back to summing the per-member data.
  const dashSavings = getStoredData('sof_savings_data', DEFAULT_SAVING_DATA);
  const dashDeposit = getStoredData('sof_savings_deposit_data', DEFAULT_DEPOSIT_DATA);
  const dashGroup = getStoredData('sof_savings_group_data', DEFAULT_GROUP_DATA);
  const groupTotalBy = (needle: string) =>
    num((dashGroup.find((g: any) => (g.name || '').includes(needle)) || {}).total);
  const dashReports = getStoredData('sof_monthly_reports', {});
  // Pick the latest month that has data, using a fixed calendar order (jsonb key order is not reliable).
  const MONTH_ORDER = ['មករា 2026', 'កុម្ភៈ 2026', 'មីនា 2026', 'មេសា 2026', 'ឧសភា 2026', 'មិថុនា 2026', 'កក្កដា 2026', 'សីហា 2026', 'កញ្ញា 2026', 'តុលា 2026', 'វិច្ឆិកា 2026', 'ធ្នូ 2026'];
  const latestMonth = [...MONTH_ORDER].reverse().find(m => dashReports[m]);
  const latestBal = latestMonth ? (dashReports[latestMonth] || {}).balance : null;
  const dashVal = (key: string, fallback: number) =>
    (latestBal && typeof latestBal[key] === 'number') ? latestBal[key] : fallback;

  // LIVE summary: use the latest month that actually has savings data, and compute the
  // same way the balance sheet does (shared engine) so the cards match it exactly.
  const dashSavBy = getStoredData('sof_savings_by_month', {}) || {};
  const dashDataMonth = [...MONTH_ORDER].reverse().find((m) => Array.isArray(dashSavBy[m]) && dashSavBy[m].length) || latestMonth || MONTH_ORDER[0];
  const dashLive = savingsLiveTotals(dashDataMonth);
  const dashSumTotal = (rows: any[]) => (rows || []).reduce((s: number, r: any) => s + num(r.total), 0);
  const dashGroupLive = (needle: string) => {
    const g = (dashLive?.group || []).find((r: any) => (r.name || '').includes(needle));
    return g ? num(g.total) : 0;
  };
  // Total group fund = reserve + social + YES + retained interest (all R001–R004 rows).
  const dashGroupAll = (dashLive?.group || []).reduce((s: number, r: any) => s + num(r.total), 0);

  return (
    <PageView title="ផ្ទាំងគ្រប់គ្រងទូទៅ (Dashboard)" hideBack={true} hideDownload={true} hideAdd={true}>
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
        {[
          { label: 'ទុនសន្សំសមាជិកសកម្ម', value: '$' + fmtMoney(dashLive ? dashSumTotal(dashLive.active) : dashVal('memberSavings', sumField(dashSavings, 'total'))), color: 'text-[#0a6652]' },
          { label: 'ទុនសន្សំសមាជិកបញ្ញើ', value: '$' + fmtMoney(dashLive ? dashSumTotal(dashLive.deposit) : dashVal('depositSavings', sumField(dashDeposit, 'total'))), color: 'text-blue-600' },
          { label: 'គណនីសន្សំមានកាលកំណត់', value: '$' + fmtMoney(fixedTermBalanceOf(dashDataMonth)), color: 'text-amber-600' },
          { label: 'ទុនបម្រុង', value: '$' + fmtMoney(dashLive ? dashGroupLive('បម្រុង') : dashVal('reserve', groupTotalBy('បម្រុង'))), color: 'text-rose-500' },
          { label: 'ទុនសង្គម', value: '$' + fmtMoney(dashLive ? dashGroupLive('សង្គម') : dashVal('social', groupTotalBy('សង្គម'))), color: 'text-violet-600' },
          { label: 'ទុនសន្សំជាក្រុម (សរុប)', value: '$' + fmtMoney(dashGroupAll), color: 'text-teal-600' }
        ].map((stat, i) => (
          <div key={i} className="bg-[#eef8f2] p-4 md:p-5 rounded-2xl border border-green-100">
            <div className="text-[10px] md:text-xs font-bold text-slate-500 mb-1 leading-tight truncate-2-lines line-clamp-2 h-8 flex items-center">{stat.label}</div>
            <div className={`text-base md:text-lg lg:text-xl font-black ${stat.color}`}>{stat.value}</div>
          </div>
        ))}
      </div>
      
      {/* ផ្នែកគ្រប់គ្រងប្រព័ន្ធជម្រើស (Admin Management Quick Options List) */}
      <div className="space-y-4">
        <h3 className="text-xs font-black text-[#0a6652] uppercase tracking-wider flex items-center gap-2">
          <Menu size={16} />
          <span>ជម្រើសគ្រប់គ្រងគណនេយ្យ និងប្រព័ន្ធ</span>
        </h3>
        
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {[
            { 
              title: "ព័ត៌មានសមាជិក (Members)", 
              desc: "គ្រប់គ្រង និងមើលប្រវត្តិរូបសមាជិកសកម្ម/បញ្ញើ", 
              path: "/members", 
              icon: <Users className="w-5 h-5" />, 
              color: "bg-teal-50 text-[#0a6652] border-teal-100/60 hover:bg-teal-100/90" 
            },
            { 
              title: "ការសន្សំប្រាក់ (Savings)", 
              desc: "កត់ត្រា និងគ្រប់គ្រងការសន្សំប្រាក់របស់សមាជិក", 
              path: "/savings", 
              icon: <Wallet className="w-5 h-5" />, 
              color: "bg-emerald-50 text-emerald-600 border-emerald-100/60 hover:bg-emerald-100/90" 
            },
            { 
              title: "ការផ្តល់កម្ចីប្រាក់ (Loans)", 
              desc: "គ្រប់គ្រងទិន្នន័យកម្ចី លក្ខខណ្ឌ និងតារាងបង់រំលស់", 
              path: "/loans", 
              icon: <HandCoins className="w-5 h-5" />, 
              color: "bg-amber-50 text-amber-600 border-amber-100/60 hover:bg-amber-100/90" 
            },
            { 
              title: "ការចំណាយ (Expenses)", 
              desc: "កត់ត្រា និងគ្រប់គ្រងរាល់ការចំណាយផ្សេងៗ", 
              path: "/expenses", 
              icon: <Receipt className="w-5 h-5" />, 
              color: "bg-blue-50 text-blue-600 border-blue-100/60 hover:bg-blue-100/90" 
            },
            { 
              title: "របាយការណ៍ហិរញ្ញវត្ថុ (Reports)", 
              desc: "មើលតារាងតុល្យការ ចំណូលចំណាយ និងវិភាគសង្ខេប", 
              path: "/reports", 
              icon: <BarChart3 className="w-5 h-5" />, 
              color: "bg-indigo-50 text-indigo-600 border-indigo-100/60 hover:bg-indigo-100/90" 
            },
            { 
              title: "ប្រវត្តិប្រតិបត្តិការ (History)", 
              desc: "ពិនិត្យមើលរាល់សកម្មភាព និងប្រតិបត្តិការក្នុងប្រព័ន្ធ", 
              path: "/history", 
              icon: <TrendingUp className="w-5 h-5" />, 
              color: "bg-rose-50 text-rose-600 border-rose-100/60 hover:bg-rose-100/90" 
            },
            { 
              title: "ការកំណត់ប្រព័ន្ធ (Settings)", 
              desc: "កែសម្រួលគណនី លេខសម្ងាត់ និងការកំណត់ផ្សេងៗ", 
              path: "/settings", 
              icon: <Settings className="w-5 h-5" />, 
              color: "bg-slate-50 text-slate-600 border-slate-200/60 hover:bg-slate-100" 
            }
          ].map((item) => (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className={`flex items-start gap-4 p-4 rounded-2xl border text-left transition-all duration-200 active:scale-[0.98] cursor-pointer ${item.color}`}
            >
              <div className="p-3 bg-white rounded-xl shadow-sm border border-slate-100/30">
                {item.icon}
              </div>
              <div className="flex-1 min-w-0">
                <h4 className="font-extrabold text-xs text-slate-800 mb-1">{item.title}</h4>
                <p className="text-[10px] text-slate-500 font-bold leading-normal truncate">{item.desc}</p>
              </div>
            </button>
          ))}
        </div>
      </div>
      {/* ផ្នែកបញ្ចូលទិន្នន័យ (Data Input Dashboard Module) */}
      <div className="bg-white p-5 md:p-6 rounded-2xl border border-slate-100 shadow-sm mb-8">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-100">
          <div>
            <h3 className="text-sm font-black text-slate-800 flex items-center gap-2">
              <span className="p-1.5 bg-[#eef8f2] text-[#0a6652] rounded-lg">➕</span>
              <span>ការបញ្ចូលទិន្នន័យថ្មី (New Data Entry)</span>
            </h3>
            <p className="text-[10px] text-slate-400 font-bold mt-1">ជ្រើសរើសប្រភេទប្រតិបត្តិការខាងក្រោមដើម្បីបញ្ចូលទៅក្នុងមូលដ្ឋានទិន្នន័យ</p>
          </div>
          
          {successMsg ? (
            <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-bold px-4 py-2 rounded-xl animate-pulse flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping"></span>
              {successMsg}
            </div>
          ) : (
            <div className="bg-slate-50 border border-slate-200 text-slate-500 text-[10px] font-bold px-3 py-1.5 rounded-xl">
              ស្ថានភាពបំពេញ៖ ធម្មតា
            </div>
          )}
        </div>

        {/* Tab Selection */}
        <div className="flex gap-2 p-1.5 bg-slate-50 rounded-xl my-4 overflow-x-auto">
          {[
            { id: 'savings', label: '💰 បញ្ចូលប្រាក់សន្សំ' },
            { id: 'loan', label: '🤝 ផ្តល់ប្រាក់កម្ចី' },
            { id: 'repayment', label: '📈 បង់សងកម្ចី' },
            { id: 'member', label: '👤 ចុះឈ្មោះសមាជិក' }
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                setEntryTab(tab.id as any);
              }}
              className={`flex-1 whitespace-nowrap text-xs font-extrabold px-4 py-2 rounded-lg transition-all ${
                entryTab === tab.id 
                  ? 'bg-white text-[#0a6652] shadow-sm border border-slate-200/50' 
                  : 'text-slate-600 hover:text-[#0a6652]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* 1. SAVINGS ENTRY FORM */}
        {entryTab === 'savings' && (
          <form onSubmit={handleAddSavings} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-[10px] font-bold text-slate-500 mb-1.5">ជ្រើសរើសសមាជិក (Select Member)</label>
                <select
                  value={sMemberId}
                  onChange={(e) => setSMemberId(e.target.value)}
                  className="w-full text-xs font-bold border border-slate-200 rounded-xl px-3 py-2.5 bg-white focus:border-[#0a6652] outline-none"
                >
                  {allMembersForSelect.map((m: any) => (
                    <option key={m.code} value={m.code}>
                      [{m.code}] {m.name} ({m.type})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-500 mb-1.5">សម្រាប់ខែ (For Month)</label>
                <select
                  value={sMonth}
                  onChange={(e) => setSMonth(e.target.value)}
                  className="w-full text-xs font-bold border border-slate-200 rounded-xl px-3 py-2.5 bg-white focus:border-[#0a6652] outline-none"
                >
                  {['មករា 2026', 'កុម្ភៈ 2026', 'មីនា 2026', 'មេសា 2026', 'ឧសភា 2026', 'មិថុនា 2026', 'កក្កដា 2026', 'សីហា 2026', 'កញ្ញា 2026', 'តុលា 2026', 'វិច្ឆិកា 2026', 'ធ្នូ 2026'].map(m => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-500 mb-1.5">ចំនួនទឹកប្រាក់សន្សំ (Deposit Amount $)</label>
                <div className="relative">
                  <span className="absolute left-3 top-2.5 text-xs font-bold text-slate-400">$</span>
                  <input
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                    value={sAmount}
                    onChange={(e) => setSAmount(e.target.value)}
                    className="w-full text-xs font-bold border border-slate-200 rounded-xl pl-8 pr-3 py-2.5 bg-white focus:border-[#0a6652] outline-none"
                    required
                  />
                </div>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="submit"
                className="bg-[#0a6652] hover:bg-[#085343] text-white font-extrabold text-xs px-6 py-2.5 rounded-xl transition-all shadow-sm flex items-center gap-2 cursor-pointer active:scale-95"
              >
                <Save size={14} />
                <span>រក្សាទុកទិន្នន័យសន្សំ</span>
              </button>
            </div>
          </form>
        )}

        {/* 2. LOAN ENTRY FORM */}
        {entryTab === 'loan' && (
          <form onSubmit={handleAddLoan} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
              <div>
                <label className="block text-[10px] font-bold text-slate-500 mb-1.5">សមាជិកស្នើសុំកម្ចី (Borrower)</label>
                <select
                  value={lMemberId}
                  onChange={(e) => setLMemberId(e.target.value)}
                  className="w-full text-xs font-bold border border-slate-200 rounded-xl px-3 py-2.5 bg-white focus:border-[#0a6652] outline-none"
                >
                  {allMembersForSelect.filter((m: any) => m.type === 'សកម្ម').map((m: any) => (
                    <option key={m.code} value={m.code}>
                      [{m.code}] {m.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-500 mb-1.5">ខែ (Month)</label>
                <select
                  value={lMonth}
                  onChange={(e) => setLMonth(e.target.value)}
                  className="w-full text-xs font-bold border border-slate-200 rounded-xl px-3 py-2.5 bg-white focus:border-[#0a6652] outline-none"
                >
                  {MONTHS_2026.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-500 mb-1.5">ទំហំប្រាក់កម្ចី (Loan Value $)</label>
                <div className="relative">
                  <span className="absolute left-3 top-2.5 text-xs font-bold text-slate-400">$</span>
                  <input
                    type="number"
                    placeholder="0.00"
                    value={lAmount}
                    onChange={(e) => setLAmount(e.target.value)}
                    className="w-full text-xs font-bold border border-slate-200 rounded-xl pl-8 pr-3 py-2.5 bg-white focus:border-[#0a6652] outline-none"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-500 mb-1.5">អត្រាការប្រាក់គិតជា % (Interest %)</label>
                <input
                  type="text"
                  placeholder="1.5%"
                  value={lRate}
                  onChange={(e) => setLRate(e.target.value)}
                  className="w-full text-xs font-bold border border-slate-200 rounded-xl px-3 py-2.5 bg-white focus:border-[#0a6652] outline-none"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-500 mb-1.5">រយៈពេលកម្ចី - ខែ (Duration)</label>
                <select
                  value={lTerm}
                  onChange={(e) => setLTerm(e.target.value)}
                  className="w-full text-xs font-bold border border-slate-200 rounded-xl px-3 py-2.5 bg-white focus:border-[#0a6652] outline-none"
                >
                  {['6', '12', '18', '24'].map(t => (
                    <option key={t} value={t}>{t} ខែ (Months)</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="submit"
                className="bg-[#0a6652] hover:bg-[#085343] text-white font-extrabold text-xs px-6 py-2.5 rounded-xl transition-all shadow-sm flex items-center gap-2 cursor-pointer active:scale-95"
              >
                <Save size={14} />
                <span>អនុម័ត និងរក្សាទុកការផ្តល់កម្ចី</span>
              </button>
            </div>
          </form>
        )}

        {/* 3. REPAYMENT ENTRY FORM */}
        {entryTab === 'repayment' && (
          <form onSubmit={handleRepayment} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <label className="block text-[10px] font-bold text-slate-500 mb-1.5">សមាជិកបង់សង (Returning Member)</label>
                <select
                  value={rMemberId}
                  onChange={(e) => setRMemberId(e.target.value)}
                  className="w-full text-xs font-bold border border-slate-200 rounded-xl px-3 py-2.5 bg-white focus:border-[#0a6652] outline-none"
                >
                  {allMembersForSelect.filter((m: any) => m.type === 'សកម្ម').map((m: any) => (
                    <option key={m.code} value={m.code}>
                      [{m.code}] {m.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-500 mb-1.5">ប្រាក់ដើមបង់សង (Paid Principal $)</label>
                <div className="relative">
                  <span className="absolute left-3 top-2.5 text-xs font-bold text-slate-400">$</span>
                  <input
                    type="number"
                    placeholder="0.00"
                    value={rPrincipal}
                    onChange={(e) => setRPrincipal(e.target.value)}
                    className="w-full text-xs font-bold border border-slate-200 rounded-xl pl-8 pr-3 py-2.5 bg-white focus:border-[#0a6652] outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-500 mb-1.5">ប្រាក់ការបង់សង (Paid Interest $)</label>
                <div className="relative">
                  <span className="absolute left-3 top-2.5 text-xs font-bold text-slate-400">$</span>
                  <input
                    type="number"
                    placeholder="0.00"
                    value={rInterest}
                    onChange={(e) => setRInterest(e.target.value)}
                    className="w-full text-xs font-bold border border-slate-200 rounded-xl pl-8 pr-3 py-2.5 bg-white focus:border-[#0a6652] outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-500 mb-1.5">សម្រាប់ខែ (For Month)</label>
                <select
                  value={rMonth}
                  onChange={(e) => setRMonth(e.target.value)}
                  className="w-full text-xs font-bold border border-slate-200 rounded-xl px-3 py-2.5 bg-white focus:border-[#0a6652] outline-none"
                >
                  {['មករា 2026', 'កុម្ភៈ 2026', 'មីនា 2026', 'មេសា 2026', 'ឧសភា 2026', 'មិថុនា 2026', 'កក្កដា 2026', 'សីហា 2026', 'កញ្ញា 2026', 'តុលា 2026', 'វិច្ឆិកា 2026', 'ធ្នូ 2026'].map(m => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="submit"
                className="bg-[#0a6652] hover:bg-[#085343] text-white font-extrabold text-xs px-6 py-2.5 rounded-xl transition-all shadow-sm flex items-center gap-2 cursor-pointer active:scale-95"
              >
                <Save size={14} />
                <span>កត់ត្រាការបង់សងរំលស់</span>
              </button>
            </div>
          </form>
        )}

        {/* 4. NEW MEMBER REGISTRATION FORM */}
        {entryTab === 'member' && (
          <form onSubmit={handleAddMember} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <label className="block text-[10px] font-bold text-slate-500 mb-1.5">ឈ្មោះសមាជិក (Full Name)</label>
                <input
                  type="text"
                  placeholder="ឧ. សុខ ពិសិដ្ឋ"
                  value={mName}
                  onChange={(e) => setMName(e.target.value)}
                  className="w-full text-xs font-bold border border-slate-200 rounded-xl px-3 py-2.5 bg-white focus:border-[#0a6652] outline-none"
                  required
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-500 mb-1.5">ភេទ (Gender)</label>
                <select
                  value={mGender}
                  onChange={(e) => setMGender(e.target.value)}
                  className="w-full text-xs font-bold border border-slate-200 rounded-xl px-3 py-2.5 bg-white focus:border-[#0a6652] outline-none"
                >
                  <option value="ប្រុស">ប្រុស (Male)</option>
                  <option value="ស្រី">ស្រី (Female)</option>
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-500 mb-1.5">ប្រភេទសមាជិក (Member Type)</label>
                <select
                  value={mType}
                  onChange={(e) => setMType(e.target.value)}
                  className="w-full text-xs font-bold border border-slate-200 rounded-xl px-3 py-2.5 bg-white focus:border-[#0a6652] outline-none"
                >
                  <option value="សកម្ម">សមាជិកសកម្ម (Active)</option>
                  <option value="បញ្ញើ">សមាជិកបញ្ញើ (Deposit)</option>
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-500 mb-1.5">តួនាទីសមាជិក (Status / Role)</label>
                <select
                  value={mRole}
                  onChange={(e) => setMRole(e.target.value)}
                  disabled={mType === 'បញ្ញើ'}
                  className="w-full text-xs font-bold border border-slate-200 rounded-xl px-3 py-2.5 bg-white focus:border-[#0a6652] outline-none disabled:bg-slate-100 disabled:text-slate-400"
                >
                  <option value="ម្ចាស់ភាគហ៊ុន">ម្ចាស់ភាគហ៊ុន (Shareholder)</option>
                  <option value="អភិបាល & ម្ចាស់ភាគហ៊ុន">អភិបាល (Director & Shareholder)</option>
                  <option value="ប្រធាន & ម្ចាស់ភាគហ៊ុន">ប្រធាន (President)</option>
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-500 mb-1.5">មុខរបរ (Occupation)</label>
                <input
                  type="text"
                  placeholder="ឧ. គ្រូ ឬសេរី"
                  value={mJob}
                  onChange={(e) => setMJob(e.target.value)}
                  className="w-full text-xs font-bold border border-slate-200 rounded-xl px-3 py-2.5 bg-white focus:border-[#0a6652] outline-none"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-500 mb-1.5">លេខទូរស័ព្ទ (Phone Number)</label>
                <input
                  type="text"
                  placeholder="ឧ. 012345678"
                  value={mPhone}
                  onChange={(e) => setMPhone(e.target.value)}
                  className="w-full text-xs font-bold border border-slate-200 rounded-xl px-3 py-2.5 bg-white focus:border-[#0a6652] outline-none"
                />
              </div>

              <div className="md:col-span-2">
                <label className="block text-[10px] font-bold text-slate-500 mb-1.5">អាសយដ្ឋាន (Address Details)</label>
                <input
                  type="text"
                  placeholder="ឧ. ភូមិកំពង់ស្ពឺ ឃុំកណ្តាល..."
                  value={mAddress}
                  onChange={(e) => setMAddress(e.target.value)}
                  className="w-full text-xs font-bold border border-slate-200 rounded-xl px-3 py-2.5 bg-white focus:border-[#0a6652] outline-none"
                />
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="submit"
                className="bg-[#0a6652] hover:bg-[#085343] text-white font-extrabold text-xs px-6 py-2.5 rounded-xl transition-all shadow-sm flex items-center gap-2 cursor-pointer active:scale-95"
              >
                <Save size={14} />
                <span>រក្សាទុកសមាជិកថ្មី</span>
              </button>
            </div>
          </form>
        )}

        {/* Recent Transactions List (Mini-terminal) */}
        {recentLogs.length > 0 && (
          <div className="mt-5 pt-4 border-t border-slate-100">
            <h4 className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
              <span>កំណត់ត្រាបញ្ចូលចុងក្រោយ (Recent Inputs Log)</span>
            </h4>
            <div className="bg-slate-50 rounded-xl p-3 border border-slate-200/40 text-[10px] space-y-1.5 font-mono text-slate-600">
              {recentLogs.map((log: string, idx: number) => (
                <div key={idx} className="flex items-center gap-2">
                  <span className="text-[#0a6652] font-semibold">✓</span>
                  <span>{log}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

    </PageView>
  );
}

function Members() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('list');
  const [searchQuery, setSearchQuery] = useState('');

  const [profileData, setProfileData] = useState(() => getStoredData('sof_profile_data', DEFAULT_PROFILE_DATA));
  const [depositProfileData, setDepositProfileData] = useState(() => getStoredData('sof_deposit_profile_data', DEFAULT_DEPOSIT_PROFILE_DATA));
  const [memberListData, setMemberListData] = useState(() => getStoredData('sof_member_list_data', DEFAULT_MEMBER_LIST_DATA));

  const [editingListIndex, setEditingListIndex] = useState<number | null>(null);
  const [editingListData, setEditingListData] = useState<any>(null);

  const displayedMembers = memberListData
    .map((row: any, idx: number) => ({ ...row, originalIndex: idx }))
    .filter((row: any) => {
      if (activeTab === 'list') {
        if (row.type === 'បញ្ញើ') return false;
      } else if (activeTab === 'list_deposit') {
        if (row.type !== 'បញ្ញើ') return false;
      } else {
        return false;
      }
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const nameMatch = row.name?.toLowerCase().includes(query);
        const codeMatch = row.code?.toLowerCase().includes(query);
        return nameMatch || codeMatch;
      }
      return true;
    });

  const handleEditMember = (index: number, row: any) => {
    setEditingListIndex(index);
    setEditingListData({ ...row });
  };

  const handleSaveEditMember = (index: number) => {
    // Check global duplicate for edits (excluding self)
    const newName = editingListData.name.trim();
    const selfCode = editingListData.code;
    
    const activeProfiles = getStoredData('sof_profile_data', DEFAULT_PROFILE_DATA);
    const depositProfiles = getStoredData('sof_deposit_profile_data', DEFAULT_DEPOSIT_PROFILE_DATA);
    
    const isDuplicate = activeProfiles.some((p: any) => p.name.toLowerCase() === newName.toLowerCase() && p.code !== selfCode && !(typeof p.id === 'string' && p.id.includes(selfCode))) ||
                        depositProfiles.some((p: any) => p.name.toLowerCase() === newName.toLowerCase() && p.code !== selfCode && !(typeof p.id === 'string' && p.id.includes(selfCode)));

    if (isDuplicate) {
      alert('សមាជិកដែលមានឈ្មោះនេះមានរួចហើយ! ឈ្មោះមិនត្រូវស្ទួនឡើយ។');
      return;
    }

    const newData = [...memberListData];
    newData[index] = editingListData;
    setMemberListData(newData);
    setStoredData('sof_member_list_data', newData);
    
    const code = editingListData.code;
    if (code) {
      const activeData = [...profileData];
      const activeIdx = activeData.findIndex((p: any) => String(p.id).includes(code) || p.code === code);
      if (activeIdx > -1) {
        activeData[activeIdx].name = editingListData.name;
        activeData[activeIdx].gender = editingListData.gender;
        activeData[activeIdx].role = editingListData.type;
        setProfileData(activeData);
        setStoredData('sof_profile_data', activeData);
      }
      
      const depData = [...depositProfileData];
      const depIdx = depData.findIndex((p: any) => String(p.id).includes(code) || p.code === code);
      if (depIdx > -1) {
        depData[depIdx].name = editingListData.name;
        depData[depIdx].gender = editingListData.gender;
        setDepositProfileData(depData);
        setStoredData('sof_deposit_profile_data', depData);
      }

      db.updateMember(code, editingListData).catch(err => console.error("Supabase error:", err));
    }
    
    setEditingListIndex(null);
    setEditingListData(null);
  };

  const handleDeleteMember = (index: number, showConfirm = true) => {
    if (showConfirm && !window.confirm('តើអ្នកពិតជាចង់លុបសមាជិកនេះមែនទេ?')) return;
    const newData = [...memberListData];
    const deleted = newData.splice(index, 1)[0];
    setMemberListData(newData);
    setStoredData('sof_member_list_data', newData);
    if (deleted && deleted.code) {
      db.deleteMember(deleted.code).catch(err => console.error("Supabase error:", err));
      
      const code = deleted.code;

      const filterProfiles = (data: any[]) => data.filter((x: any) => {
        const id = typeof x.id === 'string' ? x.id.split(' ').pop() : x.code;
        return (id || x.code) !== code;
      });

      const pfd = filterProfiles(getStoredData('sof_profile_data', DEFAULT_PROFILE_DATA));
      setProfileData(pfd);
      setStoredData('sof_profile_data', pfd);

      const dpfd = filterProfiles(getStoredData('sof_deposit_profile_data', DEFAULT_DEPOSIT_PROFILE_DATA));
      setDepositProfileData(dpfd);
      setStoredData('sof_deposit_profile_data', dpfd);

      const sd = getStoredData('sof_savings_data', DEFAULT_SAVING_DATA).filter((x: any) => x.id !== code);
      setStoredData('sof_savings_data', sd);

      const dsd = getStoredData('sof_savings_deposit_data', DEFAULT_DEPOSIT_DATA).filter((x: any) => x.id !== code);
      setStoredData('sof_savings_deposit_data', dsd);

      const ld = getStoredData('sof_loans_data', DEFAULT_LOAN_DATA).filter((x: any) => x.id !== code);
      setStoredData('sof_loans_data', ld);

      const dld = getStoredData('sof_loans_deposit_data', DEFAULT_DEPOSIT_LOAN_DATA).filter((x: any) => x.id !== code);
      setStoredData('sof_loans_deposit_data', dld);
    }
  };

  const getKhmerNum = (num: number) => {
    return String(num);
  };

  const handleDeleteAllMembers = () => {
    if (window.confirm('តើអ្នកពិតជាចង់លុបសមាជិកទាំងអស់មែនទេ? (សកម្មភាពនេះមិនអាចត្រឡប់វិញបានទេ)')) {
      setMemberListData([]);
      setProfileData([]);
      setDepositProfileData([]);
      setStoredData('sof_member_list_data', []);
      setStoredData('sof_profile_data', []);
      setStoredData('sof_deposit_profile_data', []);
      setStoredData('sof_savings_data', []);
      setStoredData('sof_savings_deposit_data', []);
      setStoredData('sof_loans_data', []);
      setStoredData('sof_loans_deposit_data', []);
    }
  };

  const handleSaveAllMembers = async () => {
    alert('ទិន្នន័យត្រូវបានរក្សាទុកទៅ Supabase ដោយជោគជ័យ!');
    // Any remaining bulk sync logic can be implemented here...
  };

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const fileExt = file.name.split('.').pop()?.toLowerCase();

    if (fileExt === 'xlsx' || fileExt === 'xls' || fileExt === 'csv') {
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const ab = event.target?.result as ArrayBuffer;
          const wb = XLSX.read(ab, { type: 'array' });
          let importedAnyData = false;

          wb.SheetNames.forEach(sheetName => {
            if (sheetName.startsWith('sof_')) {
              const ws = wb.Sheets[sheetName];
              const sheetData = XLSX.utils.sheet_to_json(ws);
              localStorage.setItem(sheetName, JSON.stringify(sheetData));
              importedAnyData = true;
            }
          });

          // If no sheets matching 'sof_', assume it's a generic members list import
          if (!importedAnyData && wb.SheetNames.length > 0) {
             const firstSheetName = wb.SheetNames[0];
             const ws = wb.Sheets[firstSheetName];
             const data = XLSX.utils.sheet_to_json(ws) as any[];
             if (data && data.length > 0) {
               const isDeposit = (activeTab === 'list_deposit' || activeTab === 'deposit_profile');
               
               const activeProfiles = getStoredData('sof_profile_data', DEFAULT_PROFILE_DATA);
               const depositProfiles = getStoredData('sof_deposit_profile_data', DEFAULT_DEPOSIT_PROFILE_DATA);
               const currentMembers = getStoredData('sof_member_list_data', DEFAULT_MEMBER_LIST_DATA);
               
               const savings = getStoredData('sof_savings_data', DEFAULT_SAVING_DATA);
               const depositSavings = getStoredData('sof_savings_deposit_data', DEFAULT_DEPOSIT_DATA);
               const loans = getStoredData('sof_loans_data', DEFAULT_LOAN_DATA);
               const depositLoans = getStoredData('sof_loans_deposit_data', DEFAULT_DEPOSIT_LOAN_DATA);
               
               let count = 0;
               let skipCount = 0;
               data.forEach(row => {
                  const name = String(row['ឈ្មោះ'] || row['Name'] || row['Full Name'] || Object.values(row)[0] || '').trim();
                  if (!name) return;
                  
                  // Skip duplicate names
                  const isDuplicate = activeProfiles.some((p: any) => p.name.toLowerCase() === name.toLowerCase()) ||
                                      depositProfiles.some((p: any) => p.name.toLowerCase() === name.toLowerCase());
                  if (isDuplicate) {
                    skipCount++;
                    return;
                  }

                  const totalExisting = isDeposit ? depositProfiles.length : activeProfiles.length;
                  const newIdNum = totalExisting + 1;
                  const newCode = (isDeposit ? 'D' : 'C') + String(newIdNum).padStart(3, '0');
                  const idPrefix = String(newIdNum);
                  const newId = `${idPrefix} ${newCode}`;
                  
                  const targetType = isDeposit ? 'បញ្ញើ' : (row['ប្រភេទសមាជិក'] || row['ប្រភេទ'] || row['តួនាទី'] || 'សកម្ម');
                  const gender = row['ភេទ'] || 'ប្រុស';
                  
                  const newProfileItem = {
                    id: newId,
                    name: String(name),
                    gender: gender,
                    role: row['តួនាទី'] || (isDeposit ? 'សមាជិកបញ្ញើ' : 'សមាជិក'),
                    job: row['មុខរបរ'] || '-',
                    phone: row['លេខទូរស័ព្ទ'] || '-',
                    dob: row['ថ្ងៃខែឆ្នាំកំណើត'] || '-',
                    address: row['ទីលំនៅ'] || '-',
                    joinDate: new Date().toISOString().split('T')[0],
                    spouse: '-',
                    relation: '-',
                    img: `https://i.pravatar.cc/150?u=${newIdNum}`
                  };
                  
                  if (isDeposit) {
                    depositProfiles.push(newProfileItem);
                    depositSavings.push({
                      id: newCode,
                      name: String(name),
                      gender: gender,
                      village: '0',
                      startCapital: '0.00',
                      addSaving: '-',
                      profit: '0',
                      withdraw: '-',
                      deductFee: '-',
                      actualFee: '-',
                      total: '0.00',
                      checked: true
                    });
                    depositLoans.push({
                      id: newCode,
                      name: String(name),
                      gender: gender,
                      loanValue: '-',
                      repayment: '-',
                      interest: '-',
                      newLoan: '-',
                      remaining: '-',
                      interestPaid: '-',
                      checked: true
                    });
                  } else {
                    activeProfiles.push(newProfileItem);
                    savings.push({
                      id: newCode,
                      name: String(name),
                      gender: gender,
                      startCapital: '0.00',
                      share: '0.00%',
                      addSaving: '-',
                      profit: '0',
                      withdraw: '-',
                      deductFee: '-',
                      actualFee: '-',
                      total: '0.00',
                      checked: true
                    });
                    loans.push({
                      id: newCode,
                      name: String(name),
                      gender: gender,
                      loanValue: '-',
                      repayment: '-',
                      interest: '-',
                      newLoan: '-',
                      remaining: '-',
                      interestPaid: '-',
                      checked: true
                    });
                  }
                  
                  currentMembers.push({
                    id: idPrefix,
                    code: newCode,
                    name: String(name),
                    gender: gender,
                    type: targetType
                  });
                  count++;
               });
               
               if (isDeposit) {
                 setStoredData('sof_deposit_profile_data', depositProfiles);
                 setStoredData('sof_savings_deposit_data', depositSavings);
                 setStoredData('sof_loans_deposit_data', depositLoans);
               } else {
                 setStoredData('sof_profile_data', activeProfiles);
                 setStoredData('sof_savings_data', savings);
                 setStoredData('sof_loans_data', loans);
               }
               setStoredData('sof_member_list_data', currentMembers);
               
               let msg = `បាននាំចូលសមាជិកជោគជ័យ ចំនួន ${count} នាក់កូដថ្មីៗ។`;
               if (skipCount > 0) {
                 msg += `\nមានឈ្មោះជាន់គ្នា ចំនួន ${skipCount} នាក់ត្រូវបានរំលង។`;
               }
               alert(msg);
               window.location.reload();
               return;
             }
          }

          if (importedAnyData) {
            alert('ទិន្នន័យពី Excel ត្រូវបាននាំចូលដោយជោគជ័យ! ប្រព័ន្ធនឹងដំណើរការឡើងវិញ...');
            window.location.reload();
          } else {
            alert('ឯកសារ Excel មិនមានទិន្នន័យត្រូវគ្នាទេ។');
          }
        } catch (err) {
          alert('មានបញ្ហាក្នុងការអានឯកសារ Excel។ សូមបញ្ជាក់ថាវាពិតជាឯកសារ Excel ត្រឹមត្រូវ។');
        }
      };
      reader.readAsArrayBuffer(file);
      return;
    }

    // Default global JSON import
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        const data = JSON.parse(text);
        if (typeof data === 'object' && data !== null) {
          Object.keys(data).forEach(key => {
            if (key.startsWith('sof_')) {
              localStorage.setItem(key, JSON.stringify(data[key]));
            }
          });
          alert('ទិន្នន័យត្រូវបាននាំចូលដោយជោគជ័យ! ប្រព័ន្ធនឹងដំណើរការឡើងវិញ...');
          window.location.reload();
        } else {
          throw new Error("Invalid format");
        }
      } catch (err) {
        alert('ឯកសារមិនត្រឹមត្រូវ! សូមជ្រើសរើសឯកសារទម្រង់ JSON ដែលបានទាញយក ឬ Excel ត្រឹមត្រូវ។');
      }
    };
    reader.readAsText(file);
  };

  return (
    <PageView 
      title="ពត៌មានសមាជិក (Members)" 
      onAddClick={() => navigate('/dashboard', { state: { tab: 'member' } })}
      onUpload={handleUpload}
    >
      {/* Tabs */}
      <div className="flex flex-wrap gap-3 mb-6">
        <button 
          onClick={() => setActiveTab('list')}
          className={`px-6 py-2.5 rounded-full font-bold text-sm transition-colors ${activeTab === 'list' ? 'bg-[#0a6652] text-white shadow-md' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
        >
          សមាជិកសកម្ម
        </button>
        <button 
          onClick={() => setActiveTab('list_deposit')}
          className={`px-6 py-2.5 rounded-full font-bold text-sm transition-colors ${activeTab === 'list_deposit' ? 'bg-[#0a6652] text-white shadow-md' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
        >
          សមាជិកបញ្ញើរសន្សំ
        </button>
        <button 
          onClick={() => setActiveTab('profile')}
          className={`px-6 py-2.5 rounded-full font-bold text-sm transition-colors ${activeTab === 'profile' ? 'bg-[#0a6652] text-white shadow-md' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
        >
          ប្រវតិ្តរូបសមាជិកសកម្ម
        </button>
        <button 
          onClick={() => setActiveTab('deposit_profile')}
          className={`px-6 py-2.5 rounded-full font-bold text-sm transition-colors ${activeTab === 'deposit_profile' ? 'bg-[#0a6652] text-white shadow-md' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
        >
          ប្រវតិ្តរូបសមាជិកបញ្ញើ
        </button>
      </div>

      {(activeTab === 'list' || activeTab === 'list_deposit') && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col p-1 px-4 md:px-6 md:p-6 mb-6">
          <div className="flex items-center gap-3 bg-slate-50 border border-slate-200 rounded-full px-4 py-2 w-full md:w-96 mb-6">
            <Search size={18} className="text-slate-400" />
            <input 
              type="text" 
              placeholder="ស្វែងរកឈ្មោះសមាជិក..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="bg-transparent border-none outline-none w-full text-sm font-medium" 
            />
          </div>
          <div className="frz3 overflow-x-auto border border-slate-300 rounded-xl">
            <table className="w-full text-left border-collapse text-sm min-w-[800px]">
              <thead className="bg-[#eef8f2] text-[#0a6652] border-b-[3px] border-[#0a6652] text-center font-bold">
                <tr>
                  <th className="px-3 py-3 border-r border-slate-300 align-middle">ល.រ</th>
                  <th className="px-3 py-3 border-r border-slate-300 align-middle">លេខ ID</th>
                  <th className="px-3 py-3 border-r border-slate-300 align-middle">ឈ្មោះ</th>
                  <th className="px-3 py-3 border-r border-slate-300 align-middle">ភេទ</th>
                  <th className="px-3 py-3 border-r border-slate-300 align-middle">ប្រភេទសមាជិក</th>
                  <th className="px-3 py-3 align-middle w-24">ជម្រើស</th>
                </tr>
              </thead>
              <tbody>
                {displayedMembers.map((row, i) => (
                  <tr key={i} className="border-b border-slate-300 hover:bg-slate-50 transition-colors">
                    {editingListIndex === row.originalIndex ? (
                      <>
                        <td className="px-1 py-1 border-r border-slate-300 text-center text-slate-500 font-medium">{getKhmerNum(i + 1)}</td>
                        <td className="px-1 py-1 border-r border-slate-300 text-center"><input type="text" className="w-full px-2 py-1 border border-slate-300 rounded" value={editingListData.code} onChange={(e) => setEditingListData({...editingListData, code: e.target.value})} /></td>
                        <td className="px-1 py-1 border-r border-slate-300"><input type="text" className="w-full px-2 py-1 border border-slate-300 rounded" value={editingListData.name} onChange={(e) => setEditingListData({...editingListData, name: e.target.value})} /></td>
                        <td className="px-1 py-1 border-r border-slate-300 text-center"><input type="text" className="w-full px-2 py-1 border border-slate-300 rounded" value={editingListData.gender} onChange={(e) => setEditingListData({...editingListData, gender: e.target.value})} /></td>
                        <td className="px-1 py-1 border-r border-slate-300 text-center"><input type="text" className="w-full px-2 py-1 border border-slate-300 rounded" value={editingListData.type} onChange={(e) => setEditingListData({...editingListData, type: e.target.value})} /></td>
                        <td className="px-2 py-2 text-center flex justify-center gap-2">
                          <button onClick={() => handleSaveEditMember(row.originalIndex)} className="p-1.5 bg-green-100 text-green-700 hover:bg-green-200 rounded" title="រក្សាទុក (Save)"><Save size={16} /></button>
                          <button onClick={() => setEditingListIndex(null)} className="p-1.5 bg-slate-100 text-slate-700 hover:bg-slate-200 rounded" title="បោះបង់ (Cancel)"><X size={16} /></button>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="px-3 py-2 border-r border-slate-300 text-center font-medium text-slate-500">{getKhmerNum(i + 1)}</td>
                        <td className="px-3 py-2 border-r border-slate-300 text-center text-slate-500">{row.code || (typeof row.id === 'string' ? row.id.split(' ').pop() : row.id) || '-'}</td>
                        <td className="px-3 py-2 border-r border-slate-300 font-bold text-slate-800">{row.name}</td>
                        <td className="px-3 py-2 border-r border-slate-300 text-center text-slate-500">{row.gender}</td>
                        <td className="px-3 py-2 border-r border-slate-300 text-center text-slate-600">{row.type}</td>
                        <td className="px-2 py-2 text-center flex justify-center gap-2">
                          <button onClick={() => handleEditMember(row.originalIndex, row)} className="p-1.5 bg-blue-50 text-blue-600 hover:bg-blue-100 rounded" title="កែប្រែ (Edit)"><Edit size={16} /></button>
                          <button onClick={() => handleDeleteMember(row.originalIndex)} className="p-1.5 bg-red-50 text-red-600 hover:bg-red-100 rounded" title="លុប (Delete)"><Trash2 size={16} /></button>
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex justify-end gap-3 mt-4">
            <button
              onClick={handleDeleteAllMembers}
              className="bg-red-50 hover:bg-red-100 text-red-600 font-bold text-xs px-6 py-2.5 rounded-xl transition-all shadow-sm flex items-center gap-2 cursor-pointer active:scale-95"
            >
              <Trash2 size={16} />
              <span>លុបទាំងអស់</span>
            </button>
            <button
              onClick={handleSaveAllMembers}
              className="bg-[#0a6652] hover:bg-[#085343] text-white font-extrabold text-xs px-6 py-2.5 rounded-xl transition-all shadow-sm flex items-center gap-2 cursor-pointer active:scale-95"
            >
              <Save size={16} />
              <span>រក្សាទុក</span>
            </button>
          </div>
        </div>
      )}

      {activeTab === 'profile' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col p-1 px-4 md:px-6 md:p-6 mb-6">
          <div className="frz3 overflow-x-auto border border-slate-300 rounded-xl">
            <table className="w-full text-left border-collapse text-sm min-w-[1200px]">
              <thead className="bg-[#eef8f2] text-[#0a6652] border-b-[3px] border-[#0a6652] text-center font-bold">
                <tr>
                  <th rowSpan={2} className="px-3 py-3 border-r border-slate-300 align-middle">ល.រ</th>
                  <th rowSpan={2} className="px-3 py-3 border-r border-slate-300 align-middle">លេខ ID</th>
                  <th rowSpan={2} className="px-3 py-3 border-r border-slate-300 align-middle min-w-[140px]">ឈ្មោះ</th>
                  <th rowSpan={2} className="px-3 py-3 border-r border-slate-300 align-middle">ភេទ</th>
                  <th rowSpan={2} className="px-3 py-3 border-r border-slate-300 align-middle">តួនាទីក្នុងក្រុម</th>
                  <th rowSpan={2} className="px-3 py-3 border-r border-slate-300 align-middle">មុខរបរបច្ចុប្បន្ន</th>
                  <th rowSpan={2} className="px-3 py-3 border-r border-slate-300 align-middle">ស្វាមី/ភរិយា</th>
                  <th rowSpan={2} className="px-3 py-3 border-r border-slate-300 align-middle">អាសយដ្ឋាន</th>
                  <th colSpan={3} className="px-3 py-2 border-r border-b border-slate-300">ទំនាក់ទំនង</th>
                  <th colSpan={2} className="px-3 py-2 border-r border-b border-slate-300">គណនីធនាគារ</th>
                  <th colSpan={4} className="px-3 py-2 border-r border-b border-slate-300">អត្តសញ្ញាណ</th>
                  <th rowSpan={2} className="px-3 py-3 align-middle">រូបថត</th>
                </tr>
                <tr>
                  <th className="px-3 py-2 border-r border-slate-300 text-xs">លេខទូរស័ព្ទ</th>
                  <th className="px-3 py-2 border-r border-slate-300 text-xs">អុីម៉ែល</th>
                  <th className="px-3 py-2 border-r border-slate-300 text-xs">ហ្វេសប៊ុក</th>
                  <th className="px-3 py-2 border-r border-slate-300 text-xs">ឈ្មោះ</th>
                  <th className="px-3 py-2 border-r border-slate-300 text-xs">លេខកុង</th>
                  <th className="px-3 py-2 border-r border-slate-300 text-xs">ថ្ងៃខែឆ្នាំកំណើត</th>
                  <th className="px-3 py-2 border-r border-slate-300 text-xs">លេខអត្តសញ្ញាណប័ណ្ណ</th>
                  <th className="px-3 py-2 border-r border-slate-300 text-xs">អ្នកទទួលមរតក</th>
                  <th className="px-3 py-2 border-r border-slate-300 text-xs">ត្រូវជា</th>
                </tr>
              </thead>
              <tbody>
                {profileData.map((row, i) => (
                  <tr key={i} className="border-b border-slate-300 hover:bg-slate-50 transition-colors">
                    <td className="px-3 py-2 border-r border-slate-300 text-center font-medium text-slate-500">{getKhmerNum(i + 1)}</td>
                    <td className="px-3 py-2 border-r border-slate-300 text-center font-medium text-slate-500">{row.code || (typeof row.id === 'string' ? row.id.split(' ').pop() : row.id) || '-'}</td>
                    <td className="px-3 py-2 border-r border-slate-300 font-bold text-slate-800">{row.name}</td>
                    <td className="px-3 py-2 border-r border-slate-300 text-center text-slate-500">{row.gender}</td>
                    <td className="px-3 py-2 border-r border-slate-300 text-left text-slate-600 text-xs">{row.role}</td>
                    <td className="px-3 py-2 border-r border-slate-300 text-left text-slate-600 text-xs">{row.job}</td>
                    <td className="px-3 py-2 border-r border-slate-300 text-center text-slate-500 text-xs">{row.spouse}</td>
                    <td className="px-3 py-2 border-r border-slate-300 text-left text-slate-500 text-xs whitespace-nowrap overflow-hidden text-ellipsis max-w-[150px]">{row.address}</td>
                    <td className="px-3 py-2 border-r border-slate-300 text-center font-medium text-xs">{row.phone}</td>
                    <td className="px-3 py-2 border-r border-slate-300 text-center text-indigo-600 text-xs">{row.email}</td>
                    <td className="px-3 py-2 border-r border-slate-300 text-center text-slate-600 text-xs">{row.facebook}</td>
                    <td className="px-3 py-2 border-r border-slate-300 text-center text-slate-600 text-xs">{row.bankName}</td>
                    <td className="px-3 py-2 border-r border-slate-300 text-center text-slate-600 text-xs">{row.bankAcc}</td>
                    <td className="px-3 py-2 border-r border-slate-300 text-center text-slate-600 text-xs">{row.dob}</td>
                    <td className="px-3 py-2 border-r border-slate-300 text-center text-slate-600 text-xs">{row.idCard}</td>
                    <td className="px-3 py-2 border-r border-slate-300 text-center text-slate-600 text-xs">{row.heir}</td>
                    <td className="px-3 py-2 border-r border-slate-300 text-center text-slate-600 text-xs">{row.relation}</td>
                    <td className="px-3 py-2 text-center align-middle">
                      <img src={row.img} alt={row.name} className="w-8 h-8 md:w-10 md:h-10 rounded-full mx-auto object-cover border border-slate-200" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'deposit_profile' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col p-1 px-4 md:px-6 md:p-6 mb-6">
          <div className="frz3 overflow-x-auto border border-slate-300 rounded-xl">
            <table className="w-full text-left border-collapse text-sm min-w-[1200px]">
              <thead className="bg-[#eef8f2] text-[#0a6652] border-b-[3px] border-[#0a6652] text-center font-bold">
                <tr>
                  <th rowSpan={2} className="px-3 py-3 border-r border-slate-300 align-middle">ល.រ</th>
                  <th rowSpan={2} className="px-3 py-3 border-r border-slate-300 align-middle">លេខកូដ</th>
                  <th rowSpan={2} className="px-3 py-3 border-r border-slate-300 align-middle min-w-[140px]">ឈ្មោះ</th>
                  <th rowSpan={2} className="px-3 py-3 border-r border-slate-300 align-middle">ភេទ</th>
                  <th colSpan={7} className="px-3 py-2 border-r border-b border-slate-300">ព័ត៌មានទំនាក់ទំនង</th>
                  <th colSpan={4} className="px-3 py-2 border-r border-b border-slate-300">ប្រវត្តិរូបសមាជិក</th>
                  <th rowSpan={2} className="px-3 py-3 align-middle">រូបថត</th>
                </tr>
                <tr>
                  <th className="px-3 py-2 border-r border-slate-300 text-xs">មុខរបរបច្ចុប្បន្ន</th>
                  <th className="px-3 py-2 border-r border-slate-300 text-xs">ស្វាមី/ភរិយា</th>
                  <th className="px-3 py-2 border-r border-slate-300 text-xs">អាសយដ្ឋាន</th>
                  <th className="px-3 py-2 border-r border-slate-300 text-xs">លេខទូរស័ព្ទ</th>
                  <th className="px-3 py-2 border-r border-slate-300 text-xs">ហ្វេសប៊ុក</th>
                  <th className="px-3 py-2 border-r border-slate-300 text-xs">តេឡេក្រាម</th>
                  <th className="px-3 py-2 border-r border-slate-300 text-xs whitespace-nowrap">កាលបរិច្ឆេទចូលជាសមាជិក</th>
                  <th className="px-3 py-2 border-r border-slate-300 text-xs whitespace-nowrap">ថ្ងៃខែឆ្នាំកំណើត</th>
                  <th className="px-3 py-2 border-r border-slate-300 text-xs whitespace-nowrap">លេខអត្តសញ្ញាណប័ណ្ណ</th>
                  <th className="px-3 py-2 border-r border-slate-300 text-xs whitespace-nowrap">អ្នកទទួលមរតក</th>
                  <th className="px-3 py-2 border-r border-slate-300 text-xs">ត្រូវជា</th>
                </tr>
              </thead>
              <tbody>
                {depositProfileData.map((row, i) => (
                  <tr key={i} className="border-b border-slate-300 hover:bg-slate-50 transition-colors">
                    <td className="px-3 py-2 border-r border-slate-300 text-center font-medium text-slate-500">{getKhmerNum(i + 1)}</td>
                    <td className="px-3 py-2 border-r border-slate-300 text-center text-slate-500">{row.code || (typeof row.id === 'string' ? row.id.split(' ').pop() : row.id) || '-'}</td>
                    <td className="px-3 py-2 border-r border-slate-300 font-bold text-slate-800">{row.name}</td>
                    <td className="px-3 py-2 border-r border-slate-300 text-center text-slate-500">{row.gender}</td>
                    <td className="px-3 py-2 border-r border-slate-300 text-left text-slate-600 text-xs">{row.job}</td>
                    <td className="px-3 py-2 border-r border-slate-300 text-center text-slate-500 text-xs">{row.spouse}</td>
                    <td className="px-3 py-2 border-r border-slate-300 text-left text-slate-500 text-xs whitespace-nowrap overflow-hidden text-ellipsis max-w-[150px]">{row.address}</td>
                    <td className="px-3 py-2 border-r border-slate-300 text-center font-medium text-xs">{row.phone}</td>
                    <td className="px-3 py-2 border-r border-slate-300 text-center text-slate-600 text-xs">{row.facebook}</td>
                    <td className="px-3 py-2 border-r border-slate-300 text-center text-slate-600 text-xs">{row.telegram}</td>
                    <td className="px-3 py-2 border-r border-slate-300 text-center text-slate-600 text-xs">{row.joinDate}</td>
                    <td className="px-3 py-2 border-r border-slate-300 text-center text-slate-600 text-xs">{row.dob}</td>
                    <td className="px-3 py-2 border-r border-slate-300 text-center text-slate-600 text-xs">{row.idCard}</td>
                    <td className="px-3 py-2 border-r border-slate-300 text-center text-slate-600 text-xs">{row.heir}</td>
                    <td className="px-3 py-2 border-r border-slate-300 text-center text-slate-600 text-xs">{row.relation}</td>
                    <td className="px-3 py-2 text-center align-middle">
                      <img src={row.img} alt={row.name} className="w-8 h-8 md:w-10 md:h-10 rounded-full mx-auto object-cover border border-slate-200" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </PageView>
  );
}

function Savings() {
  const navigate = useNavigate();
  const [selectedMonth, setSelectedMonth] = useState('មេសា 2026');
  const [activeTab, setActiveTab] = useState('members');
  const months = ['មករា 2026', 'កុម្ភៈ 2026', 'មីនា 2026', 'មេសា 2026', 'ឧសភា 2026', 'មិថុនា 2026', 'កក្កដា 2026', 'សីហា 2026', 'កញ្ញា 2026', 'តុលា 2026', 'វិច្ឆិកា 2026', 'ធ្នូ 2026'];

  const [savingData, setSavingData] = useState(() => {
    let sd = getStoredData('sof_savings_data', DEFAULT_SAVING_DATA) || [];
    const pfd = getStoredData('sof_profile_data', DEFAULT_PROFILE_DATA) || [];
    let modified = false;
    
    // Remove deleted members
    const validCodes = new Set(pfd.map((p: any) => typeof p.id === 'string' ? p.id.split(' ').pop() : p.code));
    const filteredSd = sd.filter((x: any) => validCodes.has(x.id));
    if (filteredSd.length !== sd.length) {
      sd = filteredSd;
      modified = true;
    }

    pfd.forEach((p: any) => {
      let code = typeof p.id === 'string' ? p.id.split(' ').pop() : p.code;
      if (!code) code = p.code;
      let s = sd.find((x: any) => x.id === code);
      if (!s) {
        sd.push({
           id: code, name: p.name, gender: p.gender, 
           startCapital: '0.00', share: '0.00%', addSaving: '-', profit: '0', 
           withdraw: '-', deductFee: '-', actualFee: '-', total: '0.00', checked: true
        });
        modified = true;
      } else if (s.name !== p.name || s.gender !== p.gender) {
        s.name = p.name;
        s.gender = p.gender;
        modified = true;
      }
    });
    if (modified) setStoredData('sof_savings_data', sd);
    return sd;
  });

  const [groupData, setGroupData] = useState(() => {
    let gd = getStoredData('sof_savings_group_data', DEFAULT_GROUP_DATA) || [];
    // Ensure R004 (ការប្រាក់រក្សាទុក) exists for rosters saved before it was added.
    if (!gd.some((r: any) => r.id === 'R004')) {
      gd = [...gd, DEFAULT_GROUP_DATA.find((r) => r.id === 'R004')];
      setStoredData('sof_savings_group_data', gd);
    }
    return gd;
  });

  const [depositData, setDepositData] = useState(() => {
    let sd = getStoredData('sof_savings_deposit_data', DEFAULT_DEPOSIT_DATA) || [];
    const dp = getStoredData('sof_deposit_profile_data', DEFAULT_DEPOSIT_PROFILE_DATA) || [];
    let modified = false;
    
    const validCodes = new Set(dp.map((p: any) => typeof p.id === 'string' ? p.id.split(' ').pop() : p.code));
    const filteredSd = sd.filter((x: any) => validCodes.has(x.id));
    if (filteredSd.length !== sd.length) {
      sd = filteredSd;
      modified = true;
    }

    dp.forEach((p: any) => {
      let code = typeof p.id === 'string' ? p.id.split(' ').pop() : p.code;
      if (!code) code = p.code;
      let s = sd.find((x: any) => x.id === code);
      if (!s) {
        sd.push({
           id: code, name: p.name, gender: p.gender,
           village: '0', startCapital: '0.00', addSaving: '-', profit: '0',
           withdraw: '-', deductFee: '-', actualFee: '-', total: '0.00', checked: true
        });
        modified = true;
      } else if (s.name !== p.name || s.gender !== p.gender) {
        s.name = p.name;
        s.gender = p.gender;
        modified = true;
      }
    });
    if (modified) setStoredData('sof_savings_deposit_data', sd);
    return sd;
  });

  // Recompute ONE month's rows — delegates to the shared engine so the Savings page and
  // the balance sheet always agree (see computeSavingsMonthLive above).
  const computeMonth = computeSavingsMonthLive;

  // AUTO-CALCULATE the selected month. Every prior month is recomputed in order so the
  // carry-forward beginning always equals the freshly recomputed previous-month total —
  // this prevents drift between a stale saved snapshot and the live on-screen figures
  // (e.g. when the income statement / net profit was edited after a month was saved).
  // Only ទុនសន្សំបន្ថែម (monthly deposit) is entered; first month (មករា) opening is entered.
  useEffect(() => {
    const idx = months.indexOf(selectedMonth);
    const colTotals = (arr: any[]) => { const m: Record<string, any> = {}; (arr || []).forEach((r: any) => { m[r.id] = r.total; }); return m; };
    let prevTotals: any = null;
    let result: any = null;
    for (let i = 0; i <= idx; i++) {
      result = computeMonth(months[i], prevTotals);
      prevTotals = { active: colTotals(result.active), group: colTotals(result.group), deposit: colTotals(result.deposit) };
    }
    if (result) {
      setSavingData(result.active);
      setGroupData(result.group);
      setDepositData(result.deposit);
    }
  }, [selectedMonth]);

  // Recompute the active + group profit distribution for the given rows (engine).
  const recomputeSavingsRows = (activeRows: any[], groupRows: any[]) => {
    const net = monthlyIncome(selectedMonth).netProfit;
    const pool = [...activeRows, ...groupRows].map((r: any) => ({
      id: r.id, beginning: num(r.startCapital), addSaving: num(r.addSaving) + num(r.manualAdd),
      withdraw: num(r.withdraw), penalty: num(r.actualFee), deductFee: num(r.deductFee),
    }));
    const byId: Record<string, any> = {};
    computeSavings(pool, net).forEach((x) => { byId[x.id] = x; });
    const apply = (rows: any[]) => rows.map((r: any) => {
      const c = byId[r.id];
      return c ? { ...r, share: (c.share * 100).toFixed(2) + '%', profit: c.profit.toFixed(2), total: c.total.toFixed(2) } : r;
    });
    return { active: apply(activeRows), group: apply(groupRows) };
  };
  // Deposit row total: deposit members earn a flat 0.5%, no profit-pool share (shared engine).
  const computeDepositRow = computeDepositRowLive;
  // Edit a raw input cell (startCapital / addSaving / withdraw / deductFee / actualFee) → live recompute.
  const editSavingRaw = (idx: number, field: string, value: string) => {
    const next = savingData.map((r: any, i: number) => (i === idx ? { ...r, [field]: value } : r));
    const { active, group } = recomputeSavingsRows(next, groupData);
    setSavingData(active); setGroupData(group);
  };
  const editGroupRaw = (idx: number, field: string, value: string) => {
    const next = groupData.map((r: any, i: number) => (i === idx ? { ...r, [field]: value } : r));
    const { active, group } = recomputeSavingsRows(savingData, next);
    setSavingData(active); setGroupData(group);
  };
  const editDepositRaw = (idx: number, field: string, value: string) => {
    setDepositData(depositData.map((r: any, i: number) => (i === idx ? computeDepositRow({ ...r, [field]: value }) : r)));
  };
  // Show an empty input instead of the placeholder "-" so typing doesn't produce "1-".
  const showVal = (v: any) => (v === '-' || v == null ? '' : v);
  // Column totals for the footer "សរុប" row.
  const sumOf = (rows: any[], field: string) => rows.reduce((s, r) => s + num(r[field]), 0);
  const n2 = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  // Persist the current month's savings + group + deposit to the cloud (called on blur).
  const saveSavingsMonth = () => {
    const sBy = getStoredData('sof_savings_by_month', {}); sBy[selectedMonth] = savingData; setStoredData('sof_savings_by_month', sBy);
    const gBy = getStoredData('sof_group_by_month', {}); gBy[selectedMonth] = groupData; setStoredData('sof_group_by_month', gBy);
    const dBy = getStoredData('sof_deposit_by_month', {}); dBy[selectedMonth] = depositData; setStoredData('sof_deposit_by_month', dBy);
  };
  // Beginning capital is editable only in the first month (opening); later months carry forward.
  const isFirstMonth = selectedMonth === months[0];

  // Paste-import monthly savings: one line per member → engine recomputes for the month.
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState('');
  const codeOf = (r: any) => (typeof r.id === 'string' && r.id.includes(' ') ? r.id.split(' ').pop() : r.id);
  const handlePasteImport = () => {
    const lines = importText.split('\n').map((l) => l.trim()).filter(Boolean);
    const next = [...savingData];
    let count = 0;
    lines.forEach((line) => {
      const p = line.split(/[\t,]+|\s{2,}|\s+/).map((s) => s.trim()).filter(Boolean);
      if (p.length < 2) return;
      const code = p[0].toUpperCase();
      const i = next.findIndex((r: any) => String(codeOf(r)).toUpperCase() === code);
      if (i < 0) return;
      next[i] = p.length >= 3 ? { ...next[i], startCapital: p[1], addSaving: p[2] } : { ...next[i], addSaving: p[1] };
      count++;
    });
    const { active, group } = recomputeSavingsRows(next, groupData);
    setSavingData(active); setGroupData(group);
    const sBy = getStoredData('sof_savings_by_month', {}); sBy[selectedMonth] = active; setStoredData('sof_savings_by_month', sBy);
    const gBy = getStoredData('sof_group_by_month', {}); gBy[selectedMonth] = group; setStoredData('sof_group_by_month', gBy);
    setShowImport(false); setImportText('');
    alert(`នាំចូល ${count} សមាជិក សម្រាប់ខែ ${selectedMonth} ដោយជោគជ័យ!`);
  };

  // Import an Excel/CSV file → set the selected month's deposit per member, recompute.
  // Robust: finds the header row anywhere in the first rows, flexible column names & ID format.
  const handleFileImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const wb = XLSX.read(ev.target?.result as ArrayBuffer, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const grid = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as any[][];
        const nz = (s: any) => String(s).replace(/[\s​]/g, '').toLowerCase();
        const hasKey = (cell: any, keys: string[]) => keys.some((k) => nz(cell).includes(nz(k)));
        // Locate the header row + the code / deposit / opening columns.
        let hr = -1, cCode = -1, cDep = -1, cOpen = -1;
        for (let r = 0; r < Math.min(15, grid.length); r++) {
          let code = -1, dep = -1, open = -1;
          (grid[r] || []).forEach((cell: any, ci: number) => {
            if (code < 0 && hasKey(cell, ['id', 'កូដ', 'លេខ'])) code = ci;
            if (dep < 0 && hasKey(cell, ['សន្សំ', 'ប្រចាំ', 'បន្ថែម', 'saving', 'deposit'])) dep = ci;
            if (open < 0 && hasKey(cell, ['ចាប់ផ្តើម', 'ដើម', 'opening'])) open = ci;
          });
          if (code >= 0 && dep >= 0) { hr = r; cCode = code; cDep = dep; cOpen = open; break; }
        }
        if (hr < 0) {
          alert('រកមិនឃើញជួរក្បាល (header) ដែលមាន "លេខ ID" និង "សន្សំប្រចាំ" ទេ។\nជួរទី១របស់ឯកសារ៖ ' + JSON.stringify(grid[0] || []).slice(0, 150));
          return;
        }
        const stripCode = (v: any) => { let s = String(v).trim().toUpperCase(); if (s.includes(' ')) s = s.split(' ').pop() || s; return s; };
        const next = [...savingData];
        let count = 0; const unmatched: string[] = [];
        for (let r = hr + 1; r < grid.length; r++) {
          const code = stripCode((grid[r] || [])[cCode] ?? '');
          if (!code || !/^[A-Z]+\d+$/.test(code)) continue;
          const i = next.findIndex((x: any) => stripCode(codeOf(x)) === code);
          if (i < 0) { unmatched.push(code); continue; }
          const upd: any = { ...next[i] };
          const dep = grid[r][cDep];
          if (dep !== '' && dep != null) upd.addSaving = String(dep);
          if (cOpen >= 0) { const o = grid[r][cOpen]; if (o !== '' && o != null) upd.startCapital = String(o); }
          next[i] = upd; count++;
        }
        const { active, group } = recomputeSavingsRows(next, groupData);
        setSavingData(active); setGroupData(group);
        const sBy = getStoredData('sof_savings_by_month', {}); sBy[selectedMonth] = active; setStoredData('sof_savings_by_month', sBy);
        const gBy = getStoredData('sof_group_by_month', {}); gBy[selectedMonth] = group; setStoredData('sof_group_by_month', gBy);
        alert(`នាំចូល ${count} សមាជិក សម្រាប់ខែ ${selectedMonth}!` + (unmatched.length ? `\nរកមិនឃើញកូដ ${unmatched.length}៖ ${unmatched.slice(0, 8).join(', ')}` : ''));
      } catch (err) {
        alert('មានបញ្ហាក្នុងការអានឯកសារ៖ ' + err);
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  };

  // Undo snapshot for the last "delete all" so an accidental delete is recoverable.
  const [undoSavings, setUndoSavings] = useState<{ tab: string; data: any[] } | null>(null);
  const handleDeleteAllSavings = () => {
    if (window.confirm('តើអ្នកពិតជាចង់លុបទិន្នន័យនេះមែនទេ? (អាចចុច "មិនធ្វើវិញ" ដើម្បីយកមកវិញ)')) {
      if (activeTab === 'members') {
        setUndoSavings({ tab: 'members', data: savingData });
        setSavingData([]); setStoredData('sof_savings_data', []);
      } else if (activeTab === 'group') {
        setUndoSavings({ tab: 'group', data: groupData });
        setGroupData([]); setStoredData('sof_savings_group_data', []);
      } else if (activeTab === 'deposit') {
        setUndoSavings({ tab: 'deposit', data: depositData });
        setDepositData([]); setStoredData('sof_savings_deposit_data', []);
      }
    }
  };
  const handleUndoSavings = () => {
    if (!undoSavings) return;
    if (undoSavings.tab === 'members') { setSavingData(undoSavings.data); setStoredData('sof_savings_data', undoSavings.data); }
    else if (undoSavings.tab === 'group') { setGroupData(undoSavings.data); setStoredData('sof_savings_group_data', undoSavings.data); }
    else if (undoSavings.tab === 'deposit') { setDepositData(undoSavings.data); setStoredData('sof_savings_deposit_data', undoSavings.data); }
    setUndoSavings(null);
  };

  // ---- Fixed-term accounts (គណនីសន្សំមានកាលកំណត់) — earn 1%/month, carry forward ----
  // Separate F-code roster (imported in FIXEDTERM_BY_MONTH), not the active members.
  const ftRoster = () => FIXEDTERM_ROSTER.map((r) => ({
    id: r.id, name: r.name, gender: r.gender, rate: DEFAULT_RATES.fixedTerm,
    startCapital: '0.00', addSaving: '-', interest: '-', withdraw: '-', total: '0.00', checked: true,
  }));
  const [fixedTermData, setFixedTermData] = useState<any[]>(() => ftRoster());
  // Interest (1%/month on the beginning balance) is paid out, not compounded —
  // so the running total excludes it: total = beginning + addSaving − withdraw.
  const recalcFixedTerm = (rows: any[]) => rows.map((r: any) => {
    const b = num(r.startCapital);
    const rate = r.rate != null ? Number(r.rate) : DEFAULT_RATES.fixedTerm;
    const interest = rate * b;
    const total = b + num(r.addSaving) - num(r.withdraw);
    return { ...r, interest: interest ? interest.toFixed(2) : '-', total: total.toFixed(2) };
  });
  useEffect(() => {
    const fBy = getStoredData('sof_fixedterm_by_month', FIXEDTERM_BY_MONTH) || {};
    const mi = months.indexOf(selectedMonth);
    // Roll forward from the first month: each month's end-of-month total becomes
    // the next month's beginning. Months with no data (e.g. Jul–Dec) just carry the
    // running balance forward, so the chain never resets to zero on empty months.
    let prevTotals: Record<string, any> | null = null;
    let computed: any[] = ftRoster();
    for (let i = 0; i <= mi; i++) {
      const m = months[i];
      let rows = (fBy[m] && fBy[m].length) ? fBy[m] : ftRoster();
      if (prevTotals) {
        const pt = prevTotals;
        rows = rows.map((r: any) => (pt[r.id] !== undefined ? { ...r, startCapital: String(pt[r.id]) } : r));
      }
      computed = recalcFixedTerm(rows);
      prevTotals = {};
      computed.forEach((r: any) => { prevTotals![r.id] = r.total; });
    }
    setFixedTermData(computed);
  }, [selectedMonth]);
  const editFixedTermRaw = (idx: number, field: string, value: string) => {
    setFixedTermData(recalcFixedTerm(fixedTermData.map((r: any, i: number) => (i === idx ? { ...r, [field]: value } : r))));
  };
  const saveFixedTermMonth = () => {
    const fBy = getStoredData('sof_fixedterm_by_month', FIXEDTERM_BY_MONTH) || {};
    fBy[selectedMonth] = fixedTermData;
    setStoredData('sof_fixedterm_by_month', fBy);
  };

  const handleSaveAllSavings = async () => {
    alert('ទិន្នន័យត្រូវបានរក្សាទុកទៅ Supabase ដោយជោគជ័យ!');
  };

  return (
    <PageView
      onAddClick={() => navigate('/dashboard', { state: { tab: 'savings' } })}
      onUpload={handleFileImport}
      title={
      <div className="flex flex-col md:flex-row md:items-center gap-3">
        <span>របាយការណ៍សន្សំប្រាក់{activeTab === 'group' ? 'ក្រុម' : activeTab === 'deposit' ? 'សមាជិកបញ្ញើសន្សំ' : activeTab === 'fixedterm' ? 'គណនីមានកាលកំណត់' : 'សមាជិកសកម្ម'} - </span>
        <select 
          value={selectedMonth}
          onChange={(e) => setSelectedMonth(e.target.value)}
          className="text-lg md:text-xl font-bold bg-[#eef8f2] border border-green-200 text-[#0a6652] px-3 py-1 rounded-lg outline-none cursor-pointer shadow-sm w-fit"
        >
          {months.map(m => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
      </div>
    }>
      {/* Tabs */}
      <div className="flex flex-wrap gap-3 mb-6">
        <button 
          onClick={() => setActiveTab('members')}
          className={`px-6 py-2.5 rounded-full font-bold text-sm transition-colors ${activeTab === 'members' ? 'bg-[#0a6652] text-white shadow-md' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
        >
          សមាជិកសកម្ម
        </button>
        <button 
          onClick={() => setActiveTab('deposit')}
          className={`px-6 py-2.5 rounded-full font-bold text-sm transition-colors ${activeTab === 'deposit' ? 'bg-[#0a6652] text-white shadow-md' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
        >
          សមាជិកបញ្ញើ
        </button>
        <button
          onClick={() => setActiveTab('group')}
          className={`px-6 py-2.5 rounded-full font-bold text-sm transition-colors ${activeTab === 'group' ? 'bg-[#0a6652] text-white shadow-md' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
        >
          សមាជិកជាក្រុម
        </button>
        <button
          onClick={() => setActiveTab('fixedterm')}
          className={`px-6 py-2.5 rounded-full font-bold text-sm transition-colors ${activeTab === 'fixedterm' ? 'bg-[#0a6652] text-white shadow-md' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
        >
          គណនីមានកាលកំណត់
        </button>
      </div>

      {activeTab === 'members' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col p-1 px-4 md:px-6 md:p-6 mb-6">
          <div className="flex justify-end gap-2 mb-3">
            <button onClick={() => setShowImport(true)} className="flex items-center gap-1.5 bg-[#0a6652] text-white px-4 py-2 rounded-full text-xs font-bold hover:bg-[#084f40] transition-colors cursor-pointer">
              <Upload size={14} strokeWidth={2.5} /> បិទភ្ជាប់ (Paste)
            </button>
          </div>
          {showImport && (
            <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setShowImport(false)}>
              <div className="bg-white rounded-2xl p-6 w-full max-w-lg shadow-xl" onClick={(e) => e.stopPropagation()}>
                <h3 className="font-bold text-lg text-[#0a6652] mb-2">នាំចូលទុនសន្សំ — {selectedMonth}</h3>
                <p className="text-xs text-slate-500 mb-3 leading-relaxed">
                  បិទភ្ជាប់ពី Excel ៖ មួយជួរក្នុងមួយសមាជិក។<br />
                  ទម្រង់៖ <b>លេខកូដ ⟶ ទុនសន្សំបន្ថែម</b> (ឧ. <code className="bg-slate-100 px-1">C001  50</code>)<br />
                  ឬ <b>លេខកូដ ⟶ ទុនចាប់ផ្តើម ⟶ ទុនសន្សំបន្ថែម</b> (ឧ. <code className="bg-slate-100 px-1">C001  1000  50</code> សម្រាប់ដើមដំបូង)
                </p>
                <textarea value={importText} onChange={(e) => setImportText(e.target.value)} rows={10}
                  placeholder={"C001\t50\nC002\t30\nC003\t100"}
                  className="w-full border border-slate-300 rounded-lg p-3 text-sm font-mono outline-none focus:border-[#0a6652]" />
                <div className="flex justify-end gap-2 mt-3">
                  <button onClick={() => setShowImport(false)} className="px-4 py-2 rounded-full text-sm font-bold bg-slate-100 text-slate-600 hover:bg-slate-200 cursor-pointer">បោះបង់</button>
                  <button onClick={handlePasteImport} className="px-4 py-2 rounded-full text-sm font-bold bg-[#0a6652] text-white hover:bg-[#084f40] cursor-pointer">នាំចូល</button>
                </div>
              </div>
            </div>
          )}
          <div className="sav-frz overflow-x-auto border border-slate-300 rounded-xl">
            <table className="w-full text-left border-collapse text-sm min-w-[1200px]">
              <thead className="bg-[#eef8f2] text-[#0a6652] border-b-[3px] border-[#0a6652] text-center font-bold">
                <tr>
                  <th rowSpan={2} className="px-3 py-3 border-r border-slate-300 align-middle">ល.រ</th>
                  <th rowSpan={2} className="px-3 py-3 border-r border-slate-300 align-middle min-w-[140px]">ឈ្មោះ</th>
                  <th rowSpan={2} className="px-3 py-3 border-r border-slate-300 align-middle">ភេទ</th>
                  <th rowSpan={2} className="px-3 py-3 border-r border-slate-300 align-middle">ទុនចាប់ផ្តើម</th>
                  <th rowSpan={2} className="px-3 py-3 border-r border-slate-300 align-middle">ភាគហ៊ុនជា%</th>
                  <th rowSpan={2} className="px-3 py-3 border-r border-slate-300 align-middle">ទុនសន្សំបន្ថែម</th>
                  <th rowSpan={2} className="px-3 py-3 border-r border-slate-300 align-middle">ប្រាក់ចំណេញ</th>
                  <th rowSpan={2} className="px-3 py-3 border-r border-slate-300 align-middle">ដកទុន</th>
                  <th colSpan={2} className="px-3 py-2 border-r border-b border-slate-300">ប្រាក់ពិន័យ/សមាជិកភាព</th>
                  <th rowSpan={2} className="px-3 py-3 border-r border-slate-300 align-middle shadow-[-4px_0_10px_rgba(0,0,0,0.02)] bg-[#f3faf6] text-[#084f40]">ប្រាក់សន្សំសរុប</th>
                  <th rowSpan={2} className="px-3 py-3 align-middle">កំណត់សំគាល់</th>
                </tr>
                <tr>
                  <th className="px-3 py-2 border-r border-slate-300 text-xs">កាត់ទុន</th>
                  <th className="px-3 py-2 border-r border-slate-300 text-xs">ជាក់ស្តែង</th>
                </tr>
              </thead>
              <tbody>
                {savingData.map((row, idx) => (
                  <tr key={`${row.id}-${idx}`} className="border-b border-slate-300 hover:bg-slate-50 transition-colors h-11">
                    <td className="px-3 py-2 border-r border-slate-300 text-center text-slate-500 font-medium">{typeof row.id === 'string' ? row.id.split(' ').pop() : row.id}</td>
                    <td className="px-3 py-2 border-r border-slate-300 font-bold text-slate-800">{row.name}</td>
                    <td className="px-3 py-2 border-r border-slate-300 text-center text-slate-500">{row.gender}</td>
                    <td className="px-1 py-1 border-r border-slate-300 text-right">
                      {isFirstMonth ? (
                        <input value={showVal(row.startCapital)} onChange={(e) => editSavingRaw(idx, 'startCapital', e.target.value)} onBlur={saveSavingsMonth}
                          className="w-24 text-right bg-transparent px-2 py-1 rounded border border-dashed border-slate-300 focus:border-[#0a6652] focus:bg-[#f3faf6] outline-none font-medium" />
                      ) : (
                        <span className="block px-2 py-1 text-right font-medium text-slate-600" title="អូតូពីសរុបខែមុន">{row.startCapital}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 border-r border-slate-300 text-right text-slate-500 text-xs">{row.share}</td>
                    <td className="px-1 py-1 border-r border-slate-300 text-right">
                      <input value={showVal(row.addSaving)} onChange={(e) => editSavingRaw(idx, 'addSaving', e.target.value)} onBlur={saveSavingsMonth}
                        className="w-20 text-right bg-transparent px-2 py-1 rounded border border-dashed border-slate-300 focus:border-[#0a6652] focus:bg-[#f3faf6] outline-none font-medium" />
                    </td>
                    <td className="px-3 py-2 border-r border-slate-300 text-right font-medium">{row.profit}</td>
                    <td className="px-1 py-1 border-r border-slate-300 text-right">
                      <input value={showVal(row.withdraw)} onChange={(e) => editSavingRaw(idx, 'withdraw', e.target.value)} onBlur={saveSavingsMonth}
                        className="w-20 text-right bg-transparent px-2 py-1 rounded border border-dashed border-slate-300 focus:border-[#0a6652] focus:bg-[#f3faf6] outline-none font-medium" />
                    </td>
                    <td className="px-1 py-1 border-r border-slate-300 text-right">
                      <input value={showVal(row.deductFee)} onChange={(e) => editSavingRaw(idx, 'deductFee', e.target.value)} onBlur={saveSavingsMonth}
                        className="w-20 text-right bg-transparent px-2 py-1 rounded border border-dashed border-slate-300 focus:border-[#0a6652] focus:bg-[#f3faf6] outline-none font-medium" />
                    </td>
                    <td className="px-1 py-1 border-r border-slate-300 text-right">
                      <input value={showVal(row.actualFee)} onChange={(e) => editSavingRaw(idx, 'actualFee', e.target.value)} onBlur={saveSavingsMonth}
                        className="w-20 text-right bg-transparent px-2 py-1 rounded border border-dashed border-slate-300 focus:border-[#0a6652] focus:bg-[#f3faf6] outline-none font-medium" />
                    </td>
                    <td className="px-3 py-2 border-r border-slate-300 text-right font-bold text-[#0a6652] bg-[#fafdfa] shadow-[-4px_0_10px_rgba(0,0,0,0.02)]">{row.total}</td>
                    <td className="px-3 py-2 text-center text-green-600 font-bold">{row.checked ? '✓' : ''}</td>
                  </tr>
                ))}
                <tr className="sav-tot bg-slate-50 text-slate-800 font-bold border-t-2 border-slate-800 h-12">
                  <td colSpan={3} className="px-3 py-2 border-r border-slate-300 text-center">សរុប</td>
                  <td className="px-3 py-2 border-r border-slate-300 text-right">{n2(sumOf(savingData, 'startCapital'))}</td>
                  <td className="px-3 py-2 border-r border-slate-300 text-right text-xs">{sumOf(savingData, 'share').toFixed(2)}%</td>
                  <td className="px-3 py-2 border-r border-slate-300 text-right">{n2(sumOf(savingData, 'addSaving'))}</td>
                  <td className="px-3 py-2 border-r border-slate-300 text-right">{n2(sumOf(savingData, 'profit'))}</td>
                  <td className="px-3 py-2 border-r border-slate-300 text-right">{n2(sumOf(savingData, 'withdraw'))}</td>
                  <td className="px-3 py-2 border-r border-slate-300 text-right">{n2(sumOf(savingData, 'deductFee'))}</td>
                  <td className="px-3 py-2 border-r border-slate-300 text-right">{n2(sumOf(savingData, 'actualFee'))}</td>
                  <td className="px-3 py-2 border-r border-slate-300 text-right text-[#0a6652] bg-[#fafdfa]">{n2(sumOf(savingData, 'total'))}</td>
                  <td className="px-3 py-2"></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'group' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col p-1 px-4 md:px-6 md:p-6 mb-6">
          <h3 className="font-bold text-slate-800 text-lg mb-4">ទុនរក្សាទុកក្រុម</h3>
          <div className="sav-frz overflow-x-auto border border-slate-300 rounded-xl">
            <table className="w-full text-left border-collapse text-sm min-w-[1200px]">
              <thead className="bg-[#eef8f2] text-[#0a6652] border-b-[3px] border-[#0a6652] text-center font-bold">
                <tr>
                  <th rowSpan={2} className="px-3 py-3 border-r border-slate-300 align-middle">ល.រ</th>
                  <th rowSpan={2} className="px-3 py-3 border-r border-slate-300 align-middle min-w-[140px]">ឈ្មោះ</th>
                  <th rowSpan={2} className="px-3 py-3 border-r border-slate-300 align-middle">ភេទ</th>
                  <th rowSpan={2} className="px-3 py-3 border-r border-slate-300 align-middle">ទុនចាប់ផ្តើម</th>
                  <th rowSpan={2} className="px-3 py-3 border-r border-slate-300 align-middle">ភាគហ៊ុនជា%</th>
                  <th rowSpan={2} className="px-3 py-3 border-r border-slate-300 align-middle">ទុនសន្សំបន្ថែម</th>
                  <th rowSpan={2} className="px-3 py-3 border-r border-slate-300 align-middle">ទុនបន្ថែម (ដៃ)</th>
                  <th rowSpan={2} className="px-3 py-3 border-r border-slate-300 align-middle">ប្រាក់ចំណេញ</th>
                  <th rowSpan={2} className="px-3 py-3 border-r border-slate-300 align-middle">ដកទុន</th>
                  <th colSpan={2} className="px-3 py-2 border-r border-b border-slate-300">ប្រាក់ពិន័យ</th>
                  <th rowSpan={2} className="px-3 py-3 border-r border-slate-300 align-middle shadow-[-4px_0_10px_rgba(0,0,0,0.02)] bg-[#f3faf6] text-[#084f40]">ប្រាក់សន្សំសរុប</th>
                  <th rowSpan={2} className="px-3 py-3 align-middle">កំណត់សំគាល់</th>
                </tr>
                <tr>
                  <th className="px-3 py-2 border-r border-slate-300 text-xs">កាត់ទុន</th>
                  <th className="px-3 py-2 border-r border-slate-300 text-xs">សាច់ប្រាក់ជាក់ស្តែង</th>
                </tr>
              </thead>
              <tbody>
                {groupData.map((row, idx) => (
                  <tr key={row.id} className="border-b border-slate-300 hover:bg-slate-50 transition-colors h-11">
                    <td className="px-3 py-2 border-r border-slate-300 text-center text-slate-500 font-medium">{typeof row.id === 'string' ? row.id.split(' ').pop() : row.id}</td>
                    <td className="px-3 py-2 border-r border-slate-300 font-bold text-slate-800">{row.name}</td>
                    <td className="px-3 py-2 border-r border-slate-300 text-center text-slate-500">{row.gender}</td>
                    <td className="px-1 py-1 border-r border-slate-300 text-right">
                      {isFirstMonth ? (
                        <input value={showVal(row.startCapital)} onChange={(e) => editGroupRaw(idx, 'startCapital', e.target.value)} onBlur={saveSavingsMonth}
                          className="w-24 text-right bg-transparent px-2 py-1 rounded border border-dashed border-slate-300 focus:border-[#0a6652] focus:bg-[#f3faf6] outline-none font-medium" />
                      ) : (
                        <span className="block px-2 py-1 text-right font-medium text-slate-600" title="អូតូពីសរុបខែមុន">{row.startCapital}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 border-r border-slate-300 text-right text-slate-500 text-xs">{row.share}</td>
                    <td className="px-1 py-1 border-r border-slate-300 text-right">
                      <input value={showVal(row.addSaving)} onChange={(e) => editGroupRaw(idx, 'addSaving', e.target.value)} onBlur={saveSavingsMonth}
                        className="w-20 text-right bg-transparent px-2 py-1 rounded border border-dashed border-slate-300 focus:border-[#0a6652] focus:bg-[#f3faf6] outline-none font-medium" />
                    </td>
                    <td className="px-1 py-1 border-r border-slate-300 text-right">
                      <input value={showVal(row.manualAdd)} onChange={(e) => editGroupRaw(idx, 'manualAdd', e.target.value)} onBlur={saveSavingsMonth}
                        className="w-20 text-right bg-transparent px-2 py-1 rounded border border-dashed border-slate-300 focus:border-[#0a6652] focus:bg-[#f3faf6] outline-none font-medium" />
                    </td>
                    <td className="px-3 py-2 border-r border-slate-300 text-right font-medium">{row.profit}</td>
                    <td className="px-1 py-1 border-r border-slate-300 text-right">
                      <input value={showVal(row.withdraw)} onChange={(e) => editGroupRaw(idx, 'withdraw', e.target.value)} onBlur={saveSavingsMonth}
                        className="w-20 text-right bg-transparent px-2 py-1 rounded border border-dashed border-slate-300 focus:border-[#0a6652] focus:bg-[#f3faf6] outline-none font-medium" />
                    </td>
                    <td className="px-1 py-1 border-r border-slate-300 text-right">
                      <input value={showVal(row.deductFee)} onChange={(e) => editGroupRaw(idx, 'deductFee', e.target.value)} onBlur={saveSavingsMonth}
                        className="w-20 text-right bg-transparent px-2 py-1 rounded border border-dashed border-slate-300 focus:border-[#0a6652] focus:bg-[#f3faf6] outline-none font-medium" />
                    </td>
                    <td className="px-1 py-1 border-r border-slate-300 text-right">
                      <input value={showVal(row.actualFee)} onChange={(e) => editGroupRaw(idx, 'actualFee', e.target.value)} onBlur={saveSavingsMonth}
                        className="w-20 text-right bg-transparent px-2 py-1 rounded border border-dashed border-slate-300 focus:border-[#0a6652] focus:bg-[#f3faf6] outline-none font-medium" />
                    </td>
                    <td className="px-3 py-2 border-r border-slate-300 text-right font-bold text-[#0a6652] bg-[#fafdfa] shadow-[-4px_0_10px_rgba(0,0,0,0.02)]">{row.total}</td>
                    <td className="px-3 py-2 text-center text-green-600 font-bold">{row.checked ? '✓' : ''}</td>
                  </tr>
                ))}
                <tr className="sav-tot bg-slate-50 text-slate-800 font-bold !border-t-2 !border-slate-800 h-12">
                  <td colSpan={3} className="px-3 py-2 border-r border-slate-300 text-center">សរុប</td>
                  <td className="px-3 py-2 border-r border-slate-300 text-right">{n2(sumOf(groupData, 'startCapital'))}</td>
                  <td className="px-3 py-2 border-r border-slate-300 text-right text-xs">{sumOf(groupData, 'share').toFixed(2)}%</td>
                  <td className="px-3 py-2 border-r border-slate-300 text-right">{n2(sumOf(groupData, 'addSaving'))}</td>
                  <td className="px-3 py-2 border-r border-slate-300 text-right">{n2(sumOf(groupData, 'manualAdd'))}</td>
                  <td className="px-3 py-2 border-r border-slate-300 text-right">{n2(sumOf(groupData, 'profit'))}</td>
                  <td className="px-3 py-2 border-r border-slate-300 text-right">{n2(sumOf(groupData, 'withdraw'))}</td>
                  <td className="px-3 py-2 border-r border-slate-300 text-right">{n2(sumOf(groupData, 'deductFee'))}</td>
                  <td className="px-3 py-2 border-r border-slate-300 text-right">{n2(sumOf(groupData, 'actualFee'))}</td>
                  <td className="px-3 py-2 border-r border-slate-300 text-right text-[#0a6652] bg-[#fafdfa]">{n2(sumOf(groupData, 'total'))}</td>
                  <td className="px-3 py-2"></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'deposit' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col p-1 px-4 md:px-6 md:p-6 mb-6">
          <div className="sav-frz overflow-x-auto border border-slate-300 rounded-xl">
            <table className="w-full text-left border-collapse text-sm min-w-[1200px]">
              <thead className="bg-[#eef8f2] text-[#0a6652] border-b-[3px] border-[#0a6652] text-center font-bold">
                <tr>
                  <th rowSpan={2} className="px-3 py-3 border-r border-slate-300 align-middle">ល.រ</th>
                  <th rowSpan={2} className="px-3 py-3 border-r border-slate-300 align-middle min-w-[140px]">ឈ្មោះ</th>
                  <th rowSpan={2} className="px-3 py-3 border-r border-slate-300 align-middle">ភេទ</th>
                  <th rowSpan={2} className="px-3 py-3 border-r border-slate-300 align-middle">ភូមិ</th>
                  <th rowSpan={2} className="px-3 py-3 border-r border-slate-300 align-middle">ទុនចាប់ផ្តើម</th>
                  <th rowSpan={2} className="px-3 py-3 border-r border-slate-300 align-middle">ទុនសន្សំបន្ថែម</th>
                  <th rowSpan={2} className="px-3 py-3 border-r border-slate-300 align-middle">ប្រាក់ចំណេញ</th>
                  <th rowSpan={2} className="px-3 py-3 border-r border-slate-300 align-middle">ដកទុន</th>
                  <th colSpan={2} className="px-3 py-2 border-r border-b border-slate-300">ប្រាក់ពិន័យ/សមាជិកភាព</th>
                  <th rowSpan={2} className="px-3 py-3 border-r border-slate-300 align-middle shadow-[-4px_0_10px_rgba(0,0,0,0.02)] bg-[#f3faf6] text-[#084f40]">ប្រាក់សន្សំសរុប</th>
                  <th rowSpan={2} className="px-3 py-3 align-middle">កំណត់សំគាល់</th>
                </tr>
                <tr>
                  <th className="px-3 py-2 border-r border-slate-300 text-xs">កាត់ទុន</th>
                  <th className="px-3 py-2 border-r border-slate-300 text-xs">ជាក់ស្តែង</th>
                </tr>
              </thead>
              <tbody>
                {depositData.map((row, idx) => (
                  <tr key={`${row.id}-${idx}`} className="border-b border-slate-300 hover:bg-slate-50 transition-colors h-11">
                    <td className="px-3 py-2 border-r border-slate-300 text-center text-slate-500 font-medium">{typeof row.id === 'string' ? row.id.split(' ').pop() : row.id}</td>
                    <td className="px-3 py-2 border-r border-slate-300 font-bold text-slate-800">{row.name}</td>
                    <td className="px-3 py-2 border-r border-slate-300 text-center text-slate-500">{row.gender}</td>
                    <td className="px-3 py-2 border-r border-slate-300 text-center text-slate-500">{row.village}</td>
                    <td className="px-1 py-1 border-r border-slate-300 text-right">
                      {isFirstMonth ? (
                        <input value={showVal(row.startCapital)} onChange={(e) => editDepositRaw(idx, 'startCapital', e.target.value)} onBlur={saveSavingsMonth}
                          className="w-24 text-right bg-transparent px-2 py-1 rounded border border-dashed border-slate-300 focus:border-[#0a6652] focus:bg-[#f3faf6] outline-none font-medium" />
                      ) : (
                        <span className="block px-2 py-1 text-right font-medium text-slate-600" title="អូតូពីសរុបខែមុន">{row.startCapital}</span>
                      )}
                    </td>
                    <td className="px-1 py-1 border-r border-slate-300 text-right">
                      <input value={showVal(row.addSaving)} onChange={(e) => editDepositRaw(idx, 'addSaving', e.target.value)} onBlur={saveSavingsMonth}
                        className="w-20 text-right bg-transparent px-2 py-1 rounded border border-dashed border-slate-300 focus:border-[#0a6652] focus:bg-[#f3faf6] outline-none font-medium" />
                    </td>
                    <td className="px-3 py-2 border-r border-slate-300 text-right font-medium">{row.profit}</td>
                    <td className="px-1 py-1 border-r border-slate-300 text-right">
                      <input value={showVal(row.withdraw)} onChange={(e) => editDepositRaw(idx, 'withdraw', e.target.value)} onBlur={saveSavingsMonth}
                        className="w-20 text-right bg-transparent px-2 py-1 rounded border border-dashed border-slate-300 focus:border-[#0a6652] focus:bg-[#f3faf6] outline-none font-medium" />
                    </td>
                    <td className="px-1 py-1 border-r border-slate-300 text-right">
                      <input value={showVal(row.deductFee)} onChange={(e) => editDepositRaw(idx, 'deductFee', e.target.value)} onBlur={saveSavingsMonth}
                        className="w-20 text-right bg-transparent px-2 py-1 rounded border border-dashed border-slate-300 focus:border-[#0a6652] focus:bg-[#f3faf6] outline-none font-medium" />
                    </td>
                    <td className="px-1 py-1 border-r border-slate-300 text-right">
                      <input value={showVal(row.actualFee)} onChange={(e) => editDepositRaw(idx, 'actualFee', e.target.value)} onBlur={saveSavingsMonth}
                        className="w-20 text-right bg-transparent px-2 py-1 rounded border border-dashed border-slate-300 focus:border-[#0a6652] focus:bg-[#f3faf6] outline-none font-medium" />
                    </td>
                    <td className="px-3 py-2 border-r border-slate-300 text-right font-bold text-[#0a6652] bg-[#fafdfa] shadow-[-4px_0_10px_rgba(0,0,0,0.02)]">{row.total}</td>
                    <td className="px-3 py-2 text-center text-green-600 font-bold">{row.checked ? '✓' : ''}</td>
                  </tr>
                ))}
                <tr className="sav-tot bg-slate-50 text-slate-800 font-bold !border-t-2 !border-slate-800 h-12">
                  <td colSpan={4} className="px-3 py-2 border-r border-slate-300 text-center">សរុប</td>
                  <td className="px-3 py-2 border-r border-slate-300 text-right">{n2(sumOf(depositData, 'startCapital'))}</td>
                  <td className="px-3 py-2 border-r border-slate-300 text-right">{n2(sumOf(depositData, 'addSaving'))}</td>
                  <td className="px-3 py-2 border-r border-slate-300 text-right">{n2(sumOf(depositData, 'profit'))}</td>
                  <td className="px-3 py-2 border-r border-slate-300 text-right">{n2(sumOf(depositData, 'withdraw'))}</td>
                  <td className="px-3 py-2 border-r border-slate-300 text-right">{n2(sumOf(depositData, 'deductFee'))}</td>
                  <td className="px-3 py-2 border-r border-slate-300 text-right">{n2(sumOf(depositData, 'actualFee'))}</td>
                  <td className="px-3 py-2 border-r border-slate-300 text-right text-[#0a6652] bg-[#fafdfa]">{n2(sumOf(depositData, 'total'))}</td>
                  <td className="px-3 py-2"></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'fixedterm' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col p-1 px-4 md:px-6 md:p-6 mb-6">
          <div className="text-xs text-slate-500 mb-3">គណនីមានកាលកំណត់ — ទទួលការប្រាក់ <b>1%/ខែ</b> លើទុនចាប់ផ្តើម។ ទុនចាប់ផ្តើមខែបន្ទាប់ = សរុបខែមុន (អូតូ)។</div>
          <div className="overflow-x-auto border border-slate-300 rounded-xl">
            <table className="w-full text-left border-collapse text-sm min-w-[900px]">
              <thead className="bg-[#eef8f2] text-[#0a6652] border-b-[3px] border-[#0a6652] text-center font-bold">
                <tr>
                  <th className="px-3 py-3 border-r border-slate-300">លេខ ID</th>
                  <th className="px-3 py-3 border-r border-slate-300 min-w-[140px]">ឈ្មោះ</th>
                  <th className="px-3 py-3 border-r border-slate-300">ភេទ</th>
                  <th className="px-3 py-3 border-r border-slate-300">ទុនចាប់ផ្តើម</th>
                  <th className="px-3 py-3 border-r border-slate-300">ការប្រាក់ (1%)</th>
                  <th className="px-3 py-3 border-r border-slate-300">ទុនសន្សំបន្ថែម</th>
                  <th className="px-3 py-3 border-r border-slate-300">ដកទុន</th>
                  <th className="px-3 py-3 text-[#084f40] bg-[#f3faf6]">ប្រាក់សន្សំសរុប</th>
                </tr>
              </thead>
              <tbody>
                {fixedTermData.map((row: any, idx: number) => (
                  <tr key={`${row.id}-${idx}`} className="border-b border-slate-300 hover:bg-slate-50 transition-colors h-11">
                    <td className="px-3 py-2 border-r border-slate-300 text-center text-slate-500 font-medium">{typeof row.id === 'string' ? row.id.split(' ').pop() : row.id}</td>
                    <td className="px-3 py-2 border-r border-slate-300 font-bold text-slate-800">{row.name}</td>
                    <td className="px-3 py-2 border-r border-slate-300 text-center text-slate-500">{row.gender}</td>
                    <td className="px-1 py-1 border-r border-slate-300 text-right">
                      {isFirstMonth ? (
                        <input value={row.startCapital} onChange={(e) => editFixedTermRaw(idx, 'startCapital', e.target.value)} onBlur={saveFixedTermMonth}
                          className="w-24 text-right bg-transparent px-2 py-1 rounded border border-dashed border-slate-300 focus:border-[#0a6652] focus:bg-[#f3faf6] outline-none font-medium" />
                      ) : (<span className="block px-2 py-1 text-right font-medium text-slate-600" title="អូតូពីសរុបខែមុន">{row.startCapital}</span>)}
                    </td>
                    <td className="px-3 py-2 border-r border-slate-300 text-right font-medium text-indigo-600">{row.interest}</td>
                    <td className="px-1 py-1 border-r border-slate-300 text-right">
                      <input value={row.addSaving} onChange={(e) => editFixedTermRaw(idx, 'addSaving', e.target.value)} onBlur={saveFixedTermMonth}
                        className="w-20 text-right bg-transparent px-2 py-1 rounded border border-dashed border-slate-300 focus:border-[#0a6652] focus:bg-[#f3faf6] outline-none font-medium" />
                    </td>
                    <td className="px-1 py-1 border-r border-slate-300 text-right">
                      <input value={row.withdraw} onChange={(e) => editFixedTermRaw(idx, 'withdraw', e.target.value)} onBlur={saveFixedTermMonth}
                        className="w-20 text-right bg-transparent px-2 py-1 rounded border border-dashed border-slate-300 focus:border-amber-600 focus:bg-amber-50 outline-none font-medium text-amber-700" />
                    </td>
                    <td className="px-3 py-2 text-right font-bold text-[#0a6652] bg-[#fafdfa]">{row.total}</td>
                  </tr>
                ))}
                <tr className="bg-slate-50 text-slate-800 font-bold border-t-2 border-slate-800 h-12">
                  <td colSpan={3} className="px-3 py-2 border-r border-slate-300 text-center">សរុប</td>
                  <td className="px-3 py-2 border-r border-slate-300 text-right">{fmtMoney(fixedTermData.reduce((s: number, r: any) => s + num(r.startCapital), 0))}</td>
                  <td className="px-3 py-2 border-r border-slate-300 text-right text-indigo-700">{fmtMoney(fixedTermData.reduce((s: number, r: any) => s + num(r.interest), 0))}</td>
                  <td className="px-3 py-2 border-r border-slate-300 text-right">{fmtMoney(fixedTermData.reduce((s: number, r: any) => s + num(r.addSaving), 0))}</td>
                  <td className="px-3 py-2 border-r border-slate-300 text-right text-amber-700">{fmtMoney(fixedTermData.reduce((s: number, r: any) => s + num(r.withdraw), 0))}</td>
                  <td className="px-3 py-2 text-right text-[#0a6652] bg-[#fafdfa]">{fmtMoney(fixedTermData.reduce((s: number, r: any) => s + num(r.total), 0))}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="flex justify-end gap-3 mt-4">
        {undoSavings && (
          <button
            onClick={handleUndoSavings}
            className="bg-amber-50 hover:bg-amber-100 text-amber-700 font-bold text-xs px-6 py-2.5 rounded-xl transition-all shadow-sm flex items-center gap-2 cursor-pointer active:scale-95 border border-amber-200"
          >
            <ChevronLeft size={16} />
            <span>មិនធ្វើវិញ (Undo លុប)</span>
          </button>
        )}
        <button
          onClick={handleDeleteAllSavings}
          className="bg-red-50 hover:bg-red-100 text-red-600 font-bold text-xs px-6 py-2.5 rounded-xl transition-all shadow-sm flex items-center gap-2 cursor-pointer active:scale-95"
        >
          <Trash2 size={16} />
          <span>លុបទាំងអស់</span>
        </button>
        <button
          onClick={handleSaveAllSavings}
          className="bg-[#0a6652] hover:bg-[#085343] text-white font-extrabold text-xs px-6 py-2.5 rounded-xl transition-all shadow-sm flex items-center gap-2 cursor-pointer active:scale-95"
        >
          <Save size={16} />
          <span>រក្សាទុក</span>
        </button>
      </div>
    </PageView>
  );
}

function Loans() {
  const navigate = useNavigate();
  const [selectedMonth, setSelectedMonth] = useState('មេសា 2026');
  const [activeTab, setActiveTab] = useState('members');
  const months = ['មករា 2026', 'កុម្ភៈ 2026', 'មីនា 2026', 'មេសា 2026', 'ឧសភា 2026', 'មិថុនា 2026', 'កក្កដា 2026', 'សីហា 2026', 'កញ្ញា 2026', 'តុលា 2026', 'វិច្ឆិកា 2026', 'ធ្នូ 2026'];

  const [loanData, setLoanData] = useState(() => {
    let ld = getStoredData('sof_loans_data', DEFAULT_LOAN_DATA) || [];
    const pfd = getStoredData('sof_profile_data', DEFAULT_PROFILE_DATA) || [];
    let modified = false;

    const validCodes = new Set(pfd.map((p: any) => typeof p.id === 'string' ? p.id.split(' ').pop() : p.code));
    const filteredLd = ld.filter((x: any) => validCodes.has(x.id));
    if (filteredLd.length !== ld.length) {
      ld = filteredLd;
      modified = true;
    }

    pfd.forEach((p: any) => {
      let code = typeof p.id === 'string' ? p.id.split(' ').pop() : p.code;
      if (!code) code = p.code;
      let l = ld.find((x: any) => x.id === code);
      if (!l) {
        ld.push({
           id: code, name: p.name, gender: p.gender,
           loanValue: '-', repayment: '-', interest: '-', newLoan: '-', remaining: '-', interestPaid: '-', checked: true
        });
        modified = true;
      } else if (l.name !== p.name || l.gender !== p.gender) {
        l.name = p.name;
        l.gender = p.gender;
        modified = true;
      }
    });
    if (modified) setStoredData('sof_loans_data', ld);
    return ld;
  });

  const [depositLoanData, setDepositLoanData] = useState(() => {
    let dld = getStoredData('sof_loans_deposit_data', DEFAULT_DEPOSIT_LOAN_DATA) || [];
    const dpf = getStoredData('sof_deposit_profile_data', DEFAULT_DEPOSIT_PROFILE_DATA) || [];
    let modified = false;

    const validCodes = new Set(dpf.map((p: any) => typeof p.id === 'string' ? p.id.split(' ').pop() : p.code));
    const filteredDld = dld.filter((x: any) => validCodes.has(x.id));
    if (filteredDld.length !== dld.length) {
      dld = filteredDld;
      modified = true;
    }

    dpf.forEach((p: any) => {
      let code = typeof p.id === 'string' ? p.id.split(' ').pop() : p.code;
      if (!code) code = p.code;
      let l = dld.find((x: any) => x.id === code);
      if (!l) {
        dld.push({
           id: code, name: p.name, gender: p.gender,
           loanValue: '-', repayment: '-', interest: '-', newLoan: '-', remaining: '-', interestPaid: '-', checked: true
        });
        modified = true;
      } else if (l.name !== p.name || l.gender !== p.gender) {
        l.name = p.name;
        l.gender = p.gender;
        modified = true;
      }
    });
    if (modified) setStoredData('sof_loans_deposit_data', dld);
    return dld;
  });

  // Recompute one loan row via the engine. Unpaid interest (ការប្រាក់ត្រូវបង់ −
  // ការប្រាក់បានបង់) auto-capitalises into កម្ចីថ្មី (newLoan), so remaining grows
  // by the unpaid amount — UNLESS the user has typed a value into the newLoan column.
  const recalcLoanRow = (merged: any) => {
    const fmt = (v: number) => (v ? v.toFixed(2) : '-');
    const beginning = num(merged.loanValue);
    // Use the row's entered rate as-is (including 0%). Only fall back to the default
    // when no rate has been entered at all (blank field).
    const hasRate = merged.rate !== undefined && merged.rate !== null && String(merged.rate).trim() !== '';
    const rate = hasRate ? num(merged.rate) / 100 : undefined;
    // Interest due, rounded to cents so the displayed columns reconcile exactly:
    //   កម្ចីថ្មី (auto) = ការប្រាក់ត្រូវបង់ − ការប្រាក់បានបង់.
    const interestDue = Number(((rate ?? DEFAULT_RATES.loan) * beginning).toFixed(2));
    const unpaid = Math.max(0, Number((interestDue - num(merged.interestPaid)).toFixed(2)));
    const newLoanVal = merged.newLoanEdited ? num(merged.newLoan) : unpaid;
    const res = computeLoan({
      id: merged.id, beginning, newLoan: newLoanVal, repayment: num(merged.repayment), rate,
    }, DEFAULT_RATES);
    return {
      ...merged,
      interest: fmt(interestDue),
      newLoan: merged.newLoanEdited ? merged.newLoan : fmt(unpaid),
      remaining: fmt(res.remaining),
    };
  };

  const isFirstMonth = selectedMonth === months[0];

  // Compute one loan dataset up to `upto`, recomputing every prior month in order so the
  // carry-forward beginning (កម្ចីដើមគ្រា) always equals the previous month's freshly
  // recomputed remaining (កម្ចីនៅសល់សរុប). First month's beginning is entered manually.
  const computeLoanChain = (upto: string, byKey: string, rosterKey: string, rosterDef: any[]) => {
    const byMonth = getStoredData(byKey, {});
    const idx = months.indexOf(upto);
    let prevRemaining: Record<string, any> | null = null;
    let result: any[] = [];
    for (let i = 0; i <= idx; i++) {
      const month = months[i];
      let rows = (byMonth[month] && byMonth[month].length) ? byMonth[month] : getStoredData(rosterKey, rosterDef) || [];
      if (prevRemaining) {
        rows = rows.map((r: any) => (prevRemaining![r.id] !== undefined ? { ...r, loanValue: String(prevRemaining![r.id]) } : r));
      }
      rows = rows.map(recalcLoanRow);
      prevRemaining = {};
      rows.forEach((r: any) => { prevRemaining![r.id] = r.remaining; });
      result = rows;
    }
    return result;
  };

  // Load the selected month's loans with carry-forward + auto interest/new-loan/remaining.
  useEffect(() => {
    setLoanData(computeLoanChain(selectedMonth, 'sof_loans_by_month', 'sof_loans_data', DEFAULT_LOAN_DATA));
    setDepositLoanData(computeLoanChain(selectedMonth, 'sof_loans_deposit_by_month', 'sof_loans_deposit_data', DEFAULT_DEPOSIT_LOAN_DATA));
  }, [selectedMonth]);

  // Show a blank input instead of the placeholder "-" so typing doesn't produce "1-".
  const showVal = (v: any) => (v === '-' || v == null ? '' : v);
  // Edit a raw loan input. Typing into newLoan marks it manual; clearing it reverts to auto.
  const editLoanRaw = (idx: number, field: string, value: string) => {
    setLoanData(loanData.map((r: any, i: number) => {
      if (i !== idx) return r;
      const merged = { ...r, [field]: value };
      if (field === 'newLoan') merged.newLoanEdited = value.trim() !== '' && value.trim() !== '-';
      return recalcLoanRow(merged);
    }));
  };
  const saveLoansMonth = () => {
    const by = getStoredData('sof_loans_by_month', {}); by[selectedMonth] = loanData; setStoredData('sof_loans_by_month', by);
  };
  // Deposit-member loans: same engine, separate dataset/storage.
  const editDepositLoanRaw = (idx: number, field: string, value: string) => {
    setDepositLoanData(depositLoanData.map((r: any, i: number) => {
      if (i !== idx) return r;
      const merged = { ...r, [field]: value };
      if (field === 'newLoan') merged.newLoanEdited = value.trim() !== '' && value.trim() !== '-';
      return recalcLoanRow(merged);
    }));
  };
  const saveDepositLoanMonth = () => {
    const by = getStoredData('sof_loans_deposit_by_month', {}); by[selectedMonth] = depositLoanData; setStoredData('sof_loans_deposit_by_month', by);
  };

  // First-month (មករា) paste import: one line per member → set the opening loan.
  const [showLoanImport, setShowLoanImport] = useState(false);
  const [loanImportText, setLoanImportText] = useState('');
  const loanCodeOf = (r: any) => (typeof r.id === 'string' && r.id.includes(' ') ? r.id.split(' ').pop() : r.id);
  // Column totals for the loan footer "សរុប" row.
  const loanSum = (rows: any[], field: string) => rows.reduce((s, r) => s + num(r[field]), 0);
  const ln2 = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const handlePasteLoanImport = () => {
    const isDeposit = activeTab === 'deposit_members';
    const data = isDeposit ? depositLoanData : loanData;
    const setData = isDeposit ? setDepositLoanData : setLoanData;
    const saveKey = isDeposit ? 'sof_loans_deposit_by_month' : 'sof_loans_by_month';
    const lines = loanImportText.split('\n').map((l) => l.trim()).filter(Boolean);
    const next = [...data];
    let count = 0;
    lines.forEach((line) => {
      const p = line.split(/[\t,]+|\s{2,}|\s+/).map((s) => s.trim()).filter(Boolean);
      if (p.length < 2) return;
      const code = p[0].toUpperCase();
      const i = next.findIndex((r: any) => String(loanCodeOf(r)).toUpperCase() === code);
      if (i < 0) return;
      const merged: any = { ...next[i], loanValue: p[1] };
      if (p[2] !== undefined) merged.rate = p[2];
      if (p[3] !== undefined) merged.repayment = p[3];
      if (p[4] !== undefined) merged.interestPaid = p[4];
      next[i] = recalcLoanRow(merged);
      count++;
    });
    setData(next);
    const by = getStoredData(saveKey, {}); by[selectedMonth] = next; setStoredData(saveKey, by);
    setShowLoanImport(false); setLoanImportText('');
    alert(`នាំចូល ${count} កម្ចី សម្រាប់ខែ ${selectedMonth} ដោយជោគជ័យ!`);
  };

  // ---- External loans (borrowed from / lent to outside) — editable per month ----
  // Default seed for any month with no saved rows yet.
  const EXTERNAL_RECEIVED_DEFAULT = [
    { id: 'I01', name: 'កម្ចីទទួលបានពី LSG', gender: 'ក្រុម', received: '-', repayment: '-', interestRate: '1.20%', duration: '', newLoan: '-', remaining: '-', interest: '-', totalToPay: '-', note: '' }
  ];
  const EXTERNAL_PROVIDED_DEFAULT = [
    { id: 'O01', name: 'ដៃគូ SIG', gender: '-', received: '391.70', repayment: '-', interestRate: '0.00%', duration: '', newLoan: '-', remaining: '391.70', interest: '-', totalToPay: '-', note: '' },
    { id: 'O02', name: 'ដៃគូ ឃ្លាំង', gender: '-', received: '2,870.91', repayment: '-', interestRate: '0.00%', duration: '', newLoan: '-', remaining: '2,870.91', interest: '-', totalToPay: '-', note: '' },
    { id: 'O03', name: 'ដៃគូ SOF', gender: '-', received: '7,286.91', repayment: '-', interestRate: '0.00%', duration: '', newLoan: '-', remaining: '7,286.91', interest: '-', totalToPay: '-', note: '' }
  ];
  // The roster (id/name/gender + which rows exist) is GLOBAL across months; only the
  // financial columns are per month. Static config per tab:
  const EXT: any = {
    received: { by: 'sof_external_received_by_month', roster: 'sof_external_received_roster', prefix: 'I', def: EXTERNAL_RECEIVED_DEFAULT, rate: '1.20%' },
    provided: { by: 'sof_external_provided_by_month', roster: 'sof_external_provided_roster', prefix: 'O', def: EXTERNAL_PROVIDED_DEFAULT, rate: '0.00%' },
  };
  // Default roster = the seed rows ∪ any rows already saved in past months (migration,
  // so rows added before this change aren't lost).
  const buildRoster = (which: 'received' | 'provided') => {
    const c = EXT[which];
    const roster = c.def.map((r: any) => ({ id: r.id, name: r.name, gender: r.gender }));
    const seen = new Set(roster.map((r: any) => r.id));
    const by = getStoredData(c.by, {}) || {};
    Object.values(by).forEach((rows: any) => Array.isArray(rows) && rows.forEach((r: any) => {
      if (!seen.has(r.id)) { seen.add(r.id); roster.push({ id: r.id, name: r.name, gender: r.gender }); }
    }));
    return roster;
  };
  const getRoster = (which: 'received' | 'provided') => getStoredData(EXT[which].roster, buildRoster(which));
  const defFinOf = (which: 'received' | 'provided') => { const m: any = {}; EXT[which].def.forEach((r: any) => { m[r.id] = r; }); return m; };
  // Auto-calc one external-loan row from its entered values:
  //   កម្ចីនៅសល់ (remaining) = កម្ចីទទួលបាន + កម្ចីថ្មី − កម្ចីសងត្រឡប់
  //   ការប្រាក់ (interest)  = អត្រា% × កម្ចីទទួលបាន
  //   ប្រាក់ត្រូវបង់សរុប     = នៅសល់ + ការប្រាក់
  const recalcExtRow = (row: any) => {
    const received = num(row.received), newLoan = num(row.newLoan), repayment = num(row.repayment);
    const rate = num(row.interestRate) / 100;
    const remaining = received + newLoan - repayment;
    const interest = rate * received;
    const hasAny = received || newLoan || repayment;
    return {
      ...row,
      remaining: hasAny ? fmtMoney(remaining) : '-',
      interest: (rate && received) ? fmtMoney(interest) : '-',
      totalToPay: hasAny ? fmtMoney(remaining + interest) : '-',
    };
  };
  // Compute a tab's rows for `upto`, walking every month so each month's remaining
  // (កម្ចីនៅសល់) carries into the next month's beginning (កម្ចីទទួលបាន). The first
  // month's beginning is entered manually; later months inherit it.
  const computeExtChain = (which: 'received' | 'provided', upto: string) => {
    const c = EXT[which];
    const roster = getRoster(which);
    const by = getStoredData(c.by, {}) || {};
    const df = defFinOf(which);
    const idx = months.indexOf(upto);
    let prevRemaining: Record<string, number> | null = null;
    let prevRate: Record<string, string> | null = null;
    let result: any[] = [];
    for (let i = 0; i <= idx; i++) {
      const monthRows = Array.isArray(by[months[i]]) ? by[months[i]] : [];
      const fin: any = {}; monthRows.forEach((r: any) => { fin[r.id] = r; });
      result = roster.map((rr: any) => {
        const f = fin[rr.id] || df[rr.id] || {};
        const pr = prevRemaining ? (prevRemaining[rr.id] || 0) : 0;
        const received = i === 0 ? (f.received ?? '-') : (pr ? fmtMoney(pr) : '-');
        // Rate entered for this month wins; otherwise carry the previous month's rate.
        const entered = fin[rr.id]?.interestRate;
        const rate = (entered != null && entered !== '') ? entered
          : (prevRate?.[rr.id] != null ? prevRate[rr.id] : ((df[rr.id]?.interestRate) ?? c.rate));
        return recalcExtRow({
          id: rr.id, name: rr.name, gender: rr.gender, received,
          repayment: f.repayment ?? '-', newLoan: f.newLoan ?? '-',
          interestRate: rate, duration: f.duration ?? '', note: f.note ?? '',
        });
      });
      prevRemaining = {}; prevRate = {};
      result.forEach((r: any) => { prevRemaining![r.id] = num(r.remaining); prevRate![r.id] = r.interestRate; });
    }
    return result;
  };
  const [extReceived, setExtReceived] = useState<any[]>(() => computeExtChain('received', 'មេសា 2026'));
  const [extProvided, setExtProvided] = useState<any[]>(() => computeExtChain('provided', 'មេសា 2026'));
  useEffect(() => {
    setExtReceived(computeExtChain('received', selectedMonth));
    setExtProvided(computeExtChain('provided', selectedMonth));
  }, [selectedMonth]);
  const extConf: any = {
    received: { ...EXT.received, data: extReceived, set: setExtReceived },
    provided: { ...EXT.provided, data: extProvided, set: setExtProvided },
  };
  // Persist both the month's financials AND the global roster (names/gender/order).
  const persistExt = (which: 'received' | 'provided', rows: any[]) => {
    const c = EXT[which];
    const by = getStoredData(c.by, {}) || {}; by[selectedMonth] = rows; setStoredData(c.by, by);
    setStoredData(c.roster, rows.map((r: any) => ({ id: r.id, name: r.name, gender: r.gender })));
  };
  const editExt = (which: 'received' | 'provided', idx: number, field: string, value: string) => {
    extConf[which].set(extConf[which].data.map((r: any, i: number) => {
      if (i !== idx) return r;
      const merged = { ...r, [field]: value };
      // Recompute totals when an input that feeds them changes.
      return ['received', 'repayment', 'newLoan', 'interestRate'].includes(field) ? recalcExtRow(merged) : merged;
    }));
  };
  const saveExt = (which: 'received' | 'provided') => persistExt(which, extConf[which].data);
  const nextExtId = (prefix: string, rows: any[]) => {
    let max = 0; rows.forEach((r) => { const m = /(\d+)$/.exec(String(r.id)); if (m) max = Math.max(max, parseInt(m[1], 10)); });
    return `${prefix}${String(max + 1).padStart(2, '0')}`;
  };
  const addExtRow = (which: 'received' | 'provided') => {
    const c = extConf[which];
    const id = nextExtId(c.prefix, c.data);
    const next = [...c.data, { id, name: '', gender: '-', received: '-', repayment: '-', interestRate: c.rate, duration: '', newLoan: '-', remaining: '-', interest: '-', totalToPay: '-', note: '' }];
    c.set(next); persistExt(which, next);
  };
  const delExtRow = (which: 'received' | 'provided', idx: number) => {
    const next = extConf[which].data.filter((_: any, i: number) => i !== idx);
    extConf[which].set(next); persistExt(which, next);
  };
  // Editable table shared by both external tabs.
  const renderExtTable = (which: 'received' | 'provided') => {
    const c = extConf[which];
    const inp = (row: any, idx: number, field: string, align = 'text-right') =>
      <input value={showVal(row[field])} onChange={(e) => editExt(which, idx, field, e.target.value)} onBlur={() => saveExt(which)}
        className={`w-full min-w-[70px] bg-transparent ${align} px-2 py-1 rounded border border-dashed border-slate-300 focus:border-[#0a6652] focus:bg-[#f3faf6] outline-none font-medium`} />;
    // Read-only computed/carried cell.
    const ro = (row: any, field: string, align = 'text-right') =>
      <span className={`block w-full min-w-[70px] ${align} px-2 py-1 font-medium`}>{row[field]}</span>;
    return (
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col p-1 px-4 md:px-6 md:p-6 mb-6">
        <div className="flex justify-end mb-3">
          <button onClick={() => addExtRow(which)}
            className="flex items-center gap-1.5 bg-[#0a6652] hover:bg-[#084f40] text-white font-bold text-xs px-4 py-2 rounded-xl shadow-sm cursor-pointer active:scale-95">
            <Plus size={15} /><span>បន្ថែមជួរ</span>
          </button>
        </div>
        <div className="frz2 overflow-x-auto border border-slate-300 rounded-xl">
          <table className="w-full text-left border-collapse text-sm min-w-[1280px]">
            <thead className="bg-[#eef8f2] text-[#0a6652] border-b-[3px] border-[#0a6652] text-center font-bold">
              <tr>
                <th className="px-3 py-3 border-r border-slate-300 align-middle">លរ</th>
                <th className="px-3 py-3 border-r border-slate-300 align-middle min-w-[200px]">ឈ្មោះ</th>
                <th className="px-3 py-3 border-r border-slate-300 align-middle">ភេទ</th>
                <th className="px-3 py-3 border-r border-slate-300 align-middle text-right">កម្ចី<br/>ទទួលបាន</th>
                <th className="px-3 py-3 border-r border-slate-300 align-middle text-right">កម្ចី<br/>សងត្រឡប់</th>
                <th className="px-3 py-3 border-r border-slate-300 align-middle text-center">អត្រាការប្រាក់</th>
                <th className="px-3 py-3 border-r border-slate-300 align-middle text-center">រយៈពេល</th>
                <th className="px-3 py-3 border-r border-slate-300 align-middle text-right">កម្ចីថ្មី</th>
                <th className="px-3 py-3 border-r border-slate-300 align-middle text-right">កម្ចី<br/>នៅសល់</th>
                <th className="px-3 py-3 border-r border-slate-300 align-middle text-right">ការប្រាក់</th>
                <th className="px-3 py-3 border-r border-slate-300 align-middle text-right text-[#084f40] bg-[#f3faf6]">ប្រាក់ត្រូវបង់<br/>សរុប</th>
                <th className="px-3 py-3 border-r border-slate-300 align-middle">សំគាល់</th>
                <th className="px-3 py-3 align-middle"></th>
              </tr>
            </thead>
            <tbody>
              {c.data.map((row: any, idx: number) => (
                <tr key={`${row.id}-${idx}`} className="border-b border-slate-300 hover:bg-slate-50 transition-colors h-11">
                  <td className="px-3 py-2 border-r border-slate-300 text-center text-slate-500 font-medium">{typeof row.id === 'string' ? row.id.split(' ').pop() : row.id}</td>
                  <td className="px-1 py-1 border-r border-slate-300">{inp(row, idx, 'name', 'text-left')}</td>
                  <td className="px-1 py-1 border-r border-slate-300">{inp(row, idx, 'gender', 'text-center')}</td>
                  <td className="px-1 py-1 border-r border-slate-300">{isFirstMonth ? inp(row, idx, 'received') : ro(row, 'received')}</td>
                  <td className="px-1 py-1 border-r border-slate-300">{inp(row, idx, 'repayment', 'text-right text-amber-600')}</td>
                  <td className="px-1 py-1 border-r border-slate-300">{inp(row, idx, 'interestRate', 'text-center')}</td>
                  <td className="px-1 py-1 border-r border-slate-300">{inp(row, idx, 'duration', 'text-center')}</td>
                  <td className="px-1 py-1 border-r border-slate-300">{inp(row, idx, 'newLoan', 'text-right text-emerald-600')}</td>
                  <td className="px-1 py-1 border-r border-slate-300 bg-slate-50">{ro(row, 'remaining')}</td>
                  <td className="px-1 py-1 border-r border-slate-300 text-indigo-600">{ro(row, 'interest')}</td>
                  <td className="px-1 py-1 border-r border-slate-300 bg-[#fafdfa] text-[#0a6652] font-bold">{ro(row, 'totalToPay')}</td>
                  <td className="px-1 py-1 border-r border-slate-300">{inp(row, idx, 'note', 'text-left')}</td>
                  <td className="px-2 py-2 text-center">
                    <button onClick={() => delExtRow(which, idx)} title="លុបជួរ" className="text-rose-400 hover:text-rose-600 cursor-pointer"><Trash2 size={15} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-slate-50 text-slate-800 font-bold border-t-2 border-slate-800 h-12">
                <td colSpan={3} className="px-3 py-2 border-r border-slate-300 text-center">សរុប</td>
                <td className="px-3 py-2 border-r border-slate-300 text-right">{fmtMoney(loanSum(c.data, 'received'))}</td>
                <td className="px-3 py-2 border-r border-slate-300 text-right text-amber-700">{fmtMoney(loanSum(c.data, 'repayment'))}</td>
                <td className="px-3 py-2 border-r border-slate-300"></td>
                <td className="px-3 py-2 border-r border-slate-300"></td>
                <td className="px-3 py-2 border-r border-slate-300 text-right text-emerald-700">{fmtMoney(loanSum(c.data, 'newLoan'))}</td>
                <td className="px-3 py-2 border-r border-slate-300 text-right bg-slate-100">{fmtMoney(loanSum(c.data, 'remaining'))}</td>
                <td className="px-3 py-2 border-r border-slate-300 text-right text-indigo-700">{fmtMoney(loanSum(c.data, 'interest'))}</td>
                <td className="px-3 py-2 border-r border-slate-300 text-right text-[#0a6652] bg-[#f3faf6]">{fmtMoney(loanSum(c.data, 'totalToPay'))}</td>
                <td className="px-3 py-2 border-r border-slate-300"></td>
                <td className="px-3 py-2"></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    );
  };

  const handleDeleteAllLoans = () => {
    if (window.confirm('តើអ្នកពិតជាចង់លុបទិន្នន័យនេះមែនទេ? (សកម្មភាពនេះមិនអាចត្រឡប់វិញបានទេ)')) {
      if (activeTab === 'members') {
        setLoanData([]);
        setStoredData('sof_loans_data', []);
      } else if (activeTab === 'deposit_members') {
        setDepositLoanData([]);
        setStoredData('sof_loans_deposit_data', []);
      } else if (activeTab === 'group') {
        setExtReceived([]); persistExt('received', []);
      } else if (activeTab === 'external_provided') {
        setExtProvided([]); persistExt('provided', []);
      }
    }
  };

  const handleSaveAllLoans = async () => {
    if (activeTab === 'group') saveExt('received');
    else if (activeTab === 'external_provided') saveExt('provided');
    alert('ទិន្នន័យត្រូវបានរក្សាទុកទៅ Supabase ដោយជោគជ័យ!');
  };

  return (
    <PageView 
      onAddClick={() => navigate('/dashboard', { state: { tab: 'loan' } })}
      title={
      <div className="flex flex-col md:flex-row md:items-center gap-3">
        <span>របាយការណ៍កម្ចី - </span>
        <select 
          value={selectedMonth}
          onChange={(e) => setSelectedMonth(e.target.value)}
          className="text-lg md:text-xl font-bold bg-[#eef8f2] border border-green-200 text-[#0a6652] px-3 py-1 rounded-lg outline-none cursor-pointer shadow-sm w-fit"
        >
          {months.map(m => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
      </div>
    }>
      {/* Tabs */}
      <div className="flex flex-wrap gap-3 mb-6">
        <button 
          onClick={() => setActiveTab('members')}
          className={`px-6 py-2.5 rounded-full font-bold text-sm transition-colors ${activeTab === 'members' ? 'bg-[#0a6652] text-white shadow-md' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
        >
          កម្ចីសមជិកសកម្ម
        </button>
        <button 
          onClick={() => setActiveTab('deposit_members')}
          className={`px-6 py-2.5 rounded-full font-bold text-sm transition-colors ${activeTab === 'deposit_members' ? 'bg-[#0a6652] text-white shadow-md' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
        >
          កម្ចីសមាជិកបញ្ញើរ
        </button>
        <button 
          onClick={() => setActiveTab('group')}
          className={`px-6 py-2.5 rounded-full font-bold text-sm transition-colors ${activeTab === 'group' ? 'bg-[#0a6652] text-white shadow-md' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
        >
          កម្ចីទទួលបានពីខាងក្រៅ
        </button>
        <button 
          onClick={() => setActiveTab('external_provided')}
          className={`px-6 py-2.5 rounded-full font-bold text-sm transition-colors ${activeTab === 'external_provided' ? 'bg-[#0a6652] text-white shadow-md' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
        >
          កម្ចីផ្តល់ទៅខាងក្រៅ
        </button>
      </div>

      {showLoanImport && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setShowLoanImport(false)}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-lg shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold text-lg text-[#0a6652] mb-2">នាំចូលកម្ចីដើមគ្រា — {selectedMonth}</h3>
            <p className="text-xs text-slate-500 mb-3 leading-relaxed">
              បិទភ្ជាប់ពី Excel ៖ មួយជួរក្នុងមួយសមាជិក។<br />
              ទម្រង់៖ <b>លេខកូដ ⟶ កម្ចីដើមគ្រា</b> (ឧ. <code className="bg-slate-100 px-1">C001  100</code>)<br />
              ឬបន្ថែម៖ <b>លេខកូដ ⟶ កម្ចីដើមគ្រា ⟶ អត្រា% ⟶ បង់រំលស់ ⟶ ការប្រាក់បានបង់</b>
            </p>
            <textarea value={loanImportText} onChange={(e) => setLoanImportText(e.target.value)} rows={10}
              placeholder={"C001\t100\nC002\t250\nC003\t80"}
              className="w-full border border-slate-300 rounded-lg p-3 text-sm font-mono outline-none focus:border-[#0a6652]" />
            <div className="flex justify-end gap-2 mt-3">
              <button onClick={() => setShowLoanImport(false)} className="px-4 py-2 rounded-full text-sm font-bold bg-slate-100 text-slate-600 hover:bg-slate-200 cursor-pointer">បោះបង់</button>
              <button onClick={handlePasteLoanImport} className="px-4 py-2 rounded-full text-sm font-bold bg-[#0a6652] text-white hover:bg-[#084f40] cursor-pointer">នាំចូល</button>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'members' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col p-1 px-4 md:px-6 md:p-6 mb-6">
          {isFirstMonth && (
            <div className="flex justify-end mb-3">
              <button onClick={() => setShowLoanImport(true)} className="flex items-center gap-1.5 bg-[#0a6652] text-white px-4 py-2 rounded-full text-xs font-bold hover:bg-[#084f40] transition-colors cursor-pointer">
                <Upload size={14} strokeWidth={2.5} /> បិទភ្ជាប់ (Paste)
              </button>
            </div>
          )}
          <div className="frz2 overflow-x-auto border border-slate-300 rounded-xl">
            <table className="w-full text-left border-collapse text-sm min-w-[1200px]">
              <thead className="bg-[#eef8f2] text-[#0a6652] border-b-[3px] border-[#0a6652] text-center font-bold">
                <tr>
                  <th className="px-3 py-3 border-r border-slate-300 align-middle">លេខ ID</th>
                  <th className="px-3 py-3 border-r border-slate-300 align-middle min-w-[140px]">ឈ្មោះ</th>
                  <th className="px-3 py-3 border-r border-slate-300 align-middle">ភេទ</th>
                  <th className="px-3 py-3 border-r border-slate-300 align-middle text-right">កម្ចីដើមគ្រា</th>
                  <th className="px-3 py-3 border-r border-slate-300 align-middle text-center">អត្រាការប្រាក់</th>
                  <th className="px-3 py-3 border-r border-slate-300 align-middle text-right">ការប្រាក់ត្រូវបង់</th>
                  <th className="px-3 py-3 border-r border-slate-300 align-middle text-right">បង់រំលស់ដើម</th>
                  <th className="px-3 py-3 border-r border-slate-300 align-middle text-right text-[#084f40] bg-[#f3faf6]">ការប្រាក់បានបង់</th>
                  <th className="px-3 py-3 border-r border-slate-300 align-middle text-right">កម្ចីថ្មី</th>
                  <th className="px-3 py-3 border-r border-slate-300 align-middle text-right">កម្ចីនៅសល់សរុប</th>
                </tr>
              </thead>
              <tbody>
                {loanData.map((row, idx) => (
                  <tr key={`${row.id}-${idx}`} className="border-b border-slate-300 hover:bg-slate-50 transition-colors h-11">
                    <td className="px-3 py-2 border-r border-slate-300 text-center text-slate-500 font-medium">{typeof row.id === 'string' ? row.id.split(' ').pop() : row.id}</td>
                    <td className="px-3 py-2 border-r border-slate-300 font-bold text-slate-800">{row.name}</td>
                    <td className="px-3 py-2 border-r border-slate-300 text-center text-slate-500">{row.gender}</td>
                    <td className="px-1 py-1 border-r border-slate-300 text-right">
                      {isFirstMonth ? (
                        <input value={showVal(row.loanValue)} onChange={(e) => editLoanRaw(idx, 'loanValue', e.target.value)} onBlur={saveLoansMonth}
                          className="w-24 text-right bg-transparent px-2 py-1 rounded border border-dashed border-slate-300 focus:border-[#0a6652] focus:bg-[#f3faf6] outline-none font-medium" />
                      ) : (
                        <span className="block px-2 py-1 text-right font-medium text-slate-600" title="អូតូពីកម្ចីនៅសល់ខែមុន">{row.loanValue}</span>
                      )}
                    </td>
                    <td className="px-1 py-1 border-r border-slate-300 text-center">
                      <div className="flex items-center justify-center gap-0.5">
                        <input value={row.rate ?? '1.50'} placeholder="1.50" onChange={(e) => editLoanRaw(idx, 'rate', e.target.value)} onBlur={saveLoansMonth}
                          className="w-14 text-right bg-transparent px-1 py-1 rounded border border-dashed border-slate-300 focus:border-[#0a6652] focus:bg-[#f3faf6] outline-none font-medium" />
                        <span className="text-slate-400 text-xs">%</span>
                      </div>
                    </td>
                    <td className="px-3 py-2 border-r border-slate-300 text-right font-medium text-indigo-600">
                      {row.interest !== '-' ? <span className="text-slate-400 mr-1">$</span> : null}
                      {row.interest}
                    </td>
                    <td className="px-1 py-1 border-r border-slate-300 text-right">
                      <input value={showVal(row.repayment)} onChange={(e) => editLoanRaw(idx, 'repayment', e.target.value)} onBlur={saveLoansMonth}
                        className="w-20 text-right bg-transparent px-2 py-1 rounded border border-dashed border-slate-300 focus:border-amber-600 focus:bg-amber-50 outline-none font-medium text-amber-700" />
                    </td>
                    <td className="px-1 py-1 border-r border-slate-300 text-right bg-[#f3faf6]">
                      <input value={showVal(row.interestPaid)} onChange={(e) => editLoanRaw(idx, 'interestPaid', e.target.value)} onBlur={saveLoansMonth}
                        className="w-20 text-right bg-transparent px-2 py-1 rounded border border-dashed border-slate-300 focus:border-[#0a6652] focus:bg-white outline-none font-bold text-[#0a6652]" />
                    </td>
                    <td className="px-1 py-1 border-r border-slate-300 text-right">
                      <input value={showVal(row.newLoan)} onChange={(e) => editLoanRaw(idx, 'newLoan', e.target.value)} onBlur={saveLoansMonth}
                        className="w-20 text-right bg-transparent px-2 py-1 rounded border border-dashed border-slate-300 focus:border-emerald-600 focus:bg-emerald-50 outline-none font-medium text-emerald-700" />
                    </td>
                    <td className="px-3 py-2 border-r border-slate-300 text-right font-medium bg-slate-50">
                      {row.remaining !== '-' ? <span className="text-slate-400 mr-1">$</span> : null}
                      {row.remaining}
                    </td>
                  </tr>
                ))}
                <tr className="bg-slate-50 text-slate-800 font-bold border-t-2 border-slate-800 h-12">
                  <td colSpan={3} className="px-3 py-2 border-r border-slate-300 text-center">សរុប</td>
                  <td className="px-3 py-2 border-r border-slate-300 text-right">{ln2(loanSum(loanData, 'loanValue'))}</td>
                  <td className="px-3 py-2 border-r border-slate-300 text-center text-slate-400">—</td>
                  <td className="px-3 py-2 border-r border-slate-300 text-right text-indigo-700">{ln2(loanSum(loanData, 'interest'))}</td>
                  <td className="px-3 py-2 border-r border-slate-300 text-right text-amber-700">{ln2(loanSum(loanData, 'repayment'))}</td>
                  <td className="px-3 py-2 border-r border-slate-300 text-right text-[#0a6652] bg-[#fafdfa]">{ln2(loanSum(loanData, 'interestPaid'))}</td>
                  <td className="px-3 py-2 border-r border-slate-300 text-right text-emerald-700">{ln2(loanSum(loanData, 'newLoan'))}</td>
                  <td className="px-3 py-2 border-r border-slate-300 text-right bg-slate-100">{ln2(loanSum(loanData, 'remaining'))}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'deposit_members' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col p-1 px-4 md:px-6 md:p-6 mb-6">
          {isFirstMonth && (
            <div className="flex justify-end mb-3">
              <button onClick={() => setShowLoanImport(true)} className="flex items-center gap-1.5 bg-[#0a6652] text-white px-4 py-2 rounded-full text-xs font-bold hover:bg-[#084f40] transition-colors cursor-pointer">
                <Upload size={14} strokeWidth={2.5} /> បិទភ្ជាប់ (Paste)
              </button>
            </div>
          )}
          <div className="frz2 overflow-x-auto border border-slate-300 rounded-xl">
            <table className="w-full text-left border-collapse text-sm min-w-[1200px]">
              <thead className="bg-[#eef8f2] text-[#0a6652] border-b-[3px] border-[#0a6652] text-center font-bold">
                <tr>
                  <th className="px-3 py-3 border-r border-slate-300 align-middle">លេខ ID</th>
                  <th className="px-3 py-3 border-r border-slate-300 align-middle min-w-[140px]">ឈ្មោះ</th>
                  <th className="px-3 py-3 border-r border-slate-300 align-middle">ភេទ</th>
                  <th className="px-3 py-3 border-r border-slate-300 align-middle text-right">កម្ចីដើមគ្រា</th>
                  <th className="px-3 py-3 border-r border-slate-300 align-middle text-center">អត្រាការប្រាក់</th>
                  <th className="px-3 py-3 border-r border-slate-300 align-middle text-right">ការប្រាក់ត្រូវបង់</th>
                  <th className="px-3 py-3 border-r border-slate-300 align-middle text-right">បង់រំលស់ដើម</th>
                  <th className="px-3 py-3 border-r border-slate-300 align-middle text-right text-[#084f40] bg-[#f3faf6]">ការប្រាក់បានបង់</th>
                  <th className="px-3 py-3 border-r border-slate-300 align-middle text-right">កម្ចីថ្មី</th>
                  <th className="px-3 py-3 border-r border-slate-300 align-middle text-right">កម្ចីនៅសល់សរុប</th>
                </tr>
              </thead>
              <tbody>
                {depositLoanData.map((row, idx) => (
                  <tr key={`${row.id}-${idx}`} className="border-b border-slate-300 hover:bg-slate-50 transition-colors h-11">
                    <td className="px-3 py-2 border-r border-slate-300 text-center text-slate-500 font-medium">{typeof row.id === 'string' ? row.id.split(' ').pop() : row.id}</td>
                    <td className="px-3 py-2 border-r border-slate-300 font-bold text-slate-800">{row.name}</td>
                    <td className="px-3 py-2 border-r border-slate-300 text-center text-slate-500">{row.gender}</td>
                    <td className="px-1 py-1 border-r border-slate-300 text-right">
                      {isFirstMonth ? (
                        <input value={showVal(row.loanValue)} onChange={(e) => editDepositLoanRaw(idx, 'loanValue', e.target.value)} onBlur={saveDepositLoanMonth}
                          className="w-24 text-right bg-transparent px-2 py-1 rounded border border-dashed border-slate-300 focus:border-[#0a6652] focus:bg-[#f3faf6] outline-none font-medium" />
                      ) : (
                        <span className="block px-2 py-1 text-right font-medium text-slate-600" title="អូតូពីកម្ចីនៅសល់ខែមុន">{row.loanValue}</span>
                      )}
                    </td>
                    <td className="px-1 py-1 border-r border-slate-300 text-center">
                      <div className="flex items-center justify-center gap-0.5">
                        <input value={row.rate ?? '1.50'} placeholder="1.50" onChange={(e) => editDepositLoanRaw(idx, 'rate', e.target.value)} onBlur={saveDepositLoanMonth}
                          className="w-14 text-right bg-transparent px-1 py-1 rounded border border-dashed border-slate-300 focus:border-[#0a6652] focus:bg-[#f3faf6] outline-none font-medium" />
                        <span className="text-slate-400 text-xs">%</span>
                      </div>
                    </td>
                    <td className="px-3 py-2 border-r border-slate-300 text-right font-medium text-indigo-600">
                      {row.interest !== '-' ? <span className="text-slate-400 mr-1">$</span> : null}
                      {row.interest}
                    </td>
                    <td className="px-1 py-1 border-r border-slate-300 text-right">
                      <input value={showVal(row.repayment)} onChange={(e) => editDepositLoanRaw(idx, 'repayment', e.target.value)} onBlur={saveDepositLoanMonth}
                        className="w-20 text-right bg-transparent px-2 py-1 rounded border border-dashed border-slate-300 focus:border-amber-600 focus:bg-amber-50 outline-none font-medium text-amber-700" />
                    </td>
                    <td className="px-1 py-1 border-r border-slate-300 text-right bg-[#f3faf6]">
                      <input value={showVal(row.interestPaid)} onChange={(e) => editDepositLoanRaw(idx, 'interestPaid', e.target.value)} onBlur={saveDepositLoanMonth}
                        className="w-20 text-right bg-transparent px-2 py-1 rounded border border-dashed border-slate-300 focus:border-[#0a6652] focus:bg-white outline-none font-bold text-[#0a6652]" />
                    </td>
                    <td className="px-1 py-1 border-r border-slate-300 text-right">
                      <input value={showVal(row.newLoan)} onChange={(e) => editDepositLoanRaw(idx, 'newLoan', e.target.value)} onBlur={saveDepositLoanMonth}
                        className="w-20 text-right bg-transparent px-2 py-1 rounded border border-dashed border-slate-300 focus:border-emerald-600 focus:bg-emerald-50 outline-none font-medium text-emerald-700" />
                    </td>
                    <td className="px-3 py-2 border-r border-slate-300 text-right font-medium bg-slate-50">
                      {row.remaining !== '-' ? <span className="text-slate-400 mr-1">$</span> : null}
                      {row.remaining}
                    </td>
                  </tr>
                ))}
                <tr className="bg-slate-50 text-slate-800 font-bold border-t-2 border-slate-800 h-12">
                  <td colSpan={3} className="px-3 py-2 border-r border-slate-300 text-center">សរុប</td>
                  <td className="px-3 py-2 border-r border-slate-300 text-right">{ln2(loanSum(depositLoanData, 'loanValue'))}</td>
                  <td className="px-3 py-2 border-r border-slate-300 text-center text-slate-400">—</td>
                  <td className="px-3 py-2 border-r border-slate-300 text-right text-indigo-700">{ln2(loanSum(depositLoanData, 'interest'))}</td>
                  <td className="px-3 py-2 border-r border-slate-300 text-right text-amber-700">{ln2(loanSum(depositLoanData, 'repayment'))}</td>
                  <td className="px-3 py-2 border-r border-slate-300 text-right text-[#0a6652] bg-[#fafdfa]">{ln2(loanSum(depositLoanData, 'interestPaid'))}</td>
                  <td className="px-3 py-2 border-r border-slate-300 text-right text-emerald-700">{ln2(loanSum(depositLoanData, 'newLoan'))}</td>
                  <td className="px-3 py-2 border-r border-slate-300 text-right bg-slate-100">{ln2(loanSum(depositLoanData, 'remaining'))}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'group' && renderExtTable('received')}

      {activeTab === 'external_provided' && renderExtTable('provided')}

      <div className="flex justify-end gap-3 mt-4">
        <button
          onClick={handleDeleteAllLoans}
          className="bg-red-50 hover:bg-red-100 text-red-600 font-bold text-xs px-6 py-2.5 rounded-xl transition-all shadow-sm flex items-center gap-2 cursor-pointer active:scale-95"
        >
          <Trash2 size={16} />
          <span>លុបទាំងអស់</span>
        </button>
        <button
          onClick={handleSaveAllLoans}
          className="bg-[#0a6652] hover:bg-[#085343] text-white font-extrabold text-xs px-6 py-2.5 rounded-xl transition-all shadow-sm flex items-center gap-2 cursor-pointer active:scale-95"
        >
          <Save size={16} />
          <span>រក្សាទុក</span>
        </button>
      </div>
    </PageView>
  );
}

function Expenses({ embedded = false, month }: { embedded?: boolean; month?: string } = {}) {
  const [selectedMonth, setSelectedMonth] = useState(month || 'មេសា 2026');
  const months = ['មករា 2026', 'កុម្ភៈ 2026', 'មីនា 2026', 'មេសា 2026', 'ឧសភា 2026', 'មិថុនា 2026', 'កក្កដា 2026', 'សីហា 2026', 'កញ្ញា 2026', 'តុលា 2026', 'វិច្ឆិកា 2026', 'ធ្នូ 2026'];

  // ---- Per-month expenses (each month keeps its own list) ----
  // Default new-expense date = the 15th of the month being viewed.
  const dateForMonth = (month: string) => `2026-${String(Math.max(0, months.indexOf(month)) + 1).padStart(2, '0')}-15`;
  const loadByMonth = (): Record<string, any[]> => getStoredData('sof_expenses_by_month', EXPENSE_BY_MONTH);
  const saveMonth = (rows: any[]) => {
    const byMonth = loadByMonth();
    byMonth[selectedMonth] = rows;
    setStoredData('sof_expenses_by_month', byMonth);
  };

  const [expenses, setExpenses] = useState<any[]>(() => loadByMonth()['មេសា 2026'] || []);

  const [isAdding, setIsAdding] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('ទាំងអស់');

  // New expense form inputs
  const [formDate, setFormDate] = useState(dateForMonth('មេសា 2026'));
  const [formSupplier, setFormSupplier] = useState('SOF');
  const [formDesc, setFormDesc] = useState('');
  const [formCategory, setFormCategory] = useState('ចំណាយប្រតិបត្តិការ');
  const [formQty, setFormQty] = useState(1);
  const [formPrice, setFormPrice] = useState(0);
  const [successMsg, setSuccessMsg] = useState('');

  // One-time import of the per-month expense workbook (replaces any earlier data).
  useEffect(() => {
    if (!getStoredData('sof_expenses_import_v1', false)) {
      setStoredData('sof_expenses_by_month', EXPENSE_BY_MONTH);
      setStoredData('sof_expenses_import_v1', true);
      setExpenses(EXPENSE_BY_MONTH[selectedMonth] || []);
    }
  }, []);

  // When embedded, follow the parent report's month (the top selector controls this panel).
  useEffect(() => { if (embedded && month) setSelectedMonth(month); }, [embedded, month]);

  // Load the selected month's expenses (and sync the form date) when the month changes.
  useEffect(() => {
    setExpenses(loadByMonth()[selectedMonth] || []);
    setFormDate(dateForMonth(selectedMonth));
  }, [selectedMonth]);

  const handleAddExpense = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formDesc.trim()) {
      alert("សូមបញ្ចូល មុខចំណាយ (Expense item)!");
      return;
    }

    const newExpense = {
      id: String(Date.now()),
      date: formDate,
      supplier: formSupplier || '-',
      description: formDesc,
      category: formCategory,
      qty: Number(formQty) || 1,
      price: Number(formPrice) || 0,
      total: (Number(formQty) || 1) * (Number(formPrice) || 0)
    };

    const updated = [...expenses, newExpense];
    setExpenses(updated);
    saveMonth(updated);

    // Reset Form
    setFormDesc('');
    setFormQty(1);
    setFormPrice(0);
    setIsAdding(false);
    triggerSuccess("បានរក្សាទុកការចំណាយថ្មីដោយជោគជ័យ!");
  };

  const triggerSuccess = (msg: string) => {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(''), 4000);
  };

  const handleDelete = (id: string) => {
    const updated = expenses.filter(exp => exp.id !== id);
    setExpenses(updated);
    saveMonth(updated);
    triggerSuccess("បានលុបទិន្នន័យការចំណាយរួចរាល់!");
  };

  // Reset clears only the month currently being viewed.
  const handleResetDefaults = () => {
    setExpenses([]);
    saveMonth([]);
    triggerSuccess(`បានសម្អាតការចំណាយខែ ${selectedMonth} រួចរាល់!`);
  };

  // Filter logic
  const filteredExpenses = expenses.filter(exp => {
    const matchesSearch = 
      exp.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
      exp.supplier.toLowerCase().includes(searchTerm.toLowerCase()) ||
      exp.category.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesCategory = selectedCategory === 'ទាំងអស់' || exp.category === selectedCategory;

    return matchesSearch && matchesCategory;
  });

  const totalAmount = filteredExpenses.reduce((sum, exp) => sum + (Number(exp.total) || 0), 0);
  // Count of expense records across every month (for the "all transactions" card).
  const allMonthsCount = Object.values(loadByMonth()).reduce((s: number, rows: any) => s + (rows?.length || 0), 0);

  return (
    <PageView
      hideUpload={true}
      hideDownload={true}
      hideAdd={true}
      hideBack={embedded}
      title={
        <div className="flex flex-col md:flex-row md:items-center gap-3">
          <span>បញ្ជីការចំណាយ (Expenses) - </span>
          {embedded ? (
            <span className="text-lg md:text-xl font-bold text-[#0a6652]">{selectedMonth}</span>
          ) : (
            <select
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="text-lg md:text-xl font-bold bg-[#eef8f2] border border-green-200 text-[#0a6652] px-3 py-1 rounded-lg outline-none cursor-pointer shadow-sm w-fit"
            >
              {months.map(m => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          )}
        </div>
      }
    >
      {/* Notifications */}
      {successMsg && (
        <div className="mb-6 p-4 bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm font-bold rounded-2xl flex items-center justify-between shadow-sm">
          <span>✅ {successMsg}</span>
          <button onClick={() => setSuccessMsg('')} className="text-emerald-500 hover:text-emerald-700">
            <X size={16} />
          </button>
        </div>
      )}

      {/* Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-8">
        <div className="bg-[#eef8f2] p-5 rounded-3xl border border-green-200/60 shadow-sm">
          <div className="text-xs font-black text-slate-500 uppercase tracking-wide mb-1">ការចំណាយសរុប (Total filtered)</div>
          <div className="text-3xl font-black text-[#0a6652]">${totalAmount.toFixed(2)}</div>
          <div className="text-[10px] text-slate-400 font-bold mt-1">ស្មើនឹង {filteredExpenses.length} ប្រតិបត្តិការ</div>
        </div>
        <div className="bg-blue-50/60 p-5 rounded-3xl border border-blue-100 shadow-sm">
          <div className="text-xs font-black text-slate-500 uppercase tracking-wide mb-1">ប្រភេទប្រតិបត្តិការ</div>
          <div className="text-3xl font-black text-blue-700">
            {new Set(filteredExpenses.map(e => e.category)).size}
          </div>
          <div className="text-[10px] text-slate-400 font-bold mt-1">ប្រភេទចំណាយប្លែកៗគ្នា</div>
        </div>
        <div className="bg-amber-50/60 p-5 rounded-3xl border border-amber-100 shadow-sm flex flex-col justify-between">
          <div className="text-xs font-black text-slate-500 uppercase tracking-wide mb-1">ប្រតិបត្តិការសរុបទាំងអស់</div>
          <div className="text-3xl font-black text-amber-700">{allMonthsCount}</div>
          <div className="text-[10px] text-slate-400 font-bold mt-1">កត់ត្រាក្នុងប្រព័ន្ធ</div>
        </div>
      </div>

      {/* Filter and Add Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div className="flex flex-wrap items-center flex-1 max-w-2xl gap-3">
          {/* Search */}
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input 
              type="text" 
              placeholder="ស្វែងរកតាម មុខចំណាយ ឬអ្នកផ្គត់ផ្គង់..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-slate-50 hover:bg-slate-100/50 focus:bg-white text-xs font-medium text-slate-800 placeholder-slate-400 rounded-xl border border-slate-200 outline-none transition-colors"
            />
          </div>
          {/* Category Dropdown */}
          <select 
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="px-4 py-2 bg-slate-50 hover:bg-slate-100 text-xs font-bold text-slate-700 rounded-xl border border-slate-200 outline-none cursor-pointer transition-colors"
          >
            <option value="ទាំងអស់">ប្រភេទចំណាយ៖ ទាំងអស់</option>
            <option value="ចំណាយប្រតិបត្តិការ">ចំណាយប្រតិបត្តិការ</option>
            <option value="ទុនសង្គម">ទុនសង្គម</option>
            <option value="ទុនបម្រុង">ទុនបម្រុង</option>
            <option value="ចំណាយផ្សេងៗ">ចំណាយផ្សេងៗ</option>
          </select>
        </div>

        <div className="flex gap-2">
          <button 
            onClick={() => setIsAdding(!isAdding)}
            className="flex items-center gap-2 bg-[#0a6652] hover:bg-[#084f40] text-white font-bold text-xs py-2 px-4 rounded-xl shadow-md cursor-pointer transition-colors"
          >
            <Plus size={16} />
            <span>{isAdding ? "បិទហ្វម" : "បន្ថែមការចំណាយថ្មី"}</span>
          </button>
          
          <button 
            onClick={handleResetDefaults}
            className="px-3 py-2 bg-rose-50 hover:bg-rose-100 text-rose-600 font-bold text-xs rounded-xl border border-rose-100 cursor-pointer transition-colors"
            title="កំណត់ទិន្នន័យដើមវិញ"
          >
            បិទឡើងវិញ (Reset)
          </button>
        </div>
      </div>

      {/* Add Form collapsible block */}
      {isAdding && (
        <form onSubmit={handleAddExpense} className="mb-8 p-6 bg-slate-50 border border-slate-200 rounded-3xl">
          <h3 className="text-sm font-black text-slate-700 mb-4 flex items-center gap-2">
            <span className="w-2.5 h-2.5 bg-[#0a6652] rounded-full"></span>
            បញ្ចូលទិន្នន័យការចំណាយថ្មី
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-[11px] font-black text-slate-500 uppercase tracking-widest mb-1.5">ថ្ងៃទីខែឆ្នាំ</label>
              <input 
                type="date" 
                value={formDate} 
                onChange={(e) => setFormDate(e.target.value)}
                className="w-full text-xs bg-white border border-slate-200 px-3.5 py-2.5 rounded-xl outline-none font-medium text-slate-800"
                required
              />
            </div>
            <div>
              <label className="block text-[11px] font-black text-slate-500 uppercase tracking-widest mb-1.5">អ្នកផ្គត់ផ្គង់ / ស្ថាប័ន</label>
              <input 
                type="text" 
                value={formSupplier} 
                onChange={(e) => setFormSupplier(e.target.value)}
                className="w-full text-xs bg-white border border-slate-200 px-3.5 py-2.5 rounded-xl outline-none font-medium text-slate-800 placeholder-slate-300"
                placeholder="ឧ. SOF, ហាងលក់សម្ភារៈ..."
              />
            </div>
            <div>
              <label className="block text-[11px] font-black text-slate-500 uppercase tracking-widest mb-1.5">ប្រភេទការចំណាយ</label>
              <select 
                value={formCategory} 
                onChange={(e) => setFormCategory(e.target.value)}
                className="w-full text-xs bg-white border border-slate-200 px-3.5 py-2.5 rounded-xl outline-none font-bold text-slate-800 cursor-pointer"
              >
                <option value="ចំណាយប្រតិបត្តិការ">ចំណាយប្រតិបត្តិការ</option>
                <option value="ទុនសង្គម">ទុនសង្គម</option>
                <option value="ទុនបម្រុង">ទុនបម្រុង</option>
                <option value="ចំណាយផ្សេងៗ">ចំណាយផ្សេងៗ</option>
              </select>
            </div>
            <div className="md:col-span-3">
              <label className="block text-[11px] font-black text-slate-500 uppercase tracking-widest mb-1.5">មុខចំណាយ / បរិយាយការចំណាយ</label>
              <input 
                type="text" 
                value={formDesc} 
                onChange={(e) => setFormDesc(e.target.value)}
                className="w-full text-xs bg-white border border-slate-200 px-3.5 py-2.5 rounded-xl outline-none font-medium text-slate-800 placeholder-slate-300"
                placeholder="ឧ. ប្រាក់ឧបត្ថម្ភប្រចាំខែសម្រាប់បុគ្គលិក, កាតទូរស័ព្ទ..."
                required
              />
            </div>
            <div>
              <label className="block text-[11px] font-black text-slate-500 uppercase tracking-widest mb-1.5">ឯកតា (ចំនួន)</label>
              <input 
                type="number" 
                min="1"
                value={formQty} 
                onChange={(e) => setFormQty(Number(e.target.value) || 1)}
                className="w-full text-xs bg-white border border-slate-200 px-3.5 py-2.5 rounded-xl outline-none font-medium text-slate-800"
                required
              />
            </div>
            <div>
              <label className="block text-[11px] font-black text-slate-500 uppercase tracking-widest mb-1.5">តម្លៃឯកតា ($)</label>
              <input 
                type="number" 
                step="0.01" 
                min="0"
                value={formPrice} 
                onChange={(e) => setFormPrice(Number(e.target.value) || 0)}
                className="w-full text-xs bg-white border border-slate-200 px-3.5 py-2.5 rounded-xl outline-none font-medium text-slate-800"
                required
              />
            </div>
            <div className="flex items-end">
              <button 
                type="submit" 
                className="w-full flex items-center justify-center gap-2 bg-[#0a6652] hover:bg-[#084f40] text-white font-bold text-xs py-2.5 px-4 rounded-xl shadow-md cursor-pointer transition-colors"
              >
                <Save size={16} />
                <span>រក្សាទុក (Save Expense)</span>
              </button>
            </div>
          </div>
        </form>
      )}

      {/* Main Table area */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden mb-6 animate-fade-in animate-duration-300">
        <div className="overflow-x-auto">
          <table className="w-full text-left min-w-[800px] border-collapse">
            <thead>
              <tr className="bg-[#eef8f2] border-b-[3px] border-[#0a6652] text-xs h-12 text-[#0a6652] font-black">
                <th className="px-4 py-2 text-center border-r border-green-100 w-12">ល.រ</th>
                <th className="px-4 py-2 border-r border-green-100">ថ្ងៃខែឆ្នាំ</th>
                <th className="px-4 py-2 border-r border-green-100">អ្នកផ្គត់ផ្គង់</th>
                <th className="px-4 py-2 border-r border-green-100 font-bold min-w-[200px]">មុខចំណាយ / ពិពណ៌នា</th>
                <th className="px-4 py-2 border-r border-green-100 whitespace-nowrap">ប្រភេទចំណាយ</th>
                <th className="px-4 py-2 border-r border-green-100 text-center w-16">ចំនួន</th>
                <th className="px-4 py-2 border-r border-green-100 text-right">តម្លៃឯកតា</th>
                <th className="px-4 py-2 border-r border-green-100 text-right">សរុបចំណាយ</th>
                <th className="px-4 py-2 text-center w-20">ជម្រើស</th>
              </tr>
            </thead>
            <tbody className="text-xs text-slate-700">
              {filteredExpenses.length > 0 ? (
                filteredExpenses.map((exp, index) => (
                  <tr key={exp.id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors h-11">
                    <td className="px-4 py-2.5 border-r border-slate-100 text-center font-bold text-slate-500">
                      {index + 1}
                    </td>
                    <td className="px-4 py-2.5 border-r border-slate-100 font-medium whitespace-nowrap">
                      {exp.date}
                    </td>
                    <td className="px-4 py-2.5 border-r border-slate-100 font-bold text-slate-800">
                      {exp.supplier}
                    </td>
                    <td className="px-4 py-2.5 border-r border-slate-100 font-medium max-w-[280px] truncate" title={exp.description}>
                      {exp.description}
                    </td>
                    <td className="px-4 py-2.5 border-r border-slate-100">
                      <span className={`px-2 py-1 rounded-md text-[10px] font-black ${
                        exp.category === 'ចំណាយប្រតិបត្តិការ' ? 'bg-orange-50 text-orange-700 border border-orange-100' :
                        exp.category === 'ទុនសង្គម' ? 'bg-purple-50 text-purple-700 border border-purple-100' :
                        exp.category === 'ទុនបម្រុង' ? 'bg-teal-50 text-teal-700 border border-teal-100' :
                        'bg-slate-100 text-slate-700 border border-slate-200'
                      }`}>
                        {exp.category}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 border-r border-slate-100 text-center font-semibold text-slate-600">
                      {exp.qty}
                    </td>
                    <td className="px-4 py-2.5 border-r border-slate-100 text-right font-medium text-slate-600">
                      ${Number(exp.price).toFixed(2)}
                    </td>
                    <td className="px-4 py-2.5 border-r border-slate-100 text-right font-black text-[#0a6652]">
                      ${Number(exp.total).toFixed(2)}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <button 
                        onClick={() => handleDelete(exp.id)}
                        className="p-1 px-2.5 bg-rose-50 hover:bg-rose-100 text-rose-600 rounded-lg border border-rose-100 cursor-pointer transition-colors inline-flex items-center gap-1.5 font-bold"
                        title="លុបប្រតិបត្តិការ"
                      >
                        <Trash2 size={12} />
                        <span>លុប</span>
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={9} className="text-center py-12 text-slate-400 font-medium text-xs">
                    មិនមានទិន្នន័យចំណាយត្រូវគ្នានឹងការស្វែងរកឡើយ!
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </PageView>
  );
}

function Reports() {
  const [activeTab, setActiveTab] = useState('balance');
  const [selectedMonth, setSelectedMonth] = useState('មេសា 2026');
  const months = ['មករា 2026', 'កុម្ភៈ 2026', 'មីនា 2026', 'មេសា 2026', 'ឧសភា 2026', 'មិថុនា 2026', 'កក្កដា 2026', 'សីហា 2026', 'កញ្ញា 2026', 'តុលា 2026', 'វិច្ឆិកា 2026', 'ធ្នូ 2026'];

  // Manually-entered "ផ្សេងៗ" cash-flow amounts (per month).
  const [cfOtherIncome, setCfOtherIncome] = useState('');
  const [cfOtherOutflow, setCfOtherOutflow] = useState('');
  useEffect(() => {
    const m = (getStoredData('sof_cashflow_manual_by_month', {}) || {})[selectedMonth] || {};
    setCfOtherIncome(m.otherIncome != null ? String(m.otherIncome) : '');
    setCfOtherOutflow(m.otherOutflow != null ? String(m.otherOutflow) : '');
  }, [selectedMonth]);
  const saveCfManual = (income: string, outflow: string) => {
    const all = getStoredData('sof_cashflow_manual_by_month', {}) || {};
    all[selectedMonth] = { otherIncome: income, otherOutflow: outflow };
    setStoredData('sof_cashflow_manual_by_month', all);
  };

  // ---- Live data only ----
  // Every figure is summed from the per-month stores you enter on each page. There is NO
  // imported-snapshot fallback: a month with no entries shows 0 until it is filled in.
  // (The only exception is the very first month's opening cash, seeded from the starting
  // balance below, since there is nowhere else to record the group's initial cash.)
  const monthlyReports = getStoredData('sof_monthly_reports', {});


  // Live per-month figures: sum the selected month's rows from each page's by-month
  // store. Returns null when that month has no live data, so we can fall back to the
  // imported snapshot (then to the flat roster).
  const sumMonth = (key: string, field: string, def: any = {}) => {
    const by = getStoredData(key, def) || {};
    const rows = by[selectedMonth];
    return Array.isArray(rows) ? rows.reduce((s: number, r: any) => s + num(r[field]), 0) : null;
  };
  // Month-parameterized live sums (null when that month has no rows).
  const sumOf = (key: string, field: string, month: string, def: any = {}) => {
    const rows = (getStoredData(key, def) || {})[month];
    return Array.isArray(rows) ? rows.reduce((s: number, r: any) => s + num(r[field]), 0) : null;
  };
  // ---- Balance carry-forward -------------------------------------------------
  // Every balance-sheet line is a RUNNING BALANCE: it persists until an entry changes it.
  // So for a month with no new data, carry the most recent known figure forward instead of
  // dropping to 0. carryRows walks back from the selected month to the last month that has
  // rows in a store; the helpers below aggregate those rows. This makes the whole balance
  // sheet (liabilities + equity) auto-fill every month with no manual re-entry.
  const carryRows = (key: string, def: any = {}): any[] => {
    const by = getStoredData(key, def) || {};
    const idx = months.indexOf(selectedMonth);
    for (let i = (idx < 0 ? months.length - 1 : idx); i >= 0; i--) {
      const rows = by[months[i]];
      if (Array.isArray(rows) && rows.length) return rows;
    }
    return [];
  };
  const carrySum = (key: string, field: string, def: any = {}) =>
    carryRows(key, def).reduce((s: number, r: any) => s + num(r[field]), 0);
  // Outstanding loan balance = the first funded month's `remaining` + Σ(newLoan − repayment)
  // for every later month, up to the selected one. This DERIVES the balance from the same
  // flows the cash-flow statement uses, so the two always tie — even when a stored
  // `remaining` cell went stale (e.g. a later month not recomputed after an earlier edit).
  const carryChain = (key: string) => {
    const by = getStoredData(key, {}) || {};
    const idx = months.indexOf(selectedMonth);
    let bal = 0; let started = false;
    for (let i = 0; i <= idx; i++) {
      const rows = by[months[i]];
      if (!Array.isArray(rows) || !rows.length) continue;
      if (!started) { bal = rows.reduce((s: number, r: any) => s + num(r.remaining), 0); started = true; }
      else { bal += rows.reduce((s: number, r: any) => s + num(r.newLoan) - num(r.repayment), 0); }
    }
    return bal;
  };
  const carryGroup = (needle: string) => {
    const g = carryRows('sof_group_by_month').find((r: any) => (r.name || '').includes(needle));
    return g ? num(g.total) : 0;
  };
  const carryFixedTerm = () => carryRows('sof_fixedterm_by_month', FIXEDTERM_BY_MONTH).reduce((s: number, r: any) => {
    const t = num(r.total);
    return s + (t || (num(r.startCapital) + num(r.addSaving) - num(r.withdraw)));
  }, 0);

  // Fixed-term accounts: use the stored month if present, else the code seed for that
  // month (the seed carries Jan–May, but the stored key may hold only the months that
  // were opened on the Savings tab — so from March it would otherwise read empty).
  const ftRowsFor = (month: string): any[] => {
    const rows = (getStoredData('sof_fixedterm_by_month', {}) || {})[month];
    return (Array.isArray(rows) && rows.length) ? rows : (FIXEDTERM_BY_MONTH[month] || []);
  };
  const ftSum = (month: string, field: string) => ftRowsFor(month).reduce((s: number, r: any) => s + num(r[field]), 0);

  // Balance-sheet lines. Savings & group funds are computed LIVE (same engine as the
  // Savings page) so they always tie to the income statement — no stale-data gap that
  // would pile into retained earnings. Loans/fixed-term carry their last known balance.
  const liveSav = savingsLiveTotals(selectedMonth);
  const sumTotal = (rows: any[]) => (rows || []).reduce((s: number, r: any) => s + num(r.total), 0);
  const liveGroupTotal = (needle: string) => {
    const g = (liveSav?.group || []).find((r: any) => (r.name || '').includes(needle));
    return g ? num(g.total) : 0;
  };
  const bsMemberSavings = liveSav ? sumTotal(liveSav.active) : carrySum('sof_savings_by_month', 'total');
  const bsDepositSavings = liveSav ? sumTotal(liveSav.deposit) : carrySum('sof_deposit_by_month', 'total');
  const bsFixedTerm = carryFixedTerm();
  const bsLoansMembers = carryChain('sof_loans_by_month');
  const bsLoansExternal = carryChain('sof_external_provided_by_month');
  const bsExternalBorrow = carryChain('sof_external_received_by_month');
  const bsReserve = liveSav ? liveGroupTotal('បម្រុង') : carryGroup('បម្រុង');
  const bsSocial = liveSav ? liveGroupTotal('សង្គម') : carryGroup('សង្គម');
  const bsYes = liveSav ? liveGroupTotal('យេស') : carryGroup('យេស');
  const bsBankBalance = 0;
  const bsTotalLiabilities = bsMemberSavings + bsDepositSavings + bsExternalBorrow + bsFixedTerm;
  // Cash on hand = cash-flow net; equity (incl. retained) + assets computed after the cash-flow block.

  // ---- Income statement, computed live per month ----
  // Income = interest the members actually PAID (ការប្រាក់បានបង់) + interest from loans
  // lent to outsiders (កម្ចីផ្តល់ទៅខាងក្រៅ). NOT interest merely due.
  const sumInterestPaid = (key: string) => {
    const rows = (getStoredData(key, {}) || {})[selectedMonth];
    return Array.isArray(rows) ? rows.reduce((s: number, r: any) => s + num(r.interestPaid), 0) : null;
  };
  const loanInterestLive = () => {
    const a = sumInterestPaid('sof_loans_by_month');
    const d = sumInterestPaid('sof_loans_deposit_by_month');
    const e = sumMonth('sof_external_provided_by_month', 'interest');
    return (a == null && d == null && e == null) ? null : (a || 0) + (d || 0) + (e || 0);
  };
  const depBeginSum = sumMonth('sof_deposit_by_month', 'startCapital');

  // Interest income = interest members actually paid + interest on loans lent out (live).
  const incInterestIncome = loanInterestLive() ?? 0;
  const incOtherIncome = 0;
  const incTotalIncome = incInterestIncome + incOtherIncome;
  // Cost lines are computed LIVE per month from this month's own data (no imported fallback):
  //   deposit interest = 0.5% × deposit beginning; fixed-term = 1% × fixed-term balance;
  //   external-loan interest = sum of that month's external-borrowing interest;
  //   operating expense = sum of ALL expense items entered for the month.
  const incDepositInterest = DEFAULT_RATES.deposit * (depBeginSum ?? 0);
  const incExternalInterest = sumMonth('sof_external_received_by_month', 'interest') ?? 0;
  const incFixedTermInterest = fixedTermInterestOf(selectedMonth);
  const incGrossProfit = incTotalIncome - incDepositInterest - incExternalInterest - incFixedTermInterest;
  const incOperatingExpense = sumMonth('sof_expenses_by_month', 'total', EXPENSE_BY_MONTH) ?? 0;
  const incReserveAlloc = DEFAULT_RATES.reserve * incTotalIncome;   // 10% of total income
  const incSocialAlloc = DEFAULT_RATES.social * incTotalIncome;     // 0.5% of total income
  const incNetProfit = incGrossProfit - incOperatingExpense - incReserveAlloc - incSocialAlloc;
  const inc: any = {
    interestIncome: incInterestIncome, otherIncome: incOtherIncome, totalIncome: incTotalIncome,
    depositInterestCost: incDepositInterest, externalLoanInterest: incExternalInterest, fixedTermInterest: incFixedTermInterest,
    grossProfit: incGrossProfit, operatingExpense: incOperatingExpense,
    reserveAlloc: incReserveAlloc, socialAlloc: incSocialAlloc, netProfit: incNetProfit,
  };

  // ---- Cash flow, computed LIVE per month ----
  // Each line = this month's live total from the by-month stores; when a source has no
  // live rows for the month it falls back to the imported snapshot value. Opening cash
  // is chained forward: opening(month) = previous month's closing cash.
  const cfForMonth = (month: string) => {
    const sm = (key: string, field: string, def: any = {}) => {
      const rows = (getStoredData(key, def) || {})[month];
      return Array.isArray(rows) ? rows.reduce((s: number, r: any) => s + num(r[field]), 0) : null;
    };
    const savings = (field: string) => {
      const a = sm('sof_savings_by_month', field), g = sm('sof_group_by_month', field), d = sm('sof_deposit_by_month', field);
      return (a == null && g == null && d == null) ? null : (a || 0) + (g || 0) + (d || 0);
    };
    const loans = (field: string) => {
      const a = sm('sof_loans_by_month', field), d = sm('sof_loans_deposit_by_month', field);
      return (a == null && d == null) ? null : (a || 0) + (d || 0);
    };
    const interestRecvLive = (() => {
      const a = sm('sof_loans_by_month', 'interestPaid'), d = sm('sof_loans_deposit_by_month', 'interestPaid'), e = sm('sof_external_provided_by_month', 'interest');
      return (a == null && d == null && e == null) ? null : (a || 0) + (d || 0) + (e || 0);
    })();
    const pk = (live: number | null, _k?: string) => (live != null ? live : 0);

    const memberSavingsIn = pk(sm('sof_savings_by_month', 'addSaving'), 'memberSavingsIn');
    const depositSavingsIn = pk(sm('sof_deposit_by_month', 'addSaving'), 'depositSavingsIn');
    // Group cash inflow = manual deposits only (ទុនបន្ថែម); the auto addSaving on
    // reserve/social/R004 is a non-cash profit allocation, not real cash in.
    const groupExtra = pk(sm('sof_group_by_month', 'manualAdd'), 'groupExtra');
    const fixedTermIn = ftSum(month, 'addSaving');
    const repayment = pk(loans('repayment'), 'repayment');
    const externalRepayment = pk(sm('sof_external_provided_by_month', 'repayment'), 'externalRepayment');
    const externalLoanReceived = pk(sm('sof_external_received_by_month', 'newLoan'), 'externalLoanReceived');
    // ប្រាក់ពិន័យ/សমាជិកភាព (cash IN) — only ជាក់ស្តែង (actualFee) is paid in cash.
    // កាត់ទុន (membership deducted from the member's account) is NOT a cash inflow.
    const fines = pk(savings('actualFee'), 'fines');
    const interestReceived = pk(interestRecvLive, 'interestReceived');
    const manual = (getStoredData('sof_cashflow_manual_by_month', {}) || {})[month] || {};
    const otherIncome = (manual.otherIncome != null && manual.otherIncome !== '') ? num(manual.otherIncome) : 0;

    // Loans given out = new loans to members + deposit members + external parties.
    const loanGiven = pk((() => {
      const l = loans('newLoan'), e = sm('sof_external_provided_by_month', 'newLoan');
      return (l == null && e == null) ? null : (l || 0) + (e || 0);
    })(), 'loanGiven');
    // Withdrawals (cash OUT) = ដកទុន (withdraw) + កាត់ទុន (deductFee — membership
    // deducted from the account), summed per savings table.
    const wSum = (key: string) => {
      const w = sm(key, 'withdraw'), d = sm(key, 'deductFee');
      return (w == null && d == null) ? null : (w || 0) + (d || 0);
    };
    const withdrawActive = pk(wSum('sof_savings_by_month'), 'withdrawActive');
    const withdrawDeposit = pk(wSum('sof_deposit_by_month'), 'withdrawDeposit');
    const withdrawGroup = pk(wSum('sof_group_by_month'), 'withdrawGroup');
    const withdrawFixedTerm = ftSum(month, 'withdraw');
    // Interest paid out to fixed-term holders = per-row rate × beginning (respects a closed
    // account at 0%). Same figure as the income statement so cash flow and balance sheet tie.
    const fixedTermInterest = fixedTermInterestOf(month);
    const externalBorrowInterest = pk(sm('sof_external_received_by_month', 'interest'), 'interestPaid');
    // Principal repaid on money borrowed from outside — a real cash OUT.
    const externalBorrowRepay = pk(sm('sof_external_received_by_month', 'repayment'), 'externalBorrowRepay');
    const operatingExpense = pk(sm('sof_expenses_by_month', 'total', EXPENSE_BY_MONTH), 'operatingExpense');
    const otherOutflow = (manual.otherOutflow != null && manual.otherOutflow !== '') ? num(manual.otherOutflow) : 0;

    const inflowExOpening = memberSavingsIn + depositSavingsIn + fixedTermIn + groupExtra + repayment + externalRepayment + externalLoanReceived + fines + interestReceived + otherIncome;
    const totalOutflow = loanGiven + withdrawActive + withdrawDeposit + withdrawGroup + withdrawFixedTerm + fixedTermInterest + externalBorrowInterest + externalBorrowRepay + operatingExpense + otherOutflow;
    return { memberSavingsIn, depositSavingsIn, fixedTermIn, groupExtra, repayment, externalRepayment, externalLoanReceived, fines, interestReceived, otherIncome, loanGiven, withdrawActive, withdrawDeposit, withdrawGroup, withdrawFixedTerm, fixedTermInterest, externalBorrowInterest, externalBorrowRepay, operatingExpense, otherOutflow, inflowExOpening, totalOutflow };
  };

  const cfIdx = months.indexOf(selectedMonth);
  const cfFirstSnap = (monthlyReports[months[0]] || {}).cashflow;
  let cfOpening = (cfFirstSnap && typeof cfFirstSnap.openingCash === 'number') ? cfFirstSnap.openingCash : 0;
  let cfCur: any = null;
  for (let i = 0; i <= cfIdx; i++) {
    cfCur = cfForMonth(months[i]);
    if (i < cfIdx) cfOpening = cfOpening + cfCur.inflowExOpening - cfCur.totalOutflow;
  }
  const cf = cfCur ? {
    openingCash: cfOpening,
    memberSavingsIn: cfCur.memberSavingsIn, depositSavingsIn: cfCur.depositSavingsIn, fixedTermIn: cfCur.fixedTermIn, repayment: cfCur.repayment,
    externalRepayment: cfCur.externalRepayment,
    groupExtra: cfCur.groupExtra, externalLoanReceived: cfCur.externalLoanReceived, fines: cfCur.fines,
    interestReceived: cfCur.interestReceived, otherIncome: cfCur.otherIncome,
    loanGiven: cfCur.loanGiven, withdrawActive: cfCur.withdrawActive, withdrawDeposit: cfCur.withdrawDeposit,
    withdrawGroup: cfCur.withdrawGroup, withdrawFixedTerm: cfCur.withdrawFixedTerm,
    fixedTermInterest: cfCur.fixedTermInterest, externalBorrowInterest: cfCur.externalBorrowInterest,
    externalBorrowRepay: cfCur.externalBorrowRepay,
    operatingExpense: cfCur.operatingExpense, otherOutflow: cfCur.otherOutflow,
    totalInflow: cfOpening + cfCur.inflowExOpening,
    totalOutflow: cfCur.totalOutflow,
    netCash: (cfOpening + cfCur.inflowExOpening) - cfCur.totalOutflow,
  } : null;
  const m2 = (v: number | undefined) => (typeof v === 'number' ? fmtMoney(v) : '-');

  // Unpaid loan interest (interest due − paid, accumulated per month). Standard treatment:
  // it is booked on BOTH sides — as an ASSET (ការប្រាក់ត្រូវទទួល / interest receivable) and
  // as EQUITY (ការប្រាក់រក្សាទុក / R004) — a self-balancing pair that does NOT touch cash or
  // income. So cash on hand stays the true residual = the cash-flow net.
  const unpaidInterestFor = (m: string) => {
    const due = (sumOf('sof_loans_by_month', 'interest', m) || 0) + (sumOf('sof_loans_deposit_by_month', 'interest', m) || 0);
    const paid = (sumOf('sof_loans_by_month', 'interestPaid', m) || 0) + (sumOf('sof_loans_deposit_by_month', 'interestPaid', m) || 0);
    return Math.max(0, due - paid);
  };
  const bsIdx = months.indexOf(selectedMonth);
  const bsUnpaidInterest = months.slice(0, bsIdx + 1).reduce((s, m) => s + unpaidInterestFor(m), 0);
  const bsInterestReceivable = bsUnpaidInterest;             // asset side
  const bsBaseEquity = bsReserve + bsSocial + bsYes + bsUnpaidInterest;   // reserve/social/YES + R004
  // Cash on hand = the cash-flow statement's CLOSING balance (the real cash the group
  // tracks month to month), so the balance sheet and cash flow always show the same cash.
  // Retained earnings (accumulated surplus) is the balancing equity item — it is 0 when the
  // cash flow ties to the residual, and otherwise shows the accrual/timing gap explicitly.
  const bsCashOnHand = cf ? cf.netCash : (bsTotalLiabilities + bsBaseEquity - bsLoansMembers - bsLoansExternal - bsInterestReceivable - bsBankBalance);
  const bsTotalAssets = bsCashOnHand + bsBankBalance + bsLoansMembers + bsLoansExternal + bsInterestReceivable;
  const bsRetainedEarnings = bsTotalAssets - bsTotalLiabilities - bsBaseEquity;
  const bsTotalEquity = bsBaseEquity + bsRetainedEarnings;

  return (
    <PageView 
      hideUpload={true} 
      hideDownload={true} 
      hideAdd={true}
      title={
        <div className="flex flex-wrap items-center gap-3">
          <span>របាយការណ៍ហិរញ្ញវត្ថុ - </span>
          <select 
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="text-lg md:text-xl font-bold bg-[#eef8f2] border border-green-200 text-[#0a6652] px-3 py-1 rounded-lg outline-none cursor-pointer shadow-sm"
          >
            {months.map(m => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>
      }
    >
      {/* Tabs */}
      <div className="flex flex-wrap gap-3 mb-8">
        <button 
          onClick={() => setActiveTab('balance')}
          className={`px-6 py-2.5 rounded-full font-bold text-sm transition-colors ${activeTab === 'balance' ? 'bg-[#0a6652] text-white shadow-md' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
        >
          តារាងតុល្យការ
        </button>
        <button 
          onClick={() => setActiveTab('cashflow')}
          className={`px-6 py-2.5 rounded-full font-bold text-sm transition-colors ${activeTab === 'cashflow' ? 'bg-[#0a6652] text-white shadow-md' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
        >
          លំហូរសាច់ប្រាក់
        </button>
        <button 
          onClick={() => setActiveTab('income')}
          className={`px-6 py-2.5 rounded-full font-bold text-sm transition-colors ${activeTab === 'income' ? 'bg-[#0a6652] text-white shadow-md' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
        >
          របាយការណ៍ចំណូល
        </button>
        <button 
          onClick={() => setActiveTab('expense')}
          className={`px-6 py-2.5 rounded-full font-bold text-sm transition-colors ${activeTab === 'expense' ? 'bg-[#0a6652] text-white shadow-md' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
        >
          របាយការណ៍ចំណាយ
        </button>
      </div>

      {activeTab === 'balance' && (
        <>
          {/* Overview Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
            <div className="bg-[#eef8f2] p-5 rounded-2xl border border-green-200 shadow-sm flex flex-col items-center justify-center text-center">
              <div className="text-sm font-bold text-slate-500 mb-1">សរុបទ្រព្យសម្បត្តិ</div>
              <div className="text-2xl font-black text-[#0a6652]">{fmtMoney(bsTotalAssets)}</div>
            </div>
            <div className="bg-orange-50 p-5 rounded-2xl border border-orange-200 shadow-sm flex flex-col items-center justify-center text-center">
              <div className="text-sm font-bold text-slate-500 mb-1">សរុបបំណុល</div>
              <div className="text-2xl font-black text-orange-600">{fmtMoney(bsTotalLiabilities)}</div>
            </div>
            <div className="bg-indigo-50 p-5 rounded-2xl border border-indigo-200 shadow-sm flex flex-col items-center justify-center text-center">
              <div className="text-sm font-bold text-slate-500 mb-1">សរុបដើមទុន</div>
              <div className="text-2xl font-black text-indigo-600">{fmtMoney(bsTotalEquity)}</div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Assets Section */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
              <div className="bg-slate-50 px-6 py-4 border-b border-slate-200">
                <h3 className="font-bold text-slate-800 text-lg">ទ្រព្យសកម្ម (Assets)</h3>
              </div>
              <div className="p-6 space-y-4 flex-1">
                <div className="flex justify-between items-center text-sm font-medium text-slate-700">
                  <span>សាច់ប្រាក់នៅក្នុងដៃ</span>
                  <span className={bsCashOnHand ? "font-bold" : "text-slate-400"}>{bsCashOnHand ? fmtMoney(bsCashOnHand) : '-'}</span>
                </div>
                <div className="flex justify-between items-center text-sm font-medium text-slate-700">
                  <span>សមតុល្យនៅធនាគារ</span>
                  <span className={bsBankBalance ? "font-bold" : "text-slate-400"}>{bsBankBalance ? fmtMoney(bsBankBalance) : '-'}</span>
                </div>
                <div className="flex justify-between items-center text-sm font-medium text-slate-700">
                  <span>ប្រាក់ផ្តល់កម្ចីឱ្យសមាជិក</span>
                  <span className="font-bold">{fmtMoney(bsLoansMembers)}</span>
                </div>
                <div className="flex justify-between items-center text-sm font-medium text-slate-700">
                  <span>ប្រាក់ផ្តល់កម្ចីទៅខាងក្រៅ</span>
                  <span className="font-bold">{fmtMoney(bsLoansExternal)}</span>
                </div>
                <div className="flex justify-between items-center text-sm font-medium text-slate-700">
                  <span>ការប្រាក់ត្រូវទទួល</span>
                  <span className={bsInterestReceivable ? "font-bold" : "font-bold text-slate-400"}>{bsInterestReceivable ? fmtMoney(bsInterestReceivable) : '-'}</span>
                </div>
              </div>
              <div className="bg-[#eef8f2] px-6 py-4 border-t border-green-100 flex justify-between items-center">
                <span className="font-bold text-[#0a6652]">សរុបទ្រព្យសម្បត្តិ</span>
                <span className="font-black text-[#0a6652] text-lg">{fmtMoney(bsTotalAssets)}</span>
              </div>
            </div>

            {/* Liabilities & Equity Section */}
            <div className="space-y-6">
              {/* Liabilities */}
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="bg-slate-50 px-6 py-4 border-b border-slate-200">
                  <h3 className="font-bold text-slate-800 text-lg">បំណុល (Liabilities)</h3>
                </div>
                <div className="p-6 space-y-4">
                  <div className="flex justify-between items-center text-sm font-medium text-slate-700">
                    <span>ប្រាក់សន្សំរបស់សមាជិកសន្សំ</span>
                    <span className="font-bold">{fmtMoney(bsMemberSavings)}</span>
                  </div>
                  <div className="flex justify-between items-center text-sm font-medium text-slate-700">
                    <span>ប្រាក់សន្សំរបស់សមាជិកបញ្ញើ</span>
                    <span className="font-bold">{fmtMoney(bsDepositSavings)}</span>
                  </div>
                  <div className="flex justify-between items-center text-sm font-medium text-slate-700">
                    <span>កម្ចីទទួលបានពីខាងក្រៅ</span>
                    <span className={bsExternalBorrow ? "font-bold" : "text-slate-400"}>{bsExternalBorrow ? fmtMoney(bsExternalBorrow) : '-'}</span>
                  </div>
                  <div className="flex justify-between items-center text-sm font-medium text-slate-700">
                    <span>គណនីសន្សំមានកាលកំណត់</span>
                    <span className={bsFixedTerm ? "font-bold" : "text-slate-400"}>{bsFixedTerm ? fmtMoney(bsFixedTerm) : '-'}</span>
                  </div>
                </div>
                <div className="bg-orange-50 px-6 py-4 border-t border-orange-100 flex justify-between items-center">
                  <span className="font-bold text-orange-700">សរុបបំណុល</span>
                  <span className="font-black text-orange-700 text-lg">{fmtMoney(bsTotalLiabilities)}</span>
                </div>
              </div>

              {/* Equity */}
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="bg-slate-50 px-6 py-4 border-b border-slate-200">
                  <h3 className="font-bold text-slate-800 text-lg">មូលធន (ដើមទុន)</h3>
                </div>
                <div className="p-6 space-y-4">
                  <div className="flex justify-between items-center text-sm font-medium text-slate-700">
                    <span>ទុនបម្រុង</span>
                    <span className="font-bold">{fmtMoney(bsReserve)}</span>
                  </div>
                  <div className="flex justify-between items-center text-sm font-medium text-slate-700">
                    <span>ទុនសង្គម</span>
                    <span className="font-bold">{fmtMoney(bsSocial)}</span>
                  </div>
                  <div className="flex justify-between items-center text-sm font-medium text-slate-700">
                    <span>ទុនក្រុមយេស (YES)</span>
                    <span className="font-bold">{fmtMoney(bsYes)}</span>
                  </div>
                  <div className="flex justify-between items-center text-sm font-medium text-slate-700">
                    <span>ការប្រាក់រក្សាទុក</span>
                    <span className={bsUnpaidInterest ? "font-bold" : "font-bold text-slate-400"}>{bsUnpaidInterest ? fmtMoney(bsUnpaidInterest) : '-'}</span>
                  </div>
                  {Math.abs(bsRetainedEarnings) > 0.005 && (
                    <div className="flex justify-between items-center text-sm font-medium text-slate-700">
                      <span>ចំណេញរក្សាទុក (លម្អៀងបង្គរ)</span>
                      <span className="font-bold">{fmtMoney(bsRetainedEarnings)}</span>
                    </div>
                  )}
                </div>
                <div className="bg-indigo-50 px-6 py-4 border-t border-indigo-100 flex justify-between items-center">
                  <span className="font-bold text-indigo-700">សរុបដើមទុន</span>
                  <span className="font-black text-indigo-700 text-lg">{fmtMoney(bsTotalEquity)}</span>
                </div>
              </div>

              <div className="bg-slate-800 rounded-2xl px-6 py-5 flex justify-between items-center text-white shadow-md">
                <span className="font-bold">សរុបបំណុល និងមូលធន</span>
                <span className="font-black text-xl">{fmtMoney(bsTotalLiabilities + bsTotalEquity)}</span>
              </div>
            </div>
          </div>
        </>
      )}

      {activeTab === 'cashflow' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Cash Inflow Section */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
            <div className="bg-slate-50 px-6 py-4 border-b border-slate-200">
              <h3 className="font-bold text-slate-800 text-lg">ប្រាក់ហូរចូល</h3>
            </div>
            <div className="p-6 space-y-4 flex-1">
              {[
                { label: 'សាច់ប្រាក់នៅសល់ក្នុងដៃ', value: cf?.openingCash },
                { label: 'ប្រាក់ដាក់សន្សំសមាជិកម្ចាស់ភាគហ៊ុន', value: cf?.memberSavingsIn },
                { label: 'ប្រាក់សន្សំសមាជិកបញ្ញើសន្សំ', value: cf?.depositSavingsIn },
                { label: 'ទុនសន្សំបន្ថែមគណនីមានកាលកំណត់', value: cf?.fixedTermIn },
                { label: 'ទុនសន្សំបន្ថែមក្រុម', value: cf?.groupExtra },
                { label: 'ប្រាក់បង់រំលស់កម្ចីសមាជិក', value: cf?.repayment },
                { label: 'ប្រាក់បង់រំលស់កម្ចីខាងក្រៅ', value: cf?.externalRepayment },
                { label: 'ទទួលប្រាក់កម្ចីពីខាងក្រៅ', value: cf?.externalLoanReceived },
                { label: 'ប្រាក់ពិន័យ/សមាជិកភាព', value: cf?.fines },
                { label: 'ការប្រាក់ទទួលបាន', value: cf?.interestReceived }
              ].map((item, i) => (
                <div key={i} className="flex justify-between items-center text-sm font-medium text-slate-700">
                  <span>{item.label}</span>
                  <span className={item.value ? "font-bold" : "text-slate-400"}>{item.value ? fmtMoney(item.value) : '-'}</span>
                </div>
              ))}
              <div className="flex justify-between items-center text-sm font-medium text-slate-700">
                <span>ចំណូលផ្សេងៗ</span>
                <input value={cfOtherIncome} placeholder="0.00"
                  onChange={(e) => { setCfOtherIncome(e.target.value); saveCfManual(e.target.value, cfOtherOutflow); }}
                  className="w-28 text-right bg-transparent px-2 py-1 rounded border border-dashed border-slate-300 focus:border-[#0a6652] focus:bg-[#f3faf6] outline-none font-bold" />
              </div>
            </div>
            <div className="bg-[#eef8f2] px-6 py-4 border-t border-green-100 flex justify-between items-center">
              <span className="font-bold text-[#0a6652]">សរុប</span>
              <span className="font-black text-[#0a6652] text-lg">{m2(cf?.totalInflow)}</span>
            </div>
          </div>

          {/* Cash Outflow Section */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
            <div className="bg-slate-50 px-6 py-4 border-b border-slate-200">
              <h3 className="font-bold text-slate-800 text-lg">ប្រាក់ហូរចេញ</h3>
            </div>
            <div className="p-6 space-y-4 flex-1">
              {[
                { label: 'ការផ្តល់កម្ចីសរុប', value: cf?.loanGiven },
                { label: 'សមាជិកសកម្មដកទុន', value: cf?.withdrawActive },
                { label: 'សមាជិកបញ្ញើរដកទុន', value: cf?.withdrawDeposit },
                { label: 'គណនីក្រុមដកទុន', value: cf?.withdrawGroup },
                { label: 'គណនីមានកាលកំណត់ដកទុន', value: cf?.withdrawFixedTerm },
                { label: 'ការប្រាក់គណនីមានកាលកំណត់', value: cf?.fixedTermInterest },
                { label: 'ការប្រាក់កម្ចីទទួលពីក្រៅ', value: cf?.externalBorrowInterest },
                { label: 'សងកម្ចីទៅខាងក្រៅ', value: cf?.externalBorrowRepay },
                { label: 'ចំណាយប្រតិបត្តិការ', value: cf?.operatingExpense }
              ].map((item, i) => (
                <div key={i} className="flex justify-between items-center text-sm font-medium text-slate-700">
                  <span>{item.label}</span>
                  <span className={item.value ? "font-bold" : "text-slate-400"}>{item.value ? fmtMoney(item.value) : '-'}</span>
                </div>
              ))}
              <div className="flex justify-between items-center text-sm font-medium text-slate-700">
                <span>ចំណាយផ្សេងៗ</span>
                <input value={cfOtherOutflow} placeholder="0.00"
                  onChange={(e) => { setCfOtherOutflow(e.target.value); saveCfManual(cfOtherIncome, e.target.value); }}
                  className="w-28 text-right bg-transparent px-2 py-1 rounded border border-dashed border-slate-300 focus:border-orange-500 focus:bg-orange-50 outline-none font-bold" />
              </div>
            </div>
            <div className="bg-orange-50 px-6 py-4 border-t border-orange-100 flex justify-between items-center">
              <span className="font-bold text-orange-700">សរុប</span>
              <span className="font-black text-orange-700 text-lg">{m2(cf?.totalOutflow)}</span>
            </div>
            <div className="bg-slate-800 px-6 py-4 flex justify-between items-center text-white">
              <span className="font-bold">សាច់ប្រាក់សល់ចុងខែ (= សល់ក្នុងដៃ)</span>
              <span className="font-black text-lg">{m2(cf?.netCash)}</span>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'income' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col max-w-3xl mx-auto">
          <div className="p-6 md:p-8 space-y-6">
            {/* Income Section */}
            <div>
              <h3 className="font-bold text-slate-800 text-lg mb-4">ចំណូល</h3>
              <div className="space-y-3 pl-4">
                <div className="flex justify-between items-center text-sm font-medium text-slate-700">
                  <span>ការប្រាក់សមាជិកកម្ចី</span>
                  <span className="font-bold">{m2(inc?.interestIncome)}</span>
                </div>
                <div className="flex justify-between items-center text-sm font-medium text-slate-700">
                  <span>ចំណូលផ្សេងៗ</span>
                  <span className={inc?.otherIncome ? "font-bold" : "text-slate-400"}>{inc?.otherIncome ? fmtMoney(inc.otherIncome) : '-'}</span>
                </div>
              </div>
              <div className="flex justify-between items-center mt-4 pt-4 border-t border-slate-200">
                 <span className="font-bold text-slate-800">សរុបចំណូល</span>
                 <span className="font-black text-[#0a6652] text-lg">{m2(inc?.totalIncome)}</span>
              </div>
            </div>

            {/* Cost of Funds */}
            <div>
              <div className="space-y-3 pl-4">
                <div className="flex justify-between items-center text-sm font-medium text-slate-700">
                  <span>ការប្រាក់សមាជិកបញ្ញើ</span>
                  <span className="font-bold">{m2(inc?.depositInterestCost)}</span>
                </div>
                <div className="flex justify-between items-center text-sm font-medium text-slate-700">
                  <span>កម្ចីពីខាងក្រៅ</span>
                  <span className={inc?.externalLoanInterest ? "font-bold" : "text-slate-400"}>{inc?.externalLoanInterest ? fmtMoney(inc.externalLoanInterest) : '-'}</span>
                </div>
                <div className="flex justify-between items-center text-sm font-medium text-slate-700">
                  <span>ការប្រាក់គណនីមានកាលកំណត់</span>
                  <span className="font-bold">{m2(inc?.fixedTermInterest)}</span>
                </div>
              </div>
              <div className="flex justify-between items-center mt-4 pt-4 border-t border-slate-200">
                 <span className="font-bold text-slate-800">ចំណេញដុល</span>
                 <span className="font-black text-indigo-600 text-lg">{m2(inc?.grossProfit)}</span>
              </div>
            </div>

            {/* Operating Expenses & Other deductions */}
            <div>
              <div className="space-y-3 pl-4">
                <div className="flex justify-between items-center text-sm font-medium text-slate-700">
                  <span>ចំណាយប្រតិបត្តិការ</span>
                  <span className="font-bold">{m2(inc?.operatingExpense)}</span>
                </div>
                <div className="flex justify-between items-center text-sm font-medium text-slate-700">
                  <span>ទុនបម្រុង</span>
                  <span className="font-bold">{m2(inc?.reserveAlloc)}</span>
                </div>
                <div className="flex justify-between items-center text-sm font-medium text-slate-700">
                  <span>ទុនសង្គម</span>
                  <span className="font-bold">{m2(inc?.socialAlloc)}</span>
                </div>
              </div>
            </div>
          </div>
          <div className="bg-[#eef8f2] px-6 md:px-8 py-5 border-t border-green-100 flex justify-between items-center">
            <span className="font-bold text-[#0a6652] text-lg">ប្រាក់ចំណេញសរុប</span>
            <span className="font-black text-[#0a6652] text-xl">{m2(inc?.netProfit)}</span>
          </div>
        </div>
      )}

      {activeTab === 'expense' && <Expenses embedded month={selectedMonth} />}
    </PageView>
  );
}

function History() {
  return (
    <PageView title="កំណត់ត្រាប្រវត្តិ (History)" hideUpload={true} hideDownload={true} hideAdd={true}>
      <p className="text-slate-500 font-medium mb-6">ប្រវត្តិប្រតិបត្តិការទាំងអស់ ដែលបានធ្វើឡើងនៅក្នុងប្រព័ន្ធ។</p>
      <div className="flex items-center justify-center h-48 bg-amber-50 text-amber-600 rounded-2xl font-bold border border-amber-100">
        បញ្ជីប្រតិបត្តិការ (Log History)
      </div>
    </PageView>
  );
}

function SettingsPage() {
  const [interestRate, setInterestRate] = useState('1.5%');
  const [telegramNotification, setTelegramNotification] = useState(true);

  const [newAdminUsername, setNewAdminUsername] = useState(getAdminAuth().username);
  const [newAdminPassword, setNewAdminPassword] = useState('');
  const [passwordSuccessMsg, setPasswordSuccessMsg] = useState('');

  const handleChangePassword = (e: React.FormEvent) => {
    e.preventDefault();
    const cur = getAdminAuth();
    const next = { ...cur };
    let changed = false;
    if (newAdminUsername.trim() !== '') { next.username = newAdminUsername.trim(); changed = true; }
    if (newAdminPassword.trim() !== '') { next.password = newAdminPassword; changed = true; }
    if (changed) {
      setStoredData('sof_admin_auth', next);  // synced to Supabase → works on every device
      setPasswordSuccessMsg('ប្តូរគណនី/លេខសំងាត់បានជោគជ័យ! (Saved)');
      setTimeout(() => setPasswordSuccessMsg(''), 3000);
      setNewAdminPassword('');
    }
  };

  const handleExportJSON = () => {
    const data: Record<string, any> = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('sof_')) {
        const val = localStorage.getItem(key);
        if (val) {
          try {
            data[key] = JSON.parse(val);
          } catch (e) {
            data[key] = val;
          }
        }
      }
    }
    
    // Create blob and trigger download
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `sof_backup_${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <PageView title="បញ្ជូល និងកំណត់ទិន្នន័យ (Settings)" hideUpload={true} hideDownload={true} hideAdd={true}>
      <p className="text-slate-500 font-medium text-xs mb-6">ការកំណត់ប្រព័ន្ធ អត្រាការប្រាក់ និងការនាំចេញទិន្នន័យគម្រោង។</p>
      
      {/* System Settings Form */}
      <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm space-y-4 mb-6">
        <h3 className="text-xs font-bold text-slate-800 flex items-center gap-2 pb-2 border-b border-slate-100">
          <Settings size={16} className="text-[#0a6652]" />
          <span>ការកំណត់ប្រព័ន្ធទូទៅ (General Settings)</span>
        </h3>
        
        <div className="space-y-3">
          <div>
            <label className="block text-[10px] font-bold text-slate-500 mb-1">អត្រាការប្រាក់ប្រចាំខែ (Monthly Interest Rate)</label>
            <input 
              type="text" 
              value={interestRate} 
              onChange={(e) => setInterestRate(e.target.value)}
              className="w-full text-xs font-bold border border-slate-200 rounded-xl px-3 py-2 bg-slate-50 focus:bg-white focus:border-[#0a6652] outline-none"
            />
          </div>

          <div className="flex items-center justify-between py-2">
            <div>
              <label className="block text-[10px] font-bold text-slate-800">ផ្ញើដំណឹងទៅ Telegram Bot</label>
              <span className="text-[9px] text-slate-400">ផ្ញើរបាយការណ៍ប្រតិបត្តិការចូលគ្រុបស្វ័យប្រវត្ត</span>
            </div>
            <button 
              onClick={() => setTelegramNotification(!telegramNotification)}
              className={`w-10 h-6 rounded-full p-1 transition-colors duration-200 focus:outline-none cursor-pointer ${telegramNotification ? 'bg-[#0a6652]' : 'bg-slate-300'}`}
            >
              <div className={`bg-white w-4 h-4 rounded-full shadow-md transform duration-200 ${telegramNotification ? 'translate-x-4' : 'translate-x-0'}`} />
            </button>
          </div>
        </div>
      </div>

      {/* Security Info */}
      <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm space-y-4 mb-6">
        <h3 className="text-xs font-bold text-slate-800 flex items-center gap-2 pb-2 border-b border-slate-100">
          <Lock size={16} className="text-rose-600" />
          <span>សុវត្ថិភាព (Security)</span>
        </h3>
        
        <form onSubmit={handleChangePassword} className="space-y-3">
          {passwordSuccessMsg && (
            <div className="p-2 bg-emerald-50 text-emerald-700 text-[10px] font-bold rounded-lg border border-emerald-100">
              ✅ {passwordSuccessMsg}
            </div>
          )}
          <div>
            <label className="block text-[10px] font-bold text-slate-500 mb-1">ឈ្មោះគណនីអ្នកគ្រប់គ្រង (Admin Username)</label>
            <input
              type="text"
              value={newAdminUsername}
              onChange={(e) => setNewAdminUsername(e.target.value)}
              className="w-full text-xs font-bold border border-slate-200 rounded-xl px-3 py-2 bg-slate-50 focus:bg-white focus:border-rose-500 outline-none"
              placeholder="admin"
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold text-slate-500 mb-1">លេខសំងាត់ថ្មី (New Admin Password)</label>
            <input
              type="password"
              value={newAdminPassword}
              onChange={(e) => setNewAdminPassword(e.target.value)}
              className="w-full text-xs font-bold border border-slate-200 rounded-xl px-3 py-2 bg-slate-50 focus:bg-white focus:border-rose-500 outline-none"
              placeholder="ទុកទទេ បើមិនប្តូរលេខសំងាត់..."
            />
          </div>
          <button
            type="submit"
            className="w-full bg-rose-600 hover:bg-rose-700 text-white font-bold text-[11px] py-2.5 rounded-xl transition-colors cursor-pointer"
          >
            រក្សាទុកគណនី និងលេខសំងាត់ (Save)
          </button>
        </form>
      </div>

      {/* Export & Download Section for Claude / Developers */}
      <div className="bg-gradient-to-br from-[#0a6652] to-[#164e41] p-5 rounded-2xl text-white shadow-md space-y-4 relative overflow-hidden">
        <div className="absolute -right-6 -bottom-6 w-24 h-24 bg-white/5 rounded-full pointer-events-none" />
        
        <h3 className="text-xs font-black uppercase tracking-wider flex items-center gap-2">
          <Sparkles size={16} className="text-yellow-300 animate-pulse" />
          <span>នាំចេញកូដគម្រោងដើម្បីបន្តជាមួយ Claude</span>
        </h3>

        <p className="text-[10px] text-teal-100 leading-relaxed font-medium">
          ដើម្បីទាញយកកូដគម្រោង (Codebase) ទាំងអស់យកទៅដំណើរការនៅលើកុំព្យូទ័រផ្ទាល់ខ្លួន ឬយកទៅបន្តការងារជាមួយ Claude, ChatGPT ឬ AI ផ្សេងទៀត៖
        </p>

        <div className="space-y-2 bg-black/15 p-3.5 rounded-xl text-[10px] border border-white/10 font-mono">
          <div className="flex gap-2 items-start">
            <span className="bg-yellow-400 text-slate-950 font-black w-4 h-4 rounded-full flex items-center justify-center text-[9px] shrink-0 mt-0.5">1</span>
            <p className="text-white">ក្រឡេកទៅមើល <span className="font-bold underline text-yellow-300">ម៉ឺនុយការកំណត់ (Settings Icon)</span> នៅផ្នែកខាងលើស្តាំបំផុតនៃកម្មវិធី Google AI Studio។</p>
          </div>
          <div className="flex gap-2 items-start mt-2">
            <span className="bg-yellow-400 text-slate-950 font-black w-4 h-4 rounded-full flex items-center justify-center text-[9px] shrink-0 mt-0.5">2</span>
            <p className="text-white">ស្វែងរកពាក្យ <span className="font-bold text-yellow-300">"Export to ZIP"</span> ដើម្បីទាញយកកូដទាំងអស់ជា file ZIP តែមួយដោយស្វ័យប្រវត្តិ។</p>
          </div>
          <div className="flex gap-2 items-start mt-2">
            <span className="bg-yellow-400 text-slate-950 font-black w-4 h-4 rounded-full flex items-center justify-center text-[9px] shrink-0 mt-0.5">3</span>
            <p className="text-white">ឬជ្រើសរើស <span className="font-bold text-yellow-300">"Export to GitHub"</span> ដើម្បីបញ្ជូនកូដទាំងអស់ទៅកាន់ GitHub Repository ផ្លូវការ៖ <span className="font-bold text-yellow-300 underline font-mono break-all">sophakcamkids-gif/sofmanagementapp</span> របស់អ្នក។</p>
          </div>
        </div>

        <div className="pt-2 flex flex-col gap-2">
          <button 
            type="button"
            onClick={handleExportJSON}
            className="w-full flex items-center justify-center gap-2 bg-yellow-400 hover:bg-yellow-500 text-slate-900 font-bold text-xs py-3 rounded-xl transition-colors cursor-pointer"
          >
            <Download size={16} />
            <span>ទាញយកទិន្នន័យ (Export to JSON)</span>
          </button>
          <div className="bg-white/10 p-2.5 rounded-xl border border-white/5 text-[9px] text-[#e3f4ee] flex items-center justify-center gap-2 text-center mt-2">
            <span>អ្នកក៏អាចនាំចូល (Import) ទិន្នន័យត្រឡប់មកវិញ ពីផ្ទាំងបញ្ជីសមាជិក ឬសន្សំបានផងដែរ។</span>
          </div>
        </div>
      </div>
    </PageView>
  );
}

function MemberLogin({ onLogin }: { onLogin: (role: string, id: string) => void }) {
  const navigate = useNavigate();
  const location = useLocation();
  // This app is the ADMIN console; members use the personal report link sent to them.
  const isInitiallyMember = location.search.includes('tab=member');

  const [loginType, setLoginType] = useState<'member' | 'admin'>(isInitiallyMember ? 'member' : 'admin');
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [adminUsername, setAdminUsername] = useState(getAdminAuth().username);
  const [adminPassword, setAdminPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Already signed in? Skip the login form and go straight to the right home page
  // (prevents the confusing "logged-in sidebar + login form" state).
  React.useEffect(() => {
    const role = localStorage.getItem('userRole');
    if (role === 'admin') navigate('/admin', { replace: true });
    else if (role === 'member') navigate(`/member-report?id=${localStorage.getItem('memberId') || ''}`, { replace: true });
  }, [navigate]);

  React.useEffect(() => {
    if (location.search.includes('tab=admin')) {
      setLoginType('admin');
    } else if (location.search.includes('tab=member')) {
      setLoginType('member');
    }
  }, [location.search]);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (loginType === 'member') {
      const code = loginId.trim().toUpperCase();
      if (!code) return;
      if (!memberExists(code)) {
        alert('រកមិនឃើញលេខ ID សមាជិកនេះទេ! សូមពិនិត្យ ID របស់អ្នកម្ដងទៀត។');
        return;
      }
      if (password !== getMemberPassword(code)) {
        alert('ពាក្យសម្ងាត់មិនត្រឹមត្រូវទេ!');
        return;
      }
      localStorage.setItem('userRole', 'member');
      localStorage.setItem('memberId', code);
      onLogin('member', code);
      navigate(`/member-report?id=${code}`);
    } else {
      const { username: storedAdminUsername, password: storedAdminPassword } = getAdminAuth();
      if (adminUsername.trim() === storedAdminUsername && adminPassword === storedAdminPassword) {
        localStorage.setItem('userRole', 'admin');
        onLogin('admin', '');
        navigate('/admin');
      } else {
        alert(`គណនីអ្នកគ្រប់គ្រងមិនត្រឹមត្រូវទេ! (គណនីសាកល្បង៖ ${storedAdminUsername} / ${storedAdminPassword})`);
      }
    }
  };

  return (
    <PageView title="ច្រកចូលប្រព័ន្ធ (System Login)" hideUpload hideAdd hideBack hideDownload>
      <div className="max-w-md mx-auto bg-white p-5 sm:p-8 rounded-[24px] border border-slate-200 shadow-sm mt-4">
        
        {loginType === 'member' && (
          <button
            type="button"
            onClick={() => { setLoginType('admin'); navigate('/login?tab=admin'); }}
            className="flex items-center gap-1 text-xs font-bold text-slate-500 hover:text-slate-800 mb-4"
          >
            <ChevronLeft size={14} /> ត្រឡប់ទៅគណៈកម្មការ (Admin)
          </button>
        )}

        <div className="text-center mb-6">
          <div className={`w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-4 border-4 border-white shadow-sm ${
            loginType === 'admin' ? 'bg-rose-50 text-rose-600' : 'bg-teal-50 text-[#0a6652]'
          }`}>
            {loginType === 'admin' ? <Lock size={36} strokeWidth={2} /> : <UserCheck size={36} strokeWidth={2} />}
          </div>
          <h2 className="text-2xl font-black text-slate-800">
            {loginType === 'admin' ? 'ចូលគណនីអ្នកគ្រប់គ្រង' : 'ស្វាគមន៍សមាជិក'}
          </h2>
          <p className="text-slate-500 mt-2 font-medium text-sm">
            {loginType === 'admin' 
              ? 'បញ្ចូលគណនីគណៈកម្មការ ដើម្បីគ្រប់គ្រងទិន្នន័យ'
              : 'បញ្ចូលលេខ ID ដើម្បីបើករបាយការណ៍ផ្ទាល់ខ្លួន (ឬប្រើ link ដែលគណៈកម្មការផ្ញើជូន)'
            }
          </p>
        </div>
        
        <form onSubmit={handleLogin} className="space-y-4">
          {loginType === 'member' ? (
            <>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">លេខ ID សមាជិក (Username)</label>
                <input
                  type="text"
                  value={loginId}
                  onChange={(e) => setLoginId(e.target.value)}
                  placeholder="ឧទាហរណ៍: C001"
                  className="w-full px-4 py-3 rounded-xl bg-slate-50 border border-slate-200 focus:outline-none focus:ring-2 focus:ring-[#0a6652] focus:border-transparent font-black text-xs sm:text-sm text-slate-800 placeholder:font-normal placeholder:text-slate-400"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">ពាក្យសម្ងាត់</label>
                <div className="relative">
                  <input 
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="ពាក្យសម្ងាត់..." 
                    className="w-full pl-4 pr-12 py-3 rounded-xl bg-slate-50 border border-slate-200 focus:outline-none focus:ring-2 focus:ring-[#0a6652] focus:border-transparent font-black text-xs sm:text-sm text-slate-800 placeholder:font-normal placeholder:text-slate-400"
                    required
                  />
                  <button 
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 focus:outline-none"
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>
              <button type="submit" className="w-full h-11 bg-[#0a6652] text-white font-bold py-2.5 px-4 rounded-xl shadow-lg shadow-teal-900/20 hover:bg-[#084f40] transition-colors flex items-center justify-center gap-2 mt-2 text-xs sm:text-sm cursor-pointer">
                <LogIn size={16} /> ចូលគណនីសមាជិក
              </button>
              <p className="text-[10px] text-slate-400 text-center font-medium leading-normal mt-1">
                ពាក្យសម្ងាត់ដើមរួម៖ <span className="font-extrabold text-[#0a6652]">sof2026</span> — សូមដូរវានៅពេលចូលលើកដំបូង (ប៊ូតុង «ដូរពាក្យសម្ងាត់» ក្នុងទំព័ររបាយការណ៍)។
              </p>
            </>
          ) : (
            <>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">ឈ្មោះគណនីអ្នកគ្រប់គ្រង</label>
                <input 
                  type="text" 
                  value={adminUsername}
                  onChange={(e) => setAdminUsername(e.target.value)}
                  placeholder="admin" 
                  className="w-full px-4 py-3 rounded-xl bg-slate-50 border border-slate-200 focus:outline-none focus:ring-2 focus:ring-rose-500 focus:border-transparent font-black text-xs sm:text-sm text-slate-800 placeholder:font-normal placeholder:text-slate-400"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">ពាក្យសម្ងាត់អ្នកគ្រប់គ្រង</label>
                <div className="relative">
                  <input 
                    type={showPassword ? "text" : "password"}
                    value={adminPassword}
                    onChange={(e) => setAdminPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full pl-4 pr-12 py-3 rounded-xl bg-slate-50 border border-slate-200 focus:outline-none focus:ring-2 focus:ring-rose-500 focus:border-transparent font-black text-xs sm:text-sm text-slate-800 placeholder:font-normal placeholder:text-slate-400"
                    required
                  />
                  <button 
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 focus:outline-none cursor-pointer"
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              <button type="submit" className="w-full h-11 bg-rose-600 text-white font-bold py-2.5 px-4 rounded-xl shadow-lg shadow-rose-950/20 hover:bg-rose-700 transition-colors flex items-center justify-center gap-2 mt-2 text-xs sm:text-sm cursor-pointer">
                <LogIn size={16} /> ចូលគណនីគណៈកម្មការ
              </button>
            </>
          )}
        </form>

        {loginType === 'admin' && (
          <div className="mt-6 pt-5 border-t border-slate-100 text-center">
            <p className="text-xs font-medium text-slate-500 mb-2">តើអ្នកជាសមាជិក?</p>
            <button
              type="button"
              onClick={() => { setLoginType('member'); navigate('/login?tab=member'); }}
              className="inline-flex items-center gap-1.5 text-xs font-extrabold text-[#0a6652] hover:text-[#084f40]"
            >
              <UserCheck size={14} /> បើកច្រកសមាជិក (Member Portal) →
            </button>
          </div>
        )}
      </div>
    </PageView>
  );
}

function MemberReport() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('dashboard');
  const [selectedMonth, setSelectedMonth] = useState('ឧសភា 2026');
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  
  const [loanFiles, setLoanFiles] = useState<{name: string; size: string; date: string; type: string}[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  
  // Digital loan form states
  const [showDigitalForm, setShowDigitalForm] = useState(false);
  const [digitalAmount, setDigitalAmount] = useState('');
  const [digitalTerm, setDigitalTerm] = useState('12');
  const [digitalPurpose, setDigitalPurpose] = useState('');
  const [digitalPhone, setDigitalPhone] = useState('012 345 678');

  // Loan report states based on the contract sheet
  const [repLoanAmt, setRepLoanAmt] = useState('1804.58'); // matching the total loan shown in member's dashboard screenshot $1,804.58!
  const [repLoanTerm, setRepLoanTerm] = useState(12);
  const [repLoanRate, setRepLoanRate] = useState(0.8);
  const [repBorrower, setRepBorrower] = useState('ជន សុភាក់');
  const [repBorrowerId, setRepBorrowerId] = useState('CM008');
  const [repPhone, setRepPhone] = useState('012 345 678');
  const [repGuarantor1, setRepGuarantor1] = useState('');
  const [repGuarantor1Id, setRepGuarantor1Id] = useState('');
  const [repGuarantor2, setRepGuarantor2] = useState('');
  const [repGuarantor2Id, setRepGuarantor2Id] = useState('');
  const [repFreq, setRepFreq] = useState<'monthly' | 'weekly'>('weekly'); // they say 'អាទិត្យ' in sheet, so let's support both but default 'weekly'!
  const [contractNum, setContractNum] = useState('MFC-2026-008');
  const [selectedReportYear, setSelectedReportYear] = useState('2026');
  const [summaryMonth, setSummaryMonth] = useState('');  // '' = auto (latest month with data)
  // Report signature (image + name), saved per member.
  const [sigImg, setSigImg] = useState('');
  const [sigName, setSigName] = useState('លឹវ វី');
  const sigFileRef = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    // ONE global report-preparer signature, cloud-synced → shown on every report.
    let s = getStoredData('sof_report_signature', {}) || {};
    if (!s.img) {
      // Migrate an older per-member signature (any member) so it isn't lost.
      const old = getStoredData('sof_member_signature', {}) || {};
      const found = Object.values(old).find((x: any) => x && x.img) as any;
      if (found) s = found;
    }
    setSigImg(s.img || '');
    setSigName(s.name || 'លឹវ វី');
  }, []);
  const saveSig = (img: string, name: string) => {
    setStoredData('sof_report_signature', { img, name });  // synced to Supabase, one for all
  };
  const handleSigUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { const img = String(reader.result); setSigImg(img); saveSig(img, sigName); };
    reader.readAsDataURL(file);
  };

  // Payment states for 'ការដាក់សន្សំ និងបង់កម្ចី' tab
  const [paymentType, setPaymentType] = useState<'savings' | 'loan'>('savings');
  const [paymentAmount, setPaymentAmount] = useState('50.00');
  const [loanPrincipal, setLoanPrincipal] = useState('40.00');
  const [loanInterest, setLoanInterest] = useState('10.00');
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().split('T')[0]);
  const [transactionId, setTransactionId] = useState('');
  const [proofImage, setProofImage] = useState<string | null>(null);
  const [proofFilename, setProofFilename] = useState('');
  const [submittedPayments, setSubmittedPayments] = useState<Array<{
    id: string;
    type: 'savings' | 'loan';
    amount: number;
    principal?: number;
    interest?: number;
    date: string;
    transactionId: string;
    status: 'pending' | 'approved';
    proofName: string;
    proofImg: string;
  }>>([
    {
      id: 'TXN-101',
      type: 'savings',
      amount: 30.00,
      date: '2026-05-10',
      transactionId: 'ABA-0098234B3',
      status: 'approved',
      proofName: 'savings_proof_may.png',
      proofImg: 'https://i.ibb.co/xtBGLWX7/708852725-868075986313154-5636381465848274787-n.jpg'
    }
  ]);

  // Pre-fill the loan report with the logged-in member's live borrower + loan details.
  React.useEffect(() => {
    const code = (localStorage.getItem('memberId') || '').toUpperCase();
    if (!code) return;
    const cOf = (r: any) => { const s = String(r?.id ?? r?.code ?? ''); return (s.includes(' ') ? s.split(' ').pop() : s || '').toUpperCase(); };
    const lists = [getStoredData('sof_member_list_data', []) || [], getStoredData('sof_profile_data', DEFAULT_PROFILE_DATA) || [], getStoredData('sof_deposit_profile_data', DEFAULT_DEPOSIT_PROFILE_DATA) || []];
    let name = '';
    for (const list of lists) { const m = list.find((x: any) => cOf(x) === code); if (m) { name = m.name || ''; break; } }
    const mths = ['មករា 2026', 'កុម្ភៈ 2026', 'មីនា 2026', 'មេសា 2026', 'ឧសភា 2026', 'មិថុនា 2026', 'កក្កដា 2026', 'សីហា 2026', 'កញ្ញា 2026', 'តុលា 2026', 'វិច្ឆិកា 2026', 'ធ្នូ 2026'];
    // Scan every month and take the member's peak recorded loan (a loan that was
    // outstanding in an earlier month still shows, even if the latest month is 0).
    let loanAmt = 0, loanRate = 0;
    for (const key of ['sof_loans_by_month', 'sof_loans_deposit_by_month']) {
      const by = getStoredData(key, {}) || {};
      for (const m of mths) {
        const rows = by[m];
        if (!Array.isArray(rows)) continue;
        const r = rows.find((x: any) => cOf(x) === code);
        if (!r) continue;
        const val = Math.max(num(r.remaining), num(r.loanValue), num(r.newLoan));
        if (val > loanAmt) loanAmt = val;
        if (num(r.rate)) loanRate = num(r.rate);
      }
    }
    if (name) setRepBorrower(name);
    setRepBorrowerId(code);
    setRepLoanAmt(loanAmt.toFixed(2));
    if (loanRate) setRepLoanRate(loanRate);
    setContractNum(`SOF-2026-${code}`);
  }, []);

  const calculateSchedule = () => {
    const amt = parseFloat(repLoanAmt) || 0;
    const term = repLoanTerm || 12;
    const r = (repLoanRate || 0.8) / 100;
    
    const schedule = [];
    let currentBal = amt;
    const monthlyPrincipal = amt / term;
    
    // Start date on 15 Jan 2026
    const startDate = new Date(2026, 0, 15);
    const khmerMonths = ["មករា", "កុម្ភៈ", "មីនា", "មេសា", "ឧសភា", "មិថុនា", "កក្កដា", "សីហា", "កញ្ញា", "តុលា", "វិច្ឆិកា", "ធ្នូ"];
    
    for (let i = 1; i <= term; i++) {
      const interest = currentBal * r;
      const principal = i === term ? currentBal : monthlyPrincipal;
      const totalPay = principal + interest;
      const dueBal = currentBal - principal;
      
      const dueDate = new Date(startDate);
      if (repFreq === 'monthly') {
        dueDate.setMonth(startDate.getMonth() + i);
      } else {
        dueDate.setDate(startDate.getDate() + (i * 7));
      }
      
      const dayStr = repFreq === 'monthly' ? `ខែទី ${i}` : `${i} អាទិត្យ`;
      const monthName = khmerMonths[dueDate.getMonth()];
      const dateString = `ថ្ងៃទី ${dueDate.getDate()} ខែ${dueDate.getMonth() + 1} ឆ្នាំ ${dueDate.getFullYear()}`;
      
      schedule.push({
        num: i,
        day: dayStr,
        monthName: monthName,
        dueDate: dateString,
        total: totalPay,
        interest: interest,
        principal: principal,
        balance: dueBal < 0.01 ? 0 : dueBal
      });
      
      currentBal = dueBal;
    }
    return schedule;
  };

  const handleFileUpload = (files: FileList | null) => {
    if (!files) return;
    const newList = [...loanFiles];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const sizeStr = file.size > 1024 * 1024 
        ? `${(file.size / (1024 * 1024)).toFixed(2)} MB` 
        : `${(file.size / 1024).toFixed(1)} KB`;
      
      const fileType = file.name.split('.').pop()?.toLowerCase() || '';
      const dateStr = "ថ្ងៃទី " + new Date().getDate() + " ខែ" + (new Date().getMonth() + 1) + " ឆ្នាំ " + new Date().getFullYear();
      
      newList.push({
        name: file.name,
        size: sizeStr,
        type: fileType,
        date: dateStr
      });
    }
    setLoanFiles(newList);
  };

  const removeLoanFile = (index: number) => {
    setLoanFiles(loanFiles.filter((_, i) => i !== index));
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setProofFilename(file.name);
      const reader = new FileReader();
      reader.onloadend = () => {
        setProofImage(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handlePaymentSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!proofImage) {
      alert("សូមភ្ជាប់មកជាមួយនូវរូបភាពភស្តុតាងនៃការបង់ប្រាក់!");
      return;
    }
    const isLoanVal = paymentType === 'loan';
    const finalAmount = isLoanVal
      ? (parseFloat(loanPrincipal) || 0) + (parseFloat(loanInterest) || 0)
      : parseFloat(paymentAmount) || 0;

    const newTxn = {
      id: `TXN-${Math.floor(100 + Math.random() * 900)}`,
      type: paymentType,
      amount: finalAmount,
      principal: isLoanVal ? (parseFloat(loanPrincipal) || 0) : undefined,
      interest: isLoanVal ? (parseFloat(loanInterest) || 0) : undefined,
      date: paymentDate,
      transactionId: transactionId || "N/A",
      status: 'pending' as const,
      proofName: proofFilename || 'screenshot.png',
      proofImg: proofImage,
    };
    setSubmittedPayments([newTxn, ...submittedPayments]);
    // Reset form
    setTransactionId('');
    setProofImage(null);
    setProofFilename('');
    alert("ការផ្ញើភស្តុតាងបានជោគជ័យ! គណៈកម្មការនឹងពិនិត្យ និងអនុម័តជូនក្នុងពេលឆាប់ៗ។");
  };
  
  const tabs = ['របាយការណ៍ផ្ទាល់ខ្លួន', 'ស្នើកម្ចី', 'របាយការណ៍កម្ចី', 'របាយការណ៍សន្សំ', 'ការដាក់សន្សំ និងបង់កម្ចី'];
  const months = ['មករា 2026', 'កុម្ភៈ 2026', 'មីនា 2026', 'មេសា 2026', 'ឧសភា 2026', 'មិថុនា 2026', 'កក្កដា 2026', 'សីហា 2026', 'កញ្ញា 2026', 'តុលា 2026', 'វិច្ឆិកា 2026', 'ធ្នូ 2026'];

  const handleChangePassword = (e: React.FormEvent) => {
    e.preventDefault();
    const code = (localStorage.getItem('memberId') || '').toUpperCase();
    if (currentPassword !== getMemberPassword(code)) {
      alert("ពាក្យសម្ងាត់បច្ចុប្បន្នមិនត្រឹមត្រូវទេ!");
      return;
    }
    if (!newPassword || newPassword.length < 4) {
      alert("ពាក្យសម្ងាត់ថ្មីត្រូវមានយ៉ាងតិច ៤ តួអក្សរ!");
      return;
    }
    if (newPassword !== confirmPassword) {
      alert("ពាក្យសម្ងាត់ថ្មី និងផ្ទៀងផ្ទាត់មិនត្រូវគ្នាទេ!");
      return;
    }
    setMemberPassword(code, newPassword);
    alert("បានផ្លាស់ប្តូរពាក្យសម្ងាត់ដោយជោគជ័យ!");
    setShowChangePassword(false);
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
  };

  // ---- Live data for the logged-in member ----
  const memberCode = (localStorage.getItem('memberId') || '').toUpperCase();
  const codeOf = (r: any) => { const s = String(r?.id ?? r?.code ?? ''); return (s.includes(' ') ? s.split(' ').pop() : s || '').toUpperCase(); };
  // Month keys for the selected report year (so the year selector filters the data).
  const memberMonths = ['មករា', 'កុម្ភៈ', 'មីនា', 'មេសា', 'ឧសភា', 'មិថុនា', 'កក្កដា', 'សីហា', 'កញ្ញា', 'តុលា', 'វិច្ឆិកា', 'ធ្នូ'].map((m) => `${m} ${selectedReportYear}`);
  const memberProfile = (() => {
    const lists = [
      getStoredData('sof_member_list_data', []) || [],
      getStoredData('sof_profile_data', DEFAULT_PROFILE_DATA) || [],
      getStoredData('sof_deposit_profile_data', DEFAULT_DEPOSIT_PROFILE_DATA) || [],
    ];
    for (const list of lists) {
      const m = list.find((x: any) => codeOf(x) === memberCode || String(x.code || '').toUpperCase() === memberCode);
      if (m) return m;
    }
    return null;
  })();
  const memberName = (memberProfile && memberProfile.name) || repBorrower;
  // Latest month in which this member has a row in the given by-month store.
  const memberLatest = (key: string, field: string, seed?: any) => {
    const by = getStoredData(key, seed || {}) || {};
    for (let i = memberMonths.length - 1; i >= 0; i--) {
      const rows = by[memberMonths[i]];
      if (Array.isArray(rows)) {
        const r = rows.find((x: any) => codeOf(x) === memberCode);
        if (r) return num(r[field]);
      }
    }
    return 0;
  };
  const memberSavingsTotal = memberLatest('sof_savings_by_month', 'total') + memberLatest('sof_deposit_by_month', 'total') + memberLatest('sof_fixedterm_by_month', 'total', FIXEDTERM_BY_MONTH);
  const memberLoanTotal = memberLatest('sof_loans_by_month', 'remaining') + memberLatest('sof_loans_deposit_by_month', 'remaining');
  const memberInitials = (memberName || '').trim().split(/\s+/).map((w: string) => w[0] || '').slice(0, 2).join('') || 'JS';
  // Savings-report rows: this member's monthly savings for the year (active or deposit).
  const memberSavingRows = (() => {
    const active = getStoredData('sof_savings_by_month', {}) || {};
    const deposit = getStoredData('sof_deposit_by_month', {}) || {};
    const out: any[] = [];
    memberMonths.forEach((m, i) => {
      const a = Array.isArray(active[m]) ? active[m].find((x: any) => codeOf(x) === memberCode) : null;
      const d = (!a && Array.isArray(deposit[m])) ? deposit[m].find((x: any) => codeOf(x) === memberCode) : null;
      const r = a || d;
      if (r) out.push({ seq: String(i + 1).padStart(2, '0'), mi: i, monthName: m.split(' ')[0], ...r });
    });
    return out;
  })();
  const memberSavingSum = (f: string) => memberSavingRows.reduce((s, r) => s + num(r[f]), 0);
  const memberSavingClosing = memberSavingRows.length ? num(memberSavingRows[memberSavingRows.length - 1].total) : 0;
  // Loan-report rows: this member's monthly loan progression (active or deposit-member loans).
  const memberLoanRows = (() => {
    const a = getStoredData('sof_loans_by_month', {}) || {};
    const d = getStoredData('sof_loans_deposit_by_month', {}) || {};
    const out: any[] = [];
    memberMonths.forEach((m, i) => {
      const ra = Array.isArray(a[m]) ? a[m].find((x: any) => codeOf(x) === memberCode) : null;
      const rd = (!ra && Array.isArray(d[m])) ? d[m].find((x: any) => codeOf(x) === memberCode) : null;
      const r = ra || rd;
      if (r && (num(r.loanValue) || num(r.remaining) || num(r.newLoan) || num(r.repayment) || num(r.interest))) {
        out.push({ seq: String(i + 1).padStart(2, '0'), mi: i, monthName: m.split(' ')[0], ...r });
      }
    });
    return out;
  })();
  const memberLoanSum = (f: string) => memberLoanRows.reduce((s, r) => s + num(r[f]), 0);
  // Loan-info-card figures. Start = first month the loan was disbursed (else first activity).
  const loanStartRow = memberLoanRows.find((r) => num(r.newLoan) > 0) || memberLoanRows[0] || null;
  const loanStartMonthName = loanStartRow ? loanStartRow.monthName : '-';
  const loanLastIdx = memberLoanRows.length ? memberLoanRows[memberLoanRows.length - 1].mi : 0;
  const loanTermMonths = loanStartRow ? (loanLastIdx - loanStartRow.mi + 1) : 0;   // months from loan start → now
  const loanPrincipalRepaid = memberLoanSum('repayment');
  const loanInterestPaid = memberLoanSum('interestPaid');
  const loanTotalPaid = loanPrincipalRepaid + loanInterestPaid;
  // Rate for the info card = same as the table (entered rate, else interest ÷ beginning).
  const loanRatePct = (() => {
    const withRate = memberLoanRows.find((r) => num(r.rate));
    if (withRate) return num(withRate.rate);
    const withCalc = memberLoanRows.find((r) => num(r.loanValue) && num(r.interest));
    return withCalc ? num(withCalc.interest) / num(withCalc.loanValue) * 100 : 0;
  })();
  // Monthly summary report = the chosen month, or the latest month with savings/loan data.
  const KHMER_MONTHS = ['មករា', 'កុម្ភៈ', 'មីនា', 'មេសា', 'ឧសភា', 'មិថុនា', 'កក្កដា', 'សីហា', 'កញ្ញា', 'តុលា', 'វិច្ឆិកា', 'ធ្នូ'];
  const summaryIdxAuto = Math.max(
    memberSavingRows.length ? memberSavingRows[memberSavingRows.length - 1].mi : -1,
    memberLoanRows.length ? memberLoanRows[memberLoanRows.length - 1].mi : -1,
  );
  const summaryIdx = summaryMonth ? KHMER_MONTHS.indexOf(summaryMonth) : summaryIdxAuto;
  const sumS: any = memberSavingRows.find((r) => r.mi === summaryIdx) || {};
  const sumL: any = memberLoanRows.find((r) => r.mi === summaryIdx) || {};
  const summaryMonthName = summaryIdx >= 0 ? KHMER_MONTHS[summaryIdx] : '';
  // Auto date = last day of the selected month (ចុងខែ).
  const summaryLastDay = summaryIdx >= 0 ? new Date(Number(selectedReportYear), summaryIdx + 1, 0).getDate() : '';
  const fm = (v: number) => (v ? fmtMoney(v) : '-');

  return (
    <PageView
      title={activeTab === 'dashboard' ? "ព័ត៌មានផ្ទាល់ខ្លួន" : activeTab}
      hideAdd
      hideUpload
      hideDownload={activeTab !== 'របាយការណ៍ផ្ទាល់ខ្លួន'}
      downloadLabel="ទាញយក PDF"
      onDownloadClick={() => window.print()}
      hideBack={true}
    >
      {activeTab === 'dashboard' ? (
        <div className="space-y-6">
          {/* Profile overview header card */}
          <div className="bg-gradient-to-br from-[#0a6652] to-[#128a6f] rounded-[28px] p-5 text-white shadow-lg relative overflow-hidden text-left">
            <div className="absolute -right-16 -bottom-16 w-48 h-48 bg-white/10 rounded-full" />
            <div className="absolute -left-10 -top-10 w-32 h-32 bg-white/5 rounded-full" />
            
            <div className="relative z-10 flex items-center gap-3">
              <div className="w-12 h-12 bg-white/20 rounded-full flex items-center justify-center font-black text-base border border-white/30 shadow-sm shrink-0">
                {memberInitials}
              </div>
              <div>
                <p className="text-[9px] text-emerald-200 font-extrabold tracking-wider uppercase leading-none mb-1">ស្វាគមន៍សមាជិក</p>
                <h3 className="text-base font-bold tracking-tight leading-none mb-1.5">{memberName}</h3>
                <div className="flex flex-wrap gap-1">
                  <span className="bg-white/15 px-1.5 py-0.5 rounded-full text-[8px] font-bold">ID: {memberCode}</span>
                  <span className="bg-emerald-900/40 px-1.5 py-0.5 rounded-full text-[8px] font-bold">សកម្មភាពជានិច្ច</span>
                </div>
              </div>
            </div>

            <div className="relative z-10 mt-5 pt-4 border-t border-white/10 grid grid-cols-3 gap-1 divide-x divide-white/10 text-center">
              <div className="px-1 text-left">
                <span className="text-[9px] text-emerald-200/90 font-bold block leading-tight">ប្រាក់សន្សំសរុប</span>
                <p className="text-sm font-black mt-1 tracking-tight">$ {fmtMoney(memberSavingsTotal)}</p>
              </div>
              <div className="px-1 text-left pl-2">
                <span className="text-[9px] text-emerald-200/90 font-bold block leading-tight">កម្ចីសរុប</span>
                <p className="text-sm font-black mt-1 tracking-tight">$ {fmtMoney(memberLoanTotal)}</p>
              </div>
              <div className="px-1 text-left pl-2">
                <span className="text-[9px] text-emerald-200/90 font-bold block leading-tight">តុល្យការដើមទុន</span>
                <p className="text-sm font-black mt-1 tracking-tight">$ {fmtMoney(memberSavingsTotal - memberLoanTotal)}</p>
              </div>
            </div>
          </div>

          {/* Bento grid style buttons like Admin */}
          <div>
            <h4 className="text-xs font-black text-slate-400 mb-3 tracking-wider text-left uppercase">សេវាកម្មសមាជិក</h4>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3.5">
              {[
                {
                  id: 'របាយការណ៍ផ្ទាល់ខ្លួន',
                  title: "របាយការណ៍សង្ខេប",
                  desc: "ពិនិត្យរបាយការណ៍សង្ខេប",
                  icon1: <FileText size={16} strokeWidth={2.5} />,
                  icon1Class: "bg-teal-50 text-teal-600",
                  icon2: <UserCheck size={28} strokeWidth={1.5} />,
                  icon2Class: "text-[#0a6652] fill-teal-100/40"
                },
                {
                  id: 'របាយការណ៍សន្សំ',
                  title: "របាយការណ៍សន្សំ",
                  desc: "ប្រវត្តិដាក់ និងការចាក់ចំណេញ",
                  icon1: <TrendingUp size={16} strokeWidth={2.5} />,
                  icon1Class: "bg-blue-50 text-blue-600",
                  icon2: <Wallet size={28} strokeWidth={1.5} />,
                  icon2Class: "text-blue-500 fill-blue-100/40"
                },
                {
                  id: 'របាយការណ៍កម្ចី',
                  title: "របាយការណ៍កម្ចី",
                  desc: "កិច្ចសន្យា និងគម្រោងសង",
                  icon1: <BarChart3 size={16} strokeWidth={2.5} />,
                  icon1Class: "bg-orange-50 text-orange-600",
                  icon2: <Calendar size={28} strokeWidth={1.5} />,
                  icon2Class: "text-orange-500 fill-orange-100/40"
                },
                {
                  id: 'ស្នើកម្ចី',
                  title: "ទម្រង់ស្នើសុំកម្ចី",
                  desc: "ស្នើប្រាក់កម្ចីថ្មីលឿនៗ",
                  icon1: <Receipt size={16} strokeWidth={2.5} />,
                  icon1Class: "bg-purple-50 text-purple-600",
                  icon2: <HandCoins size={28} strokeWidth={1.5} />,
                  icon2Class: "text-purple-600 fill-purple-100/40"
                },
                {
                  id: 'ការដាក់សន្សំ និងបង់កម្ចី',
                  title: "ការដាក់សន្សំ និងបង់កម្ចី",
                  desc: "ផ្ញើប្រាក់សន្សំ និងបង់កម្ចី",
                  icon1: <Plus size={16} strokeWidth={2.5} />,
                  icon1Class: "bg-rose-50 text-rose-500",
                  icon2: <Sparkles size={28} strokeWidth={1.5} />,
                  icon2Class: "text-amber-500 fill-amber-100/40"
                }
              ].map((card, i) => (
                <div
                  key={i}
                  onClick={() => setActiveTab(card.id)}
                  className="group relative overflow-hidden bg-white rounded-[24px] p-4 shadow-[0_4px_15px_rgba(0,100,50,0.03)] min-h-[134px] flex flex-col justify-between cursor-pointer hover:shadow-[0_10px_30px_rgba(0,100,50,0.08)] hover:-translate-y-0.5 active:scale-[0.98] transition-all duration-300 border border-slate-100 hover:border-emerald-200 text-left"
                >
                  {/* faded decorative watermark */}
                  <div className={`absolute -right-3 -bottom-3 opacity-[0.08] group-hover:opacity-[0.14] transition-opacity duration-300 ${card.icon2Class}`}>
                    {React.cloneElement(card.icon2, { size: 76, strokeWidth: 1.5 })}
                  </div>
                  <div className="relative z-10 flex items-center justify-between">
                    <div className={`w-9 h-9 rounded-2xl flex items-center justify-center ${card.icon1Class}`}>
                      {card.icon1}
                    </div>
                    <ChevronLeft size={16} className="rotate-180 text-slate-300 group-hover:text-emerald-500 group-hover:translate-x-0.5 transition-all duration-300" />
                  </div>
                  <div className="relative z-10">
                    <h3 className="text-sm font-black text-[#0a6652] tracking-tight leading-tight">
                      {card.title}
                    </h3>
                    <p className="text-[11px] text-slate-400 font-bold mt-1 leading-tight">
                      {card.desc}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Action Footer */}
          <div className="pt-6 border-t border-slate-100 flex flex-col sm:flex-row gap-3">
             <button 
               onClick={() => setShowChangePassword(true)} 
               className="flex-1 bg-slate-50 hover:bg-slate-100 active:scale-95 transition-all py-3 px-4 rounded-2xl font-bold text-xs flex items-center justify-center gap-2 text-slate-700 border border-slate-200/60 shadow-sm"
             >
               <Key size={14} className="text-slate-500" /> <span>ផ្លាស់ប្តូរកូដសម្ងាត់</span>
             </button>
             <button 
               onClick={() => {
                 localStorage.removeItem('userRole');
                 localStorage.removeItem('memberId');
                 window.location.href = '/login';
               }} 
               className="flex-1 bg-rose-50 hover:bg-rose-100 active:scale-95 transition-all py-3 px-4 rounded-2xl font-bold text-xs flex items-center justify-center gap-2 text-rose-600 border border-rose-100 shadow-sm"
             >
               <LogIn size={14} className="rotate-180" /> <span>ចាកចេញពីគណនី</span>
             </button>
          </div>
        </div>
      ) : (
        <div>
          {/* Active Detail Header Navigation */}
          <div className="mb-4 flex items-center justify-between bg-slate-150/60 p-2 rounded-xl">
            <button 
              onClick={() => setActiveTab('dashboard')} 
              className="flex items-center gap-1.5 text-[#0a6652] hover:text-[#084f40] font-black text-xs transition-colors"
            >
              <ChevronLeft size={16} strokeWidth={2.5} /> ត្រឡប់ក្រោយ
            </button>
          </div>

      {showChangePassword && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex justify-center items-center p-4">
          <div className="bg-white rounded-3xl p-6 md:p-8 w-full max-w-md shadow-2xl relative">
            <button 
              onClick={() => setShowChangePassword(false)}
              className="absolute right-6 top-6 text-slate-400 hover:text-slate-700 bg-slate-100 hover:bg-slate-200 p-2 rounded-full transition-colors"
            >
              <X size={20} />
            </button>
            <div className="mb-8 pr-10">
              <h3 className="text-xl font-bold text-slate-800 flex items-center gap-2 mb-2">
                <Key className="text-indigo-600" size={24} /> ប្តូរពាក្យសម្ងាត់
              </h3>
              <p className="text-slate-500 text-sm">សូមបញ្ចូលពាក្យសម្ងាត់បច្ចុប្បន្ន និងពាក្យសម្ងាត់ថ្មីរបស់អ្នក។</p>
            </div>

            <form onSubmit={handleChangePassword} className="space-y-4">
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-2">ពាក្យសម្ងាត់បច្ចុប្បន្ន</label>
                <div className="relative">
                  <input 
                    type={showCurrentPassword ? "text" : "password"} 
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    className="w-full px-4 py-3 rounded-xl bg-slate-50 border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:border-transparent text-slate-800"
                    required
                  />
                  <button 
                    type="button"
                    onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    {showCurrentPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>
              
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-2">ពាក្យសម្ងាត់ថ្មី</label>
                <div className="relative">
                  <input 
                    type={showNewPassword ? "text" : "password"} 
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="w-full px-4 py-3 rounded-xl bg-slate-50 border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:border-transparent text-slate-800"
                    required
                  />
                  <button 
                    type="button"
                    onClick={() => setShowNewPassword(!showNewPassword)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    {showNewPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-sm font-bold text-slate-700 mb-2">បញ្ជាក់ពាក្យសម្ងាត់ថ្មី</label>
                <input 
                  type={showNewPassword ? "text" : "password"} 
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl bg-slate-50 border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:border-transparent text-slate-800"
                  required
                />
              </div>

              <div className="pt-4 flex gap-3">
                <button 
                  type="button" 
                  onClick={() => setShowChangePassword(false)}
                  className="flex-1 py-3 px-4 bg-slate-100 text-slate-700 font-bold rounded-xl hover:bg-slate-200 transition-colors"
                >
                  បោះបង់
                </button>
                <button 
                  type="submit" 
                  className="flex-1 py-3 px-4 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 transition-colors flex items-center justify-center gap-2 shadow-lg shadow-indigo-600/20"
                >
                  <Save size={18} /> រក្សាទុក
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showDigitalForm && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex justify-center items-center p-4">
          <div className="bg-white rounded-3xl p-6 md:p-8 w-full max-w-md shadow-2xl relative animate-in zoom-in-95 duration-200">
            <button 
              onClick={() => setShowDigitalForm(false)}
              className="absolute right-6 top-6 text-slate-400 hover:text-slate-700 bg-slate-100 hover:bg-slate-200 p-2 rounded-full transition-colors"
            >
              <X size={20} />
            </button>
            <div className="mb-6 pr-10">
              <h3 className="text-xl font-bold text-[#0a6652] flex items-center gap-2 mb-2">
                <Receipt className="text-[#0a6652]" size={24} /> បំពេញពាក្យស្នើសុំកម្ចី
              </h3>
              <p className="text-slate-500 text-xs font-medium leading-relaxed">សូមបំពេញព័ត៌មានលម្អិតខាងក្រោមដើម្បីបង្កើត និងផ្ញើសំណើសុំប្រាក់កម្ចីឌីជីថលរបស់អ្នក។</p>
            </div>

            <form onSubmit={(e) => {
              e.preventDefault();
              if (!digitalAmount || Number(digitalAmount) <= 0) {
                alert("សូមបញ្ចូលចំនួនទឹកប្រាក់កម្ចីឲ្យត្រឹមត្រូវ!");
                return;
              }
              const sizeStr = "12.5 KB";
              const dateStr = "ថ្ងៃទី " + new Date().getDate() + " ខែ" + (new Date().getMonth() + 1) + " ឆ្នាំ " + new Date().getFullYear();
              const fileName = `លិខិតស្នើសុំកម្ចី_ឌីជីថល_$${Number(digitalAmount).toLocaleString()}USD.xlsx`;
              
              setLoanFiles([...loanFiles, {
                name: fileName,
                size: sizeStr,
                type: 'xlsx',
                date: dateStr
              }]);
              
              setShowDigitalForm(false);
              setDigitalAmount('');
              setDigitalPurpose('');
              alert("ទិន្នន័យត្រូវបានរក្សាទុក និងបង្កើតជាឯកសារពាក្យស្នើសុំឌីជីថលជោគជ័យ! សូមពិនិត្យបញ្ជីឯកសារ និងចុចផ្ញើពាក្យស្នើសុំ។");
            }} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5 uppercase tracking-wider">ចំនួនទឹកប្រាក់ស្នើសុំ (USD)</label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-sm">$</span>
                  <input 
                    type="number" 
                    value={digitalAmount}
                    onChange={(e) => setDigitalAmount(e.target.value)}
                    placeholder="ឧទាហរណ៍: 500" 
                    className="w-full pl-8 pr-4 py-3 rounded-xl bg-slate-50 border border-slate-200 focus:outline-none focus:ring-2 focus:ring-[#0a6652] focus:border-transparent text-slate-800 text-sm font-bold"
                    required
                  />
                </div>
              </div>
              
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5 uppercase tracking-wider">រយៈពេលសងត្រឡប់ (ខែ)</label>
                <select 
                  value={digitalTerm}
                  onChange={(e) => setDigitalTerm(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl bg-slate-50 border border-slate-200 focus:outline-none focus:ring-2 focus:ring-[#0a6652] focus:border-transparent text-slate-800 text-sm font-bold"
                >
                  <option value="6">6 ខែ (6 Months)</option>
                  <option value="12">12 ខែ (12 Months)</option>
                  <option value="18">18 ខែ (18 Months)</option>
                  <option value="24">24 ខែ (24 Months)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5 uppercase tracking-wider">លេខទូរស័ព្ទសមាជិក</label>
                <input 
                  type="text" 
                  value={digitalPhone}
                  onChange={(e) => setDigitalPhone(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl bg-slate-50 border border-slate-200 focus:outline-none focus:ring-2 focus:ring-[#0a6652] focus:border-transparent text-slate-800 text-sm font-semibold"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5 uppercase tracking-wider">គោលបំណងនៃការខ្ចីប្រាក់</label>
                <textarea 
                  value={digitalPurpose}
                  onChange={(e) => setDigitalPurpose(e.target.value)}
                  placeholder="រៀបរាប់ពីគោលបំណង ឧទាហរណ៍៖ ទិញជីកសិកម្ម ឬពង្រីករបរលក់ដូរ..."
                  className="w-full px-4 py-3 rounded-xl bg-slate-50 border border-slate-200 focus:outline-none focus:ring-2 focus:ring-[#0a6652] focus:border-transparent text-slate-800 text-xs font-medium min-h-[80px]"
                  required
                />
              </div>

              <div className="pt-4 flex gap-3">
                <button 
                  type="button" 
                  onClick={() => setShowDigitalForm(false)}
                  className="flex-1 py-3 px-4 bg-slate-100 text-slate-700 font-bold rounded-xl text-xs hover:bg-slate-200 transition-colors"
                >
                  បោះបង់
                </button>
                <button 
                  type="submit" 
                  className="flex-1 py-3 px-4 bg-[#0a6652] text-white font-bold rounded-xl text-xs hover:bg-[#085241] transition-all flex items-center justify-center gap-1.5 shadow-lg shadow-emerald-900/10"
                >
                  <Save size={14} /> រក្សាទុកសំណើ
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {activeTab === 'របាយការណ៍ផ្ទាល់ខ្លួន' && (
        <div className="max-w-3xl mx-auto bg-white p-6 md:p-12 rounded-[32px] shadow-[0_8px_30px_rgba(0,0,0,0.04)] border border-slate-100 relative overflow-hidden">
        
        {/* Background Watermark */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 border-8 border-slate-50 text-slate-50 rounded-full flex items-center justify-center font-black text-6xl pointer-events-none -rotate-12">
          SOF
        </div>

        <div className="flex flex-col md:flex-row justify-between items-center border-b-[3px] border-blue-50 pb-8 mb-10 relative z-10 gap-6">
          <div className="w-24 h-24 flex items-center justify-center shrink-0">
             <img src="https://i.ibb.co/Kp7CxnjC/Picture1.jpg" alt="SOF Logo" className="w-full h-full object-contain" />
          </div>
          <div className="text-center md:flex-1">
            <h2 className="text-xl md:text-2xl font-black tracking-tight text-blue-600 mb-2">ក្រុមសន្សំប្រាក់អនាគតយើង</h2>
            <h3 className="text-base md:text-lg font-bold text-blue-500 mb-2">SAVING FOR OUR FUTURE (SOF)</h3>
          </div>
          <div className="w-24 shrink-0 hidden md:block"></div> {/* Spacer for symmetry */}
        </div>

        <div className="relative z-10 text-center mb-12">
            <h3 className="inline-block text-xl md:text-2xl font-black text-blue-600 border-b-4 border-blue-600 pb-2 px-2">
            របាយការណ៍ប្រចាំខែ{summaryMonthName} {selectedReportYear}
            </h3>
            <div className="no-print flex items-center justify-center gap-1.5 mt-4">
              <span className="text-[10px] font-bold text-slate-400">ជ្រើសរើសខែ៖</span>
              <select
                value={summaryMonthName}
                onChange={(e) => setSummaryMonth(e.target.value)}
                className="text-[11px] font-extrabold bg-slate-50 border border-slate-200 rounded-full px-3 py-1 text-slate-700 outline-none cursor-pointer shadow-sm"
              >
                {KHMER_MONTHS.map((m) => (
                  <option key={m} value={m}>{m} {selectedReportYear}</option>
                ))}
              </select>
            </div>
        </div>

        <div className="relative z-10 grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-6 text-sm md:text-base font-bold text-slate-800">
          <div className="flex justify-between items-end border-b border-slate-100 pb-2">
            <span className="text-slate-500 font-medium">ឈ្មោះ:</span>
            <span className="text-lg">{memberName}</span>
          </div>
          <div className="flex justify-between items-end border-b border-slate-100 pb-2">
            <span className="text-slate-500 font-medium">លេខ ID:</span>
            <span className="text-lg">{memberCode}</span>
          </div>

          <div className="flex justify-between items-center py-1 mt-4">
            <span className="text-slate-500 font-medium">ទុនសន្សំសរុបដើមគ្រា:</span>
            <span className="text-emerald-700 bg-emerald-50 px-3 py-1 rounded-lg"><span className="text-emerald-600/50 mr-1">$</span> {fm(num(sumS.startCapital))}</span>
          </div>
          <div className="flex justify-between items-center py-1 mt-4">
            <span className="text-slate-500 font-medium">កម្ចីដើមគ្រា:</span>
            <span className="px-3 py-1"><span className="text-slate-300 mr-1">$</span> {fm(num(sumL.loanValue))}</span>
          </div>

          <div className="flex justify-between items-center py-1">
            <span className="text-slate-500 font-medium">សន្សំក្នុងខែ:</span>
            <span className="text-blue-600 bg-blue-50 px-3 py-1 rounded-lg"><span className="text-blue-600/50 mr-1">$</span> {fm(num(sumS.addSaving))}</span>
          </div>
          <div className="flex justify-between items-center py-1">
            <span className="text-slate-500 font-medium">សងត្រលប់:</span>
            <span className="text-amber-600 px-3 py-1"><span className="text-amber-600/50 mr-1">$</span> {fm(num(sumL.repayment))}</span>
          </div>

          <div className="flex justify-between items-center py-1">
            <span className="text-slate-500 font-medium">ប្រាក់ចំណេញ:</span>
            <span className="text-emerald-600 px-3 py-1"><span className="text-emerald-600/50 mr-1">$</span> {fm(num(sumS.profit))}</span>
          </div>
          <div className="flex justify-between items-center py-1">
            <span className="text-slate-500 font-medium">ការប្រាក់កម្ចី:</span>
            <span className="text-amber-600 px-3 py-1"><span className="text-amber-600/50 mr-1">$</span> {fm(num(sumL.interest))}</span>
          </div>

          <div className="flex justify-between items-center py-1">
            <span className="text-slate-500 font-medium">ការដកដើមទុន:</span>
            <span className="text-rose-600 px-3 py-1"><span className="text-rose-600/50 mr-1">$</span> {fm(num(sumS.withdraw))}</span>
          </div>
          <div className="flex justify-between items-center py-1">
            <span className="text-slate-500 font-medium">កម្ចីថ្មីក្នុងខែ:</span>
            <span className="text-indigo-600 px-3 py-1"><span className="text-indigo-600/50 mr-1">$</span> {fm(num(sumL.newLoan))}</span>
          </div>

          <div className="flex justify-between items-center py-1 pt-6 border-t border-slate-100 mt-2 text-lg">
            <span className="text-slate-600 font-medium">ដើមទុនចុងគ្រា:</span>
            <span className="text-[#0a6652]"><span className="text-[#0a6652]/50 mr-1">$</span> {fm(num(sumS.total))}</span>
          </div>
          <div className="flex justify-between items-center py-1 pt-6 border-t border-slate-100 mt-2">
            <span className="text-slate-600 font-medium">កម្ចីនៅសល់:</span>
            <span className="text-slate-800"><span className="text-slate-400 mr-1">$</span> {fm(num(sumL.remaining))}</span>
          </div>

          <div className="flex justify-between items-center py-1 bg-amber-50 rounded-xl px-4 mt-2">
            <span className="text-slate-600 font-bold">ប្រាក់បានបង់:</span>
            <span className="text-amber-700 text-lg"><span className="text-amber-700/50 mr-1">$</span> {fm(num(sumS.addSaving) + num(sumL.repayment) + num(sumL.interestPaid))}</span>
          </div>
          <div className="flex justify-between items-center py-1 mt-2">
            <span className="text-slate-500 font-medium">សមាជិកភាព:</span>
            <span className="px-3 py-1"><span className="text-slate-300 mr-1">$</span> {fm(num(sumS.actualFee))}</span>
          </div>
        </div>

        <div className="mt-20 flex flex-col items-center md:items-end text-sm text-slate-800 relative z-10 md:pr-10">
          <p className="mb-3 font-medium text-slate-500">ធ្វើនៅ​ភ្នំពេញ ថ្ងៃទី {summaryLastDay} ខែ{summaryMonthName} ឆ្នាំ {selectedReportYear}</p>
          <p className="mb-4 font-bold text-slate-700">ហត្ថលេខាអ្នកធ្វើរបាយការណ៍</p>
          <div className="w-48 h-20 border-b-2 border-slate-200 border-dashed relative flex items-center justify-center">
            {sigImg
              ? <img src={sigImg} alt="signature" className="max-h-16 max-w-full object-contain" />
              : <span className="text-slate-300 text-[11px] no-print">មិនទាន់មានហត្ថលេខា</span>}
          </div>

          {/* Add-signature button — above the name (hidden when printing) */}
          <div className="no-print mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={() => sigFileRef.current?.click()}
              className="flex items-center gap-1.5 bg-[#0a6652] hover:bg-[#084f40] text-white font-bold text-xs px-4 py-1.5 rounded-lg cursor-pointer active:scale-95"
            >
              <Plus size={14} /> បន្ថែមហត្ថលេខា
            </button>
            {sigImg && (
              <button
                type="button"
                onClick={() => { setSigImg(''); saveSig('', sigName); }}
                className="text-xs font-bold text-rose-500 hover:text-rose-700 px-2 py-1.5 cursor-pointer"
              >
                លុប
              </button>
            )}
            <input type="file" ref={sigFileRef} accept="image/*" className="hidden" onChange={handleSigUpload} />
          </div>

          {/* Preparer name (shown once, on screen and print) */}
          {sigName && <p className="mt-3 font-bold text-slate-700">{sigName}</p>}
        </div>
      </div>
      )}

      {activeTab === 'ស្នើកម្ចី' && (
        <div className="max-w-3xl mx-auto bg-white p-6 md:p-8 rounded-[32px] border border-slate-100 shadow-[0_8px_30px_rgba(0,0,0,0.04)] text-left">
           <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 pb-4 border-b border-green-50/60">
             <div className="flex items-center gap-3">
               <div className="w-12 h-12 bg-emerald-50 text-emerald-600 rounded-xl flex items-center justify-center shrink-0">
                 <Receipt size={24} />
               </div>
               <div>
                 <h3 className="text-lg font-bold text-slate-800">ទម្រង់ស្នើកម្ចី</h3>
                 <p className="text-xs text-slate-500">បង្ហោះពាក្យស្នើសុំ ឬ បំពេញសំណើកម្ចីអនឡាញ</p>
               </div>
             </div>
             <button 
               onClick={() => setShowDigitalForm(true)}
               className="bg-[#0a6652] hover:bg-[#085241] text-white font-bold text-xs py-2.5 px-4 rounded-xl active:scale-95 transition-all shadow-md shadow-emerald-900/10 flex items-center justify-center gap-1.5 self-start sm:self-auto shrink-0"
             >
               <FileText size={14} /> <span>បំពេញសំណើកម្ចីឥឡូវនេះ</span>
             </button>
           </div>

           {/* Promotional Digital Form Option Card */}
           <div className="bg-emerald-50/30 border border-emerald-100/70 rounded-2xl p-4 mb-6 flex items-start gap-4 animate-in fade-in duration-300">
             <div className="w-9 h-9 bg-[#0a6652]/15 rounded-xl flex items-center justify-center text-[#0a6652] shrink-0 mt-0.5">
               <FileText size={16} />
             </div>
             <div className="flex-1">
               <h4 className="text-xs font-bold text-[#0a6652] mb-1">ស្វែងយល់ពីលក្ខណៈងាយស្រួលនៃការស្នើកម្ចីអនឡាញ</h4>
               <p className="text-[11px] text-slate-500 leading-relaxed mb-2">អ្នកអាចបំពេញតម្រូវការប្រាក់កម្ចីសន្សំ សរសេរអំពីគោលបំណង និងរយៈពេលសងត្រឡប់ ដើម្បីបង្កើតជាឯកសារសំណើផ្លូវការភ្លាមៗ។</p>
               <button
                 type="button"
                 onClick={() => setShowDigitalForm(true)}
                 className="text-[#0a6652] hover:text-[#085241] font-extrabold text-[11px] flex items-center gap-1 transition-colors hover:underline"
               >
                 👉 បំពេញសំណើកម្ចីឥឡូវនេះ
               </button>
             </div>
           </div>

           {/* Drag and Drop Zone */}
           <div 
             onDragOver={(e) => {
               e.preventDefault();
               setIsDragging(true);
             }}
             onDragLeave={() => setIsDragging(false)}
             onDrop={(e) => {
               e.preventDefault();
               setIsDragging(false);
               handleFileUpload(e.dataTransfer.files);
             }}
             onClick={() => document.getElementById('loan-file-input')?.click()}
             className={`border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all duration-200 ${
               isDragging 
                 ? 'border-[#0a6652] bg-emerald-50/50' 
                 : 'border-slate-200 hover:border-[#0a6652] hover:bg-slate-50/30'
             }`}
           >
             <input 
               id="loan-file-input"
               type="file" 
               className="hidden" 
               multiple
               accept="image/*,.doc,.docx,.xls,.xlsx"
               onChange={(e) => handleFileUpload(e.target.files)}
             />
             <div className="w-12 h-12 bg-slate-50 text-slate-400 rounded-full flex items-center justify-center mx-auto mb-4 border border-slate-100 shadow-sm">
               <Upload size={20} className="text-[#0a6652]" />
             </div>
             <p className="text-sm font-bold text-slate-700 mb-1">
               ជ្រើសរើសឯកសារ ឬ ទាញទម្លាក់ចូលទីនេះ
             </p>
             <p className="text-xs text-slate-400 mb-4 font-medium">
               គាំទ្រឯកសារ៖ រូបភាព (PNG, JPG), Word (.doc, .docx) ឬ Excel (.xls, .xlsx)
             </p>
             <button 
               type="button" 
               className="bg-[#0a6652] text-white font-bold text-xs py-2.5 px-4 rounded-xl hover:bg-[#085241] active:scale-95 transition-all shadow-md shadow-emerald-900/10 inline-flex items-center gap-1.5"
             >
               <Upload size={14} /> <span>ជ្រើសរើសឯកសារបង្ហោះ</span>
             </button>
           </div>

           {/* Listing uploaded files */}
           {loanFiles.length > 0 ? (
             <div className="mt-6 space-y-3">
               <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">ឯកសារបានបង្ហោះ ({loanFiles.length})</h4>
               <div className="space-y-2">
                 {loanFiles.map((file, idx) => {
                   // Determine icon color based on type
                   let iconBgColor = 'bg-blue-50 text-blue-600';
                   if (['xls', 'xlsx'].includes(file.type)) {
                     iconBgColor = 'bg-emerald-50 text-emerald-600';
                   } else if (['doc', 'docx'].includes(file.type)) {
                     iconBgColor = 'bg-[#4f46e5]/10 text-indigo-600';
                   } else if (['jpg', 'jpeg', 'png', 'webp'].includes(file.type)) {
                     iconBgColor = 'bg-amber-50 text-amber-600';
                   }

                   return (
                     <div key={idx} className="flex items-center justify-between p-3 bg-slate-50/50 rounded-xl border border-slate-100 animate-in fade-in slide-in-from-bottom-2 duration-200">
                       <div className="flex items-center gap-3 min-w-0">
                         <div className={`w-10 h-10 ${iconBgColor} rounded-lg flex items-center justify-center shrink-0`}>
                           <FileText size={18} />
                         </div>
                         <div className="min-w-0">
                           <p className="text-xs font-bold text-slate-700 truncate">{file.name}</p>
                           <p className="text-[10px] text-slate-400 font-semibold mt-0.5">{file.size} • {file.date}</p>
                         </div>
                       </div>
                       <button 
                         onClick={(e) => {
                           e.stopPropagation();
                           removeLoanFile(idx);
                         }}
                         className="w-7 h-7 bg-white text-slate-400 hover:text-red-500 rounded-lg flex items-center justify-center border border-slate-100 hover:border-red-100 transition-colors shrink-0"
                         title="លុបឯកសារ"
                       >
                         <X size={14} />
                       </button>
                     </div>
                   );
                 })}
               </div>

               <div className="pt-4 border-t border-slate-100 flex justify-end animate-in fade-in duration-200">
                 <button 
                   onClick={() => {
                     alert("ពាក្យស្នើសុំកម្ចីរបស់អ្នកត្រូវបានផ្ញើជូនគណៈកម្មការពិនិត្យរួចរាល់ហើយ!");
                     setLoanFiles([]);
                   }}
                   className="bg-[#0a6652] text-white font-bold text-xs py-3 px-6 rounded-xl hover:bg-[#085241] active:scale-95 transition-all shadow-md shadow-emerald-900/10 inline-flex items-center gap-2"
                 >
                   <span>ផ្ញើពាក្យស្នើសុំកម្ចី</span>
                 </button>
               </div>
             </div>
           ) : (
             <div className="mt-6 p-4 rounded-xl bg-orange-50/30 border border-orange-100 text-center animate-in fade-in duration-200">
               <p className="text-xs text-orange-600 font-bold">⚠️ មិនទាន់មានឯកសារពាក្យស្នើសុំណាមួយត្រូវបានបង្ហោះឡើយ។</p>
             </div>
           )}
        </div>
      )}

      {activeTab === 'របាយការណ៍កម្ចី' && (
        <div className="max-w-4xl mx-auto space-y-6">
          {/* High Fidelity Loan Contract Sheet Display */}
          <div className="bg-white p-6 sm:p-10 rounded-[32px] border border-slate-100 shadow-[0_8px_30px_rgba(0,0,0,0.04)] text-left relative overflow-hidden print:p-0 print:border-none print:shadow-none">
            
            {/* Download/Print Button */}
            <div className="absolute right-6 top-6 no-print z-10">
              <button
                type="button"
                onClick={() => window.print()}
                className="bg-[#0a6652] hover:bg-[#085241] text-white font-bold text-xs py-2 px-4 rounded-xl flex items-center gap-1.5 shadow-md shadow-emerald-900/10 transition-all active:scale-95 duration-200"
              >
                <Download size={14} /> <span>បោះពុម្ភ ឬទាញយកជា PDF</span>
              </button>
            </div>

            {/* Watermark Logo */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-[0.015]">
              <img src="https://i.ibb.co/Kp7CxnjC/Picture1.jpg" alt="" className="w-96 h-96 object-contain" referrerPolicy="no-referrer" />
            </div>

            {/* Header section with brand details (same style as the savings report) */}
            <div className="text-center mb-6 relative">
              <div className="flex flex-col items-center justify-center gap-2 mb-4">
                <div className="w-14 h-14 border border-slate-200 rounded-2xl p-0.5 bg-slate-50 flex items-center justify-center shadow-sm">
                  <img src="https://i.ibb.co/Kp7CxnjC/Picture1.jpg" alt="Logo" className="w-full h-full object-contain" referrerPolicy="no-referrer" />
                </div>
                <div>
                  <h3 className="text-xs font-bold text-[#ecb22e] uppercase tracking-wide leading-tight">ក្រុមសន្សំប្រាក់អនាគតយើង</h3>
                  <p className="text-[9px] text-[#0a6652] font-black tracking-widest uppercase">Saving For Our Future</p>
                </div>
              </div>

              <h1 className="text-lg font-extrabold text-slate-800 tracking-wide mb-1 flex items-center justify-center gap-2">
                <span className="text-[#0a6652]">របាយការណ៍កម្ចីសមាជិក</span>
              </h1>

              <div className="flex items-center justify-center gap-3 mt-2 flex-wrap">
                <span className="text-xs font-bold text-[#0a6652] bg-[#eef8f2] px-4 py-1.5 rounded-full shadow-sm">
                  សម្រាប់ឆ្នាំ{selectedReportYear}
                </span>
                <div className="no-print flex items-center gap-1 bg-slate-50 border border-slate-200 rounded-full px-2.5 py-1 shadow-sm">
                  <span className="text-[10px] font-bold text-slate-400">ជ្រើសរើសឆ្នាំ៖</span>
                  <select
                    value={selectedReportYear}
                    onChange={(e) => setSelectedReportYear(e.target.value)}
                    className="text-[11px] font-extrabold bg-transparent text-slate-700 outline-none cursor-pointer py-0.5"
                  >
                    <option value="2025">2025</option>
                    <option value="2026">2026</option>
                    <option value="2027">2027</option>
                    <option value="2028">2028</option>
                  </select>
                </div>
              </div>

              <p className="text-[10px] text-slate-400 font-medium mt-3">យោងលើកិច្ចសន្យាលេខៈ <span className="font-bold text-slate-700 underline">{contractNum}</span></p>
            </div>

            {/* Document title */}
            <div className="text-center mb-6">
              <span className="px-5 py-1 bg-slate-50 border border-slate-200 rounded-full text-xs font-bold text-slate-800 tracking-wider">
                ព័ត៌មានកម្ចី (Loan Information)
              </span>
            </div>

            {/* Loan parameters grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4 mb-8">
              {/* Left Column Parameters */}
              <div className="border border-slate-200 rounded-2xl p-4 bg-slate-50/50 space-y-2.5">
                <div className="flex justify-between items-center text-xs pb-1.5 border-b border-dashed border-slate-200/80">
                  <span className="text-slate-500 font-bold">ទំហំកម្ចី (Loan Size)</span>
                  <span className="font-black text-[#0a6652]">${(parseFloat(repLoanAmt) || 0).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>
                </div>
                <div className="flex justify-between items-center text-xs pb-1.5 border-b border-dashed border-slate-200/80">
                  <span className="text-slate-500 font-semibold">រយៈពេលនៃកម្ចី</span>
                  <span className="font-bold text-slate-700">{loanTermMonths} ខែ</span>
                </div>
                <div className="flex justify-between items-center text-xs pb-1.5 border-b border-dashed border-slate-200/80">
                  <span className="text-slate-500 font-semibold">អត្រាការប្រាក់</span>
                  <span className="font-bold text-slate-700">{(loanRatePct || DEFAULT_RATES.loan * 100).toFixed(2)}% / ខែ</span>
                </div>
                <div className="flex justify-between items-center text-xs pb-1.5 border-b border-dashed border-slate-200/80">
                  <span className="text-slate-500 font-semibold">ទឹកប្រាក់បង់រំលស់សរុប</span>
                  <span className="font-bold text-slate-700">${fmtMoney(loanPrincipalRepaid)}</span>
                </div>
                <div className="flex justify-between items-center text-xs pb-1.5 border-b border-dashed border-slate-200/80">
                  <span className="text-slate-500 font-semibold">ការប្រាក់បានបង់</span>
                  <span className="font-bold text-[#0a6652]">${fmtMoney(loanInterestPaid)}</span>
                </div>
                <div className="flex justify-between items-center text-xs pb-1.5 border-b border-dashed border-slate-200/80">
                  <span className="text-slate-500 font-semibold">ទឹកប្រាក់បានបង់សរុប</span>
                  <span className="font-black text-[#0a6652]">${fmtMoney(loanTotalPaid)}</span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-slate-500 font-semibold">ខែទទួលកម្ចី</span>
                  <span className="font-bold text-slate-700">{loanStartMonthName} {selectedReportYear}</span>
                </div>
              </div>

              {/* Right Column Parameters - Client / Guarantor details */}
              <div className="border border-slate-200 rounded-2xl p-4 bg-slate-50/50 space-y-2.5">
                <div className="flex justify-between items-center text-xs pb-1.5 border-b border-dashed border-slate-200/80">
                  <span className="text-slate-500 font-semibold">ឈ្មោះអ្នកទទួលកម្ចី</span>
                  <input
                    type="text"
                    value={repBorrower}
                    onChange={(e) => setRepBorrower(e.target.value)}
                    className="font-bold text-slate-800 text-right bg-transparent focus:underline hover:bg-white/50 px-1 py-0.5 rounded focus:outline-none w-32 border-none"
                  />
                </div>
                <div className="flex justify-between items-center text-xs pb-1.5 border-b border-dashed border-slate-200/80">
                  <span className="text-slate-500 font-semibold border-b border-transparent">លេខ ID សមាជិក</span>
                  <input
                    type="text"
                    value={repBorrowerId}
                    onChange={(e) => setRepBorrowerId(e.target.value)}
                    className="font-bold text-slate-700 text-right bg-transparent focus:underline hover:bg-white/50 px-1 py-0.5 rounded focus:outline-none w-20 border-none"
                  />
                </div>
                <div className="flex justify-between items-center text-xs pb-1.5 border-b border-dashed border-slate-200/80">
                  <span className="text-slate-500 font-semibold">លេខទូរស័ព្ទ</span>
                  <input
                    type="text"
                    value={repPhone}
                    onChange={(e) => setRepPhone(e.target.value)}
                    className="font-bold text-slate-700 text-right bg-transparent focus:underline hover:bg-white/50 px-1 py-0.5 rounded focus:outline-none w-32 border-none"
                  />
                </div>
                <div className="flex justify-between items-center text-xs pb-1.5 border-b border-dashed border-slate-200/80">
                  <span className="text-slate-500 font-semibold">អ្នកធានាទី 1 (Guarantor 1)</span>
                  <input
                    type="text"
                    value={repGuarantor1}
                    onChange={(e) => setRepGuarantor1(e.target.value)}
                    className="font-bold text-slate-700 text-right bg-transparent focus:underline hover:bg-white/50 px-1 py-0.5 rounded focus:outline-none w-32 border-none"
                  />
                </div>
                <div className="flex justify-between items-center text-xs pb-1.5 border-b border-dashed border-slate-200/80">
                  <span className="text-slate-500 font-semibold">លេខ ID ធានាទី 1</span>
                  <input
                    type="text"
                    value={repGuarantor1Id}
                    onChange={(e) => setRepGuarantor1Id(e.target.value)}
                    className="font-bold text-slate-700 text-right bg-transparent focus:underline hover:bg-white/50 px-1 py-0.5 rounded focus:outline-none w-20 border-none"
                  />
                </div>
                <div className="flex justify-between items-center text-xs pb-1.5 border-b border-dashed border-slate-200/80">
                  <span className="text-slate-500 font-semibold">អ្នកធានាទី 2 (Guarantor 2)</span>
                  <input
                    type="text"
                    value={repGuarantor2}
                    onChange={(e) => setRepGuarantor2(e.target.value)}
                    className="font-bold text-slate-700 text-right bg-transparent focus:underline hover:bg-white/50 px-1 py-0.5 rounded focus:outline-none w-32 border-none"
                  />
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-slate-500 font-semibold">លេខ ID ធានាទី 2</span>
                  <input
                    type="text"
                    value={repGuarantor2Id}
                    onChange={(e) => setRepGuarantor2Id(e.target.value)}
                    className="font-bold text-slate-700 text-right bg-transparent focus:underline hover:bg-white/50 px-1 py-0.5 rounded focus:outline-none w-20 border-none"
                  />
                </div>
              </div>
            </div>

            {/* Repayment Table Title */}
            <div className="text-left mb-3">
              <span className="text-sm font-extrabold text-[#0a6652] tracking-wide border-l-4 border-[#0a6652] pl-2.5">
                តារាងបង់ប្រាក់កម្ចី
              </span>
            </div>

            {/* Repayment Schedule Table */}
            <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
              <table className="w-full text-xs text-left text-slate-700 border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold uppercase tracking-wider text-[10px]">
                    <th className="py-2.5 px-3 text-center border-r border-slate-200 w-12">ល.រ</th>
                    <th className="py-2.5 px-3 border-r border-slate-200 w-20">ខែ</th>
                    <th className="py-2.5 px-3 border-r border-slate-200 text-right">កម្ចីដើមគ្រា</th>
                    <th className="py-2.5 px-3 border-r border-slate-200 text-center">អត្រាការប្រាក់</th>
                    <th className="py-2.5 px-3 border-r border-slate-200 text-right">ការប្រាក់ត្រូវបង់</th>
                    <th className="py-2.5 px-3 border-r border-slate-200 text-right">បង់រំលស់ដើម</th>
                    <th className="py-2.5 px-3 border-r border-slate-200 text-right">ការប្រាក់បានបង់</th>
                    <th className="py-2.5 px-3 border-r border-slate-200 text-right">កម្ចីថ្មី</th>
                    <th className="py-2.5 px-3 text-right">កម្ចីនៅសល់</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 divide-dashed">
                  {memberLoanRows.map((row: any, idx: number) => (
                    <tr key={idx} className="hover:bg-slate-50/50 transition-colors">
                      <td className="py-2.5 px-3 text-center border-r border-slate-100 font-bold text-slate-400">{row.seq}</td>
                      <td className="py-2.5 px-3 border-r border-slate-100 font-bold text-[#0a6652]/90">{row.monthName}</td>
                      <td className="py-2.5 px-3 border-r border-slate-100 text-right font-semibold">${fmtMoney(num(row.loanValue))}</td>
                      <td className="py-2.5 px-3 border-r border-slate-100 text-center text-slate-500">{(() => { const r = num(row.rate) || (num(row.loanValue) ? num(row.interest) / num(row.loanValue) * 100 : 0); return r ? `${r.toFixed(2)}%` : '-'; })()}</td>
                      <td className="py-2.5 px-3 border-r border-slate-100 text-right font-bold text-amber-600">{num(row.interest) ? '$' + fmtMoney(num(row.interest)) : '-'}</td>
                      <td className="py-2.5 px-3 border-r border-slate-100 text-right font-bold text-slate-600">{num(row.repayment) ? '$' + fmtMoney(num(row.repayment)) : '-'}</td>
                      <td className="py-2.5 px-3 border-r border-slate-100 text-right font-bold text-emerald-600">{num(row.interestPaid) ? '$' + fmtMoney(num(row.interestPaid)) : '-'}</td>
                      <td className="py-2.5 px-3 border-r border-slate-100 text-right font-bold text-indigo-600">{num(row.newLoan) ? '$' + fmtMoney(num(row.newLoan)) : '-'}</td>
                      <td className="py-2.5 px-3 text-right font-black text-[#0a6652]">${fmtMoney(num(row.remaining))}</td>
                    </tr>
                  ))}
                  {memberLoanRows.length === 0 && (
                    <tr><td colSpan={9} className="py-6 text-center text-slate-400 font-medium">គ្មានទិន្នន័យកម្ចីសម្រាប់សមាជិកនេះ</td></tr>
                  )}

                  {memberLoanRows.length > 0 && (
                  <tr className="bg-slate-50 font-bold border-t border-slate-200 text-slate-800">
                    <td colSpan={4} className="py-3 px-3 text-center border-r border-slate-200 font-extrabold text-[#0a6652]">សរុប</td>
                    <td className="py-3 px-3 border-r border-slate-200 text-right font-extrabold text-amber-600">${fmtMoney(memberLoanSum('interest'))}</td>
                    <td className="py-3 px-3 border-r border-slate-200 text-right font-extrabold text-slate-700">${fmtMoney(memberLoanSum('repayment'))}</td>
                    <td className="py-3 px-3 border-r border-slate-200 text-right font-extrabold text-emerald-700">${fmtMoney(memberLoanSum('interestPaid'))}</td>
                    <td className="py-3 px-3 border-r border-slate-200 text-right font-extrabold text-indigo-700">${fmtMoney(memberLoanSum('newLoan'))}</td>
                    <td className="py-3 px-3 text-right font-black text-[#0a6652]">${fmtMoney(memberLoanRows.length ? num(memberLoanRows[memberLoanRows.length - 1].remaining) : 0)}</td>
                  </tr>
                  )}
                </tbody>
              </table>
            </div>


          </div>
        </div>
      )}

      {activeTab === 'របាយការណ៍សន្សំ' && (
        <div className="max-w-5xl mx-auto space-y-6">
          {/* Savings Report Sheet Display */}
          <div className="bg-white p-6 sm:p-10 rounded-[32px] border border-slate-100 shadow-[0_8px_30px_rgba(0,0,0,0.04)] text-left relative overflow-hidden print:p-0 print:border-none print:shadow-none">
            
            {/* Download/Print Button */}
            <div className="absolute right-6 top-6 no-print z-10">
              <button
                type="button"
                onClick={() => window.print()}
                className="bg-[#0a6652] hover:bg-[#085241] text-white font-bold text-xs py-2 px-4 rounded-xl flex items-center gap-1.5 shadow-md shadow-emerald-950/10 transition-all active:scale-95 duration-200"
              >
                <Download size={14} /> <span>បោះពុម្ភ ឬទាញយកជា PDF</span>
              </button>
            </div>

            {/* Watermark Logo */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-[0.012]">
              <img src="https://i.ibb.co/Kp7CxnjC/Picture1.jpg" alt="" className="w-96 h-96 object-contain" referrerPolicy="no-referrer" />
            </div>

            {/* Header section with brand details */}
            <div className="text-center mb-8 relative">
              <div className="flex flex-col items-center justify-center gap-2 mb-4">
                <div className="w-14 h-14 border border-slate-200 rounded-2xl p-0.5 bg-slate-50 flex items-center justify-center shadow-sm">
                  <img src="https://i.ibb.co/Kp7CxnjC/Picture1.jpg" alt="Logo" className="w-full h-full object-contain" referrerPolicy="no-referrer" />
                </div>
                <div>
                  <h3 className="text-xs font-bold text-[#ecb22e] uppercase tracking-wide leading-tight">ក្រុមសន្សំប្រាក់អនាគតយើង</h3>
                  <p className="text-[9px] text-[#0a6652] font-black tracking-widest uppercase">Saving For Our Future</p>
                </div>
              </div>

              <h1 className="text-lg font-extrabold text-slate-800 tracking-wide mb-1 flex items-center justify-center gap-2">
                <span className="text-[#0a6652]">របាយការណ៍សន្សំប្រាក់សមាជិកសន្សំ</span>
              </h1>
              
              <div className="flex items-center justify-center gap-3 mt-2 flex-wrap">
                <span className="text-xs font-bold text-[#0a6652] bg-[#eef8f2] px-4 py-1.5 rounded-full shadow-sm">
                  សម្រាប់ឆ្នាំ{selectedReportYear}
                </span>
                
                {/* Years Selector Button */}
                <div className="no-print flex items-center gap-1 bg-slate-50 border border-slate-200 rounded-full px-2.5 py-1 shadow-sm">
                  <span className="text-[10px] font-bold text-slate-400">ជ្រើសរើសឆ្នាំ៖</span>
                  <select
                    value={selectedReportYear}
                    onChange={(e) => setSelectedReportYear(e.target.value)}
                    className="text-[11px] font-extrabold bg-transparent text-slate-700 outline-none cursor-pointer py-0.5"
                  >
                    <option value="2025">2025</option>
                    <option value="2026">2026</option>
                    <option value="2027">2027</option>
                    <option value="2028">2028</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Savings Schedule Table */}
            <div className="overflow-x-auto rounded-2xl border border-slate-300 bg-white shadow-sm">
              <table className="w-full text-xs text-left text-slate-700 border-collapse">
                <thead>
                  <tr className="bg-[#eef8f2] text-[#0a6652] border-b-2 border-slate-300 text-center font-bold text-[11px]">
                    <th rowSpan={2} className="py-3 px-2 border-r border-slate-300 text-center w-12 shrink-0">ល.រ</th>
                    <th rowSpan={2} className="py-3 px-3 border-r border-slate-300 text-center w-20">ខែ</th>
                    <th rowSpan={2} className="py-3 px-3 border-r border-slate-300 text-right">ទុនចាប់ផ្តើម</th>
                    <th rowSpan={2} className="py-3 px-2 border-r border-slate-300 text-center w-24">ភាគហ៊ុនជា%</th>
                    <th rowSpan={2} className="py-3 px-3 border-r border-slate-300 text-right">ទុនសន្សំបន្ថែម</th>
                    <th rowSpan={2} className="py-3 px-3 border-r border-slate-300 text-right">ប្រាក់ចំណេញ</th>
                    <th rowSpan={2} className="py-3 px-2 border-r border-slate-300 text-center">ដកទុន</th>
                    <th colSpan={2} className="py-2 px-2 border-r border-slate-300 text-center border-b border-slate-300">ប្រាក់ពិន័យ/សមាជិកភាព</th>
                    <th rowSpan={2} className="py-3 px-3 border-r border-slate-300 text-right bg-[#f2fbf6] text-[#0a6652]">ប្រាក់សន្សំសរុប</th>
                    <th rowSpan={2} className="py-3 px-2 text-center w-20">កំណត់សំគាល់</th>
                  </tr>
                  <tr className="bg-[#eef8f2] text-[#0a6652]/90 border-b-2 border-slate-300 text-center font-bold text-[10px]">
                    <th className="py-2 px-2 border-r border-slate-300 text-center">កាត់ទុន</th>
                    <th className="py-2 px-2 border-r border-slate-300 text-center">ជាក់ស្តែង</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-300 text-[11px]">
                  {memberSavingRows.map((row: any, idx: number) => (
                    <tr key={idx} className="hover:bg-slate-50/50 transition-colors h-10">
                      <td className="py-2 px-2 text-center border-r border-slate-300 font-bold text-slate-400">{row.seq}</td>
                      <td className="py-2 px-3 border-r border-slate-300 font-bold text-slate-800 text-center bg-slate-50/10">{row.monthName}</td>
                      <td className="py-2 px-3 border-r border-slate-300 text-right font-medium">{fmtMoney(num(row.startCapital))}</td>
                      <td className="py-2 px-2 border-r border-slate-300 text-center font-medium text-slate-500">{row.share || '-'}</td>
                      <td className="py-2 px-3 border-r border-slate-300 text-right font-semibold text-slate-700">
                        {num(row.addSaving) > 0 ? fmtMoney(num(row.addSaving)) : <span className="text-slate-300">-</span>}
                      </td>
                      <td className="py-2 px-3 border-r border-slate-300 text-right font-mono text-slate-600">
                        {num(row.profit) ? fmtMoney(num(row.profit)) : <span className="text-slate-300">-</span>}
                      </td>
                      <td className="py-2 px-2 border-r border-slate-300 text-center text-slate-300">{num(row.withdraw) ? fmtMoney(num(row.withdraw)) : '-'}</td>
                      <td className="py-2 px-2 border-r border-slate-300 text-center text-slate-300">{num(row.deductFee) ? fmtMoney(num(row.deductFee)) : '-'}</td>
                      <td className="py-2 px-2 border-r border-slate-300 text-center text-slate-300">{num(row.actualFee) ? fmtMoney(num(row.actualFee)) : '-'}</td>
                      <td className="py-2 px-3 border-r border-slate-300 text-right font-black text-[#0a6652] bg-[#f8fdfb]">
                        {fmtMoney(num(row.total))}
                      </td>
                      <td className="py-2 px-2 text-center font-black text-emerald-600 text-xs">✓</td>
                    </tr>
                  ))}
                  {memberSavingRows.length === 0 && (
                    <tr><td colSpan={11} className="py-6 text-center text-slate-400 font-medium">គ្មានទិន្នន័យសន្សំសម្រាប់ឆ្នាំ{selectedReportYear}</td></tr>
                  )}

                  {/* Summary Totals Row */}
                  {memberSavingRows.length > 0 && (
                  <tr className="bg-emerald-50/60 font-bold border-t-2 border-slate-300 text-slate-900 text-[11px] h-11">
                    <td className="py-2.5 px-3 text-center border-r border-slate-300 font-bold">-</td>
                    <td className="py-2.5 px-3 border-r border-slate-300 text-center font-extrabold text-[#0a6652]">សរុប</td>
                    <td className="py-2.5 px-3 border-r border-slate-300 text-right font-black text-slate-800">{fmtMoney(memberSavingSum('startCapital'))}</td>
                    <td className="py-2.5 px-2 border-r border-slate-300 text-center font-bold text-slate-600">-</td>
                    <td className="py-2.5 px-3 border-r border-slate-300 text-right font-bold text-slate-800">{fmtMoney(memberSavingSum('addSaving'))}</td>
                    <td className="py-2.5 px-3 border-r border-slate-300 text-right font-mono font-bold text-slate-600">{fmtMoney(memberSavingSum('profit'))}</td>
                    <td className="py-2.5 px-2 border-r border-slate-300 text-center text-slate-300">{memberSavingSum('withdraw') ? fmtMoney(memberSavingSum('withdraw')) : '-'}</td>
                    <td className="py-2.5 px-2 border-r border-slate-300 text-center text-slate-300">{memberSavingSum('deductFee') ? fmtMoney(memberSavingSum('deductFee')) : '-'}</td>
                    <td className="py-2.5 px-2 border-r border-slate-300 text-center text-slate-300">{memberSavingSum('actualFee') ? fmtMoney(memberSavingSum('actualFee')) : '-'}</td>
                    <td className="py-2.5 px-3 border-r border-slate-300 text-right font-black text-[#0a6652] bg-emerald-50">{fmtMoney(memberSavingClosing)}</td>
                    <td className="py-2.5 px-2 text-center text-slate-300">-</td>
                  </tr>
                  )}
                </tbody>
              </table>
            </div>

          </div>
        </div>
      )}

      {activeTab === 'ការដាក់សន្សំ និងបង់កម្ចី' && (
        <div className="max-w-4xl mx-auto space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-start">
            
            {/* Left side: KHQR Payment card */}
            <div className="md:col-span-5 bg-white p-6 rounded-[32px] border border-slate-100 shadow-[0_8px_30px_rgba(0,0,0,0.04)] text-center">
              <h4 className="text-sm font-bold text-[#0a6652] mb-4 flex items-center justify-center gap-1.5 border-b border-slate-100 pb-3">
                <ShieldCheck size={18} />
                <span>គណនីបង់ប្រាក់ផ្លូវការ</span>
              </h4>
              
              {/* Scan Wrapper */}
              <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100 relative inline-block mb-4 overflow-hidden shadow-inner max-w-[240px] mx-auto">
                <img 
                  src="https://i.ibb.co/xtBGLWX7/708852725-868075986313154-5636381465848274787-n.jpg" 
                  alt="Official ABA KHQR" 
                  className="w-full h-auto object-contain rounded-xl select-none shadow-sm"
                  referrerPolicy="no-referrer"
                />
              </div>

              {/* Account details list */}
              <div className="space-y-2.5 text-left text-[11px] bg-[#f8fdfb] p-3.5 rounded-2xl border border-[#0a6652]/10">
                <div className="flex justify-between items-center">
                  <span className="text-slate-400 font-bold">ធនាគារ (Bank)៖</span>
                  <span className="font-extrabold text-[#0a6652]">ABA Bank</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-400 font-bold">ឈ្មោះគណនី៖</span>
                  <span className="font-black text-slate-700">LAUV V. & PHORN S.</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-400 font-bold">ចំណាំការផ្ញើ៖</span>
                  <span className="font-extrabold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-md">ឈ្មោះសមាជិក</span>
                </div>
              </div>
              
              <p className="mt-4 text-[10px] text-slate-400 font-bold leading-relaxed">
                💡 ណែនាំ៖ បន្ទាប់ពីស្កេន និងបង់ប្រាក់តាមរយៈ ABA App រួចរាល់ សូមធ្វើការថតរូបស្គ្រីនសត (Screenshot) នៃប្រតិបត្តិការរបស់អ្នក ដើម្បីផ្ញើជាភស្តុតាងនៅខាងស្តាំដៃនេះ។
              </p>
            </div>

            {/* Right side: Interactive payment submission form */}
            <div className="md:col-span-7 bg-white p-6 sm:p-8 rounded-[32px] border border-slate-100 shadow-[0_8px_30px_rgba(0,0,0,0.04)] text-left">
              <h3 className="text-base font-extrabold text-slate-800 mb-5 flex items-center gap-2">
                <HandCoins className="text-[#0a6652]" size={20} />
                <span>ផ្ញើភស្តុតាងនៃការដាក់សន្សំ ឬបង់កម្ចី</span>
              </h3>

              <form onSubmit={handlePaymentSubmit} className="space-y-4">
                {/* 1. Toggle Payment Type */}
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">ប្រភេទការបង់ប្រាក់</label>
                  <div className="flex p-1 bg-slate-100 rounded-xl">
                    <button
                      type="button"
                      onClick={() => setPaymentType('savings')}
                      className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all text-center ${
                        paymentType === 'savings' 
                          ? 'bg-[#0a6652] text-white shadow-sm' 
                          : 'text-slate-500 hover:text-slate-800'
                      }`}
                    >
                      ដាក់សន្សំប្រចាំខែ
                    </button>
                    <button
                      type="button"
                      onClick={() => setPaymentType('loan')}
                      className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all text-center ${
                        paymentType === 'loan' 
                          ? 'bg-[#0a6652] text-white shadow-sm' 
                          : 'text-slate-500 hover:text-slate-800'
                      }`}
                    >
                      បង់សងប្រាក់កម្ចី
                    </button>
                  </div>
                </div>

                {/* 2. Form Inputs dynamic based on Savings vs Loan */}
                {paymentType === 'savings' ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">ចំនួនទឹកប្រាក់សន្សំ (USD)</label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-xs">$</span>
                        <input
                          type="number"
                          step="0.01"
                          required
                          value={paymentAmount}
                          onChange={(e) => setPaymentAmount(e.target.value)}
                          className="w-full pl-7 pr-3 py-2 rounded-xl bg-slate-50 border border-slate-200 focus:outline-none focus:ring-1 focus:ring-[#0a6652] text-xs font-bold text-slate-700"
                          placeholder="0.00"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">កាលបរិច្ឆេទបង់ប្រាក់</label>
                      <input
                        type="date"
                        required
                        value={paymentDate}
                        onChange={(e) => setPaymentDate(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 focus:outline-none focus:ring-1 focus:ring-[#0a6652] text-xs font-bold text-slate-700"
                      />
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">បង់រំលស់ដើមប្រាក់កម្ចី (USD)</label>
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-xs">$</span>
                          <input
                            type="number"
                            step="0.01"
                            required
                            value={loanPrincipal}
                            onChange={(e) => setLoanPrincipal(e.target.value)}
                            className="w-full pl-7 pr-3 py-2 rounded-xl bg-slate-50 border border-slate-200 focus:outline-none focus:ring-1 focus:ring-[#0a6652] text-xs font-bold text-slate-700"
                            placeholder="0.00"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">បង់ការប្រាក់ (USD)</label>
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-xs">$</span>
                          <input
                            type="number"
                            step="0.01"
                            required
                            value={loanInterest}
                            onChange={(e) => setLoanInterest(e.target.value)}
                            className="w-full pl-7 pr-3 py-2 rounded-xl bg-slate-50 border border-slate-200 focus:outline-none focus:ring-1 focus:ring-[#0a6652] text-xs font-bold text-slate-700"
                            placeholder="0.00"
                          />
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {/* Read-only Total / Sum Box */}
                      <div className="bg-emerald-50/40 border border-emerald-100/60 rounded-2xl p-3 flex flex-col justify-center">
                        <span className="text-[9px] font-black uppercase text-slate-400 tracking-wider">សរុបប្រាក់ត្រូវទូទាត់ជាក់ស្តែង (Total)</span>
                        <span className="text-sm font-black text-[#0a6652] mt-1">
                          ${((parseFloat(loanPrincipal) || 0) + (parseFloat(loanInterest) || 0)).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}
                        </span>
                      </div>

                      <div>
                        <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">កាលបរិច្ឆេទបង់ប្រាក់</label>
                        <input
                          type="date"
                          required
                          value={paymentDate}
                          onChange={(e) => setPaymentDate(e.target.value)}
                          className="w-full px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 focus:outline-none focus:ring-1 focus:ring-[#0a6652] text-xs font-bold text-slate-700"
                        />
                      </div>
                    </div>
                  </div>
                )}

                {/* 4. Document screenshot upload (Proof of payment) */}
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">រូបភាពភស្តុតាងនៃការបង់ប្រាក់ (screenshot)</label>
                  
                  {!proofImage ? (
                    <div className="border-2 border-dashed border-slate-200 hover:border-[#0a6652]/40 rounded-2xl p-6 text-center cursor-pointer bg-slate-50/50 hover:bg-[#f8fdfb]/50 transition-all relative">
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handleImageUpload}
                        className="absolute inset-0 opacity-0 cursor-pointer"
                        required
                      />
                      <div className="flex flex-col items-center justify-center gap-2">
                        <div className="w-10 h-10 rounded-full bg-[#eef8f2] text-[#0a6652] flex items-center justify-center border border-[#0a6652]/10">
                          <Upload size={18} />
                        </div>
                        <p className="text-xs font-extrabold text-slate-600">ចុច ឬ អូសទម្លាក់ រូបភាព Screenshot ដើម្បីបញ្ចូល</p>
                        <p className="text-[10px] font-medium text-slate-400">គាំទ្រតែប្រភេទឯកសារ JPEG, PNG (ទំហំអតិបរមា 5MB)</p>
                      </div>
                    </div>
                  ) : (
                    <div className="bg-[#f8fdfb] border border-emerald-100 rounded-2xl p-3 flex items-center gap-3 relative shadow-inner">
                      <div className="w-14 h-14 bg-white border border-slate-100 rounded-xl overflow-hidden shrink-0 shadow-sm flex items-center justify-center p-0.5 animate-in fade-in zoom-in duration-200">
                        <img 
                          src={proofImage} 
                          alt="Screenshot Proof" 
                          className="w-full h-full object-cover rounded-lg"
                        />
                      </div>
                      <div className="flex-1 min-w-0 pr-6">
                        <p className="text-xs font-bold text-slate-700 truncate">{proofFilename}</p>
                        <p className="text-[10px] font-bold text-[#0a6652] flex items-center gap-1 mt-0.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                          <span>បានជ្រើសរើសរួចរាល់</span>
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setProofImage(null);
                          setProofFilename('');
                        }}
                        className="absolute right-3 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-rose-50 text-rose-500 flex items-center justify-center hover:bg-rose-100 active:scale-90 transition-all animate-in fade-in duration-150"
                      >
                        <X size={12} strokeWidth={2.5} />
                      </button>
                    </div>
                  )}
                </div>

                {/* Submit button */}
                <button
                  type="submit"
                  className="w-full py-3 px-4 rounded-xl bg-[#0a6652] hover:bg-[#085241] text-white font-extrabold text-xs flex items-center justify-center gap-2 shadow-md shadow-emerald-900/10 transition-all active:scale-95 duration-200 mt-2"
                >
                  <ShieldCheck size={16} />
                  <span>ផ្ញើភស្តុតាងបង់ប្រាក់ផ្លូវការ</span>
                </button>
              </form>
            </div>
            
          </div>

          {/* Submitted Transaction History Section */}
          <div className="bg-white p-6 sm:p-8 rounded-[32px] border border-slate-100 shadow-[0_8px_30px_rgba(0,0,0,0.04)] text-left">
            <h4 className="text-xs font-black text-[#0a6652] uppercase tracking-wider mb-4 flex items-center gap-1.5">
              <TrendingUp size={16} />
              <span>ប្រវត្តិការផ្ញើភស្តុតាង និងស្ថានភាពគណនី</span>
            </h4>
            
            {submittedPayments.length === 0 ? (
              <p className="text-xs text-slate-400 font-bold text-center py-6">មិនទាន់មានការផ្ញើប្រវត្តិប្រតិបត្តិការនៅឡើយទេ។</p>
            ) : (
              <div className="space-y-3">
                {submittedPayments.map((txn, index) => (
                  <div key={txn.id || index} className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-2xl bg-slate-50 border border-slate-200/60 hover:border-slate-300 transition-colors animate-in slide-in-from-top-4 duration-300">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 bg-white rounded-xl border border-slate-200 flex items-center justify-center p-0.5 shadow-sm overflow-hidden text-center cursor-pointer hover:border-[#0a6652]/30" onClick={() => {
                        // Open high fidelity popup modal or alert standard
                        if (txn.proofImg) {
                          const w = window.open();
                          if (w) {
                            w.document.write(`<img src="${txn.proofImg}" style="max-width:100%; max-height:100vh; display:block; margin:auto;" />`);
                          } else {
                            alert("សូមអនុញ្ញាត popups ដើម្បីមើលភស្តុតាង!");
                          }
                        }
                      }}>
                        <img 
                          src={txn.proofImg} 
                          alt="Proof thumb" 
                          className="w-full h-full object-cover rounded-lg"
                        />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${
                            txn.type === 'savings' 
                              ? 'bg-emerald-50 text-[#0a6652]' 
                              : 'bg-orange-50 text-orange-600'
                          }`}>
                            {txn.type === 'savings' ? 'ដាក់សន្សំប្រចាំខែ' : 'បង់សងប្រាក់កម្ចី'}
                          </span>
                          <span className="font-mono text-[10px] text-slate-400 font-extrabold">{txn.id}</span>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 mt-1">
                          <span className="text-xs font-black text-slate-800">${txn.amount.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>
                          {txn.principal !== undefined && txn.interest !== undefined && (
                            <span className="text-[9px] font-bold text-slate-500 bg-slate-200/60 px-2 py-0.5 rounded-md">
                              (រំលស់ដើម៖ ${txn.principal.toLocaleString(undefined, {minimumFractionDigits: 2})} + ការប្រាក់៖ ${txn.interest.toLocaleString(undefined, {minimumFractionDigits: 2})})
                            </span>
                          )}
                        </div>
                        <p className="text-[9px] font-bold text-slate-400 mt-0.5 font-sans">
                          កាលបរិច្ឆេទ៖ {txn.date}
                          {txn.transactionId && txn.transactionId !== "N/A" && (
                            <> | លេខយោង៖ <span className="font-mono text-slate-500 font-extrabold">{txn.transactionId}</span></>
                          )}
                        </p>
                      </div>
                    </div>
                    
                    <div className="flex items-center justify-between sm:justify-end gap-3 self-stretch sm:self-auto border-t sm:border-t-0 pt-2.5 sm:pt-0 border-slate-100">
                      <div className="flex flex-col text-right">
                        <span className={`text-[10px] font-black inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full ${
                          txn.status === 'approved' 
                            ? 'bg-emerald-50 text-emerald-600' 
                            : 'bg-amber-50 text-amber-600'
                        }`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${
                            txn.status === 'approved' ? 'bg-emerald-500' : 'bg-amber-500 animate-pulse'
                          }`}></span>
                          <span>{txn.status === 'approved' ? 'បានអនុម័តរួចរាល់' : 'រង់ចាំការពិនិត្យ'}</span>
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

        </div>
      )}
    </PageView>
  );
}

