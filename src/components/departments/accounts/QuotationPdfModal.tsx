import React, { useRef } from 'react';
import { X, Printer, ShieldCheck, FileCheck2, ArrowDownToLine, Calendar, Building2, User } from 'lucide-react';
import { DepartmentQuotation } from '../../../services/accountsStore';

interface QuotationPdfModalProps {
  quotation: DepartmentQuotation | null;
  isOpen: boolean;
  onClose: () => void;
}

export const QuotationPdfModal: React.FC<QuotationPdfModalProps> = ({
  quotation,
  isOpen,
  onClose
}) => {
  const printRef = useRef<HTMLDivElement>(null);

  if (!isOpen || !quotation) return null;

  const handlePrint = () => {
    window.print();
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0
    }).format(amount);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-sm overflow-y-auto">
      <div className="relative w-full max-w-4xl bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden my-8 animate-fade-in flex flex-col max-h-[90vh]">
        
        {/* Modal Top Control Bar */}
        <div className="flex items-center justify-between px-6 py-4 bg-slate-900 text-white shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-blue-500/20 text-blue-400 border border-blue-500/30">
              <FileCheck2 className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold font-mono tracking-wide">{quotation.quotationNumber}</span>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                  quotation.status === 'Accepted'
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                    : 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                }`}>
                  {quotation.status}
                </span>
              </div>
              <p className="text-xs text-slate-400 font-mono">Formal Commercial Quotation & Proposal &bull; {quotation.departmentName}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handlePrint}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold font-mono border border-slate-700 transition-all active:scale-95"
              title="Print or Save as PDF"
            >
              <Printer className="w-4 h-4 text-blue-400" />
              <span>Print / Save PDF</span>
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-xl hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Scrollable Document Body */}
        <div className="overflow-y-auto p-8 sm:p-12 space-y-8 bg-[#FAFAFA] font-sans text-slate-800" ref={printRef}>
          
          {/* Quotation Document Canvas */}
          <div className="bg-white p-8 sm:p-12 rounded-2xl border border-slate-200 shadow-sm space-y-8 print:p-0 print:border-none print:shadow-none">
            
            {/* Top Brand Header */}
            <div className="flex flex-col sm:flex-row justify-between items-start gap-6 border-b border-slate-200 pb-8">
              <div className="space-y-2">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-xl bg-slate-900 text-white flex items-center justify-center font-bold text-lg shadow-sm">
                    A
                  </div>
                  <div>
                    <h1 className="text-2xl font-black font-heading tracking-tight text-slate-900">AMUWA CORPORATION</h1>
                    <p className="text-[11px] font-mono font-semibold text-blue-600 uppercase tracking-widest">
                      {quotation.departmentName} &bull; Enterprise Solutions
                    </p>
                  </div>
                </div>
                <div className="text-xs text-slate-500 space-y-0.5 font-mono pt-1">
                  <p>Corporate Headquarters: Tower B, Level 14, Prestige Tech Park, Outer Ring Road</p>
                  <p>Bangalore, Karnataka - 560103, India</p>
                  <p className="text-slate-700 font-semibold">CIN: U72200KA2022PTC159021 &bull; GSTIN: 29AAACA9921M1Z4</p>
                  <p>Email: business@amuwa.com &bull; Phone: +91 (80) 4122-9000</p>
                </div>
              </div>

              {/* Quotation Badge & Metadata */}
              <div className="sm:text-right space-y-2 shrink-0">
                <div className="inline-block px-3.5 py-1.5 rounded-xl bg-blue-700 text-white text-xs font-mono font-bold tracking-wider uppercase">
                  COMMERCIAL PROPOSAL / QUOTATION
                </div>
                <div className="space-y-1 text-xs font-mono">
                  <div>
                    <span className="text-slate-400">Quote Ref: </span>
                    <strong className="text-slate-900 font-bold">{quotation.quotationNumber}</strong>
                  </div>
                  <div>
                    <span className="text-slate-400">Date of Issue: </span>
                    <strong className="text-slate-800">{quotation.issuedDate}</strong>
                  </div>
                  <div>
                    <span className="text-slate-400">Valid Until: </span>
                    <strong className="text-emerald-700 font-bold">{quotation.validUntil}</strong>
                  </div>
                </div>
              </div>
            </div>

            {/* Client & Account Executive Info */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-8 py-2">
              <div className="p-5 rounded-2xl bg-slate-50/80 border border-slate-200 space-y-2">
                <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-slate-500 block">
                  PROPOSAL PREPARED FOR
                </span>
                <h3 className="text-base font-bold text-slate-900">{quotation.clientCompany}</h3>
                <p className="text-xs font-medium text-slate-700">Attn: {quotation.clientName}</p>
                <p className="text-xs text-slate-600 leading-relaxed">{quotation.clientAddress}</p>
                <div className="text-xs font-mono text-slate-600 pt-1 space-y-0.5">
                  <p>Email: {quotation.clientEmail}</p>
                  {quotation.clientPhone && <p>Contact: {quotation.clientPhone}</p>}
                </div>
              </div>

              <div className="p-5 rounded-2xl bg-slate-50/80 border border-slate-200 space-y-2">
                <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-slate-500 block">
                  COMMERCIAL CONSULTANT ATTRIBUTION
                </span>
                <h3 className="text-base font-bold text-slate-900">{quotation.teamMemberName}</h3>
                <p className="text-xs font-semibold text-blue-700">{quotation.teamMemberRole}</p>
                <p className="text-xs text-slate-500">Representative ID: {quotation.teamMemberId}</p>
                <p className="text-xs text-slate-500">Business Unit: {quotation.departmentName}</p>
                <div className="mt-3 pt-3 border-t border-slate-200/80 text-[11px] text-slate-500 font-mono">
                  Corporate Enterprise Commercials Division
                </div>
              </div>
            </div>

            {/* Scope of Deliverables & Pricing */}
            <div className="border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-900 text-white text-[11px] font-mono uppercase tracking-wider">
                    <th className="py-3 px-4 w-12 text-center">#</th>
                    <th className="py-3 px-4">Deliverable / Solution Component</th>
                    <th className="py-3 px-4">Detailed Scope of Work</th>
                    <th className="py-3 px-4 w-28 text-center">Deployment Timeline</th>
                    <th className="py-3 px-4 w-36 text-right">Investment (₹)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {quotation.items.map((item, index) => (
                    <tr key={index} className="hover:bg-slate-50/60 transition-colors">
                      <td className="py-4 px-4 text-center font-mono text-slate-400 align-top">{index + 1}</td>
                      <td className="py-4 px-4 font-bold text-slate-900 align-top">
                        {item.description}
                      </td>
                      <td className="py-4 px-4 text-slate-600 leading-relaxed align-top">
                        {item.scope}
                      </td>
                      <td className="py-4 px-4 text-center font-mono text-slate-700 align-top">
                        <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 text-[11px] font-semibold">
                          {item.timeline}
                        </span>
                      </td>
                      <td className="py-4 px-4 text-right font-mono font-bold text-slate-900 align-top">
                        {formatCurrency(item.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Commercial Investment Total */}
            <div className="flex flex-col sm:flex-row justify-between gap-8 pt-2">
              <div className="flex-1 space-y-3">
                <div className="p-4 rounded-xl bg-blue-50/60 border border-blue-200/80 text-xs font-mono space-y-1.5 text-slate-700">
                  <div className="font-bold text-blue-900 uppercase tracking-wider text-[11px]">
                    COMMERCIAL TERMS &amp; MILESTONES
                  </div>
                  <p className="text-xs text-slate-700 leading-relaxed pt-1">
                    {quotation.terms}
                  </p>
                </div>
              </div>

              <div className="w-full sm:w-80 space-y-2 text-xs font-mono">
                <div className="flex justify-between py-2 border-b border-slate-100 text-slate-600">
                  <span>Total Proposed Investment:</span>
                  <span className="font-bold text-slate-900">{formatCurrency(quotation.estimatedValue)}</span>
                </div>
                <div className="flex justify-between py-1.5 text-slate-600">
                  <span>Applicable GST (18%):</span>
                  <span>{formatCurrency(Math.round(quotation.estimatedValue * 0.18))}</span>
                </div>
                <div className="flex justify-between py-3 bg-blue-50 px-4 rounded-xl border border-blue-200 text-blue-950 font-bold text-sm">
                  <span>Total With Taxes:</span>
                  <span className="text-base text-blue-900">{formatCurrency(Math.round(quotation.estimatedValue * 1.18))}</span>
                </div>
                <p className="text-[10px] text-slate-400 text-right pt-1">Commercials valid until {quotation.validUntil}</p>
              </div>
            </div>

            {/* Signatures & Acceptance Block */}
            <div className="pt-8 border-t border-slate-200 grid grid-cols-1 sm:grid-cols-2 gap-8 text-xs text-slate-500">
              <div className="space-y-3">
                <p className="text-xs font-bold text-slate-900 font-mono uppercase tracking-wider">FOR CLIENT ACCEPTANCE &amp; WORK ORDER SIGN-OFF:</p>
                <div className="h-16 border-b border-dashed border-slate-400 flex items-end pb-1 text-slate-400 italic">
                  Signature &amp; Corporate Stamp
                </div>
                <div className="text-[11px] font-mono text-slate-500 space-y-0.5">
                  <p>Name: _______________________________</p>
                  <p>Designation: ________________________</p>
                  <p>Date: _______________________________</p>
                </div>
              </div>

              <div className="text-left sm:text-right space-y-3 font-mono">
                <p className="text-xs font-bold text-slate-900 uppercase tracking-wider">FOR AMUWA CORPORATION:</p>
                <div className="h-16 border-b border-slate-400 flex items-center justify-end italic text-slate-700 font-serif text-sm">
                  {quotation.teamMemberName}
                </div>
                <div className="text-[11px] space-y-0.5">
                  <p className="font-bold text-slate-900">{quotation.teamMemberName}</p>
                  <p className="text-slate-500">{quotation.teamMemberRole}</p>
                  <p className="text-emerald-700 font-semibold">Corporate Enterprise Solutions</p>
                </div>
              </div>
            </div>

          </div>
        </div>

        {/* Modal Bottom Action Footer */}
        <div className="px-6 py-3.5 bg-slate-100 border-t border-slate-200 flex items-center justify-between shrink-0">
          <span className="text-xs font-mono text-slate-500">
            Amuwa Corporation Financial Operating System v2.0
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={handlePrint}
              className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold font-mono transition-all shadow-md active:scale-95 flex items-center gap-1.5"
            >
              <ArrowDownToLine className="w-3.5 h-3.5" />
              <span>Download Proposal PDF</span>
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-white hover:bg-slate-200 text-slate-700 text-xs font-bold font-mono border border-slate-200 transition-all active:scale-95"
            >
              Close
            </button>
          </div>
        </div>

      </div>
    </div>
  );
};
