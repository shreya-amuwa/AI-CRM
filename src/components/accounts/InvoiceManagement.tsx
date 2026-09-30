import React, { useState } from 'react';
import { Download, Eye, Edit2, Trash2, Send, CheckCircle } from 'lucide-react';

interface Invoice {
  id: string;
  invoiceNumber: string;
  customer: string;
  amount: number;
  dueDate: string;
  status: 'Paid' | 'Pending' | 'Overdue';
  paymentDate?: string;
  items: InvoiceItem[];
}

interface InvoiceItem {
  description: string;
  quantity: number;
  rate: number;
  amount: number;
}

const INITIAL_INVOICES: Invoice[] = [
  {
    id: '1',
    invoiceNumber: 'INV-2024-001',
    customer: 'Amuwa Corporation',
    amount: 250000,
    dueDate: '2024-09-15',
    status: 'Paid',
    paymentDate: '2024-09-14',
    items: [
      { description: 'Design Services', quantity: 1, rate: 150000, amount: 150000 },
      { description: 'Development', quantity: 100, rate: 1000, amount: 100000 }
    ]
  },
  {
    id: '2',
    invoiceNumber: 'INV-2024-002',
    customer: 'Amuwa Design Studio',
    amount: 180000,
    dueDate: '2024-10-05',
    status: 'Pending',
    items: [
      { description: 'Logo Design & Branding', quantity: 1, rate: 50000, amount: 50000 },
      { description: 'Website Design', quantity: 1, rate: 80000, amount: 80000 },
      { description: 'UI/UX Mockups', quantity: 3, rate: 20000, amount: 60000 }
    ]
  },
  {
    id: '3',
    invoiceNumber: 'INV-2024-003',
    customer: 'Wabastar',
    amount: 320000,
    dueDate: '2024-08-30',
    status: 'Overdue',
    items: [
      { description: 'Consultation Services', quantity: 40, rate: 5000, amount: 200000 },
      { description: 'Software License', quantity: 1, rate: 120000, amount: 120000 }
    ]
  },
  {
    id: '4',
    invoiceNumber: 'INV-2024-004',
    customer: 'Whatsbox',
    amount: 215000,
    dueDate: '2024-09-20',
    status: 'Paid',
    paymentDate: '2024-09-19',
    items: [
      { description: 'Content Writing', quantity: 50, rate: 2000, amount: 100000 },
      { description: 'Marketing Materials', quantity: 1, rate: 115000, amount: 115000 }
    ]
  },
  {
    id: '5',
    invoiceNumber: 'INV-2024-005',
    customer: 'D Talk Corporation',
    amount: 195000,
    dueDate: '2024-10-10',
    status: 'Pending',
    items: [
      { description: 'Training Programs', quantity: 30, rate: 5000, amount: 150000 },
      { description: 'Documentation', quantity: 1, rate: 45000, amount: 45000 }
    ]
  }
];

export const InvoiceManagement: React.FC = () => {
  const [invoices, setInvoices] = useState<Invoice[]>(INITIAL_INVOICES);
  const [filterStatus, setFilterStatus] = useState<'All' | 'Paid' | 'Pending' | 'Overdue'>('All');
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);

  const filteredInvoices = invoices.filter(inv =>
    filterStatus === 'All' ? true : inv.status === filterStatus
  );

  const stats = {
    total: invoices.length,
    paid: invoices.filter(i => i.status === 'Paid').reduce((sum, i) => sum + i.amount, 0),
    pending: invoices.filter(i => i.status === 'Pending').reduce((sum, i) => sum + i.amount, 0),
    overdue: invoices.filter(i => i.status === 'Overdue').reduce((sum, i) => sum + i.amount, 0)
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Paid':
        return 'bg-emerald-100 text-emerald-900 border-emerald-200';
      case 'Pending':
        return 'bg-amber-100 text-amber-900 border-amber-200';
      case 'Overdue':
        return 'bg-red-100 text-red-900 border-red-200';
      default:
        return 'bg-slate-100 text-slate-900';
    }
  };

  const handleMarkAsPaid = (invoice: Invoice) => {
    setInvoices(prev => prev.map(inv =>
      inv.id === invoice.id ? { ...inv, status: 'Paid', paymentDate: new Date().toISOString().split('T')[0] } : inv
    ));
    setSelectedInvoice(null);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-slate-900">Invoice Management</h2>
        <p className="text-sm text-slate-600 mt-1">Manage and track invoices across all departments</p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Invoices */}
        <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-2xl border border-blue-200 p-6 relative overflow-hidden">
          <div className="absolute -right-8 -top-8 w-32 h-32 bg-blue-200 rounded-full opacity-10" />
          <div className="relative z-10">
            <p className="text-xs font-bold text-blue-900 uppercase">Total Invoices</p>
            <h3 className="text-3xl font-bold text-blue-900 mt-2">{stats.total}</h3>
            <p className="text-xs text-blue-700 mt-2">+12 this month</p>
          </div>
        </div>

        {/* Paid Amount */}
        <div className="bg-gradient-to-br from-emerald-50 to-emerald-100 rounded-2xl border border-emerald-200 p-6 relative overflow-hidden">
          <div className="absolute -right-8 -top-8 w-32 h-32 bg-emerald-200 rounded-full opacity-10" />
          <div className="relative z-10">
            <p className="text-xs font-bold text-emerald-900 uppercase">Paid Amount</p>
            <h3 className="text-3xl font-bold text-emerald-900 mt-2">₹{(stats.paid / 100000).toFixed(1)}L</h3>
            <p className="text-xs text-emerald-700 mt-2">{Math.round((stats.paid / (stats.paid + stats.pending + stats.overdue)) * 100)}% collected</p>
          </div>
        </div>

        {/* Pending Amount */}
        <div className="bg-gradient-to-br from-amber-50 to-amber-100 rounded-2xl border border-amber-200 p-6 relative overflow-hidden">
          <div className="absolute -right-8 -top-8 w-32 h-32 bg-amber-200 rounded-full opacity-10" />
          <div className="relative z-10">
            <p className="text-xs font-bold text-amber-900 uppercase">Pending Amount</p>
            <h3 className="text-3xl font-bold text-amber-900 mt-2">₹{(stats.pending / 100000).toFixed(1)}L</h3>
            <p className="text-xs text-amber-700 mt-2">{Math.round((stats.pending / (stats.paid + stats.pending + stats.overdue)) * 100)}% pending</p>
          </div>
        </div>

        {/* Overdue Amount */}
        <div className="bg-gradient-to-br from-red-50 to-red-100 rounded-2xl border border-red-200 p-6 relative overflow-hidden">
          <div className="absolute -right-8 -top-8 w-32 h-32 bg-red-200 rounded-full opacity-10" />
          <div className="relative z-10">
            <p className="text-xs font-bold text-red-900 uppercase">Overdue Amount</p>
            <h3 className="text-3xl font-bold text-red-900 mt-2">₹{(stats.overdue / 100000).toFixed(1)}L</h3>
            <p className="text-xs text-red-700 mt-2">{invoices.filter(i => i.status === 'Overdue').length} invoices</p>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        {(['All', 'Paid', 'Pending', 'Overdue'] as const).map(status => (
          <button
            key={status}
            onClick={() => setFilterStatus(status)}
            className={`px-4 py-2 text-xs font-bold rounded-lg transition-all ${
              filterStatus === status
                ? 'bg-gradient-to-r from-blue-600 to-blue-700 text-white shadow-lg'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            {status}
          </button>
        ))}
      </div>

      {/* Invoices Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-6 py-4 text-left text-xs font-bold text-slate-600 uppercase">Invoice ID</th>
                <th className="px-6 py-4 text-left text-xs font-bold text-slate-600 uppercase">Customer</th>
                <th className="px-6 py-4 text-left text-xs font-bold text-slate-600 uppercase">Amount</th>
                <th className="px-6 py-4 text-left text-xs font-bold text-slate-600 uppercase">Due Date</th>
                <th className="px-6 py-4 text-left text-xs font-bold text-slate-600 uppercase">Status</th>
                <th className="px-6 py-4 text-center text-xs font-bold text-slate-600 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredInvoices.map(invoice => (
                <tr key={invoice.id} className="border-b border-slate-200 hover:bg-slate-50 transition-colors">
                  <td className="px-6 py-4 text-sm font-bold text-slate-900">{invoice.invoiceNumber}</td>
                  <td className="px-6 py-4 text-sm text-slate-600">{invoice.customer}</td>
                  <td className="px-6 py-4 text-sm font-bold text-slate-900">₹{invoice.amount.toLocaleString()}</td>
                  <td className="px-6 py-4 text-sm text-slate-600">{new Date(invoice.dueDate).toLocaleDateString('en-IN')}</td>
                  <td className="px-6 py-4">
                    <span className={`inline-block px-3 py-1.5 text-xs font-bold rounded-lg border ${getStatusColor(invoice.status)}`}>
                      {invoice.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-center">
                    <div className="flex gap-2 justify-center">
                      <button
                        onClick={() => setSelectedInvoice(invoice)}
                        className="p-2 hover:bg-blue-50 text-blue-600 rounded-lg transition-colors"
                        title="View"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                      <button
                        className="p-2 hover:bg-blue-50 text-blue-600 rounded-lg transition-colors"
                        title="Edit"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        className="p-2 hover:bg-blue-50 text-blue-600 rounded-lg transition-colors"
                        title="Download"
                      >
                        <Download className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Invoice Detail Modal */}
      {selectedInvoice && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-3xl bg-white rounded-3xl shadow-2xl border border-slate-200 max-h-[90vh] overflow-y-auto">
            {/* Modal Header */}
            <div className="bg-gradient-to-r from-blue-600 to-blue-700 px-8 py-6 flex justify-between items-start border-b border-slate-200">
              <div>
                <h2 className="text-xl font-bold text-white">Invoice Details</h2>
                <p className="text-sm text-blue-100 mt-1">{selectedInvoice.invoiceNumber} • {selectedInvoice.customer}</p>
              </div>
              <button
                onClick={() => setSelectedInvoice(null)}
                className="text-white hover:bg-blue-500 p-2 rounded-full transition-colors"
              >
                ✕
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-8 space-y-6">
              {/* Invoice Info */}
              <div className="grid grid-cols-2 gap-6 pb-6 border-b border-slate-200">
                <div>
                  <p className="text-xs font-bold text-slate-600 uppercase mb-2">Invoice ID</p>
                  <p className="text-lg font-bold text-slate-900">{selectedInvoice.invoiceNumber}</p>
                </div>
                <div>
                  <p className="text-xs font-bold text-slate-600 uppercase mb-2">Customer</p>
                  <p className="text-lg font-bold text-slate-900">{selectedInvoice.customer}</p>
                </div>
                <div>
                  <p className="text-xs font-bold text-slate-600 uppercase mb-2">Due Date</p>
                  <p className="text-lg font-bold text-slate-900">{new Date(selectedInvoice.dueDate).toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
                </div>
                <div>
                  <p className="text-xs font-bold text-slate-600 uppercase mb-2">Status</p>
                  <span className={`inline-block px-3 py-1.5 text-xs font-bold rounded-lg border ${getStatusColor(selectedInvoice.status)}`}>
                    {selectedInvoice.status}
                  </span>
                </div>
              </div>

              {/* Invoice Items */}
              <div>
                <h3 className="text-sm font-bold text-slate-900 uppercase mb-4">Invoice Items</h3>
                <div className="bg-slate-50 rounded-xl overflow-hidden border border-slate-200">
                  <div className="grid grid-cols-4 gap-4 p-4 bg-slate-100 border-b border-slate-200 text-xs font-bold text-slate-600 uppercase">
                    <div>Description</div>
                    <div className="text-right">Qty</div>
                    <div className="text-right">Rate</div>
                    <div className="text-right">Amount</div>
                  </div>
                  {selectedInvoice.items.map((item, idx) => (
                    <div key={idx} className="grid grid-cols-4 gap-4 p-4 border-b border-slate-200 last:border-b-0">
                      <div className="text-sm font-medium text-slate-900">{item.description}</div>
                      <div className="text-right text-sm text-slate-600">{item.quantity}</div>
                      <div className="text-right text-sm text-slate-600">₹{item.rate.toLocaleString()}</div>
                      <div className="text-right text-sm font-bold text-slate-900">₹{item.amount.toLocaleString()}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Totals */}
              <div className="bg-blue-50 rounded-xl p-6 border border-blue-200">
                <div className="space-y-3">
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-600">Subtotal:</span>
                    <span className="font-bold text-slate-900">₹{selectedInvoice.items.reduce((sum, i) => sum + i.amount, 0).toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-600">Tax (18%):</span>
                    <span className="font-bold text-slate-900">₹{Math.round(selectedInvoice.items.reduce((sum, i) => sum + i.amount, 0) * 0.18).toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between text-lg font-bold border-t border-blue-300 pt-3">
                    <span className="text-slate-900">Total Amount:</span>
                    <span className="text-blue-600">₹{selectedInvoice.amount.toLocaleString()}</span>
                  </div>
                </div>
              </div>

              {/* Payment Info */}
              <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-xl p-6 border border-blue-200">
                <h4 className="text-sm font-bold text-blue-900 uppercase mb-4">Payment Details</h4>
                <div className="grid grid-cols-2 gap-6 text-sm">
                  <div>
                    <p className="text-blue-700 font-bold mb-1">Bank Name</p>
                    <p className="text-slate-900">HDFC Bank</p>
                  </div>
                  <div>
                    <p className="text-blue-700 font-bold mb-1">Account Holder</p>
                    <p className="text-slate-900">Amuwa Corporation</p>
                  </div>
                  <div>
                    <p className="text-blue-700 font-bold mb-1">Account Number</p>
                    <p className="text-slate-900">****5678</p>
                  </div>
                  <div>
                    <p className="text-blue-700 font-bold mb-1">IFSC Code</p>
                    <p className="text-slate-900">HDFC0000123</p>
                  </div>
                </div>
              </div>

              {/* Notes */}
              <div className="bg-amber-50 rounded-xl p-6 border border-amber-200">
                <h4 className="text-sm font-bold text-amber-900 uppercase mb-2">Notes</h4>
                <p className="text-sm text-amber-900">Payment terms: Net 30 days. Please make payment via bank transfer. Invoice due by {new Date(selectedInvoice.dueDate).toLocaleDateString('en-IN')}.</p>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="px-8 py-6 border-t border-slate-200 bg-slate-50 flex gap-3 justify-end">
              <button
                onClick={() => setSelectedInvoice(null)}
                className="px-6 py-2.5 bg-slate-200 hover:bg-slate-300 text-slate-900 font-bold rounded-xl transition-all"
              >
                Close
              </button>
              <button className="px-6 py-2.5 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white font-bold rounded-xl flex items-center gap-2 transition-all transform hover:scale-105">
                <Send className="w-4 h-4" />
                Send Reminder
              </button>
              {selectedInvoice.status !== 'Paid' && (
                <button
                  onClick={() => handleMarkAsPaid(selectedInvoice)}
                  className="px-6 py-2.5 bg-gradient-to-r from-emerald-600 to-emerald-700 hover:from-emerald-700 hover:to-emerald-800 text-white font-bold rounded-xl flex items-center gap-2 transition-all transform hover:scale-105"
                >
                  <CheckCircle className="w-4 h-4" />
                  Mark as Paid
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default InvoiceManagement;
