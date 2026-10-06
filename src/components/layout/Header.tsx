import React, { useState } from 'react';
import { Users, LogOut, Cloud, ShieldCheck } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { sessionManager } from '../../services/sessionManager';
import { AmuwaLogo } from '../common/AmuwaLogo';
import { getSupabaseConfig } from '../../services/supabaseClient';
import { usePendingApprovalsCount } from '../../hooks/usePendingApprovalsCount';
import { UserAccessManagementModal } from '../common/UserAccessManagementModal';

interface HeaderProps {
  onNavigateHome?: () => void;
}

export const Header: React.FC<HeaderProps> = ({ onNavigateHome }) => {
  const { activeDepartment, user, logout } = useAuth();
  const supabaseConfig = getSupabaseConfig();
  const [isAccessModalOpen, setIsAccessModalOpen] = useState(false);
  const pendingCount = usePendingApprovalsCount();

  if (!activeDepartment) return null;

  const activeSessions = sessionManager.getDepartmentSessions(activeDepartment.id);
  const canManageAccess = user?.role === 'superadmin' || user?.role === 'admin' || user?.role === 'hr' || user?.role === 'team-lead';

  return (
    <>
      <header className="h-16 bg-white/95 backdrop-blur-md border-b border-slate-200 px-4 sm:px-6 flex items-center justify-between sticky top-0 z-30 shadow-xs text-slate-900">
        
        {/* Left Side: Main Corporate Logo & Active Department Identifier */}
        <div className="flex items-center gap-3 sm:gap-4">
          {onNavigateHome ? (
            <button
              type="button"
              onClick={onNavigateHome}
              className="hover:opacity-80 transition-opacity focus:outline-none flex items-center"
              title="Return to Department Hub"
            >
              <AmuwaLogo layout="horizontal" size="sm" />
            </button>
          ) : (
            <AmuwaLogo layout="horizontal" size="sm" />
          )}
          <span className="text-slate-200 text-lg">|</span>

          {/* Active Department Identifier */}
          <div className="flex items-center gap-2.5 px-3 py-1.5 rounded-xl bg-slate-50 border border-slate-200 text-xs font-mono">
            {activeDepartment.logoUrl ? (
              <img 
                src={activeDepartment.logoUrl} 
                alt={activeDepartment.name}
                className="h-5 w-auto object-contain"
              />
            ) : (
              <div 
                className="w-2.5 h-2.5 rounded-full" 
                style={{ backgroundColor: activeDepartment.accentColor }} 
              />
            )}
            <span className="font-bold font-heading text-sm text-slate-900">{activeDepartment.name}</span>
          </div>

          {/* Active Sessions Counter Badge */}
          <div className="hidden md:flex items-center gap-2 px-3 py-1 rounded-full bg-slate-100 border border-slate-200 text-slate-700 text-xs font-mono">
            <Users className="w-3.5 h-3.5 text-slate-500" />
            <span>Active Sessions: <strong className="text-slate-900">{activeSessions.length}/2</strong></span>
          </div>
        </div>

        {/* Right Side Tools */}
        <div className="flex items-center gap-2.5">
          
          {/* Cloud Connection Status Badge */}
          <div
            className={`px-3 py-1.5 rounded-xl border text-xs font-mono font-semibold flex items-center gap-1.5 shadow-xs ${
              supabaseConfig.isConfigured
                ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                : 'bg-slate-100 border-slate-200 text-slate-600'
            }`}
            title={supabaseConfig.isConfigured ? 'Cloud: Active' : 'Cloud: Local'}
          >
            <Cloud className={`w-3.5 h-3.5 ${supabaseConfig.isConfigured ? 'text-emerald-600' : 'text-slate-500'}`} />
            <span className="hidden sm:inline">
              {supabaseConfig.isConfigured ? 'CLOUD: ACTIVE' : 'CLOUD: LOCAL'}
            </span>
            {supabaseConfig.isConfigured && (
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            )}
          </div>

          {/* Access & Approvals Control Button (Super Admin / Admin / Dept Head / Team Lead) */}
          {canManageAccess && (
            <button
              type="button"
              onClick={() => setIsAccessModalOpen(true)}
              className="px-3 py-1.5 rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-xs relative"
              title="Staff Access & Approvals Control"
            >
              <ShieldCheck className="w-3.5 h-3.5 text-indigo-600" />
              <span className="hidden md:inline">Access & Approvals</span>
              {pendingCount > 0 && (
                <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-amber-500 text-white animate-pulse">
                  {pendingCount}
                </span>
              )}
            </button>
          )}

          {/* User Profile & Logout */}
          <div className="flex items-center gap-2 pl-2 border-l border-slate-200">
            <div className="w-8 h-8 rounded-full bg-blue-600 text-white font-bold text-xs flex items-center justify-center font-mono shadow-xs">
              {user?.name.charAt(0)}
            </div>
            
            <div className="hidden lg:block text-left text-xs font-mono">
              <span className="text-slate-900 font-semibold block leading-tight">{user?.name}</span>
              <span className="text-slate-400 text-[10px]">
                {user?.role === 'superadmin' ? 'Super Admin' : user?.role === 'team-lead' ? 'Team Lead' : 'Staff Admin'}
              </span>
            </div>

            <button
              onClick={logout}
              title="Sign Out"
              className="p-1.5 rounded-xl text-slate-400 hover:text-rose-600 hover:bg-slate-100 transition-colors ml-1"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>

        </div>
      </header>

      {/* Staff Access & Approvals Modal */}
      {isAccessModalOpen && (
        <UserAccessManagementModal
          isOpen={isAccessModalOpen}
          onClose={() => setIsAccessModalOpen(false)}
        />
      )}
    </>
  );
};
