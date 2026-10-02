import React, { useState } from 'react';
import {
  TrendingUp, TrendingDown, DollarSign, BarChart3, PieChart,
  ArrowUpRight, ArrowDownRight, Building2, CheckCircle2, Target,
  Filter, Search, ArrowRight, ShieldCheck, Sparkles, AlertCircle
} from 'lucide-react';
import { accountsStore, DepartmentFinancialMetric } from '../../../services/accountsStore';

interface IncomeViewProps {
  onSelectDepartmentForInvoice?: (departmentId: string) => void;
}

export const IncomeView: React.FC<IncomeViewProps> = ({ onSelectDepartmentForInvoice }) => {
  const [metrics] = useState<DepartmentFinancialMetric[]>(() => accountsStore.getDepartmentMetrics());
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState<'income' | 'profit' | 'margin'>('income');

  const totals = accountsStore.getCompanyFinancialTotals();

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0
    }).format(amount);
  };

  const filteredMetrics = metrics
    .filter(m => m.departmentName.toLowerCase().includes(searchTerm.toLowerCase()))
    .sort((a, b) => {
      if (sortBy === 'income') return b.grossIncome - a.grossIncome;
      if (sortBy === 'profit') return b.netEarnings - a.netEarnings;
      return b.profitMarginPct - a.profitMarginPct;
    });

  return (
    <div className="space-y-8 animate-fade-in font-sans">
      
      {/* Top Banner & Context */}
      <div className="bg-white border border-slate-200 rounded-3xl p-6 sm:p-8 shadow-sm relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-gradient-to-bl from-emerald-500/10 via-teal-500/5 to-transparent rounded-full pointer-events-none blur-3xl" />
        
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 relative z-10">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-mono font-semibold">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span>CORPORATE REVENUE INTELLIGENCE</span>
            </div>
            <h2 className="text-2xl sm:text-3xl font-bold font-heading text-slate-900 tracking-tight">
              Department-Wise Income &amp; Earnings Overview
            </h2>
            <p className="text-sm text-slate-500 max-w-2xl leading-relaxed">
              Consolidated financial statement displaying gross income, corporate operating expenses, and net profit margins across all active operating business units.
            </p>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <div className="text-right font-mono">
              <span className="text-[11px] text-slate-400 uppercase block font-semibold">Financial Year 2026-27</span>
              <span className="text-xs text-emerald-700 font-bold bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-200">
                Quarter 3 Real-time Audit
              </span>
            </div>
          </div>
        </div>

        {/* 4 Company-Wide Metric Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-8 pt-8 border-t border-slate-100">
          
          {/* Card 1: Total Company Income */}
          <div className="p-5 rounded-2xl bg-gradient-to-br from-emerald-50 to-teal-50/50 border border-emerald-200/80 shadow-2xs space-y-1">
            <div className="flex items-center justify-between text-emerald-800">
              <span className="text-xs font-mono font-bold uppercase tracking-wider">Total Gross Income</span>
              <div className="p-2 rounded-xl bg-emerald-100 text-emerald-700">
                <TrendingUp className="w-4 h-4" />
              </div>
            </div>
            <h3 className="text-2xl sm:text-3xl font-bold font-mono text-emerald-950 pt-1">
              {formatCurrency(totals.totalGrossIncome)}
            </h3>
            <p className="text-xs text-emerald-700 font-mono flex items-center gap-1">
              <ArrowUpRight className="w-3.5 h-3.5" />
              <span>Across {totals.activeDepartmentsCount} business departments</span>
            </p>
          </div>

          {/* Card 2: Total Operating Expenses */}
          <div className="p-5 rounded-2xl bg-gradient-to-br from-rose-50 to-orange-50/50 border border-rose-200/80 shadow-2xs space-y-1">
            <div className="flex items-center justify-between text-rose-800">
              <span className="text-xs font-mono font-bold uppercase tracking-wider">Total Expenses</span>
              <div className="p-2 rounded-xl bg-rose-100 text-rose-700">
                <TrendingDown className="w-4 h-4" />
              </div>
            </div>
            <h3 className="text-2xl sm:text-3xl font-bold font-mono text-rose-950 pt-1">
              {formatCurrency(totals.totalExpenses)}
            </h3>
            <p className="text-xs text-rose-700 font-mono">
              Corporate operations &amp; infrastructure
            </p>
          </div>

          {/* Card 3: Total Net Earnings / Profit */}
          <div className="p-5 rounded-2xl bg-gradient-to-br from-blue-50 to-indigo-50/50 border border-blue-200/80 shadow-2xs space-y-1">
            <div className="flex items-center justify-between text-blue-800">
              <span className="text-xs font-mono font-bold uppercase tracking-wider">Total Net Earnings</span>
              <div className="p-2 rounded-xl bg-blue-100 text-blue-700">
                <DollarSign className="w-4 h-4" />
              </div>
            </div>
            <h3 className="text-2xl sm:text-3xl font-bold font-mono text-blue-950 pt-1">
              {formatCurrency(totals.totalNetEarnings)}
            </h3>
            <p className="text-xs text-blue-700 font-mono">
              Net retained corporate profit
            </p>
          </div>

          {/* Card 4: Profit Margin & Target */}
          <div className="p-5 rounded-2xl bg-gradient-to-br from-purple-50 to-fuchsia-50/50 border border-purple-200/80 shadow-2xs space-y-1">
            <div className="flex items-center justify-between text-purple-800">
              <span className="text-xs font-mono font-bold uppercase tracking-wider">Net Profit Margin</span>
              <div className="p-2 rounded-xl bg-purple-100 text-purple-700">
                <PieChart className="w-4 h-4" />
              </div>
            </div>
            <h3 className="text-2xl sm:text-3xl font-bold font-mono text-purple-950 pt-1">
              {totals.overallMarginPct}%
            </h3>
            <p className="text-xs text-purple-700 font-mono">
              Target achievement: {totals.targetAchievedPct}%
            </p>
          </div>

        </div>
      </div>

      {/* Department-Wise Breakdown Section */}
      <div className="space-y-4">
        
        {/* Filters and Search Bar */}
        <div className="flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-4 bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search department income..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono focus:outline-hidden focus:border-emerald-500 focus:bg-white text-slate-900 transition-colors"
            />
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs font-mono text-slate-500">Sort by:</span>
            <button
              onClick={() => setSortBy('income')}
              className={`px-3 py-1.5 rounded-xl text-xs font-mono font-semibold transition-all ${
                sortBy === 'income'
                  ? 'bg-slate-900 text-white shadow-xs'
                  : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
              }`}
            >
              Income
            </button>
            <button
              onClick={() => setSortBy('profit')}
              className={`px-3 py-1.5 rounded-xl text-xs font-mono font-semibold transition-all ${
                sortBy === 'profit'
                  ? 'bg-slate-900 text-white shadow-xs'
                  : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
              }`}
            >
              Net Profit
            </button>
            <button
              onClick={() => setSortBy('margin')}
              className={`px-3 py-1.5 rounded-xl text-xs font-mono font-semibold transition-all ${
                sortBy === 'margin'
                  ? 'bg-slate-900 text-white shadow-xs'
                  : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
              }`}
            >
              Margin %
            </button>
          </div>
        </div>

        {/* Detailed Department Financial Cards Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {filteredMetrics.map(dept => {
            const expenseRatio = Math.round((dept.totalExpenses / dept.grossIncome) * 100);
            const profitRatio = Math.round((dept.netEarnings / dept.grossIncome) * 100);

            return (
              <div
                key={dept.departmentId}
                className="bg-white rounded-3xl border border-slate-200 p-6 shadow-sm hover:shadow-md transition-all space-y-6 relative overflow-hidden group"
              >
                {/* Top Accent Strip */}
                <div
                  className="h-1.5 w-full absolute top-0 left-0 right-0"
                  style={{ backgroundColor: dept.accentColor }}
                />

                {/* Header Row */}
                <div className="flex items-center justify-between pt-1">
                  <div className="flex items-center gap-3">
                    {dept.logoUrl ? (
                      <div className="w-12 h-12 rounded-2xl bg-slate-50 p-1.5 border border-slate-200 flex items-center justify-center shrink-0 shadow-2xs">
                        <img src={dept.logoUrl} alt={dept.departmentName} className="max-h-full max-w-full object-contain" />
                      </div>
                    ) : (
                      <div
                        className="w-12 h-12 rounded-2xl flex items-center justify-center font-bold text-white shadow-2xs"
                        style={{ backgroundColor: dept.accentColor }}
                      >
                        <Building2 className="w-6 h-6" />
                      </div>
                    )}
                    <div>
                      <h3 className="text-lg font-bold font-heading text-slate-900 group-hover:text-emerald-700 transition-colors">
                        {dept.departmentName}
                      </h3>
                      <p className="text-xs text-slate-400 font-mono">
                        Top Performer: <strong className="text-slate-700">{dept.topPerformerName}</strong> &bull; {dept.activeTeamMembersCount} Staff
                      </p>
                    </div>
                  </div>

                  <div className="text-right font-mono">
                    <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 inline-block">
                      {dept.profitMarginPct}% Margin
                    </span>
                    <span className="text-[10px] text-slate-400 block mt-1">
                      Target: {dept.targetAchievedPct}% Achieved
                    </span>
                  </div>
                </div>

                {/* Financial Pillars (Income / Expense / Net Profit) */}
                <div className="grid grid-cols-3 gap-3 p-4 rounded-2xl bg-slate-50 border border-slate-100 text-center">
                  
                  {/* Column 1: Gross Income */}
                  <div className="space-y-1">
                    <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-slate-500">
                      GROSS INCOME
                    </span>
                    <p className="text-base sm:text-lg font-bold font-mono text-emerald-800">
                      {formatCurrency(dept.grossIncome)}
                    </p>
                    <span className="text-[10px] text-slate-400 font-mono">{dept.totalInvoicesCount} Invoices</span>
                  </div>

                  {/* Column 2: Total Expenses */}
                  <div className="space-y-1 border-x border-slate-200">
                    <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-slate-500">
                      EXPENSES
                    </span>
                    <p className="text-base sm:text-lg font-bold font-mono text-rose-700">
                      {formatCurrency(dept.totalExpenses)}
                    </p>
                    <span className="text-[10px] text-slate-400 font-mono">{expenseRatio}% of income</span>
                  </div>

                  {/* Column 3: Net Earnings */}
                  <div className="space-y-1">
                    <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-slate-500">
                      NET EARNINGS
                    </span>
                    <p className="text-base sm:text-lg font-bold font-mono text-blue-800">
                      {formatCurrency(dept.netEarnings)}
                    </p>
                    <span className="text-[10px] text-emerald-700 font-mono font-semibold">Net Retained</span>
                  </div>

                </div>

                {/* Progress Bar of Income Distribution */}
                <div className="space-y-2">
                  <div className="flex justify-between text-xs font-mono text-slate-500">
                    <span>Operating Expense vs Net Profit Ratio:</span>
                    <span>{expenseRatio}% Expense / {profitRatio}% Profit</span>
                  </div>
                  <div className="h-2.5 w-full bg-slate-100 rounded-full overflow-hidden flex">
                    <div
                      className="h-full bg-rose-400 transition-all duration-500"
                      style={{ width: `${expenseRatio}%` }}
                      title={`Expense: ${expenseRatio}%`}
                    />
                    <div
                      className="h-full bg-emerald-500 transition-all duration-500"
                      style={{ width: `${profitRatio}%` }}
                      title={`Net Profit: ${profitRatio}%`}
                    />
                  </div>
                </div>

                {/* Target Progress Bar */}
                <div className="space-y-2">
                  <div className="flex justify-between text-xs font-mono text-slate-500">
                    <span>Monthly Target ({formatCurrency(dept.monthlyTarget)}):</span>
                    <span className="font-semibold text-slate-800">{dept.targetAchievedPct}%</span>
                  </div>
                  <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-600 rounded-full transition-all duration-500"
                      style={{ width: `${Math.min(dept.targetAchievedPct, 100)}%` }}
                    />
                  </div>
                </div>

                {/* Action Footer */}
                {onSelectDepartmentForInvoice && (
                  <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
                    <span className="text-xs font-mono text-slate-400">
                      {dept.totalQuotationsCount} Quotes &bull; {dept.totalInvoicesCount} Tax Invoices
                    </span>
                    <button
                      onClick={() => onSelectDepartmentForInvoice(dept.departmentId)}
                      className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold font-mono text-xs transition-colors"
                    >
                      <span>View Invoices &amp; Team</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}

              </div>
            );
          })}
        </div>

      </div>

    </div>
  );
};
