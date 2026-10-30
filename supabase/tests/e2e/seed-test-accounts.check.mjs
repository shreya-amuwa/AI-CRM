// Checks the output of scripts/seed-test-accounts.mjs: every account in the list signs in with the password in the list, lands on the right
// dashboard (GET /me), the Operations Heads oversee the sandbox departments, nothing mentions a password outside the list, and a second
// run changed nothing. Used by run-seed-test-accounts.sh.
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';

let passed = 0;
const check = (ok, label, extra) => { if (!ok) { console.error('not ok -', label, extra ?? ''); process.exit(1); } passed++; console.log('ok -', label); };
const API = process.env.API_URL;
const sb = () => createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const table = fs.readFileSync(process.env.LIST, 'utf8').split('\n').filter(l => l.startsWith('| ') && !l.startsWith('| Who') && !l.startsWith('|---'))
  .map(l => l.split('|').slice(1, -1).map(c => c.trim())).map(([who, opens, email, password, note]) => ({ who, opens, email, password, note }));
const second = fs.readFileSync(process.env.SECOND, 'utf8');

check(table.length >= 21, `the list has ${table.length} rows`);
check(fs.statSync(process.env.LIST).mode % 0o1000 === 0o600, 'the list is readable by its owner only');
check(table.every(r => r.password !== '-' || /already existed|not created/.test(r.note)), 'every row has a password or says why not');

const expected = {
  'qa.sales.head': { role: 'DEPARTMENT_HEAD', dash: 'sales-department-head' },
  'qa.support.head': { role: 'DEPARTMENT_HEAD', dash: 'department-head' },
  'qa.dept.head': { role: 'DEPARTMENT_HEAD', dash: 'department-head' },
  'qa.sales.lead': { role: 'TEAM_HEAD', dash: 'sales-lead' },
  'qa.support.lead': { role: 'TEAM_HEAD', dash: 'support-lead' },
  'qa.sales.member': { role: 'TEAM_MEMBER', dash: 'sales-member' },
  'qa.telecaller': { role: 'TEAM_MEMBER', dash: 'telecaller' },
  'qa.business.associate': { role: 'TEAM_MEMBER', dash: 'business-associate' },
  'qa.support.member': { role: 'TEAM_MEMBER', dash: 'support-member' },
  'qa.technical.consultant': { role: 'TEAM_MEMBER', dash: 'technical-consultant' },
  'qa.meta.verifier': { role: 'TEAM_MEMBER', dash: 'meta-verifier' },
  'qa.ops.sales': { role: 'DEPARTMENT_HEAD', ops: true, side: 'SALES' },
  'qa.ops.support': { role: 'DEPARTMENT_HEAD', ops: true, side: 'SUPPORT' },
  'qa.ops.both': { role: 'DEPARTMENT_HEAD', ops: true, side: null },
  'qa.accounts.member': { role: 'TEAM_MEMBER', dash: 'accounts-staff' },
  'qa.accounts.lead': { role: 'TEAM_HEAD', dash: 'accounts-staff' },
  'qa.hr.member': { role: 'TEAM_MEMBER' },
  'qa.hr.lead': { role: 'TEAM_HEAD' }
};
const opsToken = {};
for (const r of table) {
  const local = r.email.split('@')[0];
  if (!expected[local]) continue;
  const { data, error } = await sb().auth.signInWithPassword({ email: r.email, password: r.password });
  check(!error && data.session, `${r.email} signs in`, error?.message);
  const res = await fetch(`${API}/me`, { headers: { authorization: `Bearer ${data.session.access_token}` } });
  const me = (await res.json()).data;
  const e = expected[local];
  check(me.role === e.role, `${local}: role ${e.role}`, me.role);
  if (e.dash) check(me.defaultDashboard === e.dash, `${local}: opens ${e.dash}`, me.defaultDashboard);
  if (e.ops) {
    check(me.isOperationsHead === true && (me.headDivision ?? null) === e.side, `${local}: an Operations Head${e.side ? ` (${e.side} side)` : ''}`, { ops: me.isOperationsHead, side: me.headDivision });
    opsToken[local] = data.session.access_token;
  }
  if (local === 'qa.technical.consultant') check(me.isTechnicalConsultant === true, 'the Technical Consultant flag is set');
  if (local === 'qa.meta.verifier') check(me.isMetaVerifier === true, 'the Meta Verifier flag is set');
  if (local === 'qa.telecaller') check(me.salesSubRole === 'TELECALLER', 'the Telecaller sales role is set');
  if (local === 'qa.business.associate') check(me.salesSubRole === 'BUSINESS_ASSOCIATE', 'the Business Associate sales role is set');
}
for (const [local, token] of Object.entries(opsToken)) {
  const res = await fetch(`${API}/operations/overview`, { headers: { authorization: `Bearer ${token}` } });
  const rows = (await res.json()).data ?? [];
  check(res.status === 200 && rows.length >= 2, `${local} oversees both sandbox departments`, rows.map(r => r.name ?? r.department));
}
for (const r of table.filter(x => x.who.startsWith('Client'))) {
  const { data, error } = await sb().auth.signInWithPassword({ email: r.email, password: r.password });
  check(!error && data.session, `${r.email} (client) signs in`, error?.message);
  const res = await fetch(`${API.replace('/api/v1', '')}/api/v1/client/me`, { headers: { authorization: `Bearer ${data.session.access_token}` } });
  check(res.status === 200, `${r.email} reaches the client dashboard API`, res.status);
}
check(!/[A-Za-z0-9]{14}-Aa7/.test(second), 'a second run writes no password (everything already existed)');
check(table.filter(r => r.password && r.password !== '-').every(r => !second.includes(r.password)), 'and does not repeat the first run\'s passwords');
console.log(`=== SEED TEST ACCOUNTS CHECKS PASSED (${passed}) ===`);
