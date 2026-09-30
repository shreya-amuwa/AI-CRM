import React, { useState } from 'react';
import {
  FileText,
  Award,
  ShieldCheck,
  Printer,
  Copy,
  Download,
  Check,
  Sparkles,
  Calendar,
  Building2,
  User,
  ArrowRight,
  Eye,
  CheckCircle2
} from 'lucide-react';
import { Employee } from '../../../types/amuwaHq';

interface AutomatedLetterGeneratorWorkspaceProps {
  initialTab?: 'offer' | 'experience' | 'nda';
  employees?: Employee[];
  onClose?: () => void;
  onSuccessToast?: (msg: string) => void;
}

export const AutomatedLetterGeneratorWorkspace: React.FC<AutomatedLetterGeneratorWorkspaceProps> = ({
  initialTab = 'offer',
  employees = [],
  onClose,
  onSuccessToast
}) => {
  const [activeTab, setActiveTab] = useState<'offer' | 'experience' | 'nda'>(initialTab);
  const [copied, setCopied] = useState(false);

  // 1. OFFER LETTER STATE
  const [offerSalutation, setOfferSalutation] = useState<'Mr.' | 'Ms.' | 'Mrs.'>('Mr.');
  const [offerCandidateName, setOfferCandidateName] = useState('Rahul Deshmukh');
  const [offerEmail, setOfferEmail] = useState('rahul.deshmukh@example.com');
  const [offerPhone, setOfferPhone] = useState('+91 98234 56789');
  const [offerDesignation, setOfferDesignation] = useState('Senior Sales Specialist');
  const [offerDepartment, setOfferDepartment] = useState('Wabastore Sales');
  const [offerMonthlySalary, setOfferMonthlySalary] = useState('65,000');
  const [offerJoiningDate, setOfferJoiningDate] = useState('15th October 2026');
  const [offerProbationMonths, setOfferProbationMonths] = useState(3);
  const [offerReportingLead, setOfferReportingLead] = useState('Vikram Singhania (Head of Sales)');
  const [offerRefNumber, setOfferRefNumber] = useState('AMU/OL/2026/89');

  // Computed Annual CTC
  const monthlyNum = parseInt(offerMonthlySalary.replace(/[^0-9]/g, ''), 10) || 0;
  const annualCtcStr = `₹${((monthlyNum * 12) / 100000).toFixed(2)} LPA`;

  // 2. EXPERIENCE LETTER STATE
  const [expEmployeeName, setExpEmployeeName] = useState('Alexander Wright');
  const [expDesignation, setExpDesignation] = useState('Operations Lead');
  const [expDepartment, setExpDepartment] = useState('Amuwa Operations');
  const [expJoiningDate, setExpJoiningDate] = useState('01-08-2024');
  const [expRelievingDate, setExpRelievingDate] = useState('28-09-2026');
  const [expTenure, setExpTenure] = useState('2 Years, 1 Month, 27 Days');
  const [expPerformanceRating, setExpPerformanceRating] = useState('Exemplary & Outstanding');
  const [expRefNumber, setExpRefNumber] = useState('AMU/EXP/2026/142');

  // Auto-calculate tenure when dates change
  const handleExpDateChange = (joining: string, relieving: string) => {
    setExpJoiningDate(joining);
    setExpRelievingDate(relieving);
    try {
      const d1 = new Date(joining);
      const d2 = new Date(relieving);
      if (!isNaN(d1.getTime()) && !isNaN(d2.getTime()) && d2 > d1) {
        const diffMonths = (d2.getFullYear() - d1.getFullYear()) * 12 + (d2.getMonth() - d1.getMonth());
        const years = Math.floor(diffMonths / 12);
        const months = diffMonths % 12;
        setExpTenure(`${years > 0 ? `${years} Year${years > 1 ? 's' : ''}, ` : ''}${months} Month${months !== 1 ? 's' : ''}`);
      }
    } catch {}
  };

  // 3. NDA LETTER STATE
  const [ndaPartyName, setNdaPartyName] = useState('Priya Sharma');
  const [ndaRole, setNdaRole] = useState('Senior HR Partner & Data Custodian');
  const [ndaEffectiveDate, setNdaEffectiveDate] = useState('28th September 2026');
  const [ndaDurationYears, setNdaDurationYears] = useState('3 Years Post Separation');
  const [ndaJurisdiction, setNdaJurisdiction] = useState('Gurgaon / New Delhi, India');
  const [ndaRefNumber, setNdaRefNumber] = useState('AMU/NDA/2026/67');

  const handleCopyText = (content: string) => {
    navigator.clipboard.writeText(content);
    setCopied(true);
    if (onSuccessToast) onSuccessToast('📋 Copied official document text to clipboard!');
    setTimeout(() => setCopied(false), 2500);
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="space-y-6 font-sans">
      {/* Top Header */}
      <div className="bg-white rounded-3xl border border-slate-200/90 p-5 sm:p-6 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-mono font-bold bg-blue-50 text-blue-700 border border-blue-200 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-blue-600" />
              LEGAL DOCUMENT AUTOMATION ENGINE
            </span>
            <span className="px-2 py-0.5 rounded-full text-[11px] font-mono text-emerald-700 bg-emerald-50 border border-emerald-200 font-semibold">
              Instant PDF &amp; Seal Ready
            </span>
          </div>
          <h2 className="text-xl sm:text-2xl font-bold font-heading text-slate-900">
            Automated Letter &amp; Contract Generator
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Automate production of formal Offer Letters, Relieving &amp; Experience Certificates, and Non-Disclosure Agreements (NDA).
          </p>
        </div>

        {/* Tab Switcher */}
        <div className="flex items-center gap-1.5 p-1.5 bg-slate-100 rounded-2xl text-xs font-semibold shrink-0">
          <button
            onClick={() => setActiveTab('offer')}
            className={`px-3.5 py-2 rounded-xl transition-all cursor-pointer flex items-center gap-2 ${
              activeTab === 'offer'
                ? 'bg-white text-blue-700 font-bold shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <FileText className="w-4 h-4" />
            <span>Offer Letter</span>
          </button>
          <button
            onClick={() => setActiveTab('experience')}
            className={`px-3.5 py-2 rounded-xl transition-all cursor-pointer flex items-center gap-2 ${
              activeTab === 'experience'
                ? 'bg-white text-purple-700 font-bold shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Award className="w-4 h-4" />
            <span>Experience Letter</span>
          </button>
          <button
            onClick={() => setActiveTab('nda')}
            className={`px-3.5 py-2 rounded-xl transition-all cursor-pointer flex items-center gap-2 ${
              activeTab === 'nda'
                ? 'bg-white text-emerald-700 font-bold shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <ShieldCheck className="w-4 h-4" />
            <span>NDA Letter</span>
          </button>
        </div>
      </div>

      {/* Main Workspace Split: Controls Form on Left (5 cols), Live Document Letterhead on Right (7 cols) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        
        {/* ========================================================================= */}
        {/* LEFT COLUMN: PARAMETER CONTROLS & AUTOMATION INPUTS (5 cols) */}
        {/* ========================================================================= */}
        <div className="lg:col-span-5 bg-white rounded-3xl border border-slate-200/90 shadow-sm p-5 sm:p-6 space-y-5">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <h3 className="font-bold text-sm text-slate-900 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-blue-600" />
              <span>
                {activeTab === 'offer' && 'Automate Offer Letter'}
                {activeTab === 'experience' && 'Automate Experience Certificate'}
                {activeTab === 'nda' && 'Automate Legal NDA Agreement'}
              </span>
            </h3>
            <span className="text-[11px] font-mono text-slate-400">Live Auto-Update</span>
          </div>

          {/* TAB 1: OFFER LETTER INPUTS */}
          {activeTab === 'offer' && (
            <div className="space-y-4 text-xs font-mono">
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-slate-700 font-bold mb-1">Prefix</label>
                  <select
                    value={offerSalutation}
                    onChange={(e: any) => setOfferSalutation(e.target.value)}
                    className="w-full px-2.5 py-2 rounded-xl bg-slate-50 border border-slate-200"
                  >
                    <option value="Mr.">Mr.</option>
                    <option value="Ms.">Ms.</option>
                    <option value="Mrs.">Mrs.</option>
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="block text-slate-700 font-bold mb-1">Candidate Full Name *</label>
                  <input
                    type="text"
                    value={offerCandidateName}
                    onChange={(e) => setOfferCandidateName(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 focus:outline-blue-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-700 font-bold mb-1">Email</label>
                  <input
                    type="email"
                    value={offerEmail}
                    onChange={(e) => setOfferEmail(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 focus:outline-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-slate-700 font-bold mb-1">Phone</label>
                  <input
                    type="text"
                    value={offerPhone}
                    onChange={(e) => setOfferPhone(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 focus:outline-blue-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-700 font-bold mb-1">Designation / Role *</label>
                  <input
                    type="text"
                    value={offerDesignation}
                    onChange={(e) => setOfferDesignation(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 focus:outline-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-slate-700 font-bold mb-1">Department</label>
                  <input
                    type="text"
                    value={offerDepartment}
                    onChange={(e) => setOfferDepartment(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 focus:outline-blue-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-700 font-bold mb-1">Monthly Gross (₹) *</label>
                  <input
                    type="text"
                    value={offerMonthlySalary}
                    onChange={(e) => setOfferMonthlySalary(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 focus:outline-blue-500 font-bold text-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-slate-700 font-bold mb-1">Annual CTC</label>
                  <input
                    type="text"
                    readOnly
                    value={annualCtcStr}
                    className="w-full px-3 py-2 rounded-xl bg-slate-100 border border-slate-200 font-bold text-emerald-700"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-700 font-bold mb-1">Joining Date *</label>
                  <input
                    type="text"
                    value={offerJoiningDate}
                    onChange={(e) => setOfferJoiningDate(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 focus:outline-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-slate-700 font-bold mb-1">Probation Period</label>
                  <select
                    value={offerProbationMonths}
                    onChange={(e: any) => setOfferProbationMonths(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 border border-slate-200"
                  >
                    <option value={1}>1 Month</option>
                    <option value={3}>3 Months</option>
                    <option value={6}>6 Months</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-slate-700 font-bold mb-1">Reporting Lead / Manager</label>
                <input
                  type="text"
                  value={offerReportingLead}
                  onChange={(e) => setOfferReportingLead(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 focus:outline-blue-500"
                />
              </div>

              <div className="p-3 rounded-2xl bg-blue-50 border border-blue-200 text-blue-900 text-[11px] font-sans leading-relaxed">
                💡 <strong>Instant Generation:</strong> This offer includes full official clauses: compensation breakdown, 90-day probation terms, standard 30-day notice period, intellectual property transfer, and acceptance endorsement.
              </div>
            </div>
          )}

          {/* TAB 2: EXPERIENCE LETTER INPUTS */}
          {activeTab === 'experience' && (
            <div className="space-y-4 text-xs font-mono">
              <div>
                <label className="block text-slate-700 font-bold mb-1">Select from Roster or Enter Custom Name</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={expEmployeeName}
                    onChange={(e) => setExpEmployeeName(e.target.value)}
                    placeholder="Employee Name"
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 focus:outline-blue-500"
                  />
                  {employees.length > 0 && (
                    <select
                      onChange={(e) => {
                        const target = employees.find(emp => emp.name === e.target.value);
                        if (target) {
                          setExpEmployeeName(target.name);
                          setExpDesignation(target.designation);
                          if (target.joiningDate) {
                            handleExpDateChange(target.joiningDate, expRelievingDate);
                          }
                        }
                      }}
                      className="px-2 py-2 rounded-xl bg-slate-100 border border-slate-200 text-slate-700"
                    >
                      <option value="">Choose Staff...</option>
                      {employees.map(e => (
                        <option key={e.id} value={e.name}>{e.name} ({e.designation})</option>
                      ))}
                    </select>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-700 font-bold mb-1">Designation *</label>
                  <input
                    type="text"
                    value={expDesignation}
                    onChange={(e) => setExpDesignation(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 focus:outline-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-slate-700 font-bold mb-1">Department</label>
                  <input
                    type="text"
                    value={expDepartment}
                    onChange={(e) => setExpDepartment(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 focus:outline-blue-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-700 font-bold mb-1">Date of Joining *</label>
                  <input
                    type="text"
                    value={expJoiningDate}
                    onChange={(e) => handleExpDateChange(e.target.value, expRelievingDate)}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 focus:outline-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-slate-700 font-bold mb-1">Relieving Date (LWD) *</label>
                  <input
                    type="text"
                    value={expRelievingDate}
                    onChange={(e) => handleExpDateChange(expJoiningDate, e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 focus:outline-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-700 font-bold mb-1">Computed Work Tenure (Auto-Calculated)</label>
                <input
                  type="text"
                  value={expTenure}
                  onChange={(e) => setExpTenure(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-purple-50 border border-purple-200 font-bold text-purple-900"
                />
              </div>

              <div>
                <label className="block text-slate-700 font-bold mb-1">Performance &amp; Conduct Rating</label>
                <select
                  value={expPerformanceRating}
                  onChange={(e) => setExpPerformanceRating(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 border border-slate-200"
                >
                  <option value="Exemplary & Outstanding">Exemplary &amp; Outstanding</option>
                  <option value="Highly Commendable & Dedicated">Highly Commendable &amp; Dedicated</option>
                  <option value="Satisfactory & Professional">Satisfactory &amp; Professional</option>
                </select>
              </div>

              <div className="p-3 rounded-2xl bg-purple-50 border border-purple-200 text-purple-900 text-[11px] font-sans leading-relaxed">
                📜 <strong>Service Certification:</strong> Certifies that all dues are cleared, company property has been returned in good condition, and relieves the employee with goodwill.
              </div>
            </div>
          )}

          {/* TAB 3: NDA LETTER INPUTS */}
          {activeTab === 'nda' && (
            <div className="space-y-4 text-xs font-mono">
              <div>
                <label className="block text-slate-700 font-bold mb-1">Disclosee / Recipient Full Name *</label>
                <input
                  type="text"
                  value={ndaPartyName}
                  onChange={(e) => setNdaPartyName(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 focus:outline-blue-500"
                />
              </div>

              <div>
                <label className="block text-slate-700 font-bold mb-1">Role / Capacity of Access *</label>
                <input
                  type="text"
                  value={ndaRole}
                  onChange={(e) => setNdaRole(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 focus:outline-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-700 font-bold mb-1">Effective Date *</label>
                  <input
                    type="text"
                    value={ndaEffectiveDate}
                    onChange={(e) => setNdaEffectiveDate(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 focus:outline-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-slate-700 font-bold mb-1">Confidentiality Term</label>
                  <select
                    value={ndaDurationYears}
                    onChange={(e) => setNdaDurationYears(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 border border-slate-200"
                  >
                    <option value="2 Years Post Separation">2 Years Post Separation</option>
                    <option value="3 Years Post Separation">3 Years Post Separation</option>
                    <option value="5 Years Post Separation">5 Years Post Separation</option>
                    <option value="Perpetual (Trade Secrets)">Perpetual (Trade Secrets)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-slate-700 font-bold mb-1">Legal Jurisdiction</label>
                <input
                  type="text"
                  value={ndaJurisdiction}
                  onChange={(e) => setNdaJurisdiction(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 focus:outline-blue-500"
                />
              </div>

              <div className="p-3 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-[11px] font-sans leading-relaxed">
                🛡️ <strong>Legal Covenants:</strong> Covers trade secrets, proprietary algorithms, client lists, customer leads, pricing matrices, source code, and non-solicitation of company personnel.
              </div>
            </div>
          )}

          {/* Quick Actions Footer */}
          <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
            <button
              onClick={() => handlePrint()}
              className="flex-1 px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs shadow-xs transition-colors flex items-center justify-center gap-2 cursor-pointer"
            >
              <Printer className="w-4 h-4" />
              <span>Print / Save as PDF</span>
            </button>
            <button
              onClick={() => {
                if (onSuccessToast) onSuccessToast(`✅ Official ${activeTab.toUpperCase()} document finalized and archived to HR repository!`);
              }}
              className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>Save to Registry</span>
            </button>
          </div>
        </div>

        {/* ========================================================================= */}
        {/* RIGHT COLUMN: LIVE OFFICIAL LETTERHEAD PREVIEW (7 cols) */}
        {/* ========================================================================= */}
        <div className="lg:col-span-7 bg-white rounded-3xl border border-slate-200/90 shadow-md overflow-hidden">
          
          {/* Action Toolbar on Document Header */}
          <div className="bg-slate-50 border-b border-slate-200 px-5 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-xs font-mono font-bold text-slate-700">
                Official Letterhead &bull; {activeTab === 'offer' ? 'Offer Letter' : activeTab === 'experience' ? 'Experience Certificate' : 'Non-Disclosure Agreement'}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => handlePrint()}
                className="px-3 py-1.5 rounded-lg bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 text-xs font-semibold flex items-center gap-1.5 cursor-pointer shadow-2xs"
                title="Print document"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>Print</span>
              </button>
              <button
                onClick={() => {
                  const text = document.getElementById('printable-official-document')?.innerText || '';
                  handleCopyText(text);
                }}
                className="px-3 py-1.5 rounded-lg bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 text-xs font-semibold flex items-center gap-1.5 cursor-pointer shadow-2xs"
                title="Copy all text"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? 'Copied!' : 'Copy'}</span>
              </button>
            </div>
          </div>

          {/* Printable Official Document Body */}
          <div id="printable-official-document" className="p-8 sm:p-10 space-y-6 text-slate-800 text-xs sm:text-sm font-sans leading-relaxed select-text">
            
            {/* Corporate Letterhead Banner */}
            <div className="border-b-2 border-slate-900 pb-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-slate-900 text-white font-bold flex items-center justify-center text-sm">
                    A
                  </div>
                  <h1 className="text-xl sm:text-2xl font-black tracking-tight text-slate-900 font-heading">
                    AMUWA CORPORATION
                  </h1>
                </div>
                <p className="text-[11px] text-slate-500 font-mono mt-0.5">
                  AI Enterprise CRM &bull; Commerce &bull; Global Operations HQ
                </p>
              </div>

              <div className="text-right text-[11px] font-mono text-slate-500 space-y-0.5">
                <div>Corporate Tower, Sector 28, Gurgaon, HR - 122002</div>
                <div>CIN: U72900HR2023PTC109823 &bull; hr@amuwa.com</div>
                <div className="font-bold text-slate-800">www.amuwa.com</div>
              </div>
            </div>

            {/* DOCUMENT 1: OFFICIAL OFFER LETTER */}
            {activeTab === 'offer' && (
              <div className="space-y-5 animate-fade-in">
                <div className="flex items-center justify-between font-mono text-xs text-slate-500">
                  <span>Ref: <strong>{offerRefNumber}</strong></span>
                  <span>Date: <strong>{new Date().toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' })}</strong></span>
                </div>

                <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/80 font-mono text-xs space-y-0.5">
                  <div className="font-bold text-slate-900 text-sm">{offerSalutation} {offerCandidateName}</div>
                  <div>Email: {offerEmail}</div>
                  <div>Phone: {offerPhone}</div>
                  <div>Subject: <strong>Official Letter of Employment Offer</strong></div>
                </div>

                <p>
                  Dear <strong>{offerSalutation} {offerCandidateName}</strong>,
                </p>

                <p>
                  On behalf of <strong>Amuwa Corporation</strong>, we are pleased to extend an offer of employment for the position of <strong>{offerDesignation}</strong> in our <strong>{offerDepartment}</strong>. We were thoroughly impressed by your credentials, domain competence, and enthusiasm during the selection process.
                </p>

                <div className="rounded-2xl border border-slate-200 overflow-hidden font-mono text-xs">
                  <div className="bg-slate-100 p-2.5 font-bold text-slate-800 border-b border-slate-200">
                    Compensation &amp; Appointment Breakdown
                  </div>
                  <div className="divide-y divide-slate-100">
                    <div className="flex justify-between p-2.5">
                      <span className="text-slate-500">Designation / Cadre:</span>
                      <span className="font-bold text-slate-900">{offerDesignation}</span>
                    </div>
                    <div className="flex justify-between p-2.5">
                      <span className="text-slate-500">Department / Division:</span>
                      <span className="font-bold text-slate-900">{offerDepartment}</span>
                    </div>
                    <div className="flex justify-between p-2.5">
                      <span className="text-slate-500">Monthly Compensation (Gross):</span>
                      <span className="font-bold text-slate-900">₹{offerMonthlySalary} /- per month</span>
                    </div>
                    <div className="flex justify-between p-2.5 bg-emerald-50/50">
                      <span className="text-emerald-800 font-semibold">Total Annual Cost to Company (CTC):</span>
                      <span className="font-bold text-emerald-900 text-sm">{annualCtcStr}</span>
                    </div>
                    <div className="flex justify-between p-2.5">
                      <span className="text-slate-500">Official Date of Joining:</span>
                      <span className="font-bold text-slate-900">{offerJoiningDate}</span>
                    </div>
                    <div className="flex justify-between p-2.5">
                      <span className="text-slate-500">Probation Period:</span>
                      <span className="font-bold text-slate-900">{offerProbationMonths} Months</span>
                    </div>
                    <div className="flex justify-between p-2.5">
                      <span className="text-slate-500">Reporting Officer:</span>
                      <span className="font-bold text-slate-900">{offerReportingLead}</span>
                    </div>
                  </div>
                </div>

                <div className="space-y-2 text-[11px] text-slate-600 leading-relaxed font-sans">
                  <h4 className="font-bold text-slate-900 text-xs">Key Terms of Employment:</h4>
                  <p>1. <strong>Working Hours:</strong> Normal business operating hours are Monday through Saturday, 09:30 AM to 06:30 PM.</p>
                  <p>2. <strong>Confidentiality:</strong> You will be bound by the company’s Non-Disclosure Agreement regarding proprietary code, customer records, and commercial strategies.</p>
                  <p>3. <strong>Notice Period:</strong> Following probation confirmation, either party may terminate employment by giving 30 days written notice or gross salary in lieu thereof.</p>
                </div>

                {/* Sign-off & Seal */}
                <div className="pt-8 grid grid-cols-2 gap-8 font-mono text-xs">
                  <div>
                    <div className="font-bold text-slate-900">For Amuwa Corporation</div>
                    <div className="mt-8 pt-2 border-t border-slate-300 w-44">
                      <div className="font-bold">Priya Sharma</div>
                      <div className="text-[10px] text-slate-500">Head of People &amp; Talent Operations</div>
                    </div>
                  </div>

                  <div className="text-right">
                    <div className="font-bold text-slate-900">Candidate Acceptance</div>
                    <div className="mt-8 pt-2 border-t border-slate-300 w-44 ml-auto">
                      <div className="font-bold">{offerCandidateName}</div>
                      <div className="text-[10px] text-slate-500">Signature &bull; Date</div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* DOCUMENT 2: EXPERIENCE CERTIFICATE */}
            {activeTab === 'experience' && (
              <div className="space-y-6 animate-fade-in">
                <div className="flex items-center justify-between font-mono text-xs text-slate-500">
                  <span>Certificate Ref: <strong>{expRefNumber}</strong></span>
                  <span>Date of Issue: <strong>{new Date().toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' })}</strong></span>
                </div>

                <div className="text-center py-3 border-y-2 border-slate-800">
                  <h2 className="text-base sm:text-lg font-black tracking-widest text-slate-900 uppercase">
                    EXPERIENCE &amp; RELIEVING CERTIFICATE
                  </h2>
                  <p className="text-[11px] font-mono text-slate-500 mt-0.5">
                    TO WHOMSOEVER IT MAY CONCERN
                  </p>
                </div>

                <p className="text-justify leading-relaxed">
                  This is to formally certify that <strong>{expEmployeeName}</strong> was employed with <strong>Amuwa Corporation</strong> from <strong>{expJoiningDate}</strong> to <strong>{expRelievingDate}</strong>, completing an active service tenure of <strong>{expTenure}</strong>. At the time of separation, their official designation was <strong>{expDesignation}</strong> in the <strong>{expDepartment}</strong> division.
                </p>

                <p className="text-justify leading-relaxed">
                  During their tenure with our organization, {expEmployeeName} demonstrated sincere dedication, high professional standards, and strong collaborative execution. Their overall performance and moral conduct were evaluated as <strong>{expPerformanceRating}</strong>.
                </p>

                <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-2">
                  <h4 className="font-bold text-slate-900 font-mono text-xs uppercase">No-Dues &amp; Relieving Confirmation</h4>
                  <p className="text-slate-600 text-xs">
                    We hereby confirm that all official financial settlements, handovers, and return of corporate assets have been completed satisfactorily. {expEmployeeName} has been formally relieved from all organizational duties with effect from the close of business hours on <strong>{expRelievingDate}</strong>.
                  </p>
                </div>

                <p>
                  We thank them for their valuable contributions and wish them immense success and growth in all their future personal and professional endeavors.
                </p>

                {/* Seal & Signatory */}
                <div className="pt-10 flex items-center justify-between font-mono text-xs">
                  <div>
                    <div className="w-16 h-16 rounded-full border-2 border-dashed border-purple-400 bg-purple-50 text-purple-700 flex items-center justify-center text-[10px] font-bold rotate-12 mb-2">
                      OFFICIAL SEAL
                    </div>
                    <div className="text-[10px] text-slate-400">Amuwa Corp HR Vault</div>
                  </div>

                  <div className="text-right">
                    <div className="font-bold text-slate-900">For Amuwa Corporation</div>
                    <div className="mt-8 pt-2 border-t border-slate-300 w-48 ml-auto">
                      <div className="font-bold">Authorized Signatory</div>
                      <div className="text-[10px] text-slate-500">Human Resources &amp; People Operations</div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* DOCUMENT 3: NDA AGREEMENT */}
            {activeTab === 'nda' && (
              <div className="space-y-5 animate-fade-in">
                <div className="flex items-center justify-between font-mono text-xs text-slate-500">
                  <span>Agreement Ref: <strong>{ndaRefNumber}</strong></span>
                  <span>Effective Date: <strong>{ndaEffectiveDate}</strong></span>
                </div>

                <div className="text-center py-3 border-y-2 border-slate-800">
                  <h2 className="text-base sm:text-lg font-black tracking-widest text-slate-900 uppercase">
                    MUTUAL NON-DISCLOSURE &amp; CONFIDENTIALITY AGREEMENT
                  </h2>
                </div>

                <p className="text-justify leading-relaxed">
                  This Non-Disclosure Agreement (the "Agreement") is entered into on <strong>{ndaEffectiveDate}</strong> by and between <strong>Amuwa Corporation</strong> ("Disclosing Party"), having its registered corporate office at Corporate Tower, Sector 28, Gurgaon, and <strong>{ndaPartyName}</strong> ("Receiving Party"), engaged in the capacity of <strong>{ndaRole}</strong>.
                </p>

                <div className="space-y-3 text-xs leading-relaxed text-slate-700">
                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                    <strong className="text-slate-900 block font-mono text-xs mb-1">1. Definition of Confidential Information:</strong>
                    <span>"Confidential Information" encompasses all proprietary algorithms, AI models, CRM client databases, WhatsApp business integration code, pricing structures, lead records, and technical trade secrets disclosed by the Disclosing Party.</span>
                  </div>

                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                    <strong className="text-slate-900 block font-mono text-xs mb-1">2. Non-Disclosure &amp; Security Obligations:</strong>
                    <span>The Receiving Party agrees to safeguard Confidential Information with strict care, not disclose it to any unauthorized third party, and strictly refrain from duplicating proprietary data for personal or competing commercial benefit.</span>
                  </div>

                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                    <strong className="text-slate-900 block font-mono text-xs mb-1">3. Duration &amp; Non-Compete Period:</strong>
                    <span>These confidentiality covenants shall remain in full force throughout engagement and for a binding term of <strong>{ndaDurationYears}</strong> following any formal separation.</span>
                  </div>

                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                    <strong className="text-slate-900 block font-mono text-xs mb-1">4. Governing Jurisdiction:</strong>
                    <span>This Agreement is governed strictly under the legal jurisdiction of the courts of <strong>{ndaJurisdiction}</strong>.</span>
                  </div>
                </div>

                {/* Signatures */}
                <div className="pt-8 grid grid-cols-2 gap-8 font-mono text-xs">
                  <div>
                    <div className="font-bold text-slate-900">Disclosing Party (Amuwa Corp)</div>
                    <div className="mt-8 pt-2 border-t border-slate-300 w-48">
                      <div className="font-bold">Legal &amp; Compliance Officer</div>
                      <div className="text-[10px] text-slate-500">Corporate Seal Affixed</div>
                    </div>
                  </div>

                  <div className="text-right">
                    <div className="font-bold text-slate-900">Receiving Party (Acknowledge)</div>
                    <div className="mt-8 pt-2 border-t border-slate-300 w-48 ml-auto">
                      <div className="font-bold">{ndaPartyName}</div>
                      <div className="text-[10px] text-slate-500">{ndaRole}</div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Official Footer Notice */}
            <div className="pt-6 border-t border-slate-200 text-center text-[10px] font-mono text-slate-400">
              Digitally certified by Amuwa Corporate HR &bull; Document hash: SHA256-AMU-{Date.now().toString().slice(-8)}
            </div>

          </div>
        </div>

      </div>
    </div>
  );
};
