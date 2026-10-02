import React, { useState, useEffect } from 'react';
import {
  FileText, FileCheck2, Users, DollarSign, ArrowRight, ArrowLeft,
  Search, Filter, Eye, Printer, Download, Building2, CheckCircle2,
  Clock, AlertCircle, ArrowUpRight, Award, ChevronRight, Sparkles
} from 'lucide-react';
import {
  accountsStore,
  normalizeDepartmentId,
  DepartmentInvoice,
  DepartmentQuotation,
  TeamMemberPerformance,
  DepartmentFinancialMetric
} from '../../../services/accountsStore';
import { InvoicePdfModal } from './InvoicePdfModal';
import { QuotationPdfModal } from './QuotationPdfModal';

interface InvoiceViewProps {
  initialDepartmentId?: string;
}

export const InvoiceView: React.FC<InvoiceViewProps> = ({ initialDepartmentId }) => {
  const [selectedDeptId, setSelectedDeptId] = useState<string | null>(initialDepartmentId || null);
  const [activeSubTab, setActiveSubTab] = useState<'all' | 'invoices' | 'quotations' | 'team'>('all');
  
  // Search & Filter
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  // Modals
  const [activeInvoiceForPdf, setActiveInvoiceForPdf] = useState<DepartmentInvoice | null>(null);
  const [activeQuotationForPdf, setActiveQuotationForPdf] = useState<DepartmentQuotation | null>(null);

  // Reactive state listener to update view whenever an invoice is created across departments
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
  const invoices = accountsStore.getInvoices();
  const quotations = accountsStore.getQuotations();

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0
    }).format(amount);
  };

  // Currently selected department details with normalized ID matching
  const selectedDeptMetric = metrics.find(m =>
    m.departmentId === selectedDeptId ||
    normalizeDepartmentId(m.departmentId) === normalizeDepartmentId(selectedDeptId || '')
  );
  const deptTeamMembers = selectedDeptId ? accountsStore.getTeamMembersPerformance(selectedDeptId) : [];
  const deptInvoices = selectedDeptId ? accountsStore.getInvoicesForDepartment(selectedDeptId) : [];
  const deptQuotations = selectedDeptId ? accountsStore.getQuotationsForDepartment(selectedDeptId) : [];

  // Filtered lists
  const filteredInvoices = deptInvoices.filter(inv => {
    const matchStatus = statusFilter === 'all' || inv.status.toLowerCase() === statusFilter.toLowerCase();
    const matchSearch =
      searchQuery === '' ||
      inv.invoiceNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
      inv.clientCompany.toLowerCase().includes(searchQuery.toLowerCase()) ||
      inv.teamMemberName.toLowerCase().includes(searchQuery.toLowerCase());
    return matchStatus && matchSearch;
  });

  const filteredQuotations = deptQuotations.filter(q => {
    const matchStatus = statusFilter === 'all' || q.status.toLowerCase() === statusFilter.toLowerCase();
    const matchSearch =
      searchQuery === '' ||
      q.quotationNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
      q.clientCompany.toLowerCase().includes(searchQuery.toLowerCase()) ||
      q.teamMemberName.toLowerCase().includes(searchQuery.toLowerCase());
    return matchStatus && matchSearch;
  });

  return (
    <div className="space-y-8 animate-fade-in font-sans">

      {/* Top Banner */}
      <div className="bg-white border border-slate-200 rounded-3xl p-6 sm:p-8 shadow-sm relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-gradient-to-bl from-blue-500/10 via-indigo-500/5 to-transparent rounded-full pointer-events-none blur-3xl" />
        
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 relative z-10">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-50 border border-blue-200 text-blue-800 text-xs font-mono font-semibold">
              <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
              <span>DEPARTMENT INVOICES &amp; PROPOSALS HUB</span>
            </div>
            <h2 className="text-2xl sm:text-3xl font-bold font-heading text-slate-900 tracking-tight">
              {selectedDeptMetric
                ? `${selectedDeptMetric.departmentName} &bull; Accounts &amp; Commercials`
                : 'Department-Wise Invoices &amp; Quotations'}
            </h2>
            <p className="text-sm text-slate-500 max-w-2xl leading-relaxed">
              {selectedDeptMetric
                ? `Operational invoice and commercial quotation ledger for ${selectedDeptMetric.departmentName}. Review team member sales contributions, download official tax invoices, and track proposal conversions.`
                : 'Select any operating department to inspect its commercial team performance, member-by-member business closed, interactive invoice PDFs, and quotation documents.'}
            </p>
          </div>

          {selectedDeptId && (
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => {
                  setSelectedDeptId(null);
                  setStatusFilter('all');
                  setSearchQuery('');
                }}
                className="flex items-center gap-1.5 px-4 py-2.5 rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-mono font-bold text-xs transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>All Departments</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* VIEW 1: DEPARTMENT SELECTOR CARDS (When no department is selected) */}
      {!selectedDeptId ? (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-bold font-heading text-slate-900">
                Select Department to Open Accounts &amp; Billing Ledger
              </h3>
              <p className="text-xs text-slate-500 font-mono">
                Click into any department to view individual team member revenue, invoice PDFs, and quotations.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {metrics.map(dept => {
              const deptInvList = accountsStore.getInvoicesForDepartment(dept.departmentId);
              const deptQuoteList = accountsStore.getQuotationsForDepartment(dept.departmentId);
              const totalInvoiced = deptInvList.reduce((sum, i) => sum + i.totalAmount, 0);

              return (
                <div
                  key={dept.departmentId}
                  onClick={() => setSelectedDeptId(dept.departmentId)}
                  className="bg-white rounded-3xl border border-slate-200 p-6 shadow-sm hover:shadow-xl hover:border-blue-500/80 hover:-translate-y-1 transition-all cursor-pointer space-y-6 group relative overflow-hidden"
                >
                  <div
                    className="h-1.5 w-full absolute top-0 left-0 right-0"
                    style={{ backgroundColor: dept.accentColor }}
                  />

                  {/* Header */}
                  <div className="flex items-center justify-between pt-1">
                    <div className="flex items-center gap-3">
                      {dept.logoUrl ? (
                        <div className="w-12 h-12 rounded-2xl bg-slate-50 p-1.5 border border-slate-200 flex items-center justify-center shrink-0 shadow-2xs group-hover:scale-105 transition-transform">
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
                        <h4 className="text-lg font-bold font-heading text-slate-900 group-hover:text-blue-600 transition-colors">
                          {dept.departmentName}
                        </h4>
                        <p className="text-xs text-slate-400 font-mono">
                          {dept.activeTeamMembersCount} Sales Executives
                        </p>
                      </div>
                    </div>

                    <div className="p-2 rounded-xl bg-blue-50 text-blue-600 group-hover:bg-blue-600 group-hover:text-white transition-colors">
                      <ChevronRight className="w-4 h-4" />
                    </div>
                  </div>

                  {/* Metrics */}
                  <div className="grid grid-cols-2 gap-3 p-4 rounded-2xl bg-slate-50 border border-slate-100 text-center font-mono">
                    <div className="space-y-0.5">
                      <span className="text-[10px] text-slate-400 uppercase font-bold">TOTAL INVOICED</span>
                      <p className="text-base font-bold text-slate-900">{formatCurrency(totalInvoiced)}</p>
                      <span className="text-[10px] text-emerald-600 font-semibold">{deptInvList.length} Invoices</span>
                    </div>

                    <div className="space-y-0.5 border-l border-slate-200">
                      <span className="text-[10px] text-slate-400 uppercase font-bold">QUOTATIONS</span>
                      <p className="text-base font-bold text-slate-900">{deptQuoteList.length} Proposals</p>
                      <span className="text-[10px] text-blue-600 font-semibold">Active Pipeline</span>
                    </div>
                  </div>

                  {/* Top Performer Badge */}
                  <div className="flex items-center justify-between text-xs font-mono pt-1 text-slate-500">
                    <span className="flex items-center gap-1.5 text-slate-600">
                      <Award className="w-3.5 h-3.5 text-amber-500" />
                      <span>Head: <strong className="text-slate-800">{dept.topPerformerName}</strong></span>
                    </span>
                    <span className="text-blue-600 font-bold group-hover:translate-x-1 transition-transform flex items-center gap-1">
                      <span>Open Ledger</span>
                      <ArrowRight className="w-3 h-3" />
                    </span>
                  </div>

                </div>
              );
            })}
          </div>
        </div>
      ) : (
        /* VIEW 2: DEPARTMENT-SPECIFIC ACCOUNTS LEDGER */
        <div className="space-y-8 animate-fade-in">

          {/* Department Tabs Bar */}
          <div className="bg-white p-2.5 rounded-2xl border border-slate-200 shadow-xs flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                onClick={() => setActiveSubTab('all')}
                className={`px-4 py-2 rounded-xl text-xs font-mono font-bold transition-all ${
                  activeSubTab === 'all'
                    ? 'bg-slate-900 text-white shadow-xs'
                    : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                }`}
              >
                Full Department Overview
              </button>
              <button
                onClick={() => setActiveSubTab('team')}
                className={`px-4 py-2 rounded-xl text-xs font-mono font-bold transition-all flex items-center gap-1.5 ${
                  activeSubTab === 'team'
                    ? 'bg-slate-900 text-white shadow-xs'
                    : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                }`}
              >
                <Users className="w-3.5 h-3.5" />
                <span>Team Members ({deptTeamMembers.length})</span>
              </button>
              <button
                onClick={() => setActiveSubTab('invoices')}
                className={`px-4 py-2 rounded-xl text-xs font-mono font-bold transition-all flex items-center gap-1.5 ${
                  activeSubTab === 'invoices'
                    ? 'bg-slate-900 text-white shadow-xs'
                    : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                }`}
              >
                <FileText className="w-3.5 h-3.5" />
                <span>Tax Invoices ({deptInvoices.length})</span>
              </button>
              <button
                onClick={() => setActiveSubTab('quotations')}
                className={`px-4 py-2 rounded-xl text-xs font-mono font-bold transition-all flex items-center gap-1.5 ${
                  activeSubTab === 'quotations'
                    ? 'bg-slate-900 text-white shadow-xs'
                    : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                }`}
              >
                <FileCheck2 className="w-3.5 h-3.5" />
                <span>Quotations ({deptQuotations.length})</span>
              </button>
            </div>

            {/* Quick Department Switcher */}
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono text-slate-400">Switch Unit:</span>
              <select
                value={selectedDeptId}
                onChange={e => setSelectedDeptId(e.target.value)}
                className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono text-slate-800"
              >
                {metrics.map(m => (
                  <option key={m.departmentId} value={m.departmentId}>
                    {m.departmentName}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* SECTION 1: TEAM MEMBERS BUSINESS CONTRIBUTION */}
          {(activeSubTab === 'all' || activeSubTab === 'team') && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-bold font-heading text-slate-900 flex items-center gap-2">
                    <Users className="w-5 h-5 text-blue-600" />
                    <span>Team Members Business Contribution &bull; {selectedDeptMetric?.departmentName}</span>
                  </h3>
                  <p className="text-xs text-slate-500 font-mono">
                    Total revenue closed, won invoices count, and commercial quotation conversions by team member.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {deptTeamMembers.map(member => (
                  <div
                    key={member.teamMemberId}
                    className="bg-white rounded-3xl border border-slate-200 p-5 shadow-xs hover:shadow-md transition-all space-y-4"
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

                    <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-100 space-y-2 font-mono text-xs">
                      <div className="flex justify-between items-center">
                        <span className="text-slate-400 text-[11px]">BUSINESS CLOSED:</span>
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
                      <div className="flex justify-between items-center text-slate-600 text-[11px]">
                        <span>Conversion Rate:</span>
                        <strong className="text-blue-700">{member.conversionRatePct}%</strong>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* SECTION 2: DEPARTMENT TAX INVOICES */}
          {(activeSubTab === 'all' || activeSubTab === 'invoices') && (
            <div className="space-y-4 pt-2">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                <div>
                  <h3 className="text-lg font-bold font-heading text-slate-900 flex items-center gap-2">
                    <FileText className="w-5 h-5 text-emerald-600" />
                    <span>Official Department Invoices</span>
                  </h3>
                  <p className="text-xs text-slate-500 font-mono">
                    View and print official corporate tax invoices for {selectedDeptMetric?.departmentName}.
                  </p>
                </div>

                {activeSubTab === 'invoices' && (
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      placeholder="Search invoices..."
                      value={searchQuery}
                      onChange={e => setSearchQuery(e.target.value)}
                      className="px-3.5 py-1.5 bg-white border border-slate-200 rounded-xl text-xs font-mono text-slate-800"
                    />
                  </div>
                )}
              </div>

              <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-mono text-slate-600 uppercase tracking-wider">
                        <th className="py-4 px-6">Invoice #</th>
                        <th className="py-4 px-6">Client / Customer Organization</th>
                        <th className="py-4 px-4">Sales Executive</th>
                        <th className="py-4 px-4">Dates</th>
                        <th className="py-4 px-4">Status</th>
                        <th className="py-4 px-4 text-right">Amount (₹)</th>
                        <th className="py-4 px-6 text-center">PDF Document</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-xs">
                      {filteredInvoices.map(inv => (
                        <tr key={inv.id} className="hover:bg-slate-50/70 transition-colors">
                          
                          {/* Invoice # */}
                          <td className="py-4 px-6 align-middle font-mono font-bold text-slate-900">
                            {inv.invoiceNumber}
                          </td>

                          {/* Client */}
                          <td className="py-4 px-6 align-middle">
                            <h5 className="font-bold text-slate-900">{inv.clientCompany}</h5>
                            <p className="text-[11px] text-slate-500">{inv.clientName}</p>
                          </td>

                          {/* Sales Executive */}
                          <td className="py-4 px-4 align-middle font-mono">
                            <span className="font-semibold text-slate-800 block">{inv.teamMemberName}</span>
                            <span className="text-[10px] text-slate-400">{inv.teamMemberRole}</span>
                          </td>

                          {/* Dates */}
                          <td className="py-4 px-4 align-middle font-mono text-slate-500 text-[11px]">
                            <div>Issued: {inv.issuedDate}</div>
                            <div>Due: {inv.dueDate}</div>
                          </td>

                          {/* Status */}
                          <td className="py-4 px-4 align-middle">
                            <span className={`inline-block px-2.5 py-1 rounded-full text-[10px] font-mono font-bold uppercase tracking-wider ${
                              inv.status === 'Paid'
                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                : 'bg-amber-50 text-amber-700 border border-amber-200'
                            }`}>
                              {inv.status}
                            </span>
                          </td>

                          {/* Amount */}
                          <td className="py-4 px-4 align-middle text-right font-mono font-bold text-slate-900 text-sm">
                            {formatCurrency(inv.totalAmount)}
                          </td>

                          {/* PDF Action */}
                          <td className="py-4 px-6 align-middle text-center">
                            <button
                              onClick={() => setActiveInvoiceForPdf(inv)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-mono font-bold text-xs shadow-xs active:scale-95 transition-all"
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

                {filteredInvoices.length === 0 && (
                  <div className="text-center py-10 text-slate-400 font-mono text-xs">
                    No invoices recorded for this department yet.
                  </div>
                )}
              </div>
            </div>
          )}

          {/* SECTION 3: DEPARTMENT QUOTATIONS & PROPOSALS */}
          {(activeSubTab === 'all' || activeSubTab === 'quotations') && (
            <div className="space-y-4 pt-2">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                <div>
                  <h3 className="text-lg font-bold font-heading text-slate-900 flex items-center gap-2">
                    <FileCheck2 className="w-5 h-5 text-blue-600" />
                    <span>Commercial Quotations &amp; Proposals</span>
                  </h3>
                  <p className="text-xs text-slate-500 font-mono">
                    View official proposals and commercial quotes prepared for clients by {selectedDeptMetric?.departmentName}.
                  </p>
                </div>
              </div>

              <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-mono text-slate-600 uppercase tracking-wider">
                        <th className="py-4 px-6">Quote Ref #</th>
                        <th className="py-4 px-6">Client Organization</th>
                        <th className="py-4 px-4">Prepared By</th>
                        <th className="py-4 px-4">Validity</th>
                        <th className="py-4 px-4">Status</th>
                        <th className="py-4 px-4 text-right">Estimated Value (₹)</th>
                        <th className="py-4 px-6 text-center">PDF Proposal</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-xs">
                      {filteredQuotations.map(q => (
                        <tr key={q.id} className="hover:bg-slate-50/70 transition-colors">
                          
                          {/* Quote # */}
                          <td className="py-4 px-6 align-middle font-mono font-bold text-slate-900">
                            {q.quotationNumber}
                          </td>

                          {/* Client */}
                          <td className="py-4 px-6 align-middle">
                            <h5 className="font-bold text-slate-900">{q.clientCompany}</h5>
                            <p className="text-[11px] text-slate-500">{q.clientName}</p>
                          </td>

                          {/* Prepared By */}
                          <td className="py-4 px-4 align-middle font-mono">
                            <span className="font-semibold text-slate-800 block">{q.teamMemberName}</span>
                            <span className="text-[10px] text-slate-400">{q.teamMemberRole}</span>
                          </td>

                          {/* Dates */}
                          <td className="py-4 px-4 align-middle font-mono text-slate-500 text-[11px]">
                            <div>Issued: {q.issuedDate}</div>
                            <div className="text-emerald-700 font-semibold">Valid: {q.validUntil}</div>
                          </td>

                          {/* Status */}
                          <td className="py-4 px-4 align-middle">
                            <span className={`inline-block px-2.5 py-1 rounded-full text-[10px] font-mono font-bold uppercase tracking-wider ${
                              q.status === 'Accepted'
                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                : 'bg-blue-50 text-blue-700 border border-blue-200'
                            }`}>
                              {q.status}
                            </span>
                          </td>

                          {/* Estimated Value */}
                          <td className="py-4 px-4 align-middle text-right font-mono font-bold text-blue-900 text-sm">
                            {formatCurrency(q.estimatedValue)}
                          </td>

                          {/* PDF Action */}
                          <td className="py-4 px-6 align-middle text-center">
                            <button
                              onClick={() => setActiveQuotationForPdf(q)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-mono font-bold text-xs shadow-xs active:scale-95 transition-all"
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

                {filteredQuotations.length === 0 && (
                  <div className="text-center py-10 text-slate-400 font-mono text-xs">
                    No quotations prepared for this department yet.
                  </div>
                )}
              </div>
            </div>
          )}

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
