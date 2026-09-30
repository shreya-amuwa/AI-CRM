import React, { useState } from 'react';
import { X, FileText, CheckCircle2, Download, Send, Sparkles } from 'lucide-react';
import { OfferLetter } from '../../../types/amuwaHq';

interface OfferLetterModalProps {
  onClose: () => void;
  onIssueOfferLetter: (offer: OfferLetter) => void;
}

export const OfferLetterModal: React.FC<OfferLetterModalProps> = ({ onClose, onIssueOfferLetter }) => {
  const [candidateName, setCandidateName] = useState('');
  const [candidateEmail, setCandidateEmail] = useState('');
  const [candidatePhone, setCandidatePhone] = useState('');
  const [designation, setDesignation] = useState('Business Development Manager');
  const [departmentName, setDepartmentName] = useState('Amuwa Corporation');
  const [monthlySalary, setMonthlySalary] = useState('₹65,000');
  const [annualCTC, setAnnualCTC] = useState('₹7.8 LPA');
  const [joiningDate, setJoiningDate] = useState('2026-09-01');
  const [workingHours, setWorkingHours] = useState('09:30 AM - 06:30 PM (Mon-Sat)');

  const [isPreviewMode, setIsPreviewMode] = useState(false);

  const handleGenerate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!candidateName || !candidateEmail) return;

    const newOffer: OfferLetter = {
      id: `OFF-2026-${Math.floor(10 + Math.random() * 90)}`,
      candidateName,
      candidateEmail,
      candidatePhone: candidatePhone || '+91 98765 43210',
      designation,
      departmentName,
      monthlySalary,
      annualCTC,
      joiningDate,
      workingHours,
      generatedAt: new Date().toISOString(),
      status: 'Issued'
    };

    onIssueOfferLetter(newOffer);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-2xl bg-white border border-slate-200 rounded-3xl shadow-2xl overflow-hidden animate-scale-up max-h-[90vh] flex flex-col">
        
        {/* Header */}
        <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-red-50 text-red-600 border border-red-100">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-bold font-heading text-slate-900">Offer Letter Automation</h3>
              <p className="text-xs text-slate-500 font-mono">HR Automated Candidate Letter Generator</p>
            </div>
          </div>

          <button onClick={onClose} className="p-1.5 rounded-xl text-slate-400 hover:bg-slate-200 text-slate-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto flex-1 space-y-4">
          
          {!isPreviewMode ? (
            /* Form Mode */
            <form id="offerForm" onSubmit={handleGenerate} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1 font-mono uppercase">
                    CANDIDATE FULL NAME *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Vikram Sharma"
                    value={candidateName}
                    onChange={e => setCandidateName(e.target.value)}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-none focus:border-red-500 focus:bg-white font-sans"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1 font-mono uppercase">
                    CANDIDATE EMAIL *
                  </label>
                  <input
                    type="email"
                    required
                    placeholder="vikram.s@example.com"
                    value={candidateEmail}
                    onChange={e => setCandidateEmail(e.target.value)}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-none focus:border-red-500 focus:bg-white font-sans"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1 font-mono uppercase">
                    PHONE NUMBER
                  </label>
                  <input
                    type="text"
                    placeholder="+91 98765 43210"
                    value={candidatePhone}
                    onChange={e => setCandidatePhone(e.target.value)}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-none focus:border-red-500 focus:bg-white font-sans"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1 font-mono uppercase">
                    DESIGNATION / ROLE *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Senior Operations Executive"
                    value={designation}
                    onChange={e => setDesignation(e.target.value)}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-none focus:border-red-500 focus:bg-white font-sans"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1 font-mono uppercase">
                    MONTHLY SALARY
                  </label>
                  <input
                    type="text"
                    value={monthlySalary}
                    onChange={e => setMonthlySalary(e.target.value)}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-none focus:border-red-500 focus:bg-white font-sans"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1 font-mono uppercase">
                    ANNUAL CTC
                  </label>
                  <input
                    type="text"
                    value={annualCTC}
                    onChange={e => setAnnualCTC(e.target.value)}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-none focus:border-red-500 focus:bg-white font-sans"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1 font-mono uppercase">
                    WORKING HOURS / TIMINGS
                  </label>
                  <input
                    type="text"
                    value={workingHours}
                    onChange={e => setWorkingHours(e.target.value)}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-none focus:border-red-500 focus:bg-white font-mono"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1 font-mono uppercase">
                    JOINING DATE
                  </label>
                  <input
                    type="date"
                    value={joiningDate}
                    onChange={e => setJoiningDate(e.target.value)}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-none focus:border-red-500 focus:bg-white font-sans"
                  />
                </div>
              </div>
            </form>
          ) : (
            /* Document Preview Mode */
            <div className="p-6 bg-slate-50 border border-slate-200 rounded-2xl space-y-4 font-sans text-slate-800 text-xs shadow-inner">
              <div className="border-b border-slate-200 pb-3 flex items-center justify-between">
                <div>
                  <h4 className="text-lg font-bold font-heading text-red-600 tracking-tight">AMUWA CORPORATION</h4>
                  <p className="text-[10px] font-mono text-slate-400">Corporate Headquarters & Enterprise Group</p>
                </div>
                <span className="font-mono text-[10px] bg-slate-200 px-2 py-1 rounded">OFFER REF: OFF-2026-AUTO</span>
              </div>

              <div className="space-y-2">
                <p><strong>Date:</strong> {new Date().toLocaleDateString()}</p>
                <p><strong>To:</strong> {candidateName || 'Candidate Name'}</p>
                <p><strong>Email:</strong> {candidateEmail || 'candidate@example.com'}</p>
              </div>

              <p className="leading-relaxed">
                Dear <strong>{candidateName || 'Candidate'}</strong>,<br />
                We are pleased to offer you the position of <strong>{designation}</strong> with <strong>{departmentName}</strong>. 
                Your joining date is scheduled for <strong>{joiningDate}</strong>.
              </p>

              <div className="p-3 bg-white border border-slate-200 rounded-xl font-mono text-[11px] space-y-1">
                <div className="flex justify-between"><span>Monthly Salary:</span><strong className="text-slate-900">{monthlySalary}</strong></div>
                <div className="flex justify-between"><span>Annual CTC:</span><strong className="text-red-600">{annualCTC}</strong></div>
                <div className="flex justify-between"><span>Working Hours:</span><strong className="text-blue-600">{workingHours}</strong></div>
              </div>

              <p className="text-[11px] text-slate-500 italic">
                This letter is generated automatically by Amuwa Corporation HR Automation Engine.
              </p>
            </div>
          )}

        </div>

        {/* Footer Controls */}
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
          <button
            type="button"
            onClick={() => setIsPreviewMode(!isPreviewMode)}
            className="px-4 py-2 rounded-xl bg-white border border-slate-200 text-slate-700 text-xs font-mono font-medium hover:bg-slate-100 flex items-center gap-1.5"
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-500" />
            <span>{isPreviewMode ? 'Edit Details' : 'Preview Letter'}</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-white border border-slate-200 text-slate-600 text-xs font-medium hover:bg-slate-100"
            >
              Cancel
            </button>
            
            <button
              type="submit"
              form="offerForm"
              className="px-5 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-semibold font-mono flex items-center gap-1.5 shadow-md active:scale-95"
            >
              <Send className="w-3.5 h-3.5" />
              <span>Issue Offer Letter</span>
            </button>
          </div>
        </div>

      </div>
    </div>
  );
};
