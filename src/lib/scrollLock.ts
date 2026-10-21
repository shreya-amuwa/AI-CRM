/**
 * Stops the page behind a drawer or dialog from scrolling - and ALWAYS gives scrolling back.
 *
 * Several parts of the screen can ask for the lock at the same time (the sidebar drawer is read by the header, the sidebar and
 * the menu button; a dialog can open over a drawer). Each used to remember "what the page had before me" and put it back, so
 * the second one remembered "hidden" and the page stayed locked for good after the drawer closed. Here the first lock saves
 * the page's own value, the last release restores it.
 */
let locks = 0;
let saved = '';

export function lockScroll(): () => void {
  if (typeof document === 'undefined') return () => undefined;
  if (locks++ === 0) {
    saved = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--locks <= 0) {
      locks = 0;
      document.body.style.overflow = saved;
    }
  };
}
