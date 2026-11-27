/**
 * The Sales Department Head's / Sales Operations Head's side menu (src/components/sales-head/salesHeadNav.ts): it reads in sections like the other
 * dashboards, no entry of the old flat menu is lost or doubled, the Operations Head differs where it always did, Crocodial shows only when there
 * is something to show, and every entry opens a page that exists.
 */
import { salesHeadNavGroups, type SalesHeadNavOptions } from '../../src/components/sales-head/salesHeadNav.js';
import { PATHS } from '../../src/components/sales-head/salesHeadPaths.js';

let passed = 0;
function check(ok: unknown, label: string, extra?: unknown) {
  if (!ok) {
    console.error(`FAILED: ${label}`, extra === undefined ? '' : JSON.stringify(extra));
    process.exit(1);
  }
  passed++;
  console.log(`ok - ${label}`);
}

const icon = (() => null) as never;
const base: SalesHeadNavOptions = {
  operationsHead: false, crocodialSelf: false, crocodialTeam: false, pendingUpdates: 0,
  reportsNav: { id: 'work-reports', label: 'Reports', icon }, issuesNav: { id: 'raise-issue', label: 'Raise an Issue', icon }, chatNav: { id: 'chat', label: 'Chat', icon }
};
const ids = (o: Partial<SalesHeadNavOptions>) => {
  const groups = salesHeadNavGroups({ ...base, ...o });
  return { groups, labels: groups.map(g => g.label), top: groups.flatMap(g => g.items.map(i => i.id)), all: groups.flatMap(g => g.items.flatMap(i => [i.id, ...(i.children ?? []).map(c => c.id)])) };
};

// the entries of the old flat menu (before the sections)
const OLD_TOP = ['overview', 'leads', 'sheet-upload', 'my-leads-group', 'field-visits-group', 'assign-task', 'tasks', 'work-updates', 'performance', 'telecaller-group', 'business-associate-group', 'top-performers',
  'income', 'my-income', 'incentive-setup', 'reports', 'work-reports', 'telecaller-sheets', 'service-prices', 'lead-whatsapp', 'notices', 'team', 'raise-issue', 'chat', 'notifications'];
const sorted = (a: string[]) => [...a].sort();

let m = ids({});
check(JSON.stringify(m.labels) === JSON.stringify([undefined, 'Leads', 'My Sales', 'Work', 'Income & Reports', 'Customers', 'Team', 'Communication']), 'the Department Head\'s menu reads in sections: Overview on top, then Leads, My Sales, Work, Income & Reports, Customers, Team, Communication', m.labels);
check(JSON.stringify(sorted(m.top)) === JSON.stringify(sorted(OLD_TOP)), 'no entry of the old flat menu is lost, and the only one added is Assign Task', m.top);
check(new Set(m.all).size === m.all.length, 'no entry is listed twice (parents and their pages)');
check(m.groups.every(g => g.items.length > 0), 'no section is empty');
check(m.groups[0].items.map(i => i.id).join() === 'overview', 'Overview is alone on top (the shell adds Attendance and Meetings above it)');
const section = (label: string) => m.groups.find(g => g.label === label)!.items.map(i => i.id);
check(section('Leads').join() === 'leads,sheet-upload,telecaller-sheets,field-visits-group,lead-whatsapp', 'Leads holds the lead flow: Lead list / assign, Sheet Upload, Telecaller Sheets, Field Visits, Lead Welcome WhatsApp', section('Leads'));
check(section('My Sales').join() === 'my-leads-group,my-income', 'My Sales holds the head\'s own leads and income');
check(section('Team').join() === 'team,telecaller-group,business-associate-group', 'Team holds Team Members & Access and the role lists');
check(section('Communication').join() === 'raise-issue,chat,notifications', 'Communication holds Raise an Issue, Chat and the Notification Center');

// every entry opens a page that exists (a parent only opens its list)
const PARENTS = new Set(['leads', 'my-leads-group', 'field-visits-group', 'telecaller-group', 'business-associate-group']);
const pages = Object.keys(PATHS);
check(m.all.filter(id => !PARENTS.has(id)).every(id => pages.includes(id)), 'every entry is a page of the dashboard', m.all.filter(id => !PARENTS.has(id) && !pages.includes(id)));

// the Operations Head: its own dashboard first; no assignment queue of field visits, no Lead Welcome WhatsApp
m = ids({ operationsHead: true });
check(m.top[0] === 'operations' && m.groups[0].items.map(i => i.id).join() === 'operations,overview', 'the Operations Head sees the Operations Dashboard first');
check(!m.all.includes('lead-whatsapp') && !m.all.includes('field-visit-leads') && m.all.includes('field-tracking'), 'and has no Lead Welcome WhatsApp or field-visit assignment queue, but sees active field visits');
check(m.all.filter(id => !PARENTS.has(id)).every(id => pages.includes(id)), 'all of its entries are pages too');

// Crocodial: nothing unless the person is connected or oversees connected people
check(!ids({}).labels.includes('Crocodial'), 'no Crocodial section when there is nothing to show');
m = ids({ crocodialSelf: true });
check(m.labels.indexOf('Crocodial') === m.labels.indexOf('Customers') - 1 && m.all.includes('crocodial-me') && m.all.includes('crocodial-leads') && !m.all.includes('crocodial'), 'a connected head sees My Crocodial Activity and My Crocodial Leads, before Customers');
m = ids({ crocodialTeam: true });
check(m.all.includes('crocodial') && !m.all.includes('crocodial-me'), 'a head who only oversees connected people sees Team Crocodial Activity');
{
  // (20270303000100) the CEO's entry is the Crocodial Overview of all their Sales departments; a Department Head's is their department's
  const label = (o: Partial<SalesHeadNavOptions>) => salesHeadNavGroups({ ...base, ...o }).flatMap(g => g.items).find(i => i.id === 'crocodial')?.label;
  check(label({ crocodialTeam: true, operationsHead: true }) === 'Crocodial Overview' && label({ crocodialTeam: true }) === 'Department Crocodial Activity', 'the CEO sees Crocodial Overview, a Department Head Department Crocodial Activity');
}
m = ids({ crocodialSelf: true, crocodialTeam: true });
check(['crocodial-me', 'crocodial-leads', 'crocodial'].every(id => m.all.includes(id)) && m.all.filter(id => !PARENTS.has(id)).every(id => pages.includes(id)), 'both: all three, and each is a real page');

// badges
m = ids({ pendingUpdates: 3, reportsBadge: 2, chatUnread: 5 });
const item = (id: string) => m.groups.flatMap(g => g.items).find(i => i.id === id)!;
check(item('work-updates').badge === 3 && item('work-reports').badge === 2 && item('chat').badge === 5, 'the badges (work updates, reports, chat) are still shown');

console.log(`=== ${passed} SALES HEAD MENU CHECKS PASSED ===`);
