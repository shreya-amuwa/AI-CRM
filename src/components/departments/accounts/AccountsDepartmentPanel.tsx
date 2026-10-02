import React, { useState, useEffect } from 'react';
import {
  TrendingUp, TrendingDown, DollarSign, Receipt, FileText,
  Building2, ShieldCheck, PieChart, Users, ArrowRight,
  LayoutDashboard, FileCheck2, Sparkles, CheckCircle2, Lock,
  ChevronRight, ArrowUpRight, BarChart3, Clock, Eye
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

      {/* 3. EXECUTIVE OVERVIEW DASHBOARD */}
      {internalTab === 'overview' && (
        <div className="space-y-6 animate-fade-in">
          
          {/* Top 4 Key Metric Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            
            {/* Card 1: Gross Revenue */}
            <div className="p-5 rounded-2xl bg-white border border-slate-200 shadow-xs space-y-2">
              <div className="flex items-center justify-between text-slate-500 text-xs font-semibold">
                <span>CONSOLIDATED REVENUE</span>
                <span className="p-1.5 rounded-lg bg-emerald-50 text-emerald-600">
                  <TrendingUp className="w-4 h-4" />
                </span>
              </div>
              <h3 className="text-2xl font-bold font-mono text-emerald-700">
                {formatCurrency(totals.totalGrossIncome)}
              </h3>
              <div className="space-y-1">
                <div className="flex items-center justify-between text-[11px] text-slate-500 font-mono">
                  <span>Target: {formatCurrency(totals.totalMonthlyTarget)}</span>
                  <span className="font-bold text-emerald-700">{totals.targetAchievedPct}%</span>
                </div>
                <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
                  <div
                    className="bg-emerald-500 h-full rounded-full transition-all duration-500"
                    style={{ width: `${Math.min(totals.targetAchievedPct, 100)}%` }}
                  />
                </div>
              </div>
            </div>

            {/* Card 2: Corporate Expenses */}
            <div className="p-5 rounded-2xl bg-white border border-slate-200 shadow-xs space-y-2">
              <div className="flex items-center justify-between text-slate-500 text-xs font-semibold">
                <span>CORPORATE EXPENSES</span>
                <span className="p-1.5 rounded-lg bg-rose-50 text-rose-600">
                  <Receipt className="w-4 h-4" />
                </span>
              </div>
              <h3 className="text-2xl font-bold font-mono text-rose-700">
                {formatCurrency(totals.totalExpenses)}
              </h3>
              <p className="text-xs text-slate-500 flex items-center justify-between">
                <span>Cloud, telecom &amp; ops</span>
                <span className="text-[11px] font-mono text-rose-600 font-bold">
                  {Math.round((totals.totalExpenses / (totals.totalGrossIncome || 1)) * 100)}% of revenue
                </span>
              </p>
            </div>

            {/* Card 3: Net Retained Earnings */}
            <div className="p-5 rounded-2xl bg-white border border-slate-200 shadow-xs space-y-2">
              <div className="flex items-center justify-between text-slate-500 text-xs font-semibold">
                <span>NET COMPANY EARNINGS</span>
                <span className="p-1.5 rounded-lg bg-blue-50 text-blue-600">
                  <DollarSign className="w-4 h-4" />
                </span>
              </div>
              <h3 className="text-2xl font-bold font-mono text-blue-700">
                {formatCurrency(totals.totalNetEarnings)}
              </h3>
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-500">Net Profit Margin</span>
                <span className="px-2 py-0.5 rounded-full text-[11px] font-mono font-bold bg-blue-50 text-blue-700 border border-blue-200">
                  {totals.overallMarginPct}%
                </span>
              </div>
            </div>

            {/* Card 4: Total Invoices */}
            <div className="p-5 rounded-2xl bg-white border border-slate-200 shadow-xs space-y-2">
              <div className="flex items-center justify-between text-slate-500 text-xs font-semibold">
                <span>TAX INVOICES CLOSED</span>
                <span className="p-1.5 rounded-lg bg-purple-50 text-purple-600">
                  <FileText className="w-4 h-4" />
                </span>
              </div>
              <h3 className="text-2xl font-bold font-mono text-slate-900">
                {allInvoices.length} <span className="text-sm font-normal text-slate-400">Bills</span>
              </h3>
              <p className="text-xs text-slate-500 flex items-center justify-between">
                <span>Commercial business</span>
                <span className="text-[11px] font-mono text-emerald-600 font-bold">
                  {allInvoices.filter(i => i.status === 'Paid').length} Paid
                </span>
              </p>
            </div>

          </div>

          {/* Analytics Row: Department Revenue Breakdown & Performance Gauge */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            
            {/* Visual Analytics 1: Department Revenue Contribution (2 Cols) */}
            <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                    <BarChart3 className="w-4 h-4 text-emerald-600" />
                    <span>Commercial Revenue Distribution by Department</span>
                  </h3>
                  <p className="text-xs text-slate-400">
                    Gross contribution &amp; profit margins across all 6 commercial business units
                  </p>
                </div>
                <button
                  onClick={() => setInternalTab('income')}
                  className="text-xs font-mono text-emerald-700 hover:text-emerald-800 font-bold flex items-center gap-1 cursor-pointer"
                >
                  <span>Detailed Analysis</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Multi-segment stacked progress bar */}
              <div className="space-y-1.5">
                <div className="w-full h-3 rounded-full bg-slate-100 flex overflow-hidden gap-0.5">
                  {departmentMetrics.map(dept => {
                    const pct = totals.totalGrossIncome > 0
                      ? (dept.grossIncome / totals.totalGrossIncome) * 100
                      : 0;
                    const style = deptColorMap[dept.departmentId] || { bg: 'bg-slate-400' };
                    return (
                      <div
                        key={dept.departmentId}
                        style={{ width: `${pct}%` }}
                        className={`${style.bg} h-full transition-all duration-300 hover:opacity-90`}
                        title={`${dept.departmentName}: ${pct.toFixed(1)}% (${formatCurrency(dept.grossIncome)})`}
                      />
                    );
                  })}
                </div>
                <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono">
                  <span>0%</span>
                  <span>Consolidated Total: {formatCurrency(totals.totalGrossIncome)}</span>
                  <span>100%</span>
                </div>
              </div>

              {/* Compact Department Table Grid */}
              <div className="divide-y divide-slate-100 text-xs">
                {departmentMetrics.map(dept => {
                  const sharePct = totals.totalGrossIncome > 0
                    ? ((dept.grossIncome / totals.totalGrossIncome) * 100).toFixed(1)
                    : '0';
                  const style = deptColorMap[dept.departmentId] || { bg: 'bg-slate-400', text: 'text-slate-700' };
                  return (
                    <div
                      key={dept.departmentId}
                      onClick={() => handleSelectDeptForInvoice(dept.departmentId)}
                      className="py-2.5 flex items-center justify-between hover:bg-slate-50/80 px-2 rounded-xl transition-colors cursor-pointer group"
                    >
                      <div className="flex items-center gap-3">
                        <span className={`w-2.5 h-2.5 rounded-full ${style.bg} shrink-0`} />
                        <div>
                          <span className="font-bold text-slate-800 group-hover:text-emerald-700 transition-colors">
                            {dept.departmentName}
                          </span>
                          <span className="text-[11px] text-slate-400 block font-mono">
                            {dept.totalInvoicesCount} Invoices &bull; Top: {dept.topPerformerName}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-4 text-right font-mono">
                        <div>
                          <strong className="text-slate-900 block">{formatCurrency(dept.grossIncome)}</strong>
                          <span className="text-[11px] text-slate-400">{sharePct}% share</span>
                        </div>
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                          {dept.profitMarginPct}% Margin
                        </span>
                        <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-emerald-600 group-hover:translate-x-0.5 transition-all" />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Visual Analytics 2: Financial Health & Quick Actions (1 Col) */}
            <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-4 flex flex-col justify-between">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                    <PieChart className="w-4 h-4 text-blue-600" />
                    <span>Quarterly Target Health</span>
                  </h3>
                  <span className="text-[11px] font-mono text-slate-400">Q3 Real-time</span>
                </div>

                {/* Target Progress Meter */}
                <div className="p-4 rounded-xl bg-slate-50 border border-slate-100 space-y-3">
                  <div className="flex justify-between items-baseline">
                    <span className="text-xs text-slate-500">Target Achievement</span>
                    <strong className="text-lg font-bold font-mono text-emerald-700">
                      {totals.targetAchievedPct}%
                    </strong>
                  </div>
                  <div className="w-full bg-slate-200 h-2 rounded-full overflow-hidden">
                    <div
                      className="bg-emerald-500 h-full rounded-full transition-all duration-500"
                      style={{ width: `${Math.min(totals.targetAchievedPct, 100)}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-[11px] font-mono text-slate-500">
                    <span>Closed: {formatCurrency(totals.totalGrossIncome)}</span>
                    <span>Target: {formatCurrency(totals.totalMonthlyTarget)}</span>
                  </div>
                </div>

                {/* Efficiency Stats */}
                <div className="space-y-2 text-xs font-mono">
                  <div className="flex justify-between p-2.5 rounded-lg bg-emerald-50/50 border border-emerald-100/60">
                    <span className="text-slate-600">Company Operating Profit:</span>
                    <strong className="text-emerald-800">{formatCurrency(totals.totalNetEarnings)}</strong>
                  </div>
                  <div className="flex justify-between p-2.5 rounded-lg bg-rose-50/50 border border-rose-100/60">
                    <span className="text-slate-600">Expense-to-Revenue Ratio:</span>
                    <strong className="text-rose-800">
                      {Math.round((totals.totalExpenses / (totals.totalGrossIncome || 1)) * 100)}%
                    </strong>
                  </div>
                </div>
              </div>

              {/* Quick Jump Buttons */}
              <div className="pt-3 border-t border-slate-100 space-y-2">
                <span className="text-[11px] font-mono text-slate-400 font-bold uppercase block">
                  Quick Navigation
                </span>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setInternalTab('expense')}
                    className="p-2.5 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-800 text-xs font-bold text-left transition-colors cursor-pointer"
                  >
                    <Receipt className="w-3.5 h-3.5 mb-1 text-rose-600" />
                    <span>Expense Ledger</span>
                  </button>
                  <button
                    onClick={() => {
                      setSelectedDeptForInvoice(undefined);
                      setInternalTab('invoice');
                    }}
                    className="p-2.5 rounded-xl bg-blue-50 hover:bg-blue-100 text-blue-800 text-xs font-bold text-left transition-colors cursor-pointer"
                  >
                    <FileText className="w-3.5 h-3.5 mb-1 text-blue-600" />
                    <span>Invoices &amp; Tax PDFs</span>
                  </button>
                </div>
              </div>

            </div>

          </div>

          {/* Recent Invoices Pipeline (Real-Time Synchronized Stream) */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <FileCheck2 className="w-4 h-4 text-blue-600" />
                  <span>Recent Department Invoices &amp; Billing Inflow</span>
                </h3>
                <p className="text-xs text-slate-400">
                  Live commercial tax invoices created by sales executives across business divisions
                </p>
              </div>

              <button
                onClick={() => {
                  setSelectedDeptForInvoice(undefined);
                  setInternalTab('invoice');
                }}
                className="text-xs font-mono font-bold text-blue-600 hover:text-blue-700 flex items-center gap-1 cursor-pointer self-start sm:self-auto"
              >
                <span>View All Invoices ({allInvoices.length})</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-100 text-[11px] font-mono text-slate-400 uppercase">
                    <th className="py-2.5 pl-2 pr-4">Invoice #</th>
                    <th className="py-2.5 pr-4">Department</th>
                    <th className="py-2.5 pr-4">Client / Organization</th>
                    <th className="py-2.5 pr-4">Sales Executive</th>
                    <th className="py-2.5 pr-4">Status</th>
                    <th className="py-2.5 pr-4 text-right">Amount (₹)</th>
                    <th className="py-2.5 pr-2 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-sans">
                  {recentInvoices.map(inv => {
                    const normDept = normalizeDepartmentId(inv.departmentId);
                    const colorStyle = deptColorMap[normDept] || { bg: 'bg-slate-500', text: 'text-slate-700' };
                    return (
                      <tr key={inv.id} className="hover:bg-slate-50/70 transition-colors">
                        <td className="py-3 pl-2 pr-4 font-mono font-bold text-slate-900">
                          {inv.invoiceNumber}
                        </td>
                        <td className="py-3 pr-4">
                          <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-50 border border-slate-200 text-slate-700`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${colorStyle.bg}`} />
                            <span>{inv.departmentName}</span>
                          </span>
                        </td>
                        <td className="py-3 pr-4">
                          <span className="font-semibold text-slate-800 block">{inv.clientCompany}</span>
                          <span className="text-[11px] text-slate-400">{inv.clientName}</span>
                        </td>
                        <td className="py-3 pr-4 font-mono text-slate-600">
                          {inv.teamMemberName}
                        </td>
                        <td className="py-3 pr-4">
                          <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-mono font-bold uppercase ${
                            inv.status === 'Paid'
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              : 'bg-amber-50 text-amber-700 border border-amber-200'
                          }`}>
                            {inv.status}
                          </span>
                        </td>
                        <td className="py-3 pr-4 text-right font-mono font-bold text-slate-900">
                          {formatCurrency(inv.totalAmount)}
                        </td>
                        <td className="py-3 pr-2 text-right">
                          <button
                            onClick={() => setActiveInvoiceForPdf(inv)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-white font-mono text-[11px] font-bold transition-all active:scale-95 cursor-pointer"
                          >
                            <Eye className="w-3 h-3 text-emerald-400" />
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
