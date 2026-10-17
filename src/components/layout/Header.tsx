import React, { useState } from 'react';
import { Users, LogOut, Megaphone, ShieldCheck } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { sessionManager } from '../../services/sessionManager';
import { AmuwaLogo } from '../common/AmuwaLogo';
import { ClientNotices } from '../notices/ClientNotices';
import { Dialog } from '../team-member/pipeline/shared';
import { LeaveCenter } from '../leave/LeaveCenter';
import { NotificationBell } from '../notifications/NotificationBell';

interface HeaderProps {
  onNavigateHome?: () => void;
}

export const Header: React.FC<HeaderProps> = ({ onNavigateHome }) => {
  const { activeDepartment, user, logout } = useAuth();
  const [noticesOpen, setNoticesOpen] = useState(false);

  if (!activeDepartment) return null;

  const activeSessions = sessionManager.getDepartmentSessions(activeDepartment.id);

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
          
          {/* The Super Admin and the HR head tell clients about closures and new services */}
          {(user?.role === 'superadmin' || user?.role === 'hr') && activeDepartment.id !== 'hr' && (
            <button
              type="button"
              onClick={() => setNoticesOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              <Megaphone className="w-3.5 h-3.5 text-indigo-600" aria-hidden="true" /> <span className="hidden sm:inline">Client notices</span><span className="sr-only sm:hidden">Client notices</span>
            </button>
          )}

          <LeaveCenter />
          <NotificationBell />

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
      {noticesOpen && (
        <Dialog title="Client notices" onClose={() => setNoticesOpen(false)} wide>
          <ClientNotices />
        </Dialog>
      )}
    </>
  );
};
