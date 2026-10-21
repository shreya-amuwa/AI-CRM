import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ChevronsDownUp, ChevronsUpDown, Maximize2, Minus, Plus, RefreshCw, X } from 'lucide-react';
import type { CompanyWorkflow as CompanyWorkflowData, WorkflowProcess } from '../../../shared/contracts';
import { errorMessage } from '../../lib/api/client';
import { dashboardApi } from '../../lib/api/endpoints';
import { PageTitle } from '../layout/shell';
import { Card, ghostBtn, LoadingLine } from '../tasks/head/headParts';
import {
  buildDiagram,
  edgePath,
  fitView,
  PROCESS_META,
  PROCESS_ORDER,
  reportPath,
  type Diagram,
  type DiagramEdge,
  type DiagramNode
} from './workflowLayout';

/**
 * Super Admin -> Company Workflow: every department, its teams (sub-departments), its Department Head, Team Leads and members,
 * and the hand-offs that already exist between them, drawn from the live records (GET /dashboard/company-workflow).
 * Nothing in the picture is typed in: a department, team or person added in the CRM shows up the next time it is read.
 */

const edgeColor = (e: { process?: WorkflowProcess | null }) => (e.process ? PROCESS_META[e.process].color : '#334155');
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const num = (n: number) => new Intl.NumberFormat('en-IN').format(n);
const ROLE_LABEL: Record<string, string> = { TEAM_HEAD: 'Team Lead', TEAM_MEMBER: 'Team Member' };

type Selection = { type: 'node'; id: string } | { type: 'edge'; id: string } | null;

export const CompanyWorkflow: React.FC = () => {
  const [data, setData] = useState<CompanyWorkflowData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [departmentId, setDepartmentId] = useState<string>('ALL');
  const [teamId, setTeamId] = useState<string>('ALL');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [processes, setProcesses] = useState<Set<WorkflowProcess>>(new Set(PROCESS_ORDER));
  const [selected, setSelected] = useState<Selection>(null);
  const [hideEmpty, setHideEmpty] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    dashboardApi.workflow().then(
      d => {
        setData(d);
        setError(null);
        setLoading(false);
      },
      e => {
        setError(errorMessage(e));
        setLoading(false);
      }
    );
  }, []);
  useEffect(() => {
    load();
    // the picture follows the company: read it again when the tab comes back and when the pipeline changes
    const onVisible = () => document.visibilityState === 'visible' && load();
    window.addEventListener('crm:pipeline-changed', load);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('crm:pipeline-changed', load);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load]);

  // a department or team that no longer exists must not stay selected
  useEffect(() => {
    if (!data) return;
    if (departmentId !== 'ALL' && !data.departments.some(d => d.id === departmentId)) setDepartmentId('ALL');
    if (teamId !== 'ALL' && !data.teams.some(t => t.id === teamId && t.departmentId === departmentId)) setTeamId('ALL');
  }, [data, departmentId, teamId]);

  // how many department boxes fit across: from the width this page really has (the sidebar and the phone included)
  const page = useRef<HTMLDivElement>(null);
  const [pageW, setPageW] = useState(1100);
  useLayoutEffect(() => {
    const el = page.current;
    if (!el) return;
    const measure = () => setPageW(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const columns = pageW >= 1000 ? 4 : pageW >= 700 ? 3 : 2;

  const diagram: Diagram | null = useMemo(
    () => (data ? buildDiagram(data, { expanded, departmentId, teamId, processes, columns }) : null),
    [data, expanded, departmentId, teamId, processes, columns]
  );

  const teamsOfDepartment = useMemo(() => (data && departmentId !== 'ALL' ? data.teams.filter(t => t.departmentId === departmentId) : []), [data, departmentId]);

  const toggleDept = (id: string) =>
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const expandAll = () => data && setExpanded(new Set(data.departments.map(d => d.id)));
  const collapseAll = () => setExpanded(new Set());
  const toggleProcess = (p: WorkflowProcess) =>
    setProcesses(prev => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });

  return (
    <div ref={page} className="space-y-5">
      <PageTitle
        title="Company Workflow"
        subtitle="Every department, its teams and people, and how work, customers, approvals and payments move between them. Drawn from the live records."
        actions={
          <button type="button" className={ghostBtn} onClick={load} disabled={loading}>
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" /> Refresh
          </button>
        }
      />

      {error && (
        <div role="alert" className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-sm text-rose-800 flex flex-wrap items-center gap-3">
          <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span className="flex-1 min-w-0">The company workflow could not be loaded: {error}</span>
          <button type="button" className={ghostBtn} onClick={load}>Try again</button>
        </div>
      )}
      {!data && !error && <LoadingLine label="Loading the company workflow…" />}

      {data && diagram && (
        <>
          <Card label="Workflow filters">
            <div className="p-4 flex flex-wrap items-end gap-3">
              <label className="text-xs font-semibold text-slate-600 min-w-[11rem] flex-1 sm:flex-none">
                Department
                <select
                  value={departmentId}
                  onChange={e => {
                    setDepartmentId(e.target.value);
                    setTeamId('ALL');
                    setSelected(null);
                  }}
                  className="mt-1 w-full h-10 px-3 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-900"
                >
                  <option value="ALL">All departments</option>
                  {data.departments.map(d => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              </label>
              <label className="text-xs font-semibold text-slate-600 min-w-[11rem] flex-1 sm:flex-none">
                Sub-department (team)
                <select
                  value={teamId}
                  onChange={e => {
                    setTeamId(e.target.value);
                    setSelected(null);
                  }}
                  disabled={departmentId === 'ALL'}
                  className="mt-1 w-full h-10 px-3 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-900 disabled:bg-slate-50 disabled:text-slate-400"
                >
                  <option value="ALL">{departmentId === 'ALL' ? 'Choose a department first' : teamsOfDepartment.length ? 'All teams' : 'No teams yet'}</option>
                  {teamsOfDepartment.map(t => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </label>
              {departmentId === 'ALL' && (
                <div className="flex gap-2">
                  <button type="button" className={ghostBtn} onClick={expandAll}><ChevronsUpDown className="w-4 h-4" aria-hidden="true" /> Expand all</button>
                  <button type="button" className={ghostBtn} onClick={collapseAll}><ChevronsDownUp className="w-4 h-4" aria-hidden="true" /> Collapse all</button>
                </div>
              )}
              {departmentId !== 'ALL' && (
                <button type="button" className={ghostBtn} onClick={() => { setDepartmentId('ALL'); setTeamId('ALL'); setSelected(null); }}>
                  <X className="w-4 h-4" aria-hidden="true" /> Show the whole company
                </button>
              )}
            </div>
            <div className="px-4 pb-4 flex flex-wrap items-center gap-2" role="group" aria-label="Kinds of hand-off">
              <span className="text-xs font-semibold text-slate-500 mr-1">Hand-offs</span>
              {PROCESS_ORDER.map(p => {
                const on = processes.has(p);
                return (
                  <button
                    key={p}
                    type="button"
                    aria-pressed={on}
                    title={PROCESS_META[p].description}
                    onClick={() => toggleProcess(p)}
                    className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-full border text-xs font-semibold transition-colors ${on ? 'bg-white border-slate-300 text-slate-900' : 'bg-slate-50 border-slate-200 text-slate-400'}`}
                  >
                    <i className="w-3 h-0.5 rounded-full" style={{ background: on ? PROCESS_META[p].color : '#cbd5e1' }} aria-hidden="true" /> {PROCESS_META[p].label}
                  </button>
                );
              })}
              <span className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-semibold text-slate-500">
                <i className="w-3 h-0.5 rounded-full bg-slate-400" aria-hidden="true" /> Reports to
              </span>
              <label className="inline-flex items-center gap-2 h-8 px-3 text-xs font-semibold text-slate-600 cursor-pointer">
                <input type="checkbox" checked={hideEmpty} onChange={e => setHideEmpty(e.target.checked)} className="rounded border-slate-300" /> Hide steps with no records
              </label>
            </div>
          </Card>

          {data.departments.length === 0 ? (
            <Card label="Company workflow">
              <p className="p-8 text-center text-sm text-slate-500" role="status">No departments exist yet. Add one under Departments and it will appear here.</p>
            </Card>
          ) : (
            <div className={`grid grid-cols-1 gap-4 items-start ${selected ? 'xl:grid-cols-[minmax(0,1fr)_22rem]' : ''}`}>
              <Canvas hideEmpty={hideEmpty} diagram={diagram} selected={selected} onSelect={setSelected} onToggle={toggleDept} filtered={departmentId !== 'ALL'} />
              {selected && <Details data={data} diagram={diagram} selected={selected} onClose={() => setSelected(null)} onFocusDepartment={id => { setDepartmentId(id); setTeamId('ALL'); setSelected(null); }} />}
            </div>
          )}
          <p className="text-xs text-slate-500">
            Showing {num(data.departments.length)} departments, {num(data.teams.length)} teams and {num(data.people.length + data.heads.length)} people. Updated {new Date(data.generatedAt).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}. The numbers on the arrows are records that have passed through that step.
          </p>
        </>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// The canvas: pan, zoom, fit
// ---------------------------------------------------------------------------
interface View { scale: number; x: number; y: number }

const Canvas: React.FC<{
  hideEmpty: boolean;
  diagram: Diagram;
  selected: Selection;
  onSelect: (s: Selection) => void;
  onToggle: (departmentId: string) => void;
  filtered: boolean;
}> = ({ hideEmpty, diagram, selected, onSelect, onToggle, filtered }) => {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 560 });
  const [view, setView] = useState<View>({ scale: 1, x: 0, y: 0 });
  const [hover, setHover] = useState<string | null>(null);
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean } | null>(null);
  const touches = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ d: number; scale: number } | null>(null);
  const fittedFor = useRef('');

  const byId = useMemo(() => new Map(diagram.nodes.map(n => [n.id, n])), [diagram]);
  // arrows between the same two boxes are spread apart
  const lanes = useMemo(() => {
    const seen = new Map<string, number>();
    const out = new Map<string, number>();
    for (const e of diagram.edges) {
      if (e.type !== 'process') continue;
      const k = [e.from, e.to].sort().join('|');
      const i = seen.get(k) ?? 0;
      seen.set(k, i + 1);
      out.set(e.id, i);
    }
    return out;
  }, [diagram]);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fit = useCallback(() => setView(fitView(diagram, size)), [diagram, size]);
  const narrow = size.w < 560;
  // fit when the picture itself changes (a filter, expand or collapse), not on every pan
  const signature = `${diagram.nodes.map(n => `${n.id}:${n.h}`).join(',')}|${Math.round(size.w / 40)}`;
  useEffect(() => {
    if (fittedFor.current !== signature) {
      fittedFor.current = signature;
      // on a phone the picture fills the width (readable) and is moved up and down; "Fit to screen" shows all of it
      setView(fitView(diagram, size, 28, narrow));
    }
  }, [signature, diagram, size, narrow]);

  const zoomAt = useCallback((factor: number, cx: number, cy: number) => {
    setView(v => {
      const scale = Math.min(2.5, Math.max(0.15, v.scale * factor));
      const k = scale / v.scale;
      return { scale, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k };
    });
  }, []);

  // the wheel zooms the picture (a passive listener cannot stop the page from scrolling)
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey || e.shiftKey)) return; // plain wheel keeps scrolling the page
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  const onPointerDown = (e: React.PointerEvent) => {
    touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.current.size === 2) {
      const [a, b] = [...touches.current.values()];
      pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y), scale: view.scale };
      drag.current = null;
    } else {
      drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false };
    }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (touches.current.has(e.pointerId)) touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch.current && touches.current.size === 2) {
      const [a, b] = [...touches.current.values()];
      const r = box.current!.getBoundingClientRect();
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const target = pinch.current.scale * (d / pinch.current.d);
      zoomAt(target / view.scale, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
      return;
    }
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.abs(dx) + Math.abs(dy) > 4) {
      d.moved = true;
      // only a real drag takes the pointer, so a plain click still reaches the box that was clicked
      (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    }
    if (d.moved) setView(v => ({ ...v, x: d.vx + dx, y: d.vy + dy }));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    touches.current.delete(e.pointerId);
    if (touches.current.size < 2) pinch.current = null;
    const d = drag.current;
    drag.current = null;
    // a click on empty canvas clears the selection (a drag does not)
    if (d && !d.moved && (e.target as Element).closest('[data-hit]') === null) onSelect(null);
  };

  const active = hover ?? (selected ? selected.id : null);
  const related = useMemo(() => {
    if (!active) return null;
    const ids = new Set<string>([active]);
    for (const e of diagram.edges) {
      if (e.id === active) { ids.add(e.from); ids.add(e.to); }
      if (e.from === active || e.to === active) { ids.add(e.id); ids.add(e.from); ids.add(e.to); }
    }
    return ids;
  }, [active, diagram]);
  const dim = (id: string) => (related && !related.has(id) ? 0.18 : 1);

  const selectNode = (n: DiagramNode) => onSelect({ type: 'node', id: n.id });
  const keyActivate = (fn: () => void) => (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); }
  };

  const processEdges = diagram.edges.filter(e => e.type === 'process' && (!hideEmpty || e.count > 0));
  const reportEdges = diagram.edges.filter(e => e.type === 'report');

  return (
    <section aria-label="Workflow diagram" className="relative bg-white rounded-2xl border border-slate-200 overflow-hidden">
      <div className="absolute top-3 right-3 z-10 flex items-center gap-1 bg-white/95 border border-slate-200 rounded-xl p-1 shadow-xs">
        <button type="button" className="w-9 h-9 rounded-lg hover:bg-slate-100 flex items-center justify-center" aria-label="Zoom out" onClick={() => zoomAt(1 / 1.25, size.w / 2, size.h / 2)}><Minus className="w-4 h-4" /></button>
        <span className="w-12 text-center text-xs font-bold text-slate-600 tabular-nums" aria-live="polite">{Math.round(view.scale * 100)}%</span>
        <button type="button" className="w-9 h-9 rounded-lg hover:bg-slate-100 flex items-center justify-center" aria-label="Zoom in" onClick={() => zoomAt(1.25, size.w / 2, size.h / 2)}><Plus className="w-4 h-4" /></button>
        <button type="button" className="h-9 px-2.5 rounded-lg hover:bg-slate-100 flex items-center gap-1.5 text-xs font-bold text-slate-700" onClick={fit}><Maximize2 className="w-4 h-4" aria-hidden="true" /> Fit to screen</button>
      </div>
      <div
        ref={box}
        className="h-[68vh] min-h-[24rem] max-h-[52rem] cursor-grab active:cursor-grabbing select-none touch-none bg-slate-50/60"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <svg width="100%" height="100%" role="group" aria-label={`Company workflow: ${diagram.nodes.filter(n => n.kind === 'department').length} departments`} style={{ display: 'block' }}>
          <defs>
            {PROCESS_ORDER.map(p => (
              <marker key={p} id={`wf-arrow-${p}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill={PROCESS_META[p].color} />
              </marker>
            ))}
            <marker id="wf-arrow-multi" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#334155" />
            </marker>
            <marker id="wf-arrow-report" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
              <path d="M 1 1 L 9 5 L 1 9" fill="none" stroke="#94a3b8" strokeWidth="1.6" />
            </marker>
          </defs>
          <g transform={`translate(${view.x} ${view.y}) scale(${view.scale})`}>
            {/* the department boxes are the background: arrows run over them and under their text */}
            {diagram.nodes.filter(n => n.kind === 'department').map(n => (
              <g key={`bg-${n.id}`} opacity={dim(n.id)} aria-hidden="true">
                <rect x={n.x} y={n.y} width={n.w} height={n.h} rx={18} fill="#fff" stroke={selected?.type === 'node' && selected.id === n.id ? n.accent : '#e2e8f0'} strokeWidth={selected?.type === 'node' && selected.id === n.id ? 3 : 1.5} />
                <rect x={n.x} y={n.y} width={7} height={n.h} rx={3.5} fill={n.accent} />
              </g>
            ))}
            <g aria-hidden="true">
              {reportEdges.map(e => {
                const a = byId.get(e.from);
                const b = byId.get(e.to);
                if (!a || !b) return null;
                const p = reportPath(a, b);
                return <path key={e.id} d={p.d} fill="none" stroke="#94a3b8" strokeWidth={1.6} markerEnd="url(#wf-arrow-report)" opacity={dim(e.from) < 1 && dim(e.to) < 1 ? 0.18 : 1} />;
              })}
            </g>
            {processEdges.map(e => {
              const a = byId.get(e.from);
              const b = byId.get(e.to);
              if (!a || !b) return null;
              const path = edgePath(a, b, lanes.get(e.id) ?? 0);
              const color = edgeColor(e);
              const isSel = selected?.type === 'edge' && selected.id === e.id;
              const op = related ? (related.has(e.id) ? 1 : 0.12) : 0.9;
              const text = `${num(e.count)}`;
              return (
                <g key={e.id} opacity={op} data-hit="" role="button" tabIndex={0} className="outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600"
                  aria-label={`${e.label}: ${num(e.count)} ${e.countLabel}. From ${byId.get(e.from)?.title} to ${byId.get(e.to)?.title}`}
                  onClick={ev => { ev.stopPropagation(); onSelect({ type: 'edge', id: e.id }); }}
                  onKeyDown={keyActivate(() => onSelect({ type: 'edge', id: e.id }))}
                  onMouseEnter={() => setHover(e.id)} onMouseLeave={() => setHover(null)} style={{ cursor: 'pointer' }}>
                  <path d={path.d} fill="none" stroke="transparent" strokeWidth={16} />
                  <path d={path.d} fill="none" stroke={color} strokeWidth={isSel ? 3.4 : 2.2} strokeDasharray="7 4" markerEnd={`url(#wf-arrow-${e.process ?? 'multi'})`} />
                  <g transform={`translate(${path.mid.x} ${path.mid.y})`}>
                    <rect x={-(text.length * 4.2 + 9)} y={-10} width={text.length * 8.4 + 18} height={20} rx={10} fill="#fff" stroke={color} strokeWidth={isSel ? 2 : 1.2} />
                    <text textAnchor="middle" y={4} fontSize={11} fontWeight={800} fill={color}>{text}</text>
                  </g>
                </g>
              );
            })}
            {diagram.nodes.filter(n => n.kind === 'root').map(n => (
              <g key={n.id} opacity={dim(n.id)} onMouseEnter={() => setHover(n.id)} onMouseLeave={() => setHover(null)}>
                <rect x={n.x} y={n.y} width={n.w} height={n.h} rx={16} fill="#0f172a" />
                <text x={n.x + n.w / 2} y={n.y + 27} textAnchor="middle" fill="#fff" fontSize={16} fontWeight={800}>{n.title}</text>
                <text x={n.x + n.w / 2} y={n.y + 47} textAnchor="middle" fill="#cbd5e1" fontSize={12}>{n.sub} · {n.chips[0]}</text>
              </g>
            ))}
            {diagram.nodes.filter(n => n.kind === 'department').map(n => (
              <DepartmentBox key={n.id} n={n} opacity={dim(n.id)} onSelect={() => selectNode(n)} onToggle={() => n.departmentId && onToggle(n.departmentId)} onHover={setHover} keyActivate={keyActivate} locked={filtered} />
            ))}
            {diagram.nodes.filter(n => n.kind !== 'department' && n.kind !== 'root').map(n => (
              <InnerNode key={n.id} n={n} opacity={dim(n.id)} selected={selected?.type === 'node' && selected.id === n.id} onSelect={() => selectNode(n)} onHover={setHover} keyActivate={keyActivate} />
            ))}
          </g>
        </svg>
      </div>
      <p className="px-4 py-2 text-[11px] text-slate-500 border-t border-slate-100">
        Drag to move. Use the buttons, pinch, or Ctrl + scroll to zoom. Click a department's arrow to open or close it, and any box or arrow for details.
      </p>
    </section>
  );
};

const DepartmentBox: React.FC<{
  n: DiagramNode;
  opacity: number;
  locked: boolean;
  onSelect: () => void;
  onToggle: () => void;
  onHover: (id: string | null) => void;
  keyActivate: (fn: () => void) => (e: React.KeyboardEvent) => void;
}> = ({ n, opacity, locked, onSelect, onToggle, onHover, keyActivate }) => (
  <g opacity={opacity} onMouseEnter={() => onHover(n.id)} onMouseLeave={() => onHover(null)}>
    <g data-hit="" role="button" tabIndex={0} className="outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600" aria-label={`${n.title}. ${n.chips.join(', ')}. ${n.expanded ? 'Expanded' : 'Collapsed'}. Press Enter for details`} onClick={ev => { ev.stopPropagation(); onSelect(); }} onKeyDown={keyActivate(onSelect)} style={{ cursor: 'pointer' }}>
      <rect x={n.x + 8} y={n.y} width={n.w - 52} height={76} fill="transparent" />
      <text x={n.x + 24} y={n.y + 28} fontSize={18} fontWeight={800} fill="#0f172a">{clip(n.title, 22)}</text>
      <text x={n.x + 24} y={n.y + 49} fontSize={13} fill="#64748b">{clip(n.sub || (n.empty ? 'Nothing set up yet' : ''), 34)}</text>
      <text x={n.x + 24} y={n.y + 68} fontSize={12.5} fontWeight={600} fill="#475569">{clip(n.chips.slice(0, 3).join('  ·  '), 38)}</text>
    </g>
    {!locked && (
      <g data-hit="" role="button" tabIndex={0} className="outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600" aria-label={`${n.expanded ? 'Collapse' : 'Expand'} ${n.title}`} aria-expanded={!!n.expanded}
        onClick={ev => { ev.stopPropagation(); onToggle(); }} onKeyDown={keyActivate(onToggle)} style={{ cursor: 'pointer' }}>
        <circle cx={n.x + n.w - 24} cy={n.y + 26} r={14} fill="#f1f5f9" stroke="#cbd5e1" />
        <path d={n.expanded ? `M ${n.x + n.w - 30} ${n.y + 28} l 6 -6 l 6 6` : `M ${n.x + n.w - 30} ${n.y + 23} l 6 6 l 6 -6`} fill="none" stroke="#334155" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      </g>
    )}
  </g>
);

const InnerNode: React.FC<{
  n: DiagramNode;
  opacity: number;
  selected: boolean;
  onSelect: () => void;
  onHover: (id: string | null) => void;
  keyActivate: (fn: () => void) => (e: React.KeyboardEvent) => void;
}> = ({ n, opacity, selected, onSelect, onHover, keyActivate }) => {
  const fill = n.kind === 'head' ? '#eff6ff' : n.kind === 'consultants' ? '#f5f3ff' : '#f8fafc';
  const stroke = selected ? n.accent : n.kind === 'head' ? '#bfdbfe' : n.kind === 'consultants' ? '#ddd6fe' : '#e2e8f0';
  return (
    <g data-hit="" opacity={opacity} role="button" tabIndex={0} className="outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600" aria-label={`${n.title}: ${n.sub}. ${n.chips.join(', ')}`} onClick={ev => { ev.stopPropagation(); onSelect(); }} onKeyDown={keyActivate(onSelect)}
      onMouseEnter={() => onHover(n.id)} onMouseLeave={() => onHover(null)} style={{ cursor: 'pointer' }}>
      <rect x={n.x} y={n.y} width={n.w} height={n.h} rx={12} fill={fill} stroke={stroke} strokeWidth={selected ? 2.5 : 1.3} strokeDasharray={n.empty ? '4 3' : undefined} />
      <text x={n.x + 14} y={n.y + 22} fontSize={13.5} fontWeight={800} fill="#0f172a">{clip(n.title, 28)}</text>
      <text x={n.x + 14} y={n.y + 40} fontSize={11.5} fill={n.empty ? '#94a3b8' : '#475569'}>{clip(n.sub, 40)}</text>
      {n.chips.length > 0 && <text x={n.x + 14} y={n.y + 60} fontSize={11} fontWeight={600} fill="#64748b">{clip(n.chips.join('  ·  '), 44)}</text>}
    </g>
  );
};

// ---------------------------------------------------------------------------
// Details of what is selected
// ---------------------------------------------------------------------------
const Details: React.FC<{
  data: CompanyWorkflowData;
  diagram: Diagram;
  selected: Selection;
  onClose: () => void;
  onFocusDepartment: (id: string) => void;
}> = ({ data, diagram, selected, onClose, onFocusDepartment }) => {
  const nodeById = new Map(diagram.nodes.map(n => [n.id, n]));
  const edgesOf = (id: string): DiagramEdge[] => diagram.edges.filter(e => e.type === 'process' && (e.from === id || e.to === id));
  const titleOf = (id: string) => nodeById.get(id)?.title ?? id;

  if (!selected) {
    return (
      <Card label="Details">
        <div className="p-5 text-sm text-slate-600 space-y-3">
          <h2 className="text-base font-extrabold text-slate-900">Details</h2>
          <p>Click a department, team, role box or arrow to see its people and the processes that connect to it.</p>
          <ul className="space-y-1.5 text-xs text-slate-500">
            {PROCESS_ORDER.map(p => (
              <li key={p} className="flex gap-2"><i className="mt-1.5 w-3 h-0.5 rounded-full shrink-0" style={{ background: PROCESS_META[p].color }} aria-hidden="true" /><span><b className="text-slate-700">{PROCESS_META[p].label}.</b> {PROCESS_META[p].description}</span></li>
            ))}
          </ul>
        </div>
      </Card>
    );
  }

  if (selected.type === 'edge') {
    const e = diagram.edges.find(x => x.id === selected.id);
    if (!e) return null;
    const items = data.handoffs.filter(h => e.keys.includes(h.key));
    return (
      <Card label="Hand-off details">
        <div className="p-5 space-y-3 text-sm">
          <DetailHead title={e.label} onClose={onClose} color={edgeColor(e)} />
          <p className="text-slate-600">{titleOf(e.from)} <span aria-hidden="true">→</span><span className="sr-only"> to </span> {titleOf(e.to)}</p>
          <p className="text-slate-600">{e.hint}</p>
          <p className="text-2xl font-extrabold text-slate-900">{num(e.count)} <span className="text-sm font-semibold text-slate-500">{e.countLabel}</span></p>
          {items.length > 1 && (
            <ul className="divide-y divide-slate-100 border border-slate-100 rounded-xl">
              {items.map(h => {
                const a = data.teams.find(t => t.id === h.from.id)?.name ?? data.departments.find(d => d.id === h.from.id)?.name ?? '';
                const z = data.teams.find(t => t.id === h.to.id)?.name ?? data.departments.find(d => d.id === h.to.id)?.name ?? '';
                return (
                  <li key={h.key} className="px-3 py-2 flex items-center justify-between gap-3 text-[13px]">
                    <span className="min-w-0 truncate">{h.label}{a || z ? <span className="text-slate-500"> · {a} → {z}</span> : null}</span>
                    <b className="tabular-nums">{num(h.count)}</b>
                  </li>
                );
              })}
            </ul>
          )}
          {items.length === 1 && items[0].extra && (
            <dl className="text-[13px] space-y-1">
              {Object.entries(items[0].extra).map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3"><dt className="text-slate-500">{k.replace(/([A-Z])/g, ' $1').toLowerCase()}</dt><dd className="font-bold">{num(v)}</dd></div>
              ))}
            </dl>
          )}
          {e.count === 0 && <p className="text-xs text-slate-500">Nothing is waiting here right now. The step exists in the CRM; this number counts the records at it.</p>}
        </div>
      </Card>
    );
  }

  const n = nodeById.get(selected.id);
  if (!n) return null;
  const related = edgesOf(n.id);

  if (n.kind === 'root') {
    return (
      <Card label="Super Admin">
        <div className="p-5 space-y-2 text-sm"><DetailHead title="Super Admin" onClose={onClose} color="#0f172a" /><p className="text-slate-600">Sees every department. All departments report here.</p></div>
      </Card>
    );
  }

  if (n.kind === 'department') {
    const d = data.departments.find(x => x.id === n.departmentId)!;
    const teams = data.teams.filter(t => t.departmentId === d.id);
    const heads = data.heads.filter(h => h.departmentId === d.id);
    return (
      <Card label="Department details">
        <div className="p-5 space-y-4 text-sm">
          <DetailHead title={d.name} onClose={onClose} color={d.accent} />
          {d.description && <p className="text-slate-600">{d.description}</p>}
          <dl className="grid grid-cols-3 gap-2 text-center">
            <Stat k="Staff" v={d.staff} /><Stat k="Teams" v={teams.length} /><Stat k="Customers" v={d.customers} />
          </dl>
          {d.locked && <p className="text-xs font-semibold text-amber-700 bg-amber-50 rounded-lg px-3 py-2">Locked: its staff cannot sign in to it until unlocked.</p>}
          <Section title="Department Head">{heads.length ? heads.map(h => <li key={h.id}>{h.name}</li>) : <li className="text-slate-400">None assigned yet</li>}</Section>
          <Section title="Teams (sub-departments)">
            {teams.length === 0 ? <li className="text-slate-400">No teams yet</li> : teams.map(t => (
              <li key={t.id} className="flex justify-between gap-3"><span className="truncate">{t.name} <span className="text-slate-400">· {t.division.toLowerCase()}</span></span><span className="text-slate-500 shrink-0">{t.leadCount} lead{t.leadCount === 1 ? '' : 's'}, {t.memberCount} member{t.memberCount === 1 ? '' : 's'}</span></li>
            ))}
          </Section>
          <ProcessList edges={related} titleOf={titleOf} />
          <button type="button" className={`${ghostBtn} w-full justify-center`} onClick={() => onFocusDepartment(d.id)}>Show only this department</button>
        </div>
      </Card>
    );
  }

  const team = n.teamId ? data.teams.find(t => t.id === n.teamId) : null;
  if (n.kind === 'head') {
    const heads = data.heads.filter(h => h.departmentId === n.departmentId);
    return (
      <Card label="Department Head details">
        <div className="p-5 space-y-4 text-sm">
          <DetailHead title="Department Head" onClose={onClose} color={n.accent} />
          <p className="text-slate-600">{data.departments.find(d => d.id === n.departmentId)?.name}</p>
          <Section title="Who">{heads.length ? heads.map(h => <li key={h.id}>{h.name}</li>) : <li className="text-slate-400">None assigned yet</li>}</Section>
          <p className="text-xs text-slate-500">Assigns work to Team Leads, receives hand-overs from the Technical Consultant and escalated tickets, and approves leave before HR.</p>
          <ProcessList edges={related} titleOf={titleOf} />
        </div>
      </Card>
    );
  }

  const people = data.people.filter(p => p.teamId === n.teamId && (n.kind === 'consultants' ? p.consultant : true));
  return (
    <Card label={n.kind === 'consultants' ? 'Technical Consultants' : 'Team details'}>
      <div className="p-5 space-y-4 text-sm">
        <DetailHead title={n.kind === 'consultants' ? `Technical Consultants · ${team?.name ?? ''}` : n.title} onClose={onClose} color={n.accent} />
        {team && (
          <dl className="grid grid-cols-3 gap-2 text-center">
            <Stat k="Leads" v={team.leadCount} /><Stat k="Members" v={team.memberCount} /><Stat k="Customers" v={team.customers} />
          </dl>
        )}
        <Section title={n.kind === 'consultants' ? 'Consultants' : 'People'}>
          {people.length === 0 ? <li className="text-slate-400">Nobody assigned yet</li> : people.map(p => (
            <li key={p.id} className="flex justify-between gap-3"><span className="truncate">{p.name}</span><span className="text-slate-500 shrink-0 truncate">{p.consultant ? 'Technical Consultant' : p.title || ROLE_LABEL[p.role] || p.role}</span></li>
          ))}
        </Section>
        <ProcessList edges={related} titleOf={titleOf} />
      </div>
    </Card>
  );
};

const DetailHead: React.FC<{ title: string; color: string; onClose: () => void }> = ({ title, color, onClose }) => (
  <div className="flex items-start justify-between gap-3">
    <h2 className="text-base font-extrabold text-slate-900 flex items-center gap-2 min-w-0"><i className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: color }} aria-hidden="true" /> <span className="truncate">{title}</span></h2>
    <button type="button" onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center shrink-0" aria-label="Close details"><X className="w-4 h-4" /></button>
  </div>
);
const Stat: React.FC<{ k: string; v: number }> = ({ k, v }) => (
  <div className="rounded-xl bg-slate-50 py-2"><dd className="text-lg font-extrabold text-slate-900 tabular-nums">{num(v)}</dd><dt className="text-[11px] font-semibold text-slate-500">{k}</dt></div>
);
const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div><h3 className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-1.5">{title}</h3><ul className="space-y-1 text-slate-800 max-h-48 overflow-y-auto">{children}</ul></div>
);
const ProcessList: React.FC<{ edges: DiagramEdge[]; titleOf: (id: string) => string }> = ({ edges, titleOf }) =>
  edges.length === 0 ? null : (
    <div>
      <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-1.5">Connected processes</h3>
      <ul className="space-y-1.5">
        {edges.map(e => (
          <li key={e.id} className="flex items-start gap-2 text-[13px]">
            <i className="mt-1.5 w-3 h-0.5 rounded-full shrink-0" style={{ background: edgeColor(e) }} aria-hidden="true" />
            <span className="min-w-0 flex-1">{e.label}<span className="block text-xs text-slate-500 truncate">{titleOf(e.from)} → {titleOf(e.to)}</span></span>
            <b className="tabular-nums">{num(e.count)}</b>
          </li>
        ))}
      </ul>
    </div>
  );
