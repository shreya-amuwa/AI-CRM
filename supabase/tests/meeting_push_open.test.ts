/**
 * A tapped meeting push opens that meeting (20270206000100): public/sw.js posts "open-meeting" to an open CRM window, or opens
 * /?open=meeting&id=...; the app takes the meeting from the address or from the message. Run with a stand-in for the browser window.
 */
import { readFileSync } from 'node:fs';
const events: { type: string; detail: any }[] = [];
const fake = new EventTarget() as any;
fake.location = { search: '' };
(globalThis as any).window = fake;
const meetingEvents = await import('../../src/components/meetings/meetingEvents.js');
fake.addEventListener(meetingEvents.OPEN_MEETING_EVENT, (e: Event) => events.push({ type: e.type, detail: (e as CustomEvent).detail }));

let passed = 0;
function check(ok: unknown, label: string, extra?: unknown) {
  if (!ok) { console.error(`FAILED: ${label}`, extra === undefined ? '' : JSON.stringify(extra)); process.exit(1); }
  passed++; console.log(`ok - ${label}`);
}
const id = '00000000-0000-4000-8000-000000000077';
const sw = readFileSync('public/sw.js', 'utf8');
check(/q\.get\('open'\) === 'meeting'/.test(sw) && /type: 'open-meeting', id: q\.get\('id'\)/.test(sw),
  'sw.js posts open-meeting (with the meeting) to an open CRM window for a meeting url');

check(meetingEvents.meetingRequestedFromUrl(`?open=meeting&id=${id}`) === true && meetingEvents.takePendingMeeting() === id,
  'the CRM opened from a tapped meeting push (/?open=meeting&id=...) opens that meeting');
check(meetingEvents.meetingRequestedFromUrl('?open=notice&id=x') === false && meetingEvents.takePendingMeeting() === null, 'another address is not a meeting');
check(meetingEvents.meetingRequestedFromUrl('?open=meeting&id=not-an-id') === true && meetingEvents.takePendingMeeting() === null,
  'a malformed id still opens Meetings, on no particular meeting');

events.length = 0;
check(meetingEvents.handleMeetingWorkerMessage({ type: 'open-meeting', id }) === true && events.length === 1 && events[0].detail?.id === id,
  'a tapped push while the CRM is open opens that meeting', events);
check(meetingEvents.handleMeetingWorkerMessage({ type: 'open-chat' }) === false, 'other messages are left to their own listeners');
console.log(`=== MEETING PUSH OPEN TESTS PASSED (${passed}) ===`);
