import type { CompanyWorkflow, WorkflowEndpoint, WorkflowHandoff, WorkflowProcess } from '../../../shared/contracts';

/**
 * The company workflow diagram, worked out from the rows the database returned (see company_workflow()).
 * Nothing here names a department: boxes come from departments, teams and people, and arrows from the hand-offs. A department
 * that is collapsed stands in for everything inside it, so a company with many departments is still one readable picture.
 * Pure functions, no React: the screen only draws what this returns.
 */

export type NodeKind = 'root' | 'department' | 'head' | 'team' | 'consultants';

export interface DiagramNode {
  id: string;
  kind: NodeKind;
  departmentId: string | null;
  teamId: string | null;
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
  sub: string;
  /** Short facts shown in the box (a count, a division). */
  chips: string[];
  accent: string;
  /** A department box also holds the nodes of the department when it is expanded. */
  expanded?: boolean;
  empty?: boolean;
}

export interface DiagramEdge {
  id: string;
  type: 'report' | 'process';
  from: string;
  to: string;
  /** The kind of hand-off, or null when one arrow stands for several kinds. */
  process?: WorkflowProcess | null;
  processes?: WorkflowProcess[];
  label: string;
  hint: string;
  count: number;
  countLabel: string;
  /** More than one hand-off drawn as one arrow when departments are collapsed. */
  merged: number;
  keys: string[];
}

export interface Diagram {
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  width: number;
  height: number;
}

export interface DiagramOptions {
  /** Departments shown with their head, teams and consultants. */
  expanded: ReadonlySet<string>;
  /** One department (the others it hands work to or receives from stay, collapsed), or all. */
  departmentId: string | 'ALL';
  /** One team (sub-department) of that department, or all. */
  teamId: string | 'ALL';
  /** Which kinds of hand-off to draw. */
  processes: ReadonlySet<WorkflowProcess>;
  /** How many department boxes fit side by side (from the width of the screen); 4 when not given. */
  columns?: number;
}

export const PROCESS_META: Record<WorkflowProcess, { label: string; color: string; description: string }> = {
  payment: { label: 'Payment confirmation', color: '#059669', description: 'Sales or Support send a lead to Accounts, who verify the payment and return it' },
  addon: { label: 'Add-on services', color: '#0d9488', description: 'A client asks for another service; Accounts verifies the price and the payment' },
  onboarding: { label: 'Onboarding hand-over', color: '#2563eb', description: 'Technical Consultant, Department Head, Team Lead, Team Member' },
  delivery: { label: 'Service delivery', color: '#7c3aed', description: 'Services that need no consultant go to their own department' },
  tickets: { label: 'Ticket escalation', color: '#e11d48', description: 'Member, Team Lead, Department Head' },
  tasks: { label: 'Work tasks', color: '#d97706', description: 'Department Head assigns to Team Leads; updates come back up' },
  leave: { label: 'Leave approval', color: '#475569', description: 'Department Head, then HR' }
};

export const PROCESS_ORDER = Object.keys(PROCESS_META) as WorkflowProcess[];

const CARD_W = 300;
const COLLAPSED_H = 100;
const HEADER_H = 76;
const NODE_W = 276;
const HEAD_H = 56;
const TEAM_H = 84;
const CONSULT_H = 48;
const PAD = 12;
const GAP_X = 80;
const GAP_Y = 64;
const ROOT = { w: 260, h: 64 };

export const endpointId = (e: WorkflowEndpoint) => (e.kind === 'department' ? `dept:${e.id}` : `${e.kind}:${e.id}`);

const join = (names: string[], max = 2) => (names.length <= max ? names.join(', ') : `${names.slice(0, max).join(', ')} +${names.length - max}`);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const DIVISION: Record<string, string> = { SALES: 'Sales', SUPPORT: 'Support', GENERAL: 'General' };

/** Departments a department is connected to by at least one hand-off (so filtering to one still shows where its work goes). */
export function neighboursOf(data: CompanyWorkflow, departmentId: string): Set<string> {
  const teamDept = new Map(data.teams.map(t => [t.id, t.departmentId]));
  const deptOf = (e: WorkflowEndpoint) => (e.kind === 'department' || e.kind === 'head' ? e.id : teamDept.get(e.id));
  const out = new Set<string>();
  for (const h of data.handoffs) {
    const a = deptOf(h.from);
    const b = deptOf(h.to);
    if (a === departmentId && b && b !== departmentId) out.add(b);
    if (b === departmentId && a && a !== departmentId) out.add(a);
  }
  return out;
}

export function buildDiagram(data: CompanyWorkflow, opt: DiagramOptions): Diagram {
  const teamsOf = (d: string) => data.teams.filter(t => t.departmentId === d);
  const headsOf = (d: string) => data.heads.filter(h => h.departmentId === d);

  const focusDept = opt.departmentId !== 'ALL' && data.departments.some(d => d.id === opt.departmentId) ? opt.departmentId : null;
  const focusTeam = focusDept && opt.teamId !== 'ALL' && teamsOf(focusDept).some(t => t.id === opt.teamId) ? opt.teamId : null;
  const neighbours = focusDept ? neighboursOf(data, focusDept) : null;
  // the department being inspected comes first, then the ones it hands work to or receives from
  const visibleDepts = data.departments
    .filter(d => !focusDept || d.id === focusDept || neighbours!.has(d.id))
    .sort((a, b) => (a.id === focusDept ? -1 : b.id === focusDept ? 1 : 0));
  const isExpanded = (d: string) => (focusDept ? d === focusDept : opt.expanded.has(d));

  // which team nodes exist in a department (a team filter leaves one)
  const teamsShown = (d: string) => teamsOf(d).filter(t => !(focusTeam && d === focusDept) || t.id === focusTeam);
  const hasConsultants = (t: { consultantCount: number; division: string }) => t.division === 'SUPPORT' && t.consultantCount > 0;

  // ---- grid of department boxes
  const n = visibleDepts.length;
  const cols = Math.max(1, Math.min(opt.columns ?? 4, n || 1));
  type Box = { id: string; col: number; row: number; h: number; expanded: boolean };
  const boxes: Box[] = visibleDepts.map((d, i) => {
    const expanded = isExpanded(d.id);
    let h = COLLAPSED_H;
    if (expanded) {
      h = HEADER_H + PAD + HEAD_H + PAD;
      for (const t of teamsShown(d.id)) h += TEAM_H + PAD + (hasConsultants(t) ? CONSULT_H + PAD : 0);
      if (teamsShown(d.id).length === 0) h += 36;
    }
    return { id: d.id, col: i % cols, row: Math.floor(i / cols), h, expanded };
  });
  const rows = Math.max(1, ...boxes.map(b => b.row + 1));
  const rowH = Array.from({ length: rows }, (_, r) => Math.max(0, ...boxes.filter(b => b.row === r).map(b => b.h)));
  const rowY = rowH.map((_, r) => rowH.slice(0, r).reduce((s, h) => s + h + GAP_Y, ROOT.h + GAP_Y));
  const gridW = cols * CARD_W + (cols - 1) * GAP_X;

  const nodes: DiagramNode[] = [];
  nodes.push({
    id: 'root', kind: 'root', departmentId: null, teamId: null, x: gridW / 2 - ROOT.w / 2, y: 0, w: ROOT.w, h: ROOT.h,
    title: 'Super Admin', sub: 'Amuwa Corporation', chips: [plural(data.departments.length, 'department')], accent: '#0f172a'
  });

  const place = new Map<string, string>(); // endpoint id -> node id actually drawn (collapsed boxes stand in for what is inside)
  for (const b of boxes) {
    const d = data.departments.find(x => x.id === b.id)!;
    const x = b.col * (CARD_W + GAP_X);
    const y = rowY[b.row];
    const teams = teamsOf(d.id);
    const heads = headsOf(d.id);
    const deptId = `dept:${d.id}`;
    nodes.push({
      id: deptId, kind: 'department', departmentId: d.id, teamId: null, x, y, w: CARD_W, h: b.h,
      title: d.name, sub: d.category || '',
      chips: [plural(teams.length, 'team'), `${d.staff} staff`, plural(d.customers, 'customer')]
        .concat(d.locked ? ['Locked'] : []),
      accent: d.accent, expanded: b.expanded, empty: teams.length === 0 && d.staff === 0
    });
    place.set(deptId, deptId);
    place.set(`head:${d.id}`, deptId);
    for (const t of teams) {
      place.set(`team:${t.id}`, deptId);
      place.set(`consultants:${t.id}`, deptId);
    }
    if (!b.expanded) continue;

    let cy = y + HEADER_H + PAD;
    const headId = `head:${d.id}`;
    nodes.push({
      id: headId, kind: 'head', departmentId: d.id, teamId: null, x: x + (CARD_W - NODE_W) / 2, y: cy, w: NODE_W, h: HEAD_H,
      title: 'Department Head', sub: heads.length ? join(heads.map(h => h.name)) : 'No Department Head assigned yet', chips: [], accent: d.accent, empty: heads.length === 0
    });
    place.set(headId, headId);
    cy += HEAD_H + PAD;
    for (const t of teamsShown(d.id)) {
      const leads = data.people.filter(p => p.teamId === t.id && p.role === 'TEAM_HEAD').map(p => p.name);
      const teamId = `team:${t.id}`;
      nodes.push({
        id: teamId, kind: 'team', departmentId: d.id, teamId: t.id, x: x + (CARD_W - NODE_W) / 2, y: cy, w: NODE_W, h: TEAM_H,
        title: t.name, sub: leads.length ? `Lead: ${join(leads)}` : 'No Team Lead assigned yet',
        chips: [DIVISION[t.division] ?? t.division, plural(t.memberCount, 'member')].concat(t.customers ? [plural(t.customers, 'customer')] : []),
        accent: d.accent, empty: leads.length === 0 && t.memberCount === 0
      });
      place.set(teamId, teamId);
      cy += TEAM_H + PAD;
      if (hasConsultants(t)) {
        const cid = `consultants:${t.id}`;
        nodes.push({
          id: cid, kind: 'consultants', departmentId: d.id, teamId: t.id, x: x + (CARD_W - NODE_W) / 2 + 24, y: cy, w: NODE_W - 24, h: CONSULT_H,
          title: 'Technical Consultants', sub: plural(t.consultantCount, 'consultant'), chips: [], accent: d.accent
        });
        place.set(cid, cid);
        cy += CONSULT_H + PAD;
      }
    }
  }

  // ---- reporting lines: Super Admin -> department -> head -> team -> consultants
  const edges: DiagramEdge[] = [];
  const addReport = (from: string, to: string) =>
    edges.push({ id: `report:${from}>${to}`, type: 'report', from, to, label: 'Reports to', hint: '', count: 0, countLabel: '', merged: 1, keys: [] });
  for (const b of boxes) {
    addReport('root', `dept:${b.id}`);
    if (!b.expanded) continue;
    addReport(`dept:${b.id}`, `head:${b.id}`);
    for (const t of teamsShown(b.id)) {
      addReport(`head:${b.id}`, `team:${t.id}`);
      if (hasConsultants(t)) addReport(`team:${t.id}`, `consultants:${t.id}`);
    }
  }

  // ---- hand-offs (process): drawn between what is on screen, merged when a collapsed box hides the detail
  const merged = new Map<string, DiagramEdge>();
  for (const h of data.handoffs as WorkflowHandoff[]) {
    if (!opt.processes.has(h.process)) continue;
    const a = place.get(endpointId(h.from));
    const z = place.get(endpointId(h.to));
    if (!a || !z || a === z) continue;
    if (focusTeam) {
      const touches = (e: WorkflowEndpoint) => (e.kind === 'team' || e.kind === 'consultants') && e.id === focusTeam;
      const headOf = (e: WorkflowEndpoint) => e.kind === 'head' && e.id === focusDept;
      if (!(touches(h.from) || touches(h.to) || headOf(h.from) || headOf(h.to))) continue;
    }
    // one arrow per pair of boxes; when several hand-offs share it the arrow is neutral and the details list each one
    const key = `${a}>${z}`;
    const cur = merged.get(key);
    if (cur) {
      cur.count += h.count;
      cur.merged += 1;
      cur.keys.push(h.key);
      if (!cur.processes!.includes(h.process)) cur.processes!.push(h.process);
      cur.process = cur.processes!.length === 1 ? cur.processes![0] : null;
      cur.label = cur.process ? PROCESS_META[cur.process].label : `${cur.merged} hand-offs`;
      cur.hint = cur.process ? PROCESS_META[cur.process].description : 'Several hand-offs run between these two';
      cur.countLabel = 'records in total';
    } else {
      merged.set(key, { id: `process:${key}`, type: 'process', from: a, to: z, process: h.process, processes: [h.process], label: h.label, hint: h.hint, count: h.count, countLabel: h.countLabel, merged: 1, keys: [h.key] });
    }
  }
  edges.push(...merged.values());

  const height = rowY[rows - 1] + rowH[rows - 1];
  // a little room on the right for the arrows that loop outside an expanded department
  return { nodes, edges, width: gridW + (boxes.some(b => b.expanded) ? 90 : 0), height };
}

// ---------------------------------------------------------------------------
// Geometry for drawing
// ---------------------------------------------------------------------------
export interface Point { x: number; y: number }
export interface EdgePath { d: string; mid: Point; start: Point; end: Point; angle: number }

const side = (n: DiagramNode, s: 'l' | 'r' | 't' | 'b'): Point =>
  s === 'l' ? { x: n.x, y: n.y + n.h / 2 } : s === 'r' ? { x: n.x + n.w, y: n.y + n.h / 2 } : s === 't' ? { x: n.x + n.w / 2, y: n.y } : { x: n.x + n.w / 2, y: n.y + n.h };

/** A smooth curve leaving one box on the side that faces the other, and arriving on the side that faces back. */
export function edgePath(a: DiagramNode, b: DiagramNode, lane = 0): EdgePath {
  // two boxes stacked inside one department: a bracket on the right-hand side, clear of the reporting line down the middle
  if (a.departmentId && a.departmentId === b.departmentId && a.kind !== 'department' && b.kind !== 'department') {
    const p0 = { x: a.x + a.w, y: a.y + a.h / 2 + lane * 10 };
    const p3 = { x: b.x + b.w, y: b.y + b.h / 2 + lane * 10 };
    const out = Math.max(p0.x, p3.x) + 34 + Math.min(40, Math.abs(p3.y - p0.y) / 6);
    const c1 = { x: out, y: p0.y };
    const c2 = { x: out, y: p3.y };
    const mid = { x: 0.125 * p0.x + 0.375 * c1.x + 0.375 * c2.x + 0.125 * p3.x, y: (p0.y + p3.y) / 2 };
    return { d: `M ${p0.x} ${p0.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${p3.x} ${p3.y}`, mid, start: p0, end: p3, angle: 180 };
  }
  const ac = { x: a.x + a.w / 2, y: a.y + a.h / 2 };
  const bc = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  const dx = bc.x - ac.x;
  const dy = bc.y - ac.y;
  const horizontal = Math.abs(dx) > Math.abs(dy) + (a.w + b.w) / 4 && (a.x + a.w <= b.x || b.x + b.w <= a.x);
  const sa = horizontal ? (dx > 0 ? 'r' : 'l') : dy > 0 ? 'b' : 't';
  const sb = horizontal ? (dx > 0 ? 'l' : 'r') : dy > 0 ? 't' : 'b';
  let p0 = side(a, sa);
  let p3 = side(b, sb);
  // parallel arrows between the same two boxes are spread apart so they do not sit on each other
  if (lane) {
    if (horizontal) { p0 = { ...p0, y: p0.y + lane * 14 }; p3 = { ...p3, y: p3.y + lane * 14 }; }
    else { p0 = { ...p0, x: p0.x + lane * 14 }; p3 = { ...p3, x: p3.x + lane * 14 }; }
  }
  const reach = Math.max(40, Math.hypot(p3.x - p0.x, p3.y - p0.y) / 3);
  const c1 = horizontal ? { x: p0.x + Math.sign(dx) * reach, y: p0.y } : { x: p0.x, y: p0.y + Math.sign(dy || 1) * reach };
  const c2 = horizontal ? { x: p3.x - Math.sign(dx) * reach, y: p3.y } : { x: p3.x, y: p3.y - Math.sign(dy || 1) * reach };
  const t = 0.5;
  const mt = 1 - t;
  const mid = {
    x: mt ** 3 * p0.x + 3 * mt * mt * t * c1.x + 3 * mt * t * t * c2.x + t ** 3 * p3.x,
    y: mt ** 3 * p0.y + 3 * mt * mt * t * c1.y + 3 * mt * t * t * c2.y + t ** 3 * p3.y
  };
  const angle = (Math.atan2(p3.y - c2.y, p3.x - c2.x) * 180) / Math.PI;
  return { d: `M ${p0.x} ${p0.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${p3.x} ${p3.y}`, mid, start: p0, end: p3, angle };
}

/** Zoom and offset that fit the whole diagram in a box of the given size. */
export function fitView(d: Pick<Diagram, 'width' | 'height'>, box: { w: number; h: number }, margin = 28, widthOnly = false): { scale: number; x: number; y: number } {
  const bw = Math.max(1, d.width);
  const bh = Math.max(1, d.height);
  // widthOnly: the picture fills the width and is taller than the screen (a phone); the whole picture is the "Fit to screen" button
  const scale = Math.max(0.15, Math.min(1.15, (box.w - margin * 2) / bw, widthOnly ? Infinity : (box.h - margin * 2) / bh));
  return { scale, x: (box.w - bw * scale) / 2, y: Math.max(margin, (box.h - bh * scale) / 2) };
}

/** Reporting lines: Super Admin to each department box, and straight elbows down the inside of an expanded department. */
export function reportPath(a: DiagramNode, b: DiagramNode): EdgePath {
  if (a.kind === 'root') {
    const p0 = side(a, 'b');
    const p3 = side(b, 't');
    const my = p0.y + (p3.y - p0.y) / 2;
    return { d: `M ${p0.x} ${p0.y} C ${p0.x} ${my}, ${p3.x} ${my}, ${p3.x} ${p3.y}`, mid: { x: (p0.x + p3.x) / 2, y: my }, start: p0, end: p3, angle: 90 };
  }
  // inside a department: from the bottom of the parent (the header strip for a department box) to the top of the child
  const p0 = a.kind === 'department' ? { x: b.x + b.w / 2, y: a.y + HEADER_H } : { x: a.x + a.w / 2, y: a.y + a.h };
  const p3 = { x: b.x + b.w / 2, y: b.y };
  const my = p0.y + (p3.y - p0.y) / 2;
  return { d: `M ${p0.x} ${p0.y} V ${my} H ${p3.x} V ${p3.y}`, mid: { x: p3.x, y: my }, start: p0, end: p3, angle: 90 };
}
