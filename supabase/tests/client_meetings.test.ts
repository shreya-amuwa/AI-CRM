// Client Meeting (migration 20270122000200): the invitation e-mail the client receives (agenda, company, mode, link or place, host), the rule
// that the client always gets the CRM's own e-mail even when Google sent a calendar invitation, the form's rules (the same schema as the
// server) and the Scheduled / Rescheduled / Completed / Cancelled labels.
import { renderMeetingEmail, type MailMeeting } from '../../server/meetings/mail.js';
import { mailDecision, type ClaimedMail } from '../../server/meetings/worker.js';
import { clientMeetingSchema } from '../../shared/validation.js';
import { clientStatus } from '../../src/components/meetings/ClientMeetings.js';

let passed = 0;
const check = (ok: boolean, name: string, extra?: unknown) => {
  if (!ok) { console.error('not ok -', name, extra ?? ''); process.exitCode = 1; throw new Error(`failed: ${name}`); }
  passed++;
  console.log('ok -', name);
};

const base: MailMeeting = {
  id: '11111111-1111-4111-8111-111111111111', reference: 'MTG-000101', title: 'AI CRM walkthrough', description: 'Demo of the CRM\nPricing questions',
  hostName: 'Priya Shah', hostEmail: 'priya@amuwa.com', startsAt: '2026-11-25T05:30:00Z', endsAt: '2026-11-25T06:30:00Z', timezone: 'Asia/Kolkata',
  mode: 'ONLINE_LINK', location: null, meetLink: 'https://meet.example.com/abc', status: 'SCHEDULED', decisionNote: null, cancelReason: null,
  proposedStartsAt: null, proposedEndsAt: null, bookedVia: 'STAFF', version: 1, kind: 'CLIENT_MEETING', clientCompany: 'Shah <Traders>'
};

// the invitation
const inv = renderMeetingEmail('CONFIRMED', base, 'Meera Shah', null);
check(/^Meeting invitation: AI CRM walkthrough — /.test(inv.subject), 'the client gets a meeting invitation', inv.subject);
check(inv.html.includes('Dear Meera Shah') && inv.html.includes('Wednesday') && /11:00/.test(inv.html), 'addressed to the client, with the date and time in the meeting\'s zone');
check(inv.html.includes('Demo of the CRM<br>Pricing questions') && inv.html.includes('Agenda'), 'the agenda, line breaks kept');
check(inv.html.includes('Shah &lt;Traders&gt;') && !inv.html.includes('<Traders>'), 'the company, escaped');
check(inv.html.includes('Meeting link') && inv.html.includes('https://meet.example.com/abc') && inv.html.includes('>Online<'), 'online: the mode and the link');
check(inv.html.includes('Priya Shah') && inv.html.includes('mailto:priya@amuwa.com'), 'the host\'s name and e-mail');
check(inv.text.includes('https://meet.example.com/abc') && inv.text.includes('Pricing questions'), 'the plain-text part has it too');
const offline = renderMeetingEmail('CONFIRMED', { ...base, mode: 'IN_PERSON', meetLink: null, location: '4th floor, Baner Road, Pune' }, 'Meera Shah', null);
check(offline.html.includes('In person (offline)') && offline.html.includes('Location') && offline.html.includes('4th floor, Baner Road, Pune') && !offline.html.includes('meet.example'),
  'offline: the mode and the place, no link');
const moved = renderMeetingEmail('RESCHEDULED', base, 'Meera Shah', null);
check(/^New time: /.test(moved.subject) && moved.html.includes('Agenda') && moved.html.includes('https://meet.example.com/abc'), 'rescheduled: the new time with the same details');
const gone = renderMeetingEmail('CANCELLED', { ...base, cancelReason: 'Client postponed' }, 'Meera Shah', null);
check(/^Cancelled: /.test(gone.subject) && gone.html.includes('Client postponed'), 'cancelled: with the reason');
const colleague = renderMeetingEmail('CONFIRMED', base, 'Ravi', null, 'Priya Shah');
check(/^Confirmed: /.test(colleague.subject), 'a colleague taking part gets the usual confirmation, not the client invitation');
const other = renderMeetingEmail('CONFIRMED', { ...base, kind: 'MEETING', clientCompany: null }, 'Asha', null);
check(/^Confirmed: /.test(other.subject) && !other.html.includes('Agenda'), 'other meetings are unchanged');

// the client always gets the CRM's e-mail
const mail = (over: Partial<ClaimedMail>, kind = 'CLIENT_MEETING'): ClaimedMail => ({
  id: 1, toEmail: 'meera@shah.example', toName: 'Meera Shah', kind: 'CONFIRMED', meetingVersion: 1, toProfileId: null,
  organizerEmail: 'priya@amuwa.com', organizerName: 'Priya Shah',
  meeting: { ...base, kind, googleSyncStatus: 'SYNCED', updatedAt: new Date().toISOString(), createdAt: new Date().toISOString() } as never, ...over
});
check(mailDecision(mail({})) === 'SEND', 'a client meeting: the client gets the CRM invitation even when Google sent one');
check(mailDecision(mail({ kind: 'RESCHEDULED' })) === 'SEND' && mailDecision(mail({ kind: 'CANCELLED' })) === 'SEND', '... and the new-time and cancellation e-mails');
check(mailDecision(mail({ toEmail: 'ravi@amuwa.com', toProfileId: 'p2' })) === 'SKIP', 'a colleague is still not e-mailed twice');
check(mailDecision(mail({}, 'MEETING')) === 'SKIP', 'other meetings keep the old rule (Google sent it)');

// the form
const ok = {
  clientName: 'Meera Shah', clientEmail: ' Meera@Shah.Example ', companyName: 'Shah Traders', title: 'AI CRM walkthrough', agenda: 'Demo and pricing',
  startsAt: '2026-11-25T05:30:00.000Z', endsAt: '2026-11-25T06:30:00.000Z', mode: 'ONLINE', meetLink: 'https://meet.example.com/abc', clientRequestId: 'abcdefgh-1234'
};
const parsed = clientMeetingSchema.safeParse(ok);
check(parsed.success && parsed.data.clientEmail === 'meera@shah.example', 'a complete form passes; the e-mail is trimmed and lower-cased');
const fails = (over: Record<string, unknown>, field: string) => {
  const r = clientMeetingSchema.safeParse({ ...ok, ...over });
  return !r.success && r.error.issues.some(i => i.path[0] === field);
};
check(fails({ clientEmail: 'nope' }, 'clientEmail') && fails({ clientName: '' }, 'clientName') && fails({ companyName: '' }, 'companyName'), 'client name, e-mail and company are required');
check(fails({ agenda: 'hi' }, 'agenda') && fails({ title: 'x' }, 'title'), 'a title and an agenda are required');
check(fails({ meetLink: null }, 'meetLink') && fails({ meetLink: 'http://x.example' }, 'meetLink'), 'online needs an https link');
check(fails({ mode: 'OFFLINE', meetLink: null }, 'location') && clientMeetingSchema.safeParse({ ...ok, mode: 'OFFLINE', meetLink: null, location: 'Baner Road, Pune' }).success,
  'offline needs the place');
check(fails({ endsAt: '2026-11-25T05:00:00.000Z' }, 'endsAt'), 'it ends after it starts');
check(fails({ clientRequestId: 'x' }, 'clientRequestId') && !clientMeetingSchema.safeParse({ ...ok, extra: 1 }).success, 'the request id is required; unknown fields are refused');

// the statuses
check(clientStatus({ status: 'SCHEDULED', rescheduleCount: 0 }).label === 'Scheduled' && clientStatus({ status: 'SCHEDULED', rescheduleCount: 2 }).label === 'Rescheduled'
  && clientStatus({ status: 'COMPLETED', rescheduleCount: 1 }).label === 'Completed' && clientStatus({ status: 'CANCELLED', rescheduleCount: 0 }).label === 'Cancelled',
  'Scheduled / Rescheduled / Completed / Cancelled');

console.log(`=== CLIENT MEETING TESTS PASSED (${passed}) ===`);
