// Browser test of the phone chat layout (real Chromium, the real useFillViewport hook and the real client.css / chat.css): the chat
// fills what is visible, nothing is left under the message box, the page itself does not scroll, the channel tabs keep their height,
// and with the keyboard open the box stays above it with the tab bar out of the way.
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
if (!chromium) { console.log('SKIPPED - Playwright is not installed, the mobile chat browser test did not run'); process.exit(0); }

const work = mkdtempSync(path.join(tmpdir(), 'mobile-chat-'));
const out = path.join(work, 'bundle.js');
execFileSync('npx', ['esbuild', 'supabase/tests/ui/mobile_chat_harness.tsx', '--bundle', '--format=iife', '--platform=browser', `--outfile=${out}`, '--log-level=error', '--jsx=automatic'], { stdio: 'inherit' });
const bundle = readFileSync(out, 'utf8');
const css = readFileSync('src/client/client.css', 'utf8').replace(/@import[^;]+;/g, '') + '\n' + readFileSync('src/components/chat/chat.css', 'utf8');

let passed = 0;
const check = (ok, name, extra) => { if (!ok) { console.error('not ok -', name, extra === undefined ? '' : JSON.stringify(extra)); process.exitCode = 1; throw new Error(`failed: ${name}`); } passed++; console.log('ok -', name); };

let browser;
try { browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined }); }
catch (e) { console.log('SKIPPED - Chromium could not be started:', String(e.message).split('\n')[0]); process.exit(0); }

const open = async (w, h, { messages = 40, touch = true } = {}) => {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: touch, hasTouch: touch, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.setContent('<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>*,::before,::after{box-sizing:border-box}body{margin:0}button,textarea{font:inherit}' + css + '</style></head><body><div id="root"></div></body></html>');
  await page.addScriptTag({ content: bundle });
  await page.evaluate(n => window.mount(n), messages);
  await page.waitForSelector('.cd-chat-tab');
  await page.waitForTimeout(450);
  return page;
};
const rects = page => page.evaluate(() => {
  const r = s => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom), h: Math.round(b.height), display: getComputedStyle(e).display }; };
  return { inner: innerHeight, docH: document.documentElement.scrollHeight, hscroll: document.documentElement.scrollWidth > innerWidth, card: r('.cd-chat-card'), tabs: r('.cd-chat-tabs'), tabbar: r('.cd-tabbar'), composer: r('.ch-composer'), body: r('.ch-body'),
    bodyAtBottom: (() => { const b = document.querySelector('.ch-body'); return b.scrollHeight - b.scrollTop - b.clientHeight < 2; })(), bodyScrolls: (() => { const b = document.querySelector('.ch-body'); return b.scrollHeight > b.clientHeight; })() };
});

// 1. the phones and the tablet and the desktops (keyboard closed)
const sizes = [[375, 667], [390, 844], [430, 932], [360, 800], [412, 915], [768, 1024], [1366, 768], [1920, 1080]];
for (const [w, h] of sizes) {
  const phone = w < 768;
  const page = await open(w, h, { touch: phone });
  const m = await rects(page);
  const label = `${w}x${h}`;
  check(m.tabs.h < 80, `${label}: the channel tabs keep their own height (they appear after the first paint)`, m.tabs);
  check(!m.hscroll, `${label}: no sideways scrolling`);
  check(m.docH <= m.inner + 1, `${label}: the page itself does not scroll (page ${m.docH}px, window ${m.inner}px)`, m);
  const floor = phone ? m.tabbar.top : m.inner;
  check(Math.abs(m.card.bottom - floor) <= 1, `${label}: the chat reaches down to ${phone ? 'the tab bar' : 'the bottom of the window'} and leaves no blank space`, { card: m.card, floor });
  check(m.composer.bottom <= m.card.bottom + 1 && m.composer.top > m.card.top, `${label}: the message box is inside the visible chat`, m.composer);
  check(m.bodyScrolls, `${label}: a long conversation scrolls inside the chat`, m);
  if (!phone) check(m.tabbar.display === 'none', `${label}: no tab bar on a large screen`);
  await page.context().close();
}

// 2. the page was scrolled (the old code added the scroll offset to a measurement that already had it)
{
  const page = await open(390, 844);
  await page.evaluate(() => window.scrollTo(0, 80));
  await page.evaluate(() => window.dispatchEvent(new Event('resize')));
  await page.waitForTimeout(200);
  const m = await rects(page);
  check(Math.abs(m.card.bottom - m.tabbar.top) <= 1 || m.docH <= m.inner + 1, 'a scroll attempt leaves the layout as it was', m);
  await page.context().close();
}

// 3. the keyboard: the visible area shrinks and the box is focused
for (const [w, h, kbd] of [[390, 844, 336], [375, 667, 260], [360, 800, 300]]) {
  const page = await open(w, h);
  await page.locator('.ch-input textarea').focus();
  await page.setViewportSize({ width: w, height: h - kbd });
  await page.waitForTimeout(500);
  const m = await rects(page);
  const label = `${w}x${h} with the keyboard (${kbd}px)`;
  check(m.tabbar.display === 'none', `${label}: the tab bar steps aside`, m.tabbar);
  check(m.card.bottom <= m.inner + 1 && m.composer.bottom <= m.inner + 1 && m.composer.top >= 0, `${label}: the message box stays in view, above the keyboard`, m);
  check(m.docH <= m.inner + 1, `${label}: the page does not scroll`, m);
  await page.setViewportSize({ width: w, height: h });
  await page.locator('.ch-input textarea').blur();
  await page.waitForTimeout(500);
  const back = await rects(page);
  check(back.tabbar.display !== 'none' && Math.abs(back.card.bottom - back.tabbar.top) <= 1, `${label}: closing the keyboard restores the layout`, back);
  await page.context().close();
}

// 4. a phone on its side with the keyboard: no room for the title bar, the messages and the box remain
{
  const page = await open(667, 375);
  await page.locator('.ch-input textarea').focus();
  await page.setViewportSize({ width: 667, height: 200 });
  await page.waitForTimeout(500);
  const m = await rects(page);
  check(await page.evaluate(() => getComputedStyle(document.querySelector('.ch-head')).display === 'none'), 'landscape with the keyboard: the title bar makes room', m);
  check(m.composer.bottom <= m.inner + 1 && m.composer.top >= 0, 'landscape with the keyboard: the message box is still in view', m);
  await page.context().close();
}

// 5. touch comfort: tap targets and text size (iOS zooms the page when a text box is smaller than 16px)
{
  const page = await open(390, 844);
  const t = await page.evaluate(() => ({ font: getComputedStyle(document.querySelector('.ch-input textarea')).fontSize, icons: [...document.querySelectorAll('.ch-icon, .ch-send')].map(e => Math.round(e.getBoundingClientRect().width)), hint: getComputedStyle(document.querySelector('.ch-hint')).display }));
  check(parseFloat(t.font) >= 16, 'the message box text is 16px or larger on a touch screen', t);
  check(t.icons.every(w => w >= 40), 'the buttons beside the message box are at least 40px wide', t);
  check(t.hint === 'none', 'the "Enter to send" hint is not shown on a touch screen', t);
  await page.context().close();
}

await browser.close();
console.log(`=== MOBILE CHAT BROWSER CHECKS PASSED (${passed}) ===`);
