// Browser test of Enter / Exit Meeting (migrations 20270122000100, 20270127000100): an employee enters and exits (the header badge and the
// panel follow), colleagues show BUSY in the New meeting form as soon as Realtime says so, a meeting starting within 30 minutes with a BUSY
// colleague is flagged and refused; asking the CEO while they are BUSY joins the queue; the Super Admin enters and exits, sees the queue, each
// Exit confirms exactly one, the room link is set in Settings, and the Super Admin's week lists the latest day and meeting first.
// Real React components, real Chromium; the CRM API is answered in the page (supabase/tests/ui/meeting_presence_harness.tsx).
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
let chromium;
for (const p of ['playwright', '/opt/node-tools/node_modules/playwright', 'playwright-core']) {
  try { ({ chromium } = require(p)); break; } catch { /* try the next */ }
}
if (!chromium) { console.log('SKIPPED - Playwright is not installed, the meeting availability browser test did not run'); process.exit(0); }
const work = mkdtempSync(path.join(tmpdir(), 'mp-ui-'));
const out = path.join(work, 'app.js');
await build({
  entryPoints: ['supabase/tests/ui/meeting_presence_harness.tsx'], bundle: true, format: 'iife', platform: 'browser', outfile: out, define: { 'import.meta.env': '{}' },
  jsx: 'automatic', logLevel: 'error',
  plugins: [{ name: 'stubs', setup(b) {
    b.onResolve({ filter: /services\/supabaseClient$/ }, () => ({ path: path.resolve('supabase/tests/ui/meeting_presence_supabase_stub.ts') }));
  } }]
});
const bundle = readFileSync(out, 'utf8');
void execFileSync;
const cssFile = existsSync('dist/assets') ? readdirSync('dist/assets').find(f => /^index-.*\.css$/.test(f)) : null;
const css = cssFile ? readFileSync(path.join('dist/assets', cssFile), 'utf8') : '';

let passed = 0;
const check = (ok, name, extra) => { if (!ok) { console.error('not ok -', name, extra === undefined ? '' : JSON.stringify(extra)); process.exitCode = 1; throw new Error(`failed: ${name}`); } passed++; console.log('ok -', name); };
let browser;
try { browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined }); } catch (e) { console.log('SKIPPED - Chromium could not be started:', String(e.message).split('\n')[0]); process.exit(0); }
const open = async (who, viewport = { width: 1280, height: 1000 }) => {
  const page = await browser.newPage({ viewport });
  page.on('pageerror', e => { console.error('page error:', e.message); process.exitCode = 1; });
  await page.route('http://mp.test/**', route => route.fulfill({ status: 200, contentType: 'text/html',
    body: '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>' + css + '</style></head><body><div id="root"></div></body></html>' }));
  await page.goto('http://mp.test/');
  await page.addScriptTag({ content: bundle });
  await page.evaluate(w => window.mount(w), who);
  await page.waitForSelector('h1:has-text("Meetings")');
  return page;
};
const statusIn = (page, scope) => page.$eval(`${scope} [data-testid="availability"]`, e => e.getAttribute('data-status'));
const calls = page => page.evaluate(() => window.__calls.filter(c => c.method !== 'GET').map(c => c.path));

try {
  // ---- an employee: Enter Meeting / Exit Meeting
  {
    const page = await open('member');
    await page.waitForSelector('[data-testid="presence-panel"]');
    check(await statusIn(page, '[data-testid="presence-panel"]') === 'AVAILABLE', 'an employee starts AVAILABLE');
    check(!(await page.isVisible('[data-testid="header"] [data-testid="availability"]')), 'no header badge while AVAILABLE');
    check(await page.isVisible('[data-testid="presence-enter"]') && !(await page.isVisible('[data-testid="presence-exit"]')), 'not in a meeting: only Enter Meeting is offered');
    await page.click('[data-testid="presence-enter"]');
    await page.waitForSelector('[data-testid="presence-exit"]');
    check(await statusIn(page, '[data-testid="presence-panel"]') === 'BUSY', 'Enter Meeting: BUSY');
    check(/In a meeting since/.test(await page.innerText('[data-testid="presence-panel"]')), 'the panel says since when');
    await page.evaluate(() => window.__fireRealtime('meeting_presence'));
    await page.waitForSelector('[data-testid="header"] [data-testid="availability"][data-status="BUSY"]');
    check(/You: BUSY/.test(await page.innerText('[data-testid="header"]')), 'the header badge reminds them they are BUSY');
    check((await calls(page)).includes('/api/v1/meetings/presence/enter'), 'Enter is sent to the server (not kept in the page)');
    await page.click('[data-testid="presence-exit"]');
    await page.waitForSelector('[data-testid="presence-enter"]');
    check(await statusIn(page, '[data-testid="presence-panel"]') === 'AVAILABLE', 'Exit Meeting: AVAILABLE again');
    check(/AVAILABLE again/.test(await page.innerText('body')), 'they are told');
    await page.evaluate(() => window.__fireRealtime('meeting_presence'));
    await page.waitForFunction(() => !document.querySelector('[data-testid="header"] [data-testid="availability"]'));
    check(true, 'the header badge goes away');

    // ---- a colleague enters a meeting elsewhere: BUSY in the New meeting form, without a refresh
    await page.click('button:has-text("New meeting")');
    await page.fill('#mtg-people', 'Ravi');
    await page.waitForSelector('li:has-text("Ravi Colleague")');
    check(!(await page.isVisible('li:has-text("Ravi Colleague") [data-testid="availability"]')), 'the colleague is shown without BUSY while AVAILABLE');
    await page.evaluate(() => { window.__setServerStatus(window.__ids.COL, 'BUSY'); window.__fireRealtime('meeting_presence'); });
    await page.waitForSelector('li:has-text("Ravi Colleague") [data-testid="availability"][data-status="BUSY"]');
    check(true, 'Realtime: the colleague turns BUSY in the list while the form is open');
    await page.click('li:has-text("Ravi Colleague") button');
    await page.waitForSelector('span:has-text("Ravi Colleague") [data-testid="availability"][data-status="BUSY"]');
    check(true, 'the invited colleague carries the BUSY status');
    const soon = new Date(Date.now() + 10 * 60_000);
    const pad = n => String(n).padStart(2, '0');
    await page.fill('#mtg-title', 'Quick sync');
    await page.fill('#mtg-date', `${soon.getFullYear()}-${pad(soon.getMonth() + 1)}-${pad(soon.getDate())}`);
    await page.fill('#mtg-time', `${pad(soon.getHours())}:${pad(soon.getMinutes())}`);
    await page.waitForSelector('[data-testid="busy-soon"]');
    check(/Ravi Colleague is in a meeting right now \(Busy\)/.test(await page.innerText('[data-testid="busy-soon"]')), 'starting within 30 minutes: the form says the colleague is BUSY');
    await page.click('button:has-text("Book the meeting")');
    await page.waitForSelector('text=is in a meeting right now (Busy). Pick a later time');
    check(true, 'the server refuses the conflicting booking and the form shows why');
    await page.evaluate(() => { window.__setServerStatus(window.__ids.COL, 'AVAILABLE'); window.__fireRealtime('meeting_presence'); });
    await page.waitForFunction(() => !document.querySelector('[data-testid="busy-soon"]'));
    check(true, 'the colleague exits: AVAILABLE again and the warning goes away');
    await page.click('button:has-text("Book the meeting")');
    await page.waitForSelector('text=booked for');
    check(true, 'now the meeting can be booked');

    // ---- asking the CEO for time: while the CEO is AVAILABLE, an ordinary request; while BUSY, it joins the queue
    await page.click('button:has-text("Ask the CEO for time")');
    await page.waitForSelector('button:has-text("Send the request")');
    await page.waitForFunction(() => window.__calls.some(c => c.path === '/api/v1/meetings/presence/ceo'));
    await page.waitForTimeout(100); // the Realtime listener is attached right after the first load
    check(!(await page.isVisible('[data-testid="ceo-busy-notice"]')), 'the CEO is AVAILABLE: no queue notice');
    await page.evaluate(() => { window.__setServerStatus(window.__ids.CEO, 'BUSY'); window.__fireRealtime('meeting_presence'); });
    await page.waitForSelector('[data-testid="ceo-busy-notice"]');
    check(/The CEO is in a meeting right now/.test(await page.innerText('[data-testid="ceo-busy-notice"]')), 'Realtime: the CEO enters a meeting, the form says the request joins the queue');
    check(await page.isVisible('button:has-text("Join the queue")'), 'the button says so');
    const later = new Date(Date.now() + 2 * 86400_000);
    await page.fill('#mtg-title', 'Budget approval');
    await page.fill('#mtg-date', `${later.getFullYear()}-${pad(later.getMonth() + 1)}-${pad(later.getDate())}`);
    await page.fill('#mtg-time', '11:00');
    await page.fill('#mtg-desc', 'Approve the Pune office budget');
    await page.click('button:has-text("Join the queue")');
    await page.waitForSelector('text=Your request is in the queue');
    check(await page.evaluate(() => window.__queue.length === 1 && window.__queue[0].title === 'Budget approval'), 'the request is in the CEO\'s queue on the server');
    await page.close();
  }
  // ---- the Super Admin: Enter / Exit, the queue, one confirmed per Exit
  {
    const page = await open('ceo');
    // the server as the member's page left it (its own stand-in): the CEO BUSY with two requests waiting, oldest first
    await page.evaluate(() => {
      window.__setServerStatus(window.__ids.CEO, 'BUSY');
      const q = (id, title, by) => ({ id, title, startsAt: new Date().toISOString(), endsAt: new Date(Date.now() + 1800_000).toISOString(), createdAt: new Date().toISOString(), requestedBy: by });
      window.__queue.push(q('00000000-0000-4000-8000-000000000798', 'Budget approval', 'Team Member A'), q('00000000-0000-4000-8000-000000000799', 'Hiring plan', 'Ravi Colleague'));
    });
    await page.evaluate(() => window.__fireRealtime('meeting_presence'));
    await page.waitForSelector('[data-testid="ceo-queue"]');
    const q = await page.innerText('[data-testid="ceo-queue"]');
    check(/Waiting in your queue \(2\)/.test(q) && q.indexOf('Budget approval') < q.indexOf('Hiring plan'), 'the Super Admin sees the queue, oldest first', q);
    check(await statusIn(page, '[data-testid="presence-panel"]') === 'BUSY' && await page.isVisible('[data-testid="presence-exit"]'), 'the Super Admin is BUSY and can Exit Meeting');
    await page.click('[data-testid="presence-exit"]');
    await page.waitForSelector('text=The next queued meeting is confirmed and starts now');
    const t = await page.innerText('body');
    check(/"Budget approval"/.test(t) && /1 more waiting/.test(t), 'Exit confirms exactly one (the oldest) and says how many still wait');
    check(await page.evaluate(() => window.__queue.length === 1 && window.__queue[0].title === 'Hiring plan'), 'the next one keeps waiting for the next Exit');
    await page.waitForSelector('[data-testid="presence-enter"]');
    await page.click('[data-testid="presence-enter"]');
    await page.waitForSelector('[data-testid="presence-exit"]');
    check(/requests for your time join your queue/i.test(await page.innerText('body')), 'Enter Meeting: requests for their time queue up');
    await page.click('[data-testid="presence-exit"]');
    await page.waitForSelector('text="Hiring plan"');
    check(await page.evaluate(() => window.__queue.length === 0), 'the next Exit confirms the next one');
    await page.waitForSelector('[data-testid="presence-enter"]');
    await page.click('[data-testid="presence-enter"]');
    await page.waitForSelector('[data-testid="presence-exit"]');
    await page.click('[data-testid="presence-exit"]');
    await page.waitForSelector('text=You are AVAILABLE again: colleagues see it at once.');
    check(true, 'an Exit with an empty queue confirms nothing');

    // the meeting-room link used when Google Meet is not available
    await page.click('[role="tab"]:has-text("Google, hours")');
    await page.waitForSelector('#room-link');
    await page.fill('#room-link', 'http://insecure.example');
    check(await page.isDisabled('section:has(#room-link) button:has-text("Save")'), 'an http:// room link cannot be saved');
    await page.fill('#room-link', 'https://meet.example.com/ceo-room');
    await page.click('section:has(#room-link) button:has-text("Save")');
    await page.waitForSelector('text=Meeting room link saved.');
    check((await page.evaluate(() => window.__calls.filter(c => c.path === '/api/v1/meetings/settings/room-link' && c.method === 'POST').map(c => c.body.roomLink)))
      .includes('https://meet.example.com/ceo-room'), 'the room link is saved on the server');
    await page.close();
  }
  // ---- the Super Admin's week: the latest day first, and in each day the latest meeting first
  {
    const page = await open('ceo');
    await page.evaluate(() => {
      const d = new Date(); const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
      const at = (day, h, m = 0) => new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + day, h, m).toISOString();
      const mk = (id, title, s, e) => window.__full({ id, kind: 'MEETING', kindLabel: 'Meeting', title, startsAt: s, endsAt: e, mode: 'IN_PERSON', meetLink: null, location: null,
        hostId: window.__ids.CEO, hostName: 'Asha CEO', attendees: [] });
      window.__week.push(mk('w1', 'Monday early', at(0, 9), at(0, 10)), mk('w2', 'Monday late', at(0, 16), at(0, 17)),
        mk('w3', 'Wednesday', at(2, 11), at(2, 12)), mk('w4', 'Friday early', at(4, 10), at(4, 11)), mk('w5', 'Friday late', at(4, 15, 30), at(4, 16)));
    });
    await page.click('button:has-text("This week")');
    await page.waitForSelector('section[aria-label] span.truncate:has-text("Friday late")');
    const order = await page.evaluate(() => [...document.querySelectorAll('section[aria-label] button span.font-semibold.truncate')].map(e => e.textContent));
    check(JSON.stringify(order) === JSON.stringify(['Friday late', 'Friday early', 'Wednesday', 'Monday late', 'Monday early']),
      'the Super Admin\'s week: latest day first, latest meeting first in each day', order);
    const days = await page.evaluate(() => [...document.querySelectorAll('section[aria-label]')].map(e => e.getAttribute('aria-label')));
    check(/Sun/i.test(days[0]) && /Mon/i.test(days[6]), 'Sunday on top, Monday at the bottom', days);
    await page.close();
  }
  // ---- everyone else keeps Monday first, earliest first
  {
    const page = await open('member');
    await page.evaluate(() => {
      const d = new Date(); const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
      const at = (day, h) => new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + day, h).toISOString();
      const mk = (id, title, s, e) => window.__full({ id, kind: 'MEETING', kindLabel: 'Meeting', title, startsAt: s, endsAt: e, mode: 'IN_PERSON', meetLink: null, location: null,
        hostId: window.__ids.ME, hostName: 'Team Member A', attendees: [] });
      window.__week.push(mk('x1', 'Tuesday late', at(1, 15), at(1, 16)), mk('x2', 'Tuesday early', at(1, 9), at(1, 10)), mk('x3', 'Thursday', at(3, 9), at(3, 10)));
    });
    await page.click('button:has-text("This week")');
    await page.waitForSelector('section[aria-label] span.truncate:has-text("Thursday")');
    const order = await page.evaluate(() => [...document.querySelectorAll('section[aria-label] button span.font-semibold.truncate')].map(e => e.textContent));
    check(JSON.stringify(order) === JSON.stringify(['Tuesday early', 'Tuesday late', 'Thursday']), 'an employee\'s week is unchanged: earliest first', order);
    await page.close();
  }
  // ---- the meeting request to HR now lives on Meetings (it used to be on Raise an Issue); the Super Admin has no such tab
  {
    const page = await open('member');
    await page.click('[role="tab"]:has-text("HR meeting requests")');
    await page.waitForSelector('[data-testid="hr-meeting-requests"] [data-testid="meeting-form"]');
    await page.click('[data-testid="submit-meeting"]');
    await page.waitForSelector('#meeting-subject-error');
    check(!(await page.evaluate(() => window.__calls.some(c => c.method === 'POST' && c.path === '/api/v1/employee/meetings'))), 'an empty HR meeting request is not sent');
    const d = new Date(Date.now() + 3 * 86400_000);
    await page.fill('#meeting-subject', 'Leave balance');
    await page.selectOption('#meeting-category', 'ATTENDANCE_LEAVE');
    await page.selectOption('#meeting-mode', 'IN_PERSON');
    await page.fill('#meeting-date', `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
    await page.fill('#meeting-time', '10:30');
    await page.fill('#meeting-description', 'I would like to understand my leave balance.');
    await page.click('[data-testid="submit-meeting"]');
    await page.waitForSelector('[data-testid="submitted-banner"]');
    check(/MTG-2026-00001/.test(await page.innerText('[data-testid="submitted-banner"]')) && /HR will review/.test(await page.innerText('[data-testid="submitted-banner"]')),
      'Meetings > HR meeting requests: the request to HR is sent, with its reference');
    await page.waitForSelector('[data-testid="my-case-row"]:has-text("Leave balance")');
    check(/Pending/.test(await page.innerText('[data-testid="my-case-row"]')), '... and listed as Pending');
    await page.close();
    const ceo = await open('ceo');
    await ceo.waitForTimeout(300);
    check(!(await ceo.locator('[role="tab"]:has-text("HR meeting requests")').count()), 'the Super Admin has no HR meeting requests tab');
    await ceo.close();
  }
  // ---- phone width
  {
    const page = await open('member', { width: 360, height: 740 });
    await page.waitForSelector('[data-testid="presence-enter"]');
    const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth }));
    check(m.sw <= m.iw, 'phone width: the panel fits and Enter Meeting is reachable', m);
    await page.close();
  }
} finally {
  await browser.close();
}
console.log(`=== EMPLOYEE MEETING AVAILABILITY BROWSER TESTS PASSED (${passed}) ===`);
