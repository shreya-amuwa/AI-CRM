// Post-meeting summaries and the CEO's Meeting Decisions (migration 20270124000200), in real browsers against the local stack.
//   - a Team Lead's team meeting has taken place: the Team Lead confirms who attended, is made responsible, and submits the summary from
//     the meeting drawer (no plain "Mark done" for a team meeting)
//   - the member given an action item sees it in Meeting summaries
//   - the CEO (Super Admin) sees the outcome in Meeting Decisions, opens the report and asks for a clarification; on a phone too
// See supabase/tests/e2e/README.md. Passwords come from E2E_PASSWORDS (made up by the runner); nothing is stored.
import { createRequire } from 'node:module';
import pg from 'pg';

const require = createRequire(import.meta.url);
let chromium;
for (const p of ['playwright-core', '/opt/node-tools/node_modules/playwright-core', 'playwright']) {
  try { ({ chromium } = require(p)); break; } catch { /* try the next */ }
}
if (!chromium) { console.log('SKIPPED - Playwright is not installed, the meeting summaries browser test did not run'); process.exit(0); }

const BASE = process.env.E2E_BASE || 'http://localhost:3010';
const OUT = process.argv[2] || '.';
const PASSWORDS = JSON.parse(process.env.E2E_PASSWORDS || '{}');
const pwOf = email => { if (!PASSWORDS[email]) throw new Error(`E2E_PASSWORDS has no password for ${email}`); return PASSWORDS[email]; };
const db = new pg.Pool();
const q = async (sql, args = []) => (await db.query(sql, args)).rows;
const idOf = async e => (await q('select id from public.profiles where email=$1', [e]))[0].id;

const browser = await chromium.launch(process.env.E2E_CHROMIUM ? { executablePath: process.env.E2E_CHROMIUM } : {}).catch(async () => chromium.launch());
let step = 0;
const ok = m => console.log(`ok ${++step} - ${m}`);
const errors = [];
let current;
const fail = async m => {
  await current?.screenshot({ path: `${OUT}/meeting-summaries-fail.png`, fullPage: true }).catch(() => {});
  console.error('FAILED:', m, errors.length ? JSON.stringify(errors.slice(-5)) : '');
  await browser.close();
  process.exit(1);
};
const expect = async (c, m) => (c ? ok(m) : fail(m));
const login = async (email, ready, viewport = { width: 1440, height: 900 }) => {
  const ctx = await browser.newContext({ viewport });
  const p = await ctx.newPage();
  p.on('pageerror', e => errors.push('pageerror: ' + e.message));
  current = p;
  await p.goto(BASE + '/login');
  await p.getByPlaceholder('name@amuwa.com').fill(email);
  await p.locator('input[type="password"]').first().fill(pwOf(email));
  await p.locator('form button[type="submit"]').click();
  await p.waitForSelector(ready, { timeout: 25000 }).catch(() => fail(`${email} did not reach the expected dashboard (${ready})`));
  return p;
};
const navItem = (p, label) => p.locator('nav button').filter({ has: p.locator('span', { hasText: new RegExp(`^${label}$`) }) }).first();
const menu = async (p, label) => {
  if ((p.viewportSize()?.width ?? 1440) < 1024) { await p.getByRole('button', { name: 'Toggle menu' }).click(); await new Promise(r => setTimeout(r, 350)); }
  await navItem(p, label).click();
};
const meetingsTab = async (p, label) => {
  await menu(p, 'Meetings');
  await p.getByRole('tab', { name: new RegExp(`^${label}`) }).click();
};

// ------------------------------------------------------------------ fixture: a team meeting that took place two hours ago
const lead = await idOf('lead@amuwa.com'), rahul = await idOf('rahul@amuwa.com'), neha = await idOf('neha@amuwa.com');
const [{ id: meetingId }] = await q(`insert into public.meetings (kind, title, description, host_id, created_by, starts_at, ends_at, status, booked_via, google_sync_status)
  values ('MEETING', 'Weekly Sales Review', 'Review weekly sales and follow-up performance.', $1, $1, now() - interval '2 hours', now() - interval '1 hour',
          'SCHEDULED', 'STAFF', 'SKIPPED') returning id`, [lead]);
await q(`insert into public.meeting_attendees (meeting_id, profile_id, role, response) values ($1, $2, 'REQUIRED', 'ACCEPTED'), ($1, $3, 'REQUIRED', 'NEEDS_ACTION')`,
  [meetingId, rahul, neha]);

// ------------------------------------------------------------------ the Team Lead: attendance, then the summary
const tl = await login('lead@amuwa.com', 'nav button:has-text("Team Customers")');
await meetingsTab(tl, 'Meeting summaries');
await tl.getByRole('button', { name: 'Confirm attendance' }).first().click().catch(() => fail('the pending summary is not listed for the Team Lead'));
const drawer = tl.getByRole('dialog');
await drawer.getByText('Who attended?').waitFor({ timeout: 15000 }).catch(() => fail('the attendance form did not open in the meeting drawer'));
await expect(await drawer.getByRole('button', { name: 'Mark done' }).count() === 0, 'a team meeting has no plain "Mark done"');
// Rahul attended, Neha did not (she never answered: an invitation is not attendance)
await expect(!(await drawer.getByRole('checkbox', { name: /Neha Shah/ }).isChecked()), 'only people who accepted are pre-ticked');
await drawer.getByRole('button', { name: 'Confirm attendance' }).click();
await drawer.getByText(/Responsible:\s*Lead Person/).waitFor({ timeout: 15000 }).catch(() => fail('the Team Lead was not made responsible'));
ok('attendance confirmed; the Team Lead who attended is responsible');
await drawer.getByText('Meeting completed. Please document the decisions and next steps.').waitFor();
await drawer.getByRole('button', { name: 'Submit Meeting Summary' }).click();
const form = drawer.getByRole('form', { name: 'Meeting summary form' });
await form.getByText('Review weekly sales and follow-up performance.').waitFor().catch(() => fail('the agenda is not filled in from the meeting'));
ok('the form shows the meeting, its agenda and who attended, without retyping');
await form.getByRole('button', { name: 'Submit summary' }).click();
await drawer.getByText(/Write the executive summary/).waitFor().catch(() => fail('a blank summary was not refused'));
ok('a blank executive summary is refused');
await form.getByLabel('Executive summary (required)').fill('Reviewed the weekly Sales performance, found delayed lead follow-ups and agreed on a daily review.');
await form.getByRole('button', { name: 'Add a decision' }).click();
await form.getByLabel('Decision 1 title').fill('Daily lead follow-up review');
await form.getByLabel('Decision 1 description').fill('Pending follow-ups are reviewed at the start and end of each day.');
await form.getByRole('button', { name: 'Add an action item' }).click();
await form.getByLabel('Action 1 title').fill('Review all pending November leads');
await form.getByLabel('Action 1 responsible employee').selectOption({ label: 'Rahul Mehta (Team Member)' });
await form.getByLabel('Action 1 priority').selectOption('HIGH');
await form.getByLabel('No blockers').check();
await form.getByLabel('Next steps and intended outcomes').fill('Track the daily review for two weeks.');
await tl.screenshot({ path: `${OUT}/meeting-summary-form.png`, fullPage: true });
await form.getByRole('button', { name: 'Submit summary' }).click();
await drawer.getByText(/Summary submitted/).first().waitFor({ timeout: 15000 }).catch(() => fail('the summary was not submitted'));
await expect((await q('select status from public.meetings where id = $1', [meetingId]))[0].status === 'COMPLETED', 'submitted: the meeting is completed with it');
await expect(await drawer.getByText('Daily lead follow-up review').count() > 0, 'the drawer shows the submitted report');

// ------------------------------------------------------------------ the member with the action item
const tm = await login('rahul@amuwa.com', 'nav button:has-text("Meetings")');
await meetingsTab(tm, 'Meeting summaries');
await tm.getByText('Review all pending November leads').waitFor({ timeout: 15000 }).catch(() => fail('the action item is not shown to its assignee'));
ok('the member sees the action item given to them');

// ------------------------------------------------------------------ the CEO
const sa = await login('root@amuwa.com', 'nav button:has-text("Meetings")');
await meetingsTab(sa, 'Meeting Decisions');
const overview = sa.locator('section[aria-label="Executive overview"]');
await overview.waitFor({ timeout: 15000 });
await sa.getByRole('button', { name: 'View Report' }).first().waitFor({ timeout: 15000 }).catch(() => fail('the report is not listed in Meeting Decisions'));
await expect(/Summaries submitted\s*1/.test(await overview.innerText()), 'the overview counts the submitted summary');
await expect(await sa.locator('section[aria-label="Latest decisions"]').getByText('Daily lead follow-up review').count() === 1, 'the decision is in Latest decisions');
await sa.screenshot({ path: `${OUT}/meeting-decisions.png`, fullPage: true });
await sa.getByRole('button', { name: 'View Report' }).first().click();
const report = sa.getByRole('dialog');
await report.getByText('Key decisions').waitFor({ timeout: 15000 }).catch(() => fail('the report did not open'));
const rtext = await report.innerText();
await expect(/Led by\s*Lead Person/.test(rtext) && /1\. Daily lead follow-up review/.test(rtext) && /Rahul Mehta/.test(rtext) && /No blockers/.test(rtext),
  'the report: led by, numbered decisions, the action item with its assignee, blockers');
await expect(!/@amuwa\.com|meet\.google/.test(rtext), 'without e-mails or meeting links');
await report.getByLabel('Ask for a clarification').fill('Who reviews the weekend leads?');
await report.getByRole('button', { name: 'Request clarification' }).click();
await report.getByText('Clarification requested').first().waitFor({ timeout: 15000 }).catch(() => fail('the clarification was not recorded'));
ok('the CEO asks for a clarification; the report is kept as submitted');

const phone = await login('root@amuwa.com', 'button[aria-label="Toggle menu"]', { width: 390, height: 844 });
await meetingsTab(phone, 'Meeting Decisions');
await phone.locator('section[aria-label="Executive overview"]').waitFor({ timeout: 15000 });
await expect(await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'no sideways scroll on a phone (390px)');
await phone.screenshot({ path: `${OUT}/meeting-decisions-phone.png`, fullPage: true });
await expect(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);

await browser.close();
await db.end();
console.log(`=== MEETING SUMMARIES BROWSER TESTS PASSED (${step}) ===`);
