/**
 * The in-app feedback state (src/lib/feedback/feedbackStore.ts) and the safe error message (src/lib/feedback/errors.ts), without a browser:
 * nothing is confirmed without a provider on the page, one dialog at a time and the queue is bounded, an answer is given once, dismissing
 * is "no", a cancelled input is null (not ''), the toast stack is bounded and a repeated message is not stacked, technical errors never
 * reach the screen.
 */
import {
  MAX_QUEUED, MAX_TOASTS, TOAST_MS, confirmAction, dismissToast, getFeedbackState, promptInput, registerFeedbackHost, resetFeedbackForTests, settleDialog,
  showDetails, toast
} from '../../src/lib/feedback/feedbackStore.js';
import { NETWORK_MESSAGE, PERMISSION_MESSAGE, RATE_MESSAGE, SESSION_MESSAGE, userMessage } from '../../src/lib/feedback/errors.js';
import { clearToasts, errorKind, updateToast } from '../../src/lib/feedback/feedbackStore.js';

let passed = 0;
function check(ok: unknown, label: string, extra?: unknown) {
  if (!ok) { console.error(`FAILED: ${label}`, extra === undefined ? '' : JSON.stringify(extra)); process.exit(1); }
  passed++;
  console.log(`ok - ${label}`);
}
const tick = () => new Promise(r => setTimeout(r, 0));
const origWarn = console.warn;
console.warn = () => undefined;

// ---------------------------------------------------------------------------- no provider: never confirmed
resetFeedbackForTests();
check((await confirmAction({ title: 'Delete?' })) === false && (await promptInput({ title: 'Why?', label: 'Reason' })) === null,
  'without a provider on the page nothing is confirmed (an action never runs unasked)');

// ---------------------------------------------------------------------------- one at a time, answered once
resetFeedbackForTests();
const unregister = registerFeedbackHost();
const a = confirmAction({ title: 'First?' });
const b = confirmAction({ title: 'Second?', variant: 'destructive' });
await tick();
check(getFeedbackState().dialogs.length === 2 && getFeedbackState().dialogs[0].options.title === 'First?', 'two requests: the first is shown, the second waits its turn');
const first = getFeedbackState().dialogs[0];
settleDialog(first.id, true);
settleDialog(first.id, false); // a second answer to the same dialog is ignored
check((await a) === true && getFeedbackState().dialogs[0].options.title === 'Second?', 'confirmed once; the next dialog follows');
settleDialog(getFeedbackState().dialogs[0].id, false);
check((await b) === false, 'dismissed is "no"');

const pending = Array.from({ length: MAX_QUEUED + 2 }, (_, i) => confirmAction({ title: `Q${i}` }));
await tick();
check(getFeedbackState().dialogs.length === MAX_QUEUED, `at most ${MAX_QUEUED} dialogs wait`);
const extra = await Promise.race([pending[MAX_QUEUED + 1], new Promise(r => setTimeout(() => r('still waiting'), 20))]);
check(extra === false, 'a request beyond the queue is answered "no" at once (never left hanging)');
for (const d of [...getFeedbackState().dialogs]) settleDialog(d.id, false);
await Promise.all(pending);

const reason = promptInput({ title: 'Reason?', label: 'Reason' });
await tick();
settleDialog(getFeedbackState().dialogs[0].id, '');
check((await reason) === '', 'an input submitted empty is "" (it was not cancelled)');
const cancelled = promptInput({ title: 'Reason?', label: 'Reason' });
await tick();
settleDialog(getFeedbackState().dialogs[0].id, null);
check((await cancelled) === null, 'a cancelled input is null');
const info = showDetails({ title: 'Follow-up', details: ['Time: 10:00'] });
await tick();
check(getFeedbackState().dialogs[0].type === 'confirm' && (getFeedbackState().dialogs[0].options as { acknowledgeOnly?: boolean }).acknowledgeOnly === true, 'details are shown with a single Close');
settleDialog(getFeedbackState().dialogs[0].id, true);
await info;

// the provider leaves the page while something waits: it is answered "no", not left hanging
const orphan = confirmAction({ title: 'Orphan?' });
await tick();
unregister();
check((await orphan) === false && getFeedbackState().dialogs.length === 0, 'when the provider goes away, waiting dialogs are cancelled');

// ---------------------------------------------------------------------------- toasts
resetFeedbackForTests();
const id = toast.success('Customer details updated.');
toast.success('Customer details updated.');
check(getFeedbackState().toasts.length === 1 && getFeedbackState().toasts[0].repeat === 2, 'the same message again refreshes the toast shown (no stack of copies)');
toast.error('Unable to save changes.');
toast.warning('Some records could not be updated.');
toast.info('Report generation has started.');
toast.error('Connection lost.', { durationMs: null });
toast.info('A new update is available.');
const ts = getFeedbackState().toasts;
check(ts.length === MAX_TOASTS && ts.some(t => t.durationMs === null), `at most ${MAX_TOASTS} toasts; a persistent one is kept over passing ones`);
check(TOAST_MS.error > TOAST_MS.warning && TOAST_MS.warning > TOAST_MS.info && TOAST_MS.info >= TOAST_MS.success, 'errors stay longer than warnings, warnings longer than information');
check(ts[0].kind !== 'success', 'the oldest passing toast made room first');
dismissToast(ts[0].id);
check(getFeedbackState().toasts.length === MAX_TOASTS - 1, 'a toast can be closed');
check(toast.error('') > 0 && getFeedbackState().toasts.some(t => t.message === 'Something went wrong. Please try again.'), 'an empty error message gets a readable one');
void id;

// ---------------------------------------------------------------------------- safe messages
check(userMessage(new Error('This invoice is already paid.')) === 'This invoice is already paid.', 'a message written for people is kept');
check(userMessage(new Error('duplicate key value violates unique constraint "x_pkey"'), 'Could not save.') === 'Could not save.', 'a database error is not shown');
check(userMessage(new Error('TypeError: Cannot read properties of undefined (reading "id")'), 'Could not save.') === 'Could not save.', 'a script error is not shown');
check(userMessage({ message: 'select * from customers where id = 1' }, 'Could not load.') === 'Could not load.', 'SQL is not shown');
check(userMessage(new Error('at foo (app.js:1:2)\n at bar (app.js:3:4)'), 'x') === 'x', 'a stack trace is not shown');
check(userMessage({ code: 'NETWORK_ERROR', message: 'Failed to fetch' }) === NETWORK_MESSAGE, 'a lost connection says so');
check(userMessage('x'.repeat(400), 'short') === 'short', 'a very long text is not shown');
check(userMessage(undefined) === 'Something went wrong. Please try again.', 'nothing: the default sentence');


// ---------------------------------------------------------------------------- Phase 1: loading, promise, fromError, defaults (docs/crm-enhancement-roadmap.md)
{
  clearToasts();
  const id = toast.loading('Saving changes…');
  const t0 = getFeedbackState().toasts.find(t => t.id === id)!;
  check(t0.kind === 'loading' && t0.durationMs === null, 'a loading toast stays until it is updated');
  updateToast(id, 'success', 'Changes saved successfully.');
  const t1 = getFeedbackState().toasts.find(t => t.id === id)!;
  check(t1.kind === 'success' && t1.message === 'Changes saved successfully.' && t1.durationMs === 4000 && getFeedbackState().toasts.length === 1,
    'it turns into the success toast in place (one toast, then it disappears by itself)');
  check(updateToast(99999, 'info', 'Shown again.') > 0 && getFeedbackState().toasts.some(t => t.message === 'Shown again.'), 'updating a toast that was closed shows it again');

  clearToasts();
  let during = '';
  const ok = await toast.promise(new Promise<number>(r => setTimeout(() => { during = getFeedbackState().toasts.map(t => t.kind).join(','); r(7); }, 10)),
    { loading: 'Saving lead…', success: v => `Lead ${v} saved successfully.`, error: 'Unable to save lead.' });
  check(ok === 7 && during === 'loading', 'toast.promise: loading while the request runs, the value is returned');
  check(getFeedbackState().toasts.length === 1 && getFeedbackState().toasts[0].kind === 'success' && getFeedbackState().toasts[0].message === 'Lead 7 saved successfully.',
    'success only after the answer, in the same toast');

  clearToasts();
  let threw = false;
  try { await toast.promise(Promise.reject(Object.assign(new Error('duplicate key value violates unique constraint "c"'), { code: 'INTERNAL' })), { loading: 'Saving…', success: 'Saved.', error: 'Unable to save lead.' }); }
  catch { threw = true; }
  check(threw && getFeedbackState().toasts[0].kind === 'error' && getFeedbackState().toasts[0].message === 'Unable to save lead.', 'a failure: the error toast with the fallback (no database text), and the promise still rejects');

  clearToasts();
  await toast.promise(Promise.reject({ code: 'CONFLICT', message: 'A customer with this number already exists.' }), { loading: 'Saving…', success: 'Saved.', error: 'x' }).catch(() => undefined);
  check(getFeedbackState().toasts[0].kind === 'warning' && getFeedbackState().toasts[0].message === 'A customer with this number already exists.', 'a duplicate is a warning with the server\'s readable message');

  clearToasts();
  toast.fromError({ code: 'VALIDATION_ERROR', message: 'Required customer information is missing.' }, 'x');
  toast.fromError({ code: 'FORBIDDEN', status: 403, message: '' }, 'x');
  const kinds = getFeedbackState().toasts.map(t => `${t.kind}:${t.message}`);
  check(kinds[0] === 'warning:Required customer information is missing.' && kinds[1] === `error:${PERMISSION_MESSAGE}`, 'fromError: something to fix is a warning; a refusal without a message says "no permission"', kinds);
  check(errorKind({ code: 'NOT_FOUND' }) === 'error' && errorKind(null) === 'error' && errorKind({ code: 'CONFLICT' }) === 'warning', 'errorKind');
  check(userMessage({ status: 401 }, 'x') === SESSION_MESSAGE && userMessage({ code: 'RATE_LIMITED' }, 'x') === RATE_MESSAGE, 'clear defaults for an expired session and too many attempts');
  check(userMessage({ code: 'FORBIDDEN', message: 'Only Accounts can confirm payments.' }, 'x') === 'Only Accounts can confirm payments.', 'a readable refusal keeps its own words');

  clearToasts();
  for (let i = 0; i < 6; i++) toast.loading(`Uploading document ${i}…`);
  check(getFeedbackState().toasts.length === 4, 'loading toasts are bounded like the others');
  clearToasts();
}
console.warn = origWarn;
console.log(`\n=== APP FEEDBACK UNIT TESTS PASSED (${passed}) ===`);
