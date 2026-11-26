/**
 * Meetings with the CEO: ONLY the Super Admin approves, rejects or reschedules (no database, no network). The database decides who may do
 * what (supabase/tests/meetings_ceo_approval_test.sql proves it for every role); this checks what the server around it does:
 *   - a refusal from the database ("42501" / "FORBIDDEN: ...") reaches the caller as HTTP 403 with that message
 *   - the server never sends a role or a user id of its own: the functions get only the meeting, the decision and the reason, so who may
 *     decide is read from the signed-in account in the database, never from the request
 *   - the request bodies are strict: a role, a user id or a status smuggled in is refused
 *   - every management route needs a login
 * Run: npm run test:unit
 */
import { readFileSync } from 'node:fs';
import { AppError } from '../../server/http/errors.js';
import { MeetingRepository } from '../../server/repositories/MeetingRepository.js';
import { MeetingService } from '../../server/services/MeetingService.js';
import { ceoRequestsQuerySchema, meetingCreateSchema, meetingDecisionSchema, meetingRescheduleSchema, calendarMeetingCancelSchema } from '../../shared/validation.js';

let passed = 0;
function check(cond: unknown, label: string, extra?: unknown) {
  if (!cond) { console.error(`FAILED: ${label}`, extra === undefined ? '' : JSON.stringify(extra)); process.exit(1); }
  passed++;
  console.log(`ok - ${label}`);
}

const ID = '3f2b8a52-6f0e-4a73-9d56-2a1d4a8f9b10';
const NOW = Date.now();
const iso = (days: number) => new Date(NOW + days * 86_400_000).toISOString();

/** A stand-in for the signed-in client: records every call and answers like PostgREST does when the database refuses. */
function fakeDb(answer: { data?: unknown; error?: { code: string; message: string } }) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const db = { rpc: async (fn: string, args: Record<string, unknown>) => { calls.push({ fn, args }); return { data: answer.data ?? null, error: answer.error ?? null }; } };
  return { db: db as never, calls };
}
const refused = { code: '42501', message: 'FORBIDDEN: Only the Super Admin (CEO) can approve, reject or reschedule a meeting request with the CEO.' };

async function outcome(run: () => Promise<unknown>): Promise<AppError | null> {
  try { await run(); return null; } catch (e) { return e as AppError; }
}

// ---------------------------------------------------------------------------
// a refusal from the database is HTTP 403 for approve, reject, propose, reschedule, cancel (and with the bare SQLSTATE too)
// ---------------------------------------------------------------------------
const ops: [string, (s: MeetingService) => Promise<unknown>][] = [
  ['approve', s => s.decide(ID, { decision: 'APPROVE' })],
  ['reject', s => s.decide(ID, { decision: 'DECLINE', note: 'No' })],
  ['propose another time', s => s.decide(ID, { decision: 'PROPOSE', note: 'x', startsAt: iso(5), endsAt: iso(5.02) })],
  ['reschedule', s => s.reschedule(ID, { startsAt: iso(6), endsAt: iso(6.02), note: 'Moved' })],
  ['cancel', s => s.cancel(ID, { reason: 'Called off' })]
];
for (const [name, op] of ops) {
  const { db } = fakeDb({ error: refused });
  const e = await outcome(() => op(new MeetingService(new MeetingRepository(db))));
  check(e instanceof AppError && e.code === 'FORBIDDEN' && e.status === 403, `${name}: a refusal from the database is HTTP 403`, e && { code: e.code, status: e.status });
  check(e?.message.startsWith('Only the Super Admin (CEO)'), `${name}: the caller is told why`, e?.message);
  const bare = fakeDb({ error: { code: '42501', message: 'new row violates row-level security policy' } });
  const e2 = await outcome(() => op(new MeetingService(new MeetingRepository(bare.db))));
  check(e2 instanceof AppError && e2.status === 403, `${name}: the bare SQLSTATE 42501 is HTTP 403 too`, e2 && { code: e2.code, status: e2.status });
}

// ---------------------------------------------------------------------------
// what the server sends to the database: the meeting, the decision, the reason; never a role or a user id
// ---------------------------------------------------------------------------
{
  const { db, calls } = fakeDb({ error: refused });
  const svc = new MeetingService(new MeetingRepository(db));
  await outcome(() => svc.decide(ID, { decision: 'APPROVE', note: 'ok', version: 3 }));
  await outcome(() => svc.decide(ID, { decision: 'DECLINE', note: 'Not this week' }));
  await outcome(() => svc.reschedule(ID, { startsAt: iso(6), endsAt: iso(6.02), note: 'Moved', version: 3 }));
  await outcome(() => svc.cancel(ID, { reason: 'Called off' }));
  check(calls.map(c => c.fn).join() === 'mtg_decide,mtg_decide,mtg_reschedule,mtg_cancel', 'the existing database functions are used (no second approval path)', calls.map(c => c.fn));
  const sent = JSON.stringify(calls.map(c => c.args));
  check(!/role|user_id|userId|actor|decided_by|decidedBy|super_admin|SUPER_ADMIN/i.test(sent), 'no role, user id or approver is sent: the database reads them from the signed-in account', sent);
  check(Object.keys(calls[0].args).sort().join() === 'p_decision,p_ends_at,p_id,p_note,p_starts_at,p_version', 'a decision carries only the meeting, the decision, the note and the version', Object.keys(calls[0].args));
  check(calls[1].args.p_note === 'Not this week' && calls[1].args.p_decision === 'DECLINE', 'a rejection carries its reason');
}

// ---------------------------------------------------------------------------
// the requests list asks the database for the section; nothing else decides what is shown
// ---------------------------------------------------------------------------
{
  const { db, calls } = fakeDb({ data: { section: 'PENDING', isSuperAdmin: false, counts: { pending: 1, approved: 0, rejected: 0, rescheduled: 0, all: 1 }, items: [], limit: 50, offset: 0 } });
  const svc = new MeetingService(new MeetingRepository(db));
  const r = await svc.ceoRequests({ section: 'PENDING' });
  check(calls[0].fn === 'mtg_ceo_requests' && calls[0].args.p_section === 'PENDING' && calls[0].args.p_limit === 50 && calls[0].args.p_offset === 0, 'the CEO-requests list is one database function', calls[0]);
  check(!('p_user' in calls[0].args) && !('p_profile' in calls[0].args), 'asked without a user: the database knows who is signed in');
  check(r.isSuperAdmin === false, 'and the page is told by the database whether the viewer is the Super Admin');
  check(ceoRequestsQuerySchema.safeParse({ section: 'EVERYTHING' }).success === false, 'an unknown section is refused');
  check(ceoRequestsQuerySchema.safeParse({ limit: '1000' }).success === false, 'the page size is bounded');
  check(ceoRequestsQuerySchema.safeParse({ section: 'APPROVED', limit: '20', offset: '40' }).success === true, 'a good query passes');
  check(ceoRequestsQuerySchema.safeParse({ section: 'ALL', asRole: 'SUPER_ADMIN' }).success === false, 'a smuggled field is refused');
}

// ---------------------------------------------------------------------------
// strict bodies: a role, a user id or a status cannot be smuggled in
// ---------------------------------------------------------------------------
check(meetingDecisionSchema.safeParse({ decision: 'APPROVE', role: 'SUPER_ADMIN' }).success === false, 'a decision with a "role" is refused');
check(meetingDecisionSchema.safeParse({ decision: 'APPROVE', decidedBy: ID }).success === false, 'a decision with an approver id is refused');
check(meetingDecisionSchema.safeParse({ decision: 'APPROVE', userId: ID }).success === false, 'a decision with a user id is refused');
check(meetingDecisionSchema.safeParse({ decision: 'SCHEDULED' }).success === false, 'a decision is APPROVE, DECLINE or PROPOSE only (no status is set from outside)');
check(meetingDecisionSchema.safeParse({ decision: 'DECLINE', note: 'Reason' }).success === true, 'a rejection with a reason passes');
check(meetingRescheduleSchema.safeParse({ startsAt: iso(2), endsAt: iso(2.02), note: 'why', role: 'SUPER_ADMIN' }).success === false, 'a reschedule with a role is refused');
check(meetingRescheduleSchema.safeParse({ startsAt: iso(2), endsAt: iso(2.02), status: 'SCHEDULED' }).success === false, 'a reschedule cannot set the status');
check(calendarMeetingCancelSchema.safeParse({ reason: 'x', cancelledBy: ID }).success === false, 'a cancel with a "cancelled by" is refused');
check(meetingCreateSchema.safeParse({ title: 'Budget', description: 'Agenda', message: 'Thanks', hostId: ID, startsAt: iso(3), endsAt: iso(3.02) }).success === true, 'a request with an agenda and a message passes');
check(meetingCreateSchema.safeParse({ title: 'Budget', hostId: ID, startsAt: iso(3), endsAt: iso(3.02), status: 'SCHEDULED' }).success === false, 'a request cannot set its own status');
check(meetingCreateSchema.safeParse({ title: 'Budget', hostId: ID, startsAt: iso(3), endsAt: iso(3.02), requiresApproval: false }).success === false, 'nor switch the approval off');
check(meetingCreateSchema.safeParse({ title: 'Budget', message: 'x'.repeat(2001), startsAt: iso(3), endsAt: iso(3.02) }).success === false, 'the message has a limit');

// ---------------------------------------------------------------------------
// every management route needs a login (none is public) and the CEO list exists
// ---------------------------------------------------------------------------
{
  const routes = readFileSync('server/routes.ts', 'utf8').split('\n').filter(l => l.includes("path: '/meetings"));
  const need = ['/meetings/:id/decision', '/meetings/:id/reschedule', '/meetings/:id/cancel', '/meetings/:id/complete', '/meetings/approvals', '/meetings/ceo-requests', '/meetings'];
  for (const p of need) {
    const line = routes.find(l => l.includes(`path: '${p}'`));
    check(!!line && !/public\s*:\s*true/.test(line), `${p} exists and needs a login`, line);
  }
  check(!routes.some(l => /public\s*:\s*true/.test(l)), 'no /meetings route is public');
}

console.log(`\n${passed} checks passed`);
