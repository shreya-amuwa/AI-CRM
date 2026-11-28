import { useCallback, useEffect, useRef, useState } from 'react';
import { toast, type PromiseMessages } from './feedbackStore';

/**
 * One action at a time, with feedback (docs/APP_FEEDBACK_SYSTEM.md "Submitting"):
 *
 *   const save = useSubmit();
 *   <button disabled={save.busy} onClick={() => save.run(() => api.saveLead(form), { success: 'Lead saved successfully.', error: 'Unable to save lead.' })}>
 *
 *  - a second click while the first request runs does nothing (no duplicate lead, payment or assignment);
 *  - success is shown only after the server answered; a failure shows a safe sentence (warning when the person can fix it, error otherwise);
 *  - with `loading` the toast says "Saving changes…" first and turns into the result in place (slow requests, uploads);
 *  - resolves { ok: true, value } or { ok: false, error } so the caller can keep the form open on failure.
 * Inline field validation stays inline: call run() only when the form is valid.
 */
export type SubmitResult<T> = { ok: true; value: T } | { ok: false; error: unknown };
export interface SubmitMessages<T> { success?: PromiseMessages<T>['success']; error: string; loading?: string }

export function useSubmit() {
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const run = useCallback(async <T,>(work: () => Promise<T>, messages: SubmitMessages<T>): Promise<SubmitResult<T> | null> => {
    if (running.current) return null;
    running.current = true;
    setBusy(true);
    try {
      let value: T;
      if (messages.loading) {
        value = await toast.promise(work(), { loading: messages.loading, success: messages.success ?? 'Done.', error: messages.error });
      } else {
        value = await work();
        if (messages.success) toast.success(typeof messages.success === 'function' ? messages.success(value) : messages.success);
      }
      return { ok: true, value };
    } catch (error) {
      if (!messages.loading) toast.fromError(error, messages.error);
      return { ok: false, error };
    } finally {
      running.current = false;
      if (mounted.current) setBusy(false);
    }
  }, []);

  return { busy, run };
}
