import type {
  BaHome, CallStatus, CrocodialMyStatus, CrocodialRefreshCapabilities, DivisionLeadsOverview, LeadTemperature, PipelineCounts, SalesLeadAssignee, SalesLeadList, SalesLeadRow,
  SalesOverview, SalesTaskAssignee, SalesTaskList, SalesTaskRow
} from '../../../shared/contracts';
import { DemoError, demoId, simulated, type DemoContext, type FixtureModule } from '../runtime/demoStore';
import { DEMO_ME_ID } from '../runtime/previewIdentity';
import { dateOnly, daysFromNow, pick, type DemoPerson } from './org';

/**
 * Sales demonstration data: leads with temperatures and call outcomes, follow-ups, tasks, conversions and team activity, consistent with the
 * people of the previewed department. Companies are invented and marked "(Demo)"; amounts are demonstration figures, never Amuwa's results.
 * Simulated: assigning a lead, creating a task, recording a call outcome. Scenarios: empty, high-volume, target-achieved, overdue.
 */
const COMPANIES = ['Sunrise Traders', 'Lotus Retail', 'Blue Harbour Foods', 'Greenleaf Pharma', 'Metro Electronics', 'Silverline Tours', 'Orchid Textiles', 'Zenith Motors',
  'Coastal Spices', 'Nova Interiors', 'Peak Fitness', 'Urban Bakes', 'Crescent Clinics', 'Harbor Logistics', 'Maple Schools', 'Vista Realty'];
const SOURCES = ['Meta ads', 'WhatsApp', 'Website', 'Referral', 'Telecaller sheet', 'Exhibition'];
const TEMPS: (LeadTemperature | null)[] = ['HOT', 'WARM', 'COLD', 'WARM', 'HOT', null, 'COLD', 'WARM'];
const CALLS: (CallStatus | null)[] = ['INTERESTED', 'FOLLOW_UP_REQUIRED', 'CONTACTED', 'PENDING', 'NOT_INTERESTED', 'COMPLETED', null];

interface SalesBag { leads: SalesLeadRow[]; tasks: SalesTaskRow[] }
const bag = (ctx: DemoContext) => ctx.state.bag.sales as SalesBag;
const salesPeople = (ctx: DemoContext) => (ctx.state.bag.people as DemoPerson[]).filter(p => p.division === 'SALES' || (p.division === 'GENERAL' && ctx.identity.department.unified));
const leadsOfTeam = (ctx: DemoContext) => salesPeople(ctx).filter(p => p.role !== 'DEPARTMENT_HEAD');

function buildLeads(ctx: DemoContext): SalesLeadRow[] {
  if (ctx.scenario === 'empty' || ctx.scenario === 'new-account') return [];
  const count = ctx.scenario === 'high-volume' ? 64 : 22;
  const owners = leadsOfTeam(ctx);
  return Array.from({ length: count }, (_, i): SalesLeadRow => {
    const owner = i % 5 === 4 ? null : pick(owners, i);
    const isConverted = ctx.scenario === 'target-achieved' ? i % 3 === 0 : i % 9 === 0;
    return {
      id: `d8000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, leadCode: `LD-${String(4100 + i)}`, kind: i % 6 === 5 ? 'INBOUND' : 'CUSTOMER',
      name: `Contact ${i + 1} (Demo)`, company: `${pick(COMPANIES, i)}${i >= COMPANIES.length ? ` ${Math.floor(i / COMPANIES.length) + 1}` : ''} (Demo)`,
      phone: `+91 98000 ${String(20000 + i * 37).slice(-5)}`, email: `contact${i + 1}@example.invalid`, source: pick(SOURCES, i),
      temperature: pick(TEMPS, i), callStatus: owner ? pick(CALLS, i) : null, assigneeId: owner?.id ?? null, assignee: owner?.fullName ?? null,
      team: owner ? `${ctx.identity.department.name} Sales Team` : null, assignedAt: owner ? daysFromNow(-(i % 9) - 1) : null,
      lastContacted: owner ? daysFromNow(-(i % 6)) : null,
      followUp: i % 3 === 0 ? daysFromNow(ctx.scenario === 'overdue' ? -2 : (i % 4) - 1, 11) : null,
      converted: isConverted, stage: isConverted ? 'CUSTOMER' : pick(['NEW', 'CONTACTED', 'INTERESTED', 'READY_TO_BUY'], i), sheet: i % 4 === 0 ? 'expo-leads-demo.xlsx' : null
    };
  });
}

function buildTasks(ctx: DemoContext): SalesTaskRow[] {
  if (ctx.scenario === 'empty' || ctx.scenario === 'new-account') return [];
  const owners = salesPeople(ctx).filter(p => p.role === 'TEAM_HEAD' || p.role === 'TEAM_MEMBER');
  const head = (ctx.state.bag.people as DemoPerson[]).find(p => p.role === 'DEPARTMENT_HEAD')!;
  const titles = ['Call back the warm leads from the expo', 'Send revised quotation to Zenith Motors (Demo)', 'Prepare the weekly pipeline review', 'Follow up on pending demos',
    'Update call outcomes in the sheet', 'Schedule a product demo for Lotus Retail (Demo)', 'Collect feedback after the demo', 'Share the new price list with the team'];
  return titles.map((title, i): SalesTaskRow => {
    const owner = pick(owners, i + 1);
    const overdue = ctx.scenario === 'overdue' ? i % 2 === 0 : i === 3;
    const status: SalesTaskRow['status'] = i % 4 === 2 ? 'COMPLETED' : i % 4 === 1 ? 'IN_PROGRESS' : 'ASSIGNED';
    return {
      id: `d8100000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, title, description: 'Demonstration task.', priority: pick(['HIGH', 'MEDIUM', 'LOW'] as const, i),
      startDate: dateOnly(-i - 1), dueDate: dateOnly(overdue ? -2 : i - 2), status, progress: status === 'COMPLETED' ? 100 : (i * 15) % 90, remarks: null,
      lastUpdateAt: i % 2 ? daysFromNow(-1) : null, assigneeId: owner.id, assignee: owner.fullName, assignedById: head.id, assignedBy: head.fullName,
      team: `${ctx.identity.department.name} Sales Team`, overdue, dueSoon: !overdue && i % 3 === 0, level: owner.role === 'TEAM_HEAD' ? 'LEAD' : 'MEMBER', subtasks: i % 3
    };
  });
}

const followUp = (l: SalesLeadRow) => l.followUp;
const converted = (l: SalesLeadRow) => l.converted;

function overview(ctx: DemoContext): SalesOverview {
  const { leads, tasks } = bag(ctx);
  const t = (x: LeadTemperature | null) => leads.filter(l => l.temperature === x).length;
  const people = leadsOfTeam(ctx);
  const due = leads.filter(l => followUp(l) && followUp(l)! <= daysFromNow(0, 23));
  const callStatus: Record<string, number> = {};
  for (const l of leads) if (l.callStatus) callStatus[l.callStatus] = (callStatus[l.callStatus] ?? 0) + 1;
  return {
    today: dateOnly(0),
    cards: {
      totalLeads: leads.length, hot: t('HOT'), warm: t('WARM'), cold: t('COLD'), assigned: leads.filter(l => l.assigneeId).length, pendingAssignment: leads.filter(l => !l.assigneeId).length,
      teamMembers: people.length, tasksPending: tasks.filter(x => x.status !== 'COMPLETED').length,
      tasksCompleted: tasks.filter(x => x.status === 'COMPLETED').length, followUpsDue: due.length, converted: leads.filter(converted).length,
      income: leads.length ? (ctx.scenario === 'target-achieved' ? 1_250_000 : 486_500) : 0
    },
    statusDistribution: { temperature: { HOT: t('HOT'), WARM: t('WARM'), COLD: t('COLD'), NONE: t(null) }, callStatus },
    recentActivities: leads.slice(0, 6).map((l, i) => ({ at: daysFromNow(-i * 0.3, 15), type: pick(['CALL', 'NOTE', 'STAGE', 'DEMO'], i), note: pick(['Interested in the annual plan.', 'Asked for a callback next week.', 'Demo booked.', 'Quotation shared.'], i), customer: l.company ?? l.name, customerId: l.id, by: l.assignee })),
    teamActivity: people.map((p, i) => ({ id: p.id, name: p.fullName, role: p.role === 'TEAM_HEAD' ? 'Team Lead' : 'Team Member', team: `${ctx.identity.department.name} Sales Team`,
      leads: leads.filter(l => l.assigneeId === p.id).length, contacted7d: 3 + (i * 4) % 11, tasksOpen: tasks.filter(x => x.assigneeId === p.id && x.status !== 'COMPLETED').length, tasksDone: (i * 3) % 7 })),
    upcomingFollowUps: due.slice(0, 6).map(l => ({ id: l.id, name: l.name, company: l.company, followUp: followUp(l)!, assignee: l.assignee, temperature: l.temperature })),
    pendingTasks: tasks.filter(x => x.status !== 'COMPLETED').map(x => ({ id: x.id, title: x.title, dueDate: x.dueDate, priority: x.priority, status: x.status, assignee: x.assignee, overdue: x.overdue })),
    recentSheets: leads.length ? [{ id: 'd8200000-0000-4000-8000-000000000001', fileName: 'expo-leads-demo.xlsx', mode: 'LEADS', valid: 48, assignedAt: daysFromNow(-3), assignedTo: people[0]?.fullName ?? 'Team Lead' }] : [],
    recentConversions: leads.filter(converted).slice(0, 4).map((l, i) => ({ id: l.id, name: l.name, company: l.company, stage: 'CUSTOMER', at: daysFromNow(-i - 1), owner: l.assignee })),
    highlights: people.slice(0, 3).map((p, i) => ({ id: p.id, name: p.fullName, tasksDone: 9 - i * 2, converted: 4 - i }))
  };
}

function leadList(ctx: DemoContext, q: Record<string, string>): SalesLeadList {
  const all = bag(ctx).leads;
  const f = q.filter ?? 'all';
  const search = (q.search ?? '').toLowerCase();
  let items = all.filter(l => (f === 'all' ? true : f === 'hot' ? l.temperature === 'HOT' : f === 'warm' ? l.temperature === 'WARM' : f === 'cold' ? l.temperature === 'COLD'
    : f === 'unassigned' ? !l.assigneeId : f === 'assigned' ? !!l.assigneeId : f === 'followUp' ? !!followUp(l) : f === 'converted' ? converted(l) : true))
    .filter(l => !search || `${l.name} ${l.company} ${l.phone}`.toLowerCase().includes(search))
    .filter(l => !q.assigneeId || l.assigneeId === q.assigneeId);
  const page = Number(q.page) || 1;
  const pageSize = Number(q.pageSize) || 20;
  const total = items.length;
  items = items.slice((page - 1) * pageSize, page * pageSize);
  return { total, page, pageSize, items,
    counts: { all: all.length, hot: all.filter(l => l.temperature === 'HOT').length, warm: all.filter(l => l.temperature === 'WARM').length, cold: all.filter(l => l.temperature === 'COLD').length,
              unassigned: all.filter(l => !l.assigneeId).length, assigned: all.filter(l => l.assigneeId).length, followUp: all.filter(l => followUp(l)).length, converted: all.filter(converted).length } };
}

function counts(ctx: DemoContext): PipelineCounts {
  const n = bag(ctx).leads.length;
  const k = (x: number) => (n ? x : 0);
  return {
    leads: { all: k(n), NEW: k(6), CONTACTED: k(7), INTERESTED: k(5), READY_TO_BUY: k(4), WITH_ACCOUNTS: k(2), RETURNED: k(1) },
    potential: { all: k(9), AWAITING: k(4), PART_PAID: k(3), OVERDUE: k(ctx.scenario === 'overdue' ? 4 : 1), PAID: k(1) },
    onboarding: { all: k(6), RETURNED: k(1), COLLECTING: k(2), WAITING_ON_CLIENT: k(1), READY_FOR_HANDOVER: k(1), GET_STARTED: k(1) },
    partPayments: k(3), mandatoryDocuments: k(2)
  };
}

export const sales: FixtureModule = {
  build: ctx => {
    ctx.state.bag.sales = { leads: buildLeads(ctx), tasks: buildTasks(ctx) } satisfies SalesBag;
    // the Team Member workspace tables (follow-ups, activities, deals, calendar, end-of-day reports): empty in this first demonstration set
    for (const t of ['member_follow_ups', 'member_activities', 'member_deals', 'member_calendar_events', 'member_eod_reports']) ctx.state.tables[t] ??= [];
  },
  routes: [
    { method: 'GET', path: '/sales-head/overview', handle: ctx => overview(ctx) },
    { method: 'GET', path: '/sales-head/leads', handle: ctx => leadList(ctx, ctx.query) },
    { method: 'GET', path: '/sales-head/lead-assignees', handle: (ctx): SalesLeadAssignee[] => leadsOfTeam(ctx).map(p => ({
      id: p.id, name: p.fullName, team: `${ctx.identity.department.name} Sales Team`, teamId: p.teamId ?? '', role: p.role === 'TEAM_HEAD' ? 'Team Lead' : 'Team Member', subRole: null,
      mode: 'LEADS', openContacts: 0, openLeads: bag(ctx).leads.filter(l => l.assigneeId === p.id).length })) },
    // Assign Lead: the demonstration lead moves to the chosen person; no live lead is touched
    { method: 'POST', path: '/sales-head/leads/:id/assign', handle: ({ params, body, ...ctx }) => {
      const lead = bag(ctx as DemoContext).leads.find(l => l.id === params.id);
      const person = leadsOfTeam(ctx as DemoContext).find(p => p.id === (body as { assigneeId?: string })?.assigneeId);
      if (!lead || !person) throw new DemoError('VALIDATION_ERROR', 'Choose a demonstration lead and a person from the list.', 422);
      Object.assign(lead, { assigneeId: person.id, assignee: person.fullName, assignedAt: new Date().toISOString(), team: `${(ctx as DemoContext).identity.department.name} Sales Team` });
      simulated();
      return { customerId: lead.id, assignee: person.fullName };
    } },
    { method: 'GET', path: '/sales-head/tasks', handle: (ctx): SalesTaskList => {
      const items = bag(ctx).tasks;
      return { total: items.length, page: 1, pageSize: 50, today: dateOnly(0), items,
        counts: { all: items.length, pending: items.filter(x => x.status === 'ASSIGNED').length, inProgress: items.filter(x => x.status === 'IN_PROGRESS').length,
                  completed: items.filter(x => x.status === 'COMPLETED').length, overdue: items.filter(x => x.overdue).length } };
    } },
    { method: 'GET', path: '/sales-head/task-assignees', handle: (ctx): SalesTaskAssignee[] => salesPeople(ctx).filter(p => p.role === 'TEAM_HEAD').map(p => ({ id: p.id, name: p.fullName, team: `${ctx.identity.department.name} Sales Team`, teamId: p.teamId ?? '', role: 'Team Lead' })) },
    // Assign Task: appears in the demonstration list (and the Team Lead's), nobody receives a real task
    { method: 'POST', path: '/sales-head/tasks', handle: ({ body, ...ctx }) => {
      const b = (body ?? {}) as { assigneeId?: string; title?: string; description?: string | null; priority?: string; dueDate?: string | null };
      const person = salesPeople(ctx as DemoContext).find(p => p.id === b.assigneeId);
      if (!person || !b.title || b.title.trim().length < 3) throw new DemoError('VALIDATION_ERROR', 'Choose a Team Lead and give the task a title (at least 3 characters).', 422);
      const id = demoId();
      const head = ((ctx as DemoContext).state.bag.people as DemoPerson[]).find(p => p.id === DEMO_ME_ID) ?? person;
      bag(ctx as DemoContext).tasks.unshift({ id, title: b.title.trim(), description: b.description ?? null, priority: (['LOW', 'MEDIUM', 'HIGH'] as const).find(x => x === b.priority) ?? 'MEDIUM',
        startDate: dateOnly(0), dueDate: b.dueDate ?? null, status: 'ASSIGNED', progress: 0, remarks: null, lastUpdateAt: null, assigneeId: person.id, assignee: person.fullName,
        assignedById: head.id, assignedBy: head.fullName, team: `${(ctx as DemoContext).identity.department.name} Sales Team`, overdue: false, dueSoon: false, level: 'LEAD', subtasks: 0 });
      simulated();
      return { id };
    } },
    { method: 'GET', path: '/pipeline/counts', handle: ctx => counts(ctx) },
    // the pipeline lists are not in this first demonstration set: they show their real empty state
    { method: 'GET', path: '/pipeline/customers', handle: ({ query }) => ({ items: [], page: Number(query.page) || 1, pageSize: Number(query.pageSize) || 20, total: 0 }) },
    { method: 'GET', path: '/pipeline/services', handle: () => [] },
    { method: 'GET', path: '/pipeline/division-overview', handle: (ctx): DivisionLeadsOverview => {
      const people = leadsOfTeam(ctx);
      const leads = bag(ctx).leads;
      const c = counts(ctx);
      return {
        teamIds: [...new Set(people.map(p => p.teamId!).filter(Boolean))],
        members: people.map((p, i) => {
          const mine = leads.filter(l => l.assigneeId === p.id);
          return { id: p.id, fullName: p.fullName, email: p.email, role: p.role, status: 'ACTIVE', teamId: p.teamId ?? '', teamName: `${ctx.identity.department.name} Sales Team`,
            leadsAdded: mine.length + i, owned: mine.length, leads: mine.length, new: Math.ceil(mine.length / 3), contacted: Math.floor(mine.length / 3), interested: i % 3, readyToBuy: i % 2,
            potential: i % 3, onboarding: i % 2, customers: (i * 2) % 5, followUpsOverdue: ctx.scenario === 'overdue' ? 2 + (i % 3) : i % 2, followUpsToday: (i + 1) % 3, noFollowUp: i % 2, lastLeadAt: mine[0]?.assignedAt ?? null };
        }),
        totals: { members: people.length, leadsAdded: leads.length, leads: leads.length, potential: c.potential.all, onboarding: c.onboarding.all, customers: 14,
                  followUpsOverdue: ctx.scenario === 'overdue' ? 9 : 2, followUpsToday: 4, noFollowUp: 3 },
        leads: c.leads, potential: c.potential, onboarding: c.onboarding, partPayments: c.partPayments
      };
    } },
    { method: 'GET', path: '/ba/home', handle: (ctx): BaHome => {
      const mine = bag(ctx).leads.filter(l => l.assigneeId === DEMO_ME_ID);
      const none = !bag(ctx).leads.length;
      return { today: dateOnly(0), assignedContacts: none ? 0 : mine.length + 12, newContacts: none ? 0 : 4, leadsInProgress: none ? 0 : 7, quotationsDrafted: none ? 0 : 3, quotationsAwaitingReview: none ? 0 : 1,
        upcomingDemos: none ? 0 : 2, scopeDocumentsGenerated: none ? 0 : 1, followUpsDue: none ? 0 : 5,
        stageCounts: none ? {} : { NEW: 4, IN_PROGRESS: 7, QUOTATION_PENDING: 3, DEMO_SCHEDULED: 2, SCOPE_PENDING: 1, COMPLETED: 5 }, upcoming: [], recent: [] };
    } },
    // Crocodial (the dialler integration) is not connected in the demonstration: the pages show their "not enabled" state
    { method: 'GET', path: '/crocodial/me', handle: (): CrocodialMyStatus => ({ enabled: false }) },
    { method: 'GET', path: '/crocodial/refresh-capabilities', handle: (): CrocodialRefreshCapabilities => ({ kind: 'EMPLOYEE', active: false, rollout: false, self: { state: 'NOT_ENABLED' }, team: null, departments: [], all: null, recent: null }) }
  ],
  rpcs: {}
};
