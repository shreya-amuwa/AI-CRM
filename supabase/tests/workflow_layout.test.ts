/**
 * The company workflow diagram (src/components/superadmin/workflowLayout.ts): built only from the rows it is given,
 * every arrow ends on a box that is drawn, collapsed departments stand in for what is inside them, and the filters narrow the picture.
 */
import { buildDiagram, edgePath, fitView, neighboursOf, PROCESS_ORDER, reportPath } from '../../src/components/superadmin/workflowLayout.js';

let passed = 0;
function check(ok: unknown, label: string, extra?: unknown) {
  if (!ok) {
    console.error(`FAILED: ${label}`, extra === undefined ? '' : JSON.stringify(extra));
    process.exit(1);
  }
  passed++;
  console.log(`ok - ${label}`);
}

const dept = (id: string, name: string) => ({ id, slug: id, name, category: null, description: '', accent: '#2563eb', locked: false, generatesRevenue: true, staff: 2, customers: 0 });
const team = (id: string, departmentId: string, name: string, division: 'SALES' | 'SUPPORT' | 'GENERAL', extra: Partial<{ consultantCount: number; memberCount: number }> = {}) =>
  ({ id, departmentId, name, division, leadCount: 1, memberCount: 2, consultantCount: 0, customers: 3, ...extra });
const ep = (kind: 'team' | 'consultants' | 'head' | 'department', id: string) => ({ kind, id });
const hand = (key: string, process: any, from: any, to: any, count = 1) => ({ key, process, from, to, label: key, hint: '', count, countLabel: 'x' });

const data: any = {
  generatedAt: new Date().toISOString(), accountsDepartmentId: 'acc', hrDepartmentId: 'hr',
  departments: [dept('acc', 'Accounts'), dept('hr', 'HR'), dept('w', 'Wabastore'), { ...dept('x', 'Newly created'), staff: 0 }, dept('t', 'Telecom')],
  teams: [team('acc-g', 'acc', 'General', 'GENERAL'), team('hr-g', 'hr', 'General', 'GENERAL'), team('w-s', 'w', 'Sales', 'SALES'), team('w-p', 'w', 'Support', 'SUPPORT', { consultantCount: 2 }),
          team('t-s', 't', 'Sales', 'SALES'), team('t-p', 't', 'Support', 'SUPPORT')],
  heads: [{ id: 'h1', name: 'W Head', departmentId: 'w' }],
  people: [{ id: 'p1', name: 'Lead One', role: 'TEAM_HEAD', title: null, teamId: 'w-s', departmentId: 'w', consultant: false }],
  handoffs: [
    hand('to-acc:w-s', 'payment', ep('team', 'w-s'), ep('department', 'acc'), 5),
    hand('to-acc:t-s', 'payment', ep('team', 't-s'), ep('department', 'acc'), 0),
    hand('back:w-s', 'payment', ep('department', 'acc'), ep('team', 'w-s'), 4),
    hand('cons:w-s', 'onboarding', ep('team', 'w-s'), ep('consultants', 'w-p'), 2),
    hand('head:w', 'onboarding', ep('consultants', 'w-p'), ep('head', 'w'), 1),
    hand('esc:w-p', 'tickets', ep('team', 'w-p'), ep('head', 'w'), 0),
    hand('leave:w', 'leave', ep('head', 'w'), ep('department', 'hr'), 3)
  ]
};
const all = new Set(PROCESS_ORDER);
const opt = { expanded: new Set<string>(), departmentId: 'ALL' as const, teamId: 'ALL' as const, processes: all };

// the default view: every department, collapsed
let d = buildDiagram(data, opt);
const ids = d.nodes.map(n => n.id);
check(ids.length === new Set(ids).size, 'no box is drawn twice');
check(d.nodes.filter(n => n.kind === 'department').length === data.departments.length, 'every department is a box, including the new empty one');
check(d.nodes.some(n => n.id === 'dept:x' && n.empty), 'a department with no teams or staff is drawn as empty, with nothing invented inside it');
check(!d.nodes.some(n => n.kind === 'team' || n.kind === 'head'), 'collapsed departments show no inner boxes');
const byId = new Map(d.nodes.map(n => [n.id, n]));
check(d.edges.every(e => byId.has(e.from) && byId.has(e.to)), 'every arrow starts and ends on a drawn box');
check(d.edges.filter(e => e.type === 'report').length === data.departments.length, 'every department reports to the Super Admin');
const proc = d.edges.filter(e => e.type === 'process');
check(!proc.some(e => e.from === e.to), 'no arrow loops on one box');
const toAcc = proc.find(e => e.from === 'dept:w' && e.to === 'dept:acc');
check(toAcc && toAcc.count === 5, 'collapsed: the Send to Accounts arrow carries the real count');
check(proc.find(e => e.from === 'dept:t' && e.to === 'dept:acc')?.count === 0, 'a hand-off with no records is kept (and can be hidden), not dropped');
const wToAccBoth = proc.filter(e => e.from === 'dept:w' && e.to === 'dept:acc').length;
check(wToAccBoth === 1, 'two hand-offs between the same boxes are one arrow');

// several kinds between the same pair merge into one neutral arrow with the total
const merged = buildDiagram({ ...data, handoffs: [hand('a', 'payment', ep('team', 'w-s'), ep('department', 'acc'), 2), hand('b', 'addon', ep('consultants', 'w-p'), ep('department', 'acc'), 3)] }, opt);
const m = merged.edges.find(e => e.type === 'process')!;
check(m.count === 5 && m.merged === 2 && m.process === null && m.keys.length === 2, 'different kinds between two collapsed departments become one arrow with the total', m);

// process filter
d = buildDiagram(data, { ...opt, processes: new Set(['leave']) });
check(d.edges.filter(e => e.type === 'process').length === 1, 'turning off kinds of hand-off removes their arrows');

// expanded
d = buildDiagram(data, { ...opt, expanded: new Set(['w']) });
check(['head:w', 'team:w-s', 'team:w-p', 'consultants:w-p'].every(i => d.nodes.some(n => n.id === i)), 'an expanded department shows its head, teams and consultants');
check(d.nodes.find(n => n.id === 'head:w')!.sub === 'W Head', 'the Department Head is read from the rows');
check(d.nodes.find(n => n.id === 'team:w-s')!.sub === 'Lead: Lead One', 'a team shows its Team Lead');
check(d.nodes.find(n => n.id === 'team:w-p')!.sub === 'No Team Lead assigned yet', 'a team with no lead says so');
const eb = new Map(d.nodes.map(n => [n.id, n]));
check(d.edges.every(e => eb.has(e.from) && eb.has(e.to)), 'expanded: every arrow still ends on a drawn box');
check(d.edges.some(e => e.type === 'process' && e.from === 'team:w-s' && e.to === 'consultants:w-p'), 'expanded: the hand-off to the consultants is drawn between the real boxes');
check(d.nodes.find(n => n.id === 'dept:w')!.h > 100, 'an expanded department grows to hold what is in it');
const inner = d.nodes.filter(n => n.departmentId === 'w' && n.kind !== 'department');
const box = d.nodes.find(n => n.id === 'dept:w')!;
check(inner.every(n => n.x >= box.x && n.x + n.w <= box.x + box.w && n.y >= box.y && n.y + n.h <= box.y + box.h), 'inner boxes sit inside their department box');

// department filter: the department plus the ones it is connected to
check(JSON.stringify([...neighboursOf(data, 'w')].sort()) === JSON.stringify(['acc', 'hr']), 'neighbours are the departments a department exchanges work with');
d = buildDiagram(data, { ...opt, departmentId: 'w' });
check(d.nodes.filter(n => n.kind === 'department').map(n => n.departmentId).sort().join() === 'acc,hr,w', 'filtering to a department keeps it and its connected departments');
check(d.nodes.find(n => n.id === 'dept:w')!.expanded && !d.nodes.find(n => n.id === 'dept:acc')!.expanded, 'the filtered department is expanded, its neighbours are not');
check(d.nodes.filter(n => n.kind === 'department')[0].departmentId === 'w', 'the filtered department comes first');

// team filter
d = buildDiagram(data, { ...opt, departmentId: 'w', teamId: 'w-p' });
check(d.nodes.some(n => n.id === 'team:w-p') && !d.nodes.some(n => n.id === 'team:w-s'), 'filtering to a team shows only that team');
check(d.edges.filter(e => e.type === 'process').every(e => [e.from, e.to].some(i => i.includes('w-p') || i === 'head:w')), 'and only the hand-offs that touch it or its head');
// an unknown department or team falls back to the whole company
d = buildDiagram(data, { ...opt, departmentId: 'gone', teamId: 'gone' });
check(d.nodes.filter(n => n.kind === 'department').length === data.departments.length, 'a department that no longer exists falls back to the whole company');

// a company with nothing in it
d = buildDiagram({ ...data, departments: [], teams: [], heads: [], people: [], handoffs: [] }, opt);
check(d.nodes.length === 1 && d.edges.length === 0 && d.width > 0, 'with no departments only the Super Admin is drawn, and nothing is invented');

// a hand-off pointing at something that was deleted is not drawn
d = buildDiagram({ ...data, handoffs: [hand('stale', 'payment', ep('team', 'missing'), ep('department', 'acc'))] }, opt);
check(d.edges.filter(e => e.type === 'process').length === 0, 'a hand-off from a removed team is not drawn');

// geometry
const a = d.nodes.find(n => n.id === 'dept:acc')!;
const p = edgePath(a, a, 0);
check(p.d.startsWith('M '), 'an arrow has a path');
const rp = reportPath(d.nodes.find(n => n.id === 'root')!, a);
check(rp.d.includes('C'), 'a reporting line has a path');
const f = fitView({ width: 2000, height: 1000 }, { w: 1000, h: 500 });
check(f.scale > 0.15 && f.scale <= 0.5 && f.x >= 0, 'fit to screen scales the whole picture into the box');
const fw = fitView({ width: 1000, height: 4000 }, { w: 400, h: 500 }, 28, true);
check(fw.scale > 0.3, 'on a phone the picture fills the width instead of shrinking to fit the height');

console.log(`=== ${passed} checks passed`);
