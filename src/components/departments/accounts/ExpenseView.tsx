import React, { useState } from 'react';
import {
  TrendingDown, DollarSign, Filter, Search, Plus, Calendar,
  Building2, CheckCircle2, ShieldCheck, Tag, Receipt, ArrowRight,
  FileText, Clock, AlertTriangle, X, Check
} from 'lucide-react';
import { accountsStore, CorporateExpense } from '../../../services/accountsStore';

export const ExpenseView: React.FC = () => {
  const [expenses, setExpenses] = useState<CorporateExpense[]>(() => accountsStore.getExpenses());
  const [selectedDept, setSelectedDept] = useState<string>('all');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);

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

  // Filtering
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

  const handleCreateExpense = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newReason || !newAmount) return;

    const deptObj = departmentsList.find(d => d.id === newDeptId);
    const added = accountsStore.addCorporateExpense({
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
    setShowAddModal(false);
    setNewReason('');
    setNewAmount('');
    setNewInvoiceRef('');
  };

  return (
    <div className="space-y-8 animate-fade-in font-sans">
      
      {/* Top Banner */}
      <div className="bg-white border border-slate-200 rounded-3xl p-6 sm:p-8 shadow-sm relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-gradient-to-bl from-rose-500/10 via-amber-500/5 to-transparent rounded-full pointer-events-none blur-3xl" />
        
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 relative z-10">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-rose-50 border border-rose-200 text-rose-800 text-xs font-mono font-semibold">
              <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
              <span>CORPORATE OPERATING EXPENDITURE</span>
            </div>
            <h2 className="text-2xl sm:text-3xl font-bold font-heading text-slate-900 tracking-tight">
              Department-Wise Corporate Expense Breakdown
            </h2>
            <p className="text-sm text-slate-500 max-w-2xl leading-relaxed">
              Audited corporate expenditures across business departments. All listed expenses are strictly corporate operational investments required for company infrastructure, API quota licenses, and staff payroll.
            </p>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <button
              onClick={() => setShowAddModal(true)}
              className="flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-slate-900 hover:bg-slate-800 text-white font-mono font-bold text-xs shadow-md transition-all active:scale-95"
            >
              <Plus className="w-4 h-4 text-emerald-400" />
              <span>Record Corporate Expense</span>
            </button>
          </div>
        </div>

        {/* 4 Summary Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-8 pt-8 border-t border-slate-100">
          
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

      {/* Record Corporate Expense Modal */}
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
