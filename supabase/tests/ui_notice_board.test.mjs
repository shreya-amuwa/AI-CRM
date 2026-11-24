// Browser test of the Notice Board (20270131000200) and the Super Admin's attendance alert (20270131000100): every dashboard has Notice
// Board (unread badge); an employee reads (the whole card opens a notice, which becomes read) and has no Send Notice; HR sends to a department
// (the form checks the audience first) and sees the read receipts; a notice notification opens that exact notice; the Super Admin's "Look at
// today's attendance." (a tapped push, or the bell) opens Attendance on Today's Attendance Overview with the absent employees first.
// Real React components and the real dashboard shell, real Chromium; the CRM API is answered in the page (supabase/tests/ui/notice_board_harness.tsx).
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
let chromium;
for (const p of ['playwright', '/opt/node-tools/node_modules/playwright', 'playwright-core']) {
  try { ({ chromium } = require(p)); break; } catch { /* try the next */ }
}
if (!chromium) { console.log('SKIPPED - Playwright is not installed, the Notice Board browser test did not run'); process.exit(0); }
const work = mkdtempSync(path.join(tmpdir(), 'nb-ui-'));
const out = path.join(work, 'app.js');
await build({
  entryPoints: ['supabase/tests/ui/notice_board_harness.tsx'], bundle: true, format: 'iife', platform: 'browser', outfile: out, define: { 'import.meta.env': '{}' },
  jsx: 'automatic', logLevel: 'error', loader: { '.css': 'empty' },
  plugins: [{ name: 'stubs', setup(b) {
    b.onResolve({ filter: /services\/supabaseClient$/ }, () => ({ path: path.resolve('supabase/tests/ui/notice_board_supabase_stub.ts') }));
    b.onResolve({ filter: /\/context\/AuthContext$/ }, () => ({ path: path.resolve('supabase/tests/ui/chat_extras_auth_stub.ts') }));
  } }]
});
const bundle = readFileSync(out, 'utf8');
const cssFile = existsSync('dist/assets') ? readdirSync('dist/assets').find(f => /^index-.*\.css$/.test(f)) : null;
const css = cssFile ? readFileSync(path.join('dist/assets', cssFile), 'utf8') : '';

let passed = 0;
const check = (ok, name, extra) => { if (!ok) { console.error('not ok -', name, extra === undefined ? '' : JSON.stringify(extra)); process.exitCode = 1; throw new Error(`failed: ${name}`); } passed++; console.log('ok -', name); };
let browser;
try { browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined }); } catch (e) { console.log('SKIPPED - Chromium could not be started:', String(e.message).split('\n')[0]); process.exit(0); }
const errors = [];
const newPage = async (viewport = { width: 1280, height: 1000 }, search = '') => {
  const page = await browser.newPage({ viewport });
  page.on('pageerror', e => errors.push(e.message));
  await page.route('http://nb.test/**', route => route.fulfill({ status: 200, contentType: 'text/html',
    body: '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>' + css + '</style></head><body><div id="root"></div></body></html>' }));
  await page.goto(`http://nb.test/${search}`);
  await page.addScriptTag({ content: bundle });
  return page;
};
const mount = async (page, who) => { await page.evaluate(w => window.mount(w), who); await page.waitForSelector('nav', { state: 'attached' }); await page.waitForTimeout(250); };
const reset = page => page.evaluate(() => window.signOut());
const nav = (page, label) => page.locator('nav button', { hasText: label }).first();

// Today's Attendance Overview, as the database returns it
const OVERVIEW = {
  date: '2026-11-23', today: '2026-11-23', workingDay: true, timeZone: 'Asia/Kolkata', absentAfterMinutes: 60, generatedAt: '2026-11-23T05:30:00Z',
  totals: { total: 5, present: 2, absent: 2, onLeave: 1, notMarked: 0, late: 1 },
  departments: [{ id: 'd1', name: 'Wabastore', total: 3, present: 1, absent: 2, onLeave: 0, notMarked: 0, late: 1 }, { id: 'd2', name: 'Accounts', total: 2, present: 1, absent: 0, onLeave: 1, notMarked: 0, late: 0 }],
  rows: [
    { profileId: 'x1', name: 'Absent One', designation: 'Executive', departmentId: 'd1', department: 'Wabastore', category: 'ABSENT', late: false, lateMinutes: 0, punchInAt: null, dayStart: '10:00', leave: null },
    { profileId: 'x2', name: 'Absent Two', designation: null, departmentId: 'd1', department: 'Wabastore', category: 'ABSENT', late: false, lateMinutes: 0, punchInAt: null, dayStart: '10:00', leave: null },
    { profileId: 'x3', name: 'Leave Person', designation: null, departmentId: 'd2', department: 'Accounts', category: 'ON_LEAVE', late: false, lateMinutes: 0, punchInAt: null, dayStart: '10:00', leave: 'FULL_DAY' },
    { profileId: 'x4', name: 'Late Person', designation: null, departmentId: 'd1', department: 'Wabastore', category: 'PRESENT', late: true, lateMinutes: 25, punchInAt: '2026-11-23T04:55:00Z', dayStart: '10:00', leave: null },
    { profileId: 'x5', name: 'On Time', designation: null, departmentId: 'd2', department: 'Accounts', category: 'PRESENT', late: false, lateMinutes: 0, punchInAt: '2026-11-23T04:20:00Z', dayStart: '10:00', leave: null }
  ]
};

try {
  // ---- an employee: Notice Board in the menu, with the unread count; reading only
  let page = await newPage();
  await page.evaluate(() => window.__make({ title: 'Office closed on Friday', body: 'The office is closed this Friday for maintenance.', category: 'HOLIDAY', priority: 'URGENT',
    publisherId: '00000000-0000-4000-8000-0000000000b1', publisherName: 'Hema HR', publisherRole: 'HR' }));
  await mount(page, 'member');
  check(await nav(page, 'Notice Board').count() === 1, 'every dashboard has Notice Board in the side panel');
  check(await nav(page, 'Wallet').count() === 1, 'every employee dashboard has Wallet in the side panel (20270206000100)');
  await page.waitForFunction(() => /Notice Board\s*1/.test([...document.querySelectorAll('nav button')].find(b => /Notice Board/.test(b.textContent))?.textContent ?? ''));
  check(true, 'with the unread count');
  await nav(page, 'Notice Board').click();
  await page.waitForSelector('[data-testid="notice-board"] [data-testid="notice-card"]');
  check(!(await page.locator('[data-testid="notice-tab-SEND"]').count()), 'an employee has View Notices only (no Send Notice)');
  const card = await page.innerText('[data-testid="notice-card"]');
  check(/new/i.test(card) && /Office closed on Friday/.test(card) && /Urgent/.test(card) && /Hema HR/.test(card) && /HR/.test(card)
    && (await page.getAttribute('[data-testid="notice-card"]', 'data-read')) === 'false', 'the card: unread, title, priority, publisher', card);
  // the whole card opens it (a click on its text)
  await page.click('[data-testid="notice-card"] >> text=closed this Friday');
  await page.waitForSelector('[data-testid="notice-dialog"] [data-testid="notice-body"]');
  check(/The office is closed this Friday for maintenance\./.test(await page.innerText('[data-testid="notice-body"]')) && !(await page.locator('[data-testid="notice-receipts"]').count())
    && !(await page.locator('[data-testid="notice-edit-button"]').count()), 'opening it: the full notice; no receipts, no edit for a reader');
  await page.click('[data-testid="notice-dialog"] button:has-text("Close")');
  await page.waitForSelector('[data-testid="notice-card"][data-read="true"]');
  await page.waitForFunction(() => !/Notice Board\s*\d/.test([...document.querySelectorAll('nav button')].find(b => /Notice Board/.test(b.textContent))?.textContent ?? 'x'));
  check(true, 'now read: the card and the menu badge update');
  const denied = await page.evaluate(async () => (await fetch('/api/v1/notices', { method: 'POST', body: JSON.stringify({ title: 'x' }), headers: { 'Content-Type': 'application/json' } })).status);
  check(denied === 403, 'publishing directly is refused by the server');
  await reset(page);

  // ---- HR: Send Notice to a department, then the read receipts
  await mount(page, 'hr');
  await nav(page, 'Notice Board').click();
  await page.waitForSelector('[data-testid="notice-tab-SEND"]');
  const tabs = await page.$$eval('[data-testid="notice-board"] [role="tablist"][aria-label="Notice Board sections"] [role="tab"]', ts => ts.map(t => t.textContent));
  check(JSON.stringify(tabs) === JSON.stringify(['View Notices', 'Send Notice']), 'a publisher has View Notices and Send Notice', tabs);
  await page.click('[data-testid="notice-tab-SEND"]');
  await page.waitForSelector('[data-testid="notice-form"]');
  await page.fill('#notice-title', 'Wabastore: new leave rules');
  await page.fill('#notice-body', 'From December, apply for leave three days ahead.');
  await page.selectOption('#notice-category', 'HR');
  await page.selectOption('#notice-priority', 'IMPORTANT');
  await page.click('[data-testid="audience-DEPARTMENT"]');
  await page.click('[data-testid="publish-notice"]');
  await page.waitForSelector('text=Choose at least one department.');
  check(!(await page.evaluate(() => window.__calls.some(c => c.method === 'POST' && c.path === '/api/v1/notices'))), 'a department notice without a department is not sent');
  await page.click('[data-testid="audience-departments"] label:has-text("Wabastore")');
  await page.click('[data-testid="publish-notice"]');
  await page.waitForSelector('[data-testid="notice-sent"]');
  check(/Notice published\./.test(await page.innerText('[data-testid="notice-sent"]')) && /2 employees notified/.test(await page.innerText('[data-testid="notice-sent"]')), 'published: 2 employees notified');
  const sent = await page.evaluate(() => window.__calls.filter(c => c.method === 'POST' && c.path === '/api/v1/notices').map(c => c.body)[0]);
  check(sent.audienceType === 'DEPARTMENT' && sent.departmentIds.length === 1 && sent.priority === 'IMPORTANT' && sent.category === 'HR' && !('publisherRole' in sent) && !('publisherId' in sent),
    'the request: the audience and the notice, never who publishes', sent);
  await page.waitForSelector('[data-testid="my-notices"] [data-testid="notice-card"]:has-text("Wabastore: new leave rules")');
  check(/0\/2 read/.test(await page.innerText('[data-testid="my-notices"] [data-testid="notice-card"]:has-text("Wabastore: new leave rules")')), 'My published notices: 0/2 read');
  await page.click('[data-testid="my-notices"] [data-testid="notice-card"]:has-text("Wabastore: new leave rules")');
  await page.waitForSelector('[data-testid="notice-receipts"]');
  const rec = await page.innerText('[data-testid="notice-receipts"]');
  check(/Targeted: 2/.test(rec) && /Read: 0/.test(rec) && /Not read: 2/.test(rec) && (await page.locator('[data-testid="receipt-row"]').count()) === 2, 'the read receipts: targeted, read, not read, per person', rec);
  check(await page.isVisible('[data-testid="notice-edit-button"]') && await page.isVisible('[data-testid="notice-archive"]'), 'the publisher can edit and archive');
  const hrNotice = await page.evaluate(() => window.__notices.find(n => n.title === 'Wabastore: new leave rules').id);
  check(await page.isVisible('[data-testid="notice-delete"]'), 'and sees Delete');
  const deletes = () => page.evaluate(() => window.__calls.filter(c => c.method === 'DELETE').length);

  // ---- delete: the confirmation, Cancel, a failure, a double click, the list updating at once
  await page.click('[data-testid="notice-delete"]');
  await page.waitForSelector('[data-testid="delete-notice-dialog"]');
  const dlg = await page.innerText('[role="dialog"]:has([data-testid="delete-notice-dialog"])');
  check(/Delete Notice\?/.test(dlg) && /Are you sure you want to delete this notice\? This action cannot be undone\./.test(dlg), 'the confirmation says "Delete Notice?" and that it cannot be undone', dlg);
  check(await page.isVisible('[data-testid="cancel-delete"]') && await page.isVisible('[data-testid="confirm-delete"]'), 'with Cancel and Delete');
  check(await deletes() === 0, 'nothing is sent before Delete is pressed');
  await page.click('[data-testid="cancel-delete"]');
  check(!(await page.isVisible('[data-testid="delete-notice-dialog"]')) && await deletes() === 0, 'Cancel closes it and sends nothing');
  check(await page.isVisible('[data-testid="notice-dialog"]') && (await page.evaluate(() => window.__notices.find(n => n.title === 'Wabastore: new leave rules').status)) === 'PUBLISHED', 'the notice is still there');
  await page.evaluate(() => { window.__deleteFails = true; });
  await page.click('[data-testid="notice-delete"]');
  await page.click('[data-testid="confirm-delete"]');
  await page.waitForSelector('[data-testid="delete-notice-dialog"] [role="alert"]');
  check(/Something went wrong/.test(await page.innerText('[data-testid="delete-notice-dialog"] [role="alert"]')) && await page.isVisible('[data-testid="confirm-delete"]'), 'a failed delete shows the error and keeps the dialog');
  check((await page.evaluate(() => window.__notices.find(n => n.title === 'Wabastore: new leave rules').status)) === 'PUBLISHED' && !(await page.isVisible('[data-testid="notice-flash"]')), 'the notice stays, and no success message is shown');
  await page.evaluate(() => { window.__deleteFails = false; window.__deleteDelay = 500; });
  const before = await deletes();
  await page.dblclick('[data-testid="confirm-delete"]');
  await page.waitForSelector('[data-testid="notice-flash"]');
  check(await deletes() - before === 1, 'a double click sends one delete request');
  check(/Notice deleted\./.test(await page.innerText('[data-testid="notice-flash"]')), 'a success message is shown');
  check(!(await page.isVisible('[data-testid="notice-dialog"]')) && !(await page.isVisible('[data-testid="delete-notice-dialog"]')), 'both dialogs are closed');
  check((await page.locator('[data-testid="my-notices"] [data-testid="notice-card"]:has-text("Wabastore: new leave rules")').count()) === 0, 'the notice is gone from My published notices at once');
  await page.evaluate(() => { window.__deleteDelay = 0; });

  // from the list: the Delete button on a card (the notice's publisher), with the same confirmation
  await page.click('[data-testid="notice-flash"] button');
  check(!(await page.isVisible('[data-testid="notice-flash"]')), 'the success message can be dismissed');
  await page.evaluate(() => window.__make({ title: 'Card delete test', body: 'Text', category: 'GENERAL', priority: 'NORMAL', publisherId: window.__profile.id, publisherName: window.__profile.fullName, publisherRole: 'HR' }));
  await page.click('[data-testid="notice-tab-VIEW"]');
  await page.click('[data-testid="notice-tab-SEND"]');
  await page.waitForSelector('[data-testid="my-notices"] [data-testid="notice-card"]:has-text("Card delete test")');
  await page.click('[data-testid="my-notices"] li:has-text("Card delete test") [data-testid="notice-card-delete"]');
  await page.waitForSelector('[data-testid="delete-notice-dialog"]');
  check(/Card delete test/.test(await page.innerText('[data-testid="delete-notice-dialog"]')), 'the card button asks the same question, naming the notice');
  await page.click('[data-testid="confirm-delete"]');
  await page.waitForSelector('[data-testid="notice-flash"]');
  check((await page.locator('[data-testid="my-notices"] [data-testid="notice-card"]:has-text("Card delete test")').count()) === 0, 'and the card disappears at once');
  await page.click('[data-testid="notice-tab-VIEW"]');
  await page.click('button[aria-label="Refresh"]');
  check((await page.locator('[data-testid="notice-card"]:has-text("Card delete test")').count()) === 0 && (await page.locator('[data-testid="notice-card"]:has-text("Wabastore: new leave rules")').count()) === 0, 'deleted notices are not in View Notices either, after a refresh');
  await reset(page);

  // an employee: no Delete anywhere, and the API refuses a direct call
  await page.evaluate(() => window.__make({ title: 'Employee sees this', body: 'Please read the new leave rules before Friday.', category: 'GENERAL', priority: 'NORMAL', publisherId: '00000000-0000-4000-8000-0000000000b1', publisherName: 'Hema HR', publisherRole: 'HR' }));
  await mount(page, 'member');
  await nav(page, 'Notice Board').click();
  await page.waitForSelector('[data-testid="notice-card"]:has-text("Employee sees this")');
  check((await page.locator('[data-testid="notice-card-delete"]').count()) === 0, 'an employee has no Delete button on any card');
  await page.click('[data-testid="notice-card"]:has-text("Employee sees this")');
  await page.waitForSelector('[data-testid="notice-dialog"] [data-testid="notice-body"]');
  check(!(await page.isVisible('[data-testid="notice-delete"]')), 'nor in the notice');
  const direct = await page.evaluate(async id => { const r = await fetch(`/api/v1/notices/${id}`, { method: 'DELETE' }); return { status: r.status, still: window.__notices.find(n => n.id === id).status }; },
    await page.evaluate(() => window.__notices.find(n => n.title === 'Employee sees this').id));
  check(direct.status === 404 && direct.still === 'PUBLISHED', 'a direct DELETE by an employee is refused and the notice stays', direct);
  const gone = await page.evaluate(async id => (await fetch(`/api/v1/notices/${id}`)).status, hrNotice);
  check(gone === 404, 'a deleted notice cannot be opened by anyone');
  await reset(page);

  // ---- a notice notification opens that exact notice
  await mount(page, 'member');
  const empNotice = await page.evaluate(() => window.__notices.find(n => n.title === 'Employee sees this').id);
  await page.evaluate(id => window.openFromNotification({ type: 'COMPANY_NOTICE', entityType: 'company_notice', entityId: id }), empNotice);
  await page.waitForSelector('[data-testid="notice-dialog"] [data-testid="notice-body"]');
  check(/new leave rules before Friday/.test(await page.innerText('[data-testid="notice-body"]')), 'clicking the notification opens that notice on the Notice Board');
  await reset(page);
  await page.close();

  // ---- the Super Admin's "Look at today's attendance.": a tapped push opens Today's Attendance Overview, absent employees first
  page = await newPage(undefined, '?open=attendance&view=today');
  await page.evaluate(o => { window.__overview = o; }, OVERVIEW);
  await mount(page, 'sa');
  await page.waitForSelector('[data-testid="today-overview"] [data-testid="overview-list"]');
  check(await page.getAttribute('[role="tab"]:has-text("Today\'s overview")', 'aria-selected') === 'true', 'a tapped push opens Attendance on Today\'s overview');
  check(/Absent today \(2\)/.test(await page.innerText('[data-testid="overview-list-title"]')), 'the absent employees are shown first, straight away');
  const absent = await page.$$eval('[data-testid="overview-row"]', rs => rs.map(r => r.getAttribute('data-category') + ':' + r.querySelector('th').textContent));
  check(absent.length === 2 && absent.every(a => a.startsWith('ABSENT:')) && absent.some(a => /Absent One/.test(a)), 'the list of who is absent today', absent);
  const cards = await page.innerText('[data-testid="today-overview"] [aria-label="Summary"]');
  check(/Absent today\s*2/i.test(cards) && /Not yet marked\s*0/i.test(cards) && /On leave\s*1/i.test(cards) && /Present today\s*2/i.test(cards) && /Late arrivals\s*1/i.test(cards) && /Total employees\s*5/i.test(cards),
    'Present, Absent, On leave, Not yet marked, Late and Total', cards);
  check((await page.locator('[data-testid="overview-departments"] tbody tr').count()) === 2, 'and the department-wise summary');
  await page.click('[data-testid="overview-card-LATE"]');
  await page.waitForSelector('[data-testid="overview-list-title"]:has-text("Late arrivals (1)")');
  check(/Late 25 min/.test(await page.innerText('[data-testid="overview-list"]')), 'Late arrivals, with how late');
  check(await page.evaluate(() => window.__rpc.some(r => r.fn === 'attendance_today_overview')), 'read from the database (attendance_today_overview)');
  check(!/open=attendance/.test(await page.evaluate(() => location.search)), 'the address is cleaned (a reload does not reopen it)');
  await reset(page);
  // ... and from the bell
  await mount(page, 'sa');
  await page.evaluate(() => window.openFromNotification({ type: 'SA_ATTENDANCE_OVERVIEW', entityType: 'attendance_overview', entityId: null }));
  await page.waitForSelector('[data-testid="today-overview"] [data-testid="overview-list-title"]:has-text("Absent today")');
  check(true, 'clicking "Look at today\'s attendance." in the bell opens the same overview');
  await reset(page);
  // an employee's Attendance has no overview
  await mount(page, 'member');
  await nav(page, 'Attendance').click();
  await page.waitForTimeout(400);
  check(!(await page.locator('[role="tab"]:has-text("Today\'s overview")').count()), 'an employee has no Today\'s overview');
  await page.close();

  // ---- phone width
  const phone = await newPage({ width: 360, height: 740 });
  await phone.evaluate(() => window.__make({ title: 'A notice for phones', body: 'Short text.', category: 'GENERAL', priority: 'NORMAL', publisherId: 'x', publisherName: 'Asha CEO', publisherRole: 'SUPER_ADMIN' }));
  await mount(phone, 'hr');
  await phone.evaluate(() => window.openFromNotification({ type: 'COMPANY_NOTICE', entityType: 'company_notice', entityId: null }));
  await phone.waitForSelector('[data-testid="notice-board"]');
  await phone.click('[data-testid="notice-tab-SEND"]');
  await phone.waitForSelector('[data-testid="notice-form"]');
  const m = await phone.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth }));
  check(m.sw <= m.iw + 1, 'phone width: the Notice Board and its form fit', m);
  await phone.close();
  check(errors.length === 0, 'no script errors', errors);
} finally {
  await browser.close();
}
console.log(`=== NOTICE BOARD BROWSER TESTS PASSED (${passed}) ===`);
