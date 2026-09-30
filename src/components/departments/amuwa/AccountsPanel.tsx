import React, { useState, useMemo } from 'react';
import {
  DollarSign, TrendingUp, Eye, Search, X, BarChart3, PieChart, ChevronDown, Users, Clock, Zap
} from 'lucide-react';
import { useDepartments } from '../../../context/DepartmentContext';
import { InvoiceManagement } from '../../accounts/InvoiceManagement';

interface TeamMember {
  id: string;
  name: string;
  role: string;
  hoursPerMonth: number;
  hourlyRate: number;
  totalEarnings: number;
  totalPaid: number;
  totalPending: number;
  status: 'Paid' | 'Processing' | 'Pending';
  avatar?: string;
}

interface DepartmentFinancial {
  departmentId: string;
  departmentName: string;
  logoUrl?: string;
  accentColor: string;
  totalEarning: number;
  totalPaidInvoice: number;
  totalPendingAmount: number;
  totalExpenses: number;
  rechargeAmount?: number;
  hasRecharge: boolean;
  teamMembers: TeamMember[];
  activeEmployees: number;
}

export const AccountsPanel: React.FC = () => {
  const { departments } = useDepartments();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedDept, setSelectedDept] = useState<string | null>(null);
  const [expandedView, setExpandedView] = useState(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'invoices'>('overview');

  // Mock team member roles by department
  const departmentRoles: Record<string, string[]> = {
    amuwa: ['Operations Executive', 'Finance Manager', 'HR Lead', 'Business Analyst', 'Account Manager'],
    designstudio: ['Creative Director', 'UI/UX Designer', 'Video Editor', 'Graphic Designer', 'Content Creator'],
    wabastar: ['WhatsApp Marketing Manager', 'Customer Success Lead', 'Automation Specialist', 'Sales Executive', 'Support Agent'],
    wabastore: ['E-Commerce Manager', 'Product Catalog Manager', 'Order Fulfillment Lead', 'Logistics Coordinator', 'Quality Analyst'],
    whatsbox: ['Sales Manager', 'Business Development', 'Client Success Manager', 'Operations Coordinator', 'Data Analyst'],
    dtalk: ['Telecalling Supervisor', 'Call Center Agent', 'Quality Analyst', 'Team Lead', 'Customer Success Manager'],
    digitree: ['Software Engineer', 'Cloud Architect', 'QA Tester', 'DevOps Engineer', 'Project Manager'],
    mpillar: ['Project Manager', 'Site Engineer', 'Procurement Specialist', 'Finance Analyst', 'Document Manager'],
    edutraining: ['Training Coordinator', 'Content Developer', 'Instructor', 'Assessment Manager', 'Curriculum Designer']
  };

  const deptNames = ['Amuwa Corporation', 'Amuwa Design Studio', 'Wabastar', 'Wabastore', 'Whatsbox', 'D Talk Corporation', 'Digitree Infotech', 'M Pillar Corporation', 'Education & Training'];
  const deptIds = ['amuwa', 'designstudio', 'wabastar', 'wabastore', 'whatsbox', 'dtalk', 'digitree', 'mpillar', 'edutraining'];

  // Generate team members for a department
  const generateTeamMembers = (deptIdx: number, deptId: string): TeamMember[] => {
    const roles = departmentRoles[deptId] || ['Employee'];
    const baseHourlyRate = 350 + (deptIdx * 50);

    return roles.slice(0, 5).map((role, idx) => {
      const hourlyRate = baseHourlyRate + (idx * 100);
      const hoursPerMonth = 160 - (idx * 5);
      const totalEarnings = hourlyRate * hoursPerMonth;
      const pendingPercent = [0, 0, 0.6, 0.3, 0.25][idx] || 0;
      const totalPaid = Math.round(totalEarnings * (1 - pendingPercent));
      const totalPending = totalEarnings - totalPaid;

      return {
        id: `${deptId}-emp-${idx}`,
        name: ['Sarah Jenkins', 'David Chen', 'Marcus Vance', 'Elena Rostova', 'Alex Morgan'][idx],
        role,
        hoursPerMonth,
        hourlyRate,
        totalEarnings,
        totalPaid,
        totalPending,
        status: ['Paid', 'Paid', 'Processing', 'Paid', 'Pending'][idx] as 'Paid' | 'Processing' | 'Pending'
      };
    });
  };

  // Generate financial data for each department
  const financialData: DepartmentFinancial[] = departments.map((dept, idx) => {
    const isExcludedDept = dept.name.toLowerCase().includes('studio') ||
                           dept.name.toLowerCase().includes('ai design');

    const baseEarning = 150000 + (idx * 25000);
    const basePending = 45000 + (idx * 8000);
    const baseExpenses = 60000 + (idx * 12000);
    const teamMembers = generateTeamMembers(idx, dept.id);
    const activeEmployees = teamMembers.length;

    return {
      departmentId: dept.id,
      departmentName: dept.name,
      logoUrl: dept.logoUrl,
      accentColor: dept.accentColor,
      totalEarning: baseEarning,
      totalPaidInvoice: baseEarning - basePending,
      totalPendingAmount: basePending,
      totalExpenses: baseExpenses,
      rechargeAmount: isExcludedDept ? undefined : 15000 + (idx * 3000),
      hasRecharge: !isExcludedDept,
      teamMembers,
      activeEmployees
    };
  });

  // Filter departments
  const filteredData = financialData.filter(d =>
    d.departmentName.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Calculate overall totals
  const overallTotals = useMemo(() => {
    return {
      totalEarning: financialData.reduce((sum, d) => sum + d.totalEarning, 0),
      totalPaidInvoice: financialData.reduce((sum, d) => sum + d.totalPaidInvoice, 0),
      totalPendingAmount: financialData.reduce((sum, d) => sum + d.totalPendingAmount, 0),
      totalExpenses: financialData.reduce((sum, d) => sum + d.totalExpenses, 0),
      totalRecharge: financialData.reduce((sum, d) => sum + (d.rechargeAmount || 0), 0),
      departmentsWithRecharge: financialData.filter(d => d.hasRecharge).length,
      totalEmployees: financialData.reduce((sum, d) => sum + d.activeEmployees, 0)
    };
  }, [financialData]);

  const formatCurrency = (amount: number) => {
    if (amount >= 10000000) {
      return `₹${(amount / 10000000).toFixed(1)}Cr`;
    }
    if (amount >= 100000) {
      return `₹${(amount / 100000).toFixed(1)}L`;
    }
    if (amount >= 1000) {
      return `₹${(amount / 1000).toFixed(0)}K`;
    }
    return `₹${amount}`;
  };

  const formatCurrencyFull = (amount: number) => {
    return `₹${amount.toLocaleString('en-IN')}`;
  };

  // Get selected department data
  const selectedDeptData = selectedDept
    ? financialData.find(d => d.departmentId === selectedDept)
    : null;

  // Calculate percentages for chart visualization
  const totalIncome = overallTotals.totalEarning;
  const earningPercent = Math.round((overallTotals.totalEarning / (overallTotals.totalEarning + overallTotals.totalExpenses)) * 100);
  const expensePercent = 100 - earningPercent;

  const getStatusColor = (status: string) => {
    switch(status) {
      case 'Paid':
        return 'bg-emerald-50 text-emerald-700 border-emerald-200';
      case 'Processing':
        return 'bg-blue-50 text-blue-700 border-blue-200';
      case 'Pending':
        return 'bg-amber-50 text-amber-700 border-amber-200';
      default:
        return 'bg-slate-50 text-slate-700 border-slate-200';
    }
  };

  return (
    <div className="space-y-6 animate-fade-in p-6">
      {/* TABS */}
      <div className="flex gap-2 border-b border-slate-200">
        <button
          onClick={() => setActiveTab('overview')}
          className={`px-6 py-3 text-sm font-bold border-b-2 transition-all ${
            activeTab === 'overview'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-slate-600 hover:text-slate-900'
          }`}
        >
          Financial Overview
        </button>
        <button
          onClick={() => setActiveTab('invoices')}
          className={`px-6 py-3 text-sm font-bold border-b-2 transition-all ${
            activeTab === 'invoices'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-slate-600 hover:text-slate-900'
          }`}
        >
          Invoice Management
        </button>
      </div>

      {/* CONDITIONAL RENDERING - OVERVIEW TAB */}
      {activeTab === 'overview' && (
        <>
      {/* SECTION 1: OVERALL SUMMARY HEADER */}
      <div className="bg-gradient-to-r from-blue-50 to-slate-50 border border-slate-200 rounded-2xl p-6 shadow-sm">
        <div className="flex items-center gap-3 mb-4">
          <BarChart3 className="w-5 h-5 text-blue-600" />
          <h2 className="text-2xl font-bold text-slate-900">Accounts Dashboard</h2>
        </div>
        <p className="text-sm text-slate-600 mb-6">Overall financial summary across all departments and team members</p>

        {/* Overall Metrics Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
          {/* Total Earning */}
          <div className="bg-white rounded-lg p-4 border border-emerald-200">
            <p className="text-xs font-mono font-bold text-emerald-700 mb-2">TOTAL EARNING</p>
            <p className="text-lg font-bold text-emerald-900">{formatCurrency(overallTotals.totalEarning)}</p>
            <p className="text-xs text-emerald-600 mt-2">All departments</p>
          </div>

          {/* Total Paid Invoice */}
          <div className="bg-white rounded-lg p-4 border border-blue-200">
            <p className="text-xs font-mono font-bold text-blue-700 mb-2">TOTAL PAID</p>
            <p className="text-lg font-bold text-blue-900">{formatCurrency(overallTotals.totalPaidInvoice)}</p>
            <p className="text-xs text-blue-600 mt-2">Collected amount</p>
          </div>

          {/* Total Pending */}
          <div className="bg-white rounded-lg p-4 border border-amber-200">
            <p className="text-xs font-mono font-bold text-amber-700 mb-2">TOTAL PENDING</p>
            <p className="text-lg font-bold text-amber-900">{formatCurrency(overallTotals.totalPendingAmount)}</p>
            <p className="text-xs text-amber-600 mt-2">Outstanding amount</p>
          </div>

          {/* Total Expenses */}
          <div className="bg-white rounded-lg p-4 border border-rose-200">
            <p className="text-xs font-mono font-bold text-rose-700 mb-2">TOTAL EXPENSES</p>
            <p className="text-lg font-bold text-rose-900">{formatCurrency(overallTotals.totalExpenses)}</p>
            <p className="text-xs text-rose-600 mt-2">Operating costs</p>
          </div>

          {/* Total Employees */}
          <div className="bg-white rounded-lg p-4 border border-purple-200">
            <p className="text-xs font-mono font-bold text-purple-700 mb-2">ACTIVE EMPLOYEES</p>
            <p className="text-lg font-bold text-purple-900">{overallTotals.totalEmployees}</p>
            <p className="text-xs text-purple-600 mt-2">Team members</p>
          </div>
        </div>
      </div>

      {/* SECTION 2: ANALYTICS - VISUAL CHARTS */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Income vs Expenses Chart */}
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp className="w-5 h-5 text-blue-600" />
            <h3 className="text-lg font-bold text-slate-900">Income vs Expenses</h3>
          </div>

          <div className="space-y-3">
            {/* Earning Bar */}
            <div>
              <div className="flex justify-between items-center mb-2">
                <span className="text-sm font-semibold text-slate-700">Total Earning</span>
                <span className="text-sm font-bold text-emerald-900">{earningPercent}%</span>
              </div>
              <div className="w-full bg-slate-100 rounded-full h-4 overflow-hidden">
                <div
                  className="bg-gradient-to-r from-emerald-400 to-emerald-600 h-full rounded-full"
                  style={{ width: `${earningPercent}%` }}
                />
              </div>
              <p className="text-xs text-slate-500 mt-1">{formatCurrency(overallTotals.totalEarning)}</p>
            </div>

            {/* Expense Bar */}
            <div>
              <div className="flex justify-between items-center mb-2">
                <span className="text-sm font-semibold text-slate-700">Total Expenses</span>
                <span className="text-sm font-bold text-rose-900">{expensePercent}%</span>
              </div>
              <div className="w-full bg-slate-100 rounded-full h-4 overflow-hidden">
                <div
                  className="bg-gradient-to-r from-rose-400 to-rose-600 h-full rounded-full"
                  style={{ width: `${expensePercent}%` }}
                />
              </div>
              <p className="text-xs text-slate-500 mt-1">{formatCurrency(overallTotals.totalExpenses)}</p>
            </div>
          </div>

          {/* Profit Calculation */}
          <div className="mt-6 p-4 bg-emerald-50 rounded-lg border border-emerald-200">
            <p className="text-xs font-mono font-bold text-emerald-700 mb-1">NET PROFIT</p>
            <p className="text-2xl font-bold text-emerald-900">
              {formatCurrency(overallTotals.totalEarning - overallTotals.totalExpenses)}
            </p>
          </div>
        </div>

        {/* Payment Status Chart */}
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <PieChart className="w-5 h-5 text-blue-600" />
            <h3 className="text-lg font-bold text-slate-900">Payment Status</h3>
          </div>

          <div className="space-y-3">
            {/* Paid Bar */}
            <div>
              <div className="flex justify-between items-center mb-2">
                <span className="text-sm font-semibold text-slate-700">Paid Invoices</span>
                <span className="text-sm font-bold text-blue-900">
                  {overallTotals.totalEarning > 0
                    ? Math.round((overallTotals.totalPaidInvoice / overallTotals.totalEarning) * 100)
                    : 0}%
                </span>
              </div>
              <div className="w-full bg-slate-100 rounded-full h-4 overflow-hidden">
                <div
                  className="bg-gradient-to-r from-blue-400 to-blue-600 h-full rounded-full"
                  style={{
                    width: `${overallTotals.totalEarning > 0
                      ? (overallTotals.totalPaidInvoice / overallTotals.totalEarning) * 100
                      : 0}%`
                  }}
                />
              </div>
              <p className="text-xs text-slate-500 mt-1">{formatCurrency(overallTotals.totalPaidInvoice)}</p>
            </div>

            {/* Pending Bar */}
            <div>
              <div className="flex justify-between items-center mb-2">
                <span className="text-sm font-semibold text-slate-700">Pending Amount</span>
                <span className="text-sm font-bold text-amber-900">
                  {overallTotals.totalEarning > 0
                    ? Math.round((overallTotals.totalPendingAmount / overallTotals.totalEarning) * 100)
                    : 0}%
                </span>
              </div>
              <div className="w-full bg-slate-100 rounded-full h-4 overflow-hidden">
                <div
                  className="bg-gradient-to-r from-amber-400 to-amber-600 h-full rounded-full"
                  style={{
                    width: `${overallTotals.totalEarning > 0
                      ? (overallTotals.totalPendingAmount / overallTotals.totalEarning) * 100
                      : 0}%`
                  }}
                />
              </div>
              <p className="text-xs text-slate-500 mt-1">{formatCurrency(overallTotals.totalPendingAmount)}</p>
            </div>
          </div>

          {/* Collection Rate */}
          <div className="mt-6 p-4 bg-blue-50 rounded-lg border border-blue-200">
            <p className="text-xs font-mono font-bold text-blue-700 mb-1">COLLECTION RATE</p>
            <p className="text-2xl font-bold text-blue-900">
              {overallTotals.totalEarning > 0
                ? Math.round((overallTotals.totalPaidInvoice / overallTotals.totalEarning) * 100)
                : 0}%
            </p>
          </div>
        </div>
      </div>

      {/* SECTION 3: DEPARTMENT SELECTOR & SEARCH */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <h3 className="text-lg font-bold text-slate-900">Departments</h3>
          <span className="text-xs px-2 py-1 bg-slate-100 text-slate-600 rounded-full font-semibold">
            {filteredData.length} of {financialData.length}
          </span>
        </div>

        {/* Search */}
        <div className="mb-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="Search departments..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* Department Cards Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filteredData.map((dept) => (
            <div
              key={dept.departmentId}
              onClick={() => {
                setSelectedDept(dept.departmentId);
                setExpandedView(true);
              }}
              className="group cursor-pointer bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm hover:shadow-lg hover:border-blue-300 transition-all duration-300 hover:-translate-y-1"
            >
              {/* Header with Color Bar */}
              <div
                className="h-20 bg-gradient-to-r relative overflow-hidden flex items-end justify-between p-3"
                style={{
                  backgroundImage: `linear-gradient(135deg, ${dept.accentColor}dd, ${dept.accentColor}99)`
                }}
              >
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  {dept.logoUrl && (
                    <img
                      src={dept.logoUrl}
                      alt={dept.departmentName}
                      className="w-8 h-8 rounded object-contain bg-white p-0.5 shadow-sm"
                    />
                  )}
                  <h3 className="font-bold text-white text-xs truncate">{dept.departmentName}</h3>
                </div>

                {/* Eye Icon for Hint */}
                <div className="ml-2 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Eye className="w-4 h-4 text-white" />
                </div>
              </div>

              {/* Body - Department Info */}
              <div className="p-3 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-600 font-medium">Team Members:</span>
                  <span className="font-bold text-slate-900">{dept.activeEmployees}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-600 font-medium">Total Earnings:</span>
                  <span className="font-bold text-emerald-700">{formatCurrency(dept.totalEarning)}</span>
                </div>
                <div className="text-xs text-slate-500 text-center pt-1 border-t border-slate-100">
                  Click to view team breakdown
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Empty State */}
        {filteredData.length === 0 && (
          <div className="text-center py-12 bg-slate-50 rounded-2xl border border-slate-200">
            <Search className="w-12 h-12 text-slate-300 mx-auto mb-3" />
            <p className="text-slate-600 font-semibold">No departments found</p>
            <p className="text-slate-400 text-sm mt-1">Try adjusting your search</p>
          </div>
        )}
      </div>

      {/* SECTION 4: EXPANDED DEPARTMENT VIEW - Team Earnings Breakdown */}
      {selectedDeptData && expandedView && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-5xl bg-white rounded-2xl border border-slate-200 shadow-2xl animate-scale-up max-h-[90vh] overflow-y-auto">
            {/* Header */}
            <div className="sticky top-0 bg-white border-b border-slate-200 p-6 flex items-center justify-between">
              <div className="flex items-center gap-3">
                {selectedDeptData.logoUrl && (
                  <img
                    src={selectedDeptData.logoUrl}
                    alt={selectedDeptData.departmentName}
                    className="w-12 h-12 rounded object-contain"
                  />
                )}
                <div>
                  <h3 className="text-xl font-bold text-slate-900">
                    {selectedDeptData.departmentName}
                  </h3>
                  <p className="text-xs text-slate-500 font-mono">Team Earnings Breakdown</p>
                </div>
              </div>
              <button
                onClick={() => {
                  setExpandedView(false);
                  setSelectedDept(null);
                }}
                className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 hover:bg-slate-200 text-slate-600 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Content */}
            <div className="p-6 space-y-6">
              {/* Summary Metrics */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="bg-emerald-50 rounded-lg p-3 border border-emerald-200">
                  <p className="text-xs font-mono font-bold text-emerald-700">TOTAL EARNING</p>
                  <p className="text-lg font-bold text-emerald-900 mt-1">{formatCurrency(selectedDeptData.totalEarning)}</p>
                </div>
                <div className="bg-blue-50 rounded-lg p-3 border border-blue-200">
                  <p className="text-xs font-mono font-bold text-blue-700">TOTAL PAID</p>
                  <p className="text-lg font-bold text-blue-900 mt-1">{formatCurrency(selectedDeptData.totalPaidInvoice)}</p>
                </div>
                <div className="bg-amber-50 rounded-lg p-3 border border-amber-200">
                  <p className="text-xs font-mono font-bold text-amber-700">TOTAL PENDING</p>
                  <p className="text-lg font-bold text-amber-900 mt-1">{formatCurrency(selectedDeptData.totalPendingAmount)}</p>
                </div>
                <div className="bg-purple-50 rounded-lg p-3 border border-purple-200">
                  <p className="text-xs font-mono font-bold text-purple-700">ACTIVE MEMBERS</p>
                  <p className="text-lg font-bold text-purple-900 mt-1">{selectedDeptData.activeEmployees}</p>
                </div>
              </div>

              {/* Team Members Table */}
              <div>
                <h4 className="text-sm font-bold text-slate-900 mb-3">Detailed compensation and disbursement ledger</h4>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="bg-slate-900 text-white">
                        <th className="px-4 py-3 text-left text-xs font-mono font-bold">MEMBER / EMPLOYEE</th>
                        <th className="px-4 py-3 text-left text-xs font-mono font-bold">PERIOD BREAKDOWN</th>
                        <th className="px-4 py-3 text-right text-xs font-mono font-bold">TOTAL EARNINGS</th>
                        <th className="px-4 py-3 text-right text-xs font-mono font-bold">TOTAL PAID</th>
                        <th className="px-4 py-3 text-right text-xs font-mono font-bold">TOTAL PENDING</th>
                        <th className="px-4 py-3 text-left text-xs font-mono font-bold">STATUS</th>
                        <th className="px-4 py-3 text-center text-xs font-mono font-bold">ACTIONS</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {selectedDeptData.teamMembers.map((member) => (
                        <tr key={member.id} className="hover:bg-slate-50 transition-colors">
                          <td className="px-4 py-4">
                            <div className="flex items-center gap-2">
                              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-400 to-purple-500 flex items-center justify-center text-white text-xs font-bold">
                                {member.name.charAt(0)}
                              </div>
                              <div>
                                <p className="text-sm font-semibold text-slate-900">{member.name}</p>
                                <p className="text-xs text-slate-500">{member.role}</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-4">
                            <div>
                              <p className="text-sm font-semibold text-slate-900">{member.hoursPerMonth} hrs / mo</p>
                              <p className="text-xs text-slate-600">₹{member.hourlyRate} / hr</p>
                            </div>
                          </td>
                          <td className="px-4 py-4 text-right">
                            <p className="text-sm font-bold text-slate-900">{formatCurrencyFull(member.totalEarnings)}</p>
                          </td>
                          <td className="px-4 py-4 text-right">
                            <p className="text-sm font-bold text-blue-900">{formatCurrencyFull(member.totalPaid)}</p>
                          </td>
                          <td className="px-4 py-4 text-right">
                            <p className="text-sm font-bold text-amber-900">{formatCurrencyFull(member.totalPending)}</p>
                          </td>
                          <td className="px-4 py-4">
                            <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-semibold border ${getStatusColor(member.status)}`}>
                              {member.status}
                            </span>
                          </td>
                          <td className="px-4 py-4 text-center">
                            <button className="text-blue-600 hover:text-blue-700 font-semibold text-sm">
                              Details
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-xs text-slate-500 mt-3">Showing {selectedDeptData.teamMembers.length} active team members</p>
              </div>

              {/* Department Financial Details */}
              <div className="border-t border-slate-200 pt-6">
                <h4 className="text-sm font-bold text-slate-900 mb-3">Department Financial Summary</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="p-4 bg-emerald-50 rounded-lg border border-emerald-200">
                    <p className="text-xs text-emerald-700 font-mono font-bold mb-2">TOTAL EARNING</p>
                    <p className="text-2xl font-bold text-emerald-900">
                      {formatCurrencyFull(selectedDeptData.totalEarning)}
                    </p>
                  </div>

                  <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
                    <p className="text-xs text-blue-700 font-mono font-bold mb-2">TOTAL PAID INVOICE</p>
                    <p className="text-2xl font-bold text-blue-900">
                      {formatCurrencyFull(selectedDeptData.totalPaidInvoice)}
                    </p>
                  </div>

                  <div className="p-4 bg-amber-50 rounded-lg border border-amber-200">
                    <p className="text-xs text-amber-700 font-mono font-bold mb-2">TOTAL PENDING</p>
                    <p className="text-2xl font-bold text-amber-900">
                      {formatCurrencyFull(selectedDeptData.totalPendingAmount)}
                    </p>
                  </div>

                  <div className="p-4 bg-rose-50 rounded-lg border border-rose-200">
                    <p className="text-xs text-rose-700 font-mono font-bold mb-2">TOTAL EXPENSES</p>
                    <p className="text-2xl font-bold text-rose-900">
                      {formatCurrencyFull(selectedDeptData.totalExpenses)}
                    </p>
                  </div>

                  {selectedDeptData.hasRecharge && selectedDeptData.rechargeAmount !== undefined && (
                    <div className="p-4 bg-purple-50 rounded-lg border border-purple-200">
                      <p className="text-xs text-purple-700 font-mono font-bold mb-2">RECHARGE</p>
                      <p className="text-2xl font-bold text-purple-900">
                        {formatCurrencyFull(selectedDeptData.rechargeAmount)}
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* Close Button */}
              <div className="flex gap-3 pt-4 border-t border-slate-200">
                <button
                  onClick={() => {
                    setExpandedView(false);
                    setSelectedDept(null);
                  }}
                  className="flex-1 py-3 rounded-lg bg-slate-900 text-white font-semibold hover:bg-slate-800 transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
        </>
      )}

      {/* CONDITIONAL RENDERING - INVOICES TAB */}
      {activeTab === 'invoices' && (
        <div className="p-6 bg-slate-50 rounded-2xl border border-slate-200">
          <InvoiceManagement />
        </div>
      )}
    </div>
  );
};
