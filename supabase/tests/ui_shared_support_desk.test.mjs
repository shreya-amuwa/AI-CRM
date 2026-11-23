// Browser test of the shared Support desk in the "My clients" chat tab (migration 20270129000100): the desk tab and its filters, who is the Relationship Manager and who is
// handling each client, taking over / releasing (and a refused call), replying as yourself, a phone width, and the tab being absent for people without a desk.
// Real React components and the app's stylesheet, real Chromium; the CRM API is answered in the page (supabase/tests/ui/shared_desk_harness.tsx). Skipped, loudly, without Playwright.
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
if (!chromium) { console.log('SKIPPED - Playwright is not installed, the shared Support desk browser test did not run'); process.exit(0); }
const work = mkdtempSync(path.join(tmpdir(), 'shd-ui-'));
const out = path.join(work, 'app.js');
await build({
  entryPoints: ['supabase/tests/ui/shared_desk_harness.tsx'], bundle: true, format: 'iife', platform: 'browser', outfile: out, define: { 'import.meta.env': '{}' },
  jsx: 'automatic', logLevel: 'error', loader: { '.css': 'empty' },
  plugins: [{ name: 'stubs', setup(b) {
    b.onResolve({ filter: /\/context\/AuthContext$/ }, () => ({ path: path.resolve('supabase/tests/ui/chat_extras_auth_stub.ts') }));
    b.onResolve({ filter: /services\/supabaseClient$/ }, () => ({ path: path.resolve('supabase/tests/ui/meeting_presence_supabase_stub.ts') }));
  } }]
});
const bundle = readFileSync(out, 'utf8');
const cssFile = existsSync('dist/assets') ? readdirSync('dist/assets').find(f => /^index-.*\.css$/.test(f)) : null;
const appCss = cssFile ? readFileSync(path.join('dist/assets', cssFile), 'utf8') : '';
const chatCss = readFileSync('src/components/chat/chat.css', 'utf8');

let passed = 0;
const check = (ok, name, extra) => { if (!ok) { console.error('not ok -', name, extra === undefined ? '' : JSON.stringify(extra)); process.exitCode = 1; throw new Error(`failed: ${name}`); } passed++; console.log('ok -', name); };
let browser;
try { browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined }); } catch (e) { console.log('SKIPPED - Chromium could not be started:', String(e.message).split('\n')[0]); process.exit(0); }
const open = async (opts = {}, viewport = { width: 1280, height: 900 }) => {
  const page = await browser.newPage({ viewport });
  page.on('pageerror', e => { console.error('page error:', e.message); process.exitCode = 1; });
  await page.route('http://shd.test/**', route => route.fulfill({ status: 200, contentType: 'text/html',
    body: '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>' + appCss + chatCss + '</style></head><body><div id="root"></div></body></html>' }));
  await page.goto('http://shd.test/');
  await page.addScriptTag({ content: bundle });
  await page.evaluate(o => window.mount(o), opts);
  return page;
};
const calls = (page, method, re) => page.evaluate(([m, src]) => window.__calls.filter(c => c.method === m && new RegExp(src).test(c.path)), [method, re.source]);
const rows = page => page.$$eval('[data-testid="desk-list"] .ch-item', els => els.map(e => e.innerText.replace(/\s+/g, ' ').trim()));

try {
  // ---- the desk tab and what a row says
  {
    const page = await open();
    await page.waitForSelector('[data-testid="desk-tab"]');
    check(/Support desk \(3\)/.test(await page.innerText('[data-testid="desk-tab"]')), 'the Support desk tab shows how many customers it holds');
    check(await page.isVisible('text=Mine Traders') && !(await page.isVisible('text=Beta Foods')), 'the first view is "My customers": only the client this person is the Relationship Manager of');
    await page.click('[data-testid="desk-tab"]');
    await page.waitForSelector('[data-testid="desk-list"]');
    const r = await rows(page);
    check(r.length === 3, 'the desk lists all three customers of the department', r);
    const beta = r.find(x => x.includes('Beta Foods'));
    check(/RM: Priya Shah/.test(beta) && /Awaiting reply/.test(beta), 'a row names the Relationship Manager and shows the client is waiting', beta);
    check(/Handling: Rahul Verma/.test(r.find(x => x.includes('Gamma Textiles'))), 'a row shows who is handling it', r);
    check(/RM: Asha Rao/.test(r.find(x => x.includes('Mine Traders'))), 'the person\'s own client is on the desk too');
    check((await page.$$eval('[data-testid="desk-list"] .ch-count', els => els.map(e => e.textContent))).join() === '2', 'the unread count is shown on the client that has unread messages');
    check(!(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)), 'no sideways scrolling');
    await page.close();
  }
  // ---- filters and search
  {
    const page = await open();
    await page.click('[data-testid="desk-tab"]');
    await page.waitForSelector('[data-testid="desk-list"]');
    const pick = async (label, expect, name) => {
      await page.getByRole('button', { name: label, exact: true }).click();
      const r = await rows(page);
      check(r.length === expect.length && expect.every(e => r.some(x => x.includes(e))), name, r);
    };
    await pick('Unread', ['Beta Foods'], 'Unread: only the client with unread messages');
    await pick('Awaiting reply', ['Beta Foods'], 'Awaiting reply: only the client who wrote last');
    await pick('Being handled', ['Gamma Textiles'], 'Being handled: only the client somebody is handling now');
    await pick('Mine', ['Mine Traders'], 'Mine: only the clients this person is the Relationship Manager or Team Lead of');
    await pick('All', ['Mine Traders', 'Beta Foods', 'Gamma Textiles'], 'All: every customer again');
    await page.fill('input[aria-label="Search the Support desk"]', 'gamma');
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="desk-list"] .ch-item').length === 1);
    check((await calls(page, 'GET', /desk-clients$/)).some(c => /q=gamma/.test(c.query)), 'the search goes to the server (the database decides what may be found)');
    await page.close();
  }
  // ---- covering for a colleague: who is handling, take over, reply as yourself, release
  {
    const page = await open();
    await page.click('[data-testid="desk-tab"]');
    await page.getByText('Beta Foods').first().click();
    await page.waitForSelector('[data-testid="handling-bar"]');
    const bar = await page.innerText('[data-testid="handling-bar"]');
    check(/Nobody is handling this chat right now/.test(bar) && /Relationship Manager: Priya Shah/.test(bar), 'the bar shows nobody is handling it and who the Relationship Manager is', bar);
    check(/Priya Shah stays the Relationship Manager/.test(bar) && /your own name/.test(bar), 'and says that covering never changes the Relationship Manager, and that replies carry your own name');
    await page.getByRole('button', { name: 'I am handling this' }).click();
    await page.waitForFunction(() => /Currently handling: you/.test(document.querySelector('[data-testid="handling-bar"]').innerText));
    const t = (await calls(page, 'POST', /\/handling$/)).pop();
    check(t?.body?.action === 'TAKE', 'taking it sends TAKE to the server', t);
    const box = page.getByLabel('Message', { exact: true });
    await box.click();
    await box.fill('Hi, I am covering for Priya. Your invoice is ready.');
    await page.keyboard.press('Enter');
    await page.locator('[data-testid="chat-message"]').filter({ hasText: 'Your invoice is ready' }).waitFor();
    const sent = (await calls(page, 'POST', /\/messages$/)).pop();
    check(sent?.body?.body === 'Hi, I am covering for Priya. Your invoice is ready.', 'the reply is sent through the same chat as before', sent?.body);
    check(!/clientId|senderId|profileId|handler/i.test(JSON.stringify(sent?.body)), 'the browser sends no identity or handler: the server uses the signed-in person');
    await page.getByRole('button', { name: 'Release' }).click();
    await page.waitForFunction(() => /Nobody is handling this chat right now/.test(document.querySelector('[data-testid="handling-bar"]').innerText));
    check((await calls(page, 'POST', /\/handling$/)).pop()?.body?.action === 'RELEASE', 'releasing sends RELEASE');
    await page.close();
  }
  // ---- somebody else is handling: take over
  {
    const page = await open();
    await page.click('[data-testid="desk-tab"]');
    await page.getByText('Gamma Textiles').first().click();
    await page.waitForSelector('[data-testid="handling-bar"]');
    check(/Currently handling: Rahul Verma/.test(await page.innerText('[data-testid="handling-bar"]')), 'the bar shows the colleague who is handling it');
    await page.getByRole('button', { name: 'Take over' }).click();
    await page.waitForFunction(() => /Currently handling: you/.test(document.querySelector('[data-testid="handling-bar"]').innerText));
    check(true, 'a colleague can take it over (information only, nobody is locked out)');
    await page.close();
  }
  // ---- own client: no "covering" note
  {
    const page = await open();
    await page.getByText('Mine Traders').first().click();
    await page.waitForSelector('[data-testid="handling-bar"]');
    check(!/You are covering this client/.test(await page.innerText('[data-testid="handling-bar"]')), 'for the person\'s own client there is no covering note');
    await page.close();
  }
  // ---- a refused handling call shows the server's message
  {
    const page = await open({ refuseHandling: true });
    await page.click('[data-testid="desk-tab"]');
    await page.getByText('Beta Foods').first().click();
    await page.waitForSelector('[data-testid="handling-bar"]');
    await page.getByRole('button', { name: 'I am handling this' }).click();
    await page.waitForSelector('[data-testid="handling-bar"] [role="alert"]');
    check(/cannot handle this conversation/.test(await page.innerText('[data-testid="handling-bar"] [role="alert"]')), 'a refused call (HTTP 403) shows the message and nothing changes');
    check(/Nobody is handling/.test(await page.innerText('[data-testid="handling-bar"]')), 'the bar is unchanged');
    await page.close();
  }
  // ---- no desk: no tabs, the usual list
  {
    const page = await open({ noDesk: true });
    await page.waitForSelector('text=Mine Traders');
    check(!(await page.isVisible('[data-testid="desk-tab"]')), 'someone without a desk sees no Support desk tab');
    await page.close();
  }
  // ---- phone width
  {
    const page = await open({}, { width: 360, height: 740 });
    await page.click('[data-testid="desk-tab"]');
    await page.waitForSelector('[data-testid="desk-list"]');
    const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth }));
    check(m.sw <= m.iw + 1, 'phone width: no sideways scrolling on the desk list', m);
    await page.close();
  }
} finally {
  await browser.close();
}
console.log(`=== SHARED SUPPORT DESK BROWSER TESTS PASSED (${passed}) ===`);
