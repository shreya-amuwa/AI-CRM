import React, { useState, useEffect } from 'react';
import {
  TrendingUp, TrendingDown, DollarSign, Receipt, FileText,
  Building2, ShieldCheck, PieChart, Users, ArrowRight,
  LayoutDashboard, FileCheck2, Sparkles, CheckCircle2, Lock
} from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';
import { ActiveTab } from '../../layout/Sidebar';
import { accountsStore } from '../../../services/accountsStore';
import { IncomeView } from './IncomeView';
import { ExpenseView } from './ExpenseView';
import { InvoiceView } from './InvoiceView';

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

  return (
    <div className="space-y-6 animate-fade-in font-sans">
      
      {/* Top Department Header & Security Authority Status */}
      <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm relative overflow-hidden">
        <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-emerald-500 via-teal-500 to-blue-600" />
        
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 pt-1">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-emerald-600 to-teal-700 text-white flex items-center justify-center shadow-md">
              <DollarSign className="w-8 h-8" />
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
                <span className="text-[11px] font-mono text-emerald-700 font-bold uppercase tracking-wider">
                  CORPORATE ACCOUNTS &amp; FINANCIAL HEADQUARTERS
                </span>
              </div>
              <h1 className="text-2xl sm:text-3xl font-bold font-heading text-slate-900 tracking-tight">
                Accounts Department
              </h1>
              <p className="text-xs text-slate-500 font-mono mt-0.5">
                Centralized financial oversight &bull; Department Income, Corporate Expenses, and Official Invoicing
              </p>
            </div>
          </div>

          {/* Access Authority Badge */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 shrink-0">
            <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200/80 font-mono text-xs space-y-1">
              <div className="flex items-center gap-1.5 text-slate-700 font-bold">
                <ShieldCheck className="w-4 h-4 text-emerald-600" />
                <span>Access Authority: SuperAdmin &amp; Accounts Head</span>
              </div>
              <p className="text-[11px] text-slate-400">
                Current Operator: <strong className="text-slate-800">{user?.name || 'Accounts Head'}</strong> ({user?.role})
              </p>
            </div>
          </div>
        </div>

        {/* 3 Core Side-Panel Navigation Tabs */}
        <div className="flex flex-wrap items-center gap-2 mt-6 pt-6 border-t border-slate-100">
          <button
            onClick={() => setInternalTab('overview')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-2xl font-mono text-xs font-bold transition-all ${
              internalTab === 'overview'
                ? 'bg-slate-900 text-white shadow-md'
                : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
            }`}
          >
            <LayoutDashboard className="w-4 h-4 text-emerald-400" />
            <span>Overview &amp; Snapshot</span>
          </button>

          <button
            onClick={() => setInternalTab('income')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-2xl font-mono text-xs font-bold transition-all ${
              internalTab === 'income'
                ? 'bg-emerald-600 text-white shadow-md'
                : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
            }`}
          >
            <TrendingUp className="w-4 h-4" />
            <span>1. Department Income</span>
          </button>

          <button
            onClick={() => setInternalTab('expense')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-2xl font-mono text-xs font-bold transition-all ${
              internalTab === 'expense'
                ? 'bg-rose-600 text-white shadow-md'
                : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
            }`}
          >
            <Receipt className="w-4 h-4" />
            <span>2. Corporate Expense</span>
          </button>

          <button
            onClick={() => {
              setSelectedDeptForInvoice(undefined);
              setInternalTab('invoice');
            }}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-2xl font-mono text-xs font-bold transition-all ${
              internalTab === 'invoice'
                ? 'bg-blue-600 text-white shadow-md'
                : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
            }`}
          >
            <FileText className="w-4 h-4" />
            <span>3. Invoices &amp; Quotations</span>
          </button>
        </div>

      </div>

      {/* RENDER ACTIVE SUB-DASHBOARD */}
      {internalTab === 'overview' && (
        <div className="space-y-8 animate-fade-in">
          
          {/* Quick Metrics Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="p-6 rounded-3xl bg-white border border-slate-200 shadow-sm space-y-2">
              <span className="text-xs font-mono font-bold uppercase text-slate-400">GROSS INCOME (ALL UNITS)</span>
              <h3 className="text-2xl sm:text-3xl font-bold font-mono text-emerald-700">
                {formatCurrency(totals.totalGrossIncome)}
              </h3>
              <p className="text-xs text-slate-500 font-mono">Consolidated Q3 revenue</p>
            </div>

            <div className="p-6 rounded-3xl bg-white border border-slate-200 shadow-sm space-y-2">
              <span className="text-xs font-mono font-bold uppercase text-slate-400">CORPORATE EXPENSES</span>
              <h3 className="text-2xl sm:text-3xl font-bold font-mono text-rose-700">
                {formatCurrency(totals.totalExpenses)}
              </h3>
              <p className="text-xs text-slate-500 font-mono">Company operational spend</p>
            </div>

            <div className="p-6 rounded-3xl bg-white border border-slate-200 shadow-sm space-y-2">
              <span className="text-xs font-mono font-bold uppercase text-slate-400">NET COMPANY EARNINGS</span>
              <h3 className="text-2xl sm:text-3xl font-bold font-mono text-blue-700">
                {formatCurrency(totals.totalNetEarnings)}
              </h3>
              <p className="text-xs text-slate-500 font-mono">Retained corporate earnings</p>
            </div>

            <div className="p-6 rounded-3xl bg-white border border-slate-200 shadow-sm space-y-2">
              <span className="text-xs font-mono font-bold uppercase text-slate-400">NET PROFIT MARGIN</span>
              <h3 className="text-2xl sm:text-3xl font-bold font-mono text-purple-700">
                {totals.overallMarginPct}%
              </h3>
              <p className="text-xs text-slate-500 font-mono">Target achieved: {totals.targetAchievedPct}%</p>
            </div>
          </div>

          {/* 3 Navigational Action Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            
            {/* Card 1: Income */}
            <div
              onClick={() => setInternalTab('income')}
              className="bg-white rounded-3xl p-6 border border-slate-200 hover:border-emerald-500 hover:shadow-xl transition-all cursor-pointer space-y-4 group"
            >
              <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center group-hover:scale-110 transition-transform">
                <TrendingUp className="w-6 h-6" />
              </div>
              <h3 className="text-xl font-bold font-heading text-slate-900 group-hover:text-emerald-700 transition-colors">
                Department Income
              </h3>
              <p className="text-xs text-slate-500 leading-relaxed font-sans">
                Inspect department-wise income, operating expenses, and net profit amounts across all 6 business units.
              </p>
              <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs font-mono font-bold text-emerald-700">
                <span>Open Income Dashboard</span>
                <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </div>
            </div>

            {/* Card 2: Expense */}
            <div
              onClick={() => setInternalTab('expense')}
              className="bg-white rounded-3xl p-6 border border-slate-200 hover:border-rose-500 hover:shadow-xl transition-all cursor-pointer space-y-4 group"
            >
              <div className="w-12 h-12 rounded-2xl bg-rose-50 text-rose-600 flex items-center justify-center group-hover:scale-110 transition-transform">
                <Receipt className="w-6 h-6" />
              </div>
              <h3 className="text-xl font-bold font-heading text-slate-900 group-hover:text-rose-700 transition-colors">
                Corporate Expenses
              </h3>
              <p className="text-xs text-slate-500 leading-relaxed font-sans">
                Review how much each department spent and over what corporate reasons strictly for company infrastructure and operations.
              </p>
              <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs font-mono font-bold text-rose-700">
                <span>Open Expense Ledger</span>
                <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </div>
            </div>

            {/* Card 3: Invoice */}
            <div
              onClick={() => {
                setSelectedDeptForInvoice(undefined);
                setInternalTab('invoice');
              }}
              className="bg-white rounded-3xl p-6 border border-slate-200 hover:border-blue-500 hover:shadow-xl transition-all cursor-pointer space-y-4 group"
            >
              <div className="w-12 h-12 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center group-hover:scale-110 transition-transform">
                <FileText className="w-6 h-6" />
              </div>
              <h3 className="text-xl font-bold font-heading text-slate-900 group-hover:text-blue-700 transition-colors">
                Invoices &amp; Quotations
              </h3>
              <p className="text-xs text-slate-500 leading-relaxed font-sans">
                Click into any department to see team members, individual revenue closed, interactive tax invoice PDFs, and quotations.
              </p>
              <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs font-mono font-bold text-blue-700">
                <span>Open Invoices &amp; Team Hub</span>
                <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </div>
            </div>

          </div>

          {/* Quick Embed of Income View on Overview */}
          <div className="pt-4">
            <IncomeView onSelectDepartmentForInvoice={handleSelectDeptForInvoice} />
          </div>

        </div>
      )}

      {internalTab === 'income' && (
        <IncomeView onSelectDepartmentForInvoice={handleSelectDeptForInvoice} />
      )}

      {internalTab === 'expense' && (
        <ExpenseView />
      )}

      {internalTab === 'invoice' && (
        <InvoiceView initialDepartmentId={selectedDeptForInvoice} />
      )}

    </div>
  );
};
