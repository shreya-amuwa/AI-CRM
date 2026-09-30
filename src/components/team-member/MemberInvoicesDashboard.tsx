import React, { useState } from 'react';
import {
  FileText,
  DollarSign,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Plus,
  Download,
  Share2,
  X,
  Search,
  Filter
} from 'lucide-react';
import { Invoice } from '../../types/crm';
import { teamMemberStore } from '../../services/teamMemberStore';

interface MemberInvoicesDashboardProps {
  currentUserId: string;
}

export const MemberInvoicesDashboard: React.FC<MemberInvoicesDashboardProps> = ({ currentUserId }) => {
  const [invoices, setInvoices] = useState<Invoice[]>(() => teamMemberStore.getInvoices(currentUserId));
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);

  const [form, setForm] = useState({
    customerName: '',
    company: '',
    amount: 55000,
    dueDate: '2026-10-15',
    status: 'Pending' as Invoice['status']
  });

  const totalBilled = invoices.reduce((acc, inv) => acc + inv.amount, 0);
  const paidInvoices = invoices.filter(inv => inv.status === 'Paid');
  const paidAmount = paidInvoices.reduce((acc, inv) => acc + inv.amount, 0);
  const pendingInvoices = invoices.filter(inv => inv.status === 'Pending');
  const pendingAmount = pendingInvoices.reduce((acc, inv) => acc + inv.amount, 0);
  const overdueInvoices = invoices.filter(inv => inv.status === 'Overdue');
  const overdueAmount = overdueInvoices.reduce((acc, inv) => acc + inv.amount, 0);

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.customerName || !form.company) return;

    teamMemberStore.addInvoice({
      invoiceNumber: `INV-00${126 + invoices.length}`,
      customerName: form.customerName,
      company: form.company,
      amount: Number(form.amount) || 50000,
      issueDate: 'Sep 28, 2026',
      dueDate: form.dueDate,
      status: form.status
    });

    setInvoices(teamMemberStore.getInvoices(currentUserId));
    setIsCreateOpen(false);
    setForm({
      customerName: '',
      company: '',
      amount: 55000,
      dueDate: '2026-10-15',
      status: 'Pending'
    });
  };

  const filteredInvoices = invoices.filter(inv => {
    const q = searchQuery.toLowerCase();
    return (
      !q ||
      inv.invoiceNumber.toLowerCase().includes(q) ||
      inv.customerName.toLowerCase().includes(q) ||
      inv.company.toLowerCase().includes(q)
    );
  });

  const getStatusBadge = (status: Invoice['status']) => {
    switch (status) {
      case 'Paid':
        return (
          <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
            Paid
          </span>
        );
      case 'Pending':
        return (
          <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
            Pending
          </span>
        );
      case 'Overdue':
      default:
        return (
          <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
            Overdue
          </span>
        );
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* HEADER */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold font-heading text-slate-900">
            Invoices & Billing
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Generate invoices, monitor payment statuses, and track collected sales revenue.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setIsCreateOpen(true)}
          className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white rounded-xl text-xs font-bold hover:bg-blue-700 shadow-xs transition-colors cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>Create Invoice</span>
        </button>
      </div>

      {/* KPI METRIC CARDS */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs flex items-center justify-between">
          <div>
            <span className="text-xs font-medium text-slate-500">Total Billed</span>
            <div className="text-xl font-bold font-heading text-slate-900 mt-1">
              ₹ {totalBilled.toLocaleString('en-IN')}
            </div>
            <span className="text-[11px] text-slate-500 mt-1 block">{invoices.length} invoices</span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
            <DollarSign className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs flex items-center justify-between">
          <div>
            <span className="text-xs font-medium text-slate-500">Paid Invoices</span>
            <div className="text-xl font-bold font-heading text-slate-900 mt-1">
              ₹ {paidAmount.toLocaleString('en-IN')}
            </div>
            <span className="text-[11px] text-emerald-600 font-semibold mt-1 block">
              {paidInvoices.length} collected
            </span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
            <CheckCircle2 className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs flex items-center justify-between">
          <div>
            <span className="text-xs font-medium text-slate-500">Pending Amount</span>
            <div className="text-xl font-bold font-heading text-slate-900 mt-1">
              ₹ {pendingAmount.toLocaleString('en-IN')}
            </div>
            <span className="text-[11px] text-amber-600 font-semibold mt-1 block">
              {pendingInvoices.length} awaiting payment
            </span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center">
            <Clock className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs flex items-center justify-between">
          <div>
            <span className="text-xs font-medium text-slate-500">Overdue</span>
            <div className="text-xl font-bold font-heading text-slate-900 mt-1">
              ₹ {overdueAmount.toLocaleString('en-IN')}
            </div>
            <span className="text-[11px] text-rose-500 font-semibold mt-1 block">
              {overdueInvoices.length} requires follow-up
            </span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center">
            <AlertTriangle className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* INVOICE TABLE */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search invoices..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:bg-white focus:outline-none"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="text-[11px] font-bold text-slate-400 border-b border-slate-100">
                <th className="py-3 pl-2 pr-3">Invoice #</th>
                <th className="py-3 pr-3">Customer & Company</th>
                <th className="py-3 pr-3">Issue Date</th>
                <th className="py-3 pr-3">Due Date</th>
                <th className="py-3 pr-3">Amount</th>
                <th className="py-3 pr-3">Status</th>
                <th className="py-3 pr-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {filteredInvoices.map(inv => (
                <tr
                  key={inv.id}
                  className="hover:bg-slate-50/70 transition-colors group cursor-pointer"
                  onClick={() => setSelectedInvoice(inv)}
                >
                  <td className="py-3.5 pl-2 pr-3 font-mono font-bold text-blue-600">
                    {inv.invoiceNumber}
                  </td>
                  <td className="py-3.5 pr-3">
                    <div className="font-bold text-slate-900">{inv.company}</div>
                    <div className="text-[11px] text-slate-500">{inv.customerName}</div>
                  </td>
                  <td className="py-3.5 pr-3 text-slate-600 font-mono text-[11px]">
                    {inv.issueDate}
                  </td>
                  <td className="py-3.5 pr-3 text-slate-600 font-mono text-[11px]">
                    {inv.dueDate}
                  </td>
                  <td className="py-3.5 pr-3 font-mono font-bold text-slate-900">
                    ₹ {inv.amount.toLocaleString('en-IN')}
                  </td>
                  <td className="py-3.5 pr-3 whitespace-nowrap">
                    {getStatusBadge(inv.status)}
                  </td>
                  <td className="py-3.5 pr-2 text-right whitespace-nowrap" onClick={e => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={() => alert(`Downloading ${inv.invoiceNumber}.pdf`)}
                        className="p-1.5 text-slate-400 hover:text-blue-600 rounded-lg hover:bg-slate-100"
                        title="Download PDF"
                      >
                        <Download className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => alert(`Payment link for ${inv.invoiceNumber} copied to clipboard!`)}
                        className="p-1.5 text-slate-400 hover:text-emerald-600 rounded-lg hover:bg-slate-100"
                        title="Share Payment Link"
                      >
                        <Share2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* CREATE INVOICE MODAL */}
      {isCreateOpen && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-100 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
                  <FileText className="w-4 h-4" />
                </div>
                <h3 className="font-bold text-slate-900">Generate New Invoice</h3>
              </div>
              <button onClick={() => setIsCreateOpen(false)} className="p-1 text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateSubmit} className="space-y-3.5 mt-4 text-xs">
              <div>
                <label className="block text-slate-700 font-semibold mb-1">Customer Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Rohan Mehta"
                  value={form.customerName}
                  onChange={e => setForm({ ...form, customerName: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-slate-700 font-semibold mb-1">Company *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Mehta Traders"
                  value={form.company}
                  onChange={e => setForm({ ...form, company: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-700 font-semibold mb-1">Amount (₹) *</label>
                  <input
                    type="number"
                    required
                    value={form.amount}
                    onChange={e => setForm({ ...form, amount: Number(e.target.value) })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-slate-700 font-semibold mb-1">Due Date</label>
                  <input
                    type="date"
                    value={form.dueDate}
                    onChange={e => setForm({ ...form, dueDate: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none"
                  />
                </div>
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsCreateOpen(false)}
                  className="px-4 py-2 border border-slate-200 rounded-xl text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-blue-600 text-white rounded-xl font-bold shadow-xs hover:bg-blue-700"
                >
                  Create Invoice
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* INVOICE PREVIEW MODAL */}
      {selectedInvoice && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-100 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div>
                <h3 className="font-bold text-base text-slate-900">{selectedInvoice.invoiceNumber}</h3>
                <p className="text-xs text-slate-500">{selectedInvoice.company}</p>
              </div>
              <button onClick={() => setSelectedInvoice(null)} className="p-1 text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="mt-4 space-y-3 p-4 bg-slate-50 rounded-xl border border-slate-200 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-500">Customer</span>
                <span className="font-bold text-slate-800">{selectedInvoice.customerName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Issue Date</span>
                <span className="font-mono text-slate-800">{selectedInvoice.issueDate}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Due Date</span>
                <span className="font-mono text-slate-800">{selectedInvoice.dueDate}</span>
              </div>
              <div className="flex justify-between text-sm pt-2 border-t border-slate-200">
                <span className="font-bold text-slate-800">Total Due</span>
                <span className="font-bold font-mono text-blue-600">
                  ₹ {selectedInvoice.amount.toLocaleString('en-IN')}
                </span>
              </div>
            </div>

            <div className="mt-4 flex justify-end gap-2 text-xs">
              <button
                type="button"
                onClick={() => setSelectedInvoice(null)}
                className="px-4 py-2 border border-slate-200 rounded-xl text-slate-600 hover:bg-slate-50"
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => {
                  alert(`Invoice ${selectedInvoice.invoiceNumber} downloaded.`);
                  setSelectedInvoice(null);
                }}
                className="px-5 py-2 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 shadow-xs"
              >
                Download PDF
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
