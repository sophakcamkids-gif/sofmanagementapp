import { supabase } from './supabase';

// Helper to handle API responses
const handleResponse = async (promise: Promise<any>) => {
  const { data, error } = await promise;
  if (error) {
    console.error('Supabase error:', error);
    throw error;
  }
  return data;
};

export const db = {
  // Members
  getMembers: () => handleResponse(supabase.from('members').select('*').order('created_at', { ascending: false })),
  addMember: (member: any) => handleResponse(supabase.from('members').insert([member]).select()),
  updateMember: (id: string, updates: any) => handleResponse(supabase.from('members').update(updates).eq('id', id).select()),
  deleteMember: (id: string) => handleResponse(supabase.from('members').delete().eq('id', id)),

  // Savings
  getSavings: () => handleResponse(supabase.from('savings').select('*').order('transaction_date', { ascending: false })),
  addSaving: (saving: any) => handleResponse(supabase.from('savings').insert([saving]).select()),
  updateSaving: (id: string, updates: any) => handleResponse(supabase.from('savings').update(updates).eq('id', id).select()),
  deleteSaving: (id: string) => handleResponse(supabase.from('savings').delete().eq('id', id)),

  // Loans
  getLoans: () => handleResponse(supabase.from('loans').select('*').order('start_date', { ascending: false })),
  addLoan: (loan: any) => handleResponse(supabase.from('loans').insert([loan]).select()),
  updateLoan: (id: string, updates: any) => handleResponse(supabase.from('loans').update(updates).eq('id', id).select()),
  deleteLoan: (id: string) => handleResponse(supabase.from('loans').delete().eq('id', id)),

  // Loan Repayments
  getLoanRepayments: (loanId: string) => handleResponse(supabase.from('loan_repayments').select('*').eq('loan_id', loanId).order('repayment_date', { ascending: false })),
  addLoanRepayment: (repayment: any) => handleResponse(supabase.from('loan_repayments').insert([repayment]).select()),

  // Expenses
  getExpenses: () => handleResponse(supabase.from('expenses').select('*').order('expense_date', { ascending: false })),
  addExpense: (expense: any) => handleResponse(supabase.from('expenses').insert([expense]).select()),
  updateExpense: (id: string, updates: any) => handleResponse(supabase.from('expenses').update(updates).eq('id', id).select()),
  deleteExpense: (id: string) => handleResponse(supabase.from('expenses').delete().eq('id', id)),

  // System Settings
  getSettings: () => handleResponse(supabase.from('system_settings').select('*')),
  updateSetting: (key: string, value: string) => handleResponse(supabase.from('system_settings').upsert({ setting_key: key, setting_value: value }))
};
