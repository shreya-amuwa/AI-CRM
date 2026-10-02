import React, { useState } from 'react';
import {
  TrendingDown, TrendingUp, DollarSign, Filter, Search, Plus, Calendar,
  Building2, CheckCircle2, ShieldCheck, Tag, Receipt, ArrowRight,
  FileText, Clock, AlertTriangle, X, Check, BarChart3, PieChart, Layers,
  ChevronRight, Sparkles, Activity
} from 'lucide-react';
import {
  accountsStore,
  CorporateExpense,
  DepartmentDailyExpense,
  DepartmentMonthlyExpense
} from '../../../services/accountsStore';

export const ExpenseView: React.FC = () => {
  // Upper Category Timeframe State: 'daily' | 'monthly' | 'vouchers'
  const [expenseTimeframe, setExpenseTimeframe] = useState<'daily' | 'monthly' | 'vouchers'>('daily');

  // Sub-filtering states
  const [dailyFilterDept, setDailyFilterDept] = useState<string>('all');
  const [monthlyFilterDept, setMonthlyFilterDept] = useState<string>('all');

  // Vouchers state
  const [expenses, setExpenses] = useState<CorporateExpense[]>(() => accountsStore.getExpenses());
  const [selectedDept, setSelectedDept] = useState<string>('all');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);

  // Daily & Monthly live store data
  const [dailyList, setDailyList] = useState<DepartmentDailyExpense[]>(() => accountsStore.getDailyExpenses());
  const [monthlyList, setMonthlyList] = useState<DepartmentMonthlyExpense[]>(() => accountsStore.getMonthlyExpenses());
  const dailyCompanyTotals = accountsStore.getDailyCompanyTotal();
  const monthlyCompanyTotals = accountsStore.getMonthlyCompanyTotal();

  // New Expense Form State
  const [newDeptId, setNewDeptId] = useState('wabastore');
  const [newCategory, setNewCategory] = useState<CorporateExpense['category']>('Cloud & Server Infrastructure');
  const [newReason, setNewReason] = useState('');
  const [newAmount, setNewAmount] = useState('');
  const [newPaymentMode, setNewPaymentMode] = useState('Corporate Wire (HDFC Current A/C)');
  const [newApprovedBy, setNewApprovedBy] = useState('Accounts Head (Rajiv Khanna)');
  const [newInvoiceRef, setNewInvoiceRef] = useState('');

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0
    }).format(amount);
  };

  const departmentsList = [
    { id: 'all', name: 'All Departments' },
    { id: 'wabastore', name: 'Wabastore' },
    { id: 'wabastar', name: 'Wabastar' },
    { id: 'whatsbox', name: 'Whatsbox' },
    { id: 'dtalk', name: 'D Talk Corporation' },
    { id: 'digitree', name: 'Digitree Infotech' },
    { id: 'mpillar', name: 'M Pillar Corporation' }
  ];

  const categoriesList = [
    'all',
    'Cloud & Server Infrastructure',
    'API Subscriptions & Telecom',
    'Software & SaaS Licenses',
    'Corporate Office & Facilities',
    'Payroll & Executive Compensation',
    'Client Acquisition & Ad Spend',
    'Legal, Compliance & Retainers',
    'Hardware & Workstations'
  ];

  // Filtering for vouchers
  const filteredExpenses = expenses.filter(exp => {
    const matchDept = selectedDept === 'all' || exp.departmentId === selectedDept;
    const matchCat = selectedCategory === 'all' || exp.category === selectedCategory;
    const matchSearch =
      searchQuery === '' ||
      exp.corporateReason.toLowerCase().includes(searchQuery.toLowerCase()) ||
      exp.departmentName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      exp.invoiceRef.toLowerCase().includes(searchQuery.toLowerCase()) ||
      exp.category.toLowerCase().includes(searchQuery.toLowerCase());
    return matchDept && matchCat && matchSearch;
  });

  const totalFilteredAmount = filteredExpenses.reduce((sum, e) => sum + e.amount, 0);
  const totalAllAmount = expenses.reduce((sum, e) => sum + e.amount, 0);

  // Department-wise spend aggregated
  const deptSpendMap: Record<string, number> = {};
  expenses.forEach(e => {
    deptSpendMap[e.departmentName] = (deptSpendMap[e.departmentName] || 0) + e.amount;
  });
  const topSpendingDept = Object.entries(deptSpendMap).sort((a, b) => b[1] - a[1])[0] || ['None', 0];

  // Filtered Daily & Monthly lists
  const filteredDailyList = dailyFilterDept === 'all'
    ? dailyList
    : dailyList.filter(d => d.departmentId === dailyFilterDept);

  const filteredMonthlyList = monthlyFilterDept === 'all'
    ? monthlyList
    : monthlyList.filter(m => m.departmentId === monthlyFilterDept);

  const handleCreateExpense = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newReason || !newAmount) return;

    const deptObj = departmentsList.find(d => d.id === newDeptId);
    accountsStore.addCorporateExpense({
      departmentId: newDeptId,
      departmentName: deptObj?.name || 'Wabastore',
      category: newCategory,
      corporateReason: newReason,
      amount: parseFloat(newAmount),
      date: new Date().toISOString().split('T')[0],
      paymentMode: newPaymentMode,
      approvedBy: newApprovedBy,
      invoiceRef: newInvoiceRef || `PO-CORP-${Math.floor(1000 + Math.random() * 9000)}`,
      status: 'Settled'
    });

    setExpenses(accountsStore.getExpenses());
    setDailyList(accountsStore.getDailyExpenses());
    setMonthlyList(accountsStore.getMonthlyExpenses());
    setShowAddModal(false);
    setNewReason('');
    setNewAmount('');
    setNewInvoiceRef('');
  };

  const jumpToDepartmentVouchers = (deptId: string) => {
    setSelectedDept(deptId);
    setExpenseTimeframe('vouchers');
  };

  return (
    <div className="space-y-8 animate-fade-in font-sans">
      
      {/* =========================================================================
          UPPER CATEGORY SELECTOR BAR (DAILY / MONTHLY / VOUCHERS)
          ========================================================================= */}
      <div className="bg-white border border-slate-200 rounded-2xl p-3.5 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          
          <div className="flex flex-wrap items-center gap-2">
            {/* 1. Daily Tab */}
            <button
              onClick={() => setExpenseTimeframe('daily')}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-mono font-bold transition-all cursor-pointer ${
                expenseTimeframe === 'daily'
                  ? 'bg-rose-600 text-white shadow-xs'
                  : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
              }`}
            >
              <Calendar className="w-3.5 h-3.5" />
              <span>Daily Expenses</span>
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                expenseTimeframe === 'daily'
                  ? 'bg-rose-700 text-white'
                  : 'bg-slate-200 text-slate-600'
              }`}>
                {formatCurrency(dailyCompanyTotals.todayTotal)} Today
              </span>
            </button>

            {/* 2. Monthly Tab */}
            <button
              onClick={() => setExpenseTimeframe('monthly')}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-mono font-bold transition-all cursor-pointer ${
                expenseTimeframe === 'monthly'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
              }`}
            >
              <Clock className="w-3.5 h-3.5" />
              <span>Monthly Budget</span>
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                expenseTimeframe === 'monthly'
                  ? 'bg-blue-700 text-white'
                  : 'bg-slate-200 text-slate-600'
              }`}>
                {formatCurrency(monthlyCompanyTotals.monthlyTotal)}
              </span>
            </button>

            {/* 3. Vouchers & Audit Log Tab */}
            <button
              onClick={() => setExpenseTimeframe('vouchers')}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-mono font-bold transition-all cursor-pointer ${
                expenseTimeframe === 'vouchers'
                  ? 'bg-slate-900 text-white shadow-xs'
                  : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
              }`}
            >
              <Receipt className="w-3.5 h-3.5 text-emerald-400" />
              <span>Vouchers Ledger</span>
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                expenseTimeframe === 'vouchers'
                  ? 'bg-slate-800 text-slate-200'
                  : 'bg-slate-200 text-slate-600'
              }`}>
                {expenses.length} Records
              </span>
            </button>
          </div>

          {/* Quick Record Action */}
          <div className="shrink-0">
            <button
              onClick={() => setShowAddModal(true)}
              className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-mono font-bold text-xs shadow-xs transition-all active:scale-95 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5 text-emerald-400" />
              <span>Record Expense</span>
            </button>
          </div>

        </div>
      </div>

      {/* =========================================================================
          VIEW 1: DAILY EXPENSES (DEPARTMENT-WISE)
          ========================================================================= */}
      {expenseTimeframe === 'daily' && (
        <div className="space-y-8 animate-fade-in">
          
          {/* Daily Header Banner */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
            <div>
              <h2 className="text-base font-bold font-heading text-slate-900 flex items-center gap-2">
                <Calendar className="w-4 h-4 text-rose-600" />
                <span>Daily Corporate Expenses &bull; Department Breakdown</span>
              </h2>
              <p className="text-xs text-slate-500">
                Track daily operational burn rate, cloud compute, and API bandwidth quotas across all 6 units.
              </p>
            </div>
            <div className="flex items-center gap-2 text-xs font-mono">
              <span className="text-slate-400">Total Today:</span>
              <strong className="text-rose-700 bg-rose-50 px-2.5 py-1 rounded-lg border border-rose-200">
                {formatCurrency(dailyCompanyTotals.todayTotal)}
              </strong>
            </div>
          </div>

          {/* 4 Daily KPI Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="p-5 rounded-2xl bg-rose-50/70 border border-rose-200/80 shadow-2xs space-y-1">
                <div className="flex items-center justify-between text-rose-800">
                  <span className="text-xs font-mono font-bold uppercase tracking-wider">Today's Total Spend</span>
                  <Activity className="w-4 h-4 text-rose-600" />
                </div>
                <h3 className="text-2xl sm:text-3xl font-bold font-mono text-rose-950 pt-1">
                  {formatCurrency(dailyCompanyTotals.todayTotal)}
                </h3>
                <p className="text-xs text-rose-700 font-mono">Across 6 operating business units</p>
              </div>

              <div className="p-5 rounded-2xl bg-emerald-50/70 border border-emerald-200/80 shadow-2xs space-y-1">
                <div className="flex items-center justify-between text-emerald-800">
                  <span className="text-xs font-mono font-bold uppercase tracking-wider">Daily Budget Cap</span>
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                </div>
                <h3 className="text-2xl sm:text-3xl font-bold font-mono text-emerald-950 pt-1">
                  {formatCurrency(dailyCompanyTotals.dailyBudgetTotal)}
                </h3>
                <p className="text-xs text-emerald-700 font-mono">
                  {dailyCompanyTotals.utilizationPct}% aggregate daily utilization
                </p>
              </div>

              <div className="p-5 rounded-2xl bg-amber-50/70 border border-amber-200/80 shadow-2xs space-y-1">
                <div className="flex items-center justify-between text-amber-800">
                  <span className="text-xs font-mono font-bold uppercase tracking-wider">Avg Daily Burn Rate</span>
                  <TrendingDown className="w-4 h-4 text-amber-600" />
                </div>
                <h3 className="text-2xl sm:text-3xl font-bold font-mono text-amber-950 pt-1">
                  {formatCurrency(dailyCompanyTotals.dailyBurnRateTotal)}
                </h3>
                <p className="text-xs text-amber-700 font-mono">30-day normalized company burn rate</p>
              </div>

              <div className="p-5 rounded-2xl bg-blue-50/70 border border-blue-200/80 shadow-2xs space-y-1">
                <div className="flex items-center justify-between text-blue-800">
                  <span className="text-xs font-mono font-bold uppercase tracking-wider">Yesterday's Total</span>
                  <Calendar className="w-4 h-4 text-blue-600" />
                </div>
                <h3 className="text-2xl sm:text-3xl font-bold font-mono text-blue-950 pt-1">
                  {formatCurrency(dailyCompanyTotals.yesterdayTotal)}
                </h3>
                <p className="text-xs text-blue-700 font-mono">+7.0% change vs yesterday</p>
              </div>
            </div>

          {/* Department Filter Bar */}
          <div className="bg-white p-4 sm:p-5 rounded-3xl border border-slate-200 shadow-xs flex flex-wrap items-center gap-2">
            <span className="text-xs font-mono font-bold uppercase tracking-wider text-slate-400 mr-2">
              FILTER BY DEPARTMENT:
            </span>
            {departmentsList.map(dept => (
              <button
                key={dept.id}
                onClick={() => setDailyFilterDept(dept.id)}
                className={`px-3.5 py-2 rounded-xl text-xs font-mono font-bold transition-all ${
                  dailyFilterDept === dept.id
                    ? 'bg-slate-900 text-white shadow-xs'
                    : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                }`}
              >
                {dept.name}
              </button>
            ))}
          </div>

          {/* Department-Wise Daily Cards Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {filteredDailyList.map(item => {
              const util = item.budgetUtilizationPct;
              const isHigh = util > 94;
              return (
                <div
                  key={item.departmentId}
                  className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-7 shadow-sm hover:shadow-md transition-shadow space-y-6 flex flex-col justify-between"
                >
                  <div className="space-y-5">
                    {/* Header */}
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-center gap-3.5">
                        <div
                          className="w-12 h-12 rounded-2xl flex items-center justify-center font-bold text-white shadow-sm shrink-0"
                          style={{ backgroundColor: item.accentColor }}
                        >
                          <Building2 className="w-6 h-6" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="text-lg font-bold font-heading text-slate-900">
                              {item.departmentName}
                            </h3>
                            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200 font-semibold">
                              Today: 02 Oct 2026
                            </span>
                          </div>
                          <p className="text-xs text-slate-500 font-mono mt-0.5">
                            Daily Burn Rate: <strong>{formatCurrency(item.dailyBurnRate)} / day</strong>
                          </p>
                        </div>
                      </div>

                      <span className={`px-2.5 py-1 rounded-full text-xs font-mono font-bold shrink-0 ${
                        isHigh
                          ? 'bg-rose-100 text-rose-800 border border-rose-200'
                          : 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                      }`}>
                        {util}% Utilized
                      </span>
                    </div>

                    {/* Spend & Budget Numbers */}
                    <div className="grid grid-cols-3 gap-3 p-4 rounded-2xl bg-slate-50 border border-slate-100">
                      <div>
                        <span className="text-[10px] font-mono font-bold uppercase text-slate-400 block">
                          TODAY'S SPENT
                        </span>
                        <span className="text-base sm:text-lg font-bold font-mono text-rose-700">
                          {formatCurrency(item.todaySpent)}
                        </span>
                      </div>
                      <div>
                        <span className="text-[10px] font-mono font-bold uppercase text-slate-400 block">
                          DAILY BUDGET
                        </span>
                        <span className="text-base sm:text-lg font-bold font-mono text-slate-900">
                          {formatCurrency(item.dailyBudget)}
                        </span>
                      </div>
                      <div>
                        <span className="text-[10px] font-mono font-bold uppercase text-slate-400 block">
                          VS YESTERDAY
                        </span>
                        <span className={`text-base sm:text-lg font-bold font-mono ${
                          item.changeVsYesterdayPct >= 0 ? 'text-amber-700' : 'text-emerald-700'
                        }`}>
                          {item.changeVsYesterdayPct >= 0 ? `+${item.changeVsYesterdayPct}%` : `${item.changeVsYesterdayPct}%`}
                        </span>
                      </div>
                    </div>

                    {/* Progress Bar */}
                    <div className="space-y-1.5">
                      <div className="flex justify-between text-xs font-mono">
                        <span className="text-slate-500">Daily Budget Progress</span>
                        <span className="font-bold text-slate-800">
                          {formatCurrency(item.todaySpent)} / {formatCurrency(item.dailyBudget)}
                        </span>
                      </div>
                      <div className="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{
                            width: `${Math.min(util, 100)}%`,
                            backgroundColor: isHigh ? '#EF4444' : item.accentColor
                          }}
                        />
                      </div>
                    </div>

                    {/* Today's Corporate Expense Transactions List */}
                    <div className="space-y-3 pt-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-mono font-bold uppercase text-slate-700 flex items-center gap-1.5">
                          <Receipt className="w-3.5 h-3.5 text-rose-600" />
                          <span>Today's Audited Corporate Transactions ({item.recentDailyReasons.length})</span>
                        </span>
                        <span className="text-[11px] font-mono text-slate-400">
                          Yesterday: {formatCurrency(item.yesterdaySpent)}
                        </span>
                      </div>

                      <div className="space-y-2.5">
                        {item.recentDailyReasons.map((txn, idx) => (
                          <div
                            key={idx}
                            className="p-3.5 rounded-2xl bg-white border border-slate-200/90 shadow-2xs space-y-2 hover:border-slate-300 transition-colors"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <p className="text-xs font-medium text-slate-800 leading-snug">
                                {txn.reason}
                              </p>
                              <span className="text-xs font-bold font-mono text-rose-700 whitespace-nowrap">
                                {formatCurrency(txn.amount)}
                              </span>
                            </div>

                            <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-slate-100 text-[10px] font-mono text-slate-500">
                              <div className="flex items-center gap-2">
                                <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 font-semibold border border-slate-200">
                                  {txn.category}
                                </span>
                                <span className="text-slate-400 flex items-center gap-1">
                                  <Clock className="w-3 h-3" />
                                  {txn.time}
                                </span>
                              </div>
                              <span className="text-emerald-700 font-semibold flex items-center gap-1">
                                <ShieldCheck className="w-3 h-3" />
                                {txn.approvedBy}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Card Footer Button */}
                  <div className="pt-4 border-t border-slate-100 flex items-center justify-between">
                    <span className="text-[11px] font-mono text-slate-400">
                      Corporate operating account &bull; Direct audited
                    </span>
                    <button
                      onClick={() => jumpToDepartmentVouchers(item.departmentId)}
                      className="text-xs font-mono font-bold text-slate-900 hover:text-rose-600 flex items-center gap-1.5 transition-colors"
                    >
                      <span>View All Vouchers</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

        </div>
      )}

      {/* =========================================================================
          VIEW 2: MONTHLY EXPENSES (DEPARTMENT-WISE)
          ========================================================================= */}
      {expenseTimeframe === 'monthly' && (
        <div className="space-y-8 animate-fade-in">
          
          {/* Monthly Header Banner */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
            <div>
              <h2 className="text-base font-bold font-heading text-slate-900 flex items-center gap-2">
                <Clock className="w-4 h-4 text-blue-600" />
                <span>Monthly Department Expenses &bull; Budget Utilization</span>
              </h2>
              <p className="text-xs text-slate-500">
                Category-wise monthly cost distribution (Cloud, API quotas, SaaS, Facilities) across all 6 business units.
              </p>
            </div>
            <div className="flex items-center gap-2 text-xs font-mono">
              <span className="text-slate-400">Monthly Spend:</span>
              <strong className="text-blue-700 bg-blue-50 px-2.5 py-1 rounded-lg border border-blue-200">
                {formatCurrency(monthlyCompanyTotals.monthlyTotal)}
              </strong>
            </div>
          </div>

          {/* 4 Monthly KPI Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="p-5 rounded-2xl bg-blue-50/70 border border-blue-200/80 shadow-2xs space-y-1">
                <div className="flex items-center justify-between text-blue-800">
                  <span className="text-xs font-mono font-bold uppercase tracking-wider">Month Total Spend</span>
                  <DollarSign className="w-4 h-4 text-blue-600" />
                </div>
                <h3 className="text-2xl sm:text-3xl font-bold font-mono text-blue-950 pt-1">
                  {formatCurrency(monthlyCompanyTotals.monthlyTotal)}
                </h3>
                <p className="text-xs text-blue-700 font-mono">October 2026 across 6 units</p>
              </div>

              <div className="p-5 rounded-2xl bg-emerald-50/70 border border-emerald-200/80 shadow-2xs space-y-1">
                <div className="flex items-center justify-between text-emerald-800">
                  <span className="text-xs font-mono font-bold uppercase tracking-wider">Monthly Budget Cap</span>
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                </div>
                <h3 className="text-2xl sm:text-3xl font-bold font-mono text-emerald-950 pt-1">
                  {formatCurrency(monthlyCompanyTotals.monthlyBudgetTotal)}
                </h3>
                <p className="text-xs text-emerald-700 font-mono">
                  {monthlyCompanyTotals.utilizationPct}% corporate utilization
                </p>
              </div>

              <div className="p-5 rounded-2xl bg-amber-50/70 border border-amber-200/80 shadow-2xs space-y-1">
                <div className="flex items-center justify-between text-amber-800">
                  <span className="text-xs font-mono font-bold uppercase tracking-wider">Previous Month (Sept)</span>
                  <Clock className="w-4 h-4 text-amber-600" />
                </div>
                <h3 className="text-2xl sm:text-3xl font-bold font-mono text-amber-950 pt-1">
                  {formatCurrency(monthlyCompanyTotals.previousMonthTotal)}
                </h3>
                <p className="text-xs text-amber-700 font-mono">+2.9% month-on-month trend</p>
              </div>

              <div className="p-5 rounded-2xl bg-purple-50/70 border border-purple-200/80 shadow-2xs space-y-1">
                <div className="flex items-center justify-between text-purple-800">
                  <span className="text-xs font-mono font-bold uppercase tracking-wider">Remaining Buffer</span>
                  <ShieldCheck className="w-4 h-4 text-purple-600" />
                </div>
                <h3 className="text-2xl sm:text-3xl font-bold font-mono text-purple-950 pt-1">
                  {formatCurrency(monthlyCompanyTotals.monthlyBudgetTotal - monthlyCompanyTotals.monthlyTotal)}
                </h3>
                <p className="text-xs text-purple-700 font-mono">Corporate cash reserve cushion</p>
              </div>
            </div>

          {/* Department Filter Bar */}
          <div className="bg-white p-4 sm:p-5 rounded-3xl border border-slate-200 shadow-xs flex flex-wrap items-center gap-2">
            <span className="text-xs font-mono font-bold uppercase tracking-wider text-slate-400 mr-2">
              FILTER BY DEPARTMENT:
            </span>
            {departmentsList.map(dept => (
              <button
                key={dept.id}
                onClick={() => setMonthlyFilterDept(dept.id)}
                className={`px-3.5 py-2 rounded-xl text-xs font-mono font-bold transition-all ${
                  monthlyFilterDept === dept.id
                    ? 'bg-slate-900 text-white shadow-xs'
                    : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                }`}
              >
                {dept.name}
              </button>
            ))}
          </div>

          {/* Department-Wise Monthly Cards Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {filteredMonthlyList.map(item => {
              const util = item.budgetUtilizationPct;
              return (
                <div
                  key={item.departmentId}
                  className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-7 shadow-sm hover:shadow-md transition-shadow space-y-6 flex flex-col justify-between"
                >
                  <div className="space-y-5">
                    {/* Header */}
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-center gap-3.5">
                        <div
                          className="w-12 h-12 rounded-2xl flex items-center justify-center font-bold text-white shadow-sm shrink-0"
                          style={{ backgroundColor: item.accentColor }}
                        >
                          <Building2 className="w-6 h-6" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="text-lg font-bold font-heading text-slate-900">
                              {item.departmentName}
                            </h3>
                            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200 font-semibold">
                              {item.currentMonth}
                            </span>
                          </div>
                          <p className="text-xs text-slate-500 font-mono mt-0.5">
                            Top Category: <strong className="text-slate-800">{item.topCategory}</strong> ({formatCurrency(item.topCategoryAmount)})
                          </p>
                        </div>
                      </div>

                      <span className="px-2.5 py-1 rounded-full text-xs font-mono font-bold bg-blue-100 text-blue-800 border border-blue-200 shrink-0">
                        {util}% Utilized
                      </span>
                    </div>

                    {/* Spend & Budget Numbers */}
                    <div className="grid grid-cols-3 gap-3 p-4 rounded-2xl bg-slate-50 border border-slate-100">
                      <div>
                        <span className="text-[10px] font-mono font-bold uppercase text-slate-400 block">
                          MONTH SPENT
                        </span>
                        <span className="text-base sm:text-lg font-bold font-mono text-blue-700">
                          {formatCurrency(item.monthlySpent)}
                        </span>
                      </div>
                      <div>
                        <span className="text-[10px] font-mono font-bold uppercase text-slate-400 block">
                          MONTH BUDGET
                        </span>
                        <span className="text-base sm:text-lg font-bold font-mono text-slate-900">
                          {formatCurrency(item.monthlyBudget)}
                        </span>
                      </div>
                      <div>
                        <span className="text-[10px] font-mono font-bold uppercase text-slate-400 block">
                          MOM GROWTH
                        </span>
                        <span className="text-base sm:text-lg font-bold font-mono text-emerald-700">
                          +{item.monthlyGrowthPct}%
                        </span>
                      </div>
                    </div>

                    {/* Monthly Budget Progress Bar */}
                    <div className="space-y-1.5">
                      <div className="flex justify-between text-xs font-mono">
                        <span className="text-slate-500">Monthly Budget Burn</span>
                        <span className="font-bold text-slate-800">
                          {formatCurrency(item.monthlySpent)} of {formatCurrency(item.monthlyBudget)}
                        </span>
                      </div>
                      <div className="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{
                            width: `${Math.min(util, 100)}%`,
                            backgroundColor: item.accentColor
                          }}
                        />
                      </div>
                    </div>

                    {/* Monthly Category-Wise Distribution Breakdown */}
                    <div className="space-y-3 pt-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-mono font-bold uppercase text-slate-700 flex items-center gap-1.5">
                          <PieChart className="w-3.5 h-3.5 text-blue-600" />
                          <span>Category-Wise Monthly Breakdown</span>
                        </span>
                        <span className="text-[11px] font-mono text-slate-400">
                          Last Month: {formatCurrency(item.previousMonthSpent)}
                        </span>
                      </div>

                      <div className="space-y-2.5">
                        {item.monthlyBreakdownByCategory.map((cat, idx) => (
                          <div
                            key={idx}
                            className="p-3 rounded-2xl bg-slate-50/70 border border-slate-100 space-y-1.5"
                          >
                            <div className="flex items-center justify-between text-xs">
                              <span className="font-medium text-slate-800 font-sans">
                                {cat.category}
                              </span>
                              <div className="flex items-center gap-2 font-mono">
                                <span className="font-bold text-slate-900">{formatCurrency(cat.amount)}</span>
                                <span className="text-[11px] text-slate-400 font-semibold">({cat.pct}%)</span>
                              </div>
                            </div>
                            <div className="w-full bg-slate-200/80 h-1.5 rounded-full overflow-hidden">
                              <div
                                className="h-full rounded-full"
                                style={{
                                  width: `${Math.min(cat.pct, 100)}%`,
                                  backgroundColor: item.accentColor
                                }}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Card Footer Button */}
                  <div className="pt-4 border-t border-slate-100 flex items-center justify-between">
                    <span className="text-[11px] font-mono text-slate-400">
                      Corporate statutory &amp; tax compliant
                    </span>
                    <button
                      onClick={() => jumpToDepartmentVouchers(item.departmentId)}
                      className="text-xs font-mono font-bold text-slate-900 hover:text-blue-600 flex items-center gap-1.5 transition-colors"
                    >
                      <span>View All Vouchers</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

        </div>
      )}

      {/* =========================================================================
          VIEW 3: ALL EXPENSE VOUCHERS & AUDIT LOG
          ========================================================================= */}
      {expenseTimeframe === 'vouchers' && (
        <div className="space-y-8 animate-fade-in">
          
          {/* Top Banner */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
            <div>
              <h2 className="text-base font-bold font-heading text-slate-900 flex items-center gap-2">
                <Receipt className="w-4 h-4 text-emerald-600" />
                <span>Audited Corporate Expense Vouchers &amp; Statutory Log</span>
              </h2>
              <p className="text-xs text-slate-500">
                Individual audited corporate expenditures and payments strictly for company infrastructure and operations.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowAddModal(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-mono font-bold text-xs shadow-xs transition-all active:scale-95 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5 text-emerald-400" />
                <span>Record Expense</span>
              </button>
            </div>
          </div>

          {/* 4 Summary Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              
              <div className="p-5 rounded-2xl bg-rose-50/70 border border-rose-200/80 shadow-2xs space-y-1">
                <div className="flex items-center justify-between text-rose-800">
                  <span className="text-xs font-mono font-bold uppercase tracking-wider">Total Corporate Spend</span>
                  <Receipt className="w-4 h-4 text-rose-600" />
                </div>
                <h3 className="text-2xl sm:text-3xl font-bold font-mono text-rose-950 pt-1">
                  {formatCurrency(totalAllAmount)}
                </h3>
                <p className="text-xs text-rose-700 font-mono">
                  Across {expenses.length} audited corporate vouchers
                </p>
              </div>

              <div className="p-5 rounded-2xl bg-emerald-50/70 border border-emerald-200/80 shadow-2xs space-y-1">
                <div className="flex items-center justify-between text-emerald-800">
                  <span className="text-xs font-mono font-bold uppercase tracking-wider">Settled &amp; Paid</span>
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                </div>
                <h3 className="text-2xl sm:text-3xl font-bold font-mono text-emerald-950 pt-1">
                  {formatCurrency(expenses.filter(e => e.status === 'Settled').reduce((s, e) => s + e.amount, 0))}
                </h3>
                <p className="text-xs text-emerald-700 font-mono">
                  100% statutory compliant
                </p>
              </div>

              <div className="p-5 rounded-2xl bg-amber-50/70 border border-amber-200/80 shadow-2xs space-y-1">
                <div className="flex items-center justify-between text-amber-800">
                  <span className="text-xs font-mono font-bold uppercase tracking-wider">Top Spending Dept</span>
                  <Building2 className="w-4 h-4 text-amber-600" />
                </div>
                <h3 className="text-xl font-bold font-heading text-amber-950 pt-1 truncate">
                  {topSpendingDept[0]}
                </h3>
                <p className="text-xs text-amber-700 font-mono">
                  {formatCurrency(topSpendingDept[1] as number)} Total Spend
                </p>
              </div>

              <div className="p-5 rounded-2xl bg-blue-50/70 border border-blue-200/80 shadow-2xs space-y-1">
                <div className="flex items-center justify-between text-blue-800">
                  <span className="text-xs font-mono font-bold uppercase tracking-wider">Filtered View Total</span>
                  <DollarSign className="w-4 h-4 text-blue-600" />
                </div>
                <h3 className="text-2xl sm:text-3xl font-bold font-mono text-blue-950 pt-1">
                  {formatCurrency(totalFilteredAmount)}
                </h3>
                <p className="text-xs text-blue-700 font-mono">
                  {filteredExpenses.length} matching entries
                </p>
              </div>

            </div>

          {/* Filter and Search Bar */}
          <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-xs space-y-4">
            
            {/* Department Buttons Row */}
            <div>
              <span className="text-xs font-mono font-bold uppercase tracking-wider text-slate-400 block mb-2">
                SELECT DEPARTMENT:
              </span>
              <div className="flex flex-wrap gap-2">
                {departmentsList.map(dept => (
                  <button
                    key={dept.id}
                    onClick={() => setSelectedDept(dept.id)}
                    className={`px-3.5 py-2 rounded-xl text-xs font-mono font-bold transition-all ${
                      selectedDept === dept.id
                        ? 'bg-slate-900 text-white shadow-xs'
                        : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                    }`}
                  >
                    {dept.name}
                  </button>
                ))}
              </div>
            </div>

            {/* Category & Search Row */}
            <div className="flex flex-col md:flex-row gap-4 pt-2 border-t border-slate-100 items-stretch md:items-center justify-between">
              
              {/* Category Filter */}
              <div className="flex items-center gap-2 overflow-x-auto pb-1 max-w-full">
                <span className="text-xs font-mono text-slate-400 shrink-0">Category:</span>
                <select
                  value={selectedCategory}
                  onChange={e => setSelectedCategory(e.target.value)}
                  className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono text-slate-800 focus:outline-hidden focus:border-slate-400"
                >
                  {categoriesList.map(c => (
                    <option key={c} value={c}>
                      {c === 'all' ? 'All Corporate Categories' : c}
                    </option>
                  ))}
                </select>
              </div>

              {/* Search Box */}
              <div className="relative flex-1 max-w-sm">
                <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Search reason, invoice ref, category..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono focus:outline-hidden focus:border-slate-400 text-slate-900"
                />
              </div>

            </div>

          </div>

          {/* Expenses Table */}
          <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-mono text-slate-600 uppercase tracking-wider">
                    <th className="py-4 px-6">Department</th>
                    <th className="py-4 px-6">Corporate Reason &amp; Justification</th>
                    <th className="py-4 px-4">Category</th>
                    <th className="py-4 px-4">Approved By</th>
                    <th className="py-4 px-4">Payment &amp; Ref</th>
                    <th className="py-4 px-6 text-right">Amount (₹)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {filteredExpenses.map(exp => (
                    <tr key={exp.id} className="hover:bg-slate-50/70 transition-colors">
                      
                      {/* Department */}
                      <td className="py-4 px-6 align-top">
                        <span className="font-bold text-slate-900 block font-heading text-sm">
                          {exp.departmentName}
                        </span>
                        <span className="text-[11px] font-mono text-slate-400">{exp.date}</span>
                      </td>

                      {/* Corporate Reason */}
                      <td className="py-4 px-6 align-top max-w-md">
                        <p className="text-slate-800 font-medium leading-relaxed">
                          {exp.corporateReason}
                        </p>
                        <div className="flex items-center gap-2 mt-1 text-[11px] font-mono text-slate-500">
                          <span className="text-slate-400">Voucher Ref:</span>
                          <strong className="text-slate-700">{exp.invoiceRef}</strong>
                        </div>
                      </td>

                      {/* Category */}
                      <td className="py-4 px-4 align-top">
                        <span className="inline-block px-2.5 py-1 rounded-full text-[10px] font-mono font-bold bg-slate-100 text-slate-700 border border-slate-200">
                          {exp.category}
                        </span>
                      </td>

                      {/* Approved By */}
                      <td className="py-4 px-4 align-top font-mono text-slate-600">
                        <div className="flex items-center gap-1.5 text-emerald-700 font-semibold">
                          <ShieldCheck className="w-3.5 h-3.5" />
                          <span>{exp.approvedBy}</span>
                        </div>
                        <span className="text-[10px] text-slate-400 block mt-0.5">Corporate Board Auth</span>
                      </td>

                      {/* Payment Mode */}
                      <td className="py-4 px-4 align-top font-mono text-slate-600">
                        <span className="text-slate-800 font-medium block">{exp.paymentMode}</span>
                        <span className="text-[10px] text-emerald-600 font-bold uppercase tracking-wider">
                          Status: {exp.status}
                        </span>
                      </td>

                      {/* Amount */}
                      <td className="py-4 px-6 align-top text-right font-mono font-bold text-sm text-rose-700">
                        {formatCurrency(exp.amount)}
                      </td>

                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {filteredExpenses.length === 0 && (
              <div className="text-center py-12 text-slate-400 font-mono text-xs">
                No corporate expenses match the selected filters.
              </div>
            )}
          </div>

        </div>
      )}

      {/* =========================================================================
          RECORD CORPORATE EXPENSE MODAL
          ========================================================================= */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
          <div className="bg-white rounded-3xl max-w-lg w-full p-8 shadow-2xl border border-slate-200 animate-fade-in space-y-6">
            
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-rose-50 text-rose-600 border border-rose-100">
                  <Receipt className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-lg font-bold font-heading text-slate-900">Record Corporate Expense</h3>
                  <p className="text-xs text-slate-500 font-mono">Company Operating Expenditure Voucher</p>
                </div>
              </div>
              <button
                onClick={() => setShowAddModal(false)}
                className="p-2 rounded-lg hover:bg-slate-100 text-slate-400"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateExpense} className="space-y-4 text-xs font-mono">
              
              {/* Department */}
              <div>
                <label className="block text-slate-700 font-bold mb-1 uppercase text-[11px]">Department</label>
                <select
                  value={newDeptId}
                  onChange={e => setNewDeptId(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800"
                >
                  {departmentsList.filter(d => d.id !== 'all').map(d => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              </div>

              {/* Category */}
              <div>
                <label className="block text-slate-700 font-bold mb-1 uppercase text-[11px]">Corporate Category</label>
                <select
                  value={newCategory}
                  onChange={e => setNewCategory(e.target.value as any)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800"
                >
                  {categoriesList.filter(c => c !== 'all').map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>

              {/* Corporate Reason */}
              <div>
                <label className="block text-slate-700 font-bold mb-1 uppercase text-[11px]">
                  Corporate Reason &amp; Business Justification
                </label>
                <textarea
                  rows={3}
                  required
                  placeholder="e.g. AWS Multi-Region compute clustering hosting & continuous backup retainer for e-commerce catalog"
                  value={newReason}
                  onChange={e => setNewReason(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 font-sans focus:outline-hidden focus:border-slate-400"
                />
              </div>

              {/* Amount */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-700 font-bold mb-1 uppercase text-[11px]">Amount (₹)</label>
                  <input
                    type="number"
                    required
                    placeholder="e.g. 75000"
                    value={newAmount}
                    onChange={e => setNewAmount(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 font-bold"
                  />
                </div>

                <div>
                  <label className="block text-slate-700 font-bold mb-1 uppercase text-[11px]">Invoice / Voucher Ref</label>
                  <input
                    type="text"
                    placeholder="e.g. INV-AWS-99128"
                    value={newInvoiceRef}
                    onChange={e => setNewInvoiceRef(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800"
                  />
                </div>
              </div>

              {/* Payment Mode */}
              <div>
                <label className="block text-slate-700 font-bold mb-1 uppercase text-[11px]">Payment Mode</label>
                <select
                  value={newPaymentMode}
                  onChange={e => setNewPaymentMode(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800"
                >
                  <option value="Corporate Wire (HDFC Current A/C)">Corporate Wire (HDFC Current A/C)</option>
                  <option value="Corporate Credit Card">Corporate Credit Card</option>
                  <option value="RazorpayX Corporate Payroll">RazorpayX Corporate Payroll</option>
                  <option value="Bank RTGS / NEFT Transfer">Bank RTGS / NEFT Transfer</option>
                </select>
              </div>

              {/* Approval */}
              <div>
                <label className="block text-slate-700 font-bold mb-1 uppercase text-[11px]">Approving Authority</label>
                <input
                  type="text"
                  value={newApprovedBy}
                  onChange={e => setNewApprovedBy(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800"
                />
              </div>

              <div className="pt-4 flex items-center justify-end gap-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold shadow-md"
                >
                  Record Expense
                </button>
              </div>

            </form>

          </div>
        </div>
      )}

    </div>
  );
};
