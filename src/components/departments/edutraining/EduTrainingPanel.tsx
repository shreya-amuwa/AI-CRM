import React, { useState } from 'react';
import {
  GraduationCap, BookOpen, ArrowRight, ArrowLeft, Users, X, Sparkles
} from 'lucide-react';
import { ActiveTab } from '../../layout/Sidebar';
import { AmuwaTrainingPanel } from './AmuwaTrainingPanel';

type EduSubDept = 'sales' | 'support' | 'education_training' | 'product_training' | null;

interface EduTrainingPanelProps {
  activeTab: ActiveTab;
  onSelectTab?: (tab: ActiveTab) => void;
  onNavigateToLeads: () => void;
  subDept: EduSubDept;
  onSelectSubDept: (subDept: EduSubDept) => void;
}

export const EduTrainingPanel: React.FC<EduTrainingPanelProps> = ({
  activeTab,
  subDept,
  onSelectSubDept
}) => {
  const [selectedSubDeptForUsers, setSelectedSubDeptForUsers] = useState<EduSubDept>(null);

  const educationUsers = [
    { name: 'Alexander Wright', id: 'EMP-1102', email: 'alex.wright@amuwa.com' }
  ];
  const productUsers = [
    { name: 'Priya Mehta', id: 'EMP-9041', email: 'priya.mehta@amuwa.com' }
  ];

  // STEP 1: SUB-DEPARTMENT SELECTOR SCREEN
  if (!subDept) {
    return (
      <div className="space-y-8 animate-fade-in py-8 max-w-5xl mx-auto">

        {/* Header Title */}
        <div className="text-center max-w-2xl mx-auto space-y-3">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-sky-50 border border-sky-200 text-sky-800 text-xs font-mono font-semibold">
            <span className="w-2.5 h-2.5 rounded-full bg-sky-500 animate-pulse" />
            <span>EDUCATION & TRAINING</span>
          </div>
          <h2 className="text-3xl sm:text-4xl font-bold font-heading text-slate-900 tracking-tight">
            Select Education & Training Sub-Department
          </h2>
        </div>

        {/* 2 Dedicated Cards Grid (Candidate Education Training vs Client Product Training) */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

          {/* CARD 1: EDUCATION TRAINING (CANDIDATE) */}
          <div
            onClick={() => onSelectSubDept('education_training')}
            className="bg-white rounded-3xl p-8 border border-slate-200 hover:border-sky-500 hover:shadow-2xl hover:-translate-y-1.5 transition-all duration-300 cursor-pointer flex flex-col justify-between space-y-6 group relative overflow-hidden shadow-md"
          >
            <div className="h-1.5 w-full bg-gradient-to-r from-sky-500 to-blue-600 absolute top-0 left-0 right-0" />

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="p-4 rounded-2xl bg-sky-50 text-sky-600 border border-sky-100 group-hover:scale-110 transition-transform">
                  <GraduationCap className="w-8 h-8" />
                </div>

                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedSubDeptForUsers('education_training');
                  }}
                  className="px-3.5 py-1.5 rounded-full bg-sky-50 text-sky-800 border border-sky-200 font-mono text-xs font-bold flex items-center gap-1.5 hover:bg-sky-100 transition-colors shadow-2xs"
                  title="Click to view active logged-in training team"
                >
                  <Users className="w-3.5 h-3.5 text-sky-600" />
                  <span>{educationUsers.length}/3 Active</span>
                </button>
              </div>

              <div>
                <h3 className="text-2xl font-bold font-heading text-slate-900 group-hover:text-sky-600 transition-colors">
                  Education Training (Candidates)
                </h3>
                <p className="text-xs font-mono text-slate-500 mt-1">
                  Day-wise induction &amp; skill training progress for new candidates.
                </p>
              </div>
            </div>

            <div className="pt-4 border-t border-slate-100 flex items-center justify-end">
              <div className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-sky-600 text-white font-mono font-bold text-xs shadow-md group-hover:bg-sky-700 transition-colors">
                <span>Enter Education Training</span>
                <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </div>
            </div>
          </div>

          {/* CARD 2: PRODUCT TRAINING (CLIENT) */}
          <div
            onClick={() => onSelectSubDept('product_training')}
            className="bg-white rounded-3xl p-8 border border-slate-200 hover:border-indigo-500 hover:shadow-2xl hover:-translate-y-1.5 transition-all duration-300 cursor-pointer flex flex-col justify-between space-y-6 group relative overflow-hidden shadow-md"
          >
            <div className="h-1.5 w-full bg-gradient-to-r from-indigo-500 to-violet-600 absolute top-0 left-0 right-0" />

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="p-4 rounded-2xl bg-indigo-50 text-indigo-600 border border-indigo-100 group-hover:scale-110 transition-transform">
                  <BookOpen className="w-8 h-8" />
                </div>

                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedSubDeptForUsers('product_training');
                  }}
                  className="px-3.5 py-1.5 rounded-full bg-indigo-50 text-indigo-800 border border-indigo-200 font-mono text-xs font-bold flex items-center gap-1.5 hover:bg-indigo-100 transition-colors shadow-2xs"
                  title="Click to view active logged-in product training team"
                >
                  <Users className="w-3.5 h-3.5 text-indigo-600" />
                  <span>{productUsers.length}/3 Active</span>
                </button>
              </div>

              <div>
                <h3 className="text-2xl font-bold font-heading text-slate-900 group-hover:text-indigo-600 transition-colors">
                  Product Training (Clients)
                </h3>
                <p className="text-xs font-mono text-slate-500 mt-1">
                  Product onboarding &amp; training workspace for client-facing sessions.
                </p>
              </div>
            </div>

            <div className="pt-4 border-t border-slate-100 flex items-center justify-end">
              <div className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 text-white font-mono font-bold text-xs shadow-md group-hover:bg-indigo-700 transition-colors">
                <span>Enter Product Training</span>
                <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </div>
            </div>
          </div>

        </div>

        {/* SUB-DEPARTMENT ACTIVE USERS MODAL */}
        {selectedSubDeptForUsers && (
          <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="w-full max-w-md bg-white rounded-3xl p-6 border border-slate-200 shadow-2xl animate-scale-up space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <div className="flex items-center gap-2">
                  <div className="p-2 rounded-xl bg-sky-50 text-sky-600">
                    <Users className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold font-heading text-slate-900 capitalize">
                      {selectedSubDeptForUsers === 'education_training' ? 'Education Training' : 'Product Training'} Sub-Department
                    </h3>
                    <span className="text-[10px] font-mono text-slate-500">Active Staff Roster (Max 3 Users)</span>
                  </div>
                </div>
                <button
                  onClick={() => setSelectedSubDeptForUsers(null)}
                  className="p-1 rounded-xl text-slate-400 hover:text-slate-900 hover:bg-slate-100"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-2">
                {(selectedSubDeptForUsers === 'education_training' ? educationUsers : productUsers).map((usr, idx) => (
                  <div key={idx} className="p-3 bg-slate-50 border border-slate-200 rounded-2xl flex items-center justify-between text-xs font-mono">
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-full bg-sky-600 text-white font-bold flex items-center justify-center text-[10px]">
                        {usr.name.charAt(0)}
                      </div>
                      <div>
                        <strong className="text-slate-900 block">{usr.name}</strong>
                        <span className="text-[10px] text-slate-400">{usr.email}</span>
                      </div>
                    </div>

                    <span className="px-2 py-0.5 rounded bg-sky-100 text-sky-800 text-[9px] font-bold">
                      ACTIVE USER
                    </span>
                  </div>
                ))}
              </div>

              <button
                onClick={() => setSelectedSubDeptForUsers(null)}
                className="w-full py-2.5 rounded-xl bg-slate-900 text-white text-xs font-mono font-bold"
              >
                Close
              </button>
            </div>
          </div>
        )}

      </div>
    );
  }

  const backButton = (
    <button
      onClick={() => onSelectSubDept(null)}
      className="p-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 text-xs font-mono font-bold flex items-center gap-1.5 transition-colors"
    >
      <ArrowLeft className={subDept === 'education_training' ? 'w-4 h-4 text-sky-600' : 'w-4 h-4 text-indigo-600'} />
      <span>Change Sub-Department</span>
    </button>
  );

  // STEP 2A: EDUCATION TRAINING (CANDIDATE) — moved over exactly as-is from Amuwa Corporation
  if (subDept === 'education_training') {
    // The "Candidate Training" nav tab shows the full moved panel. Any other
    // tab (e.g. the default "Dashboard" tab) shows a light summary screen,
    // matching how every other department's sidebar/tab pairing behaves.
    if (activeTab === 'training') {
      return (
        <div className="space-y-6 animate-fade-in">
          <div className="flex items-center gap-3">{backButton}</div>
          <AmuwaTrainingPanel />
        </div>
      );
    }

    return (
      <div className="space-y-6 animate-fade-in">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-6 rounded-3xl bg-white border border-slate-200 shadow-sm">
          <div className="flex items-center gap-3">
            {backButton}
            <div>
              <h2 className="text-xl font-bold font-heading text-slate-900 uppercase">
                Education Training Department Panel
              </h2>
              <p className="text-xs font-mono text-slate-500">
                Candidate Day-Wise Training &amp; Induction Progress
              </p>
            </div>
          </div>
          <div className="px-3.5 py-1.5 rounded-full bg-sky-50 text-sky-800 border border-sky-200 font-mono text-[10px] font-bold uppercase">
            Education Training Workspace
          </div>
        </div>

        <div className="p-10 rounded-3xl bg-white border border-slate-200 shadow-sm text-center space-y-4">
          <div className="w-14 h-14 rounded-2xl bg-sky-50 border border-sky-100 text-sky-600 mx-auto flex items-center justify-center">
            <GraduationCap className="w-7 h-7" />
          </div>
          <h3 className="text-xl font-bold font-heading text-slate-900">
            Candidate Training Progress
          </h3>
          <p className="text-xs font-mono text-slate-500 max-w-md mx-auto">
            Open the "Candidate Training" tab in the sidebar to view day 1 / day 2 / day 3
            progress, evaluations and trainer feedback — the exact same panel that used to
            live under Amuwa Corporation.
          </p>
        </div>
      </div>
    );
  }

  // STEP 2B: PRODUCT TRAINING (CLIENT) — new workspace
  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-6 rounded-3xl bg-white border border-slate-200 shadow-sm">
        <div className="flex items-center gap-3">
          {backButton}
          <div>
            <h2 className="text-xl font-bold font-heading text-slate-900 uppercase">
              Product Training Department Panel
            </h2>
            <p className="text-xs font-mono text-slate-500">
              Client-Facing Product Onboarding Workspace
            </p>
          </div>
        </div>

        <div className="px-3.5 py-1.5 rounded-full bg-indigo-50 text-indigo-800 border border-indigo-200 font-mono text-[10px] font-bold uppercase">
          Product Training Workspace
        </div>
      </div>

      <div className="p-10 rounded-3xl bg-white border border-slate-200 shadow-sm text-center space-y-4">
        <div className="w-14 h-14 rounded-2xl bg-indigo-50 border border-indigo-100 text-indigo-600 mx-auto flex items-center justify-center">
          <Sparkles className="w-7 h-7" />
        </div>
        <h3 className="text-xl font-bold font-heading text-slate-900">
          Client Product Training Workspace
        </h3>
        <p className="text-xs font-mono text-slate-500 max-w-md mx-auto">
          This is a fresh workspace for scheduling and tracking product training sessions
          with clients — no data was moved here. Tell me what it should track (sessions,
          client roster, materials, completion status, etc.) and I'll build it out.
        </p>
      </div>
    </div>
  );
};
