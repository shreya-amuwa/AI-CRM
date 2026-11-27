import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Lightbulb, Maximize2, Minimize2, Monitor, RotateCcw, Smartphone, Tablet, TriangleAlert } from 'lucide-react';
import {
  DASHBOARD_REGISTRY, DEMO_ACTION_MESSAGE, PREVIEW_SCENARIOS, PREVIEW_VIEWPORTS, dashboardById, departmentBySlug, frameToParentSchema,
  type PreviewLaunch, type PreviewScenarioId, type PreviewViewport
} from '../../../shared/dashboardExplorer';
import { dashboardExplorerApi } from '../../lib/api/dashboardExplorer';
import { errorMessage } from '../../lib/api/client';
import { toast } from '../feedback/AppFeedback';
import { SuggestImprovement } from './SuggestImprovement';

/**
 * A dashboard preview (docs/DASHBOARD_EXPLORER.md): the permanent PREVIEW MODE toolbar above a sandboxed frame that runs the real dashboard
 * with demonstration data. The frame is a separate bundle at /dashboard-preview/, sandboxed WITHOUT allow-same-origin and with
 * connect-src 'none': it cannot read this page's session, cookies or storage, and cannot reach the API or Supabase. This page talks to it
 * only through the launch message (dashboard, department, scenario) and accepts only the frame's own, schema-checked messages.
 * The Managing Director's own session never changes; starting and ending a preview is audited through the API (their own action).
 */
export interface PreviewSelection { dashboardId: string; department: string; scenario: PreviewScenarioId }

const VIEWPORT_ICON: Record<PreviewViewport, typeof Monitor> = { desktop: Monitor, tablet: Tablet, mobile: Smartphone };
const toolBtn = 'inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50';
const selectCls = 'h-8 rounded-lg border border-slate-300 bg-white px-2 text-xs font-semibold text-slate-700 max-w-[14rem]';

export const PreviewWorkspace: React.FC<{ initial: PreviewSelection; onExit: () => void; onSuggested?: () => void }> = ({ initial, onExit, onSuggested }) => {
  const [sel, setSel] = useState<PreviewSelection>(initial);
  const [viewport, setViewport] = useState<PreviewViewport>('desktop');
  const [fullscreen, setFullscreen] = useState(false);
  const [epoch, setEpoch] = useState(1);
  const [page, setPage] = useState<{ path: string; title: string }>({ path: '', title: '' });
  const [unavailable, setUnavailable] = useState<string[]>([]);
  const [showGaps, setShowGaps] = useState(false);
  const [suggest, setSuggest] = useState(false);
  const [session, setSession] = useState<{ id: string | null; error: string | null; loading: boolean }>({ id: null, error: null, loading: true });
  const frame = useRef<HTMLIFrameElement>(null);
  const ready = useRef(false);
  const launch = useRef<PreviewLaunch | null>(null);
  const entry = dashboardById(sel.dashboardId);
  const dept = departmentBySlug(sel.department);

  // the frame is told what to show only after it says it is ready; every change (position, department, scenario, Reset) starts it afresh
  const sendLaunch = useCallback(() => {
    if (ready.current && launch.current) frame.current?.contentWindow?.postMessage({ type: 'crm-preview:launch', launch: launch.current }, '*');
  }, []);

  // the preview session: audited start (the server accepts only the Managing Director), audited end when it changes or closes
  useEffect(() => {
    let current: string | null = null;
    let cancelled = false;
    setSession({ id: null, error: null, loading: true });
    dashboardExplorerApi.startSession(sel).then(
      s => { current = s.sessionId; if (!cancelled) setSession({ id: s.sessionId, error: null, loading: false }); },
      e => { if (!cancelled) setSession({ id: null, error: errorMessage(e), loading: false }); }
    );
    setUnavailable([]);
    setPage({ path: '', title: '' });
    return () => {
      cancelled = true;
      if (current) void dashboardExplorerApi.endSession(current).catch(() => undefined);
    };
  }, [sel]);

  // a new frame element (another position or department) must say it is ready again before it is launched; this runs before its scripts do
  const frameKey = `${sel.dashboardId}:${sel.department}`;
  useEffect(() => { ready.current = false; }, [frameKey]);

  useEffect(() => {
    launch.current = { ...sel, epoch };
    sendLaunch();
  }, [sel, epoch, sendLaunch]);

  // messages from the frame: only from that window, only from an opaque (sandboxed) origin, only the known shapes
  useEffect(() => {
    let lastToast = 0;
    const onMessage = (e: MessageEvent) => {
      if (!frame.current || e.source !== frame.current.contentWindow || e.origin !== 'null') return;
      const parsed = frameToParentSchema.safeParse(e.data);
      if (!parsed.success) return;
      const m = parsed.data;
      if (m.type === 'crm-preview:ready') { ready.current = true; sendLaunch(); }
      else if (m.type === 'crm-preview:page') setPage({ path: m.path, title: m.title });
      else if (m.type === 'crm-preview:unavailable') setUnavailable(list => (list.includes(m.what) || list.length >= 200 ? list : [...list, m.what]));
      else if (m.type === 'crm-preview:exit') onExit();
      else if (m.type === 'crm-preview:demo-action' && Date.now() - lastToast > 1500) { lastToast = Date.now(); toast.info(DEMO_ACTION_MESSAGE); }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [onExit, sendLaunch]);

  // Browser Back closes the preview (and nothing else); the Managing Director's page and its filters are still underneath
  useEffect(() => {
    history.pushState({ ...(history.state ?? {}), dashboardPreview: true }, '', location.href);
    const onPop = () => onExit();
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [onExit]);
  const exit = () => (history.state?.dashboardPreview ? history.back() : onExit());

  const change = (next: Partial<PreviewSelection>) => {
    setSel(s => {
      const merged = { ...s, ...next };
      const e = dashboardById(merged.dashboardId);
      if (e && !e.departments.includes(merged.department)) merged.department = e.departments[0];
      return merged;
    });
    setEpoch(n => n + 1);
  };
  const reset = () => { setEpoch(n => n + 1); setUnavailable([]); toast.info('Demo data reset. No live CRM data has been changed.'); };
  const gaps = unavailable.filter(u => !u.startsWith('network:'));
  const width = PREVIEW_VIEWPORTS[viewport].width;

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-slate-100" role="dialog" aria-modal="true" aria-label={`Preview mode: ${entry?.position ?? ''}`}>
      {/* the permanent preview toolbar: always on top, outside the frame, so it can never be hidden or imitated by the preview */}
      <div className="shrink-0 bg-amber-50 border-b-2 border-amber-400 px-3 sm:px-4 py-2 space-y-2" data-testid="preview-toolbar">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <button type="button" className={toolBtn} onClick={exit}><ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" /> Back to Managing Director</button>
          <p className="text-[13px] font-extrabold tracking-wide text-amber-900">PREVIEW MODE — {entry?.position ?? 'Unknown dashboard'}</p>
          <p className="text-xs text-amber-900"><span className="font-semibold">Department:</span> {dept?.name ?? sel.department}</p>
          <p className="text-xs font-semibold text-amber-900 bg-amber-100 border border-amber-300 rounded-md px-1.5">Data: Demonstration only</p>
          {page.title && <p className="text-xs text-amber-800 truncate max-w-[16rem]" title={page.path}>Page: {page.title}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="dx-switch-position">Switch position</label>
          <select id="dx-switch-position" className={selectCls} value={sel.dashboardId} onChange={e => change({ dashboardId: e.target.value })}>
            {DASHBOARD_REGISTRY.map(d => <option key={d.id} value={d.id}>{d.position}</option>)}
          </select>
          <label className="sr-only" htmlFor="dx-switch-department">Switch department</label>
          <select id="dx-switch-department" className={selectCls} value={sel.department} onChange={e => change({ department: e.target.value })} disabled={(entry?.departments.length ?? 0) < 2}>
            {(entry?.departments ?? []).map(s => <option key={s} value={s}>{departmentBySlug(s)?.name ?? s}</option>)}
          </select>
          <label className="sr-only" htmlFor="dx-scenario">Scenario</label>
          <select id="dx-scenario" className={selectCls} value={sel.scenario} onChange={e => change({ scenario: e.target.value as PreviewScenarioId })}>
            {PREVIEW_SCENARIOS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
          <div className="inline-flex rounded-lg border border-slate-300 overflow-hidden" role="group" aria-label="Screen size">
            {(Object.keys(PREVIEW_VIEWPORTS) as PreviewViewport[]).map(v => {
              const Icon = VIEWPORT_ICON[v];
              return (
                <button key={v} type="button" onClick={() => setViewport(v)} aria-pressed={viewport === v}
                  className={`inline-flex items-center gap-1 h-8 px-2.5 text-xs font-semibold ${viewport === v ? 'bg-slate-800 text-white' : 'bg-white text-slate-700 hover:bg-slate-50'}`}>
                  <Icon className="w-3.5 h-3.5" aria-hidden="true" /> <span className="hidden sm:inline">{PREVIEW_VIEWPORTS[v].label}</span><span className="sm:hidden sr-only">{PREVIEW_VIEWPORTS[v].label}</span>
                </button>
              );
            })}
          </div>
          <button type="button" className={toolBtn} onClick={() => setFullscreen(f => !f)} aria-pressed={fullscreen}>
            {fullscreen ? <Minimize2 className="w-3.5 h-3.5" aria-hidden="true" /> : <Maximize2 className="w-3.5 h-3.5" aria-hidden="true" />} {fullscreen ? 'Exit full screen' : 'Full screen'}
          </button>
          <button type="button" className={toolBtn} onClick={reset}><RotateCcw className="w-3.5 h-3.5" aria-hidden="true" /> Reset demo data</button>
          <button type="button" className={`${toolBtn} !border-blue-300 !text-blue-800`} onClick={() => setSuggest(true)} disabled={!session.id}><Lightbulb className="w-3.5 h-3.5" aria-hidden="true" /> Suggest improvement</button>
          {gaps.length > 0 && (
            <button type="button" className={toolBtn} onClick={() => setShowGaps(s => !s)} aria-expanded={showGaps}>
              <TriangleAlert className="w-3.5 h-3.5 text-amber-600" aria-hidden="true" /> Not in the demonstration yet ({gaps.length})
            </button>
          )}
        </div>
        {showGaps && gaps.length > 0 && (
          <div className="bg-white border border-amber-300 rounded-lg p-2 max-h-40 overflow-auto text-[11px] text-slate-700" data-testid="preview-gaps">
            <p className="font-semibold mb-1">These parts of the page have no demonstration data yet (they show an error or an empty state; nothing is read from the live CRM):</p>
            <ul className="list-disc pl-4 space-y-0.5">{gaps.map(g => <li key={g} className="font-mono">{g}</li>)}</ul>
          </div>
        )}
      </div>

      <div className={`flex-1 min-h-0 overflow-auto ${fullscreen ? 'p-0' : 'p-2 sm:p-4'} flex justify-center`}>
        {session.loading ? (
          <p role="status" className="self-center text-sm text-slate-500">Opening the preview…</p>
        ) : session.error ? (
          <div role="alert" className="self-center max-w-md bg-white border border-rose-200 rounded-2xl p-5 text-center">
            <p className="text-sm font-bold text-rose-800">The preview could not start</p>
            <p className="mt-1 text-sm text-slate-600">{session.error}</p>
          </div>
        ) : (
          <div className={`h-full ${width ? 'rounded-2xl border-8 border-slate-800 shadow-lg overflow-hidden bg-white shrink-0' : 'w-full'}`} style={width ? { width: width + 16 } : undefined}>
            <iframe
              ref={frame}
              key={frameKey}
              title={`Preview of the ${entry?.position ?? ''} dashboard (demonstration data)`}
              src="/dashboard-preview/"
              sandbox="allow-scripts allow-forms"
              referrerPolicy="no-referrer"
              className="w-full h-full bg-white border-0"
              data-testid="preview-frame"
            />
          </div>
        )}
      </div>
      {suggest && (
        <SuggestImprovement
          context={{ dashboardId: sel.dashboardId, department: sel.department, page: page.path, pageTitle: page.title, viewport }}
          onClose={() => setSuggest(false)}
          onSent={() => { setSuggest(false); onSuggested?.(); }}
        />
      )}
    </div>
  );
};
