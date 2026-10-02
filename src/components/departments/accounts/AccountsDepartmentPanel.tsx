import React, { useState, useEffect } from 'react';
import {
  TrendingUp, TrendingDown, DollarSign, Receipt, FileText,
  Building2, ShieldCheck, PieChart, Users, ArrowRight,
  LayoutDashboard, FileCheck2, Sparkles, CheckCircle2, Lock,
  ChevronRight, ArrowUpRight, BarChart3, Clock, Eye, Search,
  CreditCard, Coins
} from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';
import { ActiveTab } from '../../layout/Sidebar';
import { accountsStore, DepartmentInvoice, normalizeDepartmentId } from '../../../services/accountsStore';
import { IncomeView } from './IncomeView';
import { ExpenseView } from './ExpenseView';
import { InvoiceView } from './InvoiceView';
import { InvoicePdfModal } from './InvoicePdfModal';

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

  // Search & Sorting filter state for overview department list
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'income' | 'profit'>('income');

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
  const recentInvoices = allInvoices.slice(0, 5);

  const filteredAndSortedDepts = departmentMetrics
    .filter(dept => {
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase().trim();
      return (
        dept.departmentName.toLowerCase().includes(q) ||
        dept.topPerformerName.toLowerCase().includes(q) ||
        dept.departmentId.toLowerCase().includes(q)
      );
    })
    .sort((a, b) => {
      if (sortBy === 'income') {
        return b.grossIncome - a.grossIncome;
      } else {
        return b.netEarnings - a.netEarnings;
      }
    });

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

  // Color mapping for department distribution
  const deptColorMap: Record<string, { bg: string; text: string; hex: string }> = {
    wabastore: { bg: 'bg-emerald-500', text: 'text-emerald-700', hex: '#10B981' },
    wabastar: { bg: 'bg-green-600', text: 'text-green-700', hex: '#16A34A' },
    whatsbox: { bg: 'bg-cyan-500', text: 'text-cyan-700', hex: '#06B6D4' },
    dtalk: { bg: 'bg-purple-600', text: 'text-purple-700', hex: '#8B5CF6' },
    digitree: { bg: 'bg-pink-500', text: 'text-pink-700', hex: '#EC4899' },
    mpillar: { bg: 'bg-amber-500', text: 'text-amber-700', hex: '#F59E0B' }
  };

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
            <span>Corporate Expenses</span>
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
                  Consolidated financial statement displaying gross income, corporate operating expenses, and net profit margins across all active operating business units.
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
                  Corporate operations &amp; infrastructure
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

          {/* SEARCH & SORT FILTER BAR */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-3.5 sm:p-4 rounded-2xl border border-slate-200/90 shadow-2xs">
            <div className="relative flex-1 max-w-xl">
              <Search className="w-4 h-4 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search department income ..."
                className="w-full pl-10 pr-4 py-2.5 text-xs bg-slate-50/80 border border-slate-200 rounded-full text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all font-sans"
              />
            </div>

            <div className="flex items-center gap-2 text-xs self-end sm:self-center font-mono">
              <span className="text-slate-500 font-semibold text-xs">Sort by :</span>
              <button
                type="button"
                onClick={() => setSortBy('income')}
                className={`px-4 py-1.5 rounded-full text-xs font-bold transition-all cursor-pointer ${
                  sortBy === 'income'
                    ? 'bg-slate-900 text-white shadow-xs'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                Income
              </button>
              <button
                type="button"
                onClick={() => setSortBy('profit')}
                className={`px-4 py-1.5 rounded-full text-xs font-bold transition-all cursor-pointer ${
                  sortBy === 'profit'
                    ? 'bg-slate-900 text-white shadow-xs'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                Net Profit
              </button>
            </div>
          </div>

          {/* DEPARTMENT BREAKDOWN (LEFT) & QUICK NAVIGATION (RIGHT) */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
            
            {/* Department List (7 cols) */}
            <div className="lg:col-span-7 bg-white rounded-2xl border border-slate-200/90 p-3 sm:p-4 shadow-2xs space-y-2">
              {filteredAndSortedDepts.length === 0 ? (
                <div className="text-center py-8 text-slate-400 text-xs font-mono">
                  No departments found matching "{searchQuery}"
                </div>
              ) : (
                filteredAndSortedDepts.map(dept => {
                  const sharePct = totals.totalGrossIncome > 0
                    ? ((dept.grossIncome / totals.totalGrossIncome) * 100).toFixed(1)
                    : '0';
                  const colorStyle = deptColorMap[dept.departmentId] || { bg: 'bg-slate-400' };

                  return (
                    <div
                      key={dept.departmentId}
                      onClick={() => handleSelectDeptForInvoice(dept.departmentId)}
                      className="p-3.5 rounded-xl border border-slate-100 hover:border-slate-200/80 bg-white hover:bg-slate-50/70 transition-all cursor-pointer flex items-center justify-between gap-3 group"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span className={`w-2.5 h-2.5 rounded-full ${colorStyle.bg} shrink-0`} />
                        <div className="truncate">
                          <h4 className="text-xs sm:text-sm font-bold text-slate-900 group-hover:text-emerald-700 transition-colors truncate">
                            {dept.departmentName}
                          </h4>
                          <p className="text-[11px] text-slate-400 font-mono truncate">
                            {dept.totalInvoicesCount} Invoices &bull; Top: {dept.topPerformerName}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 sm:gap-4 text-right shrink-0">
                        <div>
                          <strong className="text-xs sm:text-sm font-bold font-mono text-slate-900 block">
                            {formatCurrency(dept.grossIncome)}
                          </strong>
                          <span className="text-[10px] sm:text-[11px] font-mono text-slate-400">
                            {sharePct}% share
                          </span>
                        </div>
                        <span className="px-2.5 py-0.5 rounded-full text-[10px] sm:text-[11px] font-bold font-mono bg-emerald-50 text-emerald-700 border border-emerald-200 shrink-0">
                          {dept.profitMarginPct}% Margin
                        </span>
                        <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-slate-700 group-hover:translate-x-0.5 transition-all" />
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Quick Navigation Cards (5 cols) */}
            <div className="lg:col-span-5 bg-white rounded-2xl border border-slate-200/90 p-5 shadow-2xs space-y-3">
              <h3 className="text-xs font-mono font-bold text-slate-400 uppercase tracking-wider">
                QUICK NAVIGATION
              </h3>
              <div className="grid grid-cols-2 gap-3">
                {/* Expense Ledger */}
                <button
                  type="button"
                  onClick={() => setInternalTab('expense')}
                  className="p-4 rounded-2xl bg-rose-50/50 hover:bg-rose-100/70 border border-rose-100/90 text-left transition-all group cursor-pointer flex flex-col justify-between h-24 shadow-2xs"
                >
                  <div className="w-8 h-8 rounded-xl bg-rose-100 text-rose-600 flex items-center justify-center">
                    <Receipt className="w-4 h-4" />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-rose-900 group-hover:text-rose-700">
                      Expense Ledger
                    </span>
                    <ChevronRight className="w-3.5 h-3.5 text-rose-400 group-hover:translate-x-0.5 transition-all" />
                  </div>
                </button>

                {/* Invoices & Tax PDFs */}
                <button
                  type="button"
                  onClick={() => {
                    setSelectedDeptForInvoice(undefined);
                    setInternalTab('invoice');
                  }}
                  className="p-4 rounded-2xl bg-blue-50/50 hover:bg-blue-100/70 border border-blue-100/90 text-left transition-all group cursor-pointer flex flex-col justify-between h-24 shadow-2xs"
                >
                  <div className="w-8 h-8 rounded-xl bg-blue-100 text-blue-600 flex items-center justify-center">
                    <FileText className="w-4 h-4" />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-blue-900 group-hover:text-blue-700">
                      Invoices &amp; Tax PDFs
                    </span>
                    <ChevronRight className="w-3.5 h-3.5 text-blue-400 group-hover:translate-x-0.5 transition-all" />
                  </div>
                </button>
              </div>
            </div>

          </div>

          {/* TIER 2: RECENT ACTIVITY (Live Department Invoices & Billing Inflow) */}
          <div className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-2xs space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
                  <FileText className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    Recent Department Invoices &amp; Billing Inflow
                  </h3>
                  <p className="text-xs text-slate-400">
                    Live commercial tax invoices created by sales executives across business divisions
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  setSelectedDeptForInvoice(undefined);
                  setInternalTab('invoice');
                }}
                className="text-xs font-mono font-bold text-blue-600 hover:text-blue-700 flex items-center gap-1.5 cursor-pointer self-start sm:self-auto hover:underline"
              >
                <span>View All Invoices ({allInvoices.length})</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-100 text-[11px] font-mono text-slate-400 uppercase">
                    <th className="py-3 pl-3 pr-4">INVOICE #</th>
                    <th className="py-3 pr-4">DEPARTMENT</th>
                    <th className="py-3 pr-4">CLIENT / ORGANIZATION</th>
                    <th className="py-3 pr-4">SALES EXECUTIVE</th>
                    <th className="py-3 pr-4">STATUS</th>
                    <th className="py-3 pr-4 text-right">AMOUNT (₹)</th>
                    <th className="py-3 pr-3 text-right">ACTION</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-sans">
                  {recentInvoices.map(inv => {
                    const normDept = normalizeDepartmentId(inv.departmentId);
                    const colorStyle = deptColorMap[normDept] || { bg: 'bg-slate-500' };

                    let statusClass = 'bg-amber-50 text-amber-700 border-amber-200';
                    if (inv.status === 'Paid') {
                      statusClass = 'bg-emerald-50 text-emerald-700 border-emerald-200';
                    } else if (inv.status === 'Overdue') {
                      statusClass = 'bg-amber-50 text-amber-800 border-amber-300';
                    }

                    return (
                      <tr key={inv.id} className="hover:bg-slate-50/70 transition-colors">
                        <td className="py-3.5 pl-3 pr-4 font-mono font-bold text-slate-900">
                          {inv.invoiceNumber}
                        </td>
                        <td className="py-3.5 pr-4">
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium bg-slate-50 border border-slate-200 text-slate-700">
                            <span className={`w-2 h-2 rounded-full ${colorStyle.bg}`} />
                            <span>{inv.departmentName}</span>
                          </span>
                        </td>
                        <td className="py-3.5 pr-4">
                          <span className="font-semibold text-slate-800 block">{inv.clientCompany}</span>
                          <span className="text-[11px] text-slate-400 block">{inv.clientName}</span>
                        </td>
                        <td className="py-3.5 pr-4 font-mono text-slate-600">
                          {inv.teamMemberName}
                        </td>
                        <td className="py-3.5 pr-4">
                          <span className={`inline-block px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold uppercase border ${statusClass}`}>
                            {inv.status}
                          </span>
                        </td>
                        <td className="py-3.5 pr-4 text-right font-mono font-bold text-slate-900">
                          {formatCurrency(inv.totalAmount)}
                        </td>
                        <td className="py-3.5 pr-3 text-right">
                          <button
                            type="button"
                            onClick={() => setActiveInvoiceForPdf(inv)}
                            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-900 hover:bg-slate-800 text-white font-mono text-[11px] font-bold transition-all active:scale-95 cursor-pointer shadow-2xs"
                          >
                            <Eye className="w-3.5 h-3.5 text-emerald-400" />
                            <span>PDF</span>
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
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
