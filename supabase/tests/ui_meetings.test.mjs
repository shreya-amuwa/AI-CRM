// Browser test of Meetings (20270101000500): the calendar, a CEO's approval, a new meeting with a colleague (their busy time shown) and a guest,
// asking the CEO for time, the Google connect button and the return from Google, a booking link, the public booking page (a guest picks a slot
// and books it) and the guest's private link (accepting a proposed time), at desktop and phone width. The API is a fake in this test's server.
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
let chromium;
for (const p of ['playwright', '/opt/node-tools/node_modules/playwright', 'playwright-core']) {
  try { ({ chromium } = require(p)); break; } catch { /* next */ }
}
if (!chromium) { console.log('SKIPPED - Playwright is not installed, the meetings browser test did not run'); process.exit(0); }
const cssDir = 'dist/assets';
const css = existsSync(cssDir) ? readdirSync(cssDir).filter(f => f.endsWith('.css')).map(f => readFileSync(path.join(cssDir, f), 'utf8')).join('\n') : '';
const stub = path.resolve('supabase/tests/ui/meetings_stubs.ts');
const built = await build({
  entryPoints: ['supabase/tests/ui/meetings_harness.tsx'], bundle: true, format: 'iife', platform: 'browser', write: false, jsx: 'automatic', logLevel: 'error',
  define: { 'import.meta.env': '{}' }, loader: { '.css': 'empty' },
  plugins: [{ name: 'stub-supabase', setup(b) { b.onResolve({ filter: /services\/supabaseClient$/ }, () => ({ path: stub })); } }]
});
const bundle = built.outputFiles[0].text;

// ---- the fake API -----------------------------------------------------------------------------------------------------------------------
const istDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const at = (date, hm) => new Date(`${date}T${hm}:00+05:30`).toISOString();
const tomorrow = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() + 86_400_000));
const CEO = { id: '11111111-1111-4111-8111-111111111111', name: 'Meera CEO', email: 'ceo@amuwa.com', role: 'SUPER_ADMIN', position: 'CEO', department: null, isCeo: true, googleConnected: true };
const COL = { id: '22222222-2222-4222-8222-222222222222', name: 'Ravi Colleague', email: 'ravi@amuwa.com', role: 'TEAM_MEMBER', position: null, department: 'Wabastore', isCeo: false, googleConnected: false };
const meeting = (o) => ({
  id: o.id, reference: 'MTG-0000' + o.id.slice(0, 2), kind: 'MEETING', kindLabel: 'Meeting', title: 'Weekly sync', description: null, hostId: 'me', hostName: 'Asha Me',
  hostEmail: 'asha@amuwa.com', createdBy: 'me', createdByName: 'Asha Me', startsAt: at(istDate, '12:00'), endsAt: at(istDate, '12:30'), timezone: 'Asia/Kolkata',
  mode: 'GOOGLE_MEET', location: null, meetLink: 'https://meet.google.com/abc-defg-hij', status: 'SCHEDULED', requiresApproval: false, decidedBy: null, decidedByName: null,
  decidedAt: null, decisionNote: null, proposedStartsAt: null, proposedEndsAt: null, cancelReason: null, bookedVia: 'STAFF', sourceType: null, sourceId: null, customerId: null,
  googleSyncStatus: 'SYNCED', googleSyncError: null, googleEventId: 'e1', version: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  canManage: true, canDecide: false, canAnswerProposal: false, canWithdraw: false, canRequestChange: false, myResponse: null, requestMessage: null, createdByDepartment: null,
  createdByDesignation: null, rejectionReason: null, previousStartsAt: null, previousEndsAt: null, rescheduledAt: null, rescheduledBy: null, rescheduledByName: null,
  rescheduleReason: null, rescheduleCount: 0, attendees: [], ...o
});
const state = {
  meetings: [meeting({ id: 'aaaaaaaa-0000-4000-8000-000000000001' })],
  approvals: [meeting({ id: 'bbbbbbbb-0000-4000-8000-000000000002', title: 'Budget for Pune', kind: 'CEO_MEETING', kindLabel: 'Meeting with the CEO', status: 'REQUESTED',
    hostId: CEO.id, hostName: CEO.name, createdBy: COL.id, createdByName: COL.name, canDecide: true, canManage: true, startsAt: at(tomorrow, '15:00'), endsAt: at(tomorrow, '15:30') })],
  bookingTypes: [],
  viewerIsCeo: false,
  calls: []
};
const slots = [at(tomorrow, '10:00'), at(tomorrow, '10:30'), at(tomorrow, '11:00')];
const ok = (res, data, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ success: true, data })); };

function api(req, res, body) {
  const u = new URL(req.url, 'http://x');
  const p = u.pathname.replace(/^\/api\/v1/, '');
  state.calls.push({ method: req.method, path: p, body, auth: req.headers.authorization || null });
  if (p === '/meetings/google' && req.method === 'GET') return ok(res, { configured: true, connected: false, status: 'NOT_CONNECTED', googleEmail: null, connectedAt: null, lastError: null });
  if (p === '/meetings/google/connect') return ok(res, { url: '/fake-google-signin' });
  if (p === '/meetings/approvals') return ok(res, state.viewerIsCeo ? state.approvals.filter(m => m.status === 'REQUESTED') : []);
  if (p === '/meetings/ceo-requests') {
    const sec = u.searchParams.get('section') || 'ALL';
    const all = state.approvals;
    const inSec = m => sec === 'ALL' || (sec === 'PENDING' && ['REQUESTED', 'PROPOSED'].includes(m.status)) || (sec === 'APPROVED' && m.status === 'SCHEDULED' && !m.rescheduleCount)
      || (sec === 'REJECTED' && m.status === 'DECLINED') || (sec === 'RESCHEDULED' && m.status === 'SCHEDULED' && m.rescheduleCount > 0);
    const count = f => all.filter(f).length;
    return ok(res, { section: sec, isSuperAdmin: state.viewerIsCeo, limit: 50, offset: 0, items: all.filter(inSec),
      counts: { pending: count(m => ['REQUESTED', 'PROPOSED'].includes(m.status)), approved: count(m => m.status === 'SCHEDULED' && !m.rescheduleCount), rejected: count(m => m.status === 'DECLINED'),
        rescheduled: count(m => m.status === 'SCHEDULED' && m.rescheduleCount > 0), all: all.length } });
  }
  if (p === '/meetings' && req.method === 'GET') return ok(res, state.meetings);
  if (p === '/meetings/directory') return ok(res, [CEO, COL]);
  if (p === '/meetings/busy') return ok(res, [{ profileId: COL.id, start: at(tomorrow, '11:00'), end: at(tomorrow, '12:00'), source: 'GOOGLE' }]);
  if (p === '/meetings' && req.method === 'POST') {
    const ceo = body.hostId === CEO.id;
    const m = meeting({ id: 'cccccccc-0000-4000-8000-00000000000' + state.meetings.length, title: body.title, startsAt: body.startsAt, endsAt: body.endsAt,
      status: ceo ? 'REQUESTED' : 'SCHEDULED', hostName: ceo ? CEO.name : 'Asha Me', kind: body.kind, kindLabel: ceo ? 'Meeting with the CEO' : ({ DEMO: 'Demo', APPOINTMENT: 'Appointment', INTERVIEW: 'Interview' }[body.kind] ?? 'Meeting'), googleSyncStatus: ceo ? 'NOT_CONNECTED' : 'NOT_CONNECTED' });
    state.meetings.push(m);
    return ok(res, m, 201);
  }
  if (p === '/meetings/settings' && req.method === 'GET') return ok(res, { timezone: 'Asia/Kolkata', availability: [], availabilityIsDefault: true, delegates: [], bookingTypes: state.bookingTypes, isCeo: state.viewerIsCeo });
  if (p === '/meetings/settings/booking-links') {
    const l = { ...body, id: 'dddddddd-0000-4000-8000-000000000001', hostId: 'me', createdAt: new Date().toISOString(), kind: body.kind ?? 'APPOINTMENT' };
    state.bookingTypes = [l];
    return ok(res, l);
  }
  const det = /^\/meetings\/([0-9a-f-]{36})(\/(decision))?$/.exec(p);
  if (det && det[3] === 'decision') {
    const m = state.approvals.find(x => x.id === det[1]);
    m.status = body.decision === 'APPROVE' ? 'SCHEDULED' : body.decision === 'DECLINE' ? 'DECLINED' : 'PROPOSED';
    if (body.decision === 'DECLINE') m.rejectionReason = body.note;
    m.canDecide = false;
    return ok(res, m);
  }
  const mv = /^\/meetings\/([0-9a-f-]{36})\/reschedule$/.exec(p);
  if (mv) {
    const m = state.approvals.find(x => x.id === mv[1]);
    Object.assign(m, { previousStartsAt: m.startsAt, previousEndsAt: m.endsAt, startsAt: body.startsAt, endsAt: body.endsAt, status: 'SCHEDULED', canDecide: false, rescheduleCount: 1, rescheduleReason: body.note });
    return ok(res, m);
  }
  if (det) return ok(res, { ...([...state.meetings, ...state.approvals].find(x => x.id === det[1])), history: [{ kind: 'SCHEDULED', note: null, actorName: 'Asha Me', at: new Date().toISOString(), data: {} }] });
  // public booking
  if (p === '/public/booking/ravi-demo' && req.method === 'GET') {
    return ok(res, { slug: 'ravi-demo', title: 'Product demo', description: 'See the WhatsApp API in action.', kind: 'DEMO', durationMinutes: 30, mode: 'GOOGLE_MEET', location: null,
      hostName: 'Ravi Colleague', hostPosition: 'Sales', requiresApproval: false, timezone: 'Asia/Kolkata', slots });
  }
  if (p === '/public/booking/ravi-demo' && req.method === 'POST') {
    if (req.headers.authorization) { res.writeHead(400); return res.end('{}'); }
    return ok(res, { reference: 'MTG-000099', status: 'SCHEDULED', startsAt: body.startsAt, endsAt: new Date(Date.parse(body.startsAt) + 1_800_000).toISOString(), timezone: 'Asia/Kolkata', manageUrl: 'http://x/book/manage/tok.sig' }, 201);
  }
  if (p === '/public/booking/manage/tok.sig' && req.method === 'GET') {
    return ok(res, { id: 'm1', reference: 'MTG-000099', title: 'Product demo — Asha', startsAt: slots[0], endsAt: slots[1], timezone: 'Asia/Kolkata', mode: 'GOOGLE_MEET', location: null,
      meetLink: null, status: 'PROPOSED', proposedStartsAt: slots[1], proposedEndsAt: slots[2], decisionNote: 'Later is better', hostName: 'Ravi Colleague', slug: 'ravi-demo' });
  }
  if (p === '/public/booking/manage/tok.sig/proposal') {
    return ok(res, { id: 'm1', reference: 'MTG-000099', title: 'Product demo — Asha', startsAt: slots[1], endsAt: slots[2], timezone: 'Asia/Kolkata', mode: 'GOOGLE_MEET', location: null,
      meetLink: null, status: 'SCHEDULED', proposedStartsAt: null, proposedEndsAt: null, decisionNote: null, hostName: 'Ravi Colleague', slug: 'ravi-demo' });
  }
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ success: false, error: { code: 'NOT_FOUND', message: `No fake for ${req.method} ${p}` } }));
}

const srv = createServer((req, res) => {
  if (req.url.startsWith('/api/v1/')) {
    let raw = '';
    req.on('data', c => (raw += c));
    req.on('end', () => api(req, res, raw ? JSON.parse(raw) : undefined));
    return;
  }
  if (req.url === '/app.js') { res.writeHead(200, { 'Content-Type': 'application/javascript' }); return res.end(bundle); }
  if (req.url === '/app.css') { res.writeHead(200, { 'Content-Type': 'text/css' }); return res.end(css); }
  res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><div id="root"></div><script src="/app.js"></script>');
});
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${srv.address().port}`;

let passed = 0;
const check = (cond, name, extra) => { if (!cond) { console.error('not ok -', name, extra ?? ''); process.exitCode = 1; throw new Error(`failed: ${name}`); } passed++; console.log('ok -', name); };
const lastCall = (method, p) => [...state.calls].reverse().find(c => c.method === method && c.path === p);
let browser;
try { browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined }); } catch (e) { console.log('SKIPPED - Chromium could not be started:', String(e.message).split('\n')[0]); srv.close(); process.exit(0); }
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'Asia/Kolkata' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('dialog', d => d.accept(''));

  // 1. the calendar
  await page.goto(base);
  await page.evaluate(() => window.mount());
  await page.getByRole('heading', { name: 'Meetings' }).waitFor();
  await page.getByText('Weekly sync').waitFor();
  check(await page.getByText(/Your Google Calendar is not connected yet/).isVisible(), 'an employee who has not connected Google is asked to');
  check(await page.getByRole('button', { name: /Weekly sync/ }).isVisible() && await page.getByText('Scheduled').first().isVisible(), 'this week\'s meeting is in the calendar with its status');
  check(lastCall('GET', '/meetings').auth === 'Bearer test-token', 'the calendar is read with the signed-in session');
  await page.getByRole('button', { name: /Weekly sync/ }).click();
  await page.getByRole('dialog', { name: 'Weekly sync' }).waitFor();
  check(await page.getByRole('link', { name: /Join the meeting/ }).getAttribute('href') === 'https://meet.google.com/abc-defg-hij', 'the details show the Google Meet link');
  check(await page.getByRole('button', { name: /Reschedule/ }).isVisible() && await page.getByRole('button', { name: /Cancel/ }).first().isVisible(), 'the host can reschedule or cancel');
  await page.keyboard.press('Escape');

  // 2. a request for the CEO's time: an employee sees no management buttons, the Super Admin (CEO) decides
  state.approvals[0].canDecide = false; state.approvals[0].canManage = false; state.approvals[0].canWithdraw = true;
  await page.getByRole('tab', { name: 'My CEO requests' }).click();
  await page.getByText('Budget for Pune').waitFor();
  check(await page.getByRole('button', { name: 'Approve' }).count() === 0 && await page.getByRole('button', { name: 'Reject' }).count() === 0
        && await page.getByRole('button', { name: /Reschedule/ }).count() === 0, 'an employee sees no Approve, Reject or Reschedule button');
  check(await page.getByRole('heading', { name: 'My Meeting Requests' }).isVisible(), 'they see "My Meeting Requests"');
  state.approvals[0].canDecide = true; state.approvals[0].canManage = true; state.approvals[0].canWithdraw = false;
  state.viewerIsCeo = true;
  await page.goto(base);
  await page.evaluate(() => window.mount());
  await page.getByRole('tab', { name: /Requests \(1\)/ }).click();
  await page.getByRole('heading', { name: 'Meeting requests from employees' }).waitFor();
  check(await page.getByRole('tab', { name: /Pending Requests \(1\)/ }).isVisible() && await page.getByRole('tab', { name: /Approved Meetings/ }).isVisible()
        && await page.getByRole('tab', { name: /Rejected Meetings/ }).isVisible() && await page.getByRole('tab', { name: /Rescheduled Meetings/ }).isVisible()
        && await page.getByRole('tab', { name: /Meeting History/ }).isVisible(), 'the Super Admin has Pending, Approved, Rejected, Rescheduled and History sections');
  await page.getByText('Budget for Pune').waitFor();
  check(await page.getByText('Ravi Colleague').first().isVisible(), 'the CEO sees who asks for their time');
  check(await page.getByRole('button', { name: 'Approve' }).isVisible() && await page.getByRole('button', { name: 'Reject' }).isVisible()
        && await page.getByRole('button', { name: /Reschedule/ }).isVisible(), 'only the Super Admin has Approve, Reject and Reschedule');
  // reject: a reason is required
  await page.getByRole('button', { name: 'Reject' }).click();
  await page.getByRole('dialog', { name: 'Budget for Pune' }).waitFor();
  const rejectBtn = page.getByRole('button', { name: 'Reject the request' });
  await rejectBtn.waitFor();
  check(await rejectBtn.isDisabled(), 'a rejection cannot be sent without a reason');
  await page.getByLabel('Reason for rejecting').fill('Please ask your Department Head first');
  await rejectBtn.click();
  await page.getByText(/Request rejected/).waitFor();
  check(lastCall('POST', '/meetings/bbbbbbbb-0000-4000-8000-000000000002/decision').body.decision === 'DECLINE'
        && lastCall('POST', '/meetings/bbbbbbbb-0000-4000-8000-000000000002/decision').body.note === 'Please ask your Department Head first', 'Reject sends the reason');
  await page.getByRole('tab', { name: /Rejected Meetings \(1\)/ }).click();
  await page.getByText(/Rejected: Please ask your Department Head first/).waitFor();
  check(true, 'the rejected request is in the Rejected section with its reason');
  // approve and reschedule on a second request
  state.approvals.push(meeting({ id: 'eeeeeeee-0000-4000-8000-000000000005', title: 'Hiring plan', kind: 'CEO_MEETING', kindLabel: 'Meeting with the CEO', status: 'REQUESTED',
    hostId: CEO.id, hostName: CEO.name, createdBy: COL.id, createdByName: COL.name, createdByDepartment: 'Wabastore', createdByDesignation: 'Team Member', description: 'Plan for Q1',
    canDecide: true, canManage: true, startsAt: at(tomorrow, '17:00'), endsAt: at(tomorrow, '17:30') }));
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('crm:meetings-changed')));
  await page.getByRole('tab', { name: /Pending Requests \(1\)/ }).click();
  await page.getByText('Hiring plan').waitFor();
  check(await page.getByText(/Wabastore · Team Member/).isVisible() && await page.getByText(/Plan for Q1/).isVisible(), 'each request shows the employee, department, designation and agenda');
  await page.getByRole('button', { name: /Reschedule/ }).click();
  await page.getByRole('dialog', { name: 'Hiring plan' }).waitFor();
  const saveBtn = page.getByRole('dialog').getByRole('button', { name: 'Save' });
  check(await saveBtn.isDisabled(), 'a reschedule cannot be saved without a reason');
  await page.getByLabel('Reason for rescheduling').fill('The board meets that afternoon');
  await saveBtn.click();
  await page.getByText(/Meeting rescheduled/).waitFor();
  check(lastCall('POST', '/meetings/eeeeeeee-0000-4000-8000-000000000005/reschedule').body.note === 'The board meets that afternoon', 'Reschedule sends the reason');
  await page.getByRole('tab', { name: /Rescheduled Meetings \(1\)/ }).click();
  await page.getByText(/The board meets that afternoon/).waitFor();
  check(true, 'the moved meeting is in the Rescheduled section with the reason');
  state.approvals.push(meeting({ id: 'ffffffff-0000-4000-8000-000000000006', title: 'Quarterly review', kind: 'CEO_MEETING', kindLabel: 'Meeting with the CEO', status: 'REQUESTED',
    hostId: CEO.id, hostName: CEO.name, createdBy: COL.id, createdByName: COL.name, canDecide: true, canManage: true, startsAt: at(tomorrow, '18:00'), endsAt: at(tomorrow, '18:30') }));
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('crm:meetings-changed')));
  await page.getByRole('tab', { name: /Pending Requests \(1\)/ }).click();
  await page.getByText('Quarterly review').waitFor();
  await page.getByRole('button', { name: 'Approve' }).click();
  await page.getByText(/Approved: Quarterly review/).waitFor();
  check(lastCall('POST', '/meetings/ffffffff-0000-4000-8000-000000000006/decision').body.decision === 'APPROVE', 'Approve sends the decision');
  state.viewerIsCeo = false;
  // the employee reads the reason of a rejection
  await page.goto(base);
  await page.evaluate(() => window.mount());
  await page.getByRole('tab', { name: 'My CEO requests' }).click();
  await page.getByRole('tab', { name: /Rejected \(1\)/ }).click();
  await page.getByText(/Rejected: Please ask your Department Head first/).waitFor();
  check(await page.getByRole('button', { name: 'Approve' }).count() === 0, 'the employee reads the rejection reason and has no decision buttons');

  // 3. a new meeting with a colleague (busy at 11:00) and a guest
  await page.getByRole('tab', { name: 'Calendar' }).click();
  await page.getByRole('button', { name: /New meeting/ }).click();
  const dlg = page.getByRole('dialog', { name: 'New meeting' });
  await dlg.getByLabel('Title').fill('Demo for Sharma Traders');
  await dlg.getByLabel('Type').selectOption('DEMO');
  await dlg.getByLabel('Date').fill(tomorrow);
  await dlg.getByLabel('Start').fill('11:30');
  await dlg.getByLabel('Colleagues').fill('Ravi');
  await dlg.getByRole('button', { name: /Ravi Colleague/ }).click();
  await dlg.getByText('Someone is busy at this time').waitFor();
  check(await dlg.getByText(/Ravi Colleague: 11:00/).isVisible(), 'the colleague\'s busy time (from their calendar) shows before booking');
  await dlg.getByRole('button', { name: /Add guest/ }).click();
  await dlg.getByLabel('Guest 1 name').fill('Mr Sharma');
  await dlg.getByLabel('Guest 1 e-mail').fill('sharma@example.com');
  await dlg.getByRole('button', { name: /Book the meeting/ }).click();
  await page.getByText(/Demo booked for/).waitFor();
  const made = lastCall('POST', '/meetings').body;
  check(made.kind === 'DEMO' && made.attendeeIds[0] === COL.id && made.guests[0].email === 'sharma@example.com' && made.startsAt === at(tomorrow, '11:30') && made.endsAt === at(tomorrow, '12:00'),
    'the meeting is sent with the colleague, the guest and the exact time', made);
  check(await page.getByText(/Connect Google Calendar to add it there/).isVisible(), 'the employee is told Google needs connecting');

  // 4. asking the CEO for time
  await page.getByRole('button', { name: /Ask the CEO for time/ }).click();
  const ask = page.getByRole('dialog', { name: 'Ask the CEO for time' });
  check(await ask.getByLabel('With').inputValue() === CEO.id, 'the CEO is chosen');
  await ask.getByLabel('Subject').fill('Hiring plan for Q1');
  check(await ask.getByLabel('Agenda or purpose').getAttribute('required') !== null, 'the agenda is required');
  await ask.getByLabel('Agenda or purpose').fill('Agree the hiring numbers for Q1');
  await ask.getByLabel('Additional message').fill('Any slot this week works');
  await ask.getByRole('button', { name: /Send the request/ }).click();
  await page.getByText(/Request sent to Meera CEO/).waitFor();
  const asked = lastCall('POST', '/meetings').body;
  check(asked.hostId === CEO.id && asked.kind === 'CEO_MEETING' && asked.description === 'Agree the hiring numbers for Q1' && asked.message === 'Any slot this week works', 'the request names the CEO as host, with the agenda and the message', asked);

  // 5. a booking link
  await page.getByRole('tab', { name: /Google, hours/ }).click();
  await page.getByRole('button', { name: /New link/ }).click();
  await page.getByLabel('Link name').fill('Ravi Demo!');
  check(await page.getByLabel('Link name').inputValue() === 'ravi-demo-', 'the link name is kept to lowercase letters, digits and dashes');
  await page.getByLabel('Link name').fill('ravi-demo');
  await page.getByLabel('Title').fill('Product demo');
  await page.getByRole('button', { name: 'Save link' }).click();
  await page.getByText(/Booking link saved/).waitFor();
  check(lastCall('POST', '/meetings/settings/booking-links').body.slug === 'ravi-demo', 'the link is saved');
  check(await page.getByText(`${base}/book/ravi-demo`).first().isVisible(), 'its public address is shown');
  check(await page.getByText(/Monday–Saturday 10:00–18:00 is used/).isVisible(), 'the default working hours are explained');
  // 6. connecting Google leaves for Google's sign-in
  await page.getByRole('button', { name: /Connect Google Calendar/ }).click();
  await page.waitForURL(/fake-google-signin/);
  check(true, 'Connect Google Calendar opens Google\'s sign-in');
  check(!errors.length, 'no script errors on the Meetings page', errors);

  // 7. back from Google
  await page.goto(`${base}/?tab=meetings&google=connected`);
  await page.evaluate(() => window.mount());
  await page.getByText(/Google Calendar connected\. Your meetings now appear/).waitFor();
  check(!page.url().includes('google='), 'the outcome is shown once and the address is cleaned');
  check(await page.getByRole('button', { name: /Ask the CEO for time/ }).isVisible(), 'an employee can ask the CEO for time');

  // 7b. the CEO's own view: no "Ask the CEO for time" (they book on their own calendar with "New meeting")
  state.viewerIsCeo = true;
  await page.goto(base);
  await page.evaluate(() => window.mount());
  await page.getByText(/requests for your time/).waitFor();
  check(await page.getByRole('button', { name: /Ask the CEO for time/ }).count() === 0, 'the CEO is not offered "Ask the CEO for time"');
  check(await page.getByRole('button', { name: /New meeting/ }).isVisible(), 'the CEO can still book a new meeting');
  state.viewerIsCeo = false;

  // 7c. live: a new request appears without a refresh, and a meeting notification opens the meeting
  state.viewerIsCeo = true;
  state.approvals.length = 0;
  await page.goto(base);
  await page.evaluate(() => window.mount());
  check(await page.getByRole('tab', { name: /^Requests$/ }).isVisible(), 'nothing is waiting for a decision');
  state.approvals.push(meeting({ id: 'cccccccc-0000-4000-8000-000000000003', title: 'Office lease', kind: 'CEO_MEETING', kindLabel: 'Meeting with the CEO', status: 'REQUESTED',
    hostId: CEO.id, hostName: CEO.name, createdBy: COL.id, createdByName: COL.name, canDecide: true, startsAt: at(tomorrow, '16:00'), endsAt: at(tomorrow, '16:30') }));
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('crm:meetings-changed')));
  await page.getByRole('tab', { name: /Requests \(1\)/ }).waitFor({ timeout: 5000 });
  check(true, 'a new request shows on the Requests tab as soon as its notification arrives');
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('crm:open-meeting', { detail: { id: 'cccccccc-0000-4000-8000-000000000003' } })));
  await page.getByRole('dialog', { name: 'Office lease' }).waitFor({ timeout: 5000 });
  check(true, 'clicking the meeting notification opens that meeting');
  await page.keyboard.press('Escape');
  state.viewerIsCeo = false;

  // 8. the public booking page
  const guest = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'Asia/Kolkata' });
  const gp = await guest.newPage();
  gp.on('pageerror', e => errors.push(String(e)));
  await gp.goto(`${base}/book/ravi-demo`);
  await gp.evaluate(() => window.mountPublic());
  await gp.getByRole('heading', { name: 'Product demo' }).waitFor();
  check(await gp.getByText('30 minutes').isVisible() && await gp.getByText(/Google Meet video call/).isVisible(), 'the guest sees the length and how it happens');
  check(await gp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no sideways scrolling on a phone');
  await gp.getByRole('button', { name: /10:30/ }).click();
  await gp.getByLabel('Your name').fill('Asha Guest');
  await gp.getByLabel('E-mail').fill('asha@example.com');
  await gp.getByRole('button', { name: /Confirm booking/ }).click();
  await gp.getByRole('heading', { name: 'You are booked' }).waitFor();
  const booked = lastCall('POST', '/public/booking/ravi-demo');
  check(booked.body.startsAt === slots[1] && booked.body.name === 'Asha Guest' && !booked.auth && !booked.body.website, 'the chosen slot is booked without any login (and the honeypot is empty)', booked);
  check(await gp.getByRole('link', { name: /Change or cancel/ }).isVisible(), 'the guest gets their private link');

  // 9. the guest's private link: a proposed time
  await gp.goto(`${base}/book/manage/tok.sig`);
  await gp.evaluate(() => window.mountPublic());
  await gp.getByText(/proposes/).waitFor();
  check(await gp.getByText('Note: Later is better').isVisible(), 'the host\'s note is shown');
  await gp.getByRole('button', { name: /Accept the new time/ }).click();
  await gp.getByText(/The new time is confirmed/).waitFor();
  check(lastCall('POST', '/public/booking/manage/tok.sig/proposal').body.accept === true, 'accepting the proposed time is sent');
  check(!errors.length, 'no script errors on the public pages', errors);
  await guest.close();
} finally {
  await browser.close();
  srv.close();
}
console.log(`=== ${passed} MEETINGS BROWSER CHECKS PASSED ===`);
