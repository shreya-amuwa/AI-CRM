import React, { useState, useEffect } from 'react';
import {
  TrendingUp, TrendingDown, DollarSign, BarChart3, PieChart,
  ArrowUpRight, ArrowDownRight, Building2, CheckCircle2, Target,
  Filter, Search, ArrowRight, ShieldCheck, Sparkles, AlertCircle,
  ChevronRight
} from 'lucide-react';
import { accountsStore, DepartmentFinancialMetric } from '../../../services/accountsStore';

interface IncomeViewProps {
  onSelectDepartmentForInvoice?: (departmentId: string) => void;
}

export const IncomeView: React.FC<IncomeViewProps> = ({ onSelectDepartmentForInvoice }) => {
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const handleInvoiceCreated = () => {
      setRefreshKey(prev => prev + 1);
    };
    window.addEventListener('amuwa_crm_invoice_created', handleInvoiceCreated);
    window.addEventListener('storage', handleInvoiceCreated);
    return () => {
      window.removeEventListener('amuwa_crm_invoice_created', handleInvoiceCreated);
      window.removeEventListener('storage', handleInvoiceCreated);
    };
  }, []);

  const metrics = accountsStore.getDepartmentMetrics();
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
    <div className="space-y-6 animate-fade-in font-sans">
      
      {/* Sleek Sub-Header with Quick Context */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
        <div>
          <h2 className="text-base font-bold font-heading text-slate-900 flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-emerald-600" />
            <span>Department Income &amp; Profitability Statement</span>
          </h2>
          <p className="text-xs text-slate-500">
            Compare gross revenue, operational expenses, and net profit margins across active operating units.
          </p>
        </div>

        <div className="flex items-center gap-3 font-mono text-xs">
          <span className="text-slate-400">Total Revenue:</span>
          <strong className="text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-200">
            {formatCurrency(totals.totalGrossIncome)}
          </strong>
        </div>
      </div>

      {/* Filters and Search Bar */}
      <div className="flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-3 bg-white p-3.5 rounded-2xl border border-slate-200 shadow-xs">
        <div className="relative flex-1 max-w-md">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search department..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium focus:outline-none focus:bg-white text-slate-900 transition-colors"
          />
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-slate-400">Sort:</span>
          <button
            onClick={() => setSortBy('income')}
            className={`px-3 py-1.5 rounded-xl text-xs font-mono font-semibold transition-all cursor-pointer ${
              sortBy === 'income'
                ? 'bg-slate-900 text-white shadow-xs'
                : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
            }`}
          >
            Income
          </button>
          <button
            onClick={() => setSortBy('profit')}
            className={`px-3 py-1.5 rounded-xl text-xs font-mono font-semibold transition-all cursor-pointer ${
              sortBy === 'profit'
                ? 'bg-slate-900 text-white shadow-xs'
                : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
            }`}
          >
            Net Profit
          </button>
          <button
            onClick={() => setSortBy('margin')}
            className={`px-3 py-1.5 rounded-xl text-xs font-mono font-semibold transition-all cursor-pointer ${
              sortBy === 'margin'
                ? 'bg-slate-900 text-white shadow-xs'
                : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
            }`}
          >
            Margin %
          </button>
        </div>
      </div>

      {/* Clean Department Financial Cards Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {filteredMetrics.map(dept => {
          const expenseRatio = Math.round((dept.totalExpenses / (dept.grossIncome || 1)) * 100);
          const profitRatio = Math.round((dept.netEarnings / (dept.grossIncome || 1)) * 100);

          return (
            <div
              key={dept.departmentId}
              className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs hover:shadow-md transition-all space-y-4 relative overflow-hidden group"
            >
              {/* Top Accent Strip */}
              <div
                className="h-1 w-full absolute top-0 left-0 right-0"
                style={{ backgroundColor: dept.accentColor }}
              />

              {/* Header Row */}
              <div className="flex items-center justify-between pt-1">
                <div className="flex items-center gap-3">
                  {dept.logoUrl ? (
                    <div className="w-10 h-10 rounded-xl bg-slate-50 p-1 border border-slate-200 flex items-center justify-center shrink-0">
                      <img src={dept.logoUrl} alt={dept.departmentName} className="max-h-full max-w-full object-contain" />
                    </div>
                  ) : (
                    <div
                      className="w-10 h-10 rounded-xl flex items-center justify-center font-bold text-white shrink-0"
                      style={{ backgroundColor: dept.accentColor }}
                    >
                      <Building2 className="w-5 h-5" />
                    </div>
                  )}
                  <div>
                    <h3 className="text-base font-bold font-heading text-slate-900 group-hover:text-emerald-700 transition-colors">
                      {dept.departmentName}
                    </h3>
                    <p className="text-[11px] text-slate-400 font-mono">
                      Lead: <strong className="text-slate-700">{dept.topPerformerName}</strong> &bull; {dept.activeTeamMembersCount} Members
                    </p>
                  </div>
                </div>

                <div className="text-right font-mono">
                  <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 inline-block">
                    {dept.profitMarginPct}% Margin
                  </span>
                  <span className="text-[10px] text-slate-400 block mt-0.5">
                    Target: {dept.targetAchievedPct}%
                  </span>
                </div>
              </div>

              {/* 3 Metric Pillars */}
              <div className="grid grid-cols-3 gap-2 p-3 rounded-xl bg-slate-50 border border-slate-100 text-center font-mono">
                <div>
                  <span className="text-[10px] font-bold uppercase text-slate-400 block">Gross Income</span>
                  <p className="text-sm sm:text-base font-bold text-emerald-800">{formatCurrency(dept.grossIncome)}</p>
                  <span className="text-[10px] text-slate-400">{dept.totalInvoicesCount} Invoices</span>
                </div>
                <div className="border-x border-slate-200">
                  <span className="text-[10px] font-bold uppercase text-slate-400 block">Expenses</span>
                  <p className="text-sm sm:text-base font-bold text-rose-700">{formatCurrency(dept.totalExpenses)}</p>
                  <span className="text-[10px] text-slate-400">{expenseRatio}% Ratio</span>
                </div>
                <div>
                  <span className="text-[10px] font-bold uppercase text-slate-400 block">Net Profit</span>
                  <p className="text-sm sm:text-base font-bold text-blue-800">{formatCurrency(dept.netEarnings)}</p>
                  <span className="text-[10px] text-emerald-600 font-semibold">Retained</span>
                </div>
              </div>

              {/* Visual Split Bar */}
              <div className="space-y-1">
                <div className="flex justify-between text-[11px] font-mono text-slate-400">
                  <span>Expenses: {expenseRatio}%</span>
                  <span>Profit: {profitRatio}%</span>
                </div>
                <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden flex">
                  <div className="h-full bg-rose-400" style={{ width: `${expenseRatio}%` }} />
                  <div className="h-full bg-emerald-500" style={{ width: `${profitRatio}%` }} />
                </div>
              </div>

              {/* Action Footer */}
              {onSelectDepartmentForInvoice && (
                <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-xs">
                  <span className="text-[11px] font-mono text-slate-400">
                    {dept.totalQuotationsCount} Quotes &bull; {dept.totalInvoicesCount} Tax Invoices
                  </span>
                  <button
                    onClick={() => onSelectDepartmentForInvoice(dept.departmentId)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-semibold font-mono text-xs transition-colors cursor-pointer active:scale-95"
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
  );
};
