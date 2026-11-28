import React, { useState } from 'react';
import { CheckCircle2, KeyRound, Send } from 'lucide-react';
import type { HandoverInfo, HandoverStage } from '../../../../shared/contracts';
import { pipelineApi } from '../../../lib/api/endpoints';
import { Dialog, ErrorBanner, inputCls, longDate } from '../../team-member/pipeline/shared';
import { userMessage } from '../../../lib/feedback/errors';

export const HANDOVER_LABEL: Record<HandoverStage, string> = {
  CONSULTANT: 'In verification (Meta Verifier / Technical Consultant)',
  DEPARTMENT_HEAD: 'With the Department Head',
  TEAM_LEAD: 'With the Team Lead',
  TEAM_MEMBER: 'With the Team Member'
};

/** Where the verified customer is in the hand-over, shown to the consultant once it has left them. */
export const HandoverBanner: React.FC<{ info: HandoverInfo | null; audience?: 'consultant' | 'sales' }> = ({ info, audience = 'consultant' }) => {
  if (!info || info.stage === 'CONSULTANT') return null;
  const steps: { label: string; at: string | null; who: string | null }[] = [
    { label: 'Department Head', at: info.toDepartmentHeadAt, who: info.sentBy ? `sent by ${info.sentBy}` : null },
    { label: 'Team Lead', at: info.passedToTeamLeadAt, who: info.teamLead?.fullName ?? null },
    { label: 'Team Member', at: info.assignedToMemberAt, who: info.teamMember?.fullName ?? null }
  ];
  return (
    <div className="p-4 rounded-2xl border border-emerald-200 bg-emerald-50 text-sm text-emerald-900" role="status">
      <p className="font-bold">{HANDOVER_LABEL[info.stage]}</p>
      <p className="mt-0.5 text-xs">
        {audience === 'sales'
          ? 'Verified and handed over. The Department Head, Team Lead and Team Member continue from here.'
          : 'Verified and handed over. Your review is closed; the team continues from here.'}
      </p>
      <ol className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs">
        {steps.map(s => (
          <li key={s.label} className={s.at ? 'font-semibold' : 'text-emerald-700/60'}>
            {s.at ? '✓ ' : '○ '}
            {s.label}
            {s.at ? ` · ${longDate(s.at)}` : ''}
            {s.at && s.who ? ` · ${s.who}` : ''}
          </li>
        ))}
      </ol>
    </div>
  );
};

/**
 * The client's panel login, read only. Accounts creates it (for every service) from the e-mail on the customer record, and the client sets
 * their own password from an e-mailed link - the verifier / consultant has nothing to type here and never sees a password.
 */
export const ClientLoginCard: React.FC<{ account: HandoverInfo['clientAccount'] | undefined }> = ({ account }) => (
  <section className="bg-white rounded-2xl border border-slate-200/80 p-5" aria-labelledby="client-login-heading">
    <div className="flex items-center gap-3">
      <span className="w-9 h-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0" aria-hidden="true">
        <KeyRound className="w-4 h-4" />
      </span>
      <div>
        <h2 id="client-login-heading" className="font-bold text-slate-900">
          Client panel login
        </h2>
        <p className="text-xs text-slate-500">Created by the Accounts team once the payment is verified. The client chooses their own password from an e-mailed link.</p>
      </div>
    </div>
    {account ? (
      <div className="mt-4 space-y-1">
        <p className="inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-700">
          <CheckCircle2 className="w-4 h-4" aria-hidden="true" /> Login created by Accounts
        </p>
        <p className="text-sm text-slate-700">
          <span className="font-mono break-all">{account.email}</span> · {longDate(account.createdAt)}
        </p>
      </div>
    ) : (
      <p className="mt-4 text-sm text-slate-500">Not created yet. Accounts creates it; you do not need to wait for it.</p>
    )}
  </section>
);

/** "Send to Department Head" with a confirmation. Enabled once everything is authorized (the client login is Accounts' job, not a condition). */
export const SendToDepartmentHead: React.FC<{
  customerId: string;
  businessName: string;
  ready: boolean;
  reason: string;
  onSent: () => void;
}> = ({ customerId, businessName, ready, reason, onSent }) => {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      await pipelineApi.sendToDepartmentHead(customerId, note.trim() || null);
      setOpen(false);
      onSent();
    } catch (err) {
      setError(userMessage(err));
      setBusy(false);
    }
  };

  return (
    <>
      <div className="flex flex-col items-end gap-1">
        <button
          type="button"
          disabled={!ready}
          title={ready ? undefined : reason}
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Send className="w-4 h-4" aria-hidden="true" /> Send to Department Head
        </button>
        {/* Say why it is greyed out, where the consultant looks (a hover tooltip is easy to miss). */}
        {!ready && (
          <span className="text-[11px] font-semibold text-amber-700" data-testid="send-reason">
            {reason}
          </span>
        )}
      </div>
      {open && (
        <Dialog
          title="Send to Department Head"
          description={`${businessName} is verified. The Department Head passes it to a Team Lead, who assigns it to a Team Member. Your review closes once you send it.`}
          onClose={() => !busy && setOpen(false)}
        >
          <label className="block text-xs font-medium text-slate-600" htmlFor="handover-note">
            Note for the Department Head (optional)
          </label>
          <textarea id="handover-note" rows={2} maxLength={1000} className={inputCls} value={note} onChange={e => setNote(e.target.value)} />
          {error && <ErrorBanner message={error} />}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setOpen(false)} disabled={busy} className="px-3.5 py-2 rounded-lg text-xs font-bold border border-slate-200 bg-white">
              Cancel
            </button>
            <button type="button" onClick={send} disabled={busy} className="px-3.5 py-2 rounded-lg text-xs font-bold bg-emerald-600 text-white disabled:opacity-40">
              {busy ? 'Sending…' : 'Yes, send'}
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
};
