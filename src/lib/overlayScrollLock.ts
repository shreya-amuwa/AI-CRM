import { lockScroll } from './scrollLock';

/**
 * Stops the page behind ANY pop-up, dialog or drawer from scrolling, without every one of them having to ask.
 *
 * There are dozens of drawers and dialogs (and more will be added); only a few asked for the lock, so on the others the page behind
 * scrolled when the wheel was turned over the pop-up. Instead of editing each one, this watches the page: while an element that covers
 * (almost) the whole screen is shown on top of it, the page is locked (src/lib/scrollLock.ts, which always gives scrolling back
 * when the last one lets go); when the pop-up closes, or is removed, the lock is released.
 *
 * What counts as such an element: position fixed, at least 90% of the window in width and height, visible, able to take the
 * pointer (a toast layer that lets clicks through is not one), and stacked above the page (z-index 10 or more - a decorative
 * background behind the page never locks it). The sidebar drawer's own panel does not cover the screen; its dim backdrop does, and it
 * already holds the lock through menuState (locks are counted, so two holders are fine).
 */
const SELECTOR = '.fixed, [role="dialog"], [aria-modal="true"], [style*="fixed"]';
const COVER = 0.9;

export function coversScreen(el: Element): boolean {
  const cs = window.getComputedStyle(el);
  if (cs.position !== 'fixed' || cs.display === 'none' || cs.visibility === 'hidden' || cs.pointerEvents === 'none' || Number(cs.opacity) === 0) return false;
  const z = Number.parseInt(cs.zIndex, 10);
  if (!Number.isFinite(z) || z < 10) return false;
  if (el.getClientRects().length === 0) return false; // inside something that is not displayed
  const r = el.getBoundingClientRect();
  return r.width >= window.innerWidth * COVER && r.height >= window.innerHeight * COVER;
}

export const overlayIsOpen = (root: ParentNode = document.body): boolean => Array.from(root.querySelectorAll(SELECTOR)).some(coversScreen);

/** Starts watching the page; returns a function that stops it (and releases the lock). */
export function watchOverlays(): () => void {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return () => undefined;
  let release: (() => void) | null = null;
  let queued = false;
  const check = () => {
    queued = false;
    const open = overlayIsOpen();
    if (open && !release) release = lockScroll();
    else if (!open && release) { release(); release = null; }
  };
  // one check per frame however many changes the page made
  const schedule = () => {
    if (queued) return;
    queued = true;
    window.requestAnimationFrame(check);
  };
  const observer = new MutationObserver(schedule);
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'open', 'aria-hidden'] });
  window.addEventListener('resize', schedule);
  schedule();
  return () => {
    observer.disconnect();
    window.removeEventListener('resize', schedule);
    if (release) { release(); release = null; }
  };
}
