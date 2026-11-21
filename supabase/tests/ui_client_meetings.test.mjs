// Browser test of Client Meeting (migration 20270122000200): the third option next to Ask the CEO and New meeting, its own form with every
// required field checked before sending, online (link) and offline (place), the invitation's delivery shown in the meeting (sent, or failed
// with the reason and Send again), the Client meetings list with its statuses, and cancelling. Real React components, real Chromium; the CRM
// API is answered in the page (supabase/tests/ui/meeting_presence_harness.tsx).
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
if (!chromium) { console.log('SKIPPED - Playwright is not installed, the client meeting browser test did not run'); process.exit(0); }
const work = mkdtempSync(path.join(tmpdir(), 'cm-ui-'));
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
  {
    const page = await open('member');
    const dialogs = [];
    page.on('dialog', d => { dialogs.push(d.message()); d.accept('Client postponed the visit'); });
    // ---- three separate options
    for (const b of ['Ask the CEO for time', 'New meeting', 'Client meeting']) check(await page.isVisible(`button:has-text("${b}")`), `the Meetings page offers "${b}"`);
    await page.click('button:has-text("Client meeting")');
    await page.waitForSelector('[data-testid="client-meeting-form"]');
    check(await page.isVisible('text=The client receives a meeting invitation by e-mail'), 'Client meeting opens its own form');
    for (const l of ['Client name', 'Client e-mail address', 'Company name', 'Meeting title', 'Meeting agenda', 'Meeting date', 'Start time', 'End time', 'Meeting link', 'Assigned employee / meeting host'])
      check(await page.getByLabel(l, { exact: true }).isVisible(), `the form has "${l}"`);

    // ---- every required field is checked before anything is sent
    await page.click('button:has-text("Create and send the invitation")');
    await page.waitForSelector('#cm-clientName-err');
    const errs = await page.$$eval('[id$="-err"]', es => es.map(e => e.textContent));
    check(errs.length >= 6, 'an empty form shows what is missing', errs);
    check(!(await calls(page)).includes('/api/v1/meetings/client'), 'nothing is sent while the form is incomplete');

    const pad = n => String(n).padStart(2, '0');
    const d = new Date(Date.now() + 2 * 86_400_000);
    const day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    await page.getByLabel('Client name', { exact: true }).fill('Meera Shah');
    await page.getByLabel('Client e-mail address', { exact: true }).fill('Meera@Shah.example');
    await page.getByLabel('Company name', { exact: true }).fill('Shah Traders');
    await page.getByLabel('Meeting title', { exact: true }).fill('AI CRM walkthrough');
    await page.getByLabel('Meeting agenda', { exact: true }).fill('Demo of the CRM and pricing');
    await page.getByLabel('Meeting date', { exact: true }).fill(day);
    await page.getByLabel('Start time', { exact: true }).fill('11:00');
    await page.getByLabel('End time', { exact: true }).fill('12:00');
    await page.click('button:has-text("Create and send the invitation")');
    await page.waitForSelector('#cm-meetLink-err');
    check(/meeting link/i.test(await page.innerText('#cm-meetLink-err')), 'online: the meeting link is required');
    await page.getByLabel('Meeting link', { exact: true }).fill('https://meet.example.com/abc');
    await page.click('button:has-text("Create and send the invitation")');
    await page.waitForSelector('text=Client meeting booked for');
    const sent = await page.evaluate(() => window.__calls.find(c => c.method === 'POST' && c.path === '/api/v1/meetings/client')?.body);
    check(sent && sent.clientName === 'Meera Shah' && sent.companyName === 'Shah Traders' && sent.mode === 'ONLINE' && sent.meetLink === 'https://meet.example.com/abc'
      && sent.agenda === 'Demo of the CRM and pricing' && (new Date(sent.endsAt) - new Date(sent.startsAt)) === 3600000 && sent.clientRequestId?.length >= 8 && sent.location === null,
      'the server receives the whole form with a request id (so a resubmission is not a second meeting)', sent);

    // ---- the meeting: details and the invitation's delivery
    await page.waitForSelector('[data-testid="mail-log"]');
    check(await page.isVisible('dd:has-text("Meera Shah · meera@shah.example")') && await page.isVisible('dd:has-text("Shah Traders")'), 'the details show the client and the company');
    check(await page.isVisible('text=Agenda:'), 'and the agenda');
    await page.waitForSelector('[data-testid="mail-row"][data-status="SENT"]');
    check(/Invitation → meera@shah.example/.test(await page.innerText('[data-testid="mail-log"]')), 'the employee sees the invitation was sent to the client');
    await page.click('button[aria-label="Close"]').catch(() => page.keyboard.press('Escape'));
    await page.waitForSelector('[data-testid="client-meeting-row"]');
    check(/Scheduled/.test(await page.innerText('[data-testid="client-meeting-row"]')), 'the Client meetings tab lists it as Scheduled');

    // ---- a failed invitation: shown with the reason, and sent again
    await page.evaluate(() => { window.__mailOutcome = 'FAILED'; });
    await page.click('button:has-text("Client meeting")');
    await page.getByLabel('Client name', { exact: true }).fill('Kiran Rao');
    await page.getByLabel('Client e-mail address', { exact: true }).fill('kiran@rao.example');
    await page.getByLabel('Company name', { exact: true }).fill('Rao Exports');
    await page.getByLabel('Meeting title', { exact: true }).fill('Office visit');
    await page.getByLabel('Meeting agenda', { exact: true }).fill('Onboarding discussion');
    await page.getByLabel('Meeting date', { exact: true }).fill(day);
    await page.getByLabel('Start time', { exact: true }).fill('15:00');
    await page.getByLabel('End time', { exact: true }).fill('16:00');
    await page.click('label:has-text("Offline")');
    check(!(await page.getByLabel('Meeting link', { exact: true }).count()) && await page.getByLabel('Physical meeting location', { exact: true }).isVisible(),
      'offline: the place instead of the link');
    await page.getByLabel('Physical meeting location', { exact: true }).fill('4th floor, Baner Road, Pune');
    await page.click('button:has-text("Create and send the invitation")');
    await page.waitForSelector('[data-testid="mail-row"][data-status="FAILED"]');
    check(/Failed/.test(await page.innerText('[data-testid="mail-log"]')) && /SMTP 550: mailbox unavailable/.test(await page.innerText('[data-testid="mail-log"]')),
      'a failed invitation says so, and why');
    await page.click('button:has-text("Send again")');
    await page.waitForSelector('[data-testid="mail-row"][data-status="SENT"]');
    check((await calls(page)).some(c => /\/api\/v1\/meetings\/mails\/\d+\/retry/.test(c)), 'Send again asks the server to send it again');

    // ---- cancelling: the client is told
    await page.click('button:has-text("Cancel")');
    await page.waitForSelector('text=Client meetings');
    check(dialogs.length === 1, 'cancelling asks for the reason');
    const cancelled = await page.evaluate(() => window.__mails.some(m => m.kind === 'CANCELLED'));
    check(cancelled, 'the cancellation e-mail to the client is queued');
    await page.waitForSelector('[data-testid="client-meeting-row"]:has-text("Cancelled")');
    check(true, 'the list shows it Cancelled');
    await page.close();
  }
  // ---- phone width
  {
    const page = await open('member', { width: 360, height: 740 });
    await page.click('button:has-text("Client meeting")');
    await page.waitForSelector('[data-testid="client-meeting-form"]');
    const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth }));
    check(m.sw <= m.iw, 'phone width: the form fits', m);
    await page.close();
  }
} finally {
  await browser.close();
}
console.log(`=== CLIENT MEETING BROWSER TESTS PASSED (${passed}) ===`);
