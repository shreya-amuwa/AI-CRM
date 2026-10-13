import React from 'react';
import type { ActiveTab } from '../../../layout/Sidebar';
import { useSalesOverview, useWabastoreId } from './useSalesOverview';

/**
 * The numbered "1 Leads / 2 Potential" steps under Leads, styled like the Sales Team Member
 * dashboard's My Leads sub-menu, with the sub-department's real counts.
 */
const CHILDREN: { id: ActiveTab; label: string; step: number; badge: string; activeBadge: string; key: 'leads' | 'potential' }[] = [
  { id: 'leads', label: 'Leads', step: 1, badge: 'bg-indigo-50 text-indigo-700', activeBadge: 'bg-indigo-600 text-white', key: 'leads' },
  { id: 'sales_potential' as ActiveTab, label: 'Potential', step: 2, badge: 'bg-orange-50 text-orange-700', activeBadge: 'bg-orange-700 text-white', key: 'potential' }
];

export const SalesLeadsSubNav: React.FC<{ activeTab: ActiveTab; onSelectTab: (tab: ActiveTab) => void }> = ({ activeTab, onSelectTab }) => {
  const departmentId = useWabastoreId();
  const { data } = useSalesOverview(departmentId);
  // The counts come from the database function; an older function without them just shows no number.
  const count = (k: 'leads' | 'potential'): number | undefined => (k === 'leads' ? data?.leads?.all : data?.potential?.all);
  return (
    <ul role="group" aria-label="Leads" className="mt-1 ml-3 pl-2 border-l border-slate-100 space-y-0.5">
      {CHILDREN.map(child => {
        const active = activeTab === child.id;
        const n = count(child.key);
        return (
          <li key={child.id}>
            <button
              type="button"
              aria-current={active ? 'page' : undefined}
              onClick={() => onSelectTab(child.id)}
              className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-xs text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 ${
                active ? 'bg-white shadow-sm ring-1 ring-slate-200 font-bold text-slate-900' : 'font-medium text-slate-600 hover:bg-slate-50'
              }`}
            >
              <span aria-hidden="true" className={`w-5 h-5 rounded-md inline-flex items-center justify-center text-[10px] font-bold shrink-0 ${active ? child.activeBadge : child.badge}`}>
                {child.step}
              </span>
              <span className="flex-1 leading-tight font-sans">{child.label}</span>
              {n !== undefined && (
                <span className={`text-[10px] font-semibold ${active ? `px-1.5 py-0.5 rounded-md ${child.badge}` : 'text-slate-400'}`} aria-label={`${n} ${child.label.toLowerCase()}`}>
                  {n}
                </span>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
};
