import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  Building2, CalendarDays, ChevronLeft, ChevronRight, ClipboardList, Clock3, CornerDownLeft, FileText, FolderKanban, LayoutGrid, LifeBuoy, Megaphone, Network, Search, Target, User, X
} from 'lucide-react';
import type { SearchRecordCard, SearchRecordType, SearchResponse } from '../../../shared/contracts';
import { api, ApiError } from '../../lib/api/client';
import { userMessage } from '../../lib/feedback/errors';
import { addRecent, clearRecent, isMac, rankPages, readRecent, removeRecent, type RecentItem, type SearchPage } from '../../lib/search/searchEngine';
import { openAiStudio } from '../ai-studio/aiStudioEvents';
import { openMeeting } from '../meetings/meetingEvents';
import { openNotice } from '../notices/noticeEvents';
import { RECORD_PARAM, recordFromUrl } from './GlobalSearch';

/**
 * The command palette and the record panel (docs/COMMAND_PALETTE_GUIDE.md). Loaded the first time search is used.
 *
 * Results: the open dashboard's pages (its own menu), then the records the server returns (public.global_search: only what this person may
 * open). Selecting a result opens that exact thing: a page through the dashboard's own navigation, a meeting or a notice on its page, an
 * employee / customer / lead / ticket / department in the record panel (?open=record&type=...&id=..., so Back, Forward and a refresh work;
 * the panel reads it again from the server, which checks access again).
 */
type Kind = SearchRecordType;
export const KIND: Record<Kind, { label: string; one: string; icon: React.ElementType }> = {
  employee: { label: 'Employees', one: 'Employee', icon: User },
  customer: { label: 'Customers', one: 'Customer', icon: Building2 },
  lead: { label: 'Leads', one: 'Lead', icon: Target },
  meeting: { label: 'Meetings', one: 'Meeting', icon: CalendarDays },
  ticket: { label: 'Support tickets', one: 'Ticket', icon: LifeBuoy },
  department: { label: 'Departments', one: 'Department', icon: Network },
  notice: { label: 'Notices', one: 'Notice', icon: Megaphone },
  // AI Studio (20270219000100): opened on the AI Studio pages, which check access again
  ai_studio_task: { label: 'AI Studio tasks', one: 'Task', icon: ClipboardList },
  ai_studio_project: { label: 'AI Studio projects', one: 'Project', icon: FolderKanban },
  ai_studio_report: { label: 'AI Studio daily reports', one: 'Daily report', icon: FileText }
};
const PANEL_TYPES = new Set<Kind>(['employee', 'customer', 'lead', 'ticket', 'department']);
const OPEN_RECORD_EVENT = 'crm:open-record';
const DEBOUNCE_MS = 250;

/** Open a record: a meeting / notice on its own page, the others in the record panel (one history entry, so Back closes it). */
export function openSearchRecord(type: Kind, id: string) {
  if (type === 'meeting') { openMeeting(id); return; }
  if (type === 'notice') { openNotice(id); return; }
  if (type === 'ai_studio_task') { openAiStudio({ kind: 'task', id }); return; }
  if (type === 'ai_studio_report') { openAiStudio({ kind: 'report', id }); return; }
  if (type === 'ai_studio_project') { openAiStudio({ kind: 'project', id }); return; }
  if (!PANEL_TYPES.has(type)) return;
  const url = new URL(window.location.href);
  url.searchParams.set('open', RECORD_PARAM);
  url.searchParams.set('type', type);
  url.searchParams.set('id', id);
  window.history.pushState({ ...(window.history.state ?? {}), crmRecord: true }, '', url.pathname + url.search + url.hash);
  window.dispatchEvent(new CustomEvent(OPEN_RECORD_EVENT));
}

interface Item {
  key: string;
  section: string;
  icon: React.ElementType;
  title: string;
  subtitle?: string | null;
  meta?: string | null;
  run: () => void;
  recent?: RecentItem;
}

const Row: React.FC<{ item: Item; id: string; active: boolean; onHover: () => void; onRemove?: () => void }> = ({ item, id, active, onHover, onRemove }) => {
  const Icon = item.icon;
  return (
    <li id={id} role="option" aria-selected={active} onMouseMove={onHover} onClick={item.run} data-testid="search-result"
      className={`group flex items-center gap-3 px-3 min-h-[44px] py-2 rounded-lg cursor-pointer select-none ${active ? 'bg-slate-100' : ''}`}>
      <span className={`shrink-0 w-8 h-8 rounded-md border flex items-center justify-center ${active ? 'border-slate-300 bg-white text-slate-900' : 'border-slate-200 bg-slate-50 text-slate-500'}`} aria-hidden>
        <Icon className="w-4 h-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-slate-900">{item.title}</span>
        {item.subtitle ? <span className="block truncate text-xs text-slate-500">{item.subtitle}</span> : null}
      </span>
      {item.meta ? <span className="hidden sm:inline shrink-0 text-[11px] font-medium text-slate-500 rounded border border-slate-200 px-1.5 py-0.5">{item.meta}</span> : null}
      {onRemove ? (
        <button type="button" aria-label={`Remove ${item.title} from recent`} tabIndex={-1}
          onClick={e => { e.stopPropagation(); onRemove(); }}
          className="shrink-0 w-7 h-7 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-200 flex items-center justify-center sm:opacity-0 sm:group-hover:opacity-100 sm:group-aria-selected:opacity-100">
          <X className="w-3.5 h-3.5" aria-hidden />
        </button>
      ) : <ChevronRight className={`shrink-0 w-4 h-4 ${active ? 'text-slate-500' : 'text-slate-300'}`} aria-hidden />}
    </li>
  );
};

export const CommandPalette: React.FC<{
  userId: string;
  /** what was typed while the palette was loading (read when it appears, not when it was asked for) */
  draft?: React.MutableRefObject<string>;
  returnFocus?: HTMLElement | null; pages: SearchPage[]; onSelectPage: (navId: string) => void; onClose: () => void;
}> = ({ userId, draft, returnFocus = null, pages, onSelectPage, onClose }) => {
  const [query, setQuery] = useState(() => draft?.current ?? '');
  const [limit, setLimit] = useState(5);
  const [records, setRecords] = useState<{ status: 'idle' | 'loading' | 'ok' | 'error'; q: string; data?: SearchResponse; error?: string }>({ status: 'idle', q: '' });
  const [active, setActive] = useState(0);
  const [recent, setRecent] = useState<RecentItem[]>(() => readRecent(userId));
  const [cards, setCards] = useState<Record<string, SearchRecordCard | 'gone'>>({});
  const [retry, setRetry] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const seq = useRef(0);
  // where the focus was before search opened (noted by the provider), to give it back when closing
  const before = returnFocus;
  const keepFocusAway = useRef(false);
  const listId = useId();
  const mac = isMac();
  const trimmed = query.trim();

  // the field has the focus as soon as the palette appears (autoFocus: nothing typed right after Ctrl + K is lost); the focus goes back to
  // where it was when closing (unless a record panel takes it)
  useEffect(() => () => { if (!keepFocusAway.current && before?.isConnected) before.focus(); }, [before]);
  // text typed while the palette was loading is kept: carry on typing after it (the caret at the end)
  useEffect(() => { const el = input.current; if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }, []);

  // records: after a short pause in typing; an older answer never replaces a newer one
  useEffect(() => {
    const q = trimmed;
    const mine = ++seq.current;
    if (q.length < 2) { setRecords({ status: 'idle', q }); return; }
    setRecords(r => ({ status: 'loading', q, data: r.q === q ? r.data : undefined }));
    const t = window.setTimeout(() => {
      api.post<SearchResponse>('/search', { q, limit }).then(
        data => { if (seq.current === mine) setRecords({ status: 'ok', q, data }); },
        e => { if (seq.current === mine) setRecords({ status: 'error', q, error: e instanceof ApiError && e.status === 401 ? 'Your session has ended. Sign in again to search.' : userMessage(e, 'Please try again.') }); }
      );
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [trimmed, limit, retry]);
  useEffect(() => { setLimit(5); setActive(0); }, [trimmed]);

  // recently visited records: names are fetched again (and access checked again); one that is gone is dropped
  useEffect(() => {
    let alive = true;
    for (const r of recent) {
      if (r.kind !== 'record' || cards[`${r.type}:${r.id}`]) continue;
      api.get<SearchRecordCard>(`/search/records/${r.type}/${r.id}`).then(
        c => { if (alive) setCards(x => ({ ...x, [`${r.type}:${r.id}`]: c })); },
        e => {
          if (!alive) return;
          if (e instanceof ApiError && (e.status === 404 || e.status === 403)) { setCards(x => ({ ...x, [`${r.type}:${r.id}`]: 'gone' })); setRecent(removeRecent(userId, r)); }
        });
    }
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recent]);

  const close = onClose;
  const goPage = useCallback((p: SearchPage) => {
    addRecent(userId, { kind: 'page', navId: p.navId, label: p.label, at: Date.now() });
    close();
    onSelectPage(p.navId);
  }, [userId, close, onSelectPage]);
  const goRecord = useCallback((type: Kind, id: string) => {
    if (PANEL_TYPES.has(type)) addRecent(userId, { kind: 'record', type, id, at: Date.now() });
    keepFocusAway.current = PANEL_TYPES.has(type);
    close();
    openSearchRecord(type, id);
  }, [userId, close]);

  const pageItem = (p: SearchPage, section: string, recentItem?: RecentItem): Item => ({
    key: `page:${p.navId}`, section, icon: LayoutGrid, title: p.label, subtitle: [p.group, p.parent].filter(Boolean).join(' · ') || 'Page', run: () => goPage(p), recent: recentItem
  });

  const sections = useMemo(() => {
    const out: { label: string; items: Item[]; more?: () => void }[] = [];
    if (!trimmed) {
      const recentItems: Item[] = recent.flatMap((r): Item[] => {
        if (r.kind === 'page') {
          const p = pages.find(x => x.navId === r.navId);
          return p ? [pageItem(p, 'Recently visited', r)] : [];
        }
        const c = cards[`${r.type}:${r.id}`];
        if (!c || c === 'gone') return [];
        const k = KIND[r.type as Kind];
        return [{ key: `rec:${r.type}:${r.id}`, section: 'Recently visited', icon: k.icon, title: c.title, subtitle: k.one, run: () => goRecord(r.type as Kind, r.id), recent: r }];
      });
      if (recentItems.length) out.push({ label: 'Recently visited', items: recentItems });
      const used = new Set(recentItems.map(i => i.key));
      const quick = pages.filter(p => !used.has(`page:${p.navId}`)).slice(0, 6).map(p => pageItem(p, 'Quick navigation'));
      if (quick.length) out.push({ label: 'Quick navigation', items: quick });
      return out;
    }
    const pageHits = rankPages(pages, trimmed, 6).map(p => pageItem(p, 'Pages & features'));
    if (pageHits.length) out.push({ label: 'Pages & features', items: pageHits });
    if (records.status === 'ok' || (records.status === 'loading' && records.data)) {
      for (const g of records.data?.groups ?? []) {
        const k = KIND[g.type];
        if (!k) continue;
        out.push({
          label: k.label,
          items: g.items.map(r => ({ key: `${r.type}:${r.id}`, section: k.label, icon: k.icon, title: r.title, subtitle: [r.subtitle, k.one].filter(Boolean).join(' · '), meta: r.meta, run: () => goRecord(r.type, r.id) })),
          more: g.hasMore && limit < 20 ? () => setLimit(20) : undefined
        });
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trimmed, pages, recent, cards, records, limit, goPage, goRecord]);

  const flat = useMemo(() => sections.flatMap(s => s.items), [sections]);
  useEffect(() => { if (active >= flat.length) setActive(Math.max(0, flat.length - 1)); }, [flat.length, active]);
  // keep the chosen row in view
  useEffect(() => { list.current?.querySelector<HTMLElement>(`[aria-selected="true"]`)?.scrollIntoView({ block: 'nearest' }); }, [active]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => (flat.length ? (a + 1) % flat.length : 0)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => (flat.length ? (a - 1 + flat.length) % flat.length : 0)); }
    else if (e.key === 'Enter') { if (e.nativeEvent.isComposing) return; e.preventDefault(); flat[active]?.run(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
  };

  const loading = records.status === 'loading' && !records.data && trimmed.length >= 2;
  const nothing = !!trimmed && trimmed.length >= 2 && records.status === 'ok' && !flat.length;
  const optionId = (i: number) => `${listId}-o${i}`;
  let index = -1;

  return (
    <div className="fixed inset-0 z-[150]" data-testid="command-palette-layer">
      <div className="absolute inset-0 bg-slate-900/30 hidden sm:block motion-safe:animate-[fadeIn_100ms_ease-out]" aria-hidden onClick={close} />
      <div role="dialog" aria-modal="true" aria-label="Search" onKeyDown={onKeyDown} data-testid="command-palette"
        className="absolute inset-0 sm:inset-auto sm:left-1/2 sm:top-[12vh] sm:-translate-x-1/2 sm:w-[min(720px,calc(100vw-2rem))] flex flex-col bg-white sm:rounded-xl sm:border sm:border-slate-200 sm:shadow-2xl overflow-hidden h-[100dvh] sm:h-auto sm:max-h-[72vh] pt-[env(safe-area-inset-top)] sm:pt-0">
        <div className="flex items-center gap-2 px-3 sm:px-4 border-b border-slate-200 h-14 shrink-0">
          <button type="button" onClick={close} aria-label="Close search" className="sm:hidden -ml-1 w-10 h-10 rounded-lg text-slate-600 hover:bg-slate-100 flex items-center justify-center">
            <ChevronLeft className="w-5 h-5" aria-hidden />
          </button>
          <Search className="hidden sm:block w-[18px] h-[18px] text-slate-400 shrink-0" aria-hidden />
          <input ref={input} autoFocus value={query} onChange={e => setQuery(e.target.value)} placeholder="Search pages, people, customers, meetings…"
            role="combobox" aria-expanded="true" aria-controls={listId} aria-autocomplete="list" aria-activedescendant={flat.length ? optionId(active) : undefined}
            aria-label="Search the CRM" autoComplete="off" spellCheck={false} maxLength={100} enterKeyHint="go" data-testid="command-palette-input"
            className="flex-1 min-w-0 h-full bg-transparent text-[15px] text-slate-900 placeholder:text-slate-400 focus:outline-none" />
          {query ? <button type="button" onClick={() => { setQuery(''); input.current?.focus(); }} aria-label="Clear search" className="w-8 h-8 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 flex items-center justify-center"><X className="w-4 h-4" aria-hidden /></button> : null}
          <kbd className="hidden sm:inline rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px] font-semibold text-slate-500">Esc</kbd>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-2 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
          <p className="sr-only" role="status" aria-live="polite">{trimmed ? (loading ? 'Searching…' : `${flat.length} result${flat.length === 1 ? '' : 's'}`) : ''}</p>
          <ul ref={list} id={listId} role="listbox" aria-label="Results" className="space-y-3">
            {sections.map(s => (
              <li key={s.label} role="presentation">
                <div className="flex items-center justify-between px-3 pt-1 pb-1">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500" id={`${listId}-${s.label}`}>{s.label}</span>
                  {s.label === 'Recently visited' ? (
                    <button type="button" tabIndex={-1} onClick={() => { clearRecent(userId); setRecent([]); input.current?.focus(); }}
                      className="text-[11px] font-medium text-slate-500 hover:text-slate-800 underline-offset-2 hover:underline">Clear recent history</button>
                  ) : null}
                </div>
                <ul role="group" aria-labelledby={`${listId}-${s.label}`} className="space-y-0.5">
                  {s.items.map(item => {
                    index += 1;
                    const i = index;
                    return <Row key={item.key} item={item} id={optionId(i)} active={i === active} onHover={() => setActive(i)}
                      onRemove={item.recent ? () => { setRecent(removeRecent(userId, item.recent!)); input.current?.focus(); } : undefined} />;
                  })}
                </ul>
                {s.more ? <button type="button" tabIndex={-1} onClick={s.more} className="ml-3 mt-1 text-xs font-semibold text-slate-600 hover:text-slate-900 hover:underline">Show more {s.label.toLowerCase()}</button> : null}
              </li>
            ))}
          </ul>
          {loading ? (
            <div className="px-3 py-2 space-y-2" aria-hidden data-testid="search-loading">
              {[0, 1, 2].map(i => <div key={i} className="flex items-center gap-3"><div className="w-8 h-8 rounded-md bg-slate-100 motion-safe:animate-pulse" /><div className="flex-1 space-y-1.5"><div className="h-3 w-1/3 rounded bg-slate-100 motion-safe:animate-pulse" /><div className="h-2.5 w-1/2 rounded bg-slate-100 motion-safe:animate-pulse" /></div></div>)}
            </div>
          ) : null}
          {records.status === 'error' ? (
            <div className="mx-3 my-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-sm" role="alert" data-testid="search-error">
              <p className="font-semibold text-slate-900">Unable to complete your search</p>
              <p className="text-slate-600">{records.error}</p>
              <button type="button" onClick={() => setRetry(r => r + 1)} className="mt-2 text-sm font-semibold text-slate-900 underline underline-offset-2">Try again</button>
            </div>
          ) : null}
          {nothing ? (
            <div className="px-3 py-10 text-center" data-testid="search-empty">
              <p className="text-sm font-semibold text-slate-900">No results found</p>
              <p className="mt-1 text-sm text-slate-500">Try searching for a different name, page, customer or feature.</p>
            </div>
          ) : null}
          {trimmed.length === 1 && !flat.length ? <p className="px-3 py-6 text-center text-sm text-slate-500">Type one more letter to search records.</p> : null}
        </div>

        <div className="hidden sm:flex items-center gap-4 px-4 h-10 shrink-0 border-t border-slate-200 bg-slate-50 text-[11px] text-slate-500">
          <span className="flex items-center gap-1"><kbd className="rounded border border-slate-200 bg-white px-1">↑</kbd><kbd className="rounded border border-slate-200 bg-white px-1">↓</kbd> to navigate</span>
          <span className="flex items-center gap-1"><kbd className="rounded border border-slate-200 bg-white px-1"><CornerDownLeft className="inline w-3 h-3" aria-label="Enter" /></kbd> to open</span>
          <span className="flex items-center gap-1"><kbd className="rounded border border-slate-200 bg-white px-1">Esc</kbd> to close</span>
          <span className="ml-auto flex items-center gap-1"><Clock3 className="w-3 h-3" aria-hidden /> {mac ? '⌘ K' : 'Ctrl K'} opens search anywhere</span>
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------------------------------------------- the record panel
/** Pages of the current dashboard that list this kind of record ("Go to Customers"), matched by their names. */
const RELATED: Record<string, RegExp> = {
  customer: /customer|client|pipeline|sales management/i,
  lead: /lead|pipeline|sales management/i,
  employee: /team member|employee|staff|people|directory/i,
  ticket: /ticket|support/i,
  department: /department/i
};

export const RecordPanelHost: React.FC<{ userId: string; pages: SearchPage[]; onSelectPage: (navId: string) => void }> = ({ pages, onSelectPage }) => {
  const [rec, setRec] = useState(() => recordFromUrl());
  const [state, setState] = useState<{ status: 'loading' | 'ok' | 'error'; card?: SearchRecordCard; error?: string }>({ status: 'loading' });
  const box = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const titleId = useId();

  useEffect(() => {
    const sync = () => setRec(recordFromUrl());
    window.addEventListener('popstate', sync);
    window.addEventListener(OPEN_RECORD_EVENT, sync);
    return () => { window.removeEventListener('popstate', sync); window.removeEventListener(OPEN_RECORD_EVENT, sync); };
  }, []);
  useEffect(() => {
    if (!rec) return;
    let alive = true;
    setState({ status: 'loading' });
    api.get<SearchRecordCard>(`/search/records/${rec.type}/${rec.id}`).then(
      card => { if (alive) setState({ status: 'ok', card }); },
      e => {
        if (!alive) return;
        setState({ status: 'error', error: e instanceof ApiError && (e.status === 404 || e.status === 403)
          ? 'This record is no longer available, or you do not have access to it.' : userMessage(e, 'The record could not be loaded. Please try again.') });
      });
    const t = window.setTimeout(() => heading.current?.focus(), 0);
    return () => { alive = false; window.clearTimeout(t); };
  }, [rec?.type, rec?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const close = useCallback(() => {
    if (window.history.state?.crmRecord) { window.history.back(); return; }
    const url = new URL(window.location.href);
    for (const k of ['open', 'type', 'id']) url.searchParams.delete(k);
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
    setRec(null);
  }, []);
  useEffect(() => {
    if (!rec) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.defaultPrevented) close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [rec, close]);

  if (!rec) return null;
  const k = KIND[rec.type as Kind];
  const Icon = k.icon;
  const related = pages.filter(p => RELATED[rec.type]?.test(p.label)).slice(0, 2);
  return (
    <div className="fixed inset-0 z-[140]" data-testid="record-panel-layer">
      <div className="absolute inset-0 bg-slate-900/30 hidden sm:block" aria-hidden onClick={close} />
      <div ref={box} role="dialog" aria-modal="true" aria-labelledby={titleId} data-testid="record-panel"
        className="absolute inset-0 sm:inset-y-0 sm:left-auto sm:right-0 sm:w-[440px] bg-white sm:border-l sm:border-slate-200 sm:shadow-2xl flex flex-col pt-[env(safe-area-inset-top)] sm:pt-0">
        <div className="flex items-center gap-2 px-4 h-14 border-b border-slate-200 shrink-0">
          <span className="w-8 h-8 rounded-md border border-slate-200 bg-slate-50 text-slate-600 flex items-center justify-center" aria-hidden><Icon className="w-4 h-4" /></span>
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{k.one}</span>
          <button type="button" onClick={close} aria-label="Close" className="ml-auto w-10 h-10 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-100 flex items-center justify-center">
            <X className="w-5 h-5" aria-hidden />
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          {state.status === 'loading' ? <p role="status" className="text-sm text-slate-500">Loading…</p> : null}
          {state.status === 'error' ? (
            <div role="alert" data-testid="record-panel-error">
              <h2 ref={heading} tabIndex={-1} id={titleId} className="text-base font-bold text-slate-900 focus:outline-none">Not available</h2>
              <p className="mt-1 text-sm text-slate-600">{state.error}</p>
            </div>
          ) : null}
          {state.status === 'ok' && state.card ? (
            <>
              <h2 ref={heading} tabIndex={-1} id={titleId} className="text-lg font-bold text-slate-900 focus:outline-none break-words" data-testid="record-panel-title">{state.card.title}</h2>
              <dl className="mt-4 divide-y divide-slate-100 border-y border-slate-100">
                {state.card.fields.map(([label, value]) => (
                  <div key={label} className="flex gap-3 py-2.5 text-sm">
                    <dt className="w-32 shrink-0 text-slate-500">{label}</dt>
                    <dd className="min-w-0 flex-1 text-slate-900 break-words">{value}</dd>
                  </div>
                ))}
              </dl>
              {related.length ? (
                <div className="mt-5 flex flex-wrap gap-2">
                  {related.map(p => (
                    <button key={p.navId} type="button" onClick={() => { close(); onSelectPage(p.navId); }}
                      className="inline-flex items-center gap-1.5 min-h-[40px] px-3 rounded-lg border border-slate-300 bg-white text-sm font-semibold text-slate-800 hover:bg-slate-50">
                      Go to {p.label} <ChevronRight className="w-4 h-4" aria-hidden />
                    </button>
                  ))}
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
};
