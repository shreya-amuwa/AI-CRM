import React, { useState, useEffect } from 'react';
import {
  TrendingUp, TrendingDown, DollarSign, Receipt, FileText,
  Building2, ShieldCheck, PieChart, Users, ArrowRight,
  LayoutDashboard, FileCheck2, Sparkles, CheckCircle2, Lock,
  ChevronRight, ArrowUpRight, BarChart3, Clock, Eye,
  CreditCard, Coins
} from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';
import { ActiveTab } from '../../layout/Sidebar';
import { accountsStore, DepartmentInvoice } from '../../../services/accountsStore';
import { IncomeView } from './IncomeView';
import { ExpenseView } from './ExpenseView';
import { InvoiceView } from './InvoiceView';
import { InvoicePdfModal } from './InvoicePdfModal';
import { AccountsConfirmations } from '../../accounts/AccountsConfirmations';

interface AccountsDepartmentPanelProps {
  activeTab?: ActiveTab;
}

export const AccountsDepartmentPanel: React.FC<AccountsDepartmentPanelProps> = ({
  activeTab = 'dashboard'
}) => {
  const { user } = useAuth();
  
  // Internal tab state: 'overview' | 'income' | 'expense' | 'invoice'
  const [internalTab, setInternalTab] = useState<'overview' | 'income' | 'expense' | 'invoice'>('overview');
  const [selectedDeptForInvoice, setSelectedDeptForInvoice] = useState<string | undefined>(undefined);
  const [activeInvoiceForPdf, setActiveInvoiceForPdf] = useState<DepartmentInvoice | null>(null);

  // Real-time synchronization listener for newly created invoices
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  useEffect(() => {
    const handleInvoiceCreated = () => {
      setRefreshTrigger(prev => prev + 1);
    };
    window.addEventListener('amuwa_crm_invoice_created', handleInvoiceCreated);
    window.addEventListener('storage', handleInvoiceCreated);
    return () => {
      window.removeEventListener('amuwa_crm_invoice_created', handleInvoiceCreated);
      window.removeEventListener('storage', handleInvoiceCreated);
    };
  }, []);

  // Sync with Sidebar activeTab
  useEffect(() => {
    if (activeTab === 'income') {
      setInternalTab('income');
    } else if (activeTab === 'expense') {
      setInternalTab('expense');
    } else if (activeTab === 'invoice') {
      setInternalTab('invoice');
    } else if (activeTab === 'dashboard') {
      setInternalTab('overview');
    }
  }, [activeTab]);

  const totals = accountsStore.getCompanyFinancialTotals();
  const departmentMetrics = accountsStore.getDepartmentMetrics();
  const allInvoices = accountsStore.getInvoices();

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0
    }).format(amount);
  };

  const handleSelectDeptForInvoice = (deptId: string) => {
    setSelectedDeptForInvoice(deptId);
    setInternalTab('invoice');
  };

  // Customers Sales sent to Accounts: business name list, details in a pop-up with the Confirm button.
  if (activeTab === 'confirmations') return <AccountsConfirmations layout="popup" />;

  return (
    <div className="space-y-6 animate-fade-in font-sans">
      
      {/* 1. CLEAN MODERN HEADER */}
      <div className="bg-white border border-slate-200/90 rounded-2xl p-5 shadow-xs relative overflow-hidden">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="w-11 h-11 rounded-xl bg-emerald-600 text-white flex items-center justify-center shadow-xs shrink-0">
              <DollarSign className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl sm:text-2xl font-bold font-heading text-slate-900 tracking-tight">
                  Accounts Department
                </h1>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                  Financial Headquarters
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Centralized financial intelligence &bull; Income analysis, corporate expenditure, and GST invoicing.
              </p>
            </div>
          </div>

          {/* Access Authority Indicator */}
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-50 border border-slate-200/80 text-xs font-mono shrink-0">
            <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
            <span className="text-slate-600">Access:</span>
            <strong className="text-slate-800">{user?.name || 'Accounts Head'}</strong>
            <span className="text-slate-400 text-[11px]">({user?.role})</span>
          </div>
        </div>

        {/* 2. MODERN SEGMENTED TABS */}
        <div className="flex items-center gap-1.5 mt-5 pt-4 border-t border-slate-100 overflow-x-auto">
          <button
            onClick={() => setInternalTab('overview')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-all shrink-0 cursor-pointer ${
              internalTab === 'overview'
                ? 'bg-slate-900 text-white shadow-xs'
                : 'bg-slate-50 hover:bg-slate-100 text-slate-600'
            }`}
          >
            <LayoutDashboard className="w-3.5 h-3.5 text-emerald-400" />
            <span>Overview &amp; Analytics</span>
          </button>

          <button
            onClick={() => setInternalTab('income')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-all shrink-0 cursor-pointer ${
              internalTab === 'income'
                ? 'bg-emerald-600 text-white shadow-xs'
                : 'bg-slate-50 hover:bg-slate-100 text-slate-600'
            }`}
          >
            <TrendingUp className="w-3.5 h-3.5" />
            <span>Department Income</span>
            <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-white/20 text-white">
              {departmentMetrics.length}
            </span>
          </button>

          <button
            onClick={() => setInternalTab('expense')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-all shrink-0 cursor-pointer ${
              internalTab === 'expense'
                ? 'bg-rose-600 text-white shadow-xs'
                : 'bg-slate-50 hover:bg-slate-100 text-slate-600'
            }`}
          >
            <Receipt className="w-3.5 h-3.5" />
            <span>Expenses</span>
          </button>

          <button
            onClick={() => {
              setSelectedDeptForInvoice(undefined);
              setInternalTab('invoice');
            }}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-all shrink-0 cursor-pointer ${
              internalTab === 'invoice'
                ? 'bg-blue-600 text-white shadow-xs'
                : 'bg-slate-50 hover:bg-slate-100 text-slate-600'
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            <span>Invoices &amp; Quotations</span>
            <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-white/20 text-white">
              {allInvoices.length}
            </span>
          </button>
        </div>
      </div>

      {/* 3. ACCOUNTS OVERVIEW: 2-TIER REVENUE INTELLIGENCE & RECENT ACTIVITY */}
      {internalTab === 'overview' && (
        <div className="space-y-6 animate-fade-in">
          
          {/* TIER 1: CORPORATE REVENUE INTELLIGENCE BANNER */}
          <div className="bg-gradient-to-r from-white via-cyan-50/25 to-emerald-50/35 rounded-3xl border border-slate-200/90 p-6 sm:p-8 shadow-2xs relative overflow-hidden">
            
            {/* 3D Glass Analytics Graphic (as shown in Screenshot 1) */}
            <div className="hidden lg:block absolute right-8 -bottom-1 pointer-events-none opacity-85 select-none">
              <svg width="220" height="135" viewBox="0 0 220 135" fill="none" xmlns="http://www.w3.org/2000/svg">
                {/* Bar 1 */}
                <rect x="20" y="70" width="30" height="65" rx="8" fill="url(#bar-g1)" />
                <ellipse cx="35" cy="70" rx="15" ry="6" fill="#A7F3D0" />
                {/* Bar 2 */}
                <rect x="70" y="45" width="30" height="90" rx="8" fill="url(#bar-g2)" />
                <ellipse cx="85" cy="45" rx="15" ry="6" fill="#6EE7B7" />
                {/* Bar 3 */}
                <rect x="120" y="20" width="30" height="115" rx="8" fill="url(#bar-g3)" />
                <ellipse cx="135" cy="20" rx="15" ry="6" fill="#34D399" />
                {/* Bar 4 */}
                <rect x="170" y="55" width="30" height="80" rx="8" fill="url(#bar-g4)" />
                <ellipse cx="185" cy="55" rx="15" ry="6" fill="#93C5FD" />
                <defs>
                  <linearGradient id="bar-g1" x1="20" y1="70" x2="50" y2="135" gradientUnits="userSpaceOnUse">
                    <stop stopColor="#93C5FD" stopOpacity="0.75" />
                    <stop stopColor="#60A5FA" stopOpacity="0.4" />
                  </linearGradient>
                  <linearGradient id="bar-g2" x1="70" y1="45" x2="100" y2="135" gradientUnits="userSpaceOnUse">
                    <stop stopColor="#6EE7B7" stopOpacity="0.85" />
                    <stop stopColor="#10B981" stopOpacity="0.5" />
                  </linearGradient>
                  <linearGradient id="bar-g3" x1="120" y1="20" x2="150" y2="135" gradientUnits="userSpaceOnUse">
                    <stop stopColor="#34D399" stopOpacity="0.9" />
                    <stop stopColor="#059669" stopOpacity="0.65" />
                  </linearGradient>
                  <linearGradient id="bar-g4" x1="170" y1="55" x2="200" y2="135" gradientUnits="userSpaceOnUse">
                    <stop stopColor="#93C5FD" stopOpacity="0.8" />
                    <stop stopColor="#3B82F6" stopOpacity="0.45" />
                  </linearGradient>
                </defs>
              </svg>
            </div>

            <div className="relative z-10 flex flex-col md:flex-row md:items-start justify-between gap-6">
              <div className="space-y-2 max-w-2xl">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold font-mono bg-emerald-50 text-emerald-700 border border-emerald-200">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  <span>CORPORATE REVENUE INTELLIGENCE</span>
                </div>
                <h2 className="text-xl sm:text-2xl lg:text-3xl font-extrabold font-heading text-slate-900 tracking-tight">
                  Department-Wise Income &amp; Earnings Overview
                </h2>
                <p className="text-xs sm:text-sm text-slate-500 leading-relaxed">
                  Consolidated financial statement displaying gross income, operating expenses, and net profit margins across all active operating business units.
                </p>
              </div>

              {/* Fiscal Year & Audit Badge */}
              <div className="flex flex-col md:items-end gap-1.5 shrink-0">
                <span className="text-[10px] font-mono font-semibold uppercase tracking-wider text-slate-400">
                  FINANCIAL YEAR 2026-27
                </span>
                <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-mono font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 shadow-2xs">
                  Quarter 3 Real-time Audit
                </span>
              </div>
            </div>
          </div>

          {/* 3 CLEAN PASTEL METRIC CARDS */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            
            {/* Card 1: Total Gross Income */}
            <div className="p-6 rounded-3xl bg-emerald-50/40 border border-emerald-100 shadow-2xs hover:shadow-xs transition-all space-y-4">
              <div className="w-11 h-11 rounded-2xl bg-emerald-100/80 text-emerald-600 flex items-center justify-center">
                <TrendingUp className="w-5 h-5 stroke-[2.5]" />
              </div>
              <div>
                <span className="text-[11px] font-bold font-mono tracking-wider text-slate-500 uppercase block mb-1">
                  TOTAL GROSS INCOME
                </span>
                <h3 className="text-3xl font-extrabold font-heading text-emerald-600 tracking-tight">
                  {formatCurrency(totals.totalGrossIncome)}
                </h3>
                <p className="text-xs text-slate-500 mt-1.5">
                  Across 6 business departments
                </p>
              </div>
            </div>

            {/* Card 2: Total Expenses */}
            <div className="p-6 rounded-3xl bg-rose-50/40 border border-rose-100 shadow-2xs hover:shadow-xs transition-all space-y-4">
              <div className="w-11 h-11 rounded-2xl bg-rose-100/80 text-rose-600 flex items-center justify-center">
                <CreditCard className="w-5 h-5 stroke-[2.5]" />
              </div>
              <div>
                <span className="text-[11px] font-bold font-mono tracking-wider text-slate-500 uppercase block mb-1">
                  TOTAL EXPENSES
                </span>
                <h3 className="text-3xl font-extrabold font-heading text-rose-600 tracking-tight">
                  {formatCurrency(totals.totalExpenses)}
                </h3>
                <p className="text-xs text-slate-500 mt-1.5">
                  Departmental operations &amp; infrastructure
                </p>
              </div>
            </div>

            {/* Card 3: Total Net Earnings */}
            <div className="p-6 rounded-3xl bg-blue-50/40 border border-blue-100 shadow-2xs hover:shadow-xs transition-all space-y-4">
              <div className="w-11 h-11 rounded-2xl bg-blue-100/80 text-blue-600 flex items-center justify-center">
                <Coins className="w-5 h-5 stroke-[2.5]" />
              </div>
              <div>
                <span className="text-[11px] font-bold font-mono tracking-wider text-slate-500 uppercase block mb-1">
                  TOTAL NET EARNINGS
                </span>
                <h3 className="text-3xl font-extrabold font-heading text-blue-600 tracking-tight">
                  {formatCurrency(totals.totalNetEarnings)}
                </h3>
                <p className="text-xs text-slate-500 mt-1.5">
                  Net retained corporate profit
                </p>
              </div>
            </div>

          </div>

        </div>
      )}

      {/* 4. SUB-VIEWS */}
      {internalTab === 'income' && (
        <IncomeView onSelectDepartmentForInvoice={handleSelectDeptForInvoice} />
      )}

      {internalTab === 'expense' && (
        <ExpenseView />
      )}

      {internalTab === 'invoice' && (
        <InvoiceView initialDepartmentId={selectedDeptForInvoice} />
      )}

      {/* Interactive PDF Modal */}
      <InvoicePdfModal
        invoice={activeInvoiceForPdf}
        isOpen={!!activeInvoiceForPdf}
        onClose={() => setActiveInvoiceForPdf(null)}
      />

    </div>
  );
};
