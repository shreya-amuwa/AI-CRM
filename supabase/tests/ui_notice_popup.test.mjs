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
    check(/Company notice/.test(band) && (await popup(page).getAttribute('data-priority')) === 'URGENT', 'the heading says "Company notice" and the popup knows it is Urgent');
    check(await page.isVisible('[data-testid="notice-popup-priority"]') && /Urgent/.test(await page.innerText('[data-testid="notice-popup-priority"]')), 'the priority is a quiet marker with its label (a dot and the word Urgent)');
    // a normal-sized, plain modal: not a full-screen announcement
    const box = await page.evaluate(() => { const d = document.querySelector('[data-testid="notice-popup"]').getBoundingClientRect(); const s = getComputedStyle(document.querySelector('[data-testid="notice-popup"]'));
      return { w: d.width, h: d.height, iw: innerWidth, ih: innerHeight, anim: s.animationName, grad: s.backgroundImage, title: parseFloat(getComputedStyle(document.querySelector('[data-testid="notice-popup-title"]')).fontSize) }; });
    check(box.w <= 520 && box.w >= 320 && box.h <= box.ih * 0.85 && box.w < box.iw * 0.5, 'desktop: a normal-sized modal (about 512 px wide), not the whole screen', box);
    check(box.anim === 'none' && box.grad === 'none' && box.title <= 20, 'no animation, no gradient, and a title that is clear but not oversized', box);
    check(/Policy/.test(await page.innerText('[data-testid="notice-popup-category"]')), 'the category');
    const meta = await popup(page).innerText();
    check(/Published by\s+Ashish Sinha/.test(meta) && /2030|Jan/.test(meta), 'who published it and when');
    const body = await page.innerText('[data-testid="notice-popup-body"]');
    check(/Full text of Office closed on Friday\./.test(body) && /Second line/.test(body), 'the whole text, line breaks kept');
    check(await page.isVisible('text=holiday-list.pdf') && await page.isVisible('[data-testid="notice-popup-file"] >> text=20 KB'), 'the attachment, with its size');
    // View and Download are separate buttons; each asks the server for a short-lived link of its own kind and opens it
    await page.evaluate(() => { window.__opened = []; window.open = u => { window.__opened.push(String(u)); return null; }; });
    await page.click('button[aria-label="View holiday-list.pdf"]');
    await page.waitForFunction(() => window.__opened.length === 1);
    await page.click('button[aria-label="Download holiday-list.pdf"]');
    await page.waitForFunction(() => window.__opened.length === 2);
    const urlCalls = (await calls(page, 'GET', /issue-attachments\/f1\/url/)).map(c => c.search);
    check(urlCalls.some(q => /action=view/.test(q)) && urlCalls.some(q => /action=download/.test(q)), 'View and Download each open the file (their own signed link)', urlCalls);
    check(!(await page.isVisible('[data-testid="notice-popup-close"]')), 'an Urgent notice has no close button');
    check(!(await page.isVisible('[data-testid="notice-popup-later"]')), 'an Urgent notice has no "Remind me later"');
    await page.keyboard.press('Escape');
    check(await popup(page).isVisible(), 'and Escape does not close it');
    const overlap = await page.evaluate(() => document.querySelectorAll('[data-testid="notice-popup"]').length);
    check(overlap === 1, 'one notice at a time, never overlapping windows');
    // navigation without acknowledging
    await page.click('[data-testid="notice-popup-next"]');
    check(await title(page) === 'New leave policy' && /Notice 2 of 3/.test(await page.innerText('[data-testid="notice-popup-count"]')), 'Next moves to the Important notice (Important next, then Normal)');
    check(/Important/.test(await page.innerText('[data-testid="notice-popup-priority"]')) && (await popup(page).getAttribute('data-priority')) === 'IMPORTANT' && await page.isVisible('[data-testid="notice-popup-later"]'), 'it shows Important, and may be put off');
    check(await page.isVisible('[data-testid="notice-popup-close"]'), 'it has a close button in the top-right corner');
    const pos = await page.evaluate(() => { const d = document.querySelector('[data-testid="notice-popup"]').getBoundingClientRect(); const c = document.querySelector('[data-testid="notice-popup-close"]').getBoundingClientRect(); return { fromRight: d.right - c.right, fromTop: c.top - d.top }; });
    check(pos.fromRight < 24 && pos.fromTop < 24, 'and it sits in the top-right corner', pos);
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
  // ---- the Important notice's close button puts it off; a notice deleted while it is open disappears instead of getting stuck
  {
    const page = await open();
    await page.evaluate(() => { window.__server = { items: [window.__notice('n-imp', 'IMPORTANT', 'Close me', 5), window.__notice('n-del', 'NORMAL', 'Deleted meanwhile', 1)], failAck: false, deletedIds: [] }; });
    await mount(page);
    await popup(page).waitFor();
    check(await title(page) === 'Close me', 'the Important notice is first');
    await page.click('[data-testid="notice-popup-close"]');
    await page.waitForFunction(() => document.querySelector('[data-testid="notice-popup-title"]')?.textContent === 'Deleted meanwhile');
    check((await calls(page, 'POST', /acknowledge/)).length === 0, 'the close button puts it off without acknowledging, and the next notice is shown');
    await page.evaluate(() => { window.__server.deletedIds.push('n-del'); });
    await page.click('[data-testid="notice-popup-ack"]');
    await page.waitForFunction(() => !document.querySelector('[data-testid="notice-popup"]'));
    check(!(await page.isVisible('[data-testid="notice-popup-error"]')), 'a notice deleted while it was open just leaves the queue: no error, nothing stuck');
    await page.close();
  }
  // ---- a tablet, and a long text on a phone: the modal stays a normal size and the text scrolls inside it
  {
    const page = await open({ width: 768, height: 1024 });
    await mount(page);
    await popup(page).waitFor();
    const t = await page.evaluate(() => { const d = document.querySelector('[data-testid="notice-popup"]').getBoundingClientRect(); return { w: d.width, h: d.height, ih: innerHeight, iw: innerWidth, left: d.left, right: d.right }; });
    check(t.w <= 520 && t.left > 0 && t.right < t.iw && t.h < t.ih * 0.6, 'tablet: still a normal-sized modal, centred, with the page visible around it', t);
    await page.close();
  }
  {
    const page = await open({ width: 360, height: 640 });
    await page.evaluate(() => { window.__server = { items: [window.__notice('n-long', 'NORMAL', 'A very long notice', 1, { body: Array.from({ length: 120 }, (_, i) => `Line ${i + 1} of a long notice that keeps going.`).join('\n') })], failAck: false }; });
    await mount(page);
    await popup(page).waitFor();
    const m = await page.evaluate(() => { const d = document.querySelector('[data-testid="notice-popup"]').getBoundingClientRect(); const a = document.querySelector('[data-testid="notice-popup-ack"]').getBoundingClientRect();
      const sc = document.querySelector('[data-testid="notice-popup-body"]').parentElement; return { top: d.top, bottom: d.bottom, ih: innerHeight, ackBottom: a.bottom, scrolls: sc.scrollHeight > sc.clientHeight + 5, sw: document.documentElement.scrollWidth, iw: innerWidth }; });
    check(m.top >= 0 && m.bottom <= m.ih && m.ackBottom <= m.ih && m.scrolls && m.sw <= m.iw + 1, 'phone, long text: the modal fits the screen, the text scrolls inside it and Acknowledge stays on screen', m);
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
  // ---- Task 03: a compact bottom sheet on phones, "View full notice", focus kept inside, the page locked, and never over another dialog
  for (const vp of [{ width: 320, height: 640 }, { width: 390, height: 844 }, { width: 430, height: 932 }]) {
    const page = await open(vp);
    await page.evaluate(() => { window.__server = { items: [window.__notice('n-long', 'NORMAL', 'A long notice', 1, { body: Array.from({ length: 80 }, (_, i) => `Line ${i + 1} of a long notice.`).join('\n') })], failAck: false }; });
    await mount(page);
    await popup(page).waitFor();
    const m = await page.evaluate(() => { const d = document.querySelector('[data-testid="notice-popup"]').getBoundingClientRect();
      return { h: d.height, bottom: d.bottom, ih: innerHeight, left: d.left, right: d.right, iw: innerWidth, sw: document.documentElement.scrollWidth, locked: getComputedStyle(document.body).overflow }; });
    check(m.h <= m.ih * 0.56 && m.h >= m.ih * 0.3 && Math.abs(m.bottom - m.ih) <= 1 && m.left <= 0.5 && m.right >= m.iw - 0.5 && m.sw <= m.iw + 1,
      `${vp.width}px: a bottom sheet across the width, at most about half the screen, no sideways scroll`, m);
    check(m.locked === 'hidden', `${vp.width}px: the page behind does not scroll`, m);
    check(await page.isVisible('[data-testid="notice-popup-full"]') && /View full notice/.test(await page.innerText('[data-testid="notice-popup-full"]')), `${vp.width}px: "View full notice" for a long text`);
    await page.click('[data-testid="notice-popup-full"]');
    const e = await page.evaluate(() => { const d = document.querySelector('[data-testid="notice-popup"]').getBoundingClientRect(); const a = document.querySelector('[data-testid="notice-popup-ack"]').getBoundingClientRect();
      return { h: d.height, top: d.top, ih: innerHeight, ackBottom: a.bottom, expanded: document.querySelector('[data-testid="notice-popup"]').dataset.expanded }; });
    check(e.expanded === 'true' && e.h > m.h && e.h <= e.ih * 0.93 && e.top >= 0 && e.ackBottom <= e.ih + 1, `${vp.width}px: opened to nearly the full height, Acknowledge still on screen`, e);
    await page.close();
  }
  {
    const page = await open({ width: 390, height: 844 });
    await page.evaluate(() => { window.__server = { items: [window.__notice('n-short', 'NORMAL', 'Short one', 1, { body: 'Two words.' })], failAck: false }; });
    await mount(page);
    await popup(page).waitFor();
    const h = await page.evaluate(() => document.querySelector('[data-testid="notice-popup"]').getBoundingClientRect().height / innerHeight);
    check(h < 0.55 && !(await page.isVisible('[data-testid="notice-popup-full"]')), 'a short notice: a small sheet, no "View full notice"', h);
    // Tab stays inside the notice
    const inside = [];
    for (let i = 0; i < 8; i++) { await page.keyboard.press('Tab'); inside.push(await page.evaluate(() => !!document.activeElement?.closest('[data-testid="notice-popup"]'))); }
    await page.keyboard.press('Shift+Tab');
    inside.push(await page.evaluate(() => !!document.activeElement?.closest('[data-testid="notice-popup"]')));
    check(inside.every(Boolean), 'keyboard: Tab and Shift+Tab stay inside the notice', inside);
    await page.click('[data-testid="notice-popup-ack"]');
    await popup(page).waitFor({ state: 'detached' });
    check(await page.evaluate(() => getComputedStyle(document.body).overflow) !== 'hidden', 'once acknowledged, the page scrolls again');
    await page.close();
  }
  {
    const page = await open({ width: 390, height: 844 });
    await page.evaluate(() => {
      const d = document.createElement('div'); d.setAttribute('role', 'dialog'); d.setAttribute('aria-modal', 'true'); d.id = 'other-dialog'; d.textContent = 'Start your workday?';
      document.body.appendChild(d);
      window.__server = { items: [window.__notice('n-wait', 'URGENT', 'Wait your turn', 1)], failAck: false };
    });
    await mount(page);
    await page.waitForTimeout(500);
    check(!(await popup(page).isVisible()), 'another dialog is open (a punch confirmation): the notice waits, never on top of it');
    await page.evaluate(() => document.getElementById('other-dialog').remove());
    await popup(page).waitFor();
    check(await title(page) === 'Wait your turn', 'and it appears once that dialog closes');
    await page.close();
  }
} finally {
  await browser.close();
}
check(errors.length === 0, 'no error on the page', errors);
console.log(`=== NOTICE POPUP BROWSER TESTS PASSED (${passed}) ===`);
