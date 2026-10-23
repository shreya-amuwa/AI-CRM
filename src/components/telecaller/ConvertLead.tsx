import React, { useEffect, useRef, useState } from 'react';
import { ArrowRightCircle } from 'lucide-react';
import type { BaAssignee, TelecallerLead } from '../../../shared/contracts';
import { errorMessage } from '../../lib/api/client';
import { businessAssociateApi } from '../../lib/api/endpoints';
import { Dialog, ErrorBanner, Field } from '../team-member/pipeline/shared';
import { tcBtn, tcInput } from './ui';

/**
 * The Telecaller's hand-over: a qualified lead (call status Interested) becomes a contact for a Business Associate of the department.
 * A lead converts once (the database refuses a second time); without a choice the Business Associate with the fewest open contacts gets it.
 */
export const ConvertLead: React.FC<{ lead: TelecallerLead; onDone: () => void }> = ({ lead, onDone }) => {
  const [open, setOpen] = useState(false);
  if (lead.converted) {
    return <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700 ring-1 ring-inset ring-emerald-200" title={`Handed over to ${lead.converted.businessAssociate || 'a Business Associate'}`}>Converted</span>;
  }
  const qualified = lead.callStatus === 'INTERESTED';
  return (
    <>
      <button
        type="button"
        className={`${tcBtn.link} inline-flex items-center gap-1 ${qualified ? '' : 'opacity-40 cursor-not-allowed no-underline'}`}
        disabled={!qualified}
        title={qualified ? 'Hand this qualified lead over to a Business Associate' : 'Set the call status to Interested first'}
        onClick={() => setOpen(true)}
        aria-label={`Convert ${lead.name} to a contact`}
      >
        <ArrowRightCircle className="w-3.5 h-3.5" aria-hidden="true" /> Convert
      </button>
      {open && <ConvertDialog lead={lead} onClose={() => setOpen(false)} onDone={() => { setOpen(false); onDone(); }} />}
    </>
  );
};

const ConvertDialog: React.FC<{ lead: TelecallerLead; onClose: () => void; onDone: () => void }> = ({ lead, onClose, onDone }) => {
  const [assignees, setAssignees] = useState<BaAssignee[] | null>(null);
  const [assigneeId, setAssigneeId] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  useEffect(() => {
    businessAssociateApi.assignees().then(setAssignees, err => (setError(errorMessage(err)), setAssignees([])));
  }, []);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy.current) return; // a double click must not convert the lead twice
    busy.current = true;
    setSaving(true);
    setError(null);
    try {
      await businessAssociateApi.convertLead(lead.id, { assigneeId: assigneeId || null, note: note.trim() || null });
      onDone();
    } catch (err) {
      setError(errorMessage(err));
      busy.current = false;
      setSaving(false);
    }
  };
  return (
    <Dialog title={`Convert ${lead.name} to a contact`} description="The Business Associate will find this client in their Tasks, with your notes." onClose={onClose} persistent>
      <form onSubmit={submit} className="space-y-3">
        <Field label="Hand over to" htmlFor="cv-assignee">
          <select id="cv-assignee" className={tcInput} value={assigneeId} onChange={e => setAssigneeId(e.target.value)} disabled={assignees === null}>
            <option value="">Assign automatically (fewest open contacts)</option>
            {(assignees ?? []).map(a => <option key={a.id} value={a.id}>{a.name} · {a.openContacts} open</option>)}
          </select>
        </Field>
        {assignees && assignees.length === 0 && !error && <p className="text-xs text-amber-700">Your department has no Business Associate yet. Ask your Department Head to add one.</p>}
        <Field label="Note for the Business Associate (optional)" htmlFor="cv-note">
          <textarea id="cv-note" className={`${tcInput} min-h-[84px]`} maxLength={1000} value={note} onChange={e => setNote(e.target.value)} placeholder="What did the client say? What do they need?" />
        </Field>
        {error && <ErrorBanner message={error} />}
        <div className="flex justify-end gap-2">
          <button type="button" className={tcBtn.secondary} onClick={onClose} disabled={saving}>Cancel</button>
          <button type="submit" className={tcBtn.primary} disabled={saving || (assignees?.length ?? 0) === 0}>{saving ? 'Converting…' : 'Convert to contact'}</button>
        </div>
      </form>
    </Dialog>
  );
};
