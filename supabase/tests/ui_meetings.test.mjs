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
  canManage: true, canDecide: false, canAnswerProposal: false, myResponse: null, attendees: [], ...o
});
const state = {
  meetings: [meeting({ id: 'aaaaaaaa-0000-4000-8000-000000000001' })],
  approvals: [meeting({ id: 'bbbbbbbb-0000-4000-8000-000000000002', title: 'Budget for Pune', kind: 'CEO_MEETING', kindLabel: 'Meeting with the CEO', status: 'REQUESTED',
    hostId: CEO.id, hostName: CEO.name, createdBy: COL.id, createdByName: COL.name, canDecide: true, canManage: true, startsAt: at(tomorrow, '15:00'), endsAt: at(tomorrow, '15:30') })],
  bookingTypes: [],
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
  if (p === '/meetings/approvals') return ok(res, state.approvals.filter(m => m.status === 'REQUESTED'));
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
  if (p === '/meetings/settings' && req.method === 'GET') return ok(res, { timezone: 'Asia/Kolkata', availability: [], availabilityIsDefault: true, delegates: [], bookingTypes: state.bookingTypes, isCeo: false });
  if (p === '/meetings/settings/booking-links') {
    const l = { ...body, id: 'dddddddd-0000-4000-8000-000000000001', hostId: 'me', createdAt: new Date().toISOString(), kind: body.kind ?? 'APPOINTMENT' };
    state.bookingTypes = [l];
    return ok(res, l);
  }
  const det = /^\/meetings\/([0-9a-f-]{36})(\/(decision))?$/.exec(p);
  if (det && det[3] === 'decision') {
    const m = state.approvals.find(x => x.id === det[1]);
    m.status = body.decision === 'APPROVE' ? 'SCHEDULED' : body.decision === 'DECLINE' ? 'DECLINED' : 'PROPOSED';
    m.canDecide = false;
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

  // 2. a request for the CEO's time
  await page.getByRole('tab', { name: /Requests \(1\)/ }).click();
  await page.getByText('Budget for Pune').waitFor();
  check(await page.getByText(/asked by Ravi Colleague/).isVisible(), 'the CEO sees who asks for their time');
  await page.getByRole('button', { name: 'Approve' }).click();
  await page.getByText(/Approved: Budget for Pune/).waitFor();
  check(lastCall('POST', '/meetings/bbbbbbbb-0000-4000-8000-000000000002/decision').body.decision === 'APPROVE', 'Approve sends the decision');

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
  await ask.getByRole('button', { name: /Send the request/ }).click();
  await page.getByText(/Request sent to Meera CEO/).waitFor();
  const asked = lastCall('POST', '/meetings').body;
  check(asked.hostId === CEO.id && asked.kind === 'CEO_MEETING', 'the request names the CEO as host', asked);

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
