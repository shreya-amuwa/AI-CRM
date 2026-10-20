import { useLayoutEffect, useRef } from 'react';

/**
 * Makes an element as tall as the room left under it in the window (so a chat fills the page whatever the height of the bar
 * above it is, on a phone as well as on a desktop). It follows window resizes, rotation and the phone's address bar.
 */
export function useFillViewport<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const fit = () => {
      const top = el.getBoundingClientRect().top + window.scrollY;
      const room = (window.visualViewport?.height ?? window.innerHeight) - top;
      el.style.height = `${Math.max(420, Math.floor(room))}px`;
    };
    fit();
    const later = window.setTimeout(fit, 300); // fonts and the bar above settle
    window.addEventListener('resize', fit);
    window.visualViewport?.addEventListener('resize', fit);
    return () => {
      window.clearTimeout(later);
      window.removeEventListener('resize', fit);
      window.visualViewport?.removeEventListener('resize', fit);
    };
  }, []);
  return ref;
}
