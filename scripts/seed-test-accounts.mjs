#!/usr/bin/env node
/**
 * Dummy accounts for testing EVERY dashboard, plus two client logins.
 *
 * It goes through the application's own API as a Super Admin (the same calls "Add Team Member" and the customer import make), so every rule
 * the real screens apply applies here too: who may create whom, one Sales head and one Support head per department, Operations Heads and their
 * departments, Technical Consultant / Meta Verifier flags, Sales roles. Nothing is written to the database any other way.
 *
 * Everything is kept apart from real data:
 *   - two sandbox departments, "QA Sandbox" and "QA Sandbox Two", each with a Sales and a Support team;
 *   - every login e-mail is <prefix><sep><role>@<domain> (default qa.<role>@example.com, so no real person is ever mailed);
 *   - the Accounts and HR departments are the real ones (their dashboards belong to them): only members / leads are added there, and the
 *     department head only when the department has none yet.
 *
 *   API_URL=https://your-app.example/api/v1 \
 *   SUPABASE_URL=https://xxxx.supabase.co SUPABASE_ANON_KEY=... \
 *   SA_EMAIL=you@yourcompany.com   [SA_PASSWORD=...  (otherwise asked, without echo)] \
 *   npm run seed:test-accounts -- [--same-password] [--all-departments [--only wabastore,whatsbox] [--skip dtalk]] [--domain example.com] [--prefix qa] [--sep .] [--out qa-accounts.local.md] [--no-clients] [--dry-run]
 *     --all-departments   also one login per role in EVERY real department: wabastore-sales-head@, whatsbox-support-member@, ... (real teams, see below)
 *     --prefix wabastore --sep -   makes wabastore-sales-head@example.com, wabastore-support-member@example.com, ...
 *
 * Passwords are made up on every run (or, with --same-password, one password you type for all of them), written ONLY to the --out file (mode 600, git-ignored: qa-accounts.local.*) and never printed or logged.
 * An account that already exists is left as it is (its password is not changed and is not in the file): the file says so.
 * Rerunning is safe. Remove the accounts afterwards by suspending or deleting these users in Team Members.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import readline from 'node:readline';
import { createClient } from '@supabase/supabase-js';

const args = process.argv.slice(2);
const opt = name => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const flag = name => args.includes(`--${name}`);
const DOMAIN = (opt('domain') || 'example.com').trim().toLowerCase();
// the login name is <prefix><sep><role>: qa.sales.head@... by default; --prefix wabastore --sep - gives wabastore-sales-head@...
const PREFIX = (opt('prefix') || 'qa').trim().toLowerCase();
const SEP = opt('sep') || '.';
const OUT = opt('out') || 'qa-accounts.local.md';
const DRY = flag('dry-run');
const ALL = flag('all-departments');
const SAME = flag('same-password');
const ONLY = (opt('only') || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
const SKIP = (opt('skip') || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
const API_URL = (process.env.API_URL || '').replace(/\/+$/, '');
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const SA_EMAIL = (process.env.SA_EMAIL || '').trim().toLowerCase();

if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(DOMAIN) || !API_URL || (!process.env.SA_TOKEN && (!SUPABASE_URL || !ANON || !SA_EMAIL))) {
  console.error('Usage: API_URL=https://<app>/api/v1 SUPABASE_URL=... SUPABASE_ANON_KEY=... SA_EMAIL=<super admin e-mail> [SA_PASSWORD=...] npm run seed:test-accounts -- [--domain example.com] [--prefix qa] [--sep .] [--out file] [--no-clients] [--dry-run]');
  process.exit(1);
}
if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(PREFIX) || !['.', '-', '_'].includes(SEP)) {
  console.error('--prefix may have lower-case letters, digits and hyphens (for example wabastore); --sep must be one of  .  -  _');
  process.exit(1);
}
if (!OUT.includes('.local.')) {
  console.error('The --out file name must contain ".local." (for example qa-accounts.local.md) so that git ignores it: it holds passwords.');
  process.exit(1);
}

const password = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(14);
  return `${Array.from(bytes, b => chars[b % chars.length]).join('')}-Aa7`;
};
const mail = local => `${PREFIX}${SEP}${local.split('.').join(SEP)}@${DOMAIN}`;
const mailIn = (slug, local) => `${slug}${SEP}${local.split('.').join(SEP)}@${DOMAIN}`; // <department>-<role>@<domain>

async function ask(prompt) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  rl._writeToOutput = () => {};
  process.stdout.write(prompt);
  const v = await new Promise(resolve => rl.question('', resolve));
  rl.close();
  process.stdout.write('\n');
  return v;
}

async function signIn(email, pw) {
  const sb = createClient(SUPABASE_URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await sb.auth.signInWithPassword({ email, password: pw });
  if (error || !data.session) throw new Error(`Could not sign in as ${email}: ${error?.message ?? 'no session'}`);
  return data.session.access_token;
}

const call = async (token, method, path, body) => {
  const res = await fetch(API_URL + path, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', origin: new URL(API_URL).origin }, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
};
const must = async (token, method, path, body) => {
  const r = await call(token, method, path, body);
  if (!r.json.success) throw new Error(`${method} ${path} -> ${r.status} ${r.json.error?.message ?? JSON.stringify(r.json).slice(0, 200)}`);
  return r.json.data;
};

// ---------------------------------------------------------------------------------------------------------------------------------------
// --same-password: ONE password for every account made in this run (easier testing). Typed twice without echo, or SEED_PASSWORD for scripts.
// It is as weak as it is easy: use it on a test or staging project only. Accounts that already exist keep their own password.
let SHARED = null;
if (SAME) {
  SHARED = process.env.SEED_PASSWORD || (await ask('One password for every test account (10 to 72 characters, not shown): '));
  if (!process.env.SEED_PASSWORD && SHARED !== (await ask('Type it again: '))) {
    console.error('The two passwords are not the same.');
    process.exit(1);
  }
  if (SHARED.length < 10 || SHARED.length > 72 || /\s/.test(SHARED)) {
    console.error('The password needs 10 to 72 characters and no spaces.');
    process.exit(1);
  }
}
const pick = () => SHARED ?? password();

const saToken = process.env.SA_TOKEN || (await signIn(SA_EMAIL, process.env.SA_PASSWORD || (await ask('Super Admin password (not shown): '))));
const me = await must(saToken, 'GET', '/me');
if (me.role !== 'SUPER_ADMIN') throw new Error('The signed-in account is not a Super Admin.');

const rows = []; // { who, dashboard, email, password|null, note }
const log = msg => console.log(msg);

// ---- departments and teams ----------------------------------------------------------------------------------------------------------
const departments = await must(saToken, 'GET', '/departments');
async function sandbox(name, slug) {
  let d = departments.find(x => x.slug === slug);
  if (!d && !DRY) {
    d = await must(saToken, 'POST', '/departments', { name, slug, description: 'Sandbox for dummy test accounts. Safe to ignore.' });
    log(`created department ${name}`);
  }
  if (!d) return { id: `(dry-run:${slug})`, slug, teams: {} };
  const teams = await must(saToken, 'GET', `/teams?departmentId=${d.id}`);
  const out = {};
  for (const division of ['SALES', 'SUPPORT']) {
    let t = teams.find(x => x.division === division);
    if (!t && !DRY) {
      t = await must(saToken, 'POST', '/teams', { departmentId: d.id, name: division === 'SALES' ? 'Sales' : 'Support', division });
      log(`created ${division} team in ${name}`);
    }
    out[division] = t?.id;
  }
  return { id: d.id, slug, teams: out };
}
// one pair of sandbox departments per --prefix, so a second set of accounts never collides with the first (a department has one head per side)
const title = PREFIX.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
const SB = PREFIX === 'qa' ? 'QA Sandbox' : `${title} Sandbox`;
const A = await sandbox(SB, `${PREFIX}-sandbox`);
const B = await sandbox(`${SB} Two`, `${PREFIX}-sandbox-two`);
const accounts = departments.find(d => d.slug === 'accounts');
const hr = departments.find(d => d.slug === 'hr');
const firstTeam = async dept => (dept ? (await must(saToken, 'GET', `/teams?departmentId=${dept.id}`))[0]?.id : undefined);

// ---- users ----------------------------------------------------------------------------------------------------------------------------
const made = {}; // email -> { password, id }
async function user(who, dashboard, local, fullName, body, { optional = false, email: given } = {}) {
  const email = given ?? mail(local);
  const pw = pick();
  if (DRY) {
    rows.push({ who, dashboard, email, password: '(dry run)', note: '' });
    return;
  }
  const r = await call(saToken, 'POST', '/users', { email, fullName, password: pw, ...body });
  if (r.json.success) {
    made[email] = { password: pw, id: r.json.data.id };
    rows.push({ who, dashboard, email, password: pw, note: '' });
    log(`created ${email}`);
  } else if (/e-mail already exists|already (been )?registered/i.test(r.json.error?.message || '') || (r.status === 409 && (r.json.error?.message || '').includes(`(${fullName})`))) {
    // (a head slot taken by this very account from an earlier run is reported by the slot rule before the e-mail rule)
    rows.push({ who, dashboard, email, password: null, note: 'already existed: password unchanged (reset it in Team Members)' });
    log(`kept ${email} (already exists)`);
  } else if (optional) {
    rows.push({ who, dashboard, email, password: null, note: `not created: ${r.json.error?.message ?? r.status}` });
    log(`skipped ${email}: ${r.json.error?.message}`);
  } else {
    throw new Error(`${email}: ${r.status} ${r.json.error?.message ?? ''}`);
  }
}

// Sandbox A: the department with every kind of head, lead and member
await user('Sales Department Head', 'Sales Department Head dashboard', 'sales.head', 'QA Sales Head', { role: 'DEPARTMENT_HEAD', departmentId: A.id, headDivision: 'SALES' });
await user('Support Department Head', 'Department Head dashboard (Support side)', 'support.head', 'QA Support Head', { role: 'DEPARTMENT_HEAD', departmentId: A.id, headDivision: 'SUPPORT' });
await user('Department Head (no side)', 'Department Head dashboard', 'dept.head', 'QA Department Head', { role: 'DEPARTMENT_HEAD', departmentId: A.id });
await user('Sales Team Lead', 'Sales Team Lead dashboard', 'sales.lead', 'QA Sales Lead', { role: 'TEAM_HEAD', teamId: A.teams.SALES });
await user('Support Team Lead', 'Support Team Lead dashboard', 'support.lead', 'QA Support Lead', { role: 'TEAM_HEAD', teamId: A.teams.SUPPORT });
await user('Sales Team Member', 'Sales Team Member dashboard', 'sales.member', 'QA Sales Member', { role: 'TEAM_MEMBER', teamId: A.teams.SALES });
await user('Telecaller', 'Telecaller dashboard', 'telecaller', 'QA Telecaller', { role: 'TEAM_MEMBER', teamId: A.teams.SALES, salesSubRole: 'TELECALLER' });
await user('Business Associate', 'Business Associate dashboard', 'business.associate', 'QA Business Associate', { role: 'TEAM_MEMBER', teamId: A.teams.SALES, salesSubRole: 'BUSINESS_ASSOCIATE' });
await user('Support Team Member', 'Support Team Member dashboard', 'support.member', 'QA Support Member', { role: 'TEAM_MEMBER', teamId: A.teams.SUPPORT });
await user('Technical Consultant', 'Technical Consultant dashboard', 'technical.consultant', 'QA Technical Consultant', { role: 'TEAM_MEMBER', teamId: A.teams.SUPPORT, technicalConsultant: true });
await user('Meta Verifier', 'Meta Verifier dashboard', 'meta.verifier', 'QA Meta Verifier', { role: 'TEAM_MEMBER', teamId: A.teams.SUPPORT, metaVerifier: true });

// Operations Heads: home department "QA Sandbox Two", overseeing both sandbox departments
const both = id => [{ departmentId: id, division: 'SALES' }, { departmentId: id, division: 'SUPPORT' }];
await user('Sales Operations Head', 'Sales Operations Head dashboard', 'ops.sales', 'QA Sales Operations Head',
  { role: 'DEPARTMENT_HEAD', departmentId: B.id, headDivision: 'SALES', operationsHead: true, additionalAccess: [{ departmentId: A.id, division: 'SALES' }] });
await user('Support Operations Head', 'Support Operations Head dashboard', 'ops.support', 'QA Support Operations Head',
  { role: 'DEPARTMENT_HEAD', departmentId: B.id, headDivision: 'SUPPORT', operationsHead: true, additionalAccess: [{ departmentId: A.id, division: 'SUPPORT' }] });
await user('Sales & Support Operations Head', 'Operations Head dashboard', 'ops.both', 'QA Operations Head',
  { role: 'DEPARTMENT_HEAD', departmentId: B.id, operationsHead: true, additionalAccess: [...both(B.id), ...both(A.id)] });

// Every real department (--all-departments): one login per role it has teams for, named <department-slug>-<role>@<domain>.
// These are the REAL departments and teams: the test users sit next to real staff, and a head slot that a real head already holds is refused
// (reported in the file as "not created"). One Operations Head oversees all of them.
if (ALL) {
  // a side that is its own department (Wabatalk = the Support side of D Talk) is not a department of its own here: its side is given as that department
  const sideOf = (d, division) => departments.find(x => x.facetOf === d.id && x.facetDivision === division)?.id ?? d.id;
  const real = departments.filter(d => !d.is_locked && !d.isLocked && !d.facetOf && !/^(qa-|.*-sandbox)/.test(d.slug) && !['accounts', 'hr'].includes(d.slug)
    && (!ONLY.length || ONLY.includes(d.slug)) && !SKIP.includes(d.slug));
  const access = [];
  for (const d of real) {
    const teams = await must(saToken, 'GET', `/teams?departmentId=${d.id}`);
    const sales = teams.find(t => t.division === 'SALES');
    const support = teams.find(t => t.division === 'SUPPORT');
    const lab = text => `${d.name}: ${text}`;
    const o = { optional: true };
    if (sales) {
      access.push({ departmentId: sideOf(d, 'SALES'), division: 'SALES' });
      await user(lab('Sales Department Head'), 'Sales Department Head dashboard', 'sales.head', `${d.name} Sales Head`, { role: 'DEPARTMENT_HEAD', departmentId: d.id, headDivision: 'SALES' }, { ...o, email: mailIn(d.slug, 'sales.head') });
      await user(lab('Sales Team Lead'), 'Sales Team Lead dashboard', 'sales.lead', `${d.name} Sales Lead`, { role: 'TEAM_HEAD', teamId: sales.id }, { ...o, email: mailIn(d.slug, 'sales.lead') });
      await user(lab('Sales Team Member'), 'Sales Team Member dashboard', 'sales.member', `${d.name} Sales Member`, { role: 'TEAM_MEMBER', teamId: sales.id }, { ...o, email: mailIn(d.slug, 'sales.member') });
      await user(lab('Telecaller'), 'Telecaller dashboard', 'telecaller', `${d.name} Telecaller`, { role: 'TEAM_MEMBER', teamId: sales.id, salesSubRole: 'TELECALLER' }, { ...o, email: mailIn(d.slug, 'telecaller') });
      await user(lab('Business Associate'), 'Business Associate dashboard', 'business.associate', `${d.name} Business Associate`, { role: 'TEAM_MEMBER', teamId: sales.id, salesSubRole: 'BUSINESS_ASSOCIATE' }, { ...o, email: mailIn(d.slug, 'business.associate') });
    }
    if (support) {
      access.push({ departmentId: sideOf(d, 'SUPPORT'), division: 'SUPPORT' });
      await user(lab('Support Department Head'), 'Department Head dashboard (Support side)', 'support.head', `${d.name} Support Head`, { role: 'DEPARTMENT_HEAD', departmentId: d.id, headDivision: 'SUPPORT' }, { ...o, email: mailIn(d.slug, 'support.head') });
      await user(lab('Support Team Lead'), 'Support Team Lead dashboard', 'support.lead', `${d.name} Support Lead`, { role: 'TEAM_HEAD', teamId: support.id }, { ...o, email: mailIn(d.slug, 'support.lead') });
      await user(lab('Support Team Member'), 'Support Team Member dashboard', 'support.member', `${d.name} Support Member`, { role: 'TEAM_MEMBER', teamId: support.id }, { ...o, email: mailIn(d.slug, 'support.member') });
      await user(lab('Technical Consultant'), 'Technical Consultant dashboard', 'technical.consultant', `${d.name} Technical Consultant`, { role: 'TEAM_MEMBER', teamId: support.id, technicalConsultant: true }, { ...o, email: mailIn(d.slug, 'technical.consultant') });
      await user(lab('Meta Verifier'), 'Meta Verifier dashboard', 'meta.verifier', `${d.name} Meta Verifier`, { role: 'TEAM_MEMBER', teamId: support.id, metaVerifier: true }, { ...o, email: mailIn(d.slug, 'meta.verifier') });
    }
    const general = teams.find(t => t.division === 'GENERAL');
    if (!sales && !support && general) {
      // a department with one general team (for example Education & Training): its head, a lead and a member
      await user(lab('Department Head'), 'Department Head dashboard', 'head', `${d.name} Head`, { role: 'DEPARTMENT_HEAD', departmentId: d.id }, { ...o, email: mailIn(d.slug, 'head') });
      await user(lab('Team Lead'), 'Team Lead dashboard', 'lead', `${d.name} Lead`, { role: 'TEAM_HEAD', teamId: general.id }, { ...o, email: mailIn(d.slug, 'lead') });
      await user(lab('Team Member'), 'Team Member dashboard', 'member', `${d.name} Member`, { role: 'TEAM_MEMBER', teamId: general.id }, { ...o, email: mailIn(d.slug, 'member') });
    } else if (!sales && !support) rows.push({ who: lab('(no team)'), dashboard: '', email: '-', password: null, note: 'nothing created: this department has no team' });
  }
  if (access.length) {
    // its own home sandbox: the "both functions" slot of QA Sandbox Two is taken by ops.both
    const C = await sandbox(`${SB} Three`, `${PREFIX}-sandbox-three`);
    await user('Operations Head over every department', 'Operations Head dashboard', 'ops.all', 'QA Operations Head (all departments)',
      { role: 'DEPARTMENT_HEAD', departmentId: C.id, operationsHead: true, additionalAccess: [...both(C.id), ...access] }, { optional: true });
  }
}

// Accounts and HR are the real departments: members and leads, the head only when there is none
const accTeam = await firstTeam(accounts);
if (accTeam) {
  await user('Accounts Team Member', 'Accounts dashboard', 'accounts.member', 'QA Accounts Member', { role: 'TEAM_MEMBER', teamId: accTeam });
  await user('Accounts Team Lead', 'Accounts dashboard (lead)', 'accounts.lead', 'QA Accounts Lead', { role: 'TEAM_HEAD', teamId: accTeam });
  await user('Accounts Department Head', 'Accounts Department Head dashboard', 'accounts.head', 'QA Accounts Head', { role: 'DEPARTMENT_HEAD', departmentId: accounts.id }, { optional: true });
} else rows.push({ who: 'Accounts', dashboard: '', email: '-', password: null, note: 'no Accounts department or team found: not created' });
const hrTeam = await firstTeam(hr);
if (hrTeam) {
  // made-up member details (an HR employee is created with them, like any member added in the CRM)
  const hrDetails = designation => ({ designation, joiningDate: '2025-01-10', dateOfBirth: '1995-05-05', bloodGroup: 'A+', contactNumber: '+91 98111 22222', emergencyContact: '+91 98765 43210' });
  // an HR employee is an HR Assistant, an HR Recruiter or the HR Admin Head (migration 20261222000500); HR has no Team Lead designation,
  // so the HR Team Lead row stays only as an optional, reported "not created" line for older databases
  await user('HR Team Member', 'HR dashboard (HR Assistant)', 'hr.member', 'QA HR Member', { role: 'TEAM_MEMBER', teamId: hrTeam, details: hrDetails('HR Assistant') });
  await user('HR Recruiter', 'HR Recruiter dashboard', 'hr.recruiter', 'QA HR Recruiter', { role: 'TEAM_MEMBER', teamId: hrTeam, details: hrDetails('HR Recruiter') });
  await user('HR Team Lead', 'HR dashboard (lead)', 'hr.lead', 'QA HR Lead', { role: 'TEAM_HEAD', teamId: hrTeam }, { optional: true });
  await user('HR Department Head', 'HR Department Head dashboard', 'hr.head', 'QA HR Head', { role: 'DEPARTMENT_HEAD', departmentId: hr.id, details: hrDetails('HR Admin Head') }, { optional: true });
} else rows.push({ who: 'HR', dashboard: '', email: '-', password: null, note: 'no HR department or team found: not created' });

// ---- clients (existing customers with a client login: the same import the Support team uses) -------------------------------------------
async function seedClients() {
  const supportMember = made[mail('support.member')];
  if (!supportMember) {
    rows.push({ who: 'Client', dashboard: 'Client dashboard', email: '-', password: null, note: 'not created: the QA Support Member already existed, so the script cannot sign in as them. Add a client with Support > Import existing customers.' });
  } else {
    const token = await signIn(mail('support.member'), supportMember.password);
    const clients = [
      { key: 'client.calls', name: 'QA Client Calls', business: 'QA Calls Traders (TEST)', mobile: '9000000101', service: 'AI Calling', pw: pick() },
      { key: 'client.whatsapp', name: 'QA Client WhatsApp', business: 'QA WhatsApp Stores (TEST)', mobile: '9000000102', service: 'WhatsApp API', pw: pick() }
    ];
    const data = {
      customers: clients.map((c, i) => ({ row: 3 + i, mobile: c.mobile, name: c.name, businessName: c.business, email: mail(c.key), loginEmail: mail(c.key), loginPassword: c.pw })),
      services: clients.map((c, i) => ({ row: 3 + i, mobile: c.mobile, service: c.service, startDate: '2026-05-01', status: 'Live' }))
    };
    const check = await must(token, 'POST', '/customers/import-existing', { commit: false, data });
    if (check.errors?.length) {
      for (const c of clients) rows.push({ who: 'Client', dashboard: 'Client dashboard', email: mail(c.key), password: null, note: `not created: ${check.errors[0].message}` });
    } else {
      const done = await must(token, 'POST', '/customers/import-existing', { commit: true, data });
      for (const c of clients) {
        const l = (done.logins ?? []).find(x => x.email?.toLowerCase() === mail(c.key));
        rows.push({ who: `Client (${c.service})`, dashboard: 'Client dashboard (sign in at /client/login)', email: mail(c.key), password: l ? c.pw : null, note: l ? `${c.business}; sign-in e-mail: ${l.mail}` : 'the customer already existed: its login was not changed' });
      }
      log('created the client logins');
    }
  }
}
if (!flag('no-clients') && !DRY) {
  // a problem here (for example the server has no APP_URL for the sign-in e-mail) must not lose the staff passwords already made
  await seedClients().catch(err => {
    rows.push({ who: 'Client', dashboard: 'Client dashboard', email: '-', password: null, note: `not created: ${String(err.message).slice(0, 160)}` });
    log(`the clients were not created: ${err.message}`);
  });
}

// ---- the file -------------------------------------------------------------------------------------------------------------------------
const lines = [
  '# Dummy test accounts',
  '',
  `Made ${new Date().toISOString()} on ${API_URL}. **Passwords are in this file only. Do not commit or share it.**`,
  '',
  `Staff sign in at the normal login page; clients at \`/client/login\`. The sandbox departments are "${SB}" and "${SB} Two".`,
  '',
  '| Who | Opens | Login e-mail | Password | Note |',
  '|---|---|---|---|---|',
  ...rows.map(r => `| ${r.who} | ${r.dashboard} | ${r.email} | ${r.password ?? '-'} | ${r.note} |`),
  '',
  'Super Admin: your own account (not created here).',
  ''
];
if (!DRY) fs.writeFileSync(OUT, lines.join('\n'), { mode: 0o600 });
console.log(`\n${rows.length} accounts handled${DRY ? ' (dry run: nothing was created)' : `; the list with passwords is in ${OUT}`}.`);
