import React, { useState } from 'react';
import {
  Search,
  Filter,
  Plus,
  MoreVertical,
  Users,
  ShoppingCart,
  Clock,
  Building2,
  Calendar,
  ChevronLeft,
  ChevronRight,
  TrendingUp,
  TrendingDown,
  UserPlus,
  UploadCloud,
  FileText,
  MessageSquare,
  Phone,
  CheckCircle2,
  X
} from 'lucide-react';
import { Customer } from '../../types/crm';
import { useCustomers } from '../../hooks/useCustomers';
import { customerCreateSchema } from '../../../shared/validation';
import { segmentFromLabel, statusFromLabel } from '../../lib/customers';
import { customersApi } from '../../lib/api/endpoints';
import { errorMessage } from '../../lib/api/client';
import { countLegacyCustomers, legacyCustomersAsImport, retainLegacyCustomers } from '../../lib/legacyStorage';

const PAGE_SIZE = 8;
const SEGMENT_COLORS: Record<string, string> = { Retail: '#2563EB', Wholesale: '#8B5CF6', Corporate: '#10B981', Others: '#F97316' };
const SORTS = {
  latest: { sort: 'createdAt', order: 'desc' },
  name: { sort: 'name', order: 'asc' },
  amount: { sort: 'lastOrderAmount', order: 'desc' }
} as const;
// Cross-customer activity feed will come from customer_activities; none yet.
const recentActivities: { id: string; type: string; title: string; subtitle: string; timeAgo: string }[] = [];

interface MemberCustomersDashboardProps {
  currentUserId: string;
  onSendWhatsApp?: (phone: string, name: string) => void;
  onCreateInvoice?: (customer: Customer) => void;
}

export const MemberCustomersDashboard: React.FC<MemberCustomersDashboardProps> = ({
  currentUserId,
  onSendWhatsApp,
  onCreateInvoice
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [segmentFilter, setSegmentFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sortBy, setSortBy] = useState<'latest' | 'name' | 'amount'>('latest');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [addError, setAddError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [legacyCount, setLegacyCount] = useState(() => countLegacyCustomers());
  const [importNotice, setImportNotice] = useState<string | null>(null);

  // Modals
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);

  // Add Customer Form State
  const [newCust, setNewCust] = useState({
    name: '',
    company: '',
    phone: '',
    email: '',
    segment: 'Retail' as Customer['segment'],
    status: 'Active' as Customer['status'],
    lastOrderAmount: 50000
  });

  // Filtering, sorting and pagination run in the database; RLS scopes rows to the user.
  const { items: customers, total, summary, loading, error: listError, reload, createCustomer } = useCustomers({
    search: searchQuery,
    segment: segmentFilter === 'all' ? undefined : segmentFromLabel(segmentFilter),
    status: statusFilter === 'all' ? undefined : statusFromLabel(statusFilter),
    ...SORTS[sortBy],
    page: currentPage,
    pageSize: PAGE_SIZE
  });
  const filteredCustomers = customers;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Reset to the first page whenever the filters change.
  React.useEffect(() => setCurrentPage(1), [searchQuery, segmentFilter, statusFilter, sortBy]);

  const pct = (n: number) => (summary.total ? `${Math.round((n / summary.total) * 100)}%` : '0%');
  const newDelta = summary.newThisMonth - summary.newLastMonth;
  const kpis = {
    totalCustomers: summary.total,
    totalGrowth: `+${summary.newThisMonth} this month`,
    activeCustomers: summary.active,
    activeGrowth: `${pct(summary.active)} of total`,
    inactiveCustomers: summary.inactive,
    inactiveGrowth: `${pct(summary.inactive)} of total`,
    newThisMonth: summary.newThisMonth,
    newGrowth: `${newDelta >= 0 ? '+' : ''}${newDelta} vs. last month`
  };
  const segments = (['Retail', 'Wholesale', 'Corporate', 'Others'] as const).map(name => {
    const count = summary.bySegment[segmentFromLabel(name)!] || 0;
    return { name, count, percentage: summary.total ? Math.round((count / summary.total) * 100) : 0, color: SEGMENT_COLORS[name] };
  });

  const getInitials = (name: string) => {
    const parts = name.trim().split(' ');
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  };

  const getSegmentBadge = (segment: Customer['segment']) => {
    switch (segment) {
      case 'Retail':
        return (
          <span className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-blue-50 text-blue-600 border border-blue-100">
            Retail
          </span>
        );
      case 'Wholesale':
        return (
          <span className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-purple-50 text-purple-600 border border-purple-100">
            Wholesale
          </span>
        );
      case 'Corporate':
        return (
          <span className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-emerald-50 text-emerald-600 border border-emerald-100">
            Corporate
          </span>
        );
      case 'Others':
      default:
        return (
          <span className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-100">
            Others
          </span>
        );
    }
  };

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedIds(filteredCustomers.map(c => c.id));
    } else {
      setSelectedIds([]);
    }
  };

  const handleToggleSelect = (id: string) => {
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const resetNewCustomer = () =>
    setNewCust({ name: '', company: '', phone: '', email: '', segment: 'Retail', status: 'Active', lastOrderAmount: 50000 });

  /** Persist to Supabase via the API; the list is refreshed from the database. */
  const handleAddCustomerSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddError(null);
    const parsed = customerCreateSchema.safeParse({
      name: newCust.name,
      company: newCust.company,
      phone: newCust.phone,
      email: newCust.email,
      segment: segmentFromLabel(newCust.segment),
      status: statusFromLabel(newCust.status),
      lastOrderAmount: Number(newCust.lastOrderAmount) || null
    });
    if (!parsed.success) {
      setAddError(parsed.error.issues[0]?.message || 'Please check the form.');
      return;
    }
    setSaving(true);
    try {
      await createCustomer(parsed.data);
      setCurrentPage(1);
      setIsAddModalOpen(false);
      resetNewCustomer();
    } catch (err) {
      setAddError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  /** One-time import of customers the previous version kept in this browser. */
  const handleLegacyImport = async () => {
    const rows = legacyCustomersAsImport();
    if (!rows.length) return;
    setSaving(true);
    try {
      const result = await customersApi.import(rows);
      retainLegacyCustomers(result.skipped.map(s => s.index));
      setLegacyCount(countLegacyCustomers());
      setImportNotice(
        `Imported ${result.imported} customer(s) into the CRM database.` +
          (result.skipped.length ? ` ${result.skipped.length} skipped (e.g. "${result.skipped[0].reason}") and kept in this browser.` : '')
      );
      await reload();
    } catch (err) {
      setImportNotice(errorMessage(err));
    } finally {
      setSaving(false);
      setIsImportModalOpen(false);
    }
  };

  // SVG Donut Setup
  const donutSize = 130;
  const strokeWidth = 14;
  const radius = (donutSize - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  let cumulativeOffset = 0;
  const donutSegments = segments.map(seg => {
    const strokeDasharray = `${(seg.percentage / 100) * circumference} ${circumference}`;
    const strokeDashoffset = -cumulativeOffset;
    cumulativeOffset += (seg.percentage / 100) * circumference;
    return {
      ...seg,
      strokeDasharray,
      strokeDashoffset
    };
  });

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {(legacyCount > 0 || importNotice) && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-2xl bg-amber-50 border border-amber-200 text-xs text-amber-900">
          <span>
            {importNotice ||
              `${legacyCount} customer(s) from the previous version exist only in this browser and are not saved in the CRM yet.`}
          </span>
          {legacyCount > 0 && (
            <button
              type="button"
              disabled={saving}
              onClick={() => void handleLegacyImport()}
              className="px-3 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-semibold disabled:opacity-60"
            >
              Import to CRM database
            </button>
          )}
        </div>
      )}
      {/* 1. TOP HEADER & DATE RANGE */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold font-heading text-slate-900">
            Customers
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Manage your existing customers and their details.
          </p>
        </div>

        <div>
          <button
            type="button"
            className="flex items-center gap-2 px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 hover:bg-slate-50 shadow-2xs transition-colors cursor-pointer"
          >
            <Calendar className="w-3.5 h-3.5 text-slate-400" />
            <span>Sep 1, 2026 – Sep 30, 2026</span>
            <svg className="w-3.5 h-3.5 text-slate-400 ml-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        </div>
      </div>

      {/* 2. TOP 4 KPI METRIC CARDS */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Total Customers */}
        <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs flex items-center justify-between">
          <div className="space-y-1">
            <span className="text-xs font-medium text-slate-500">Total Customers</span>
            <div className="text-2xl font-bold font-heading text-slate-900 leading-none">
              {kpis.totalCustomers}
            </div>
            <div className="flex items-center gap-1 text-[11px] font-semibold text-emerald-600 pt-1">
              <TrendingUp className="w-3 h-3" />
              <span>{kpis.totalGrowth}</span>
            </div>
          </div>
          <div className="w-11 h-11 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
            <Users className="w-5 h-5" />
          </div>
        </div>

        {/* Card 2: Active Customers */}
        <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs flex items-center justify-between">
          <div className="space-y-1">
            <span className="text-xs font-medium text-slate-500">Active Customers</span>
            <div className="text-2xl font-bold font-heading text-slate-900 leading-none">
              {kpis.activeCustomers}
            </div>
            <div className="flex items-center gap-1 text-[11px] font-semibold text-emerald-600 pt-1">
              <TrendingUp className="w-3 h-3" />
              <span>{kpis.activeGrowth}</span>
            </div>
          </div>
          <div className="w-11 h-11 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
            <ShoppingCart className="w-5 h-5" />
          </div>
        </div>

        {/* Card 3: Inactive Customers */}
        <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs flex items-center justify-between">
          <div className="space-y-1">
            <span className="text-xs font-medium text-slate-500">Inactive Customers</span>
            <div className="text-2xl font-bold font-heading text-slate-900 leading-none">
              {kpis.inactiveCustomers}
            </div>
            <div className="flex items-center gap-1 text-[11px] font-semibold text-slate-500 pt-1">
              <TrendingDown className="w-3 h-3 text-rose-500" />
              <span>{kpis.inactiveGrowth}</span>
            </div>
          </div>
          <div className="w-11 h-11 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center shrink-0">
            <Clock className="w-5 h-5" />
          </div>
        </div>

        {/* Card 4: New This Month */}
        <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs flex items-center justify-between">
          <div className="space-y-1">
            <span className="text-xs font-medium text-slate-500">New This Month</span>
            <div className="text-2xl font-bold font-heading text-slate-900 leading-none">
              {kpis.newThisMonth}
            </div>
            <div className="flex items-center gap-1 text-[11px] font-semibold text-emerald-600 pt-1">
              <TrendingUp className="w-3 h-3" />
              <span>{kpis.newGrowth}</span>
            </div>
          </div>
          <div className="w-11 h-11 rounded-xl bg-orange-50 text-orange-600 flex items-center justify-center shrink-0">
            <Building2 className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* 3. MAIN WORKSPACE GRID: TABLE (8 cols) + RIGHT SIDEBAR (4 cols) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        
        {/* LEFT / MAIN TABLE CONTAINER (8 cols) */}
        <div className="lg:col-span-8 bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs space-y-4">
          
          {/* SEARCH & FILTER CONTROLS BAR */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search by name, phone, email or company..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>

            <div className="flex items-center gap-2 overflow-x-auto pb-1 sm:pb-0">
              <select
                value={segmentFilter}
                onChange={(e) => setSegmentFilter(e.target.value)}
                className="px-2.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-700 focus:outline-none cursor-pointer"
              >
                <option value="all">All Segments</option>
                <option value="Retail">Retail</option>
                <option value="Wholesale">Wholesale</option>
                <option value="Corporate">Corporate</option>
                <option value="Others">Others</option>
              </select>

              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="px-2.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-700 focus:outline-none cursor-pointer"
              >
                <option value="all">All Status</option>
                <option value="Active">Active</option>
                <option value="Inactive">Inactive</option>
                <option value="Prospect">Prospect</option>
              </select>

              <select
                value={sortBy}
                onChange={(e: any) => setSortBy(e.target.value)}
                className="px-2.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-700 focus:outline-none cursor-pointer"
              >
                <option value="latest">Sort by: Latest</option>
                <option value="name">Sort by: Name</option>
                <option value="amount">Sort by: Amount</option>
              </select>

              <button
                type="button"
                className="p-2 border border-slate-200 rounded-xl text-slate-500 hover:bg-slate-50"
                title="Filter options"
              >
                <Filter className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={() => setIsAddModalOpen(true)}
                className="flex items-center gap-1.5 px-3.5 py-2 bg-blue-600 text-white rounded-xl text-xs font-bold hover:bg-blue-700 shadow-xs transition-colors whitespace-nowrap cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Customer</span>
              </button>
            </div>
          </div>

          {/* CUSTOMERS TABLE */}
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="text-[11px] font-bold text-slate-400 border-b border-slate-100">
                  <th className="py-3 pl-2 pr-3 w-8">
                    <input
                      type="checkbox"
                      checked={
                        selectedIds.length === filteredCustomers.length &&
                        filteredCustomers.length > 0
                      }
                      onChange={(e) => handleSelectAll(e.target.checked)}
                      className="rounded text-blue-600 focus:ring-blue-500 cursor-pointer"
                    />
                  </th>
                  <th className="py-3 pr-3 font-semibold">Customer Name</th>
                  <th className="py-3 pr-3 font-semibold">Company</th>
                  <th className="py-3 pr-3 font-semibold">Phone</th>
                  <th className="py-3 pr-3 font-semibold">Email</th>
                  <th className="py-3 pr-3 font-semibold">Segment</th>
                  <th className="py-3 pr-3 font-semibold">Status</th>
                  <th className="py-3 pr-3 font-semibold">Last Order</th>
                  <th className="py-3 pr-2 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {filteredCustomers.map(customer => {
                  const isSelected = selectedIds.includes(customer.id);
                  return (
                    <tr
                      key={customer.id}
                      className="hover:bg-slate-50/70 transition-colors group cursor-pointer"
                      onClick={() => setSelectedCustomer(customer)}
                    >
                      {/* Checkbox */}
                      <td className="py-3.5 pl-2 pr-3" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => handleToggleSelect(customer.id)}
                          className="rounded text-blue-600 focus:ring-blue-500 cursor-pointer"
                        />
                      </td>

                      {/* Customer Name */}
                      <td className="py-3.5 pr-3">
                        <div className="flex items-center gap-2.5">
                          <div className="w-7 h-7 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center font-bold text-[11px] shrink-0">
                            {getInitials(customer.name)}
                          </div>
                          <span className="font-bold text-slate-900 group-hover:text-blue-600 transition-colors">
                            {customer.name}
                          </span>
                        </div>
                      </td>

                      {/* Company */}
                      <td className="py-3.5 pr-3 text-slate-600 font-medium">
                        {customer.company}
                      </td>

                      {/* Phone */}
                      <td className="py-3.5 pr-3 text-slate-600 font-mono text-[11px]">
                        {customer.phone}
                      </td>

                      {/* Email */}
                      <td className="py-3.5 pr-3 text-slate-600 truncate max-w-[140px]">
                        {customer.email}
                      </td>

                      {/* Segment */}
                      <td className="py-3.5 pr-3 whitespace-nowrap">
                        {getSegmentBadge(customer.segment)}
                      </td>

                      {/* Status */}
                      <td className="py-3.5 pr-3 whitespace-nowrap">
                        <span
                          className={`font-semibold text-xs ${
                            customer.status === 'Active' ? 'text-emerald-600' : 'text-rose-500'
                          }`}
                        >
                          {customer.status}
                        </span>
                      </td>

                      {/* Last Order */}
                      <td className="py-3.5 pr-3 whitespace-nowrap">
                        <div className="text-slate-800 text-[11px] font-mono leading-tight">
                          {customer.lastOrderDate}
                        </div>
                        <div className="text-slate-500 font-mono font-bold text-[11px] leading-tight mt-0.5">
                          ₹ {customer.lastOrderAmount.toLocaleString('en-IN')}
                        </div>
                      </td>

                      {/* Actions */}
                      <td className="py-3.5 pr-2 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          onClick={() => setSelectedCustomer(customer)}
                          className="p-1 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100 cursor-pointer"
                        >
                          <MoreVertical className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* PAGINATION FOOTER */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-3 border-t border-slate-100 text-xs">
            <span className="text-slate-500">
              {loading
                ? 'Loading…'
                : listError
                  ? <span className="text-rose-600">{listError}</span>
                  : total === 0
                    ? 'No customers found'
                    : `Showing ${(currentPage - 1) * PAGE_SIZE + 1}-${Math.min(currentPage * PAGE_SIZE, total)} of ${total} customers`}
            </span>

            <div className="flex items-center gap-1">
              <button
                type="button"
                disabled={currentPage <= 1}
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                aria-label="Previous page"
                className="w-7 h-7 rounded-lg border border-slate-200 flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-50 disabled:opacity-40"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <span className="px-2 text-slate-600 font-semibold">
                {currentPage} / {totalPages}
              </span>
              <button
                type="button"
                disabled={currentPage >= totalPages}
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                aria-label="Next page"
                className="w-7 h-7 rounded-lg border border-slate-200 flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-50 disabled:opacity-40"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* RIGHT SIDEBAR (4 cols) */}
        <div className="lg:col-span-4 space-y-4">
          
          {/* 1. CUSTOMER SEGMENTS CARD */}
          <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs">
            <div className="flex items-center justify-between mb-3 pb-2 border-b border-slate-100">
              <h3 className="text-xs font-bold font-heading text-slate-900">Customer Segments</h3>
              <button
                type="button"
                className="text-[11px] font-semibold text-blue-600 hover:text-blue-700 cursor-pointer"
              >
                View all
              </button>
            </div>

            <div className="flex items-center gap-4">
              {/* Donut Chart */}
              <div className="relative w-28 h-28 shrink-0 flex items-center justify-center">
                <svg className="w-full h-full -rotate-90" viewBox={`0 0 ${donutSize} ${donutSize}`}>
                  <circle
                    cx={donutSize / 2}
                    cy={donutSize / 2}
                    r={radius}
                    fill="none"
                    stroke="#F1F5F9"
                    strokeWidth={strokeWidth}
                  />
                  {donutSegments.map((seg, idx) => (
                    <circle
                      key={idx}
                      cx={donutSize / 2}
                      cy={donutSize / 2}
                      r={radius}
                      fill="none"
                      stroke={seg.color}
                      strokeWidth={strokeWidth}
                      strokeDasharray={seg.strokeDasharray}
                      strokeDashoffset={seg.strokeDashoffset}
                      strokeLinecap="round"
                      className="transition-all duration-500 ease-out"
                    />
                  ))}
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                  <span className="text-lg font-bold font-heading text-slate-900 leading-tight">
                    248
                  </span>
                  <span className="text-[9px] text-slate-400 font-medium leading-none">
                    Total Customers
                  </span>
                </div>
              </div>

              {/* Legend */}
              <div className="flex-1 space-y-2 text-[11px]">
                {segments.map((item, idx) => (
                  <div key={idx} className="flex items-center justify-between text-slate-600">
                    <div className="flex items-center gap-1.5">
                      <span
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ backgroundColor: item.color }}
                      />
                      <span className="font-medium text-slate-700">{item.name}</span>
                    </div>
                    <span className="font-mono text-slate-500 text-[10px]">
                      {item.count} ({item.percentage}%)
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* 2. QUICK ACTIONS PANEL (2x2 GRID) */}
          <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs">
            <h3 className="text-xs font-bold font-heading text-slate-900 mb-3">Quick Actions</h3>
            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => setIsAddModalOpen(true)}
                className="flex flex-col items-center justify-center p-3 rounded-xl border border-blue-100 bg-blue-50/30 hover:bg-blue-50 text-blue-700 text-xs font-semibold transition-all cursor-pointer"
              >
                <div className="w-8 h-8 rounded-lg bg-blue-100/70 text-blue-600 flex items-center justify-center mb-1.5">
                  <UserPlus className="w-4 h-4" />
                </div>
                <span>Add Customer</span>
              </button>

              <button
                type="button"
                onClick={() => setIsImportModalOpen(true)}
                className="flex flex-col items-center justify-center p-3 rounded-xl border border-purple-100 bg-purple-50/30 hover:bg-purple-50 text-purple-700 text-xs font-semibold transition-all cursor-pointer"
              >
                <div className="w-8 h-8 rounded-lg bg-purple-100/70 text-purple-600 flex items-center justify-center mb-1.5">
                  <UploadCloud className="w-4 h-4" />
                </div>
                <span>Import Customers</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  if (onCreateInvoice && customers.length > 0) {
                    onCreateInvoice(customers[0]);
                  } else {
                    alert('Select a customer to create an invoice');
                  }
                }}
                className="flex flex-col items-center justify-center p-3 rounded-xl border border-emerald-100 bg-emerald-50/30 hover:bg-emerald-50 text-emerald-700 text-xs font-semibold transition-all cursor-pointer"
              >
                <div className="w-8 h-8 rounded-lg bg-emerald-100/70 text-emerald-600 flex items-center justify-center mb-1.5">
                  <FileText className="w-4 h-4" />
                </div>
                <span>Create Invoice</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  if (customers.length > 0) {
                    const cleanPhone = customers[0].phone.replace(/[^\d]/g, '');
                    window.open(`https://wa.me/${cleanPhone}`, '_blank');
                  }
                }}
                className="flex flex-col items-center justify-center p-3 rounded-xl border border-teal-100 bg-teal-50/30 hover:bg-teal-50 text-teal-700 text-xs font-semibold transition-all cursor-pointer"
              >
                <div className="w-8 h-8 rounded-lg bg-teal-100/70 text-teal-600 flex items-center justify-center mb-1.5">
                  <MessageSquare className="w-4 h-4" />
                </div>
                <span>Send WhatsApp</span>
              </button>
            </div>
          </div>

          {/* 3. RECENT ACTIVITY CARD */}
          <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs">
            <div className="flex items-center justify-between mb-3 pb-2 border-b border-slate-100">
              <h3 className="text-xs font-bold font-heading text-slate-900">Recent Activity</h3>
              <button
                type="button"
                className="text-[11px] font-semibold text-blue-600 hover:text-blue-700 cursor-pointer"
              >
                View all
              </button>
            </div>

            <div className="space-y-3.5">
              {recentActivities.map(item => (
                <div key={item.id} className="flex items-start gap-3">
                  <div className="w-7 h-7 rounded-full bg-slate-50 border border-slate-200 flex items-center justify-center shrink-0 mt-0.5 text-slate-600">
                    {item.type === 'customer' ? (
                      <Users className="w-3.5 h-3.5 text-blue-600" />
                    ) : item.type === 'call' ? (
                      <Phone className="w-3.5 h-3.5 text-sky-600" />
                    ) : item.type === 'invoice' ? (
                      <FileText className="w-3.5 h-3.5 text-purple-600" />
                    ) : (
                      <MessageSquare className="w-3.5 h-3.5 text-emerald-600" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-semibold text-slate-800 leading-tight">
                      {item.title}
                    </div>
                    <div className="text-[11px] text-slate-500 truncate leading-tight mt-0.5">
                      {item.subtitle}
                    </div>
                    <div className="text-[10px] text-slate-400 font-mono mt-1">
                      {item.timeAgo}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

        </div>
      </div>

      {/* ========================================================================= */}
      {/* MODALS */}
      {/* ========================================================================= */}

      {/* ADD CUSTOMER MODAL */}
      {isAddModalOpen && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-100 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
                  <UserPlus className="w-4 h-4" />
                </div>
                <h3 className="font-bold text-slate-900">Add New Customer</h3>
              </div>
              <button
                onClick={() => setIsAddModalOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleAddCustomerSubmit} className="space-y-3.5 mt-4 text-xs">
              {addError && (
                <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700">{addError}</div>
              )}
              <div>
                <label className="block text-slate-700 font-semibold mb-1">Customer Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Ramesh Kumar"
                  value={newCust.name}
                  onChange={(e) => setNewCust({ ...newCust, name: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-slate-700 font-semibold mb-1">Company Name</label>
                <input
                  type="text"
                  placeholder="e.g. Kumar Store"
                  value={newCust.company}
                  onChange={(e) => setNewCust({ ...newCust, company: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-700 font-semibold mb-1">Phone</label>
                  <input
                    type="tel"
                    placeholder="+91 98765 00000"
                    value={newCust.phone}
                    onChange={(e) => setNewCust({ ...newCust, phone: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-slate-700 font-semibold mb-1">Email</label>
                  <input
                    type="email"
                    placeholder="contact@store.in"
                    value={newCust.email}
                    onChange={(e) => setNewCust({ ...newCust, email: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-700 font-semibold mb-1">Segment</label>
                  <select
                    value={newCust.segment}
                    onChange={(e: any) => setNewCust({ ...newCust, segment: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none cursor-pointer"
                  >
                    <option value="Retail">Retail</option>
                    <option value="Wholesale">Wholesale</option>
                    <option value="Corporate">Corporate</option>
                    <option value="Others">Others</option>
                  </select>
                </div>
                <div>
                  <label className="block text-slate-700 font-semibold mb-1">Status</label>
                  <select
                    value={newCust.status}
                    onChange={(e: any) => setNewCust({ ...newCust, status: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none cursor-pointer"
                  >
                    <option value="Active">Active</option>
                    <option value="Inactive">Inactive</option>
                    <option value="Prospect">Prospect</option>
                  </select>
                </div>
              </div>
              <p className="text-[11px] text-slate-400">Provide at least an e-mail address or a phone number.</p>

              <div>
                <label className="block text-slate-700 font-semibold mb-1">Last Order Amount (₹)</label>
                <input
                  type="number"
                  value={newCust.lastOrderAmount}
                  onChange={(e) => setNewCust({ ...newCust, lastOrderAmount: Number(e.target.value) })}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-4 py-2 border border-slate-200 rounded-xl text-slate-600 hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2 disabled:opacity-60 bg-blue-600 text-white rounded-xl font-bold shadow-xs hover:bg-blue-700 cursor-pointer"
                >
                  Save Customer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* IMPORT MODAL */}
      {isImportModalOpen && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-100 animate-in fade-in zoom-in-95 text-center">
            <div className="w-12 h-12 rounded-2xl bg-purple-50 text-purple-600 flex items-center justify-center mx-auto mb-3">
              <UploadCloud className="w-6 h-6" />
            </div>
            <h3 className="font-bold text-base text-slate-900">Import Customers</h3>
            <p className="text-xs text-slate-500 mt-1">
              {legacyCount
                ? `${legacyCount} customer(s) from the previous version are stored only in this browser. Import them into the CRM database so they are available on every device.`
                : 'No locally stored customers were found in this browser. Spreadsheet import is not available yet.'}
            </p>
            <div className="mt-4 p-6 border-2 border-dashed border-slate-200 rounded-2xl hover:border-purple-400 transition-colors cursor-pointer bg-slate-50/50">
              <FileText className="w-8 h-8 text-slate-400 mx-auto mb-2" />
              <div className="text-xs font-semibold text-slate-700">Drag & drop files here, or browse</div>
              <div className="text-[10px] text-slate-400 mt-0.5">Supports .CSV, .XLSX (up to 10MB)</div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsImportModalOpen(false)}
                className="px-4 py-2 border border-slate-200 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-50 cursor-pointer"
              >
                Close
              </button>
              <button
                type="button"
                disabled={!legacyCount || saving}
                onClick={() => void handleLegacyImport()}
                className="px-5 py-2 bg-purple-600 text-white rounded-xl text-xs font-bold shadow-xs hover:bg-purple-700 cursor-pointer"
              >
                Start Import
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CUSTOMER DETAIL MODAL */}
      {selectedCustomer && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-100 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center font-bold text-sm">
                  {getInitials(selectedCustomer.name)}
                </div>
                <div>
                  <h3 className="font-bold text-base text-slate-900">{selectedCustomer.name}</h3>
                  <p className="text-xs text-slate-500">{selectedCustomer.company} • {selectedCustomer.segment}</p>
                </div>
              </div>
              <button
                onClick={() => setSelectedCustomer(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="mt-4 space-y-3.5 text-xs">
              <div className="grid grid-cols-2 gap-3 p-3 rounded-xl bg-slate-50 border border-slate-200">
                <div>
                  <span className="text-slate-400 text-[10px] uppercase font-bold block">Phone</span>
                  <span className="font-semibold text-slate-800 font-mono">{selectedCustomer.phone}</span>
                </div>
                <div>
                  <span className="text-slate-400 text-[10px] uppercase font-bold block">Email</span>
                  <span className="font-semibold text-slate-800">{selectedCustomer.email}</span>
                </div>
                <div>
                  <span className="text-slate-400 text-[10px] uppercase font-bold block">Status</span>
                  <span className={`font-semibold ${selectedCustomer.status === 'Active' ? 'text-emerald-600' : 'text-rose-500'}`}>
                    {selectedCustomer.status}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 text-[10px] uppercase font-bold block">Last Order</span>
                  <span className="font-semibold text-slate-800 font-mono">
                    {selectedCustomer.lastOrderDate} (₹ {selectedCustomer.lastOrderAmount.toLocaleString('en-IN')})
                  </span>
                </div>
              </div>

              <div className="pt-2 flex items-center justify-between border-t border-slate-100">
                <div className="flex items-center gap-2">
                  <a
                    href={`tel:${selectedCustomer.phone}`}
                    className="px-3 py-1.5 bg-blue-50 text-blue-600 rounded-lg font-semibold hover:bg-blue-100 flex items-center gap-1.5"
                  >
                    <Phone className="w-3.5 h-3.5" />
                    <span>Call</span>
                  </a>
                  <button
                    type="button"
                    onClick={() => {
                      const cleanPhone = selectedCustomer.phone.replace(/[^\d]/g, '');
                      window.open(`https://wa.me/${cleanPhone}`, '_blank');
                    }}
                    className="px-3 py-1.5 bg-emerald-50 text-emerald-600 rounded-lg font-semibold hover:bg-emerald-100 flex items-center gap-1.5 cursor-pointer"
                  >
                    <MessageSquare className="w-3.5 h-3.5" />
                    <span>WhatsApp</span>
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedCustomer(null)}
                  className="px-4 py-1.5 border border-slate-200 rounded-lg text-slate-600 cursor-pointer"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
