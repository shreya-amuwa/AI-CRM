import type { DivisionSupportOverview, OperationsDashboard, ScopeOverview } from '../../../shared/contracts';
import type { HeadOverviewData } from '../../lib/headDashboard';
import type { TlDashboard } from '../../lib/teamLead';
import type { WorkUpdateList } from '../../lib/workUpdates';
import type { TeamAttendance, TeamAttendanceRow } from '../../lib/attendance';
import { DemoError, demoId, simulated, type DemoContext, type FixtureModule, type Row } from '../runtime/demoStore';
import { DEMO_ME_ID, demoDepartmentId } from '../runtime/previewIdentity';
import { dateOnly, daysFromNow, pick, type DemoPerson } from './org';

/**
 * Support demonstration data: customers with their services, tickets (open, waiting, escalated, resolved), renewals, invoices and the team's
 * tasks, for the people of the previewed department. Rows use the column names of the tables the Support pages read directly.
 * Simulated: adding a customer, assigning a task, a ticket update. Scenarios: empty, escalations, overdue, pending-approvals.
 */
const COMPANIES = ['Aster Dental (Demo)', 'Kiran Jewellers (Demo)', 'Bright Minds Academy (Demo)', 'Riverfront Cafe (Demo)', 'Pulse Diagnostics (Demo)', 'Trident Hardware (Demo)',
  'Saffron Kitchens (Demo)', 'Nimbus Travels (Demo)', 'Evergreen Nursery (Demo)', 'Royal Optics (Demo)', 'Swift Couriers (Demo)', 'Golden Gym (Demo)', 'Pearl Salon (Demo)', 'Delta Motors (Demo)'];
const SERVICES = ['WHATSAPP_API_BLUE_TICK', 'AI_CRM', 'AI_QR', 'WHATSAPP_API', 'SOCIAL_MEDIA'];
const SUBJECTS = ['WhatsApp template rejected', 'Cannot log in to the CRM', 'Invoice copy needed', 'Campaign scheduled at the wrong time', 'Add a new user to the account',
  'Blue tick verification status', 'QR code not opening', 'Renewal quotation requested'];

const people = (ctx: DemoContext) => ctx.state.bag.people as DemoPerson[];
const supportStaff = (ctx: DemoContext) => people(ctx).filter(p => (p.division === 'SUPPORT' || (p.division === 'GENERAL' && ctx.identity.department.unified)) && p.role !== 'DEPARTMENT_HEAD');
const none = (ctx: DemoContext) => ctx.scenario === 'empty' || ctx.scenario === 'new-account';
const tables = (ctx: DemoContext) => ctx.state.tables;

function build(ctx: DemoContext): void {
  const deptId = demoDepartmentId(ctx.identity.department.slug);
  const staff = supportStaff(ctx);
  const members = staff.filter(p => p.role === 'TEAM_MEMBER');
  const owners = members.length ? members : staff;
  const customers: Row[] = none(ctx) ? [] : COMPANIES.map((company, i) => {
    const owner = pick(owners, i);
    return {
      id: `da000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, customer_code: `CUS-${String(2201 + i)}`, name: `Owner ${i + 1} (Demo)`, company,
      email: `customer${i + 1}@example.invalid`, phone: `+91 97000 ${String(30000 + i * 41).slice(-5)}`, segment: pick(['RETAIL', 'WHOLESALE', 'CORPORATE'], i),
      status: i % 7 === 6 ? 'INACTIVE' : 'ACTIVE', lifecycle_stage: 'CUSTOMER', owner_id: owner?.id ?? null, team_id: owner?.teamId ?? null, department_id: deptId,
      channel: pick(['Phone', 'WhatsApp', 'E-mail'], i), service_code: pick(SERVICES, i), service_interest: null, service_details: {}, requirement: 'Demonstration requirement.',
      notes: null, search_text: `${company} owner ${i + 1}`.toLowerCase(), created_at: daysFromNow(-30 - i * 3), updated_at: daysFromNow(-(i % 5))
    };
  });
  const escal = ctx.scenario === 'escalations';
  const tickets: Row[] = none(ctx) ? [] : SUBJECTS.concat(escal ? SUBJECTS.slice(0, 4) : []).map((subject, i) => {
    const status = escal && i % 2 === 0 ? 'ESCALATED' : pick(['OPEN', 'IN_PROGRESS', 'WAITING_CUSTOMER', 'RESOLVED', 'OPEN', 'ESCALATED', 'IN_PROGRESS', 'CLOSED'], i);
    const c = customers[i % customers.length];
    return {
      id: `db000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, ticket_no: `TKT-${1040 + i}`, subject, description: 'Demonstration ticket raised by the customer.',
      category: pick(['TECHNICAL', 'BILLING', 'ONBOARDING', 'SERVICE_REQUEST', 'GENERAL'], i), priority: status === 'ESCALATED' ? 'URGENT' : pick(['HIGH', 'MEDIUM', 'LOW'], i), status,
      customer_id: c.id, assignee_id: c.owner_id, team_id: c.team_id, department_id: deptId, created_by: c.owner_id,
      sla_due_at: daysFromNow(status === 'ESCALATED' || ctx.scenario === 'overdue' ? -1 : 1), escalation_level: status === 'ESCALATED' ? 1 : 0,
      escalated_at: status === 'ESCALATED' ? daysFromNow(-1) : null, escalated_to: null, first_response_at: daysFromNow(-2), resolved_at: ['RESOLVED', 'CLOSED'].includes(status) ? daysFromNow(-1) : null,
      resolution_notes: ['RESOLVED', 'CLOSED'].includes(status) ? 'Resolved for the demonstration.' : null, last_client_message_at: daysFromNow(-1), last_staff_reply_at: daysFromNow(-1, 15),
      created_at: daysFromNow(-3 - (i % 6)), updated_at: daysFromNow(-(i % 3))
    };
  });
  const head = people(ctx).find(p => p.role === 'DEPARTMENT_HEAD')!;
  const taskTitles = ['Renewal call for Aster Dental (Demo)', 'Verify the Meta business documents', 'Set up the welcome campaign', 'Close the resolved tickets', 'Collect the pending invoice copy',
    'Train the new client user', 'Check the blue tick application', 'Weekly customer health review'];
  const tasks: Row[] = none(ctx) ? [] : taskTitles.map((title, i) => {
    const a = pick(staff, i + 1);
    const overdue = ctx.scenario === 'overdue' ? i % 2 === 0 : i === 5;
    const status = pick(['ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'IN_PROGRESS', 'BLOCKED', 'ASSIGNED', 'COMPLETED', 'ASSIGNED'], i);
    return {
      id: `dc000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, title, description: 'Demonstration task.', priority: pick(['HIGH', 'MEDIUM', 'LOW'], i), status,
      progress: status === 'COMPLETED' ? 100 : (i * 20) % 80, due_date: dateOnly(overdue ? -2 : i), assignee_id: a.id, assigned_by: a.role === 'TEAM_HEAD' ? head.id : a.managerId ?? head.id,
      department_id: deptId, team_id: a.teamId, division: a.division, parent_id: null, customer_id: customers[i % Math.max(1, customers.length)]?.id ?? null, handling: null, assignment_note: null,
      completed_at: status === 'COMPLETED' ? daysFromNow(-1) : null, last_update_at: daysFromNow(-(i % 3)), last_update_note: i % 2 ? 'Spoke to the customer (demonstration).' : null,
      created_at: daysFromNow(-4 - i)
    };
  });
  const invoices: Row[] = none(ctx) ? [] : customers.slice(0, 8).map((c, i) => ({
    id: `dd000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, owner_id: c.owner_id, customer_id: c.id, customer_name: c.company, invoice_number: `DEMO-INV-${String(301 + i)}`,
    amount: [11800, 23600, 5900, 47200, 17700, 8850, 35400, 14160][i], status: i % 3 === 2 ? 'Paid' : 'Pending', issue_date: dateOnly(-10 - i), due_date: dateOnly(i % 4 === 0 ? -3 : 7),
    created_at: daysFromNow(-10 - i)
  }));
  Object.assign(tables(ctx), { customers, support_tickets: tickets, support_ticket_updates: [], support_ticket_reads: [], work_tasks: tasks, work_task_updates: [], member_invoices: invoices,
    crm_leads: [], customer_services: customers.map(c => ({ customer_id: c.id, service_code: c.service_code, details: {}, created_at: c.created_at })) });
}

const open = (t: Row) => !['RESOLVED', 'CLOSED'].includes(String(t.status));

function headOverview(ctx: DemoContext): HeadOverviewData {
  const c = tables(ctx).customers;
  const inv = tables(ctx).member_invoices;
  const staff = people(ctx).filter(p => p.id !== DEMO_ME_ID);
  const present = none(ctx) ? 0 : Math.max(0, staff.length - (ctx.scenario === 'on-leave' ? 3 : 1));
  const sum = (rows: Row[]) => rows.reduce((s, r) => s + Number(r.amount), 0);
  const pending = inv.filter(r => r.status === 'Pending');
  const overdue = pending.filter(r => String(r.due_date) < dateOnly(0));
  return {
    department: { id: demoDepartmentId(ctx.identity.department.slug), name: ctx.identity.department.name }, today: dateOnly(0),
    attendance: { employees: staff.length, present, absent: none(ctx) ? 0 : 1, onLeave: ctx.scenario === 'on-leave' ? 2 : 0, rate: staff.length && !none(ctx) ? Math.round((present / staff.length) * 100) : null },
    customers: { total: c.length, active: c.filter(x => x.status === 'ACTIVE').length, inactive: c.filter(x => x.status === 'INACTIVE').length, new: none(ctx) ? 0 : 3, withPendingInvoices: new Set(pending.map(r => r.customer_id)).size },
    leads: { total: none(ctx) ? 0 : 18, new: none(ctx) ? 0 : 5, inProgress: none(ctx) ? 0 : 8, converted: none(ctx) ? 0 : 4, lost: none(ctx) ? 0 : 1 },
    invoices: { count: inv.length, amount: sum(inv), paid: inv.length - pending.length, paidAmount: sum(inv) - sum(pending), pending: pending.length, pendingAmount: sum(pending), overdue: overdue.length, overdueAmount: sum(overdue) }
  };
}

function tlDashboard(ctx: DemoContext): TlDashboard {
  const me = people(ctx).find(p => p.id === DEMO_ME_ID) ?? supportStaff(ctx).find(p => p.role === 'TEAM_HEAD')!;
  const team = people(ctx).filter(p => p.managerId === me.id);
  const c = tables(ctx).customers;
  const t = tables(ctx).support_tickets;
  return {
    lead: { id: me.id, fullName: me.fullName, teamId: me.teamId ?? '', teamName: `${ctx.identity.department.name} Support Team` },
    totals: { customers: c.length, mine: c.filter(x => x.owner_id === me.id).length, team: c.filter(x => team.some(m => m.id === x.owner_id)).length, needsDecision: none(ctx) ? 0 : 2,
              openTickets: t.filter(open).length, urgentTickets: t.filter(x => x.priority === 'URGENT' && open(x)).length },
    members: team.map(m => ({ id: m.id, fullName: m.fullName, customers: c.filter(x => x.owner_id === m.id).length, openTickets: t.filter(x => x.assignee_id === m.id && open(x)).length,
                              urgentTickets: t.filter(x => x.assignee_id === m.id && x.priority === 'URGENT' && open(x)).length })),
    decisions: c.slice(0, none(ctx) ? 0 : 2).map(x => ({ id: String(x.id), name: String(x.name), company: String(x.company), code: String(x.customer_code), passedAt: daysFromNow(-1) })),
    alerts: t.filter(x => x.priority === 'URGENT' && open(x)).slice(0, 5).map(x => {
      const cust = c.find(y => y.id === x.customer_id);
      return { id: String(x.id), ticketNo: String(x.ticket_no), subject: String(x.subject), priority: 'URGENT', status: x.status as TlDashboard['alerts'][number]['status'], updatedAt: String(x.updated_at),
               customerId: String(x.customer_id), customerName: String(cust?.company ?? '') };
    }),
    activity: c.slice(0, 5).map((x, i) => ({ id: `de000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, type: pick(['NOTE', 'CALL', 'TICKET_UPDATE'], i), note: 'Demonstration activity.',
      occurredAt: daysFromNow(-i * 0.4), customerId: String(x.id), customerName: String(x.company), actorName: pick(team.length ? team : [me], i).fullName }))
  };
}

function teamAttendance(ctx: DemoContext): TeamAttendance {
  const staff = people(ctx).filter(p => p.id !== DEMO_ME_ID);
  const rows: TeamAttendanceRow[] = staff.map((p, i) => {
    const onLeave = ctx.scenario === 'on-leave' ? i < 2 : i === staff.length - 1;
    const late = !onLeave && i % 5 === 3;
    return { profileId: p.id, name: p.fullName, avatarUrl: null, designation: p.position, role: p.role, departmentId: demoDepartmentId(p.departmentSlug), department: ctx.identity.department.name,
      teamId: p.teamId, team: p.teamId ? `${ctx.identity.department.name} ${p.division === 'SALES' ? 'Sales' : p.division === 'SUPPORT' ? 'Support' : ''} Team`.replace('  ', ' ') : null,
      teamLead: null, status: onLeave ? 'APPROVED_LEAVE' : late ? 'LATE' : 'PRESENT', late, lateMinutes: late ? 22 : 0, punchInAt: onLeave ? null : daysFromNow(0, late ? 5 : 4),
      punchOutAt: null, dayStart: null, dayEnd: null, leave: onLeave ? 'FULL_DAY' : null, onBreak: i % 6 === 2, workedMinutes: onLeave ? null : 200 - i * 5, earlyOutReason: null,
      correctionPending: ctx.scenario === 'pending-approvals' && i % 4 === 0, available: !onLeave };
  });
  const present = rows.filter(r => r.available).length;
  return {
    date: dateOnly(0), today: dateOnly(0), serverTime: new Date().toISOString(), workingDay: true, graceMinutes: 30, absentAfterMinutes: 240, reportingTime: '10:00', lateAfter: '10:30',
    totals: { total: rows.length, scheduled: rows.length, present, absent: 0, notPunchedIn: 0, shiftNotStarted: 0, late: rows.filter(r => r.late).length, onLeave: rows.length - present,
              halfDay: 0, onBreak: rows.filter(r => r.onBreak).length, shiftCompleted: 0, offToday: 0 },
    departments: [{ id: demoDepartmentId(ctx.identity.department.slug), name: ctx.identity.department.name, total: rows.length, available: present, present, unavailable: rows.length - present, late: rows.filter(r => r.late).length }],
    teams: [], departmentOptions: [{ id: demoDepartmentId(ctx.identity.department.slug), name: ctx.identity.department.name }], rows: none(ctx) ? [] : rows, shown: none(ctx) ? 0 : rows.length
  };
}

export const support: FixtureModule = {
  build,
  routes: [
    { method: 'GET', path: '/pipeline/division-support-overview', handle: (ctx): DivisionSupportOverview => {
      const staff = supportStaff(ctx);
      const c = tables(ctx).customers;
      const t = tables(ctx).support_tickets;
      const tk = tables(ctx).work_tasks;
      const st = (s: string) => t.filter(x => x.status === s).length;
      return {
        teamIds: [...new Set(staff.map(p => p.teamId!).filter(Boolean))],
        members: staff.map(p => ({ id: p.id, fullName: p.fullName, email: p.email, role: p.role, status: 'ACTIVE', teamId: p.teamId ?? '', teamName: `${ctx.identity.department.name} Support Team`,
          customersAdded: c.filter(x => x.owner_id === p.id).length, customersOwned: c.filter(x => x.owner_id === p.id).length, ticketsAssigned: t.filter(x => x.assignee_id === p.id).length,
          ticketsOpen: t.filter(x => x.assignee_id === p.id && x.status === 'OPEN').length, ticketsInProgress: t.filter(x => x.assignee_id === p.id && x.status === 'IN_PROGRESS').length,
          ticketsWaiting: t.filter(x => x.assignee_id === p.id && x.status === 'WAITING_CUSTOMER').length, ticketsEscalated: t.filter(x => x.assignee_id === p.id && x.status === 'ESCALATED').length,
          ticketsResolved: t.filter(x => x.assignee_id === p.id && !open(x)).length, tasksPending: tk.filter(x => x.assignee_id === p.id && x.status !== 'COMPLETED').length,
          tasksDone: tk.filter(x => x.assignee_id === p.id && x.status === 'COMPLETED').length, lastCustomerAt: (c.find(x => x.owner_id === p.id)?.created_at as string) ?? null })),
        totals: { members: staff.length, customers: c.length, customersActive: c.filter(x => x.status === 'ACTIVE').length, tickets: t.length, open: st('OPEN'), inProgress: st('IN_PROGRESS'),
                  waiting: st('WAITING_CUSTOMER'), escalated: st('ESCALATED'), resolved: t.filter(x => !open(x)).length, unassigned: t.filter(x => !x.assignee_id).length,
                  tasksPending: tk.filter(x => x.status !== 'COMPLETED').length, tasksDone: tk.filter(x => x.status === 'COMPLETED').length }
      };
    } },
    { method: 'GET', path: '/dashboard/scope-overview', handle: (ctx): ScopeOverview => {
      const c = tables(ctx).customers;
      const t = tables(ctx).support_tickets;
      const tk = tables(ctx).work_tasks;
      const staff = people(ctx).filter(p => p.role !== 'DEPARTMENT_HEAD');
      const z = none(ctx);
      return {
        generatedAt: new Date().toISOString(), scope: { role: ctx.identity.profile.role, departmentId: demoDepartmentId(ctx.identity.department.slug), teamId: null },
        customers: { total: c.length + (z ? 0 : 22), leads: z ? 0 : 12, potential: z ? 0 : 6, onboarding: z ? 0 : 4, customers: c.length, lost: z ? 0 : 1 },
        pipeline: { followUpsOverdue: z ? 0 : ctx.scenario === 'overdue' ? 7 : 2, followUpsToday: z ? 0 : 4, leadsWithoutFollowUp: z ? 0 : 3, newLeadsThisWeek: z ? 0 : 5, wonThisMonth: z ? 0 : 3 },
        money: { pendingConfirmations: z ? 0 : 2, unverifiedPayments: z ? 0 : 1, outstandingBalance: z ? 0 : 84_960, customersWithBalance: z ? 0 : 4, verifiedReceived: z ? 0 : 312_700 },
        onboarding: { inProgress: z ? 0 : 4, waitingForDepartmentHead: z ? 0 : ctx.scenario === 'pending-approvals' ? 3 : 1, waitingForTeamLead: z ? 0 : 1, withTeamMember: z ? 0 : 2, itemsTotal: z ? 0 : 24, itemsVerified: z ? 0 : 15, stalled: z ? 0 : 1 },
        tickets: { open: t.filter(open).length, escalated: t.filter(x => x.status === 'ESCALATED').length, unassigned: t.filter(x => !x.assignee_id).length, pastSla: t.filter(x => open(x) && String(x.sla_due_at) < new Date().toISOString()).length },
        tasks: { open: tk.filter(x => x.status !== 'COMPLETED').length, overdue: tk.filter(x => x.status !== 'COMPLETED' && String(x.due_date) < dateOnly(0)).length, blocked: tk.filter(x => x.status === 'BLOCKED').length, completedThisWeek: tk.filter(x => x.status === 'COMPLETED').length },
        members: staff.map((p, i) => ({ id: p.id, name: p.fullName, role: p.role, team: `${ctx.identity.department.name} team`, teamId: p.teamId ?? '', leads: z ? 0 : i % 4, potential: z ? 0 : i % 3, onboarding: z ? 0 : i % 2,
          customers: c.filter(x => x.owner_id === p.id).length, records: c.filter(x => x.owner_id === p.id).length + (i % 4), followUpsOverdue: z ? 0 : i % 2, openTasks: tk.filter(x => x.assignee_id === p.id && x.status !== 'COMPLETED').length,
          overdueTasks: tk.filter(x => x.assignee_id === p.id && x.status !== 'COMPLETED' && String(x.due_date) < dateOnly(0)).length, lastActivityAt: z ? null : daysFromNow(-(i % 4)) })),
        teams: [],
        recentActivity: c.slice(0, 6).map((x, i) => ({ at: daysFromNow(-i * 0.3), type: pick(['NOTE', 'TICKET', 'PAYMENT', 'STAGE'], i), note: 'Demonstration activity.', customerId: String(x.id), customer: String(x.company), department: ctx.identity.department.name, actor: pick(staff, i)?.fullName ?? null }))
      };
    } },
    { method: 'GET', path: '/operations/dashboard', handle: (ctx): OperationsDashboard => {
      const z = none(ctx);
      const depts = ctx.identity.scopes?.departments.length ? ctx.identity.scopes.departments : [{ id: demoDepartmentId(ctx.identity.department.slug), name: ctx.identity.department.name, slug: ctx.identity.department.slug }];
      const list = depts.map((d, i) => ({ id: d.id, name: d.name, slug: d.slug, accountable: true,
        departmentHeads: [{ id: `d3100000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, name: pick(['Kavya Rao', 'Imran Das', 'Tara Mehta'], i), email: `head${i + 1}@example.invalid`, status: 'ACTIVE', side: 'SUPPORT', lastLoginAt: daysFromNow(-i * 0.5) }],
        teamLeads: 2, teamMembers: 8 + i * 2, awaitingAssignment: z ? 0 : 1 + i, pendingDepartmentHeadApprovals: z ? 0 : ctx.scenario === 'pending-approvals' ? 3 : i, leads: z ? 0 : 18 + i * 7, onboarding: z ? 0 : 4 + i,
        customers: z ? 0 : 14 + i * 5, awaitingDepartmentHead: z ? 0 : i, withVerifier: z ? 0 : 1 }));
      return { departments: list, totals: { departments: list.length, departmentHeads: list.length, teamLeads: list.reduce((s, d) => s + d.teamLeads, 0), teamMembers: list.reduce((s, d) => s + d.teamMembers, 0),
        awaitingAssignment: list.reduce((s, d) => s + d.awaitingAssignment, 0), pendingDepartmentHeadApprovals: list.reduce((s, d) => s + d.pendingDepartmentHeadApprovals, 0) } };
    } }
  ],
  rpcs: {
    head_dashboard_overview: ctx => headOverview(ctx),
    team_lead_dashboard: ctx => tlDashboard(ctx),
    attendance_team_overview: ctx => teamAttendance(ctx),
    work_update_list: (ctx, args): WorkUpdateList => ({ filter: (args.p_filter as WorkUpdateList['filter']) ?? 'ALL', counts: { all: 0, pending: 0, responded: 0, overdue: 0 }, items: [] }),
    // the live database escalates overdue tickets on a timer; the demonstration data already holds its escalations
    escalate_overdue_tickets: () => null,
    // Add Customer: the customer appears in the demonstration list only (the duplicate check works on the demonstration customers)
    create_support_customer: (ctx, a) => {
      const name = String(a.p_name ?? '').trim();
      if (name.length < 2) throw new DemoError('VALIDATION_ERROR', 'VALIDATION_ERROR: Enter the customer’s full name.');
      const phone = String(a.p_phone ?? '').replace(/\D/g, '');
      const email = String(a.p_email ?? '').trim().toLowerCase();
      if (tables(ctx).customers.some(c => (email && c.email === email) || (phone.length >= 7 && String(c.phone).replace(/\D/g, '').endsWith(phone.slice(-10)))))
        throw new DemoError('CONFLICT', 'CONFLICT: A demonstration customer with this phone or e-mail already exists.');
      const owner = people(ctx).find(p => p.id === (a.p_assignee || DEMO_ME_ID));
      if (!owner?.teamId) throw new DemoError('VALIDATION_ERROR', 'VALIDATION_ERROR: Choose an active team member to assign this customer to.');
      const id = demoId();
      tables(ctx).customers.unshift({ id, customer_code: `CUS-DEMO-${tables(ctx).customers.length + 1}`, name, company: String(a.p_company ?? '') || null, email: email || null, phone: String(a.p_phone ?? '') || null,
        segment: a.p_segment ?? 'RETAIL', status: a.p_status ?? 'ACTIVE', lifecycle_stage: 'CUSTOMER', owner_id: owner.id, team_id: owner.teamId, department_id: demoDepartmentId(ctx.identity.department.slug),
        channel: a.p_channel ?? null, service_code: null, service_interest: null, service_details: {}, requirement: a.p_requirement ?? null, notes: a.p_notes ?? null,
        search_text: `${name} ${a.p_company ?? ''}`.toLowerCase(), created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
      simulated();
      return id;
    },
    // Assign Task (Department Head -> Team Lead, Team Lead -> members): appears in the demonstration task lists only
    assign_task_to_team_lead: (ctx, a) => addTask(ctx, String(a.p_assignee ?? a.p_team_lead ?? ''), a),
    assign_team_task: (ctx, a) => { const ids = (a.p_members ?? a.p_assignees ?? []) as string[]; for (const id of ids) addTask(ctx, id, a); return ids.length; },
    assign_task_to_members: (ctx, a) => { const ids = (a.p_members ?? []) as string[]; simulated(); return ids.length; },
    my_team_members: ctx => people(ctx).filter(p => p.managerId === DEMO_ME_ID).map(p => ({ id: p.id, fullName: p.fullName, position: p.position, ordinary: true }))
  }
};

function addTask(ctx: DemoContext, assigneeId: string, a: Record<string, unknown>): string {
  const person = people(ctx).find(p => p.id === assigneeId);
  const title = String(a.p_title ?? '').trim();
  if (!person || title.length < 3) throw new DemoError('VALIDATION_ERROR', 'VALIDATION_ERROR: Choose a person and give the task a title (at least 3 characters).');
  const id = demoId();
  tables(ctx).work_tasks.unshift({ id, title, description: a.p_description ?? null, priority: a.p_priority ?? 'MEDIUM', status: 'ASSIGNED', progress: 0, due_date: a.p_due ?? a.p_due_date ?? null,
    assignee_id: person.id, assigned_by: DEMO_ME_ID, department_id: demoDepartmentId(ctx.identity.department.slug), team_id: person.teamId, division: person.division, parent_id: null,
    customer_id: null, handling: null, assignment_note: null, completed_at: null, last_update_at: null, last_update_note: null, created_at: new Date().toISOString() });
  simulated();
  return id;
}
