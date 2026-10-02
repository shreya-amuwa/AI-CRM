import React, { useState } from 'react';
import {
  DollarSign, TrendingUp, TrendingDown, FileText, FileCheck2,
  Users, Building2, ShieldCheck, ArrowRight, ArrowUpRight, Receipt,
  CheckCircle2, Printer, Download, Eye
} from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';
import { accountsStore } from '../../../services/accountsStore';
import { InvoicePdfModal } from '../accounts/InvoicePdfModal';
import { QuotationPdfModal } from '../accounts/QuotationPdfModal';

interface DepartmentAccountsBillingViewProps {
  departmentId: string;
  departmentName?: string;
  onNavigateToMasterAccounts?: () => void;
}

export const DepartmentAccountsBillingView: React.FC<DepartmentAccountsBillingViewProps> = ({
  departmentId,
  departmentName,
  onNavigateToMasterAccounts
}) => {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<'overview' | 'invoices' | 'quotations' | 'expenses' | 'team'>('overview');
  
  // Modals
  const [activeInvoiceForPdf, setActiveInvoiceForPdf] = useState<any | null>(null);
  const [activeQuotationForPdf, setActiveQuotationForPdf] = useState<any | null>(null);

  const metric = accountsStore.getMetricsForDepartment(departmentId);
  const invoices = accountsStore.getInvoicesForDepartment(departmentId);
  const quotations = accountsStore.getQuotationsForDepartment(departmentId);
  const expenses = accountsStore.getExpensesForDepartment(departmentId);
  const teamMembers = accountsStore.getTeamMembersPerformance(departmentId);

  const resolvedName = departmentName || metric?.departmentName || departmentId.toUpperCase();

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0
    }).format(amount);
  };

  const isSuperAdminOrAccountsHead =
    user?.role === 'superadmin' ||
    (user?.role === 'admin' && (user?.departmentId === 'accounts' || user?.email === 'accounts@amuwa.com'));

  return (
    <div className="space-y-6 animate-fade-in font-sans">
      
      {/* Top Banner */}
      <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm relative overflow-hidden">
        <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-emerald-500 to-teal-600" />
        
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 pt-1">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-600 border border-emerald-100 flex items-center justify-center shadow-xs">
              <DollarSign className="w-7 h-7" />
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[11px] font-mono text-emerald-700 font-bold uppercase tracking-wider">
                  DEPARTMENT FINANCIAL LEDGER &bull; {resolvedName.toUpperCase()}
                </span>
              </div>
              <h2 className="text-2xl font-bold font-heading text-slate-900 tracking-tight">
                Accounts, Invoicing &amp; Commercials
              </h2>
              <p className="text-xs text-slate-500 font-mono">
                Departmental billing records, team business contributions, tax invoices, and operating spend.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {onNavigateToMasterAccounts && (
              <button
                onClick={onNavigateToMasterAccounts}
                className="flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-slate-900 hover:bg-slate-800 text-white font-mono font-bold text-xs shadow-md transition-all active:scale-95"
              >
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                <span>Central Accounts Department</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* 4 KPI Summary Cards for this department */}
        {metric && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-6 pt-6 border-t border-slate-100">
            <div className="p-4 rounded-2xl bg-emerald-50/60 border border-emerald-200/80 space-y-1">
              <span className="text-[10px] font-mono font-bold text-emerald-800 uppercase">Gross Income</span>
              <p className="text-xl font-bold font-mono text-emerald-950">{formatCurrency(metric.grossIncome)}</p>
              <span className="text-[10px] text-emerald-700 font-mono">{invoices.length} Invoices Closed</span>
            </div>

            <div className="p-4 rounded-2xl bg-rose-50/60 border border-rose-200/80 space-y-1">
              <span className="text-[10px] font-mono font-bold text-rose-800 uppercase">Department Expenses</span>
              <p className="text-xl font-bold font-mono text-rose-950">{formatCurrency(metric.totalExpenses)}</p>
              <span className="text-[10px] text-rose-700 font-mono">{expenses.length} Corporate Vouchers</span>
            </div>

            <div className="p-4 rounded-2xl bg-blue-50/60 border border-blue-200/80 space-y-1">
              <span className="text-[10px] font-mono font-bold text-blue-800 uppercase">Net Department Profit</span>
              <p className="text-xl font-bold font-mono text-blue-950">{formatCurrency(metric.netEarnings)}</p>
              <span className="text-[10px] text-blue-700 font-mono">{metric.profitMarginPct}% Profit Margin</span>
            </div>

            <div className="p-4 rounded-2xl bg-purple-50/60 border border-purple-200/80 space-y-1">
              <span className="text-[10px] font-mono font-bold text-purple-800 uppercase">Target Achievement</span>
              <p className="text-xl font-bold font-mono text-purple-950">{metric.targetAchievedPct}%</p>
              <span className="text-[10px] text-purple-700 font-mono">Target: {formatCurrency(metric.monthlyTarget)}</span>
            </div>
          </div>
        )}

        {/* Sub-tabs */}
        <div className="flex flex-wrap items-center gap-1.5 mt-6 pt-6 border-t border-slate-100">
          <button
            onClick={() => setActiveTab('overview')}
            className={`px-3.5 py-1.5 rounded-xl font-mono text-xs font-bold transition-all ${
              activeTab === 'overview'
                ? 'bg-slate-900 text-white shadow-xs'
                : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
            }`}
          >
            Overview
          </button>
          <button
            onClick={() => setActiveTab('team')}
            className={`px-3.5 py-1.5 rounded-xl font-mono text-xs font-bold transition-all flex items-center gap-1.5 ${
              activeTab === 'team'
                ? 'bg-slate-900 text-white shadow-xs'
                : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            <span>Team Revenue ({teamMembers.length})</span>
          </button>
          <button
            onClick={() => setActiveTab('invoices')}
            className={`px-3.5 py-1.5 rounded-xl font-mono text-xs font-bold transition-all flex items-center gap-1.5 ${
              activeTab === 'invoices'
                ? 'bg-slate-900 text-white shadow-xs'
                : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            <span>Tax Invoices ({invoices.length})</span>
          </button>
          <button
            onClick={() => setActiveTab('quotations')}
            className={`px-3.5 py-1.5 rounded-xl font-mono text-xs font-bold transition-all flex items-center gap-1.5 ${
              activeTab === 'quotations'
                ? 'bg-slate-900 text-white shadow-xs'
                : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
            }`}
          >
            <FileCheck2 className="w-3.5 h-3.5" />
            <span>Quotations ({quotations.length})</span>
          </button>
          <button
            onClick={() => setActiveTab('expenses')}
            className={`px-3.5 py-1.5 rounded-xl font-mono text-xs font-bold transition-all flex items-center gap-1.5 ${
              activeTab === 'expenses'
                ? 'bg-slate-900 text-white shadow-xs'
                : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
            }`}
          >
            <Receipt className="w-3.5 h-3.5" />
            <span>Operating Spend ({expenses.length})</span>
          </button>
        </div>

      </div>

      {/* 1. TEAM MEMBERS REVENUE PERFORMANCE */}
      {(activeTab === 'overview' || activeTab === 'team') && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-bold font-heading text-slate-900 flex items-center gap-2">
              <Users className="w-5 h-5 text-blue-600" />
              <span>Sales Team Members &bull; Business Generated</span>
            </h3>
            <span className="text-xs font-mono text-slate-500">
              Department Total Closed: <strong>{formatCurrency(metric?.grossIncome || 0)}</strong>
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {teamMembers.map(member => (
              <div
                key={member.teamMemberId}
                className="bg-white rounded-3xl border border-slate-200 p-5 shadow-xs space-y-3"
              >
                <div className="flex items-center gap-3">
                  {member.avatar ? (
                    <img
                      src={member.avatar}
                      alt={member.name}
                      className="w-12 h-12 rounded-2xl object-cover border border-slate-200 shadow-2xs"
                    />
                  ) : (
                    <div className="w-12 h-12 rounded-2xl bg-blue-100 text-blue-700 font-bold flex items-center justify-center">
                      {member.name.slice(0, 2).toUpperCase()}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <h4 className="text-sm font-bold text-slate-900 truncate">{member.name}</h4>
                    <p className="text-[11px] text-slate-500 truncate">{member.role}</p>
                    <span className={`inline-block mt-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-bold ${
                      member.status === 'Top Performer'
                        ? 'bg-amber-50 text-amber-700 border border-amber-200'
                        : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                    }`}>
                      {member.status}
                    </span>
                  </div>
                </div>

                <div className="p-3 rounded-2xl bg-slate-50 border border-slate-100 space-y-1.5 font-mono text-xs">
                  <div className="flex justify-between items-center">
                    <span className="text-slate-400 text-[10px]">BUSINESS CLOSED:</span>
                    <strong className="text-emerald-800 font-bold text-sm">
                      {formatCurrency(member.totalBusinessClosed)}
                    </strong>
                  </div>
                  <div className="flex justify-between items-center text-slate-600 text-[11px]">
                    <span>Invoices Won:</span>
                    <strong className="text-slate-900">{member.totalInvoicesCount}</strong>
                  </div>
                  <div className="flex justify-between items-center text-slate-600 text-[11px]">
                    <span>Quotations Prepared:</span>
                    <strong className="text-slate-900">{member.totalQuotationsCount}</strong>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 2. INVOICES TABLE */}
      {(activeTab === 'overview' || activeTab === 'invoices') && (
        <div className="space-y-4 pt-2">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-bold font-heading text-slate-900 flex items-center gap-2">
              <FileText className="w-5 h-5 text-emerald-600" />
              <span>Official Department Tax Invoices</span>
            </h3>
            <span className="text-xs font-mono text-slate-500">{invoices.length} Total</span>
          </div>

          <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-mono text-slate-600 uppercase tracking-wider">
                    <th className="py-3.5 px-6">Invoice #</th>
                    <th className="py-3.5 px-6">Customer Organization</th>
                    <th className="py-3.5 px-4">Sales Executive</th>
                    <th className="py-3.5 px-4">Status</th>
                    <th className="py-3.5 px-4 text-right">Amount (₹)</th>
                    <th className="py-3.5 px-6 text-center">PDF</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {invoices.map(inv => (
                    <tr key={inv.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-3.5 px-6 font-mono font-bold text-slate-900">{inv.invoiceNumber}</td>
                      <td className="py-3.5 px-6">
                        <strong className="text-slate-900 block">{inv.clientCompany}</strong>
                        <span className="text-slate-400 text-[11px]">{inv.clientName}</span>
                      </td>
                      <td className="py-3.5 px-4 font-mono text-slate-700">{inv.teamMemberName}</td>
                      <td className="py-3.5 px-4">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold uppercase ${
                          inv.status === 'Paid'
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : 'bg-amber-50 text-amber-700 border border-amber-200'
                        }`}>
                          {inv.status}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono font-bold text-slate-900">
                        {formatCurrency(inv.totalAmount)}
                      </td>
                      <td className="py-3.5 px-6 text-center">
                        <button
                          onClick={() => setActiveInvoiceForPdf(inv)}
                          className="px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-mono font-bold text-xs inline-flex items-center gap-1.5 shadow-xs"
                        >
                          <FileText className="w-3.5 h-3.5 text-emerald-400" />
                          <span>View PDF</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* 3. QUOTATIONS TABLE */}
      {(activeTab === 'overview' || activeTab === 'quotations') && (
        <div className="space-y-4 pt-2">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-bold font-heading text-slate-900 flex items-center gap-2">
              <FileCheck2 className="w-5 h-5 text-blue-600" />
              <span>Commercial Quotations &amp; Proposals</span>
            </h3>
            <span className="text-xs font-mono text-slate-500">{quotations.length} Active Quotes</span>
          </div>

          <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-mono text-slate-600 uppercase tracking-wider">
                    <th className="py-3.5 px-6">Quote Ref #</th>
                    <th className="py-3.5 px-6">Client Organization</th>
                    <th className="py-3.5 px-4">Prepared By</th>
                    <th className="py-3.5 px-4">Validity</th>
                    <th className="py-3.5 px-4">Status</th>
                    <th className="py-3.5 px-4 text-right">Estimated (₹)</th>
                    <th className="py-3.5 px-6 text-center">PDF</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {quotations.map(q => (
                    <tr key={q.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-3.5 px-6 font-mono font-bold text-slate-900">{q.quotationNumber}</td>
                      <td className="py-3.5 px-6">
                        <strong className="text-slate-900 block">{q.clientCompany}</strong>
                        <span className="text-slate-400 text-[11px]">{q.clientName}</span>
                      </td>
                      <td className="py-3.5 px-4 font-mono text-slate-700">{q.teamMemberName}</td>
                      <td className="py-3.5 px-4 font-mono text-slate-500 text-[11px]">{q.validUntil}</td>
                      <td className="py-3.5 px-4">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold uppercase ${
                          q.status === 'Accepted'
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : 'bg-blue-50 text-blue-700 border border-blue-200'
                        }`}>
                          {q.status}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono font-bold text-blue-900">
                        {formatCurrency(q.estimatedValue)}
                      </td>
                      <td className="py-3.5 px-6 text-center">
                        <button
                          onClick={() => setActiveQuotationForPdf(q)}
                          className="px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-mono font-bold text-xs inline-flex items-center gap-1.5 shadow-xs"
                        >
                          <FileCheck2 className="w-3.5 h-3.5 text-blue-200" />
                          <span>View Proposal</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* 4. CORPORATE EXPENSES */}
      {(activeTab === 'overview' || activeTab === 'expenses') && (
        <div className="space-y-4 pt-2">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-bold font-heading text-slate-900 flex items-center gap-2">
              <Receipt className="w-5 h-5 text-rose-600" />
              <span>Department Operating Expenses &amp; Corporate Reasons</span>
            </h3>
            <span className="text-xs font-mono text-slate-500">{expenses.length} Vouchers</span>
          </div>

          <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-mono text-slate-600 uppercase tracking-wider">
                    <th className="py-3.5 px-6">Corporate Reason &amp; Infrastructure Purpose</th>
                    <th className="py-3.5 px-4">Category</th>
                    <th className="py-3.5 px-4">Approved By</th>
                    <th className="py-3.5 px-4">Voucher Ref</th>
                    <th className="py-3.5 px-6 text-right">Amount (₹)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {expenses.map(exp => (
                    <tr key={exp.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-3.5 px-6 font-medium text-slate-800 max-w-md leading-relaxed">
                        {exp.corporateReason}
                      </td>
                      <td className="py-3.5 px-4">
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-slate-100 text-slate-700">
                          {exp.category}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 font-mono text-slate-700">{exp.approvedBy}</td>
                      <td className="py-3.5 px-4 font-mono text-slate-500">{exp.invoiceRef}</td>
                      <td className="py-3.5 px-6 text-right font-mono font-bold text-rose-700">
                        {formatCurrency(exp.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* PDF MODALS */}
      <InvoicePdfModal
        invoice={activeInvoiceForPdf}
        isOpen={activeInvoiceForPdf !== null}
        onClose={() => setActiveInvoiceForPdf(null)}
      />

      <QuotationPdfModal
        quotation={activeQuotationForPdf}
        isOpen={activeQuotationForPdf !== null}
        onClose={() => setActiveQuotationForPdf(null)}
      />

    </div>
  );
};
