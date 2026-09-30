import React, { useMemo, useState } from 'react';
import {
  GraduationCap, Laptop, UserCheck, HelpCircle, ExternalLink,
  FileText, Download, X
} from 'lucide-react';
import { AmuwaLogo } from '../common/AmuwaLogo';
import { INITIAL_TRAINEES } from '../../data/trainingInitialData';
import { TraineeProgress } from '../../types/training';

// Same Google Form link used in the Trainer & Evaluation Desk (Day 3 quiz).
const GOOGLE_FORM_URL =
  'https://docs.google.com/forms/d/e/1FAIpQLScZddVx8e2BNiQ8FyFTeyZYdj3fYpzI7eqd8O7-0DMtRsIfcA/viewform';

/**
 * Standalone Candidate Training Portal.
 *
 * This page is intentionally NOT wrapped in AuthProvider / Sidebar / Header.
 * It is served at a dedicated URL (/candidate) so a training candidate /
 * new joinee can open their 3-Day Induction modules directly via the link
 * sent to them, without needing a staff CRM login.
 *
 * It renders the exact same "3-Day Candidate Panel" content that lives
 * inside Education & Training \u2192 Candidate Training \u2192 "2. 3-Day Candidate
 * Panel" tab (AmuwaTrainingPanel.tsx), just outside the locked staff app.
 */
export const CandidatePortal: React.FC = () => {
  // Support deep-linking a specific candidate via ?id=EMP-1003 or ?name=Rohan%20Mehta
  const initialTrainee = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('id');
    const name = params.get('name');
    if (id) {
      const byId = INITIAL_TRAINEES.find(t => t.employeeId.toLowerCase() === id.toLowerCase());
      if (byId) return byId;
    }
    if (name) {
      const byName = INITIAL_TRAINEES.find(
        t => t.traineeName.toLowerCase() === name.toLowerCase()
      );
      if (byName) return byName;
    }
    return INITIAL_TRAINEES[0];
  }, []);

  const [selectedTrainee, setSelectedTrainee] = useState<TraineeProgress>(initialTrainee);
  const [showTraineePicker, setShowTraineePicker] = useState(false);
  const [showPdfModal, setShowPdfModal] = useState(false);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans">
      {/* Lightweight standalone header \u2014 no sidebar, no staff login */}
      <div className="bg-white border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
          <AmuwaLogo size="sm" />
          <div className="flex items-center gap-3">
            <div className="text-right hidden sm:block">
              <div className="text-sm font-bold text-slate-900">{selectedTrainee.traineeName}</div>
              <div className="text-[11px] font-mono text-slate-500">{selectedTrainee.designation}</div>
            </div>
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowTraineePicker(v => !v)}
                className="w-9 h-9 rounded-full bg-blue-600 text-white font-bold flex items-center justify-center text-sm"
                title="Switch candidate (demo only)"
              >
                {selectedTrainee.traineeName.charAt(0)}
              </button>
              {showTraineePicker && (
                <div className="absolute right-0 mt-2 w-56 bg-white border border-slate-200 rounded-2xl shadow-xl p-2 z-50">
                  {INITIAL_TRAINEES.map(t => (
                    <button
                      key={t.id}
                      onClick={() => {
                        setSelectedTrainee(t);
                        setShowTraineePicker(false);
                      }}
                      className={`w-full text-left px-3 py-2 rounded-xl text-xs font-mono ${
                        t.id === selectedTrainee.id
                          ? 'bg-blue-50 text-blue-800 font-bold'
                          : 'text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      {t.traineeName}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">

        {/* Title banner \u2014 same copy/style as the in-app Candidate Panel */}
        <div className="flex items-center gap-3 p-6 rounded-3xl bg-white border border-slate-200 shadow-sm">
          <div className="p-3 rounded-2xl bg-amber-100 text-amber-800 border border-amber-300">
            <GraduationCap className="w-7 h-7" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-bold font-heading text-slate-900">3-Day Induction Training Center</h2>
              <span className="px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-900 text-[10px] font-mono font-bold border border-amber-300">
                TOTAL 3 DAYS
              </span>
            </div>
            <p className="text-xs font-mono text-slate-500">Welcome, {selectedTrainee.traineeName} \u2014 complete your 3-day modules below.</p>
          </div>
        </div>

        {/* Same content as PANEL 2 in AmuwaTrainingPanel.tsx */}
        <div className="bg-blue-50 border border-blue-200 text-slate-900 p-6 rounded-3xl shadow-sm space-y-2">
          <span className="px-3 py-1 rounded-full bg-blue-100 text-blue-800 border border-blue-300 text-[10px] font-mono font-bold uppercase">
            OFFICIAL 3-DAY INDUCTION PROGRAM
          </span>
          <h3 className="text-2xl font-bold font-heading text-slate-900">Amuwa Corporation 3-Day Training Modules</h3>
          <p className="text-xs text-slate-600 font-mono">Complete the 3-day learning modules below and submit your final Google Form evaluation quiz.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">

          {/* DAY 1: WEBSITE & OFFICIAL INDUCTION PDF BROCHURE */}
          <div className="p-6 rounded-3xl bg-white border border-slate-200 shadow-sm space-y-4 flex flex-col justify-between hover:shadow-md transition-shadow">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="px-3 py-1 rounded-full bg-blue-50 text-blue-700 border border-blue-200 text-xs font-mono font-bold">
                  DAY 1
                </span>
                <Laptop className="w-5 h-5 text-blue-600" />
              </div>

              <h4 className="text-lg font-bold font-heading text-slate-900">Website &amp; Official Induction PDF Analysis</h4>
              <p className="text-xs text-slate-600 leading-relaxed">
                Analyze Amuwa Corporation's official web portals and read the Official Induction PDF Brochure.
              </p>

              <div className="p-3 bg-slate-50 border border-slate-200 rounded-2xl space-y-2 text-xs font-mono">
                <div className="flex items-center justify-between">
                  <span className="text-slate-700 font-bold">amuwa.com:</span>
                  <a href="https://amuwa.com" target="_blank" rel="noopener noreferrer" className="text-blue-600 underline font-bold">
                    Visit &rarr;
                  </a>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-700 font-bold">amuwacorporation.com:</span>
                  <a href="https://amuwacorporation.com" target="_blank" rel="noopener noreferrer" className="text-blue-600 underline font-bold">
                    Visit &rarr;
                  </a>
                </div>
              </div>

              {/* Attached Induction PDF File Card */}
              <div className="p-3 bg-emerald-50/70 border border-emerald-200 rounded-2xl text-xs font-mono text-emerald-950 flex items-center justify-between">
                <div>
                  <strong className="block text-emerald-900">Official Induction PDF:</strong>
                  <span className="text-[11px] text-emerald-700">amuwa_induction.pdf</span>
                </div>
                <FileText className="w-6 h-6 text-emerald-600 shrink-0" />
              </div>
            </div>

            <div className="pt-2">
              <button
                type="button"
                onClick={() => setShowPdfModal(true)}
                className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-mono font-bold text-xs flex items-center justify-center gap-1.5 shadow-sm active:scale-95 transition-transform"
              >
                <FileText className="w-4 h-4" />
                <span>View Official Induction PDF</span>
              </button>
            </div>
          </div>

          {/* DAY 2: BRIEFING OF COMPANY BY ASSIGNED TRAINER */}
          <div className="p-6 rounded-3xl bg-white border border-slate-200 shadow-sm space-y-4 flex flex-col justify-between hover:shadow-md transition-shadow">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="px-3 py-1 rounded-full bg-amber-50 text-amber-800 border border-amber-200 text-xs font-mono font-bold">
                  DAY 2
                </span>
                <UserCheck className="w-5 h-5 text-amber-600" />
              </div>

              <h4 className="text-lg font-bold font-heading text-slate-900">Briefing of Company by Assigned Trainer</h4>
              <p className="text-xs text-slate-600 leading-relaxed">
                Interactive briefing session conducted by your assigned trainer covering internal hierarchy, daily lead status logging, and client SLA expectations.
              </p>

              <div className="p-3 bg-amber-50/50 border border-amber-200 rounded-2xl text-xs space-y-1">
                <span className="font-mono text-[10px] text-amber-800 font-bold uppercase block">Your Assigned Trainer:</span>
                <span className="font-bold text-slate-900 block">{selectedTrainee.trainerName}</span>
              </div>
            </div>

            <div className="pt-2">
              <div className="w-full py-2.5 rounded-xl bg-amber-100 text-amber-900 border border-amber-300 font-mono font-bold text-xs text-center">
                Session Conducted by {selectedTrainee.trainerName}
              </div>
            </div>
          </div>

          {/* DAY 3: EVALUATION QUIZ GOOGLE FORM */}
          <div className="p-6 rounded-3xl bg-white border border-slate-200 shadow-sm space-y-4 flex flex-col justify-between hover:shadow-md transition-shadow">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="px-3 py-1 rounded-full bg-purple-50 text-purple-800 border border-purple-200 text-xs font-mono font-bold">
                  DAY 3
                </span>
                <HelpCircle className="w-5 h-5 text-purple-600" />
              </div>

              <h4 className="text-lg font-bold font-heading text-slate-900">Evaluation Quiz &amp; Q/N Google Form</h4>
              <p className="text-xs text-slate-600 leading-relaxed">
                Complete the official Google Form evaluation quiz to test your understanding of company products, websites, and operational workflows.
              </p>

              <div className="p-3 bg-purple-50/50 border border-purple-200 rounded-2xl text-xs font-mono text-purple-950">
                <strong className="block">Official Google Form Quiz Link:</strong>
                <a
                  href={GOOGLE_FORM_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-purple-600 underline font-bold truncate block mt-0.5"
                >
                  {GOOGLE_FORM_URL}
                </a>
              </div>
            </div>

            <div className="pt-2">
              <a
                href={GOOGLE_FORM_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full py-2.5 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-mono font-bold text-xs flex items-center justify-center gap-1.5 shadow-sm active:scale-95 transition-transform"
              >
                <ExternalLink className="w-4 h-4" />
                <span>Open Day 3 Evaluation Quiz Google Form</span>
              </a>
            </div>
          </div>

        </div>

        {/* Progress footer */}
        <div className="p-5 rounded-3xl bg-white border border-slate-200 shadow-sm flex items-center justify-between text-xs font-mono text-slate-600">
          <span>Days Completed: <strong className="text-slate-900">{selectedTrainee.daysCompleted}/{selectedTrainee.totalDays} Days</strong></span>
          <span className="text-amber-700 font-bold">{selectedTrainee.progressPercentage}% Complete</span>
        </div>
      </div>

      {/* MODAL: IN-APP PDF VIEWER (same as staff Trainer view) */}
      {showPdfModal && (
        <div className="fixed inset-0 z-60 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-4xl h-[85vh] bg-white rounded-3xl overflow-hidden border border-slate-200 shadow-2xl flex flex-col">
            <div className="p-4 bg-slate-900 text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-emerald-400" />
                <span className="font-bold text-sm font-heading">Official Amuwa Induction PDF Brochure</span>
              </div>

              <div className="flex items-center gap-2">
                <a
                  href="/docs/amuwa_induction.pdf"
                  download="Amuwa_Official_Induction.pdf"
                  className="px-3 py-1 rounded-xl bg-emerald-600 text-white text-xs font-mono font-bold flex items-center gap-1"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download PDF</span>
                </a>
                <button
                  onClick={() => setShowPdfModal(false)}
                  className="p-1 rounded-xl hover:bg-slate-800 text-slate-400 hover:text-white"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="flex-1 bg-slate-100">
              <iframe
                src="/docs/amuwa_induction.pdf"
                className="w-full h-full border-0"
                title="Official Amuwa Induction PDF Brochure"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CandidatePortal;
