// Lead tags on leads, with a stubbed API (page.route): the lead form's "Tag" select (grouped by stage, active tags only, the lead's
// department), what a save sends (leadStatus = the tag's stage, then the tag), the "Moves to Potential" prompt following the tag's
// stage, a retired tag shown but not offered, the chip on the Leads list and its "Tag" filter, and no sideways scroll at 360px.
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
let chromium;
for (const p of ['playwright', '/opt/node-tools/node_modules/playwright', 'playwright-core']) {
  try { ({ chromium } = require(p)); break; } catch { /* next */ }
}
if (!chromium) { console.log('SKIPPED - Playwright is not installed, the lead tag form browser test did not run'); process.exit(0); }
const stub = new URL('./ui/staff_forgot_stubs.ts', import.meta.url).pathname;
const authStub = new URL('./ui/lead_upload_auth_stub.tsx', import.meta.url).pathname;
const built = await build({
  entryPoints: ['supabase/tests/ui/lead_tag_form_harness.tsx'], bundle: true, format: 'iife', platform: 'browser', write: false, jsx: 'automatic', logLevel: 'error',
  define: { 'import.meta.env': JSON.stringify({}) }, loader: { '.css': 'empty' },
  plugins: [{ name: 'stub-supabase', setup(b) { b.onResolve({ filter: /services\/supabaseClient$/ }, () => ({ path: stub })); b.onResolve({ filter: /context\/AuthContext$/ }, () => ({ path: authStub })); } }]
});
const bundle = built.outputFiles[0].text;
const cssFile = existsSync('dist/assets') ? readdirSync('dist/assets').find(f => /^index-.*\.css$/.test(f)) : null;
const css = cssFile ? readFileSync(`dist/assets/${cssFile}`, 'utf8') : '';
const srv = createServer((req, res) => {
  if (req.url === '/app.js') { res.writeHead(200, { 'Content-Type': 'application/javascript' }); return res.end(bundle); }
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script src="/app.js"></script>`);
});
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${srv.address().port}`;

const tag = (o) => ({ colour: 'slate', scope: 'COMPANY', departmentIds: [], retired: false, seed: false, leadCount: 0, canManage: false, ...o });
// as lead_tags_list answers a team member: the department's active tags and its retired ones (marked), never another department's
const TAGS = [
  tag({ id: 'n1', label: 'New', stage: 'NEW', seed: true }),
  tag({ id: 'c1', label: 'Contacted', colour: 'blue', stage: 'CONTACTED', seed: true }),
  tag({ id: 'noresp', label: 'No response / unreachable', colour: 'amber', stage: 'CONTACTED' }),
  tag({ id: 'old', label: 'Old campaign', colour: 'orange', stage: 'CONTACTED', retired: true }),
  tag({ id: 'i1', label: 'Interested', colour: 'indigo', stage: 'INTERESTED', seed: true }),
  tag({ id: 'demo', label: 'Demo done', colour: 'violet', stage: 'INTERESTED' }),
  tag({ id: 'r1', label: 'Ready to buy', colour: 'green', stage: 'READY_TO_BUY', seed: true }),
  tag({ id: 'hot', label: 'Wants invoice', colour: 'red', stage: 'READY_TO_BUY', scope: 'DEPARTMENTS', departmentIds: ['d1'] })
];
const byId = new Map(TAGS.map(t => [t.id, t]));
const L1 = '00000000-0000-4000-8000-0000000000a1';
const L2 = '00000000-0000-4000-8000-0000000000a2';
const L3 = '00000000-0000-4000-8000-0000000000a3';
const NEW_ID = '00000000-0000-4000-8000-0000000000a9';
const leadRow = (o) => ({
  name: 'Kavya Nair', company: 'Nair Bakes', phone: '+91 98470 12345', whatsapp: null, email: null, city: 'Kochi', address: null, businessCategory: null,
  leadSource: 'Walk-in', lifecycleStage: 'LEAD', services: ['AI_CALLING'], nextFollowUpAt: null, notes: null, expectedBudget: null, dealAmount: null,
  amountReceived: 0, amountVerified: 0, paymentStatus: 'NO_PAYMENT', paymentWorkflow: 'NONE', paymentDueDate: null, owner: { id: 'u1', fullName: 'Sales Person' },
  createdBy: { id: 'u1', fullName: 'Sales Person' }, ownerId: 'u1', teamId: 't1', departmentId: 'd1', stageChangedAt: '2026-11-01T10:00:00Z',
  createdAt: '2026-11-01T10:00:00Z', updatedAt: '2026-11-01T10:00:00Z', onboarding: null,
  documents: [], documentTypes: [], activities: [], conversations: [], checklist: [], handover: null, ...o
});
const ok = (data, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(status < 400 ? { success: true, data } : { success: false, error: data }) });

let passed = 0;
const check = (cond, name, extra) => { if (!cond) { console.error('not ok -', name, extra === undefined ? '' : JSON.stringify(extra)); process.exitCode = 1; throw new Error(`failed: ${name}`); } passed++; console.log('ok -', name); };
let browser;
try { browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined }); } catch (e) { console.log('SKIPPED - Chromium could not be started:', String(e.message).split('\n')[0]); srv.close(); process.exit(0); }

/** A page whose API answers from `leads` (a stand-in for the database: setting a tag sets the stage, writing another stage re-seeds). */
async function open(mount, arg, viewport = { width: 1280, height: 1000 }, { rejectTag = false } = {}) {
  const leads = new Map([
    [L1, leadRow({ id: L1, leadStatus: 'CONTACTED', leadTagId: 'c1' })],
    [L2, leadRow({ id: L2, name: 'Arun Das', company: 'Das Tiles', leadStatus: 'CONTACTED', leadTagId: 'old' })],
    // a retired tag a non-manager is no longer sent
    [L3, leadRow({ id: L3, name: 'Ravi Menon', company: 'Menon Motors', leadStatus: 'INTERESTED', leadTagId: 'gone' })]
  ]);
  const calls = [];
  const page = await browser.newPage({ viewport });
  page.on('pageerror', e => { console.error('page error:', e.message); process.exitCode = 1; });
  await page.route('**/api/v1/**', async r => {
    const req = r.request();
    const url = new URL(req.url());
    const p = url.pathname.replace('/api/v1', '');
    const method = req.method();
    const body = req.postData() ? JSON.parse(req.postData()) : undefined;
    calls.push({ method, path: p, query: Object.fromEntries(url.searchParams), body });
    if (p === '/lead-tags' && method === 'GET') return r.fulfill(ok(TAGS));
    if (p === '/pipeline/services') return r.fulfill(ok([{ code: 'AI_CALLING', name: 'AI Calling', category: 'Messaging & AI' }]));
    if (p === '/pipeline/customers' && method === 'GET') {
      const items = [...leads.values()].filter(l => l.id !== L3).filter(l => !url.searchParams.get('leadTagId') || l.leadTagId === url.searchParams.get('leadTagId'));
      return r.fulfill(ok({ items, page: 1, pageSize: 10, total: items.length }));
    }
    const m = p.match(/^\/pipeline\/(customers|leads)\/([^/]+)(\/tag)?$/);
    if (m && m[1] === 'customers' && !m[3] && method === 'GET' && leads.has(m[2])) return r.fulfill(ok(leads.get(m[2])));
    if (m && m[1] === 'leads' && !m[3] && method === 'PATCH' && leads.has(m[2])) {
      const l = { ...leads.get(m[2]), ...body };
      if (body.leadStatus && body.leadStatus !== byId.get(l.leadTagId)?.stage) l.leadTagId = TAGS.find(t => t.seed && t.stage === body.leadStatus).id;
      leads.set(m[2], l);
      return r.fulfill(ok(l));
    }
    if (m && m[3] && method === 'POST') {
      if (rejectTag) return r.fulfill(ok({ code: 'VALIDATION_ERROR', message: "That tag can't be used in this lead's department." }, 422));
      if (!leads.has(m[2])) leads.set(m[2], leadRow({ id: m[2] }));
      const l = { ...leads.get(m[2]), leadTagId: body.tagId, leadStatus: byId.get(body.tagId).stage };
      leads.set(m[2], l);
      return r.fulfill(ok({ id: m[2], tagId: body.tagId }));
    }
    if (p === '/pipeline/leads' && method === 'POST') { leads.set(NEW_ID, leadRow({ id: NEW_ID, name: body.name, leadStatus: body.leadStatus, leadTagId: null })); return r.fulfill(ok(leads.get(NEW_ID), 201)); }
    return r.fulfill(ok({ code: 'NOT_FOUND', message: 'Not found.' }, 404));
  });
  await page.goto(base);
  await page.evaluate(([fn, a]) => window[fn](a), [mount, arg]);
  return { page, calls, leads };
}
const writes = calls => calls.filter(c => c.method !== 'GET' && c.path.startsWith('/pipeline/leads'));

try {
  // ---- The lead page
  {
    const { page, calls, leads } = await open('mountEdit', L1);
    const select = page.getByLabel('Tag', { exact: true });
    await select.waitFor();
    check(calls.some(c => c.path === '/lead-tags' && c.query.departmentId === 'd1'), 'the tags are those visible in the lead\'s department', calls.filter(c => c.path === '/lead-tags'));
    const groups = await select.locator('optgroup').evaluateAll(gs => gs.map(g => g.label));
    check(JSON.stringify(groups) === JSON.stringify(['New', 'Contacted', 'Interested', 'Ready to buy']), 'the "Tag" select is grouped by stage', groups);
    const labels = await select.locator('option').allInnerTexts();
    check(labels.some(l => /Demo done/.test(l)) && !labels.some(l => /Old campaign/.test(l)), 'only active tags are offered', labels);
    check(await select.inputValue() === 'c1', 'it starts on the lead\'s tag');

    await select.selectOption('demo');
    check(await page.getByRole('button', { name: /^Interested - / }).getAttribute('aria-pressed') === 'true', 'choosing a tag moves the stage steps to the tag\'s stage');
    check(await page.getByTestId('lead-tag-current').getByText('Demo done').isVisible(), 'the chosen tag is shown as a chip');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await page.getByText('Changes saved.').waitFor();
    const w = writes(calls);
    check(w.length === 2 && w[0].method === 'PATCH' && w[0].body.leadStatus === 'INTERESTED' && w[1].path === `/pipeline/leads/${L1}/tag` && w[1].body.tagId === 'demo',
      'a save sends leadStatus = the tag\'s stage, then the tag', w);
    check(leads.get(L1).leadTagId === 'demo' && leads.get(L1).leadStatus === 'INTERESTED', 'the lead keeps the chosen tag');
    check(await select.inputValue() === 'demo', 'after the save the form shows the saved tag');

    // READY_TO_BUY follows the tag's stage
    await select.selectOption('hot');
    check(await page.getByText('Kavya is ready to buy').isVisible() && await page.getByRole('button', { name: /Save & move to Potential/ }).isVisible(),
      'a tag counting as Ready to buy shows the "Moves to Potential" prompt');
    await select.selectOption('noresp');
    check(await page.getByText('Kavya is ready to buy').count() === 0, 'a tag of another stage does not');

    // tapping a stage step chooses that stage's basic tag
    await page.getByRole('button', { name: /^New - / }).click();
    check(await select.inputValue() === 'n1', 'tapping a stage step chooses the basic tag of that stage');
    await page.close();
  }

  // ---- A lead whose tag was retired
  {
    const { page, calls } = await open('mountEdit', L2);
    const select = page.getByLabel('Tag', { exact: true });
    await select.waitFor();
    const chip = page.getByTestId('lead-tag-current').getByTestId('tag-chip');
    check(/Old campaign/.test(await chip.innerText()) && /opacity-60/.test(await chip.getAttribute('class')), 'a retired tag is still shown with its real label, in the retired style');
    const headerChip = page.locator('h1').locator('..').getByTestId('tag-chip');
    check(/Old campaign/.test(await headerChip.innerText()) && /opacity-60/.test(await headerChip.getAttribute('class')), 'and in the lead page header');
    const opt = select.locator('option[value="old"]');
    check(await opt.count() === 1 && await opt.isDisabled(), 'the retired tag is not offered for a new choice');
    await select.selectOption('noresp');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await page.getByText('Changes saved.').waitFor();
    const w = writes(calls);
    check(w.length === 1 && w[0].path === `/pipeline/leads/${L2}/tag` && w[0].body.tagId === 'noresp', 'a tag of the same stage is sent alone (the stage is unchanged)', w);
    await page.close();
  }

  // ---- A lead whose retired tag is not in the list any more
  {
    const { page } = await open('mountEdit', L3);
    const select = page.getByLabel('Tag', { exact: true });
    await select.waitFor();
    const chip = page.getByTestId('lead-tag-current').getByTestId('tag-chip');
    check(/Retired tag/.test(await chip.innerText()) && /opacity-60/.test(await chip.getAttribute('class')) && await select.locator('option[value="gone"]').isDisabled(),
      'a tag no longer listed is shown as a retired tag and cannot be chosen again');
    await page.close();
  }

  // ---- Add lead
  {
    const { page, calls } = await open('mountAdd');
    const select = page.getByLabel('Tag', { exact: true });
    await select.waitFor();
    await page.getByText('AI Calling', { exact: true }).first().waitFor();
    check(await select.inputValue() === 'n1', 'a new lead starts on the basic "New" tag');
    const labels = await select.locator('option').allInnerTexts();
    check(!labels.some(l => /Old campaign/.test(l)), 'a new lead is never offered a retired tag', labels);
    await page.fill('#lead-name', 'Meera Pillai');
    await page.fill('#lead-company', 'Pillai Prints');
    await page.fill('#lead-phone', '+91 98470 54321');
    await page.getByText('AI Calling', { exact: true }).first().click();
    await page.fill('#terms-AI_CALLING-plan', 'Starter');
    await page.selectOption('#terms-AI_CALLING-duration', { index: 1 });
    await page.fill('#terms-AI_CALLING-amount', '3999');
    await select.selectOption('demo');
    await page.click('button[type="submit"]');
    await page.waitForFunction(() => window.__saved.length === 1, null, { timeout: 5000 });
    const w = writes(calls);
    check(w.length === 2 && w[0].path === '/pipeline/leads' && w[0].body.leadStatus === 'INTERESTED' && w[1].path === `/pipeline/leads/${NEW_ID}/tag` && w[1].body.tagId === 'demo',
      'Add lead sends leadStatus = the tag\'s stage, then the tag', w);
    await page.close();
  }

  // ---- Add lead: a tag the database refuses does not lose the lead
  {
    const { page, calls } = await open('mountAdd', undefined, undefined, { rejectTag: true });
    const select = page.getByLabel('Tag', { exact: true });
    await select.waitFor();
    await page.getByText('AI Calling', { exact: true }).first().waitFor();
    await page.fill('#lead-name', 'Meera Pillai');
    await page.fill('#lead-company', 'Pillai Prints');
    await page.fill('#lead-phone', '+91 98470 54321');
    await page.getByText('AI Calling', { exact: true }).first().click();
    await page.fill('#terms-AI_CALLING-plan', 'Starter');
    await page.selectOption('#terms-AI_CALLING-duration', { index: 1 });
    await page.fill('#terms-AI_CALLING-amount', '3999');
    await select.selectOption('demo');
    await page.click('button[type="submit"]');
    await page.waitForFunction(() => window.__saved.length === 1, null, { timeout: 5000 });
    await page.getByText(/The lead was saved, but the tag "Demo done" could not be set/).waitFor();
    check(writes(calls).filter(c => c.path === '/pipeline/leads').length === 1, 'a refused tag: the lead is saved once and the refusal is shown');
    await page.close();
  }

  // ---- The Leads list: the chip and the "Tag" filter
  {
    const { page, calls, leads } = await open('mountList');
    leads.set(L1, { ...leads.get(L1), leadTagId: 'demo', leadStatus: 'INTERESTED' });
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('crm:pipeline-changed')));
    const row = page.getByRole('row').filter({ hasText: 'Kavya Nair' });
    await row.getByText('Demo done').waitFor();
    check(await row.getByTestId('tag-chip').count() === 1, 'a lead with a tag shows its chip on the list');
    const retiredChip = page.getByRole('row').filter({ hasText: 'Arun Das' }).getByTestId('tag-chip');
    check(/Old campaign/.test(await retiredChip.innerText()) && /opacity-60/.test(await retiredChip.getAttribute('class')),
      'a lead whose tag was retired shows its real label on the list, as a faded chip');
    const filter = page.getByLabel('Filter by tag');
    check(await filter.locator('optgroup').count() === 4, 'the "Tag" filter is grouped by stage');
    await filter.selectOption('demo');
    await page.waitForFunction(() => document.querySelectorAll('tbody tr').length === 1);
    check(calls.some(c => c.path === '/pipeline/customers' && c.query.leadTagId === 'demo'), 'filtering by tag asks for leads with that tag');
    await page.close();
  }

  // ---- 360px
  for (const [mount, arg] of [['mountEdit', L1], ['mountAdd'], ['mountList']]) {
    const { page } = await open(mount, arg, { width: 360, height: 740 });
    await page.getByLabel(mount === 'mountList' ? 'Filter by tag' : 'Tag', { exact: true }).waitFor();
    check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `no sideways scroll at 360px (${mount})`);
    await page.close();
  }
} finally {
  await browser.close();
  srv.close();
}
console.log(`=== LEAD TAG FORM BROWSER TESTS PASSED (${passed}) ===`);
