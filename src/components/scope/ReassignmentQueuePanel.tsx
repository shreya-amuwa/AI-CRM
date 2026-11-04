import React, { useCallback, useEffect, useState } from 'react';
import type { Profile, ReassignmentItem } from '../../../shared/contracts';
import { usersApi } from '../../lib/api/endpoints';
import { errorMessage } from '../../lib/api/client';

const KIND_LABEL: Record<ReassignmentItem['kind'], string> = {
  CUSTOMER_MEMBER: 'Client needs a Team Member', CUSTOMER_LEAD: 'Client needs a Team Lead', CUSTOMER_VERIFIER: 'Verification needs a Meta Verifier',
  MEMBER_LEAD: 'Team Member needs a Team Lead', TASK: 'Task needs an owner', DEPARTMENT_HEAD: 'Department needs a Department Head'
};

/** The work nobody has yet because someone left: customers, verifications, people, tasks. Visible to the managers of that department; the database checks every assignment. */
export const ReassignmentQueuePanel: React.FC = () => {
  const [items, setItems] = useState<ReassignmentItem[] | null>(null);
  const [people, setPeople] = useState<Record<string, Profile[]>>({});
  const [pick, setPick] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setItems(await usersApi.reassignmentQueue()); setError(null); } catch (e) { setError(errorMessage(e)); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  // the colleagues of the item's department (the server still decides who is eligible)
  useEffect(() => {
    const departments = [...new Set((items ?? []).map(i => i.departmentId).filter(Boolean))] as string[];
    departments.filter(d => !people[d]).forEach(d => {
      usersApi.list({ departmentId: d, status: 'ACTIVE', pageSize: 100 }).then(r => setPeople(p => ({ ...p, [d]: r.items })), () => undefined);
    });
  }, [items, people]);

  const resolve = async (i: ReassignmentItem) => {
    setBusy(i.id); setError(null);
    try { await usersApi.reassignmentResolve(i.id, i.kind === 'DEPARTMENT_HEAD' ? null : pick[i.id] || null); await load(); } catch (e) { setError(errorMessage(e)); } finally { setBusy(null); }
  };

  return (
    <section className="bg-white rounded-2xl border border-slate-200/80 p-5 space-y-3" aria-labelledby="reassign-title" data-testid="reassignment-queue">
      <h2 id="reassign-title" className="font-bold text-slate-900">Reassignment required</h2>
      <p className="text-xs text-slate-500">Work that lost its owner because someone left. Nothing here was given to anybody automatically.</p>
      {error && <p role="alert" className="text-xs font-semibold text-rose-600">{error}</p>}
      {items === null && !error && <p className="text-xs text-slate-500" role="status">Loading…</p>}
      {items && items.length === 0 && <p className="text-xs text-slate-500">Nothing is waiting for a new owner.</p>}
      {items && items.length > 0 && (
        <ul className="divide-y divide-slate-100 border border-slate-100 rounded-xl">
          {items.map(i => (
            <li key={i.id} className="p-3 flex flex-col lg:flex-row lg:items-center gap-2">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-slate-900">{i.label ?? KIND_LABEL[i.kind]}</p>
                <p className="text-[11px] text-slate-500">{KIND_LABEL[i.kind]}{i.from ? ` · from ${i.from}` : ''}{i.department ? ` · ${i.department}` : ''}{i.reason ? ` · ${i.reason}` : ''}</p>
              </div>
              {i.kind !== 'DEPARTMENT_HEAD' && (
                <select aria-label={`New owner for ${i.label ?? i.kind}`} className="border border-slate-300 rounded-lg px-2 py-1 text-xs min-w-[12rem]" value={pick[i.id] ?? ''} onChange={e => setPick(p => ({ ...p, [i.id]: e.target.value }))}>
                  <option value="">Choose a colleague…</option>
                  {(people[i.departmentId ?? ''] ?? []).map(p => <option key={p.id} value={p.id}>{p.fullName}</option>)}
                </select>
              )}
              <button type="button" className="px-3 py-1.5 rounded-lg text-xs font-bold bg-blue-600 text-white disabled:opacity-60" disabled={busy !== null || (i.kind !== 'DEPARTMENT_HEAD' && !pick[i.id])} onClick={() => void resolve(i)}>
                {busy === i.id ? 'Saving…' : i.kind === 'DEPARTMENT_HEAD' ? 'Mark resolved' : 'Assign'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};
