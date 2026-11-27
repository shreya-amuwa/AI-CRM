// Browser test of the shared pop-up (Dialog) on phones, tablets and desktop: it fits the visible screen (dvh, with room for the safe areas), the whole report
// scrolls from top to bottom inside the one panel (the dimmed layer and the page behind never scroll), nothing is wider than the screen, the last button is
// reachable and clickable, and the lock on the page is always given back (also with a second pop-up on top). Real Chromium, the real built CSS.
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
if (!chromium) { console.log('SKIPPED - Playwright is not installed, the mobile pop-up browser test did not run'); process.exit(0); }
const cssDir = 'dist/assets';
const css = existsSync(cssDir) ? readdirSync(cssDir).filter(f => f.endsWith('.css')).map(f => readFileSync(path.join(cssDir, f), 'utf8')).join('\n') : '';
const srcCss = readFileSync('src/index.css', 'utf8');
const built = await build({
  entryPoints: ['supabase/tests/ui/modal_harness.tsx'], bundle: true, format: 'iife', platform: 'browser', write: false, jsx: 'automatic', logLevel: 'error',
  define: { 'import.meta.env': '{}' }, loader: { '.css': 'empty' }
});
const bundle = built.outputFiles[0].text;
const srv = createServer((req, res) => {
  if (req.url === '/app.js') { res.writeHead(200, { 'Content-Type': 'application/javascript' }); return res.end(bundle); }
  if (req.url === '/app.css') { res.writeHead(200, { 'Content-Type': 'text/css' }); return res.end(css); }
  res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><link rel="stylesheet" href="/app.css"><div id="root"></div><script src="/app.js"></script>');
});
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${srv.address().port}`;

let passed = 0;
const check = (cond, name, extra) => { if (!cond) { console.error('not ok -', name, extra ?? ''); process.exitCode = 1; throw new Error(`failed: ${name}`); } passed++; console.log('ok -', name); };
let browser;
try { browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined }); } catch (e) { console.log('SKIPPED - Chromium could not be started:', String(e.message).split('\n')[0]); srv.close(); process.exit(0); }

check(/\.crm-dialog-layer[^{]*\{[^}]*safe-area-inset-bottom/.test(srcCss) && /safe-area-inset-top/.test(srcCss) && /100dvh/.test(srcCss), 'the pop-up CSS asks for dvh and for room around the notch and home bar');
check(/crm-dialog-layer/.test(css), 'the built CSS contains the pop-up rules (run npm run build first if this fails)');

const VIEWPORTS = [
  ['desktop 1280x800', { width: 1280, height: 800 }, false],
  ['tablet 768x1024', { width: 768, height: 1024 }, true],
  ['phone 412x700', { width: 412, height: 700 }, true],
  ['phone 390x844', { width: 390, height: 844 }, true],
  ['small phone 320x568', { width: 320, height: 568 }, true],
  ['phone landscape 740x360', { width: 740, height: 360 }, true]
];
const state = page => page.evaluate(() => {
  const d = document.querySelector('[role="dialog"]:last-of-type') && [...document.querySelectorAll('[role="dialog"]')].at(-1);
  const layer = d?.parentElement; const r = d?.getBoundingClientRect();
  return { vw: innerWidth, vh: innerHeight, scrollY: Math.round(scrollY), bodyOverflow: document.body.style.overflow, docSW: document.documentElement.scrollWidth,
    panel: d && { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right), sh: d.scrollHeight, ch: d.clientHeight, st: Math.round(d.scrollTop), sw: d.scrollWidth, cw: d.clientWidth },
    layer: layer && { sh: layer.scrollHeight, ch: layer.clientHeight, st: layer.scrollTop, h: Math.round(layer.getBoundingClientRect().height), padTop: parseFloat(getComputedStyle(layer).paddingTop), padLeft: parseFloat(getComputedStyle(layer).paddingLeft) } };
});
for (const [label, viewport, mobile] of VIEWPORTS) {
  const ctx = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(base);
  await page.getByTestId('page-filler').waitFor();

  // ---- a short pop-up: centred, locks the page, gives it back
  await page.evaluate(() => window.openDialog('short'));
  await page.getByRole('dialog').waitFor();
  let s = await state(page);
  check(s.bodyOverflow === 'hidden', `${label}: the page behind is locked while a pop-up is open`);
  check(s.panel.top >= 0 && s.panel.bottom <= s.vh && s.panel.left >= 0 && s.panel.right <= s.vw, `${label}: a short pop-up fits the screen`, s.panel);
  check(Math.abs((s.panel.top + s.panel.bottom) / 2 - s.vh / 2) < 3, `${label}: a short pop-up is centred`, s.panel);
  check(s.layer.h === s.vh, `${label}: the layer is exactly the visible screen height (dvh)`, [s.layer.h, s.vh]);
  check(s.layer.padTop >= (mobile && viewport.width < 640 ? 8 : 16) && s.layer.padLeft >= (viewport.width < 640 ? 8 : 16), `${label}: the layer keeps room around the edges`, s.layer);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
  check((await state(page)).bodyOverflow === '', `${label}: the page scroll is given back when the pop-up closes`);

  // ---- a tall report: one scroll area, top to bottom
  await page.evaluate(() => window.scrollTo(0, 400));
  await page.evaluate(() => window.openDialog('tall'));
  await page.getByRole('dialog').waitFor();
  s = await state(page);
  const y0 = s.scrollY;
  check(s.bodyOverflow === 'hidden', `${label}: the report locks the page`);
  check(s.panel.top >= 0 && s.panel.bottom <= s.vh && s.panel.left >= 0 && s.panel.right <= s.vw, `${label}: the report panel fits inside the visible screen`, s.panel);
  check(s.panel.sh > s.panel.ch, `${label}: the report is taller than the screen, so it must scroll`);
  check(s.layer.sh <= s.layer.ch + 1, `${label}: the dimmed layer is not a second scroll area`, s.layer);
  check(s.panel.sw <= s.panel.cw && s.docSW <= s.vw + 1, `${label}: nothing is wider than the screen (no sideways scrolling)`, [s.panel.sw, s.panel.cw, s.docSW, s.vw]);
  if (mobile) {
    const cdp = await ctx.newCDPSession(page);
    const box = await page.getByRole('dialog').boundingBox();
    const x = Math.round(box.x + box.width / 2), y = Math.round(Math.min(box.y + box.height - 30, s.vh - 40));
    for (let k = 0; k < 40 && (await state(page)).panel.st + (await state(page)).panel.ch < (await state(page)).panel.sh - 2; k++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      for (let i = 1; i <= 10; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - (s.vh * 0.5 * i) / 10 }] }); await page.waitForTimeout(12); }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await page.waitForTimeout(250);
    }
  } else {
    await page.getByRole('dialog').hover();
    for (let k = 0; k < 40; k++) await page.mouse.wheel(0, 900);
    await page.waitForTimeout(300);
  }
  s = await state(page);
  check(s.panel.st + s.panel.ch >= s.panel.sh - 2, `${label}: the report scrolls all the way to its bottom`, s.panel);
  check(s.scrollY === y0 && s.layer.st === 0, `${label}: the page behind and the layer did not move while the report scrolled`, [y0, s.scrollY, s.layer.st]);
  const b = await page.getByTestId('bottom-action').boundingBox();
  check(b && b.y >= 0 && b.y + b.height <= s.vh && b.x >= 0 && b.x + b.width <= s.vw, `${label}: the last button is on screen and reachable`, b);
  await page.getByTestId('bottom-action').click();
  check((await page.evaluate(() => window.__clicked)) >= 1, `${label}: and it can be pressed`);

  // ---- a second pop-up over the report
  await page.getByTestId('open-inner').scrollIntoViewIfNeeded();
  await page.getByTestId('open-inner').click();
  await page.getByTestId('inner-body').waitFor();
  s = await state(page);
  check(s.bodyOverflow === 'hidden' && s.panel.top >= 0 && s.panel.bottom <= s.vh && s.panel.right <= s.vw, `${label}: a task pop-up over the report fits the screen and the page stays locked`, s.panel);
  await page.getByRole('button', { name: 'Close task' }).click();
  await page.getByTestId('inner-body').waitFor({ state: 'detached' });
  s = await state(page);
  check(s.bodyOverflow === 'hidden', `${label}: closing the task pop-up leaves the report (and the lock) in place`);
  check(s.panel.sh > 0 && (await page.getByRole('dialog').count()) === 1, `${label}: the report is still open`);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
  s = await state(page);
  check(s.bodyOverflow === '' && s.scrollY === y0, `${label}: closing the report gives the page back, where it was`, [s.bodyOverflow, s.scrollY, y0]);
  check(errors.length === 0, `${label}: no script errors`, errors);
  await ctx.close();
}
console.log(`\nMOBILE POP-UP BROWSER CHECKS PASSED (${passed})`);
await browser.close();
srv.close();
