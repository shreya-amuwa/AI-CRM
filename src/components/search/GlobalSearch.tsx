import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { getFeedbackState } from '../../lib/feedback/feedbackStore';
import { isMac, isSearchShortcut, type SearchPage } from '../../lib/search/searchEngine';

/**
 * Global search (Ctrl / Cmd + K, docs/GLOBAL_SEARCH_ARCHITECTURE.md). The always-loaded part: the provider (one keyboard listener for the
 * whole app), the trigger in the top bar, and useSearchPages() through which the open dashboard registers its own menu. The palette and the
 * record panel (CommandPalette.tsx) load the first time they are needed.
 */
const loadPalette = () => import('./CommandPalette');
const CommandPalette = React.lazy(() => loadPalette().then(m => ({ default: m.CommandPalette })));
const RecordPanelHost = React.lazy(() => loadPalette().then(m => ({ default: m.RecordPanelHost })));

/**
 * Shown for the moment the palette's code is still loading (the first Ctrl + K on a fresh page): the same field, so what is typed
 * straight away is kept and handed to the palette.
 */
const PaletteLoading: React.FC<{ draft: React.MutableRefObject<string>; onClose: () => void }> = ({ draft, onClose }) => {
  const [v, setV] = useState(draft.current);
  return (
    <div className="fixed inset-0 z-[150]" aria-busy="true">
      <div className="absolute inset-0 bg-slate-900/30 hidden sm:block" aria-hidden onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-label="Search"
        className="absolute inset-0 sm:inset-auto sm:left-1/2 sm:top-[12vh] sm:-translate-x-1/2 sm:w-[min(720px,calc(100vw-2rem))] bg-white sm:rounded-xl sm:border sm:border-slate-200 sm:shadow-2xl">
        <div className="flex items-center gap-2 px-4 h-14 border-b border-slate-200">
          <Search className="w-[18px] h-[18px] text-slate-400 shrink-0" aria-hidden />
          <input autoFocus value={v} onChange={e => { draft.current = e.target.value; setV(e.target.value); }} onKeyDown={e => { if (e.key === 'Escape') onClose(); }}
            placeholder="Search pages, people, customers, meetings…" aria-label="Search the CRM" maxLength={100}
            className="flex-1 min-w-0 h-full bg-transparent text-[15px] text-slate-900 placeholder:text-slate-400 focus:outline-none" />
        </div>
      </div>
    </div>
  );
};

interface PageSource { pages: SearchPage[]; onSelect: (navId: string) => void }
interface GlobalSearchCtx {
  enabled: boolean;
  openPalette: () => void;
  register: (src: PageSource) => () => void;
}
const Ctx = createContext<GlobalSearchCtx>({ enabled: false, openPalette: () => undefined, register: () => () => undefined });
export const useGlobalSearch = () => useContext(Ctx);

/** The record panel opens from the address (?open=record&type=...&id=...): a refresh, Back / Forward and a pasted link all work. */
export const RECORD_PARAM = 'record';
export const recordFromUrl = (search = typeof window === 'undefined' ? '' : window.location.search) => {
  const q = new URLSearchParams(search);
  if (q.get('open') !== RECORD_PARAM) return null;
  const type = q.get('type') || '';
  const id = q.get('id') || '';
  return ['employee', 'customer', 'lead', 'ticket', 'department'].includes(type) && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ? { type, id } : null;
};

export const GlobalSearchProvider: React.FC<{ userId: string | null; children: React.ReactNode }> = ({ userId, children }) => {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(() => !!recordFromUrl());
  const sources = useRef<PageSource[]>([]);
  const [, setVersion] = useState(0); // re-renders when a dashboard registers or leaves
  const enabled = !!userId;
  const draft = useRef('');
  // where the focus was when search opened: it goes back there when search closes
  const returnTo = useRef<HTMLElement | null>(null);
  const noteFocus = () => { returnTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; };
  // load the palette's code shortly after sign-in, so the first Ctrl + K opens it at once
  useEffect(() => {
    if (!enabled) return;
    const t = window.setTimeout(() => { void loadPalette().catch(() => undefined); }, 1500);
    return () => window.clearTimeout(t);
  }, [enabled]);

  const register = useCallback((src: PageSource) => {
    sources.current = [...sources.current, src];
    setVersion(v => v + 1);
    return () => { sources.current = sources.current.filter(s => s !== src); setVersion(v => v + 1); };
  }, []);
  const openPalette = useCallback(() => { if (enabled) { noteFocus(); draft.current = ''; setLoaded(true); setOpen(true); } }, [enabled]);

  // one listener for the whole app; it is removed when the provider goes (sign out)
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (!isSearchShortcut(e)) return;
      // another dialog of the CRM is asking something: answer it first
      if (getFeedbackState().dialogs.length) return;
      e.preventDefault();
      setOpen(o => {
        if (!o) { noteFocus(); draft.current = ''; }
        return !o;
      });
      setLoaded(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
  // signing out (or another person signing in) closes everything; recent items are kept per person
  useEffect(() => { setOpen(false); }, [userId]);

  const value = useMemo(() => ({ enabled, openPalette, register }), [enabled, openPalette, register]);
  // the most recently registered dashboard menu is the one on screen
  const current = sources.current[sources.current.length - 1] ?? null;
  return (
    <Ctx.Provider value={value}>
      {children}
      {enabled && loaded ? (
        <>
          {open ? (
            <React.Suspense fallback={<PaletteLoading draft={draft} onClose={() => setOpen(false)} />}>
              <CommandPalette userId={userId!} draft={draft} returnFocus={returnTo.current} pages={current?.pages ?? []} onSelectPage={id => current?.onSelect(id)} onClose={() => setOpen(false)} />
            </React.Suspense>
          ) : null}
          <React.Suspense fallback={null}>
            <RecordPanelHost userId={userId!} pages={current?.pages ?? []} onSelectPage={id => current?.onSelect(id)} />
          </React.Suspense>
        </>
      ) : null}
    </Ctx.Provider>
  );
};

/** A dashboard registers its menu (only the pages this person has), so search finds and opens them with the dashboard's own navigation. */
export function useSearchPages(pages: SearchPage[], onSelect: (navId: string) => void) {
  const { register } = useGlobalSearch();
  const select = useRef(onSelect);
  select.current = onSelect;
  const key = pages.map(p => `${p.navId}\u0001${p.label}\u0001${p.group ?? ''}\u0001${p.parent ?? ''}`).join('\u0002');
  useEffect(() => {
    const unregister = register({ pages, onSelect: id => select.current(id) });
    return unregister;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [register, key]);
}

/** The top bar's search: "Search anything… Ctrl K" on larger screens, an icon on phones; both open the same palette. */
export const GlobalSearchTrigger: React.FC = () => {
  const { enabled, openPalette } = useGlobalSearch();
  if (!enabled) return null;
  const mac = isMac();
  return (
    <>
      <button type="button" onClick={openPalette} data-testid="global-search-trigger" aria-label="Search" aria-keyshortcuts={mac ? 'Meta+K' : 'Control+K'}
        className="hidden md:flex items-center gap-2 h-10 w-64 lg:w-80 rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-500 hover:bg-white hover:border-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 transition-colors">
        <Search className="w-4 h-4 shrink-0" aria-hidden />
        <span className="flex-1 text-left truncate">Search anything…</span>
        <kbd className="shrink-0 rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[11px] font-semibold text-slate-500">{mac ? '⌘ K' : 'Ctrl K'}</kbd>
      </button>
      <button type="button" onClick={openPalette} data-testid="global-search-trigger-mobile" aria-label="Search"
        className="md:hidden shrink-0 w-11 h-11 rounded-xl border border-slate-200 bg-white text-slate-700 flex items-center justify-center hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400">
        <Search className="w-5 h-5" aria-hidden />
      </button>
    </>
  );
};
