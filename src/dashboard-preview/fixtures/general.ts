import type { ChatInternalMode, ChatKeyStatus, ChatUnreadSummary, CompanyNotice, DevBugAccess, LeaveRequest, LeaveReview, Notification, NoticePending, Paginated, ReportContext } from '../../../shared/contracts';
import type { AttendanceDayData, ReminderSettings } from '../../lib/attendance';
import { DemoError, simulated, type DemoContext, type FixtureModule, type RouteCtx } from '../runtime/demoStore';
import { DEMO_ME_ID } from '../runtime/previewIdentity';
import { dateOnly, daysFromNow, demoDepartments, demoPeople, demoTeams, profileRow, type DemoPerson } from './org';

/**
 * What every dashboard's frame reads (departments, teams, people, the bell, notices, chat badges, leave, attendance, report context), with the
 * scenario applied: "empty" and "new-account" have no history, "pending-approvals" has leave waiting, "on-leave" shows the person on leave.
 */
const people = (ctx: DemoContext) => ctx.state.bag.people as DemoPerson[];
const empty = (ctx: DemoContext) => ctx.scenario === 'empty' || ctx.scenario === 'new-account';

function notifications(ctx: DemoContext): Notification[] {
  if (empty(ctx)) return [];
  const n = (i: number, type: string, title: string, body: string, read: boolean, priority: Notification['priority'] = 'normal'): Notification => ({
    id: `d4000000-0000-4000-8000-${String(i).padStart(12, '0')}`, type, title, body, priority, entityType: null, entityId: null, actorId: null, data: {},
    readAt: read ? daysFromNow(-1) : null, createdAt: daysFromNow(-i * 0.15, 9 + i)
  });
  return [
    n(1, 'TASK_ASSIGNED', 'New task: Prepare the weekly follow-up list', 'Assigned by your Team Lead (demonstration).', false),
    n(2, 'MEETING_REMINDER', 'In 1 hour: Team stand-up', 'Today, 11:00 AM (IST) · demonstration meeting.', false),
    n(3, 'NOTICE_PUBLISHED', 'Notice: Office timings during the festival week', 'Read and acknowledge (demonstration notice).', true, 'announcement'),
    n(4, 'LEAVE_APPROVED', 'Leave approved', 'Your half day on Friday was approved (demonstration).', true),
    n(5, 'TICKET_ESCALATED', 'Escalated: TKT-1042 WhatsApp template rejected', 'Overdue for 26 hours (demonstration ticket).', ctx.scenario !== 'escalations', ctx.scenario === 'escalations' ? 'urgent' : 'normal')
  ];
}

function notice(i: number, title: string, body: string, priority: CompanyNotice['priority'], acknowledged: boolean): CompanyNotice {
  return {
    id: `d5000000-0000-4000-8000-${String(i).padStart(12, '0')}`, reference: `NOT-2026-${String(100 + i)}`, title, body, category: 'GENERAL', priority,
    status: 'PUBLISHED', expired: false, publishAt: daysFromNow(-i), expiresAt: null, releasedAt: daysFromNow(-i), updatedAt: daysFromNow(-i), version: 1,
    publisherId: 'd3000000-0000-4000-8000-000000000001', publisherName: 'HR Department (demonstration)', publisherRole: 'HR',
    audience: { type: 'COMPANY', departments: [], roles: [], employees: [], departmentNames: [] },
    isRecipient: true, read: acknowledged, readAt: acknowledged ? daysFromNow(-i + 0.2) : null, canManage: false, recipientCount: 42, readCount: 31,
    acknowledged, acknowledgedAt: acknowledged ? daysFromNow(-i + 0.2) : null, acknowledgedCount: 0, attachments: []
  };
}

function leave(ctx: DemoContext): { mine: LeaveRequest[]; review: LeaveReview } {
  const me = ctx.identity.profile;
  const team = people(ctx).filter(p => p.id !== DEMO_ME_ID && (me.role === 'DEPARTMENT_HEAD' || p.managerId === DEMO_ME_ID));
  const req = (i: number, who: { id: string; fullName: string }, start: number, status: LeaveRequest['status'], reason: string): LeaveRequest => ({
    paid: i % 2 === 0, id: `d6000000-0000-4000-8000-${String(i).padStart(12, '0')}`, employeeId: who.id, employeeName: who.fullName, departmentName: ctx.identity.department.name,
    leaveType: i % 3 === 0 ? 'HALF_DAY' : 'FULL_DAY', startDate: dateOnly(start), endDate: dateOnly(start + (i % 3 === 0 ? 0 : 1)), halfDayShift: i % 3 === 0 ? 'AFTERNOON' : null,
    days: i % 3 === 0 ? 0.5 : 2, reason, status, createdAt: daysFromNow(-2), departmentHead: null
  } as LeaveRequest);
  const mine = empty(ctx) ? [] : [req(1, { id: DEMO_ME_ID, fullName: me.fullName }, ctx.scenario === 'on-leave' ? 0 : 6, ctx.scenario === 'on-leave' ? 'APPROVED' : 'PENDING_DEPARTMENT_HEAD', 'Family function (demonstration)')];
  const waiting = empty(ctx) ? [] : team.slice(0, ctx.scenario === 'pending-approvals' ? 4 : 1).map((p, i) => req(10 + i, p, 3 + i, me.role === 'DEPARTMENT_HEAD' ? 'PENDING_DEPARTMENT_HEAD' : 'PENDING_TEAM_LEAD', 'Personal work (demonstration)'));
  const canReview = me.role !== 'TEAM_MEMBER';
  return { mine, review: { awaiting: canReview ? waiting : [], decided: [], canReviewAsDepartmentHead: me.role === 'DEPARTMENT_HEAD', canReviewAsHr: ctx.identity.department.slug === 'hr', canReview } };
}

function attendanceToday(ctx: DemoContext): AttendanceDayData {
  const punched = !empty(ctx) && ctx.scenario !== 'on-leave';
  const state = ctx.state.bag.attendance as AttendanceDayData | undefined;
  if (state) return state;
  const day: AttendanceDayData = {
    date: dateOnly(0), serverTime: new Date().toISOString(), timeZone: 'Asia/Kolkata', status: punched ? 'PUNCHED_IN' : 'NOT_PUNCHED_IN', maxAccuracyM: 100,
    punchIn: punched ? { at: daysFromNow(0, 4), locationStatus: 'CAPTURED', latitude: null, longitude: null, accuracy: 25, place: 'Demonstration office' } : null,
    punchOut: null, punchOutCount: 0, workedMinutes: punched ? 185 : null,
    lunch: { allowanceMinutes: 45, minutes: 0, remainingMinutes: 45, exceededMinutes: 0, open: null, sessions: [] }
  };
  ctx.state.bag.attendance = day;
  return day;
}

const reminderSettings = (): ReminderSettings => ({
  company: { enabled: true, punchIn: '09:30', lunch: '13:30', punchOut: '18:30', followUpMinutes: 15, lunchWarningMinutes: 10, days: [1, 2, 3, 4, 5, 6], resumeFollowUpMinutes: 0, lunchAllowanceMinutes: 45 },
  mine: { enabled: true, punchIn: null, lunch: null, punchOut: null },
  effective: { enabled: true, punchIn: '09:30', lunch: '13:30', punchOut: '18:30' },
  pausedToday: false, canManage: false, chatPush: true,
  sound: { attendance: true, chat: true, general: true, confirmedAt: daysFromNow(-10) }, testConfirmedAt: daysFromNow(-10)
});

/** A simulated attendance change: the demonstration day moves on, no attendance record exists anywhere. */
function punch(ctx: DemoContext, status: NonNullable<AttendanceDayData['status']>): AttendanceDayData {
  const day = attendanceToday(ctx);
  const at = new Date().toISOString();
  if (status === 'PUNCHED_IN') day.punchIn = { at, locationStatus: 'CAPTURED', latitude: null, longitude: null, accuracy: 20, place: 'Demonstration office' };
  if (status === 'PUNCHED_OUT') { day.punchOut = { at, locationStatus: 'CAPTURED', latitude: null, longitude: null, accuracy: 20, place: 'Demonstration office' }; day.punchOutCount += 1; }
  if (status === 'ON_LUNCH') day.lunch.open = { id: 'd7000000-0000-4000-8000-000000000001', startedAt: at };
  if (status === 'RESUMED_WORK' && day.lunch.open) { day.lunch.sessions.push({ startedAt: day.lunch.open.startedAt, endedAt: at, endedBy: 'SELF', minutes: 1 }); day.lunch.open = null; }
  day.status = status;
  day.serverTime = at;
  simulated();
  return day;
}

function reportContext(ctx: DemoContext): ReportContext {
  const me = ctx.identity.profile;
  const level: ReportContext['level'] = me.isOperationsHead ? 'OPERATIONS_HEAD' : me.role === 'DEPARTMENT_HEAD' ? 'DEPARTMENT_HEAD' : me.role === 'TEAM_HEAD' ? 'TEAM_LEAD' : 'MEMBER';
  const lead = people(ctx).find(p => p.id === people(ctx).find(x => x.id === DEMO_ME_ID)?.managerId);
  const pending = empty(ctx) ? 0 : ctx.scenario === 'pending-approvals' ? 5 : level === 'MEMBER' ? 0 : 2;
  return { level, canWrite: true, name: me.fullName, team: me.team?.name ?? null, reportsTo: lead ? [{ id: lead.id, name: lead.fullName }] : [], pendingReview: pending,
           pendingLeadReports: level === 'DEPARTMENT_HEAD' ? pending : 0, pendingMemberApprovals: 0, weeklyPending: 0, needsRevision: 0, badge: pending };
}

export const general: FixtureModule = {
  build: ctx => {
    const list = demoPeople(ctx.identity);
    ctx.state.bag.people = list;
    ctx.state.bag.notifications = notifications(ctx);
    ctx.state.bag.notices = empty(ctx) ? [] : [
      notice(1, 'Office timings during the festival week', 'From Monday the office opens at 10:00 AM. This is a demonstration notice.', 'IMPORTANT', true),
      notice(2, 'New leave policy explained', 'The updated leave policy is in the HR section. This is a demonstration notice.', 'NORMAL', true)
    ];
    ctx.state.bag.leave = leave(ctx);
    ctx.state.tables.profiles = list.map(profileRow);
    ctx.state.tables.teams = demoTeams().map(t => ({ id: t.id, name: t.name, division: t.division, department_id: t.departmentId, created_at: t.createdAt }));
    ctx.state.tables.departments = demoDepartments().map(d => ({ id: d.id, slug: d.slug, name: d.name }));
    // the lead inbox reads incoming webhook leads; the demonstration has none (the live webhook stream is blocked in the preview)
    ctx.state.tables.crm_leads = [];
  },
  routes: [
    { method: 'GET', path: '/departments', handle: () => demoDepartments() },
    { method: 'GET', path: '/teams', handle: ({ query }) => demoTeams().filter(t => !query.departmentId || t.departmentId === query.departmentId) },
    // the bell
    { method: 'GET', path: '/notifications', handle: ({ state, query }): Paginated<Notification> => {
      const all = (state.bag.notifications as Notification[]).filter(n => query.unreadOnly !== 'true' || !n.readAt);
      return { items: all, page: 1, pageSize: Number(query.pageSize) || 20, total: all.length };
    } },
    { method: 'GET', path: '/notifications/unread-count', handle: ({ state }) => ({ count: (state.bag.notifications as Notification[]).filter(n => !n.readAt).length }) },
    { method: 'POST', path: '/notifications/read-all', handle: ({ state }) => { for (const n of state.bag.notifications as Notification[]) n.readAt ??= new Date().toISOString(); simulated(); return null; } },
    { method: 'POST', path: '/notifications/:id/read', handle: ({ state, params }) => { const n = (state.bag.notifications as Notification[]).find(x => x.id === params.id); if (n) n.readAt ??= new Date().toISOString(); simulated(); return n ?? null; } },
    // company notices (the popup host reads /notices/pending: acknowledged demonstration notices never pop up over the preview)
    { method: 'GET', path: '/notices/pending', handle: (): NoticePending => ({ pending: 0, items: [] }) },
    { method: 'GET', path: '/notices/unread-count', handle: ({ state }) => ({ unread: (state.bag.notices as CompanyNotice[]).filter(n => !n.read).length }) },
    { method: 'GET', path: '/notices', handle: ({ state }) => ({ items: state.bag.notices as CompanyNotice[], total: (state.bag.notices as CompanyNotice[]).length, unread: 0, publisherRole: null }) },
    // chat badges (the chat itself is not part of the demonstration: it is end-to-end encrypted per person)
    { method: 'GET', path: '/chat/settings', handle: (): ChatInternalMode => ({ mode: 'STANDARD' }) },
    { method: 'GET', path: '/chat/unread', handle: ({ scenario }): ChatUnreadSummary => (scenario === 'empty' ? { total: 0, internal: 0, clients: 0, review: 0 } : { total: 3, internal: 2, clients: 1, review: 0 }) },
    { method: 'GET', path: '/chat/keys/status', handle: (): ChatKeyStatus => ({ hasKey: false, version: null, publicKey: null, fingerprint: null, hasBackup: false, backupVersion: null }) },
    // leave
    { method: 'GET', path: '/leave/mine', handle: ({ state }) => (state.bag.leave as { mine: LeaveRequest[] }).mine },
    { method: 'GET', path: '/leave/review', handle: ({ state }) => (state.bag.leave as { review: LeaveReview }).review },
    ...(['decision', 'department-head-decision', 'hr-decision'] as const).map(kind => ({
      method: 'POST' as const, path: `/leave/:id/${kind}`, handle: ({ state, params, body }: RouteCtx) => {
        const review = (state.bag.leave as { review: LeaveReview }).review;
        const i = review.awaiting.findIndex(r => r.id === params.id);
        if (i < 0) throw new DemoError('NOT_FOUND', 'This demonstration leave request was already decided.', 404);
        const b = (body ?? {}) as { approve?: boolean; decision?: string };
        const [r] = review.awaiting.splice(i, 1);
        r.status = b.approve === false || b.decision === 'REJECT' ? 'REJECTED_BY_DEPARTMENT_HEAD' : b.decision === 'REVISE' ? 'REVISION_REQUIRED' : 'APPROVED';
        review.decided.unshift(r);
        simulated();
        return r;
      }
    })),
    { method: 'GET', path: '/bugs/access', handle: (): DevBugAccess => ({ isDeveloper: false, isLead: false, meId: DEMO_ME_ID, developers: [] }) },
    { method: 'GET', path: '/bugs/mine', handle: () => [] },
    { method: 'GET', path: '/meetings/presence', handle: () => [] },
    { method: 'GET', path: '/meetings/presence/ceo', handle: () => [] },
    { method: 'GET', path: '/work-reports/context', handle: ctx => reportContext(ctx) },
    { method: 'GET', path: '/employee-requests', handle: () => [] }
  ],
  rpcs: {
    attendance_today: ctx => attendanceToday(ctx),
    my_attendance: ctx => (empty(ctx) ? [] : [attendanceToday(ctx)]),
    attendance_punch_in: ctx => punch(ctx, 'PUNCHED_IN'),
    attendance_punch_out: ctx => punch(ctx, 'PUNCHED_OUT'),
    attendance_lunch: (ctx, args) => punch(ctx, args.p_action === 'START' ? 'ON_LUNCH' : 'RESUMED_WORK'),
    attendance_reminder_settings: () => reminderSettings(),
    // the preview never registers a device or reports a notification check
    notification_client_check: () => null,
    my_push_devices: () => []
  }
};
