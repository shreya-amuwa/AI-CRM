import { confirmAction } from '../feedback/feedbackStore';

/**
 * Switching department or function re-opens the dashboard. When a form on the page has been typed into and not submitted, ask first.
 * (There was no shared "unsaved changes" convention, so this watches every form on the page: any input marks its form, submit / reset clears it.)
 */
const dirty = new Set<HTMLFormElement>();
let installed = false;

export function installUnsavedGuard() {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  document.addEventListener('input', e => {
    const form = (e.target as HTMLElement | null)?.closest?.('form');
    if (form) dirty.add(form as HTMLFormElement);
  }, true);
  const clear = (e: Event) => dirty.delete(e.target as HTMLFormElement);
  document.addEventListener('submit', clear, true);
  document.addEventListener('reset', clear, true);
}

export function hasUnsavedForm(): boolean {
  for (const f of [...dirty]) {
    if (!f.isConnected) dirty.delete(f);
  }
  return dirty.size > 0;
}

/** True when it is fine to switch: nothing unsaved, or the person agreed (in the CRM's own dialog) to lose it. */
export async function confirmLeaveUnsaved(): Promise<boolean> {
  if (!hasUnsavedForm()) return true;
  const ok = await confirmAction({
    title: 'Switch without saving?',
    description: 'You have changes on this page that are not saved. What you typed will be lost.',
    confirmLabel: 'Switch without saving', cancelLabel: 'Stay on this page', variant: 'destructive'
  });
  if (ok) dirty.clear();
  return ok;
}
