// Browser test of the "Something went wrong" flash after a deployment (src/lib/chunkReload.ts, ErrorBoundary): a screen of the previous
// build that cannot be loaded never shows the dark error page; the page shows "Loading the latest version" while it reloads itself.
// A real crash still shows the (light) error page, without internal details. Real React and Chromium. Skipped, loudly, without Playwright.
import { createRequire } from 'node:module';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
let chromium;
for (const p of ['playwright', '/opt/node-tools/node_modules/playwright', 'playwright-core']) {
  try { ({ chromium } = require(p)); break; } catch { /* try the next */ }
}
if (!chromium) { console.log('SKIPPED - Playwright is not installed, the app update browser test did not run'); process.exit(0); }
const built = await build({ entryPoints: ['supabase/tests/ui/app_update_harness.tsx'], bundle: true, format: 'iife', platform: 'browser', write: false,
  define: { 'import.meta.env': '{}', 'process.env.NODE_ENV': '"production"' }, jsx: 'automatic', logLevel: 'error', loader: { '.css': 'empty' } });
const bundle = built.outputFiles[0].text;
const cssFile = existsSync('dist/assets') ? readdirSync('dist/assets').find(f => /^index-.*\.css$/.test(f)) : null;
const css = cssFile ? readFileSync(path.join('dist/assets', cssFile), 'utf8') : '';

let passed = 0;
const check = (ok, name, extra) => { if (!ok) { console.error('not ok -', name, extra === undefined ? '' : JSON.stringify(extra)); process.exitCode = 1; throw new Error(`failed: ${name}`); } passed++; console.log('ok -', name); };
let browser;
try { browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined }); } catch (e) { console.log('SKIPPED - Chromium could not be started:', String(e.message).split('\n')[0]); process.exit(0); }

// every load of the page: the harness, and a recorder that writes each screen shown into sessionStorage (it survives the reload)
const open = async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  let loads = 0;
  page.on('load', () => { loads++; });
  await page.route('http://au.test/**', r => r.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body><div id="root"></div>
<script>new MutationObserver(() => { const t = document.getElementById('root').innerText.trim(); if (t) { const s = JSON.parse(sessionStorage.getItem('screens') || '[]'); if (s[s.length - 1] !== t) { s.push(t); sessionStorage.setItem('screens', JSON.stringify(s)); } } }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });</script></body></html>` }));
  await page.goto('http://au.test/');
  await page.addScriptTag({ content: bundle });
  return { page, loads: () => loads };
};
const screens = page => page.evaluate(() => JSON.parse(sessionStorage.getItem('screens') || '[]'));

try {
  for (const kind of ['empty', 'missing']) {
    const { page, loads } = await open();
    const before = loads();
    await page.evaluate(k => window.mount(k), kind);
    await page.waitForFunction(() => document.readyState === 'complete' && !window.mount, null, { timeout: 10000 }).catch(() => undefined);
    await page.waitForTimeout(800);
    const seen = await screens(page);
    check(loads() > before, `${kind === 'empty' ? 'an empty module (cancelled preload)' : 'a missing module'}: the page reloads itself to get the new version`, { loads: loads(), before });
    check(!seen.some(t => /Something went wrong/.test(t)) && seen.some(t => /Loading the latest version/.test(t)),
      `${kind}: never "Something went wrong"; "Loading the latest version" while it reloads`, seen);
    await page.close();
  }
  {
    const { page } = await open();
    check(await page.evaluate(() => window.vitePreloadFails()) === false, 'a failed preload is not cancelled (Vite passes the real error on)');
    await page.close();
  }
  {
    // a real crash: the light error page, no reload, no internal details
    const { page, loads } = await open();
    const before = loads();
    await page.evaluate(() => window.mount('crash'));
    await page.getByTestId('app-error').waitFor();
    await page.waitForTimeout(500);
    const t = await page.innerText('[data-testid="app-error"]');
    const bg = await page.evaluate(() => getComputedStyle(document.querySelector('[data-testid="app-error"]')).backgroundColor);
    check(/Something went wrong/.test(t) && /Reload page/.test(t) && /Go to home page/.test(t) && loads() === before, 'a real crash: "Something went wrong" with Reload / Home, and no reload by itself', t);
    check(!/Real bug in a screen/.test(t), 'the error page shows no internal details (they go to error reporting)', t);
    check(!/rgb\((1[0-9]|2[0-9]|3[0-9]|[0-9]), (2[0-9]|3[0-9]|4[0-9]|[0-9]), (3[0-9]|4[0-9]|[0-9])\)/.test(bg), 'and it is light, not a dark screen', bg);
    await page.close();
  }
} finally {
  await browser.close();
}
console.log(`=== APP UPDATE BROWSER CHECKS PASSED (${passed}) ===`);
