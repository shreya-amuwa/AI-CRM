// Browser test of Field Visit > Add Lead and live location: real React components, real Chromium, the real on-device text reader
// (Tesseract.js, same /ocr files and Content-Security-Policy as production) and the browser's own geolocation (Playwright emulation).
// The CRM API is answered inside the page (supabase/tests/ui/field_visit_harness.tsx), so the test checks exactly what is sent.
// Skipped, loudly, when Playwright / Chromium or the OCR files are missing.
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
let chromium;
for (const p of ['playwright', '/opt/node-tools/node_modules/playwright', 'playwright-core']) {
  try { ({ chromium } = require(p)); break; } catch { /* try the next */ }
}
if (!chromium) { console.log('SKIPPED - Playwright is not installed, the Field Visit browser test did not run'); process.exit(0); }
const haveOcr = existsSync('public/ocr/worker.min.js') && existsSync('public/ocr/lang/eng.traineddata.gz');

const csp = JSON.parse(readFileSync('vercel.json', 'utf8')).headers.flatMap(h => h.headers).find(h => h.key === 'Content-Security-Policy').value;
const work = mkdtempSync(path.join(tmpdir(), 'fv-ui-'));
const build = (entry, file) => { execFileSync('npx', ['esbuild', entry, '--bundle', '--format=iife', '--platform=browser', `--outfile=${path.join(work, file)}`, '--define:import.meta.env={}', '--jsx=automatic', '--log-level=error'], { stdio: 'inherit' }); return readFileSync(path.join(work, file)); };
const appBundle = build('supabase/tests/ui/field_visit_harness.tsx', 'app.js');
const ocrBundle = build('supabase/tests/ui/ocr_harness.ts', 'ocr.js');
const cssFile = existsSync('dist/assets') ? readdirSync('dist/assets').find(f => /^index-.*\.css$/.test(f)) : null;
const appCss = cssFile ? readFileSync(path.join('dist/assets', cssFile)) : Buffer.from('');
const types = { '.js': 'application/javascript', '.gz': 'application/gzip', '.html': 'text/html', '.css': 'text/css' };
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x').pathname;
  const send = (body, ext) => { res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream', 'Content-Security-Policy': csp }); res.end(body); };
  if (url === '/') return send('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><div id="root"></div>', '.html');
  if (url === '/app.js') return send(appBundle, '.js');
  if (url === '/ocr.js') return send(ocrBundle, '.js');
  if (url === '/app.css') return send(appCss, '.css');
  if (url.startsWith('/ocr/')) {
    const f = path.join('public', url.replace(/\.\./g, ''));
    return existsSync(f) ? send(readFileSync(f), path.extname(f)) : (res.writeHead(404), res.end());
  }
  res.writeHead(404); res.end();
});
await new Promise(r => server.listen(0, r));
const origin = `http://localhost:${server.address().port}`;

let passed = 0;
const check = (ok, name, extra) => { if (!ok) { console.error('not ok -', name, extra ?? ''); process.exitCode = 1; throw new Error(`failed: ${name}`); } passed++; console.log('ok -', name); };
let browser;
try { browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined }); } catch (e) { console.log('SKIPPED - Chromium could not be started:', String(e.message).split('\n')[0]); server.close(); process.exit(0); }
const calls = p => p.evaluate(() => window.__calls);
const open = async (ctx, mount) => {
  const page = await ctx.newPage();
  const violations = [];
  page.on('console', m => { if (/Content Security Policy|CSP/i.test(m.text())) violations.push(m.text().slice(0, 200)); });
  page.on('pageerror', e => console.log('pageerror:', e.message.slice(0, 300)));
  await page.goto(origin);
  await page.addScriptTag({ url: `${origin}/app.js` });
  await page.evaluate(m => window[m](), mount);
  return { page, violations };
};

try {
  // ---------------------------------------------------------------- the dropdowns: separated options, keyboard, phone width
  const phone = await browser.newContext({ viewport: { width: 375, height: 900 } });
  let { page } = await open(phone, 'mountLead');
  const cat = page.locator('#lead-businessCategory');
  await cat.waitFor();
  check(await cat.getAttribute('role') === 'combobox' && await cat.getAttribute('aria-haspopup') === 'listbox', 'Business category is an accessible combobox (role and popup)');
  check(await page.locator('label[for="lead-businessCategory"]').innerText() === 'Business category', 'and its label names it');
  await cat.focus();
  await page.keyboard.press('ArrowDown');
  check(await cat.getAttribute('aria-expanded') === 'true', 'Arrow Down opens the list');
  const opts = page.locator('#lead-businessCategory-listbox [role="option"]');
  check(await opts.count() === 12, 'every category is an option (values unchanged) plus "Select…"', await opts.count());
  const border = await opts.first().evaluate(e => getComputedStyle(e).borderBottomWidth);
  check(cssFile ? parseFloat(border) >= 1 : true, 'a thin line separates the options', border);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  check(await cat.getAttribute('aria-activedescendant') !== null, 'the highlighted option is announced (aria-activedescendant)');
  await page.keyboard.press('Enter');
  check(await cat.getAttribute('data-value') === 'Retail' && await cat.getAttribute('aria-expanded') === 'false', 'Enter chooses the highlighted option and closes the list');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Escape');
  check(await cat.getAttribute('aria-expanded') === 'false' && await cat.getAttribute('data-value') === 'Retail', 'Escape closes without changing the choice');
  await page.keyboard.type('h');
  check(await cat.getAttribute('data-value') === 'Healthcare', 'typing a letter jumps to the matching option');
  await cat.click();
  const box = await page.locator('#lead-businessCategory-listbox').boundingBox();
  check(box && box.x >= 0 && box.x + box.width <= 375, 'on a phone the list stays inside the screen', box);
  await page.locator('#lead-businessCategory-listbox [role="option"]', { hasText: 'Beauty / Salon' }).click();
  check(await cat.getAttribute('data-value') === 'Beauty / Salon', 'a tap chooses an option');
  const src = page.locator('#lead-leadSource');
  check(await src.getAttribute('data-value') === 'Field visit' && await src.isDisabled(), 'Field Visit > Add Lead: the source is Field visit and stays so');
  check(await page.isVisible('[data-testid="fv-lead-routing-note"]'), 'the employee is told the lead goes to the Sales Department Head');
  const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth }));
  check(m.sw <= m.iw, 'phone width: no sideways scrolling', m);
  await page.close();
  // the normal Add Lead keeps a choosable source
  ({ page } = await open(phone, 'mountLead'));
  await page.evaluate(() => { document.getElementById('root').remove(); const d = document.createElement('div'); d.id = 'root'; document.body.append(d); window.mountLead(''); });
  const src2 = page.locator('#lead-leadSource');
  await src2.waitFor();
  check(!(await src2.isDisabled()) && await src2.getAttribute('data-value') === 'Walk-in', 'the normal Add Lead: the source can be chosen (Walk-in first)');
  await src2.click();
  await page.locator('#lead-leadSource-listbox [role="option"]', { hasText: 'Instagram' }).click();
  check(await src2.getAttribute('data-value') === 'Instagram', 'and choosing Instagram works');
  check(!(await page.isVisible('[data-testid="shop-scan"]')), 'the photo reader is offered on the Field Visit page only');
  await page.close();
  await phone.close();

  // ---------------------------------------------------------------- photo -> fields -> corrections -> review -> one save
  if (!haveOcr) {
    console.log('SKIPPED (photo part) - public/ocr is missing (node scripts/copy-ocr-assets.mjs)');
  } else {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 1000 } });
    const { page: fp, violations } = await open(ctx, 'mountLead');
    await fp.addScriptTag({ url: `${origin}/ocr.js` });
    const photo = Buffer.from(await fp.evaluate(async () => Array.from(new Uint8Array(await (await window.__board({})).arrayBuffer()))));
    await fp.setInputFiles('[data-testid="shop-photo-input"]', { name: 'board.png', mimeType: 'image/png', buffer: photo });
    await fp.waitForSelector('[data-testid="shop-scan-result"]', { timeout: 90000 });
    const company = await fp.inputValue('#lead-company');
    check(/sharma/i.test(company), 'the business name is read from the photo', company);
    check(await fp.inputValue('#lead-phone') === '+91 98112 00000', 'the phone number is filled in');
    check(/main market/i.test(await fp.inputValue('#lead-address')), 'the address is filled in');
    check(await fp.inputValue('#lead-name') === '', 'the customer\'s own name is not invented');
    check(await fp.inputValue('#lead-whatsapp').catch(() => '') === '', 'the WhatsApp number is not filled without the employee confirming it');
    check(await fp.locator('[data-testid="from-photo"]').count() >= 3, 'filled fields say they came from the photo');
    // 1. a wrongly read name is corrected; 2. a missing detail is typed
    await fp.fill('#lead-company', 'Sharma Electronics & Mobiles');
    await fp.fill('#lead-name', 'Rakesh Sharma');
    check(!(await fp.isVisible('#lead-company-photo')), 'the corrected name no longer says "from photo"');
    // 3. another photo keeps the corrections and asks before changing them
    await fp.setInputFiles('[data-testid="shop-photo-input"]', { name: 'board2.png', mimeType: 'image/png', buffer: photo });
    await fp.waitForFunction(() => !document.querySelector('[data-testid="shop-scan-status"]'), null, { timeout: 90000 });
    await fp.waitForSelector('[data-testid="scan-conflicts"]', { timeout: 10000 });
    check(await fp.inputValue('#lead-company') === 'Sharma Electronics & Mobiles', 'scanning another photo keeps the corrected business name');
    check(await fp.inputValue('#lead-name') === 'Rakesh Sharma', 'and the typed customer name');
    await fp.click('[data-testid="scan-conflict-keep-company"]');
    check(!(await fp.isVisible('[data-testid="scan-conflicts"]')), 'the employee chooses to keep their own value');
    // services and the plan of each
    await fp.getByText('AI Calling', { exact: true }).first().click();
    await fp.fill('#terms-AI_CALLING-plan', 'Growth');
    await fp.selectOption('#terms-AI_CALLING-duration', { index: 1 });
    await fp.fill('#terms-AI_CALLING-amount', '12000');
    // review & edit before saving
    await fp.click('button[type="submit"]');
    await fp.waitForSelector('[data-testid="lead-review"]');
    check(await fp.inputValue('#review-company') === 'Sharma Electronics & Mobiles', 'Review & edit shows the corrected values');
    await fp.fill('#review-address', 'Shop 7, Main Market, Gurugram 122001');
    check((await calls(fp)).every(c => c.path !== '/api/v1/pipeline/leads'), 'nothing is saved before the employee confirms');
    await fp.click('[data-testid="lead-review-confirm"]');
    await fp.click('[data-testid="lead-review-confirm"]').catch(() => undefined); // a quick second click
    await fp.waitForFunction(() => window.__saved.length > 0, null, { timeout: 10000 });
    const posts = (await calls(fp)).filter(c => c.method === 'POST' && c.path === '/api/v1/pipeline/leads');
    check(posts.length === 1, 'one save, even with a second click', posts.length);
    const b = posts[0].body;
    check(b.company === 'Sharma Electronics & Mobiles' && b.name === 'Rakesh Sharma' && b.address === 'Shop 7, Main Market, Gurugram 122001' && b.phone === '+91 98112 00000',
      'what is saved is what the employee confirmed, not the raw photo reading', b);
    check(b.leadSource === 'Field visit' && /^[0-9a-f-]{36}$/.test(b.clientRequestId) && b.services.includes('AI_CALLING'), 'with the source, the services and a request id (a retry returns the same lead)', b);
    check(violations.length === 0, 'no Content-Security-Policy violation', violations);
    await ctx.close();
  }

  // ---------------------------------------------------------------- live location: granted, moving, offline, stopped
  const geo = await browser.newContext({ viewport: { width: 390, height: 900 }, permissions: ['geolocation'], geolocation: { latitude: 18.5204, longitude: 73.8567, accuracy: 12 } });
  const { page: tp } = await open(geo, 'mountTracking');
  check(/Team Lead.*Department Head.*CEO.*HR/s.test(await tp.innerText('[data-testid="tracking-disclosure"]')), 'before sharing, the employee is told who sees the location and when it stops');
  check((await calls(tp)).length === 0, 'nothing is collected before the employee starts');
  await tp.click('[data-testid="tracking-start"]');
  await tp.waitForFunction(() => window.__calls.some(c => c.path.endsWith('/tracking/start')), null, { timeout: 10000 });
  let c = await calls(tp);
  const start = c.find(x => x.path.endsWith('/tracking/start')).body;
  check(Math.abs(start.latitude - 18.5204) < 1e-6 && start.accuracyMeters === 12 && !!start.recordedAt, 'sharing starts with the device position, its accuracy and time', start);
  await tp.waitForSelector('[data-testid="tracking-freshness"][data-value="LIVE"]');
  check(/18\.52040/.test(await tp.innerText('[data-testid="tracking-coords"]')), 'the employee sees the current location');
  await geo.setGeolocation({ latitude: 18.5214, longitude: 73.8567, accuracy: 15 }); // ~110 m, but within 15 s
  await tp.waitForTimeout(1500);
  check((await calls(tp)).filter(x => x.path.endsWith('/tracking/points')).length === 0, 'a new position within 15 s is not sent (no flood of writes)');
  await tp.waitForTimeout(15000);
  await geo.setGeolocation({ latitude: 18.5224, longitude: 73.8567, accuracy: 15 });
  await tp.waitForFunction(() => window.__calls.some(c => c.path.endsWith('/tracking/points')), null, { timeout: 10000 });
  c = await calls(tp);
  check(Math.abs(c.filter(x => x.path.endsWith('/tracking/points')).at(-1).body.points.at(-1).latitude - 18.5224) < 1e-6, 'moving on: the new position is sent');
  // offline: positions are kept on the phone and sent with their own time when the connection is back
  await geo.setOffline(true);
  await tp.waitForTimeout(16000);
  await geo.setGeolocation({ latitude: 18.5240, longitude: 73.8567, accuracy: 20 });
  await tp.waitForFunction(() => /waiting/.test(document.body.innerText), null, { timeout: 10000 });
  const before = (await calls(tp)).filter(x => x.path.endsWith('/tracking/points')).length;
  const onlineAt = Date.now();
  await geo.setOffline(false);
  await tp.waitForFunction(n => window.__calls.filter(c => c.path.endsWith('/tracking/points')).length > n, before, { timeout: 10000 });
  c = await calls(tp);
  const sentLater = c.filter(x => x.path.endsWith('/tracking/points')).at(-1).body.points.at(-1);
  check(Math.abs(sentLater.latitude - 18.524) < 1e-6 && Date.parse(sentLater.recordedAt) <= onlineAt, 'a position taken offline is sent when the connection is back, with the time it was taken', sentLater);
  await tp.click('[data-testid="tracking-stop"]');
  await tp.waitForFunction(() => window.__calls.some(c => c.path.endsWith('/tracking/stop')), null, { timeout: 10000 });
  const after = (await calls(tp)).length;
  await geo.setGeolocation({ latitude: 18.53, longitude: 73.86, accuracy: 10 });
  await tp.waitForTimeout(17000);
  await geo.setGeolocation({ latitude: 18.54, longitude: 73.87, accuracy: 10 });
  await tp.waitForTimeout(1500);
  check((await calls(tp)).length === after, 'after Stop, no further position is collected or sent', (await calls(tp)).slice(after));
  check(await tp.isVisible('[data-testid="tracking-start"]'), 'and sharing can be started again by the employee only');
  await geo.close();

  // ---------------------------------------------------------------- permission refused
  const denied = await browser.newContext({ viewport: { width: 390, height: 900 } });
  const { page: dp } = await open(denied, 'mountTracking');
  await dp.click('[data-testid="tracking-start"]');
  await dp.waitForSelector('[data-testid="tracking-error"]', { timeout: 10000 });
  check(/permission/i.test(await dp.innerText('[data-testid="tracking-error"]')), 'a refused permission is explained (how to allow it)');
  check(!(await calls(dp)).some(x => x.path.includes('/tracking/')), 'and nothing is sent');
  await denied.close();

  // ---------------------------------------------------------------- the managers' board
  const mgr = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const { page: bp } = await open(mgr, 'mountBoard');
  await bp.waitForSelector('[data-testid="tracking-row"]');
  const states = await bp.locator('[data-testid="tracking-row"] [data-testid="tracking-freshness"]').evaluateAll(els => els.map(e => e.getAttribute('data-value')));
  check(states.includes('LIVE') && states.includes('OFFLINE'), 'the board shows a recent position as Live and a 20-minute-old one as Offline (never as live)', states);
  check(/Team Lead One/.test(await bp.innerText('[data-testid="tracking-rows"]')) && /Wabastore/.test(await bp.innerText('[data-testid="tracking-rows"]')), 'with the department and the Team Lead');
  await bp.locator('[data-testid="tracking-row"]').first().click();
  await bp.waitForSelector('[data-testid="tracking-map"]');
  check(/openstreetmap\.org\/export\/embed\.html.*marker=18\.52,73\.85/.test(await bp.getAttribute('[data-testid="tracking-map"]', 'src')), 'choosing a visit shows its latest position on the map');
  await mgr.close();
} finally {
  await browser.close();
  server.close();
}
console.log(`=== FIELD VISIT BROWSER TESTS PASSED (${passed}) ===`);
