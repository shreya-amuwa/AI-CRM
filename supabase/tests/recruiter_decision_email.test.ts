/**
 * Candidate decision e-mails (no database): the exact subjects and wording, HTML escaping, and the backend dispatcher's behaviour with a fake database
 * and a fake mail provider (dry run sends nothing, live sends once, temporary failures retry, permanent ones fail, the decision is never touched).
 * Run: npm run test:unit
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AutomationSettings } from '../../server/automations/config.js';
import { processDecisionEmail, runDecisionEmailDispatch, type ClaimedDecisionEmail } from '../../server/recruitment/emailDispatcher.js';
import { REJECTION_SUBJECT, SELECTION_SUBJECT, formatDecisionDate, renderRejectionEmail, renderSelectionEmail } from '../../server/recruitment/emailTemplates.js';
import { recruiterCallSchema, recruiterDecisionSchema, recruiterInterviewSchema, recruiterStageSchema, employeeRequestSchema } from '../../shared/validation.js';

let passed = 0;
function check(cond: unknown, label: string, extra?: unknown) {
  if (!cond) {
    console.error(`FAILED: ${label}`, extra === undefined ? '' : JSON.stringify(extra));
    process.exit(1);
  }
  passed++;
  console.log(`ok - ${label}`);
}

// ---- templates -----------------------------------------------------------------------------------------------------------------
const payload = { candidateName: 'Asha Rao', positionName: 'Backend Engineer', departmentName: 'Engineering', selectionDate: '03 November 2026', logoUrl: 'https://crm.example.com/amuwa-logo.png', supportEmail: 'hr@example.com' };
const sel = renderSelectionEmail(payload);
check(SELECTION_SUBJECT === 'Congratulations! You Have Been Selected – Amuwa Corporation' && sel.subject === SELECTION_SUBJECT, 'selection subject is exact');
for (const line of [
  'Dear Asha Rao,', 'Congratulations!', 'you have been selected for the position of Backend Engineer at Amuwa Corporation.',
  'After reviewing your application, assessment performance, and interview evaluation, we are happy to move forward with your candidature.',
  'Selection Details', 'Candidate Name: Asha Rao', 'Selected Position: Backend Engineer', 'Department: Engineering', 'Selection Date: 03 November 2026',
  'Our HR team will share the next steps regarding documentation, verification, and onboarding.', 'Please check your registered email for further communication.',
  'We congratulate you on your selection and look forward to the possibility of welcoming you to Amuwa Corporation.', 'HR Recruitment Team', 'Amuwa Corporation'
]) check(sel.text.replace(/\s+/g, ' ').includes(line), `selection text: ${line.slice(0, 50)}`, sel.text);
check(sel.html.includes('Amuwa Corporation') && sel.html.includes('amuwa-logo.png') && !/\{\{|\}\}/.test(sel.html + sel.text), 'selection is branded and has no unresolved variable');

const rej = renderRejectionEmail(payload);
check(REJECTION_SUBJECT === 'Update on Your Job Application – Amuwa Corporation' && rej.subject === REJECTION_SUBJECT, 'rejection subject is exact');
for (const line of [
  'Dear Asha Rao,', 'Thank you for applying for the position of Backend Engineer at Amuwa Corporation.',
  'We sincerely appreciate the time and effort you invested in our recruitment process, including the application, assessment, and interview stages.',
  'After careful consideration, we regret to inform you that we will not be moving forward with your candidature for this particular position.',
  'This decision does not diminish the value of your skills, experience, or potential.',
  'We appreciate your interest in Amuwa Corporation and encourage you to explore other suitable opportunities with us in the future.',
  'We wish you success in your career.', 'HR Recruitment Team'
]) check(rej.text.replace(/\s+/g, ' ').includes(line), `rejection text: ${line.slice(0, 50)}`, rej.text);
check(!/reason|category|skills mismatch/i.test(rej.text), 'a rejection e-mail never carries the internal reason');
const evil = renderSelectionEmail({ ...payload, candidateName: '<script>alert(1)</script>', positionName: 'A "quoted" & role' });
check(!evil.html.includes('<script>') && evil.html.includes('&lt;script&gt;') && evil.html.includes('&amp;'), 'candidate-controlled values are HTML-escaped');
check(formatDecisionDate('2026-11-03') === '03 November 2026' && formatDecisionDate(null) === '' && formatDecisionDate('nonsense') === '', 'the decision date reads as 03 November 2026');

// ---- dispatcher ----------------------------------------------------------------------------------------------------------------
const base: AutomationSettings = {
  mode: 'live',
  email: { provider: 'resend', apiKey: 'test-key-not-real', smtp: null, apiBaseUrl: null, fromName: 'Amuwa', fromEmail: 'hr@example.com', replyTo: 'hr@example.com', cc: ['cc@example.com'], bcc: ['bcc@example.com'] },
  whatsapp: { webhookUrl: null, source: 'x' }, testRecipients: null, requireValidWhatsapp: false, appUrl: 'https://crm.example.com', secretKey: null, dispatchSecrets: []
};
const ev = (over: Partial<ClaimedDecisionEmail> = {}): ClaimedDecisionEmail => ({
  id: 'e1', attempts: 1, type: 'SELECTION', to: 'asha@example.com', applicationId: 'a1', candidateName: 'Asha Rao', positionName: 'Backend Engineer', departmentName: 'Engineering', decisionDate: '2026-11-03', ...over
});
type Sent = { to: string; subject: string; cc: string[]; bcc: string[]; fromName: string };
const sentLog: Sent[] = [];
const okSender = async (s: AutomationSettings, to: { email: string }, mail: { subject: string }) => { sentLog.push({ to: to.email, subject: mail.subject, cc: s.email.cc, bcc: s.email.bcc, fromName: s.email.fromName }); return { ok: true, retry: false, code: 202, ref: 'ref-1', detail: 'ok' }; };

let o = await processDecisionEmail({ ...base, mode: 'dry_run' }, ev(), okSender);
check(o.outcome === 'DRY_RUN' && sentLog.length === 0, 'dry run prepares the e-mail and sends nothing');
o = await processDecisionEmail(base, ev(), okSender);
check(o.outcome === 'SENT' && o.ref === 'ref-1' && sentLog.length === 1 && sentLog[0].subject === SELECTION_SUBJECT, 'live mode sends the selection e-mail once');
check(sentLog[0].cc.length === 0 && sentLog[0].bcc.length === 0 && sentLog[0].fromName === 'Amuwa Corporation HR', 'the client CC / BCC lists are never copied and the sender is HR');
check(!o.detail.includes('asha@example.com'), 'the result text masks the address', o.detail);
o = await processDecisionEmail(base, ev({ type: 'REJECTION' }), okSender);
check(o.outcome === 'SENT' && sentLog[1].subject === REJECTION_SUBJECT, 'a rejection uses the rejection template');
o = await processDecisionEmail(base, ev({ to: 'not-an-address' }), okSender);
check(o.outcome === 'SKIPPED' && sentLog.length === 2, 'a missing or invalid address is skipped, not sent');
o = await processDecisionEmail({ ...base, testRecipients: { emails: new Set(['someone@else.com']), phones: new Set() } }, ev(), okSender);
check(o.outcome === 'DRY_RUN' && sentLog.length === 2, 'test mode sends only to test recipients');
o = await processDecisionEmail(base, ev(), async () => ({ ok: false, retry: true, code: 503, ref: null, detail: 'Provider unavailable' }));
check(o.outcome === 'RETRY' && o.code === 503, 'a temporary provider failure is retried');
o = await processDecisionEmail(base, ev(), async () => ({ ok: false, retry: false, code: 422, ref: null, detail: 'Rejected address' }));
check(o.outcome === 'FAILED', 'a permanent provider failure fails');

// a fake database: the claim returns rows once, finish records what the dispatcher reports
function fakeDb(rows: ClaimedDecisionEmail[]) {
  const finished: { id: string; outcome: string; detail: string }[] = [];
  let claimed = false;
  const db = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      if (fn === 'recruitment_email_claim') {
        if (claimed) return { data: [], error: null };
        claimed = true;
        return { data: rows, error: null };
      }
      if (fn === 'recruitment_email_finish') { finished.push({ id: args.p_id as string, outcome: args.p_outcome as string, detail: args.p_detail as string }); return { data: {}, error: null }; }
      return { data: null, error: { message: 'unexpected' } };
    }
  } as unknown as SupabaseClient;
  return { db, finished };
}
sentLog.length = 0;
let f = fakeDb([ev({ id: 'e1' }), ev({ id: 'e2', type: 'REJECTION', to: 'bimal@example.com', candidateName: 'Bimal Das' })]);
let summary = await runDecisionEmailDispatch({ db: f.db, settings: base, send: okSender });
check(summary.claimed === 2 && summary.sent === 2 && f.finished.every(x => x.outcome === 'SENT') && sentLog.length === 2, 'the dispatcher claims, sends and records every row');
summary = await runDecisionEmailDispatch({ db: f.db, settings: base, send: okSender });
check(summary.claimed === 0 && sentLog.length === 2, 'running again sends nothing more (rows are claimed once)');
f = fakeDb([ev()]);
summary = await runDecisionEmailDispatch({ db: f.db, settings: base, send: async () => { throw new Error('socket hang up'); } });
check(summary.retrying === 1 && f.finished[0].outcome === 'RETRY', 'an unexpected error is recorded as a retry and never thrown at the request');
f = fakeDb([ev()]);
summary = await runDecisionEmailDispatch({ db: f.db, settings: { ...base, mode: 'off' }, send: okSender });
check(summary.claimed === 0 && !!summary.note && f.finished.length === 0, 'automation off: nothing is claimed');
f = fakeDb([ev()]);
summary = await runDecisionEmailDispatch({ db: f.db, settings: { ...base, email: { ...base.email, provider: null, apiKey: null } }, send: okSender });
check(summary.claimed === 0 && !!summary.note, 'live mode without a configured provider leaves the e-mails waiting in the queue');
process.env.RECRUITMENT_EMAIL = 'off';
f = fakeDb([ev()]);
summary = await runDecisionEmailDispatch({ db: f.db, settings: base, send: okSender });
check(summary.claimed === 0 && !!summary.note, 'the operator kill switch stops sending but not queueing');
delete process.env.RECRUITMENT_EMAIL;

// ---- schemas the forms and the server share ---------------------------------------------------------------------------------------
check(!recruiterCallSchema.safeParse({ action: 'RECORD' }).success, 'a call cannot be completed without an outcome');
check(!recruiterCallSchema.safeParse({ action: 'RECORD', outcome: 'CALL_BACK' }).success && recruiterCallSchema.safeParse({ action: 'RECORD', outcome: 'CALL_BACK', followUpDate: '2026-11-10' }).success, 'a call-back needs its follow-up date');
check(!recruiterDecisionSchema.safeParse({ decision: 'REJECTED' }).success && recruiterDecisionSchema.safeParse({ decision: 'REJECTED', category: 'SKILLS_MISMATCH' }).success && recruiterDecisionSchema.safeParse({ decision: 'SELECTED' }).success, 'a rejection needs a category or a reason; a selection needs neither');
check(!recruiterDecisionSchema.safeParse({ decision: 'SELECTED', candidateEmail: 'x@y.com' }).success, 'a decision request carries no e-mail field (strict)');
check(!recruiterInterviewSchema.safeParse({ action: 'COMPLETE', id: '11111111-1111-4111-8111-111111111111', version: 1 }).success, 'completing an interview needs its result');
check(!recruiterStageSchema.safeParse({ action: 'HOLD' }).success && recruiterStageSchema.safeParse({ action: 'HOLD', comment: 'Waiting for references' }).success, 'putting an application on hold needs a reason');
const reqBase = { email: 'new@example.com', fullName: 'New Person', departmentId: '11111111-1111-4111-8111-111111111111', details: { designation: 'HR Recruiter', joiningDate: '2026-11-03', dateOfBirth: '1995-05-05', bloodGroup: 'O+', contactNumber: '+91 98765 43210', emergencyContact: '+91 98765 43211' } };
check(employeeRequestSchema.safeParse({ ...reqBase, role: 'TEAM_MEMBER' }).success, 'an HR Recruiter designation is accepted for a Team Member');
check(!employeeRequestSchema.safeParse({ ...reqBase, role: 'DEPARTMENT_HEAD' }).success, 'an HR designation is refused for a Department Head');

console.log(`=== ${passed} checks passed ===`);
