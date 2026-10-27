import React, { useCallback, useEffect, useRef, useState } from 'react';
import { LEAD_SCOPES, LEAD_SCOPE_LABELS, type LeadScope, type LeadScopeCounts, type LeadScopeRow } from '../../../shared/contracts';
import { errorMessage } from '../../lib/api/client';
import { leadScopeApi } from '../../lib/api/endpoints';
import { Badge, WorkflowBadge, fmtDate, fmtDateTime, rupees } from '../payments/PaymentBits';
import { Dialog } from '../team-member/pipeline/shared';

/**
 * The five filters of the Lead section of a Telecaller and a Business Associate: All Leads, My Leads, Department Leads, To Accounts and
 * Returned by Accounts. The rows and the numbers both come from the database (lead_scope_list / lead_scope_counts), which decides who may
 * see which lead; this file only shows them.
 */

export const LEAD_SCOPE_EMPTY: Record<LeadScope, { title: string; text: string }> = {
  ALL: { title: 'No leads yet', text: 'Leads you own and leads of your department appear here.' },
  MINE: { title: 'No leads assigned to you', text: 'Leads you add or are given appear here.' },
  DEPARTMENT: { title: 'No department leads', text: 'Leads of the other people in your department appear here, to view.' },
  TO_ACCOUNTS: { title: 'Nothing is with Accounts', text: 'Leads sent to Accounts for payment confirmation appear here until Accounts acts on them.' },
  RETURNED: { title: 'Accounts has not returned any lead', text: 'A lead Accounts sends back for correction appears here, with the reason.' }
};

const COUNT_KEY: Record<LeadScope, keyof LeadScopeCounts> = { ALL: 'all', MINE: 'mine', DEPARTMENT: 'department', TO_ACCOUNTS: 'toAccounts', RETURNED: 'returned' };

/** The numbers beside the filters. `refresh` reloads them (after the list reloads, or a lead changed). */
export function useLeadScopeCounts() {
  const [counts, setCounts] = useState<LeadScopeCounts | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const refresh = useCallback(() => {
    const mine = ++seq.current;
    leadScopeApi.counts().then(
      c => mine === seq.current && (setCounts(c), setError(null)),
      err => mine === seq.current && setError(errorMessage(err))
    );
  }, []);
  useEffect(refresh, [refresh]);
  return { counts, error, refresh };
}

export const LeadScopeTabs: React.FC<{ scope: LeadScope; onChange: (s: LeadScope) => void; counts: LeadScopeCounts | null }> = ({ scope, onChange, counts }) => (
  <div role="tablist" aria-label="Lead filter" className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1" data-testid="lead-scope-tabs">
    {LEAD_SCOPES.map(s => {
      const on = scope === s;
      const n = counts ? counts[COUNT_KEY[s]] : null;
      return (
        <button
          key={s}
          type="button"
          role="tab"
          aria-selected={on}
          data-testid={`lead-scope-${s}`}
          onClick={() => onChange(s)}
          className={`shrink-0 inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-sm font-semibold border transition-colors ${
            on ? 'bg-blue-600 border-blue-600 text-white shadow-sm' : 'bg-white border-slate-200 text-slate-700 hover:bg-blue-50 hover:border-blue-200'
          }`}
        >
          {LEAD_SCOPE_LABELS[s]}
          {n !== null && (
            <span className={`min-w-[1.5rem] px-1.5 py-0.5 rounded-full text-[11px] font-bold text-center ${on ? 'bg-white/25 text-white' : 'bg-slate-100 text-slate-600'}`} data-testid={`lead-scope-count-${s}`}>
              {n}
            </span>
          )}
        </button>
      );
    })}
  </div>
);

/** Who the lead belongs to, for the rows that are not the signed-in person's own. */
export const LeadOwner: React.FC<{ row: Pick<LeadScopeRow, 'isMine' | 'owner'> }> = ({ row }) =>
  row.owner ? <span className="block text-[11px] text-slate-500 truncate">{row.isMine ? 'Assigned to you' : `Assigned to ${row.owner.fullName}`}</span> : null;

/** What the Accounts workflow recorded: shown under a lead of To Accounts / Returned by Accounts. */
export const AccountsDetails: React.FC<{ row: LeadScopeRow; scope: LeadScope }> = ({ row, scope }) => {
  const a = row.accounts;
  if (!a) return null;
  const returned = a.status === 'RETURNED';
  const items: [string, React.ReactNode][] = returned
    ? [
        ['Returned on', fmtDateTime(a.returnedAt)],
        ['Returned by', a.returnedBy || '-'],
        ['Reason for return', a.reason || 'No reason was given.'],
        ['Assigned to', row.owner?.fullName || '-'],
        ['Follow-up', `${row.followUpDate ? `Due ${fmtDate(row.followUpDate)}` : 'No date set'} · ${row.leadStatus.replace(/_/g, ' ').toLowerCase()}`],
        ['Agreed amount', rupees(a.amount)],
        ['Submitted by', `${a.submittedBy || '-'} · ${fmtDateTime(a.submittedAt)}`]
      ]
    : [
        ['Agreed amount', rupees(a.amount)],
        ['Submitted by', a.submittedBy || '-'],
        ['Submitted on', fmtDateTime(a.submittedAt)],
        ['Accounts verification', 'Awaiting Accounts confirmation'],
        ['Assigned to', row.owner?.fullName || '-'],
        ['Note to Accounts', a.salesNote || '-']
      ];
  return (
    <dl
      className={`grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-x-6 gap-y-2 text-xs rounded-xl p-3 border ${returned ? 'bg-rose-50/60 border-rose-100' : 'bg-amber-50/60 border-amber-100'}`}
      data-testid={`lead-accounts-${scope}`}
    >
      {items.map(([k, v]) => (
        <div key={k} className={k === 'Reason for return' || k === 'Note to Accounts' ? 'sm:col-span-2' : ''}>
          <dt className="font-medium text-slate-500">{k}</dt>
          <dd className="text-slate-800 whitespace-pre-wrap break-words">{v}</dd>
        </div>
      ))}
    </dl>
  );
};

/** A lead of a colleague: read-only. Editing and sending to Accounts stay with its owner (the database refuses anybody else). */
export const ReadOnlyLeadDialog: React.FC<{ row: LeadScopeRow; scope: LeadScope; serviceNames?: string; onClose: () => void }> = ({ row, scope, serviceNames, onClose }) => {
  const rows: [string, React.ReactNode][] = [
    ['Company / Business', row.company],
    ['Phone', row.phone],
    ['Email', row.email],
    ['Interested service', serviceNames || row.serviceNames],
    ['Lead source', row.leadSource],
    ['Follow-up date', row.followUpDate ? fmtDate(row.followUpDate) : '-'],
    ['Created', fmtDate(row.createdAt)],
    ['Assigned to', row.owner?.fullName]
  ];
  return (
    <Dialog title={row.name} description="Lead details (read-only: this lead belongs to a colleague)" onClose={onClose}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="blue">{row.leadStatus.replace(/_/g, ' ').toLowerCase()}</Badge>
        <WorkflowBadge workflow={row.paymentWorkflow} />
      </div>
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt className="text-xs font-medium text-slate-500">{k}</dt>
            <dd className="text-slate-800 break-words">{v || '-'}</dd>
          </div>
        ))}
      </dl>
      {(scope === 'TO_ACCOUNTS' || scope === 'RETURNED' || row.accounts) && <AccountsDetails row={row} scope={scope} />}
      <div className="flex justify-end pt-1">
        <button type="button" className="inline-flex items-center justify-center h-11 px-4 rounded-xl border border-slate-200 bg-white text-slate-900 text-sm font-semibold hover:bg-slate-50" onClick={onClose}>
          Close
        </button>
      </div>
    </Dialog>
  );
};
