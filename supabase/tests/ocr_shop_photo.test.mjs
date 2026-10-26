// The real text reader against shop-board images: Tesseract.js in Chromium, served exactly as in production (same /ocr files, the
// production Content-Security-Policy from vercel.json), then the field parser. Skipped, loudly, when Playwright / Chromium are missing
// or the OCR files were not copied (npm run dev / build copies them; or node scripts/copy-ocr-assets.mjs).
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
if (!chromium) { console.log('SKIPPED - Playwright is not installed, the OCR browser test did not run'); process.exit(0); }
if (!existsSync('public/ocr/worker.min.js') || !existsSync('public/ocr/lang/eng.traineddata.gz')) { console.log('SKIPPED - public/ocr is missing (node scripts/copy-ocr-assets.mjs), the OCR browser test did not run'); process.exit(0); }

const csp = JSON.parse(readFileSync('vercel.json', 'utf8')).headers.flatMap(h => h.headers).find(h => h.key === 'Content-Security-Policy').value;
const work = mkdtempSync(path.join(tmpdir(), 'ocr-ui-'));
const out = path.join(work, 'bundle.js');
execFileSync('npx', ['esbuild', 'supabase/tests/ui/ocr_harness.ts', '--bundle', '--format=iife', '--platform=browser', `--outfile=${out}`, '--define:import.meta.env={}', '--log-level=error'], { stdio: 'inherit' });
const bundle = readFileSync(out);
const outForm = path.join(work, 'form.js');
execFileSync('npx', ['esbuild', 'supabase/tests/ui/ocr_form_harness.tsx', '--bundle', '--format=iife', '--platform=browser', `--outfile=${outForm}`, '--define:import.meta.env={}', '--jsx=automatic', '--log-level=error'], { stdio: 'inherit' });
const formBundle = readFileSync(outForm);
const cssFile = existsSync('dist/assets') ? readdirSync('dist/assets').find(f => /^index-.*\.css$/.test(f)) : null;
const appCss = cssFile ? readFileSync(path.join('dist/assets', cssFile)) : Buffer.from('');

const types = { '.js': 'application/javascript', '.gz': 'application/gzip', '.html': 'text/html', '.css': 'text/css' };
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x').pathname;
  const send = (body, ext) => { res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream', 'Content-Security-Policy': csp }); res.end(body); };
  if (url === '/') return send('<!doctype html><meta charset="utf-8"><body>ocr</body>', '.html');
  if (url === '/bundle.js') return send(bundle, '.js');
  if (url === '/form.js') return send(formBundle, '.js');
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

const page = await browser.newPage();
const violations = [];
page.on('console', m => { if (/Content Security Policy|CSP/i.test(m.text())) violations.push(m.text().slice(0, 200)); });
page.on('pageerror', e => console.log('pageerror:', e.message.slice(0, 200)));
await page.goto(origin);
await page.addScriptTag({ url: `${origin}/bundle.js` });

const run = opts => page.evaluate(o => window.scanBoard(o), opts);
const first = await run({});
check(first.stages.includes('preparing') && first.stages.includes('loading') && first.stages.includes('reading'), 'the engine loads from the app itself under the production CSP and reads the photo', first.stages);
check(violations.length === 0, 'no Content-Security-Policy violation (wasm and the worker are allowed)', violations);
const f = first.scan;
console.log('   raw:', JSON.stringify(first.scan.rawText));
console.log('   clean board ->', JSON.stringify({ name: f.shopName, phones: f.phones.map(p => p.value), gst: f.gstin?.value, pin: f.pincode?.value, address: f.address?.value, category: f.category, ms: first.ms }));
check(f.shopName && /sharma/i.test(f.shopName.value) && /electronics/i.test(f.shopName.value), 'clean board: the shop name', f.shopName);
check(f.phones.some(p => p.value === '+91 98112 00000') && f.phones.some(p => p.value === '+91 99100 11111'), 'clean board: both phone numbers', f.phones);
check(f.pincode?.value === '122001', 'clean board: the pincode', f.pincode);
check(f.address && /Main Market/i.test(f.address.value), 'clean board: the address', f.address);
check(f.gstin && f.gstin.value.startsWith('06ABCDE1234F1'), 'clean board: the GSTIN (a character the engine drops is marked for checking)', f.gstin);
check(f.category === 'Mobile & electronics', 'clean board: shop type');
const again = await run({ tilt: 3, dim: 0.35, noise: 40 });
const g = again.scan;
console.log('   tilted, dim, noisy ->', JSON.stringify({ name: g.shopName, phones: g.phones.map(p => p.value), pin: g.pincode?.value, ms: again.ms }));
check(again.ms < 30000, 'a second photo is read with the loaded engine, in reasonable time', again.ms);
check(g.shopName && /sharma|electronics/i.test(g.shopName.value), 'tilted + dim + noisy photo: the shop name is still found', g.shopName);
check(g.phones.length >= 1, 'tilted + dim + noisy photo: at least one phone number is found', g.phones);
// ---- the form: take a photo -> the fields fill in (real input, real engine, production CSP)
const boardPng = async p => Buffer.from(await p.evaluate(async () => {
  const blob = await new Promise(res => { /* reuse the board drawing of the harness */ window.__board({}).then(res); });
  return Array.from(new Uint8Array(await blob.arrayBuffer()));
}));
const fpage = await browser.newPage({ viewport: { width: 390, height: 900 } });
const fviolations = [];
fpage.on('console', m => { if (/Content Security Policy|CSP/i.test(m.text())) fviolations.push(m.text().slice(0, 200)); });
await fpage.goto(origin);
await fpage.addScriptTag({ url: `${origin}/bundle.js` });
const photo = await boardPng(fpage);
await fpage.setContent('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><div id="root"></div>');
await fpage.addScriptTag({ url: `${origin}/form.js` });
await fpage.evaluate(() => window.mount());
check(await fpage.inputValue('[data-testid="name"]') === '', 'the form starts empty');
const upload = () => fpage.setInputFiles('[data-testid="shop-photo-input"]', { name: 'shop.png', mimeType: 'image/png', buffer: photo });
await upload();
await fpage.waitForSelector('[data-testid="shop-scan-status"]', { timeout: 5000 }).catch(() => undefined);
await fpage.waitForSelector('[data-testid="shop-scan-result"]', { timeout: 60000 });
check(/sharma/i.test(await fpage.inputValue('[data-testid="name"]')), 'the shop name is filled in from the photo', await fpage.inputValue('[data-testid="name"]'));
check(await fpage.inputValue('[data-testid="phone"]') === '+91 98112 00000', 'the first phone number is filled in');
check(/122001/.test(await fpage.inputValue('[data-testid="address"]')), 'the address is filled in');
check(await fpage.isVisible('[data-testid="from-photo-name"]') && await fpage.isVisible('[data-testid="from-photo-phone"]'), 'filled fields say they were read from the photo');
check(/99100 11111/.test(await fpage.textContent('[data-testid="shop-scan-result"]')), 'the other phone number is offered');
await fpage.click('button:has-text("+91 99100 11111")');
check(await fpage.inputValue('[data-testid="phone"]') === '+91 99100 11111', 'one tap puts the other number in the form');
await fpage.fill('[data-testid="name"]', 'My Own Name');
check(!(await fpage.isVisible('[data-testid="from-photo-name"]')), 'typing over a value removes its "from the photo" note');
await upload();
await fpage.waitForSelector('[data-testid="shop-scan-result"]', { timeout: 60000 });
await fpage.waitForFunction(() => !document.querySelector('[data-testid="shop-scan-status"]'), null, { timeout: 60000 });
check(await fpage.inputValue('[data-testid="name"]') === 'My Own Name', 'a second photo never overwrites what the person typed');
const m = await fpage.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth }));
check(m.sw <= m.iw, 'phone width: no sideways scrolling', m);
check(fviolations.length === 0, 'no Content-Security-Policy violation in the form either', fviolations);
const bad = await fpage.evaluate(async () => { const input = document.querySelector('[data-testid="shop-photo-input"]'); return !!input; });
await fpage.setInputFiles('[data-testid="shop-photo-input"]', { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
await fpage.waitForSelector('[role="alert"]');
check(/photo/i.test(await fpage.textContent('[role="alert"]')) && bad, 'a file that is not a photo is refused with a message');
await browser.close();
server.close();
console.log(`=== OCR SHOP PHOTO TESTS PASSED (${passed}) ===`);
