// Browser test of the scrolling fixes: the page-scroll lock behind drawers / dialogs is always given back, and a pop-up taller than
// the screen scrolls instead of being cut off. Real Chromium, the real src/index.css and src/lib/scrollLock.ts.
// Needs Playwright with Chromium (not a project dependency); it is skipped, loudly, when they are not installed.
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
let chromium;
for (const p of ['playwright', '/opt/node-tools/node_modules/playwright', 'playwright-core']) {
  try { ({ chromium } = require(p)); break; } catch { /* try the next */ }
}
if (!chromium) { console.log('SKIPPED - Playwright is not installed, the scrolling browser test did not run'); process.exit(0); }

const work = mkdtempSync(path.join(tmpdir(), 'scroll-ui-'));
const out = path.join(work, 'bundle.js');
execFileSync('npx', ['esbuild', 'supabase/tests/ui/scroll_harness.ts', '--bundle', '--format=iife', '--platform=browser', `--outfile=${out}`, '--log-level=error'], { stdio: 'inherit' });
const bundle = readFileSync(out, 'utf8');
const appCss = readFileSync('src/index.css', 'utf8');
// the few Tailwind utilities the pop-ups are built from
const utilities = '.fixed{position:fixed}.inset-0{inset:0}.flex{display:flex}.items-center{align-items:center}.justify-center{justify-content:center}.p-4{padding:1rem}.z-50{z-index:50}';

let passed = 0;
const check = (ok, name, extra) => { if (!ok) { console.error('not ok -', name, extra ?? ''); process.exitCode = 1; throw new Error(`failed: ${name}`); } passed++; console.log('ok -', name); };

let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
} catch (e) {
  console.log('SKIPPED - Chromium could not be started:', String(e.message).split('\n')[0]);
  process.exit(0);
}

// 1. the lock behind a drawer: several parts of the screen ask for it; the page must be unlocked when the last one lets go
{
  const page = await browser.newPage();
  await page.setContent('<body></body>');
  await page.addScriptTag({ content: bundle });
  const r = await page.evaluate(() => {
    const o = [];
    const v = () => document.body.style.overflow;
    o.push(v());                                   // ''
    const a = window.lockScroll(), b = window.lockScroll(), c = window.lockScroll();
    o.push(v());                                   // hidden
    a(); o.push(v());                              // still hidden (two left)
    c(); o.push(v());                              // still hidden (one left)
    b(); o.push(v());                              // '' again
    const d = window.lockScroll(); d(); d(); o.push(v());   // releasing twice is harmless
    document.body.style.overflow = 'auto';
    const e = window.lockScroll(); e(); o.push(v());        // the page's own value comes back
    return o;
  });
  check(JSON.stringify(r) === JSON.stringify(['', 'hidden', 'hidden', 'hidden', '', '', 'auto']), 'the page scroll lock is always released (nested, repeated and out-of-order)', r);
  await page.close();
}

// 2. a pop-up taller than the screen scrolls (a phone held sideways), a small one stays centred
const popup = (panelHeight) => `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>${utilities}${appCss}</style>
<div class="fixed inset-0 flex items-center justify-center p-4 z-50" id="ov"><div id="panel" style="background:#fff;width:100%;max-width:28rem;height:${panelHeight}px"><button id="last" style="margin-top:${panelHeight - 40}px">Save</button></div></div>`;
for (const [name, vp, h, scrolls] of [
  ['a phone held sideways (360 px high)', { width: 667, height: 360 }, 560, true],
  ['a small phone', { width: 320, height: 560 }, 700, true],
  ['a tall panel on a desktop screen', { width: 1440, height: 900 }, 1100, true],
  ['a small panel on a phone', { width: 390, height: 700 }, 300, false]
]) {
  const page = await browser.newPage({ viewport: vp });
  await page.setContent(popup(h));
  const before = await page.evaluate(() => { const r = document.getElementById('panel').getBoundingClientRect(); return { top: r.top, bottom: r.bottom, vh: innerHeight }; });
  if (scrolls) {
    check(before.top >= 0, `${name}: the top of the pop-up is not cut off`, before);
    await page.mouse.move(vp.width / 2, vp.height / 2);
    await page.mouse.wheel(0, 2000);
    await page.waitForTimeout(150);
    const saveBottom = await page.evaluate(() => document.getElementById('last').getBoundingClientRect().bottom);
    check(saveBottom <= vp.height, `${name}: scrolling brings the bottom button into view`, { saveBottom, vh: vp.height });
  } else {
    const gapTop = before.top, gapBottom = before.vh - before.bottom;
    check(Math.abs(gapTop - gapBottom) <= 1, `${name}: stays centred`, before);
  }
  await page.close();
}


// 3. the page behind ANY pop-up does not scroll (src/lib/overlayScrollLock.ts watches the page, so no pop-up has to ask for the lock)
{
  const longPage = `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0"><div style="height:4000px;background:linear-gradient(#fff,#ccc)">page</div><div id="host"></div></body>`;
  const drawer = `<div id="drawer" class="fixed" style="position:fixed;inset:0;z-index:60"><div style="position:absolute;inset:0;background:rgba(15,23,42,.4)"></div><div style="position:absolute;right:0;top:0;height:100%;width:28rem;background:#fff;overflow-y:auto"><div style="height:2000px">drawer</div></div></div>`;
  const scrollY = (page) => page.evaluate(() => Math.round(window.scrollY));
  const frame = (page) => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  const wheelOver = async (page, x, y) => { await page.mouse.move(x, y); await page.mouse.wheel(0, 600); await page.waitForTimeout(150); };
  const vp = { width: 1280, height: 800 };
  const fresh = async (watch) => {
    const page = await browser.newPage({ viewport: vp });
    await page.setContent(longPage);
    await page.addScriptTag({ content: bundle });
    if (watch) await page.evaluate(() => { window.__stop = window.watchOverlays(); });
    return page;
  };

  // control: without the watcher, a drawer that did not ask for the lock lets the page behind it scroll (the bug)
  { const page = await fresh(false);
    await page.evaluate(h => { document.getElementById('host').innerHTML = h; }, drawer);
    await wheelOver(page, 300, 400);
    check(await scrollY(page) > 0, 'control: without the lock the page behind a drawer scrolls', await scrollY(page));
    await page.close(); }

  // with the watcher: opening a drawer locks the page, closing it gives scrolling back
  { const page = await fresh(true);
    await wheelOver(page, 300, 400);
    const free = await scrollY(page);
    check(free > 0, 'no pop-up open: the page scrolls normally', free);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.evaluate(h => { document.getElementById('host').innerHTML = h; }, drawer);
    await frame(page);
    check(await page.evaluate(() => document.body.style.overflow) === 'hidden', 'a drawer opens: the page is locked');
    await wheelOver(page, 300, 400);
    check(await scrollY(page) === 0, 'wheel over the dimmed page behind the drawer does not scroll it');
    await wheelOver(page, 1100, 400);
    check(await scrollY(page) === 0, 'wheel over the drawer panel does not scroll the page behind it');
    const inner = await page.evaluate(() => document.querySelector('#drawer [style*="overflow-y"]').scrollTop);
    check(inner > 0, 'but the drawer\'s own content still scrolls', inner);
    await page.evaluate(() => { document.getElementById('host').innerHTML = ''; });
    await frame(page);
    check(await page.evaluate(() => document.body.style.overflow) === '', 'the drawer closes: scrolling is given back');
    await wheelOver(page, 300, 400);
    check(await scrollY(page) > 0, 'and the page scrolls again', await scrollY(page));
    // hiding (not removing) a pop-up also gives scrolling back
    await page.evaluate(h => { document.getElementById('host').innerHTML = h; }, drawer);
    await frame(page);
    check(await page.evaluate(() => document.body.style.overflow) === 'hidden', 'a drawer opens again: locked');
    await page.evaluate(() => { document.getElementById('drawer').style.display = 'none'; });
    await frame(page);
    check(await page.evaluate(() => document.body.style.overflow) === '', 'a pop-up that is hidden instead of removed releases the lock');
    // two pop-ups over each other: the lock stays until the last one closes
    await page.evaluate(h => { document.getElementById('host').innerHTML = h + h.replace('id="drawer"', 'id="second"'); }, drawer);
    await frame(page);
    await page.evaluate(() => document.getElementById('second').remove());
    await frame(page);
    check(await page.evaluate(() => document.body.style.overflow) === 'hidden', 'two pop-ups open, one closed: still locked');
    await page.evaluate(() => document.getElementById('drawer').remove());
    await frame(page);
    check(await page.evaluate(() => document.body.style.overflow) === '', 'the last one closed: unlocked');
    // stopping the watcher while a pop-up is open never leaves the page locked
    await page.evaluate(h => { document.getElementById('host').innerHTML = h; }, drawer);
    await frame(page);
    await page.evaluate(() => window.__stop());
    check(await page.evaluate(() => document.body.style.overflow) === '', 'stopping the watcher releases the lock');
    await page.close(); }

  // things that only look like pop-ups must never lock the page
  const notOverlays = [
    ['a toast layer that lets clicks through', '<div class="fixed" style="position:fixed;inset:0;z-index:50;pointer-events:none"></div>'],
    ['a decorative background behind the page', '<div class="fixed" style="position:fixed;inset:0;z-index:-10"></div>'],
    ['a fixed header', '<div class="fixed" style="position:fixed;top:0;left:0;right:0;height:64px;z-index:50;background:#fff"></div>'],
    ['the desktop sidebar', '<aside class="fixed" style="position:fixed;top:0;left:0;height:100vh;width:264px;z-index:50;background:#fff"></aside>'],
    ['a layer that is invisible', '<div class="fixed" style="position:fixed;inset:0;z-index:60;visibility:hidden"></div>'],
    ['a fully transparent layer', '<div class="fixed" style="position:fixed;inset:0;z-index:60;opacity:0"></div>'],
    ['a layer inside something not displayed', '<div style="display:none"><div class="fixed" style="position:fixed;inset:0;z-index:60"></div></div>'],
    ['a full-screen element with no stacking order', '<div class="fixed" style="position:fixed;inset:0"></div>']
  ];
  for (const [name, html] of notOverlays) {
    const page = await fresh(true);
    await page.evaluate(h => { document.getElementById('host').innerHTML = h; }, html);
    await frame(page);
    check(await page.evaluate(() => document.body.style.overflow) === '', `${name} does not lock the page`);
    await wheelOver(page, 640, 400);
    check(await scrollY(page) > 0, `${name}: the page still scrolls`, await scrollY(page));
    await page.close();
  }

  // a phone: the drawer covers the narrow screen
  { const page = await browser.newPage({ viewport: { width: 390, height: 780 } });
    await page.setContent(longPage);
    await page.addScriptTag({ content: bundle });
    await page.evaluate(() => { window.watchOverlays(); });
    await page.evaluate(h => { document.getElementById('host').innerHTML = h; }, drawer);
    await frame(page);
    check(await page.evaluate(() => document.body.style.overflow) === 'hidden', 'phone width: a drawer locks the page');
    await page.close(); }
}

await browser.close();
console.log(`=== ALL SCROLLING BROWSER TESTS PASSED (${passed}) ===`);
