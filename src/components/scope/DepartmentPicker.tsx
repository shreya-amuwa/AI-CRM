import React from 'react';
import { ArrowRight, LogOut } from 'lucide-react';
import type { DepartmentScopeDepartment, HeadDivision } from '../../../shared/contracts';
import { useAuth } from '../../context/AuthContext';
import { AmuwaLogo } from '../common/AmuwaLogo';
import { DepartmentIcon } from './DepartmentIcon';

const SIDE_LABEL: Record<HeadDivision, string> = { SALES: 'Sales', SUPPORT: 'Support' };

/** What the head does in a department: "Sales", "Support", "Sales and Support" (or the whole department). */
export const functionsOf = (d: DepartmentScopeDepartment): string =>
  d.divisions.length ? d.divisions.map(x => SIDE_LABEL[x]).join(' and ') : 'Whole department';

/**
 * Shown after sign-in to a Department Head who is authorised for several departments (the shared Sales or Support head): the
 * departments they may enter, nothing else. Choosing one opens its dashboard; the department list in the top bar switches later.
 */
export const DepartmentPicker: React.FC = () => {
  const { scopes, user, chooseDepartment, logout } = useAuth();
  const departments = scopes?.departments ?? [];
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      <header className="h-16 bg-white border-b border-slate-200 px-4 sm:px-8 flex items-center justify-between">
        <AmuwaLogo layout="horizontal" size="sm" />
        <button type="button" onClick={() => void logout()} className="inline-flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-slate-900">
          <LogOut className="w-4 h-4" aria-hidden="true" /> Sign out
        </button>
      </header>
      <main className="flex-1 w-full max-w-5xl mx-auto px-4 sm:px-8 py-8 sm:py-12">
        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight font-heading">Choose a department</h1>
        <p className="mt-2 text-slate-600 max-w-2xl">
          {user?.name ? `${user.name}, you` : 'You'} look after {departments.length} departments. Open the one you want to work in; you can switch to another from the top of the dashboard without signing in again.
        </p>
        {departments.length === 0 ? (
          <p role="alert" className="mt-8 text-sm text-slate-600">No department is assigned to your account. Ask the Super Admin.</p>
        ) : (
          <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label="Your departments">
            {departments.map(d => (
              <li key={d.id}>
                <button
                  type="button"
                  onClick={() => chooseDepartment(d.id)}
                  className="group w-full h-full text-left bg-white rounded-2xl border border-slate-200 p-5 shadow-sm hover:shadow-md hover:border-slate-300 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                  data-testid={`department-card-${d.slug}`}
                >
                  <span className="flex items-center gap-3">
                    <span className="w-11 h-11 rounded-xl flex items-center justify-center bg-slate-50 border border-slate-200 shrink-0">
                      <DepartmentIcon name={d.iconName} color={d.accentColor} className="w-6 h-6" />
                    </span>
                    <span className="min-w-0">
                      <span className="block font-bold text-slate-900 truncate">{d.name}</span>
                      <span className="block text-xs text-slate-500">{functionsOf(d)}{d.isHome ? ' · your own department' : ''}</span>
                    </span>
                  </span>
                  <span className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-blue-700 group-hover:gap-2.5 transition-all">
                    Open dashboard <ArrowRight className="w-4 h-4" aria-hidden="true" />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
};
