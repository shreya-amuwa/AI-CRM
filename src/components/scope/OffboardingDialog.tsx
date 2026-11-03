import React, { useCallback, useEffect, useState } from 'react';
import type { OffboardingImpact, OffboardingResult, Profile } from '../../../shared/contracts';
import { usersApi } from '../../lib/api/endpoints';
import { errorMessage } from '../../lib/api/client';
import { Dialog } from '../team-member/pipeline/shared';

const COUNT_LABEL: [keyof OffboardingImpact['counts'], string][] = [
  ['customersAsMember', 'Clients they look after (Team Member)'], ['customersAsLead', 'Clients they supervise (Team Lead)'], ['customersAsVerifier', 'Unfinished Meta verifications'],
  ['customersOwned', 'Customers and leads they own'], ['openTasks', 'Open tasks'], ['directReports', 'People who report to them'], ['reportsToReview', 'Reports waiting for their review'], ['conversations', 'Ongoing client conversations']
];

/**
 * Employee offboarding: first what is attached to the person (read-only), then ONE step that moves the work to a chosen colleague (or leaves it in the Reassignment Required
 * queue when nobody is chosen) and closes the account. Nothing is chosen for you, nothing is approved on anybody's behalf, and the server repeats every check.
 */
export const OffboardingDialog: React.FC<{ member: Pick<Profile, 'id' | 'fullName'>; onClose: () => void }> = ({ member, onClose }) => {
  const [impact, setImpact] = useState<OffboardingImpact | null>(null);
  const [replacement, setReplacement] = useState('');
  const [status, setStatus] = useState<'SUSPENDED' | 'REVOKED'>('REVOKED');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<OffboardingResult | null>(null);

  const load = useCallback(async () => {
    try { setImpact(await usersApi.offboardingImpact(member.id)); setError(null); } catch (e) { setError(errorMessage(e)); }
  }, [member.id]);
  useEffect(() => { void load(); }, [load]);

  const run = async () => {
    setBusy(true); setError(null);
    try { setDone(await usersApi.offboard(member.id, { replacementId: replacement || null, status, reason: reason.trim() || null })); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };
  const total = impact ? Object.values(impact.counts).reduce((a, b) => a + b, 0) : 0;

  return (
    <Dialog title={`Offboard · ${member.fullName}`} description="See what is attached to this person, choose who takes it, then close the account. The history, chats and reports are kept." onClose={onClose} wide>
      <div className="space-y-3" data-testid="offboarding-dialog">
        {error && <p role="alert" className="text-xs font-semibold text-rose-600">{error}</p>}
        {!impact && !error && <p className="text-xs text-slate-500" role="status">Loading…</p>}
        {done ? (
          <div role="status" className="text-xs text-slate-700 space-y-1">
            <p className="font-semibold text-emerald-700">The account is now {done.status === 'REVOKED' ? 'revoked' : 'suspended'} and sign-in is blocked.</p>
            <p>Moved: {done.moved.customers} client(s), {done.moved.verifications} verification(s), {done.moved.tasks} task(s), {done.moved.members} team member(s), {done.moved.reports} pending report(s).</p>
            {done.queued > 0 && <p><b>{done.queued}</b> item(s) are waiting in the <b>Reassignment Required</b> queue for a manager to assign.</p>}
            <div className="pt-1"><button type="button" className="px-4 py-2 rounded-xl bg-blue-600 text-white text-xs font-bold" onClick={onClose}>Close</button></div>
          </div>
        ) : impact && (
          <>
            <p className="text-xs text-slate-600"><b>{impact.employee.name}</b> · {impact.employee.team ? `${impact.employee.team}, ` : ''}{impact.employee.department ?? 'no department'}{impact.employee.isMetaVerifier ? ' · Meta Verifier' : ''}{impact.employee.isTechnicalConsultant ? ' · Technical Consultant' : ''}</p>
            <ul className="text-xs text-slate-700 grid sm:grid-cols-2 gap-x-4 gap-y-1" aria-label="What is attached to this person">
              {COUNT_LABEL.map(([k, label]) => <li key={k} className="flex justify-between border-b border-slate-100 py-0.5"><span>{label}</span><b>{impact.counts[k]}</b></li>)}
            </ul>
            {impact.needsInterimHead && <p role="note" className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">A Department Head&apos;s pending approvals are never moved to an arbitrary person: the department is placed in the queue and the Operations Head / Super Admin are told it needs an interim or new head.</p>}
            {!impact.needsInterimHead && (
              <label className="block text-xs text-slate-600">
                <span className="block font-semibold mb-1">Who takes the work</span>
                <select className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs min-w-[16rem]" value={replacement} onChange={e => setReplacement(e.target.value)}>
                  <option value="">Nobody now: leave it in the Reassignment Required queue</option>
                  {impact.candidates.map(c => <option key={c.id} value={c.id}>{c.name} ({c.role})</option>)}
                </select>
                {impact.candidates.length === 0 && total > 0 && <span className="block text-[11px] text-slate-500 mt-1">No colleague of the same kind is available, so everything will wait in the queue.</span>}
              </label>
            )}
            <div className="flex flex-wrap gap-3 text-xs text-slate-700">
              <label className="flex items-center gap-1.5"><input type="radio" name="offboard-status" checked={status === 'REVOKED'} onChange={() => setStatus('REVOKED')} /> Revoke (left the company)</label>
              <label className="flex items-center gap-1.5"><input type="radio" name="offboard-status" checked={status === 'SUSPENDED'} onChange={() => setStatus('SUSPENDED')} /> Suspend (leave, can come back)</label>
            </div>
            <label className="block text-xs text-slate-600">
              <span className="block font-semibold mb-1">Reason (kept on record)</span>
              <input className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-xs" maxLength={500} value={reason} onChange={e => setReason(e.target.value)} />
            </label>
            <div className="flex justify-end gap-2">
              <button type="button" className="px-4 py-2 rounded-xl border border-slate-300 text-xs font-bold text-slate-700" onClick={onClose}>Cancel</button>
              <button type="button" className="px-4 py-2 rounded-xl bg-rose-600 text-white text-xs font-bold disabled:opacity-60" disabled={busy} onClick={() => void run()}>{busy ? 'Working…' : status === 'REVOKED' ? 'Offboard and revoke access' : 'Offboard and suspend'}</button>
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
};
