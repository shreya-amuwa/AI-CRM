import React from 'react';
import { ShieldAlert, LogOut, Clock, Monitor, UserCheck, AlertTriangle } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

export const SessionEvictionModal: React.FC = () => {
  const {
    isEvictionModalOpen,
    pendingDepartment,
    conflictingSessions,
    confirmEviction,
    closeEvictionModal,
    user
  } = useAuth();

  if (!isEvictionModalOpen || !pendingDepartment) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-xl bg-white border border-amber-300 rounded-2xl p-6 sm:p-8 shadow-2xl relative overflow-hidden animate-scale-up">
        {/* Top Warning Stripe */}
        <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-amber-500 via-rose-500 to-amber-500" />

        {/* Header */}
        <div className="flex items-start gap-4 mb-6">
          <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-600 shrink-0">
            <ShieldAlert className="w-8 h-8" />
          </div>
          <div>
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-amber-100 border border-amber-200 text-amber-800 text-xs font-mono mb-1 font-semibold">
              <AlertTriangle className="w-3 h-3" />
              <span>SESSION LIMIT REACHED (MAX 2 USERS)</span>
            </div>
            <h3 className="text-xl font-bold font-heading text-slate-900">
              Department Active Session Limit
            </h3>
            <p className="text-slate-600 text-xs mt-1">
              <span className="text-amber-800 font-semibold">{pendingDepartment.name}</span> currently has 2 active sessions. Evict one session below to gain access.
            </p>
          </div>
        </div>

        {/* Active Sessions List */}
        <div className="space-y-4 mb-6">
          <p className="text-xs font-mono text-slate-500 uppercase tracking-wider font-semibold">
            Active Sessions in {pendingDepartment.name}:
          </p>

          {conflictingSessions.map((sess, idx) => (
            <div
              key={sess.sessionId}
              className="p-4 rounded-xl bg-slate-50 border border-slate-200 hover:border-amber-400 transition-all flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4"
            >
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-full bg-blue-100 border border-blue-200 text-blue-700 flex items-center justify-center font-bold text-sm shrink-0">
                  {sess.userName.charAt(0)}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-slate-900 text-sm">{sess.userName}</span>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-white text-slate-600 border border-slate-200 font-semibold">
                      Session #{idx + 1}
                    </span>
                  </div>
                  <p className="text-xs font-mono text-slate-500 mt-0.5">{sess.userEmail}</p>
                  
                  <div className="flex items-center gap-3 text-[11px] font-mono text-slate-500 mt-2">
                    <span className="flex items-center gap-1">
                      <Monitor className="w-3 h-3 text-slate-400" />
                      {sess.device}
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3 text-slate-400" />
                      {new Date(sess.loggedInAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => confirmEviction(sess.sessionId)}
                className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-xs font-semibold font-mono flex items-center justify-center gap-2 transition-all shadow-sm shrink-0"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>EVICT SESSION</span>
              </button>
            </div>
          ))}
        </div>

        {/* Action Footer */}
        <div className="pt-4 border-t border-slate-100 flex items-center justify-between">
          <div className="text-xs text-slate-500 font-mono flex items-center gap-1.5">
            <UserCheck className="w-3.5 h-3.5 text-blue-600" />
            <span>Attempting login as: <strong className="text-slate-900">{user?.name}</strong></span>
          </div>
          <button
            type="button"
            onClick={closeEvictionModal}
            className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};
