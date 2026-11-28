# In-app feedback: toasts, confirmations and input dialogs

The CRM never uses the browser's own `alert()`, `confirm()` or `prompt()`. Those pop-ups look different in every browser, cannot be
styled and stop the page. Instead every screen uses one shared system, drawn by `<AppFeedbackProvider>`
(`src/components/feedback/AppFeedback.tsx`). It is mounted once around the whole app in `src/main.tsx`: the staff CRM, the customers'
dashboard (`/client/`), the booking pages and the set-password page.

| What | Use | When |
|---|---|---|
| `toast.success / .error / .warning / .info(message, { title?, durationMs?, action? })` | a short message in the corner | a finished operation, a non-blocking problem |
| `await confirmAction({ title, description?, details?, confirmLabel?, cancelLabel?, variant?, requireText?, onConfirm? })` | a decision | before a significant or irreversible action |
| `await promptInput({ title, label, required?, multiline?, maxLength?, ... })` | a short text (a reason) | when the action needs one |
| `await showDetails({ title, description?, details? })` | information with one Close button | details that need reading |
| an inline message next to the field (`role="alert"`, `aria-invalid`) | form validation | a missing or wrong field |

The functions can be called from any handler (they do not need a hook). `useToast()`, `useConfirm()` and `usePrompt()` return the same
functions, for components that prefer hooks. The state lives in `src/lib/feedback/feedbackStore.ts` (no React).

## Confirmations

```tsx
import { confirmAction, toast } from '../feedback/AppFeedback';

const remove = async (id: string) => {
  if (!(await confirmAction({
    title: 'Delete this report draft?',                       // what exactly happens: never "Are you sure?"
    description: 'The draft is removed. This cannot be undone.',
    confirmLabel: 'Delete draft', cancelLabel: 'Keep draft',
    variant: 'destructive'
  }))) return;                                               // cancelled, Escape, or closed: nothing happens
  try {
    await workReportsApi.deleteDraft(id);
    toast.success('Draft deleted.');                         // only after the server confirmed it
  } catch (e) {
    toast.error(userMessage(e, 'The draft could not be deleted.'));
  }
};
```

Rules the provider keeps for every caller:

* **One dialog at a time.** A second request waits its turn. At most 5 wait; anything beyond is answered "no" at once, so a promise is
  never left hanging.
* **Dismissing is "no".** Cancel and Escape always cancel. A click outside cancels an ordinary dialog, but not a destructive one.
* **Destructive dialogs** (`variant: 'destructive'`) have a red confirm button and open with the **safe** button focused, so pressing
  Enter does not delete. Use red only for destructive actions.
* **Typed confirmation** (`requireText: 'DELETE'` or the record's name) is only for genuinely high-risk, irreversible actions (deleting a
  department, permanently deleting a person).
* **Running the action inside the dialog** (`onConfirm: async () => …`): the dialog shows "Working…" and runs the action once, however
  often the button is clicked. If it fails, the dialog stays open with the reason so the person can try again or cancel. It resolves `true`
  only when the action succeeded. Use this for actions where retrying in place helps, such as a payment.
* **Focus.** The dialog takes the focus, Tab stays inside it, and the focus goes back to the button that opened it.
* **No provider on the page** (a test page that forgot it): nothing is confirmed (`false` / `null`), so an action never runs unasked.

## Input dialogs

```tsx
const reason = await promptInput({
  title: `Cancel "${m.title}"?`,
  description: 'Everyone invited is told, with the reason if you give one.',
  label: 'Reason for cancelling', required: isCeoMeeting, multiline: true, maxLength: 500,
  confirmLabel: 'Cancel meeting', cancelLabel: 'Keep meeting', variant: 'destructive'
});
if (reason === null) return;      // cancelled: different from an empty optional reason ('')
```

An empty value cannot be submitted when `required` is set. The field shows "This is required." inline. `maxLength` shows a counter.

## Toasts

* Success and information disappear by themselves (4 and 5 seconds), warnings after 7 and errors after 9. Pass `durationMs: null` for a
  failure that must stay until it is closed. Hovering over or focusing a toast pauses it.
* At most 4 are shown. The same message again refreshes the one already shown (marked ×2) instead of stacking copies.
* On phones they appear at the top (clear of the keyboard and bottom buttons); on larger screens, bottom right.
* An error is announced to screen readers at once (`role="alert"`), the others politely (`role="status"`). Each one says
  "Error", "Warning" and so on in words, not only through its colour.
* Never show success before the server has confirmed it. Never put a raw server or database message in a toast: use
  `userMessage(err, fallback)` (`src/lib/feedback/errors.ts`). It keeps the API's own readable messages and replaces stack traces, SQL and
  library errors with the fallback. Technical details go to the error report (Sentry), not the screen.

### Toasts or the notification centre?

Toasts are temporary feedback about what the person just did ("Changes saved"). Business events (a meeting scheduled, a leave approved,
a customer assigned, a notice published) stay in the **notification centre**, with its unread count, history, push notifications, e-mail
and sound. That system is unchanged.

## Form validation

Do not use a toast or a dialog for a field error. Show the message next to the field (`role="alert"`, and `aria-invalid` on the field),
like the leave forms in `EmployeeProfileModal.tsx` or the outcome picker in `LeadQuickUpdate.tsx`. A problem that concerns the whole form
(the server refused it) goes in one compact message inside the form.

## What stays with the browser

These belong to the browser or the operating system, and are not replaced:

* the "Leave site? Changes you made may not be saved" warning (`beforeunload` in `TeamMemberManagement.tsx` and `AccessControlTab.tsx`);
* permission requests for notifications, camera, microphone and location (the CRM explains them first where useful);
* the "Install app" prompt (the `beforeinstallprompt` event's own `prompt()` in `src/lib/push/pushSupport.ts`);
* third-party code shipped as it is (`public/ocr`, the OCR engine).

## Keeping it this way

`supabase/tests/no_native_dialogs.test.ts` (part of `npm run test:unit`, so of CI) scans `src`, `server`, `shared`, `api`, `worker` and
`public/sw.js`. It fails on `alert(`, `confirm(`, `prompt(`, `window.confirm`, `window['alert']`, `globalThis.prompt`, `self.alert` and
`const { confirm } = window`. Comments are ignored. A file's own function that happens to be called `confirm` is allowed (the scan checks
that the file defines it). The project has no ESLint; this test is the lint rule.

Browser tests: `supabase/tests/ui_app_feedback.test.mjs` covers focus, keyboard, risk rules, retry, the queue, validation and toasts at
desktop, 390 px and 320 px. Test pages mount the provider by importing `supabase/tests/ui/withAppFeedback.tsx`. A test that used to answer
`page.on('dialog')` now calls `answerAppDialogs(page, { value })` (`supabase/tests/ui/appDialogs.mjs`) and reads what was asked with
`appDialogs(page)`.

## What was migrated (58 calls in 40 files)

| Area | Before | Now |
|---|---|---|
| CEOs (suspend), access control (make / remove CEO, switch employee with unsaved changes), Team Members tab | `window.confirm` | destructive confirmation |
| HR: offers (release, withdraw), placement, review submit, interview cancel (×2), HR staff roster, employee documents, "left company" | `window.confirm` | confirmation (destructive where it removes) |
| HR employee profile: leave and cancellation forms without the mail attachment, failed uploads | `alert` | inline form error |
| Meetings: cancel (reason), withdraw, Google Calendar disconnect, summary follow-up note, public booking cancel | `prompt` / `confirm` | input dialog / confirmation |
| Registrations: decline, permanent delete | `window.confirm` | destructive confirmation (permanent delete needs "DELETE" typed) |
| Wallet and income: cancel withdrawal (×2); incentive rule stop / delete; Razorpay payout | `window.confirm` | confirmation with the amount and destination |
| Departments: delete a custom department | `window.confirm` | destructive confirmation with the name typed |
| Crocodial: count past activity (×2), pause rollout, approve mapping, end mapping (reason) | `confirm` / `prompt` | confirmation / input dialog |
| Workflow: move a customer to the Meta Verifier / Technical Consultant (reason) | `prompt` | required input dialog |
| Reports draft delete, client calendar entry remove, field visit withdraw, secure chat key removal, accounts expense reset, Wabastore live-lead view clear | `confirm` | confirmation |
| Department / function switch with an unsaved form (`unsavedGuard.ts`, now async) | `confirm` | destructive confirmation |
| Notification centre (sent / refused), training panels (saved), member follow-up details | `alert` | toast / details dialog |
| Wabastore sample views (export, page engineering, capacity, SLA nudge) | `alert` claiming an action that never happened | an honest information toast ("not available on this view yet") |
| Wabastore lead update without an outcome | `alert` | inline error |

## Loading, submitting and offline (Phase 1, docs/crm-enhancement-roadmap.md)

* **`toast.loading('Uploading document…')`** shows a toast with a spinner that never disappears by itself. `updateToast(id, kind, message)`
  turns it into the result in place.
* **`await toast.promise(request, { loading, success, error })`** is one toast for the whole request: "Saving changes…" while it runs, then
  the success message (only after the server answered) or the failure. The failure is a **warning** when the person can fix it (the API said
  `VALIDATION_ERROR` or `CONFLICT`, for example a duplicate number) and an **error** otherwise. Its text goes through `userMessage`. The
  promise still resolves or rejects as the request did.
* **`toast.fromError(err, 'Unable to save lead.')`** applies the same rule for a failure handled in a `catch`.
* **`useSubmit()`** (`src/lib/feedback/useSubmit.ts`) for forms and action buttons:

  ```tsx
  const save = useSubmit();
  <button disabled={save.busy} onClick={() => save.run(() => leadsApi.create(form), { success: 'Lead saved successfully.', error: 'Unable to save lead.' })}>
  ```

  It runs one request at a time (a double click sends once) and keeps a `busy` flag for the button. It shows the toasts, with `loading` for
  slow requests and uploads. It resolves `{ ok, value | error }`, so the form can stay open on failure. Field validation stays inline: call
  `run()` only for a valid form.
* **Offline.** While the browser has no connection, one persistent warning says *You are offline: Internet connection unavailable*. It is
  replaced by *Back online.* when the connection returns. Failed requests still say what could not be done.
* **Clear defaults** when the server gives no readable message:
  * no permission: *You do not have permission to perform this action.*;
  * an expired session: *Your session has expired. Please sign in again.*;
  * too many attempts: *Too many attempts. Please wait a moment and try again.*;
  * offline: *Internet connection unavailable…*.

### Where an action's result goes (rule used from Phase 1 on)

| Result | Where |
| --- | --- |
| Success | Always a toast, after the server answered. |
| Failure of an **open form or dialog** (assign, create, forward) | Inside that form, with `userMessage(err, fallback)`. The form stays open so the person can correct it and try again. |
| Failure of a row, button or background action (a large upload, a row action) | A toast. A long action uses one loading toast that turns into the result. Trying again replaces the previous failure toast instead of leaving a stale error. |
| Field validation | Inline next to the field. |

Temporary green success banners that disappeared on a timer are replaced by success toasts.
