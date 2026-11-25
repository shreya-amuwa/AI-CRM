import React from 'react';
import { createRoot } from 'react-dom/client';
import { AppFeedbackProvider, confirmAction, promptInput, showDetails, toast } from '../../../src/components/feedback/AppFeedback';

// Buttons that ask the way the CRM's screens do; every answer and every "mutation" is written to window.__log.
const log = (x: unknown) => { ((window as any).__log ||= []).push(x); };
let mutations = 0;
let failOnce = true;
const Page: React.FC = () => (
  <div className="p-4 space-y-2">
    <button type="button" id="destructive" onClick={async () => {
      const ok = await confirmAction({ title: 'Delete this draft?', description: 'The draft is removed. This cannot be undone.', confirmLabel: 'Delete draft', cancelLabel: 'Keep draft', variant: 'destructive' });
      log({ destructive: ok }); if (ok) mutations++;
    }}>Delete draft</button>
    <button type="button" id="normal" onClick={async () => log({ normal: await confirmAction({ title: 'Release this offer?', confirmLabel: 'Release offer' }) })}>Release</button>
    <button type="button" id="retry" onClick={async () => {
      const ok = await confirmAction({ title: 'Send ₹1,000 now?', confirmLabel: 'Send', onConfirm: async () => {
        await new Promise(r => setTimeout(r, 150));
        mutations++;
        if (failOnce) { failOnce = false; throw new Error('The payment service did not answer.'); }
      } });
      log({ retry: ok });
    }}>Send money</button>
    <button type="button" id="typed" onClick={async () => log({ typed: await confirmAction({ title: 'Delete the Digitree department?', confirmLabel: 'Delete department', variant: 'destructive', requireText: 'Digitree' }) })}>Delete department</button>
    <button type="button" id="reason" onClick={async () => log({ reason: await promptInput({ title: 'Reject this request?', label: 'Reason for rejecting', required: true, multiline: true, maxLength: 200, confirmLabel: 'Reject request', variant: 'destructive' }) })}>Reject</button>
    <button type="button" id="optional" onClick={async () => log({ optional: await promptInput({ title: 'Cancel this booking?', label: 'Reason', confirmLabel: 'Cancel booking' }) })}>Cancel booking</button>
    <button type="button" id="two" onClick={() => { void confirmAction({ title: 'First question?' }).then(v => log({ first: v })); void confirmAction({ title: 'Second question?' }).then(v => log({ second: v })); }}>Two at once</button>
    <button type="button" id="details" onClick={() => void showDetails({ title: 'Follow-up: Asha', details: ['Time: 10:00', 'Notes: call back'] }).then(() => log({ details: 'closed' }))}>Details</button>
    <button type="button" id="ok" onClick={() => toast.success('Changes saved successfully.')}>Save</button>
    <button type="button" id="err" onClick={() => toast.error('Unable to save changes.')}>Fail</button>
    <button type="button" id="many" onClick={() => { for (let i = 1; i <= 6; i++) toast.info(`Update ${i}`); }}>Many</button>
  </div>
);
(window as any).mount = () => createRoot(document.getElementById('root')!).render(<AppFeedbackProvider><Page /></AppFeedbackProvider>);
(window as any).mutations = () => mutations;
