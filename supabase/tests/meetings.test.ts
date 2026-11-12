/**
 * Meetings (no database, no network): free slots and time zones, the signed sign-in state and guest links, the Google event body and the
 * Google calls (with a fake fetch), the calendar file and the guest e-mails, and the input checks. Run: npm run test:unit
 */
import {
  authorizeUrl, decryptToken, deleteEvent, encryptToken, eventBody, exchangeCode, freeBusy, googleConfig, GoogleAuthLostError, insertEvent, patchEvent,
  refreshAccessToken, signState, verifyState, type CalendarMeeting
} from '../../server/meetings/google.js';
import { manageToken, meetingIcs, renderMeetingEmail, verifyManageToken, whenText, type MailMeeting } from '../../server/meetings/mail.js';
import { DEFAULT_WINDOWS, freeSlots, localDate, slotStep, zonedTimeToUtc, zoneOffsetMinutes } from '../../server/meetings/slots.js';
import { meetingAvailabilitySchema, meetingBookingLinkSchema, meetingCreateSchema, meetingDecisionSchema, publicBookingSchema } from '../../shared/validation.js';

let passed = 0;
function check(cond: unknown, label: string, extra?: unknown) {
  if (!cond) { console.error(`FAILED: ${label}`, extra === undefined ? '' : JSON.stringify(extra)); process.exit(1); }
  passed++;
  console.log(`ok - ${label}`);
}
async function throws(p: () => Promise<unknown>): Promise<Error | null> {
  try { await p(); return null; } catch (e) { return e as Error; }
}

// ---------------------------------------------------------------------------
// time zones
// ---------------------------------------------------------------------------
check(zoneOffsetMinutes(new Date('2026-01-15T00:00:00Z'), 'Asia/Kolkata') === 330, 'India is UTC+5:30');
check(zonedTimeToUtc(2026, 11, 18, 10, 0, 'Asia/Kolkata').toISOString() === '2026-11-18T04:30:00.000Z', '10:00 in Kolkata is 04:30 UTC');
check(zonedTimeToUtc(2026, 7, 1, 9, 0, 'Europe/London').toISOString() === '2026-07-01T08:00:00.000Z', 'summer time is respected (London 09:00 BST = 08:00 UTC)');
check(zonedTimeToUtc(2026, 1, 1, 9, 0, 'Europe/London').toISOString() === '2026-01-01T09:00:00.000Z', 'and winter time (London 09:00 GMT = 09:00 UTC)');
check(localDate(new Date('2026-11-17T20:00:00Z'), 'Asia/Kolkata').day === 18, 'a late UTC evening is already the next day in India');
check(slotStep(15) === 15 && slotStep(30) === 30 && slotStep(60) === 30, 'slots start every meeting length, at most every half hour');

// ---------------------------------------------------------------------------
// free slots
// ---------------------------------------------------------------------------
const now = new Date('2026-11-16T03:30:00Z'); // Monday 16 Nov 2026, 09:00 IST
const rules = { timezone: 'Asia/Kolkata', windows: [{ weekday: 1, start: '10:00', end: '12:00' }, { weekday: 2, start: '10:00', end: '11:00' }],
  durationMinutes: 30, bufferMinutes: 0, minNoticeMinutes: 60, maxDaysAhead: 7 };
const s1 = freeSlots(rules, [], now);
check(s1[0] === '2026-11-16T04:30:00.000Z', 'the first slot is Monday 10:00 IST', s1.slice(0, 3));
check(s1.filter(s => s.startsWith('2026-11-16')).length === 4, 'Monday 10-12 gives four 30-minute slots');
check(s1.filter(s => s.startsWith('2026-11-17')).length === 2, 'Tuesday 10-11 gives two');
check(!s1.some(s => new Date(s).getTime() > now.getTime() + 7 * 86_400_000), 'nothing beyond the days ahead');
const s2 = freeSlots({ ...rules, minNoticeMinutes: 120 }, [], now);
check(s2[0] === '2026-11-16T05:30:00.000Z', 'the minimum notice hides the slots too soon (11:00 IST is the first)', s2.slice(0, 2));
const busy = [{ start: '2026-11-16T05:00:00Z', end: '2026-11-16T05:30:00Z' }]; // 10:30-11:00 IST taken
const s3 = freeSlots(rules, busy, now).filter(s => s.startsWith('2026-11-16'));
check(s3.length === 3 && !s3.includes('2026-11-16T05:00:00.000Z'), 'a busy time is not offered', s3);
const s4 = freeSlots({ ...rules, bufferMinutes: 15 }, busy, now).filter(s => s.startsWith('2026-11-16'));
check(s4.length === 1 && s4[0] === '2026-11-16T06:00:00.000Z', 'with a 15-minute buffer the slots next to the busy time go too', s4);
check(freeSlots({ ...rules, durationMinutes: 150 }, [], now).length === 0, 'a meeting longer than the window fits nowhere');
check(freeSlots({ ...rules, windows: [] }, [], now).some(s => s === '2026-11-21T04:30:00.000Z'), 'without own hours: Mon-Sat 10-18 (Saturday offered)');
check(!freeSlots({ ...rules, windows: [] }, [], now).some(s => s.startsWith('2026-11-22')), 'and never Sunday');
check(DEFAULT_WINDOWS.length === 6, 'the default week has six working days');
check(freeSlots({ ...rules, timezone: 'Not/AZone' }, [], now)[0] === '2026-11-16T04:30:00.000Z', 'an unknown zone falls back to India');

// ---------------------------------------------------------------------------
// the signed sign-in state, the token encryption, the guest's private link
// ---------------------------------------------------------------------------
const KEY = 'k'.repeat(40);
const st = signState('11111111-1111-1111-1111-111111111111', KEY, 1_000);
check(verifyState(st, KEY, 2_000) === '11111111-1111-1111-1111-111111111111', 'a fresh state names the employee who started the sign-in');
check(verifyState(st, KEY, 1_000 + 11 * 60_000) === null, 'it expires after 10 minutes');
check(verifyState(st, 'x'.repeat(40), 2_000) === null, 'a state signed with another key is refused');
check(verifyState(st.replace(/^./, c => (c === 'a' ? 'b' : 'a')), KEY, 2_000) === null, 'an altered state is refused');
check(verifyState(null, KEY) === null && verifyState('garbage', KEY) === null, 'a missing or malformed state is refused');
const cfg = googleConfig({ GOOGLE_CLIENT_ID: 'cid', GOOGLE_CLIENT_SECRET: 'sec', GOOGLE_TOKEN_KEY: KEY } as NodeJS.ProcessEnv, 'https://crm.example.com')!;
check(cfg.redirectUri === 'https://crm.example.com/api/v1/integrations/google/callback', 'the callback address defaults to the CRM\'s own');
check(googleConfig({ GOOGLE_CLIENT_ID: 'cid', GOOGLE_CLIENT_SECRET: 'sec', GOOGLE_TOKEN_KEY: 'short' } as NodeJS.ProcessEnv) === null, 'a key shorter than 32 characters leaves Google off');
const url = new URL(authorizeUrl(cfg, '11111111-1111-1111-1111-111111111111', 'a@b.com'));
check(url.searchParams.get('access_type') === 'offline' && url.searchParams.get('prompt') === 'consent', 'the sign-in asks for offline access (a refresh token)');
check(url.searchParams.get('scope')!.includes('calendar.events') && url.searchParams.get('scope')!.includes('calendar.freebusy') && !url.searchParams.get('scope')!.includes('auth/calendar '),
  'only the event and free/busy scopes are asked for (never the whole calendar)');
const enc = encryptToken('1//refresh-token', cfg);
check(!enc.includes('refresh-token') && decryptToken(enc, cfg) === '1//refresh-token', 'the refresh token is stored encrypted and reads back');
check(decryptToken(enc, { ...cfg, tokenKey: 'z'.repeat(40) }) === null, 'and cannot be read with another key');
const id = '22222222-2222-4222-8222-222222222222';
const tok = manageToken(id, KEY);
check(verifyManageToken(tok, KEY) === id, 'a guest\'s private link opens their booking');
check(verifyManageToken(`${id}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`, KEY) === null, 'a guessed link is refused');
check(verifyManageToken(tok.replace(id, '33333333-3333-4333-8333-333333333333'), KEY) === null, 'a link cannot be moved to another booking');

// ---------------------------------------------------------------------------
// the Google event and calls (fake fetch)
// ---------------------------------------------------------------------------
const meeting: CalendarMeeting = {
  id, reference: 'MTG-000042', title: 'Product demo — Asha', description: 'WhatsApp API', kindLabel: 'Demo', startsAt: '2026-11-18T04:30:00Z',
  endsAt: '2026-11-18T05:00:00Z', timezone: 'Asia/Kolkata', mode: 'GOOGLE_MEET', location: null, meetLink: null, hostEmail: 'Host@Amuwa.com', version: 3,
  attendees: [
    { email: 'host@amuwa.com', name: 'Host', role: 'REQUIRED', profileId: 'p1' },
    { email: 'Asha@Example.com', name: 'Asha', role: 'EXTERNAL', profileId: null },
    { email: 'asha@example.com', name: 'Asha again', role: 'EXTERNAL', profileId: null },
    { email: 'col@amuwa.com', name: 'Colleague', role: 'OPTIONAL', profileId: 'p2' }
  ]
};
const body = eventBody(meeting, 'https://crm.example.com', true) as any;
check(body.attendees.length === 2 && !body.attendees.some((a: any) => a.email === 'host@amuwa.com'), 'the host is the organiser, not a guest; guests appear once', body.attendees);
check(body.attendees.find((a: any) => a.email === 'col@amuwa.com').optional === true, 'an optional colleague is optional in Google');
check(body.conferenceData.createRequest.conferenceSolutionKey.type === 'hangoutsMeet' && body.conferenceData.createRequest.requestId === `${id}-3`, 'a Google Meet link is requested once per version');
check(body.start.timeZone === 'Asia/Kolkata' && body.extendedProperties.private.crmMeetingId === id, 'the event keeps the zone and the CRM id');
check(!('conferenceData' in (eventBody({ ...meeting, mode: 'IN_PERSON', location: 'Pune office' }, 'https://crm.example.com', false) as any)), 'an in-person meeting has no Meet link');

type Call = { url: string; init: RequestInit };
function fakeFetch(replies: { status: number; body: unknown }[]) {
  const calls: Call[] = [];
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), init });
    const r = replies.shift() ?? { status: 500, body: {} };
    return new Response(r.status === 204 ? null : JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { f, calls };
}
const idToken = ['x', Buffer.from(JSON.stringify({ email: 'Person@Gmail.com' })).toString('base64url'), 'y'].join('.');
{
  const { f, calls } = fakeFetch([{ status: 200, body: { access_token: 'at', refresh_token: 'rt', id_token: idToken, scope: 'openid email https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.freebusy' } }]);
  const t = await exchangeCode(cfg, 'code123', f);
  check(t.refreshToken === 'rt' && t.email === 'person@gmail.com', 'the sign-in code gives the tokens and the account e-mail');
  check(String(calls[0].init.body).includes('grant_type=authorization_code') && String(calls[0].init.body).includes('code=code123'), 'the code is exchanged at Google\'s token address');
}
{
  const { f } = fakeFetch([{ status: 200, body: { access_token: 'at', id_token: idToken, scope: 'openid email https://www.googleapis.com/auth/calendar.events' } }]);
  check(/offline access/.test((await throws(() => exchangeCode(cfg, 'c', f)))?.message ?? ''), 'no refresh token: the person is told to connect again');
}
{
  const { f } = fakeFetch([{ status: 200, body: { access_token: 'at', refresh_token: 'rt', scope: 'openid email' } }]);
  check(/Calendar access was not granted/.test((await throws(() => exchangeCode(cfg, 'c', f)))?.message ?? ''), 'calendar permission unticked: refused with a clear message');
}
{
  const { f } = fakeFetch([{ status: 400, body: { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' } }]);
  check((await throws(() => refreshAccessToken(cfg, 'rt', f))) instanceof GoogleAuthLostError, 'a revoked access is recognised (the person must reconnect)');
}
{
  const { f, calls } = fakeFetch([{ status: 200, body: { id: 'evt1', hangoutLink: 'https://meet.google.com/aaa-bbbb-ccc' } }]);
  const r = await insertEvent('at', 'primary', body, f);
  check(r.eventId === 'evt1' && r.meetLink === 'https://meet.google.com/aaa-bbbb-ccc', 'creating the event returns its id and Meet link');
  check(calls[0].url.includes('sendUpdates=all') && calls[0].url.includes('conferenceDataVersion=1'), 'Google e-mails the invitation and makes the Meet link');
  check((calls[0].init.headers as Record<string, string>).authorization === 'Bearer at', 'with the person\'s own access token');
}
{
  const { f } = fakeFetch([{ status: 404, body: {} }]);
  check((await patchEvent('at', 'primary', 'gone', body, f)) === null, 'an event deleted by hand in Google is recreated (patch says "gone")');
}
{
  const { f } = fakeFetch([{ status: 410, body: {} }]);
  check((await throws(() => deleteEvent('at', 'primary', 'gone', f))) === null, 'removing an event that is already gone is fine');
}
{
  const { f } = fakeFetch([{ status: 429, body: { error: { message: 'Rate Limit Exceeded' } } }]);
  const e = await throws(() => insertEvent('at', 'primary', body, f)) as any;
  check(e && e.retry === true && /Rate Limit/.test(e.message), 'a rate limit is retried later');
}
{
  const { f } = fakeFetch([{ status: 200, body: { calendars: { primary: { busy: [{ start: '2026-11-18T04:00:00Z', end: '2026-11-18T05:00:00Z' }] } } } }]);
  const b = await freeBusy('at', 'primary', new Date('2026-11-18T00:00:00Z'), new Date('2026-11-19T00:00:00Z'), f);
  check(b.length === 1 && b[0].start === '2026-11-18T04:00:00Z', 'free/busy gives busy times only');
}

// ---------------------------------------------------------------------------
// the guest e-mails and the calendar file
// ---------------------------------------------------------------------------
const mm: MailMeeting = {
  id, reference: 'MTG-000042', title: 'Product demo <b>— Asha</b>', description: 'Line one\nLine, two; three', hostName: 'Ravi Host', hostEmail: 'ravi@amuwa.com',
  startsAt: '2026-11-18T04:30:00Z', endsAt: '2026-11-18T05:00:00Z', timezone: 'Asia/Kolkata', mode: 'GOOGLE_MEET', location: null,
  meetLink: 'https://meet.google.com/aaa-bbbb-ccc', status: 'SCHEDULED', decisionNote: null, cancelReason: null, proposedStartsAt: null, proposedEndsAt: null,
  bookedVia: 'BOOKING_LINK', version: 2
};
check(/Wednesday,? 18 November 2026, 10:00 – 10:30/.test(whenText(mm.startsAt, mm.endsAt, 'Asia/Kolkata')), 'times are written in the meeting\'s own zone', whenText(mm.startsAt, mm.endsAt, 'Asia/Kolkata'));
const conf = renderMeetingEmail('CONFIRMED', mm, 'Asha', 'https://crm.example.com/book/manage/x.y');
check(/^Confirmed: /.test(conf.subject) && conf.html.includes('https://meet.google.com/aaa-bbbb-ccc') && conf.html.includes('/book/manage/x.y'), 'the confirmation has the Meet link and the private link');
check(!conf.html.includes('<b>— Asha</b>') && conf.html.includes('&lt;b&gt;'), 'what people typed is escaped in the e-mail');
const req = renderMeetingEmail('REQUEST_RECEIVED', mm, 'Asha', null);
check(/not confirmed yet/.test(req.html), 'a request is clearly not a confirmation');
const prop = renderMeetingEmail('PROPOSED', { ...mm, proposedStartsAt: '2026-11-19T06:00:00Z', proposedEndsAt: '2026-11-19T06:30:00Z' }, 'Asha', 'https://x/y');
check(/Thursday,? 19 November 2026, 11:30/.test(prop.html), 'a proposed time shows the new time');
check(/cancelled/.test(renderMeetingEmail('CANCELLED', { ...mm, cancelReason: 'Host unwell' }, null, null).html.toLowerCase()), 'the cancellation says so');
const ics = meetingIcs(mm);
check(ics.includes('DTSTART:20261118T043000Z') && ics.includes('UID:' + id) && ics.includes('SEQUENCE:2') && ics.includes('\r\n'), 'the calendar file has the time, a stable id and the version');
check(ics.includes('Line\\, two\\; three') || ics.replace(/\r\n /g, '').includes('Line\\, two\\; three'), 'commas and semicolons are escaped in the calendar file');
check(ics.split('\r\n').every(l => Buffer.byteLength(l, 'utf8') <= 75), 'calendar file lines are folded at 75 octets');
check(meetingIcs(mm, true).includes('METHOD:CANCEL') && meetingIcs(mm, true).includes('STATUS:CANCELLED'), 'a cancellation removes the entry from the guest\'s calendar');

// ---------------------------------------------------------------------------
// input checks
// ---------------------------------------------------------------------------
const ok = (schema: { safeParse: (v: unknown) => { success: boolean } }, v: unknown) => schema.safeParse(v).success;
check(ok(meetingCreateSchema, { title: 'Review', startsAt: '2026-11-18T04:30:00Z', endsAt: '2026-11-18T05:00:00Z' }), 'a simple meeting is accepted');
check(!ok(meetingCreateSchema, { title: 'Review', startsAt: '2026-11-18T05:00:00Z', endsAt: '2026-11-18T04:30:00Z' }), 'one ending before it starts is refused');
check(!ok(meetingCreateSchema, { title: 'Review', startsAt: '2026-11-18', endsAt: '2026-11-18T05:00:00Z' }), 'a start without a time is refused');
check(!ok(meetingCreateSchema, { title: 'Review', startsAt: '2026-11-18T04:30:00Z', endsAt: '2026-11-18T05:00:00Z', mode: 'ONLINE_LINK' }), 'an online link meeting needs its link');
check(!ok(meetingCreateSchema, { title: 'R', startsAt: '2026-11-18T04:30:00Z', endsAt: '2026-11-18T05:00:00Z', guests: [{ email: 'nope' }] }), 'a guest needs a valid e-mail');
check(!ok(meetingCreateSchema, { title: 'Review', startsAt: '2026-11-18T04:30:00Z', endsAt: '2026-11-18T05:00:00Z', hostId: 'x' }), 'a host must be a real id');
check(!ok(meetingDecisionSchema, { decision: 'PROPOSE' }), 'proposing needs a time');
check(ok(meetingDecisionSchema, { decision: 'APPROVE', note: 'ok' }), 'approving does not');
check(!ok(meetingBookingLinkSchema, { slug: 'Has Spaces', title: 'Demo' }), 'a link name with spaces is refused');
check(ok(meetingBookingLinkSchema, { slug: 'ravi-demo', title: 'Demo' }), 'a link name of lowercase letters and dashes is fine');
check(!ok(meetingAvailabilitySchema, { timezone: 'Asia/Kolkata', availability: [{ weekday: 1, start: '18:00', end: '10:00' }] }), 'working hours must end after they start');
check(!ok(meetingAvailabilitySchema, { timezone: 'Asia/Kolkata', availability: [{ weekday: 7, start: '10:00', end: '18:00' }] }), 'weekdays are 0-6');
check(!ok(publicBookingSchema, { startsAt: '2026-11-18T04:30:00Z', name: 'A', email: 'a@b.co' }), 'a guest gives a real name');
check(!ok(publicBookingSchema, { startsAt: '2026-11-18T04:30:00Z', name: 'Asha', email: 'a@b.co', extra: 1 }), 'unknown fields are refused');

console.log(`=== ${passed} MEETINGS CHECKS PASSED ===`);
