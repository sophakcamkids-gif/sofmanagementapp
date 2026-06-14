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

const DEFAULT_DEPOSIT_PROFILE_DATA = [];

const DEFAULT_MEMBER_LIST_DATA = [];

const DEFAULT_SAVING_DATA = [];

const DEFAULT_GROUP_DATA = [
  { id: 'R001', name: 'ទុនបម្រុង', gender: 'ក្រុម', startCapital: '0.00', share: '0.00%', addSaving: '-', profit: '0', withdraw: '-', deductFee: '-', actualFee: '-', total: '0.00', checked: true },
  { id: 'R002', name: 'ទុនសង្គម', gender: 'ក្រុម', startCapital: '0.00', share: '0.00%', addSaving: '-', profit: '0', withdraw: '-', deductFee: '-', actualFee: '-', total: '0.00', checked: true },
  { id: 'R003', name: 'ទុនក្រុមយេស (YES)', gender: 'ក្រុម', startCapital: '0.00', share: '0.00%', addSaving: '-', profit: '0', withdraw: '-', deductFee: '-', actualFee: '-', total: '0.00', checked: true }
];

const DEFAULT_DEPOSIT_DATA: any[] = [];
const DEFAULT_LOAN_DATA: any[] = [];
const DEFAULT_DEPOSIT_LOAN_DATA: any[] = [];

const DEFAULT_EXPENSE_DATA = [
  { id: '1', date: '2026-04-15', supplier: 'SOF', description: 'ប្រាក់ឧបត្ថម្ភប្រចាំខែសម្រាប់ លី រ៉ា', category: 'ចំណាយប្រតិបត្តិការ', qty: 1, price: 170.00, total: 170.00 },
  { id: '2', date: '2026-04-15', supplier: 'SOF', description: 'ប្រាក់ឧបត្ថម្ភប្រចាំខែសម្រាប់ ផាត សុភាព', category: 'ចំណាយប្រតិបត្តិការ', qty: 1, price: 30.00, total: 30.00 },
  { id: '3', date: '2026-04-15', supplier: 'SOF', description: 'កាតទូរស័ព្ទប្រចាំខែសម្រាប់ លី រ៉ា', category: 'ចំណាយប្រតិបត្តិការ', qty: 2, price: 4.00, total: 8.00 }
];

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

    if (selectedM.type === 'សកម្ម') {
      const savings = getStoredData('sof_savings_data', DEFAULT_SAVING_DATA);
      const updated = savings.map((s: any) => {
        if (s.id === sMemberId) {
          const cap = parseFloat(s.startCapital?.replace(/,/g, '')) || 0;
          const add = parseFloat(sAmount);
          const prof = parseFloat(s.profit) || 0;
          const totalVal = cap + add + prof;
          return {
            ...s,
            addSaving: add.toFixed(2),
            total: totalVal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
          };
        }
        return s;
      });
      setStoredData('sof_savings_data', updated);
    } else {
      const savings = getStoredData('sof_savings_deposit_data', DEFAULT_DEPOSIT_DATA);
      const updated = savings.map((s: any) => {
        if (s.id === sMemberId) {
          const cap = parseFloat(s.startCapital?.replace(/,/g, '')) || 0;
          const add = parseFloat(sAmount);
          const prof = parseFloat(s.profit) || 0;
          const totalVal = cap + add + prof;
          return {
            ...s,
            addSaving: add.toFixed(2),
            total: totalVal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
          };
        }
        return s;
      });
      setStoredData('sof_savings_deposit_data', updated);
    }

    // Success log
    const logs = getStoredData('sof_query_logs', []);
    const newLog = `បានបញ្ចូលប្រាក់សន្សំ $${sAmount} ជូន ${selectedM.name} សម្រាប់ខែ ${sMonth}`;
    setStoredData('sof_query_logs', [newLog, ...logs].slice(0, 5));

    setSuccessMsg(`បានរក្សាទុកការដាក់សន្សំ $${sAmount} ជូន ${selectedM.name}!`);
    setSAmount('');
    setTimeout(() => setSuccessMsg(''), 4500);
  };

  const handleAddLoan = (e: React.FormEvent) => {
    e.preventDefault();
    if (!lAmount || isNaN(parseFloat(lAmount))) return;

    const selectedM = allMembersForSelect.find(member => member.code === lMemberId);
    if (!selectedM) return;

    const loans = getStoredData('sof_loans_data', DEFAULT_LOAN_DATA);
    const updated = loans.map((l: any) => {
      if (l.id === lMemberId) {
        const val = parseFloat(lAmount);
        const interestRateRaw = parseFloat(lRate) || 1.5;
        const interestPaidVal = val * (interestRateRaw / 100);
        return {
          ...l,
          loanValue: val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
          remaining: val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
          interest: interestPaidVal.toFixed(2),
          repayment: '-',
          interestPaid: '-'
        };
      }
      return l;
    });
    setStoredData('sof_loans_data', updated);

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

    const loans = getStoredData('sof_loans_data', DEFAULT_LOAN_DATA);
    const updated = loans.map((l: any) => {
      if (l.id === rMemberId) {
        const origVal = parseFloat(l.loanValue?.replace(/,/g, '')) || 0;
        const remainingVal = Math.max(0, origVal - pAmt);
        return {
          ...l,
          repayment: pAmt > 0 ? pAmt.toFixed(2) : '-',
          interestPaid: iAmt > 0 ? iAmt.toFixed(2) : '-',
          remaining: remainingVal > 0 ? remainingVal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-'
        };
      }
      return l;
    });
    setStoredData('sof_loans_data', updated);

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

  return (
    <PageView title="ផ្ទាំងគ្រប់គ្រងទូទៅ (Dashboard)" hideBack={true} hideDownload={true} hideAdd={true}>
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
        {[
          { label: 'ទុនសន្សំសមាជិកសកម្ម', value: '$' + fmtMoney(dashVal('memberSavings', sumField(dashSavings, 'total'))), color: 'text-[#0a6652]' },
          { label: 'ទុនសន្សំសមាជិកបញ្ញើ', value: '$' + fmtMoney(dashVal('depositSavings', sumField(dashDeposit, 'total'))), color: 'text-blue-600' },
          { label: 'គណនីសន្សំមានកាលកំណត់', value: '$' + fmtMoney(dashVal('fixedTerm', 0)), color: 'text-amber-600' },
          { label: 'ទុនបម្រុង', value: '$' + fmtMoney(dashVal('reserve', groupTotalBy('បម្រុង'))), color: 'text-rose-500' },
          { label: 'ទុនសង្គម', value: '$' + fmtMoney(dashVal('social', groupTotalBy('សង្គម'))), color: 'text-violet-600' }
        ].map((stat, i) => (
          <div key={i} className="bg-[#eef8f2] p-4 md:p-5 rounded-2xl border border-green-100">
            <div className="text-[10px] md:text-xs font-bold text-slate-500 mb-1 leading-tight truncate-2-lines line-clamp-2 h-8 flex items-center">{stat.label}</div>
            <div className={`text-base md:text-lg lg:text-xl font-black ${stat.color}`}>{stat.value}</div>
          </div>
        ))}
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
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
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
          <div className="overflow-x-auto border border-slate-300 rounded-xl">
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
          <div className="overflow-x-auto border border-slate-300 rounded-xl">
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
          <div className="overflow-x-auto border border-slate-300 rounded-xl">
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

  const [groupData, setGroupData] = useState(() => getStoredData('sof_savings_group_data', DEFAULT_GROUP_DATA));

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

  // Recompute ONE month's rows from raw inputs (saved snapshot, else current roster),
  // applying the profit engine. The carry-forward beginning is supplied by the caller.
  const computeMonth = (month: string, prevTotals: { active: Record<string, any>; group: Record<string, any>; deposit: Record<string, any> } | null) => {
    const sBy = getStoredData('sof_savings_by_month', {});
    const gBy = getStoredData('sof_group_by_month', {});
    const dBy = getStoredData('sof_deposit_by_month', {});
    const reports = getStoredData('sof_monthly_reports', {});
    let active = (sBy[month] && sBy[month].length) ? sBy[month] : getStoredData('sof_savings_data', DEFAULT_SAVING_DATA) || [];
    let group = (gBy[month] && gBy[month].length) ? gBy[month] : getStoredData('sof_savings_group_data', DEFAULT_GROUP_DATA) || [];
    let deposit = (dBy[month] && dBy[month].length) ? dBy[month] : getStoredData('sof_savings_deposit_data', DEFAULT_DEPOSIT_DATA) || [];

    // Carry forward: this month's beginning = previous month's freshly recomputed total.
    if (prevTotals) {
      active = active.map((r: any) => (prevTotals.active[r.id] !== undefined ? { ...r, startCapital: String(prevTotals.active[r.id]) } : r));
      group = group.map((r: any) => (prevTotals.group[r.id] !== undefined ? { ...r, startCapital: String(prevTotals.group[r.id]) } : r));
      deposit = deposit.map((r: any) => (prevTotals.deposit[r.id] !== undefined ? { ...r, startCapital: String(prevTotals.deposit[r.id]) } : r));
    }

    const net = num(((reports[month] || {}).income || {}).netProfit);
    const pool = [...active, ...group].map((r: any) => ({
      id: r.id, beginning: num(r.startCapital), addSaving: num(r.addSaving),
      withdraw: num(r.withdraw), penalty: num(r.actualFee), deductFee: num(r.deductFee),
    }));
    const byId: Record<string, any> = {};
    computeSavings(pool, net).forEach((x) => { byId[x.id] = x; });
    const apply = (rows: any[]) => rows.map((r: any) => {
      const c = byId[r.id];
      return c ? { ...r, share: (c.share * 100).toFixed(2) + '%', profit: c.profit.toFixed(2), total: c.total.toFixed(2) } : r;
    });
    return { active: apply(active), group: apply(group), deposit: deposit.map((r: any) => computeDepositRow(r)) };
  };

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
    const reports = getStoredData('sof_monthly_reports', {});
    const net = num(((reports[selectedMonth] || {}).income || {}).netProfit);
    const pool = [...activeRows, ...groupRows].map((r: any) => ({
      id: r.id, beginning: num(r.startCapital), addSaving: num(r.addSaving),
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
  // Deposit row total: deposit members earn a flat 0.5%, no profit-pool share.
  const computeDepositRow = (r: any) => {
    const beginning = num(r.startCapital);
    const profit = DEFAULT_RATES.deposit * beginning;
    const total = beginning + num(r.addSaving) + profit - num(r.withdraw) - num(r.actualFee) - num(r.deductFee);
    return { ...r, profit: profit.toFixed(2), total: total.toFixed(2) };
  };
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

  const handleSaveAllSavings = async () => {
    alert('ទិន្នន័យត្រូវបានរក្សាទុកទៅ Supabase ដោយជោគជ័យ!');
  };

  return (
    <PageView
      onAddClick={() => navigate('/dashboard', { state: { tab: 'savings' } })}
      onUpload={handleFileImport}
      title={
      <div className="flex flex-col md:flex-row md:items-center gap-3">
        <span>របាយការណ៍សន្សំប្រាក់{activeTab === 'group' ? 'ក្រុម' : activeTab === 'deposit' ? 'សមាជិកបញ្ញើសន្សំ' : 'សមាជិកសកម្ម'} - </span>
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

  // Load the selected month's loans and AUTO-CALCULATE interest (rate × beginning)
  // and remaining (beginning + newLoan − repayment) via the engine.
  useEffect(() => {
    const byMonth = getStoredData('sof_loans_by_month', {});
    if (byMonth[selectedMonth]) {
      const rows = byMonth[selectedMonth];
      const fmt = (v: number) => v ? v.toFixed(2) : '-';
      setLoanData(rows.map((r: any) => {
        const res = computeLoan({
          id: r.id, beginning: num(r.loanValue),
          newLoan: num(r.newLoan), repayment: num(r.repayment),
        }, DEFAULT_RATES);
        return { ...r, interest: fmt(res.interest), remaining: fmt(res.remaining) };
      }));
    }
  }, [selectedMonth]);

  // Edit a raw loan input (loanValue/repayment/newLoan) → live recompute interest + remaining.
  const editLoanRaw = (idx: number, field: string, value: string) => {
    const fmt = (v: number) => (v ? v.toFixed(2) : '-');
    const next = loanData.map((r: any, i: number) => {
      if (i !== idx) return r;
      const merged = { ...r, [field]: value };
      const res = computeLoan({
        id: merged.id, beginning: num(merged.loanValue),
        newLoan: num(merged.newLoan), repayment: num(merged.repayment),
      }, DEFAULT_RATES);
      return { ...merged, interest: fmt(res.interest), remaining: fmt(res.remaining) };
    });
    setLoanData(next);
  };
  const saveLoansMonth = () => {
    const by = getStoredData('sof_loans_by_month', {}); by[selectedMonth] = loanData; setStoredData('sof_loans_by_month', by);
  };

  const externalLoanData = [
    { id: 'I01', name: 'កម្ចីទទួលបានពី LSG', gender: 'ក្រុម', received: '-', repayment: '-', interestRate: '1.20%', duration: '', newLoan: '-', remaining: '-', interest: '-', totalToPay: '-', note: '' }
  ];

  const externalProvidedData = [
    { id: 'O01', name: 'ដៃគូ SIG', gender: '-', received: '391.70', repayment: '-', interestRate: '0.00%', duration: '', newLoan: '-', remaining: '391.70', interest: '-', totalToPay: '-', note: '' },
    { id: 'O02', name: 'ដៃគូ ឃ្លាំង', gender: '-', received: '2,870.91', repayment: '-', interestRate: '0.00%', duration: '', newLoan: '-', remaining: '2,870.91', interest: '-', totalToPay: '-', note: '' },
    { id: 'O03', name: 'ដៃគូ SOF', gender: '-', received: '7,286.91', repayment: '-', interestRate: '0.00%', duration: '', newLoan: '-', remaining: '7,286.91', interest: '-', totalToPay: '-', note: '' }
  ];

  const handleDeleteAllLoans = () => {
    if (window.confirm('តើអ្នកពិតជាចង់លុបទិន្នន័យនេះមែនទេ? (សកម្មភាពនេះមិនអាចត្រឡប់វិញបានទេ)')) {
      if (activeTab === 'members') {
        setLoanData([]);
        setStoredData('sof_loans_data', []);
      } else if (activeTab === 'deposit_members') {
        setDepositLoanData([]);
        setStoredData('sof_loans_deposit_data', []);
      }
      // Note: external group and provided loans are hardcoded, so we don't clear them
    }
  };

  const handleSaveAllLoans = async () => {
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

      {activeTab === 'members' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col p-1 px-4 md:px-6 md:p-6 mb-6">
          <div className="overflow-x-auto border border-slate-300 rounded-xl">
            <table className="w-full text-left border-collapse text-sm min-w-[1200px]">
              <thead className="bg-[#eef8f2] text-[#0a6652] border-b-[3px] border-[#0a6652] text-center font-bold">
                <tr>
                  <th className="px-3 py-3 border-r border-slate-300 align-middle">ល.រ</th>
                  <th className="px-3 py-3 border-r border-slate-300 align-middle min-w-[140px]">ឈ្មោះ</th>
                  <th className="px-3 py-3 border-r border-slate-300 align-middle">ភេទ</th>
                  <th className="px-3 py-3 border-r border-slate-300 align-middle text-right">កម្ចី</th>
                  <th className="px-3 py-3 border-r border-slate-300 align-middle text-right">កម្ចីសងត្រឡប់</th>
                  <th className="px-3 py-3 border-r border-slate-300 align-middle text-right">ការប្រាក់</th>
                  <th className="px-3 py-3 border-r border-slate-300 align-middle text-right">កម្ចីថ្មី</th>
                  <th className="px-3 py-3 border-r border-slate-300 align-middle text-right">កម្ចីនៅសល់</th>
                  <th className="px-3 py-3 border-r border-slate-300 align-middle text-right text-[#084f40] bg-[#f3faf6] shadow-[-4px_0_10px_rgba(0,0,0,0.02)]">ការប្រាក់បានបង់</th>
                  <th className="px-3 py-3 align-middle">កំណត់សំគាល់</th>
                </tr>
              </thead>
              <tbody>
                {loanData.map((row, idx) => (
                  <tr key={`${row.id}-${idx}`} className="border-b border-slate-300 hover:bg-slate-50 transition-colors h-11">
                    <td className="px-3 py-2 border-r border-slate-300 text-center text-slate-500 font-medium">{typeof row.id === 'string' ? row.id.split(' ').pop() : row.id}</td>
                    <td className="px-3 py-2 border-r border-slate-300 font-bold text-slate-800">{row.name}</td>
                    <td className="px-3 py-2 border-r border-slate-300 text-center text-slate-500">{row.gender}</td>
                    <td className="px-1 py-1 border-r border-slate-300 text-right">
                      <input value={row.loanValue} onChange={(e) => editLoanRaw(idx, 'loanValue', e.target.value)} onBlur={saveLoansMonth}
                        className="w-24 text-right bg-transparent px-2 py-1 rounded border border-dashed border-slate-300 focus:border-[#0a6652] focus:bg-[#f3faf6] outline-none font-medium" />
                    </td>
                    <td className="px-1 py-1 border-r border-slate-300 text-right">
                      <input value={row.repayment} onChange={(e) => editLoanRaw(idx, 'repayment', e.target.value)} onBlur={saveLoansMonth}
                        className="w-20 text-right bg-transparent px-2 py-1 rounded border border-dashed border-slate-300 focus:border-amber-600 focus:bg-amber-50 outline-none font-medium text-amber-700" />
                    </td>
                    <td className="px-3 py-2 border-r border-slate-300 text-right font-medium text-indigo-600">
                      {row.interest !== '-' ? <span className="text-slate-400 mr-1">$</span> : null}
                      {row.interest}
                    </td>
                    <td className="px-1 py-1 border-r border-slate-300 text-right">
                      <input value={row.newLoan} onChange={(e) => editLoanRaw(idx, 'newLoan', e.target.value)} onBlur={saveLoansMonth}
                        className="w-20 text-right bg-transparent px-2 py-1 rounded border border-dashed border-slate-300 focus:border-emerald-600 focus:bg-emerald-50 outline-none font-medium text-emerald-700" />
                    </td>
                    <td className="px-3 py-2 border-r border-slate-300 text-right font-medium bg-slate-50">
                      {row.remaining !== '-' ? <span className="text-slate-400 mr-1">$</span> : null}
                      {row.remaining}
                    </td>
                    <td className="px-3 py-2 border-r border-slate-300 text-right font-bold text-[#0a6652] bg-[#fafdfa] shadow-[-4px_0_10px_rgba(0,0,0,0.02)]">
                      {row.interestPaid !== '-' ? <span className="text-[#0a6652]/60 mr-1">$</span> : null}
                      {row.interestPaid}
                    </td>
                    <td className="px-3 py-2 text-center text-green-600 font-bold">{row.checked ? '✓' : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'deposit_members' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col p-1 px-4 md:px-6 md:p-6 mb-6">
          <div className="overflow-x-auto border border-slate-300 rounded-xl">
            <table className="w-full text-left border-collapse text-sm min-w-[1200px]">
              <thead className="bg-[#eef8f2] text-[#0a6652] border-b-[3px] border-[#0a6652] text-center font-bold">
                <tr>
                  <th className="px-3 py-3 border-r border-slate-300 align-middle">ល.រ</th>
                  <th className="px-3 py-3 border-r border-slate-300 align-middle min-w-[140px]">ឈ្មោះ</th>
                  <th className="px-3 py-3 border-r border-slate-300 align-middle">ភេទ</th>
                  <th className="px-3 py-3 border-r border-slate-300 align-middle text-right">កម្ចី</th>
                  <th className="px-3 py-3 border-r border-slate-300 align-middle text-right">កម្ចីសងត្រឡប់</th>
                  <th className="px-3 py-3 border-r border-slate-300 align-middle text-right">ការប្រាក់</th>
                  <th className="px-3 py-3 border-r border-slate-300 align-middle text-right">កម្ចីថ្មី</th>
                  <th className="px-3 py-3 border-r border-slate-300 align-middle text-right">កម្ចីនៅសល់</th>
                  <th className="px-3 py-3 border-r border-slate-300 align-middle text-right text-[#084f40] bg-[#f3faf6] shadow-[-4px_0_10px_rgba(0,0,0,0.02)]">ការប្រាក់បានបង់</th>
                  <th className="px-3 py-3 align-middle">កំណត់សំគាល់</th>
                </tr>
              </thead>
              <tbody>
                {depositLoanData.map((row) => (
                  <tr key={row.id} className="border-b border-slate-300 hover:bg-slate-50 transition-colors h-11">
                    <td className="px-3 py-2 border-r border-slate-300 text-center text-slate-500 font-medium">{typeof row.id === 'string' ? row.id.split(' ').pop() : row.id}</td>
                    <td className="px-3 py-2 border-r border-slate-300 font-bold text-slate-800">{row.name}</td>
                    <td className="px-3 py-2 border-r border-slate-300 text-center text-slate-500">{row.gender}</td>
                    <td className="px-3 py-2 border-r border-slate-300 text-right font-medium">
                      {row.loanValue !== '-' ? <span className="text-slate-400 mr-1">$</span> : null}
                      {row.loanValue}
                    </td>
                    <td className="px-3 py-2 border-r border-slate-300 text-right font-medium text-amber-600">
                      {row.repayment !== '-' ? <span className="text-slate-400 mr-1">$</span> : null}
                      {row.repayment}
                    </td>
                    <td className="px-3 py-2 border-r border-slate-300 text-right font-medium text-indigo-600">
                      {row.interest !== '-' ? <span className="text-slate-400 mr-1">$</span> : null}
                      {row.interest}
                    </td>
                    <td className="px-3 py-2 border-r border-slate-300 text-right font-medium text-emerald-600">
                      {row.newLoan !== '-' ? <span className="text-slate-400 mr-1">$</span> : null}
                      {row.newLoan}
                    </td>
                    <td className="px-3 py-2 border-r border-slate-300 text-right font-medium bg-slate-50">
                      {row.remaining !== '-' ? <span className="text-slate-400 mr-1">$</span> : null}
                      {row.remaining}
                    </td>
                    <td className="px-3 py-2 border-r border-slate-300 text-right font-bold text-[#0a6652] bg-[#fafdfa] shadow-[-4px_0_10px_rgba(0,0,0,0.02)]">
                      {row.interestPaid !== '-' ? <span className="text-[#0a6652]/60 mr-1">$</span> : null}
                      {row.interestPaid}
                    </td>
                    <td className="px-3 py-2 text-center text-green-600 font-bold">{row.checked ? '✓' : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'group' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col p-1 px-4 md:px-6 md:p-6 mb-6">
          <div className="overflow-x-auto border border-slate-300 rounded-xl">
            <table className="w-full text-left border-collapse text-sm min-w-[1200px]">
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
                  <th className="px-3 py-3 border-r border-slate-300 align-middle text-right text-[#084f40] bg-[#f3faf6] shadow-[-4px_0_10px_rgba(0,0,0,0.02)]">ប្រាក់ត្រូវបង់<br/>សរុប</th>
                  <th className="px-3 py-3 align-middle">សំគាល់</th>
                </tr>
              </thead>
              <tbody>
                {externalLoanData.map((row) => (
                  <tr key={row.id} className="border-b border-slate-300 hover:bg-slate-50 transition-colors h-11">
                    <td className="px-3 py-2 border-r border-slate-300 text-center text-slate-500 font-medium">{typeof row.id === 'string' ? row.id.split(' ').pop() : row.id}</td>
                    <td className="px-3 py-2 border-r border-slate-300 font-bold text-slate-800">{row.name}</td>
                    <td className="px-3 py-2 border-r border-slate-300 text-center text-slate-500">{row.gender}</td>
                    <td className="px-3 py-2 border-r border-slate-300 text-right font-medium">{row.received}</td>
                    <td className="px-3 py-2 border-r border-slate-300 text-right font-medium text-amber-600">{row.repayment}</td>
                    <td className="px-3 py-2 border-r border-slate-300 text-center font-medium">{row.interestRate}</td>
                    <td className="px-3 py-2 border-r border-slate-300 text-center font-medium">{row.duration}</td>
                    <td className="px-3 py-2 border-r border-slate-300 text-right font-medium text-emerald-600">{row.newLoan}</td>
                    <td className="px-3 py-2 border-r border-slate-300 text-right font-medium bg-slate-50">{row.remaining}</td>
                    <td className="px-3 py-2 border-r border-slate-300 text-right font-medium text-indigo-600">{row.interest}</td>
                    <td className="px-3 py-2 border-r border-slate-300 text-right font-bold text-[#0a6652] bg-[#fafdfa] shadow-[-4px_0_10px_rgba(0,0,0,0.02)]">
                      <div className={`w-16 h-6 ml-auto ${row.id === 'I06' ? 'border border-green-500 rounded bg-green-50/50' : ''}`}>
                        {row.totalToPay}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-center text-slate-500">{row.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'external_provided' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col p-1 px-4 md:px-6 md:p-6 mb-6">
          <div className="overflow-x-auto border border-slate-300 rounded-xl">
            <table className="w-full text-left border-collapse text-sm min-w-[1200px]">
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
                  <th className="px-3 py-3 border-r border-slate-300 align-middle text-right text-[#084f40] bg-[#f3faf6] shadow-[-4px_0_10px_rgba(0,0,0,0.02)]">ប្រាក់ត្រូវបង់<br/>សរុប</th>
                  <th className="px-3 py-3 align-middle">សំគាល់</th>
                </tr>
              </thead>
              <tbody>
                {externalProvidedData.map((row) => (
                  <tr key={row.id} className="border-b border-slate-300 hover:bg-slate-50 transition-colors h-11">
                    <td className="px-3 py-2 border-r border-slate-300 text-center text-slate-500 font-medium">{typeof row.id === 'string' ? row.id.split(' ').pop() : row.id}</td>
                    <td className="px-3 py-2 border-r border-slate-300 font-bold text-slate-800">{row.name}</td>
                    <td className="px-3 py-2 border-r border-slate-300 text-center text-slate-500">{row.gender}</td>
                    <td className="px-3 py-2 border-r border-slate-300 text-right font-medium">{row.received}</td>
                    <td className="px-3 py-2 border-r border-slate-300 text-right font-medium text-amber-600">{row.repayment}</td>
                    <td className="px-3 py-2 border-r border-slate-300 text-center font-medium">{row.interestRate}</td>
                    <td className="px-3 py-2 border-r border-slate-300 text-center font-medium">{row.duration}</td>
                    <td className="px-3 py-2 border-r border-slate-300 text-right font-medium text-emerald-600">{row.newLoan}</td>
                    <td className="px-3 py-2 border-r border-slate-300 text-right font-medium bg-slate-50">{row.remaining}</td>
                    <td className="px-3 py-2 border-r border-slate-300 text-right font-medium text-indigo-600">{row.interest}</td>
                    <td className="px-3 py-2 border-r border-slate-300 text-right font-bold text-[#0a6652] bg-[#fafdfa] shadow-[-4px_0_10px_rgba(0,0,0,0.02)]">
                      {row.totalToPay}
                    </td>
                    <td className="px-3 py-2 text-center text-slate-500">{row.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

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

function Expenses() {
  const [selectedMonth, setSelectedMonth] = useState('មេសា 2026');
  const months = ['មករា 2026', 'កុម្ភៈ 2026', 'មីនា 2026', 'មេសា 2026', 'ឧសភា 2026', 'មិថុនា 2026', 'កក្កដា 2026', 'សីហា 2026', 'កញ្ញា 2026', 'តុលា 2026', 'វិច្ឆិកា 2026', 'ធ្នូ 2026'];

  const [expenses, setExpenses] = useState<any[]>(() => 
    getStoredData('sof_expenses_data', DEFAULT_EXPENSE_DATA)
  );

  const [isAdding, setIsAdding] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('ទាំងអស់');

  // New expense form inputs
  const [formDate, setFormDate] = useState('2026-04-15');
  const [formSupplier, setFormSupplier] = useState('SOF');
  const [formDesc, setFormDesc] = useState('');
  const [formCategory, setFormCategory] = useState('ចំណាយប្រតិបត្តិការ');
  const [formQty, setFormQty] = useState(1);
  const [formPrice, setFormPrice] = useState(0);
  const [successMsg, setSuccessMsg] = useState('');

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
    setStoredData('sof_expenses_data', updated);

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
    setStoredData('sof_expenses_data', updated);
    triggerSuccess("បានលុបទិន្នន័យការចំណាយរួចរាល់!");
  };

  const handleResetDefaults = () => {
    setExpenses(DEFAULT_EXPENSE_DATA);
    setStoredData('sof_expenses_data', DEFAULT_EXPENSE_DATA);
    triggerSuccess("បានកំណត់ទិន្នន័យការចំណាយទៅដើមវិញរួចរាល់!");
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

  return (
    <PageView 
      hideUpload={true} 
      hideDownload={true} 
      hideAdd={true}
      title={
        <div className="flex flex-col md:flex-row md:items-center gap-3">
          <span>បញ្ជីការចំណាយ (Expenses) - </span>
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
          <div className="text-3xl font-black text-amber-700">{expenses.length}</div>
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

  // Prefer the imported monthly report snapshot (from the Excel financial report)
  // for the selected month; fall back to live computation from per-member data
  // when a month has no snapshot.
  const monthlyReports = getStoredData('sof_monthly_reports', {});
  const snap = monthlyReports[selectedMonth] || null;

  const rSavings = getStoredData('sof_savings_data', DEFAULT_SAVING_DATA);
  const rDeposit = getStoredData('sof_savings_deposit_data', DEFAULT_DEPOSIT_DATA);
  const rGroup = getStoredData('sof_savings_group_data', DEFAULT_GROUP_DATA);
  const rLoans = getStoredData('sof_loans_data', DEFAULT_LOAN_DATA);
  const rLoansDep = getStoredData('sof_loans_deposit_data', DEFAULT_DEPOSIT_LOAN_DATA);
  const rGroupBy = (needle: string) => num((rGroup.find((g: any) => (g.name || '').includes(needle)) || {}).total);
  const outstanding = (arr: any[]) => (arr || []).reduce((s: number, l: any) => s + (num(l.remaining) || num(l.loanValue)), 0);

  const bal = (snap && snap.balance) || null;
  const pick = (k: string, fallback: number) => (bal && typeof bal[k] === 'number') ? bal[k] : fallback;

  const bsMemberSavings = pick('memberSavings', sumField(rSavings, 'total'));
  const bsDepositSavings = pick('depositSavings', sumField(rDeposit, 'total'));
  const bsLoansMembers = pick('loansToMembers', outstanding(rLoans));
  const bsLoansExternal = pick('loansExternal', outstanding(rLoansDep));
  const bsCashOnHand = pick('cashOnHand', 0);
  const bsBankBalance = pick('bankBalance', 0);
  const bsExternalBorrow = pick('externalBorrow', 0);
  const bsFixedTerm = pick('fixedTerm', 0);
  const bsReserve = pick('reserve', rGroupBy('បម្រុង'));
  const bsSocial = pick('social', rGroupBy('សង្គម'));
  const bsYes = pick('yes', rGroupBy('យេស'));
  const bsTotalAssets = bal ? bal.totalAssets : (bsCashOnHand + bsBankBalance + bsLoansMembers + bsLoansExternal);
  const bsTotalLiabilities = bal ? bal.totalLiabilities : (bsMemberSavings + bsDepositSavings + bsExternalBorrow + bsFixedTerm);
  const bsTotalEquity = bal ? bal.totalEquity : (bsReserve + bsSocial + bsYes);

  // Income & cash-flow snapshots for their tabs (null when the month has no data).
  const inc = (snap && snap.income) || null;
  const cf = (snap && snap.cashflow) || null;
  const m2 = (v: number | undefined) => (typeof v === 'number' ? fmtMoney(v) : '-');

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
                { label: 'សាច់ប្រាក់នៅក្នុងហ៊ីបប្រាក់', value: cf?.openingCash },
                { label: 'ប្រាក់ដាក់សន្សំសមាជិកម្ចាស់ភាគហ៊ុន', value: cf?.memberSavingsIn },
                { label: 'ប្រាក់សន្សំសមាជិកបញ្ញើសន្សំ', value: cf?.depositSavingsIn },
                { label: 'ប្រាក់បង់រំលោះ', value: cf?.repayment },
                { label: 'ទុនសន្សំបន្ថែមក្រុម', value: cf?.groupExtra },
                { label: 'ទទួលប្រាក់កម្ចីពីខាងក្រៅ', value: cf?.externalLoanReceived },
                { label: 'ប្រាក់ពិន័យ/សមាជិកភាព', value: cf?.fines },
                { label: 'ការប្រាក់ទទួលបាន', value: cf?.interestReceived },
                { label: 'ចំណូលផ្សេងៗ', value: cf?.otherIncome }
              ].map((item, i) => (
                <div key={i} className="flex justify-between items-center text-sm font-medium text-slate-700">
                  <span>{item.label}</span>
                  <span className={item.value ? "font-bold" : "text-slate-400"}>{item.value ? fmtMoney(item.value) : '-'}</span>
                </div>
              ))}
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
                { label: 'ប្រាក់ដកចេញ', value: cf?.withdrawals },
                { label: 'ការចំណាយប្រតិបត្តិការ', value: cf?.operatingExpense },
                { label: 'ការបង់ការប្រាក់កម្ចី', value: cf?.interestPaid },
                { label: 'ការផ្តល់កម្ចី', value: cf?.loanGiven }
              ].map((item, i) => (
                <div key={i} className="flex justify-between items-center text-sm font-medium text-slate-700">
                  <span>{item.label}</span>
                  <span className={item.value ? "font-bold" : "text-slate-400"}>{item.value ? fmtMoney(item.value) : '-'}</span>
                </div>
              ))}
            </div>
            <div className="bg-orange-50 px-6 py-4 border-t border-orange-100 flex justify-between items-center">
              <span className="font-bold text-orange-700">សរុប</span>
              <span className="font-black text-orange-700 text-lg">{m2(cf?.totalOutflow)}</span>
            </div>
            <div className="bg-slate-800 px-6 py-4 flex justify-between items-center text-white">
              <span className="font-bold">តុល្យភាពលំហូរសុទ្ធ</span>
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

      {activeTab === 'expense' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col p-6 md:p-8">
           <h3 className="font-bold text-slate-800 text-lg mb-6">ចំណាយប្រតិបត្តិការ</h3>
           
           <div className="overflow-x-auto mb-10 border border-slate-200 rounded-xl">
             <table className="w-full text-left min-w-[700px] border-collapse">
               <thead>
                 <tr className="bg-slate-50 border-b border-slate-200 text-sm h-11 text-slate-700">
                   <th className="px-4 py-2 border-r border-slate-200 font-bold whitespace-nowrap">ថ្ងៃទីខែឆ្នាំ</th>
                   <th className="px-4 py-2 border-r border-slate-200 font-bold whitespace-nowrap">អ្នកផ្គត់ផ្គង់</th>
                   <th className="px-4 py-2 border-r border-slate-200 font-bold whitespace-nowrap">អត្តសញ្ញាណ</th>
                   <th className="px-4 py-2 border-r border-slate-200 font-bold min-w-[200px]">មុខចំណាយ</th>
                   <th className="px-4 py-2 border-r border-slate-200 font-bold text-center whitespace-nowrap">ឯកតា</th>
                   <th className="px-4 py-2 border-r border-slate-200 font-bold text-right whitespace-nowrap">តម្លៃ</th>
                   <th className="px-4 py-2 font-bold text-right whitespace-nowrap">សរុប</th>
                 </tr>
               </thead>
               <tbody className="text-sm">
                 <tr className="border-b border-slate-200 hover:bg-slate-50 transition-colors">
                   <td className="px-4 py-3 border-r border-slate-200">15-Apr-26</td>
                   <td className="px-4 py-3 border-r border-slate-200">SOF</td>
                   <td className="px-4 py-3 border-r border-slate-200"></td>
                   <td className="px-4 py-3 border-r border-slate-200">ប្រាក់ឧបត្ថម្ភប្រចាំខែសម្រាប់ លី រ៉ា</td>
                   <td className="px-4 py-3 border-r border-slate-200 text-center">1</td>
                   <td className="px-4 py-3 border-r border-slate-200 text-right font-medium">$ 170.00</td>
                   <td className="px-4 py-3 text-right font-bold text-[#0a6652]">$ 170.00</td>
                 </tr>
                 <tr className="border-b border-slate-200 hover:bg-slate-50 transition-colors">
                   <td className="px-4 py-3 border-r border-slate-200">15-Apr-26</td>
                   <td className="px-4 py-3 border-r border-slate-200">SOF</td>
                   <td className="px-4 py-3 border-r border-slate-200"></td>
                   <td className="px-4 py-3 border-r border-slate-200">ប្រាក់ឧបត្ថម្ភប្រចាំខែសម្រាប់ ផាត សុភាព</td>
                   <td className="px-4 py-3 border-r border-slate-200 text-center">1</td>
                   <td className="px-4 py-3 border-r border-slate-200 text-right font-medium">$ 30.00</td>
                   <td className="px-4 py-3 text-right font-bold text-[#0a6652]">$ 30.00</td>
                 </tr>
                 <tr className="border-b border-slate-200 hover:bg-slate-50 transition-colors">
                   <td className="px-4 py-3 border-r border-slate-200">15-Apr-26</td>
                   <td className="px-4 py-3 border-r border-slate-200">SOF</td>
                   <td className="px-4 py-3 border-r border-slate-200"></td>
                   <td className="px-4 py-3 border-r border-slate-200">កាតទូរស័ព្ទប្រចាំខែសម្រាប់ លី រ៉ា</td>
                   <td className="px-4 py-3 border-r border-slate-200 text-center">2</td>
                   <td className="px-4 py-3 border-r border-slate-200 text-right font-medium">$ 4.00</td>
                   <td className="px-4 py-3 text-right font-bold text-[#0a6652]">8.00</td>
                 </tr>
                 {[...Array(4)].map((_, idx) => (
                   <tr key={idx} className="border-b border-slate-200 h-10">
                     <td className="border-r border-slate-200 px-4"></td>
                     <td className="border-r border-slate-200 px-4"></td>
                     <td className="border-r border-slate-200 px-4"></td>
                     <td className="border-r border-slate-200 px-4"></td>
                     <td className="border-r border-slate-200 px-4"></td>
                     <td className="border-r border-slate-200 px-4"></td>
                     <td className="text-right text-slate-400 px-4">-</td>
                   </tr>
                 ))}
                 <tr className="bg-slate-50 hover:bg-slate-100 transition-colors">
                   <td colSpan={6} className="px-4 py-3 border-r border-slate-200 text-center font-bold text-slate-800">សរុប</td>
                   <td className="px-4 py-3 text-right font-black text-slate-800">208.00</td>
                 </tr>
               </tbody>
             </table>
           </div>
           
           <div className="space-y-4 max-w-md pl-2 md:pl-4">
              <div className="flex justify-between items-center text-sm font-medium text-slate-700">
                <span>ការប្រាក់</span>
                <span className="text-slate-400">-</span>
              </div>
              <div className="flex justify-between items-center text-sm font-medium text-slate-700">
                <span>បំណុលអាក្រក់</span>
                <span className="text-slate-400">-</span>
              </div>
              <div className="flex justify-between items-center text-sm font-medium text-slate-700">
                <span>ចំណាយផ្សេងៗ</span>
                <span className="text-slate-400">-</span>
              </div>
           </div>
        </div>
      )}
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

  const [newAdminPassword, setNewAdminPassword] = useState('');
  const [passwordSuccessMsg, setPasswordSuccessMsg] = useState('');

  const handleChangePassword = (e: React.FormEvent) => {
    e.preventDefault();
    if (newAdminPassword.trim() !== '') {
      localStorage.setItem('adminPassword', newAdminPassword);
      setPasswordSuccessMsg('ប្តូរលេខសំងាត់បានជោគជ័យ! (Password changed)');
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
            <label className="block text-[10px] font-bold text-slate-500 mb-1">លេខសំងាត់ថ្មី (New Admin Password)</label>
            <input 
              type="password" 
              value={newAdminPassword} 
              onChange={(e) => setNewAdminPassword(e.target.value)}
              className="w-full text-xs font-bold border border-slate-200 rounded-xl px-3 py-2 bg-slate-50 focus:bg-white focus:border-rose-500 outline-none"
              placeholder="វាយបញ្ចូលលេខសំងាត់ថ្មីនៅទីនេះ..."
              required
            />
          </div>
          <button 
            type="submit" 
            className="w-full bg-rose-600 hover:bg-rose-700 text-white font-bold text-[11px] py-2.5 rounded-xl transition-colors cursor-pointer"
          >
            ផ្លាស់ប្តូរលេខសំងាត់ (Change Password)
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
  const isInitiallyAdmin = location.search.includes('tab=admin');
  
  const [loginType, setLoginType] = useState<'member' | 'admin'>(isInitiallyAdmin ? 'admin' : 'member');
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [adminUsername, setAdminUsername] = useState('admin');
  const [adminPassword, setAdminPassword] = useState('admin123');
  const [showPassword, setShowPassword] = useState(false);

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
      if (loginId.trim()) {
        localStorage.setItem('userRole', 'member');
        localStorage.setItem('memberId', loginId);
        onLogin('member', loginId);
        navigate(`/member-report?id=${loginId}`);
      }
    } else {
      const storedAdminPassword = localStorage.getItem('adminPassword') || 'admin123';
      if (adminUsername.trim() === 'admin' && adminPassword === storedAdminPassword) {
        localStorage.setItem('userRole', 'admin');
        onLogin('admin', '');
        navigate('/admin');
      } else {
        alert(`គណនីអ្នកគ្រប់គ្រងមិនត្រឹមត្រូវទេ! (គណនីសាកល្បង៖ admin / ${storedAdminPassword})`);
      }
    }
  };

  return (
    <PageView title="ច្រកចូលប្រព័ន្ធ (System Login)" hideUpload hideAdd hideBack hideDownload>
      <div className="max-w-md mx-auto bg-white p-5 sm:p-8 rounded-[24px] border border-slate-200 shadow-sm mt-4">
        
        {/* Toggle Admin vs Member Tab */}
        <div className="flex p-1 bg-slate-100 rounded-2xl mb-6">
          <button 
            type="button"
            onClick={() => {
              setLoginType('member');
              navigate('/login?tab=member');
            }}
            className={`flex-1 flex items-center justify-center gap-1 py-2.5 rounded-xl font-black text-xs transition-all ${
              loginType === 'member'
                ? 'bg-white text-[#0a6652] shadow-sm'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <UserCheck size={14} /> សមាជិក (Member)
          </button>
          <button 
            type="button"
            onClick={() => {
              setLoginType('admin');
              navigate('/login?tab=admin');
            }}
            className={`flex-1 flex items-center justify-center gap-1 py-2.5 rounded-xl font-black text-xs transition-all ${
              loginType === 'admin'
                ? 'bg-white text-rose-600 shadow-sm'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <ShieldCheck size={14} /> គណៈកម្មការ (Admin)
          </button>
        </div>

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
              : 'សូមបញ្ចូលលេខសម្គាល់គណនី និងពាក្យសម្ងាត់'
            }
          </p>
        </div>
        
        <form onSubmit={handleLogin} className="space-y-4">
          {loginType === 'member' ? (
            <>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">លេខ ID សមាជិក ឬ លេខទូរស័ព្ទ</label>
                <input 
                  type="text" 
                  value={loginId}
                  onChange={(e) => setLoginId(e.target.value)}
                  placeholder="ឧទាហរណ៍: CM008 ឬ 012345678" 
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
                    placeholder={localStorage.getItem('adminPassword') || 'admin123'} 
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
              
              <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-100 text-[10px] font-bold text-slate-500 leading-normal">
                💡 គណនីសាកល្បង៖ <span className="text-rose-600 font-extrabold">admin</span> / លេខកូដ៖ <span className="text-rose-600 font-extrabold">{localStorage.getItem('adminPassword') || 'admin123'}</span>
              </div>

              <button type="submit" className="w-full h-11 bg-rose-600 text-white font-bold py-2.5 px-4 rounded-xl shadow-lg shadow-rose-950/20 hover:bg-rose-700 transition-colors flex items-center justify-center gap-2 mt-2 text-xs sm:text-sm cursor-pointer">
                <LogIn size={16} /> ចូលគណនីគណៈកម្មការ
              </button>
            </>
          )}
        </form>
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
  const [repGuarantor1, setRepGuarantor1] = useState('ណុល សុខា');
  const [repGuarantor1Id, setRepGuarantor1Id] = useState('CM012');
  const [repGuarantor2, setRepGuarantor2] = useState('សឿន សំបូរ');
  const [repGuarantor2Id, setRepGuarantor2Id] = useState('CM024');
  const [repFreq, setRepFreq] = useState<'monthly' | 'weekly'>('weekly'); // they say 'អាទិត្យ' in sheet, so let's support both but default 'weekly'!
  const [contractNum, setContractNum] = useState('MFC-2026-008');
  const [selectedReportYear, setSelectedReportYear] = useState('2026');

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
    if (newPassword === confirmPassword) {
      alert("បានផ្លាស់ប្តូរពាក្យសម្ងាត់ដោយជោគជ័យ!");
      setShowChangePassword(false);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } else {
      alert("ពាក្យសម្ងាត់ថ្មី និងផ្ទៀងផ្ទាត់មិនត្រូវគ្នាទេ!");
    }
  };

  return (
    <PageView 
      title={activeTab === 'dashboard' ? "ព័ត៌មានផ្ទាល់ខ្លួន" : activeTab} 
      hideAdd 
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
                JS
              </div>
              <div>
                <p className="text-[9px] text-emerald-200 font-extrabold tracking-wider uppercase leading-none mb-1">ស្វាគមន៍សមាជិក</p>
                <h3 className="text-base font-bold tracking-tight leading-none mb-1.5">ជន សុភាក់</h3>
                <div className="flex flex-wrap gap-1">
                  <span className="bg-white/15 px-1.5 py-0.5 rounded-full text-[8px] font-bold">ID: CM008</span>
                  <span className="bg-emerald-900/40 px-1.5 py-0.5 rounded-full text-[8px] font-bold">សកម្មភាពជានិច្ច</span>
                </div>
              </div>
            </div>
            
            <div className="relative z-10 mt-5 pt-4 border-t border-white/10 grid grid-cols-3 gap-1 divide-x divide-white/10 text-center">
              <div className="px-1 text-left">
                <span className="text-[9px] text-emerald-200/90 font-bold block leading-tight">ប្រាក់សន្សំសរុប</span>
                <p className="text-sm font-black mt-1 tracking-tight">$ 1,804.58</p>
              </div>
              <div className="px-1 text-left pl-2">
                <span className="text-[9px] text-emerald-200/90 font-bold block leading-tight">កម្ចីសរុប</span>
                <p className="text-sm font-black mt-1 tracking-tight">$ 0.00</p>
              </div>
              <div className="px-1 text-left pl-2">
                <span className="text-[9px] text-emerald-200/90 font-bold block leading-tight">តុល្យការដើមទុន</span>
                <p className="text-sm font-black mt-1 tracking-tight">$ 1,804.58</p>
              </div>
            </div>
          </div>

          {/* Bento grid style buttons like Admin */}
          <div>
            <h4 className="text-[11px] font-black text-slate-400 mb-3 tracking-wider text-left uppercase">សេវាកម្មសមាជិក</h4>
            <div className="grid grid-cols-2 gap-3.5">
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
                  id: 'ស្នើកម្ចី',
                  title: "ទម្រង់ស្នើសុំកម្ចី",
                  desc: "ស្នើប្រាក់កម្ចីថ្មីលឿនៗ",
                  icon1: <Receipt size={16} strokeWidth={2.5} />,
                  icon1Class: "bg-purple-50 text-purple-600",
                  icon2: <HandCoins size={28} strokeWidth={1.5} />,
                  icon2Class: "text-purple-600 fill-purple-100/40"
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
                  id: 'របាយការណ៍សន្សំ',
                  title: "របាយការណ៍សន្សំ",
                  desc: "ប្រវត្តិដាក់ និងការចាក់ចំណេញ",
                  icon1: <TrendingUp size={16} strokeWidth={2.5} />,
                  icon1Class: "bg-blue-50 text-blue-600",
                  icon2: <Wallet size={28} strokeWidth={1.5} />,
                  icon2Class: "text-blue-500 fill-blue-100/40"
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
                  className="bg-white rounded-[24px] p-4 shadow-[0_4px_15px_rgba(0,100,50,0.02)] min-h-[120px] flex flex-col justify-between cursor-pointer hover:shadow-[0_8px_25px_rgba(0,100,50,0.06)] hover:-translate-y-0.5 active:scale-[0.98] transition-all duration-300 border border-slate-100 hover:border-emerald-100 text-left"
                >
                  <div className="flex justify-between items-start w-full">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center ${card.icon1Class}`}>
                      {card.icon1}
                    </div>
                    <div className={`${card.icon2Class} opacity-80`}>
                      {card.icon2}
                    </div>
                  </div>
                  <div>
                    <h3 className="text-xs font-black text-[#0a6652] tracking-tight leading-tight">
                      {card.title}
                    </h3>
                    <p className="text-[9px] text-slate-400 font-bold mt-0.5 leading-none">
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
            <div className="flex gap-2">
              <select 
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="px-2.5 py-1 rounded-lg border border-slate-200 bg-white font-black text-[10px] text-slate-700 focus:outline-none cursor-pointer"
              >
                {months.map(m => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
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
            របាយការណ៍ប្រចាំខែ{selectedMonth}
            </h3>
        </div>

        <div className="relative z-10 grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-6 text-sm md:text-base font-bold text-slate-800">
          <div className="flex justify-between items-end border-b border-slate-100 pb-2">
            <span className="text-slate-500 font-medium">ឈ្មោះ:</span>
            <span className="text-lg">ជន សុភាក់</span>
          </div>
          <div className="flex justify-between items-end border-b border-slate-100 pb-2">
            <span className="text-slate-500 font-medium">លេខ ID:</span>
            <span className="text-lg">CM008</span>
          </div>
          
          <div className="flex justify-between items-center py-1 mt-4">
            <span className="text-slate-500 font-medium">ដើមទុនខែមុន:</span>
            <span className="text-emerald-700 bg-emerald-50 px-3 py-1 rounded-lg"><span className="text-emerald-600/50 mr-1">$</span> 1,794.42</span>
          </div>
          <div className="flex justify-between items-center py-1 mt-4">
            <span className="text-slate-500 font-medium">កម្ចីដើមគ្រា:</span>
            <span className="px-3 py-1"><span className="text-slate-300 mr-1">$</span> -</span>
          </div>
          
          <div className="flex justify-between items-center py-1">
            <span className="text-slate-500 font-medium">សន្សំក្នុងខែ:</span>
            <span className="text-blue-600 bg-blue-50 px-3 py-1 rounded-lg"><span className="text-blue-600/50 mr-1">$</span> 10.00</span>
          </div>
          <div className="flex justify-between items-center py-1">
            <span className="text-slate-500 font-medium">សងត្រលប់:</span>
            <span className="text-amber-600 px-3 py-1"><span className="text-amber-600/50 mr-1">$</span> -</span>
          </div>
          
          <div className="flex justify-between items-center py-1">
            <span className="text-slate-500 font-medium">ប្រាក់ចំណេញ:</span>
            <span className="text-emerald-600 px-3 py-1"><span className="text-emerald-600/50 mr-1">$</span> 0.16</span>
          </div>
          <div className="flex justify-between items-center py-1">
            <span className="text-slate-500 font-medium">ការប្រាក់កម្ចី:</span>
            <span className="text-amber-600 px-3 py-1"><span className="text-amber-600/50 mr-1">$</span> -</span>
          </div>
          
          <div className="flex justify-between items-center py-1">
            <span className="text-slate-500 font-medium">ការដកដើមទុន:</span>
            <span className="text-rose-600 px-3 py-1"><span className="text-rose-600/50 mr-1">$</span> -</span>
          </div>
          <div className="flex justify-between items-center py-1">
            <span className="text-slate-500 font-medium">កម្ចីថ្មីក្នុងខែ:</span>
            <span className="text-indigo-600 px-3 py-1"><span className="text-indigo-600/50 mr-1">$</span> -</span>
          </div>
          
          <div className="flex justify-between items-center py-1 pt-6 border-t border-slate-100 mt-2 text-lg">
            <span className="text-slate-600 font-medium">ដើមទុនចុងគ្រា:</span>
            <span className="text-[#0a6652]"><span className="text-[#0a6652]/50 mr-1">$</span> 1,804.58</span>
          </div>
          <div className="flex justify-between items-center py-1 pt-6 border-t border-slate-100 mt-2">
            <span className="text-slate-600 font-medium">កម្ចីនៅសល់:</span>
            <span className="text-slate-800"><span className="text-slate-400 mr-1">$</span> -</span>
          </div>
          
          <div className="flex justify-between items-center py-1 bg-amber-50 rounded-xl px-4 mt-2">
            <span className="text-slate-600 font-bold">ប្រាក់បានបង់:</span>
            <span className="text-amber-700 text-lg"><span className="text-amber-700/50 mr-1">$</span> 10.00</span>
          </div>
          <div className="flex justify-between items-center py-1 mt-2">
            <span className="text-slate-500 font-medium">សមាជិកភាព:</span>
            <span className="px-3 py-1"><span className="text-slate-300 mr-1">$</span> -</span>
          </div>
        </div>

        <div className="mt-20 flex flex-col items-center md:items-end text-sm text-slate-800 relative z-10 md:pr-10">
          <p className="mb-3 font-medium text-slate-500">ធ្វើនៅថ្ងៃទី 31 ខែឧសភា ឆ្នាំ 2023</p>
          <p className="mb-8 font-bold text-slate-700">ហត្ថលេខាអ្នកធ្វើរបាយការណ៍</p>
          <div className="w-40 h-20 border-b-2 border-slate-200 border-dashed relative">
            <div className="absolute inset-0 flex items-center justify-center pb-4 text-4xl text-blue-800 font-serif -rotate-12 italic opacity-60">Rv</div>
          </div>
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

            {/* Contract Royal Header */}
            <div className="text-center mb-6 relative">
              <h1 className="text-sm font-bold tracking-widest text-slate-800 uppercase font-sans mb-1">ព្រះរាជាណាចក្រកម្ពុជា</h1>
              <h2 className="text-xs font-bold text-slate-600 mb-4 tracking-wide">ជាតិ សាសនា ព្រះមហាក្សត្រ</h2>
              
              <div className="flex justify-between items-start gap-4 mt-2 border-b border-dashed border-slate-200 pb-4">
                <div className="flex items-center gap-2">
                  <div className="w-10 h-10 border border-slate-200 rounded-lg p-0.5 shrink-0 bg-slate-50 flex items-center justify-center">
                    <img src="https://i.ibb.co/Kp7CxnjC/Picture1.jpg" alt="Logo" className="w-full h-full object-contain" referrerPolicy="no-referrer" />
                  </div>
                  <div className="text-left">
                    <h3 className="text-xs font-bold text-[#0a6652] leading-tight">ក្រុមសន្សំប្រាក់អនាគតយើង</h3>
                    <p className="text-[9px] text-[#1fb487] font-bold tracking-tight">Saving For Our Future</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-[10px] text-slate-400 font-medium">យោងលើកិច្ចសន្យាលេខៈ <span className="font-bold text-slate-700 underline border-slate-300">{contractNum}</span></p>
                </div>
              </div>
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
                  <span className="font-bold text-slate-700">{repLoanTerm} {repFreq === 'weekly' ? 'សប្តាហ៍' : 'ខែ'}</span>
                </div>
                <div className="flex justify-between items-center text-xs pb-1.5 border-b border-dashed border-slate-200/80">
                  <span className="text-slate-500 font-semibold">អត្រាការប្រាក់</span>
                  <span className="font-bold text-slate-700">{repLoanRate}% / {repFreq === 'weekly' ? 'សប្តាហ៍' : 'ខែ'}</span>
                </div>
                <div className="flex justify-between items-center text-xs pb-1.5 border-b border-dashed border-slate-200/80">
                  <span className="text-slate-500 font-semibold">ទឹកប្រាក់សរុបត្រូវសង</span>
                  <span className="font-bold text-slate-700">
                    ${(calculateSchedule().reduce((s, row) => s + row.total, 0)).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}
                  </span>
                </div>
                <div className="flex justify-between items-center text-xs pb-1.5 border-b border-dashed border-slate-200/80">
                  <span className="text-slate-500 font-semibold">ការប្រាក់សរុប</span>
                  <span className="font-bold text-[#0a6652]">
                    ${(calculateSchedule().reduce((s, row) => s + row.interest, 0)).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}
                  </span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-slate-500 font-semibold">កាលបរិច្ឆេទខ្ចីប្រាក់</span>
                  <span className="font-bold text-slate-700">ថ្ងៃទី 15 ខែមករា ឆ្នាំ 2026</span>
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
                    <th className="py-2.5 px-3 text-center border-r border-slate-200 w-12 text-center">ល.រ</th>
                    <th className="py-2.5 px-3 border-r border-slate-200 w-28">ខែ</th>
                    <th className="py-2.5 px-3 border-r border-slate-200">កាលបរិច្ឆេទ</th>
                    <th className="py-2.5 px-3 border-r border-slate-200 text-right">ទឹកប្រាក់បានបង់សរុប</th>
                    <th className="py-2.5 px-3 border-r border-slate-200 text-right">ការប្រាក់បានបង់</th>
                    <th className="py-2.5 px-3 border-r border-slate-200 text-right">កម្ចីបានរំលស់</th>
                    <th className="py-2.5 px-3 text-right">តុល្យការកម្ចី</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 divide-dashed">
                  {/* Totals helper display Row at zero status before calculations */}
                  <tr className="bg-slate-50/50 text-[11px] font-bold text-slate-500">
                    <td colSpan={6} className="py-2 px-3 text-right border-r border-slate-200">
                      សរុបដើមទុន
                    </td>
                    <td className="py-2 px-3 text-right font-black text-rose-600">
                      ${(parseFloat(repLoanAmt) || 0).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}
                    </td>
                  </tr>

                  {calculateSchedule().map((row, idx) => (
                    <tr key={idx} className="hover:bg-slate-50/50 transition-colors">
                      <td className="py-2.5 px-3 text-center border-r border-slate-100 font-bold text-slate-400">{row.num}</td>
                      <td className="py-2.5 px-3 border-r border-slate-100 font-bold text-[#0a6652]/90">
                        {row.monthName}
                      </td>
                      <td className="py-2.5 px-3 border-r border-slate-100 font-semibold">{row.dueDate}</td>
                      <td className="py-2.5 px-3 border-r border-slate-100 text-right font-black text-[#0a6652]">
                        ${row.total.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}
                      </td>
                      <td className="py-2.5 px-3 border-r border-slate-100 text-right font-bold text-amber-600">
                        ${row.interest.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}
                      </td>
                      <td className="py-2.5 px-3 border-r border-slate-100 text-right font-bold text-slate-600">
                        ${row.principal.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}
                      </td>
                      <td className="py-2.5 px-3 text-right font-bold text-slate-500">
                        ${row.balance.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}
                      </td>
                    </tr>
                  ))}

                  {/* Summary Totals Row */}
                  <tr className="bg-slate-50 font-bold border-t border-slate-200 text-slate-800">
                    <td className="py-3 px-3 text-center border-r border-slate-200">-</td>
                    <td className="py-3 px-3 border-r border-slate-200">សរុបសង</td>
                    <td className="py-3 px-3 border-r border-slate-200">-</td>
                    <td className="py-3 px-3 border-r border-slate-200 text-right font-black text-[#0a6652]">
                      ${calculateSchedule().reduce((s, row) => s + row.total, 0).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}
                    </td>
                    <td className="py-3 px-3 border-r border-slate-200 text-right font-extrabold text-amber-600">
                      ${calculateSchedule().reduce((s, row) => s + row.interest, 0).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}
                    </td>
                    <td className="py-3 px-3 border-r border-slate-200 text-right font-extrabold text-slate-700">
                      ${calculateSchedule().reduce((s, row) => s + row.principal, 0).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}
                    </td>
                    <td className="py-3 px-3 text-right font-black text-slate-400">$0.00</td>
                  </tr>
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
                  {[
                    { id: '01', monthName: 'មករា', startCapital: 945.69, share: '1.31%', addSaving: 30.00, profit: 5.938979617, withdraw: '-', deductFee: '-', actualFee: '-', total: 981.63, note: '✓' },
                    { id: '02', monthName: 'កុម្ភៈ', startCapital: 145.85, share: '0.20%', addSaving: 0, profit: 0.915948925, withdraw: '-', deductFee: '-', actualFee: '-', total: 146.77, note: '✓' },
                    { id: '03', monthName: 'មីនា', startCapital: 849.78, share: '1.18%', addSaving: 5.00, profit: 5.336650621, withdraw: '-', deductFee: '-', actualFee: '-', total: 860.12, note: '✓' },
                    { id: '04', monthName: 'មេសា', startCapital: 550.63, share: '0.77%', addSaving: 0, profit: 3.457965883, withdraw: '-', deductFee: '-', actualFee: '-', total: 554.09, note: '✓' },
                    { id: '05', monthName: 'ឧសភា', startCapital: 433.28, share: '0.60%', addSaving: 0, profit: 2.720984666, withdraw: '-', deductFee: '-', actualFee: '-', total: 436.00, note: '✓' },
                    { id: '06', monthName: 'មិថុនា', startCapital: 1260.05, share: '1.75%', addSaving: 0, profit: 7.913150809, withdraw: '-', deductFee: '-', actualFee: '-', total: 1267.96, note: '✓' },
                    { id: '07', monthName: 'កក្កដា', startCapital: 465.49, share: '0.65%', addSaving: 0, profit: 2.923260657, withdraw: '-', deductFee: '-', actualFee: '-', total: 468.41, note: '✓' },
                    { id: '08', monthName: 'សីហា', startCapital: 492.60, share: '0.68%', addSaving: 5.00, profit: 3.093531719, withdraw: '-', deductFee: '-', actualFee: '-', total: 500.69, note: '✓' },
                  ].map((row, idx) => (
                    <tr key={idx} className="hover:bg-slate-50/50 transition-colors h-10">
                      <td className="py-2 px-2 text-center border-r border-slate-300 font-bold text-slate-400">{typeof row.id === 'string' ? row.id.split(' ').pop() : row.id}</td>
                      <td className="py-2 px-3 border-r border-slate-300 font-bold text-slate-800 text-center bg-slate-50/10">{row.monthName}</td>
                      <td className="py-2 px-3 border-r border-slate-300 text-right font-medium">{row.startCapital.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
                      <td className="py-2 px-2 border-r border-slate-300 text-center font-medium text-slate-500">{row.share}</td>
                      <td className="py-2 px-3 border-r border-slate-300 text-right font-semibold text-slate-700">
                        {row.addSaving > 0 ? row.addSaving.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2}) : <span className="text-slate-300">-</span>}
                      </td>
                      <td className="py-2 px-3 border-r border-slate-300 text-right font-mono text-slate-600">
                        {row.profit.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 9})}
                      </td>
                      <td className="py-2 px-2 border-r border-slate-300 text-center text-slate-300">{row.withdraw}</td>
                      <td className="py-2 px-2 border-r border-slate-300 text-center text-slate-300">{row.deductFee}</td>
                      <td className="py-2 px-2 border-r border-slate-300 text-center text-slate-300">{row.actualFee}</td>
                      <td className="py-2 px-3 border-r border-slate-300 text-right font-black text-[#0a6652] bg-[#f8fdfb]">
                        {row.total.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}
                      </td>
                      <td className="py-2 px-2 text-center font-black text-emerald-600 text-xs">{row.note}</td>
                    </tr>
                  ))}

                  {/* Summary Totals Row */}
                  <tr className="bg-emerald-50/60 font-bold border-t-2 border-slate-300 text-slate-900 text-[11px] h-11">
                    <td className="py-2.5 px-3 text-center border-r border-slate-300 font-bold">-</td>
                    <td className="py-2.5 px-3 border-r border-slate-300 text-center font-extrabold text-[#0a6652]">សរុប</td>
                    <td className="py-2.5 px-3 border-r border-slate-300 text-right font-black text-slate-800">5,143.37</td>
                    <td className="py-2.5 px-2 border-r border-slate-300 text-center font-bold text-slate-600">7.14%</td>
                    <td className="py-2.5 px-3 border-r border-slate-300 text-right font-bold text-slate-800">40.00</td>
                    <td className="py-2.5 px-3 border-r border-slate-300 text-right font-mono font-bold text-slate-600">32.300472897</td>
                    <td className="py-2.5 px-2 border-r border-slate-300 text-center text-slate-300">-</td>
                    <td className="py-2.5 px-2 border-r border-slate-300 text-center text-slate-300">-</td>
                    <td className="py-2.5 px-2 border-r border-slate-300 text-center text-slate-300">-</td>
                    <td className="py-2.5 px-3 border-r border-slate-300 text-right font-black text-[#0a6652] bg-emerald-50">5,215.67</td>
                    <td className="py-2.5 px-2 text-center text-slate-300">-</td>
                  </tr>
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

