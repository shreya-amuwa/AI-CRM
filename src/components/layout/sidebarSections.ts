import { useCallback, useState } from 'react';

/**
 * Which labelled sections of a long side menu are closed. Remembered per menu in this browser only (a convenience: a cleared or blocked
 * storage simply shows every section open). Pass null to switch the behaviour off (every section stays open, no chevrons).
 */
export function useCollapsedSections(menu: string | null) {
  const storageKey = menu ? `crm.sidebar.closed.${menu}` : null;
  const [closed, setClosed] = useState<string[]>(() => {
    if (!storageKey) return [];
    try {
      const raw = window.localStorage.getItem(storageKey);
      const list: unknown = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : [];
    } catch {
      return [];
    }
  });
  const toggle = useCallback((label: string) => {
    setClosed(prev => {
      const next = prev.includes(label) ? prev.filter(x => x !== label) : [...prev, label];
      try { if (storageKey) window.localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* storage blocked: still works for this visit */ }
      return next;
    });
  }, [storageKey]);
  return { enabled: !!storageKey, isCollapsed: (label: string) => closed.includes(label), toggle };
}
