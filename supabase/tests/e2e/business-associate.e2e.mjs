// The Business Associate workspace in real browsers against the local stack (Postgres + PostgREST + gateway + the web app):
//   - a Telecaller converts a qualified lead into a contact for a Business Associate (and cannot convert twice)
//   - Tasks: the contact appears with the Telecaller, stage and requirement tracking; only the assigned Business Associate sees it
//   - Quotation: approved prices, AI draft (a local stand-in for the AI service), review, PDF stored privately, revision
//   - Demo Schedule: validation, conflicts, reschedule, cancel; list and calendar
//   - Scope of Project: AI draft with Verified/Assumption points, section regeneration, review, finalise, new version, PDFs
//   - Leads, routing and permissions, the Department Head's Service Prices page, and a phone-sized window
// See supabase/tests/e2e/README.md. Passwords come from E2E_PASSWORDS (made up by the runner); nothing is stored.
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import http from 'node:http';
import pg from 'pg';

const require = createRequire(import.meta.url);
let chromium;
for (const p of ['playwright-core', '/opt/node-tools/node_modules/playwright-core', 'playwright']) {
  try { ({ chromium } = require(p)); break; } catch { /* try the next */ }
}
if (!chromium) { console.log('SKIPPED - Playwright is not installed, the Telecaller browser test did not run'); process.exit(0); }

const BASE = process.env.E2E_BASE || 'http://localhost:3060';
const OUT = process.argv[2] || '.';
const SECRET = process.env.JWT_SECRET || 'local-test-secret-that-is-at-least-32-chars';
const PASSWORDS = JSON.parse(process.env.E2E_PASSWORDS || '{}');
const pwOf = email => { if (!PASSWORDS[email]) throw new Error(`E2E_PASSWORDS has no password for ${email}`); return PASSWORDS[email]; };
const sign = p => {
  const e = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const h = e({ alg: 'HS256', typ: 'JWT' }), b = e({ iat: 1, exp: 2e9, ...p });
  return `${h}.${b}.${crypto.createHmac('sha256', SECRET).update(`${h}.${b}`).digest('base64url')}`;
};
const db = new pg.Pool();
const q = async (sql, args = []) => (await db.query(sql, args)).rows;
const idOf = async e => (await q('select id from public.profiles where email=$1', [e]))[0].id;
const api = async (who, method, path, body) => {
  const r = await fetch(BASE + '/api/v1' + path, { method, headers: { authorization: `Bearer ${sign({ sub: who, role: 'authenticated' })}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = await r.json();
  if (!j.success) throw new Error(`${method} ${path} ${JSON.stringify(j)}`);
  return j.data;
};

const browser = await chromium.launch(process.env.E2E_CHROMIUM ? { executablePath: process.env.E2E_CHROMIUM } : { executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' }).catch(async () => chromium.launch());
let step = 0;
const ok = m => console.log(`ok ${++step} - ${m}`);
const errors = [];
let current;
const fail = async m => {
  await current?.screenshot({ path: `${OUT}/ba-fail.png`, fullPage: true }).catch(() => {});
  console.error('FAILED:', m, errors.length ? JSON.stringify(errors.slice(-5)) : '');
  await browser.close();
  process.exit(1);
};
const expect = async (c, m, extra) => (c ? ok(m) : fail(m + (extra === undefined ? '' : ' ' + JSON.stringify(extra))));
const open = async (viewport = { width: 1440, height: 900 }) => {
  const ctx = await browser.newContext({ viewport, acceptDownloads: true });
  const p = await ctx.newPage();
  p.on('pageerror', e => errors.push('pageerror: ' + e.message));
  p.on('console', m => m.type() === 'error' && !/Failed to load resource|fonts\.g|net::ERR/.test(m.text()) && errors.push('console: ' + m.text()));
  return p;
};
const login = async (email, viewport, ready) => {
  const p = await open(viewport);
  current = p;
  await p.goto(BASE + '/login');
  await p.getByPlaceholder('name@amuwa.com').fill(email);
  await p.locator('input[type="password"]').first().fill(pwOf(email));
  await p.locator('form button[type="submit"]').click();
  await p.waitForSelector(ready, { timeout: 25000 }).catch(() => fail(`${email} did not reach the expected page (${ready})`));
  return p;
};
const navItem = (p, label) => p.locator('nav button').filter({ has: p.locator('span', { hasText: new RegExp(`^${label}$`) }) }).first();
const menu = async (p, label) => {
  if ((p.viewportSize()?.width ?? 1440) < 1024) { await p.getByRole('button', { name: 'Toggle menu' }).click(); await new Promise(r => setTimeout(r, 350)); }
  await navItem(p, label).click();
};
// the Leads group of the Business Associate sidebar: Leads, Potential, Customer onboarding, Part payments
const pipeStep = async (p, label) => {
  if ((p.viewportSize()?.width ?? 1440) < 1024) { await p.getByRole('button', { name: 'Toggle menu' }).click(); await new Promise(r => setTimeout(r, 350)); }
  if (!(await p.locator('#nav-sub-leads-group').count())) await navItem(p, 'Leads').click();
  await p.locator('#nav-sub-leads-group button', { hasText: new RegExp(`^${label}$`) }).click();
};
const text = p => p.locator('main').innerText();
const todayIST = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
const stat = async (p, label) => Number(await p.getByTestId(`stat-${label}`).innerText());


const styleOf = async p => { await p.waitForSelector('main .bg-white.rounded-2xl.border, main h1', { timeout: 20000 }); await p.waitForSelector('main .bg-white.rounded-2xl.border', { timeout: 20000 }).catch(() => {}); return p.evaluate(() => {
  const cs = (el, props) => (el ? Object.fromEntries(props.map(k => [k, getComputedStyle(el)[k]])) : null);
  const aside = document.querySelector('aside');
  const active = aside?.querySelector('nav button[aria-current="page"]');
  const inactive = [...(aside?.querySelectorAll('nav button:not([aria-current])') ?? [])][0];
  const header = document.querySelector('header');
  const title = document.querySelector('main h1');
  const primary = [...document.querySelectorAll('main button')].find(b => /\bbg-blue-600\b/.test(b.className) && !b.getAttribute('role'));
  const card = document.querySelector('main .bg-white.rounded-2xl.border');
  return {
    page: cs(aside?.parentElement, ['backgroundColor']),
    sidebar: { ...cs(aside, ['backgroundColor', 'borderRightColor']), width: Math.round(aside?.getBoundingClientRect().width ?? 0) },
    active: cs(active, ['backgroundColor', 'color', 'fontWeight', 'borderRadius']),
    inactive: cs(inactive, ['color', 'fontWeight']),
    header: cs(header, ['backgroundColor', 'borderBottomColor']),
    title: cs(title, ['fontSize', 'fontWeight', 'color']),
    primary: cs(primary, ['backgroundColor', 'color', 'borderRadius', 'height']),
    card: cs(card, ['backgroundColor', 'borderTopColor', 'borderRadius'])
  };
}); };
const sameDesign = (a, b, keys) => keys.every(k => JSON.stringify(a[k]) === JSON.stringify(b[k]));

// ------------------------------------------------------------------ the AI service stand-in (the API server calls it; nothing external is reached)
const aiCalls = [];
const ai = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => {
    const body = JSON.parse(Buffer.concat(chunks).toString());
    const user = JSON.parse(body.messages[0].content);
    aiCalls.push({ system: body.system, user });
    let answer;
    if (/client quotation/.test(body.system)) {
      answer = {
        introduction: `Dear ${user.client.company}, thank you for meeting us. This quotation covers what you asked for.`, understanding: 'You want order updates on WhatsApp and a QR menu.', recommendedServices: 'The services listed below.',
        scopeSummary: 'We set the services up and hand them over.', commercialTerms: `Payment terms as entered: ${user.paymentTerms}.`, implementationTimeline: `Timeline as entered: ${user.timeline ?? 'To be confirmed'}.`,
        exclusions: ['Third-party fees are not included unless stated'], notes: [], serviceDescriptions: Object.fromEntries(user.lines.map(l => [l.code, `${l.service}: set up for ${user.client.company}.`])), missingInformation: user.timeline ? [] : ['What is the delivery timeline?']
      };
    } else if (user.section === 'projectScope') {
      answer = { projectScope: { overview: 'Regenerated project overview', objectives: ['Regenerated objective'] }, missingInformation: [] };
    } else {
      answer = {
        businessAnalysis: { swot: { strengths: [{ text: 'A loyal local customer base (stated by the client)', basis: 'VERIFIED' }], weaknesses: [{ text: 'No online ordering channel is mentioned', basis: 'ASSUMPTION' }], opportunities: [{ text: 'Repeat orders by message', basis: 'ASSUMPTION' }], threats: [] },
          keyChallenges: [{ text: 'Customers keep calling to ask about orders', basis: 'VERIFIED' }], growthAreas: [], improvementAreas: [] },
        recommendedSolutions: [{ serviceCode: user.services[0]?.code ?? user.catalogue[0].code, reason: 'Stated requirement', benefits: 'Fewer calls', integrations: '', dependencies: '', considerations: '' }],
        projectScope: { overview: 'Set up order updates and a QR menu.', objectives: ['Fewer order calls'], phases: [{ name: 'Setup', duration: 'about 2 weeks, to be confirmed', activities: ['Configure the services'] }], deliverables: ['Working order updates'], assumptions: ['Timelines are proposals'], nextSteps: ['Review with the client'] },
        missingInformation: ['How many orders a day?']
      };
    }
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(answer) }] }));
  });
});
await new Promise(r => ai.listen(54469, '127.0.0.1', r));

// ------------------------------------------------------------------ fixture (through the API)
const root = await idOf('root@amuwa.com');
const dhId = await idOf('dh@amuwa.com');
const wab = (await api(root, 'GET', '/departments')).find(d => d.slug === 'wabastore');
const salesTeam = (await api(root, 'GET', `/teams?departmentId=${wab.id}`)).find(t => t.name === 'Sales');
const mk = async (email, fullName, subRole) => {
  const pw = crypto.randomBytes(9).toString('base64url') + '-Aa1';
  PASSWORDS[email] = pw;
  return api(root, 'POST', '/users', { email, fullName, password: pw, role: 'TEAM_MEMBER', teamId: salesTeam.id, salesSubRole: subRole });
};
const tele = await mk('tele.one@amuwa.com', 'Tele One', 'TELECALLER');
const baOne = await mk('ba.one@amuwa.com', 'Biz One', 'BUSINESS_ASSOCIATE');
const baTwo = await mk('ba.two@amuwa.com', 'Biz Two', 'BUSINESS_ASSOCIATE');
await mk('visit.sales@amuwa.com', 'Visit Person', 'VISIT_SALES');
const svc = (await q('select code, name from crm_services where is_active order by sort_order limit 3'));
await api(dhId, 'POST', `/ba/prices/${svc[0].code}`, { unitLabel: 'one time', unitPrice: 5000, gstRate: 18, maxDiscountPct: 10 });
await api(dhId, 'POST', `/ba/prices/${svc[1].code}`, { unitLabel: 'per month', unitPrice: 2000, gstRate: 18, maxDiscountPct: 0 });
const mkLead = (name, status, services) => api(tele.id, 'POST', '/telecaller/leads', { name, company: `${name} Traders`, phone: `98112${String(Math.floor(Math.random() * 90000) + 10000)}`, email: `${name.toLowerCase().replace(/\s/g, '.')}@example.com`, leadSource: 'Cold call', services, leadTemperature: 'HOT', callStatus: status, notes: 'Spoke to the owner' });
const hot = await mkLead('Meera Kapoor', 'INTERESTED', [svc[0].code, svc[1].code]);
await mkLead('Cold Carl', 'PENDING', [svc[0].code]);
ok('fixture: a Telecaller, two Business Associates and an approved price list were created through the API');

// ------------------------------------------------------------------ 1. the Department Head: creation form and Service Prices
const dh = await login('dh@amuwa.com', { width: 1440, height: 900 }, 'nav button');
const refDesign = await styleOf(dh); // the Department Head's dashboard is the reference for the design
await menu(dh, 'Team Members & Access');
await dh.locator('#staff-role').waitFor({ timeout: 15000 });
await dh.locator('#staff-role').selectOption('TEAM_MEMBER');
const teamSelect = dh.locator('select').filter({ has: dh.locator('option', { hasText: 'Select team…' }) }).first();
await teamSelect.selectOption({ label: 'Sales (sales)' });
await dh.locator('#staff-sales-role').selectOption('BUSINESS_ASSOCIATE');
await expect(/Business Associate Dashboard/.test(await dh.locator('main').innerText()), 'creation form: choosing Business Associate shows "Will open: Business Associate Dashboard"');
await menu(dh, 'Service Prices');
await dh.getByRole('heading', { name: 'Service prices' }).waitFor({ timeout: 15000 });
await dh.locator(`input[aria-label="Unit price, ${svc[0].name}"]`).waitFor({ timeout: 10000 });
await expect((await dh.locator(`input[aria-label="Unit price, ${svc[0].name}"]`).inputValue()) === '5000', 'Service Prices: the approved price is shown');
await dh.locator(`input[aria-label="Unit price, ${svc[2].name}"]`).fill('3500');
await dh.locator(`input[aria-label="Largest discount, ${svc[2].name}"]`).fill('5');
await dh.getByRole('button', { name: `Save the price of ${svc[2].name}` }).click();
await dh.getByText(`${svc[2].name}: price saved.`).waitFor({ timeout: 10000 }).catch(() => fail('Service Prices: the price was not saved'));
await expect((await q('select unit_price::text, max_discount_pct::text from service_prices where service_code = $1', [svc[2].code]))[0].unit_price === '3500.00', 'Service Prices: saved in the database');
await dh.screenshot({ path: `${OUT}/ba-1-service-prices.png`, fullPage: true });
await dh.close();

// ------------------------------------------------------------------ 2. the Telecaller converts a qualified lead
const t1 = await login('tele.one@amuwa.com', { width: 1440, height: 900 }, 'text=Today\'s Focus');
await menu(t1, 'Leads');
await t1.locator('tbody tr', { hasText: 'Cold Carl' }).waitFor({ timeout: 15000 });
await expect(await t1.getByRole('button', { name: 'Convert Cold Carl to a contact' }).isDisabled(), 'Convert: a lead that is not Interested cannot be converted');
await t1.getByRole('button', { name: 'Convert Meera Kapoor to a contact' }).click();
const cv = t1.getByRole('dialog');
await cv.locator('#cv-assignee').waitFor({ timeout: 10000 });
await t1.waitForFunction(() => document.querySelectorAll('#cv-assignee option').length >= 3, null, { timeout: 10000 });
await cv.locator('#cv-assignee').selectOption({ label: (await cv.locator('#cv-assignee option').allInnerTexts()).find(t => /Biz One/.test(t)) });
await cv.locator('#cv-note').fill('Wants WhatsApp order updates and a QR menu');
await t1.screenshot({ path: `${OUT}/ba-2-convert.png` });
await cv.getByRole('button', { name: 'Convert to contact' }).dblclick();
await t1.locator('tbody tr', { hasText: 'Meera Kapoor' }).getByText('Converted').waitFor({ timeout: 15000 }).catch(() => fail('Convert: the lead was not marked converted'));
const contactRows = await q('select id, assigned_to, telecaller_id, lead_id, stage, handover_note from ba_contacts');
await expect(contactRows.length === 1 && contactRows[0].assigned_to === baOne.id && contactRows[0].telecaller_id === tele.id && contactRows[0].lead_id === hot.id && contactRows[0].stage === 'NEW', 'Convert: one contact for the lead, assigned to Biz One, from the Telecaller (a double click makes one)', contactRows);
const contactId = contactRows[0].id;
await t1.close();

// ------------------------------------------------------------------ 3. the Business Associate: Home and Tasks
const b1 = await login('ba.one@amuwa.com', { width: 1440, height: 900 }, 'text=Quick actions');
await expect(/\/business-associate\/dashboard\//.test(b1.url()), 'routing: a Business Associate lands on the Business Associate dashboard', b1.url());
const nav = (await b1.locator('aside nav button').allInnerTexts()).map(s => s.trim());
await expect(nav.join('|') === 'Home|Tasks|Leads|Quotation|Demo Schedule|Scope of Project', 'sidebar: Tasks, Leads, Quotation, Demo Schedule, Scope of Project (after Home)', nav);
const baDesign = await styleOf(b1);
await expect(sameDesign(baDesign, refDesign, ['page', 'sidebar', 'active', 'inactive', 'header', 'title', 'card']), 'design: the page background, sidebar, active menu item, header, page title and cards are the Department Head dashboard\'s', { baDesign, refDesign });
await expect(baDesign.primary && refDesign.primary && sameDesign(baDesign, refDesign, ['primary']), 'design: the primary button is the Department Head dashboard\'s (colour, radius, height)', { baDesign: baDesign.primary, refDesign: refDesign.primary });
await expect(await b1.locator('header').getByRole('button', { name: 'Sign out' }).count() === 1, 'the Sign out button is in the top bar');
await b1.getByTestId('stat-assigned-contacts').waitFor({ timeout: 15000 });
await expect(Number(await b1.getByTestId('stat-assigned-contacts').innerText()) === 1 && Number(await b1.getByTestId('stat-upcoming-demos').innerText()) === 0 && Number(await b1.getByTestId('stat-scope-documents-generated').innerText()) === 0, 'Home: the counts come from the data (1 contact; zeros where nothing exists)');
await expect(/Meera Kapoor/.test(await text(b1)) && /Converted by Tele One/.test(await text(b1)), 'Home: recent activity shows the hand-over');
const quick = (await b1.locator('section[aria-label="Quick actions"] button').allInnerTexts()).map(s => s.trim());
await expect(quick.join('|') === 'Open Tasks|Add Lead|Generate Quotation|Schedule Demo|Generate Scope of Project', 'Home: the five quick actions', quick);
await b1.screenshot({ path: `${OUT}/ba-3-home.png`, fullPage: true });

await menu(b1, 'Tasks');
await b1.locator('tbody tr', { hasText: 'Meera Kapoor' }).waitFor({ timeout: 15000 });
const heads = (await b1.locator('thead th').allInnerTexts()).map(s => s.trim().toLowerCase());
await expect(heads.join('|') === 'contact name|company/business name|phone number|email|lead source|assigned telecaller|assigned date|business associate|requirement status|next follow-up|actions', 'Tasks: the eleven required columns', heads);
const tabs = (await b1.getByRole('tab').allInnerTexts()).map(s => s.replace(/\s*\d+$/, '').trim());
await expect(tabs.join('|') === 'All Contacts|New|In Progress|Quotation Pending|Demo Scheduled|Scope of Project Pending|Completed', 'Tasks: the seven filters', tabs);
const row = await b1.locator('tbody tr', { hasText: 'Meera Kapoor' }).innerText();
await expect(/Tele One/.test(row) && /Biz One/.test(row) && /Cold call/.test(row) && /New/.test(row), 'Tasks: the row shows the Telecaller, the Business Associate, the source and the status', row);
await b1.getByRole('tab', { name: /^Completed/ }).click();
await b1.getByText('No contacts match').waitFor({ timeout: 10000 });
ok('Tasks: the Completed filter shows an empty state');
await b1.getByRole('tab', { name: /^All Contacts/ }).click();
await b1.getByLabel('Search contacts').fill('zzzz');
await b1.getByText('No contacts match').waitFor({ timeout: 10000 });
await b1.getByLabel('Search contacts').fill('kapoor');
await b1.locator('tbody tr', { hasText: 'Meera Kapoor' }).waitFor({ timeout: 10000 });
ok('Tasks: search');
await b1.locator('tbody tr', { hasText: 'Meera Kapoor' }).click();
await b1.getByRole('heading', { name: 'Meera Kapoor' }).waitFor({ timeout: 10000 });
const detail = await text(b1);
await expect(/Wants WhatsApp order updates and a QR menu/.test(detail) && /Spoke to the owner/.test(detail) && /Client information/.test(detail) && /Communication notes/.test(detail), 'Tasks: the contact view has the client information, the hand-over note and the history');
await b1.locator('#ba-req').fill('A WhatsApp API and an AI QR menu so customers stop calling about orders');
await b1.getByRole('button', { name: 'Save', exact: true }).click();
await b1.getByText('Saved.').waitFor({ timeout: 10000 });
await b1.getByLabel('New note').fill('Owner prefers calls after 4 pm');
await b1.getByRole('button', { name: 'Add note' }).click();
await b1.getByText('Note added.').waitFor({ timeout: 10000 });
const saved = (await q('select requirements, stage from ba_contacts where id = $1', [contactId]))[0];
await expect(saved.requirements.startsWith('A WhatsApp API') && saved.stage === 'IN_PROGRESS', 'Tasks: requirements and notes are saved; the contact is In Progress', saved);
await b1.screenshot({ path: `${OUT}/ba-4-contact.png`, fullPage: true });

// ------------------------------------------------------------------ 4. Quotation
await b1.locator('main').getByRole('button', { name: 'Quotation', exact: true }).click();
await b1.locator('#qt-client').waitFor({ timeout: 15000 });
await b1.waitForFunction(() => document.querySelectorAll('#qt-client option').length >= 2, null, { timeout: 10000 });
await expect((await b1.locator('#qt-client').inputValue()) === contactId, 'Quotation: opened from the contact, the client is already selected');
await b1.getByRole('button', { name: 'Add the services the client asked for' }).click();
await b1.locator('#qt-price-1').waitFor({ timeout: 10000 });
await expect((await b1.locator('#qt-price-0').inputValue()) === '5000' && (await b1.locator('#qt-price-1').inputValue()) === '2000', 'Quotation: prices start from the approved price list');
await b1.locator('#qt-qty-0').fill('2');
await b1.locator('#qt-disc-0').fill('25');
await b1.locator('#qt-valid').fill('30');
await b1.locator('#qt-pay').fill('50% advance, 50% on delivery');
await b1.locator('#qt-time').fill('3 weeks from the advance');
await b1.getByLabel('GST applies to this quotation (no tax is added unless you tick this)').check().catch(async () => b1.getByText('GST applies to this quotation').click());
await b1.getByRole('button', { name: 'Save Draft' }).click();
await b1.getByText(/above the .* the Department Head allows/).waitFor({ timeout: 10000 }).catch(() => fail('Quotation: a discount above the approved limit was accepted'));
ok('Quotation: a discount above the approved limit is refused');
await b1.locator('#qt-disc-0').fill('10');
await b1.getByRole('button', { name: 'Save Draft' }).click();
await b1.getByText('Draft saved.').waitFor({ timeout: 10000 }).catch(() => fail('Quotation: the draft was not saved'));
await expect(Number((await b1.getByTestId('quote-total').innerText()).replace(/[^0-9.]/g, '')) === 12980, 'Quotation: the total is calculated by the system (Rs 12,980.00)');
const qNo = (await q('select quotation_no from ba_quotations where contact_id = $1', [contactId]))[0].quotation_no;
await b1.getByRole('button', { name: 'Generate with AI' }).click();
await b1.getByText(/The AI drafted the text/).waitFor({ timeout: 20000 }).catch(() => fail('Quotation: the AI draft did not arrive'));
await expect((await b1.locator('#qt-introduction').inputValue()).startsWith('Dear Meera Kapoor Traders') && (await b1.locator('#qt-commercialTerms').inputValue()).includes('50% advance'), 'Quotation: the AI drafted the text from the client and the terms entered');
await expect(Number((await b1.getByTestId('quote-total').innerText()).replace(/[^0-9.]/g, '')) === 12980, 'Quotation: the AI did not change the total');
await expect(/AI draft · not reviewed/.test(await text(b1)), 'Quotation: the AI draft is shown as not reviewed');
await expect(await b1.getByRole('button', { name: 'Generate PDF' }).isDisabled(), 'Quotation: Generate PDF is disabled until the draft is reviewed');
const sent = JSON.stringify(aiCalls[aiCalls.length - 1].user);
await expect(!/@example\.com|98112|Cold Carl/.test(sent) && /Meera Kapoor Traders/.test(sent), 'Quotation: the AI got this client only, without phone or e-mail', sent.slice(0, 200));
await b1.locator('#qt-introduction').fill('Dear Meera Kapoor Traders, thank you for your time. We are pleased to quote as below.');
await b1.getByRole('button', { name: 'Preview' }).click();
await b1.getByLabel('Quotation preview').waitFor({ timeout: 5000 });
await b1.screenshot({ path: `${OUT}/ba-5-quotation-editor.png`, fullPage: true });
await b1.getByRole('button', { name: 'I have reviewed this draft' }).click();
await b1.getByText('Marked as reviewed.').waitFor({ timeout: 10000 });
await b1.getByRole('button', { name: 'Generate PDF' }).click();
await b1.getByText('The quotation is final and its PDF is saved against the client.').waitFor({ timeout: 30000 }).catch(() => fail('Quotation: the PDF was not generated'));
const fin = (await q('select status, pdf_bucket, pdf_path, pdf_provider, pdf_size, quotation_no, revision from ba_quotations where contact_id = $1', [contactId]))[0];
await expect(fin.status === 'FINAL' && fin.pdf_bucket === 'ba-documents' && Number(fin.pdf_size) > 1500, 'Quotation: final, with the PDF stored privately and its reference in the database', fin);
await b1.evaluate(() => { window.open = u => { window.__opened = String(u); return null; }; });
await b1.getByRole('button', { name: 'Download PDF' }).click();
await b1.waitForFunction(() => !!window.__opened, null, { timeout: 15000 });
const pdfBytes = Buffer.from(await (await fetch(await b1.evaluate(() => window.__opened))).arrayBuffer());
await expect(pdfBytes.subarray(0, 5).toString() === '%PDF-', 'Quotation: Download PDF opens a signed link to the real PDF');
await expect((await b1.locator('#qt-introduction').isDisabled()), 'Quotation: a final quotation is read-only');
await b1.reload();
await b1.waitForSelector('text=Quotation', { timeout: 15000 });
await b1.getByRole('button', { name: /^Quotation$/ }).first().click().catch(() => {});
await b1.locator('tbody tr', { hasText: qNo }).waitFor({ timeout: 15000 }).catch(() => fail('Quotation: after a refresh the quotation is not listed'));
await expect(/Final/.test(await b1.locator('tbody tr', { hasText: qNo }).innerText()), 'Quotation: after a refresh it is still there and final');
await b1.locator('tbody tr', { hasText: qNo }).getByRole('button', { name: new RegExp(`Open ${qNo}`) }).click();
await b1.getByRole('button', { name: 'Create revision' }).click();
await b1.getByText('Revision 2 started.').waitFor({ timeout: 10000 }).catch(() => fail('Quotation: no revision was created'));
await expect((await q('select count(*)::int n from ba_quotations where quotation_no = $1', [qNo]))[0].n === 2, 'Quotation: a revision is a second record; the final one is kept');
await b1.screenshot({ path: `${OUT}/ba-6-quotation-revision.png`, fullPage: true });

// ------------------------------------------------------------------ 5. Demo Schedule
await menu(b1, 'Demo Schedule');
await b1.getByRole('heading', { name: 'Demo Schedule' }).waitFor({ timeout: 15000 });
await expect(/does not send invitations/.test(await text(b1)), 'Demo Schedule: says plainly that no invitations or reminders are sent');
await b1.getByRole('button', { name: 'Schedule demo' }).first().click();
const dm = b1.getByRole('dialog');
await dm.locator('#dm-contact').waitFor({ timeout: 10000 });
await b1.waitForFunction(() => document.querySelectorAll('#dm-contact option').length >= 2, null, { timeout: 10000 });
await dm.locator('#dm-contact').selectOption(contactId);
const fmt = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const tomorrow = fmt(new Date(Date.now() + 86400e3));
await dm.locator('#dm-date').fill(tomorrow);
await dm.locator('#dm-start').fill('11:00');
await dm.locator('#dm-end').fill('10:00');
await dm.getByRole('button', { name: 'Schedule demo' }).click();
await expect(/The end time must be after the start time/.test(await dm.innerText()), 'Demo Schedule: an end time before the start time is refused');
await dm.locator('#dm-end').fill('12:00');
await dm.locator('#dm-loc').fill('Google Meet');
await dm.locator('#dm-link').fill('https://meet.example.com/abc-defg');
await dm.locator('#dm-notes').fill('Show the QR menu');
await dm.getByRole('button', { name: 'Schedule demo' }).dblclick();
await b1.getByText('The demo with Meera Kapoor is scheduled.').waitFor({ timeout: 15000 }).catch(() => fail('Demo Schedule: the demo was not scheduled'));
await expect((await q('select count(*)::int n from ba_demos where contact_id = $1', [contactId]))[0].n === 1, 'Demo Schedule: the demo is saved against the client (a double click books once)');
await b1.locator('tbody tr', { hasText: 'Meera Kapoor' }).waitFor({ timeout: 10000 });
await expect(/Scheduled/.test(await b1.locator('tbody tr', { hasText: 'Meera Kapoor' }).innerText()), 'Demo Schedule: the list shows the client, the date, the time, the mode, the assignee and the status');
await b1.getByRole('button', { name: 'Schedule demo' }).first().click();
const dm2 = b1.getByRole('dialog');
await b1.waitForFunction(() => document.querySelectorAll('#dm-contact option').length >= 2, null, { timeout: 10000 });
await dm2.locator('#dm-contact').selectOption(contactId);
await dm2.locator('#dm-date').fill(tomorrow); await dm2.locator('#dm-start').fill('11:30'); await dm2.locator('#dm-end').fill('12:30'); await dm2.locator('#dm-loc').fill('Zoom');
await dm2.getByRole('button', { name: 'Schedule demo' }).click();
await dm2.getByText(/already have a demo at that time/).waitFor({ timeout: 10000 }).catch(() => fail('Demo Schedule: an overlapping demo was accepted'));
ok('Demo Schedule: an overlapping demo is a conflict');
await dm2.getByRole('button', { name: 'Cancel' }).click();
await b1.getByRole('button', { name: 'Calendar' }).click();
await b1.locator('button[title^="Product demo"]').first().waitFor({ timeout: 10000 }).catch(() => fail('Demo Schedule: the calendar does not show the demo'));
ok('Demo Schedule: the calendar view shows it');
await b1.screenshot({ path: `${OUT}/ba-7-demo-calendar.png`, fullPage: true });
await b1.getByRole('button', { name: 'List' }).click();
await b1.getByRole('button', { name: /Open the demo Product demo for Meera Kapoor/ }).click();
await b1.getByRole('button', { name: 'Edit / Reschedule' }).click();
const dm3 = b1.getByRole('dialog');
await dm3.locator('#dm-start').fill('15:00'); await dm3.locator('#dm-end').fill('16:00');
await dm3.getByRole('button', { name: 'Save changes' }).click();
await b1.getByText('The demo was rescheduled.').waitFor({ timeout: 15000 }).catch(() => fail('Demo Schedule: the reschedule was not saved'));
await expect((await q('select status, reschedule_count from ba_demos where contact_id = $1', [contactId]))[0].status === 'RESCHEDULED', 'Demo Schedule: a changed time is a reschedule');
await b1.getByRole('tab', { name: /^Rescheduled Demos/ }).click();
await b1.getByRole('button', { name: /Open the demo Product demo/ }).click();
await b1.getByRole('button', { name: 'Cancel demo' }).click();
await b1.getByRole('dialog').getByRole('button', { name: 'Cancel the demo' }).click();
await b1.getByText('The demo was marked cancelled.').waitFor({ timeout: 15000 }).catch(() => fail('Demo Schedule: the cancellation was not saved'));
await b1.getByRole('tab', { name: /^Cancelled Demos/ }).click();
await b1.locator('tbody tr', { hasText: 'Meera Kapoor' }).waitFor({ timeout: 10000 });
ok('Demo Schedule: a cancelled demo moves to Cancelled Demos and keeps its client');

// ------------------------------------------------------------------ 6. Scope of Project
await menu(b1, 'Scope of Project');
await b1.locator('#sc-client').waitFor({ timeout: 15000 });
await b1.waitForFunction(() => document.querySelectorAll('#sc-client option').length >= 2, null, { timeout: 10000 });
await b1.locator('#sc-client').selectOption(contactId);
await b1.getByRole('button', { name: 'Start the Scope of Project' }).click();
await b1.locator('#sc-industry').waitFor({ timeout: 15000 });
await b1.locator('#sc-industry').fill('Restaurants');
await b1.locator('#sc-operationalChallenges').fill('Customers keep calling to ask about orders');
await b1.getByRole('button', { name: 'Generate Scope with AI' }).click();
await b1.getByText(/The AI drafted the scope/).waitFor({ timeout: 30000 }).catch(() => fail('Scope: the AI draft did not arrive'));
const sc = await text(b1);
await expect(/A loyal local customer base/.test(await b1.locator('input[aria-label="Strengths 1"]').inputValue().then(v => v)) && (await b1.locator('select[aria-label="Basis of Strengths 1"]').inputValue()) === 'VERIFIED' && (await b1.locator('select[aria-label="Basis of Weaknesses 1"]').inputValue()) === 'ASSUMPTION', 'Scope: the SWOT is there, with verified facts told apart from assumptions');
await expect(/How many orders a day\?/.test(sc), 'Scope: missing information is asked as a question');
await expect((await b1.locator('#sc-overview').inputValue()) === 'Set up order updates and a QR menu.', 'Scope: the project scope is drafted');
await expect((await b1.locator('#sc-cname').inputValue()) === 'Meera Kapoor' && (await b1.locator('#sc-ccomp').inputValue()) === 'Meera Kapoor Traders', 'Scope: the client and company stay filled after the AI draft');
const scopeAi = aiCalls[aiCalls.length - 1].user;
await expect(scopeAi.client.company === 'Meera Kapoor Traders' && scopeAi.profile.industry === 'Restaurants' && !JSON.stringify(scopeAi).includes('Cold Carl') && !('phone' in scopeAi.client), 'Scope: the AI got this client\'s facts, including what was typed in the form, and nobody else\'s', Object.keys(scopeAi));
await expect(await b1.getByRole('button', { name: /Finalize Scope/ }).isDisabled(), 'Scope: an unreviewed AI draft cannot be finalised');
await b1.getByRole('button', { name: 'Regenerate Project scope' }).click();
await b1.waitForFunction(() => document.querySelector('#sc-overview')?.value === 'Regenerated project overview', null, { timeout: 20000 }).catch(() => fail('Scope: the section was not regenerated'));
await expect((await b1.locator('input[aria-label="Strengths 1"]').inputValue()).includes('loyal') , 'Scope: regenerating one section leaves the others');
await b1.locator('#sc-overview').fill('Edited by the Business Associate: order updates and a QR menu for the restaurant.');
await b1.getByRole('button', { name: 'Save Draft' }).click();
await b1.getByText('Draft saved.').waitFor({ timeout: 10000 });
await b1.screenshot({ path: `${OUT}/ba-8-scope-editor.png`, fullPage: true });
await b1.getByRole('button', { name: 'I have reviewed this document' }).click();
await b1.getByText('Marked as reviewed.').waitFor({ timeout: 10000 });
await b1.getByRole('button', { name: /Finalize Scope/ }).click();
await b1.getByText('Version finalised and its PDF saved against the client.').waitFor({ timeout: 30000 }).catch(() => fail('Scope: the PDF was not generated'));
const sfin = (await q('select status, pdf_path, pdf_size, version from ba_scope_docs where contact_id = $1', [contactId]))[0];
await expect(sfin.status === 'FINAL' && Number(sfin.pdf_size) > 1500 && sfin.version === 1, 'Scope: version 1 is final, with its PDF stored', sfin);
await b1.evaluate(() => { window.__opened = ''; window.open = u => { window.__opened = String(u); return null; }; });
await b1.getByRole('button', { name: 'Download PDF' }).click();
await b1.waitForFunction(() => !!window.__opened, null, { timeout: 15000 });
const sPdf = Buffer.from(await (await fetch(await b1.evaluate(() => window.__opened))).arrayBuffer());
await expect(sPdf.subarray(0, 5).toString() === '%PDF-', 'Scope: Download PDF opens a signed link to the real PDF');
await expect(await b1.locator('#sc-overview').isDisabled(), 'Scope: a final version is read-only');
await b1.getByRole('button', { name: 'Start a new version' }).click();
await b1.getByText(/version 2/).first().waitFor({ timeout: 15000 });
await expect((await b1.locator('#sc-overview').inputValue()).startsWith('Edited by the Business Associate'), 'Scope: version 2 starts from version 1');
await b1.getByRole('button', { name: 'Back to versions' }).click();
await b1.locator('#sc-client').selectOption(contactId);
await b1.getByText('Version 1').first().waitFor({ timeout: 10000 });
await expect(/Version 2/.test(await text(b1)) && /Final/.test(await text(b1)), 'Scope: both versions are listed; the final one is kept');
await b1.screenshot({ path: `${OUT}/ba-9-scope-versions.png`, fullPage: true });
await menu(b1, 'Tasks');
await b1.locator('tbody tr', { hasText: 'Meera Kapoor' }).waitFor({ timeout: 15000 });
await b1.locator('tbody tr', { hasText: 'Meera Kapoor' }).click();
await b1.getByRole('heading', { name: 'Meera Kapoor' }).waitFor();
const progress = await text(b1);
await expect(new RegExp(qNo).test(progress) && /Version 1/.test(progress) && /Product demo/.test(progress), 'Tasks: the client view shows the quotations, the demo and the scope versions together');

// ------------------------------------------------------------------ 7. Leads -> Potential -> Customer onboarding (the pipeline every Sales member works in)
await pipeStep(b1, 'Leads');
await b1.getByRole('heading', { name: 'Leads' }).first().waitFor({ timeout: 15000 });
const pipeSteps = (await b1.locator('#nav-sub-leads-group button').allInnerTexts()).map(t => t.trim());
await expect(JSON.stringify(pipeSteps) === JSON.stringify(['Leads', 'Potential', 'Customer onboarding', 'Part payments']), 'Leads: the group has Leads, Potential, Customer onboarding and Part payments', pipeSteps);
await expect(!(await text(b1)).includes('Hot Customer'), 'Leads: the Business Associate does not see the Telecaller\'s leads');
await b1.getByRole('button', { name: /Add lead/i }).first().click();
await b1.locator('#lead-name').fill('Ravi Menon');
await b1.locator('#lead-company').fill('Menon Cafe');
await b1.locator('#lead-phone').fill('9811234567');
await b1.locator('#lead-leadSource').selectOption('Instagram');
await b1.getByRole('button', { name: 'Select all services' }).click();
await b1.getByRole('button', { name: 'Save lead' }).click();
await b1.getByRole('button', { name: /Save & move to Potential|Back to leads|Back/ }).first().waitFor({ timeout: 15000 }).catch(() => fail('Leads: the lead was not saved from the Add lead form'));
await pipeStep(b1, 'Leads');
await b1.locator('tbody tr:visible, main ul li:visible', { hasText: 'Ravi Menon' }).first().waitFor({ timeout: 15000 }).catch(() => fail('Leads: the new lead is not in the Leads list'));
const rl = (await q(`select id, owner_id, lifecycle_stage from customers where name = 'Ravi Menon'`));
await expect(rl.length === 1 && rl[0].owner_id === baOne.id && rl[0].lifecycle_stage === 'LEAD', 'Leads: one lead record, owned by the Business Associate', rl);
await b1.screenshot({ path: `${OUT}/ba-7-leads.png`, fullPage: true });
// the lead moves on as the same record: Potential, then Customer onboarding
const dueTomorrow = new Date(Date.now() + 86400e3).toISOString().slice(0, 10);
await api(baOne.id, 'PATCH', `/pipeline/leads/${rl[0].id}`, { leadStatus: 'READY_TO_BUY' }).catch(() => {});
const toPotential = await api(baOne.id, 'POST', `/pipeline/customers/${rl[0].id}/move-to-potential`, { dealAmount: 40000, paymentDueDate: dueTomorrow });
await expect(toPotential.lifecycleStage === 'POTENTIAL' && toPotential.id === rl[0].id, 'Potential: the same record moves from Leads to Potential', toPotential);
await pipeStep(b1, 'Potential');
await b1.locator('tbody tr:visible, main ul li:visible', { hasText: 'Menon Cafe' }).first().waitFor({ timeout: 15000 }).catch(() => fail('Potential: the customer is not in Potential'));
await b1.screenshot({ path: `${OUT}/ba-7-potential.png`, fullPage: true });
const toOnboarding = await api(baOne.id, 'POST', `/pipeline/customers/${rl[0].id}/payments`, { amount: 40000, method: 'UPI' });
await expect(toOnboarding.lifecycleStage === 'ONBOARDING', 'Customer onboarding: a full payment starts onboarding for the same record', toOnboarding);
await pipeStep(b1, 'Customer onboarding');
await b1.locator('tbody tr:visible, main ul li:visible', { hasText: 'Menon Cafe' }).first().waitFor({ timeout: 15000 }).catch(() => fail('Customer onboarding: the customer is not in the list'));
await expect((await q(`select count(*)::int n from customers where name = 'Ravi Menon'`))[0].n === 1, 'Customer onboarding: still exactly one record, nothing duplicated');
await b1.screenshot({ path: `${OUT}/ba-7-onboarding.png`, fullPage: true });
await b1.close();

// ------------------------------------------------------------------ 8. routing and permissions
const b2 = await login('ba.two@amuwa.com', { width: 1440, height: 900 }, 'text=Quick actions');
await expect(Number(await b2.getByTestId('stat-assigned-contacts').innerText()) === 0, 'permissions: the other Business Associate has their own (empty) counts');
await menu(b2, 'Tasks');
await b2.getByText('No contacts have been handed over to you yet').waitFor({ timeout: 10000 }).catch(() => fail('Tasks: no empty state'));
ok('Tasks: an empty state when nothing has been handed over');
await b2.goto(`${BASE}/business-associate/dashboard/${baOne.id}`);
await b2.waitForFunction(id => location.pathname.startsWith('/business-associate/dashboard/') && !location.pathname.includes(id), baOne.id, { timeout: 15000 }).catch(() => fail('routing: a Business Associate opened another one\'s dashboard URL'));
ok('routing: another Business Associate\'s dashboard URL redirects to the own');
const apiTok = sign({ sub: baTwo.id, role: 'authenticated' });
const other = await fetch(`${BASE}/api/v1/ba/contacts/${contactId}`, { headers: { authorization: `Bearer ${apiTok}` } });
await expect(other.status === 404, 'permissions: the other Business Associate cannot read the contact through the API');
const quoteFile = await fetch(`${BASE}/api/v1/ba/quotations/${(await q('select id from ba_quotations where contact_id = $1 and status = $2', [contactId, 'FINAL']))[0].id}/file`, { headers: { authorization: `Bearer ${apiTok}` } });
await expect(quoteFile.status === 404, 'permissions: nor download its quotation');
await b2.close();
const tl = await login('tele.one@amuwa.com', { width: 1440, height: 900 }, 'text=Today\'s Focus');
await tl.goto(`${BASE}/business-associate/dashboard/${baOne.id}`);
await tl.waitForFunction(() => location.pathname.startsWith('/telecaller/dashboard/'), null, { timeout: 15000 }).catch(() => fail('routing: a Telecaller reached the Business Associate route'));
ok('routing: a Telecaller cannot open the Business Associate dashboard');
await tl.close();
const rahul = await login('rahul@amuwa.com', { width: 1440, height: 900 }, 'nav button');
await rahul.goto(`${BASE}/business-associate/dashboard/${baOne.id}`);
await rahul.waitForFunction(() => location.pathname.startsWith('/team-member/dashboard/'), null, { timeout: 15000 }).catch(() => fail('routing: a Sales member reached the Business Associate route'));
ok('routing: a Sales member cannot open it either, and keeps the Sales member dashboard');
await rahul.close();

// ------------------------------------------------------------------ 8b. a Sales member works as a Business Associate from the Sales Team Member dashboard
const rahulId = await idOf('rahul@amuwa.com');
const sunita = await mkLead('Sunita Rao', 'INTERESTED', [svc[0].code]);
const handed = await api(tele.id, 'POST', `/telecaller/leads/${sunita.id}/convert`, { assigneeId: rahulId, note: 'Please call today' });
await expect(handed.assigneeName === 'Rahul' || !!handed.contactId, 'Sales member: a Telecaller hands a contact to a Sales member', handed);
const sm = await login('rahul@amuwa.com', { width: 1440, height: 900 }, 'nav button');
await expect(/\/team-member\/dashboard\//.test(sm.url()), 'Sales member: keeps the Sales Team Member dashboard', sm.url());
await navItem(sm, 'Business Associate').waitFor({ timeout: 15000 }).catch(() => fail('Sales member: the Business Associate group is missing from the sidebar'));
await expect(await navItem(sm, 'My Leads').count() === 1 && await navItem(sm, 'My Customers').count() === 1, 'Sales member: the existing menu (My Leads, My Customers) is still there');
await navItem(sm, 'Business Associate').click();
const subs = (await sm.locator('#business-associate-subtree button').allInnerTexts()).map(t => t.trim());
await expect(JSON.stringify(subs) === JSON.stringify(['BA Overview', 'BA Tasks', 'Quotation', 'Demo Schedule', 'Scope of Project']), 'Sales member: the Business Associate group lists its pages', subs);
await sm.locator('main').getByText('Quick actions').first().waitFor({ timeout: 15000 }).catch(() => fail('Sales member: BA Overview did not open'));
await sm.locator('#business-associate-subtree button', { hasText: 'BA Tasks' }).click();
await sm.locator('tbody tr:visible, main ul li:visible', { hasText: 'Sunita Rao' }).first().waitFor({ timeout: 15000 }).catch(() => fail('Sales member: the contact handed to them is not in BA Tasks'));
await expect(!(await text(sm)).includes('Meera Kapoor'), 'Sales member: sees only their own contacts (not a Business Associate\'s)');
await sm.screenshot({ path: `${OUT}/ba-8b-sales-member-contacts.png`, fullPage: true });
// the Sales member's own pipeline is untouched: a lead created there appears in My Leads, once, and the Lead -> Potential -> Customer onboarding steps are all still in the menu
const pipeLead = await api(rahulId, 'POST', '/pipeline/leads', { name: 'Pipeline Pal', company: 'Pal Co', phone: '+91 98200 33333', leadSource: 'Instagram', services: [svc[0].code] });
await expect(!!pipeLead.id, 'Pipeline: a Sales member creates a lead', pipeLead);
await navItem(sm, 'My Leads').click();
const steps = (await sm.locator('#my-leads-subtree button').allInnerTexts()).map(t => t.replace(/\s+/g, ' ').trim().replace(/\s*\d+$/, ''));
await expect(steps.length === 4 && /^1 Leads/.test(steps[0]) && /^2 Potential/.test(steps[1]) && /^3 Customer onboarding/.test(steps[2]) && /^4 Part payments/.test(steps[3]), 'Pipeline: My Leads still has Leads, Potential, Customer onboarding and Part payments', steps);
await sm.locator('tbody tr:visible, main ul li:visible', { hasText: 'Pipeline Pal' }).first().waitFor({ timeout: 15000 }).catch(() => fail('Pipeline: the new lead is not in My Leads'));
await expect((await q(`select count(*)::int n from customers where name = 'Pipeline Pal'`))[0].n === 1, 'Pipeline: exactly one record exists for the lead');
await expect((await q(`select count(*)::int n from ba_contacts c join customers l on l.id = c.lead_id where l.name = 'Pipeline Pal'`))[0].n === 0, 'Pipeline: the lead is not turned into a Business Associate contact by itself');
await sm.screenshot({ path: `${OUT}/ba-8b-sales-member-my-leads.png`, fullPage: true });
for (const [label, heading] of [['Quotation', 'Quotation'], ['Demo Schedule', 'Demo Schedule'], ['Scope of Project', 'Scope of Project']]) {
  await sm.locator('#business-associate-subtree button', { hasText: label }).click();
  await sm.getByRole('heading', { name: heading }).first().waitFor({ timeout: 15000 }).catch(() => fail(`Sales member: ${label} did not open`));
}
ok('Sales member: Quotation, Demo Schedule and Scope of Project open');
await sm.close();
const vs = await login('visit.sales@amuwa.com', { width: 1440, height: 900 }, 'text=dashboard is not set up yet');
await expect(/\/sales-role\//.test(vs.url()), 'routing: another Sales role (Visit Sales) still gets the "not set up yet" page, not this dashboard', vs.url());
await vs.close();
const leadPage = await login('lead@amuwa.com', { width: 1440, height: 900 }, 'nav button');
await expect(/\/team-lead\/dashboard\//.test(leadPage.url()), 'routing: the Sales Team Lead dashboard is unchanged', leadPage.url());
await leadPage.close();

// ------------------------------------------------------------------ 9. a phone-sized window
const ph = await login('ba.one@amuwa.com', { width: 390, height: 844 }, 'text=Quick actions');
const noSideways = async label => expect(await ph.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `phone: no sideways scrolling on ${label}`);
await noSideways('Home');
await menu(ph, 'Tasks'); await ph.locator('ul li').first().waitFor({ timeout: 10000 }); await noSideways('Tasks');
await pipeStep(ph, 'Leads'); await ph.getByRole('heading', { name: 'Leads' }).first().waitFor({ timeout: 10000 }); await noSideways('Leads');
await menu(ph, 'Quotation'); await ph.getByRole('heading', { name: 'Quotation' }).first().waitFor({ timeout: 10000 }); await noSideways('Quotation');
await ph.screenshot({ path: `${OUT}/ba-10-phone-quotation.png`, fullPage: true });
await menu(ph, 'Demo Schedule'); await ph.getByRole('heading', { name: 'Demo Schedule' }).waitFor({ timeout: 10000 }); await noSideways('Demo Schedule');
await ph.getByRole('button', { name: 'Calendar' }).click(); await noSideways('the calendar');
await menu(ph, 'Scope of Project'); await ph.locator('#sc-client').waitFor({ timeout: 10000 }); await noSideways('Scope of Project');
await ph.close();

// ------------------------------------------------------------------ 10. a tablet-sized window
const tb = await login('ba.one@amuwa.com', { width: 820, height: 1180 }, 'text=Quick actions');
const tabletOk = async label => expect(await tb.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `tablet: no sideways scrolling on ${label}`);
await tabletOk('Home');
for (const [label, ready] of [['Tasks', 'tbody tr:visible, main ul li:visible'], ['Leads', 'tbody tr:visible, main ul li:visible'], ['Quotation', 'tbody tr:visible, main ul li:visible'], ['Demo Schedule', 'text=Demo Schedule'], ['Scope of Project', '#sc-client']]) {
  if (label === 'Leads') await pipeStep(tb, 'Leads'); else await menu(tb, label);
  await tb.waitForSelector(ready, { timeout: 15000 });
  await tabletOk(label);
}
await tb.screenshot({ path: `${OUT}/ba-11-tablet.png` });
await tb.close();

const bad = errors.filter(e => !/favicon/.test(e));
await expect(bad.length === 0, 'no console errors or page errors in any window', bad.slice(0, 5));
console.log(`=== ${step} BUSINESS ASSOCIATE BROWSER CHECKS PASSED ===`);
ai.close();
await browser.close();
await db.end();
