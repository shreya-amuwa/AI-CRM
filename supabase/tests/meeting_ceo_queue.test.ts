// The Super Admin's meeting queue (migration 20270128000100): the "scheduled, join now" e-mail a queued request gets when the Super Admin
// exits a meeting (the room link when there is one, never a made-up one), and when the worker sends it: at once with a fixed room, after the
// Google sync has added the Meet link (waiting at most ~15 minutes) with Google Meet.
import { renderMeetingEmail, type MailMeeting } from '../../server/meetings/mail.js';
import { mailDecision, type ClaimedMail } from '../../server/meetings/worker.js';
import { meetingRoomLinkSchema } from '../../shared/validation.js';

let passed = 0;
const check = (ok: boolean, name: string, extra?: unknown) => {
  if (!ok) { console.error('not ok -', name, extra ?? ''); process.exitCode = 1; throw new Error(`failed: ${name}`); }
  passed++;
  console.log('ok -', name);
};

const base: MailMeeting = {
  id: '22222222-2222-4222-8222-222222222222', reference: 'MTG-000202', title: 'Pune budget', description: 'Approve the Pune office budget',
  hostName: 'Asha CEO', hostEmail: 'ceo@amuwa.com', startsAt: '2026-11-21T06:00:00Z', endsAt: '2026-11-21T06:30:00Z', timezone: 'Asia/Kolkata',
  mode: 'ONLINE_LINK', location: null, meetLink: 'https://meet.example.com/ceo-room', status: 'SCHEDULED', decisionNote: null, cancelReason: null,
  proposedStartsAt: null, proposedEndsAt: null, bookedVia: 'STAFF', version: 2, kind: 'CEO_MEETING', clientCompany: null
};

const room = renderMeetingEmail('QUEUE_CONFIRMED', base, 'Ravi', null);
check(/^Your meeting is scheduled now: Pune budget/.test(room.subject), 'the subject says it is scheduled now', room.subject);
check(room.html.includes('Join the meeting room') && room.html.includes('https://meet.example.com/ceo-room'), 'it carries the meeting room link as a button');
check(room.text.includes('https://meet.example.com/ceo-room'), 'and in the plain-text part');
check(/11:30/.test(room.html), 'the time in the meeting\'s zone');
const noLink = renderMeetingEmail('QUEUE_CONFIRMED', { ...base, mode: 'GOOGLE_MEET', meetLink: null }, 'Ravi', null);
check(!noLink.html.includes('Join the meeting room') && /calendar invitation, or from Meetings in the CRM/.test(noLink.html), 'without a link: no made-up one, it says where the link comes from');

const mail = (over: Partial<MailMeeting & { googleSyncStatus: string; updatedAt: string }>): ClaimedMail => ({
  id: 1, toEmail: 'ravi@amuwa.com', toName: 'Ravi', kind: 'QUEUE_CONFIRMED', meetingVersion: 2, toProfileId: 'p1',
  organizerEmail: 'ceo@amuwa.com', organizerName: 'Asha CEO',
  meeting: { ...base, googleSyncStatus: 'NOT_CONNECTED', updatedAt: new Date().toISOString(), createdAt: new Date().toISOString(), ...over } as never
});
check(mailDecision(mail({})) === 'SEND', 'a fixed room: sent at once, even to a colleague (Google sends no "join now")');
check(mailDecision(mail({ mode: 'GOOGLE_MEET', meetLink: null, googleSyncStatus: 'PENDING' })) === 'DEFER', 'Google Meet without its link yet: wait for the sync');
check(mailDecision(mail({ mode: 'GOOGLE_MEET', meetLink: 'https://meet.google.com/abc-defg-hij', googleSyncStatus: 'SYNCED' })) === 'SEND', '... sent once the Meet link is there');
check(mailDecision(mail({ mode: 'GOOGLE_MEET', meetLink: null, googleSyncStatus: 'PENDING', updatedAt: new Date(Date.now() - 20 * 60_000).toISOString() })) === 'SEND',
  '... and never held back more than ~15 minutes');
check(mailDecision(mail({ mode: 'GOOGLE_MEET', meetLink: null, googleSyncStatus: 'FAILED' })) === 'SEND', '... nor when the sync failed');

check(meetingRoomLinkSchema.safeParse({ roomLink: 'https://meet.example.com/x' }).success && meetingRoomLinkSchema.safeParse({ roomLink: null }).success
  && meetingRoomLinkSchema.safeParse({ roomLink: '' }).success, 'the room link: https, or none');
check(!meetingRoomLinkSchema.safeParse({ roomLink: 'http://meet.example.com/x' }).success && !meetingRoomLinkSchema.safeParse({ roomLink: 'javascript:alert(1)' }).success,
  'never http or anything else');

console.log(`=== CEO MEETING QUEUE TESTS PASSED (${passed}) ===`);
