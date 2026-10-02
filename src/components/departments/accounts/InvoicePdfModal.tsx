import React, { useRef } from 'react';
import { X, Printer, Download, CheckCircle, Building2, ShieldCheck, FileText, ArrowDownToLine } from 'lucide-react';
import { DepartmentInvoice } from '../../../services/accountsStore';

interface InvoicePdfModalProps {
  invoice: DepartmentInvoice | null;
  isOpen: boolean;
  onClose: () => void;
}

export const InvoicePdfModal: React.FC<InvoicePdfModalProps> = ({
  invoice,
  isOpen,
  onClose
}) => {
  const printRef = useRef<HTMLDivElement>(null);

  if (!isOpen || !invoice) return null;

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
            <div className="p-2 rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold font-mono tracking-wide">{invoice.invoiceNumber}</span>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                  invoice.status === 'Paid'
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                    : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                }`}>
                  {invoice.status}
                </span>
              </div>
              <p className="text-xs text-slate-400 font-mono">Official Corporate Tax Invoice &bull; {invoice.departmentName}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handlePrint}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold font-mono border border-slate-700 transition-all active:scale-95"
              title="Print or Save as PDF"
            >
              <Printer className="w-4 h-4 text-emerald-400" />
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

        {/* Scrollable Document Body (Styled as Authentic Tax Invoice) */}
        <div className="overflow-y-auto p-8 sm:p-12 space-y-8 bg-[#FAFAFA] font-sans text-slate-800" ref={printRef}>
          
          {/* Invoice Document Canvas */}
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
                    <p className="text-[11px] font-mono font-semibold text-emerald-600 uppercase tracking-widest">
                      {invoice.departmentName} Division
                    </p>
                  </div>
                </div>
                <div className="text-xs text-slate-500 space-y-0.5 font-mono pt-1">
                  <p>Corporate Office: Tower B, Level 14, Prestige Tech Park, Outer Ring Road</p>
                  <p>Bangalore, Karnataka - 560103, India</p>
                  <p className="text-slate-700 font-semibold">GSTIN: 29AAACA9921M1Z4 &bull; PAN: AAACA9921M &bull; CIN: U72200KA2022PTC159021</p>
                  <p>Email: accounts@amuwa.com &bull; Support: +91 (80) 4122-9000</p>
                </div>
              </div>

              {/* Tax Invoice Badge & Metadata */}
              <div className="sm:text-right space-y-2 shrink-0">
                <div className="inline-block px-3.5 py-1.5 rounded-xl bg-slate-900 text-white text-xs font-mono font-bold tracking-wider uppercase">
                  TAX INVOICE
                </div>
                <div className="space-y-1 text-xs font-mono">
                  <div>
                    <span className="text-slate-400">Invoice No: </span>
                    <strong className="text-slate-900 font-bold">{invoice.invoiceNumber}</strong>
                  </div>
                  <div>
                    <span className="text-slate-400">Issue Date: </span>
                    <strong className="text-slate-800">{invoice.issuedDate}</strong>
                  </div>
                  <div>
                    <span className="text-slate-400">Payment Due: </span>
                    <strong className="text-slate-800">{invoice.dueDate}</strong>
                  </div>
                  {invoice.paymentDate && (
                    <div className="text-emerald-700 font-bold bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                      Paid On: {invoice.paymentDate}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Billed To & Account Executive Section */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-8 py-2">
              <div className="p-5 rounded-2xl bg-slate-50/80 border border-slate-200 space-y-2">
                <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-slate-500 block">
                  BILLED TO (CUSTOMER DETAILS)
                </span>
                <h3 className="text-base font-bold text-slate-900">{invoice.clientCompany}</h3>
                <p className="text-xs font-medium text-slate-700">Attn: {invoice.clientName}</p>
                <p className="text-xs text-slate-600 leading-relaxed">{invoice.clientAddress}</p>
                <div className="text-xs font-mono text-slate-600 pt-1 space-y-0.5">
                  <p>Email: {invoice.clientEmail}</p>
                  {invoice.clientPhone && <p>Phone: {invoice.clientPhone}</p>}
                  {invoice.clientGst && (
                    <p className="text-blue-700 font-semibold font-mono">GSTIN: {invoice.clientGst}</p>
                  )}
                </div>
              </div>

              <div className="p-5 rounded-2xl bg-slate-50/80 border border-slate-200 space-y-2">
                <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-slate-500 block">
                  COMMERCIAL ACCOUNT ATTRIBUTION
                </span>
                <h3 className="text-base font-bold text-slate-900">{invoice.teamMemberName}</h3>
                <p className="text-xs font-semibold text-emerald-700">{invoice.teamMemberRole}</p>
                <p className="text-xs text-slate-500">Employee ID: {invoice.teamMemberId}</p>
                <p className="text-xs text-slate-500">Operating Unit: {invoice.departmentName}</p>
                <div className="mt-3 pt-3 border-t border-slate-200/80 text-[11px] text-slate-500 font-mono">
                  Verified by Accounts & Commercial Audit Division
                </div>
              </div>
            </div>

            {/* Itemized Table */}
            <div className="border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-900 text-white text-[11px] font-mono uppercase tracking-wider">
                    <th className="py-3 px-4 w-12 text-center">#</th>
                    <th className="py-3 px-4">Item & Description of Service</th>
                    <th className="py-3 px-4 w-24 text-center">SAC / HSN</th>
                    <th className="py-3 px-4 w-20 text-center">Qty</th>
                    <th className="py-3 px-4 w-32 text-right">Unit Rate (₹)</th>
                    <th className="py-3 px-4 w-36 text-right">Amount (₹)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {invoice.items.map((item, index) => (
                    <tr key={index} className="hover:bg-slate-50/60 transition-colors">
                      <td className="py-3.5 px-4 text-center font-mono text-slate-400">{index + 1}</td>
                      <td className="py-3.5 px-4 font-medium text-slate-900">
                        {item.description}
                      </td>
                      <td className="py-3.5 px-4 text-center font-mono text-slate-500">
                        {item.sacCode || '998314'}
                      </td>
                      <td className="py-3.5 px-4 text-center font-mono text-slate-700">
                        {item.quantity}
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono text-slate-700">
                        {formatCurrency(item.rate)}
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono font-bold text-slate-900">
                        {formatCurrency(item.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Calculations Breakdown */}
            <div className="flex flex-col sm:flex-row justify-between gap-8 pt-2">
              {/* Payment Details & Bank Transfer Info */}
              <div className="flex-1 space-y-3">
                <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-xs font-mono space-y-1.5 text-slate-700">
                  <div className="font-bold text-slate-900 uppercase tracking-wider text-[11px] flex items-center gap-1.5">
                    <Building2 className="w-3.5 h-3.5 text-blue-600" />
                    <span>CORPORATE BANK WIRE DETAILS</span>
                  </div>
                  <div className="grid grid-cols-2 gap-x-2 gap-y-1 pt-1 text-[11px]">
                    <span className="text-slate-400">Account Name:</span>
                    <span className="font-bold text-slate-900">AMUWA CORPORATION PRIVATE LIMITED</span>
                    <span className="text-slate-400">Bank Name:</span>
                    <span>HDFC Bank Limited</span>
                    <span className="text-slate-400">Account Number:</span>
                    <span className="font-bold text-slate-900">50200088921044</span>
                    <span className="text-slate-400">IFSC Code:</span>
                    <span className="font-bold text-slate-900">HDFC0001758</span>
                    <span className="text-slate-400">Branch:</span>
                    <span>Prestige Tech Park, Bangalore</span>
                  </div>
                </div>

                {invoice.notes && (
                  <p className="text-xs text-slate-500 font-mono italic">
                    Note: {invoice.notes}
                  </p>
                )}
              </div>

              {/* Total Calculation Column */}
              <div className="w-full sm:w-80 space-y-2 text-xs font-mono">
                <div className="flex justify-between py-2 border-b border-slate-100 text-slate-600">
                  <span>Subtotal:</span>
                  <span className="font-bold text-slate-900">{formatCurrency(invoice.subtotal)}</span>
                </div>
                <div className="flex justify-between py-1.5 text-slate-600">
                  <span>CGST ({invoice.taxRate / 2}%):</span>
                  <span>{formatCurrency(invoice.taxAmount / 2)}</span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-slate-200 text-slate-600">
                  <span>SGST ({invoice.taxRate / 2}%):</span>
                  <span>{formatCurrency(invoice.taxAmount / 2)}</span>
                </div>
                <div className="flex justify-between py-3 bg-emerald-50 px-4 rounded-xl border border-emerald-200 text-emerald-950 font-bold text-sm">
                  <span>Grand Total:</span>
                  <span className="text-base text-emerald-800">{formatCurrency(invoice.totalAmount)}</span>
                </div>
                <p className="text-[10px] text-slate-400 text-right pt-1">Inclusive of all applicable statutory corporate taxes</p>
              </div>
            </div>

            {/* Corporate Seal & Authorized Signatory */}
            <div className="pt-8 border-t border-slate-200 flex flex-col sm:flex-row justify-between items-end gap-6 text-xs text-slate-500">
              <div className="space-y-1">
                <div className="flex items-center gap-1.5 text-emerald-700 font-semibold font-mono">
                  <ShieldCheck className="w-4 h-4" />
                  <span>Digitally Generated Corporate Document &bull; Zero Discrepancy Guaranteed</span>
                </div>
                <p className="text-[11px] font-mono text-slate-400">This is a system-authenticated tax invoice authorized by Amuwa Corporate Finance.</p>
              </div>

              <div className="text-center sm:text-right space-y-1 font-mono">
                <div className="w-48 h-12 border-b border-slate-400 flex items-center justify-center italic text-slate-700 font-serif text-sm">
                  Rajiv Khanna
                </div>
                <p className="text-[11px] font-bold text-slate-900">Authorized Signatory</p>
                <p className="text-[10px] text-slate-500">Head of Accounts & Financial Operations</p>
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
              className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold font-mono transition-all shadow-md active:scale-95 flex items-center gap-1.5"
            >
              <ArrowDownToLine className="w-3.5 h-3.5" />
              <span>Download PDF</span>
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
