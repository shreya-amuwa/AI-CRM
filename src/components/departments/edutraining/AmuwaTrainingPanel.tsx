import React, { useState } from 'react';
import { 
  GraduationCap, UserCheck, Plus, CheckCircle2, Clock, 
  ExternalLink, FileText, Download, Mail, Send, Eye, BookOpen, 
  Star, MessageSquare, Laptop, Share2, HelpCircle, Layers, X, Edit3
} from 'lucide-react';
import { TraineeProgress } from '../../../types/training';
import { INITIAL_TRAINEES } from '../../../data/trainingInitialData';

interface AmuwaTrainingPanelProps {
  onConvertTraineeToEmployee?: (employeeId: string) => void;
}

export const AmuwaTrainingPanel: React.FC<AmuwaTrainingPanelProps> = ({ onConvertTraineeToEmployee }) => {
  // Mode Switcher: Trainee Panel (HR / Trainer View) vs Training Candidate Panel (Candidate View)
  const [activePanel, setActivePanel] = useState<'trainer' | 'candidate'>('trainer');

  // Trainees state
  const [trainees, setTrainees] = useState<TraineeProgress[]>(INITIAL_TRAINEES);
  const [selectedTrainee, setSelectedTrainee] = useState<TraineeProgress>(INITIAL_TRAINEES[0]);

  // Modal States
  const [showAddModal, setShowAddModal] = useState(false);
  const [showPdfModal, setShowPdfModal] = useState(false);
  const [activePdfUrl, setActivePdfUrl] = useState<string>('/docs/amuwa_induction.pdf');
  const [activePdfTitle, setActivePdfTitle] = useState<string>('Official Amuwa Induction PDF Brochure');
  const [showEditFormModal, setShowEditFormModal] = useState(false);

  // Form State for "Enroll New Candidate" (3 Days Total Duration)
  const [candName, setCandName] = useState('');
  const [candDuration, setCandDuration] = useState('3');
  const [assignedTrainer, setAssignedTrainer] = useState('Alexander Wright');

  // Module 4 Google Form Evaluation Quiz URL (Configured to user's exact link)
  const [googleFormUrl, setGoogleFormUrl] = useState<string>(
    'https://docs.google.com/forms/d/e/1FAIpQLScZddVx8e2BNiQ8FyFTeyZYdj3fYpzI7eqd8O7-0DMtRsIfcA/viewform'
  );

  // Candidate Evaluation Form state inside Trainer view
  const [evalScore, setEvalScore] = useState<number>(selectedTrainee?.evaluationScore || 85);
  const [evalFeedback, setEvalFeedback] = useState<string>(selectedTrainee?.trainerFeedback || '');
  const [daysDone, setDaysDone] = useState<number>(selectedTrainee?.daysCompleted || 2);

  // Email Sharing Modal State
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [recipientEmail, setRecipientEmail] = useState(selectedTrainee?.employeeId + '@example.com');
  const [emailSubject, setEmailSubject] = useState('Amuwa Corporation - Official 3-Day Induction Training Access');

  const handleOpenPdf = (url: string, title: string) => {
    setActivePdfUrl(url);
    setActivePdfTitle(title);
    setShowPdfModal(true);
  };

  // Sync selected trainee edits
  const handleSelectTrainee = (t: TraineeProgress) => {
    setSelectedTrainee(t);
    setEvalScore(t.evaluationScore);
    setEvalFeedback(t.trainerFeedback);
    setDaysDone(t.daysCompleted);
    setRecipientEmail(t.traineeName.toLowerCase().replace(/\s+/g, '.') + '@amuwa.com');
  };

  // Trainee-to-Employee Conversion Handler (Synced with HR)
  const handleConvertTrainee = (t: TraineeProgress) => {
    if (onConvertTraineeToEmployee) {
      onConvertTraineeToEmployee(t.employeeId);
    }
    const updated = { ...t, status: 'Converted' as const };
    setTrainees(prev => prev.map(item => item.id === t.id ? updated : item));
    setSelectedTrainee(updated);
    alert(`Success: ${t.traineeName} has completed 3-Day Training & is now confirmed as a Full-Time Employee synced with HR Roster!`);
  };

  // Save Trainer Evaluation & Feedback
  const handleSaveEvaluation = (e: React.FormEvent) => {
    e.preventDefault();
    const updated = {
      ...selectedTrainee,
      evaluationScore: evalScore,
      trainerFeedback: evalFeedback,
      daysCompleted: daysDone,
      progressPercentage: Math.round((daysDone / selectedTrainee.totalDays) * 100)
    };

    setTrainees(prev => prev.map(t => t.id === updated.id ? updated : t));
    setSelectedTrainee(updated);
    alert(`Evaluation saved for ${updated.traineeName}!`);
  };

  // Enroll New Candidate Submit (3-Day Duration)
  const handleEnrollSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!candName) return;

    const newTrainee: TraineeProgress = {
      id: `TRN-${Date.now()}`,
      employeeId: `EMP-${Math.floor(1000 + Math.random() * 9000)}`,
      traineeName: candName,
      designation: 'Training Candidate',
      track: 'Corporate Induction',
      startDate: new Date().toISOString().split('T')[0],
      targetEndDate: new Date(Date.now() + 1000 * 60 * 60 * 24 * Number(candDuration)).toISOString().split('T')[0],
      daysCompleted: 1,
      totalDays: Number(candDuration),
      progressPercentage: 33,
      currentModule: 'Day 1: Website & Products Analysis',
      evaluationScore: 75,
      trainerName: assignedTrainer,
      trainerFeedback: 'Onboarded for 3-Day Candidate Training Program.',
      status: 'In-Training',
      modules: []
    };

    setTrainees(prev => [newTrainee, ...prev]);
    setSelectedTrainee(newTrainee);
    setShowAddModal(false);
    setCandName('');
  };

  // Send Direct Gmail Mailto Link
  const handleSendGmail = () => {
    const body = `Dear ${selectedTrainee.traineeName},\n\nWelcome to Amuwa Corporation Official 3-Day Induction Training Program!\n\nPlease access your training modules below:\n\n1. Company Websites & Official Induction PDF (Day 1):\n• https://amuwa.com\n• https://amuwacorporation.com\n• Official Induction PDF: http://localhost:3000/docs/amuwa_induction.pdf\n\n2. Assigned Trainer (Day 2 Briefing): ${selectedTrainee.trainerName}\n\n3. Evaluation Quiz Google Form (Day 3):\n${googleFormUrl}\n\nBest Regards,\nHR Team - Amuwa Corporation`;
    
    const mailtoUrl = `mailto:${recipientEmail}?subject=${encodeURIComponent(emailSubject)}&body=${encodeURIComponent(body)}`;
    window.open(mailtoUrl, '_blank');
    setShowEmailModal(false);
  };

  return (
    <div className="space-y-6 animate-fade-in">
      
      {/* Top Panel Navigation Bar - Pure Bright Style */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-6 rounded-3xl bg-white text-slate-900 border border-slate-200 shadow-sm">
        <div className="flex items-center gap-3">
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
            <p className="text-xs font-mono text-slate-500">Switch between Trainer Evaluation Panel &amp; Candidate 3-Day Modules</p>
          </div>
        </div>

        {/* 2 PANELS TOGGLE */}
        <div className="bg-slate-100 p-1.5 rounded-2xl border border-slate-200 flex items-center gap-1.5 shrink-0">
          <button
            onClick={() => setActivePanel('trainer')}
            className={`px-4 py-2 rounded-xl text-xs font-mono font-bold transition-all flex items-center gap-2 ${
              activePanel === 'trainer'
                ? 'bg-amber-600 text-white shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <UserCheck className="w-4 h-4" />
            <span>1. Trainee Panel (Trainer View)</span>
          </button>

          <button
            onClick={() => setActivePanel('candidate')}
            className={`px-4 py-2 rounded-xl text-xs font-mono font-bold transition-all flex items-center gap-2 ${
              activePanel === 'candidate'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <BookOpen className="w-4 h-4" />
            <span>2. 3-Day Candidate Panel</span>
          </button>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* PANEL 1: TRAINEE PANEL (TRAINER / HR EVALUATION VIEW WITH CONVERSION ACTION) */}
      {/* ========================================================================= */}
      {activePanel === 'trainer' && (
        <div className="space-y-6 animate-fade-in">
          
          {/* Top Banner Bar with Enroll Button */}
          <div className="flex items-center justify-between bg-amber-50 p-4 rounded-2xl border border-amber-200">
            <div>
              <h3 className="text-sm font-bold text-amber-950 font-heading">Trainer &amp; Evaluation Desk (3-Day Program)</h3>
              <p className="text-xs text-amber-800">Enroll new candidates, assign trainers, score evaluations, provide feedback, and confirm employee conversions after 3 days.</p>
            </div>

            <button
              onClick={() => setShowAddModal(true)}
              className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-mono font-bold flex items-center gap-1.5 shadow-md active:scale-95"
            >
              <Plus className="w-4 h-4" />
              <span>Enroll New Candidate</span>
            </button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            
            {/* Left Column: List of Training Candidates */}
            <div className="space-y-3">
              <h4 className="text-xs font-mono font-bold text-slate-500 uppercase">Training Candidates Roster ({trainees.length})</h4>

              <div className="space-y-3">
                {trainees.map(t => (
                  <div
                    key={t.id}
                    onClick={() => handleSelectTrainee(t)}
                    className={`p-4 rounded-2xl border transition-all cursor-pointer ${
                      selectedTrainee?.id === t.id
                        ? 'bg-amber-50/80 border-amber-400 shadow-md ring-2 ring-amber-400/30'
                        : 'bg-white border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <h5 className="font-bold text-slate-900 text-sm">{t.traineeName}</h5>
                        <p className="text-[11px] font-mono text-slate-500">Assigned: {t.trainerName}</p>
                      </div>

                      <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold border ${
                        t.status === 'Converted'
                          ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                          : 'bg-amber-100 text-amber-900 border-amber-300'
                      }`}>
                        {t.status === 'Converted' ? 'Employee' : `Score: ${t.evaluationScore}/100`}
                      </span>
                    </div>

                    <div className="mt-3 flex items-center justify-between text-[11px] font-mono text-slate-600">
                      <span>Days Completed: <strong>{t.daysCompleted}/3 Days</strong></span>
                      <span className="text-amber-700 font-bold">{t.progressPercentage}%</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Right Column: Selected Candidate Profile, Conversion Action & Trainer Evaluation */}
            {selectedTrainee ? (
              <div className="lg:col-span-2 bg-white rounded-3xl border border-slate-200 p-6 shadow-sm space-y-6">
                
                {/* Profile Header & HR Conversion Sync Button */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-slate-100 pb-4 gap-4">
                  <div>
                    <h3 className="text-xl font-bold font-heading text-slate-900">{selectedTrainee.traineeName}</h3>
                    <p className="text-xs font-mono text-slate-500 mt-0.5">
                      Assigned Trainer: <strong>{selectedTrainee.trainerName}</strong> &bull; Training Duration: <strong>Total 3 Days</strong>
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {/* CONVERSION BUTTON SYNCED WITH HR */}
                    {selectedTrainee.status !== 'Converted' ? (
                      <button
                        type="button"
                        onClick={() => handleConvertTrainee(selectedTrainee)}
                        className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-mono font-bold text-xs flex items-center gap-1.5 shadow-md transition-all active:scale-95"
                      >
                        <CheckCircle2 className="w-4 h-4" />
                        <span>CONFIRM &amp; CONVERT TO EMPLOYEE</span>
                      </button>
                    ) : (
                      <span className="px-3.5 py-1.5 rounded-xl bg-emerald-50 text-emerald-800 border border-emerald-200 font-mono font-bold text-xs flex items-center gap-1.5">
                        <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                        <span>Converted to Full-Time Employee (Synced with HR)</span>
                      </span>
                    )}

                    {/* Send Gmail Button */}
                    <button
                      type="button"
                      onClick={() => setShowEmailModal(true)}
                      className="px-3.5 py-2 rounded-xl bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 font-mono font-bold text-xs flex items-center gap-1.5 shadow-2xs"
                    >
                      <Mail className="w-3.5 h-3.5" />
                      <span>Gmail Link</span>
                    </button>
                  </div>
                </div>

                {/* Trainer Evaluation Inputs Form */}
                <form onSubmit={handleSaveEvaluation} className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    
                    {/* Evaluation Score Input */}
                    <div className="p-4 rounded-2xl bg-amber-50/60 border border-amber-200 space-y-1.5">
                      <label className="block text-[11px] font-bold text-amber-900 font-mono uppercase flex items-center gap-1.5">
                        <Star className="w-4 h-4 text-amber-500 fill-amber-400" />
                        <span>Evaluation Score (out of 100)</span>
                      </label>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={evalScore}
                        onChange={e => setEvalScore(Number(e.target.value))}
                        className="w-full p-2.5 bg-white border border-amber-300 rounded-xl font-mono text-lg font-bold text-slate-900"
                      />
                    </div>

                    {/* Days of Completion Input */}
                    <div className="p-4 rounded-2xl bg-blue-50/60 border border-blue-200 space-y-1.5">
                      <label className="block text-[11px] font-bold text-blue-900 font-mono uppercase flex items-center gap-1.5">
                        <Clock className="w-4 h-4 text-blue-600" />
                        <span>Days of Completion</span>
                      </label>
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          min={1}
                          max={3}
                          value={daysDone}
                          onChange={e => setDaysDone(Number(e.target.value))}
                          className="w-full p-2.5 bg-white border border-blue-300 rounded-xl font-mono text-lg font-bold text-slate-900"
                        />
                        <span className="text-xs font-mono text-slate-500 font-bold shrink-0">/ 3 Days</span>
                      </div>
                    </div>

                  </div>

                  {/* Candidate Feedback Input */}
                  <div className="space-y-1.5">
                    <label className="block text-[11px] font-bold text-slate-700 font-mono uppercase flex items-center gap-1.5">
                      <MessageSquare className="w-4 h-4 text-slate-600" />
                      <span>Trainer Feedback for Candidate *</span>
                    </label>
                    <textarea
                      rows={4}
                      required
                      placeholder="Enter trainer feedback, strengths, and areas for candidate improvement..."
                      value={evalFeedback}
                      onChange={e => setEvalFeedback(e.target.value)}
                      className="w-full p-3 bg-slate-50 border border-slate-200 rounded-2xl text-xs text-slate-900 focus:outline-none focus:bg-white"
                    />
                  </div>

                  <div className="flex justify-end pt-2">
                    <button
                      type="submit"
                      className="px-6 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-mono font-bold text-xs shadow-md active:scale-95"
                    >
                      Save Trainer Evaluation &amp; Feedback
                    </button>
                  </div>
                </form>

              </div>
            ) : null}

          </div>

        </div>
      )}

      {/* ========================================================================= */}
      {/* PANEL 2: TRAINING CANDIDATE PANEL (3-DAY INDUCTION LEARNING MODULES VIEW) */}
      {/* ========================================================================= */}
      {activePanel === 'candidate' && (
        <div className="space-y-6 animate-fade-in">
          
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
                  Analyze Amuwa Corporation’s official web portals and read the Official Induction PDF Brochure.
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
                  onClick={() => handleOpenPdf('/docs/amuwa_induction.pdf', 'Official Amuwa Induction PDF Brochure')}
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
                  <span className="font-bold text-slate-900 block">{selectedTrainee?.trainerName || 'Alexander Wright'}</span>
                </div>
              </div>

              <div className="pt-2">
                <div className="w-full py-2.5 rounded-xl bg-amber-100 text-amber-900 border border-amber-300 font-mono font-bold text-xs text-center">
                  Session Conducted by {selectedTrainee?.trainerName || 'Trainer'}
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
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setShowEditFormModal(true)}
                      className="p-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600"
                      title="Edit Google Form Link"
                    >
                      <Edit3 className="w-4 h-4" />
                    </button>
                    <HelpCircle className="w-5 h-5 text-purple-600" />
                  </div>
                </div>

                <h4 className="text-lg font-bold font-heading text-slate-900">Evaluation Quiz &amp; Q/N Google Form</h4>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Complete the official Google Form evaluation quiz to test your understanding of company products, websites, and operational workflows.
                </p>

                <div className="p-3 bg-purple-50/50 border border-purple-200 rounded-2xl text-xs font-mono text-purple-950">
                  <strong className="block">Official Google Form Quiz Link:</strong>
                  <a
                    href={googleFormUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-purple-600 underline font-bold truncate block mt-0.5"
                  >
                    {googleFormUrl}
                  </a>
                </div>
              </div>

              <div className="pt-2">
                <a
                  href={googleFormUrl}
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

        </div>
      )}

      {/* MODAL: IN-APP PDF VIEWER LIGHTBOX MODAL FOR OFFICIAL INDUCTION BROCHURE */}
      {showPdfModal && (
        <div className="fixed inset-0 z-60 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-4xl h-[85vh] bg-white rounded-3xl overflow-hidden border border-slate-200 shadow-2xl flex flex-col">
            <div className="p-4 bg-slate-900 text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-emerald-400" />
                <span className="font-bold text-sm font-heading">{activePdfTitle}</span>
              </div>

              <div className="flex items-center gap-2">
                <a
                  href={activePdfUrl}
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
                src={activePdfUrl}
                className="w-full h-full border-0"
                title="Official Amuwa Induction PDF Brochure"
              />
            </div>
          </div>
        </div>
      )}

      {/* MODAL: EDIT GOOGLE FORM LINK */}
      {showEditFormModal && (
        <div className="fixed inset-0 z-60 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white rounded-3xl p-6 border border-slate-200 shadow-2xl space-y-4">
            <h3 className="text-lg font-bold font-heading text-slate-900">Configure Evaluation Google Form Link</h3>
            <p className="text-xs text-slate-500 font-mono">Paste the official evaluation Google Form URL for candidates to complete Day 3.</p>

            <div className="space-y-3">
              <input
                type="url"
                required
                placeholder="https://docs.google.com/forms/..."
                value={googleFormUrl}
                onChange={e => setGoogleFormUrl(e.target.value)}
                className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono text-slate-900"
              />

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowEditFormModal(false)}
                  className="w-1/2 py-2 rounded-xl bg-slate-100 text-slate-700 text-xs font-mono"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowEditFormModal(false);
                    alert('Google Form Quiz link updated successfully!');
                  }}
                  className="w-1/2 py-2 rounded-xl bg-purple-600 text-white font-mono font-bold text-xs shadow-sm"
                >
                  Save Form Link
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: ENROLL NEW CANDIDATE (3 DAYS) */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white rounded-3xl p-6 border border-slate-200 shadow-2xl animate-scale-up space-y-4">
            <h3 className="text-lg font-bold font-heading text-slate-900">Enroll New Candidate for 3-Day Training</h3>

            <form onSubmit={handleEnrollSubmit} className="space-y-3 text-xs">
              <div>
                <label className="block text-[10px] font-bold text-slate-700 font-mono uppercase mb-1">CANDIDATE FULL NAME *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Sameer Kulkarni"
                  value={candName}
                  onChange={e => setCandName(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-700 font-mono uppercase mb-1">TRAINING DURATION (DAYS)</label>
                <input
                  type="number"
                  value={candDuration}
                  onChange={e => setCandDuration(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-mono"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-700 font-mono uppercase mb-1">ASSIGNED TRAINER NAME</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Alexander Wright"
                  value={assignedTrainer}
                  onChange={e => setAssignedTrainer(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="w-1/2 py-2 rounded-xl bg-slate-100 text-slate-700 font-mono"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="w-1/2 py-2 rounded-xl bg-amber-600 text-white font-mono font-bold shadow-sm"
                >
                  Enroll Candidate
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: DIRECT GMAIL EMAIL SHARING MODAL */}
      {showEmailModal && (
        <div className="fixed inset-0 z-60 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white rounded-3xl p-6 border border-slate-200 shadow-2xl animate-scale-up space-y-4">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-xl bg-blue-50 text-blue-600">
                <Mail className="w-5 h-5" />
              </div>
              <h3 className="text-lg font-bold font-heading text-slate-900">Send Module Link via Gmail</h3>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-[10px] font-bold text-slate-700 font-mono uppercase mb-1">CANDIDATE GMAIL ADDRESS</label>
                <input
                  type="email"
                  required
                  value={recipientEmail}
                  onChange={e => setRecipientEmail(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-mono"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-700 font-mono uppercase mb-1">EMAIL SUBJECT</label>
                <input
                  type="text"
                  value={emailSubject}
                  onChange={e => setEmailSubject(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                />
              </div>

              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-[11px] font-mono text-slate-600 space-y-1">
                <span className="font-bold text-slate-900 block">Links Included in Email:</span>
                <div>• Day 1: Websites &amp; Official Induction PDF Brochure</div>
                <div>• Day 2: Assigned Trainer Briefing ({selectedTrainee.trainerName})</div>
                <div>• Day 3: Evaluation Quiz ({googleFormUrl})</div>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowEmailModal(false)}
                  className="w-1/2 py-2 rounded-xl bg-slate-100 text-slate-700 font-mono"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSendGmail}
                  className="w-1/2 py-2 rounded-xl bg-blue-600 text-white font-mono font-bold flex items-center justify-center gap-1.5 shadow-sm"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>Launch Gmail</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
