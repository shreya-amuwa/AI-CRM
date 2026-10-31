import { useCallback, useRef } from 'react';
import { fitHeight, isShortViewport, keyboardOpen } from './viewportFit';

const isTextField = (el: Element | null) => !!el && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'submit', 'file'].includes((el as HTMLInputElement).type)) || (el as HTMLElement).isContentEditable);

/**
 * Makes an element as tall as the room that is visible under it, so a chat fills the page on a phone as well as on a desktop. It follows
 * window resizes, rotation, the address bar and the on-screen keyboard.
 *
 * It returns a callback ref, not a ref object: the measuring starts when the element appears and stops (and its height is taken off) when it
 * goes away or when the ref moves to another element. The earlier version measured once, on the first render, and React then re-used that
 * element for something else, which kept the height on it.
 *
 * While the keyboard is open it sets `data-kbd="1"` on the page (the tab bar hides itself) and, on a very short window,
 * `data-vshort="1"` (the chat hides its title bar). `reserveBelow` says how much room something fixed at the bottom of the window takes.
 */
export function useFillViewport<T extends HTMLElement>(reserveBelow?: () => number) {
  const reserve = useRef(reserveBelow);
  reserve.current = reserveBelow;
  const cleanup = useRef<(() => void) | null>(null);

  const attach = useCallback((el: T | null) => {
    cleanup.current?.();
    cleanup.current = null;
    if (!el) return;
    const root = document.documentElement;
    const vv = window.visualViewport;
    const touch = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
    let frame = 0;

    const fit = () => {
      frame = 0;
      const viewportHeight = vv?.height ?? window.innerHeight;
      const kbd = keyboardOpen({ layoutHeight: window.innerHeight, viewportHeight, textFieldFocused: isTextField(document.activeElement) && el.contains(document.activeElement), touch });
      if (kbd) root.setAttribute('data-kbd', '1'); else root.removeAttribute('data-kbd');
      if (kbd && isShortViewport(viewportHeight)) root.setAttribute('data-vshort', '1'); else root.removeAttribute('data-vshort');
      // with the keyboard open the tab bar is hidden, so it takes no room
      const below = kbd ? 0 : reserve.current?.() ?? 0;
      el.style.height = `${fitHeight({ elementTop: el.getBoundingClientRect().top, viewportHeight, viewportOffsetTop: vv?.offsetTop ?? 0, reserveBelow: below })}px`;
    };
    // one measurement per frame however many events arrive
    const schedule = () => { if (!frame) frame = window.requestAnimationFrame(fit); };

    fit();
    const later = window.setTimeout(schedule, 300); // fonts and the bar above settle
    window.addEventListener('resize', schedule);
    window.addEventListener('orientationchange', schedule);
    window.addEventListener('focusin', schedule);
    window.addEventListener('focusout', schedule);
    vv?.addEventListener('resize', schedule);
    vv?.addEventListener('scroll', schedule);
    // the bar above the chat can change height (the channel tabs appear, a banner opens): follow it
    const bar = el.parentElement;
    const ro = typeof ResizeObserver !== 'undefined' && bar ? new ResizeObserver(schedule) : null;
    // (the parent grows or shrinks with what sits above or below the panel; the panel's own change settles at the same height)
    if (ro && bar) ro.observe(bar);

    cleanup.current = () => {
      window.clearTimeout(later);
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('orientationchange', schedule);
      window.removeEventListener('focusin', schedule);
      window.removeEventListener('focusout', schedule);
      vv?.removeEventListener('resize', schedule);
      vv?.removeEventListener('scroll', schedule);
      ro?.disconnect();
      root.removeAttribute('data-kbd');
      root.removeAttribute('data-vshort');
      el.style.height = '';
    };
  }, []);

  // (React calls the ref with null when the element goes away, which stops the measuring)
  return attach;
}
