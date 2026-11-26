// Mobile audit hook (Task 04; docs/MOBILE_UI_GUIDELINES.md). Loaded with `node --import` in front of a browser test
// (supabase/tests/ui_*.test.mjs): every page the test opens is measured at the 9 audit widths just before it closes, and whatever makes
// the page scroll sideways is written to AUDIT_OUT (one JSON line per page and width; only the outermost element that sticks out).
// AUDIT_NAV=<selector> also opens every navigation item matching it and measures each screen. Read-only: it never changes a test's result.
import { createRequire } from 'node:module';
import { appendFileSync } from 'node:fs';
import path from 'node:path';
const require = createRequire(path.join(process.cwd(), 'x.js'));
let pw;
for (const p of ['playwright', '/opt/node-tools/node_modules/playwright', 'playwright-core']) { try { pw = require(p); break; } catch { /* next */ } }
const OUT = process.env.AUDIT_OUT;
const TEST = path.basename(process.argv[1] || '?');
const WIDTHS = [320, 360, 375, 390, 414, 430, 768, 1024, 1440];
const audited = new WeakSet();
async function audit(page) {
  if (audited.has(page) || page.isClosed()) return;
  audited.add(page);
  // AUDIT_NAV=selector: also open every navigation item matching it and measure each screen
  const sel = process.env.AUDIT_NAV;
  if (sel) {
    await page.setViewportSize({ width: 1440, height: 900 });
    const n = await page.locator(sel).count().catch(() => 0);
    const labels = [];
    for (let i = 0; i < n; i++) labels.push(((await page.locator(sel).nth(i).innerText().catch(() => '')) || '').trim().split('\n')[0]);
    for (let i = 0; i < n; i++) {
      await page.setViewportSize({ width: 1440, height: 900 });
      try { await page.locator(sel).nth(i).click({ timeout: 2000 }); await page.waitForTimeout(500); } catch { continue; }
      await measure(page, 'nav:' + labels[i]);
    }
  }
  await measure(page, '');
}
async function measure(page, screen) {
  try {
    const url = page.url();
    for (const w of WIDTHS) {
      await page.setViewportSize({ width: w, height: w < 700 ? 760 : 900 });
      await page.waitForTimeout(120);
      const r = await page.evaluate(() => {
        const iw = document.documentElement.clientWidth;
        const sw = Math.max(document.documentElement.scrollWidth, document.body ? document.body.scrollWidth : 0);
        const out = [];
        if (sw > iw + 1) {
          const bad = new Set();
          for (const el of document.querySelectorAll('body *')) {
            const b = el.getBoundingClientRect();
            if (!b.width || b.right <= iw + 1) continue;
            const cs = getComputedStyle(el);
            if (cs.position === 'fixed' && b.left >= iw) continue;
            let p = el.parentElement, clipped = false;
            while (p && p !== document.body) { if (getComputedStyle(p).overflowX !== 'visible') { clipped = true; break; } p = p.parentElement; }
            if (clipped) continue;
            bad.add(el);
          }
          for (const el of bad) {
            if (el.parentElement && bad.has(el.parentElement)) continue;
            const b = el.getBoundingClientRect();
            const cls = (el.getAttribute('class') || '').slice(0, 140);
            const tid = el.closest('[data-testid]')?.getAttribute('data-testid') || '';
            out.push({ tag: el.tagName.toLowerCase(), cls, tid, text: (el.innerText || '').trim().slice(0, 60).replace(/\s+/g, ' '), right: Math.round(b.right), width: Math.round(b.width) });
          }
        }
        return { iw, sw, out: out.slice(0, 8) };
      });
      if (r.sw > r.iw + 1) appendFileSync(OUT, JSON.stringify({ test: TEST, screen, url, width: w, ...r }) + '\n');
      if (process.env.AUDIT_LOG) appendFileSync(process.env.AUDIT_LOG, JSON.stringify({ test: TEST, screen, width: w, sw: r.sw, iw: r.iw }) + '\n');
    }
  } catch (e) { appendFileSync(OUT, JSON.stringify({ test: TEST, error: String(e.message).slice(0, 200) }) + '\n'); }
}
function wrapPage(page) {
  const close = page.close.bind(page);
  page.close = async (...a) => { await audit(page); return close(...a); };
  return page;
}
function wrapContext(ctx) {
  const np = ctx.newPage.bind(ctx);
  ctx.newPage = async (...a) => wrapPage(await np(...a));
  const close = ctx.close.bind(ctx);
  ctx.close = async (...a) => { for (const p of ctx.pages()) await audit(p); return close(...a); };
  return ctx;
}
if (pw && OUT) {
  const launch = pw.chromium.launch.bind(pw.chromium);
  pw.chromium.launch = async (...a) => {
    const browser = await launch(...a);
    const np = browser.newPage.bind(browser);
    browser.newPage = async (...x) => wrapPage(await np(...x));
    const nc = browser.newContext.bind(browser);
    browser.newContext = async (...x) => wrapContext(await nc(...x));
    const close = browser.close.bind(browser);
    browser.close = async (...x) => { for (const c of browser.contexts()) for (const p of c.pages()) await audit(p); return close(...x); };
    return browser;
  };
}
