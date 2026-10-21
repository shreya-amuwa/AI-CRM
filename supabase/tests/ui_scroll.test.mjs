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

await browser.close();
console.log(`=== ALL SCROLLING BROWSER TESTS PASSED (${passed}) ===`);
