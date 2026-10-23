import React from 'react';
import { Hourglass, LogOut } from 'lucide-react';
import { SALES_SUB_ROLE_LABELS } from '../../../shared/contracts';
import { useAuth } from '../../context/AuthContext';
import { AmuwaLogo } from '../common/AmuwaLogo';

/**
 * A Sales member whose Sales role (Business Associate, Influencer, Visit Sales, Business Partner) has no dashboard yet. They never
 * land on another role's dashboard; the role is stored, and the dashboard will open here once it exists.
 */
export const SalesRolePending: React.FC = () => {
  const { user, profile, logout } = useAuth();
  const role = profile?.salesSubRole ? SALES_SUB_ROLE_LABELS[profile.salesSubRole] : 'Sales';
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center px-4 text-center">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm space-y-4" role="status">
        <div className="flex justify-center"><AmuwaLogo size="sm" /></div>
        <span className="mx-auto w-12 h-12 rounded-2xl bg-amber-50 text-amber-700 flex items-center justify-center"><Hourglass className="w-6 h-6" aria-hidden="true" /></span>
        <h1 className="text-xl font-extrabold text-slate-900">Your {role} dashboard is not set up yet</h1>
        <p className="text-sm text-slate-600">
          {user?.name ? `${user.name}, your` : 'Your'} Sales role is saved as <strong>{role}</strong>. Its dashboard has not been built yet, so there is nothing to open here for now.
          Please check back later or ask your Department Head.
        </p>
        <button
          type="button"
          onClick={() => void logout()}
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          <LogOut className="w-4 h-4" aria-hidden="true" /> Sign out
        </button>
      </div>
    </div>
  );
};
