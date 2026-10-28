import React, { useEffect, useRef, useState } from 'react';
import { VISIT_PRIORITIES, type SalesVisitAssignee, type VisitPriority } from '../../../shared/contracts';
import { errorMessage } from '../../lib/api/client';
import { fieldVisitApi } from '../../lib/api/endpoints';
import { Dialog, ErrorBanner, Field, Spinner, btn, inputCls } from '../team-member/pipeline/shared';

const PRIORITY_LABEL: Record<VisitPriority, string> = { LOW: 'Low', NORMAL: 'Normal', HIGH: 'High', URGENT: 'Urgent' };

/**
 * The Sales Department Head hands a lead to a Telecaller, Business Associate or Sales member for a field visit, with a priority and the visit
 * instructions. The lead keeps its owner (nothing changes in the pipeline or the Accounts workflow); the person sees it under Field Visit ->
 * Department Head Assigned Leads. Who may be chosen, and whether the lead may be assigned, is decided by the database.
 */
export const AssignVisitDialog: React.FC<{ lead: { id: string; name: string }; onClose: () => void; onDone: (message: string) => void }> = ({ lead, onClose, onDone }) => {
  const [people, setPeople] = useState<SalesVisitAssignee[] | null>(null);
  const [who, setWho] = useState('');
  const [priority, setPriority] = useState<VisitPriority>('NORMAL');
  const [instructions, setInstructions] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const guard = useRef(false);

  useEffect(() => {
    fieldVisitApi.assignees().then(setPeople, err => setError(errorMessage(err)));
  }, []);

  const run = async (job: () => Promise<string>) => {
    if (guard.current) return;
    guard.current = true;
    setBusy(true);
    setError(null);
    try {
      onDone(await job());
    } catch (err) {
      setError(errorMessage(err));
      guard.current = false;
      setBusy(false);
    }
  };

  return (
    <Dialog title={`Assign ${lead.name} for a field visit`} description="The lead stays with its owner. The person you choose sees it under Field Visit and plans the visit." onClose={onClose} persistent>
      <form
        className="space-y-3"
        data-testid="visit-assign-form"
        onSubmit={e => {
          e.preventDefault();
          if (!who) return setError('Choose who will make the visit.');
          void run(async () => {
            const r = await fieldVisitApi.assign({ leadId: lead.id, assigneeId: who, priority, instructions: instructions.trim() || null });
            return `${lead.name} was ${r.reassigned ? 'reassigned' : 'assigned'} to ${r.assignee} for a field visit.`;
          });
        }}
      >
        {error && <ErrorBanner message={error} />}
        {!people && !error ? (
          <Spinner />
        ) : (
          <>
            <Field label="Who will make the visit" required htmlFor="visit-assignee">
              <select id="visit-assignee" className={inputCls} value={who} onChange={e => setWho(e.target.value)}>
                <option value="">Choose…</option>
                {(people ?? []).map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {p.role} · {p.team}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Priority" htmlFor="visit-priority">
              <select id="visit-priority" className={inputCls} value={priority} onChange={e => setPriority(e.target.value as VisitPriority)}>
                {VISIT_PRIORITIES.map(p => (
                  <option key={p} value={p}>
                    {PRIORITY_LABEL[p]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Visit instructions" htmlFor="visit-instructions">
              <textarea id="visit-instructions" rows={3} className={inputCls} value={instructions} onChange={e => setInstructions(e.target.value)} maxLength={1000} placeholder="What to do, who to meet, what to carry" />
            </Field>
          </>
        )}
        <div className="flex flex-wrap justify-between gap-2 pt-1">
          <button
            type="button"
            className={btn.danger}
            disabled={busy}
            onClick={() => {
              if (window.confirm(`Withdraw the field visit assignment of ${lead.name}?`)) void run(async () => {
                await fieldVisitApi.cancelAssignment(lead.id);
                return `The field visit assignment of ${lead.name} was withdrawn.`;
              });
            }}
          >
            Withdraw assignment
          </button>
          <div className="flex gap-2">
            <button type="button" className={btn.secondary} onClick={onClose} disabled={busy}>
              Close
            </button>
            <button type="submit" className={btn.primary} disabled={busy || !people}>
              {busy ? 'Saving…' : 'Assign for visit'}
            </button>
          </div>
        </div>
      </form>
    </Dialog>
  );
};
