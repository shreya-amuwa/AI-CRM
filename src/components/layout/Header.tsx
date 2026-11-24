import React, { useState } from 'react';
import { Users, Megaphone } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { sessionManager } from '../../services/sessionManager';
import { ROLE_LABELS } from '../../lib/auth/roleMapping';
import { AmuwaLogo } from '../common/AmuwaLogo';
import { ClientNotices } from '../notices/ClientNotices';
import { Dialog } from '../team-member/pipeline/shared';
import { LeaveCenter } from '../leave/LeaveCenter';
import { NotificationBell } from '../notifications/NotificationBell';
import { MenuButton, SignOutButton } from './shell';

interface HeaderProps {
  onNavigateHome?: () => void;
  /** Show the hamburger (the department has a sidebar on this screen). */
  showMenu?: boolean;
}

export const Header: React.FC<HeaderProps> = ({ onNavigateHome, showMenu = false }) => {
  const { activeDepartment, user, logout } = useAuth();
  const [noticesOpen, setNoticesOpen] = useState(false);

  if (!activeDepartment) return null;

  const activeSessions = sessionManager.getDepartmentSessions(activeDepartment.id);

  return (
    <>
      <header className="h-16 bg-white border-b border-slate-200 px-3 sm:px-6 flex items-center justify-between gap-2 sticky top-0 z-30 text-slate-900">
        
        {/* Left Side: Main Corporate Logo & Active Department Identifier */}
        <div className="flex items-center gap-2 sm:gap-4 min-w-0">
          {showMenu && <MenuButton />}
          <div className="hidden sm:flex items-center gap-3 sm:gap-4 shrink-0">
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
          </div>

          {/* Active Department Identifier (the HR dashboard shows none: the HR logo/name is left out of the top corner) */}
          {activeDepartment.id !== 'hr' && <div className="flex items-center gap-2.5 px-3 py-1.5 rounded-xl bg-slate-50 border border-slate-200 text-xs min-w-0">
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
            <span className="font-bold font-heading text-sm text-slate-900 truncate">{activeDepartment.name}</span>
          </div>}

          {/* Active Sessions Counter Badge */}
          <div className="hidden md:flex items-center gap-2 h-8 px-3 rounded-full bg-slate-50 border border-slate-200 text-slate-600 text-xs whitespace-nowrap">
            <Users className="w-3.5 h-3.5 text-slate-500" />
            <span>Active Sessions: <strong className="text-slate-900">{activeSessions.length}/2</strong></span>
          </div>
        </div>

        {/* Right Side Tools */}
        <div className="flex items-center gap-1 sm:gap-2 shrink-0">
          
          {/* The Super Admin and the HR head tell clients about closures and new services */}
          {(user?.role === 'superadmin' || user?.role === 'hr') && activeDepartment.id !== 'hr' && (
            <button
              type="button"
              onClick={() => setNoticesOpen(true)}
              className="inline-flex items-center gap-1.5 h-10 px-3.5 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-900 hover:bg-slate-50"
            >
              <Megaphone className="w-4 h-4 text-blue-600" aria-hidden="true" /> <span className="hidden sm:inline">Client notices</span><span className="sr-only sm:hidden">Client notices</span>
            </button>
          )}

          <LeaveCenter />
          <NotificationBell />

          {/* User Profile & Logout */}
          <div className="flex items-center gap-2 sm:gap-2.5 pl-2 sm:pl-3 ml-0.5 sm:ml-1 border-l border-slate-200">
            <div className="w-9 h-9 rounded-full bg-blue-50 text-blue-700 ring-1 ring-blue-100 font-bold text-[13px] flex items-center justify-center shrink-0" aria-hidden="true">
              {user?.name.charAt(0)}
            </div>
            
            <div className="hidden lg:block text-left min-w-0 max-w-[180px]">
              <span className="text-slate-900 text-sm font-semibold block leading-tight truncate">{user?.name}</span>
              <span className="text-slate-500 text-xs block truncate">
                {user?.role === 'superadmin' ? 'Managing Director' : user?.role === 'team-lead' ? 'Team Lead' : user?.role === 'hr' && user.profile ? ROLE_LABELS[user.profile.role] : 'Staff Admin'}
              </span>
            </div>

            <SignOutButton onClick={() => void logout()} />
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
