/** Task tracking helpers (no database): the summary cards, the eight filters, the sort order, overdue being calculated, and the assignment form's checks. */
import { localDateKey, type WorkTask } from '../../src/lib/workTasks.js';
import { matchesFilter, sortTasks, trackerStats, initials, ago } from '../../src/components/tasks/taskView.js';
import { assignProblems } from '../../src/components/tasks/TaskAssignPanel.js';

let passed = 0;
function check(ok: unknown, label: string, extra?: unknown) {
  if (!ok) { console.error(`FAILED: ${label}`, extra === undefined ? '' : JSON.stringify(extra)); process.exit(1); }
  passed++; console.log(`ok - ${label}`);
}
const day = (offset: number) => { const d = new Date(); d.setDate(d.getDate() + offset); return localDateKey(d); };
let n = 0;
const task = (o: Partial<WorkTask>): WorkTask => ({
  id: `t${++n}`, departmentId: 'd', teamId: null, parentId: null, customerId: null, title: `Task ${n}`, description: null, priority: 'MEDIUM', dueDate: null, assignedBy: 'boss', assigneeId: 'emp',
  status: 'ASSIGNED', progress: 0, lastUpdateNote: null, lastUpdateAt: null, completedAt: null, createdAt: `2030-01-0${(n % 9) + 1}T00:00:00Z`, assignmentNote: null, division: null, handling: null, ...o
});

const late = task({ title: 'Late', dueDate: day(-3), status: 'IN_PROGRESS', progress: 40 });
const lateDone = task({ title: 'Late but done', dueDate: day(-3), status: 'COMPLETED', progress: 100 });
const blocked = task({ title: 'Blocked', status: 'BLOCKED', priority: 'HIGH', dueDate: day(5), progress: 20 });
const urgent = task({ title: 'Urgent', priority: 'URGENT', dueDate: day(9) });
const soon = task({ title: 'Soon', dueDate: day(1) });
const later = task({ title: 'Later', dueDate: day(20), assigneeId: 'me', assignedBy: 'me' });
const mine = task({ title: 'Mine', assigneeId: 'me' });
const all = [soon, later, lateDone, urgent, blocked, late, mine];
const awaiting = new Set([late.id, lateDone.id, urgent.id]);

const s = trackerStats(all, awaiting);
check(s.total === 7 && s.assigned === 4 && s.inProgress === 1 && s.blocked === 1 && s.completed === 1, 'the summary cards count total, assigned, in progress, blocked and completed', s);
check(s.overdue === 1, 'overdue is calculated from the due date, and a completed task is never overdue', s);
check(s.awaiting === 2, 'awaiting update counts open requests on unfinished tasks only (a completed task does not)', s);

const names = (f: Parameters<typeof matchesFilter>[1]) => all.filter(t => matchesFilter(t, f, 'me', awaiting)).map(t => t.title).sort().join(',');
check(names('ALL').split(',').length === 7, 'All Tasks lists everything');
check(names('MINE') === 'Later,Mine', 'My Tasks are the ones assigned to me');
check(names('BY_ME') === '', 'Assigned by Me excludes a task I gave to myself');
check(all.filter(t => matchesFilter(t, 'BY_ME', 'boss', awaiting)).length === 6, 'Assigned by Me lists what the manager gave out');
check(names('IN_PROGRESS') === 'Late' && names('BLOCKED') === 'Blocked' && names('COMPLETED') === 'Late but done', 'In Progress, Blocked and Completed follow the status');
check(names('OVERDUE') === 'Late', 'Overdue lists open tasks past their due date');
check(names('AWAITING') === 'Late,Urgent', 'Awaiting Update lists unfinished tasks with an open request');

const order = sortTasks(all).map(t => t.title);
check(order[0] === 'Late', 'overdue tasks come first', order);
check(order.indexOf('Urgent') < order.indexOf('Blocked') && order.indexOf('Blocked') < order.indexOf('Soon'), 'then Urgent and High priority ahead of the rest', order);
check(order.indexOf('Soon') < order.indexOf('Later'), 'then the closest due date', order);
check(order[order.length - 1] === 'Late but done', 'finished tasks go last, even when they were late', order);
check(all.length === 7 && sortTasks(all) !== all, 'sorting returns a new list and leaves the original alone');

check(initials('Mia Member') === 'MM' && initials('  priya ') === 'P' && initials('') === '?', 'initials for the avatar');
const now = Date.parse('2030-01-01T12:00:00Z');
check(ago(null, now) === 'No update yet' && ago('2030-01-01T11:30:00Z', now) === '30 min ago' && ago('2030-01-01T09:00:00Z', now) === '3h ago' && ago('2029-12-29T12:00:00Z', now) === '3d ago', 'the latest update time reads as "3h ago"');

const ok = assignProblems({ title: 'Call back customers', dueDate: day(2), assigneeIds: ['a'] });
check(!ok.title && !ok.due && !ok.assignee, 'a complete assignment has no problems');
const bad = assignProblems({ title: ' ', dueDate: day(-1), assigneeIds: [] });
check(bad.title && bad.due && bad.assignee, 'an empty title, a past due date and no assignee are each refused', bad);
check(!assignProblems({ title: 'ok', dueDate: null, assigneeIds: ['a'] }).due, 'the due date is optional');

console.log(`=== ${passed} TASK TRACKER CHECKS PASSED ===`);
