import { useEffect, useSyncExternalStore } from 'react';
import { lockScroll } from '../../lib/scrollLock';

/**
 * The hamburger menu, shared by every dashboard (only one is on screen at a time).
 *   Phones and tablets (< 1024px): the sidebar is a drawer that the hamburger opens and closes.
 *   Desktop (>= 1024px): the hamburger collapses and expands the sidebar; the choice is remembered.
 */
const KEY = 'amuwa.sidebar.collapsed';
const DESKTOP = '(min-width: 1024px)';

interface MenuState {
  open: boolean;
  collapsed: boolean;
}

const readCollapsed = () => {
  try {
    return window.localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
};

/** Lets CSS widen the page content while the sidebar is collapsed (see index.css). */
const reflect = (collapsed: boolean) => {
  if (typeof document === 'undefined') return;
  if (collapsed) document.documentElement.dataset.sidebar = 'collapsed';
  else delete document.documentElement.dataset.sidebar;
};

let state: MenuState = { open: false, collapsed: typeof window === 'undefined' ? false : readCollapsed() };
const listeners = new Set<() => void>();
reflect(state.collapsed);
const set = (next: MenuState) => {
  state = next;
  reflect(next.collapsed);
  listeners.forEach(l => l());
};

export const isDesktop = () => typeof window !== 'undefined' && window.matchMedia(DESKTOP).matches;

export function toggleMenu() {
  if (isDesktop()) {
    const collapsed = !state.collapsed;
    try {
      window.localStorage.setItem(KEY, collapsed ? '1' : '0');
    } catch {
      /* private window: the choice just is not remembered */
    }
    set({ ...state, collapsed });
  } else {
    set({ ...state, open: !state.open });
  }
}

export function closeMenu() {
  if (state.open) set({ ...state, open: false });
}

export function useMenu(): MenuState & { toggle: () => void; close: () => void } {
  const snap = useSyncExternalStore(
    cb => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    () => state,
    () => state
  );
  // the drawer closes on Escape, and when the window grows to desktop width
  useEffect(() => {
    if (!snap.open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeMenu();
    const mq = window.matchMedia(DESKTOP);
    const onChange = () => mq.matches && closeMenu();
    document.addEventListener('keydown', onKey);
    mq.addEventListener('change', onChange);
    const unlock = lockScroll();
    return () => {
      document.removeEventListener('keydown', onKey);
      mq.removeEventListener('change', onChange);
      unlock();
    };
  }, [snap.open]);
  return { ...snap, toggle: toggleMenu, close: closeMenu };
}
