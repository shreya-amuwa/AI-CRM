// Browser test of the company-notice popup (20270202000100): it opens by itself when an employee has notices they have not acknowledged (Urgent first), shows each notice
// (title, category, priority, publisher, time, text, files) one at a time with "Notice 2 of 3", needs an individual acknowledgement, cannot be put off for an Urgent notice,
// does not come back once acknowledged (also after a reload), opens by itself when a notice is published while the CRM is open (the bell receives it), and fits a phone.
// Real React component, real Chromium; the CRM API is answered in the page (supabase/tests/ui/notice_popup_harness.tsx). Skipped, loudly, without Playwright.
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
let chromium;
for (const p of ['playwright', '/opt/node-tools/node_modules/playwright', 'playwright-core']) {
  try { ({ chromium } = require(p)); break; } catch { /* try the next */ }
}
if (!chromium) { console.log('SKIPPED - Playwright is not installed, the notice popup browser test did not run'); process.exit(0); }
const work = mkdtempSync(path.join(tmpdir(), 'np-ui-'));
const out = path.join(work, 'app.js');
await build({
  entryPoints: ['supabase/tests/ui/notice_popup_harness.tsx'], bundle: true, format: 'iife', platform: 'browser', outfile: out, define: { 'import.meta.env': '{}' },
  jsx: 'automatic', logLevel: 'error', loader: { '.css': 'empty' },
  plugins: [{ name: 'stubs', setup(b) {
    b.onResolve({ filter: /\/context\/AuthContext$/ }, () => ({ path: path.resolve('supabase/tests/ui/chat_extras_auth_stub.ts') }));
    b.onResolve({ filter: /\/context\/NotificationContext$/ }, () => ({ path: path.resolve('supabase/tests/ui/notice_popup_notifications_stub.tsx') }));
    b.onResolve({ filter: /services\/supabaseClient$/ }, () => ({ path: path.resolve('supabase/tests/ui/meeting_presence_supabase_stub.ts') }));
  } }]
});
const bundle = readFileSync(out, 'utf8');
// the page's own classes: the Tailwind build when it exists; the popup is checked by what it shows and where it sits
const tailwind = (await import('node:fs')).existsSync('dist/assets') ? (await import('node:fs')).readdirSync('dist/assets').find(f => /^index-.*\.css$/.test(f)) : null;
const css = tailwind ? readFileSync(path.join('dist/assets', tailwind), 'utf8') : '';

let passed = 0;
const check = (ok, name, extra) => { if (!ok) { console.error('not ok -', name, extra === undefined ? '' : JSON.stringify(extra)); process.exitCode = 1; throw new Error(`failed: ${name}`); } passed++; console.log('ok -', name); };
let browser;
try { browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined }); } catch (e) { console.log('SKIPPED - Chromium could not be started:', String(e.message).split('\n')[0]); process.exit(0); }
const errors = [];
const open = async (viewport = { width: 1280, height: 800 }) => {
  const page = await browser.newPage({ viewport });
  page.on('pageerror', e => errors.push(e.message));
  await page.route('http://np.test/**', route => route.fulfill({ status: 200, contentType: 'text/html',
    body: '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>' + css + '</style></head><body><div id="root"></div></body></html>' }));
  await page.goto('http://np.test/');
  await page.addScriptTag({ content: bundle });
  return page;
};
const mount = (page, o = {}) => page.evaluate(x => window.mount(x), o);
const popup = page => page.locator('[data-testid="notice-popup"]');
const calls = (page, method, re) => page.evaluate(([m, src]) => window.__calls.filter(c => c.method === m && new RegExp(src).test(c.path)), [method, re.source]);
const title = page => page.innerText('[data-testid="notice-popup-title"]');

try {
  // ---- the employee opens the CRM with three unread notices (they were offline when they were published)
  {
    const page = await open();
    await mount(page);
    await popup(page).waitFor();
    check(await title(page) === 'Office closed on Friday', 'it opens by itself with the Urgent notice first');
    check(/Notice 1 of 3/.test(await page.innerText('[data-testid="notice-popup-count"]')) && /3 unread notices/.test(await page.innerText('[data-testid="notice-popup-unread"]')), 'it says "Notice 1 of 3" and how many are unread');
    const band = await page.innerText('[data-testid="notice-popup-band"]');
    check(/URGENT NOTICE/.test(band) && (await popup(page).getAttribute('data-priority')) === 'URGENT', 'the Urgent notice is marked in the heading band');
    check(await page.isVisible('[data-testid="notice-popup-priority"]') && /Urgent/.test(await page.innerText('[data-testid="notice-popup-priority"]')), 'with its priority label');
    check(/Policy/.test(await page.innerText('[data-testid="notice-popup-category"]')), 'the category');
    const meta = await popup(page).innerText();
    check(/Published by\s+Ashish Sinha/.test(meta) && /2030|Jan/.test(meta), 'who published it and when');
    const body = await page.innerText('[data-testid="notice-popup-body"]');
    check(/Full text of Office closed on Friday\./.test(body) && /Second line/.test(body), 'the whole text, line breaks kept');
    check(await page.isVisible('text=holiday-list.pdf'), 'the attachment');
    check(!(await page.isVisible('[data-testid="notice-popup-later"]')), 'an Urgent notice has no "Remind me later"');
    await page.keyboard.press('Escape');
    check(await popup(page).isVisible(), 'and Escape does not close it');
    const overlap = await page.evaluate(() => document.querySelectorAll('[data-testid="notice-popup"]').length);
    check(overlap === 1, 'one notice at a time, never overlapping windows');
    // navigation without acknowledging
    await page.click('[data-testid="notice-popup-next"]');
    check(await title(page) === 'New leave policy' && /Notice 2 of 3/.test(await page.innerText('[data-testid="notice-popup-count"]')), 'Next moves to the Important notice (Important next, then Normal)');
    check(/Important notice/.test(await page.innerText('[data-testid="notice-popup-band"]')) && await page.isVisible('[data-testid="notice-popup-later"]'), 'it has its own band, and may be put off');
    await page.click('[data-testid="notice-popup-prev"]');
    check(await title(page) === 'Office closed on Friday', 'Previous goes back');
    check((await calls(page, 'POST', /acknowledge/)).length === 0, 'looking at notices acknowledges nothing');
    // acknowledge one by one
    await page.click('[data-testid="notice-popup-ack"]');
    await page.waitForFunction(() => /Notice 1 of 2/.test(document.querySelector('[data-testid="notice-popup-count"]')?.textContent ?? ''));
    const a1 = (await calls(page, 'POST', /acknowledge/))[0];
    check(a1.path.endsWith('/notices/n-urgent/acknowledge') && JSON.stringify(a1.body) === '{}', 'acknowledging sends only the notice id: the server knows who is asking', a1);
    check(await title(page) === 'New leave policy', 'then the next notice appears');
    await page.click('[data-testid="notice-popup-ack"]');
    await page.waitForFunction(() => /Notice 1 of 1/.test(document.querySelector('[data-testid="notice-popup-count"]')?.textContent ?? ''));
    check(await title(page) === 'Weekly team meeting moved' && !(await page.isVisible('[data-testid="notice-popup-prev"]')), 'the last one: no Previous / Next');
    await page.click('[data-testid="notice-popup-ack"]');
    await popup(page).waitFor({ state: 'detached' });
    check((await calls(page, 'POST', /acknowledge/)).length === 3, 'each notice was acknowledged individually (three requests)');
    // reload: the server remembers
    await page.evaluate(() => { window.unmount(); });
    await mount(page);
    await page.waitForTimeout(400);
    check(!(await popup(page).isVisible()), 'after a reload an acknowledged notice does not come back');
    // a notice is published while the CRM is open: the bell receives it, the popup opens by itself
    await page.evaluate(() => window.__publish(window.__notice('n-live', 'IMPORTANT', 'Server maintenance tonight', 0)));
    await popup(page).waitFor();
    check(await title(page) === 'Server maintenance tonight' && /Notice 1 of 1/.test(await page.innerText('[data-testid="notice-popup-count"]')), 'a notice published while the CRM is open opens by itself (realtime)');
    // a second one arrives while this one is being read: the reader is not taken away
    await page.evaluate(() => window.__publish(window.__notice('n-live2', 'NORMAL', 'Canteen timings', 1)));
    await page.waitForFunction(() => /of 2/.test(document.querySelector('[data-testid="notice-popup-count"]')?.textContent ?? ''));
    check(await title(page) === 'Server maintenance tonight' && /2 unread notices/.test(await page.innerText('[data-testid="notice-popup-unread"]')), 'a second arrival joins the queue; the notice being read stays');
    await page.close();
  }
  // ---- "Remind me later" for a non-urgent notice: gone for this session, back when the CRM is opened again
  {
    const page = await open();
    await page.evaluate(() => { window.__server = { items: [window.__notice('n-a', 'NORMAL', 'Canteen timings', 50)], failAck: false }; });
    await mount(page);
    await popup(page).waitFor();
    await page.click('[data-testid="notice-popup-later"]');
    await popup(page).waitFor({ state: 'detached' });
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.waitForTimeout(300);
    check(!(await popup(page).isVisible()), 'put off: it does not interrupt again in this session (even when the tab regains focus)');
    check((await calls(page, 'POST', /acknowledge/)).length === 0, 'and it was not acknowledged');
    await page.evaluate(() => window.unmount());
    await mount(page);
    await popup(page).waitFor();
    check(await title(page) === 'Canteen timings', 'the next time the CRM opens it is there again');
    await page.keyboard.press('Escape');
    await popup(page).waitFor({ state: 'detached' });
    check(true, 'Escape puts a non-urgent notice off');
    await page.close();
  }
  // ---- a failed acknowledgement keeps the notice and says so
  {
    const page = await open();
    await page.evaluate(() => { window.__server = { items: [window.__notice('n-b', 'NORMAL', 'Parking rules', 40)], failAck: true }; });
    await mount(page);
    await popup(page).waitFor();
    await page.click('[data-testid="notice-popup-ack"]');
    await page.waitForSelector('[data-testid="notice-popup-error"]');
    check(/could not be saved/.test(await page.innerText('[data-testid="notice-popup-error"]')) && await popup(page).isVisible(), 'a failed save shows the message and keeps the notice');
    await page.evaluate(() => { window.__server.failAck = false; });
    await page.click('[data-testid="notice-popup-ack"]');
    await popup(page).waitFor({ state: 'detached' });
    check(true, 'and a second try works');
    await page.close();
  }
  // ---- signed out, or the server unreachable: nothing
  {
    const page = await open();
    await mount(page, { signedOut: true });
    await page.waitForTimeout(300);
    check(!(await popup(page).isVisible()) && (await calls(page, 'GET', /pending/)).length === 0, 'nobody signed in: no popup and no request');
    await page.evaluate(() => { window.__server = { items: [window.__notice('n-c', 'NORMAL', 'Hidden', 1)], failAck: false, offline: true }; });
    await mount(page);
    await page.waitForTimeout(400);
    check(!(await popup(page).isVisible()) && errors.length === 0, 'the server unreachable: no popup, no error on the page');
    await page.close();
  }
  // ---- a phone
  {
    const page = await open({ width: 360, height: 640 });
    await mount(page);
    await popup(page).waitFor();
    const m = await page.evaluate(() => {
      const d = document.querySelector('[data-testid="notice-popup"]').getBoundingClientRect();
      const a = document.querySelector('[data-testid="notice-popup-ack"]').getBoundingClientRect();
      return { sw: document.documentElement.scrollWidth, iw: innerWidth, left: d.left, right: d.right, bottom: d.bottom, ih: innerHeight, ackBottom: a.bottom, ackTop: a.top };
    });
    check(m.sw <= m.iw + 1 && m.left >= 0 && m.right <= m.iw + 1, 'phone width: the popup fits the screen, no sideways scrolling', m);
    check(m.ackTop >= 0 && m.ackBottom <= m.ih + 1, 'and the Acknowledge button is on screen', m);
    await page.close();
  }
} finally {
  await browser.close();
}
check(errors.length === 0, 'no error on the page', errors);
console.log(`=== NOTICE POPUP BROWSER TESTS PASSED (${passed}) ===`);
