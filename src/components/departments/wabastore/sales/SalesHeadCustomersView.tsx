import React, { useState } from 'react';
import {
  Users,
  Search,
  Filter,
  Eye,
  MessageSquare,
  Building2,
  Mail,
  Phone,
  Calendar,
  X,
  CheckCircle2,
  Clock,
  ArrowUpRight,
  TrendingUp,
  Tag
} from 'lucide-react';
import { teamMemberStore } from '../../../../services/teamMemberStore';
import { Customer } from '../../../../types/crm';

export const SalesHeadCustomersView: React.FC = () => {
  const [customers] = useState<Customer[]>(() => teamMemberStore.getCustomers());
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSegment, setSelectedSegment] = useState('All');
  const [selectedStatus, setSelectedStatus] = useState('All');
  const [selectedCustomerForView, setSelectedCustomerForView] = useState<Customer | null>(null);

  const formatINR = (val: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0
    }).format(val);
  };

  const assignedMap: Record<string, { rep: string; pod: string }> = {
    'CUST-001': { rep: 'Priya Nair', pod: 'Pod Alpha' },
    'CUST-002': { rep: 'Amit Patel', pod: 'Pod Alpha' },
    'CUST-003': { rep: 'Sameer Kulkarni', pod: 'Pod Beta' },
    'CUST-004': { rep: 'Priya Nair', pod: 'Pod Alpha' },
    'CUST-005': { rep: 'Rahul Kumar', pod: 'Pod Alpha' },
    'CUST-006': { rep: 'Sneha Deshmukh', pod: 'Pod Alpha' },
    'CUST-007': { rep: 'Ananya Verma', pod: 'Pod Beta' },
    'CUST-008': { rep: 'Rohan Varma', pod: 'Pod Alpha' }
  };

  const filteredCustomers = customers.filter(c => {
    if (selectedSegment !== 'All' && c.segment !== selectedSegment) return false;
    if (selectedStatus !== 'All' && c.status !== selectedStatus) return false;
    if (
      searchQuery &&
      !c.name.toLowerCase().includes(searchQuery.toLowerCase()) &&
      !c.company.toLowerCase().includes(searchQuery.toLowerCase()) &&
      !c.email.toLowerCase().includes(searchQuery.toLowerCase())
    ) {
      return false;
    }
    return true;
  });

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl sm:text-2xl font-bold font-heading text-slate-900">
              Department Customer Accounts
            </h1>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-purple-100 text-purple-800">
              248 Total Accounts
            </span>
          </div>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Monitor client profiles, assigned sales executives, interaction logs, and lifetime commercial order values.
          </p>
        </div>

        {/* Search */}
        <div className="relative w-full sm:w-72">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search by customer or company..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-emerald-600 shadow-2xs"
          />
        </div>
      </div>

      {/* Top 4 Customer KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-xs">
          <span className="text-xs font-semibold text-slate-500">Total Customer Base</span>
          <p className="text-2xl font-bold font-heading text-slate-900 mt-1 font-mono">248</p>
          <span className="text-[10px] font-bold text-emerald-600">+14% vs last month</span>
        </div>
        <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-xs">
          <span className="text-xs font-semibold text-slate-500">Active Accounts</span>
          <p className="text-2xl font-bold font-heading text-emerald-600 mt-1 font-mono">213</p>
          <span className="text-[10px] text-slate-400">86% retention rate</span>
        </div>
        <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-xs">
          <span className="text-xs font-semibold text-slate-500">Inactive Accounts</span>
          <p className="text-2xl font-bold font-heading text-amber-600 mt-1 font-mono">35</p>
          <span className="text-[10px] text-amber-700">Need re-engagement</span>
        </div>
        <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-xs">
          <span className="text-xs font-semibold text-slate-500">New This Month</span>
          <p className="text-2xl font-bold font-heading text-blue-600 mt-1 font-mono">18</p>
          <span className="text-[10px] text-blue-700">+5 this week</span>
        </div>
      </div>

      {/* Filter Row */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-bold text-slate-400 uppercase tracking-wider mr-1">Segment:</span>
        {['All', 'Retail', 'Wholesale', 'Corporate', 'Others'].map(seg => (
          <button
            key={seg}
            onClick={() => setSelectedSegment(seg)}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
              selectedSegment === seg
                ? 'bg-slate-900 text-white shadow-2xs'
                : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
            }`}
          >
            {seg}
          </button>
        ))}

        <div className="h-4 w-px bg-slate-200 mx-2 hidden sm:block" />

        <span className="text-xs font-bold text-slate-400 uppercase tracking-wider mr-1">Status:</span>
        {['All', 'Active', 'Inactive'].map(st => (
          <button
            key={st}
            onClick={() => setSelectedStatus(st)}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
              selectedStatus === st
                ? 'bg-slate-900 text-white shadow-2xs'
                : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
            }`}
          >
            {st}
          </button>
        ))}
      </div>

      {/* Customers Table */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200/80 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                <th className="py-3 px-4">Customer & Email</th>
                <th className="py-3 px-4">Company</th>
                <th className="py-3 px-4">Segment</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Assigned Employee & Pod</th>
                <th className="py-3 px-4">Total Spent</th>
                <th className="py-3 px-4">Orders</th>
                <th className="py-3 px-4">Last Order</th>
                <th className="py-3 px-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {filteredCustomers.map(cust => {
                const assigned = assignedMap[cust.id] || { rep: 'Sales Team', pod: 'Pod Alpha' };
                const segmentColors: Record<string, string> = {
                  Retail: 'bg-blue-50 text-blue-700 border-blue-200',
                  Wholesale: 'bg-purple-50 text-purple-700 border-purple-200',
                  Corporate: 'bg-indigo-50 text-indigo-700 border-indigo-200',
                  Others: 'bg-slate-100 text-slate-700 border-slate-200'
                };

                return (
                  <tr key={cust.id} className="hover:bg-slate-50 transition-colors">
                    <td className="py-3.5 px-4">
                      <div className="font-bold text-slate-900">{cust.name}</div>
                      <div className="text-[11px] text-slate-400 font-mono">{cust.email}</div>
                    </td>

                    <td className="py-3.5 px-4 font-semibold text-slate-700">
                      {cust.company}
                    </td>

                    <td className="py-3.5 px-4">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${segmentColors[cust.segment] || 'bg-slate-100'}`}>
                        {cust.segment}
                      </span>
                    </td>

                    <td className="py-3.5 px-4">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        cust.status === 'Active'
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          : 'bg-amber-50 text-amber-700 border border-amber-200'
                      }`}>
                        {cust.status}
                      </span>
                    </td>

                    <td className="py-3.5 px-4">
                      <span className="font-semibold text-slate-800 block">{assigned.rep}</span>
                      <span className="text-[10px] text-slate-400">{assigned.pod}</span>
                    </td>

                    <td className="py-3.5 px-4 font-mono font-bold text-slate-900">
                      {formatINR(cust.totalSpent ?? cust.lastOrderAmount ?? 0)}
                    </td>

                    <td className="py-3.5 px-4 font-mono text-slate-600">
                      {cust.orderCount ?? 1}
                    </td>

                    <td className="py-3.5 px-4 text-slate-500">
                      {cust.lastOrderDate}
                    </td>

                    <td className="py-3.5 px-4 text-right">
                      <button
                        onClick={() => setSelectedCustomerForView(cust)}
                        className="p-1.5 rounded-lg bg-slate-100 hover:bg-emerald-50 text-slate-600 hover:text-emerald-700 transition-colors"
                        title="View Customer Dossier"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Customer Profile Modal */}
      {selectedCustomerForView && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-100 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center font-bold">
                  {selectedCustomerForView.name.slice(0, 2).toUpperCase()}
                </div>
                <div>
                  <h3 className="font-bold text-sm text-slate-900">{selectedCustomerForView.name}</h3>
                  <p className="text-[11px] text-slate-500">{selectedCustomerForView.company} &bull; {selectedCustomerForView.segment}</p>
                </div>
              </div>
              <button
                onClick={() => setSelectedCustomerForView(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 bg-slate-50 p-3 rounded-xl text-xs">
              <div>
                <span className="text-slate-400 block text-[10px] uppercase font-bold">Total Spent</span>
                <span className="font-mono font-bold text-slate-900 text-sm">{formatINR(selectedCustomerForView.totalSpent ?? selectedCustomerForView.lastOrderAmount ?? 0)}</span>
              </div>
              <div>
                <span className="text-slate-400 block text-[10px] uppercase font-bold">Orders Placed</span>
                <span className="font-mono font-bold text-slate-900 text-sm">{selectedCustomerForView.orderCount ?? 1} Orders</span>
              </div>
              <div>
                <span className="text-slate-400 block text-[10px] uppercase font-bold">Assigned Sales Executive</span>
                <span className="font-semibold text-slate-800">
                  {assignedMap[selectedCustomerForView.id]?.rep || 'Sales Rep'} ({assignedMap[selectedCustomerForView.id]?.pod || 'Pod Alpha'})
                </span>
              </div>
              <div>
                <span className="text-slate-400 block text-[10px] uppercase font-bold">Status</span>
                <span className="font-bold text-emerald-600">{selectedCustomerForView.status}</span>
              </div>
            </div>

            <div className="space-y-2">
              <h4 className="font-bold text-xs text-slate-800">Recent Customer Interaction History</h4>
              <div className="space-y-2 text-xs">
                <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-100 flex items-center justify-between">
                  <div>
                    <p className="font-medium text-slate-800">WhatsApp Commerce Order Placed</p>
                    <span className="text-[10px] text-slate-400">Order Ref: ORD-9921 &bull; {selectedCustomerForView.lastOrderDate}</span>
                  </div>
                  <span className="font-mono font-bold text-emerald-600">{formatINR(selectedCustomerForView.lastOrderAmount)}</span>
                </div>
                <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-100 flex items-center justify-between">
                  <div>
                    <p className="font-medium text-slate-800">Account Health Checkup Call</p>
                    <span className="text-[10px] text-slate-400">Logged by {assignedMap[selectedCustomerForView.id]?.rep || 'Rep'} &bull; Satisfied NPS</span>
                  </div>
                  <span className="text-[10px] font-bold text-indigo-600">Completed</span>
                </div>
              </div>
            </div>

            <div className="pt-3 border-t border-slate-100 flex justify-end">
              <button
                onClick={() => setSelectedCustomerForView(null)}
                className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold"
              >
                Close Dossier
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
