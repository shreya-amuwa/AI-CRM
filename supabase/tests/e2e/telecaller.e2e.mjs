// The Telecaller workspace in real browsers against the local stack (Postgres + PostgREST + gateway + the web app):
//   - the Department Head creates a Sales member with the Sales role Telecaller (the dropdown only shows for a Sales team)
//   - the Department Head assigns an Excel sheet (errors block it, preview, confirm), the Telecaller sees it
//   - Home counts, Tasks (columns, filters, search, pagination, updates) and Leads (Hot/Warm/Cold, edit, filters) against the database
//   - routing: a Telecaller opens only their own dashboard; a Sales member and a Business Associate never reach it
//   - a phone-sized window has no sideways scrolling
// See supabase/tests/e2e/README.md. Passwords come from E2E_PASSWORDS (made up by the runner); nothing is stored.
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import JSZip from 'jszip';
import pg from 'pg';

const require = createRequire(import.meta.url);
let chromium;
for (const p of ['playwright-core', '/opt/node-tools/node_modules/playwright-core', 'playwright']) {
  try { ({ chromium } = require(p)); break; } catch { /* try the next */ }
}
if (!chromium) { console.log('SKIPPED - Playwright is not installed, the Telecaller browser test did not run'); process.exit(0); }

const BASE = process.env.E2E_BASE || 'http://localhost:3050';
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
  await current?.screenshot({ path: `${OUT}/telecaller-fail.png`, fullPage: true }).catch(() => {});
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
const text = p => p.locator('main').innerText();
const todayIST = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
const stat = async (p, label) => Number(await p.getByTestId(`stat-${label}`).innerText());

// A minimal .xlsx (a real zip) with the given rows, written for the test.
const xlsx = async (rows, name) => {
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const cell = (v, r, c) => {
    const ref = String.fromCharCode(65 + c) + (r + 1);
    return typeof v === 'number' ? `<c r="${ref}"><v>${v}</v></c>` : v === null || v === '' ? '' : `<c r="${ref}" t="inlineStr"><is><t>${esc(v)}</t></is></c>`;
  };
  const sheet = `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows.map((row, r) => `<row r="${r + 1}">${row.map((v, c) => cell(v, r, c)).join('')}</row>`).join('')}</sheetData></worksheet>`;
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
  zip.file('xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Contacts" sheetId="1" r:id="rId1"/></sheets></workbook>');
  zip.file('xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>');
  zip.file('xl/worksheets/sheet1.xml', sheet);
  const path = `${OUT}/${name}`;
  fs.writeFileSync(path, await zip.generateAsync({ type: 'nodebuffer' }));
  return path;
};
const HEAD = ['Contact Name', 'Company Name', 'Phone Number', 'Email', 'Remarks'];
const goodRows = n => Array.from({ length: n }, (_v, i) => [`Contact ${String(i + 1).padStart(2, '0')}`, `Company ${i + 1}`, 9811230000 + i, `contact${i + 1}@example.com`, i === 0 ? 'Met at the expo' : null]);

// ------------------------------------------------------------------ fixture (made through the API, as the Super Admin)
const root = await idOf('root@amuwa.com');
const wab = (await api(root, 'GET', '/departments')).find(d => d.slug === 'wabastore');
const salesTeam = (await api(root, 'GET', `/teams?departmentId=${wab.id}`)).find(t => t.name === 'Sales');
const mk = async (email, fullName, extra = {}) => {
  const pw = crypto.randomBytes(9).toString('base64url') + '-Aa1';
  PASSWORDS[email] = pw;
  return api(root, 'POST', '/users', { email, fullName, password: pw, role: 'TEAM_MEMBER', teamId: salesTeam.id, ...extra });
};
const toTwo = await mk('tele.two@amuwa.com', 'Tele Two', { salesSubRole: 'TELECALLER' });
const biz = await mk('biz.assoc@amuwa.com', 'Visit Sales Person', { salesSubRole: 'VISIT_SALES' });
ok('fixture: a Telecaller and a Visit Sales person were created through the API (Sales role at creation)');

// ------------------------------------------------------------------ 1. the Department Head creates a Telecaller in the form
const dh = await login('dh@amuwa.com', { width: 1440, height: 900 }, 'nav button');
await menu(dh, 'Team Members & Access');
await dh.locator('#staff-role').waitFor({ timeout: 15000 });
await dh.locator('#staff-role').selectOption('TEAM_MEMBER');
const teamSelect = dh.locator('select').filter({ has: dh.locator('option', { hasText: 'Select team…' }) }).first();
await teamSelect.selectOption({ label: 'Support (support)' });
await expect((await dh.locator('#staff-sales-role').count()) === 0, 'creation form: no Sales role dropdown for a Support team');
await teamSelect.selectOption({ label: 'Sales (sales)' });
await dh.locator('#staff-sales-role').waitFor({ timeout: 5000 }).catch(() => fail('creation form: the Sales role dropdown does not show for a Sales team'));
const salesOptions = await dh.locator('#staff-sales-role option').allInnerTexts();
await expect(['Telecaller', 'Business Associate', 'Influencer', 'Visit Sales', 'Business Partner'].every(o => salesOptions.includes(o)), 'creation form: the Sales dropdown offers the five Sales roles', salesOptions);
await dh.locator('#staff-role').selectOption('TEAM_HEAD');
await expect((await dh.locator('#staff-sales-role').count()) === 0, 'creation form: not shown for a Team Lead');
await dh.locator('#staff-role').selectOption('TEAM_MEMBER');
await dh.locator('#staff-sales-role').selectOption('TELECALLER');
const onePw = crypto.randomBytes(9).toString('base64url') + '-Aa1';
PASSWORDS['tele.one@amuwa.com'] = onePw;
await dh.getByPlaceholder('e.g. Kunal Sharma').fill('Tele One');
await dh.getByPlaceholder('kunal@amuwa.com').fill('tele.one@amuwa.com');
await dh.getByPlaceholder('min. 10 characters').fill(onePw);
await dh.locator('input[type="date"]').first().fill('2025-01-10');
await dh.locator('input[type="date"]').nth(1).fill('1995-05-05');
await dh.locator('select').filter({ has: dh.locator('option', { hasText: 'A+' }) }).first().selectOption('A+');
await dh.getByPlaceholder('+91 98765 43210').fill('+91 98765 43210');
await expect(/Telecaller Dashboard/.test(await dh.locator('main').innerText()), 'creation form: "Will open: Telecaller Dashboard"');
await dh.screenshot({ path: `${OUT}/tc-1-create-form.png`, fullPage: true });
await dh.getByRole('button', { name: /Create|Add team member|Add member/i }).last().click();
await dh.getByText('Tele One').first().waitFor({ timeout: 15000 }).catch(() => fail('the Telecaller was not created'));
const oneProfile = (await q('select id, sales_sub_role, default_dashboard, team_id, role from profiles where email = $1', ['tele.one@amuwa.com']))[0];
await expect(oneProfile.sales_sub_role === 'TELECALLER' && oneProfile.default_dashboard === 'telecaller' && oneProfile.team_id === salesTeam.id && oneProfile.role === 'TEAM_MEMBER', 'creation form: the Telecaller is stored as a Sales team member with the sub-role (not as a department or team)', oneProfile);
const plain = (await q(`select count(*)::int n from profiles where email in ('rahul@amuwa.com','neha@amuwa.com') and sales_sub_role is null and default_dashboard = 'sales-member'`))[0].n;
await expect(plain === 2, 'existing Sales members are unchanged (no sub-role, Sales member dashboard)');

// ------------------------------------------------------------------ 2. the Department Head assigns an Excel sheet
await menu(dh, 'Telecaller Sheets');
await dh.getByRole('heading', { name: 'Telecaller contact sheets' }).waitFor({ timeout: 15000 });
await dh.locator('#cs-assignee').waitFor({ timeout: 15000 });
await dh.waitForFunction(() => document.querySelectorAll('#cs-assignee option').length >= 3, null, { timeout: 15000 }).catch(() => fail('the Telecallers were not listed'));
await dh.locator('#cs-assignee').selectOption({ label: (await dh.locator('#cs-assignee option').allInnerTexts()).find(t => /Tele One/.test(t)) });
const withErrors = await xlsx([HEAD, ['Good One', 'Co', 9811239001, 'good@example.com'], ['', 'No Name Co', 9811239002], ['Bad Phone', 'Co', 'abc'], ['Bad Mail', 'Co', 9811239004, 'not-an-email'], ['Dup', 'Co', 9811239001]], 'bad-sheet.xlsx');
await dh.locator('#cs-file').setInputFiles(withErrors);
await dh.getByText(/with problems/).waitFor({ timeout: 15000 }).catch(() => fail('the preview did not appear'));
const badText = await text(dh);
await expect(/Row 3: The contact name is missing/.test(badText) && /Row 4: The phone number is missing or not valid/.test(badText) && /Row 5: The e-mail address is not valid/.test(badText) && /Row 6: This phone number appears twice/.test(badText), 'upload: every wrong row is named with its Excel row number');
await expect(await dh.getByRole('button', { name: /Confirm and assign/ }).isDisabled(), 'upload: a sheet with problems cannot be confirmed');
await expect((await q('select count(*)::int n from telecaller_contacts'))[0].n === 0, 'upload: nothing was saved while rows are wrong');
await dh.screenshot({ path: `${OUT}/tc-2-upload-errors.png`, fullPage: true });
await dh.getByRole('button', { name: 'Cancel' }).first().click();
await dh.locator('#cs-file').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
await dh.getByText('Choose an Excel (.xlsx) file.').waitFor({ timeout: 5000 }).catch(() => fail('upload: a non-Excel file was not refused'));
ok('upload: a file that is not .xlsx is refused');
await dh.locator('#cs-file').setInputFiles({ name: 'huge.xlsx', mimeType: 'application/octet-stream', buffer: Buffer.alloc(800 * 1024, 1) });
await dh.getByText(/The file is too large/).waitFor({ timeout: 5000 }).catch(() => fail('upload: an oversize file was not refused'));
ok('upload: a file over the size limit is refused');
const wrongHeadings = await xlsx([['Company', 'Email'], ['Acme', 'a@b.co']], 'wrong-headings.xlsx');
await dh.locator('#cs-file').setInputFiles(wrongHeadings);
await dh.getByText(/Missing: Contact Name and Phone Number/).waitFor({ timeout: 5000 }).catch(() => fail('upload: missing headings were not explained'));
ok('upload: missing column headings are explained');
const good = await xlsx([HEAD, ...goodRows(45)], 'october-contacts.xlsx');
await dh.locator('#cs-file').setInputFiles(good);
await dh.getByTestId('preview-rows').waitFor({ timeout: 15000 });
await expect(/45\s*valid/.test(await text(dh)) && (await dh.locator('table caption').first().innerText().catch(() => '')) !== undefined, 'upload: the preview shows 45 valid rows');
await dh.getByRole('button', { name: 'Confirm and assign 45 contacts' }).waitFor({ timeout: 5000 });
await dh.screenshot({ path: `${OUT}/tc-3-upload-preview.png`, fullPage: true });
await dh.getByRole('button', { name: 'Confirm and assign 45 contacts' }).click();
await dh.getByText(/45 contacts from october-contacts.xlsx were assigned to Tele One/).waitFor({ timeout: 20000 }).catch(() => fail('the sheet was not assigned'));
const sheetRow = (await q(`select total_contacts, file_name, source_stored_at, source_provider from telecaller_contact_lists`))[0];
await expect(sheetRow.total_contacts === 45 && sheetRow.file_name === 'october-contacts.xlsx', 'upload: the sheet and its 45 contacts were stored for Tele One', sheetRow);
await expect(!!sheetRow.source_stored_at, 'upload: the original Excel file was stored too');
await dh.getByLabel('Assigned sheets').getByText('october-contacts.xlsx').waitFor({ timeout: 10000 }).catch(() => fail('upload: the sheet does not show in the assigned list'));
ok('upload: the sheet shows in the assigned list');
await dh.locator('#cs-file').setInputFiles(good);
await dh.getByText(/already been assigned/).waitFor({ timeout: 15000 }).catch(() => fail('upload: the same sheet was not recognised'));
ok('upload: the same file cannot be assigned twice to the same Telecaller');
await dh.close();

// ------------------------------------------------------------------ 3. the Telecaller's workspace
const t1 = await login('tele.one@amuwa.com', { width: 1440, height: 900 }, 'text=Today\'s Focus');
await expect(/\/telecaller\/dashboard\//.test(t1.url()), 'routing: a Sales Telecaller lands on the Telecaller dashboard', t1.url());
const navLabels = await t1.locator('aside nav button').allInnerTexts();
await expect(navLabels.map(s => s.trim()).join('|') === 'Home|Tasks|Leads', 'sidebar: Home, Tasks, Leads', navLabels);
const sidebarBg = await t1.locator('aside').evaluate(e => getComputedStyle(e).backgroundColor);
const activeBg = await t1.locator('aside nav button[aria-current="page"]').evaluate(e => getComputedStyle(e).backgroundColor);
const [ar, ag, ab] = activeBg.match(/\d+/g).map(Number);
await expect(sidebarBg === 'rgb(11, 31, 75)' && ab > 200 && ab > ar + 100 && ab > ag + 80, 'design: navy sidebar with a blue active item', { sidebarBg, activeBg });
await expect(await t1.locator('header').getByRole('button', { name: 'Sign out' }).count() === 1, 'the existing Sign out is still in the top bar');
await t1.getByTestId('stat-total-assigned-contacts').waitFor({ timeout: 15000 });
const home0 = { assigned: await stat(t1, 'total-assigned-contacts'), pending: await stat(t1, 'calls-pending'), completed: await stat(t1, 'calls-completed'), leads: await stat(t1, 'total-leads'), due: await stat(t1, 'follow-ups-due-today') };
await expect(home0.assigned === 45 && home0.pending === 45 && home0.completed === 0 && home0.leads === 0 && home0.due === 0, 'Home: the five cards equal the database', home0);
await expect(/next calls/i.test(await text(t1)) && /Contact 01/.test(await text(t1)), "Home: Today's Focus lists the next calls");
await expect((await t1.getByRole('button', { name: /View Assigned Tasks/ }).count()) === 1 && (await t1.getByRole('button', { name: /Add Lead/ }).count()) === 1 && (await t1.getByRole('button', { name: /View Follow-ups/ }).count()) === 1, 'Home: the three quick actions');
await t1.screenshot({ path: `${OUT}/tc-4-home.png`, fullPage: true });

// Tasks
await menu(t1, 'Tasks');
await t1.getByTestId('sheet-name').waitFor({ timeout: 15000 }).catch(() => {});
await t1.locator('#tc-sheet').selectOption({ index: 1 });
await t1.getByTestId('sheet-name').waitFor({ timeout: 10000 });
const sheetText = await text(t1);
await expect(/october-contacts.xlsx/.test(sheetText) && /Dev Head/.test(sheetText), 'Tasks: shows the sheet name, the assignment date and who assigned it');
await expect((await t1.getByTestId('sheet-total').innerText()) === '45' && (await t1.getByTestId('sheet-pending').innerText()) === '45' && (await t1.getByTestId('sheet-completed').innerText()) === '0', 'Tasks: total / pending / completed');
await t1.locator('tbody tr').first().waitFor({ timeout: 10000 });
const heads = (await t1.locator('thead th').allInnerTexts()).map(s => s.trim());
await expect(heads.join('|').toLowerCase() === 'Contact Name|Company Name|Phone Number|Email|Assigned Date|Call Status|Last Called|Follow-up Date|Remarks|Actions'.toLowerCase(), 'Tasks: the table has the ten required columns', heads);
await expect((await t1.locator('tbody tr').count()) === 20, 'Tasks: a page holds 20 contacts');
const tabs = (await t1.getByRole('tab').allInnerTexts()).map(s => s.replace(/\s*\d+$/, '').trim());
await expect(tabs.join('|') === 'All|Pending|Contacted|Interested|Follow-up Required|Not Interested|Completed', 'Tasks: the status filters', tabs);
await t1.getByRole('button', { name: '3', exact: true }).click();
await t1.waitForFunction(() => document.querySelectorAll('tbody tr').length === 5, null, { timeout: 10000 }).catch(() => fail('Tasks: page 3 does not hold the last 5'));
ok('Tasks: pagination reaches the last page (5 contacts)');
await t1.getByLabel('Search contacts').fill('Contact 07');
await t1.waitForFunction(() => document.querySelectorAll('tbody tr').length === 1, null, { timeout: 10000 }).catch(() => fail('Tasks: search did not narrow the list'));
ok('Tasks: search narrows the list (and returns to page 1)');
await t1.screenshot({ path: `${OUT}/tc-5-tasks.png`, fullPage: true });
await t1.getByRole('button', { name: 'Update call for Contact 07' }).click();
const dlg = t1.getByRole('dialog');
await dlg.locator('#tc-call-status').selectOption('FOLLOW_UP_REQUIRED');
await dlg.getByRole('button', { name: 'Save' }).click();
await expect(/Enter the follow-up date/.test(await dlg.innerText()), 'Tasks: Follow-up Required needs a date');
await dlg.locator('#tc-follow-up').fill(todayIST);
await dlg.locator('#tc-remarks').fill('Call back after lunch');
await dlg.getByRole('button', { name: 'Save' }).click();
await t1.getByText('Contact 07 was updated.').waitFor({ timeout: 10000 }).catch(() => fail('Tasks: the update was not saved'));
const saved = (await q(`select call_status, remarks, follow_up_date::text, last_called_at, call_count from telecaller_contacts where name = 'Contact 07'`))[0];
await expect(saved.call_status === 'FOLLOW_UP_REQUIRED' && saved.remarks === 'Call back after lunch' && saved.follow_up_date === todayIST && !!saved.last_called_at && saved.call_count === 1, 'Tasks: status, remarks, follow-up date and last called time are saved in the database', saved);
await t1.getByLabel('Search contacts').fill('');
await t1.getByRole('tab', { name: /^Follow-up Required/ }).click();
await t1.waitForFunction(() => document.querySelectorAll('tbody tr').length === 1, null, { timeout: 10000 }).catch(() => fail('Tasks: the Follow-up filter'));
await expect(/Call back after lunch/.test(await t1.locator('tbody').innerText()), 'Tasks: the Follow-up Required filter shows it, with the remarks');
await t1.reload();
await t1.getByTestId('sheet-name').waitFor({ timeout: 15000 }).catch(() => {});
await t1.getByRole('tab', { name: /^Follow-up Required/ }).click();
await t1.waitForFunction(() => /Call back after lunch/.test(document.querySelector('tbody')?.innerText || ''), null, { timeout: 10000 }).catch(() => fail('Tasks: the update did not persist after a reload'));
ok('Tasks: the update persists after a page reload');

// Home reflects it
await menu(t1, 'Home');
await t1.getByTestId('stat-total-assigned-contacts').waitFor({ timeout: 15000 });
await t1.waitForFunction(() => document.querySelector('[data-testid="stat-calls-completed"]')?.textContent === '1', null, { timeout: 10000 }).catch(() => fail('Home: the counts did not follow the update'));
const home1 = { pending: await stat(t1, 'calls-pending'), completed: await stat(t1, 'calls-completed'), due: await stat(t1, 'follow-ups-due-today') };
await expect(home1.pending === 44 && home1.completed === 1 && home1.due === 1, 'Home: Calls Pending 44, Calls Completed 1, Follow-ups Due Today 1', home1);
await expect(/Contact 07/.test(await text(t1)), "Home: Today's Focus lists the follow-up");

// Leads
await t1.getByRole('button', { name: /Add Lead/ }).click();
await t1.getByRole('heading', { name: 'Add Lead' }).waitFor({ timeout: 10000 });
const addDlg = t1.getByRole('dialog');
await addDlg.getByRole('button', { name: 'Add Lead' }).click();
const errText = await addDlg.innerText();
await expect(/Customer name is required/.test(errText) && /Choose Hot, Warm or Cold/.test(errText) && /Select the service/.test(errText), 'Add Lead: required fields are validated');
await addDlg.locator('#lead-name').fill('Meera Kapoor');
await addDlg.locator('#lead-company').fill('Kapoor Foods');
await addDlg.locator('#lead-phone').fill('9811234561');
await addDlg.locator('#lead-email').fill('meera@kapoorfoods.com');
await addDlg.locator('#lead-address').fill('12 MG Road, Pune');
await addDlg.locator('[aria-label="Interested service"] button').first().click();
await addDlg.getByRole('radio', { name: 'Hot' }).click();
await addDlg.locator('#lead-callStatus').selectOption('INTERESTED');
await addDlg.locator('#lead-followUpDate').fill(todayIST);
await addDlg.locator('#lead-notes').fill('Wants a demo on Friday');
await t1.screenshot({ path: `${OUT}/tc-6-add-lead.png`, fullPage: true });
await addDlg.getByRole('button', { name: 'Add Lead' }).dblclick();
await t1.getByText('Meera Kapoor was added to your leads.').waitFor({ timeout: 15000 }).catch(() => fail('Add Lead: the lead was not added'));
await expect((await q(`select count(*)::int n from customers where name = 'Meera Kapoor'`))[0].n === 1, 'Add Lead: a double click creates only one lead');
await expect((await t1.locator('tbody tr', { hasText: 'Meera Kapoor' }).count()) === 1, 'Add Lead: the lead appears in the list without a manual refresh');
const leadHeads = (await t1.locator('thead th').allInnerTexts()).map(s => s.trim());
await expect(leadHeads.join('|').toLowerCase() === 'Customer Name|Company / Business Name|Phone|Email|Lead Source|Lead Temperature|Call Status|Follow-up Date|Created Date|Actions'.toLowerCase(), 'Leads: the ten required columns', leadHeads);
const hotColor = await t1.locator('tbody tr', { hasText: 'Meera Kapoor' }).locator('[data-temperature="HOT"]').evaluate(e => getComputedStyle(e).color);
const rgb = c => c.match(/\d+/g).map(Number);
const [hr_, hg, hb] = rgb(hotColor);
await expect(hr_ > hg + 80 && hr_ > hb + 80, 'Leads: Hot is red', hotColor);
const lead = (await q(`select owner_id, lifecycle_stage, lead_temperature, call_status from customers where name = 'Meera Kapoor'`))[0];
await expect(lead.owner_id === oneProfile.id && lead.lifecycle_stage === 'LEAD' && lead.lead_temperature === 'HOT' && lead.call_status === 'INTERESTED', 'Leads: it is a Sales lead owned by the Telecaller, with temperature and call status stored separately', lead);
// a Warm and a Cold lead through the API (same rules), then filters
const svc = (await q('select code from crm_services where is_active order by sort_order limit 1'))[0].code;
await api(oneProfile.id, 'POST', '/telecaller/leads', { name: 'Warm Wendy', company: 'Warm Co', phone: '9811234562', leadSource: 'Referral', services: [svc], leadTemperature: 'WARM', callStatus: 'CONTACTED' });
await api(oneProfile.id, 'POST', '/telecaller/leads', { name: 'Cold Carl', company: 'Cold Co', phone: '9811234563', leadSource: 'Cold call', services: [svc], leadTemperature: 'COLD', callStatus: 'PENDING' });
await menu(t1, 'Home');
await menu(t1, 'Leads');
await t1.locator('tbody tr').first().waitFor({ timeout: 10000 });
await expect((await t1.locator('tbody tr').count()) === 3, 'Leads: three leads listed');
const warmColor = await t1.locator('tbody tr', { hasText: 'Warm Wendy' }).locator('[data-temperature="WARM"]').evaluate(e => getComputedStyle(e).color);
const coldColor = await t1.locator('tbody tr', { hasText: 'Cold Carl' }).locator('[data-temperature="COLD"]').evaluate(e => getComputedStyle(e).color);
const [wr, wg, wb] = rgb(warmColor), [cr, cg, cb] = rgb(coldColor);
await expect(wr > wb + 80 && wg > wb + 30 && wr > wg && cb > cr + 80 && cb > cg + 60, 'Leads: Warm is amber and Cold is blue', { warmColor, coldColor });
await t1.getByLabel('Filter by lead temperature').selectOption('WARM');
await t1.locator('tbody').getByText('Warm Wendy').waitFor({ timeout: 10000 });
await t1.waitForFunction(() => document.querySelectorAll('tbody tr').length === 1, null, { timeout: 10000 }).catch(() => fail('Leads: the temperature filter'));
await expect(/Warm Wendy/.test(await t1.locator('tbody').innerText()), 'Leads: filter by temperature');
await t1.getByLabel('Filter by lead temperature').selectOption('');
await t1.getByLabel('Filter by call status').selectOption('PENDING');
await t1.locator('tbody').getByText('Cold Carl').waitFor({ timeout: 10000 });
await t1.waitForFunction(() => document.querySelectorAll('tbody tr').length === 1, null, { timeout: 10000 }).catch(() => fail('Leads: the call status filter'));
await expect(/Cold Carl/.test(await t1.locator('tbody').innerText()), 'Leads: filter by call status (separate from the temperature)');
await t1.getByLabel('Filter by call status').selectOption('');
await t1.getByLabel('Search leads').fill('kapoor');
await t1.locator('tbody').getByText('Meera Kapoor').waitFor({ timeout: 10000 });
await t1.waitForFunction(() => document.querySelectorAll('tbody tr').length === 1, null, { timeout: 10000 }).catch(() => fail('Leads: search'));
ok('Leads: search');
await t1.getByLabel('Search leads').fill('');
await t1.getByRole('button', { name: 'Edit Cold Carl' }).click();
await t1.getByRole('dialog').getByRole('radio', { name: 'Hot' }).click();
await t1.getByRole('dialog').getByRole('button', { name: 'Save changes' }).click();
await t1.getByText('Cold Carl was updated.').waitFor({ timeout: 10000 }).catch(() => fail('Leads: the edit was not saved'));
await expect((await q(`select lead_temperature from customers where name = 'Cold Carl'`))[0].lead_temperature === 'HOT', 'Leads: a lead can be edited (Cold to Hot) and the change is stored');
await t1.getByRole('button', { name: 'View Warm Wendy' }).click();
await expect(/Warm Co/.test(await t1.getByRole('dialog').innerText()), 'Leads: View shows the lead');
await t1.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
await menu(t1, 'Home');
await t1.waitForFunction(() => document.querySelector('[data-testid="stat-total-leads"]')?.textContent === '3', null, { timeout: 10000 }).catch(() => fail('Home: Total Leads did not follow'));
ok('Home: Total Leads is 3');
await t1.screenshot({ path: `${OUT}/tc-7-leads-home.png`, fullPage: true });

// quick actions
await t1.getByRole('button', { name: /View Follow-ups/ }).click();
await t1.getByRole('tab', { name: /^Follow-up Required/ }).waitFor({ timeout: 10000 });
await expect((await t1.getByRole('tab', { name: /^Follow-up Required/ }).getAttribute('aria-selected')) === 'true', 'Quick action: View Follow-ups opens Tasks on the Follow-up filter');

// routing and permissions
const otherId = await idOf('tele.two@amuwa.com');
await t1.goto(`${BASE}/telecaller/dashboard/${otherId}`);
await t1.waitForFunction(id => location.pathname.startsWith('/telecaller/dashboard/') && !location.pathname.includes(id), otherId, { timeout: 15000 }).catch(() => fail('routing: a Telecaller opened another Telecaller\'s route'));
ok('routing: another Telecaller\'s dashboard URL redirects to the Telecaller\'s own');
await t1.goto(`${BASE}/team-member/dashboard/${oneProfile.id}`);
await t1.waitForFunction(() => location.pathname.startsWith('/telecaller/dashboard/'), null, { timeout: 15000 }).catch(() => fail('routing: a Telecaller opened the Sales member dashboard'));
ok('routing: a Telecaller cannot open the Sales member dashboard');
const forbidden = await fetch(BASE + '/api/v1/telecaller/contacts', { headers: { authorization: `Bearer ${sign({ sub: await idOf('rahul@amuwa.com'), role: 'authenticated' })}` } });
await expect(forbidden.status === 403, 'permissions: a Sales member gets 403 from the Telecaller API');
await t1.close();

// ------------------------------------------------------------------ 4. a second Telecaller sees nothing of the first
const t2 = await login('tele.two@amuwa.com', { width: 1440, height: 900 }, 'text=Today\'s Focus');
await expect((await stat(t2, 'total-assigned-contacts')) === 0 && (await stat(t2, 'total-leads')) === 0, 'permissions: the other Telecaller has their own (empty) counts');
await expect(/Nothing waiting right now/.test(await text(t2)), 'Home: an empty state when nothing is waiting');
await menu(t2, 'Tasks');
await t2.getByText('No contact sheet has been assigned to you yet').waitFor({ timeout: 10000 }).catch(() => fail('Tasks: no empty state'));
ok('Tasks: an empty state when no sheet is assigned');
await menu(t2, 'Leads');
await t2.getByText('No leads yet').waitFor({ timeout: 10000 }).catch(() => fail('Leads: no empty state'));
ok('Leads: an empty state, with the prominent Add Lead button');
await t2.close();

// ------------------------------------------------------------------ 5. other roles never get a Telecaller dashboard
const rahul = await login('rahul@amuwa.com', { width: 1440, height: 900 }, 'nav button');
await expect(/\/team-member\/dashboard\//.test(rahul.url()), 'routing: a Sales member still lands on the Sales member dashboard', rahul.url());
await rahul.goto(`${BASE}/telecaller/dashboard/${oneProfile.id}`);
await rahul.waitForFunction(() => location.pathname.startsWith('/team-member/dashboard/'), null, { timeout: 15000 }).catch(() => fail('routing: a Sales member reached the Telecaller route'));
ok('routing: a Sales member cannot open the Telecaller dashboard');
await rahul.close();
const ba = await login('biz.assoc@amuwa.com', { width: 1440, height: 900 }, 'text=dashboard is not set up yet');
await expect(/\/sales-role\//.test(ba.url()) && !/Today's Focus/.test(await ba.locator('body').innerText()), 'routing: a Visit Sales person sees a "not set up yet" page, never the Telecaller or Sales dashboard', ba.url());
await ba.screenshot({ path: `${OUT}/tc-8-sales-role-pending.png` });
await ba.close();
const tlPage = await login('lead@amuwa.com', { width: 1440, height: 900 }, 'nav button');
await expect(/\/team-lead\/dashboard\//.test(tlPage.url()), 'routing: the Sales Team Lead dashboard is unchanged', tlPage.url());
await tlPage.close();

// ------------------------------------------------------------------ 6. a phone-sized window
const ph = await login('tele.one@amuwa.com', { width: 390, height: 844 }, 'text=Today\'s Focus');
const noSideways = async label => expect(await ph.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `phone: no sideways scrolling on ${label}`);
await noSideways('Home');
await menu(ph, 'Tasks');
await ph.locator('ul li').first().waitFor({ timeout: 10000 });
await noSideways('Tasks');
await expect((await ph.locator('table').first().isVisible().catch(() => false)) === false, 'phone: Tasks shows cards instead of the wide table');
await ph.screenshot({ path: `${OUT}/tc-9-phone-tasks.png`, fullPage: true });
await menu(ph, 'Leads');
await ph.locator('ul li').first().waitFor({ timeout: 10000 });
await noSideways('Leads');
await ph.getByRole('button', { name: /Add Lead/ }).first().click();
await ph.getByRole('heading', { name: 'Add Lead' }).waitFor({ timeout: 5000 });
await noSideways('the Add Lead form');
await ph.screenshot({ path: `${OUT}/tc-10-phone-add-lead.png` });
await ph.close();

const bad = errors.filter(e => !/favicon/.test(e));
await expect(bad.length === 0, 'no console errors or page errors in any window', bad.slice(0, 5));
console.log(`=== ${step} TELECALLER BROWSER CHECKS PASSED ===`);
await browser.close();
await db.end();
