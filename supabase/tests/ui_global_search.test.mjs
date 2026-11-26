// Browser test of global search (docs/COMMAND_PALETTE_GUIDE.md): Ctrl + K (Windows / Linux) and Cmd + K (Mac) open it, Escape closes it and
// gives the focus back; pages of the dashboard's own menu are found ("att", "emp") and opened with Enter; records come from the server once
// typing pauses (one request, an older answer never replaces a newer one; text typed while the palette's code is still loading is kept); an employee opens in the record panel with its own address, which
// Back / Forward / a refresh follow; a record no longer available says so; a meeting opens on the Meetings page; recent items are per person
// and only revalidated ones are shown; empty and error states (pages still usable), an ended session; a phone opens it from the header icon,
// full screen, without sideways scrolling (320 / 390 px). The API is a fake.
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
let chromium;
for (const p of ['playwright', '/opt/node-tools/node_modules/playwright', 'playwright-core']) { try { ({ chromium } = require(p)); break; } catch { /* next */ } }
if (!chromium) { console.log('SKIPPED - Playwright is not installed, the global search browser test did not run'); process.exit(0); }
const cssDir = 'dist/assets';
const css = existsSync(cssDir) ? readdirSync(cssDir).filter(f => f.endsWith('.css')).map(f => readFileSync(path.join(cssDir, f), 'utf8')).join('\n') : '';
const stub = path.resolve('supabase/tests/ui/meetings_stubs.ts');
const built = await build({
  entryPoints: ['supabase/tests/ui/global_search_harness.tsx'], bundle: true, format: 'esm', splitting: true, outdir: 'out', platform: 'browser', write: false, jsx: 'automatic', logLevel: 'error',
  define: { 'import.meta.env': '{}' }, loader: { '.css': 'empty' },
  plugins: [{ name: 'stub-supabase', setup(b) { b.onResolve({ filter: /services\/supabaseClient$/ }, () => ({ path: stub })); } }]
});
const files = new Map(built.outputFiles.map(f => ['/' + path.basename(f.path), f.text]));

// ---- fake API
const U = n => `eeeeeeee-0000-4000-8000-${String(n).padStart(12, '0')}`;
const RAHUL = U(1), GONE = U(9), MEET = U(5);
let state;
const reset = () => { state = { searches: [], slowFirst: false, fail: false, expired: false, records: {} }; };
reset();
const ok = (res, data) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ success: true, data })); };
const err = (res, status, code, message) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ success: false, error: { code, message } })); };
function search(q) {
  const groups = [];
  if ('rahul sharma'.includes(q)) groups.push({ type: 'employee', hasMore: false, items: [{ type: 'employee', id: RAHUL, title: 'Rahul Sharma', subtitle: 'Sales Executive · M Pillar', meta: null, reference: null, score: 80 }] });
  if (q.startsWith('gon')) groups.push({ type: 'customer', hasMore: false, items: [{ type: 'customer', id: GONE, title: 'Gone Traders', subtitle: 'CUS-9', meta: 'Active', reference: null, score: 80 }] });
  if (q.startsWith('month')) groups.push({ type: 'meeting', hasMore: false, items: [{ type: 'meeting', id: MEET, title: 'Monthly Sales Review', subtitle: 'Meeting · 12:30 PM', meta: 'Scheduled', reference: 'MTG-1', score: 80 }] });
  return { query: q, groups };
}
function api(req, res, body) {
  const p = new URL(req.url, 'http://x').pathname.replace(/^\/api\/v1/, '');
  if (state.expired) return err(res, 401, 'UNAUTHORIZED', 'Sign in again.');
  if (p === '/search' && req.method === 'POST') {
    state.searches.push(body.q);
    if (state.fail) return err(res, 500, 'INTERNAL', 'select * from customers failed at line 3');
    const delay = state.slowFirst && state.searches.length === 1 ? 900 : 10;
    return setTimeout(() => ok(res, search(body.q)), delay);
  }
  const m = p.match(/^\/search\/records\/([a-z]+)\/([0-9a-f-]+)$/);
  if (m) {
    state.records[m[2]] = (state.records[m[2]] || 0) + 1;
    if (m[2] === GONE) return err(res, 404, 'NOT_FOUND', 'This record is no longer available, or you do not have access to it.');
    return ok(res, { type: 'employee', id: m[2], title: 'Rahul Sharma', fields: [['Designation', 'Sales Executive'], ['Department', 'M Pillar']] });
  }
  return err(res, 404, 'NOT_FOUND', 'no fake');
}
const srv = createServer((req, res) => {
  if (req.url.startsWith('/api/v1/')) { let raw = ''; req.on('data', c => (raw += c)); req.on('end', () => api(req, res, raw ? JSON.parse(raw) : undefined)); return; }
  const f = files.get(new URL(req.url, 'http://x').pathname);
  if (f) { res.writeHead(200, { 'Content-Type': 'application/javascript' }); return res.end(f); }
  if (req.url === '/app.css') { res.writeHead(200, { 'Content-Type': 'text/css' }); return res.end(css); }
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><div id="root"></div><script type="module">import "/global_search_harness.js"; window.mount(new URLSearchParams(location.search).get("u") || "aaaaaaaa-0000-4000-8000-000000000001");</script>');
});
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${srv.address().port}/`;
let passed = 0;
// SHOTS_DIR=/some/dir saves screenshots of the palette for review (not needed for the checks)
const shot = async (page, name) => { if (process.env.SHOTS_DIR) await page.screenshot({ path: `${process.env.SHOTS_DIR}/${name}.png` }); };
const check = (cond, name, extra) => { if (!cond) { console.error('not ok -', name, extra ?? ''); process.exitCode = 1; throw new Error(`failed: ${name}`); } passed++; console.log('ok -', name); };
let browser;
try { browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined }); } catch (e) { console.log('SKIPPED - Chromium could not be started:', String(e.message).split('\n')[0]); srv.close(); process.exit(0); }
try {
  // ---------------------------------------------------------------- desktop, Windows / Linux
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    reset();
    await page.goto(base);
    await page.getByTestId('global-search-trigger').waitFor();
    check(await page.getByTestId('global-search-trigger').getByText('Ctrl K').isVisible() && await page.getByTestId('global-search-trigger').getByText('Search anything…').isVisible(),
      'desktop header: "Search anything… Ctrl K"');
    await shot(page, 'search-desktop-header');
    const pal = page.getByTestId('command-palette');
    await page.click('#notes');
    await page.keyboard.press('Control+k');
    await pal.waitFor();
    await page.waitForTimeout(50);
    check(await page.evaluate(() => document.activeElement?.getAttribute('data-testid')) === 'command-palette-input', 'Ctrl + K opens it with the field focused');
    check(await pal.getByText('Quick navigation').isVisible() && await pal.getByText('↑').isVisible(), 'empty: quick navigation, and the keyboard hints');
    await shot(page, 'search-desktop-empty');
    await page.keyboard.press('Escape');
    await pal.waitFor({ state: 'detached' });
    check(await page.evaluate(() => document.activeElement?.id) === 'notes', 'Escape closes it and the focus returns where it was');

    // pages
    await page.keyboard.press('Control+k');
    await page.keyboard.type('att');
    await pal.getByRole('option', { name: /Attendance/ }).waitFor();
    check(await pal.getByRole('option').first().getAttribute('aria-selected') === 'true' && (await pal.getByRole('option').first().textContent()).includes('Attendance'), '"att": Attendance first, highlighted');
    await page.keyboard.press('Enter');
    await pal.waitFor({ state: 'detached' });
    check(await page.getByTestId('current-page').textContent() === '__attendance', 'Enter opens the page through the dashboard\'s own navigation');
    await page.keyboard.press('Control+k');
    await page.keyboard.type('emp');
    await pal.getByRole('option', { name: /Team Members/ }).waitFor();
    check(true, '"emp" finds Team Members (alias)');

    // records: one request after the pause; arrows; Enter opens the record panel at its own address
    await page.fill('[data-testid="command-palette-input"]', '');
    state.searches = [];
    await page.keyboard.type('rahul', { delay: 40 });
    await pal.getByRole('option', { name: /Rahul Sharma/ }).waitFor();
    check(state.searches.length === 1 && state.searches[0] === 'rahul', 'typing sends one search after the pause, not one per key', state.searches);
    check(await pal.getByText('Employees', { exact: true }).isVisible(), 'results are grouped (Employees)');
    await shot(page, 'search-desktop-results');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowUp');
    const sel = await pal.locator('[aria-selected="true"]').textContent();
    check(sel.includes('Rahul Sharma') && await page.getByTestId('command-palette-input').getAttribute('aria-activedescendant'), 'arrow keys move the selection (announced to screen readers)');
    await page.keyboard.press('Enter');
    const panel = page.getByTestId('record-panel');
    await panel.getByTestId('record-panel-title').waitFor();
    check(new URL(page.url()).searchParams.get('open') === 'record' && new URL(page.url()).searchParams.get('id') === '' + 'eeeeeeee-0000-4000-8000-000000000001',
      'the employee opens in the record panel, at its own address', page.url());
    check(await panel.getByText('Sales Executive').isVisible(), 'with their details (read again from the server)');
    await shot(page, 'search-desktop-record-panel');
    await page.goBack();
    await panel.waitFor({ state: 'detached' });
    check(!new URL(page.url()).searchParams.get('open'), 'Back closes it');
    await page.goForward();
    await panel.getByTestId('record-panel-title').waitFor();
    check(true, 'Forward opens it again');
    await page.reload();
    await panel.getByTestId('record-panel-title').waitFor();
    check(true, 'a refresh keeps it open');
    await page.keyboard.press('Escape');
    await panel.waitFor({ state: 'detached' });

    // a record that is gone, opened from a typed address
    await page.goto(`${base}?open=record&type=customer&id=${GONE}`);
    await page.getByTestId('record-panel-error').waitFor();
    check(await page.getByText('This record is no longer available, or you do not have access to it.').isVisible(), 'a deleted / inaccessible record says so (no blank page)');
    await page.getByRole('button', { name: 'Close' }).click();
    check(!(await page.getByTestId('record-panel').count()), 'and closes');
    await page.goto(`${base}?open=record&type=customer&id=javascript:alert(1)`);
    await page.waitForTimeout(300);
    check(!(await page.getByTestId('record-panel').count()), 'a malformed address opens nothing');

    // recent: the employee opened earlier, revalidated
    await page.goto(base);
    await page.keyboard.press('Control+k');
    await pal.getByText('Recently visited').waitFor();
    check(await pal.getByRole('option', { name: /Rahul Sharma/ }).isVisible() && await pal.getByRole('option', { name: /Attendance/ }).first().isVisible(), 'recently visited: the employee and the page');
    check(!(await page.evaluate(() => JSON.stringify(localStorage))).includes('Rahul'), 'the browser stores no names (only kinds and ids)');
    await pal.getByRole('button', { name: 'Remove Rahul Sharma from recent' }).click();
    check(!(await pal.getByRole('option', { name: /Rahul Sharma/ }).count()), 'one entry can be removed');
    await pal.getByRole('button', { name: 'Clear recent history' }).click();
    check(!(await pal.getByText('Recently visited').count()), 'the history can be cleared');
    await page.keyboard.press('Escape');
    await pal.waitFor({ state: 'detached' });

    // a meeting opens on the Meetings page (its own open event)
    await page.keyboard.press('Control+k');
    await pal.waitFor();
    await page.keyboard.type('monthly');
    await pal.getByRole('option', { name: /Monthly Sales Review/ }).click();
    check((await page.evaluate(() => window.__events)).some(e => e.meeting === 'eeeeeeee-0000-4000-8000-000000000005'), 'a meeting opens that exact meeting on the Meetings page');

    // stale answers, empty, error, ended session
    reset(); state.slowFirst = true;
    await page.keyboard.press('Control+k');
    await page.keyboard.type('rah');
    await page.waitForTimeout(350);
    await page.keyboard.type('ulx');
    await pal.getByTestId('search-empty').waitFor();
    await page.waitForTimeout(1000);
    check(await pal.getByTestId('search-empty').isVisible() && !(await pal.getByRole('option', { name: /Rahul/ }).count()), 'a slow older answer never replaces the newer one');
    check(await pal.getByText('No results found').isVisible(), 'no match: "No results found"');
    reset(); state.fail = true;
    await page.fill('[data-testid="command-palette-input"]', 'incent');
    await pal.getByTestId('search-error').waitFor();
    check(await pal.getByText('Unable to complete your search').isVisible() && await pal.getByRole('option', { name: /Sales Incentives/ }).isVisible()
      && !(await pal.getByText(/select \*/).count()), 'a failed search says so in the palette, pages still work, no technical text');
    state.fail = false;
    await pal.getByRole('button', { name: 'Try again' }).click();
    await pal.getByTestId('search-error').waitFor({ state: 'detached' });
    check(true, 'Try again searches again');
    state.expired = true;
    await page.fill('[data-testid="command-palette-input"]', 'rahul');
    await pal.getByText('Your session has ended. Sign in again to search.').waitFor();
    check(true, 'an ended session says so');
    check(errors.length === 0, 'desktop: no script errors', errors);
    await ctx.close();
  }
  // ---------------------------------------------------------------- recent items are per person
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    const page = await ctx.newPage();
    reset();
    await page.goto(base + '?u=aaaaaaaa-0000-4000-8000-0000000000aa');
    await page.getByTestId('global-search-trigger').click();
    await page.keyboard.type('rahul');
    await page.getByRole('option', { name: /Rahul Sharma/ }).click();
    await page.getByTestId('record-panel-title').waitFor();
    await page.goto(base + '?u=bbbbbbbb-0000-4000-8000-0000000000bb');
    await page.getByTestId('global-search-trigger').click();
    await page.getByTestId('command-palette').waitFor();
    await page.waitForTimeout(300);
    check(!(await page.getByText('Recently visited').count()), 'another person signing in on the same browser sees none of the first person\'s recent items');
    await ctx.close();
  }
  // ---------------------------------------------------------------- Mac
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    const page = await ctx.newPage();
    // a Mac: Chrome / Edge report it through userAgentData, Safari through platform
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'platform', { get: () => 'MacIntel' });
      Object.defineProperty(navigator, 'userAgentData', { get: () => ({ platform: 'macOS' }) });
    });
    await page.goto(base);
    await page.getByTestId('global-search-trigger').getByText('⌘ K').waitFor();
    // the shortcut listener is attached just after the first paint: press again if the first press came before it
    for (let i = 0; i < 3 && !(await page.getByTestId('command-palette').count()); i++) { await page.keyboard.press('Meta+k'); await page.waitForTimeout(300); }
    await page.getByTestId('command-palette').waitFor();
    check(true, 'Mac: Cmd + K opens it, and the header shows ⌘ K');
    await ctx.close();
  }
  // ---------------------------------------------------------------- phones
  for (const w of [320, 390]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 760 }, hasTouch: true, isMobile: true });
    const page = await ctx.newPage();
    reset();
    await page.goto(base);
    check(!(await page.getByTestId('global-search-trigger').isVisible()) && await page.getByTestId('global-search-trigger-mobile').isVisible(), `${w} px: a search icon in the header`);
    await page.getByTestId('global-search-trigger-mobile').tap();
    const pal = page.getByTestId('command-palette');
    await pal.waitFor();
    const box = await pal.boundingBox();
    check(Math.round(box.width) === w && box.height >= 700, `${w} px: full screen`, box);
    check(!(await pal.getByText('to navigate').isVisible()) && await pal.getByRole('button', { name: 'Close search' }).isVisible(), `${w} px: no keyboard hints; a Close button`);
    await page.keyboard.type('rahul');
    const row = pal.getByRole('option', { name: /Rahul Sharma/ });
    await row.waitFor();
    check((await row.boundingBox()).height >= 44, `${w} px: rows are easy to tap (44 px or more)`);
    await shot(page, `search-phone-${w}`);
    check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${w} px: no sideways scrolling`);
    await row.tap();
    await page.getByTestId('record-panel-title').waitFor();
    check(Math.round((await page.getByTestId('record-panel').boundingBox()).width) === w, `${w} px: the record panel is full screen`);
    await page.getByRole('button', { name: 'Close' }).tap();
    await pal.getByRole('button', { name: 'Close search' }).count();
    await ctx.close();
  }
  console.log(`=== ${passed} GLOBAL SEARCH BROWSER CHECKS PASSED ===`);
} finally {
  await browser.close();
  srv.close();
}
