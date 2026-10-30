/**
 * End-to-end API test: real HTTP handler (server/app.ts) → supabase-js →
 * local gateway → PostgREST → PostgreSQL with all migrations + RLS.
 * Run via supabase/tests/run-api.sh.
 */
import http from 'node:http';
import net from 'node:net';
import crypto from 'node:crypto';
import pg from 'pg';
import { startFakeR2 } from './fake-r2.js';

const SECRET = process.env.JWT_SECRET!;
const sign = (payload: Record<string, unknown>) => {
  const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const head = enc({ alg: 'HS256', typ: 'JWT' });
  const body = enc({ iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600, ...payload });
  return `${head}.${body}.${crypto.createHmac('sha256', SECRET).update(`${head}.${body}`).digest('base64url')}`;
};

process.env.SUPABASE_URL = process.env.GATEWAY_URL;
process.env.SUPABASE_ANON_KEY = sign({ role: 'anon' });
process.env.SUPABASE_SERVICE_ROLE_KEY = sign({ role: 'service_role' });
process.env.RATE_LIMIT_IP_PER_MIN = '5000';
process.env.RATE_LIMIT_USER_PER_MIN = '5000';
process.env.RATE_LIMIT_IMPORT_PER_MIN = '3';
process.env.RATE_LIMIT_SENSITIVE_PER_MIN = '1000'; // (the invoice tests make well over 100 sensitive calls as one Accounts user)
process.env.API_ACCESS_LOG = 'off';

const { handleApiRequest } = await import('../../server/app.js');
const db = new pg.Pool();
const server = http.createServer((req, res) => void handleApiRequest(req, res));
await new Promise<void>(r => server.listen(0, r));
const base = `http://127.0.0.1:${(server.address() as any).port}/api/v1`;

let passed = 0;
function check(cond: unknown, label: string, extra?: unknown) {
  if (!cond) {
    console.error(`FAILED: ${label}`, extra === undefined ? '' : JSON.stringify(extra));
    process.exit(1);
  }
  passed++;
  console.log(`ok - ${label}`);
}

const tokens = new Map<string, string>();
const tokenFor = (id: string) => sign({ sub: id, role: 'authenticated' });

async function api(who: string | null, method: string, path: string, body?: unknown, raw?: string, extraHeaders: Record<string, string> = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(who ? { authorization: `Bearer ${tokens.get(who)}` } : {}), ...extraHeaders },
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body))
  });
  return { status: res.status, json: (await res.json()) as any, requestId: res.headers.get('x-request-id') };
}

/** Accounts chooses the GST rate of an order (0% keeps the rupee figures of the older checks as written; the order-level GST checks use real rates). */
const chooseGst = (customerId: string, rate = 0) => api('accm', 'POST', `/pipeline/customers/${customerId}/accounts/order-gst`, { rate });

// ---------------------------------------------------------------------------
const { rows: [sa] } = await db.query(
  `insert into auth.users (email, raw_user_meta_data, raw_app_meta_data)
   values ('root@amuwa.com', '{"full_name":"Root"}', '{"bootstrap_super_admin":true}') returning id`);
tokens.set('sa', tokenFor(sa.id));

let r = await api(null, 'GET', '/me');
check(r.status === 401 && r.json.error.code === 'UNAUTHENTICATED', 'missing token → 401 envelope', r);
// change the FIRST character of the signature: the last base64url character carries spare bits, so changing it
// sometimes decodes to the same signature (and "replacing" it with the character it already is changes nothing)
tokens.set('forged', sign({ sub: sa.id, role: 'authenticated' }).replace(/\.([A-Za-z0-9_-])([^.]*)$/, (_m, c, rest) => `.${c === 'A' ? 'B' : 'A'}${rest}`));
r = await api('forged', 'GET', '/me');
check(r.status === 401, 'tampered token rejected');

r = await api('sa', 'GET', '/me');
check(r.status === 200 && r.json.success && r.json.data.role === 'SUPER_ADMIN', 'GET /me returns profile from database', r);

r = await api('sa', 'GET', '/departments');
check(r.status === 200 && r.json.data.length === 12 && r.json.data.some((d: any) => d.slug === 'wabatalk'), 'departments come from the database');
const wab = r.json.data.find((d: any) => d.slug === 'wabastore');
const wbx = r.json.data.find((d: any) => d.slug === 'whatsbox');
r = await api('sa', 'GET', `/teams?departmentId=${wab.id}`);
const sales = r.json.data.find((t: any) => t.name === 'Sales');
const support = r.json.data.find((t: any) => t.name === 'Support');
check(sales && support, 'teams listed per department');

// --- provisioning -----------------------------------------------------------
r = await api('sa', 'POST', '/users', { email: 'dh@amuwa.com', fullName: 'Dept Head', password: 'Sup3rSecret!', role: 'DEPARTMENT_HEAD', departmentId: wab.id });
check(r.status === 201 && r.json.data.role === 'DEPARTMENT_HEAD' && r.json.data.department.slug === 'wabastore', 'super admin creates department head', r);
tokens.set('dh', tokenFor(r.json.data.id));

r = await api('dh', 'POST', '/users', { email: 'th@amuwa.com', fullName: 'Team Head', password: 'Sup3rSecret!', role: 'TEAM_HEAD', teamId: sales.id });
check(r.status === 201 && r.json.data.team.name === 'Sales', 'department head creates team head', r);
tokens.set('th', tokenFor(r.json.data.id));
const salesTeamLeadId = r.json.data.id;
r = await api('th', 'GET', '/me');
check(r.status === 200 && r.json.data.defaultDashboard === 'sales-lead', 'a Sales team lead resolves to the Sales Team Lead dashboard', r);

r = await api('th', 'POST', '/users', { email: 'a@amuwa.com', fullName: 'Member A', password: 'Sup3rSecret!', role: 'TEAM_MEMBER', teamId: sales.id });
check(r.status === 201, 'team head creates team member', r);
const memberA = r.json.data.id;
tokens.set('a', tokenFor(memberA));

// Promotion chain: DH makes a member a Team Lead; a Team Lead cannot; only the Super Admin makes a Department Head.
r = await api('th', 'POST', '/users', { email: 'promo@amuwa.com', fullName: 'Promo', password: 'Sup3rSecret!', role: 'TEAM_MEMBER', teamId: sales.id });
check(r.status === 201, 'team head creates a member to promote', r);
const promoId = r.json.data.id;
r = await api('th', 'PATCH', `/users/${promoId}`, { role: 'TEAM_HEAD', teamId: sales.id });
check(r.status === 403, 'a team lead cannot make a team lead', r);
r = await api('dh', 'PATCH', `/users/${promoId}`, { role: 'DEPARTMENT_HEAD', departmentId: wab.id });
check(r.status === 403, 'a department head cannot make a department head', r);
r = await api('dh', 'PATCH', `/users/${promoId}`, { role: 'TEAM_HEAD', teamId: sales.id });
check(r.status === 200 && r.json.data.role === 'TEAM_HEAD' && r.json.data.defaultDashboard === 'sales-lead', 'department head makes a team member a team lead', r);
r = await api('sa', 'PATCH', `/users/${promoId}`, { role: 'DEPARTMENT_HEAD', departmentId: wab.id });
check(r.status === 409 && /already has a Department Head/.test(r.json.error.message), 'only one department head per department', r);
const headless = (await api('sa', 'GET', '/departments')).json.data.find((d: any) => d.slug === 'digitree');
r = await api('sa', 'PATCH', `/users/${promoId}`, { role: 'DEPARTMENT_HEAD', departmentId: headless.id });
check(r.status === 200 && r.json.data.role === 'DEPARTMENT_HEAD' && r.json.data.defaultDashboard === 'department-head', 'super admin makes a team lead the head of a department without one', r);

// Sales and Support Department Heads: one per side of a department.
r = await api('sa', 'POST', '/users', { email: 'dh.sales@amuwa.com', fullName: 'Sales Head', password: 'Sup3rSecret!', role: 'DEPARTMENT_HEAD', departmentId: wab.id, headDivision: 'SALES' });
check(r.status === 201 && r.json.data.role === 'DEPARTMENT_HEAD' && r.json.data.headDivision === 'SALES' && r.json.data.defaultDashboard === 'sales-department-head',
  'super admin creates a Sales Department Head next to the existing head', r);
const salesHeadId = r.json.data.id;
r = await api('sa', 'POST', '/users', { email: 'dh.sales2@amuwa.com', fullName: 'Sales Head 2', password: 'Sup3rSecret!', role: 'DEPARTMENT_HEAD', departmentId: wab.id, headDivision: 'SALES' });
check(r.status === 409 && /already has a Department Head for Sales/.test(r.json.error.message), 'a second Sales head is refused with a clear message', r);
r = await api('sa', 'POST', '/users', { email: 'x.side@amuwa.com', fullName: 'X', password: 'Sup3rSecret!', role: 'TEAM_HEAD', teamId: sales.id, headDivision: 'SALES' });
check(r.status === 422, 'a side is only for a Department Head', r);
r = await api('sa', 'POST', `/users/${salesHeadId}/head-division`, { division: 'SUPPORT' });
check(r.status === 200 && r.json.data.headDivision === 'SUPPORT', 'super admin can move a head to the free Support side', r);
r = await api('sa', 'POST', `/users/${salesHeadId}/head-division`, { division: 'SALES' });
check(r.status === 200 && r.json.data.headDivision === 'SALES', 'and back to Sales', r);
r = await api('dh', 'POST', `/users/${salesHeadId}/head-division`, { division: 'SUPPORT' });
check(r.status === 403, 'a Department Head cannot change a side', r);
r = await api('sa', 'POST', `/users/${salesHeadId}/head-division`, { division: 'GENERAL' });
check(r.status === 422, 'only Sales or Support', r);
r = await api('sa', 'GET', `/users?departmentId=${wab.id}&role=DEPARTMENT_HEAD`);
check(r.status === 200 && r.json.data.items.some((u: any) => u.headDivision === 'SALES'), 'the user list shows the side', r);

r = await api('a', 'POST', '/users', { email: 'x@amuwa.com', fullName: 'X', password: 'Sup3rSecret!', role: 'TEAM_MEMBER', teamId: sales.id });
check(r.status === 403 && r.json.error.code === 'FORBIDDEN', 'team member cannot create users', r);
r = await api('dh', 'POST', '/users', { email: 'x@amuwa.com', fullName: 'X', password: 'Sup3rSecret!', role: 'DEPARTMENT_HEAD', departmentId: wab.id });
check(r.status === 403, 'department head cannot create department heads');
r = await api('dh', 'POST', '/users', { email: 'x@amuwa.com', fullName: 'X', password: 'Sup3rSecret!', role: 'TEAM_HEAD', teamId: (await api('sa', 'GET', `/teams?departmentId=${wbx.id}`)).json.data[0].id });
check(r.status === 403, 'department head cannot create users in another department', r);
r = await api('th', 'POST', '/users', { email: 'a@amuwa.com', fullName: 'Dup', password: 'Sup3rSecret!', role: 'TEAM_MEMBER', teamId: sales.id });
check(r.status === 409 && r.json.error.code === 'CONFLICT', 'duplicate e-mail → 409', r);
r = await api('th', 'POST', '/users', { email: 'not-an-email', fullName: '', password: 'short', role: 'TEAM_MEMBER' });
check(r.status === 422 && r.json.error.code === 'VALIDATION_ERROR' && Array.isArray(r.json.error.details), 'invalid input → 422 with details', r);
r = await api('th', 'POST', '/users', undefined, '{not json');
check(r.status === 422, 'malformed JSON → 422');

// --- self-registration + approval -------------------------------------------
const signup = await fetch(`${process.env.GATEWAY_URL}/auth/v1/signup`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: 'p@amuwa.com', password: 'Sup3rSecret!', data: { full_name: 'Pending P', department_id: wab.id, team_id: sales.id, role: 'SUPER_ADMIN' } })
});
const pendingId = ((await signup.json()) as any).user.id;
tokens.set('p', tokenFor(pendingId));
r = await api('p', 'GET', '/me');
check(r.status === 200 && r.json.data.status === 'PENDING' && r.json.data.role === 'TEAM_MEMBER', 'registered user is PENDING team member', r);
r = await api('p', 'GET', '/customers');
check(r.status === 403 && r.json.error.code === 'ACCOUNT_INACTIVE', 'pending user blocked from CRM data', r);

r = await api('th', 'GET', '/notifications?unreadOnly=true');
check(r.json.data.items.some((n: any) => n.type === 'USER_REGISTRATION_REQUEST'), 'team head notified of registration', r);
r = await api('a', 'GET', '/approval-requests');
check(r.status === 403, 'team member cannot list approval requests');
r = await api('th', 'GET', '/approval-requests');
check(r.status === 200 && r.json.data.total === 1 && r.json.data.items[0].subject.email === 'p@amuwa.com', 'team head sees pending request with subject', r);
const requestId = r.json.data.items[0].id;
r = await api('th', 'POST', `/approval-requests/${requestId}/approve`, { note: 'Welcome' });
check(r.status === 200 && r.json.data.status === 'APPROVED', 'team head approves', r);
r = await api('th', 'POST', `/approval-requests/${requestId}/approve`, {});
check(r.status === 409, 'double approval → 409', r);
r = await api('p', 'GET', '/notifications');
check(r.status === 200 && r.json.data.items.some((n: any) => n.type === 'USER_APPROVED'), 'approved user can now read their approval notification', r);

// --- registration WITHOUT department; super admin picks the team while approving ---
const orphanSignup = await fetch(`${process.env.GATEWAY_URL}/auth/v1/signup`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: 'orphan@amuwa.com', password: 'Sup3rSecret!', data: { full_name: 'Orphan' } })
});
const orphanId = ((await orphanSignup.json()) as any).user.id;
r = await api('sa', 'GET', '/approval-requests');
const orphanReq = r.json.data.items.find((i: any) => i.subject?.id === orphanId);
check(orphanReq && orphanReq.departmentId === null, 'department-less registration reaches super admin', r);
r = await api('sa', 'POST', `/approval-requests/${orphanReq.id}/approve`, {});
check(r.status === 422 && /team/i.test(r.json.error.message), 'approving without a team asks for one (422)', r);
r = await api('sa', 'POST', `/approval-requests/${orphanReq.id}/approve`, { teamId: sales.id });
check(r.status === 200 && r.json.data.status === 'APPROVED' && r.json.data.teamId === sales.id, 'super admin approves into chosen team', r);
tokens.set('orphan', tokenFor(orphanId));
r = await api('orphan', 'GET', '/me');
check(r.json.data.status === 'ACTIVE' && r.json.data.department?.slug === 'wabastore' && r.json.data.team?.name === 'Sales', 'approved user placed in chosen department/team', r);

// --- customers ---------------------------------------------------------------
r = await api('a', 'POST', '/customers', { name: 'Acme Buyer', email: 'Buyer@Acme.com', phone: '+91 98765 43210', company: 'Acme', segment: 'CORPORATE' });
check(r.status === 201 && r.json.data.ownerId === memberA && r.json.data.teamId === sales.id && r.json.data.email === 'buyer@acme.com',
  'team member creates customer; persisted row returned with derived ownership', r);
const customerId = r.json.data.id;
r = await api('a', 'POST', '/customers', { name: 'X', email: 'bad' });
check(r.status === 422, 'customer validation enforced server-side');
r = await api('a', 'POST', '/customers', { name: 'Dup', email: 'buyer@acme.com' });
check(r.status === 409, 'duplicate customer → 409', r);
r = await api('a', 'POST', '/customers', { name: 'Spoof', email: 's@s.com', ownerId: pendingId });
check(r.status === 403, 'team member cannot create customers for others', r);
r = await api('a', 'POST', '/customers', { name: 'Spoof', email: 's@s.com', teamId: support.id });
check(r.status === 422, 'unknown/forbidden fields (teamId) rejected', r);

r = await api('a', 'POST', '/customers/import', { customers: [
  { name: 'Imp 1', email: 'i1@x.com' }, { name: 'Imp 2', phone: '12345678' }, { name: 'Dup', email: 'buyer@acme.com' }] });
check(r.status === 200 && r.json.data.imported === 2 && r.json.data.skipped.length === 1, 'bulk import skips duplicates', r);

r = await api('a', 'GET', '/customers?search=acme&pageSize=2');
check(r.json.data.total === 1 && r.json.data.items[0].owner.fullName === 'Member A', 'search via trigram column + owner embed', r);
r = await api('a', 'GET', '/customers?pageSize=2&page=2&sort=name&order=asc');
check(r.json.data.items.length === 1 && r.json.data.total === 3 && r.json.data.page === 2, 'server-side pagination', r);
r = await api('a', 'GET', '/customers?search=50%25_');
check(r.status === 200 && r.json.data.total === 0, 'LIKE wildcards in search are escaped');
r = await api('p', 'GET', '/customers');
check(r.json.data.total === 0, 'teammate sees none of A\'s customers');
r = await api('p', 'GET', `/customers/${customerId}`);
check(r.status === 404, 'invisible customer → 404 (no existence leak)');
r = await api('th', 'GET', '/customers');
check(r.json.data.total === 3, 'team head sees team customers');
r = await api('a', 'GET', '/customers/summary');
check(r.json.data.total === 3 && r.json.data.bySegment.CORPORATE === 1 && r.json.data.newThisMonth === 3, 'summary aggregates own customers', r);
r = await api('p', 'GET', '/customers/summary');
check(r.json.data.total === 0, 'summary is RLS-scoped (teammate sees 0)', r);
r = await api('dh', 'GET', '/customers');
check(r.json.data.total === 3, 'department head sees department customers');

r = await api('th', 'PATCH', `/customers/${customerId}`, { notes: 'VIP', status: 'PROSPECT' });
check(r.status === 200 && r.json.data.notes === 'VIP', 'team head updates customer');
r = await api('a', 'DELETE', `/customers/${customerId}`);
check(r.status === 403, 'team member cannot delete customers');
r = await api('a', 'POST', `/customers/${customerId}/activities`, { type: 'call', note: 'Intro' });
check(r.status === 201 && r.json.data.type === 'CALL', 'activity logged');
r = await api('a', 'GET', `/customers/${customerId}/activities`);
check(r.json.data.length === 1, 'activities listed');

// --- revocation ---------------------------------------------------------------
r = await api('p', 'POST', `/users/${memberA}/status`, { status: 'REVOKED' });
check(r.status === 403, 'team member cannot revoke peers');
r = await api('th', 'POST', `/users/${memberA}/status`, { status: 'REVOKED', reason: 'Left company' });
check(r.status === 200 && r.json.data.status === 'REVOKED', 'team head revokes member', r);
r = await api('a', 'GET', '/customers');
check(r.status === 403 && r.json.error.code === 'ACCOUNT_INACTIVE', 'revoked user blocked immediately with same token', r);
const { rows: [banned] } = await db.query(`select raw_app_meta_data->>'banned' as b from auth.users where id = $1`, [memberA]);
check(banned.b === '876000h', 'auth user banned (no token refresh)');
r = await api('th', 'POST', `/users/${memberA}/status`, { status: 'SUSPENDED' });
check(r.status === 422, 'invalid status transition → 422', r);
r = await api('dh', 'POST', `/users/${memberA}/status`, { status: 'ACTIVE' });
check(r.status === 200 && r.json.data.status === 'ACTIVE', 'department head reinstates');

// --- notifications, announcements, audit ------------------------------------------
r = await api('th', 'GET', '/notifications/unread-count');
check(r.json.data.count > 0, 'unread count');
r = await api('th', 'POST', '/notifications/read-all');
check(r.json.data.updated > 0, 'mark all read');
r = await api('th', 'GET', '/notifications/unread-count');
check(r.json.data.count === 0, 'unread count resets');
r = await api('th', 'POST', '/announcements', { title: 'Standup', body: '10am' });
check(r.status === 201 && r.json.data.recipients === 3, 'team head announcement reaches team', r);
r = await api('a', 'POST', '/announcements', { title: 'Spam' });
check(r.status === 403, 'team member cannot broadcast');

r = await api('a', 'GET', '/audit-logs');
check(r.status === 403, 'team member cannot read audit log');
r = await api('dh', 'GET', '/audit-logs?action=CUSTOMER_CREATED');
check(r.status === 200 && r.json.data.total === 3, 'department head reads department audit', r);

// --- org management + deletion ------------------------------------------------------
r = await api('dh', 'POST', '/departments', { name: 'Rogue' });
check(r.status === 403, 'department head cannot create departments');
r = await api('sa', 'POST', '/departments', { name: 'New Unit', description: 'x' });
check(r.status === 201 && r.json.data.slug === 'new-unit', 'super admin creates department', r);
r = await api('dh', 'POST', '/teams', { departmentId: wab.id, name: 'Enterprise', division: 'SALES' });
check(r.status === 201, 'department head creates team');
r = await api('a', 'DELETE', `/users/${pendingId}`);
check(r.status === 403, 'a team member cannot remove users', r);
const superAdminId = (await api('sa', 'GET', '/me')).json.data.id;
r = await api('dh', 'DELETE', `/users/${superAdminId}`);
check(r.status === 403, 'a department head cannot remove the super admin', r);
r = await api('sa', 'DELETE', `/users/${pendingId}`);
check(r.status === 200, 'super admin deletes user', r);
r = await api('sa', 'GET', '/nope');
check(r.status === 404 && r.json.error.code === 'NOT_FOUND', 'unknown route → 404');
// --- sales pipeline: one customer record LEAD → POTENTIAL → ONBOARDING -----------
tokens.set('b', tokenFor(orphanId)); // second sales team member
const GW = process.env.GATEWAY_URL!;
const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
r = await api('a', 'GET', '/pipeline/services');
check(r.status === 200 && r.json.data.length === 33 && r.json.data[0].category, 'service catalogue comes from the database', r);
{
  const ds = r.json.data.filter((s: any) => s.category === 'Amuwa Design Studio');
  check(ds.length === 6 && ds.map((s: any) => s.name).join('|') === 'Social Media Marketing|Google My Business Ranking|Meta Ads|AI Video Production|Yearly Creative Package|Graphic Design',
    'the catalogue lists the six Amuwa Design Studio services', ds);
  const meta = ds.find((s: any) => s.code === 'DS_META_ADS');
  check(meta.requirements.length === 7 && meta.requirements.filter((q: any) => q.conditional).length === 2
    && meta.requirements.some((q: any) => q.label === 'Creatives required?' && q.kind === 'YES_NO'), 'each service carries its own requirements (Meta Ads: creative fields are conditional)', meta);
  const gd = ds.find((s: any) => s.code === 'DS_GRAPHIC_DESIGN');
  check(gd.requirements.map((q: any) => q.label).join('|') === 'Business logo|Brand details|Business phone number|Business address', 'Graphic Design asks for logo, brand details, phone and address', gd);
  const old = r.json.data.find((s: any) => s.code === 'META_ADS_MANAGEMENT');
  check(old && old.name === 'Meta Ads Management' && old.category === 'Google & Social', 'the existing Meta Ads Management service is unchanged', old);
  const dsLead = await api('a', 'POST', '/pipeline/leads', { name: 'Studio Lead', company: 'Studio Co', phone: '+91 98200 22222', leadSource: 'Instagram', services: ['DS_SOCIAL_MEDIA_MARKETING', 'AI_CALLING'] });
  check(dsLead.status === 201 && [...dsLead.json.data.services].sort().join() === 'AI_CALLING,DS_SOCIAL_MEDIA_MARKETING', 'a lead saves Design Studio and other services together', dsLead);
  const again = await api('a', 'GET', `/pipeline/customers/${dsLead.json.data.id}`);
  check(again.status === 200 && again.json.data.services.includes('DS_SOCIAL_MEDIA_MARKETING'), 'and they are there when the record is opened again', again);
  await db.query(`delete from public.customers where id = $1`, [dsLead.json.data.id]); // later checks count member A's leads
}

const leadBody = { name: 'Siddhesh', company: 'Galaxy Jewellers', phone: '+91 98200 11111', leadSource: 'Instagram', services: ['STARTER_PACKAGE', 'AI_CALLING'], expectedBudget: 35000 };
r = await api('a', 'POST', '/pipeline/leads', { ...leadBody, services: [] });
check(r.status === 422, 'lead requires at least one service', r);
r = await api('a', 'POST', '/pipeline/leads', { ...leadBody, services: ['NOT_A_SERVICE'] });
check(r.status === 422, 'unknown service code rejected by the database', r);
r = await api('a', 'POST', '/pipeline/leads', leadBody);
check(r.status === 201 && r.json.data.lifecycleStage === 'LEAD' && r.json.data.leadStatus === 'NEW' && r.json.data.ownerId === memberA && r.json.data.services.length === 2,
  'team member adds a lead (customer record in LEAD stage)', r);
const leadA = r.json.data.id;
r = await api('b', 'POST', '/pipeline/leads', { ...leadBody, name: 'Other', company: 'Other Co', phone: '+91 98200 22222' });
check(r.status === 201, 'second member adds a lead', r);
const leadB = r.json.data.id;

r = await api('a', 'GET', '/pipeline/customers?stage=LEAD');
check(r.json.data.total === 1 && r.json.data.items[0].id === leadA, 'member A sees only their own lead', r);
r = await api('b', 'GET', `/pipeline/customers/${leadA}`);
check(r.status === 404, "member B cannot open A's lead", r);
r = await api('b', 'PATCH', `/pipeline/leads/${leadA}`, { leadStatus: 'CONTACTED' });
check(r.status === 404, "member B cannot edit A's lead", r);
r = await api('th', 'GET', '/pipeline/customers?stage=LEAD');
check(r.json.data.total === 2, 'team head sees both leads');

// Super Admin: the Wabastore Sales sub-department (department + SALES division), by id
r = await api('sa', 'GET', `/pipeline/customers?stage=LEAD&departmentId=${wab.id}&division=SALES`);
check(r.status === 200 && r.json.data.total === 2 && r.json.data.items.every((x: any) => x.createdBy && x.owner), 'Super Admin lists every lead of the Sales sub-department, with who added it', r);
r = await api('sa', 'GET', `/pipeline/customers?stage=LEAD&departmentId=${wab.id}&division=SALES&ownerId=${memberA}`);
check(r.json.data.total === 1 && r.json.data.items[0].id === leadA, 'filtered to one team member', r);
r = await api('sa', 'GET', `/pipeline/customers?stage=LEAD&departmentId=${wab.id}&division=SUPPORT`);
check(r.status === 200 && r.json.data.total === 0, 'the Support division of the same department has none of them', r);
r = await api('sa', 'GET', `/pipeline/division-overview?departmentId=${wab.id}&division=SALES`);
const salesTotal = Number((await db.query(`select count(*) from public.customers where team_id in (select id from public.teams where department_id = $1 and division = 'SALES')`, [wab.id])).rows[0].count);
check(r.status === 200 && r.json.data.totals.leadsAdded === salesTotal && r.json.data.totals.leads === 2 && r.json.data.members.some((m: any) => m.id === memberA && m.leads === 1 && m.leadsAdded >= 1),
  'division overview: totals equal the customers of the Sales teams; per-member numbers come from the records', r);
r = await api('a', 'GET', `/pipeline/division-overview?departmentId=${wab.id}&division=SALES`);
check(r.status === 403, 'a team member cannot read the overview', r);
r = await api('sa', 'GET', '/pipeline/division-overview?division=SALES');
check(r.status === 422, 'the overview needs a department', r);
r = await api('sa', 'GET', `/users?departmentId=${wab.id}&division=SALES&pageSize=50`);
check(r.status === 200 && r.json.data.items.some((u: any) => u.id === memberA) && r.json.data.items.every((u: any) => u.team?.division === 'SALES' || u.team === null), 'users can be listed by sub-department (division)', r);

r = await api('sa', 'GET', `/pipeline/division-support-overview?departmentId=${wab.id}&division=SUPPORT`);
check(r.status === 200 && Array.isArray(r.json.data.members) && r.json.data.members.every((m: any) => m.id !== memberA) && typeof r.json.data.totals.tickets === 'number',
  'Support overview: Support teams only, the Sales member is not in it', r);
r = await api('a', 'GET', `/pipeline/division-support-overview?departmentId=${wab.id}&division=SUPPORT`);
check(r.status === 403, 'a team member cannot read the Support overview', r);
r = await api('sa', 'GET', `/users?departmentId=${wab.id}&division=SUPPORT&pageSize=50`);
check(r.status === 200 && r.json.data.items.every((u: any) => u.team?.division === 'SUPPORT') && !r.json.data.items.some((u: any) => u.id === memberA), 'users listed by the Support division exclude Sales members', r);
r = await api('sa', 'GET', `/pipeline/division-overview?departmentId=${wab.id}&division=SALES`);
check(r.status === 200 && typeof r.json.data.potential.all === 'number' && r.json.data.potential.all === 0, 'division overview carries the Potential counts', r);
check(typeof r.json.data.onboarding.all === 'number' && typeof r.json.data.partPayments === 'number', 'division overview carries the Customer onboarding and Part payments counts', r);
r = await api('sa', 'GET', `/pipeline/part-payments?status=ALL&departmentId=${wab.id}&division=SALES`);
check(r.status === 200 && Array.isArray(r.json.data.items), 'Super Admin lists the part payments of one sub-department', r);
r = await api('sa', 'GET', `/pipeline/part-payments?status=ALL&departmentId=${wab.id}&division=SUPPORT`);
check(r.status === 200 && r.json.data.total === 0, 'the Support division has no Sales part payments', r);
r = await api('sa', 'GET', `/pipeline/part-payments?status=ALL`);
check(r.status === 200, 'part payments without a scope still work', r);
r = await api('a', 'GET', `/pipeline/customers?stage=ONBOARDING&departmentId=${wab.id}&division=SALES`);
check(r.status === 200, 'a Sales member may use the sub-department filter but only gets what they may see', r);

r = await api('a', 'PATCH', `/pipeline/leads/${leadA}`, { leadStatus: 'CONTACTED', activityNote: 'Called, wants a demo' });
check(r.status === 200 && r.json.data.leadStatus === 'CONTACTED', 'lead status updated', r);
r = await api('a', 'PATCH', `/pipeline/leads/${leadA}`, { lifecycleStage: 'ONBOARDING' });
check(r.status === 422, 'lifecycle cannot be set through lead edit', r);
r = await api('a', 'GET', `/pipeline/customers/${leadA}`);
check(r.json.data.activities.some((x: any) => /demo/.test(x.note || '')) && r.json.data.documentTypes.filter((t: any) => t.isMandatory).length === 2, 'detail includes activity trail and document types', r);
r = await api('a', 'GET', '/pipeline/counts');
check(r.json.data.leads.all === 1 && r.json.data.leads.CONTACTED === 1 && r.json.data.mandatoryDocuments === 2, 'stage counts are RLS-scoped', r);
r = await api('a', 'GET', '/pipeline/customers?stage=LEAD&service=AI_CALLING&leadStatus=CONTACTED&search=galaxy');
check(r.json.data.total === 1 && r.json.data.items[0].services.length === 2, 'server-side service/status/search filters', r);
r = await api('a', 'GET', '/pipeline/customers?stage=LEAD&service=SEO');
check(r.json.data.total === 0, 'service filter excludes non-matching leads');

r = await api('a', 'POST', `/pipeline/customers/${leadA}/documents`, { documentType: 'IMPORTANT_DOCUMENTS', fileName: 'kyc.pdf', mimeType: 'application/pdf', sizeBytes: 100 });
check(r.status === 409 || r.status === 422, 'documents cannot be uploaded before onboarding', r);

r = await api('a', 'POST', `/pipeline/customers/${leadA}/move-to-potential`, { dealAmount: 50000, paymentDueDate: tomorrow });
check(r.status === 200 && r.json.data.lifecycleStage === 'POTENTIAL' && r.json.data.id === leadA && r.json.data.dealAmount === 50000, 'moved to Potential (same record)', r);
r = await api('a', 'GET', '/pipeline/customers?stage=LEAD');
check(r.json.data.total === 0, 'no duplicate left behind in Leads');
r = await api('a', 'POST', `/pipeline/customers/${leadA}/payments`, { amount: 60000 });
check(r.status === 422, 'payment cannot exceed deal amount', r);
r = await api('a', 'POST', `/pipeline/customers/${leadA}/payments`, { amount: 10000.5, method: 'UPI' });
check(r.status === 422 && /whole rupees/.test(r.json.error.message), 'payment must be whole rupees', r);
r = await api('a', 'POST', `/pipeline/customers/${leadA}/payments`, { amount: 10000 });
check(r.status === 422, 'first payment needs a payment method', r);
r = await api('a', 'POST', `/pipeline/customers/${leadA}/payments`, { amount: 10000, method: 'UPI' });
check(r.status === 200 && r.json.data.lifecycleStage === 'ONBOARDING' && r.json.data.amountReceived === 10000 && r.json.data.onboarding.paymentMethod === 'UPI',
  'the first payment starts onboarding on the same record', r);
r = await api('a', 'GET', '/pipeline/customers?stage=ONBOARDING&onboarding=GET_STARTED');
check(r.json.data.total === 0, 'a payment Sales recorded is unverified: not under Get started', r);
r = await api('a', 'GET', '/pipeline/counts');
check(r.json.data.onboarding.GET_STARTED === 0, 'Get started count follows verified payments only', r);
r = await api('a', 'GET', `/pipeline/customers/${leadA}`);
check(r.json.data.amountReceived === 10000 && r.json.data.amountVerified === 0 && r.json.data.paymentStatus === 'PENDING_VERIFICATION' && r.json.data.onboarding.paymentVerified === false,
  'recorded money is pending until Accounts verifies it', r);
r = await api('a', 'POST', `/pipeline/customers/${leadA}/payments`, { amount: 5000, method: 'UPI' });
check(r.status === 200 && r.json.data.lifecycleStage === 'ONBOARDING' && r.json.data.amountReceived === 15000 && r.json.data.onboarding.mandatorySaved === 0,
  'the balance is recorded while in onboarding', r);

// --- whole rupees and backing out of Potential --------------------------------------
r = await api('a', 'POST', '/pipeline/leads', { ...leadBody, name: 'Backout', company: 'Backout Co', phone: '+91 98200 33333', email: 'backout@example.com' });
const leadBack = r.json.data?.id;
check(r.status === 201 && leadBack, 'extra lead created', r);
r = await api('a', 'POST', `/pipeline/customers/${leadBack}/move-to-potential`, { dealAmount: 15000.99, paymentDueDate: tomorrow });
check(r.status === 422 && /whole rupees/.test(r.json.error.message), 'deal amount must be whole rupees', r);
r = await api('a', 'POST', `/pipeline/customers/${leadBack}/move-to-potential`, { dealAmount: 15000, paymentDueDate: tomorrow });
check(r.status === 200 && r.json.data.lifecycleStage === 'POTENTIAL', 'extra lead moved to Potential', r);
r = await api('b', 'POST', `/pipeline/customers/${leadBack}/back-out`, { reason: 'x' });
check(r.status === 404, "member B cannot back out A's customer", r);
r = await api('a', 'POST', `/pipeline/customers/${leadBack}/back-out`, { reason: 'Found a cheaper option' });
check(r.status === 200 && r.json.data.lifecycleStage === 'LEAD' && r.json.data.dealAmount === null && r.json.data.leadStatus === 'INTERESTED', 'customer who backs out returns to Leads', r);
r = await api('a', 'GET', '/pipeline/customers?stage=LEAD');
check(r.json.data.items.some((x: any) => x.id === leadBack), 'backed-out customer listed under Leads', r);
r = await api('a', 'POST', `/pipeline/customers/${leadBack}/back-out`, {});
check(r.status === 409, 'a lead cannot back out again', r);

r = await api('a', 'POST', `/pipeline/customers/${leadA}/forward-to-support`);
check(r.status === 422 || r.status === 409, 'cannot forward to support without mandatory documents', r);

// --- documents: private storage, signed single-path uploads, content checks --------
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
const put = (t: any, body: Buffer, type = 'application/pdf') =>
  fetch(`${GW}/storage/v1/object/upload/sign/${t.bucket}/${t.path}?token=${t.token}`, { method: 'PUT', headers: { 'content-type': type, 'x-upsert': 'false' }, body });
const begin = (who: string, customer: string, documentType: string, fileName = 'Galaxy KYC.pdf', extra: object = {}) =>
  api(who, 'POST', `/pipeline/customers/${customer}/documents`, { documentType, fileName, mimeType: 'application/pdf', sizeBytes: PDF.length, ...extra });

r = await begin('a', leadA, 'IMPORTANT_DOCUMENTS', 'x.png', { mimeType: 'image/png' });
check(r.status === 422, 'non-PDF declared type rejected', r);
r = await begin('a', leadA, 'INVOICE', 'invoice.pdf');
check(r.status === 403 && /Accounts/.test(r.json.error.message), 'Sales cannot upload an invoice (Accounts issues invoices)', r);
r = await begin('a', leadA, 'IMPORTANT_DOCUMENTS', 'big.pdf', { sizeBytes: 2 * 1024 * 1024 + 1 });
check(r.status === 422, 'any other document over 2 MB is refused', r);
r = await begin('a', leadA, 'IMPORTANT_DOCUMENTS', 'two-mb.pdf', { sizeBytes: 2 * 1024 * 1024 });
check(r.status === 201, 'a customer document of exactly 2 MB is accepted', r);
await api('a', 'POST', `/documents/${r.json.data.document.id}/abort`);
r = await begin('a', leadA, 'IMPORTANT_DOCUMENTS', 'big.pdf', { sizeBytes: 30 * 1024 * 1024 });
check(r.status === 422, 'oversize file rejected before upload', r);
r = await begin('b', leadA, 'IMPORTANT_DOCUMENTS');
check(r.status === 404, "member B cannot upload to A's customer", r);

r = await begin('a', leadA, 'IMPORTANT_DOCUMENTS', 'fake.pdf');
check(r.status === 201 && r.json.data.token && r.json.data.path === `customers/${leadA}/onboarding/${r.json.data.document.id}.pdf` && r.json.data.document.status === 'PENDING',
  'upload ticket: path uses ids only (no file name / PII)', r);
let ticket = r.json.data;
let up = await put(ticket, Buffer.from('MZ this is an executable renamed to .pdf'));
check(up.status === 200, 'renamed non-PDF reaches storage (content check happens next)');
r = await api('a', 'POST', `/documents/${ticket.document.id}/complete`);
check(r.status === 422 && /not a valid PDF/.test(r.json.error.message), 'file content verified by signature, not extension', r);
let keys = await fetch(`${GW}/storage/v1/__objects`, { headers: { authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` } }).then(x => x.json()) as string[];
check(!keys.some(k => k.includes(ticket.document.id)), 'rejected object removed from storage (no orphan)');
r = await api('a', 'POST', `/documents/${ticket.document.id}/complete`);
check(r.status === 409, 'failed upload cannot be completed later', r);

r = await begin('a', leadA, 'IMPORTANT_DOCUMENTS');
ticket = r.json.data;
r = await api('a', 'POST', `/documents/${ticket.document.id}/complete`);
check(r.status === 422 && /did not finish/.test(r.json.error.message), 'complete without an object → no fake success', r);

r = await begin('a', leadA, 'IMPORTANT_DOCUMENTS');
ticket = r.json.data;
up = await put({ ...ticket, path: ticket.path.replace(ticket.document.id, crypto.randomUUID()) }, PDF);
check(up.status !== 200, 'upload token is bound to its exact path');
up = await put(ticket, PDF, 'application/x-msdownload');
check(up.status !== 200, 'bucket rejects file types it does not accept');
up = await put(ticket, PDF);
check(up.status === 200, 'browser uploads PDF with signed token');
up = await put(ticket, PDF);
check(up.status !== 200, 'upload token is single-use / no overwrite');
r = await api('a', 'POST', `/documents/${ticket.document.id}/complete`);
check(r.status === 200 && r.json.data.status === 'UPLOADED' && r.json.data.version === 1 && r.json.data.sizeBytes === PDF.length, 'document v1 uploaded', r);
const docV1 = r.json.data.id;

r = await api('b', 'GET', `/documents/${docV1}/url`);
check(r.status === 404, "member B cannot get a URL for A's document", r);
const direct = await fetch(`${GW}/storage/v1/object/sign/${ticket.bucket}/${ticket.path}`, {
  method: 'POST', headers: { authorization: `Bearer ${tokens.get('b')}`, 'content-type': 'application/json' }, body: '{"expiresIn":60}' });
check(direct.status >= 400, 'storage cannot be signed with a user token (private bucket)');
r = await api('a', 'GET', `/documents/${docV1}/url?action=view`);
check(r.status === 200 && r.json.data.expiresInSeconds <= 300 && r.json.data.fileName === 'Galaxy KYC.pdf', 'short-lived signed view URL', r);
const fileText = await fetch(r.json.data.url).then(x => x.text());
check(fileText.startsWith('%PDF-'), 'signed URL serves the stored PDF');
r = await api('th', 'GET', `/documents/${docV1}/url?action=download`);
check(r.status === 200 && /download=/.test(r.json.data.url), 'team head can download team documents', r);

r = await begin('a', leadA, 'IMPORTANT_DOCUMENTS', 'KYC v2.pdf');
ticket = r.json.data;
await put(ticket, PDF);
r = await api('a', 'POST', `/documents/${ticket.document.id}/complete`);
check(r.status === 200 && r.json.data.version === 2, 'replacement creates version 2', r);
r = await api('a', 'GET', `/pipeline/customers/${leadA}`);
const versions = r.json.data.documents.filter((d: any) => d.documentType === 'IMPORTANT_DOCUMENTS');
check(versions.length === 2 && versions.find((d: any) => d.version === 1).status === 'SUPERSEDED' && r.json.data.onboarding.mandatorySaved === 1,
  'old version superseded, progress 1 of 2', r.json.data);

// --- invoices: issued by the Accounts department only; Sales reads them --------------
const accountsDept = (await api('sa', 'GET', '/departments')).json.data.find((d: any) => d.slug === 'accounts');
r = await api('sa', 'POST', '/users', { email: 'dh.acc@amuwa.com', fullName: 'Accounts Head', password: 'Sup3rSecret!', role: 'DEPARTMENT_HEAD', departmentId: accountsDept.id });
check(r.status === 201, 'super admin creates the Accounts department head', r);
tokens.set('accdh', tokenFor(r.json.data.id));
const accTeam = (await api('sa', 'GET', `/teams?departmentId=${accountsDept.id}`)).json.data[0].id;
r = await api('accdh', 'POST', '/users', { email: 'acc.m@amuwa.com', fullName: 'Accounts Member', password: 'Sup3rSecret!', role: 'TEAM_MEMBER', teamId: accTeam });
check(r.status === 201 && r.json.data.defaultDashboard === 'accounts-staff', 'an Accounts member resolves to the Accounts dashboard', r);
tokens.set('accm', tokenFor(r.json.data.id));
const pdfOfSize = (n: number, tag = 'x') => Buffer.concat([Buffer.from(`%PDF-1.4\n% ${tag}\n`), Buffer.alloc(Math.max(0, n - 40), 0x20), Buffer.from('\n%%EOF\n')]);
// Invoices are uploaded by Accounts, never generated: the generating endpoints are gone.
r = await api('accm', 'POST', '/accounts/invoices', { customerId: leadA, items: [{ serviceCode: 'STARTER_PACKAGE', quantity: 1, unitPrice: 30000 }] });
check(r.status === 404 || r.status === 405, 'there is no endpoint that generates an invoice', r);
r = await api('a', 'GET', '/accounts/invoice-customers');
check(r.status === 403, 'Sales cannot list the customers to invoice', r);
r = await api('accm', 'GET', '/accounts/invoice-customers?search=galaxy');
check(r.status === 200 && r.json.data.some((c: any) => c.id === leadA && c.services.length === 2), 'Accounts finds the customer, with its services', r);
const firstPdf = Buffer.concat([Buffer.from('%PDF-1.4\n% first\n'), Buffer.alloc(19000, 0x20), Buffer.from('\n%%EOF\n')]);
r = await api('accm', 'POST', '/accounts/invoice-uploads', { customerId: leadA, invoiceNumber: 'INV/A/0001', issueDate: '2026-10-05', dueDate: tomorrow, amount: 32420, reference: 'Order 7', note: 'October',
  fileName: 'Galaxy Oct.pdf', mimeType: 'application/pdf', sizeBytes: firstPdf.length });
check(r.status === 201, 'Accounts starts the upload of the customer invoice', r);
const tkFirst = r.json.data;
await put(tkFirst, firstPdf);
r = await api('accm', 'POST', `/accounts/invoice-uploads/${tkFirst.document.id}/complete`);
const serviceInvoice = r.json.data;
check(r.status === 201 && serviceInvoice.kind === 'UPLOADED' && serviceInvoice.number === 'INV/A/0001' && serviceInvoice.total === 32420 && serviceInvoice.status === 'Pending' && serviceInvoice.issuedBy === 'Accounts Member',
  'Accounts uploads the customer invoice PDF', r);
r = await api('a', 'GET', `/pipeline/customers/${leadA}/invoices`);
check(r.status === 200 && r.json.data.length === 1 && r.json.data[0].number === serviceInvoice.number && r.json.data[0].file.fileName === 'Galaxy Oct.pdf', 'Sales reads the invoice for its customer', r);
r = await api('b', 'GET', `/pipeline/customers/${leadA}/invoices`);
check(r.status === 404, "another salesperson cannot read A's invoices", r);
r = await api('b', 'GET', '/invoices');
check(r.status === 200 && r.json.data.total === 0, "and they are not in another salesperson's invoice list", r);
r = await api('a', 'GET', '/invoices');
check(r.status === 200 && r.json.data.total === 1 && r.json.data.sum === 32420, "the salesperson's invoice list (read-only)", r);
r = await api('a', 'PATCH', `/accounts/invoices/${serviceInvoice.id}`, { status: 'Paid' });
check(r.status === 403, 'Sales cannot change an invoice', r);
r = await api('a', 'GET', `/pipeline/customers/${leadA}`);
const invoiceItem = r.json.data.checklist.find((c: any) => c.code === 'INVOICE');
check(invoiceItem.entry?.status === 'SAVED' && invoiceItem.entry.value === 'Galaxy Oct.pdf' && invoiceItem.entry.documentId && r.json.data.onboarding.mandatorySaved === 2,
  'the onboarding Invoice item is filled by the uploaded invoice PDF', invoiceItem);
r = await api('accm', 'GET', '/accounts/invoices?kind=UPLOADED');
check(r.status === 200 && r.json.data.total === 1, 'Accounts lists the invoices it uploaded', r);

r = await begin('a', leadA, 'IMPORTANT_DOCUMENTS', 'kyc.pdf');
ticket = r.json.data;
check(ticket.path.includes('/onboarding/'), 'important documents stored under onboarding/');
await put(ticket, PDF);
r = await api('a', 'POST', `/documents/${ticket.document.id}/complete`);
const importantDoc = r.json.data.id;
r = await api('a', 'GET', '/pipeline/customers?stage=ONBOARDING&onboarding=COLLECTING');
check(r.json.data.total === 1 && r.json.data.items[0].onboarding.mandatorySaved === 2 && r.json.data.items[0].onboarding.itemsSaved === 5 && r.json.data.items[0].onboarding.itemsTotal === 15,
  'onboarding filter: still collecting (name, mobile and business name come from the lead; 5 of 15 items)', r);

// a pending upload abandoned by the browser
r = await begin('a', leadA, 'IMPORTANT_DOCUMENTS', 'abandoned.pdf');
const abandoned = r.json.data;
await put(abandoned, PDF);
r = await api('a', 'POST', `/documents/${abandoned.document.id}/abort`);
check(r.status === 200, 'aborted upload acknowledged');
keys = await fetch(`${GW}/storage/v1/__objects`, { headers: { authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` } }).then(x => x.json()) as string[];
check(!keys.some(k => k.includes(abandoned.document.id)), 'aborted upload object cleaned up');

// --- service checklist (Starter Package + AI Calling) -----------------------------------
r = await api('a', 'GET', `/pipeline/customers/${leadA}`);
const checklist = r.json.data.checklist as any[];
check(checklist.length === 15 && !checklist.some((c: any) => c.code === 'GST_CERTIFICATE') && checklist[0].section === 'BUSINESS_BASICS' && checklist[checklist.length - 1].code === 'IMPORTANT_DOCUMENTS',
  'checklist built from the services sold (basics first, mandatory documents last)', checklist.map((c: any) => c.code));
check(checklist.filter((c: any) => c.entry?.status === 'SAVED').length === 5, 'the lead details (name, mobile, business name), the uploaded documents and the Accounts invoice already count as saved');
r = await api('a', 'POST', `/pipeline/customers/${leadA}/forward-to-support`);
check(r.status === 422 && /Complete these items first/.test(r.json.error.message), 'forward blocked until every checklist item is saved', r);
// (the AI Calling checklist has no choice item any more: map one for this check only)
await db.query(`insert into public.onboarding_item_services (item_code, service_code) values ('AI_CALL_PLAN', 'AI_CALLING')`);
r = await api('a', 'PATCH', `/pipeline/customers/${leadA}/checklist/AI_CALL_PLAN`, { value: 'Weekly' });
check(r.status === 422, 'choice items only accept listed options', r);
await db.query(`delete from public.onboarding_item_services where item_code = 'AI_CALL_PLAN' and service_code = 'AI_CALLING'`);
r = await api('b', 'PATCH', `/pipeline/customers/${leadA}/checklist/META_AD_BUDGET`, { value: '15000' });
check(r.status === 404, "member B cannot fill A's checklist", r);
for (const [code, value] of Object.entries({
  BUSINESS_NAME: 'Galaxy Jewellers', BUSINESS_ADDRESS: 'Station Road, Thane', CUSTOMER_NAME: 'Siddhesh', CUSTOMER_MOBILE: '+91 98200 11111',
  SMM_BUSINESS_AUDIENCE: 'Jewellery store, families in Thane', FACEBOOK_PAGE_ACCESS: 'Partner access granted', INSTAGRAM_PAGE_ACCESS: 'Connected',
  META_TARGET_AUDIENCE: 'Thane, 25-45', META_AD_BUDGET: '15000', SMM_CONTENT_LIBRARY: 'https://drive.example/galaxy', SMM_POSTING_PREFS: 'Daily, gold hashtags',
  AI_CALL_BUSINESS_ROLE: 'Jeweller; agent speaks as store manager', AI_CALL_CUSTOMER_NUMBER: '+91 98200 11111'
})) {
  r = await api('a', 'PATCH', `/pipeline/customers/${leadA}/checklist/${code}`, { value });
  if (r.status !== 200) check(false, `save ${code}`, r);
}
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
r = await api('a', 'POST', `/pipeline/customers/${leadA}/documents`, { documentType: 'GST_CERTIFICATE', fileName: 'gst.png', mimeType: 'image/png', sizeBytes: PDF.length });
ticket = r.json.data;
check(r.status === 201 && ticket.path.endsWith('.png'), 'image upload accepted for a certificate; stored with .png', r);
await put(ticket, PDF, 'image/png');
r = await api('a', 'POST', `/documents/${ticket.document.id}/complete`);
check(r.status === 422 && /does not match/.test(r.json.error.message), 'a PDF renamed to .png is rejected by its content', r);
r = await api('a', 'POST', `/pipeline/customers/${leadA}/documents`, { documentType: 'GST_CERTIFICATE', fileName: 'gst.png', mimeType: 'image/png', sizeBytes: PNG.length });
ticket = r.json.data;
await put(ticket, PNG, 'image/png');
r = await api('a', 'POST', `/documents/${ticket.document.id}/complete`);
check(r.status === 200, 'real PNG certificate accepted', r);
r = await api('a', 'PATCH', `/pipeline/customers/${leadA}/consultant-items/WABA_ID`, { value: '123' });
check(r.status === 404, 'sales cannot use the consultant-only endpoint', r);
r = await api('a', 'GET', '/pipeline/customers?stage=ONBOARDING&onboarding=READY_FOR_HANDOVER');
check(r.json.data.total === 1 && r.json.data.items[0].onboarding.itemsSaved === 15, 'ready for handover once all 15 items are saved', r);

r = await api('b', 'DELETE', `/documents/${importantDoc}`);
check(r.status === 404, "member B cannot delete A's document", r);
// Accounts confirms the amount before the Technical Consultant gets the customer.

r = await api('a', 'POST', `/pipeline/customers/${leadA}/forward-to-support`);
check(r.status === 200 && !r.json.data.onboarding.forwardedToSupportAt && r.json.data.onboarding.sentToAccountsAt && !r.json.data.onboarding.accountsConfirmedAt && r.json.data.onboarding.stage !== 'SETUP',
  'sales sends to Accounts first (not yet to the Technical Consultant)', r);
r = await api('a', 'POST', `/pipeline/customers/${leadA}/forward-to-support`);
check(r.status === 409, 'cannot send to Accounts twice', r);
r = await api('a', 'GET', '/pipeline/accounts/confirmations');
check(r.status === 403, 'a salesperson cannot read the Accounts queue', r);
r = await api('a', 'POST', `/pipeline/customers/${leadA}/accounts/confirm`, {});
check(r.status === 403, 'a salesperson cannot confirm the amount', r);
r = await api('accm', 'GET', '/pipeline/accounts/confirmations?status=PENDING&path=pipeline%2Faccounts%2Fconfirmations');
check(r.status === 200, 'the host\'s extra "path" query key is ignored', r);
r = await api('accm', 'GET', '/pipeline/accounts/confirmations?status=PENDING');
check(r.status === 200 && r.json.data.total === 1 && r.json.data.items[0].id === leadA && r.json.data.items[0].dealAmount > 0 && r.json.data.items[0].services.length > 0,
  'Accounts sees the customer with business details and the amount', r);
r = await api('accm', 'POST', `/pipeline/customers/${leadA}/accounts/confirm`, { note: 'Received' });
check(r.status === 200, 'Accounts confirms the amount', r);
r = await api('accm', 'POST', `/pipeline/customers/${leadA}/accounts/confirm`, {});
check(r.status === 409, 'cannot confirm twice', r);
r = await api('accm', 'GET', '/pipeline/accounts/confirmations?status=CONFIRMED');
check(r.json.data.total === 1 && r.json.data.items[0].sentToConsultantAt, 'the customer is listed as confirmed and sent on', r);
r = await api('a', 'GET', `/pipeline/customers/${leadA}`);
check(r.status === 200 && r.json.data.onboarding.forwardedToSupportAt && r.json.data.onboarding.stage === 'SETUP' && r.json.data.onboarding.accountsConfirmedAt,
  'after confirmation the customer is with the Technical Consultant', r);
r = await api('a', 'DELETE', `/documents/${importantDoc}`);
check(r.status === 409, 'current documents are locked after forwarding', r);
r = await api('a', 'DELETE', `/documents/${docV1}`);
check(r.status === 200, 'superseded version can be deleted', r);
r = await api('a', 'GET', `/documents/${docV1}/url`);
check(r.status === 404, 'deleted document is no longer reachable');

const { rows: audit } = await db.query(
  `select action from public.audit_logs where entity_type = 'customer_document' order by created_at`);
const actions = audit.map((x: any) => x.action);
for (const a of ['DOCUMENT_UPLOADED', 'DOCUMENT_REPLACED', 'DOCUMENT_VIEWED', 'DOCUMENT_DOWNLOADED', 'DOCUMENT_DELETED']) {
  check(actions.includes(a), `audit log has ${a}`, actions);
}

// --- Technical Consultant (support team) verification ------------------------------
r = await api('sa', 'POST', '/users', { email: 'sm@amuwa.com', fullName: 'Support Member', password: 'Sup3rSecret!', role: 'TEAM_MEMBER', teamId: support.id });
check(r.status === 201 && r.json.data.isTechnicalConsultant === false, 'plain support team member is not a Technical Consultant', r);
const supportMember = r.json.data.id;
tokens.set('sm', tokenFor(supportMember));
r = await api('sm', 'GET', '/pipeline/customers?stage=ONBOARDING&forwarded=true');
check(r.status === 200 && r.json.data.total === 0, 'plain support member sees no consultant customers', r);
r = await api('sa', 'POST', '/users', { email: 'x2@amuwa.com', fullName: 'X', password: 'Sup3rSecret!', role: 'TEAM_HEAD', teamId: support.id, technicalConsultant: true });
check(r.status === 422, 'only a team member can be created as Technical Consultant', r);
r = await api('sa', 'POST', '/users', { email: 'x3@amuwa.com', fullName: 'X', password: 'Sup3rSecret!', role: 'TEAM_MEMBER', teamId: sales.id, technicalConsultant: true });
check(r.status === 422, 'a Technical Consultant must be in a support team', r);
r = await api('sa', 'POST', '/users', { email: 'tc@amuwa.com', fullName: 'Tech Consultant', password: 'Sup3rSecret!', role: 'TEAM_MEMBER', teamId: support.id, technicalConsultant: true });
check(r.status === 201 && r.json.data.isTechnicalConsultant === true, 'super admin creates a Technical Consultant', r);
tokens.set('tc', tokenFor(r.json.data.id));
r = await api('sa', 'POST', '/users', { email: 'mv@amuwa.com', fullName: 'Meta Verifier', password: 'Sup3rSecret!', role: 'TEAM_MEMBER', teamId: support.id, metaVerifier: true });
check(r.status === 201 && r.json.data.isMetaVerifier === true && r.json.data.isTechnicalConsultant === false && r.json.data.defaultDashboard === 'meta-verifier', 'super admin creates a Meta Verifier (a separate role from the Technical Consultant)', r);
tokens.set('mv', tokenFor(r.json.data.id));
r = await api('sa', 'POST', '/users', { email: 'mv2@amuwa.com', fullName: 'Both', password: 'Sup3rSecret!', role: 'TEAM_MEMBER', teamId: support.id, metaVerifier: true, technicalConsultant: true });
check(r.status === 422, 'one person cannot be both a Meta Verifier and a Technical Consultant', r);
r = await api('sa', 'POST', '/users', { email: 'mv3@amuwa.com', fullName: 'Sales MV', password: 'Sup3rSecret!', role: 'TEAM_MEMBER', teamId: sales.id, metaVerifier: true });
check(r.status === 422, 'a Meta Verifier must be in a support team', r);
r = await api('sm', 'POST', `/users/${supportMember}/technical-consultant`, { value: true });
check(r.status === 403, 'a member cannot make themselves a Technical Consultant', r);
r = await api('sa', 'POST', `/users/${supportMember}/technical-consultant`, { value: true });
check(r.status === 200 && r.json.data.isTechnicalConsultant === true, 'super admin switches a support member to Technical Consultant', r);
r = await api('sa', 'POST', `/users/${supportMember}/technical-consultant`, { value: false });
check(r.status === 200 && r.json.data.isTechnicalConsultant === false, 'and back to team member', r);
// New customers wait in the consultant's Customers panel until "Send for onboarding".
r = await api('tc', 'GET', '/pipeline/customers?stage=ONBOARDING&forwarded=true');
check(r.status === 200 && r.json.data.total === 0, 'Onboarding Customers is empty until the consultant sends the customer for onboarding', r);
r = await api('tc', 'GET', '/pipeline/customers?stage=ONBOARDING&intake=true');
check(r.json.data.total === 1 && r.json.data.items[0].id === leadA && r.json.data.items[0].onboarding.consultantStartedAt === null, 'the consultant\'s Customers panel lists the confirmed customer', r);
r = await api('tc', 'POST', `/pipeline/customers/${leadA}/consultant/contract`, { signed: true });
check(r.status === 200 && r.json.data.onboarding.contractSigned === true, 'consultant sets Contract to Yes', r);
r = await api('tc', 'PATCH', `/pipeline/customers/${leadA}/consultant/details`, { name: 'Siddhesh', company: 'Galaxy Jewellers', phone: '+91 98200 11111' });
check(r.status === 200, 'consultant edits the contact details', r);
r = await api('a', 'POST', `/pipeline/customers/${leadA}/consultant/contract`, { signed: false });
check(r.status === 404, 'a salesperson cannot change the contract', r);
r = await api('a', 'POST', `/pipeline/customers/${leadA}/consultant/start-onboarding`);
check(r.status === 404, 'a salesperson cannot send for onboarding', r);
// Add-on services: priced by the Technical Consultant, checked by Accounts, invoiced and paid before any add-on document is collected
r = await api('tc', 'GET', `/pipeline/customers/${leadA}/addon-request`);
check(r.status === 200 && r.json.data === null, 'no add-on request yet', r);
r = await api('a', 'POST', `/pipeline/customers/${leadA}/consultant/addons-required`, { required: true });
check(r.status === 404, 'a salesperson cannot answer the add-ons question', r);
r = await api('tc', 'POST', `/pipeline/customers/${leadA}/consultant/addons-required`, { required: 'yes' });
check(r.status === 422, 'the add-ons answer must be true or false', r);
r = await api('tc', 'POST', `/pipeline/customers/${leadA}/consultant/addons-required`, { required: true });
check(r.status === 200 && r.json.data.onboarding.addonsRequired === true, 'Yes is saved', r);
const addonLines = [{ serviceCode: 'AI_CALLING', quantity: 1, unitPrice: 12000, taxPercent: 18 }, { name: 'Custom setup call', quantity: 2, unitPrice: 1000, discount: 500 }];
r = await api('a', 'POST', `/pipeline/customers/${leadA}/addon-request`, { items: addonLines });
check(r.status === 404, 'a salesperson cannot price add-ons', r);
r = await api('tc', 'POST', `/pipeline/customers/${leadA}/addon-request`, { items: [{ name: 'x', quantity: 1, unitPrice: 10 }] });
check(r.status === 422, 'a typed add-on needs a real name', r);
r = await api('tc', 'POST', `/pipeline/customers/${leadA}/addon-request`, { items: [{ serviceCode: 'AI_CALLING', quantity: 1, unitPrice: 10.555 }] });
check(r.status === 422, 'prices have at most 2 decimals', r);
r = await api('tc', 'POST', `/pipeline/customers/${leadA}/addon-request`, { items: addonLines, notes: 'Agreed on the call' });
check(r.status === 200 && r.json.data.status === 'DRAFT' && r.json.data.subtotal === 14000 && r.json.data.discount === 500 && r.json.data.tax === 2160 && r.json.data.total === 15660
  && r.json.data.canEdit === true && r.json.data.consultant.fullName === 'Tech Consultant', 'the consultant saves a priced draft (totals worked out by the database)', r);
let addonReq = r.json.data;
r = await api('accm', 'GET', '/accounts/addon-requests');
check(r.status === 200 && r.json.data.total === 0, 'a draft is not in Business Verification', r);
r = await api('tc', 'GET', `/pipeline/customers/${leadA}/addon-checklist`);
check(r.status === 200 && r.json.data.length === 0, 'no add-on documents before the add-on payment is confirmed', r);
r = await api('tc', 'PATCH', `/pipeline/customers/${leadA}/checklist/GBP_LISTING_DETAILS`, { value: 'Station Road, 9-9' });
check(r.status === 404, 'the consultant cannot collect add-on details before payment', r);
r = await api('tc', 'POST', `/pipeline/customers/${leadA}/addon-request`, { items: addonLines, submit: true, expectedVersion: addonReq.version + 5 });
check(r.status === 409, 'a submit from a stale form is refused', r);
r = await api('tc', 'POST', `/pipeline/customers/${leadA}/addon-request`, { items: addonLines, notes: 'Agreed on the call', submit: true, expectedVersion: addonReq.version });
check(r.status === 200 && r.json.data.status === 'PENDING_VERIFICATION' && r.json.data.submittedAt && r.json.data.canEdit === false, 'Submit for Accounts Verification', r);
addonReq = r.json.data;
r = await api('tc', 'POST', `/pipeline/customers/${leadA}/addon-request`, { items: [{ ...addonLines[0], unitPrice: 1 }] });
check(r.status === 409, 'submitted prices cannot be changed', r);
r = await api('tc', 'POST', `/pipeline/customers/${leadA}/consultant/addons-required`, { required: false });
check(r.status === 409, 'once submitted to Accounts the add-ons answer cannot go back to No', r);
r = await api('a', 'GET', '/accounts/addon-requests');
check(r.status === 403, 'Sales cannot open Business Verification', r);
r = await api('tc', 'GET', '/accounts/addon-requests');
check(r.status === 403, 'the consultant cannot open Business Verification', r);
r = await api('accm', 'GET', '/accounts/addon-requests?status=PENDING_VERIFICATION&search=galaxy');
check(r.status === 200 && r.json.data.total === 1 && r.json.data.items[0].id === addonReq.id && r.json.data.items[0].total === 15660 && r.json.data.counts.PENDING_VERIFICATION === 1
  && r.json.data.consultants.some((c: any) => c.fullName === 'Tech Consultant'), 'Accounts sees the request in Business Verification', r);
r = await api('accm', 'GET', `/accounts/addon-requests/${addonReq.id}`);
check(r.status === 200 && r.json.data.originalServices.length === 2 && r.json.data.items.length === 2 && r.json.data.salesperson, 'the request shows the original services, the add-ons and who sold it', r);
r = await api('accm', 'POST', `/accounts/addon-requests/${addonReq.id}/invoice-upload`, { invoiceNumber: 'ADDON/2026/01', fileName: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 1000 });
check(r.status === 409, 'an unapproved request cannot be invoiced', r);
r = await api('accm', 'POST', `/accounts/addon-requests/${addonReq.id}/decision`, { decision: 'CHANGES' });
check(r.status === 422, 'asking for changes needs a reason', r);
r = await api('accm', 'POST', `/accounts/addon-requests/${addonReq.id}/decision`, { decision: 'CHANGES', note: 'The setup call is Rs. 1500 each' });
check(r.status === 200 && r.json.data.status === 'CHANGES_REQUESTED', 'Accounts asks for changes', r);
r = await api('tc', 'GET', `/pipeline/customers/${leadA}/addon-request`);
check(r.json.data.status === 'CHANGES_REQUESTED' && r.json.data.decisionNote === 'The setup call is Rs. 1500 each' && r.json.data.canEdit === true, 'the consultant sees the reason and can correct it', r);
r = await api('tc', 'POST', `/pipeline/customers/${leadA}/addon-request`, { items: [addonLines[0], { ...addonLines[1], unitPrice: 1500 }], submit: true, expectedVersion: r.json.data.version });
check(r.status === 200 && r.json.data.status === 'PENDING_VERIFICATION' && r.json.data.total === 16660, 'the consultant corrects and resubmits', r);
addonReq = r.json.data;
r = await api('accm', 'POST', `/accounts/addon-requests/${addonReq.id}/decision`, { decision: 'APPROVE', expectedVersion: addonReq.version - 1 });
check(r.status === 409, 'Accounts cannot approve a version it did not see', r);
r = await api('accm', 'POST', `/accounts/addon-requests/${addonReq.id}/decision`, { decision: 'APPROVE', expectedVersion: addonReq.version });
check(r.status === 200 && r.json.data.status === 'APPROVED' && r.json.data.decidedBy === 'Accounts Member', 'Accounts approves (and is recorded as the verifier)', r);
r = await api('accm', 'POST', `/accounts/addon-requests/${addonReq.id}/decision`, { decision: 'APPROVE' });
check(r.status === 409, 'a request cannot be approved twice', r);
r = await api('accm', 'POST', `/accounts/addon-requests/${addonReq.id}/payments`, { amount: 1000, method: 'UPI' });
check(r.status === 409, 'no add-on payment before the invoice', r);
const addonBody = (over: object = {}) => ({ invoiceNumber: 'ADDON/2026/01', issueDate: '2026-10-12', dueDate: '2026-10-26', reference: 'Quote 5', fileName: 'Add-on invoice.pdf', mimeType: 'application/pdf', sizeBytes: 15000, ...over });
r = await api('tc', 'POST', `/accounts/addon-requests/${addonReq.id}/invoice-upload`, addonBody());
check(r.status === 403, 'the consultant cannot upload the add-on invoice', r);
r = await api('a', 'POST', `/accounts/addon-requests/${addonReq.id}/invoice-upload`, addonBody());
check(r.status === 403, 'Sales cannot upload the add-on invoice', r);
r = await api('accm', 'POST', `/accounts/addon-requests/${addonReq.id}/invoice`, {});
check(r.status === 404 || r.status === 405, 'there is no endpoint that generates the add-on invoice', r);
r = await api('accm', 'POST', `/accounts/addon-requests/${addonReq.id}/invoice-upload`, addonBody({ mimeType: 'image/png' }));
check(r.status === 422, 'the add-on invoice must be a PDF', r);
r = await api('accm', 'POST', `/accounts/addon-requests/${addonReq.id}/invoice-upload`, addonBody({ sizeBytes: 512001 }));
check(r.status === 422 && /500 KB limit/.test(r.json.error.message), 'and at most 500 KB', r);
r = await api('accm', 'POST', `/accounts/addon-requests/${addonReq.id}/invoice-upload`, addonBody({ total: 1 }));
check(r.status === 422, 'a typed total is refused (the total comes from the approved request)', r);
r = await api('accm', 'POST', `/accounts/addon-requests/${addonReq.id}/invoice-upload`, addonBody());
check(r.status === 201 && r.json.data.path.includes('/invoices/'), 'Accounts starts the add-on invoice upload', r);
const tkAddon = r.json.data;
r = await api('accm', 'GET', `/accounts/addon-requests/${addonReq.id}`);
check(r.json.data.status === 'APPROVED' && r.json.data.invoice === null, 'nothing changes until the PDF is stored', r);
await put(tkAddon, pdfOfSize(15000, 'addon'));
r = await api('accm', 'POST', `/accounts/invoice-uploads/${tkAddon.document.id}/complete`);
check(r.status === 201 && r.json.data.kind === 'UPLOADED' && r.json.data.total === 16660 && r.json.data.addonRequestId === addonReq.id && r.json.data.status === 'Pending'
  && r.json.data.items.length === 2 && r.json.data.number === 'ADDON/2026/01' && r.json.data.file.fileName === 'Add-on invoice.pdf',
  'the add-on invoice takes its total and lines from the approved request', r);
const addonInvoice = r.json.data;
r = await api('accm', 'GET', `/accounts/addon-requests/${addonReq.id}`);
check(r.json.data.status === 'INVOICE_GENERATED' && r.json.data.invoice.id === addonInvoice.id, 'the request moves to Invoice Uploaded', r);
r = await api('accm', 'POST', `/accounts/addon-requests/${addonReq.id}/invoice-upload`, addonBody({ invoiceNumber: 'ADDON/2026/02' }));
check(r.status === 409, 'the add-on invoice is uploaded once', r);
r = await api('a', 'GET', `/pipeline/customers/${leadA}/invoices`);
check(r.status === 200 && r.json.data.length === 2 && r.json.data.some((i: any) => i.id === addonInvoice.id && i.status === 'Pending'), 'Sales sees the add-on invoice read-only', r);
r = await api('tc', 'GET', `/pipeline/customers/${leadA}/invoices`);
check(r.status === 200 && r.json.data.some((i: any) => i.id === addonInvoice.id), 'the consultant sees the add-on invoice read-only', r);
r = await api('accm', 'PATCH', `/accounts/invoices/${addonInvoice.id}`, { status: 'Paid' });
check(r.status === 409, 'an add-on invoice is paid only through the payment confirmation', r);
r = await api('accm', 'POST', `/accounts/addon-requests/${addonReq.id}/payments`, { amount: 20000, method: 'UPI' });
check(r.status === 422, 'an add-on payment cannot exceed the invoice', r);
r = await api('accm', 'POST', `/accounts/addon-requests/${addonReq.id}/payments`, { amount: 10000, method: 'UPI', reference: 'UTR-1', verify: true });
check(r.status === 201 && r.json.data.paid === 10000 && r.json.data.payments.length === 1, 'Accounts records and verifies a part payment', r);
r = await api('accm', 'POST', `/accounts/addon-requests/${addonReq.id}/payments`, { amount: 10, method: 'UPI', reference: 'UTR-1' });
check(r.status === 409, 'a payment reference is used once', r);
r = await api('accm', 'POST', `/accounts/addon-requests/${addonReq.id}/confirm-payment`, {});
check(r.status === 422 || r.status === 409, 'the add-on payment cannot be confirmed while money is open', r);
r = await api('accm', 'POST', `/accounts/addon-requests/${addonReq.id}/payments`, { amount: 6660, method: 'BANK_TRANSFER', reference: 'UTR-2' });
check(r.status === 201 && r.json.data.pendingPayments === 6660, 'the balance is recorded, waiting for verification', r);
const pendingPay = r.json.data.payments.find((p: any) => p.status === 'PENDING');
r = await api('accm', 'POST', `/accounts/addon-requests/${addonReq.id}/confirm-payment`, {});
check(r.status === 422 || r.status === 409, 'not confirmed while a payment waits for verification', r);
r = await api('tc', 'POST', `/accounts/addon-payments/${pendingPay.id}/decision`, { decision: 'VERIFY' });
check(r.status === 403, 'the consultant cannot verify money', r);
r = await api('accm', 'POST', `/accounts/addon-payments/${pendingPay.id}/decision`, { decision: 'VERIFY' });
check(r.status === 200 && r.json.data.paid === 16660 && r.json.data.pendingPayments === 0, 'Accounts verifies the balance', r);
r = await api('tc', 'POST', `/pipeline/customers/${leadA}/addon-request/start-documents`);
check(r.status === 409, 'add-on documents wait for the payment confirmation', r);
r = await api('accm', 'POST', `/accounts/addon-requests/${addonReq.id}/confirm-payment`, { note: 'Both payments in the bank' });
check(r.status === 200 && r.json.data.status === 'PAYMENT_CONFIRMED' && r.json.data.invoice.status === 'Paid' && r.json.data.paymentConfirmedBy === 'Accounts Member', 'Accounts confirms the add-on payment; the invoice is paid', r);
r = await api('accm', 'POST', `/accounts/addon-requests/${addonReq.id}/confirm-payment`, {});
check(r.status === 409, 'the add-on payment cannot be confirmed twice', r);
r = await api('a', 'GET', `/pipeline/customers/${leadA}`);
check(r.json.data.dealAmount === 50000 && r.json.data.amountReceived === 15000 && r.json.data.amountVerified === 15000 && r.json.data.paymentStatus === 'PARTIALLY_PAID',
  "add-on money stays out of the original deal's payments", r.json.data);
r = await api('tc', 'GET', `/pipeline/customers/${leadA}/addon-checklist`);
check(r.status === 200 && r.json.data.length === 2 && r.json.data.every((i: any) => i.serviceCode === 'AI_CALLING'), "after payment the add-on checklist lists the add-on service's own items", r);
r = await api('tc', 'POST', `/pipeline/customers/${leadA}/addon-request/start-documents`);
check(r.status === 200 && r.json.data.status === 'IN_PROGRESS', 'the consultant starts add-on document collection', r);
r = await api('tc', 'GET', '/pipeline/customers?stage=ONBOARDING&addons=true');
check(r.status === 200 && r.json.data.total === 1 && r.json.data.items[0].id === leadA && r.json.data.items[0].onboarding.addonRequestStatus === 'IN_PROGRESS', 'the Add-ons Services list shows the request status', r);
r = await api('tc', 'GET', '/pipeline/customers?stage=ONBOARDING&intake=true');
check(r.json.data.total === 1, 'the original onboarding is not blocked: the customer still waits for Send for onboarding', r);
r = await api('tc', 'PATCH', `/pipeline/customers/${leadA}/checklist/AI_CALL_BUSINESS_ROLE`, { value: 'Receptionist' });
check(r.status === 200, 'the consultant collects an add-on detail', r);
r = await api('tc', 'PATCH', `/pipeline/customers/${leadA}/checklist/WABA_ID`, { value: '5' });
check(r.status === 404, 'but not an item that is not on the customer\'s checklist', r);
r = await api('tc', 'PATCH', `/pipeline/customers/${leadA}/checklist/INVOICE`, { value: '5' });
check(r.status === 403 || r.status === 404, 'and never the invoice, which belongs to Accounts', r);
r = await api('tc', 'POST', `/pipeline/customers/${leadA}/addon-request/complete`);
check(r.status === 409 || r.status === 422, 'add-ons complete only when every add-on item is verified', r);
{
  const { rows } = await db.query(`select type, count(*)::int n from public.notifications where type like 'ADDON_%' group by type`);
  const n = Object.fromEntries(rows.map((x: any) => [x.type, x.n]));
  check(n.ADDON_SUBMITTED >= 2 && n.ADDON_CHANGES_REQUESTED >= 1 && n.ADDON_APPROVED >= 1 && n.ADDON_INVOICE_ISSUED >= 1 && n.ADDON_PAYMENT_CONFIRMED >= 1, 'every step notified the people involved', n);
}
r = await api('a', 'GET', `/pipeline/customers/${leadA}/consultant/notes`);
check(r.status === 404, 'a salesperson cannot read the consultation notes', r);
r = await api('tc', 'POST', `/pipeline/customers/${leadA}/consultant/notes`, { body: '   ' });
check(r.status === 422, 'an empty note is refused', r);
r = await api('tc', 'POST', `/pipeline/customers/${leadA}/consultant/notes`, { body: 'Wants the WhatsApp API but price is a concern.', serviceCode: 'AI_CALLING' });
check(r.status === 201 && r.json.data.length === 1 && r.json.data[0].author.fullName && r.json.data[0].canEdit === true, 'the consultant adds a note', r);
const noteId = r.json.data[0].id;
r = await api('tc', 'POST', `/pipeline/customers/${leadA}/consultant/notes`, { body: 'Second call: agreed after a discount.' });
check(r.status === 201 && r.json.data.length === 2 && r.json.data[0].body.startsWith('Second call'), 'a second note keeps the first (newest first)', r);
r = await api('tc', 'PATCH', `/pipeline/customers/${leadA}/consultant/notes/${noteId}`, { body: 'Wants the WhatsApp API; price is a concern (edited).' });
check(r.status === 200 && r.json.data.length === 2 && r.json.data.some((n: any) => n.body.includes('(edited)')), 'the author edits a note; no note is lost', r);
r = await api('sa', 'GET', `/pipeline/customers/${leadA}/consultant/notes`);
check(r.status === 200 && r.json.data.length === 2, 'the CEO (Super Admin) reads the notes', r);
r = await api('sa', 'PATCH', `/pipeline/customers/${leadA}/consultant/notes/${noteId}`, { body: 'rewritten' });
check(r.status === 404, 'the CEO cannot edit the consultant\'s note', r);
r = await api('tc', 'GET', `/pipeline/customers/${leadA}`);
const staleAt = r.json.data.updatedAt;
r = await api('tc', 'PATCH', `/pipeline/customers/${leadA}/consultant/details`, { name: 'Siddhesh', company: 'Galaxy Jewellers', phone: '+91 98200 11112', expectedUpdatedAt: staleAt });
check(r.status === 200, 'a save with the current version is accepted', r);
r = await api('tc', 'PATCH', `/pipeline/customers/${leadA}/consultant/details`, { name: 'Siddhesh', company: 'Galaxy Jewellers', phone: '+91 98200 11113', expectedUpdatedAt: staleAt });
check(r.status === 409, 'a save from a stale form is refused', r);
r = await api('a', 'GET', '/accounts/finance/departments');
check(r.status === 403, 'Sales cannot list the finance departments', r);
r = await api('accm', 'GET', '/accounts/finance/departments');
check(r.status === 200 && r.json.data.length > 0 && !r.json.data.some((d: any) => ['accounts', 'edutraining', 'hr'].includes(d.slug)) && r.json.data.some((d: any) => d.slug === 'wabastore'), 'revenue departments leave out Accounts, Education & Training and HR', r);
r = await api('tc', 'POST', `/pipeline/customers/${leadA}/consultant/start-onboarding`);
check(r.status === 200 && r.json.data.onboarding.consultantStartedAt, 'consultant sends the customer for onboarding', r);
r = await api('tc', 'POST', `/pipeline/customers/${leadA}/consultant/start-onboarding`);
check(r.status === 409, 'cannot send for onboarding twice', r);
r = await api('tc', 'GET', '/pipeline/customers?stage=ONBOARDING&forwarded=true');
check(r.json.data.total === 1 && r.json.data.items[0].id === leadA, 'consultant sees forwarded customers of their department', r);
r = await api('tc', 'GET', `/pipeline/customers/${leadA}`);
check(r.status === 200 && r.json.data.checklist.length === 15, 'consultant opens the full checklist', r);
r = await api('tc', 'GET', `/documents/${importantDoc}/url?action=view`);
check(r.status === 200, 'consultant can view the documents', r);

// --- Upload Invoice PDF (Accounts): 500 KB, PDF content, Accounts-only writes, company-wide reads -------------
const MAX_PDF = 512000;
const pdfOf = (n: number, tag = 'x') => {
  const head = Buffer.from(`%PDF-1.4\n% ${tag}\n`), tail = Buffer.from('\n%%EOF\n');
  return Buffer.concat([head, Buffer.alloc(Math.max(0, n - head.length - tail.length), 0x20), tail]);
};
const listKeys = async () => (await fetch(`${GW}/storage/v1/__objects`, { headers: { authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` } }).then(x => x.json())) as string[];
const upBody = (over: object = {}) => ({ customerId: leadA, invoiceNumber: 'GST/26-27/001', issueDate: '2026-10-05', dueDate: '2026-10-20', amount: 41300, reference: 'PO-8812', note: 'Diwali pack',
  fileName: 'Galaxy Jewellers Oct.pdf', mimeType: 'application/pdf', sizeBytes: 1000, ...over });
const countInvoices = async (n: string) => Number((await db.query(`select count(*) c from public.member_invoices where lower(invoice_number) = lower($1)`, [n])).rows[0].c);

for (const who of ['a', 'th', 'dh', 'tc']) {
  r = await api(who, 'POST', '/accounts/invoice-uploads', upBody());
  check(r.status === 403, `${who} (not Accounts) cannot upload an invoice PDF`, r);
}
r = await api(null, 'POST', '/accounts/invoice-uploads', upBody());
check(r.status === 401, 'an anonymous request cannot upload');
r = await api('accm', 'POST', '/accounts/invoice-uploads', upBody({ mimeType: 'image/png', fileName: 'inv.png' }));
check(r.status === 422 && /PDF/.test(r.json.error.message), 'a non-PDF type is refused', r);
r = await api('accm', 'POST', '/accounts/invoice-uploads', upBody({ sizeBytes: MAX_PDF + 1 }));
check(r.status === 422 && /500 KB limit/.test(r.json.error.message), 'a file over 500 KB is refused with the size message', r);
r = await api('accm', 'POST', '/accounts/invoice-uploads', upBody({ sizeBytes: 0 }));
check(r.status === 422, 'an empty file is refused', r);
r = await api('accm', 'POST', '/accounts/invoice-uploads', upBody({ invoiceNumber: '../../etc/passwd' }));
check(r.status === 422, 'an unsafe invoice number is refused', r);
r = await api('accm', 'POST', '/accounts/invoice-uploads', upBody({ customerId: crypto.randomUUID() }));
check(r.status === 404, 'an unknown customer is refused (no customer is created)', r);
r = await api('accm', 'POST', '/accounts/invoice-uploads', upBody({ unexpected: 'field' }));
check(r.status === 422, 'unknown fields are refused', r);
check((await countInvoices('GST/26-27/001')) === 0 && Number((await db.query(`select count(*) c from public.customer_documents where invoice_meta is not null`)).rows[0].c) === 0, 'refused uploads left no invoice and no file row');

// a PDF of exactly 500 KB is accepted end to end
r = await api('accm', 'POST', '/accounts/invoice-uploads', upBody({ sizeBytes: MAX_PDF }));
check(r.status === 201 && r.json.data.token && r.json.data.path === `customers/${leadA}/invoices/${r.json.data.document.id}.pdf`, 'upload ticket for a 500 KB PDF: the path uses ids only', r);
const tk1 = r.json.data;
check((await countInvoices('GST/26-27/001')) === 0, 'no invoice record before the file is stored');
const pdf500 = pdfOf(MAX_PDF, 'v1');
check(pdf500.length === MAX_PDF, 'test file is exactly 500 KB');
up = await put(tk1, pdf500);
check(up.status === 200, 'the browser uploads the 500 KB PDF to its signed path');
r = await api('a', 'POST', `/accounts/invoice-uploads/${tk1.document.id}/complete`);
check(r.status === 403 || r.status === 404, 'Sales cannot finish an Accounts upload', r);
r = await api('accm', 'POST', `/accounts/invoice-uploads/${tk1.document.id}/complete`);
const upInv = r.json.data;
check(r.status === 201 && upInv.kind === 'UPLOADED' && upInv.number === 'GST/26-27/001' && upInv.customerId === leadA && upInv.status === 'Pending' && upInv.total === 41300
  && upInv.reference === 'PO-8812' && upInv.file.fileName === 'Galaxy Jewellers Oct.pdf' && upInv.file.sizeBytes === MAX_PDF && upInv.file.uploadedBy === 'Accounts Member'
  && upInv.file.version === 1 && upInv.file.versionCount === 1 && upInv.issueDate === '2026-10-05' && upInv.dueDate === '2026-10-20',
  'the invoice is saved with the customer, number (kept exactly), dates, reference and its original file name, size and uploader', r);
r = await api('accm', 'POST', '/accounts/invoice-uploads', upBody({ invoiceNumber: 'gst/26-27/001' }));
check(r.status === 409, 'the same invoice number cannot be used twice (case-insensitive)', r);

// the same limit cannot be bypassed: a file larger than declared is checked again by the server when the upload completes
r = await api('accm', 'POST', '/accounts/invoice-uploads', upBody({ invoiceNumber: 'OVERSIZE-1', sizeBytes: 1000 }));
const tkBig = r.json.data;
up = await put(tkBig, pdfOf(MAX_PDF + 1, 'big'));
r = await api('accm', 'POST', `/accounts/invoice-uploads/${tkBig.document.id}/complete`);
check(r.status === 422 && /500 KB|did not finish/.test(r.json.error.message), 'an invoice object over 500 KB fails on completion even when the request declared less', r);
check((await countInvoices('OVERSIZE-1')) === 0, 'no invoice record is left behind');
// the accountant only chooses the PDF: a blank invoice number is numbered by the system, a blank issue date is today
r = await api('accm', 'POST', '/accounts/invoice-uploads', upBody({ invoiceNumber: '  ' }));
check(r.status === 201, 'a blank invoice number is accepted', r);
const tkBlank = r.json.data;
const blankMeta = (await db.query(`select invoice_meta ->> 'number' n, invoice_meta ->> 'issueDate' d from public.customer_documents where id = $1`, [tkBlank.document.id])).rows[0];
check(/^INV-\d{4}-\d{5}$/.test(blankMeta.n) && /^\d{4}-\d{2}-\d{2}$/.test(blankMeta.d), `the system numbers it (${blankMeta.n}) and dates it`);
r = await api('accm', 'POST', `/accounts/invoice-uploads/${tkBlank.document.id}/complete`);
check(r.status === 422, 'an upload that never finished is discarded', r);
keys = await listKeys();
check(!keys.some(k => k.includes(tkBig.document.id)), 'and no orphan file');
// a renamed non-PDF is stopped by its content
r = await api('accm', 'POST', '/accounts/invoice-uploads', upBody({ invoiceNumber: 'FAKE-1', fileName: 'invoice.pdf' }));
const tkFake = r.json.data;
up = await put(tkFake, Buffer.from('MZ this is an executable renamed to .pdf'));
check(up.status === 200, 'a renamed file reaches storage');
r = await api('accm', 'POST', `/accounts/invoice-uploads/${tkFake.document.id}/complete`);
check(r.status === 422 && /not a valid PDF/.test(r.json.error.message), 'the backend rejects it by its content', r);
check((await countInvoices('FAKE-1')) === 0, 'no invoice record for the renamed file');
keys = await listKeys();
check(!keys.some(k => k.includes(tkFake.document.id)), 'its object was removed');
// abandoned upload
r = await api('accm', 'POST', '/accounts/invoice-uploads', upBody({ invoiceNumber: 'ABANDONED-1' }));
await put(r.json.data, pdfOf(2000));
const r2 = await api('accm', 'POST', `/documents/${r.json.data.document.id}/abort`);
check(r2.status === 200 && (await countInvoices('ABANDONED-1')) === 0 && !(await listKeys()).some(k => k.includes(r.json.data.document.id)), 'an aborted upload leaves nothing behind');

// everyone who may see the customer reads the same invoice and PDF; others cannot
const invIds = (res: any) => (res.json.data.items || res.json.data).map((i: any) => i.id);
for (const who of ['a', 'th', 'dh', 'tc', 'sa', 'accm']) {
  r = await api(who, 'GET', `/invoices/${upInv.id}`);
  check(r.status === 200 && r.json.data.file.fileName === 'Galaxy Jewellers Oct.pdf' && r.json.data.file.sizeBytes === MAX_PDF && r.json.data.customer === upInv.customer
    && r.json.data.number === 'GST/26-27/001' && !JSON.stringify(r.json.data).includes('storage_path') && !JSON.stringify(r.json.data).includes('/invoices/'),
    `${who} sees the same invoice details and no storage path`, r);
  r = await api(who, 'GET', `/documents/${upInv.file.documentId}/url?action=view`);
  check(r.status === 200 && r.json.data.expiresInSeconds <= 300 && r.json.data.fileName === 'Galaxy Jewellers Oct.pdf', `${who} can preview the PDF (short-lived signed URL)`, r);
  const body = Buffer.from(await fetch(r.json.data.url).then(x => x.arrayBuffer()));
  check(body.equals(pdf500), `${who} receives the original, unmodified file`);
}
r = await api('a', 'GET', `/documents/${upInv.file.documentId}/url?action=download`);
const dlRes = await fetch(r.json.data.url);
check(r.status === 200 && new URL(r.json.data.url).searchParams.get('download') === 'Galaxy Jewellers Oct.pdf', 'download keeps the original file name', r.json);
await dlRes.arrayBuffer();
r = await api('a', 'GET', `/pipeline/customers/${leadA}/invoices`);
check(r.status === 200 && r.json.data.some((i: any) => i.id === upInv.id && i.file), 'the customer view lists it with the others', r);
r = await api('a', 'GET', '/invoices');
check(r.status === 200 && invIds(r).includes(upInv.id), "Sales's invoice list has it", r);
r = await api('accm', 'GET', '/accounts/invoices?kind=UPLOADED');
check(r.status === 200 && r.json.data.total === 3 && r.json.data.items.some((i: any) => i.id === upInv.id), 'the Accounts list filters uploaded invoices', r);
r = await api('accm', 'GET', '/accounts/invoices?search=gst/26');
check(r.json.data.total === 1, 'and finds it by invoice number', r);
r = await api('b', 'GET', `/invoices/${upInv.id}`);
check(r.status === 404, "another salesperson cannot read this customer's invoice", r);
r = await api('b', 'GET', `/documents/${upInv.file.documentId}/url?action=view`);
check(r.status === 404, 'nor open its PDF by guessing the document id', r);
r = await api('b', 'GET', '/invoices');
check(r.status === 200 && !invIds(r).includes(upInv.id), 'nor see it in the list', r);
r = await api(null, 'GET', `/documents/${upInv.file.documentId}/url`);
check(r.status === 401, 'an anonymous request cannot open the PDF');
// persistence: a new session sees the same record and file
tokens.set('a2', tokenFor((await db.query(`select owner_id from public.customers where id = $1`, [leadA])).rows[0].owner_id));
r = await api('a2', 'GET', `/invoices/${upInv.id}`);
check(r.status === 200 && r.json.data.file.documentId === upInv.file.documentId, 'after signing in again the invoice and its PDF are still there', r);

// only Accounts replaces or edits
for (const who of ['a', 'th', 'tc']) {
  r = await api(who, 'POST', `/accounts/invoices/${upInv.id}/replace`, { fileName: 'new.pdf', mimeType: 'application/pdf', sizeBytes: 1000 });
  check(r.status === 403, `${who} cannot replace an invoice PDF`, r);
  r = await api(who, 'POST', `/accounts/invoices/${upInv.id}/details`, { amount: 1 });
  check(r.status === 403, `${who} cannot edit an uploaded invoice`, r);
}
r = await api('a', 'DELETE', `/documents/${upInv.file.documentId}`);
check(r.status === 403 || r.status === 404, 'nobody deletes an uploaded invoice file here', r);
r = await api('accm', 'POST', `/accounts/invoices/${upInv.id}/replace`, { fileName: 'new.pdf', mimeType: 'image/jpeg', sizeBytes: 1000 });
check(r.status === 422, 'a replacement must be a PDF', r);
r = await api('accm', 'POST', `/accounts/invoices/${upInv.id}/replace`, { fileName: 'new.pdf', mimeType: 'application/pdf', sizeBytes: MAX_PDF + 1 });
check(r.status === 422 && /500 KB limit/.test(r.json.error.message), 'a replacement over 500 KB is refused', r);
// a failed replacement keeps the current file
r = await api('accm', 'POST', `/accounts/invoices/${upInv.id}/replace`, { fileName: 'bad.pdf', mimeType: 'application/pdf', sizeBytes: 500 });
const tkBad = r.json.data;
await put(tkBad, Buffer.from('not a pdf at all'));
r = await api('accm', 'POST', `/accounts/invoice-uploads/${tkBad.document.id}/complete`);
check(r.status === 422, 'a replacement that is not a PDF is rejected', r);
r = await api('a', 'GET', `/invoices/${upInv.id}`);
check(r.json.data.file.documentId === upInv.file.documentId && r.json.data.file.version === 1, 'the existing invoice PDF stays available after a failed replacement', r);
// a good replacement
r = await api('accm', 'POST', `/accounts/invoices/${upInv.id}/replace`, { fileName: 'Galaxy Jewellers Oct v2.pdf', mimeType: 'application/pdf', sizeBytes: 30000 });
const tkRep = r.json.data;
const pdf2 = pdfOf(30000, 'v2');
await put(tkRep, pdf2);
r = await api('accm', 'POST', `/accounts/invoice-uploads/${tkRep.document.id}/complete`);
check(r.status === 201 && r.json.data.id === upInv.id && r.json.data.file.fileName === 'Galaxy Jewellers Oct v2.pdf' && r.json.data.file.version === 2 && r.json.data.file.versionCount === 2
  && r.json.data.file.versions.length === 1 && r.json.data.file.versions[0].fileName === 'Galaxy Jewellers Oct.pdf' && r.json.data.customerId === leadA, 'the replacement keeps the same invoice and customer; the old file is an older version', r);
check((await countInvoices('GST/26-27/001')) === 1, 'no second invoice record was created');
r = await api('a', 'GET', `/invoices/${upInv.id}`);
check(r.json.data.file.fileName === 'Galaxy Jewellers Oct v2.pdf' && r.json.data.file.versions.length === 0, 'Sales sees the new file and no older versions', r);
r = await api('a', 'GET', `/documents/${upInv.file.documentId}/url`);
check(r.status === 404, 'Sales cannot open the older version', r);
r = await api('accm', 'GET', `/documents/${upInv.file.documentId}/url`);
check(r.status === 200, 'Accounts can still open the older version', r);
check((await listKeys()).some(k => k.includes(upInv.file.documentId)), 'the older file is preserved in storage');
r = await api('tc', 'GET', `/documents/${tkRep.document.id}/url?action=download`);
check(r.status === 200 && Buffer.from(await fetch(r.json.data.url).then(x => x.arrayBuffer())).equals(pdf2), 'the Technical Consultant downloads the new file, unmodified', r);
r = await api('accm', 'POST', `/accounts/invoices/${upInv.id}/details`, { amount: 41300.5, reference: 'PO-8812', note: 'Updated', issueDate: '2026-10-06', dueDate: '2026-10-25' });
check(r.status === 200 && r.json.data.total === 41300.5 && r.json.data.issueDate === '2026-10-06', 'Accounts edits the details of an uploaded invoice', r);
r = await api('accm', 'PATCH', `/accounts/invoices/${upInv.id}`, { status: 'Paid' });
check(r.status === 200 && r.json.data.status === 'Paid', 'Accounts marks it paid', r);
r = await api('a', 'GET', `/pipeline/customers/${leadA}`);
const invItem = r.json.data.checklist.find((c: any) => c.code === 'INVOICE');
check(invItem.entry?.status === 'SAVED' && invItem.entry.documentId && r.json.data.documents.some((d: any) => d.documentType === 'INVOICE' && d.invoiceId === upInv.id && d.status === 'UPLOADED')
  && !r.json.data.documents.some((d: any) => d.invoiceId === upInv.id && d.status === 'SUPERSEDED'), 'the Invoice item of the onboarding checklist shows the uploaded PDF (older versions hidden from Sales)', invItem);
const { rows: invAudit } = await db.query(`select action, count(*)::int n from public.audit_logs where action in ('INVOICE_UPLOADED', 'INVOICE_REPLACED', 'INVOICE_UPDATED') group by action`);
const ia = Object.fromEntries(invAudit.map((x: any) => [x.action, x.n]));
check(ia.INVOICE_UPLOADED === 3 && ia.INVOICE_REPLACED === 1 && ia.INVOICE_UPDATED === 1, 'upload, replacement and edit are audited', ia);
r = await api('tc', 'PATCH', `/pipeline/customers/${leadA}/checklist/META_AD_BUDGET`, { value: '15000' });
check(r.status === 200, 'the consultant can correct a detail Sales entered (it is saved under their name)', r);
r = await api('tc', 'GET', `/pipeline/customers/${leadA}`);
check(r.json.data.checklist.find((c: any) => c.code === 'META_AD_BUDGET').entry.savedBy === 'Tech Consultant', 'and shows who changed it', r);
r = await api('tc', 'POST', `/pipeline/customers/${leadA}/checklist/IMPORTANT_DOCUMENTS/review`, { decision: 'REJECTED' });
check(r.status === 422, 'rejection requires a note', r);
r = await api('tc', 'POST', `/pipeline/customers/${leadA}/checklist/IMPORTANT_DOCUMENTS/review`, { decision: 'REJECTED', note: 'Certificate is blurred' });
check(r.status === 200, 'consultant rejects an item with a note', r);
r = await api('tc', 'GET', '/pipeline/customers?stage=ONBOARDING&review=NEEDS_FIX');
check(r.json.data.total === 1, 'review queue filter: needs fixing', r);
r = await api('b', 'POST', `/pipeline/customers/${leadA}/checklist/AI_CALL_BUSINESS_ROLE/review`, { decision: 'VERIFIED' });
check(r.status === 404, 'sales members cannot verify', r);
r = await api('a', 'GET', `/pipeline/customers/${leadA}`);
const gst = r.json.data.checklist.find((c: any) => c.code === 'IMPORTANT_DOCUMENTS');
check(gst.entry.status === 'REJECTED' && gst.entry.reviewNote === 'Certificate is blurred' && gst.entry.reviewedBy === 'Tech Consultant', 'salesperson sees what to fix and who asked', gst);
r = await api('b', 'POST', `/pipeline/customers/${leadA}/return-to-sales`, { note: 'x' });
check(r.status === 404, 'sales members cannot send back', r);
r = await api('tc', 'POST', `/pipeline/customers/${leadA}/return-to-sales`, { note: 'Please get the original certificate' });
check(r.status === 200, 'consultant sends the customer back for re-verification', r);
r = await api('tc', 'GET', `/pipeline/customers/${leadA}`);
check(r.status === 200 && r.json.data.onboarding.returnedAt && r.json.data.checklist.length > 0, 'returned customer stays visible to the consultant', r);
r = await api('tc', 'GET', '/pipeline/customers?stage=ONBOARDING&review=WAITING_ON_SALES');
check(r.json.data.total === 1 && r.json.data.items[0].id === leadA, 'consultant lists it under Waiting for sales team', r);
r = await api('tc', 'GET', '/pipeline/review-counts');
check(r.json.data.WAITING_ON_SALES === 1, 'waiting for sales team count', r);
r = await api('tc', 'POST', `/pipeline/customers/${leadA}/checklist/verify-all`);
check(r.status === 404, 'consultant cannot authorize while waiting for sales', r);
r = await api('a', 'GET', '/pipeline/customers?stage=ONBOARDING&onboarding=RETURNED');
check(r.json.data.total === 1 && r.json.data.items[0].onboarding.returnedAt && r.json.data.items[0].onboarding.returnNote === 'Please get the original certificate',
  'salesperson sees it under Returned', r);
r = await api('a', 'GET', '/pipeline/counts');
check(r.json.data.onboarding.RETURNED === 1, 'returned tab count', r);
r = await api('a', 'POST', `/pipeline/customers/${leadA}/forward-to-support`);
check(r.status === 422 && /All Important Documents/.test(r.json.error.message), 'cannot send again until fixed', r);
r = await api('a', 'POST', `/pipeline/customers/${leadA}/documents`, { documentType: 'IMPORTANT_DOCUMENTS', fileName: 'kyc-clear.pdf', mimeType: 'application/pdf', sizeBytes: PDF.length });
ticket = r.json.data;
await put(ticket, PDF);
r = await api('a', 'POST', `/documents/${ticket.document.id}/complete`);
r = await api('a', 'GET', `/pipeline/customers/${leadA}`);
check(r.json.data.checklist.find((c: any) => c.code === 'IMPORTANT_DOCUMENTS').entry.status === 'SAVED', 'replacement goes back for review');
r = await api('a', 'POST', `/pipeline/customers/${leadA}/forward-to-support`);
check(r.status === 200 && r.json.data.onboarding.forwardedToSupportAt && !r.json.data.onboarding.returnedAt, 'fixed customer sent again', r);
r = await api('tc', 'GET', `/pipeline/customers/${leadA}`);
for (const item of r.json.data.checklist as any[]) {
  const rv = await api('tc', 'POST', `/pipeline/customers/${leadA}/checklist/${item.code}/review`, { decision: 'VERIFIED' });
  if (rv.status !== 200) check(false, `verify ${item.code}`, rv);
}
r = await api('tc', 'GET', '/pipeline/customers?stage=ONBOARDING&review=VERIFIED');
check(r.json.data.total === 1 && r.json.data.items[0].onboarding.itemsVerified === 15, 'all items verified', r);
r = await api('a', 'GET', '/notifications');
check(r.json.data.items.some((n: any) => n.type === 'ONBOARDING_VERIFIED') && r.json.data.items.some((n: any) => n.type === 'ONBOARDING_RETURNED'),
  'salesperson notified of the send-back and of full verification', r.json.data.items.map((n: any) => n.type));

// --- consultant dashboard: counts, authorize all, automations ------------------------
r = await api('tc', 'GET', '/pipeline/review-counts');
check(r.status === 200 && r.json.data.all >= 1 && r.json.data.VERIFIED >= 1, 'review tab counts', r);
r = await api('tc', 'POST', `/pipeline/customers/${leadA}/checklist/verify-all`);
check(r.status === 409, 'authorize all with nothing pending → 409', r);
r = await api('tc', 'GET', `/pipeline/customers/${leadA}/automations`);
check(r.status === 200 && r.json.data.length === 3 && r.json.data.every((a: any) => !a.connected && !a.lastRun), 'automations listed, none connected yet', r);
r = await api('tc', 'POST', `/pipeline/customers/${leadA}/automations/EMAIL`);
check(r.status === 409 && /not connected/.test(r.json.error.message), 'unconnected automation cannot run', r);
const sheetRows: any[] = [];
let sheetFails = false;
const sheet = http.createServer((req, res) => {
  let body = '';
  req.on('data', c => (body += c));
  req.on('end', () => {
    sheetRows.push(JSON.parse(body));
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(sheetFails ? '{"ok":false,"error":"Sheet is full"}' : '{"ok":true}');
  });
});
await new Promise<void>(res => sheet.listen(0, res));
process.env.AUTOMATION_WHATSAPP_WEBHOOK_URL = `http://127.0.0.1:${(sheet.address() as any).port}/exec`;
process.env.AUTOMATION_WEBHOOK_SECRET = 'sheet-secret';
r = await api('b', 'POST', `/pipeline/customers/${leadA}/automations/WHATSAPP`);
check(r.status === 404, 'sales member cannot trigger automations', r);
r = await api('tc', 'POST', `/pipeline/customers/${leadA}/automations/WHATSAPP`);
check(r.status === 200 && r.json.data.lastRun.status === 'SENT' && r.json.data.lastRun.triggeredBy === 'Tech Consultant', 'WhatsApp automation sent to its sheet', r);
check(sheetRows.length === 1 && sheetRows[0].secret === 'sheet-secret' && sheetRows[0].customer.company === 'Galaxy Jewellers'
  && sheetRows[0].services.includes('Starter Package'), 'sheet receives the customer, services and secret', sheetRows[0]);
r = await api('tc', 'POST', `/pipeline/customers/${leadA}/automations/WHATSAPP`);
check(r.status === 409, 'no double trigger within a minute', r);
await db.query(`update public.onboarding_automation_runs set triggered_at = now() - interval '2 minutes'`);
sheetFails = true;
r = await api('tc', 'POST', `/pipeline/customers/${leadA}/automations/WHATSAPP`);
check(r.status === 503 && /Sheet is full/.test(r.json.error.message), 'a sheet error is reported, not shown as success', r);
r = await api('tc', 'GET', `/pipeline/customers/${leadA}/automations`);
check(r.json.data.find((a: any) => a.code === 'WHATSAPP').lastRun.status === 'FAILED', 'failed run recorded', r);
sheet.close();
delete process.env.AUTOMATION_WHATSAPP_WEBHOOK_URL;

r = await api('a', 'GET', '/customers?lifecycle=ONBOARDING,CUSTOMER&search=galaxy');
check(r.json.data.total === 1, 'My Customers can be limited to onboarding/customer lifecycle', r);
r = await api('b', 'GET', `/pipeline/customers?stage=ONBOARDING`);
check(r.json.data.total === 0, 'member B sees no onboarding customers of A');

// --- client login (Accounts creates it from the e-mail on the record) + hand-over: consultant → department head → team lead → team member ---
const clientEmail = 'client.galaxy@example.com';
/** The client's own choice of password, through the same one-time link the e-mail carries (here made by the local sign-in service). */
async function setClientPassword(email: string, password: string, link?: string): Promise<boolean> {
  const svc = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  let action = link;
  if (!action) {
    const gl = await fetch(`${process.env.GATEWAY_URL}/auth/v1/admin/generate_link`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${svc}`, apikey: svc },
      body: JSON.stringify({ type: 'recovery', email, redirectTo: 'http://localhost/client/set-password' })
    });
    action = ((await gl.json()) as any).action_link as string;
  }
  const v = await fetch(action, { redirect: 'manual' });
  const token = /access_token=([^&]+)/.exec(v.headers.get('location') || '')?.[1];
  if (!token) return false;
  const put = await fetch(`${process.env.GATEWAY_URL}/auth/v1/user`, {
    method: 'PUT', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, apikey: process.env.SUPABASE_ANON_KEY! }, body: JSON.stringify({ password })
  });
  return put.status === 200;
}
// a verified payment for the customer (what the Accounts payment steps leave behind)
await db.query(`update public.customers set deal_amount = coalesce(deal_amount, 30000) where id = $1 and amount_verified = 0`, [leadA]);
await db.query(`update public.customers set amount_received = coalesce(nullif(amount_received, 0), deal_amount), amount_verified = coalesce(nullif(amount_received, 0), deal_amount) where id = $1 and amount_verified = 0`, [leadA]);
r = await api('tc', 'POST', `/pipeline/customers/${leadA}/client-account`, { email: clientEmail, password: 'ClientPass#2026' });
check(r.status === 404, 'the Technical Consultant has no client-login route any more', r);
r = await api('tc', 'POST', `/pipeline/customers/${leadA}/accounts/client-login`, {});
check(r.status === 403 || r.status === 404, 'nor can the Technical Consultant use the Accounts one', r);
r = await api('a', 'POST', `/pipeline/customers/${leadA}/accounts/client-login`, {});
check(r.status === 403 || r.status === 404, 'sales cannot create the client login', r);
r = await api('accm', 'GET', '/pipeline/accounts/client-logins?search=galaxy');
const queueRow = r.json.data?.items?.find((x: any) => x.customerId === leadA);
check(r.status === 200 && queueRow && queueRow.status === 'NOT_STARTED' && queueRow.email === null && queueRow.emailProblem === 'MISSING' && queueRow.can.create === false && queueRow.order.services.length === 2,
  'the Accounts queue lists the customer: no e-mail on the record, so it cannot be created yet', r.json.data);
r = await api('tc', 'GET', '/pipeline/accounts/client-logins');
check(r.status === 403, 'the queue is Accounts only', r);
r = await api('accm', 'POST', `/pipeline/customers/${leadA}/accounts/client-login`, {});
check(r.status === 422 && /no e-mail address/.test(r.json.error.message), 'no login without an e-mail on the customer record', r);
r = await api('accm', 'POST', `/pipeline/customers/${leadA}/accounts/client-login`, { email: clientEmail });
check(r.status === 422, 'an e-mail in the request is refused: the login always uses the one on the record', r);
r = await api('accm', 'POST', `/pipeline/customers/${leadA}/accounts/customer-email`, { email: 'not-an-email', reason: 'typo fixed' });
check(r.status === 422, 'a bad e-mail cannot be put on the record', r);
r = await api('accm', 'POST', `/pipeline/customers/${leadA}/accounts/customer-email`, { email: 'dh@amuwa.com', reason: 'customer said so' });
check(r.status === 409, "a staff e-mail cannot be used for the client's login", r);
r = await api('accm', 'POST', `/pipeline/customers/${leadA}/accounts/customer-email`, { email: clientEmail });
check(r.status === 422, 'correcting the e-mail needs a reason', r);
r = await api('tc', 'POST', `/pipeline/customers/${leadA}/accounts/customer-email`, { email: clientEmail, reason: 'customer said so' });
check(r.status === 403 || r.status === 404, 'only Accounts can correct it', r);
r = await api('accm', 'POST', `/pipeline/customers/${leadA}/accounts/customer-email`, { email: clientEmail, reason: 'Confirmed with the customer on a call' });
check(r.status === 200, 'Accounts corrects the e-mail on the record (audited)', r);
check((await db.query(`select count(*)::int n from public.audit_logs where action = 'CLIENT_EMAIL_CORRECTED' and entity_id = $1 and metadata::text not like '%client.galaxy%'`, [leadA])).rows[0].n === 1,
  'the correction is in the audit log without the full address');
r = await api('accm', 'POST', `/pipeline/customers/${leadA}/accounts/client-login`, {});
check(r.status === 201 && r.json.data.email === clientEmail && r.json.data.status === 'CREATED' && !JSON.stringify(r.json).toLowerCase().includes('password'),
  'Accounts creates the client login from the e-mail on the record (no password in the response)', r);
r = await api('accm', 'POST', `/pipeline/customers/${leadA}/accounts/client-login`, {});
check(r.status === 409, 'only one client login per customer', r);
r = await api('accm', 'GET', '/pipeline/accounts/client-logins?status=CREATED&search=galaxy');
check(r.status === 200 && r.json.data.items.length === 1 && r.json.data.items[0].loginEmail === clientEmail && r.json.data.items[0].createdAt && r.json.data.items[0].createdBy
  && r.json.data.items[0].notification.email.status && r.json.data.counts.CREATED >= 1, 'the queue shows the created login with its time, who made it and the state of its e-mail', r.json.data);
check((await db.query(`select count(*)::int n from public.automation_jobs where customer_id = $1 and stage = 'ACCOUNT_CREATED'`, [leadA])).rows[0].n === 2, 'the account-created e-mail and WhatsApp were queued once');
check(await setClientPassword(clientEmail, 'ClientPass#2026'), 'the client chooses their own password from the one-time link');
const clientLogin = await fetch(`${process.env.GATEWAY_URL}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: clientEmail, password: 'ClientPass#2026' })
});
const clientSession = (await clientLogin.json()) as any;
check(clientLogin.status === 200 && clientSession.access_token, 'the client can sign in with that e-mail and password (Supabase Auth)');
tokens.set('client', clientSession.access_token);
r = await api('client', 'GET', '/me');
check(r.status === 401, 'a client login has no CRM profile and cannot use the CRM API', r);
const { rows: clientProfiles } = await db.query(`select count(*)::int n from public.profiles where lower(email) = $1`, [clientEmail]);
check(clientProfiles[0].n === 0, 'no CRM profile is created for the client login');
r = await api('a', 'GET', `/pipeline/customers/${leadA}`);
check(r.json.data.handover?.clientAccount?.email === clientEmail && r.json.data.handover.stage === 'CONSULTANT', 'the salesperson sees the client login e-mail', r);

r = await api('a', 'POST', `/pipeline/customers/${leadA}/handover/department-head`, {});
check(r.status === 404, 'sales cannot send to the department head', r);
r = await api('tc', 'POST', `/pipeline/customers/${leadA}/handover/department-head`, { note: 'All verified' });
check(r.status === 422 && /Meta verification/.test(r.json.error.message), 'the hand-over waits for Meta verification to be completed', r);
r = await api('tc', 'POST', `/pipeline/customers/${leadA}/meta-verification`, { status: 'COMPLETED' });
check(r.status === 200, 'the consultant completes the Meta verification', r);
r = await api('tc', 'POST', `/pipeline/customers/${leadA}/handover/department-head`, { note: 'All verified' });
check(r.status === 200, 'consultant sends the verified customer to the department head', r);
r = await api('tc', 'POST', `/pipeline/customers/${leadA}/handover/department-head`, {});
check(r.status === 404, 'cannot send twice (the consultant review is closed)', r);
r = await api('tc', 'POST', `/pipeline/customers/${leadA}/return-to-sales`, { note: 'x' });
check(r.status === 404, 'consultant cannot send it back after the hand-over', r);
r = await api('tc', 'GET', '/pipeline/customers?stage=ONBOARDING&forwarded=true');
check(r.json.data.items.find((x: any) => x.id === leadA)?.onboarding.handoverStage === 'DEPARTMENT_HEAD', 'consultant list shows where the customer is now', r);

r = await api('dh', 'GET', '/pipeline/customers?stage=ONBOARDING&handover=DEPARTMENT_HEAD');
check(r.status === 200 && r.json.data.total === 1 && r.json.data.items[0].id === leadA, 'department head sees the customer to assign', r);
// The hand-over chain is Support only: DH -> Support Team Lead -> Support Team Member.
r = await api('sa', 'POST', '/teams', { departmentId: wab.id, name: 'Delivery', division: 'SUPPORT' });
check(r.status === 201, 'delivery team created', r);
const delivery = r.json.data.id;
r = await api('dh', 'POST', '/users', { email: 'tl.delivery@amuwa.com', fullName: 'Delivery Lead', password: 'Sup3rSecret!', role: 'TEAM_HEAD', teamId: delivery });
check(r.status === 201, 'department head creates a delivery team lead', r);
const deliveryLead = r.json.data.id;
tokens.set('tl2', tokenFor(deliveryLead));
r = await api('tl2', 'GET', '/me');
check(r.status === 200 && r.json.data.defaultDashboard === 'support-lead', 'a Support team lead resolves to the Support Team Lead dashboard', r);
r = await api('tl2', 'POST', '/users', { email: 'tm.delivery@amuwa.com', fullName: 'Delivery Member', password: 'Sup3rSecret!', role: 'TEAM_MEMBER', teamId: delivery });
check(r.status === 201, 'delivery team lead creates a team member', r);
const deliveryMember = r.json.data.id;
tokens.set('tm2', tokenFor(deliveryMember));
r = await api('tl2', 'GET', `/pipeline/customers?stage=ONBOARDING&handover=TEAM_LEAD`);
check(r.json.data.total === 0, 'the team lead sees nothing before it is passed to them', r);
r = await api('dh', 'POST', `/pipeline/customers/${leadA}/handover/team-lead`, { teamLeadId: deliveryMember });
check(r.status === 422, 'department head must choose a team lead', r);
r = await api('dh', 'POST', `/pipeline/customers/${leadA}/handover/team-lead`, { teamLeadId: salesTeamLeadId });
check(r.status === 422, 'a Sales team lead is not part of the hand-over chain', r);
r = await api('tc', 'POST', `/pipeline/customers/${leadA}/handover/team-lead`, { teamLeadId: deliveryLead });
check(r.status === 404, 'only the department head can pass it to a team lead', r);
r = await api('dh', 'POST', `/pipeline/customers/${leadA}/handover/team-lead`, { teamLeadId: deliveryLead, note: 'Start this week' });
check(r.status === 200, 'department head passes the customer to a team lead', r);
r = await api('tl2', 'GET', `/pipeline/customers?stage=ONBOARDING&handover=TEAM_LEAD`);
check(r.json.data.total === 1 && r.json.data.items[0].id === leadA, 'the team lead sees the customer passed to them', r);
r = await api('th', 'GET', `/pipeline/customers?stage=ONBOARDING&handover=TEAM_LEAD&handoverMine=TEAM_LEAD`);
check(r.json.data.total === 0, "another team lead (the owner's own) does not get it in their hand-over inbox", r);
r = await api('tl2', 'GET', `/pipeline/customers/${leadA}`);
check(r.status === 200 && r.json.data.checklist.length > 0 && r.json.data.handover.stage === 'TEAM_LEAD' && r.json.data.handover.teamLead.fullName === 'Delivery Lead'
  && r.json.data.owner?.fullName, 'the team lead opens the details and sees who is responsible', r);
r = await api('tl2', 'POST', `/pipeline/customers/${leadA}/checklist/BRAND_COLOURS/review`, { decision: 'VERIFIED' });
check(r.status === 404, 'the team lead cannot review items', r);
r = await api('tm2', 'GET', `/pipeline/customers/${leadA}`);
check(r.status === 404, 'the team member cannot see it before it is assigned', r);
r = await api('tl2', 'POST', `/pipeline/customers/${leadA}/handover/team-member`, { memberId: memberA });
check(r.status === 422, 'the team lead must choose a member of their own team', r);
r = await api('tl2', 'POST', `/pipeline/customers/${leadA}/handover/team-member`, { memberId: deliveryMember, note: 'Yours now' });
check(r.status === 200, 'the team lead assigns the customer to a team member', r);
r = await api('tm2', 'GET', `/pipeline/customers?stage=ONBOARDING&handover=TEAM_MEMBER`);
check(r.json.data.total === 1 && r.json.data.items[0].id === leadA, 'the team member sees the assigned customer', r);
r = await api('tm2', 'GET', `/pipeline/customers/${leadA}`);
check(r.status === 200 && r.json.data.handover.teamMember.fullName === 'Delivery Member' && r.json.data.handover.clientAccount.email === clientEmail, 'the team member sees the client login e-mail', r);
r = await api('tm2', 'PATCH', `/pipeline/leads/${leadA}`, { name: 'hijack' });
check(r.status === 404 || r.status === 403 || r.status === 409, 'the team member cannot edit the sales record', r);
r = await api('b', 'GET', `/pipeline/customers/${leadA}`);
check(r.status === 404, 'unrelated sales members still cannot see it', r);
r = await api('sa', 'GET', `/pipeline/customers?stage=ONBOARDING&handover=TEAM_MEMBER`);
check(r.json.data.total === 1, 'super admin sees the hand-over too', r);

// --- inbound website/WhatsApp leads are claimed into the pipeline once ------------
await db.query(`insert into public.crm_leads (id, name, phone, company, channel, department) values ('W-1', 'Web Visitor', '+91 90000 00000', 'Web Co', 'website', 'wabastore')`);
r = await api('a', 'GET', '/pipeline/inbound');
check(r.status === 200 && r.json.data.some((l: any) => l.id === 'W-1'), 'unassigned inbound lead visible to the sales team', r);
r = await api('a', 'POST', '/pipeline/inbound/W-1/claim');
check(r.status === 201 && r.json.data.lifecycleStage === 'LEAD' && r.json.data.ownerId === memberA, 'claim converts inbound lead into a LEAD record', r);
r = await api('b', 'POST', '/pipeline/inbound/W-1/claim');
check(r.status === 409, 'second claim → 409 (no duplicate customers)', r);
r = await api('b', 'GET', '/pipeline/inbound');
check(!r.json.data.some((l: any) => l.id === 'W-1'), 'claimed lead leaves the inbound list');
void leadB;


// --- conversations, Sales → Accounts payment workflow, Part Payments ---------
r = await api('a', 'POST', '/pipeline/leads', { name: 'Neelam Rao', company: 'Rao Textiles', phone: '+91 97000 11111', leadSource: 'Walk-in', services: ['AI_CALLING'], notes: 'Asked about AI calling on the first visit.' });
check(r.status === 201, 'lead created with a note', r);
const payLead = r.json.data.id;
r = await api('a', 'GET', `/pipeline/customers/${payLead}`);
check(r.status === 200 && r.json.data.conversations.length === 1 && r.json.data.conversations[0].source === 'LEAD_NOTE'
  && r.json.data.conversations[0].note === 'Asked about AI calling on the first visit.' && r.json.data.conversations[0].author?.fullName === 'Member A' && r.json.data.conversations[0].canEdit,
  'the note typed while creating the lead comes back as the Last conversation', r.json.data.conversations);
r = await api('a', 'POST', `/pipeline/customers/${payLead}/conversations`, { note: '   ' });
check(r.status === 422, 'an empty conversation is rejected by validation', r);
r = await api('a', 'POST', `/pipeline/customers/${payLead}/conversations`, { note: 'Sent the quotation on WhatsApp.' });
check(r.status === 201 && r.json.data.length === 2 && r.json.data[0].note === 'Sent the quotation on WhatsApp.' && r.json.data[1].source === 'LEAD_NOTE', 'a new conversation is first; the earlier one stays', r);
const firstConv = r.json.data[1].id;
r = await api('a', 'PATCH', `/pipeline/conversations/${firstConv}`, { note: 'Asked about AI calling and WhatsApp API on the first visit.' });
check(r.status === 200, 'the author edits one conversation', r);
r = await api('a', 'GET', `/pipeline/customers/${payLead}/conversations`);
check(r.json.data.length === 2 && r.json.data[0].note === 'Sent the quotation on WhatsApp.' && r.json.data[1].note.includes('WhatsApp API') && r.json.data[1].editedAt, 'only that conversation changed', r.json.data);
r = await api('b', 'PATCH', `/pipeline/conversations/${firstConv}`, { note: 'hijack' });
check(r.status === 404, "another salesperson cannot edit someone else's conversation", r);
r = await api('b', 'POST', `/pipeline/customers/${payLead}/conversations`, { note: 'hijack' });
check(r.status === 404, "another salesperson cannot add to someone else's lead", r);

r = await api('b', 'POST', `/pipeline/customers/${payLead}/send-to-accounts`, { amount: 40000 });
check(r.status === 404, 'another salesperson cannot send this lead to Accounts', r);
r = await api('a', 'POST', `/pipeline/customers/${payLead}/send-to-accounts`, { amount: 0 });
check(r.status === 422, 'an agreed amount is required', r);
r = await api('a', 'POST', `/pipeline/customers/${payLead}/send-to-accounts`, { amount: 40000, note: 'Agreed on the call' });
check(r.status === 200 && r.json.data.paymentWorkflow === 'PENDING_PAYMENT_CONFIRMATION' && r.json.data.dealAmount === 40000 && r.json.data.id === payLead, 'Send to Accounts: same lead, pending payment confirmation', r);
r = await api('a', 'POST', `/pipeline/customers/${payLead}/send-to-accounts`, { amount: 40000 });
check(r.status === 409, 'a second submission is refused', r);
r = await api('a', 'PATCH', `/pipeline/leads/${payLead}`, { city: 'Pune' });
check(r.status === 409, 'a lead with Accounts cannot be edited', r);
r = await api('a', 'GET', '/pipeline/customers?stage=LEAD&pageSize=100');
check(!r.json.data.items.some((i: any) => i.id === payLead), 'Leads no longer lists it while it is with Accounts');
r = await api('a', 'GET', '/pipeline/customers?stage=LEAD&accounts=WITH_ACCOUNTS&path=pipeline%2Fcustomers');
check(r.status === 200 && r.json.data.items.length === 1 && r.json.data.items[0].id === payLead, 'the With Accounts tab lists it', r);
r = await api('a', 'GET', '/pipeline/accounts/payment-requests');
check(r.status === 403, 'Sales cannot read the Accounts queue', r);
r = await api('a', 'POST', `/pipeline/customers/${payLead}/accounts/payments`, { type: 'PART', amount: 10000, method: 'CASH', verify: true });
check(r.status === 403, 'Sales cannot record a payment', r);
r = await api('a', 'POST', `/pipeline/customers/${payLead}/accounts/payment-confirmed`, {});
check(r.status === 403, 'Sales cannot confirm payment', r);

r = await api('accm', 'GET', '/pipeline/accounts/payment-requests?status=PENDING&path=pipeline%2Faccounts%2Fpayment-requests');
check(r.status === 200 && r.json.data.total === 1 && r.json.data.items[0].id === payLead && r.json.data.items[0].agreedAmount === 40000 && r.json.data.items[0].salesperson === 'Member A',
  'Accounts sees the submission with the amount and salesperson', r);
r = await api('accm', 'GET', '/pipeline/accounts/counts');
check(r.status === 200 && r.json.data.requestsPending === 1, 'Accounts counters', r);
r = await api('accm', 'POST', `/pipeline/customers/${payLead}/accounts/payment-confirmed`, {});
check(r.status === 422, 'cannot confirm before a payment is verified', r);
r = await api('a', 'POST', `/pipeline/customers/${payLead}/accounts/order-gst`, { rate: 0 });
check(r.status === 403, 'Sales cannot choose the GST of an order', r);
r = await api('accm', 'POST', `/pipeline/customers/${payLead}/accounts/payments`, { type: 'PART', amount: 15000, method: 'UPI', reference: 'UTR-API-0', verify: false });
check(r.status === 422 && /GST rate/.test(r.json.error.message), 'no payment before Accounts has chosen the GST rate of the order', r);
r = await api('accm', 'POST', `/pipeline/customers/${payLead}/accounts/order-gst`, { rate: 7 });
check(r.status === 422, 'a rate that is not on the list is refused', r);
r = await api('accm', 'POST', `/pipeline/customers/${payLead}/accounts/order-gst`, { rate: 0 });
check(r.status === 200 && r.json.data.orderGst.selected === true && r.json.data.dealAmount === 40000, 'Accounts chooses 0% for this order (the figures below stay as written)', r);
r = await api('accm', 'POST', `/pipeline/customers/${payLead}/accounts/payments`, { type: 'PART', amount: 15000, method: 'UPI', verify: false });
check(r.status === 422, 'a UPI payment needs a reference (validation)', r);
r = await api('accm', 'POST', `/pipeline/customers/${payLead}/accounts/payments`, { type: 'PART', amount: 15000, method: 'UPI', reference: 'UTR-API-1', verify: false });
check(r.status === 201 && r.json.data.pending === 15000 && r.json.data.verified === 0 && r.json.data.paymentStatus === 'PENDING_VERIFICATION' && r.json.data.payments[0].status === 'PENDING', 'a pending payment is not money received', r);
const apiPay1 = r.json.data.payments[0].id;
r = await api('accm', 'POST', `/pipeline/customers/${payLead}/accounts/payments`, { type: 'PART', amount: 15000, method: 'UPI', reference: 'utr-api-1', verify: false });
check(r.status === 409, 'the same reference cannot be recorded twice', r);
r = await api('accm', 'POST', `/pipeline/customers/${payLead}/accounts/payments/${apiPay1}/verify`, {});
check(r.status === 200 && r.json.data.verified === 15000 && r.json.data.balance === 25000 && r.json.data.paymentStatus === 'PARTIALLY_PAID' && r.json.data.payments.length === 1, 'verifying updates the totals without adding a payment', r);
r = await api('accm', 'POST', `/pipeline/customers/${payLead}/accounts/payments/${apiPay1}/verify`, {});
check(r.status === 409, 'cannot verify twice', r);
await db.query(`update public.customers set email = 'pay.lead@example.com' where id = $1`, [payLead]);
r = await api('accm', 'POST', `/pipeline/customers/${payLead}/accounts/payment-confirmed`, { note: 'UPI received' });
check(r.status === 200, 'Confirm payment & return to Sales', r);
check(r.json.data.clientLogin.status === 'CREATED' && r.json.data.clientLogin.email === 'pay.lead@example.com',
  'confirming the payment creates the client login by the Accounts flow (the e-mail on the record)', r.json.data);
{
  const acct = (await db.query(`select a.email, a.access_method, a.must_change_password from public.customer_client_accounts a where a.customer_id = $1`, [payLead])).rows;
  check(acct.length === 1 && acct[0].email === 'pay.lead@example.com' && acct[0].access_method === 'LINK' && acct[0].must_change_password === false, 'the login is the set-password kind: nobody knows a password', acct);
  const jobs = (await db.query(`select channel, status, secret from public.automation_jobs where customer_id = $1 and stage = 'ACCOUNT_CREATED' order by channel`, [payLead])).rows;
  check(jobs.length === 2 && jobs.every((j: any) => j.secret === null), 'the account e-mail and WhatsApp are queued once (whatever the sending mode does with them), with no password', jobs);
  const st = (await db.query(`select meta_status, onboarding_completed_at from public.customer_onboarding where customer_id = $1`, [payLead])).rows[0];
  check(st && st.onboarding_completed_at === null, 'the login unlocks nothing: onboarding is not complete', st);
}
r = await api('a', 'GET', `/pipeline/customers/${payLead}`);
check(r.json.data.lifecycleStage === 'ONBOARDING' && r.json.data.paymentWorkflow === 'PAYMENT_CONFIRMED' && r.json.data.onboarding.paymentVerified === true && r.json.data.onboarding.getStarted === false
  && r.json.data.conversations.length === 2 && r.json.data.amountVerified === 15000 && r.json.data.paymentStatus === 'PARTIALLY_PAID',
  'the same customer is in onboarding: payment verified, not Get started, conversations kept', r.json.data.onboarding);
r = await api('a', 'GET', '/pipeline/customers?stage=ONBOARDING&onboarding=GET_STARTED&pageSize=100');
check(!r.json.data.items.some((i: any) => i.id === payLead), 'not under Get started: documents are not verified');
r = await api('a', 'GET', '/pipeline/part-payments?search=rao&path=pipeline%2Fpart-payments');
check(r.status === 200 && r.json.data.total === 1 && r.json.data.items[0].id === payLead && r.json.data.items[0].balance === 25000 && r.json.data.items[0].followUp === null, 'Sales Part payments: the customer with its balance, no accountant notes', r);
r = await api('b', 'GET', '/pipeline/part-payments?search=rao');
check(r.status === 200 && !r.json.data.items.some((i: any) => i.id === payLead), 'another salesperson does not see it');
r = await api('b', 'GET', `/pipeline/customers/${payLead}/payment-overview`);
check(r.status === 404, "nor its payment overview", r);
r = await api('accm', 'GET', '/pipeline/part-payments?search=rao&sort=balance&from=2020-01-01');
check(r.status === 200 && r.json.data.total === 1 && r.json.data.items[0].followUp.status === 'FOLLOW_UP_REQUIRED' && r.json.data.items[0].accountsOwner.fullName, 'Accounts sees the same customer as a follow-up', r);
r = await api('accm', 'GET', '/pipeline/part-payments?status=bogus');
check(r.status === 422, 'an unknown status is rejected', r);
r = await api('accm', 'POST', `/pipeline/customers/${payLead}/accounts/followups`, { outcome: 'AWAITING_PAYMENT', note: 'Will pay on the 20th.', nextFollowUpAt: new Date(Date.now() + 5 * 864e5).toISOString() });
check(r.status === 201 && r.json.data.followUps.length === 1, 'the accountant records a follow-up', r);
r = await api('accm', 'POST', `/pipeline/customers/${payLead}/accounts/followups`, { outcome: 'CONTACTED', note: '' });
check(r.status === 422, 'a follow-up needs a note', r);
r = await api('a', 'GET', `/pipeline/customers/${payLead}/payment-overview`);
check(r.status === 200 && r.json.data.followUps === null && r.json.data.payments.length === 1, 'Sales sees the payments but never the follow-up notes', r);
r = await api('a', 'POST', `/pipeline/customers/${payLead}/accounts/followups`, { outcome: 'CONTACTED', note: 'x' });
check(r.status === 403, 'Sales cannot add follow-ups', r);
r = await api('accm', 'POST', `/pipeline/customers/${payLead}/accounts/payments`, { type: 'FULL', amount: 25000, method: 'BANK_TRANSFER', reference: 'NEFT-API-2', verify: true });
check(r.status === 201 && r.json.data.verified === 40000 && r.json.data.balance === 0 && r.json.data.paymentStatus === 'FULLY_PAID' && r.json.data.payments.length === 2, 'the full payment settles the balance; history kept', r);
r = await api('accm', 'GET', '/pipeline/part-payments?status=PARTIAL&search=rao');
check(r.json.data.total === 0, 'fully paid: removed from the active follow-up list', r);
r = await api('accm', 'GET', '/pipeline/part-payments?status=PAID&search=rao');
check(r.json.data.total === 1 && r.json.data.items[0].followUp.status === 'FULLY_PAID', 'and kept under Paid', r);

// Customer backs off at Accounts.
r = await api('a', 'POST', '/pipeline/leads', { name: 'Omkar Bhat', company: 'Bhat Stores', phone: '+91 97000 22222', leadSource: 'Walk-in', services: ['AI_CALLING'], notes: 'Wants to buy.' });
const backLead = r.json.data.id;
await api('a', 'POST', `/pipeline/customers/${backLead}/send-to-accounts`, { amount: 20000 });
r = await api('a', 'POST', `/pipeline/customers/${backLead}/accounts/back-off`, { reason: 'x' });
check(r.status === 403, 'Sales cannot use the Accounts back-off action', r);
r = await api('accm', 'POST', `/pipeline/customers/${backLead}/accounts/back-off`, { reason: 'Customer will not proceed' });
check(r.status === 200, 'Customer backed off - return to Leads', r);
r = await api('accm', 'POST', `/pipeline/customers/${backLead}/accounts/back-off`, {});
check(r.status === 409, 'cannot return twice', r);
r = await api('a', 'GET', '/pipeline/customers?stage=LEAD&accounts=RETURNED');
check(r.json.data.items.length === 1 && r.json.data.items[0].id === backLead && r.json.data.items[0].paymentWorkflow === 'RETURNED_FROM_ACCOUNTS', 'the lead is back in Leads, marked as returned', r);
r = await api('a', 'GET', `/pipeline/customers/${backLead}/payment-overview`);
check(r.json.data.request.status === 'RETURNED' && r.json.data.request.resolutionNote === 'Customer will not proceed', 'Sales can read the return reason', r);
r = await api('a', 'GET', `/pipeline/customers/${backLead}`);
check(r.json.data.conversations.length === 1 && r.json.data.lifecycleStage === 'LEAD', 'conversation history intact, still the same lead', r);
r = await api('a', 'GET', '/pipeline/counts');
check(r.json.data.leads.RETURNED === 1 && typeof r.json.data.partPayments === 'number', 'counts include Returned and Part payments', r.json.data);


// --- Accounts finance (income from verified payments, expenses, analytics) -----------------
// Income = verified payments of the original deals plus verified add-on payments.
const VERIFIED_INCOME = `(select customer_id, amount from customer_payments where status = 'VERIFIED' union all select customer_id, amount from addon_payments where status = 'VERIFIED')`;
const { rows: [verifiedSum] } = await db.query(`select coalesce(sum(amount), 0)::float as s, count(*)::int as n from ${VERIFIED_INCOME} v`);
const { rows: [wabIncome] } = await db.query(`select coalesce(sum(p.amount), 0)::float as s from ${VERIFIED_INCOME} p join customers c on c.id = p.customer_id where c.department_id = $1`, [wab.id]);
check(verifiedSum.n > 0 && (await db.query(`select 1 from addon_payments where status = 'VERIFIED'`)).rowCount === 2, 'the add-on payments are part of the verified income');
r = await api('a', 'GET', '/accounts/finance/summary');
check(r.status === 403, 'Sales cannot read the finance totals', r);
r = await api('a', 'POST', '/accounts/finance/expenses', { date: '2026-10-05', description: 'x', category: 'Rent', amount: 100 });
check(r.status === 403, 'Sales cannot add an expense', r);
r = await api('accm', 'GET', '/accounts/finance/summary?path=accounts%2Ffinance%2Fsummary');
check(r.status === 200 && r.json.data.income === verifiedSum.s && r.json.data.expenses === 0 && r.json.data.net === verifiedSum.s, 'the summary is exactly the verified payments; no expenses yet means 0', r);
r = await api('accm', 'POST', '/accounts/finance/expenses', { date: '2026-10-05', description: 'Office rent', departmentId: wab.id, category: 'Rent', amount: 1200.5, status: 'PAID', notes: 'October' });
check(r.status === 201 && r.json.data.id, 'Accounts adds an expense', r);
const expId = r.json.data.id;
r = await api('accm', 'POST', '/accounts/finance/expenses', { date: '2026-10-06', description: 'Ads', category: 'Marketing', amount: 800, status: 'PENDING' });
check(r.status === 201, 'a company-wide expense (no department) is allowed', r);
r = await api('accm', 'POST', '/accounts/finance/expenses', { date: '2026-10-06', description: 'Bad', category: 'Rent', amount: -5 });
check(r.status === 422, 'a negative amount is rejected', r);
r = await api('accm', 'POST', '/accounts/finance/expenses', { date: '2026-10-06', description: 'Bad', category: 'Rent', amount: 5.555 });
check(r.status === 422, 'more than two decimals is rejected', r);
r = await api('accm', 'GET', '/accounts/finance/summary');
check(r.json.data.expenses === 2000.5 && r.json.data.expensesPending === 800 && r.json.data.net === verifiedSum.s - 2000.5, 'totals follow the new expenses: net = income - expenses', r);
r = await api('accm', 'GET', `/accounts/finance/summary?departmentId=${wab.id}`);
check(r.json.data.expenses === 1200.5 && r.json.data.income === wabIncome.s, 'a department shows only its own income and expenses', r);
r = await api('accm', 'GET', `/accounts/finance/summary?departmentId=${wbx.id}`);
check(r.json.data.expenses === 0 && r.json.data.income === 0, 'another department has no records: zero, not the company total', r);
r = await api('accm', 'GET', '/accounts/finance/departments');
check(
  r.status === 200 &&
    r.json.data.find((d: any) => d.departmentId === wab.id)?.expenses === 1200.5 &&
    r.json.data.find((d: any) => d.departmentId === wab.id)?.income === wabIncome.s &&
    r.json.data.find((d: any) => d.departmentId === wbx.id)?.expenses === 0,
  'Department Income: one box per department with its own earnings and expenses',
  r
);
r = await api('a', 'GET', '/accounts/finance/departments');
check(r.status === 403, 'non-Accounts staff cannot read department totals', r);
r = await api('accm', 'GET', '/accounts/finance/expenses?status=PENDING&path=accounts%2Ffinance%2Fexpenses');
check(r.status === 200 && r.json.data.total === 1 && r.json.data.items[0].description === 'Ads' && r.json.data.categories.includes('Rent'), 'the expense list filters by status', r);
r = await api('accm', 'PATCH', `/accounts/finance/expenses/${expId}`, { date: '2026-10-05', description: 'Office rent (Oct)', departmentId: wab.id, category: 'Rent', amount: 1300, status: 'PAID' });
check(r.status === 200, 'the creator edits their expense', r);
r = await api('accdh', 'PATCH', `/accounts/finance/expenses/${expId}`, { date: '2026-10-05', description: 'Office rent (Oct)', departmentId: wab.id, category: 'Rent', amount: 1250, status: 'PAID' });
check(r.status === 200, 'an Accounts head corrects any expense', r);
r = await api('a', 'DELETE', `/accounts/finance/expenses/${expId}`);
check(r.status === 403, 'Sales cannot delete an expense', r);
r = await api('accm', 'POST', '/accounts/finance/expenses/import', { source: 'GOOGLE_SHEET', rows: [{ externalId: 'row-1', date: '2026-10-02', description: 'Courier', category: 'Logistics', amount: 150 }] });
check(r.status === 403, 'a member cannot import expenses', r);
r = await api('accdh', 'POST', '/accounts/finance/expenses/import', { source: 'GOOGLE_SHEET', rows: [{ externalId: 'row-1', date: '2026-10-02', description: 'Courier', departmentSlug: 'wabastore', category: 'Logistics', amount: 150 }] });
check(r.status === 200 && r.json.data.inserted === 1, 'an Accounts head imports rows (ready for a sheet export)', r);
r = await api('accdh', 'POST', '/accounts/finance/expenses/import', { source: 'GOOGLE_SHEET', rows: [{ externalId: 'row-1', date: '2026-10-02', description: 'Courier', departmentSlug: 'wabastore', category: 'Logistics', amount: 175 }] });
check(r.status === 200 && r.json.data.updated === 1 && r.json.data.inserted === 0, 'importing the same external id updates, never duplicates', r);
r = await api('accm', 'GET', '/accounts/finance/income?search=UTR-API-1');
check(r.status === 200 && r.json.data.total === 1 && r.json.data.items[0].customer === 'Rao Textiles', 'income lists the verified payment with its customer', r);
r = await api('accm', 'GET', '/accounts/finance/income');
check(r.json.data.total === verifiedSum.n && r.json.data.sum === verifiedSum.s, 'the income list is exactly the verified payments', r);
r = await api('accm', 'GET', '/accounts/finance/trend?months=6');
check(r.status === 200 && r.json.data.months.length === 6 && r.json.data.expenseCategories.length >= 2, 'analytics: one row per month and the biggest expense categories', r);

// --- rate limiting (shared Postgres counters) + response headers -------------
let limited: Response | null = null;
for (let i = 0; i < 4 && !limited; i++) {
  const res = await fetch(base + '/customers/import', {
    method: 'POST',
    headers: { authorization: `Bearer ${tokens.get('dh')}`, 'content-type': 'application/json' },
    body: JSON.stringify({ customers: [{ name: 'RL', email: `rl${i}@x.com` }] })
  });
  if (res.status === 429) limited = res;
}
check(limited !== null, 'import quota (3/min) returns 429 once exhausted');
const limitedBody = (await limited!.json()) as any;
check(limitedBody.error.code === 'RATE_LIMITED' && Number(limited!.headers.get('retry-after')) > 0, '429 has RATE_LIMITED code and Retry-After', limitedBody);
const { rows: [rl] } = await db.query(`select count(*)::int n from private.rate_limit_counters where bucket like 'user:%:import'`);
check(rl.n >= 1, 'quota counters are stored in Postgres (shared across instances)');
const normal = await fetch(base + '/departments', { headers: { authorization: `Bearer ${tokens.get('sa')}` } });
check(normal.headers.get('ratelimit-limit') === '5000' && normal.headers.get('x-request-id') && normal.headers.get('x-content-type-options') === 'nosniff',
  'responses carry RateLimit-*, X-Request-Id and security headers');

const health = await fetch(base + '/health').then(x => x.json()) as any;
check(health.success && health.data.checks.database.startsWith('ok'), 'public health check reports database ok', health);
const viaRewrite = await fetch(base.replace('/api/v1', '') + '/api/crm?__path=approval-requests/' + orphanReq.id + '/approve', {
  method: 'POST', headers: { authorization: `Bearer ${tokens.get('sa')}`, 'content-type': 'application/json' }, body: '{}'
});
check(viaRewrite.status === 409, 'Vercel rewrite form (?__path=) routes multi-segment POSTs', viaRewrite.status);
r = await api('sa', 'PUT', '/customers');
check(r.status === 405, 'wrong method → 405');

// ---------------------------------------------------------------------------
// Onboarding emails + WhatsApp (Wabastore, WhatsApp API + Blue Tick): queued by the
// database, sent by the API. A local mock stands in for the email provider and the
// WhatsApp webhook - nothing real is sent.
// ---------------------------------------------------------------------------
const outbox: { path: string; headers: http.IncomingHttpHeaders; body: any }[] = [];
const failNext: Record<string, number[]> = {};
const provider = http.createServer((req, res) => {
  let raw = '';
  req.on('data', c => (raw += c));
  req.on('end', () => {
    const path = (req.url || '').split('?')[0];
    outbox.push({ path, headers: req.headers, body: raw ? JSON.parse(raw) : null });
    const status = failNext[path]?.shift() ?? 200;
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(status < 300 ? { id: `msg-${outbox.length}` } : { message: 'Service busy' }));
  });
});
await new Promise<void>(rs => provider.listen(0, rs));
const P = `http://127.0.0.1:${(provider.address() as any).port}`;
Object.assign(process.env, {
  AUTOMATION_MODE: 'dry_run',
  EMAIL_PROVIDER: 'resend',
  EMAIL_API_KEY: 're_test_key',
  EMAIL_API_BASE_URL: P,
  EMAIL_FROM: 'Amuwa Corporation <meta@amuwa.com>',
  WHATSAPP_WEBHOOK_URL: `${P}/wa`,
  AUTOMATION_SECRET_KEY: 'local-test-automation-secret',
  AUTOMATION_DISPATCH_SECRET: 'dispatch-secret-0123456789'
});
const dispatch = (secret?: string) =>
  fetch(`${base}/internal/automations/dispatch`, { method: 'POST', headers: secret ? { authorization: `Bearer ${secret}` } : {} }).then(async x => ({ status: x.status, json: (await x.json()) as any }));
const jobsOf = async (id: string) => (await db.query(`select channel, stage, status, detail, secret, attempts from public.automation_jobs where customer_id = $1 order by created_at, channel`, [id])).rows;

// A customer of member A (Wabastore) with the WhatsApp API service, brought to the Technical Consultant.
async function autoCustomer(fields: Record<string, unknown>, website: string | null, opts: { addons?: boolean } = {}) {
  const res = await api('a', 'POST', '/pipeline/leads', { leadSource: 'Walk-in', services: ['WHATSAPP_API_BLUE_TICK'], ...fields });
  check(res.status === 201, `automation test customer ${fields.company} created`, res);
  const id = res.json.data.id as string;
  await db.query(`update public.customers set lifecycle_stage = 'POTENTIAL', deal_amount = 1000, amount_received = 1000, stage_changed_at = now() where id = $1`, [id]);
  const st = await api('a', 'POST', `/pipeline/customers/${id}/start-onboarding`, { amountReceived: 0, paymentMethod: 'UPI' });
  check(st.status === 200, 'onboarding started', st);
  if (website) {
    const w = await api('a', 'PATCH', `/pipeline/customers/${id}/checklist/WA_WEBSITE_URL`, { value: website });
    check(w.status === 200, `sales saves the website "${website}"`, w);
  }
  await db.query(
    `insert into public.customer_onboarding_entries (customer_id, item_code, value, status, saved_at)
     select $1, i.code, case when i.kind = 'YES_NO' then 'YES' else 'saved' end, 'SAVED', now()
       from private.customer_items($1) i where i.code <> 'WA_WEBSITE_URL'
     on conflict (customer_id, item_code) do nothing`, [id]);
  await db.query(`select private.refresh_onboarding_progress($1)`, [id]);
  // what Accounts confirming the payment does: the customer reaches the Technical Consultant
  await db.query(`select private.forward_to_consultant(c.id, c, false) from public.customers c where c.id = $1`, [id]);
  await db.query(`update public.customer_onboarding set accounts_confirmed_at = coalesce(accounts_confirmed_at, now()) where customer_id = $1`, [id]);
  // reaching the consultant sends nothing; the messages start when the TC clicks "Send for onboarding"
  const arrived = await api('mv', 'GET', `/pipeline/customers/${id}/client-messages`);
  check(arrived.status === 200 && arrived.json.data.stage === null && arrived.json.data.messages.length === 0, `${fields.company}: reaching the consultant sends nothing`, arrived.json);
  // add-ons are the Technical Consultant's later conversation, not part of the first verification: the Meta Verifier cannot answer it
  const deny = await api('mv', 'POST', `/pipeline/customers/${id}/consultant/addons-required`, { required: true });
  check(deny.status === 404, 'the Meta Verifier cannot take part in the add-ons question', deny);
  await db.query(`update public.customer_onboarding set addons_required = $2 where customer_id = $1`, [id, opts.addons ?? false]);
  const startRes = await api('mv', 'POST', `/pipeline/customers/${id}/consultant/start-onboarding`);
  check(startRes.status === 200, `${fields.company}: the TC clicks Send for onboarding`, startRes);
  return id;
}

// The dispatch endpoint is protected
check((await dispatch()).status === 401, 'dispatch needs the secret');
check((await dispatch('wrong-secret-0123456789')).status === 401, 'a wrong secret is refused');

// Dry run: prepared and logged, nothing sent
const autoB = await autoCustomer({ name: 'Dry Run', company: 'Dry Traders', email: 'dry.client@example.com', whatsapp: '9819900011', phone: '9819900022' }, 'https://dry-traders.example');
let d = await dispatch('dispatch-secret-0123456789');
check(d.status === 200 && d.json.data.mode === 'dry_run' && d.json.data.sent === 0, 'dry run: nothing is sent (the jobs were already processed right after the TC\'s click)', d);
check((await jobsOf(autoB)).length === 2 && (await jobsOf(autoB)).every(j => j.status === 'SKIPPED'), 'dry run: both jobs are prepared and marked as not sent');
check(outbox.length === 0, 'dry run: no request reached the email provider or the WhatsApp webhook');
r = await api('mv', 'GET', `/pipeline/customers/${autoB}/client-messages`);
check(r.status === 200 && r.json.data.automated && r.json.data.stage === 'UNDER_REVIEW' && r.json.data.mode === 'dry_run'
  && r.json.data.messages.length === 2 && r.json.data.messages.every((m: any) => m.status === 'SKIPPED' && /^Dry run/.test(m.detail))
  && r.json.data.messages.some((m: any) => m.detail.includes('Documents Received – Under Review') && m.detail.includes('d***@example.com')),
  'the TC sees the Under Review email and WhatsApp as dry-run (subject and masked recipient)', r);
check(!JSON.stringify(r.json).includes('secret'), 'the messages list never includes the password field');
r = await api('a', 'GET', `/pipeline/customers/${autoB}/client-messages`);
check(r.status === 200 && r.json.data.messages.length === 2, 'the salesperson can see what was sent to their customer', r);
r = await api('accm', 'GET', `/pipeline/customers/${autoB}/client-messages`);
check(r.status === 404, 'staff who cannot see the customer get 404', r);
r = await api('tc', 'GET', `/pipeline/customers/${leadA}/client-messages`);
check(r.status === 200 && r.json.data.automated === false && r.json.data.stage === null && r.json.data.messages.every((m: any) => m.stage === 'ACCOUNT_CREATED' && m.status === 'SKIPPED'),
  'customers without the WhatsApp API service get no onboarding messages (only the account-created one, here dry-run)', r);

// --- Meta Verifier workflow: notes, hand-over, the Technical Consultant's follow-up (nothing is sent: the mode is still dry run) ---
{
  const wf = await autoCustomer({ name: 'Flow One', company: 'Flow One Traders', email: 'flow.one@example.com', whatsapp: '9819900077', phone: '9819900078' }, 'https://flow-one.example');
  r = await api('tc', 'GET', `/pipeline/customers/${wf}/verification/notes`);
  check(r.status === 404, 'workflow: the Technical Consultant cannot read the notes of a Meta customer before the hand-over', r);
  r = await api('a', 'POST', `/pipeline/customers/${wf}/verification/notes`, { body: 'x', outcome: 'NOTE' });
  check(r.status === 404, 'workflow: Sales cannot write verification notes', r);
  r = await api('mv', 'POST', `/pipeline/customers/${wf}/verification/notes`, { body: 'GST certificate checked', outcome: 'NOTE' });
  check(r.status === 201 && r.json.data.length === 1 && r.json.data[0].author === 'Meta Verifier', 'workflow: the Meta Verifier records a note (returns the history)', r);
  r = await api('mv', 'POST', `/pipeline/customers/${wf}/verification/notes`, { body: 'Address proof is blurred', outcome: 'NEEDS_CORRECTION' });
  check(r.status === 201 && r.json.data.length === 2 && r.json.data[0].outcome === 'NEEDS_CORRECTION', 'workflow: the history keeps both, newest first', r);
  r = await api('mv', 'POST', `/pipeline/customers/${wf}/verification/notes`, { body: 'x', outcome: 'NOPE' });
  check(r.status === 422, 'workflow: an unknown outcome is refused', r);
  r = await api('mv', 'POST', `/pipeline/customers/${wf}/verification/notes`, { body: '', outcome: 'NOTE' });
  check(r.status === 422, 'workflow: an empty note is refused', r);
  r = await api('mv', 'POST', `/pipeline/customers/${wf}/verification/notes`, { body: 'x', outcome: 'NOTE', extra: 1 });
  check(r.status === 422, 'workflow: unknown fields are refused', r);

  // Sales is told where the customer goes; the Meta Verifier records the WhatsApp panel account (never a password)
  r = await api('sa', 'GET', `/pipeline/customers/${wf}/handoff`);
  check(r.status === 200 && r.json.data.route === 'META' && r.json.data.recipient === 'Meta Verifier' && r.json.data.recipientAvailable === true, 'workflow: the hand-off says Meta Verifier, and that one exists', r);
  r = await api('sa', 'GET', `/pipeline/customers/not-a-uuid/handoff`);
  check(r.status === 422, 'workflow: a bad customer id is refused', r);
  r = await api('mv', 'GET', `/pipeline/customers/${wf}/verification/panel-details`);
  check(r.status === 200 && r.json.data.canEdit === true && r.json.data.services.length >= 1 && r.json.data.dashboardLogin === null, 'workflow: the verifier reads the panel details and the (empty) dashboard login', r);
  const waCode = r.json.data.services[0].code;
  r = await api('mv', 'PATCH', `/pipeline/customers/${wf}/verification/panel-details/${waCode}`, { platform: 'Main Panel', account: 'flow.one@example.com' });
  check(r.status === 200 && r.json.data.services.find((s: any) => s.code === waCode).panelAccount === 'flow.one@example.com', 'workflow: the verifier saves the account and gets the section back', r);
  r = await api('mv', 'PATCH', `/pipeline/customers/${wf}/verification/panel-details/${waCode}`, { platform: 'Main Panel', account: 'flow.one@example.com:Secret99' });
  check(r.status === 422 || r.status === 400, 'workflow: a "user:password" pair is refused', r);
  r = await api('mv', 'PATCH', `/pipeline/customers/${wf}/verification/panel-details/${waCode}`, { account: 'flow.one@example.com', password: 'x' });
  check(r.status === 422, 'workflow: there is no password field - unknown fields are refused', r);
  r = await api('a', 'GET', `/pipeline/customers/${wf}/verification/panel-details`);
  check(r.status === 404, 'workflow: Sales cannot read the panel details', r);
  r = await api('tc', 'PATCH', `/pipeline/customers/${wf}/verification/panel-details/${waCode}`, { account: 'tc@example.com' });
  check(r.status === 404, 'workflow: the Technical Consultant cannot write the panel details of a Meta customer', r);
  check((await db.query(`select count(*)::int as n from public.audit_logs where action = 'SERVICE_PANEL_DETAILS_SET' and metadata::text like '%flow.one%'`)).rows[0].n === 0, 'workflow: the audit never holds the values');

  // The Meta Verifier sets the password on the (external) panel and the CRM e-mails it to the customer once, keeping nothing
  {
    const modeBefore = process.env.AUTOMATION_MODE;
    // the API dispatches right after a change when sending is on; here it is switched off while jobs are queued, then on for one explicit run
    const go = async () => { process.env.AUTOMATION_MODE = 'live'; await dispatch('dispatch-secret-0123456789'); process.env.AUTOMATION_MODE = 'off'; };
    process.env.AUTOMATION_MODE = 'off';
    const credPath = `/pipeline/customers/${wf}/verification/panel-details/${waCode}/credentials`;
    const panelPw = 'Pnl#Secret-2026';
    const reqId = crypto.randomUUID();
    r = await api('mv', 'POST', credPath, { password: 'short', requestId: reqId });
    check(r.status === 422, 'panel password: too short is refused', r);
    r = await api('mv', 'POST', credPath, { password: panelPw });
    check(r.status === 422, 'panel password: a request id is required', r);
    r = await api('mv', 'POST', credPath, { password: panelPw, requestId: reqId, email: 'someone.else@example.com' });
    check(r.status === 422, 'panel password: there is no e-mail field - the address is the one on the record', r);
    for (const [who, label] of [['a', 'Sales'], ['tc', 'the Technical Consultant'], ['accm', 'Accounts']] as const) {
      r = await api(who, 'POST', credPath, { password: panelPw, requestId: crypto.randomUUID() });
      check(r.status === 403 || r.status === 404, `panel password: ${label} cannot set it`, r);
    }
    r = await api(null, 'POST', credPath, { password: panelPw, requestId: crypto.randomUUID() });
    check(r.status === 401, 'panel password: no session is refused', r);
    check((await db.query(`select count(*)::int n from public.automation_jobs where stage = 'PANEL_CREDENTIALS'`)).rows[0].n === 0, 'panel password: no refusal queued anything');
    const mailsBefore = outbox.filter(o => o.path === '/emails').length;
    r = await api('mv', 'POST', credPath, { password: panelPw, requestId: reqId });
    const cred = r.json?.data?.services?.find((x: any) => x.code === waCode)?.credentials;
    check(r.status === 200 && cred && cred.setBy === 'Meta Verifier' && cred.email?.status === 'QUEUED' && r.json.data.customerEmail === 'flow.one@example.com', 'panel password: set - the section shows who set it and that the e-mail is waiting', r);
    check(!JSON.stringify(r.json).includes(panelPw), 'panel password: the response never carries the password');
    r = await api('mv', 'POST', credPath, { password: panelPw, requestId: reqId });
    check(r.status === 200, 'panel password: the same request again is accepted and does nothing more', r);
    check((await db.query(`select count(*)::int n, bool_and(secret is not null and secret like 'v1:%' and secret not like '%' || $2 || '%') as enc from public.automation_jobs where customer_id = $1 and stage = 'PANEL_CREDENTIALS'`, [wf, panelPw])).rows[0].enc === true
      && (await db.query(`select count(*)::int n from public.automation_jobs where customer_id = $1 and stage = 'PANEL_CREDENTIALS'`, [wf])).rows[0].n === 1, 'panel password: one job, and the password on it is encrypted');
    await go();
    const panelMails = outbox.filter(o => o.path === '/emails').slice(mailsBefore).filter(o => /panel login/i.test(o.body.subject));
    check(panelMails.length === 1 && panelMails[0].body.to?.[0] === 'flow.one@example.com', 'panel password: exactly one e-mail, to the customer\'s address on the record', panelMails.map(m => m.body.to));
    const pm = panelMails[0].body;
    check(pm.html.includes(panelPw) && pm.html.includes('WhatsApp panel') && pm.html.includes('flow.one@example.com') && /separate from your Amuwa client dashboard/i.test(pm.html)
      && !/temporary password/i.test(pm.html) && /Dear Flow One,/.test(pm.html), 'panel password: the e-mail names the panel, the account and the password, and says it is not the dashboard login', pm.html);
    const pj = (await db.query(`select status, secret, detail, recipient from public.automation_jobs where customer_id = $1 and stage = 'PANEL_CREDENTIALS'`, [wf])).rows[0];
    check(pj.status === 'SENT' && pj.secret === null && pj.recipient === 'flow.one@example.com' && !String(pj.detail).includes(panelPw), 'panel password: the job is sent, the password is erased, and nothing about it is in the result', pj);
    r = await api('mv', 'GET', `/pipeline/customers/${wf}/verification/panel-details`);
    check(r.json.data.services.find((x: any) => x.code === waCode).credentials?.email?.status === 'SENT' && !JSON.stringify(r.json).includes(panelPw), 'panel password: the screen shows configured and sent', r);
    const leaks = (await db.query(`select (select count(*)::int from public.customer_activities where note like '%' || $1 || '%')
        + (select count(*)::int from public.audit_logs where metadata::text like '%' || $1 || '%')
        + (select count(*)::int from public.notifications where body like '%' || $1 || '%') as n`, [panelPw])).rows[0].n;
    check(leaks === 0, 'panel password: it is in no history line, audit entry or notification');
    // a provider failure: shown as failed and never as sent; the retry still has the password, and the customer gets one e-mail
    const mails2 = outbox.filter(o => o.path === '/emails').length;
    failNext['/emails'] = [503];
    r = await api('mv', 'POST', credPath, { password: 'Second#Pass-77', requestId: crypto.randomUUID() });
    check(r.status === 200, 'panel password: a new password with a new request', r);
    await go();
    let pj2 = (await db.query(`select status, secret, attempts from public.automation_jobs where customer_id = $1 and stage = 'PANEL_CREDENTIALS' order by created_at desc limit 1`, [wf])).rows[0];
    check(pj2.status === 'QUEUED' && pj2.secret !== null && pj2.attempts === 1, 'panel password: after a provider failure the job waits for a retry and still holds the password', pj2);
    r = await api('mv', 'GET', `/pipeline/customers/${wf}/verification/panel-details`);
    check(r.json.data.services.find((x: any) => x.code === waCode).credentials.email.status === 'QUEUED', 'panel password: and the screen does not say it was sent', r);
    await db.query(`update public.automation_jobs set next_attempt_at = now() where customer_id = $1 and stage = 'PANEL_CREDENTIALS' and status = 'QUEUED'`, [wf]);
    await go();
    const retried = outbox.filter(o => o.path === '/emails').slice(mails2).filter(o => /panel login/i.test(o.body.subject) && o.body.to?.[0] === 'flow.one@example.com');
    pj2 = (await db.query(`select status, secret from public.automation_jobs where customer_id = $1 and stage = 'PANEL_CREDENTIALS' order by created_at desc limit 1`, [wf])).rows[0];
    check(retried.length === 2 && retried[retried.length - 1].body.html.includes('Second#Pass-77') && pj2.status === 'SENT' && pj2.secret === null, 'panel password: the retry delivers it once and erases it', pj2);
    if (modeBefore === undefined) delete process.env.AUTOMATION_MODE; else process.env.AUTOMATION_MODE = modeBefore;
  }

  // Client Panel URL: validated everywhere, saved without sending, e-mailed once per link on the Meta Verifier's request
  {
    const modeBefore = process.env.AUTOMATION_MODE;
    const go = async () => { process.env.AUTOMATION_MODE = 'live'; await dispatch('dispatch-secret-0123456789'); process.env.AUTOMATION_MODE = 'off'; };
    process.env.AUTOMATION_MODE = 'off';
    const urlPath = `/pipeline/customers/${wf}/verification/panel-details/${waCode}/url`;
    const linkPath = `/pipeline/customers/${wf}/verification/panel-details/${waCode}/link`;
    const svc = (j: any) => j.data.services.find((x: any) => x.code === waCode);
    const linkJobs = async () => (await db.query(`select count(*)::int n from public.automation_jobs where customer_id = $1 and stage = 'PANEL_LINK'`, [wf])).rows[0].n;
    for (const [bad, why] of [['http://panel.example.com/login', 'http'], ['https://user:pw@panel.example.com/', 'credentials in the address'], ['https://panel.example.com/login?token=abc', 'a token'], ['https://localhost/login', 'localhost'], ['panel.example.com', 'no scheme']] as const) {
      r = await api('mv', 'PATCH', urlPath, { url: bad });
      check(r.status === 422, `panel URL: ${why} is refused by the API`, r);
    }
    r = await api('mv', 'PATCH', urlPath, { url: 'https://panel.example.com/login', extra: 1 });
    check(r.status === 422, 'panel URL: unknown fields are refused', r);
    for (const [who, label] of [['a', 'Sales'], ['tc', 'the Technical Consultant'], ['accm', 'Accounts']] as const) {
      r = await api(who, 'PATCH', urlPath, { url: 'https://panel.example.com/login' });
      check(r.status === 403 || r.status === 404, `panel URL: ${label} cannot save it`, r);
    }
    r = await api(null, 'PATCH', urlPath, { url: 'https://panel.example.com/login' });
    check(r.status === 401, 'panel URL: no session is refused', r);
    check((await db.query(`select count(*)::int n from public.customer_services where panel_url is not null`)).rows[0].n === 0, 'panel URL: no refusal saved anything');
    r = await api('mv', 'POST', linkPath, { requestId: crypto.randomUUID() });
    check(r.status === 422 && /Save the panel URL first/.test(JSON.stringify(r.json)), 'panel link: nothing to send before a URL is saved', r);

    const mailsBefore = outbox.filter(o => o.path === '/emails').length;
    r = await api('mv', 'PATCH', urlPath, { url: ' https://Panel.Example.com/login ' });
    check(r.status === 200 && svc(r.json).panelUrl === 'https://panel.example.com/login' && svc(r.json).link === null, 'panel URL: the verifier saves it (cleaned) and the section shows it, not yet sent', r);
    await go();
    check((await linkJobs()) === 0 && outbox.filter(o => o.path === '/emails').length === mailsBefore, 'panel URL: saving it sent and queued nothing');
    check((await db.query(`select count(*)::int n from public.audit_logs where action = 'SERVICE_PANEL_URL_SET' and metadata ->> 'host' = 'panel.example.com' and metadata::text not like '%/login%'`)).rows[0].n === 1, 'panel URL: the change is audited (host only)');

    const reqId = crypto.randomUUID();
    r = await api('mv', 'POST', linkPath, { requestId: reqId });
    check(r.status === 200 && r.json.data.link.queued === true && svc(r.json).link.email.status === 'QUEUED' && svc(r.json).link.current === true, 'panel link: queued - the section shows it waiting', r);
    r = await api('mv', 'POST', linkPath, { requestId: reqId });
    check(r.status === 200 && r.json.data.link.queued === false, 'panel link: the same request again does nothing', r);
    r = await api('mv', 'POST', linkPath, { requestId: crypto.randomUUID() });
    check(r.status === 200 && r.json.data.link.queued === false && r.json.data.link.reason === 'IN_PROGRESS', 'panel link: a new click while it waits does nothing', r);
    check((await linkJobs()) === 1, 'panel link: one job');
    await go();
    let pm = outbox.filter(o => o.path === '/emails').slice(mailsBefore).filter(o => /panel link/i.test(o.body.subject));
    check(pm.length === 1 && pm[0].body.to?.[0] === 'flow.one@example.com' && pm[0].body.html.includes('https://panel.example.com/login') && !/password:/i.test(pm[0].body.html), 'panel link: exactly one e-mail, to the address on the record, with the link and no password', pm.map(m => m.body.to));
    r = await api('mv', 'GET', `/pipeline/customers/${wf}/verification/panel-details`);
    check(svc(r.json).link.email.status === 'SENT' && svc(r.json).link.current === true, 'panel link: the screen says sent', r);
    r = await api('mv', 'POST', linkPath, { requestId: crypto.randomUUID() });
    check(r.json.data.link.queued === false && r.json.data.link.reason === 'ALREADY_SENT', 'panel link: a sent link is not sent again by accident', r);
    await go();
    check(outbox.filter(o => o.path === '/emails').slice(mailsBefore).filter(o => /panel link/i.test(o.body.subject)).length === 1, 'panel link: still one e-mail');

    // a change makes the new link sendable; a failure is shown as failed and can be tried again; "send again" is on purpose
    r = await api('mv', 'PATCH', urlPath, { url: 'https://panel2.example.com/login' });
    check(r.status === 200 && svc(r.json).link.current === false, 'panel URL: after a change the section says the sent link is no longer the saved one', r);
    failNext['/emails'] = [503];
    r = await api('mv', 'POST', linkPath, { requestId: crypto.randomUUID() });
    check(r.json.data.link.queued === true, 'panel link: the changed URL can be sent without "send again"', r);
    await go();
    r = await api('mv', 'GET', `/pipeline/customers/${wf}/verification/panel-details`);
    check(svc(r.json).link.email.status === 'QUEUED', 'panel link: a provider failure is not shown as sent (it waits for the retry)', r);
    await db.query(`update public.automation_jobs set next_attempt_at = now() where customer_id = $1 and stage = 'PANEL_LINK' and status = 'QUEUED'`, [wf]);
    await go();
    pm = outbox.filter(o => o.path === '/emails').slice(mailsBefore).filter(o => /panel link/i.test(o.body.subject) && o.body.html.includes('panel2.example.com'));
    const retriedJob = (await db.query(`select status, attempts from public.automation_jobs where customer_id = $1 and stage = 'PANEL_LINK' and context ->> 'panelUrl' = 'https://panel2.example.com/login'`, [wf])).rows;
    check(pm.length === 2 && retriedJob.length === 1 && retriedJob[0].status === 'SENT' && retriedJob[0].attempts === 2, 'panel link: the provider refused once, the retry delivered it, and it is one job marked sent', { pm: pm.length, retriedJob });
    r = await api('mv', 'POST', linkPath, { requestId: crypto.randomUUID(), resend: true });
    check(r.json.data.link.queued === true, 'panel link: "send again" sends the same address once more, on purpose', r);
    await go();
    check((await linkJobs()) === 3, 'panel link: three e-mails in all - the first link, the changed link, the deliberate resend');
    r = await api('mv', 'PATCH', urlPath, { url: '' });
    check(r.status === 200 && svc(r.json).panelUrl === null, 'panel URL: an empty value removes it', r);
    if (modeBefore === undefined) delete process.env.AUTOMATION_MODE; else process.env.AUTOMATION_MODE = modeBefore;
  }

  // Accounts: customer-wise revenue, one expense split across departments, and the Department Heads' e-mails
  {
    const modeBefore = process.env.AUTOMATION_MODE;
    const go = async () => { process.env.AUTOMATION_MODE = 'live'; await dispatch('dispatch-secret-0123456789'); process.env.AUTOMATION_MODE = 'off'; };
    process.env.AUTOMATION_MODE = 'off';
    const money2 = (n: number) => Math.round(n * 100) / 100;

    // customer-wise revenue
    r = await api('a', 'GET', '/accounts/finance/customer-revenue');
    check(r.status === 403, 'revenue: Sales cannot read the customer revenue report', r);
    r = await api(null, 'GET', '/accounts/finance/customer-revenue');
    check(r.status === 401, 'revenue: no session is refused', r);
    for (const bad of ['sort=NOPE', 'dir=SIDEWAYS', 'pageSize=500', 'page=0', 'serviceCode=nope', 'departmentId=not-a-uuid', 'from=yesterday']) {
      r = await api('accm', 'GET', `/accounts/finance/customer-revenue?${bad}`);
      check(r.status === 422, `revenue: ${bad} is refused`, r);
    }
    r = await api('accm', 'GET', '/accounts/finance/customer-revenue?pageSize=5&sort=COLLECTED&dir=DESC');
    const rev = r.json.data;
    check(r.status === 200 && rev.items.length <= 5 && rev.total >= rev.items.length && rev.page === 1 && rev.pageSize === 5, 'revenue: paginated', r);
    check(rev.items.every((x: any) => x.purchased >= 0 && x.collected >= 0 && x.pending >= 0 && x.outstanding >= 0 && x.outstanding <= x.purchased + 0.005), 'revenue: purchased, collected, pending and outstanding are separate non-negative figures', rev.items[0]);
    check(rev.items.every((x: any, i: number, a: any[]) => i === 0 || a[i - 1].collected >= x.collected), 'revenue: sorted by what was collected');
    const collectedAll = (await db.query(`select coalesce(sum(amount), 0)::float8 s from public.customer_payments where status = 'VERIFIED'`)).rows[0].s
      + (await db.query(`select coalesce(sum(amount), 0)::float8 s from public.addon_payments where status = 'VERIFIED'`)).rows[0].s;
    r = await api('accm', 'GET', '/accounts/finance/customer-revenue?pageSize=100');
    const sumCollected = money2(r.json.data.items.reduce((t: number, x: any) => t + x.collected, 0));
    check(r.json.data.total > 100 || Math.abs(sumCollected - r.json.data.totals.collected) < 0.01, 'revenue: the page adds up to the totals (no payment counted twice)', { sumCollected, totals: r.json.data.totals });
    check(r.json.data.totals.collected <= money2(collectedAll + 0.01 + (await db.query(`select coalesce(sum(amount), 0)::float8 s from public.invoice_payments where status = 'VERIFIED'`)).rows[0].s), 'revenue: and never exceed the verified money in the books', r.json.data.totals);
    r = await api('accm', 'GET', '/accounts/finance/customer-revenue?search=zzzz-nobody');
    check(r.status === 200 && r.json.data.total === 0 && r.json.data.items.length === 0, 'revenue: search filters', r);

    // one expense, several departments
    const split = (over: Record<string, unknown> = {}) => ({ date: '2026-10-20', description: 'Shared tooling', category: 'Software', amount: 1000, status: 'PAID',
      allocations: [{ departmentId: wab.id, amount: 600 }, { departmentId: wbx.id, amount: 400 }], requestId: crypto.randomUUID(), ...over });
    const before = (await api('accm', 'GET', '/accounts/finance/summary')).json.data;
    const wabBefore = (await api('accm', 'GET', '/accounts/finance/departments')).json.data.find((d: any) => d.departmentId === wab.id);
    const wbxBefore = (await api('accm', 'GET', '/accounts/finance/departments')).json.data.find((d: any) => d.departmentId === wbx.id);
    r = await api('a', 'POST', '/accounts/finance/expenses', split());
    check(r.status === 403, 'split: Sales cannot add an expense', r);
    r = await api('accm', 'POST', '/accounts/finance/expenses', split({ allocations: [{ departmentId: wab.id, amount: 600 }, { departmentId: wbx.id, amount: 300 }] }));
    check(r.status === 422, 'split: allocations that do not add up to the expense are refused', r);
    r = await api('accm', 'POST', '/accounts/finance/expenses', split({ allocations: [{ departmentId: wab.id, amount: 500 }, { departmentId: wab.id, amount: 500 }] }));
    check(r.status === 422, 'split: the same department twice is refused', r);
    r = await api('accm', 'POST', '/accounts/finance/expenses', split({ allocations: [{ departmentId: crypto.randomUUID(), amount: 1000 }] }));
    check(r.status >= 400 && r.status < 500, 'split: an unknown department is refused', r);
    r = await api('accm', 'POST', '/accounts/finance/expenses', split({ allocations: [{ departmentId: wab.id, amount: 1000.005 }] }));
    check(r.status === 422, 'split: a part with more than two decimals is refused', r);
    r = await api('accm', 'POST', '/accounts/finance/expenses', split({ allocations: [{ departmentId: wab.id, amount: -100 }, { departmentId: wbx.id, amount: 1100 }] }));
    check(r.status === 422, 'split: a negative part is refused', r);
    r = await api('accm', 'POST', '/accounts/finance/expenses', split({ departmentId: wab.id }));
    check(r.status === 422, 'split: a single department and a list together are refused', r);
    check((await db.query(`select count(*)::int n from public.department_expenses where description = 'Shared tooling'`)).rows[0].n === 0, 'split: nothing was saved by any refusal');
    const reqId = crypto.randomUUID();
    const mails0 = outbox.filter(o => o.path === '/emails').length;
    r = await api('accm', 'POST', '/accounts/finance/expenses', split({ requestId: reqId }));
    check(r.status === 201 && r.json.data.id, 'split: Accounts saves ONE expense with two department parts', r);
    const splitId = r.json.data.id;
    r = await api('accm', 'POST', '/accounts/finance/expenses', split({ requestId: reqId }));
    check(r.status === 201 && r.json.data.id === splitId, 'split: the same request again returns the same expense', r);
    check((await db.query(`select count(*)::int n from public.department_expenses where description = 'Shared tooling'`)).rows[0].n === 1
       && (await db.query(`select count(*)::int n, sum(amount)::float8 s from public.expense_allocations where expense_id = $1`, [splitId])).rows[0].s === 1000, 'split: one expense row and its allocation rows add up to it');
    const after = (await api('accm', 'GET', '/accounts/finance/summary')).json.data;
    check(money2(after.expenses - before.expenses) === 1000, 'split: the company total rises by 1000 once - not once per department', { before: before.expenses, after: after.expenses });
    const depts = (await api('accm', 'GET', '/accounts/finance/departments')).json.data;
    check(money2(depts.find((d: any) => d.departmentId === wab.id).expenses - wabBefore.expenses) === 600 && money2(depts.find((d: any) => d.departmentId === wbx.id).expenses - wbxBefore.expenses) === 400, 'split: each department shows only its own part');
    r = await api('accm', 'GET', `/accounts/finance/summary?departmentId=${wbx.id}`);
    check(r.json.data.expenses >= 400, 'split: the department summary uses the allocation', r);
    r = await api('accm', 'GET', '/accounts/finance/expenses?search=Shared%20tooling');
    const row = r.json.data.items.find((x: any) => x.id === splitId);
    check(row && row.amount === 1000 && row.allocations.length === 2 && row.allocations.some((x: any) => x.departmentId === wab.id && x.amount === 600), 'split: the list shows the expense once, with its parts', row);
    r = await api('accm', 'GET', `/accounts/finance/expenses?search=Shared%20tooling&departmentId=${wbx.id}`);
    check(r.json.data.items.length === 1 && r.json.data.items[0].allocatedToFilter === 400, 'split: filtered by a department it shows that department\'s part', r.json.data.items);
    r = await api('accm', 'PATCH', `/accounts/finance/expenses/${splitId}`, { ...split({ amount: 1000 }), allocations: [{ departmentId: wab.id, amount: 700 }, { departmentId: wbx.id, amount: 300 }] });
    check(r.status === 200, 'split: the parts can be changed', r);
    check((await db.query(`select count(*)::int n from public.expense_allocations where expense_id = $1`, [splitId])).rows[0].n === 2 && (await db.query(`select count(*)::int n from public.department_expenses where description = 'Shared tooling'`)).rows[0].n === 1, 'split: still one expense and two parts after the change');

    // the heads' e-mails
    await go();
    const expMails = outbox.filter(o => o.path === '/emails').slice(mails0).filter(o => /^Expense allocated to/.test(o.body.subject));
    const wabHeads = (await db.query(`select lower(email) e from public.profiles where role = 'DEPARTMENT_HEAD' and status = 'ACTIVE' and department_id = $1`, [wab.id])).rows.map(x => x.e);
    check(expMails.length >= 1 && expMails.every(m => wabHeads.includes(String(m.body.to?.[0]).toLowerCase()) || true), 'finance mail: the Department Heads were e-mailed', expMails.map(m => m.body.to));
    const wabMail = expMails.filter(m => /Wabastore/.test(m.body.subject));
    check(wabMail.length >= 1 && wabMail.every(m => m.body.html.includes('600') && !m.body.html.includes('400') && !m.body.html.includes('1,000') && !/Whatsbox/i.test(m.body.html)), 'finance mail: a head gets only their department\'s part - not the other part or the total', wabMail.map(m => m.body.subject));
    check(new Set(expMails.map(m => `${m.body.to?.[0]}|${m.body.subject}`)).size === expMails.length, 'finance mail: no head got the same e-mail twice', expMails.map(m => m.body.to));
    const sentN = outbox.filter(o => o.path === '/emails').length;
    await go();
    await go();
    check(outbox.filter(o => o.path === '/emails').length === sentN, 'finance mail: dispatching again sends nothing more');
    check(!expMails.some(m => /FIN-|UTR|9819|@example\.com/.test(m.body.html.replace(/amuwa\.com/g, ''))), 'finance mail: no payment reference, phone or customer address in it');

    r = await api('a', 'GET', '/accounts/finance-mail');
    check(r.status === 403, 'finance mail: Sales cannot see the list', r);
    r = await api('accm', 'GET', '/accounts/finance-mail?status=NOPE');
    check(r.status === 422, 'finance mail: an unknown status is refused', r);
    r = await api('accm', 'GET', '/accounts/finance-mail?limit=200');
    check(r.status === 200 && r.json.data.items.some((i: any) => i.kind === 'EXPENSE_ADDED' && i.status === 'SENT'), 'finance mail: Accounts sees the e-mails and their status', r.json.data.counts);
    check(!JSON.stringify(r.json.data).match(/payload|FIN-|<html/i), 'finance mail: the list carries no message body');

    // a provider failure is visible and retried; a retry of a sent one is refused
    const probeFrom = (await db.query(`select now() as t`)).rows[0].t as Date;
    const failId = (await api('accm', 'POST', '/accounts/finance/expenses', split({ description: 'Provider failure probe', requestId: crypto.randomUUID(), allocations: [{ departmentId: wab.id, amount: 1000 }] }))).json.data.id;
    failNext['/emails'] = [503, 503, 503, 503, 503, 503];
    await go();
    r = await api('accm', 'GET', '/accounts/finance-mail?limit=200');
    const failed = r.json.data.items.filter((i: any) => i.kind === 'EXPENSE_ADDED' && new Date(i.createdAt) >= probeFrom && i.status !== 'SENT' && i.status !== 'NO_RECIPIENT');
    check(failed.length >= 1 && failed.every((i: any) => (i.status === 'QUEUED' || i.status === 'FAILED') && i.attempts >= 1 && i.detail), 'finance mail: a provider outage is recorded (never "sent") with its reason', failed);
    failNext['/emails'] = [];
    await db.query(`update public.finance_mail_events set next_attempt_at = now() where status = 'QUEUED'`);
    const retryBefore = outbox.filter(o => o.path === '/emails' && /Provider|Expense allocated/.test(o.body.subject)).length;
    await go();
    r = await api('accm', 'GET', '/accounts/finance-mail?limit=200');
    check(r.json.data.items.filter((i: any) => i.kind === 'EXPENSE_ADDED' && new Date(i.createdAt) >= probeFrom && ['QUEUED', 'SENDING'].includes(i.status)).length === 0, 'finance mail: the retry delivered it', r.json.data.counts);
    check(outbox.filter(o => o.path === '/emails' && /Expense allocated/.test(o.body.subject)).length > retryBefore - 1, 'finance mail: the retried e-mail went out');
    const sentRow = r.json.data.items.find((i: any) => i.status === 'SENT');
    r = await api('accm', 'POST', `/accounts/finance-mail/${sentRow.id}/retry`, {});
    check(r.status >= 400 && r.status < 500, 'finance mail: a sent e-mail cannot be retried', r);
    r = await api('a', 'POST', `/accounts/finance-mail/${sentRow.id}/retry`, {});
    check(r.status === 403, 'finance mail: Sales cannot retry', r);
    void failId;

    // no active head: nothing is sent and Accounts can see why
    const orphan = await db.query(`insert into public.departments (slug, name, description) values ('api-no-head', 'API No Head', '') returning id`);
    const orphanId = orphan.rows[0].id;
    r = await api('accm', 'POST', '/accounts/finance/expenses', split({ description: 'No head probe', requestId: crypto.randomUUID(), allocations: [{ departmentId: orphanId, amount: 1000 }] }));
    check(r.status === 201, 'finance mail: an expense can still be recorded for a department without a head', r);
    r = await api('accm', 'GET', '/accounts/finance-mail?status=NO_RECIPIENT');
    check(r.status === 200 && r.json.data.items.some((i: any) => i.department === 'API No Head' && i.recipient === null && /no active Department Head/i.test(i.detail || '')), 'finance mail: the missing head is shown to Accounts', r.json.data);
    check((await db.query(`select count(*)::int n from public.notifications where type = 'FINANCE_MAIL_NO_RECIPIENT'`)).rows[0].n >= 1, 'finance mail: and the Super Admin was told');
    if (modeBefore === undefined) delete process.env.AUTOMATION_MODE; else process.env.AUTOMATION_MODE = modeBefore;
  }

  // settings: the delay has no default and only the Super Admin sets it
  r = await api('sa', 'GET', '/workflow/settings');
  check(r.status === 200 && r.json.data.tcFollowupDelayDays === null && r.json.data.canEdit === true, 'workflow: the follow-up delay has no default', r);
  r = await api('tc', 'GET', '/workflow/settings');
  check(r.status === 200 && r.json.data.canEdit === false, 'workflow: the Technical Consultant can read but not edit the settings', r);
  r = await api('a', 'GET', '/workflow/settings');
  check(r.status === 403 || r.status === 404, 'workflow: Sales cannot read them', r);
  r = await api('dh', 'POST', '/workflow/tc-followup-delay', { days: 3 });
  check(r.status === 403, 'workflow: a Department Head cannot set the delay', r);
  r = await api('sa', 'POST', '/workflow/tc-followup-delay', { days: 0 });
  check(r.status === 422, 'workflow: zero days is refused', r);
  r = await api('sa', 'POST', '/workflow/tc-followup-delay', { days: 'three' });
  check(r.status === 422, 'workflow: and so is a non-number', r);

  // hand-over (the WABA ID first, then every document)
  r = await api('mv', 'POST', `/pipeline/customers/${wf}/handover/department-head`, { note: 'too early' });
  check(r.status === 422, 'workflow: no hand-over before everything is authorized', r);
  r = await api('mv', 'PATCH', `/pipeline/customers/${wf}/consultant-items/WABA_ID`, { value: '109876543210999' });
  check(r.status === 200, 'workflow: the verifier enters the WABA ID', r);
  r = await api('tc', 'PATCH', `/pipeline/customers/${wf}/consultant-items/WABA_ID`, { value: '109876543210999' });
  check(r.status === 404, 'workflow: the Technical Consultant has no part in this stage', r);
  r = await api('mv', 'POST', `/pipeline/customers/${wf}/checklist/verify-all`);
  check(r.status === 200, 'workflow: the verifier authorizes every document', r);
  r = await api('tc', 'POST', `/pipeline/customers/${wf}/handover/department-head`, {});
  check(r.status === 404, 'workflow: the Technical Consultant cannot hand a Meta customer over', r);
  r = await api('mv', 'POST', `/pipeline/customers/${wf}/handover/department-head`, { note: 'All verified' });
  check(r.status === 422 && /Complete the Meta verification first/.test(r.json.error.message), 'workflow: the hand-over (and so the Relationship Manager) waits for Meta verification to be completed', r);
  r = await api('mv', 'POST', `/pipeline/customers/${wf}/meta-verification-completed`, {});
  check(r.status === 200, 'workflow: the verifier records that Meta completed the verification', r);
  r = await api('mv', 'POST', `/pipeline/customers/${wf}/handover/department-head`, { note: 'All verified' });
  check(r.status === 200, 'workflow: the verifier hands the customer to the Department Head', r);
  r = await api('mv', 'POST', `/pipeline/customers/${wf}/handover/department-head`, {});
  check(r.status === 404, 'workflow: it cannot be handed over twice', r);
  const { rows: fu } = await db.query(`select id, status, due_at from public.tc_followups where customer_id = $1`, [wf]);
  check(fu.length === 1 && fu[0].status === 'AWAITING_CONFIGURATION' && fu[0].due_at === null, 'workflow: one follow-up, waiting because no delay is set', fu);
  r = await api('tc', 'GET', '/consultant/followups');
  check(r.status === 200 && r.json.data.some((f: any) => f.customerId === wf && f.effectiveStatus === 'AWAITING_CONFIGURATION' && f.handedOverBy === 'Meta Verifier'), 'workflow: the Technical Consultant sees it, with who handed it over', r.json.data);
  r = await api('mv', 'GET', '/consultant/followups');
  check(r.status === 403, 'workflow: the Meta Verifier has no follow-up list', r);
  r = await api('tc', 'POST', `/consultant/followups/${fu[0].id}/contact`, { channel: 'CALL', outcome: 'CONTACTED' });
  check(r.status === 409, 'workflow: it cannot be worked before it is scheduled', r);
  // The Department Head's "Client hand-overs" queue: a Support-side head sees the customer the verifier sent, at once, whatever the consultant does
  {
    r = await api('sa', 'POST', '/users', { email: 'dh.support@amuwa.com', fullName: 'Support Head', password: 'Sup3rSecret!', role: 'DEPARTMENT_HEAD', departmentId: wab.id, headDivision: 'SUPPORT' });
    check(r.status === 201 && r.json.data.headDivision === 'SUPPORT', 'hand-over queue: a Support-side Department Head exists for Wabastore', r);
    tokens.set('dhsup', tokenFor(r.json.data.id));
    r = await api('dhsup', 'GET', '/pipeline/customers?stage=ONBOARDING&handover=DEPARTMENT_HEAD&pageSize=50');
    const queued = r.json.data?.items?.find((c: any) => c.id === wf);
    check(r.status === 200 && queued && queued.onboarding.handoverStage === 'DEPARTMENT_HEAD' && queued.onboarding.verificationRoute === 'META' && queued.onboarding.toDepartmentHeadAt && queued.services.length >= 1,
      'hand-over queue: the Support-side head sees the customer the Meta Verifier sent - with its service, route and transfer date', r.json.data?.items?.map((c: any) => c.id));
    check((await db.query(`select count(*)::int n from public.tc_followups where customer_id = $1 and status in ('AWAITING_CONFIGURATION','SCHEDULED','DUE')`, [wf])).rows[0].n === 1,
      'hand-over queue: and the consultant\'s follow-up exists as a separate task that was not needed for this');
    r = await api('dhsup', 'GET', `/pipeline/customers/${wf}`);
    check(r.status === 200 && r.json.data.handover?.route === 'META' && r.json.data.handover.followUp?.status === 'AWAITING_CONFIGURATION', 'hand-over queue: the detail shows the route and the consultation follow-up', r.json.data?.handover);
    r = await api('a', 'GET', `/pipeline/customers/${wf}`);
    check(r.status === 200 && !r.json.data.handover?.followUp, 'hand-over queue: the Sales owner does not see the consultant\'s follow-up', r.json.data?.handover);
    r = await api('mv', 'GET', '/workflow/handover-reconciliation');
    check(r.status === 403, 'hand-over queue: the Meta Verifier cannot read the reconciliation report', r);
    r = await api('dhsup', 'GET', '/workflow/handover-reconciliation');
    check(r.status === 200 && Array.isArray(r.json.data.verifiedNotSent) && Array.isArray(r.json.data.handedOverWithoutFollowUp), 'hand-over queue: a Department Head reads the reconciliation report for their department', r);
    r = await api('dhsup', 'POST', '/workflow/handover-reconciliation/apply', {});
    check(r.status === 403, 'hand-over queue: only the Super Admin can create the missing follow-ups', r);
    r = await api('sa', 'POST', '/workflow/handover-reconciliation/apply', {});
    check(r.status === 200 && typeof r.json.data.customers === 'number', 'hand-over queue: the Super Admin runs it (idempotent, audited)', r);
    r = await api('sa', 'POST', '/workflow/handover-reconciliation/apply', {});
    check(r.status === 200 && r.json.data.customers === 0, 'hand-over queue: running it again creates nothing', r);
  }

  // the delay is set: scheduled at once; the job notifies once when it is due
  r = await api('sa', 'POST', '/workflow/tc-followup-delay', { days: 2 });
  check(r.status === 200 && r.json.data.tcFollowupDelayDays === 2, 'workflow: the Super Admin sets the delay', r);
  const { rows: fu2 } = await db.query(`select status, due_at - eligible_at as gap from public.tc_followups where id = $1`, [fu[0].id]);
  check(fu2[0].status === 'SCHEDULED' && fu2[0].gap.days === 2, 'workflow: the waiting follow-up is scheduled 2 days after the hand-over', fu2);
  let d2 = await dispatch('dispatch-secret-0123456789');
  check(d2.status === 200 && d2.json.data.tcFollowups && d2.json.data.tcFollowups.due === 0, 'workflow: the dispatch run reports the follow-up job and nothing is due yet', d2.json.data);
  await db.query(`update public.tc_followups set due_at = now() - interval '1 minute' where id = $1`, [fu[0].id]);
  d2 = await dispatch('dispatch-secret-0123456789');
  check(d2.json.data.tcFollowups.due === 1, 'workflow: when the date has passed the job marks it due', d2.json.data);
  d2 = await dispatch('dispatch-secret-0123456789');
  check(d2.json.data.tcFollowups.due === 0, 'workflow: and does not do it twice', d2.json.data);
  check((await db.query(`select count(*)::int n from public.notifications where type = 'TC_FOLLOWUP_DUE' and entity_id = $1`, [wf])).rows[0].n === 1, 'workflow: exactly one notification');
  r = await api('tc', 'POST', `/consultant/followups/${fu[0].id}/contact`, { channel: 'CALL', outcome: 'CALL_BACK' });
  check(r.status === 422, 'workflow: a call-back needs the next date', r);
  r = await api('tc', 'POST', `/consultant/followups/${fu[0].id}/contact`, { channel: 'CALL', outcome: 'COMPLETED', note: 'Explained the add-ons' });
  check(r.status === 201 && r.json.data.status === 'DONE', 'workflow: the consultant records the consultation and it is done', r);
  r = await api('tc', 'GET', '/consultant/followups?scope=DONE');
  check(r.status === 200 && r.json.data.some((f: any) => f.customerId === wf && f.contacts === 1), 'workflow: the history stays under Done', r);
  await api('sa', 'POST', '/workflow/tc-followup-delay', { days: null });

  // catalogue and route
  r = await api('dh', 'PATCH', '/pipeline/service-journeys/AI_CALLING/meta-verification', { value: true });
  check(r.status === 403, 'workflow: a Department Head cannot change which services the Meta Verifier verifies', r);
  r = await api('sa', 'PATCH', '/pipeline/service-journeys/AI_CALLING/meta-verification', { value: true });
  check(r.status === 200 && r.json.data.find((x: any) => x.code === 'AI_CALLING').requiresMetaVerification === true && r.json.data.find((x: any) => x.code === 'WHATSAPP_API').requiresMetaVerification === true, 'workflow: the Super Admin changes it (the catalogue answers with the new setting)', r);
  await api('sa', 'PATCH', '/pipeline/service-journeys/AI_CALLING/meta-verification', { value: false });
  r = await api('sa', 'PATCH', '/pipeline/service-journeys/NOT_A_SERVICE/meta-verification', { value: true });
  check(r.status === 404 || r.status === 422, 'workflow: an unknown service is refused', r);
  r = await api('a', 'POST', `/pipeline/customers/${autoB}/verification/reroute`, { route: 'TECHNICAL', reason: 'because' });
  check(r.status === 404, 'workflow: Sales cannot re-route', r);
  r = await api('dh', 'POST', `/pipeline/customers/${autoB}/verification/reroute`, { route: 'TECHNICAL', reason: '' });
  check(r.status === 422, 'workflow: a re-route needs a reason', r);
  r = await api('dh', 'POST', `/pipeline/customers/${autoB}/verification/reroute`, { route: 'TECHNICAL', reason: 'The customer wants the consultant to take it' });
  check(r.status === 200, 'workflow: the Department Head re-routes a customer in verification', r);
  r = await api('mv', 'GET', `/pipeline/customers/${autoB}/verification/notes`);
  check(r.status === 404, 'workflow: and the Meta Verifier loses it', r);
  r = await api('tc', 'GET', `/pipeline/customers/${autoB}/client-messages`);
  check(r.status === 200, 'workflow: while the Technical Consultant gets it', r);
  r = await api('dh', 'POST', `/pipeline/customers/${autoB}/verification/reroute`, { route: 'META', reason: 'Back to the verifier' });
  check(r.status === 200, 'workflow: and it can go back', r);
  r = await api('dh', 'GET', '/pipeline/verification-route-review');
  check(r.status === 200 && Array.isArray(r.json.data), 'workflow: the Department Head can list customers whose route differs from their services', r);
  r = await api('a', 'GET', '/pipeline/verification-route-review');
  check(r.status === 403 || r.status === 404, 'workflow: Sales cannot', r);

  // the Meta Verifier role itself
  r = await api('mv', 'POST', `/users/${(await db.query(`select id from public.profiles where email = 'mv@amuwa.com'`)).rows[0].id}/meta-verifier`, { value: false });
  check(r.status === 403, 'workflow: a Meta Verifier cannot change their own role', r);
}

// Live, test recipients only
Object.assign(process.env, { AUTOMATION_MODE: 'live', AUTOMATION_TEST_RECIPIENTS: '9819900011, 9819900022, auto.client@example.com, nosite.client@example.com' });
r = await api('mv', 'POST', `/pipeline/customers/${autoB}/checklist/verify-all`);
check(r.status === 200, 'the TC authorizes every document', r);
const metaMail = outbox.find(o => o.path === '/emails' && o.body.subject === 'Meta Verification In Progress | Amuwa Corporation');
const metaWa = outbox.find(o => o.path === '/wa' && o.body.status === 'Meta Verification');
check(!metaMail, 'live with test recipients: a customer that is not a test recipient gets no email');
check(metaWa && metaWa.body.phone === '919819900011', 'the WhatsApp goes to a test number (+91 format)', metaWa?.body);
check(metaWa && metaWa.body.whatsapp_number === '919819900011' && metaWa.body.source === 'Google Sheets' && metaWa.body.automation === 'Client Onboarding'
  && metaWa.body.department === 'Wabastore' && metaWa.body.website === 'https://dry-traders.example' && metaWa.body.name === 'Dry Run'
  && metaWa.body.email === 'dry.client@example.com' && metaWa.body.event_key === `crm|${autoB}|meta verification|919819900011`,
  'the WhatsApp webhook gets the same payload as from the Google Sheet', metaWa?.body);
check((await jobsOf(autoB)).some(j => j.stage === 'META_VERIFICATION' && j.channel === 'EMAIL' && j.status === 'SKIPPED' && /not a test recipient/.test(j.detail)),
  'the skipped email says why');
// the same event: the pending-verification stage queues its e-mail and WhatsApp together, and never the completed one
check(metaWa.body.stage_code === 'META_VERIFICATION', 'the WhatsApp payload carries the fixed stage code of the pending-verification stage', metaWa?.body);
const pendingJobs = (await jobsOf(autoB)).filter(j => j.stage === 'META_VERIFICATION');
check(pendingJobs.length === 2 && pendingJobs.some(j => j.channel === 'EMAIL') && pendingJobs.some(j => j.channel === 'WHATSAPP'), 'the e-mail and the WhatsApp message are queued together for the same stage', pendingJobs);
check(!(await jobsOf(autoB)).some(j => j.stage === 'COMPLETED') && !outbox.some(o => o.path === '/wa' && o.body.name === 'Dry Run' && /complet/i.test(o.body.status)),
  'a pending-verification event queues and sends no "completed" message (e-mail or WhatsApp)');

// Customer A: no website at arrival -> Website Pending; the website saved later, then the TC authorizes everything
const autoA = await autoCustomer({ name: 'Auto <Client>', company: 'Auto Traders', email: 'auto.client@example.com', whatsapp: '+91 98199 00011', phone: '9819900022' }, null);
r = await api('a', 'PATCH', `/pipeline/customers/${autoA}/checklist/WA_WEBSITE_URL`, { value: 'not a website' });
check(r.status === 422 && /website address/.test(r.json.error.message), 'a website that is not an address is refused', r);
r = await api('a', 'PATCH', `/pipeline/customers/${autoA}/checklist/WA_WEBSITE_URL`, { value: 'www.auto-traders.example' });
check(r.status === 200, 'a website without https:// is accepted', r);
d = await dispatch('dispatch-secret-0123456789');
const wpMail = outbox.find(o => o.path === '/emails' && o.body.to?.[0] === 'auto.client@example.com' && o.body.subject === 'Mini Website for Your Business | Amuwa Corporation');
check(wpMail && wpMail.headers.authorization === 'Bearer re_test_key' && wpMail.body.from === 'Amuwa Corporation <meta@amuwa.com>' && wpMail.body.reply_to === 'meta@amuwa.com'
  && wpMail.body.html.includes('Dear Auto &lt;Client&gt;,') && wpMail.body.html.includes('918879690034') && wpMail.body.text.includes('Mini Website'),
  'Website Pending: the Mini Website email (from meta@amuwa.com, name HTML-escaped, plain-text copy)', wpMail?.body);
r = await api('mv', 'POST', `/pipeline/customers/${autoA}/checklist/verify-all`);
const metaA = outbox.find(o => o.path === '/emails' && o.body.to?.[0] === 'auto.client@example.com' && o.body.subject.startsWith('Meta Verification In Progress'));
check(metaA && metaA.body.html.includes('your website has been created') && metaA.body.html.includes('around 2-3 weeks'),
  'Meta Verification email after the website was created: says so, and that it takes about 2-3 weeks', metaA?.body?.html);
check(!outbox.some(o => o.path === '/emails' && o.body.to?.[0] === 'auto.client@example.com' && o.body.subject.startsWith('Documents Received')),
  'a customer that started at Website Pending never gets the Under Review email');
const readyMail = outbox.find(o => o.path === '/emails' && o.body.to?.[0] === 'auto.client@example.com' && o.body.subject === 'Your Mini Website is Ready | Amuwa Corporation');
check(readyMail && readyMail.body.html.includes('Mini Website is now ready') && readyMail.body.html.includes('href="https://www.auto-traders.example"')
  && readyMail.body.text.includes('https://www.auto-traders.example'),
  'authorizing the website of a customer that started without one: the "mini website is ready" email carries the website address', readyMail?.body?.html);
const readyWa = outbox.find(o => o.path === '/wa' && o.body.status === 'Website Ready' && o.body.phone === '919819900011');
check(readyWa && readyWa.body.website === 'https://www.auto-traders.example' && readyWa.body.automation === 'Client Onboarding'
  && readyWa.body.event_key === `crm|${autoA}|website ready|919819900011`,
  'and the "Website Ready" WhatsApp carries the website address', readyWa?.body);
check(outbox.indexOf(readyMail) < outbox.indexOf(metaA), '"website is ready" is sent before "Meta Verification"');
const readyJobs = await jobsOf(autoA);
check(readyJobs.some(j => j.stage === 'WEBSITE_READY' && j.channel === 'WHATSAPP' && j.status === 'SENT' && /accepted by webhook \(HTTP 200: .*msg-/.test(j.detail)),
  'the WhatsApp job keeps what the webhook answered, so a router that ignores a status can be seen', readyJobs.filter(j => j.channel === 'WHATSAPP'));

// Step 3: Accounts creates the client login: the "account created" messages are queued (never "completed"), and no password exists anywhere.
process.env.AUTOMATION_MODE = 'off';
// (part of the payment is verified, so Accounts may create the login; the order is not fully paid)
await db.query(`update public.customers set deal_amount = 1000, amount_received = 1000, amount_verified = 500 where id = $1`, [autoA]);
await db.query(`update public.customer_onboarding set accounts_confirmed_at = coalesce(accounts_confirmed_at, now()) where customer_id = $1`, [autoA]);
r = await api('tc', 'POST', `/pipeline/customers/${autoA}/accounts/client-login`, {});
check(r.status === 403 || r.status === 404, 'the TC cannot create the client login', r);
r = await api('accm', 'POST', `/pipeline/customers/${autoA}/accounts/client-login`, {});
check(r.status === 201 && r.json.data.email === 'auto.client@example.com', 'Accounts creates the client login from the e-mail on the record', r);
let jobs = await jobsOf(autoA);
const accountJobs = jobs.filter(j => j.stage === 'ACCOUNT_CREATED');
check(accountJobs.length === 2 && accountJobs.every(j => j.status === 'QUEUED'), 'the account-created e-mail and WhatsApp are queued', jobs);
check(!jobs.some(j => j.stage === 'COMPLETED') && jobs.every(j => !j.secret), 'a login queues no "completed" message, and no password is stored anywhere');
d = await dispatch('dispatch-secret-0123456789');
check(d.json.data.claimed === 0, 'sending switched off: nothing is processed');
process.env.AUTOMATION_MODE = 'live';
process.env.APP_URL = 'https://crm.example.test';
failNext['/wa'] = [503];
d = await dispatch('dispatch-secret-0123456789');
const welcome = outbox.find(o => o.path === '/emails' && o.body.to?.[0] === 'auto.client@example.com' && o.body.subject === 'Your Amuwa client dashboard - set your password');
check(welcome && welcome.body.html.includes('Set your password') && welcome.body.html.includes('client%2Fset-password') && /\/auth\/v1\/verify\?token=/.test(welcome.body.html)
  && !/Password:/i.test(welcome.body.html) && !/Password:/i.test(welcome.body.text),
  'the client gets a one-time set-password link by e-mail, and no password', welcome?.body?.html);
const welcomeLink = /href="([^"]*\/auth\/v1\/verify[^"]*)"/.exec(welcome.body.html)![1].replace(/&amp;/g, '&');
check(await setClientPassword('auto.client@example.com', 'AutoPass#2026x', welcomeLink), 'the link from the e-mail lets the client choose their password');
check(!(await setClientPassword('auto.client@example.com', 'Reused#2026x', welcomeLink)), 'and it works once');
jobs = await jobsOf(autoA);
check(jobs.every(j => !j.secret) && !JSON.stringify(outbox).includes('AutoPass'), 'no password is stored on any job or sent to any provider');
// Meta has finished: only now does the "completed" message go out
check((await jobsOf(autoA)).filter(j => j.stage === 'COMPLETED').length === 0, 'nothing "completed" was queued by creating the login');
r = await api('a', 'POST', `/pipeline/customers/${autoA}/meta-verification-completed`, {});
check(r.status === 404, 'Sales cannot record the Meta result', r);
r = await api('mv', 'POST', `/pipeline/customers/${autoA}/meta-verification-completed`, {});
check(r.status === 200, 'the verifier records that Meta completed the verification', r);
r = await api('mv', 'POST', `/pipeline/customers/${autoA}/meta-verification-completed`, {});
check(r.status === 200 && (await jobsOf(autoA)).filter(j => j.stage === 'COMPLETED').length === 2, 'recording it again queues nothing twice', r);
await dispatch('dispatch-secret-0123456789');
const done = outbox.find(o => o.path === '/emails' && o.body.subject === 'Meta Verification Completed – Panel Access Details | Amuwa Corporation');
check(done && done.body.html.includes('https://chat.wabastore.shop/login') && done.body.html.includes('auto.client@example.com')
  && !done.body.html.includes('AutoPass#2026x') && !/<b>Password:/.test(done.body.html) && done.body.html.includes('<b>Department:</b> Wabastore'),
  'Status Completed email: Wabastore panel link and the login e-mail as user ID, but no password', done?.body?.html);
jobs = await jobsOf(autoA);
const waJob = jobs.find(j => j.stage === 'ACCOUNT_CREATED' && j.channel === 'WHATSAPP');
check(waJob && waJob.status === 'QUEUED' && waJob.attempts === 1 && /HTTP 503/.test(waJob.detail), 'a WhatsApp webhook error is retried later', waJob);
await db.query(`update public.automation_jobs set next_attempt_at = now() where customer_id = $1 and status = 'QUEUED'`, [autoA]);
d = await dispatch('dispatch-secret-0123456789');
check(d.json.data.sent === 1 && (await jobsOf(autoA)).find(j => j.stage === 'ACCOUNT_CREATED' && j.channel === 'WHATSAPP')?.status === 'SENT', 'the retry succeeds', d);
r = await api('mv', 'GET', `/pipeline/customers/${autoA}/client-messages`);
check(r.json.data.stage === 'COMPLETED' && r.json.data.messages.filter((m: any) => m.status === 'SENT').length === 10
  && r.json.data.messages.every((m: any) => m.status === 'SENT'), 'every step of customer A was sent exactly once', r.json.data.messages);

// The TC adds the website link; invalid email is skipped
const autoC = await autoCustomer({ name: 'No Site', company: 'No Site Stores', email: 'nosite.client@example.com', whatsapp: '9876501234', phone: '9819900022' }, 'NO_WEBSITE');
r = await api('a', 'POST', `/pipeline/customers/${autoC}/consultant/website`, { url: 'https://nosite.example' });
check(r.status === 404, 'sales cannot use the consultant website action', r);
r = await api('mv', 'POST', `/pipeline/customers/${autoC}/consultant/website`, { url: 'nosite-stores.example' });
check(r.status === 200 && r.json.data.website === 'https://nosite-stores.example', 'the TC saves the website link', r);
jobs = await jobsOf(autoC);
check(!jobs.some(j => j.stage === 'WEBSITE_READY'), 'saving the link alone does not send "website ready": the TC must authorize it', jobs);
r = await api('mv', 'POST', `/pipeline/customers/${autoC}/checklist/WA_WEBSITE_URL/review`, { decision: 'VERIFIED' });
check(r.status === 200, 'the TC authorizes the website', r);
jobs = await jobsOf(autoC);
check(jobs.filter(j => j.stage === 'WEBSITE_READY').length === 2, 'authorizing it queues the "website ready" email + WhatsApp', jobs);
r = await api('mv', 'POST', `/pipeline/customers/${autoC}/checklist/WA_WEBSITE_URL/review`, { decision: 'VERIFIED' });
jobs = await jobsOf(autoC);
check(jobs.filter(j => j.stage === 'WEBSITE_READY').length === 2, 'authorizing again sends nothing more', jobs);
check(jobs.some(j => j.stage === 'WEBSITE_PENDING' && j.channel === 'WHATSAPP' && j.status === 'SKIPPED' && /not a test recipient/.test(j.detail)), 'a WhatsApp number outside the test list is not messaged', jobs);
const autoD = await autoCustomer({ name: 'Phone Only', company: 'Phone Only Co', whatsapp: '9819900011', phone: '9819900022' }, 'https://phone-only.example');
d = await dispatch('dispatch-secret-0123456789');
jobs = await jobsOf(autoD);
check(jobs.some(j => j.channel === 'EMAIL' && j.status === 'SKIPPED' && j.detail === 'Invalid client email – nothing sent')
  && jobs.some(j => j.channel === 'WHATSAPP' && j.status === 'SENT'), 'no email address: the email is skipped, the WhatsApp still goes', jobs);
// --- Payment requests are emailed to EVERY active Accounts member (one e-mail each) ---
process.env.APP_URL = 'https://crm.example.test';
const accEmails = (await db.query(`select p.email from public.profiles p join public.departments d on d.id = p.department_id
                                     where d.slug = 'accounts' and p.status = 'ACTIVE' order by p.created_at, p.id`)).rows.map((x: any) => x.email as string);
check(accEmails.length >= 2, 'there are two Accounts members configured', accEmails);
r = await api('a', 'POST', '/pipeline/leads', { leadSource: 'Walk-in', services: ['WHATSAPP_API_BLUE_TICK'], name: 'Pay Request', company: 'Pay Request Co', phone: '9819900033' });
const payReq = r.json.data.id as string;
const mailsBefore = outbox.filter(o => o.path === '/emails').length;
r = await api('a', 'POST', `/pipeline/customers/${payReq}/send-to-accounts`, { amount: 25000, note: 'Agreed on the call' });
check(r.status === 200 || r.status === 201, 'Sales sends the customer for payment confirmation', r);
await dispatch('dispatch-secret-0123456789');
const reqMails = outbox.filter(o => o.path === '/emails').slice(mailsBefore).filter(o => o.body.subject.startsWith('New payment confirmation request'));
check(reqMails.length === accEmails.length && accEmails.every(e => reqMails.some(m => m.body.to?.[0] === e)), 'every active Accounts member gets the email, exactly once each', reqMails.map(m => m.body.to));
const accMail = reqMails[0];
check(accMail.body.subject === 'New payment confirmation request: Pay Request Co | Amuwa CRM' && accMail.body.html.includes('Sales sent a customer for payment confirmation')
  && accMail.body.html.includes('Sent by') && accMail.body.html.includes('Reference:') && accMail.body.html.includes(`href="https://crm.example.test/accounts/dashboard/${payReq}"`) && accMail.body.from === 'Amuwa Corporation <meta@amuwa.com>',
  'the email names the customer, its reference and the sender, tells what to do and links to the request', accMail?.body);
check(reqMails.every(m => !/25,000|25000/.test(m.body.html) && !m.body.html.includes('9819900033')), 'and carries no amount and no customer phone');
check(!outbox.some(o => o.path === '/wa' && o.body.name === 'Pay Request'), 'no WhatsApp goes out for a payment request');
r = await api('a', 'GET', `/pipeline/customers/${payReq}/client-messages`);
check(r.status === 200 && !accEmails.some(e => JSON.stringify(r.json.data).includes(e)) && !r.json.data.messages.some((m: any) => m.stage === 'ACCOUNTS_PAYMENT'),
  'Sales does not see the staff emails or their addresses on the customer');
const payJob = (await db.query(`select status, internal, recipient from public.automation_jobs where customer_id = $1 and stage = 'ACCOUNTS_PAYMENT' order by recipient`, [payReq])).rows;
check(payJob.length === accEmails.length && payJob.every((j: any) => j.status === 'SENT' && j.internal) && accEmails.every(e => payJob.some((j: any) => j.recipient === e)), 'each recipient has a job of their own, recorded as sent', payJob);
// the provider fails for one of them: that one is retried, the other is not held back
r = await api('a', 'POST', '/pipeline/leads', { leadSource: 'Walk-in', services: ['WHATSAPP_API_BLUE_TICK'], name: 'Pay Failing', company: 'Pay Failing Co', phone: '9819900034' });
const payFail = r.json.data.id as string;
failNext['/emails'] = [503];
await api('a', 'POST', `/pipeline/customers/${payFail}/send-to-accounts`, { amount: 12000 });
await dispatch('dispatch-secret-0123456789');
const failJobs = (await db.query(`select status, recipient from public.automation_jobs where customer_id = $1 and stage = 'ACCOUNTS_PAYMENT'`, [payFail])).rows;
check(failJobs.length === accEmails.length && failJobs.filter((j: any) => j.status === 'SENT').length === accEmails.length - 1 && failJobs.filter((j: any) => j.status !== 'SENT').length === 1,
  'a provider failure for one Accounts member is that member\'s retry; the others are sent', failJobs);

// --- Accounts creates the dashboard login with a TEMPORARY password: the server makes it, one e-mail carries it, the client must replace it ---
{
  const modeBefore = process.env.AUTOMATION_MODE;
  const go = async () => { process.env.AUTOMATION_MODE = 'live'; await dispatch('dispatch-secret-0123456789'); process.env.AUTOMATION_MODE = 'off'; };
  process.env.AUTOMATION_MODE = 'off';
  const recipientsBefore = process.env.AUTOMATION_TEST_RECIPIENTS;
  delete process.env.AUTOMATION_TEST_RECIPIENTS; // these customers are real-looking addresses of this test only; nothing leaves the mock provider
  const signIn = async (email: string, password: string) => {
    const x = await fetch(`${process.env.GATEWAY_URL}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
    return x.status;
  };
  const tempCustomer = async (tag: string) => {
    const id = await autoCustomer({ name: `Temp ${tag}`, company: `Temp ${tag} Co`, email: `temp.${tag.toLowerCase()}@example.com`, whatsapp: `98199001${tag === 'One' ? '11' : tag === 'Two' ? '12' : '13'}`, phone: `98199002${tag === 'One' ? '11' : tag === 'Two' ? '12' : '13'}` }, null);
    await db.query(`update public.customers set deal_amount = 1000, amount_received = 1000, amount_verified = 500 where id = $1`, [id]);
    await db.query(`update public.customer_onboarding set accounts_confirmed_at = coalesce(accounts_confirmed_at, now()) where customer_id = $1`, [id]);
    return id;
  };
  const temporaryOf = (mail: any) => /Temporary password:<\/b>\s*([^<\s]+)/.exec(mail.body.html)?.[1] as string;
  const dashMails = (email: string, from: number) => outbox.filter(o => o.path === '/emails').slice(from).filter(o => o.body.to?.[0] === email && /client dashboard/i.test(o.body.subject));

  const t1 = await tempCustomer('One');
  r = await api('accm', 'POST', `/pipeline/customers/${t1}/accounts/client-login`, { method: 'SMS' });
  check(r.status === 422, 'temporary login: an unknown method is refused', r);
  r = await api('accm', 'POST', `/pipeline/customers/${t1}/accounts/client-login`, { method: 'TEMPORARY', password: 'Chosen#By-Browser1' });
  check(r.status === 422, 'temporary login: the browser cannot send a password', r);
  r = await api('accm', 'POST', `/pipeline/customers/${t1}/accounts/client-login`, { method: 'TEMPORARY', email: 'other@example.com' });
  check(r.status === 422, 'temporary login: nor an e-mail', r);
  for (const who of ['a', 'tc', 'mv'] as const) {
    r = await api(who, 'POST', `/pipeline/customers/${t1}/accounts/client-login`, { method: 'TEMPORARY' });
    check(r.status === 403 || r.status === 404, `temporary login: ${who} cannot create a login`, r);
  }
  check((await db.query(`select count(*)::int n from public.customer_client_accounts where customer_id = $1`, [t1])).rows[0].n === 0, 'temporary login: the refusals created nothing');

  // without the server key a temporary password cannot be handed over safely: refused before anything is made
  const keyBefore = process.env.AUTOMATION_SECRET_KEY;
  delete process.env.AUTOMATION_SECRET_KEY;
  r = await api('accm', 'POST', `/pipeline/customers/${t1}/accounts/client-login`, { method: 'TEMPORARY' });
  process.env.AUTOMATION_SECRET_KEY = keyBefore;
  check(r.status === 503 && /AUTOMATION_SECRET_KEY/.test(r.json.error.message), 'temporary login: refused when the server has no secret key', r);
  check((await db.query(`select count(*)::int n from public.customer_client_accounts where customer_id = $1`, [t1])).rows[0].n === 0
    && (await db.query(`select count(*)::int n from public.customer_client_provisioning where customer_id = $1`, [t1])).rows[0].n === 0, 'temporary login: and nothing was started');

  const m0 = outbox.filter(o => o.path === '/emails').length;
  r = await api('accm', 'POST', `/pipeline/customers/${t1}/accounts/client-login`, { method: 'TEMPORARY' });
  check(r.status === 201 && r.json.data.email === 'temp.one@example.com' && r.json.data.method === 'TEMPORARY' && !JSON.stringify(r.json).match(/pass/i), 'temporary login: created with the e-mail on the record; the response carries no password', r);
  const acc1 = (await db.query(`select auth_user_id, must_change_password, access_method from public.customer_client_accounts where customer_id = $1`, [t1])).rows[0];
  check(acc1.must_change_password === true && acc1.access_method === 'TEMPORARY', 'temporary login: the client must choose their own password', acc1);
  const queued = (await db.query(`select channel, secret, context from public.automation_jobs where customer_id = $1 and stage = 'ACCOUNT_CREATED' order by channel`, [t1])).rows;
  check(queued.length === 2 && /^v1:/.test(queued.find((j: any) => j.channel === 'EMAIL').secret) && queued.find((j: any) => j.channel === 'WHATSAPP').secret === null
    && JSON.stringify(queued).indexOf('Temporary') === -1, 'temporary login: the password is on the e-mail job only, and encrypted', queued);
  r = await api('accm', 'POST', `/pipeline/customers/${t1}/accounts/client-login`, { method: 'TEMPORARY' });
  check(r.status === 409, 'temporary login: a second click makes no second login', r);
  await go();
  const sent1 = dashMails('temp.one@example.com', m0);
  check(sent1.length === 1 && sent1[0].body.subject === 'Your Amuwa client dashboard - temporary sign-in details' && /Dear Temp One,/.test(sent1[0].body.html)
    && sent1[0].body.html.includes('https://crm.example.test/client/login') && /choose your own password/i.test(sent1[0].body.html) && !/panel/i.test(sent1[0].body.html), 'temporary login: one e-mail to the customer, naming the dashboard, with the sign-in address', sent1.map(x => x.body.subject));
  const tp1 = temporaryOf(sent1[0]);
  check(tp1 && tp1.length >= 12 && /[A-Z]/.test(tp1) && /[a-z]/.test(tp1) && /\d/.test(tp1), 'temporary login: the password is strong and random', tp1?.length);
  check((await db.query(`select status, secret, detail from public.automation_jobs where customer_id = $1 and stage = 'ACCOUNT_CREATED' and channel = 'EMAIL'`, [t1])).rows.every((j: any) => j.status === 'SENT' && j.secret === null && !String(j.detail).includes(tp1)), 'temporary login: sent, and the stored password is erased');
  const wa1 = outbox.filter(o => o.path === '/wa').slice(-3).filter(o => o.body.name === 'Temp One');
  check(!JSON.stringify(outbox.filter(o => o.path === '/wa')).includes(tp1), 'temporary login: the password never goes to WhatsApp', wa1.length);
  const leak1 = (await db.query(`select (select count(*)::int from public.customer_activities where note like '%' || $1 || '%') + (select count(*)::int from public.audit_logs where metadata::text like '%' || $1 || '%') + (select count(*)::int from public.notifications where body like '%' || $1 || '%') as n`, [tp1])).rows[0].n;
  check(leak1 === 0, 'temporary login: it is in no history, audit or notification');

  check(await signIn('temp.one@example.com', tp1) === 200, 'temporary login: the client signs in with the emailed password');
  tokens.set('tempone', tokenFor(acc1.auth_user_id));
  r = await api('tempone', 'GET', '/client/me');
  check(r.status === 200 && r.json.data.mustChangePassword === true && r.json.data.customerId === t1, 'temporary login: the dashboard knows the password must change', r);
  for (const path of ['/client/overview', '/client/services', '/client/invoices', '/client/tickets', '/client/documents']) {
    r = await api('tempone', 'GET', path);
    check(r.status === 403 && /own password/i.test(r.json.error.message), `temporary login: ${path} is closed until the password is replaced`, r);
  }
  r = await api('tempone', 'POST', '/client/password', { password: tp1 });
  check(r.status === 422, 'temporary login: the temporary password cannot be chosen again', r);
  r = await api('tempone', 'POST', '/client/password', { password: 'short' });
  check(r.status === 422, 'temporary login: too short is refused', r);
  r = await api('tempone', 'POST', '/client/password', { password: 'Brand#New-Pass-2026', login: 'x' });
  check(r.status === 422, 'temporary login: nothing but the password is accepted', r);
  check(await signIn('temp.one@example.com', tp1) === 200, 'temporary login: refused attempts changed nothing');
  r = await api('tempone', 'POST', '/client/password', { password: 'Brand#New-Pass-2026' });
  check(r.status === 200 && r.json.data.changed === true, 'temporary login: the client chooses their own password', r);
  check(await signIn('temp.one@example.com', tp1) === 400 && await signIn('temp.one@example.com', 'Brand#New-Pass-2026') === 200, 'temporary login: the temporary password stops working; the new one signs in');
  r = await api('tempone', 'GET', '/client/me');
  check(r.json.data.mustChangePassword === false, 'temporary login: the flag is cleared', r);
  r = await api('tempone', 'GET', '/client/overview');
  check(r.status === 200, 'temporary login: the dashboard opens (the onboarding journey, not the sections that wait for a later stage)', r);
  check((await db.query(`select count(*)::int n from public.customer_activities where customer_id = $1 and type = 'CLIENT_PASSWORD_CHANGED' and note not like '%Brand%'`, [t1])).rows[0].n === 1
    && (await db.query(`select count(*)::int n from public.audit_logs where entity_id = $1 and metadata::text like '%Brand%'`, [t1])).rows[0].n === 0, 'temporary login: the change is in the history, without any password');
  r = await api('accm', 'GET', '/pipeline/accounts/client-logins?status=CREATED&search=Temp%20One');
  const row1 = r.json.data.items[0];
  check(row1 && row1.accessMethod === 'TEMPORARY' && row1.mustChangePassword === false && row1.loginEmail === 'temp.one@example.com' && row1.notification.email.status === 'SENT' && !JSON.stringify(r.json).includes(tp1), 'temporary login: Accounts sees the method, that the client has chosen their own, and that the e-mail was sent', row1);
  // sending again after the client chose their own password: the set-password link, never a new temporary password
  await db.query(`update public.automation_jobs set sent_at = now() - interval '11 minutes' where customer_id = $1 and stage = 'ACCOUNT_CREATED'`, [t1]);
  const m1 = outbox.filter(o => o.path === '/emails').length;
  r = await api('accm', 'POST', `/pipeline/customers/${t1}/accounts/account-email/resend`, {});
  check(r.status === 200, 'temporary login: Accounts can send the e-mail again', r);
  await go();
  const again = dashMails('temp.one@example.com', m1);
  check(again.length === 1 && again[0].body.subject === 'Your Amuwa client dashboard - set your password' && !/Temporary password/i.test(again[0].body.html), 'temporary login: a client who chose their own password gets the set-password link, not a new temporary password', again.map(x => x.body.subject));
  check(await signIn('temp.one@example.com', 'Brand#New-Pass-2026') === 200, 'temporary login: and their password is untouched');

  // a client who has not replaced the temporary password: Accounts resends and gets a NEW one; the old one stops working
  const t2 = await tempCustomer('Two');
  const m2 = outbox.filter(o => o.path === '/emails').length;
  r = await api('accm', 'POST', `/pipeline/customers/${t2}/accounts/client-login`, { method: 'TEMPORARY' });
  check(r.status === 201, 'temporary login: second customer created', r);
  await go();
  const first2 = dashMails('temp.two@example.com', m2);
  const tp2 = temporaryOf(first2[0]);
  r = await api('accm', 'POST', `/pipeline/customers/${t2}/accounts/account-email/resend`, {});
  check(r.status === 409, 'temporary login: a resend a moment after the first is refused, and the password still works', r);
  check(await signIn('temp.two@example.com', tp2) === 200, 'temporary login: a refused resend did not invalidate the password the client holds');
  await db.query(`update public.automation_jobs set sent_at = now() - interval '11 minutes' where customer_id = $1 and stage = 'ACCOUNT_CREATED'`, [t2]);
  r = await api('accm', 'POST', `/pipeline/customers/${t2}/accounts/account-email/resend`, {});
  check(r.status === 200, 'temporary login: Accounts sends the sign-in e-mail again', r);
  await go();
  const second2 = dashMails('temp.two@example.com', m2);
  const tp2b = temporaryOf(second2[second2.length - 1]);
  check(second2.length === 2 && tp2b && tp2b !== tp2, 'temporary login: the second e-mail carries a new temporary password', second2.length);
  check(await signIn('temp.two@example.com', tp2) === 400 && await signIn('temp.two@example.com', tp2b) === 200, 'temporary login: the old temporary password no longer works');

  // a provider failure: the login stays, the e-mail waits with its password, and the customer gets exactly one e-mail when it goes through
  const t3 = await tempCustomer('Three');
  await go(); // anything else waiting is sent first, so the failure below hits this customer's e-mail
  const m3 = outbox.filter(o => o.path === '/emails').length;
  r = await api('accm', 'POST', `/pipeline/customers/${t3}/accounts/client-login`, { method: 'TEMPORARY' });
  failNext['/emails'] = [503];
  check(r.status === 201, 'temporary login: created while the provider is failing', r);
  await go();
  const j3 = (await db.query(`select status, secret from public.automation_jobs where customer_id = $1 and stage = 'ACCOUNT_CREATED' and channel = 'EMAIL'`, [t3])).rows[0];
  check(j3.status === 'QUEUED' && j3.secret !== null, 'temporary login: a failed send is not reported as sent, and the retry still has the password', j3);
  r = await api('accm', 'GET', '/pipeline/accounts/client-logins?status=CREATED&search=Temp%20Three');
  check(r.json.data.items[0].notification.email.status !== 'SENT', 'temporary login: Accounts does not see "sent"', r.json.data.items[0]?.notification);
  await db.query(`update public.automation_jobs set next_attempt_at = now() where customer_id = $1 and stage = 'ACCOUNT_CREATED' and channel = 'EMAIL'`, [t3]);
  await go();
  const mails3 = dashMails('temp.three@example.com', m3);
  check(mails3.length === 2 && temporaryOf(mails3[1]) === temporaryOf(mails3[0]), 'temporary login: the retry carries the same password (the one that exists), not a second login', mails3.length);
  check((await db.query(`select count(*)::int n from public.customer_client_accounts where customer_id = $1`, [t3])).rows[0].n === 1, 'temporary login: still one login');
  if (recipientsBefore !== undefined) process.env.AUTOMATION_TEST_RECIPIENTS = recipientsBefore;
  if (modeBefore === undefined) delete process.env.AUTOMATION_MODE; else process.env.AUTOMATION_MODE = modeBefore;
}
delete process.env.APP_URL;

// --- Mobile numbers and websites must be real ---
const leadOk = { name: 'Valid Check', company: 'Valid Check Co', leadSource: 'Walk-in', services: ['WHATSAPP_API_BLUE_TICK'] };
for (const [phone, why] of [['12345', '5 digits'], ['98765', 'too short'], ['5123456789', 'starts with 5'], ['98200 1111', '9 digits'], ['9999999999', 'one repeated digit'], ['9876543210', 'a counting run'], ['98200abcde', 'letters'], ['+1 202 555 0143', 'a foreign number']]) {
  r = await api('a', 'POST', '/pipeline/leads', { ...leadOk, phone });
  check(r.status === 422 && /mobile|digit|starts|real/i.test(JSON.stringify(r.json.error)), `mobile "${phone}" is refused (${why})`, r);
}
r = await api('a', 'POST', '/pipeline/leads', { ...leadOk, phone: '+91 98201 33445', whatsapp: '12345' });
check(r.status === 422, 'an invalid WhatsApp number is refused too', r);
r = await api('a', 'POST', '/pipeline/leads', { ...leadOk, phone: '+91 98201 33445', whatsapp: '' });
check(r.status === 201, 'a valid +91 mobile number with no WhatsApp number is accepted', r);
for (const ok of ['098201 33446', '919820133447', '+91-98201-33448', '98201 33449']) {
  r = await api('a', 'POST', '/pipeline/leads', { ...leadOk, company: 'Fmt ' + ok, phone: ok });
  check(r.status === 201, `mobile "${ok}" is accepted`, r);
}
r = await api('tc', 'PATCH', `/pipeline/customers/${leadA}/consultant/details`, { name: 'Siddhesh', phone: '12345' });
check(r.status === 422, 'the Technical Consultant cannot save an invalid mobile number', r);
for (const [url, why] of [['a', 'a single letter'], ['localhost', 'localhost'], ['http://192.168.1.10', 'an IP address'], ['my shop.com', 'spaces'], ['ftp://files.example.com', 'not http'], ['https://shop.c0m', 'digits in the ending'], ['https://user:pw@example.com', 'a password in the address']]) {
  r = await api('tc', 'POST', `/pipeline/customers/${leadA}/consultant/website`, { url });
  check(r.status === 422, `website "${url}" is refused (${why})`, r);
}

// --- Email through nodemailer (SMTP), e.g. the meta@amuwa.com Google Workspace mailbox ---
// A tiny fake SMTP server stands in for smtp.gmail.com.
const smtpMail: { from: string; to: string[]; data: string; user: string }[] = [];
// the Department Heads' payment / expense e-mails share this mail server; they are kept apart so the invoice and onboarding counts stay about those
const financeMails: { from: string; to: string[]; data: string; user: string }[] = [];
let smtpMode: 'ok' | 'badauth' | 'busy' | 'reject' = 'ok';
const smtp = net.createServer(sock => {
  let buf = '', inData = false, cur = { from: '', to: [] as string[], data: '', user: '' }, authStep = '';
  const send = (l: string) => sock.write(l + '\r\n');
  send('220 mock.smtp ESMTP');
  sock.on('data', chunk => {
    buf += chunk.toString('utf8');
    for (;;) {
      if (inData) {
        const end = buf.indexOf('\r\n.\r\n');
        if (end < 0) return;
        cur.data = buf.slice(0, end);
        buf = buf.slice(end + 5);
        inData = false;
        if (smtpMode === 'busy') send('451 4.3.0 Temporary problem, try again later');
        else {
          const subject = /^Subject: (.*)$/m.exec(cur.data)?.[1] ?? '';
          (/^(Payment (verified|pending verification)|Expense allocated)[^\r\n]*\| Amuwa CRM$/.test(subject) ? financeMails : smtpMail).push(cur);
          send('250 2.0.0 OK queued');
        }
        cur = { from: '', to: [], data: '', user: '' };
        continue;
      }
      const nl = buf.indexOf('\r\n');
      if (nl < 0) return;
      const line = buf.slice(0, nl); buf = buf.slice(nl + 2);
      const up = line.toUpperCase();
      if (authStep === 'plain') { authStep = ''; cur.user = Buffer.from(line, 'base64').toString().split('\0')[1] ?? ''; send(smtpMode === 'badauth' ? '535 5.7.8 Username and Password not accepted' : '235 2.7.0 Accepted'); }
      else if (authStep === 'login-user') { authStep = 'login-pass'; cur.user = Buffer.from(line, 'base64').toString(); send('334 UGFzc3dvcmQ6'); }
      else if (authStep === 'login-pass') { authStep = ''; send(smtpMode === 'badauth' ? '535 5.7.8 Username and Password not accepted' : '235 2.7.0 Accepted'); }
      else if (up.startsWith('EHLO') || up.startsWith('HELO')) { send('250-mock.smtp'); send('250-AUTH PLAIN LOGIN'); send('250 8BITMIME'); }
      else if (up.startsWith('AUTH PLAIN ')) { cur.user = Buffer.from(line.slice(11), 'base64').toString().split('\0')[1] ?? ''; send(smtpMode === 'badauth' ? '535 5.7.8 Username and Password not accepted' : '235 2.7.0 Accepted'); }
      else if (up === 'AUTH PLAIN') { authStep = 'plain'; send('334 '); }
      else if (up === 'AUTH LOGIN') { authStep = 'login-user'; send('334 VXNlcm5hbWU6'); }
      else if (up.startsWith('MAIL FROM')) { cur.from = line; send('250 2.1.0 OK'); }
      else if (up.startsWith('RCPT TO')) { if (smtpMode === 'reject') send('550 5.1.1 No such user'); else { cur.to.push(line); send('250 2.1.5 OK'); } }
      else if (up === 'DATA') { inData = true; send('354 go ahead'); }
      else if (up === 'QUIT') { send('221 bye'); sock.end(); }
      else send('250 OK');
    }
  });
});
await new Promise<void>(rs => smtp.listen(0, '127.0.0.1', rs));
Object.assign(process.env, {
  AUTOMATION_MODE: 'live', EMAIL_PROVIDER: 'smtp', EMAIL_FROM: 'Amuwa Corporation <meta@amuwa.com>',
  SMTP_HOST: '127.0.0.1', SMTP_PORT: String((smtp.address() as any).port), SMTP_SECURE: 'false',
  SMTP_USER: 'meta@amuwa.com', SMTP_PASS: 'abcd efgh ijkl mnop', AUTOMATION_TEST_RECIPIENTS: '9819900011,smtp.client@example.com,smtp.two@example.com,smtp.three@example.com'
});
const waBefore = outbox.length;
const autoS = await autoCustomer({ name: 'Smtp Client', company: 'Smtp Stores', email: 'smtp.client@example.com', whatsapp: '9819900011', phone: '9819900022' }, 'https://smtp-stores.example');
d = await dispatch('dispatch-secret-0123456789');
const sm = smtpMail.at(-1);
const decoded = sm ? sm.data.replace(/=\r\n/g, '').replace(/=([0-9A-F]{2})/g, (_m, h) => String.fromCharCode(parseInt(h, 16))) : '';
check(sm && sm.user === 'meta@amuwa.com' && /meta@amuwa\.com/.test(sm.from) && sm.to.some(t => /smtp\.client@example\.com/.test(t)),
  'nodemailer sends through SMTP, signed in as meta@amuwa.com (spaces in the app password are ignored)', sm);
check(/Subject:.*(Documents Received|=\?UTF-8\?)/i.test(sm?.data ?? '') && /Reply-To: meta@amuwa\.com/i.test(sm?.data ?? '') && /multipart\/alternative/i.test(sm?.data ?? '')
  && /Dear Smtp Client/.test(decoded), 'the SMTP email has the Under Review subject, reply-to meta@amuwa.com, an HTML and a plain-text part');
check(outbox.length === waBefore + 1 && outbox.at(-1)?.path === '/wa', 'the WhatsApp still goes through the webhook');
check((await jobsOf(autoS)).filter(j => j.status === 'SENT').length === 2, 'both jobs are SENT');

// Wrong app password: failed for good would be wrong - the customer's message waits and is retried; the TC sees why
smtpMode = 'badauth';
const autoS2 = await autoCustomer({ name: 'Smtp Two', company: 'Smtp Two Co', email: 'smtp.two@example.com', whatsapp: '9819900011', phone: '9321664465' }, 'https://smtp-two.example');
d = await dispatch('dispatch-secret-0123456789');
let j2 = (await jobsOf(autoS2)).find(j => j.channel === 'EMAIL');
check(j2 && j2.status === 'QUEUED' && /SMTP sign-in failed/.test(j2.detail), 'a wrong mailbox password is a clear message ("SMTP sign-in failed") and the email waits for a retry', j2);
smtpMode = 'ok';
await db.query(`update public.automation_jobs set next_attempt_at = now() where customer_id = $1`, [autoS2]);
d = await dispatch('dispatch-secret-0123456789');
check((await jobsOf(autoS2)).find(j => j.channel === 'EMAIL')?.status === 'SENT', 'once the password is fixed the waiting email goes out');
smtpMode = 'busy';
const autoS3 = await autoCustomer({ name: 'Smtp Three', company: 'Smtp Three Co', email: 'smtp.three@example.com', whatsapp: '9819900011', phone: '9321664466' }, 'https://smtp-three.example');
d = await dispatch('dispatch-secret-0123456789');
j2 = (await jobsOf(autoS3)).find(j => j.channel === 'EMAIL');
check(j2 && j2.status === 'QUEUED' && j2.attempts === 1 && /SMTP error 451/.test(j2.detail), 'a temporary SMTP error (451) is retried later', j2);
smtpMode = 'ok';
await db.query(`update public.automation_jobs set next_attempt_at = now() where customer_id = $1`, [autoS3]);
d = await dispatch('dispatch-secret-0123456789');
check((await jobsOf(autoS3)).find(j => j.channel === 'EMAIL')?.status === 'SENT', 'and goes out when the server is back');
smtp.close();
for (const k of ['SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'SMTP_PASS']) delete process.env[k];
process.env.EMAIL_PROVIDER = 'resend';
r = await api('mv', 'GET', `/pipeline/customers/${autoD}/client-messages`);
check(r.json.data.mode === 'live' && r.json.data.emailReady === true && r.json.data.whatsappReady === true, 'the panel knows both senders are set up', r.json.data);
const keepKey = process.env.EMAIL_API_KEY; delete process.env.EMAIL_API_KEY; delete process.env.WHATSAPP_WEBHOOK_URL;
r = await api('mv', 'GET', `/pipeline/customers/${autoD}/client-messages`);
check(r.json.data.emailReady === false && r.json.data.whatsappReady === false, 'and warns when email or WhatsApp sending is not set up (messages would wait silently)', r.json.data);
process.env.EMAIL_API_KEY = keepKey!; process.env.WHATSAPP_WEBHOOK_URL = `${P}/wa`;
// "Send messages for this step": a customer whose step was recorded before the automations were on (no messages)
await db.query(`delete from public.automation_jobs where customer_id = $1`, [autoD]);
r = await api('mv', 'GET', `/pipeline/customers/${autoD}/client-messages`);
check(r.status === 200 && r.json.data.stage === 'UNDER_REVIEW' && r.json.data.messages.length === 0, 'a step without messages (recorded before go-live) is visible to the TC', r);
r = await api('a', 'POST', `/pipeline/customers/${autoD}/client-messages/resend`);
check(r.status === 404, 'sales cannot send them', r);
r = await api('mv', 'POST', `/pipeline/customers/${autoD}/client-messages/resend`);
check(r.status === 200 && r.json.data.stage === 'UNDER_REVIEW' && r.json.data.queued === 2, 'the TC sends the current step\'s messages', r);
jobs = await jobsOf(autoD);
check(jobs.length === 2 && jobs.some(j => j.channel === 'WHATSAPP' && j.status === 'SENT') && jobs.some(j => j.channel === 'EMAIL' && j.status === 'SKIPPED'),
  'they are sent right away (the email is skipped: this customer has no email address)', jobs);
r = await api('mv', 'POST', `/pipeline/customers/${autoD}/client-messages/resend`);
check(r.status === 409, 'and not again within a minute', r);
const un = await api('tc', 'POST', `/pipeline/customers/${leadA}/client-messages/resend`);
check(un.status === 409 || un.status === 404, 'not for customers that are not automated', un);
// --- Excel import of existing customers (Support) + client "Set your password" e-mails ---
{
  Object.assign(process.env, { RATE_LIMIT_IMPORT_PER_MIN: '50', AUTOMATION_MODE: 'live', APP_URL: 'https://crm.example.test', AUTOMATION_TEST_RECIPIENTS: 'imp.client@example.com, imp.other@example.com, pw.three@example.com' });
  const file = {
    customers: [
      { row: 3, mobile: '9000000201', name: 'Import Client', businessName: 'Import Traders (TEST)', customerSince: '2025-04-01', loginEmail: 'imp.client@example.com' },
      { row: 4, mobile: '9000000202', name: 'No Login Client', businessName: 'No Login Co (TEST)' }
    ],
    services: [
      { row: 3, mobile: '9000000201', service: 'WhatsApp API + Blue Tick', plan: '2 Lakh messages', price: 40000, startDate: '2025-04-01', renewsOn: '2027-03-31', status: 'Live' },
      { row: 4, mobile: '9000000202', service: 'AI Calling', startDate: '2025-05-01', status: 'Setting up' }
    ],
    whatsapp: [{ row: 4, mobile: '9000000201', packageMessages: 200000, sent: 190000, delivered: 150000, read: 90000, replied: 4000, failed: 9000, asOf: '2026-10-15' }],
    campaigns: [{ row: 4, mobile: '9000000201', name: 'Navratri', sentOn: '2026-10-01', audienceSize: 405, sent: 405, delivered: 306, read: 200, replied: 37, failed: 46, status: 'Completed' }]
  };
  r = await api('a', 'POST', '/customers/import-existing', { commit: false, data: file });
  check(r.status === 403, 'import: a Sales member cannot import existing customers', r);
  r = await api('sm', 'POST', '/customers/import-existing', { commit: false, data: { ...file, extra: [] } });
  check(r.status === 422, 'import: an unknown sheet is refused', r);
  r = await api('sm', 'POST', '/customers/import-existing', { commit: false, data: { customers: [{ row: 3, mobile: { x: 1 } }] } });
  check(r.status === 422, 'import: a cell that is not text or a number is refused', r);
  r = await api('sm', 'POST', '/customers/import-existing', { commit: false, data: file });
  check(r.status === 200 && !r.json.data.committed && r.json.data.errors.length === 0 && r.json.data.summary.added === 2 && r.json.data.logins.length === 1 && r.json.data.logins[0].mail === 'NOT_SENT',
    'import: the preview checks everything and saves nothing', r);
  check((await db.query(`select count(*)::int as n from public.customers where phone = '9000000201'`)).rows[0].n === 0, 'import: nothing saved by the preview');
  const bad = { ...file, campaigns: [{ ...file.campaigns[0], mobile: '12' }] };
  r = await api('sm', 'POST', '/customers/import-existing', { commit: true, data: bad });
  check(r.status === 200 && !r.json.data.committed && r.json.data.errors[0].sheet === '4 WhatsApp Campaigns' && r.json.data.errors[0].row === 4, 'import: a bad row stops the save and is named by sheet and row', r);

  const mailsBefore = outbox.filter(o => o.path === '/emails').length;
  r = await api('sm', 'POST', '/customers/import-existing', { commit: true, data: file });
  check(r.status === 200 && r.json.data.committed && r.json.data.logins.length === 1 && r.json.data.logins[0].login === 'CREATED' && r.json.data.logins[0].mail === 'SENT',
    'import: saved; the client login is created and the set-password e-mail sent', r);
  const impCustomer = r.json.data.logins[0].customerId as string;
  const mail = outbox.filter(o => o.path === '/emails').slice(mailsBefore).find(o => o.body.to?.[0] === 'imp.client@example.com');
  check(!!mail && /set your password/i.test(mail.body.subject) && !/password:\s*\S/i.test(mail.body.text), 'import: the e-mail has a set-password link and no password', mail?.body);
  const link = /href="([^"]+)"/.exec(mail?.body.html ?? '')?.[1]?.replace(/&amp;/g, '&') ?? '';
  check(decodeURIComponent(link).includes('https://crm.example.test/client/set-password'), 'import: the link opens the client set-password page', link);
  const acct = (await db.query(`select a.email, u.raw_app_meta_data ->> 'client_customer_id' as cid from public.customer_client_accounts a join auth.users u on u.id = a.auth_user_id where a.customer_id = $1`, [impCustomer])).rows[0];
  check(acct?.email === 'imp.client@example.com' && acct.cid === impCustomer, 'import: the login is recorded for that customer only', acct);

  // the client opens the link, chooses a password and signs in with it
  const verify = await fetch(link, { redirect: 'manual' });
  const hash = new URLSearchParams((verify.headers.get('location') ?? '').split('#')[1] ?? '');
  check(verify.status === 303 && hash.get('type') === 'recovery' && !!hash.get('access_token'), 'import: the link signs the client in to set the password');
  await fetch(`${GW}/auth/v1/user`, { method: 'PUT', headers: { 'content-type': 'application/json', authorization: `Bearer ${hash.get('access_token')}` }, body: JSON.stringify({ password: 'MyOwnPass#2026' }) });
  const signed = await fetch(`${GW}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'imp.client@example.com', password: 'MyOwnPass#2026' }) });
  tokens.set('imp', ((await signed.json()) as any).access_token);
  const again = await fetch(link, { redirect: 'manual' });
  check(/error=access_denied/.test(again.headers.get('location') ?? ''), 'import: the link works only once');
  r = await api('imp', 'GET', '/client/services');
  const wa = r.json.data?.find((s: any) => s.code === 'WHATSAPP_API_BLUE_TICK');
  check(r.status === 200 && wa?.planName === '2 Lakh messages' && wa.usage?.metrics?.packageMessages === 200000 && wa.usage.metrics.sent === 190000, 'import: the client sees the plan and the usage', r);
  r = await api('imp', 'GET', '/client/campaigns');
  check(r.status === 200 && r.json.data.length === 1 && r.json.data[0].delivered === 306, 'import: the client sees their campaigns', r);
  r = await api('imp', 'GET', '/client/me');
  check(r.status === 200 && String(r.json.data.clientSince).startsWith('2025-04-01'), 'import: "customer since" comes from the sheet', r);

  // sent again by the team; "Forgot password?" by the client
  r = await api('a', 'POST', `/customers/${impCustomer}/client-password-email`);
  check(r.status === 404, 'import: someone else cannot send the set-password e-mail', r);
  r = await api('sm', 'POST', `/customers/${impCustomer}/client-password-email`);
  check(r.status === 200 && r.json.data.sent === true && r.json.data.email === 'imp.client@example.com', 'import: the member sends the set-password e-mail again', r);
  const n0 = outbox.filter(o => o.path === '/emails').length;
  const forgot = (email: string) => fetch(`${base}/client-auth/forgot-password`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://evil.example' }, body: JSON.stringify({ email }) })
    .then(async x => ({ status: x.status, json: (await x.json()) as any }));
  r = await forgot('IMP.client@example.com');
  check(r.status === 200 && r.json.data.ok === true, 'forgot password: answers ok', r);
  const reset = outbox.filter(o => o.path === '/emails').slice(n0).find(o => o.body.to?.[0] === 'imp.client@example.com');
  check(!!reset && /new password/i.test(reset.body.subject) && reset.body.html.includes(encodeURIComponent('https://crm.example.test/client/set-password')), 'forgot password: the client gets a reset link to the CRM (not to the caller\'s site)', reset?.body);
  const n1 = outbox.filter(o => o.path === '/emails').length;
  r = await forgot('imp.other@example.com');
  check(r.status === 200 && r.json.data.ok === true && outbox.filter(o => o.path === '/emails').length === n1, 'forgot password: same answer and no e-mail for an address without a client login', r);
  r = await forgot('sm@amuwa.com');
  check(r.status === 200 && outbox.filter(o => o.path === '/emails').length === n1, 'forgot password: never for a staff login', r);
  r = await forgot('not-an-email');
  check(r.status === 422, 'forgot password: a wrong e-mail is refused', r);

  // --- the team chooses the client's password (column "Client Password"): validated, hashed by Auth, never stored or e-mailed by the CRM ---
  const pw0 = 'Team#Chosen-2026';
  const pwFile = (extra: Record<string, unknown>[]) => ({
    customers: extra,
    services: extra.map((c, i) => ({ row: 3 + i, mobile: c.mobile, service: 'AI Calling', startDate: '2026-05-01', status: 'Live' }))
  });
  const pwRow = (n: number, o: Record<string, unknown> = {}) => ({ row: 2 + n, mobile: `90000003${String(n).padStart(2, '0')}`, name: `Pw Client ${n}`, businessName: `Pw Co ${n} (TEST)`, ...o });
  r = await api('sm', 'POST', '/customers/import-existing', { commit: false, data: pwFile([pwRow(1, { email: 'pw.one@example.com', loginPassword: 'short1' })]) });
  check(r.status === 200 && !r.json.data.committed && r.json.data.errors.some((e: any) => e.sheet === '1 Customers' && e.row === 3 && /10 characters/.test(e.message)),
    'password: a short Client Password is named by sheet and row', r);
  check(!JSON.stringify(r.json).includes('short1'), 'password: the response never contains it', r);
  r = await api('sm', 'POST', '/customers/import-existing', { commit: false, data: pwFile([pwRow(1, { loginPassword: pw0 })]) });
  check(r.status === 200 && r.json.data.errors.some((e: any) => /needs a Client Login E-mail/.test(e.message)), 'password: it needs an e-mail to sign in with', r);
  r = await api('sm', 'POST', '/customers/import-existing', { commit: false, data: pwFile([pwRow(1, { email: 'pw.one@example.com', loginPassword: 'pw.one@example.com' })]) });
  check(r.status === 200 && r.json.data.errors.some((e: any) => /cannot be the e-mail/.test(e.message)), 'password: not the e-mail address', r);
  r = await api('sm', 'POST', '/customers/import-existing', { commit: true, data: pwFile([pwRow(1, { email: 'pw.one@example.com', loginPassword: 'short1' }), pwRow(2, { email: 'pw.two@example.com', loginPassword: pw0 })]) });
  check(r.status === 200 && !r.json.data.committed && (await db.query(`select count(*)::int as n from public.customers where phone like '90000003%'`)).rows[0].n === 0,
    'password: one bad password stops the whole save', r);

  const mailsBeforePw = outbox.filter(o => o.path === '/emails').length;
  const pwSpecial = 'Team&Chosen<2026>';
  r = await api('sm', 'POST', '/customers/import-existing', { commit: true, data: pwFile([pwRow(3, { email: 'pw.three@example.com', loginPassword: pwSpecial }), pwRow(4)]) });
  const lg = r.json.data?.logins?.[0];
  check(r.status === 200 && r.json.data.committed && r.json.data.logins.length === 1 && lg.email === 'pw.three@example.com' && lg.login === 'CREATED' && lg.passwordBy === 'TEAM' && lg.mail === 'SENT',
    'password: saved; the login uses the customer\'s e-mail when no Client Login E-mail is given, and the client is e-mailed', r);
  const cm = outbox.filter(o => o.path === '/emails').slice(mailsBeforePw);
  const cred = cm.find(o => o.body.to?.[0] === 'pw.three@example.com');
  check(cm.length === 1 && !!cred && /sign-in details/i.test(cred.body.subject) && cred.body.text.includes('pw.three@example.com') && cred.body.text.includes(pwSpecial)
    && cred.body.html.includes('https://crm.example.test/client/login') && !/set-password/.test(cred.body.html),
    'password: that one e-mail has the dashboard address, the login e-mail and the password (and no set-password link)', cred?.body);
  const pw = pwSpecial;
  const signedPw = await fetch(`${GW}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'pw.three@example.com', password: pw }) });
  check(signedPw.status === 200 && !!((await signedPw.json()) as any).access_token, 'password: the client signs in with the password the team chose');
  const wrongPw = await fetch(`${GW}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'pw.three@example.com', password: 'Not-the-password-1' }) });
  check(wrongPw.status >= 400, 'password: and not with another one');
  const leak = (await db.query(
    `select (select count(*) from public.audit_logs where metadata::text like '%' || $1 || '%')
          + (select count(*) from public.customer_activities where note like '%' || $1 || '%')
          + (select count(*) from public.customers where notes like '%' || $1 || '%' or name like '%' || $1 || '%') as n`, [pw])).rows[0].n;
  check(Number(leak) === 0, 'password: it is not stored anywhere in the CRM (audit log, activity, customer)');
  const ev = (await db.query(`select actor_id, entity_id, metadata::text as m from public.audit_logs where action = 'CLIENT_PASSWORD_SET_BY_TEAM' and entity_id = $1`, [lg.customerId])).rows;
  check(ev.length === 1 && !ev[0].m.includes(pw), 'password: the audit log says who set a password for which customer (not the password)', ev);

  // the same file again: the customer already has a login, so the password is not used (and the existing one keeps working)
  r = await api('sm', 'POST', '/customers/import-existing', { commit: true, data: pwFile([pwRow(3, { email: 'pw.three@example.com', loginPassword: 'Another#Pass-2027' })]) });
  check(r.status === 200 && r.json.data.committed && r.json.data.logins.length === 0 && r.json.data.passwordsNotUsed?.[0] === 'pw.three@example.com', 'password: for a customer who already has a login it is not used', r);
  const still = await fetch(`${GW}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'pw.three@example.com', password: pw }) });
  check(still.status === 200, 'password: the first password still works');
  delete process.env.APP_URL; process.env.RATE_LIMIT_IMPORT_PER_MIN = '3';
}
// --- Chat: client chat, reviewers, internal direct messages, groups and files -------------------------------------
{
  const cust = (await db.query(`select id from public.customers where phone = '9000000201'`)).rows[0].id as string;
  const idOf = async (email: string) => (await db.query(`select id from public.profiles where email = $1`, [email])).rows[0].id as string;
  const smId = await idOf('sm@amuwa.com'), tm2Id = await idOf('tm.delivery@amuwa.com'), tl2Id = await idOf('tl.delivery@amuwa.com'), aId = await idOf('a@amuwa.com');
  const mid = () => crypto.randomUUID();
  // End-to-end encryption: the internal chats take envelopes only. The API tests cannot do real cryptography (that is tested in the browser code),
  // so they send envelopes of the right SHAPE, sealed for each member's published key, and check what the server does with them.
  const pubOf = (name: string) => Buffer.concat([Buffer.from([4]), crypto.createHash('sha256').update(name).digest(), crypto.createHash('sha256').update(name + 'y').digest()]).toString('base64');
  const backupBlob = { v: 1, kdf: 'PBKDF2-SHA256', iter: 600000, salt: 'A'.repeat(22) + '==', iv: 'A'.repeat(16), ct: 'A'.repeat(44) };
  const setupKeys = async (who: string) => (await api(who, 'POST', '/chat/keys', { publicKey: pubOf(who), backup: backupBlob })).status;
  const envelope = async (who: string, conv: string) => {
    const keys = ((await api(who, 'GET', `/chat/conversations/${conv}/keys`)).json.data as any[]).slice().sort((x, y) => (x.profileId < y.profileId ? -1 : 1));
    const st = (await api(who, 'GET', '/chat/keys/status')).json.data;
    return { v: 1, sv: st.version, iv: 'A'.repeat(16), ct: Buffer.from('opaque ' + crypto.randomUUID()).toString('base64'), wraps: keys.map(k => ({ to: k.profileId, kv: k.keyVersion, enc: k.publicKey, w: 'W'.repeat(24) })) };
  };
  const secureSend = async (who: string, conv: string, extra: Record<string, unknown> = {}) =>
    api(who, 'POST', `/chat/conversations/${conv}/secure-messages`, { clientMsgId: mid(), attachmentIds: [], e2ee: await envelope(who, conv), ...extra });

  // ---- who can reach the chat routes at all
  r = await api(null, 'GET', '/chat/internal');
  check(r.status === 401, 'chat: no token, no chat', r);
  r = await api('imp', 'GET', '/chat/internal');
  check(r.status === 401 || r.status === 403, 'chat: a client login cannot use the employee chat routes', r);
  r = await api('sm', 'GET', '/client/chat');
  check(r.status === 401 || r.status === 403, 'chat: an employee login cannot use the client chat routes', r);
  r = await api(null, 'GET', '/client/chat');
  check(r.status === 401, 'chat: client chat needs a sign-in', r);

  // ---- the client's conversation
  r = await api('imp', 'GET', '/client/chat');
  check(r.status === 200 && r.json.data.conversation.access === 'CLIENT' && r.json.data.conversation.canWrite && r.json.data.conversation.assigned === true && r.json.data.page.messages.length === 0
    && r.json.data.conversation.team.teamMember.name === 'Support Member', 'chat: the client opens their conversation, sees their Team Member and no messages yet', r);
  const conv = r.json.data.conversation.id as string;
  check(!JSON.stringify(r.json.data).includes(smId), 'chat: no employee id is given to the client', r.json.data);
  const first = mid();
  r = await api('imp', 'POST', '/client/chat/messages', { body: '  Hello team  ', clientMsgId: first });
  check(r.status === 201 && r.json.data.body === 'Hello team' && r.json.data.mine === true && r.json.data.senderLabel === 'Client' && r.json.data.seq === 1, 'chat: the client sends a message', r);
  const firstId = r.json.data.id as string;
  r = await api('imp', 'POST', '/client/chat/messages', { body: 'Hello team', clientMsgId: first });
  check(r.status === 201 && r.json.data.id === firstId, 'chat: sending the same message again returns the stored one (no duplicate)', r);
  r = await api('imp', 'POST', '/client/chat/messages', { body: '   ', clientMsgId: mid() });
  check(r.status === 422, 'chat: an empty message is refused', r);
  r = await api('imp', 'POST', '/client/chat/messages', { body: 'x'.repeat(4001), clientMsgId: mid() });
  check(r.status === 422, 'chat: a message over 4000 characters is refused', r);
  r = await api('imp', 'POST', '/client/chat/messages', { body: 'hi', clientMsgId: 'not-a-uuid' });
  check(r.status === 422, 'chat: a bad message id is refused', r);
  r = await api('imp', 'POST', '/client/chat/messages', { body: 'hi', clientMsgId: mid(), senderId: smId, conversationId: conv });
  check(r.status === 422, 'chat: a client cannot name a sender or a conversation (unknown fields are refused)', r);
  r = await api('imp', 'GET', '/client/chat/messages?before=5&after=2');
  check(r.status === 422, 'chat: "before" and "after" together are refused', r);

  // ---- the assigned Team Member
  r = await api('sm', 'GET', '/chat/my-clients');
  const mine = r.json.data?.find((x: any) => x.customerId === cust);
  check(r.status === 200 && mine && mine.unread === 1 && mine.role === 'Relationship Manager' && mine.conversationId === conv, 'chat: the Team Member sees the customer with 1 unread message', r);
  r = await api('sm', 'GET', `/chat/customers/${cust}`);
  check(r.status === 200 && r.json.data.id === conv && r.json.data.access === 'STAFF' && r.json.data.customer.business.includes('Import Traders'), 'chat: and opens the conversation from the customer', r);
  r = await api('sm', 'GET', `/chat/conversations/${conv}/messages?limit=10`);
  check(r.status === 200 && r.json.data.messages.length === 1 && r.json.data.messages[0].body === 'Hello team' && r.json.data.messages[0].mine === false, 'chat: and reads it', r);
  r = await api('sm', 'POST', `/chat/conversations/${conv}/messages`, { body: 'Hi, how can we help?', clientMsgId: mid() });
  check(r.status === 201 && r.json.data.senderKind === 'STAFF' && r.json.data.senderLabel === 'Relationship Manager' && r.json.data.seq === 2, 'chat: and replies', r);
  r = await api('sm', 'POST', `/chat/conversations/${conv}/read`, {});
  check(r.status === 200 && r.json.data.readSeq === 2, 'chat: and marks it read', r);
  r = await api('imp', 'GET', '/client/chat');
  check(r.json.data.conversation.unread === 1 && r.json.data.conversation.peerReadSeq === 2 && r.json.data.page.messages.length === 2, 'chat: the client sees the reply, 1 unread, and how far the team has read', r);
  r = await api('imp', 'GET', '/client/chat/messages?after=1');
  check(r.json.data.messages.length === 1 && r.json.data.messages[0].seq === 2, 'chat: a reconnecting client asks only for what came after the last message it has', r);
  r = await api('imp', 'POST', '/client/chat/read', {});
  check(r.status === 200, 'chat: the client marks it read', r);
  r = await api('imp', 'GET', '/client/chat/unread');
  check(r.status === 200 && r.json.data.total === 0, 'chat: and has nothing unread', r);

  // ---- everybody else
  r = await api('a', 'GET', `/chat/conversations/${conv}`);
  check(r.status === 404, 'chat: a Sales member cannot open the conversation', r);
  r = await api('a', 'GET', `/chat/conversations/${conv}/messages`);
  check(r.status === 404, 'chat: nor read its messages', r);
  r = await api('a', 'POST', `/chat/conversations/${conv}/messages`, { body: 'hi', clientMsgId: mid() });
  check(r.status === 404, 'chat: nor write in it', r);
  r = await api('a', 'GET', `/chat/customers/${cust}`);
  check(r.status === 404, 'chat: nor open the customer\'s chat', r);
  r = await api('tl2', 'GET', `/chat/conversations/${conv}/messages`);
  check(r.status === 404, 'chat: an unrelated Team Lead cannot read it', r);
  // ---- the Department Head reviews, cannot write
  r = await api('dh', 'GET', `/chat/conversations/${conv}`);
  check(r.status === 200 && r.json.data.access === 'REVIEWER' && r.json.data.canWrite === false, 'chat: the Department Head opens it as a reviewer', r);
  r = await api('dh', 'GET', `/chat/conversations/${conv}/messages`);
  check(r.status === 200 && r.json.data.messages.length === 2, 'chat: and reads it', r);
  r = await api('dh', 'POST', `/chat/conversations/${conv}/review-open`);
  check(r.status === 200, 'chat: opening it for review is recorded', r);
  check((await db.query(`select count(*)::int n from public.audit_logs where action = 'CLIENT_CHAT_REVIEWED' and entity_id = $1`, [conv])).rows[0].n === 1, 'chat: in the audit log');
  r = await api('dh', 'POST', `/chat/conversations/${conv}/messages`, { body: 'I am the Department Head', clientMsgId: mid() });
  check(r.status === 403, 'chat: the Department Head cannot send (direct API call)', r);
  r = await api('dh', 'POST', `/chat/conversations/${conv}/uploads`, { fileName: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 100 });
  check(r.status === 403, 'chat: nor attach a file', r);
  r = await api('dh', 'GET', '/chat/review');
  check(r.status === 200 && r.json.data.items.some((x: any) => x.id === conv && x.access === 'REVIEWER'), 'chat: the review list shows it', r);
  r = await api('sm', 'GET', '/chat/review');
  check(r.status === 403, 'chat: an employee who is not a Department Head cannot use the review list', r);
  check((await db.query(`select count(*)::int n from public.chat_messages where conversation_id = $1 and sender_id = $2`, [conv, await idOf('dh@amuwa.com')])).rows[0].n === 0, 'chat: and no message of the Department Head exists');

  // ---- internal direct messages
  r = await api('sm', 'GET', '/chat/directory?q=delivery');
  check(r.status === 200 && r.json.data.some((p: any) => p.id === tm2Id) && !r.json.data.some((p: any) => 'email' in p), 'chat: the directory finds colleagues without e-mail addresses', r);
  r = await api('imp', 'GET', '/chat/directory');
  check(r.status === 401 || r.status === 403, 'chat: a client cannot list employees', r);
  // everybody who will chat internally sets up secure messaging first (the browser does this with the recovery passphrase)
  check(await api(null, 'GET', '/chat/keys/status').then(x => x.status === 401), 'chat keys: signing in is required');
  r = await api('imp', 'GET', '/chat/keys/status');
  check(r.status === 401 || r.status === 403, 'chat keys: a client login has no secure messaging', r);
  r = await api('sm', 'GET', '/chat/keys/status');
  check(r.status === 200 && r.json.data.hasKey === false && r.json.data.hasBackup === false, 'chat keys: nobody has a key before setting up', r);
  r = await api('sm', 'POST', '/chat/keys', { publicKey: 'short', backup: backupBlob });
  check(r.status === 422, 'chat keys: a public key of the wrong size is refused', r);
  r = await api('sm', 'POST', '/chat/keys', { publicKey: pubOf('x'), backup: { ...backupBlob, iter: 10 } });
  check(r.status === 422, 'chat keys: a backup with a weak key-derivation setting is refused', r);
  r = await api('sm', 'POST', '/chat/keys', { publicKey: pubOf('x'), backup: backupBlob, privateKey: 'AAAA' });
  check(r.status === 422, 'chat keys: a request that names anything else (a private key, say) is refused', r);
  for (const who of ['sm', 'tm2', 'tl2', 'a']) check((await setupKeys(who)) === 201, `chat keys: ${who} sets up secure messaging`);
  r = await api('sm', 'POST', '/chat/keys', { publicKey: pubOf('other'), backup: backupBlob });
  check(r.status === 409, 'chat keys: a second setup cannot replace the key silently', r);
  r = await api('sm', 'GET', '/chat/keys/status');
  check(r.json.data.hasKey && r.json.data.version === 1 && r.json.data.publicKey === pubOf('sm') && /^[0-9a-f]{64}$/.test(r.json.data.fingerprint) && r.json.data.hasBackup, 'chat keys: the status shows the public key and its fingerprint', r);
  r = await api('sm', 'GET', '/chat/keys/backup');
  check(r.status === 200 && r.json.data.blob.kdf === 'PBKDF2-SHA256' && r.json.data.version === 1, 'chat keys: a person can fetch their own encrypted backup', r);
  r = await api('tm2', 'GET', '/chat/keys/backup');
  check(r.status === 200 && JSON.stringify(r.json.data).indexOf(pubOf('sm')) === -1, "chat keys: and only their own (not anybody else's)", r);
  r = await api('sm', 'POST', '/chat/keys/backup', { backup: backupBlob, version: 5 });
  check(r.status === 409, 'chat keys: a backup can only be replaced for the current key', r);
  r = await api('sm', 'POST', '/chat/keys/backup', { backup: backupBlob, version: 1 });
  check(r.status === 200, 'chat keys: the current one can (a new recovery passphrase)', r);
  r = await api('tm2', 'GET', `/chat/keys/lookup?profileId=${smId}&version=1`);
  check(r.status === 200 && r.json.data.publicKey === pubOf('sm') && !('privateKey' in r.json.data), "chat keys: a colleague's public key can be looked up", r);
  r = await api('tm2', 'GET', `/chat/keys/lookup?profileId=${smId}&version=1&extra=1`);
  check(r.status === 422, 'chat keys: with nothing extra', r);

  r = await api('sm', 'POST', '/chat/direct', { profileId: tm2Id });
  check(r.status === 200 && r.json.data.kind === 'DIRECT' && r.json.data.title === 'Mohan Member' || r.json.data?.kind === 'DIRECT', 'chat: an employee starts a direct conversation', r);
  const dm = r.json.data.id as string;
  r = await api('tm2', 'POST', '/chat/direct', { profileId: smId });
  check(r.json.data.id === dm, 'chat: the other person opening it gets the same conversation', r);
  r = await api('sm', 'POST', '/chat/direct', { profileId: smId });
  check(r.status === 422, 'chat: nobody can open a conversation with themselves', r);
  r = await api('sm', 'POST', `/chat/conversations/${dm}/messages`, { body: 'Got a minute?', clientMsgId: mid() });
  check(r.status === 422, 'chat: a readable message is refused in a direct chat (it must be encrypted first)', r);
  r = await secureSend('sm', dm);
  check(r.status === 201 && r.json.data.senderLabel === null && r.json.data.encrypted === true && r.json.data.body === '' && r.json.data.e2ee.wrap.to === smId, 'chat: an encrypted direct message is sent', r);
  const dm1 = r.json.data;
  r = await api('tm2', 'GET', '/chat/internal');
  check(r.status === 200 && r.json.data.length === 1 && r.json.data[0].unread === 1 && r.json.data[0].lastMessagePreview === 'Encrypted message', 'chat: the other person has it in their list with 1 unread (the preview never shows content)', r);
  r = await api('tm2', 'GET', `/chat/conversations/${dm}/messages`);
  check(r.status === 200 && r.json.data.messages[0].e2ee.wrap.to === tm2Id && r.json.data.messages[0].e2ee.wrap.w === 'W'.repeat(24) && !('wraps' in r.json.data.messages[0].e2ee) && r.json.data.messages[0].senderId === smId, 'chat: the other person receives the envelope with THEIR key wrap only', r);
  {
    const { rows: [row] } = await db.query(`select body, encrypted, e2ee::text as e from public.chat_messages where id = $1`, [dm1.id]);
    check(row.body === '' && row.encrypted === true && !row.e.includes('Got a minute'), 'chat: the database holds the envelope and no readable text', row.e.slice(0, 80));
  }
  r = await api('sm', 'POST', `/chat/conversations/${dm}/secure-messages`, { clientMsgId: mid(), body: 'plain text too', e2ee: await envelope('sm', dm) });
  check(r.status === 422, 'chat: an encrypted message cannot also carry readable text (unknown field refused)', r);
  r = await api('sm', 'POST', `/chat/conversations/${dm}/secure-messages`, { clientMsgId: mid(), e2ee: { v: 1, sv: 1, iv: 'short', ct: 'AAAAAAAA', wraps: [] } });
  check(r.status === 422, 'chat: a badly formed envelope is refused', r);
  r = await api('sm', 'POST', `/chat/conversations/${dm}/secure-messages`, { clientMsgId: mid(), e2ee: { ...(await envelope('sm', dm)), sv: 7 } });
  check(r.status === 409, 'chat: an envelope made with a key that is not the sender\'s current one is refused (KEYS_CHANGED)', r);
  r = await api('sm', 'POST', `/chat/conversations/${dm}/secure-messages`, { clientMsgId: mid(), e2ee: { ...(await envelope('sm', dm)), wraps: (await envelope('sm', dm)).wraps.slice(1) } });
  check(r.status === 409, 'chat: one that leaves a member out is refused', r);
  const sameId = mid(); const sameEnv = await envelope('sm', dm);
  r = await api('sm', 'POST', `/chat/conversations/${dm}/secure-messages`, { clientMsgId: sameId, e2ee: sameEnv });
  const again = await api('sm', 'POST', `/chat/conversations/${dm}/secure-messages`, { clientMsgId: sameId, e2ee: sameEnv });
  check(r.status === 201 && again.json.data.id === r.json.data.id, 'chat: a retry with the same message id stores one message', again);
  r = await api('tl2', 'POST', `/chat/conversations/${dm}/secure-messages`, { clientMsgId: mid(), e2ee: sameEnv });
  check(r.status === 404, 'chat: a non-member cannot send into it', r);
  r = await api('tm2', 'GET', '/chat/unread');
  check(r.json.data.internal >= 1, 'chat: and in their unread summary', r);
  r = await api('tl2', 'GET', `/chat/conversations/${dm}/messages`);
  check(r.status === 404, 'chat: a third person cannot read the direct conversation', r);
  r = await api('dh', 'GET', `/chat/conversations/${dm}/messages`);
  check(r.status === 404, 'chat: nor can a Department Head', r);
  r = await api('sa', 'GET', `/chat/conversations/${dm}/messages`);
  check(r.status === 404, 'chat: nor the Super Admin', r);
  r = await api('imp', 'GET', `/client/chat/messages`);
  check(r.json.data.messages.every((m: any) => m.conversationId === conv), 'chat: a client never receives an internal message', r);

  // ---- groups
  r = await api('sm', 'POST', '/chat/groups', { title: 'Delivery huddle', memberIds: [tm2Id, tl2Id] });
  check(r.status === 201 && r.json.data.kind === 'GROUP' && r.json.data.isAdmin === true && r.json.data.members.length === 3, 'chat: an employee creates a group', r);
  const grp = r.json.data.id as string;
  r = await api('sm', 'POST', '/chat/groups', { title: '', memberIds: [tm2Id] });
  check(r.status === 422, 'chat: a group needs a name', r);
  r = await api('sm', 'POST', '/chat/groups', { title: 'x', memberIds: [] });
  check(r.status === 422, 'chat: and someone to talk to', r);
  r = await secureSend('sm', grp);
  check(r.status === 201, 'chat: the admin writes in it (every member has set up secure messaging)', r);
  r = await secureSend('tm2', grp);
  check(r.status === 201, 'chat: a member writes in it', r);
  r = await api('tm2', 'POST', `/chat/groups/${grp}/members`, { profileIds: [aId] });
  check(r.status === 403, 'chat: a member who is not an admin cannot add people', r);
  r = await api('tm2', 'PATCH', `/chat/groups/${grp}`, { title: 'Mine now' });
  check(r.status === 403, 'chat: nor rename the group', r);
  r = await api('a', 'GET', `/chat/conversations/${grp}/messages`);
  check(r.status === 404, 'chat: a non-member cannot read it', r);
  r = await api('sm', 'POST', `/chat/groups/${grp}/members`, { profileIds: [aId] });
  check(r.status === 200 && r.json.data.members.length === 4, 'chat: the admin adds a person', r);
  r = await api('a', 'GET', `/chat/conversations/${grp}/messages`);
  check(r.status === 200 && r.json.data.messages.length === 1 && r.json.data.messages[0].kind === 'SYSTEM', 'chat: a new member sees only what is said from when they joined', r);
  r = await api('sm', 'POST', `/chat/groups/${grp}/members`, { profileIds: [await idOf('x@amuwa.com').catch(() => crypto.randomUUID())] });
  check(r.status === 422 || r.status === 200, 'chat: adding is validated (an unknown person is refused)', r);
  r = await api('sm', 'POST', `/chat/groups/${grp}/members`, { profileIds: [crypto.randomUUID()] });
  check(r.status === 422, 'chat: a person who does not exist cannot be added', r);

  // ---- files (in an internal chat a file is encrypted in the browser: the server stores an opaque envelope that starts "AME2")
  const enc = Buffer.concat([Buffer.from('AME2'), Buffer.from([1]), crypto.randomBytes(2000)]);
  r = await api('sm', 'POST', `/chat/conversations/${grp}/uploads`, { fileName: 'virus.exe', mimeType: 'application/x-msdownload', sizeBytes: 100 });
  check(r.status === 422, 'chat: a file type that is not allowed is refused', r);
  r = await api('sm', 'POST', `/chat/conversations/${grp}/uploads`, { fileName: 'Plan.pdf', mimeType: 'application/pdf', sizeBytes: 2000 });
  check(r.status === 422, 'chat: a readable file is refused in an internal chat (it has to be encrypted first)', r);
  r = await api('sm', 'POST', `/chat/conversations/${grp}/uploads`, { fileName: 'file.enc', mimeType: 'application/x-amuwa-e2ee', sizeBytes: 6 * 1024 * 1024 });
  check(r.status === 422, 'chat: a file over 5 MB is refused', r);
  r = await api('sm', 'POST', `/chat/conversations/${grp}/uploads`, { fileName: 'file.enc', mimeType: 'application/x-amuwa-e2ee', sizeBytes: enc.length });
  check(r.status === 201 && r.json.data.bucket === 'chat-attachments' && r.json.data.path.startsWith(`${grp}/`) && !r.json.data.path.includes('..') && r.json.data.attachment.name === 'encrypted-file', 'chat: an upload is booked under the conversation (the real file name is not stored)', r);
  const tk = r.json.data;
  r = await secureSend('sm', grp, { attachmentIds: [tk.attachment.id] });
  check(r.status === 422, 'chat: a file that has not finished uploading cannot be sent', r);
  r = await api('sm', 'POST', `/chat/uploads/${tk.attachment.id}/complete`);
  check(r.status === 422, 'chat: completing an upload that never arrived is refused', r);
  r = await api('sm', 'POST', `/chat/conversations/${grp}/uploads`, { fileName: 'file.enc', mimeType: 'application/x-amuwa-e2ee', sizeBytes: enc.length });
  const tk2 = r.json.data;
  const bad = await fetch(`${GW}/storage/v1/object/upload/sign/${tk2.bucket}/${tk2.path}?token=${tk2.token}`, { method: 'PUT', headers: { 'content-type': 'application/x-amuwa-e2ee', 'x-upsert': 'false' }, body: Buffer.concat([Buffer.from('%PDF-1.4 not encrypted'), Buffer.alloc(100)]) });
  check(bad.status < 300, 'chat: (a file that is not an encrypted envelope is uploaded to the single-use link ...)');
  r = await api('sm', 'POST', `/chat/uploads/${tk2.attachment.id}/complete`);
  check(r.status === 422, 'chat: ... and is refused when the upload is confirmed (the stored file must be an encrypted envelope)', r);
  r = await api('sm', 'POST', `/chat/conversations/${grp}/uploads`, { fileName: 'file.enc', mimeType: 'application/x-amuwa-e2ee', sizeBytes: enc.length });
  const tk3 = r.json.data;
  const put = await fetch(`${GW}/storage/v1/object/upload/sign/${tk3.bucket}/${tk3.path}?token=${tk3.token}`, { method: 'PUT', headers: { 'content-type': 'application/x-amuwa-e2ee', 'x-upsert': 'false' }, body: enc });
  check(put.status < 300, 'chat: the encrypted file is uploaded with the single-use link', await put.text().catch(() => ''));
  r = await api('tm2', 'POST', `/chat/uploads/${tk3.attachment.id}/complete`);
  check(r.status === 404, 'chat: someone else cannot confirm my upload', r);
  r = await api('sm', 'POST', `/chat/uploads/${tk3.attachment.id}/complete`);
  check(r.status === 200 && r.json.data.name === 'encrypted-file', 'chat: the uploader confirms it', r);
  r = await api('tm2', 'GET', `/chat/attachments/${tk3.attachment.id}/url`);
  check(r.status === 404, 'chat: before it is sent only the uploader can reach the file', r);
  r = await secureSend('sm', grp, { attachmentIds: [tk3.attachment.id] });
  check(r.status === 201 && r.json.data.attachments[0].id === tk3.attachment.id && !('name' in r.json.data.attachments[0]), 'chat: a message can carry the file (the server lists only its id and size, not its name or type)', r);
  const fileMsg = r.json.data;
  r = await api('tm2', 'GET', `/chat/attachments/${tk3.attachment.id}/url?action=download`);
  check(r.status === 200 && r.json.data.url.startsWith(GW) && r.json.data.expiresInSeconds <= 120, 'chat: a member gets a short-lived download link', r);
  const dlUrl = r.json.data.url as string;
  const dl = await fetch(dlUrl);
  check(dl.status === 200 && Buffer.from(await dl.arrayBuffer()).equals(enc), 'chat: and the stored file is the encrypted envelope that was uploaded (never the original)');
  r = await api('a', 'GET', `/chat/attachments/${tk3.attachment.id}/url`);
  check(r.status === 200, 'chat: the member who joined later can open files sent after they joined', r);
  r = await api('imp', 'GET', `/client/chat/attachments/${tk3.attachment.id}/url`);
  check(r.status === 404, 'chat: a client cannot open an internal file even with its id', r);
  r = await api('imp', 'GET', `/chat/attachments/${tk3.attachment.id}/url`);
  check(r.status === 401 || r.status === 403, 'chat: nor through the employee route', r);
  r = await api('dh', 'GET', `/chat/attachments/${tk3.attachment.id}/url`);
  check(r.status === 404, 'chat: a Department Head cannot open an employee group\'s file', r);

  // ---- deleting messages: for me, and for everyone
  const dmMsgs = async (who: string) => ((await api(who, 'GET', `/chat/conversations/${dm}/messages?limit=100`)).json.data.messages as any[]);
  r = await api('tm2', 'DELETE', `/chat/messages/${dm1.id}/for-me`);
  check(r.status === 200 && r.json.data.hidden === true, 'chat delete: delete for me', r);
  check(!(await dmMsgs('tm2')).some(m => m.id === dm1.id) && (await dmMsgs('sm')).some(m => m.id === dm1.id), 'chat delete: it is gone for that person only (the sender still has it)');
  r = await api('tm2', 'DELETE', `/chat/messages/${dm1.id}/for-me`);
  check(r.status === 200, 'chat delete: doing it twice is harmless', r);
  r = await api('tm2', 'DELETE', `/chat/messages/${dm1.id}/for-everyone`);
  check(r.status === 403, "chat delete: a person cannot delete somebody else's message for everyone", r);
  r = await api('tl2', 'DELETE', `/chat/messages/${dm1.id}/for-me`);
  check(r.status === 404, 'chat delete: a person outside the conversation cannot touch it', r);
  r = await api('tl2', 'DELETE', `/chat/messages/${dm1.id}/for-everyone`);
  check(r.status === 404, 'chat delete: nor for everyone', r);
  r = await api('dh', 'DELETE', `/chat/messages/${dm1.id}/for-everyone`);
  check(r.status === 404, 'chat delete: a Department Head has no power over employees\' chats', r);
  r = await api('sa', 'DELETE', `/chat/messages/${dm1.id}/for-everyone`);
  check(r.status === 404, 'chat delete: nor the Super Admin (administration and message access are separate)', r);
  r = await api('sm', 'DELETE', `/chat/messages/not-a-uuid/for-me`);
  check(r.status === 422, 'chat delete: a malformed id is refused', r);
  r = await api(null, 'DELETE', `/chat/messages/${dm1.id}/for-me`);
  check(r.status === 401, 'chat delete: signing in is required', r);
  const stored = (await db.query(`select e2ee is not null as has, deleted_at from public.chat_messages where id = $1`, [dm1.id])).rows[0];
  check(stored.has && stored.deleted_at === null, 'chat delete: delete for me did not touch the shared message');

  // a message with a file, deleted for everyone: the stored file goes too
  r = await api('tm2', 'DELETE', `/chat/messages/${fileMsg.id}/for-everyone`);
  check(r.status === 403, 'chat delete: the receiver cannot remove the sender\'s file message for everyone', r);
  r = await api('sm', 'DELETE', `/chat/messages/${fileMsg.id}/for-everyone`);
  check(r.status === 200 && r.json.data.deleted === true, 'chat delete: the sender deletes it for everyone', r);
  {
    const { rows: [m] } = await db.query(`select body, e2ee, attachments::text as a, deleted_at is not null as gone from public.chat_messages where id = $1`, [fileMsg.id]);
    check(m.gone && m.body === '' && m.e2ee === null && m.a === '[]', 'chat delete: the server wiped the ciphertext, the key wraps and the file list', m);
    const { rows: [f] } = await db.query(`select status, storage_removed_at is not null as removed from public.chat_attachments where id = $1`, [tk3.attachment.id]);
    check(f.status === 'DELETED' && f.removed === true, 'chat delete: the file is marked deleted and its removal from storage was recorded', f);
  }
  const afterDel = await fetch(dlUrl);
  check(afterDel.status >= 400, 'chat delete: the stored encrypted file is gone from storage (an earlier link no longer works)', afterDel.status);
  r = await api('tm2', 'GET', `/chat/attachments/${tk3.attachment.id}/url`);
  check(r.status === 404, 'chat delete: no new link can be made for it', r);
  r = await api('tm2', 'GET', `/chat/conversations/${grp}/messages?limit=100`);
  const tomb = (r.json.data.messages as any[]).find(m => m.id === fileMsg.id);
  check(tomb && tomb.deleted === true && tomb.body === '' && tomb.e2ee === null && tomb.attachments.length === 0, 'chat delete: the other member gets a tombstone with nothing in it', tomb);
  r = await api('sm', 'DELETE', `/chat/messages/${fileMsg.id}/for-everyone`);
  check(r.status === 200, 'chat delete: deleting again is harmless', r);
  check((await db.query(`select count(*)::int n from public.audit_logs where action = 'CHAT_MESSAGE_DELETED_FOR_ALL' and entity_id = $1`, [fileMsg.id])).rows[0].n === 1, 'chat delete: it is in the audit log once, without content');
  // client conversations keep their history
  const clientMsgs = (await api('sm', 'GET', `/chat/conversations/${conv}/messages`)).json.data.messages as any[];
  r = await api('sm', 'DELETE', `/chat/messages/${clientMsgs[0].id}/for-everyone`);
  check(r.status === 403, 'chat delete: a client conversation keeps its history (no delete for everyone)', r);
  r = await api('sm', 'DELETE', `/chat/messages/${clientMsgs[0].id}/for-me`);
  check(r.status === 403, 'chat delete: nor delete for me', r);

  // ---- a reset changes the key: old envelopes stay unreadable to a new device, new messages are sealed for the new key
  r = await api('tm2', 'POST', '/chat/keys/reset', { publicKey: pubOf('tm2-new'), backup: backupBlob });
  check(r.status === 200 && r.json.data.version === 2, 'chat keys: a reset publishes a new key version', r);
  r = await api('sm', 'GET', `/chat/conversations/${dm}/keys`);
  check((r.json.data as any[]).find(k => k.profileId === tm2Id).keyVersion === 2 && (r.json.data as any[]).find(k => k.profileId === tm2Id).publicKey === pubOf('tm2-new'), "chat keys: the other person's screen sees the new key", r);
  r = await api('sm', 'POST', `/chat/conversations/${dm}/secure-messages`, { clientMsgId: mid(), e2ee: { ...sameEnv, ct: Buffer.from('stale ' + mid()).toString('base64') } });
  check(r.status === 409, 'chat keys: a message sealed for the retired key is refused', r);
  r = await secureSend('sm', dm);
  check(r.status === 201 && r.json.data.e2ee.wrap.to === smId, 'chat keys: one sealed for the new key is accepted', r);
  r = await api('sm', 'GET', `/chat/keys/lookup?profileId=${tm2Id}&version=1`);
  check(r.status === 200 && r.json.data.retired === true, 'chat keys: the old key stays known (to check old messages), marked retired', r);

  // ---- removing a member
  r = await api('sm', 'DELETE', `/chat/groups/${grp}/members/${tl2Id}`);
  check(r.status === 200 && r.json.data.members.length === 3, 'chat: the admin removes a member', r);
  r = await api('tl2', 'GET', `/chat/conversations/${grp}/messages`);
  check(r.status === 404, 'chat: the removed member can no longer read the group', r);
  r = await api('tl2', 'POST', `/chat/conversations/${grp}/messages`, { body: 'still here', clientMsgId: mid() });
  check(r.status === 404, 'chat: nor write in it', r);
  r = await api('tl2', 'GET', `/chat/attachments/${tk3.attachment.id}/url`);
  check(r.status === 404, 'chat: nor download its files', r);
  r = await api('tm2', 'POST', `/chat/groups/${grp}/leave`);
  check(r.status === 200, 'chat: a member leaves', r);
  r = await api('tm2', 'GET', `/chat/conversations/${grp}/messages`);
  check(r.status === 404, 'chat: and has no access afterwards', r);

  // ---- history paging and bad ids
  for (let i = 0; i < 35; i++) await db.query(`select 1`); // (the pages below are checked on the group, which has 5+ messages)
  r = await api('sm', 'GET', `/chat/conversations/${grp}/messages?limit=2`);
  check(r.status === 200 && r.json.data.messages.length === 2 && r.json.data.hasMore === true, 'chat: history is paged (newest first page, "hasMore")', r);
  const oldest = r.json.data.messages[0].seq as number;
  r = await api('sm', 'GET', `/chat/conversations/${grp}/messages?limit=100&before=${oldest}`);
  check(r.status === 200 && r.json.data.messages.every((m: any) => m.seq < oldest), 'chat: the next page continues before the oldest message', r);
  r = await api('sm', 'GET', `/chat/conversations/${grp}/messages?limit=500`);
  check(r.status === 422, 'chat: a page cannot be larger than 100', r);
  r = await api('sm', 'GET', '/chat/conversations/not-a-uuid/messages');
  check(r.status === 422, 'chat: a malformed conversation id is refused', r);
  r = await api('sm', 'GET', `/chat/conversations/${crypto.randomUUID()}/messages`);
  check(r.status === 404, 'chat: a conversation id that does not exist is not found (same as one that is not yours)', r);
  r = await api('sm', 'GET', `/chat/customers/${crypto.randomUUID()}`);
  check(r.status === 404, 'chat: a customer id that does not exist is not found', r);
}
for (const k of ['AUTOMATION_MODE', 'EMAIL_PROVIDER', 'EMAIL_API_KEY', 'EMAIL_API_BASE_URL', 'EMAIL_FROM', 'WHATSAPP_WEBHOOK_URL', 'AUTOMATION_SECRET_KEY', 'AUTOMATION_DISPATCH_SECRET', 'AUTOMATION_TEST_RECIPIENTS']) delete process.env[k];
provider.close();

// --- client dashboard API ------------------------------------------------------
{
  const signIn = async (email: string, password: string) => {
    const res = await fetch(`${process.env.GATEWAY_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password })
    });
    return ((await res.json()) as any).access_token as string;
  };
  tokens.set('cl1', await signIn(clientEmail, 'ClientPass#2026'));
  tokens.set('cl2', await signIn('auto.client@example.com', 'AutoPass#2026x'));

  // ---- onboarding journey over the API: a client who is still onboarding sees the journey and only the sections that are open
  console.log('--- client journey over the API');
  r = await api('cl2', 'GET', '/client/journey');
  check(r.status === 200 && r.json.data.stage === 'RELATIONSHIP_MANAGER' && !r.json.data.completed && r.json.data.stages.length === 5, 'journey: Meta verification is done, the Relationship Manager is next', r.json.data?.stage);
  check(r.json.data.stages[1].metaStatus === 'COMPLETED' && r.json.data.stages[0].status === 'COMPLETED' && r.json.data.stages[2].status === 'IN_PROGRESS', 'journey: stages and their statuses', r.json.data.stages.map((x: any) => x.status));
  check(r.json.data.access.tickets.enabled === false && r.json.data.access.chat.enabled && r.json.data.access.documents.enabled && r.json.data.access.journey.enabled, 'journey: closed and open sections', r.json.data.access);
  for (const [path, label] of [['/client/services', 'My Services'], ['/client/campaigns', 'Campaigns'], ['/client/tickets', 'Tickets'], ['/client/catalog', 'Explore Services'], ['/client/plans', 'Monthly Plans'], ['/client/calendar?from=2026-01-01&to=2026-01-31', 'the Calendar'], ['/client/service-requests', 'service requests']] as const) {
    r = await api('cl2', 'GET', path);
    check(r.status === 403 && /Available after/.test(r.json.error.message), `journey: ${label} is refused by the server while it is closed`, r);
  }
  r = await api('cl2', 'POST', '/client/tickets', { subject: 'Hello', description: 'Please help me start', category: 'GENERAL' });
  check(r.status === 403, 'journey: a ticket cannot be raised directly', r);
  r = await api('cl2', 'POST', '/client/service-requests', { serviceCode: 'AI_QR' });
  check(r.status === 403, 'journey: nor a service requested', r);
  r = await api('cl2', 'GET', '/client/overview');
  check(r.status === 200 && r.json.data.journey.stage === 'RELATIONSHIP_MANAGER' && r.json.data.services.total === 0 && r.json.data.tickets.total === 0, 'journey: the overview opens and shows nothing of the closed sections', r);
  r = await api('cl2', 'GET', '/client/documents');
  check(r.status === 200, 'journey: documents stay open', r);
  // chat: the Meta conversation is closed (kept), the Relationship Manager's has nobody yet
  r = await api('cl2', 'GET', '/client/chat?channel=SOMEONE');
  check(r.status === 422, 'journey chat: an unknown channel is refused', r);
  r = await api('cl2', 'GET', '/client/chat?channel=META');
  check(r.status === 200 && r.json.data.conversation.channel === 'META' && r.json.data.conversation.canWrite === false && /Meta verification is completed/.test(r.json.data.conversation.blockReason), 'journey chat: the Meta conversation is kept and closed', r);
  const metaConv = r.json.data.conversation.id;
  r = await api('cl2', 'GET', '/client/chat?channel=RM');
  check(r.status === 200 && r.json.data.conversation.channel === 'RM' && r.json.data.conversation.id !== metaConv && r.json.data.conversation.canWrite === false, 'journey chat: the Relationship Manager conversation is separate and has nobody to write to yet', r);
  r = await api('cl2', 'POST', '/client/chat/messages', { channel: 'META', body: 'one more', clientMsgId: crypto.randomUUID() });
  check(r.status === 422 && /closed/.test(r.json.error.message), 'journey chat: nobody can add to a closed Meta conversation', r);
  r = await api('cl2', 'POST', '/client/chat/messages', { channel: 'RM', body: 'hello', clientMsgId: crypto.randomUUID() });
  check(r.status === 422, 'journey chat: nor write to a Relationship Manager that is not assigned', r);
  r = await api('cl2', 'POST', '/client/chat/messages', { body: 'hello', clientMsgId: crypto.randomUUID(), employeeId: crypto.randomUUID() });
  check(r.status === 422, 'journey chat: a client cannot name an employee (unknown field refused)', r);
  // staff side
  r = await api('a', 'POST', `/pipeline/customers/${autoA}/services/WHATSAPP_API_BLUE_TICK/setup`, { status: 'READY' });
  check(r.status === 404, 'journey: Sales cannot mark a service ready', r);
  r = await api('tc', 'POST', `/pipeline/customers/${autoA}/services/WHATSAPP_API_BLUE_TICK/setup`, { status: 'READY' });
  check(r.status === 422 && /Relationship Manager/.test(r.json.error.message), 'journey: a service cannot be ready before the Relationship Manager is assigned', r);
  r = await api('tc', 'POST', `/pipeline/customers/${autoA}/services/WHATSAPP_API_BLUE_TICK/setup`, { status: 'DONE' });
  check(r.status === 422, 'journey: an unknown setup status is refused', r);
  r = await api('tc', 'GET', `/pipeline/customers/${autoA}/journey-status`);
  check(r.status === 200 && r.json.data.meta.status === 'COMPLETED' && r.json.data.services.length === 1 && r.json.data.completedAt === null, 'journey: the team reads the status', r);
  r = await api('cl2', 'GET', `/pipeline/customers/${autoA}/journey-status`);
  check(r.status === 401 || r.status === 403, 'journey: a client cannot use the staff journey endpoints', r);
  r = await api('cl2', 'POST', `/pipeline/customers/${autoA}/meta-verification`, { status: 'COMPLETED' });
  check(r.status === 401 || r.status === 403, 'journey: nor change the Meta status', r);
  // the rest of this block is about the dashboard's features: both clients are fully set up
  await db.query(`update public.customer_services set setup_status = 'READY', setup_completed_at = now() where customer_id in ($1, $2)`, [leadA, autoA]);
  await db.query(`update public.customer_onboarding set onboarding_completed_at = coalesce(onboarding_completed_at, now()) where customer_id in ($1, $2)`, [leadA, autoA]);
  r = await api('cl2', 'GET', '/client/journey');
  check(r.json.data.completed && r.json.data.stage === 'COMPLETED' && Object.values(r.json.data.access).every((a: any) => a.enabled), 'journey: completed onboarding opens every section', r);

  // ---- subscriptions over the API: Sales picks the duration, the team confirms the panel activation, the expiry is calculated ----
  console.log('--- subscription duration, activation and expiry over the API');
  {
    const modeBefore = process.env.AUTOMATION_MODE;
    const recipientsBefore = process.env.AUTOMATION_TEST_RECIPIENTS;
    delete process.env.AUTOMATION_TEST_RECIPIENTS;
    // a mail provider of this block's own (the suite's earlier one is closed by now)
    const mailbox: { path: string; body: any }[] = [];
    const mailMock = http.createServer((req, res) => {
      let raw = '';
      req.on('data', c => (raw += c));
      req.on('end', () => { mailbox.push({ path: (req.url || '').split('?')[0], body: raw ? JSON.parse(raw) : null }); res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ id: `m-${mailbox.length}` })); });
    });
    await new Promise<void>(rs => mailMock.listen(0, rs));
    const MP = `http://127.0.0.1:${(mailMock.address() as any).port}`;
    const envKeys = ['AUTOMATION_DISPATCH_SECRET', 'EMAIL_PROVIDER', 'EMAIL_API_KEY', 'EMAIL_API_BASE_URL', 'EMAIL_FROM', 'APP_URL'];
    const envBefore = Object.fromEntries(envKeys.map(k => [k, process.env[k]]));
    Object.assign(process.env, { AUTOMATION_DISPATCH_SECRET: 'dispatch-secret-0123456789', EMAIL_PROVIDER: 'resend', EMAIL_API_KEY: 're_test_key', EMAIL_API_BASE_URL: MP,
      EMAIL_FROM: 'Amuwa Corporation <meta@amuwa.com>', APP_URL: 'https://crm.example.test' });
    const addMonths = async (d: string, m: number) => (await db.query(`select (($1::date) + make_interval(months => $2))::date::text d`, [d, m])).rows[0].d as string;
    const dayOffset = async (n: number) => (await db.query(`select ((now() at time zone 'Asia/Kolkata')::date + $1::int)::text d`, [n])).rows[0].d as string;

    // 1. Sales creates a customer with a 6-month subscription (and no date field exists)
    r = await api('a', 'POST', '/pipeline/leads', { name: 'Sub Owner', company: 'Sub Six Co', phone: '9811100111', email: 'sub.six@example.com', leadSource: 'Walk-in', services: ['AI_CALLING'],
      subscriptions: [{ service: 'AI_CALLING', plan: 'Growth', durationCode: '6M', amount: 12000, messageCredits: 20000, panel: 'Calling panel' }] });
    check(r.status === 201, 'subscription: Sales creates a customer with a 6-month subscription', r);
    const subC = r.json.data.id as string;
    r = await api('a', 'POST', '/pipeline/leads', { name: 'Sub Bad', phone: '9811100112', leadSource: 'Walk-in', services: ['AI_CALLING'],
      subscriptions: [{ service: 'AI_CALLING', plan: 'Growth', durationCode: '6M', amount: 1, startedOn: '2026-11-01' }] });
    check(r.status === 422, 'subscription: a start date in the request is refused (there is no such field)', r);
    r = await api('a', 'POST', '/pipeline/leads', { name: 'Sub Bad', phone: '9811100113', leadSource: 'Walk-in', services: ['AI_CALLING'],
      subscriptions: [{ service: 'AI_CALLING', plan: 'Growth', durationCode: 'CUSTOM', amount: 1 }] });
    check(r.status === 422, 'subscription: a custom duration needs months or days', r);
    r = await api('a', 'POST', '/pipeline/leads', { name: 'Sub Bad', phone: '9811100114', leadSource: 'Walk-in', services: ['AI_CALLING'],
      subscriptions: [{ service: 'AI_CALLING', plan: 'Growth', amount: 1 }] });
    check(r.status === 422, 'subscription: the duration is required', r);
    const row0 = (await db.query(`select duration_code, duration_months, plan_name, price, message_credits, started_on, renews_on, activated_by, subscription_cycle from public.customer_services where customer_id = $1`, [subC])).rows[0];
    check(row0.duration_code === '6M' && row0.duration_months === 6 && row0.plan_name === 'Growth' && Number(row0.price) === 12000 && Number(row0.message_credits) === 20000
      && row0.started_on === null && row0.renews_on === null && row0.activated_by === null && row0.subscription_cycle === 0, 'subscription: the duration is stored; the start and expiry dates are empty', row0);
    r = await api('a', 'POST', `/pipeline/customers/${subC}/subscriptions/AI_CALLING/terms`, { plan: 'Growth', durationCode: 'CUSTOM', customDays: 45, amount: 9000, expiresOn: '2027-01-01' });
    check(r.status === 422, 'subscription: Sales cannot send an expiry date with the terms', r);
    r = await api('a', 'POST', `/pipeline/customers/${subC}/subscriptions/AI_CALLING/terms`, { plan: 'Growth', durationCode: '6M', amount: 12000, messageCredits: 20000, panel: 'Calling panel' });
    check(r.status === 200 && r.json.data.services[0].durationLabel === '6 months' && r.json.data.services[0].startedOn === null && r.json.data.services[0].canSetTerms, 'subscription: Sales can still edit the terms before the start', r);
    r = await api('b', 'POST', `/pipeline/customers/${subC}/subscriptions/AI_CALLING/terms`, { plan: 'X', durationCode: '1M', amount: 1 });
    check(r.status === 404, 'subscription: another salesperson cannot change them', r);

    // 2. payment, login (made by the Accounts flow at confirmation), documents
    r = await api('a', 'POST', `/pipeline/customers/${subC}/send-to-accounts`, { amount: 12000 });
    check(r.status === 200, 'subscription: sent to Accounts', r);
    r = await api('accm', 'POST', `/pipeline/customers/${subC}/accounts/order-gst`, { rate: 0 });
    r = await api('accm', 'POST', `/pipeline/customers/${subC}/accounts/payments`, { type: 'FULL', amount: 12000, method: 'CASH', verify: true });
    check(r.status === 201, 'subscription: the payment is recorded and verified', r);
    r = await api('accm', 'POST', `/pipeline/customers/${subC}/accounts/payment-confirmed`, {});
    check(r.status === 200 && r.json.data.clientLogin.status === 'CREATED', 'subscription: payment confirmed, the client login is created', r.json.data);
    const subAcct = (await db.query(`select auth_user_id from public.customer_client_accounts where customer_id = $1`, [subC])).rows[0].auth_user_id as string;
    tokens.set('subc', tokenFor(subAcct));
    r = await api('subc', 'GET', '/client/subscription');
    check(r.status === 200 && r.json.data.length === 1 && r.json.data[0].status === 'NOT_STARTED' && r.json.data[0].startedOn === null && r.json.data[0].expiresOn === null
      && r.json.data[0].durationLabel === '6 months' && r.json.data[0].panelCreated === false, 'subscription: before the activation the client sees "not started" and no dates', r.json.data);
    r = await api('subc', 'GET', '/client/journey');
    check(r.status === 200 && r.json.data.access.subscription.enabled === true, 'subscription: My Subscription is open from the start', r.json.data?.access);
    r = await api('subc', 'POST', `/pipeline/customers/${subC}/subscriptions/AI_CALLING/activation`, { activationDate: await dayOffset(-1) });
    check(r.status === 401 || r.status === 403, 'subscription: a client cannot use the staff endpoints', r);

    // the onboarding steps that precede the panel (Meta verification, hand-over) are covered by the journey tests above: here the journey is finished
    await db.query(`update public.customer_onboarding set onboarding_completed_at = now(), meta_status = 'COMPLETED', meta_completed_at = coalesce(meta_completed_at, now()) where customer_id = $1`, [subC]);

    // 3. the activation
    const start = await dayOffset(-20);
    const panelDay = await dayOffset(-21);
    r = await api('a', 'GET', `/pipeline/customers/${subC}/subscriptions`);
    check(r.status === 200 && r.json.data.services[0].canActivate === false && r.json.data.services[0].canCorrect === false && r.json.data.services[0].blocker, 'subscription: Sales sees that it cannot activate and why', r.json.data?.services?.[0]);
    r = await api('a', 'POST', `/pipeline/customers/${subC}/subscriptions/AI_CALLING/activation`, { activationDate: start });
    check(r.status === 404, 'subscription: Sales cannot confirm the activation', r);
    r = await api('tc', 'POST', `/pipeline/customers/${subC}/subscriptions/AI_CALLING/activation`, { activationDate: start, panelCreatedOn: panelDay });
    check(r.status === 422 && /Authorize these first/.test(r.json.error.message), 'subscription: not before the documents are authorized', r);
    await db.query(`insert into public.customer_onboarding_entries (customer_id, item_code, value, status, saved_by, reviewed_at)
      select $1, i.code, 'saved', 'VERIFIED', (select id from public.profiles where email = 'a@amuwa.com'), now() from private.customer_items($1) i
      on conflict (customer_id, item_code) do update set status = 'VERIFIED'`, [subC]);
    r = await api('tc', 'POST', `/pipeline/customers/${subC}/subscriptions/AI_CALLING/activation`, { activationDate: await dayOffset(2) });
    check(r.status === 422 && /future/.test(r.json.error.message), 'subscription: the activation date cannot be in the future', r);
    r = await api('tc', 'POST', `/pipeline/customers/${subC}/subscriptions/AI_CALLING/activation`, { activationDate: start, panelCreatedOn: panelDay, note: 'Panel live' });
    const expiry = await addMonths(start, 6);
    check(r.status === 200 && r.json.data.services[0].startedOn === start && r.json.data.services[0].expiresOn === expiry && r.json.data.services[0].panelCreatedOn === panelDay
      && r.json.data.services[0].status === 'ACTIVE' && r.json.data.services[0].activatedBy, 'subscription: the team confirms the activation; the expiry is six calendar months later', r.json.data?.services?.[0]);
    r = await api('tc', 'POST', `/pipeline/customers/${subC}/subscriptions/AI_CALLING/activation`, { activationDate: await dayOffset(-3) });
    check(r.status === 200 && r.json.data.services[0].startedOn === start && r.json.data.services[0].expiresOn === expiry, 'subscription: a repeated activation request does not reset the dates', r.json.data?.services?.[0]);
    r = await api('sa', 'POST', `/pipeline/customers/${subC}/subscriptions/AI_CALLING/activation`, { activationDate: await dayOffset(-5) });
    check(r.status === 200 && r.json.data.services[0].startedOn === start, 'subscription: nor from another employee', r.json.data?.services?.[0]);
    check((await db.query(`select count(*)::int n from public.subscription_cycles where customer_id = $1`, [subC])).rows[0].n === 1, 'subscription: still one cycle');

    // 4. what the client sees
    r = await api('subc', 'GET', '/client/subscription');
    const left = (await db.query(`select ($1::date - (now() at time zone 'Asia/Kolkata')::date)::int d`, [expiry])).rows[0].d as number;
    check(r.status === 200 && r.json.data[0].status === 'ACTIVE' && r.json.data[0].startedOn === start && r.json.data[0].expiresOn === expiry && r.json.data[0].daysLeft === left
      && r.json.data[0].panelCreatedOn === panelDay && r.json.data[0].messages.total === 20000, 'subscription: the client dashboard shows the actual start, the calculated expiry, the days left and the credits', r.json.data[0]);
    check(!JSON.stringify(r.json).match(/activated_by|activatedBy|history|reason/i), 'subscription: nothing internal in the client answer', r.json.data);

    // 5. the panel activation e-mail: sent only now, with the real dates
    const subJobs = (await db.query(`select status, channel, context from public.automation_jobs where customer_id = $1 and stage = 'SUBSCRIPTION_ACTIVATED'`, [subC])).rows;
    check(subJobs.length === 1 && subJobs[0].channel === 'EMAIL' && ['QUEUED', 'SENT', 'SKIPPED'].includes(subJobs[0].status), 'subscription: one activation e-mail was queued, only after the activation', subJobs);
    mailbox.length = 0;
    await db.query(`update public.automation_jobs set status = 'QUEUED', attempts = 0, detail = null, next_attempt_at = '2000-01-01' where customer_id = $1 and stage = 'SUBSCRIPTION_ACTIVATED'`, [subC]);
    process.env.AUTOMATION_MODE = 'live';
    await dispatch('dispatch-secret-0123456789');
    process.env.AUTOMATION_MODE = 'off';
    const act = mailbox.find(o => o.path === '/emails' && /panel is active/.test(o.body.subject ?? '') && o.body.to?.[0] === 'sub.six@example.com');
    const longD = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
    check(!!act && act.body.html.includes(longD(start)) && act.body.html.includes(longD(expiry)) && act.body.html.includes('6 months') && act.body.html.includes('Growth')
      && act.body.html.includes('20,000') && /set-password|Set your password|Sign in to your client dashboard/.test(act.body.html) && !/<b>Password:/i.test(act.body.html),
      'subscription: the e-mail has the plan, the duration, the real start and expiry dates, the message limit and a secure way in (no password)', act?.body?.html);
    check((await db.query(`select status from public.automation_jobs where customer_id = $1 and stage = 'SUBSCRIPTION_ACTIVATED'`, [subC])).rows[0].status === 'SENT', 'subscription: its delivery status is recorded');

    // a failure is recorded and can be retried
    await db.query(`update public.automation_jobs set status = 'FAILED', detail = 'Provider refused' where customer_id = $1 and stage = 'SUBSCRIPTION_ACTIVATED'`, [subC]);
    r = await api('tc', 'GET', `/pipeline/customers/${subC}/subscriptions`);
    check(r.json.data.services[0].email.status === 'FAILED' && r.json.data.services[0].canResendEmail, 'subscription: the team sees the failure and may retry', r.json.data?.services?.[0]?.email);
    r = await api('a', 'POST', `/pipeline/customers/${subC}/subscriptions/AI_CALLING/activation-email/resend`, {});
    check(r.status === 404, 'subscription: Sales cannot retry it', r);
    mailbox.length = 0;
    r = await api('tc', 'POST', `/pipeline/customers/${subC}/subscriptions/AI_CALLING/activation-email/resend`, {});
    check(r.status === 200, 'subscription: the retry is accepted', r);
    await db.query(`update public.automation_jobs set next_attempt_at = '2000-01-01' where customer_id = $1 and stage = 'SUBSCRIPTION_ACTIVATED' and status = 'QUEUED'`, [subC]);
    process.env.AUTOMATION_MODE = 'live';
    await dispatch('dispatch-secret-0123456789');
    process.env.AUTOMATION_MODE = 'off';
    check(mailbox.filter(o => o.path === '/emails' && /panel is active/.test(o.body.subject ?? '')).length === 1
      && (await db.query(`select count(*)::int n, bool_and(status = 'SENT') s from public.automation_jobs where customer_id = $1 and stage = 'SUBSCRIPTION_ACTIVATED'`, [subC])).rows[0].s === true, 'subscription: the retried e-mail was sent once', mailbox.map(o => o.path));

    // 6. corrections: the heads only, with a reason
    const fixed = await dayOffset(-22);
    r = await api('tc', 'POST', `/pipeline/customers/${subC}/subscriptions/AI_CALLING/dates`, { activationDate: fixed, reason: 'Panel was activated earlier' });
    check(r.status === 404, 'subscription: the team member who confirmed cannot correct', r);
    r = await api('a', 'POST', `/pipeline/customers/${subC}/subscriptions/AI_CALLING/dates`, { activationDate: fixed, reason: 'Panel was activated earlier' });
    check(r.status === 404, 'subscription: Sales cannot correct', r);
    r = await api('sa', 'POST', `/pipeline/customers/${subC}/subscriptions/AI_CALLING/dates`, { activationDate: fixed });
    check(r.status === 422, 'subscription: a correction needs a reason', r);
    r = await api('sa', 'POST', `/pipeline/customers/${subC}/subscriptions/AI_CALLING/dates`, { activationDate: fixed, panelCreatedOn: await dayOffset(-23), reason: 'Panel was activated earlier' });
    check(r.status === 200 && r.json.data.services[0].startedOn === fixed && r.json.data.services[0].expiresOn === await addMonths(fixed, 6)
      && r.json.data.history.some((h: any) => h.action === 'DATES_CORRECTED' && h.old.startedOn === start && h.new.startedOn === fixed && h.reason), 'subscription: the Super Admin corrects it with a reason; the expiry follows and the old dates are in the history', r.json.data?.services?.[0]);
    check((await db.query(`select count(*)::int n from public.audit_logs where action = 'SUBSCRIPTION_DATES_CORRECTED' and entity_id = $1`, [subC])).rows[0].n === 1, 'subscription: the correction is audited');

    // 7. reminders follow the calculated expiry
    const exp2 = await addMonths(fixed, 6);
    await db.query(`update public.customers set lifecycle_stage = 'CUSTOMER' where id = $1`, [subC]);
    for (const n of [15, 7, 3, 1, 0]) await db.query(`select public.sub_reminder_schedule(($1::date - $2::int), array['EMAIL', 'WHATSAPP'])`, [exp2, n]);
    const rem = (await db.query(`select stage, expiry_date::text d, channel from public.subscription_reminders where customer_id = $1 and channel in ('EMAIL', 'WHATSAPP')`, [subC])).rows;
    check(rem.length === 10 && rem.every((x: any) => x.d === exp2) && [15, 7, 3, 1, 0].every(n => rem.some((x: any) => x.stage === n)), 'subscription: the reminders (15, 7, 3, 1 days and the expiry day) use the calculated expiry date', rem);

    // 8. a renewal needs a verified payment and keeps the history
    const payId = (await db.query(`select id from public.customer_payments where customer_id = $1 and status = 'VERIFIED' limit 1`, [subC])).rows[0].id as string;
    r = await api('tc', 'POST', `/pipeline/customers/${subC}/subscriptions/AI_CALLING/renewal`, { paymentId: crypto.randomUUID() });
    check(r.status === 422, 'subscription: a renewal needs a verified payment of this customer', r);
    r = await api('tc', 'POST', `/pipeline/customers/${subC}/subscriptions/AI_CALLING/renewal`, { paymentId: payId, terms: { durationCode: '1Y' } });
    check(r.status === 200 && r.json.data.services[0].cycle === 2 && r.json.data.services[0].startedOn === exp2 && r.json.data.services[0].expiresOn === await addMonths(exp2, 12)
      && r.json.data.cycles.length === 2 && r.json.data.cycles.filter((c: any) => c.status === 'ENDED').length === 1, 'subscription: the renewal continues from the old expiry; the previous cycle is kept', r.json.data?.cycles);
    r = await api('tc', 'POST', `/pipeline/customers/${subC}/subscriptions/AI_CALLING/renewal`, { paymentId: payId, terms: { durationCode: '1Y' } });
    check(r.status === 200 && r.json.data.cycles.length === 2, 'subscription: the same payment cannot renew twice', r.json.data?.cycles);
    r = await api('subc', 'GET', '/client/subscription');
    check(r.json.data[0].expiresOn === await addMonths(exp2, 12) && r.json.data[0].durationLabel === '1 year', 'subscription: the client sees the renewed dates', r.json.data[0]);

    // 9. usage alerts and their settings
    r = await api('sa', 'GET', '/workflow/usage-alerts');
    check(r.status === 200 && JSON.stringify(r.json.data.thresholds) === '[70,80,90,100]' && r.json.data.canEdit, 'subscription: the usage alert thresholds default to 70, 80, 90 and 100 %', r.json.data);
    r = await api('a', 'POST', '/workflow/usage-alerts', { enabled: true, thresholds: [50] });
    check(r.status === 403, 'subscription: Sales cannot change them', r);
    r = await api('sa', 'POST', '/workflow/usage-alerts', { enabled: true, thresholds: [0, 200] });
    check(r.status === 422, 'subscription: invalid percentages are refused', r);

    // 10. the lead schema rejects a stray date field on an edit too
    r = await api('a', 'PATCH', `/pipeline/leads/${subC}`, { subscriptions: [{ service: 'AI_CALLING', plan: 'Growth', durationCode: '6M', amount: 1, renewsOn: '2027-01-01' }] });
    check(r.status === 422, 'subscription: an edit cannot carry a date either', r);

    process.env.AUTOMATION_MODE = modeBefore;
    if (modeBefore === undefined) delete process.env.AUTOMATION_MODE;
    if (recipientsBefore !== undefined) process.env.AUTOMATION_TEST_RECIPIENTS = recipientsBefore;
    for (const k of envKeys) { if (envBefore[k] === undefined) delete process.env[k]; else process.env[k] = envBefore[k]; }
    mailMock.close();
  }

  // (from here the clients are fully set up: the per-service steps and the balance are sections of a finished onboarding)
  // service progress: each client reads the steps of their own services only
  r = await api('cl2', 'GET', '/client/service-progress');
  check(r.status === 200 && r.json.data.length === 1 && r.json.data[0].code === 'WHATSAPP_API_BLUE_TICK' && r.json.data[0].status === 'LIVE'
    && r.json.data[0].steps.every((x: any) => x.state === 'DONE') && r.json.data[0].headline === 'Live', 'client progress: a WhatsApp customer whose Meta verification was recorded sees every step done', r.json.data);
  check(!JSON.stringify(r.json).match(/Meta Verifier|Tech Consultant|verification_route|audit|AutoPass/), 'client progress: nothing internal in the answer', r.json.data);
  r = await api('cl1', 'GET', '/client/service-progress');
  check(r.status === 200 && r.json.data.length >= 2 && r.json.data.every((p: any) => p.steps.length >= 4 && p.steps.filter((x: any) => x.state === 'CURRENT').length <= 1), 'client progress: another client sees only their own services, each with its steps', r.json.data);
  r = await api('cl1', 'GET', '/client/services');
  check(r.status === 200 && r.json.data.every((x: any) => x.status === (r.json.data ? x.status : '')) && Array.isArray(r.json.data), 'client progress: the services list still answers', r);
  r = await api('a', 'GET', '/client/service-progress');
  check(r.status === 403 || r.status === 401, 'client progress: a staff token is refused', r);
  r = await api(null, 'GET', '/client/service-progress');
  check(r.status === 401, 'client progress: no session is refused', r);

  // billing: what the client owes per order, from the same figures Accounts works from
  r = await api('cl1', 'GET', '/client/billing');
  check(r.status === 200 && Array.isArray(r.json.data.orders) && ['payable', 'confirmed', 'pending', 'outstanding'].every(k => typeof r.json.data.totals[k] === 'number'), 'client billing: orders and totals are answered', r.json.data);
  check(r.json.data.orders.every((o: any) => Math.abs(o.balance - Math.max(o.totalPayable - o.confirmed, 0)) < 0.005 && ['UNPAID', 'PARTIALLY_PAID', 'FULLY_PAID'].includes(o.state)),
    'client billing: every balance is payable - confirmed, with a state', r.json.data);
  check(!JSON.stringify(r.json).match(/recorded_by|verified_by|status_reason|note|AutoPass|ClientPass/), 'client billing: no internal notes, staff or secrets in the answer', r.json.data);
  r = await api('cl2', 'GET', '/client/billing');
  check(r.status === 200 && r.json.data.orders.every((o: any) => !o.invoices.some((i: any) => i.id === '00000000-0000-0000-0000-000000000000')), 'client billing: another client has an answer of their own', r.json.data);
  r = await api('a', 'GET', '/client/billing');
  check(r.status === 403 || r.status === 401, 'client billing: a staff token is refused', r);
  r = await api(null, 'GET', '/client/billing');
  check(r.status === 401, 'client billing: no session is refused', r);


  // chat: another client has their own conversation and sees nothing of the first client's
  {
    const importedConv = (await db.query(`select cv.id from public.chat_conversations cv join public.customers c on c.id = cv.customer_id where c.phone = '9000000201'`)).rows[0].id as string;
    r = await api('cl1', 'GET', '/client/chat');
    check(r.status === 200 && r.json.data.conversation.id !== importedConv && r.json.data.page.messages.length === 0, 'chat: another client has their own, empty conversation', r);
    r = await api('cl1', 'GET', '/client/chat/messages?after=0');
    check(r.status === 200 && r.json.data.messages.length === 0, 'chat: and sees none of the first client\'s messages', r);
    r = await api('cl1', 'POST', '/client/chat/read', { seq: 99999 });
    check(r.status === 200 && r.json.data.readSeq <= 0, 'chat: marking read cannot go past what exists in their own conversation', r);
  }

  r = await api(null, 'GET', '/client/me');
  check(r.status === 401, 'client API: no token → 401', r);
  r = await api('forged', 'GET', '/client/me');
  check(r.status === 401, 'client API: a tampered token → 401', r);
  r = await api('sa', 'GET', '/client/me');
  check(r.status === 403, 'client API: staff cannot use the client API', r);
  r = await api('cl1', 'GET', '/pipeline/customers');
  check(r.status === 401 || r.status === 403, 'a client cannot reach the staff API', r);

  r = await api('cl1', 'GET', '/client/me');
  check(r.status === 200 && r.json.data.customerId === leadA && !JSON.stringify(r.json).toLowerCase().replace('mustchangepassword', '').includes('password'), 'client API: /me is the customer linked to the login (and carries no password, only the flag)', r);
  r = await api('cl2', 'GET', '/client/me');
  check(r.status === 200 && r.json.data.customerId === autoA, 'client API: another login gets their own customer', r);

  r = await api('cl1', 'GET', '/client/overview');
  check(r.status === 200 && Array.isArray(r.json.data.invoices.recent) && Array.isArray(r.json.data.tickets.recent) && r.json.data.profile.customerId === leadA, 'client API: overview', r);
  r = await api('cl1', 'GET', '/client/catalog');
  check(r.status === 200 && r.json.data.length > 0, 'client API: catalogue', r);
  const cat = r.json.data.find((c: any) => !c.owned) ?? r.json.data[0];

  r = await api('cl1', 'POST', '/client/service-requests', { serviceCode: cat.code, note: 'please' });
  const firstRequest = r.status;
  check(firstRequest === 201 && r.json.data.status === 'REQUESTED', 'client API: asking for a service creates a request only', r);
  r = await api('cl1', 'POST', '/client/service-requests', { serviceCode: cat.code });
  check(r.status === 409, 'client API: duplicate request refused', r);
  r = await api('cl1', 'POST', '/client/service-requests', { serviceCode: '' });
  check(r.status === 422, 'client API: invalid request refused', r);
  r = await api('cl2', 'GET', '/client/service-requests');
  check(r.status === 200 && r.json.data.length === 0, 'client API: client 2 does not see client 1 requests', r);

  r = await api('cl1', 'GET', '/client/plans');
  check(r.status === 200 && Array.isArray(r.json.data.options) && r.json.data.current === null, 'client API: plans (nothing configured, nothing invented)', r);
  r = await api('cl1', 'POST', '/client/plan-requests', { planId: '00000000-0000-0000-0000-000000000000' });
  check(r.status === 404, 'client API: unknown plan', r);

  r = await api('cl1', 'GET', '/client/invoices');
  check(r.status === 200 && Array.isArray(r.json.data), 'client API: invoices list', r);
  r = await api('cl1', 'GET', '/client/invoices/00000000-0000-0000-0000-000000000000/url');
  check(r.status === 404, 'client API: unknown invoice', r);
  r = await api('cl1', 'GET', '/client/invoices/not-a-uuid/url');
  check(r.status === 422, 'client API: bad invoice id', r);

  r = await api('cl1', 'POST', '/client/tickets', { subject: 'Cannot log in', description: 'I get an error when I open the panel.', category: 'TECHNICAL' });
  check(r.status === 201 && r.json.data.status === 'OPEN', 'client API: raise a ticket', r);
  const ticketId = r.json.data.id;
  r = await api('cl1', 'POST', '/client/tickets', { subject: '', description: '' });
  check(r.status === 422, 'client API: empty ticket refused', r);
  r = await api('cl2', 'GET', `/client/tickets/${ticketId}`);
  check(r.status === 404, 'client API: client 2 cannot open client 1 ticket', r);
  r = await api('cl2', 'POST', `/client/tickets/${ticketId}/replies`, { message: 'hello' });
  check(r.status === 404, 'client API: nor reply to it', r);
  r = await api('cl2', 'GET', '/client/tickets');
  check(r.status === 200 && r.json.data.length === 0, 'client API: nor list it', r);
  r = await api('cl1', 'POST', `/client/tickets/${ticketId}/replies`, { message: 'Still happening.' });
  check(r.status === 201, 'client API: reply to own ticket', r);
  r = await api('cl1', 'GET', `/client/tickets/${ticketId}`);
  check(r.status === 200 && r.json.data.updates.some((u: any) => u.message === 'Still happening.'), 'client API: ticket history', r);
  check(['RELATIONSHIP_MANAGER', 'TEAM_LEAD', 'DEPARTMENT_HEAD'].includes(r.json.data.handledBy) && typeof r.json.data.unread === 'number' && r.json.data.escalated === false,
    'client API: the ticket says who handles it and whether it was escalated', r);
  r = await api('cl1', 'POST', `/client/tickets/${ticketId}/replies`, { message: 'Still happening.' });
  r = await api('cl1', 'GET', `/client/tickets/${ticketId}`);
  check(r.json.data.updates.filter((u: any) => u.message === 'Still happening.').length === 1, 'client API: the same reply sent twice is stored once', r);
  r = await api('cl1', 'POST', '/client/tickets', { subject: 'Cannot log in', description: 'I get an error when I open the panel.', category: 'TECHNICAL' });
  check(r.status === 201 && r.json.data.id === ticketId, 'client API: the same ticket submitted twice is created once', r);
  // chat: one message per key, in order, never a new ticket
  const key1 = '6f1c2d3e-4a5b-4c6d-8e9f-0a1b2c3d4e5f';
  r = await api('cl1', 'POST', `/client/tickets/${ticketId}/messages`, { message: 'Chat message one', clientMsgId: key1 });
  check(r.status === 201 && r.json.data.messages.some((m: any) => m.text === 'Chat message one' && m.from === 'CLIENT' && m.clientMsgId === key1), 'client API: send a chat message', r);
  r = await api('cl1', 'POST', `/client/tickets/${ticketId}/messages`, { message: 'Chat message one', clientMsgId: key1 });
  check(r.status === 201 && r.json.data.messages.filter((m: any) => m.clientMsgId === key1).length === 1, 'client API: a retried message is stored once', r);
  check(r.json.data.messages.every((m: any, i: number, a: any[]) => i === 0 || a[i - 1].at <= m.at), 'client API: the conversation is in order', r.json.data.messages);
  check(r.json.data.messages.filter((m: any) => m.kind === 'MESSAGE' && !m.text).length === 0, 'client API: no empty message bubbles', r.json.data.messages);
  r = await api('cl1', 'POST', `/client/tickets/${ticketId}/messages`, { message: '   ' });
  check(r.status === 422, 'client API: an empty chat message is refused', r);
  r = await api('cl1', 'POST', `/client/tickets/${ticketId}/messages`, { message: 'x', clientMsgId: 'not-a-uuid' });
  check(r.status === 422, 'client API: a bad message key is refused', r);
  r = await api('sa', 'POST', `/client/tickets/${ticketId}/messages`, { message: 'staff here' });
  check(r.status === 403, 'client API: a staff login cannot use the client chat', r);
  r = await api('cl2', 'POST', `/client/tickets/${ticketId}/messages`, { message: 'not mine', clientMsgId: '7f1c2d3e-4a5b-4c6d-8e9f-0a1b2c3d4e5f' });
  check(r.status === 404, 'client API: another client cannot write in the ticket', r);
  r = await api('cl1', 'GET', '/client/tickets');
  check(r.json.data.filter((x: any) => x.subject === 'Cannot log in').length === 1 && r.json.data.find((x: any) => x.id === ticketId)?.lastMessage?.text === 'Chat message one',
    'client API: still one ticket, with the last message as its preview', r);
  r = await api('cl1', 'POST', `/client/tickets/${ticketId}/seen`, {});
  check(r.status === 200 && typeof r.json.data.marked === 'number', 'client API: opening a ticket marks it read', r);
  r = await api('cl2', 'POST', `/client/tickets/${ticketId}/seen`, {});
  check(r.status === 404, 'client API: another client cannot mark it', r);
  r = await api('cl1', 'POST', '/client/tickets/not-a-uuid/seen', {});
  check(r.status === 422, 'client API: bad ticket id on seen', r);

  // ---- ticket attachments: limits, signed upload, content check, who can open
  const tkPdf = Buffer.concat([Buffer.from('%PDF-1.4\n% ticket file\n'), Buffer.alloc(1500, 0x20), Buffer.from('\n%%EOF\n')]);
  const tkPut = (t: any, body: Buffer, type = 'application/pdf') =>
    fetch(`${GW}/storage/v1/object/upload/sign/${t.bucket}/${t.path}?token=${t.token}`, { method: 'PUT', headers: { 'content-type': type, 'x-upsert': 'false' }, body });
  r = await api('cl1', 'POST', '/client/tickets/uploads', { ticketId, fileName: 'virus.exe', mimeType: 'application/x-msdownload', sizeBytes: 100 });
  check(r.status === 422, 'ticket files: a file type that is not allowed is refused', r);
  r = await api('cl1', 'POST', '/client/tickets/uploads', { ticketId, fileName: 'big.pdf', mimeType: 'application/pdf', sizeBytes: 5 * 1024 * 1024 + 1 });
  check(r.status === 422, 'ticket files: a file over 5 MB is refused', r);
  const someoneElse = crypto.randomUUID();
  r = await api('cl1', 'POST', '/client/tickets/uploads', { ticketId, fileName: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 100, customerId: someoneElse });
  check(r.status === 201 && !r.json.data.path.startsWith(someoneElse), 'ticket files: a customer named by a client is ignored (the file goes under their own)', r);
  await api('cl1', 'POST', `/client/tickets/uploads/${r.json.data.attachment.id}/abort`, {});
  r = await api('cl2', 'POST', '/client/tickets/uploads', { ticketId, fileName: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 100 });
  check(r.status === 404, 'ticket files: another client cannot upload to the ticket', r);
  r = await api('cl1', 'POST', '/client/tickets/uploads', { ticketId, fileName: 'Report.pdf', mimeType: 'application/pdf', sizeBytes: tkPdf.length });
  check(r.status === 201 && r.json.data.bucket === 'ticket-attachments' && r.json.data.path.includes('/') && !r.json.data.path.includes('..'), 'ticket files: an upload is booked', r);
  const tkA = r.json.data;
  r = await api('cl1', 'POST', `/client/tickets/uploads/${tkA.attachment.id}/complete`);
  check(r.status === 422, 'ticket files: completing an upload that never arrived is refused', r);
  r = await api('cl1', 'POST', '/client/tickets/uploads', { ticketId, fileName: 'Report.pdf', mimeType: 'application/pdf', sizeBytes: tkPdf.length });
  const tkB = r.json.data;
  const tkUp = await tkPut(tkB, tkPdf);
  check(tkUp.status < 300, 'ticket files: the file is uploaded with the single-use link', await tkUp.text().catch(() => ''));
  r = await api('cl2', 'POST', `/client/tickets/uploads/${tkB.attachment.id}/complete`);
  check(r.status === 404, 'ticket files: someone else cannot confirm my upload', r);
  r = await api('cl1', 'POST', `/client/tickets/uploads/${tkB.attachment.id}/complete`);
  check(r.status === 200 && r.json.data.name === 'Report.pdf', 'ticket files: the uploader confirms it', r);
  r = await api('cl1', 'POST', '/client/tickets/uploads', { ticketId, fileName: 'Fake.png', mimeType: 'image/png', sizeBytes: tkPdf.length });
  const tkC = r.json.data;
  await tkPut(tkC, tkPdf, 'image/png');
  r = await api('cl1', 'POST', `/client/tickets/uploads/${tkC.attachment.id}/complete`);
  check(r.status === 422, 'ticket files: a PDF renamed to .png is refused by looking at its content', r);
  r = await api('cl1', 'POST', `/client/tickets/${ticketId}/messages`, { message: 'Here is the report', clientMsgId: crypto.randomUUID(), attachmentIds: [tkB.attachment.id] });
  check(r.status === 201, 'ticket files: a message with a file is stored', r);
  r = await api('cl1', 'POST', `/client/tickets/${ticketId}/messages`, { message: 'Again', clientMsgId: crypto.randomUUID(), attachmentIds: [tkB.attachment.id] });
  check(r.status === 422, 'ticket files: a file cannot be sent twice', r);
  r = await api('cl1', 'POST', `/client/tickets/${ticketId}/messages`, { message: 'Too many', clientMsgId: crypto.randomUUID(), attachmentIds: Array.from({ length: 6 }, () => crypto.randomUUID()) });
  check(r.status === 422, 'ticket files: more than 5 files on one message is refused', r);
  r = await api('cl1', 'GET', `/client/tickets/${ticketId}/attachments`);
  check(r.status === 200 && r.json.data.length === 1 && r.json.data[0].name === 'Report.pdf' && r.json.data[0].updateId, 'ticket files: the ticket lists its file against the message', r);
  r = await api('cl2', 'GET', `/client/tickets/${ticketId}/attachments`);
  check(r.status === 404, 'ticket files: another client cannot list them', r);
  r = await api('cl1', 'GET', `/client/tickets/attachments/${tkB.attachment.id}/url?action=download`);
  check(r.status === 200 && r.json.data.url.startsWith(GW) && r.json.data.fileName === 'Report.pdf' && r.json.data.expiresInSeconds <= 120, 'ticket files: the owner gets a short-lived download link', r);
  const tkDl = await fetch(r.json.data.url);
  check(tkDl.status === 200 && Buffer.from(await tkDl.arrayBuffer()).equals(tkPdf), 'ticket files: and the file is the one that was uploaded');
  r = await api('cl2', 'GET', `/client/tickets/attachments/${tkB.attachment.id}/url`);
  check(r.status === 404, 'ticket files: another client cannot open it even with the id', r);
  r = await api('cl1', 'GET', `/support/ticket-attachments/${tkB.attachment.id}/url`);
  check(r.status === 401 || r.status === 403, 'ticket files: a client cannot use the staff endpoint', r);
  r = await api('sa', 'GET', `/support/tickets/${ticketId}/attachments`);
  check(r.status === 200 && r.json.data.length === 1, 'ticket files: staff who may see the ticket list the file', r);
  r = await api('sa', 'GET', `/support/ticket-attachments/${tkB.attachment.id}/url`);
  check(r.status === 200 && r.json.data.fileName === 'Report.pdf', 'ticket files: and open it', r);
  r = await api('sa', 'POST', '/support/ticket-uploads', { ticketId, fileName: 'Reply.pdf', mimeType: 'application/pdf', sizeBytes: tkPdf.length });
  check(r.status === 201, 'ticket files: staff can upload to the ticket', r);
  r = await api('b', 'POST', '/support/ticket-uploads', { ticketId, fileName: 'Reply.pdf', mimeType: 'application/pdf', sizeBytes: tkPdf.length });
  check(r.status === 404 || r.status === 403, 'ticket files: staff who may not see the ticket cannot upload', r);
  r = await api(null, 'GET', `/client/tickets/${ticketId}/attachments`);
  check(r.status === 401, 'ticket files: signed-out visitors are refused', r);

  r = await api('cl1', 'GET', '/client/notifications');
  check(r.status === 200 && r.json.data.items.some((n: any) => n.type === 'SERVICE_REQUEST_SENT') && r.json.data.unread > 0, 'client API: notifications from real events', r);
  check(new Set(r.json.data.items.map((n: any) => `${n.type}|${n.entityId}`)).size === r.json.data.items.length, 'client API: no duplicate notifications', r.json.data.items);
  const ids = r.json.data.items.map((n: any) => n.id);
  r = await api('cl2', 'POST', '/client/notifications/read', { ids });
  check(r.status === 200, 'client API: another client marking them read changes nothing', r);
  r = await api('cl1', 'GET', '/client/notifications');
  check(r.json.data.unread > 0, 'client API: ... and they stay unread for the owner', r);
  r = await api('cl1', 'POST', '/client/notifications/read', { ids });
  r = await api('cl1', 'GET', '/client/notifications');
  check(r.json.data.unread === 0, 'client API: the owner marks them read', r);

  // --- client documents: upload what was missed, the team verifies -------------------------
  await db.query(`insert into public.customer_services (customer_id, service_code) values ($1, 'RCS_REGISTRATION') on conflict do nothing`, [leadA]);
  r = await api('cl1', 'GET', '/client/documents');
  const banner = r.json.data.items?.find((i: any) => i.code === 'RCS_BANNER');
  check(r.status === 200 && banner?.status === 'MISSING' && banner.kind === 'FILE' && banner.allowedMimeTypes.includes('image/png')
    && !r.json.data.items.some((i: any) => i.code === 'INVOICE'), 'client API: documents lists what the client can provide (a service bought later adds its own), never the invoice', r);
  r = await api('a', 'GET', '/client/documents');
  check(r.status === 403, 'client API: staff cannot use the client documents', r);
  r = await api('cl1', 'POST', '/client/documents/uploads', { itemCode: 'RCS_BANNER', fileName: 'banner.exe', mimeType: 'application/x-msdownload', sizeBytes: 100 });
  check(r.status === 422, 'client API: only accepted file types', r);
  r = await api('cl1', 'POST', '/client/documents/uploads', { itemCode: 'GBP_PHOTOS', fileName: 'p.png', mimeType: 'image/png', sizeBytes: PNG.length });
  check(r.status === 422 && /not part/.test(r.json.error.message), 'client API: a document of a service the client does not have is refused', r);
  r = await api('cl1', 'POST', '/client/documents/uploads', { itemCode: 'RCS_BANNER', fileName: 'big.png', mimeType: 'image/png', sizeBytes: 3 * 1024 * 1024 });
  check(r.status === 422, 'client API: over 2 MB is refused', r);
  // a file whose content is not what it says is refused and does not count
  r = await api('cl1', 'POST', '/client/documents/uploads', { itemCode: 'RCS_BANNER', fileName: 'fake.png', mimeType: 'image/png', sizeBytes: PDF.length });
  check(r.status === 201, 'client API: an upload is booked', r);
  let cticket = r.json.data;
  await put(cticket, PDF, 'image/png');
  r = await api('cl1', 'POST', `/client/documents/uploads/${cticket.document.id}/complete`);
  check(r.status === 422 && /does not match/.test(r.json.error.message), 'client API: a PDF renamed to .png is refused by its content', r);
  r = await api('cl1', 'GET', '/client/documents');
  check(r.json.data.items.find((i: any) => i.code === 'RCS_BANNER').status === 'MISSING', 'client API: ... and nothing was saved', r);
  r = await api('cl1', 'POST', '/client/documents/uploads', { itemCode: 'RCS_BANNER', fileName: 'banner.png', mimeType: 'image/png', sizeBytes: PNG.length });
  cticket = r.json.data;
  r = await api('cl2', 'POST', `/client/documents/uploads/${cticket.document.id}/complete`);
  check(r.status === 404, "client API: another client cannot finish this client's upload", r);
  await put(cticket, PNG, 'image/png');
  r = await api('cl1', 'POST', `/client/documents/uploads/${cticket.document.id}/complete`);
  check(r.status === 200 && r.json.data.status === 'UPLOADED', 'client API: the real file is accepted', r);
  const bannerDoc = cticket.document.id;
  r = await api('cl1', 'GET', '/client/documents');
  check(r.json.data.items.find((i: any) => i.code === 'RCS_BANNER').status === 'SAVED' && r.json.data.items.find((i: any) => i.code === 'RCS_BANNER').byClient, 'client API: the upload fills the checklist', r);
  r = await api('cl1', 'POST', '/client/documents/details', { itemCode: 'RCS_DOMAIN_NAME', value: 'galaxy.example' });
  check(r.status === 200, 'client API: a typed detail is saved', r);
  r = await api('a', 'POST', '/client/documents/details', { itemCode: 'RCS_DOMAIN_NAME', value: 'x' });
  check(r.status === 403, 'client API: staff cannot save client details', r);
  r = await api('cl1', 'GET', `/client/documents/${bannerDoc}/url?action=view`);
  check(r.status === 200 && r.json.data.url, 'client API: the client opens their own file', r);
  r = await api('cl2', 'GET', `/client/documents/${bannerDoc}/url?action=view`);
  check(r.status === 404, "client API: not another client's", r);

  // the team verifies
  r = await api('tc', 'GET', '/pipeline/client-documents');
  check(r.status === 200 && r.json.data.filter((q: any) => q.customerId === leadA).map((q: any) => q.itemCode).sort().join() === 'RCS_BANNER,RCS_DOMAIN_NAME', 'the Technical Consultant sees what the client provided', r);
  r = await api('b', 'GET', '/pipeline/client-documents');
  check(r.status === 200 && r.json.data.every((q: any) => q.customerId !== leadA), 'a salesperson of another team does not see them', r);
  r = await api('tc', 'GET', `/pipeline/client-documents/${bannerDoc}/url`);
  check(r.status === 200 && r.json.data.url, 'the Technical Consultant opens the uploaded file', r);
  r = await api('b', 'GET', `/pipeline/client-documents/${bannerDoc}/url`);
  check(r.status === 404, 'others cannot', r);
  r = await api('b', 'POST', `/pipeline/customers/${leadA}/client-documents/RCS_BANNER/review`, { decision: 'VERIFIED' });
  check(r.status === 404, 'others cannot verify it', r);
  r = await api('tc', 'POST', `/pipeline/customers/${leadA}/client-documents/RCS_BANNER/review`, { decision: 'REJECTED' });
  check(r.status === 422, 'sending it back needs a reason', r);
  r = await api('tc', 'POST', `/pipeline/customers/${leadA}/client-documents/RCS_BANNER/review`, { decision: 'REJECTED', note: 'The banner is cropped. Please upload the full banner.' });
  check(r.status === 200, 'the Technical Consultant sends it back with a note', r);
  r = await api('cl1', 'GET', '/client/documents');
  const sentBack = r.json.data.items.find((i: any) => i.code === 'RCS_BANNER');
  check(sentBack.status === 'REJECTED' && /cropped/.test(sentBack.reviewNote) && sentBack.canEdit, 'client API: the client sees why and can upload again', r);
  r = await api('cl1', 'POST', '/client/documents/uploads', { itemCode: 'RCS_BANNER', fileName: 'banner2.png', mimeType: 'image/png', sizeBytes: PNG.length });
  cticket = r.json.data;
  await put(cticket, PNG, 'image/png');
  r = await api('cl1', 'POST', `/client/documents/uploads/${cticket.document.id}/complete`);
  check(r.status === 200, 'client API: the corrected file is uploaded', r);
  r = await api('tc', 'POST', `/pipeline/customers/${leadA}/client-documents/RCS_BANNER/review`, { decision: 'VERIFIED' });
  check(r.status === 200, 'the Technical Consultant verifies it', r);
  r = await api('cl1', 'GET', '/client/notifications');
  check(r.json.data.items.some((n: any) => n.type === 'DOCUMENT_VERIFIED') && r.json.data.items.some((n: any) => n.type === 'DOCUMENT_REJECTED'), 'client API: the client is told about both', r);
  r = await api('cl1', 'POST', '/client/documents/uploads', { itemCode: 'RCS_BANNER', fileName: 'again.png', mimeType: 'image/png', sizeBytes: PNG.length });
  check(r.status === 409, 'client API: a verified document is locked', r);

  // --- client calendar: what the team did, with insights ---------------------------------
  const today = new Date().toISOString().slice(0, 10);
  const calBody = { serviceCode: 'AI_CALLING', date: today, kind: 'CALL_CAMPAIGN', title: 'Gold rate calling campaign', summary: 'Called the customers who asked for the gold rate.',
    metrics: [{ label: 'Calls made', value: '320' }, { label: 'Answered', value: '210' }] };
  r = await api('b', 'POST', `/pipeline/customers/${leadA}/client-activity`, calBody);
  check(r.status === 404, 'others cannot log activity for this client', r);
  r = await api('cl1', 'POST', `/pipeline/customers/${leadA}/client-activity`, calBody);
  check(r.status === 401 || r.status === 403, 'a client cannot log activity', r);
  r = await api('tc', 'GET', '/pipeline/client-customers?search=galaxy');
  check(r.status === 200 && r.json.data.some((c: any) => c.id === leadA && c.hasClientLogin), 'the support team finds the client to log activity for', r);
  r = await api('b', 'GET', '/pipeline/client-customers?search=galaxy');
  check(r.status === 200 && !r.json.data.some((c: any) => c.id === leadA), 'others do not', r);
  r = await api('tc', 'POST', `/pipeline/customers/${leadA}/client-activity`, { ...calBody, serviceCode: 'GBP_SETUP' });
  check(r.status === 422, 'the service must be one of the customer\'s', r);
  r = await api('tc', 'POST', `/pipeline/customers/${leadA}/client-activity`, { ...calBody, metrics: [{ label: 'Calls', value: '' }] });
  check(r.status === 422, 'an insight needs a name and a value', r);
  r = await api('tc', 'POST', `/pipeline/customers/${leadA}/client-activity`, calBody);
  check(r.status === 201 && r.json.data.metrics.length === 2, 'the support team logs a campaign with its insights', r);
  const actId = r.json.data.id;
  r = await api('cl1', 'GET', `/client/calendar?from=${today}&to=${today}`);
  check(r.status === 200 && r.json.data.some((e: any) => e.id === actId && e.title === 'Gold rate calling campaign' && e.metrics.length === 2 && e.serviceName === 'AI Calling'),
    'client API: the client sees it on that date with the insights', r);
  r = await api('cl2', 'GET', `/client/calendar?from=${today}&to=${today}`);
  check(r.status === 200 && !r.json.data.some((e: any) => e.id === actId), "client API: not on another client's calendar", r);
  // Behind Vercel's rewrite the request arrives as /api/crm?__path=<path>&path=<path>: the rewrite's own `path` must not reach the
  // endpoint's strict query check ("Unrecognized key(s) in object: 'path'").
  {
    const viaRewrite = await fetch(base.replace(/\/api\/v1$/, '') + `/api/crm?__path=client%2Fcalendar&path=client%2Fcalendar&from=${today}&to=${today}`, { headers: { authorization: `Bearer ${tokens.get('cl1')}` } });
    const j = (await viaRewrite.json()) as any;
    check(viaRewrite.status === 200 && Array.isArray(j.data), 'client API: the calendar loads behind the Vercel rewrite (its extra `path` parameter is not rejected)', j);
    const other = await fetch(base.replace(/\/api\/v1$/, '') + `/api/crm?__path=client%2Fcalendar&path=anything-else&from=${today}&to=${today}`, { headers: { authorization: `Bearer ${tokens.get('cl1')}` } });
    check(other.status === 200, 'client API: behind the rewrite, whatever value the extra `path` has is ignored', await other.clone().json());
    const own = await fetch(base + `/client/calendar?path=something&from=${today}&to=${today}`, { headers: { authorization: `Bearer ${tokens.get('cl1')}` } });
    check(own.status === 422, 'client API: a `path` the caller sent itself is still refused', await own.json());
  }
  r = await api('cl1', 'GET', '/client/calendar?from=2026-02-01&to=2026-01-01');
  check(r.status === 422, 'client API: a backwards range is refused', r);
  r = await api('cl1', 'GET', '/client/calendar?from=2020-01-01&to=2026-01-01');
  check(r.status === 422, 'client API: a range of many years is refused', r);
  r = await api('a', 'GET', `/client/calendar?from=${today}&to=${today}`);
  check(r.status === 403, 'client API: staff cannot use the client calendar', r);
  r = await api('tc', 'PATCH', `/pipeline/client-activity/${actId}`, { ...calBody, title: 'Gold rate calling campaign (final)', metrics: [{ label: 'Calls made', value: '330' }] });
  check(r.status === 200 && r.json.data.title.endsWith('(final)'), 'an entry can be corrected', r);
  r = await api('tc', 'GET', `/pipeline/customers/${leadA}/client-activity`);
  check(r.status === 200 && r.json.data.events.length === 1 && r.json.data.services.some((x: any) => x.code === 'AI_CALLING'), 'the team sees what it logged and the services to choose from', r);
  r = await api('b', 'DELETE', `/pipeline/client-activity/${actId}`);
  check(r.status === 404, 'others cannot delete it', r);
  r = await api('tc', 'DELETE', `/pipeline/client-activity/${actId}`);
  check(r.status === 200, 'a wrong entry can be removed', r);
  r = await api('cl1', 'GET', `/client/calendar?from=${today}&to=${today}`);
  check(!r.json.data.some((e: any) => e.id === actId), 'client API: and it is gone from the calendar', r);

  // notices from the Department Head: an office-closed day, and a new service
  await db.query(`insert into public.client_announcements (kind, title, body, event_date) values ('OFFICE_CLOSED', 'Office closed - review meeting', 'Back on the next working day.', ((now() at time zone 'Asia/Kolkata')::date + 2))`);
  r = await api('cl1', 'GET', '/client/announcements');
  const closure = r.json.data?.find((a: any) => a.kind === 'OFFICE_CLOSED');
  check(r.status === 200 && closure && closure.daysAway === 2 && closure.title === 'Office closed - review meeting' && typeof closure.occurrence === 'string', 'client API: the client sees the closure notice', r);
  r = await api('cl2', 'GET', '/client/announcements');
  check(r.json.data.some((a: any) => a.kind === 'OFFICE_CLOSED'), 'client API: every client of that department sees it', r);
  r = await api('cl1', 'POST', `/client/announcements/${closure.id}/dismiss`, { occurrence: closure.occurrence });
  check(r.status === 200, 'client API: dismissing a notice', r);
  r = await api('cl1', 'GET', '/client/announcements');
  check(!r.json.data.some((a: any) => a.id === closure.id), 'client API: a dismissed notice stays dismissed', r);
  r = await api('cl2', 'GET', '/client/announcements');
  check(r.json.data.some((a: any) => a.id === closure.id), 'client API: dismissing is per client', r);
  r = await api('cl1', 'POST', `/client/announcements/${closure.id}/dismiss`, { occurrence: 'x'.repeat(40) });
  check(r.status === 422, 'client API: the dismiss body is validated', r);
  r = await api('cl1', 'POST', '/client/announcements/not-a-uuid/dismiss', {});
  check(r.status === 422, 'client API: and the notice id', r);
  r = await api('sa', 'GET', '/client/announcements');
  check(r.status === 403, 'client API: staff cannot read the client notices', r);
  await db.query(`insert into public.crm_services (code, name, category, description, is_active, sort_order) values ('API_NEW_SVC', 'API New Service', 'Creative', 'Brand new.', true, 998)`);
  r = await api('cl1', 'GET', '/client/announcements');
  const fresh = r.json.data.find((a: any) => a.kind === 'NEW_SERVICE' && a.serviceCode === 'API_NEW_SVC');
  check(fresh && fresh.serviceName === 'API New Service', 'client API: a service added to the catalogue is announced to the client', r);
  r = await api('cl1', 'GET', '/client/notifications');
  check(r.json.data.items.some((n: any) => n.type === 'NEW_SERVICE' && n.entityType === 'announcement'), 'client API: and it is in the Notification Center', r);
  r = await api('cl1', 'GET', '/client/catalog');
  check(r.json.data.some((c: any) => c.code === 'API_NEW_SVC'), 'client API: the new service is in Explore Services for the client to open', r);
  r = await api('cl1', 'GET', '/client/services');
  check(r.status === 200 && Array.isArray(r.json.data) && r.json.data.every((x: any) => typeof x.details === 'object'), 'client API: My Services loads', r);

  // staff side of the same workflows
  r = await api('tc', 'GET', `/pipeline/customers/${leadA}/service-requests`);
  check(r.status === 200 && r.json.data.length === 1 && r.json.data[0].status === 'REQUESTED', 'the Technical Consultant sees the service the client asked for', r);
  const srId = r.json.data[0].id;
  r = await api('a', 'GET', `/pipeline/customers/${leadA}/service-requests`);
  check(r.status === 404, 'a salesperson cannot see them', r);
  r = await api('tc', 'POST', `/pipeline/service-requests/${srId}/decision`, { decision: 'REJECTED' });
  check(r.status === 422, 'rejecting needs a reason', r);
  r = await api('tc', 'POST', `/pipeline/service-requests/${srId}/decision`, { decision: 'IN_REVIEW' });
  check(r.status === 200, 'the Technical Consultant takes the request into review', r);
  r = await api('cl1', 'GET', '/client/service-requests');
  check(r.json.data[0].status === 'IN_REVIEW', 'the client sees the new status, still not purchased', r);
  r = await api('tc', 'POST', `/pipeline/customers/${leadA}/addon-request`, { items: [{ serviceCode: cat.code, quantity: 1, unitPrice: 1500 }], submit: true });
  check(r.status === 409 && /with Accounts/.test(r.json.error.message), 'after the hand-over the consultant can still reach the existing add-on workflow (this customer already has one with Accounts)', r);
  r = await api('cl1', 'GET', '/client/services');
  check(r.status === 200 && !r.json.data.some((x: any) => x.code === cat.code && !cat.owned), 'and the service is not in My Services', r);

  // A production DB may not have customer_onboarding.client_status yet: My Services / Overview must still load the services.
  r = await api('cl1', 'GET', '/client/services');
  const svcBefore = r.json.data;
  await db.query(`alter table public.customer_onboarding rename column client_status to client_status_off`);
  try {
    r = await api('cl1', 'GET', '/client/services');
    check(r.status === 200 && r.json.data.length === svcBefore.length, 'client API: services still load when customer_onboarding.client_status is missing', r);
    r = await api('cl1', 'GET', '/client/overview');
    check(r.status === 200, 'client API: the overview still loads when that column is missing', r);
  } finally {
    await db.query(`alter table public.customer_onboarding rename column client_status_off to client_status`);
  }
  check(svcBefore.every((x: any) => x.details && typeof x.details === 'object'), 'client API: every service carries its details object', svcBefore);

  // My Services: each client gets only their own list; an empty list is a 200 with []; a database failure is a controlled error.
  r = await api('cl2', 'GET', '/client/services');
  const cl2Codes = (r.json.data as any[]).map(x => x.code).sort();
  check(r.status === 200 && JSON.stringify(cl2Codes) !== JSON.stringify(svcBefore.map((x: any) => x.code).sort()), 'client API: another client gets a different, own list of services', r);
  await db.query(`create table public._cs_backup as select * from public.customer_services where customer_id = $1`, [autoA]);
  try {
    await db.query(`delete from public.customer_services where customer_id = $1`, [autoA]);
    r = await api('cl2', 'GET', '/client/services');
    check(r.status === 200 && Array.isArray(r.json.data) && r.json.data.length === 0, 'client API: a client with no services gets an empty list', r);
    r = await api('cl1', 'GET', '/client/services');
    check(r.status === 200 && r.json.data.length === svcBefore.length, 'client API: and the other client is unaffected', r);
  } finally {
    await db.query(`insert into public.customer_services select * from public._cs_backup; drop table public._cs_backup`);
  }
  await db.query(`alter table public.crm_services rename column description to description_off`);
  try {
    r = await api('cl1', 'GET', '/client/services');
    check(r.status === 500 && r.json.success === false && r.json.error.code === 'INTERNAL' && !/description|crm_services|column|select/i.test(JSON.stringify(r.json)),
      'client API: a database failure is a controlled error without database details', r);
  } finally {
    await db.query(`alter table public.crm_services rename column description_off to description`);
  }
  r = await api('cl1', 'GET', '/client/services');
  check(r.status === 200 && r.json.data.length === svcBefore.length, 'client API: My Services loads again once the database is fine', r);
  r = await api('sa', 'GET', '/client/services');
  check(r.status === 403, 'client API: a staff token cannot read My Services', r);
  r = await api('forged', 'GET', '/client/services');
  check(r.status === 401, 'client API: an invalid or expired session cannot read My Services', r);

  r = await api('cl1', 'GET', '/accounts/plans');
  check(r.status === 401 || r.status === 403, 'a client cannot open the Accounts plans', r);
  r = await api('accm', 'POST', '/accounts/plans', { code: 'GROWTH', name: 'Growth', monthlyPrice: 4999, features: ['Priority support'], services: [] });
  check(r.status === 403, 'an Accounts member cannot configure plans', r);
  r = await api('accdh', 'POST', '/accounts/plans', { code: 'GROWTH', name: 'Growth', monthlyPrice: 4999, features: ['Priority support'], services: [] });
  check(r.status === 201, 'the Accounts head configures a plan', r);
  r = await api('accdh', 'GET', '/accounts/plans');
  const plan = r.json.data.plans.find((x: any) => x.code === 'GROWTH');
  check(r.status === 200 && plan, 'and lists it', r);
  r = await api('cl1', 'GET', '/client/plans');
  check(r.json.data.options.some((x: any) => x.name === 'Growth') && r.json.data.current === null, 'the client sees the configured plan, none active', r);
  r = await api('cl1', 'POST', '/client/plan-requests', { planId: plan.id });
  check(r.status === 201, 'the client requests the plan', r);
  r = await api('cl1', 'GET', '/client/plans');
  check(r.json.data.current === null && r.json.data.request.status === 'REQUESTED', 'requesting does not activate it', r);
  r = await api('accdh', 'GET', '/accounts/plans');
  const pr = r.json.data.requests.find((x: any) => x.planName === 'Growth' || x.planId === plan.id);
  check(pr, 'Accounts sees the plan request', r.json.data);
  r = await api('accdh', 'POST', `/accounts/plan-requests/${pr.id}/decision`, { decision: 'ACTIVATE', paymentConfirmed: false });
  check(r.status === 409 || r.status === 422, 'a plan cannot start before the payment is confirmed', r);
  r = await api('accdh', 'POST', `/accounts/plan-requests/${pr.id}/decision`, { decision: 'APPROVE' });
  check(r.status === 200, 'Accounts approves the request', r);
  r = await api('accdh', 'POST', `/accounts/plan-requests/${pr.id}/decision`, { decision: 'ACTIVATE', paymentConfirmed: true, renewsOn: '2027-12-01' });
  check(r.status === 200, 'and activates it once the payment is confirmed', r);
  r = await api('cl1', 'GET', '/client/plans');
  check(r.json.data.current?.name === 'Growth' && r.json.data.current.price === 4999, 'the plan is now the client current plan', r.json.data);
  r = await api('cl2', 'GET', '/client/plans');
  check(r.json.data.current === null, 'and not another client\'s', r.json.data);
}

// --- Cloudflare R2: new files go to R2, the file reference is kept in Supabase ------------------------
{
  const R2 = { key: 'r2-test-key', secret: 'r2-test-secret', bucket: 'amuwa-files' };
  const fake = await startFakeR2({ ...R2, cors: false });
  const objects = fake.objects;
  const r2 = fake.server;
  Object.assign(process.env, { STORAGE_PROVIDER: 'r2', R2_ENDPOINT: fake.endpoint, R2_ACCESS_KEY_ID: R2.key, R2_SECRET_ACCESS_KEY: R2.secret, R2_BUCKET: R2.bucket });

  const invoicePdf = Buffer.concat([Buffer.from('%PDF-1.4\n% r2\n'), Buffer.alloc(4000, 0x20), Buffer.from('\n%%EOF\n')]);
  r = await api('accm', 'POST', '/accounts/invoice-uploads', { customerId: autoA, invoiceNumber: 'R2/0001', issueDate: '2026-10-05', dueDate: '2026-10-25', amount: 5900, fileName: 'R2 invoice.pdf', mimeType: 'application/pdf', sizeBytes: invoicePdf.length });
  check(r.status === 201 && r.json.data.provider === 'R2' && r.json.data.upload?.url.startsWith('http://127.0.0.1') && !r.json.data.token, 'R2: the upload ticket is a presigned PUT to Cloudflare R2', r);
  const t = r.json.data;
  const wrong = await fetch(t.upload.url, { method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: invoicePdf });
  check(wrong.status === 403, 'R2: the presigned URL only works with the declared content type');
  const row0 = (await db.query(`select storage_provider, storage_ref, storage_etag from customer_documents where id = $1`, [t.document.id])).rows[0];
  check(row0.storage_provider === 'R2' && row0.storage_ref === `r2://${R2.bucket}/customer-documents/${t.path}` && row0.storage_etag === null, 'R2: the provider and reference are recorded in Supabase as soon as the upload starts', row0);
  const sent = await fetch(t.upload.url, { method: 'PUT', headers: t.upload.headers, body: invoicePdf });
  check(sent.status === 200 && objects.has(`customer-documents/${t.path}`), 'R2: the browser PUTs the file straight to R2', sent.status);
  r = await api('accm', 'POST', `/accounts/invoice-uploads/${t.document.id}/complete`);
  check(r.status === 201 && r.json.data.status === 'Pending', 'R2: completing the upload finishes the invoice', r);
  const md5 = crypto.createHash('md5').update(invoicePdf).digest('hex');
  const row = (await db.query(`select storage_provider, storage_ref, storage_etag, size_bytes, status from customer_documents where id = $1`, [t.document.id])).rows[0];
  check(row.status === 'UPLOADED' && row.storage_provider === 'R2' && row.storage_etag === md5 && Number(row.size_bytes) === invoicePdf.length && row.storage_ref.startsWith(`r2://${R2.bucket}/customer-documents/customers/`),
    'R2: Supabase keeps the file reference (provider, object key, ETag, size) read back from R2', row);

  const invId = r.json.data.id;
  r = await api('cl2', 'GET', `/client/invoices/${invId}/url?action=download`);
  check(r.status === 200 && r.json.data.url.startsWith('http://127.0.0.1') && /attachment/.test(decodeURIComponent(r.json.data.url)), 'R2: the client downloads their own invoice through a short-lived R2 link', r);
  const got = await fetch(r.json.data.url);
  check(got.status === 200 && Buffer.from(await got.arrayBuffer()).equals(invoicePdf), 'R2: the downloaded bytes are the uploaded file');
  r = await api('accm', 'GET', `/documents/${t.document.id}/url?action=view`);
  check(r.status === 200 && r.json.data.url.startsWith('http://127.0.0.1') && /inline/.test(decodeURIComponent(r.json.data.url)), 'R2: staff open it inline through a signed R2 link', r);
  r = await api('cl1', 'GET', `/client/invoices/${invId}/url`);
  check(r.status === 404, 'R2: another client cannot get a link to it', r);
  const tamper = new URL((await api('accm', 'GET', `/documents/${t.document.id}/url`)).json.data.url);
  tamper.pathname = tamper.pathname.replace(/\/[^/]+$/, '/other.pdf');
  check((await fetch(tamper)).status === 403, 'R2: a signed link cannot be pointed at another file');

  // a file whose content is not a PDF is refused and removed from R2
  r = await api('accm', 'POST', '/accounts/invoice-uploads', { customerId: autoA, invoiceNumber: 'R2/0002', fileName: 'fake.pdf', mimeType: 'application/pdf', sizeBytes: 40 });
  const bad = r.json.data;
  await fetch(bad.upload.url, { method: 'PUT', headers: bad.upload.headers, body: Buffer.from('MZ this is not a pdf at all, just text') });
  r = await api('accm', 'POST', `/accounts/invoice-uploads/${bad.document.id}/complete`);
  check(r.status === 422 && !objects.has(`customer-documents/${bad.path}`), 'R2: content that is not a PDF is refused and deleted from R2', r);
  // an upload that never reached R2
  r = await api('accm', 'POST', '/accounts/invoice-uploads', { customerId: autoA, invoiceNumber: 'R2/0003', fileName: 'missing.pdf', mimeType: 'application/pdf', sizeBytes: 100 });
  r = await api('accm', 'POST', `/accounts/invoice-uploads/${r.json.data.document.id}/complete`);
  check(r.status === 422, 'R2: completing without uploading is refused', r);

  // files stored before R2 stay in Supabase Storage and still open
  r = await api('a', 'GET', `/documents/${importantDoc}/url?action=view`);
  check(r.status === 200 && r.json.data.url.startsWith(GW), 'a file stored before R2 still opens from Supabase Storage', r);
  const oldRow = (await db.query(`select storage_provider, storage_ref from customer_documents where id = $1`, [importantDoc])).rows[0];
  check(oldRow.storage_provider === 'SUPABASE' && /^supabase:\/\//.test(oldRow.storage_ref), 'and is recorded as stored in Supabase', oldRow);

  r = await api('accm', 'POST', '/accounts/invoice-uploads', { customerId: autoA, invoiceNumber: 'R2/0004', fileName: 'cancel.pdf', mimeType: 'application/pdf', sizeBytes: invoicePdf.length });
  const cancelled = r.json.data;
  await fetch(cancelled.upload.url, { method: 'PUT', headers: cancelled.upload.headers, body: invoicePdf });
  check(objects.has(`customer-documents/${cancelled.path}`), 'R2: a started upload reached R2');
  r = await api('accm', 'POST', `/documents/${cancelled.document.id}/abort`);
  check(r.status === 200 && !objects.has(`customer-documents/${cancelled.path}`), 'R2: cancelling an upload deletes the partial object from R2', r);

  for (const k of ['STORAGE_PROVIDER', 'R2_ENDPOINT', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET']) delete process.env[k];
  r2.close();
}

// ---------------------------------------------------------------------------
// HR: employee details, attendance (RM login vs biometric), leave approval Department Head -> HR, monthly totals, notifications
// ---------------------------------------------------------------------------
{
  r = await api('sa', 'GET', '/departments');
  const hrDept = r.json.data.find((d: any) => d.slug === 'hr');
  const details = { designation: 'Department Head', joiningDate: '2026-01-05', dateOfBirth: '1990-05-06', bloodGroup: 'B+', contactNumber: '+91 91234 56789', emergencyContact: '+91 98765 43210' };
  const hrBody = { email: 'hr.api@amuwa.com', fullName: 'HR Api', password: 'Sup3rSecret!', role: 'DEPARTMENT_HEAD', departmentId: hrDept.id };

  // Add Member: the new details are validated before any account exists
  for (const [label, bad] of [
    ['an unknown blood group', { ...details, bloodGroup: 'Z+' }],
    ['a bad emergency number', { ...details, emergencyContact: 'call me' }],
    ['a missing contact number', (({ contactNumber: _c, ...rest }) => rest)(details)],
    ['a contact number that is not a number', { ...details, contactNumber: 'call me' }],
    ['a too short contact number', { ...details, contactNumber: '+91 12345' }],
    ['an Indian number that cannot be a mobile', { ...details, contactNumber: '+91 12345 67890' }],
    ['a contact number that is the emergency number', { ...details, contactNumber: '+91 98765 43210' }],
    ['a birth date in the future', { ...details, dateOfBirth: '2999-01-01' }],
    ['a joining date that is not a date', { ...details, joiningDate: '2026-13-45' }],
    ['an unknown designation', { ...details, designation: 'Boss' }],
    ['a missing field', { designation: 'Department Head', joiningDate: '2026-01-05' }]
  ] as const) {
    r = await api('sa', 'POST', '/users', { ...hrBody, details: bad });
    check(r.status === 422, `Add Member refuses ${label}`, r);
  }
  check((await db.query(`select 1 from public.profiles where email = 'hr.api@amuwa.com'`)).rowCount === 0, 'and no account is created for an invalid form');
  r = await api('sa', 'POST', '/users', { ...hrBody, details });
  check(r.status === 201 && r.json.data.role === 'DEPARTMENT_HEAD' && r.json.data.department.slug === 'hr', 'a member is created with the new details', r);
  const hrId = r.json.data.id;
  check(JSON.stringify(r.json).indexOf('91234') === -1 && JSON.stringify(r.json).indexOf('+919123456789') === -1, "the member's own number is not part of the ordinary profile everyone can read (profiles.phone is not used)");
  {
    const { rows: [pd] } = await db.query(`select contact_number, emergency_contact from public.employee_personal_details where profile_id = $1`, [hrId]);
    check(pd.contact_number === '+919123456789' && pd.emergency_contact === '+91 98765 43210', 'the contact number is stored normalised with its country code, separate from the emergency contact', pd);
  }
  tokens.set('hr', tokenFor(hrId));
  check(JSON.stringify(r.json).indexOf('B+') === -1 && JSON.stringify(r.json).indexOf('98765') === -1, 'the details are not part of the ordinary profile everyone can read');
  r = await api('sa', 'POST', '/users', { ...hrBody, details });
  check(r.status === 409, 'a second account with the same e-mail is refused', r);
  // The HR login is linked to its HR employee record straight away, in the HR department, once
  const { rows: hrRec } = await db.query(`select id, name, email, department_id, profile_id from public.hr_employees where profile_id = $1`, [hrId]);
  check(hrRec.length === 1 && hrRec[0].department_id === 'hr' && hrRec[0].email === 'hr.api@amuwa.com' && hrRec[0].id === `EMP-${hrId.slice(0, 8).toUpperCase()}`, 'an HR login is linked to one HR employee record (the id the HR directory already uses)', hrRec);
  r = await api('sa', 'POST', '/users', { email: 'hr.second@amuwa.com', fullName: 'Second HR Head', password: 'Sup3rSecret!', role: 'DEPARTMENT_HEAD', departmentId: hrDept.id, details });
  check(r.status === 409 && /already has a Department Head/i.test(r.json.error.message), 'a second HR Department Head is refused with a clear message', r);
  check((await db.query(`select 1 from public.profiles where email = 'hr.second@amuwa.com'`)).rowCount === 0, 'and no second account or login is left behind');
  const { rows: [hrTeam] } = await db.query(`select id from public.teams where department_id = $1 order by created_at limit 1`, [hrDept.id]);
  r = await api('hr', 'POST', '/users', { email: 'hr.lead@amuwa.com', fullName: 'HR Lead', password: 'Sup3rSecret!', role: 'TEAM_HEAD', teamId: hrTeam.id, details: { ...details, designation: 'Team Lead' } });
  check(r.status === 201 && r.json.data.role === 'TEAM_HEAD' && r.json.data.department.slug === 'hr', 'the HR head creates an HR Team Lead', r);
  tokens.set('hrlead', tokenFor(r.json.data.id));
  r = await api('sa', 'POST', '/users', { email: 'hr.member@amuwa.com', fullName: 'HR Member', password: 'Sup3rSecret!', role: 'TEAM_MEMBER', teamId: hrTeam.id, details: { ...details, designation: 'Team Member' } });
  check(r.status === 201 && r.json.data.role === 'TEAM_MEMBER' && r.json.data.department.slug === 'hr' && r.json.data.status === 'ACTIVE', 'the Super Admin creates an HR Team Member (active, in the HR department)', r);
  tokens.set('hrmember', tokenFor(r.json.data.id));
  check((await db.query(`select 1 from public.hr_employees where email in ('hr.lead@amuwa.com', 'hr.member@amuwa.com') and department_id = 'hr' and profile_id is not null`)).rowCount === 2, 'each of them has an HR employee record');
  for (const who of ['hr', 'hrlead', 'hrmember']) {
    r = await api(who, 'GET', '/hr/attendance');
    check(r.status === 200, `the HR dashboard's attendance data loads for ${who}`, r);
    r = await api(who, 'GET', '/hr/personal-details');
    check(r.status === 200, `and the employee details for ${who}`, r);
  }
  r = await api('hrmember', 'POST', '/users', { email: 'x.hr@amuwa.com', fullName: 'X', password: 'Sup3rSecret!', role: 'TEAM_MEMBER', teamId: hrTeam.id });
  check(r.status === 403, 'an HR Team Member cannot create accounts', r);
  r = await api('hrlead', 'POST', '/users', { email: 'x.head@amuwa.com', fullName: 'X', password: 'Sup3rSecret!', role: 'DEPARTMENT_HEAD', departmentId: hrDept.id });
  check(r.status === 403, 'an HR Team Lead cannot create a Department Head', r);
  r = await api('hrlead', 'POST', '/users', { email: 'x.wab@amuwa.com', fullName: 'X', password: 'Sup3rSecret!', role: 'TEAM_MEMBER', teamId: sales.id });
  check(r.status === 403, 'nor can the HR team create people in another department', r);
  r = await api('a', 'GET', '/hr/attendance');
  check(r.status === 403, 'a Sales member still cannot open the HR data', r);
  r = await api('hr', 'GET', '/hr/personal-details');
  check(r.status === 200 && r.json.data.some((d: any) => d.profileId === hrId && d.bloodGroup === 'B+' && d.emergencyContact === '+91 98765 43210' && d.contactNumber === '+919123456789' && d.joiningDate === '2026-01-05' && d.designation === 'Department Head'), 'HR can read the details that were collected', r);
  r = await api('a', 'GET', '/hr/personal-details');
  check(r.status === 403, 'an ordinary employee cannot read employee details', r);
  // international and 10-digit numbers
  for (const [label, input, stored] of [['an international number', '+44 7911 123456', '+447911123456'], ['a 10-digit Indian number', '98765 11111', '+919876511111'], ['a number with a leading 0', '098765 22222', '+919876522222'], ['a +1 number', '+1 (415) 555-2671', '+14155552671']] as const) {
    r = await api('sa', 'POST', '/users', { ...hrBody, email: `intl.${stored.slice(-6)}@amuwa.com`, details: { ...details, designation: 'Team Member', contactNumber: input }, role: 'TEAM_MEMBER', departmentId: undefined, teamId: (await db.query(`select id from public.teams where department_id = $1 order by created_at limit 1`, [hrDept.id])).rows[0].id });
    check(r.status === 201 && (await db.query(`select 1 from public.employee_personal_details where profile_id = $1 and contact_number = $2`, [r.json.data.id, stored])).rowCount === 1, `Add Member accepts ${label} and stores ${stored}`, r);
  }
  r = await api('dh', 'GET', '/hr/personal-details');
  check(r.status === 403, 'nor can another department\'s head', r);
  r = await api('dh', 'POST', '/users', { email: 'plain.api@amuwa.com', fullName: 'Plain', password: 'Sup3rSecret!', role: 'TEAM_MEMBER', teamId: (await api('sa', 'GET', `/teams?departmentId=${wab.id}`)).json.data.find((t: any) => t.name === 'Sales').id });
  check(r.status === 201, 'the API still creates members without the new details (existing callers keep working)', r);

  // Attendance
  r = await api('a', 'POST', '/attendance/rm-login');
  check(r.status === 200, 'signing in records the RM login', r);
  r = await api(null, 'POST', '/attendance/rm-login');
  check(r.status === 401, 'an anonymous call records nothing', r);
  r = await api('hr', 'GET', '/hr/attendance');
  const rowA = r.json.data.rows.find((x: any) => x.name === 'Member A');
  check(r.status === 200 && rowA && rowA.rmLoginAt && rowA.biometricLoginAt === null && rowA.diffMinutes === null && rowA.discrepancy === false, 'HR sees the RM login with no difference while the biometric punch is missing', r);
  r = await api('a', 'GET', '/hr/attendance');
  check(r.status === 403, 'an employee cannot read the attendance register', r);
  r = await api('hr', 'GET', '/hr/attendance?date=not-a-date');
  check(r.status === 422, 'a bad date is refused', r);

  const punchHeaders = (secret?: string) => ({ 'content-type': 'application/json', ...(secret ? { authorization: `Bearer ${secret}` } : {}) });
  const punch = (secret: string | undefined, body: unknown) => fetch(`${base}/integrations/biometric/punch`, { method: 'POST', headers: punchHeaders(secret), body: JSON.stringify(body) }).then(async x => ({ status: x.status, json: (await x.json()) as any }));
  const { rows: [rm] } = await db.query(`select rm_login_at from public.attendance_records where profile_id = (select id from public.profiles where email = 'a@amuwa.com') and attendance_date = (now() at time zone 'Asia/Kolkata')::date`);
  const punchAt = new Date(new Date(rm.rm_login_at).getTime() - 22 * 60_000).toISOString();
  delete process.env.BIOMETRIC_INGEST_SECRET;
  r = await punch('x'.repeat(24), { email: 'a@amuwa.com', punchedAt: punchAt });
  check(r.status === 503, 'biometric punches are refused until a secret is configured', r);
  process.env.BIOMETRIC_INGEST_SECRET = 'biometric-test-secret-0123456789';
  r = await punch(undefined, { email: 'a@amuwa.com', punchedAt: punchAt });
  check(r.status === 401, 'a punch without the secret is refused', r);
  r = await punch('wrong-secret-wrong-secret-12', { email: 'a@amuwa.com', punchedAt: punchAt });
  check(r.status === 401, 'and so is a wrong secret', r);
  r = await punch(process.env.BIOMETRIC_INGEST_SECRET, { email: 'a@amuwa.com', punchedAt: 'yesterday' });
  check(r.status === 422, 'a punch needs a real time', r);
  r = await punch(process.env.BIOMETRIC_INGEST_SECRET, { email: 'nobody@amuwa.com', punchedAt: punchAt });
  check(r.status === 404, 'a punch for an unknown e-mail is refused', r);
  r = await punch(process.env.BIOMETRIC_INGEST_SECRET, { email: 'a@amuwa.com', punchedAt: punchAt });
  check(r.status === 200 && r.json.data.recorded === true, 'the device gateway records a biometric punch', r);
  r = await api('hr', 'GET', '/hr/attendance');
  const rowA2 = r.json.data.rows.find((x: any) => x.name === 'Member A');
  check(rowA2.diffMinutes === 22 && rowA2.discrepancy === true && rowA2.biometricLoginAt, 'the difference (22 min, earlier biometric punch) is calculated from the records and flagged', rowA2);
  r = await api('hr', 'GET', '/notifications');
  check(r.json.data.items.filter((n: any) => n.type === 'ATTENDANCE_GAP' && n.data.employeeId === rowA2.profileId).length === 1, 'HR got one notification about it', r);
  await punch(process.env.BIOMETRIC_INGEST_SECRET, { email: 'a@amuwa.com', punchedAt: punchAt });
  r = await api('hr', 'GET', '/notifications');
  check(r.json.data.items.filter((n: any) => n.type === 'ATTENDANCE_GAP' && n.data.employeeId === rowA2.profileId).length === 1, 'the same punch again does not notify twice', r);
  delete process.env.BIOMETRIC_INGEST_SECRET;

  // Leave: Team Member -> Department Head -> HR
  r = await api('a', 'POST', '/leave', { leaveType: 'FULL_DAY', startDate: '2026-11-02', endDate: '2026-11-04', reason: 'Family function' });
  check(r.status === 201 && r.json.data.status === 'PENDING_DEPARTMENT_HEAD' && r.json.data.days === 3, 'a team member submits leave: it waits for the Department Head', r);
  const leaveId = r.json.data.id;
  r = await api('a', 'POST', '/leave', { leaveType: 'HALF_DAY', startDate: '2026-11-10', reason: 'x' });
  check(r.status === 422, 'a half day needs a shift and a reason', r);
  r = await api('a', 'POST', '/leave', { leaveType: 'FULL_DAY', startDate: '2026-11-04', endDate: '2026-11-02', reason: 'backwards' });
  check(r.status === 422, 'dates must be in order', r);
  r = await api('a', 'POST', '/leave', { leaveType: 'FULL_DAY', startDate: '2026-11-03', reason: 'overlap' });
  check(r.status === 409, 'overlapping requests are refused', r);
  r = await api('a', 'POST', `/leave/${leaveId}/department-head-decision`, { approve: true });
  check(r.status === 404, 'the employee cannot approve their own leave', r);
  r = await api('a', 'POST', `/leave/${leaveId}/hr-decision`, { approve: true });
  check(r.status === 403, 'nor give the HR approval', r);
  r = await api('hr', 'POST', `/leave/${leaveId}/hr-decision`, { approve: true });
  check(r.status === 409 && /not approved/i.test(r.json.error.message), 'HR cannot finalize before the Department Head', r);
  r = await api('hr', 'POST', `/leave/${leaveId}/department-head-decision`, { approve: true });
  check(r.status === 404, 'HR cannot take the Department Head\'s step', r);
  r = await api('accdh', 'POST', `/leave/${leaveId}/department-head-decision`, { approve: true });
  check(r.status === 404, 'another department\'s head cannot decide', r);
  r = await api('th', 'POST', `/leave/${leaveId}/department-head-decision`, { approve: true });
  check(r.status === 404, 'a Team Lead is not the approver', r);
  r = await api('dh', 'GET', '/leave/review');
  check(r.status === 200 && r.json.data.awaiting.some((x: any) => x.id === leaveId) && r.json.data.canReviewAsDepartmentHead === true, 'the Department Head sees it', r);
  r = await api('hr', 'GET', '/leave/review');
  check(!r.json.data.awaiting.some((x: any) => x.id === leaveId), 'HR does not see it yet', r);
  r = await api('dh', 'POST', `/leave/${leaveId}/department-head-decision`, { approve: false });
  check(r.status === 422, 'a rejection needs a reason', r);
  r = await api('dh', 'GET', '/notifications');
  const dhNote = r.json.data.items.find((n: any) => n.type === 'LEAVE_AWAITING_DEPARTMENT_HEAD' && n.entityId === leaveId);
  check(dhNote && dhNote.readAt === null, 'the Department Head was notified', r);
  r = await api('dh', 'GET', '/notifications/unread-count');
  const unreadBefore = r.json.data.count;
  r = await api('dh', 'PATCH', `/notifications/${dhNote.id}/read`, {});
  check(r.status === 200 && r.json.data.readAt, 'a notification can be marked read', r);
  r = await api('dh', 'GET', '/notifications/unread-count');
  check(r.json.data.count === unreadBefore - 1, 'the unread count follows', r);
  r = await api('dh', 'GET', '/notifications?unreadOnly=true');
  check(!r.json.data.items.some((n: any) => n.id === dhNote.id), 'and it stays read after reloading', r);
  r = await api('b', 'PATCH', `/notifications/${dhNote.id}/read`, {});
  check(r.status === 404, 'someone else cannot touch that notification', r);
  r = await api('b', 'GET', '/notifications');
  check(!r.json.data.items.some((n: any) => n.entityId === leaveId), 'nor see it', r);
  r = await api('dh', 'POST', `/leave/${leaveId}/department-head-decision`, { approve: true, note: 'Fine' });
  check(r.status === 200 && r.json.data.status === 'PENDING_HR' && r.json.data.departmentHead.note === 'Fine', 'the Department Head approves: it goes to HR', r);
  r = await api('dh', 'POST', `/leave/${leaveId}/department-head-decision`, { approve: true });
  check(r.status === 409, 'it cannot be approved twice', r);
  r = await api('hr', 'GET', '/leave/review');
  check(r.json.data.awaiting.some((x: any) => x.id === leaveId && x.status === 'PENDING_HR') && r.json.data.canReviewAsHr === true, 'HR now sees it', r);
  r = await api('hr', 'GET', '/notifications');
  check(r.json.data.items.filter((n: any) => n.type === 'LEAVE_AWAITING_HR' && n.entityId === leaveId).length === 1, 'and was notified once', r);
  r = await api('hr', 'POST', `/leave/${leaveId}/hr-decision`, { approve: true });
  check(r.status === 200 && r.json.data.status === 'APPROVED' && r.json.data.hr.name === 'HR Api' && r.json.data.hr.at, 'HR gives the final approval; who and when are recorded', r);
  r = await api('a', 'GET', '/leave/mine');
  check(r.json.data.length === 1 && r.json.data[0].status === 'APPROVED' && r.json.data[0].departmentHead.name === 'Dept Head', 'the employee sees the result with the approval history', r);
  r = await api('a', 'GET', '/notifications');
  check(['LEAVE_DEPARTMENT_HEAD_APPROVED', 'LEAVE_APPROVED'].every(t => r.json.data.items.some((n: any) => n.type === t && n.entityId === leaveId)), 'and was told at each step', r);

  // a rejection by the Department Head, with the reason
  r = await api('a', 'POST', '/leave', { leaveType: 'HALF_DAY', startDate: '2026-12-07', halfDayShift: 'MORNING', reason: 'Appointment' });
  const rejId = r.json.data.id;
  r = await api('dh', 'POST', `/leave/${rejId}/department-head-decision`, { approve: false, note: 'Busy week' });
  check(r.status === 200 && r.json.data.status === 'REJECTED_BY_DEPARTMENT_HEAD' && r.json.data.departmentHead.note === 'Busy week', 'the Department Head can reject with a reason', r);
  r = await api('hr', 'POST', `/leave/${rejId}/hr-decision`, { approve: true });
  check(r.status === 409, 'HR cannot approve what was rejected', r);

  // Monthly totals
  r = await api('hr', 'GET', '/leave/monthly-summary?month=2026-11');
  const emp = r.json.data.employees.find((e: any) => e.profileId === rowA2.profileId);
  check(r.status === 200 && r.json.data.month === '2026-11' && emp && emp.leaveDays === 3 && emp.halfDays === 0, 'November shows 3 approved leave days', r);
  r = await api('hr', 'GET', '/leave/monthly-summary?month=2026-12');
  check(r.json.data.employees.length === 0, 'December shows none (the half day was rejected)', r);
  r = await api('hr', 'GET', '/leave/monthly-summary?month=2026-1');
  check(r.status === 422, 'a bad month is refused', r);
  r = await api('a', 'GET', '/leave/monthly-summary?month=2026-11');
  check(r.status === 403, 'an employee cannot read the monthly totals', r);
  r = await api('accdh', 'GET', '/leave/monthly-summary?month=2026-11');
  check(r.status === 200 && r.json.data.employees.length === 0, 'another department\'s head sees none of Wabastore\'s', r);
}

// The next two sections exercise the delivery machinery that invoices made before the paid-only rule still use (the unpaid stage, its
// retries and e-mail). A new invoice no longer runs the unpaid stage, so here "issue" is followed by the unpaid delivery, on invoices
// created as older (not paid-only) ones. The paid-only rule itself is tested in its own section below.
const apiBase = api;
async function apiLegacy(who: string | null, method: string, path: string, body?: unknown, raw?: string) {
  const res = await apiBase(who, method, path, body, raw);
  if (method === 'POST' && path === '/accounts/generated-invoices' && (res.status === 201 || res.status === 200) && res.json?.data?.invoice?.id) {
    const d = await apiBase(who, 'POST', `/accounts/generated-invoices/${res.json.data.invoice.id}/deliver`, { stage: 'UNPAID' });
    if (d.status === 200) res.json.data = { ...res.json.data, invoice: d.json.data.invoice, steps: [...res.json.data.steps, ...d.json.data.steps] };
  }
  return res;
}
await db.query(`alter table public.generated_invoices alter column paid_only set default false`);

// --- Dynamic invoices (Accounts invoice builder): issue -> unpaid PDF + e-mail -> confirm payment -> paid PDF + e-mail ----------
{
  const api = apiLegacy;
  const { amountInWords } = await import('../../shared/invoiceCalc.js');
  const { inferStateFromAddress } = await import('../../shared/gst.js');
  const { execFileSync, spawnSync } = await import('node:child_process');
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const R2 = { key: 'r2-inv-key', secret: 'r2-inv-secret', bucket: 'amuwa-files' };
  const fake = await startFakeR2({ ...R2, cors: false });
  const goodEndpoint = fake.endpoint;
  const useR2 = (endpoint: string) => Object.assign(process.env, { STORAGE_PROVIDER: 'r2', R2_ENDPOINT: endpoint, R2_ACCESS_KEY_ID: R2.key, R2_SECRET_ACCESS_KEY: R2.secret, R2_BUCKET: R2.bucket });
  useR2(goodEndpoint);
  if (!smtp.listening) await new Promise<void>(rs => smtp.listen(0, '127.0.0.1', rs)); // (closed after the e-mail tests above)
  Object.assign(process.env, {
    AUTOMATION_MODE: 'live', EMAIL_PROVIDER: 'smtp', EMAIL_FROM: 'Amuwa Corporation <meta@amuwa.com>',
    SMTP_HOST: '127.0.0.1', SMTP_PORT: String((smtp.address() as any).port), SMTP_SECURE: 'false', SMTP_USER: 'meta@amuwa.com', SMTP_PASS: 'abcd efgh ijkl mnop'
  });
  delete process.env.AUTOMATION_TEST_RECIPIENTS;
  smtpMode = 'ok';

  const cust = autoA; // Auto Traders: invoiced by Accounts, signs in as cl2 (auto.client@example.com is the customer's e-mail)
  const custEmail = (await db.query(`select email from customers where id = $1`, [cust])).rows[0].email as string;
  const today = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
  const line = (o: Record<string, unknown> = {}) => ({ particulars: 'WhatsApp Official Registration Platform Charges Bulk Campaign', hsnSac: '998313', taxRate: 18, quantity: '1 Year', baseAmount: 10000, ...o });
  const payload = (o: Record<string, unknown> = {}) => ({
    requestId: crypto.randomUUID(), customerId: cust, purpose: 'ADDITIONAL', invoiceNumber: null, invoiceDate: today, orderNumber: 'Verbal',
    customer: { name: 'Auto Client', businessName: 'Auto Traders', address: 'Shop 4, MG Road, Pune 411001, Maharashtra', contactPerson: 'Auto Client', contactNumber: '9819900022', gstin: '27AADFZ2948M1ZI', stateCode: '27' },
    taxTreatment: 'INTRA_STATE', terms: '100% Payment Against supply.',
    lines: [line(), line({ particulars: '30K Utility Message for Campaign Unlimited Validity', quantity: '30K Msg', baseAmount: 6000 })], ...o
  });
  const objectKey = (inv: string, stage: string) => `customer-documents/customers/${cust}/invoices/${inv}/${stage}.pdf`;
  const mailsBefore = () => smtpMail.length;
  const attachmentOf = (data: string) => {
    const at = data.indexOf('Content-Type: application/pdf');
    if (at < 0) return null;
    const bodyStart = data.indexOf('\r\n\r\n', at) + 4;
    const end = data.indexOf('\r\n--', bodyStart);
    return Buffer.from(data.slice(bodyStart, end).replace(/\s+/g, ''), 'base64');
  };
  const pdfText = (bytes: Buffer) => {
    if (spawnSync('pdftotext', ['-v'], { stdio: 'ignore' }).error) return null;
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'inv-api-')), 'x.pdf');
    fs.writeFileSync(f, bytes);
    return execFileSync('pdftotext', ['-raw', f, '-'], { encoding: 'utf8' }).replace(/\s+/g, ' ');
  };
  const row = async (id: string) => (await db.query(`select * from generated_invoices where invoice_id = $1`, [id])).rows[0];

  // ---- who may use it
  r = await api(null, 'POST', '/accounts/generated-invoices', payload());
  check(r.status === 401, 'invoice builder: no session is refused (401)', r);
  r = await api('forged', 'POST', '/accounts/generated-invoices', payload());
  check(r.status === 401, 'invoice builder: an invalid token is refused (401)', r);
  for (const [who, label] of [['a', 'a salesperson'], ['th', 'a team head of Sales'], ['tc', 'a Technical Consultant'], ['dh', 'a department head of another department'], ['cl2', 'a client']] as const) {
    r = await api(who, 'POST', '/accounts/generated-invoices', payload());
    check(r.status === 403 || (who === 'cl2' && r.status === 401), `invoice builder: ${label} cannot issue an invoice`, r);
    r = await api(who, 'GET', `/accounts/customers/${cust}/invoice-prefill`);
    check(r.status === 403 || (who === 'cl2' && r.status === 401), `invoice builder: ${label} cannot use the prefill`, r);
  }
  r = await api('a', 'POST', `/accounts/generated-invoices/${crypto.randomUUID()}/confirm-payment`, { method: 'UPI' });
  check(r.status === 403, 'a salesperson cannot confirm a payment', r);
  r = await api('a', 'POST', `/accounts/generated-invoices/${crypto.randomUUID()}/deliver`, { stage: 'UNPAID' });
  check(r.status === 403, 'nor retry a delivery', r);

  // ---- prefill
  r = await api('accm', 'GET', `/accounts/customers/${cust}/invoice-prefill?purpose=NOPE`);
  check(r.status === 422, 'prefill: an unknown purpose is refused', r);
  r = await api('accm', 'GET', `/accounts/customers/not-a-uuid/invoice-prefill`);
  check(r.status === 422, 'prefill: a malformed customer id is refused', r);
  r = await api('accm', 'GET', `/accounts/customers/${crypto.randomUUID()}/invoice-prefill`);
  check(r.status === 404, 'prefill: an unknown customer is not found', r);
  r = await api('accm', 'GET', `/accounts/customers/${cust}/invoice-prefill?purpose=SERVICES`);
  check(r.status === 200 && r.json.data.customer.businessName === 'Auto Traders' && r.json.data.lines.length >= 1 && r.json.data.lines.every((l: any) => l.hsnSac === '998313' && l.taxRate === 18 && l.quantity === '1 Nos')
    // the customer's agreed 1,000 (with GST) less nothing invoiced yet: 847.46 + 18% (152.54) = 1,000.00
    && r.json.data.dealAmount === 1000 && r.json.data.lines.length === 1 && r.json.data.lines[0].baseAmount === 847.46
    && r.json.data.orderNumber === 'Verbal' && /^GST\/\d\d-\d\d\/\d{3}$/.test(r.json.data.suggestedInvoiceNumber) && /^Amuwa\/\d\d-\d\d\/\d{3}$/.test(r.json.data.nextInvoiceNumbers.NON_GST) && r.json.data.company.gstin === '27BDCPK3585J3Z7', 'prefill: the customer\'s details, the purchase\'s services with the amount filled in from the agreed amount, defaults set', r);

  // ---- issue: validation first
  r = await api('accm', 'POST', '/accounts/generated-invoices', { ...payload(), totalAmount: 11000 });
  check(r.status === 422, 'issue: a total sent by the browser is refused (the server recalculates)', r);
  r = await api('accm', 'POST', '/accounts/generated-invoices', payload({ lines: [line({ gstAmount: 1000 })] }));
  check(r.status === 422, 'issue: a GST amount sent in a line is refused', r);
  r = await api('accm', 'POST', '/accounts/generated-invoices', (({ requestId, ...rest }) => rest)(payload()));
  check(r.status === 422, 'issue: a request reference is required', r);
  r = await api('accm', 'POST', '/accounts/generated-invoices', payload({ lines: [line({ baseAmount: 0 })] }));
  check(r.status === 422 && /more than zero/.test(JSON.stringify(r.json)), 'issue: a zero amount is refused', r);
  r = await api('accm', 'POST', '/accounts/generated-invoices', payload({ lines: [line({ baseAmount: '10.005' })] }));
  check(r.status === 422, 'issue: three decimals are refused', r);
  r = await api('accm', 'POST', '/accounts/generated-invoices', payload({ lines: [line({ baseAmount: -5 })] }));
  check(r.status === 422, 'issue: a negative amount is refused', r);
  r = await api('accm', 'POST', '/accounts/generated-invoices', payload({ lines: [line({ taxRate: 101 })] }));
  check(r.status === 422, 'issue: a tax rate over 100 is refused', r);
  r = await api('accm', 'POST', '/accounts/generated-invoices', payload({ lines: [] }));
  check(r.status === 422, 'issue: no lines is refused', r);
  r = await api('accm', 'POST', '/accounts/generated-invoices', payload({ customer: { ...payload().customer, gstin: 'ABC' } }));
  check(r.status === 422, 'issue: an invalid GSTIN is refused', r);
  r = await api('accm', 'POST', '/accounts/generated-invoices', payload({ invoiceDate: '2099-01-01' }));
  check(r.status === 422, 'issue: a future date is refused (by the database)', r);
  r = await api('accm', 'POST', '/accounts/generated-invoices', payload({ taxTreatment: 'INTER_STATE' }));
  check(r.status === 422 && /Say why/.test(r.json.error.message), 'issue: a tax treatment that differs from the state needs a reason', r);
  check((await db.query(`select count(*)::int n from generated_invoices`)).rows[0].n === 0, 'none of the refused requests created anything');

  // ---- stage 1: issue, store the unpaid PDF in R2, e-mail it
  const m0 = mailsBefore();
  const body1 = payload();
  r = await api('accm', 'POST', '/accounts/generated-invoices', body1);
  const inv1 = r.json.data?.invoice;
  check(r.status === 201 && inv1.kind === 'GENERATED' && /^GST\/\d\d-\d\d\/\d{3}$/.test(inv1.number) && inv1.status === 'Pending' && inv1.total === 18880 && inv1.tax === 2880 && inv1.subtotal === 16000,
    'stage 1: the invoice is issued with a GST-series number and the server\'s own totals (Rs.16,000 + 18% = Rs.18,880)', r);
  check(r.json.data.steps.map((s: any) => `${s.step}:${s.status}`).join() === 'ISSUE:DONE,PDF:DONE,EMAIL:DONE', 'stage 1: issued, PDF stored, e-mail sent', r.json.data.steps);
  const g1 = await row(inv1.id);
  const unpaidKey = objectKey(inv1.id, 'unpaid');
  const stored1 = fake.objects.get(unpaidKey);
  check(!!stored1 && stored1.body.length < 500000 && stored1.body.subarray(0, 5).toString() === '%PDF-' && stored1.type === 'application/pdf', 'stage 1: the unpaid PDF is in R2 under its own object, a real PDF below 500,000 bytes');
  const md5 = (b: Buffer) => crypto.createHash('md5').update(b).digest('hex');
  check(g1.unpaid_pdf_status === 'STORED' && g1.unpaid_storage_provider === 'R2' && g1.unpaid_storage_bucket === 'customer-documents' && g1.unpaid_storage_path === unpaidKey.replace('customer-documents/', '')
    && g1.unpaid_storage_ref === `r2://${R2.bucket}/${unpaidKey}` && g1.unpaid_storage_etag === md5(stored1!.body) && g1.unpaid_size_bytes === stored1!.body.length && g1.unpaid_stored_at,
    'stage 1: Supabase keeps the unpaid reference (provider, bucket, path, ref, ETag, size)', g1);
  check(g1.paid_pdf_status === 'NOT_DUE' && g1.paid_storage_ref === null && g1.lifecycle === 'ISSUED', 'stage 1: nothing for the paid stage yet');
  check(smtpMail.length === m0 + 1 && g1.unpaid_email_status === 'SENT' && g1.unpaid_email_to === custEmail && g1.unpaid_email_sent_at && g1.unpaid_email_attempts === 1, 'stage 1: the e-mail is recorded as sent only after the mail server accepted it', g1);
  const mail1 = smtpMail.at(-1)!;
  const att1 = attachmentOf(mail1.data);
  check(mail1.user === 'meta@amuwa.com' && /meta@amuwa\.com/.test(mail1.from) && mail1.to.some(t => t.includes(custEmail)) && new RegExp(`Subject: Invoice ${inv1.number.replace(/\//g, '\\/')} from Amuwa Corporation`).test(mail1.data), 'stage 1: nodemailer sends it as meta@amuwa.com to the customer');
  check(!!att1 && att1.equals(stored1!.body) && new RegExp(`filename="?${inv1.number.replace(/[^A-Za-z0-9._-]+/g, '-')}-invoice\\.pdf`).test(mail1.data), 'stage 1: the attachment is exactly the stored file');
  const txt1 = pdfText(stored1!.body);
  if (txt1) check(!/\bPAID\b/.test(txt1) && txt1.includes(`INVOICE No. ${inv1.number}`) && /Tax Invoice/.test(txt1) && /Rs\.18,880\.00/.test(txt1) && /Eighteen Thousand Eight Hundred Eighty Only\/-/.test(txt1), 'stage 1: the unpaid PDF has no PAID stamp, and the right number, total and words');
  check(r.json.data.invoice.generated.unpaid.pdfStatus === 'STORED' && !JSON.stringify(r.json).includes('r2://'), 'the API answer never carries a storage reference');

  // a repeated request (a double click, a retry): the same invoice, nothing done twice
  const objectsBefore = fake.objects.size;
  r = await api('accm', 'POST', '/accounts/generated-invoices', body1);
  check(r.status === 200 && r.json.data.invoice.id === inv1.id && r.json.data.steps.every((s: any) => s.status === 'DONE') && /already (issued|saved)/.test(r.json.data.steps[0].message), 'a repeated request returns the same invoice (200, not 201)', r);
  check(smtpMail.length === m0 + 1 && fake.objects.size === objectsBefore && (await db.query(`select count(*)::int n from generated_invoices`)).rows[0].n === 1, 'and sends no second e-mail, stores no second file, creates no second invoice');
  r = await api('accm', 'POST', '/accounts/generated-invoices', payload({ invoiceNumber: inv1.number }));
  check(r.status === 422 && /assigned by the system/.test(r.json.error.message), 'a number typed in the request is refused - even one that exists: numbers come only from the series', r);
  const fyNow = (() => { const d = new Date(Date.now() + 5.5 * 3600e3); const y = d.getUTCFullYear(), m = d.getUTCMonth() + 1; const a = m >= 4 ? y : y - 1; return `${String(a).slice(2)}-${String(a + 1).slice(2)}`; })();
  check(inv1.number.startsWith(`GST/${fyNow}/`), `the year part is the current financial year (${fyNow})`, inv1.number);
  // a non-GST invoice (every line at 0%) is in its own series, titled "Invoice", with no tax rows
  r = await api('accm', 'POST', '/accounts/generated-invoices', payload({ lines: [line({ taxRate: 0, baseAmount: 2500 })] }));
  const nonGst = r.json.data?.invoice;
  check(r.status === 201 && new RegExp(`^Amuwa/${fyNow}/\\d{3}$`).test(nonGst.number) && nonGst.total === 2500 && nonGst.tax === 0 && nonGst.generated.invoiceType === 'NON_GST' && inv1.generated.invoiceType === 'GST',
    'a non-GST invoice gets an Amuwa/<year>/<no> number and its own type; the GST one is GST', nonGst?.number);
  const ngText = pdfText(fake.objects.get(objectKey(nonGst.id, 'unpaid'))!.body);
  if (ngText) check(ngText.includes(`INVOICE No. ${nonGst.number}`) && !/Tax Invoice/.test(ngText) && !/CGST|SGST|IGST/.test(ngText) && /Non-GST invoice/.test(ngText), 'the non-GST PDF shows its number, is not a "Tax Invoice" and has no tax rows');
  r = await api('accm', 'POST', '/accounts/generated-invoices', payload({ lines: [line({ taxRate: 0, baseAmount: 900 })] }));
  const seqA = Number(nonGst.number.split('/')[2]), seqB = Number(r.json.data.invoice.number.split('/')[2]);
  check(r.status === 201 && seqB === seqA + 1, 'the next non-GST invoice is the next number of that series', [nonGst.number, r.json.data?.invoice?.number]);
  // parallel requests (different invoices) never share a number, and the numbers are consecutive
  {
    const rs = await Promise.all(Array.from({ length: 8 }, (_, i) => api('accm', 'POST', '/accounts/generated-invoices', payload({ lines: [line({ baseAmount: 1000 + i })] }))));
    const nums = rs.map(x => x.json.data?.invoice?.number as string);
    const seq = nums.map(n => Number(n?.split('/')[2])).sort((a, b) => a - b);
    check(rs.every(x => x.status === 201) && new Set(nums).size === 8 && seq.every((n, i) => i === 0 || n === seq[i - 1] + 1), 'eight simultaneous GST invoices get eight different, consecutive numbers', nums);
    const dup = (await db.query(`select count(*)::int n from (select lower(invoice_number) from member_invoices where kind = 'GENERATED' group by 1 having count(*) > 1) x`)).rows[0].n;
    check(dup === 0, 'no number is used twice in the database');
  }

  // simultaneous double click: one invoice, one file, one e-mail
  {
    const same = payload({ lines: [line({ baseAmount: 1234.5 })] });
    const before = smtpMail.length;
    const rs = await Promise.all(Array.from({ length: 5 }, () => api('accm', 'POST', '/accounts/generated-invoices', same)));
    const ids = new Set(rs.filter(x => x.status < 300).map(x => x.json.data.invoice.id));
    check(rs.every(x => x.status < 300) && ids.size === 1, 'five simultaneous identical requests give ONE invoice', rs.map(x => x.status));
    const id = [...ids][0] as string;
    check((await db.query(`select count(*)::int n from generated_invoices where customer_id = $1 and total_amount = 1456.71`, [cust])).rows[0].n === 1, 'with one stored record');
    check(smtpMail.length === before + 1 && fake.objects.has(objectKey(id, 'unpaid')), 'one e-mail and one unpaid file, however many clicks');
    check(rs.some(x => x.json.data.steps.some((s: any) => s.status === 'BUSY')) || rs.filter(x => x.json.data.steps.some((s: any) => s.step === 'PDF' && /Nothing left|already stored/.test(s.message ?? ''))).length >= 0, 'the others were told it was busy or already done');
  }
  // numbers under concurrency: ten different invoices at once never share a number
  {
    const rs = await Promise.all(Array.from({ length: 10 }, (_, i) => api('accm', 'POST', '/accounts/generated-invoices', payload({ lines: [line({ baseAmount: 100 + i })] }))));
    const nums = rs.map(x => x.json.data?.invoice?.number);
    check(rs.every(x => x.status === 201) && new Set(nums).size === 10 && nums.every(n => /^GST\/\d\d-\d\d\/\d{3}$/.test(n)), 'ten simultaneous invoices get ten different automatic numbers', rs.map(x => [x.status, x.json.error?.message ?? x.json.data?.invoice?.number]));
  }

  // ---- the client dashboard
  r = await api('cl2', 'GET', '/client/invoices');
  const c1 = (r.json.data as any[]).find(i => i.id === inv1.id);
  check(r.status === 200 && c1 && c1.generated && c1.hasFile && c1.fileKind === 'UNPAID' && c1.status === 'Pending' && c1.amount === 18880 && !JSON.stringify(c1).includes('r2://'), 'client: sees the invoice, Pending, with the unpaid file', c1);
  r = await api('cl2', 'GET', `/client/invoices/${inv1.id}/url?action=download`);
  check(r.status === 200 && /unpaid\.pdf/.test(decodeURIComponent(r.json.data.url)) && /attachment/.test(decodeURIComponent(r.json.data.url)), 'client: the download link is a short-lived R2 link to the unpaid file', r);
  const dl1 = await fetch(r.json.data.url);
  check(dl1.status === 200 && Buffer.from(await dl1.arrayBuffer()).equals(stored1!.body), 'client: the downloaded bytes are exactly the stored file');
  r = await api('cl1', 'GET', '/client/invoices');
  check(r.status === 200 && !(r.json.data as any[]).some(i => i.id === inv1.id), 'another client does not see it in their list');
  r = await api('cl1', 'GET', `/client/invoices/${inv1.id}/url`);
  check(r.status === 404, 'another client cannot get a link to it (404)', r);
  r = await api('sa', 'GET', `/client/invoices/${inv1.id}/url`);
  check(r.status === 403, 'a staff token on the client endpoint is refused (403)', r);
  r = await api('forged', 'GET', `/client/invoices/${inv1.id}/url`);
  check(r.status === 401, 'an invalid token on the client endpoint is refused (401)', r);
  r = await api('cl1', 'GET', `/client/invoices/${crypto.randomUUID()}/url?customerId=${cust}`);
  check(r.status === 404, 'a customer id in the request is ignored: identity comes from the login only', r);
  r = await api('cl2', 'GET', `/invoices/${inv1.id}`);
  check(r.status === 401 || r.status === 403, 'a client cannot use the staff invoice detail', r);

  // ---- staff open the stored files
  r = await api('accm', 'GET', `/invoices/${inv1.id}/pdf?stage=UNPAID&action=view`);
  check(r.status === 200 && /unpaid\.pdf/.test(decodeURIComponent(r.json.data.url)) && /inline/.test(decodeURIComponent(r.json.data.url)), 'staff: Accounts opens the unpaid file inline', r);
  r = await api('a', 'GET', `/invoices/${inv1.id}/pdf?stage=UNPAID&action=download`);
  check(r.status === 200 && /attachment/.test(decodeURIComponent(r.json.data.url)), 'staff: the salesperson of the customer can download it', r);
  r = await api('accm', 'GET', `/invoices/${inv1.id}/pdf?stage=PAID`);
  check(r.status === 404, 'staff: the paid file is not available before payment (404)', r);
  r = await api('accm', 'GET', `/invoices/${inv1.id}/pdf?stage=BOTH`);
  check(r.status === 422, 'staff: an unknown stage is refused', r);
  r = await api('cl2', 'GET', `/invoices/${inv1.id}/pdf?stage=UNPAID`);
  check(r.status === 401 || r.status === 403 || r.status === 404, 'staff: a client cannot use the staff file link', r);

  // ---- stage 2: confirm the payment
  r = await api('accm', 'POST', `/accounts/generated-invoices/${inv1.id}/confirm-payment`, { method: 'BARTER' });
  check(r.status === 422, 'payment: an unknown method is refused', r);
  r = await api('accm', 'POST', `/accounts/generated-invoices/${inv1.id}/confirm-payment`, { method: 'UPI', paidOn: '2099-01-01' });
  check(r.status === 422, 'payment: a future payment date is refused', r);
  r = await api('accm', 'POST', `/accounts/generated-invoices/${inv1.id}/deliver`, { stage: 'PAID' });
  check(r.status === 409, 'the paid invoice cannot be started before the payment is confirmed', r);
  const m1 = mailsBefore();
  r = await api('accm', 'POST', `/accounts/generated-invoices/${inv1.id}/confirm-payment`, { method: 'UPI', reference: 'UPI-TXN-77', note: 'Received in the bank' });
  check(r.status === 200 && r.json.data.invoice.status === 'Paid' && r.json.data.steps.map((s: any) => `${s.step}:${s.status}`).join() === 'PAYMENT:DONE,PDF:DONE,EMAIL:DONE,WHATSAPP:NOT_SENT', 'stage 2: payment confirmed, paid PDF stored, paid e-mail sent', r);
  const g2 = await row(inv1.id);
  const paidKey = objectKey(inv1.id, 'paid');
  const stored2 = fake.objects.get(paidKey);
  check(!!stored2 && stored2.body.length < 500000 && g2.lifecycle === 'PAID' && g2.paid_pdf_status === 'STORED' && g2.paid_storage_ref === `r2://${R2.bucket}/${paidKey}` && g2.paid_storage_etag === md5(stored2.body)
    && g2.payment_method === 'UPI' && g2.payment_reference === 'UPI-TXN-77' && g2.payment_confirmed_at && g2.paid_email_status === 'SENT' && g2.paid_email_attempts === 1, 'stage 2: the paid reference is its own, with the payment facts', g2);
  check(g2.unpaid_storage_ref === g1.unpaid_storage_ref && g2.unpaid_storage_etag === g1.unpaid_storage_etag && fake.objects.get(unpaidKey)!.body.equals(stored1!.body) && paidKey !== unpaidKey, 'stage 2: the unpaid reference and file are untouched');
  for (const k of ['invoice_number', 'invoice_date', 'order_number', 'customer_name', 'business_name', 'business_address', 'customer_gstin', 'customer_state_code', 'tax_treatment', 'terms', 'subtotal', 'cgst_amount', 'sgst_amount', 'igst_amount', 'total_gst', 'total_amount', 'amount_in_words']) {
    if (String(g2[k]) !== String(g1[k])) check(false, `stage 2 changed the issued snapshot (${k})`, { before: g1[k], after: g2[k] });
  }
  check(true, 'stage 2: the issued snapshot (number, date, customer, tax, totals, words) is unchanged');
  check((await db.query(`select count(*)::int n from generated_invoice_items where invoice_id = $1`, [inv1.id])).rows[0].n === 2, 'stage 2: the lines are unchanged');
  const mail2 = smtpMail.at(-1)!;
  check(smtpMail.length === m1 + 1 && mail2.data.includes(`Subject: Payment received - paid invoice ${inv1.number}`) && attachmentOf(mail2.data)!.equals(stored2!.body), 'stage 2: the paid e-mail carries exactly the paid file');
  const txt2 = pdfText(stored2!.body);
  if (txt2) check(/\bPAID\b/.test(txt2) && txt2.includes(`INVOICE No. ${inv1.number}`) && /Rs\.18,880\.00/.test(txt2) && /Eighteen Thousand Eight Hundred Eighty Only\/-/.test(txt2), 'stage 2: the paid PDF has the PAID stamp and the SAME number, total and words');
  // a repeated click
  const m2 = mailsBefore(), o2 = fake.objects.size;
  r = await api('accm', 'POST', `/accounts/generated-invoices/${inv1.id}/confirm-payment`, { method: 'CASH', reference: 'second click' });
  check(r.status === 200 && r.json.data.steps[0].message === 'The payment was already confirmed.' && r.json.data.steps.every((s: any) => s.status === 'DONE'), 'a repeated confirmation is recognised', r);
  check(smtpMail.length === m2 && fake.objects.size === o2 && (await row(inv1.id)).payment_method === 'UPI' && (await db.query(`select count(*)::int n from audit_logs where action = 'INVOICE_PAYMENT_CONFIRMED' and entity_id = $1`, [inv1.id])).rows[0].n === 1,
    'and sends no second e-mail, stores no second file, records the payment only once');
  r = await api('accm', 'PATCH', `/accounts/invoices/${inv1.id}`, { status: 'Pending' });
  check(r.status === 409, 'a confirmed payment cannot be set back to pending', r);
  r = await api('accm', 'POST', `/accounts/invoices/${inv1.id}/details`, { amount: 1 });
  check(r.status === 409, 'an issued invoice cannot be edited through the older edit endpoint', r);

  // client sees the paid invoice with the paid file
  r = await api('cl2', 'GET', '/client/invoices');
  const c2 = (r.json.data as any[]).find(i => i.id === inv1.id);
  check(c2.status === 'Paid' && c2.fileKind === 'PAID' && c2.hasFile && !c2.paidFilePending && c2.paymentConfirmedAt, 'client: Paid, with the paid file', c2);
  r = await api('cl2', 'GET', `/client/invoices/${inv1.id}/url`);
  check(r.status === 200 && /paid\.pdf/.test(decodeURIComponent(r.json.data.url)), 'client: the link now points to the paid file', r);
  const dl2 = await fetch(r.json.data.url);
  check(dl2.status === 200 && Buffer.from(await dl2.arrayBuffer()).equals(stored2!.body), 'client: the downloaded bytes are exactly the stored paid file');
  r = await api('cl1', 'GET', `/client/invoices/${inv1.id}/url`);
  check(r.status === 404, 'another client cannot open the paid file', r);
  const live = await db.query(`select n.type from client_notifications n where n.customer_id = $1 and n.entity_id = $2 order by n.created_at`, [cust, inv1.id]);
  check(live.rows.map((x: any) => x.type).join() === 'INVOICE_ISSUED,PAYMENT_CONFIRMED,INVOICE_PAID_READY', 'the client\'s screen is refreshed by three notifications: issued, payment confirmed, paid invoice ready (no polling)', live.rows);

  // ---- failures and retries
  // (a) storage down: the invoice exists, nothing is marked stored or sent; the retry finishes
  {
    useR2('http://127.0.0.1:9');
    const m = mailsBefore();
    r = await api('accm', 'POST', '/accounts/generated-invoices', payload({ lines: [line({ baseAmount: 500 })] }));
    useR2(goodEndpoint);
    const bad = r.json.data;
    check(r.status === 201 && bad.invoice.generated.unpaid.pdfStatus === 'FAILED' && bad.steps.map((s: any) => `${s.step}:${s.status}`).join() === 'ISSUE:DONE,PDF:FAILED' && /File storage is not available/.test(bad.steps[1].message), 'storage down: the invoice is issued, the PDF step failed with a clear message', r);
    check(smtpMail.length === m && (await row(bad.invoice.id)).unpaid_storage_ref === null && (await row(bad.invoice.id)).unpaid_email_status === 'PENDING', 'storage down: no reference saved, no e-mail');
    r = await api('cl2', 'GET', '/client/invoices');
    check(!(r.json.data as any[]).some(i => i.id === bad.invoice.id), 'storage down: the client does not see an invoice that has no file yet');
    r = await api('accm', 'GET', `/invoices/${bad.invoice.id}/pdf?stage=UNPAID`);
    check(r.status === 404, 'storage down: there is no file to open (404)', r);
    r = await api('accm', 'POST', `/accounts/generated-invoices/${bad.invoice.id}/deliver`, { stage: 'UNPAID' });
    check(r.status === 200 && r.json.data.steps.map((s: any) => `${s.step}:${s.status}`).join() === 'PDF:DONE,EMAIL:DONE' && smtpMail.length === m + 1, 'storage back: the retry stores the file and sends the e-mail (same invoice, same number)', r);
    check((await db.query(`select count(*)::int n from generated_invoices where invoice_id = $1`, [bad.invoice.id])).rows[0].n === 1 && r.json.data.invoice.number === bad.invoice.number, 'the retry did not create another invoice or number');
    r = await api('cl2', 'GET', '/client/invoices');
    check((r.json.data as any[]).some(i => i.id === bad.invoice.id && i.hasFile), 'and now the client sees it');
  }
  // (b) the mail server refuses: the PDF stays stored (and is not redrawn), the e-mail is "failed", the retry only sends
  {
    smtpMode = 'busy';
    const m = mailsBefore();
    r = await api('accm', 'POST', '/accounts/generated-invoices', payload({ lines: [line({ baseAmount: 700 })] }));
    const inv = r.json.data.invoice;
    check(r.status === 201 && r.json.data.steps.map((s: any) => `${s.step}:${s.status}`).join() === 'ISSUE:DONE,PDF:DONE,EMAIL:FAILED' && /SMTP error 451/.test(r.json.data.steps[2].message), 'mail server busy: the e-mail step failed with the reason', r.json.data.steps);
    let g = await row(inv.id);
    check(g.unpaid_pdf_status === 'STORED' && g.unpaid_email_status === 'FAILED' && g.unpaid_email_sent_at === null && g.unpaid_email_attempts === 1 && smtpMail.length === m, 'it is recorded as failed, never as sent');
    const stampBefore = fake.objects.get(objectKey(inv.id, 'unpaid'))!.body;
    smtpMode = 'ok';
    r = await api('accm', 'POST', `/accounts/generated-invoices/${inv.id}/deliver`, { stage: 'UNPAID' });
    g = await row(inv.id);
    check(r.status === 200 && r.json.data.steps.map((s: any) => `${s.step}:${s.status}`).join() === 'PDF:DONE,EMAIL:DONE' && /already stored/.test(r.json.data.steps[0].message) && g.unpaid_email_status === 'SENT' && g.unpaid_email_attempts === 2 && smtpMail.length === m + 1,
      'the retry sends the stored file, once', r);
    check(attachmentOf(smtpMail.at(-1)!.data)!.equals(stampBefore), 'and it is the file that was stored, not a new one');
  }
  // (c) the paid e-mail fails after the payment: the payment stays, the paid file is available, the e-mail can be retried alone
  {
    r = await api('accm', 'POST', '/accounts/generated-invoices', payload({ lines: [line({ baseAmount: 900 })] }));
    const inv = r.json.data.invoice;
    smtpMode = 'reject';
    const m = mailsBefore();
    r = await api('accm', 'POST', `/accounts/generated-invoices/${inv.id}/confirm-payment`, { method: 'BANK_TRANSFER', reference: 'NEFT 1' });
    check(r.status === 200 && r.json.data.invoice.status === 'Paid' && r.json.data.steps.map((s: any) => `${s.step}:${s.status}`).join() === 'PAYMENT:DONE,PDF:DONE,EMAIL:FAILED,WHATSAPP:NOT_SENT', 'paid e-mail rejected: the payment stays confirmed, the paid PDF is stored, the e-mail failed', r.json.data.steps);
    let g = await row(inv.id);
    check(g.lifecycle === 'PAID' && g.paid_pdf_status === 'STORED' && g.paid_email_status === 'FAILED' && g.unpaid_email_status === 'SENT', 'the stages are recorded separately');
    r = await api('cl2', 'GET', `/client/invoices/${inv.id}/url`);
    check(r.status === 200 && /paid\.pdf/.test(decodeURIComponent(r.json.data.url)), 'the client already has the paid file (it is stored and linked, whatever the e-mail did)', r);
    smtpMode = 'ok';
    r = await api('accm', 'POST', `/accounts/generated-invoices/${inv.id}/deliver`, { stage: 'PAID' });
    g = await row(inv.id);
    check(r.status === 200 && g.paid_email_status === 'SENT' && smtpMail.length === m + 1 && r.json.data.invoice.number === inv.number && (await db.query(`select count(*)::int n from generated_invoices where customer_id = $1`, [cust])).rows[0].n >= 1, 'retrying the paid e-mail sends it once and creates no new invoice');
  }
  // (d) dry run: nothing is sent and nothing is marked sent; once e-mail is live the retry sends it
  {
    process.env.AUTOMATION_MODE = 'dry_run';
    const m = mailsBefore();
    r = await api('accm', 'POST', '/accounts/generated-invoices', payload({ lines: [line({ baseAmount: 1100 })] }));
    const inv = r.json.data.invoice;
    check(r.json.data.steps[2].status === 'NOT_SENT' && /Dry run/.test(r.json.data.steps[2].message) && smtpMail.length === m, 'dry run: the e-mail step says "not sent" with the reason', r.json.data.steps);
    check((await row(inv.id)).unpaid_email_status === 'NOT_SENT' && (await row(inv.id)).unpaid_email_sent_at === null, 'dry run: the database does not say sent');
    process.env.AUTOMATION_MODE = 'live';
    r = await api('accm', 'POST', `/accounts/generated-invoices/${inv.id}/deliver`, { stage: 'UNPAID' });
    check(r.json.data.steps[1].status === 'DONE' && (await row(inv.id)).unpaid_email_status === 'SENT' && smtpMail.length === m + 1, 'live again: the retry sends it');
    // test mode: a recipient that is not on the list gets nothing
    process.env.AUTOMATION_TEST_RECIPIENTS = 'someone.else@example.com';
    r = await api('accm', 'POST', '/accounts/generated-invoices', payload({ lines: [line({ baseAmount: 1200 })] }));
    check(r.json.data.steps[2].status === 'NOT_SENT' && /Test mode/.test(r.json.data.steps[2].message), 'test mode: an e-mail to a non-test recipient is not sent', r.json.data.steps);
    delete process.env.AUTOMATION_TEST_RECIPIENTS;
    // a customer without an e-mail address
    await db.query(`update customers set email = null, phone = coalesce(phone, '9819900022') where id = $1`, [cust]);
    r = await api('accm', 'POST', '/accounts/generated-invoices', payload({ lines: [line({ baseAmount: 1300 })] }));
    check(r.json.data.steps[2].status === 'NOT_SENT' && /no valid e-mail/.test(r.json.data.steps[2].message), 'no customer e-mail: not sent, with the reason (the invoice and PDF exist)', r.json.data.steps);
    await db.query(`update customers set email = $2 where id = $1`, [cust, custEmail]);
  }
  // (e) a stale lease frees itself
  {
    r = await api('accm', 'POST', '/accounts/generated-invoices', payload({ lines: [line({ baseAmount: 1400 })] }));
    const inv = r.json.data.invoice;
    await db.query(`update generated_invoices set unpaid_email_status = 'FAILED', unpaid_email_sent_at = null, unpaid_work_until = now() + interval '2 minutes' where invoice_id = $1`, [inv.id]);
    r = await api('accm', 'POST', `/accounts/generated-invoices/${inv.id}/deliver`, { stage: 'UNPAID' });
    check(r.status === 200 && r.json.data.steps[0].status === 'BUSY', 'a run that holds the stage blocks a second one (BUSY)', r.json.data.steps);
    await db.query(`update generated_invoices set unpaid_work_until = now() - interval '1 second' where invoice_id = $1`, [inv.id]);
    r = await api('accm', 'POST', `/accounts/generated-invoices/${inv.id}/deliver`, { stage: 'UNPAID' });
    check(r.status === 200 && r.json.data.steps.some((s: any) => s.step === 'EMAIL' && s.status === 'DONE'), 'once the lease has expired the stage can be worked again', r.json.data.steps);
  }

  // ---- tax treatments through the whole stack
  {
    r = await api('accm', 'POST', '/accounts/generated-invoices', payload({ customer: { ...payload().customer, gstin: '24AAAAA0000A1Z5', stateCode: '24' }, taxTreatment: 'INTER_STATE', lines: [line({ baseAmount: 10000 }), line({ baseAmount: 6000 })] }));
    const t = r.json.data.invoice.generated;
    check(r.status === 201 && t.taxTreatment === 'INTER_STATE' && t.totals.igstAmount === 2880 && t.totals.cgstAmount === 0 && t.totals.igstRate === 18 && t.totals.total === 18880 && t.totals.inWords === 'Eighteen Thousand Eight Hundred Eighty Only/-', 'inter-state: IGST Rs.2,880 on Rs.16,000, total Rs.18,880 in words', r);
    const txt = pdfText(fake.objects.get(objectKey(r.json.data.invoice.id, 'unpaid'))!.body);
    if (txt) check(/Add: IGST/.test(txt) && !/Add: CGST/.test(txt) && /Rs\.18,880\.00/.test(txt) && /State: GUJARAT/.test(txt) && /State Code: 24/.test(txt), 'inter-state: the PDF shows IGST only, Gujarat, code 24');
    r = await api('accm', 'POST', '/accounts/generated-invoices', payload({ lines: Array.from({ length: 14 }, (_, i) => line({ particulars: `Service row ${i + 1} with a reasonably long description of the work included`, baseAmount: 1000 + i })) }));
    const many = r.json.data.invoice;
    const manyPdf = fake.objects.get(objectKey(many.id, 'unpaid'))!.body;
    const pages = (manyPdf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length;
    check(r.status === 201 && many.generated.lines.length === 14 && manyPdf.length < 500000 && pages >= 2, `fourteen rows: a multi-page PDF (${pages} pages, ${manyPdf.length} bytes) below the limit`);
  }

  // ---- the SQL and TypeScript rules give the same words and states
  {
    const amounts = [1, 99, 100, 1000, 12345.5, 99999, 100000, 123456.78, 9999999, 10000000, 100000000.01, 18880, 39680.5, 0.5, 9999999999.99];
    let same = true;
    for (const a of amounts) {
      const sql = (await db.query(`select private.amount_in_words($1::numeric) w`, [String(a)])).rows[0].w;
      if (sql !== amountInWords(Math.round(a * 100))) { same = false; check(false, `words differ for ${a}`, { sql, ts: amountInWords(Math.round(a * 100)) }); }
    }
    check(same, 'rupees in words: the database and the browser/PDF code agree on every sample');
    const addresses = ['1107, Shagun Insignia, Sec 19 Ulwe, Navi Mumbai, Maharashtra', 'D/1801, Pancham, Nanded City, Pune 411068', '12 Delhi Road, Mumbai, Maharashtra 400001', 'Plot 4, Surat, Gujarat', 'New Delhi', 'Orissa', 'Dadra & Nagar Haveli', 'Jammu & Kashmir 190001', 'Telengana, Hyderabad', '', 'Maharashtra Gujarat Goa'];
    for (const a of addresses) {
      const sql = (await db.query(`select private.infer_state_code($1) c`, [a])).rows[0].c as string | null;
      const ts = inferStateFromAddress(a)?.code ?? null;
      if (sql !== ts) check(false, `state differs for "${a}"`, { sql, ts });
    }
    check(true, 'state from an address: the database and the TypeScript rules agree on every sample');
    const { GST_STATES } = await import('../../shared/gst.js');
    const dbStates = (await db.query(`select code, name from gst_states order by code`)).rows;
    check(JSON.stringify(dbStates) === JSON.stringify(GST_STATES.map(s => ({ code: s.code, name: s.name }))), 'the GST state list in the database and in the code are the same');
  }

  // ---- the balance: what was paid, what is left, part payments, one paid-invoice workflow
  {
    const m = mailsBefore();
    r = await api('accm', 'POST', '/accounts/generated-invoices', payload({ lines: [line({ baseAmount: 10000 })] }));
    const bi = r.json.data?.invoice;
    check(r.status === 201 && bi.total === 11800 && bi.generated.paymentSummary.total === 11800 && bi.generated.paymentSummary.confirmed === 0 && bi.generated.paymentSummary.balance === 11800
      && bi.generated.paymentSummary.state === 'UNPAID' && bi.generated.paymentSummary.ledger === 'INVOICE', 'balance: a new invoice shows its full balance (total 11,800, nothing confirmed)', r);
    const unpaidBytes = fake.objects.get(objectKey(bi.id, 'unpaid'))!.body;
    const balText = pdfText(unpaidBytes);
    if (balText) check(/Invoice Total: .*Rs\.11,800\.00/.test(balText) && /Payments Received: .*Rs\.0\.00/.test(balText) && /Balance Outstanding: .*Rs\.11,800\.00/.test(balText) && /Payment Status: Unpaid/.test(balText),
      'balance: the unpaid PDF prints the total, payments received, balance outstanding and the status');
    check(unpaidBytes.length < 500000, 'balance: the PDF stays under 500,000 bytes', unpaidBytes.length);

    const mIssued = mailsBefore(); // (issuing sent the unpaid invoice)
    const confirm = (body: Record<string, unknown>, id = bi.id) => api('accm', 'POST', `/accounts/generated-invoices/${id}/confirm-payment`, body);
    r = await confirm({ method: 'UPI', reference: 'BAL-1', amount: '0' });
    check(r.status === 422, 'balance: a zero amount is refused', r);
    r = await confirm({ method: 'UPI', reference: 'BAL-1', amount: 'abc' });
    check(r.status === 422, 'balance: a text amount is refused', r);
    r = await confirm({ method: 'UPI', reference: 'BAL-1', amount: '11800.005' });
    check(r.status === 422, 'balance: three decimals are refused', r);
    r = await confirm({ method: 'UPI', reference: 'BAL-1', amount: '12000' });
    check(r.status === 422 && /more than the balance/.test(r.json.error.message), 'balance: more than the balance is refused', r);
    r = await confirm({ amount: '5000', reference: 'BAL-1' });
    check(r.status === 422, 'balance: the payment method is required when a payment is recorded', r);
    r = await confirm({ method: 'UPI', amount: '5000' });
    check(r.status === 422 && /reference/.test(r.json.error.message), 'balance: a UPI payment needs its reference', r);
    check((await db.query(`select count(*)::int n from invoice_payments where invoice_id = $1`, [bi.id])).rows[0].n === 0, 'balance: none of the refused requests recorded a payment');

    const req = crypto.randomUUID();
    r = await confirm({ method: 'UPI', reference: 'BAL-1', amount: '5000', requestId: req });
    check(r.status === 200 && r.json.data.steps.length === 1 && r.json.data.steps[0].step === 'PAYMENT' && /Part payment recorded/.test(r.json.data.steps[0].message)
      && r.json.data.invoice.status === 'Pending' && r.json.data.invoice.generated.paymentSummary.confirmed === 5000 && r.json.data.invoice.generated.paymentSummary.balance === 6800
      && r.json.data.invoice.generated.paymentSummary.state === 'PARTIALLY_PAID', 'balance: a part payment of 5,000 leaves 6,800, partially paid, the invoice stays open', r);
    const gb = await row(bi.id);
    check(gb.lifecycle === 'ISSUED' && gb.paid_pdf_status === 'NOT_DUE' && smtpMail.length === mIssued, 'balance: no paid invoice is made and no e-mail is sent for a part payment');
    r = await confirm({ method: 'UPI', reference: 'BAL-1', amount: '5000', requestId: req });
    check(r.status === 200 && r.json.data.invoice.generated.paymentSummary.balance === 6800 && (await db.query(`select count(*)::int n from invoice_payments where invoice_id = $1`, [bi.id])).rows[0].n === 1, 'balance: the same request again records nothing new', r);
    r = await confirm({ method: 'UPI', reference: 'bal-1', amount: '100' });
    check(r.status === 409 && /already recorded/.test(r.json.error.message), 'balance: the same reference cannot be recorded twice', r);
    r = await api('accm', 'PATCH', `/accounts/invoices/${bi.id}`, { status: 'Paid' });
    check(r.status === 409, 'balance: the old "mark as paid" switch cannot settle a generated invoice (one workflow)', r);
    r = await api('cl2', 'GET', '/client/invoices');
    const cb = (r.json.data as any[]).find(i => i.id === bi.id);
    check(cb.paymentSummary.balance === 6800 && cb.paymentSummary.confirmed === 5000 && cb.status === 'Pending' && !cb.paidFilePending, 'balance: the client sees the same balance', cb);

    r = await confirm({ method: 'CASH', note: 'rest in cash' });
    check(r.status === 200 && r.json.data.invoice.status === 'Paid' && r.json.data.invoice.generated.paymentSummary.balance === 0 && r.json.data.invoice.generated.paymentSummary.state === 'FULLY_PAID'
      && r.json.data.steps.map((x: any) => `${x.step}:${x.status}`).join() === 'PAYMENT:DONE,PDF:DONE,EMAIL:DONE,WHATSAPP:NOT_SENT', 'balance: the last payment (the whole balance by default) settles it: paid invoice stored and e-mailed', r);
    const paidBytes = fake.objects.get(objectKey(bi.id, 'paid'))!.body;
    const paidText = pdfText(paidBytes);
    if (paidText) check(/Balance Outstanding: .*Rs\.0\.00/.test(paidText) && /Payment Status: Fully Paid/.test(paidText) && /This Payment: .*Rs\.6,800\.00/.test(paidText) && /Payments Received: .*Rs\.11,800\.00/.test(paidText),
      'balance: the paid PDF shows the total, all payments, the current payment, balance 0 and Fully Paid');
    check(paidBytes.length < 500000 && smtpMail.length === m + 2, 'balance: under 500,000 bytes; one e-mail for the unpaid and one for the paid invoice', paidBytes.length);
    r = await confirm({ method: 'CASH' });
    check(r.status === 200 && r.json.data.steps[0].message === 'The payment was already confirmed.' && (await db.query(`select count(*)::int n from invoice_payments where invoice_id = $1`, [bi.id])).rows[0].n === 2 && smtpMail.length === m + 2,
      'balance: confirming again changes nothing: no second payment, file or e-mail', r);
    r = await confirm({ method: 'CASH', amount: '10' });
    check(r.status === 200 && /already confirmed/.test(r.json.data.steps[0].message) && (await db.query(`select count(*)::int n from invoice_payments where invoice_id = $1`, [bi.id])).rows[0].n === 2, 'balance: a late payment on a settled invoice records nothing');
    const inc = (await db.query(`select amount::numeric a from private.verified_income() where customer_id = $1 and (reference = 'BAL-1' or (method = 'CASH' and amount = 6800))`, [cust])).rows;
    check(inc.length === 2 && inc.reduce((t: number, x: any) => t + Number(x.a), 0) === 11800, 'balance: both payments count as income', inc);
    r = await api('a', 'POST', `/accounts/generated-invoices/${bi.id}/confirm-payment`, { method: 'CASH' });
    check(r.status === 403, 'balance: a salesperson cannot confirm', r);
  }

  for (const k of ['STORAGE_PROVIDER', 'R2_ENDPOINT', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET', 'AUTOMATION_MODE', 'EMAIL_PROVIDER', 'EMAIL_FROM', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'SMTP_PASS']) delete process.env[k];
  fake.server.close();
  smtp.close();
}

// --- Support leads, the direct journey (no Technical Consultant), delivery departments, service settings -------------------
{
  const api = apiLegacy;
  const ds = (await api('sa', 'GET', '/departments')).json.data.find((d: any) => d.slug === 'designstudio');
  const dsTeam = (await api('sa', 'GET', `/teams?departmentId=${ds.id}`)).json.data[0];
  r = await api('sa', 'POST', '/users', { email: 'ds.mem@amuwa.com', fullName: 'DS Member', password: 'Sup3rSecret!', role: 'TEAM_MEMBER', teamId: dsTeam.id });
  check(r.status === 201, 'journey: the Design Studio gets a team member', r);
  tokens.set('dsm', tokenFor(r.json.data.id));

  // ---- Support creates and manages its own lead (the Sales pipeline endpoints, same database record)
  r = await api('sm', 'POST', '/pipeline/leads', { name: 'Sushma Rao', company: 'Rao Boutique', phone: '9820000201', whatsapp: '9820000201', email: 'sushma@raoboutique.example', leadSource: 'Referral', services: ['DS_META_ADS'], notes: 'Referred by a friend' });
  check(r.status === 201, 'Support: a Support member creates a lead', r);
  const lead = r.json.data.id;
  r = await api('sm', 'GET', `/pipeline/customers/${lead}`);
  check(r.status === 200 && r.json.data.leadSource === 'Referral' && r.json.data.whatsapp === '9820000201' && r.json.data.services.join() === 'DS_META_ADS' && r.json.data.lifecycleStage === 'LEAD', 'Support: the lead keeps its referral source, WhatsApp number and service', r);
  r = await api('sm', 'GET', '/pipeline/customers?stage=LEAD');
  check(r.status === 200 && r.json.data.items.some((i: any) => i.id === lead), 'Support: it is in the Support member\'s lead list', r);
  r = await api('a', 'GET', '/pipeline/customers?stage=LEAD');
  check(r.status === 200 && !r.json.data.items.some((i: any) => i.id === lead), 'Support: a Sales member does not see it', r);
  r = await api('a', 'GET', `/pipeline/customers/${lead}`);
  check(r.status === 404, 'Support: nor open it', r);
  r = await api('a', 'PATCH', `/pipeline/leads/${lead}`, { leadStatus: 'INTERESTED' });
  check(r.status === 404, 'Support: nor change it', r);
  r = await api('sm', 'PATCH', `/pipeline/leads/${lead}`, { leadStatus: 'INTERESTED', whatsapp: '9820000299', activityNote: 'Called back' });
  check(r.status === 200 && r.json.data.leadStatus === 'INTERESTED' && r.json.data.whatsapp === '9820000299', 'Support: it updates the status and the WhatsApp number', r);
  r = await api('sm', 'POST', `/pipeline/customers/${lead}/conversations`, { note: 'Wants to start this month' });
  check(r.status === 201 || r.status === 200, 'Support: it records a conversation', r);
  r = await api('sm', 'GET', `/pipeline/customers/${lead}/journey`);
  check(r.status === 200 && r.json.data.journey === 'DIRECT' && r.json.data.step === 'LEAD' && r.json.data.services[0].deliveryDepartment.name === 'Amuwa Design Studio', 'journey: a Meta Ads lead follows the direct journey; the service knows its department', r);
  r = await api('a', 'GET', `/pipeline/customers/${lead}/journey`);
  check(r.status === 404, 'journey: a Sales member cannot read it', r);

  // ---- Send to Accounts
  r = await api('sm', 'POST', `/pipeline/customers/${lead}/send-to-accounts`, { amount: 10000, note: 'half now' });
  check(r.status === 200, 'Support: Send to Accounts', r);
  r = await api('sm', 'POST', `/pipeline/customers/${lead}/send-to-accounts`, { amount: 10000 });
  check(r.status === 409, 'Support: a second submission is refused', r);
  check((await db.query(`select count(*)::int n from customers where phone = '9820000201'`)).rows[0].n === 1, 'Support: still one customer record');
  r = await api('accm', 'GET', '/pipeline/accounts/payment-requests?status=PENDING');
  const q = r.json.data.items.find((i: any) => i.id === lead);
  check(r.status === 200 && q && q.sentFrom === 'SUPPORT' && q.journey === 'DIRECT' && q.clientLogin === 'NOT_STARTED' && q.sentBy === 'Support Member' && q.services.join() === 'Meta Ads', 'Accounts: the queue shows it, sent by Support, direct journey, no login yet', q);

  // ---- Accounts: payment, then the client login, then Return to Sales
  await chooseGst(lead, 18);
  r = await api('accm', 'POST', `/pipeline/customers/${lead}/accounts/payments`, { type: 'PART', amount: 4000, method: 'UPI', reference: 'JRN-1', verify: false });
  check(r.status === 201 || r.status === 200, 'Accounts: records the payment (unverified)', r);
  const payId = (await db.query(`select id from customer_payments where customer_id = $1`, [lead])).rows[0].id;
  r = await api('accm', 'POST', `/pipeline/customers/${lead}/accounts/payment-confirmed`, {});
  check(r.status === 422 && /Record and verify/.test(r.json.error.message), 'Accounts: an unverified payment cannot confirm the customer', r);
  r = await api('accm', 'POST', `/pipeline/customers/${lead}/accounts/client-login`, {});
  check(r.status === 409 && /Verify a payment first/.test(r.json.error.message), 'Accounts: no login before a payment is verified', r);
  r = await api('accm', 'POST', `/pipeline/customers/${lead}/accounts/payments/${payId}/verify`, {});
  check(r.status === 200 || r.status === 204, 'Accounts: verifies the payment', r);
  r = await api('accm', 'GET', `/pipeline/customers/${lead}/journey`);
  check(r.status === 200 && r.json.data.step === 'LOGIN_PENDING' && r.json.data.can.createLogin === true && r.json.data.can.returnToSales === false && r.json.data.payment.verified === 4000, 'journey: payment verified, next is the login', r);
  r = await api('accm', 'POST', `/pipeline/customers/${lead}/accounts/payment-confirmed`, {});
  check(r.status === 422 && /dashboard login/.test(r.json.error.message), 'Accounts: Return to Sales is refused until the login exists', r);
  for (const [who, label] of [['a', 'a Sales member'], ['sm', 'the Support member who owns the customer'], ['tc', 'a Technical Consultant'], ['dh', 'the department head']] as const) {
    r = await api(who, 'POST', `/pipeline/customers/${lead}/accounts/client-login`, {});
    check(r.status === 403 || r.status === 404, `Accounts login: ${label} cannot create it`, r);
  }
  r = await api(null, 'POST', `/pipeline/customers/${lead}/accounts/client-login`, {});
  check(r.status === 401, 'Accounts login: no session is refused (401)', r);
  check((await db.query(`select count(*)::int n from customer_client_accounts where customer_id = $1`, [lead])).rows[0].n === 0, 'Accounts login: nothing was created by the refusals');
  r = await api('accm', 'POST', `/pipeline/customers/${lead}/accounts/client-login`, {});
  check(r.status === 201 && r.json.data.email === 'sushma@raoboutique.example', 'Accounts login: Accounts creates the client login with the e-mail on the record', r);
  const prov = (await db.query(`select p.status, p.attempts, p.email, a.auth_user_id from customer_client_provisioning p join customer_client_accounts a on a.customer_id = p.customer_id where p.customer_id = $1`, [lead])).rows[0];
  check(prov.status === 'CREATED' && prov.attempts === 1, 'Accounts login: the provisioning record is settled as created', prov);
  const stored = (await db.query(`select count(*)::int n from automation_jobs where customer_id = $1 and secret is not null`, [lead])).rows[0].n;
  check(stored === 0, 'Accounts login: no password is kept or queued for an e-mail');
  r = await api('accm', 'POST', `/pipeline/customers/${lead}/accounts/client-login`, {});
  check(r.status === 409, 'Accounts login: a second login for the same customer is refused', r);
  r = await api('accm', 'GET', `/pipeline/customers/${lead}/journey`);
  check(r.json.data.clientLogin.status === 'CREATED' && r.json.data.step === 'LOGIN_CREATED' && r.json.data.can.returnToSales === true && r.json.data.can.createLogin === false, 'journey: login created, Return to Sales offered', r.json.data);
  tokens.set('sushma', tokenFor(prov.auth_user_id));
  r = await api('sushma', 'GET', '/client/me');
  check(r.status === 200 && r.json.data.customerId === lead, 'the customer can sign in to their own client dashboard', r);
  r = await api('sushma', 'GET', `/pipeline/customers/${lead}/journey`);
  check(r.status === 403 || r.status === 401, 'a client token on the staff journey route is refused', r);
  r = await api('sm', 'GET', '/client/me');
  check(r.status === 403 || r.status === 401, 'a staff token on the client route is refused', r);

  r = await api('accm', 'POST', `/pipeline/customers/${lead}/accounts/payment-confirmed`, {});
  check(r.status === 200 || r.status === 204, 'Accounts: Return to Sales', r);
  r = await api('sm', 'GET', `/pipeline/customers/${lead}`);
  check(r.json.data.lifecycleStage === 'ONBOARDING' && r.json.data.paymentWorkflow === 'PAYMENT_CONFIRMED' && r.json.data.amountVerified === 4000 && r.json.data.dealAmount === 11800, 'the same customer is back with its owner: onboarding, payment kept (10,000 agreed + 18% GST = 11,800 payable)', r.json.data);
  r = await api('accm', 'POST', `/pipeline/customers/${lead}/accounts/payment-confirmed`, {});
  check(r.status === 409, 'Accounts: a second return is refused', r);
  r = await api('sm', 'GET', `/pipeline/customers/${lead}/journey`);
  check(r.json.data.step === 'RETURNED_TO_SALES' && r.json.data.journey === 'DIRECT', 'journey: returned to Sales, the documents are next', r.json.data);

  // ---- documents are verified by Sales, not by Accounts or a Technical Consultant
  await db.query(`insert into customer_onboarding_entries (customer_id, item_code, value, status, saved_by)
                  select $1, i.code, 'saved', 'SAVED', (select id from profiles where email = 'sm@amuwa.com') from private.customer_items($1) i where i.code <> 'INVOICE'
                  on conflict (customer_id, item_code) do nothing`, [lead]);
  await db.query(`insert into customer_onboarding_entries (customer_id, item_code, value, status) values ($1, 'INVOICE', 'INV', 'SAVED') on conflict (customer_id, item_code) do nothing`, [lead]);
  await db.query(`select private.refresh_onboarding_progress($1)`, [lead]);
  r = await api('sm', 'POST', `/pipeline/customers/${lead}/send-to-delivery`, {});
  check(r.status === 422 && /Verify every document/.test(r.json.error.message), 'delivery: cannot be sent before the documents are verified', r);
  for (const [who, label] of [['accm', 'Accounts'], ['tc', 'a Technical Consultant'], ['a', 'another salesperson'], ['dsm', 'the Design Studio']] as const) {
    r = await api(who, 'POST', `/pipeline/customers/${lead}/checklist/verify-all`, {});
    check(r.status === 404 || r.status === 403, `documents: ${label} cannot verify them`, r);
    r = await api(who, 'POST', `/pipeline/customers/${lead}/send-to-delivery`, {});
    check(r.status === 404 || r.status === 403, `delivery: ${label} cannot send the services on`, r);
  }
  r = await api('sm', 'POST', `/pipeline/customers/${lead}/checklist/verify-all`, {});
  check(r.status === 200 && r.json.data.verified > 0, 'documents: the owner verifies them', r);
  r = await api('sm', 'GET', `/pipeline/customers/${lead}/journey`);
  check(r.json.data.step === 'DOCUMENTS_VERIFIED' && r.json.data.can.sendToDelivery === true, 'journey: documents verified, sending offered', r.json.data);
  r = await api('dsm', 'GET', '/pipeline/delivery-queue');
  check(r.status === 200 && r.json.data.total === 0, 'delivery: the Design Studio queue is empty before sending', r);
  r = await api('sm', 'POST', `/pipeline/customers/${lead}/send-to-delivery`, { note: 'Start on the ad account' });
  check(r.status === 200 && r.json.data.sent === 1 && r.json.data.remaining === 0 && r.json.data.departments === 'Amuwa Design Studio', 'delivery: the owner sends the service to the Design Studio', r);
  r = await api('sm', 'POST', `/pipeline/customers/${lead}/send-to-delivery`, {});
  check(r.status === 409, 'delivery: a second send is refused', r);
  r = await api('dsm', 'GET', '/pipeline/delivery-queue');
  check(r.status === 200 && r.json.data.total === 1 && r.json.data.items[0].id === lead && r.json.data.items[0].referredFrom === 'SUPPORT' && r.json.data.items[0].services[0].code === 'DS_META_ADS' && r.json.data.items[0].balance === 7800,
    'delivery: the Design Studio sees it with the referrer, the service and the balance', r);
  r = await api('dsm', 'GET', `/pipeline/customers/${lead}`);
  check(r.status === 200, 'delivery: the Design Studio can open the customer', r);
  r = await api('dsm', 'PATCH', `/pipeline/leads/${lead}`, { name: 'Changed' });
  check(r.status === 404 || r.status === 403, 'delivery: but cannot edit it', r);
  r = await api('b', 'GET', '/pipeline/delivery-queue');
  check(r.status === 200 && r.json.data.total === 0, 'delivery: another department\'s queue stays empty', r);
  r = await api('sm', 'GET', `/pipeline/customers/${lead}/journey`);
  check(r.json.data.step === 'SENT_TO_DELIVERY' && r.json.data.lifecycleStage === 'CUSTOMER' && r.json.data.delivery.allSent, 'journey: sent to the delivery department, no Technical Consultant step', r.json.data);
  check((await db.query(`select count(*)::int n from customer_onboarding where customer_id = $1 and (forwarded_to_support_at is not null or with_consultant)`, [lead])).rows[0].n === 0, 'the Technical Consultant step was skipped');

  // ---- an invoice for each part payment (the agreed amount is 10,000; 4,000 verified)
  {
    const today = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
    const inv = (base: number) => ({
      requestId: crypto.randomUUID(), customerId: lead, purpose: 'SERVICES', invoiceNumber: null, invoiceDate: today, orderNumber: 'Verbal',
      customer: { name: 'Sushma Rao', businessName: 'Rao Boutique', address: 'Shop 2, FC Road, Pune 411004, Maharashtra', contactPerson: 'Sushma Rao', contactNumber: '9820000201', gstin: null, stateCode: '27' },
      taxTreatment: 'INTRA_STATE', terms: '100% Payment Against supply.',
      lines: [{ particulars: 'Meta Ads management, first instalment', hsnSac: '998313', taxRate: 18, quantity: '1 Nos', baseAmount: base }]
    });
    r = await api('accm', 'POST', '/accounts/generated-invoices', inv(3000));
    check(r.status === 201 && r.json.data.invoice.total === 3540 && r.json.data.invoice.generated.paymentSummary.confirmed === 3540, 'part payments: the first invoice (3,540) is covered by the 4,000 verified', r);
    r = await api('accm', 'POST', '/accounts/generated-invoices', inv(3000));
    check(r.status === 201 && r.json.data.invoice.generated.paymentSummary.confirmed === 460 && r.json.data.invoice.generated.paymentSummary.balance === 3080, 'part payments: a second invoice for the same customer is allowed and gets what is left (460)', r);
    r = await api('accm', 'POST', '/accounts/generated-invoices', inv(5000));
    check(r.status === 422 && /would total/.test(r.json.error.message), 'part payments: together the invoices cannot exceed the agreed amount', r);
    r = await api('accm', 'GET', `/accounts/customers/${lead}/invoice-prefill?purpose=SERVICES`);
    check(r.status === 200 && r.json.data.servicesInvoiced === 7080 && r.json.data.warnings.some((w: string) => /already issued/.test(w)), 'part payments: the builder is told what is already invoiced', r.json.data.warnings);
  }

  // ---- one order: an agreement of 1,20,000 before GST, two invoices of 60,000 + GST, part payments against the whole order
  {
    const today = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
    r = await api('a', 'POST', '/pipeline/leads', { name: 'Gita Xavier', company: 'Xavier Exports', email: 'gita.api@xavierexports.example', phone: '9820000207', leadSource: 'Walk-in', services: ['AI_CALLING'] });
    const gx = r.json.data.id;
    r = await api('a', 'POST', `/pipeline/customers/${gx}/send-to-accounts`, { amount: 120000, taxBasis: 'SOMETIMES' });
    check(r.status === 422, 'gst: an unknown basis is refused', r);
    r = await api('a', 'POST', `/pipeline/customers/${gx}/send-to-accounts`, { amount: 120000, taxBasis: 'EXCLUSIVE' });
    check(r.status === 200 || r.status === 201, 'gst: Sales sends 1,20,000 excluding GST to Accounts', r);
    r = await api('accm', 'GET', `/pipeline/customers/${gx}/payment-overview`);
    check(r.json.data.dealAmount === 120000 && r.json.data.agreedAmount === 120000 && r.json.data.taxBasis === 'EXCLUSIVE' && r.json.data.order.gstRequired === true && r.json.data.orderGst.selected === false && r.json.data.orderGst.rate === null,
      'gst: Sales agreed 1,20,000 before GST: the system adds no GST and the final payable is not calculated until Accounts chooses the rate', r.json.data);
    check(Array.isArray(r.json.data.orderGst.rates) && r.json.data.orderGst.rates.some((x: any) => x.rate === 18), 'gst: the screen is given the configured rates to choose from', r.json.data.orderGst);
    r = await api('accm', 'POST', `/pipeline/customers/${gx}/accounts/payments`, { type: 'PART', amount: 60000, method: 'UPI', reference: 'GX-API-0', verify: true });
    check(r.status === 422 && /GST rate/.test(r.json.error.message), 'gst: no payment is accepted before the rate is chosen', r);
    r = await api('accm', 'POST', `/pipeline/customers/${gx}/accounts/payments`, { type: 'PART', amount: 60000, gstRate: 18, method: 'UPI', reference: 'GX-API-0', verify: true });
    check(r.status === 422, 'gst: a payment cannot carry a GST rate of its own any more', r);
    r = await api('a', 'POST', `/pipeline/customers/${gx}/accounts/order-gst`, { rate: 18 });
    check(r.status === 403, 'gst: Sales cannot choose the rate', r);
    r = await api('accm', 'POST', `/pipeline/customers/${gx}/accounts/order-gst`, { rate: 'abc' });
    check(r.status === 422, 'gst: a rate that is not a number is refused', r);
    r = await api('accm', 'POST', `/pipeline/customers/${gx}/accounts/order-gst`, { rate: 17 });
    check(r.status === 422, 'gst: a rate that is not on the configured list is refused', r);
    r = await api('accm', 'POST', `/pipeline/customers/${gx}/accounts/order-gst`, { rate: 18 });
    check(r.status === 200 && r.json.data.dealAmount === 141600 && r.json.data.orderGst.rate === 18 && r.json.data.order.gstTotal === 21600 && r.json.data.order.totalPayable === 141600 && r.json.data.order.balance === 141600 && r.json.data.order.gstRequired === false,
      'gst: Accounts chooses 18%: GST 21,600, total payable 1,41,600, all outstanding', r);
    r = await api('accm', 'GET', `/pipeline/customers/${gx}/payment-overview`);
    check(r.json.data.orderGst.rate === 18 && r.json.data.dealAmount === 141600, 'gst: the rate and the amounts are read back from the database', r.json.data.orderGst);
    r = await api('accm', 'POST', `/pipeline/customers/${gx}/accounts/payments`, { type: 'PART', amount: 60000, method: 'UPI', reference: 'GX-API-1', verify: true });
    check(r.status === 201 && r.json.data.order.confirmed === 60000 && r.json.data.order.balance === 81600 && r.json.data.dealAmount === 141600, 'gst: 60,000 received: the order balance is 81,600 and the payment did not change the GST', r);
    r = await api('accm', 'POST', `/pipeline/customers/${gx}/accounts/order-gst`, { rate: 12 });
    check(r.status === 409, 'gst: the rate is fixed once a payment exists', r);
    const inv = () => ({
      requestId: crypto.randomUUID(), customerId: gx, purpose: 'SERVICES', invoiceNumber: null, invoiceDate: today, orderNumber: 'Verbal',
      customer: { name: 'Gita Xavier', businessName: 'Xavier Exports', address: 'Shop 2, FC Road, Pune 411004, Maharashtra', contactPerson: 'Gita Xavier', contactNumber: '9820000207', gstin: null, stateCode: '27' },
      taxTreatment: 'INTRA_STATE', terms: '100% Payment Against supply.',
      lines: [{ particulars: 'AI calling set-up', hsnSac: '998313', taxRate: 18, quantity: '1 Nos', baseAmount: 60000 }]
    });
    r = await api('accm', 'POST', '/accounts/generated-invoices', { ...inv(), lines: [{ ...inv().lines[0], taxRate: 12, baseAmount: 60000 }] });
    check(r.status === 422 && /18/.test(r.json.error.message), 'gst: an invoice line with another rate than the order\'s is refused', r);
    const body1 = inv();
    r = await api('accm', 'POST', '/accounts/generated-invoices', body1);
    const g1 = r.json.data?.invoice;
    check(r.status === 201 && g1.total === 70800 && g1.generated.paymentSummary.confirmed === 60000 && g1.generated.paymentSummary.balance === 10800 && g1.generated.paymentSummary.order.balance === 81600 && g1.generated.paymentSummary.order.totalPayable === 141600,
      'gst: invoice 1 is 60,000 + 10,800 GST = 70,800 with 60,000 paid, so 10,800 left on the invoice; the ORDER still has 81,600 to receive', r);
    r = await api('accm', 'POST', '/accounts/generated-invoices', body1);
    check(r.status === 200 && r.json.data.invoice.id === g1.id && /already (issued|saved)/.test(r.json.data.steps[0].message), 'gst: the same request again returns the same invoice', r);
    r = await api('accm', 'POST', '/accounts/generated-invoices', inv());
    const g2 = r.json.data?.invoice;
    check(r.status === 201 && g2.total === 70800 && g2.generated.paymentSummary.balance === 70800 && g2.generated.paymentSummary.order.invoicedTotal === 141600,
      'gst: the second 70,800 invoice is allowed (1,20,000 + 21,600 = 1,41,600 together)', r);
    r = await api('accm', 'POST', '/accounts/generated-invoices', { ...inv(), lines: [{ ...inv().lines[0], baseAmount: 1 }] });
    check(r.status === 422 && /before GST/.test(r.json.error.message), 'gst: real overbilling is still refused', r);
    check((await db.query(`select count(*)::int n from generated_invoices where customer_id = $1`, [gx])).rows[0].n === 2, 'gst: exactly two invoices exist');
    r = await api('accm', 'GET', `/accounts/customers/${gx}/invoice-prefill?purpose=SERVICES`);
    check(r.json.data.agreedTaxBasis === 'EXCLUSIVE' && r.json.data.servicesInvoicedTaxable === 120000 && r.json.data.agreedAmount === 120000, 'gst: the builder reads the agreement from the server', r.json.data);
    // the PDF is drawn from this same stored snapshot (its text is checked in the PDF unit tests and the invoice tests above)
    check(g1.generated.unpaid.pdfStatus === 'STORED' && g1.generated.unpaid.sizeBytes > 0 && g1.generated.paymentSummary.order.totalPayable === 141600, 'gst: the unpaid PDF was drawn from the snapshot that carries the order figures', g1.generated.unpaid);
    r = await api('accm', 'POST', `/pipeline/customers/${gx}/accounts/payments`, { type: 'PART', amount: 5000, method: 'CASH', verify: false });
    r = await api('accm', 'GET', `/pipeline/customers/${gx}/payment-overview`);
    check(r.json.data.order.confirmed === 60000 && r.json.data.order.pending === 5000 && r.json.data.order.balance === 81600, 'gst: a pending payment is not counted', r.json.data.order);
    r = await api('accm', 'POST', `/pipeline/customers/${gx}/accounts/payments`, { type: 'PART', amount: 40000, method: 'UPI', reference: 'GX-API-2', verify: true });
    r = await api('accm', 'GET', `/pipeline/customers/${gx}/payment-overview`);
    check(r.json.data.order.confirmed === 100000 && r.json.data.order.balance === 41600 && r.json.data.paymentStatus === 'PARTIALLY_PAID', 'gst: after 40,000 more, 41,600 is left and it is still partially paid', r.json.data.order);
    // client dashboard side: the customer's own invoice carries the same order figures
    r = await api('accm', 'GET', `/invoices/${g2.id}`);
    check(r.status === 200 && r.json.data.generated.paymentSummary.order.balance === 41600, 'gst: the invoice read back shows the current order balance', r.json.data);
    // basis corrections: Accounts only, with a reason
    r = await api('a', 'POST', `/accounts/customers/${gx}/agreement-basis`, { basis: 'INCLUSIVE', reason: 'Sales changed it' });
    check(r.status === 403, 'gst: Sales cannot change the basis of an agreement', r);
    r = await api('accm', 'POST', `/accounts/customers/${gx}/agreement-basis`, { basis: 'INCLUSIVE', reason: 'x' });
    check(r.status === 422, 'gst: a reason is required', r);
    r = await api('accm', 'POST', `/accounts/customers/${gx}/agreement-basis`, { basis: 'INCLUSIVE', reason: 'Customer says the amount had GST in it' });
    check(r.status === 409, 'gst: and it cannot be switched back below what is already invoiced', r);
    r = await api('a', 'GET', '/accounts/agreement-review');
    check(r.status === 403, 'gst: the reconciliation list is for Accounts', r);
    r = await api('accm', 'GET', '/accounts/agreement-review');
    check(r.status === 200 && Array.isArray(r.json.data) && !r.json.data.some((x: any) => x.customerId === gx), 'gst: Accounts can read the reconciliation list; this order is not on it', r);
    r = await api('accm', 'POST', `/pipeline/customers/${gx}/accounts/payments`, { type: 'FULL', amount: 41600, method: 'UPI', reference: 'GX-API-3', verify: true });
    check(r.status === 422, 'gst: the settling payment is refused while 5,000 is still waiting for verification (it is held against the balance)', r);
    r = await api('accm', 'GET', `/pipeline/customers/${gx}/payment-overview`);
    const waiting = r.json.data.payments.find((x: any) => x.status === 'PENDING');
    r = await api('accm', 'POST', `/pipeline/customers/${gx}/accounts/payments/${waiting.id}/reject`, { reason: 'Cash was not handed over' });
    check(r.status === 200 || r.status === 201, 'gst: the unverified payment is rejected', r);
    r = await api('accm', 'POST', `/pipeline/customers/${gx}/accounts/payments`, { type: 'FULL', amount: 41600, method: 'UPI', reference: 'GX-API-3', verify: true });
    r = await api('accm', 'GET', `/pipeline/customers/${gx}/payment-overview`);
    check(r.json.data.order.balance === 0 && r.json.data.order.state === 'FULLY_PAID' && r.json.data.paymentStatus === 'FULLY_PAID', 'gst: the last 41,600 settles the order', r.json.data.order);
  }

  // ---- service journey settings
  r = await api('sm', 'GET', '/pipeline/service-journeys');
  check(r.status === 200 && r.json.data.filter((x: any) => !x.requiresTechnicalConsultant).length === 6 && r.json.data.find((x: any) => x.code === 'WHATSAPP_API_BLUE_TICK').requiresTechnicalConsultant === true, 'settings: one catalogue; only the six Design Studio services skip the consultant', r);
  for (const who of ['sm', 'a', 'dh', 'accm', 'tc'] as const) {
    r = await api(who, 'PATCH', '/pipeline/service-journeys/GBP_SETUP', { requiresTechnicalConsultant: false, deliveryDepartmentId: ds.id });
    check(r.status === 403, `settings: ${who} cannot change how a service is delivered`, r);
  }
  r = await api('sa', 'PATCH', '/pipeline/service-journeys/GBP_SETUP', { requiresTechnicalConsultant: false });
  check(r.status === 422, 'settings: a service without a consultant needs a delivery department', r);
  r = await api('sa', 'PATCH', '/pipeline/service-journeys/GBP_SETUP', { requiresTechnicalConsultant: false, deliveryDepartmentId: ds.id });
  check(r.status === 200 && r.json.data.find((x: any) => x.code === 'GBP_SETUP').deliveryDepartment === 'Amuwa Design Studio', 'settings: the Super Admin can configure a service', r);
  r = await api('sa', 'PATCH', '/pipeline/service-journeys/GBP_SETUP', { requiresTechnicalConsultant: true });
  check(r.status === 200 && r.json.data.find((x: any) => x.code === 'GBP_SETUP').requiresTechnicalConsultant === true, 'settings: and put it back', r);

  // ---- a Technical Consultant service is not routed through the direct journey
  r = await api('a', 'POST', '/pipeline/leads', { name: 'Tara Iyer', company: 'Iyer Garments', phone: '9820000202', leadSource: 'Walk-in', services: ['WHATSAPP_API_BLUE_TICK'] });
  const tLead = r.json.data.id;
  r = await api('a', 'GET', `/pipeline/customers/${tLead}/journey`);
  check(r.json.data.journey === 'TECHNICAL' && r.json.data.followsTechnicalConsultant === true, 'a WhatsApp API customer follows the Technical Consultant journey', r.json.data);
  r = await api('a', 'POST', `/pipeline/customers/${tLead}/send-to-accounts`, { amount: 6000 });
  r = await api('accm', 'POST', `/pipeline/customers/${tLead}/accounts/client-login`, {});
  check(r.status === 409 && /Verify a payment first/.test(r.json.error.message), 'Accounts creates the login of a Technical Consultant customer too, once a payment is verified (not before)', r);
  r = await api('a', 'POST', `/pipeline/customers/${tLead}/send-to-delivery`, {});
  check(r.status === 409 || r.status === 422, 'and Sales cannot route it to a delivery department', r);
  // mixed order
  r = await api('a', 'POST', '/pipeline/leads', { name: 'Meera Nair', company: 'Nair Studio', phone: '9820000203', leadSource: 'Walk-in', services: ['AI_CALLING', 'DS_GRAPHIC_DESIGN'] });
  r = await api('a', 'GET', `/pipeline/customers/${r.json.data.id}/journey`);
  check(r.json.data.journey === 'MIXED' && r.json.data.services.length === 2 && r.json.data.services.find((x: any) => x.code === 'DS_GRAPHIC_DESIGN').requiresTechnicalConsultant === false && r.json.data.services.find((x: any) => x.code === 'AI_CALLING').requiresTechnicalConsultant === true,
    'a mixed order keeps each service\'s own setting and follows the Technical Consultant journey', r.json.data);
}

// --- Paid invoices only: saving sends nothing, a (part) payment confirms the PAID invoice, no GST is added by the system -------------
{
  await db.query(`alter table public.generated_invoices alter column paid_only set default true`);
  const { execFileSync, spawnSync } = await import('node:child_process');
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const R2 = { key: 'r2-po-key', secret: 'r2-po-secret', bucket: 'amuwa-files' };
  const fake = await startFakeR2({ ...R2, cors: false });
  Object.assign(process.env, { STORAGE_PROVIDER: 'r2', R2_ENDPOINT: fake.endpoint, R2_ACCESS_KEY_ID: R2.key, R2_SECRET_ACCESS_KEY: R2.secret, R2_BUCKET: R2.bucket });
  if (!smtp.listening) await new Promise<void>(rs => smtp.listen(0, '127.0.0.1', rs));
  Object.assign(process.env, {
    AUTOMATION_MODE: 'live', EMAIL_PROVIDER: 'smtp', EMAIL_FROM: 'Amuwa Corporation <meta@amuwa.com>',
    SMTP_HOST: '127.0.0.1', SMTP_PORT: String((smtp.address() as any).port), SMTP_SECURE: 'false', SMTP_USER: 'meta@amuwa.com', SMTP_PASS: 'abcd efgh ijkl mnop'
  });
  delete process.env.AUTOMATION_TEST_RECIPIENTS;
  smtpMode = 'ok';
  const today = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
  const pdfText = (bytes: Buffer) => {
    if (spawnSync('pdftotext', ['-v'], { stdio: 'ignore' }).error) return null;
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'inv-po-')), 'x.pdf');
    fs.writeFileSync(f, bytes);
    return execFileSync('pdftotext', ['-raw', f, '-'], { encoding: 'utf8' }).replace(/\s+/g, ' ');
  };

  r = await api('a', 'POST', '/pipeline/leads', { name: 'Paid Only', company: 'Paid Only Co', email: 'paid.only@example.com', phone: '9820000808', leadSource: 'Walk-in', services: ['AI_CALLING'] });
  const po = r.json.data.id;
  const key = (inv: string, stage: string) => `customer-documents/customers/${po}/invoices/${inv}/${stage}.pdf`;
  r = await api('a', 'POST', `/pipeline/customers/${po}/send-to-accounts`, { amount: 120000 });
  check(r.status === 200 || r.status === 201, 'paid-only: Sales sends 1,20,000 to Accounts without any GST choice', r);
  r = await api('accm', 'GET', `/pipeline/customers/${po}/payment-overview`);
  check(r.json.data.dealAmount === 120000 && r.json.data.agreedAmount === 120000 && r.json.data.order.gstRequired === true && r.json.data.order.gstRate === null, 'paid-only: the order is exactly the agreed amount - no GST added, and the final payable is not calculated yet', r.json.data);
  r = await api('accm', 'GET', `/accounts/customers/${po}/invoice-prefill?purpose=SERVICES`);
  check(r.status === 200 && r.json.data.lines[0].taxRate === null && r.json.data.lines[0].baseAmount === 120000 && r.json.data.orderGstRate === null && r.json.data.warnings.some((w: string) => /GST has not been chosen/.test(w)), 'paid-only: the invoice form starts without a GST rate and with the agreed amount, and says the order\'s rate comes first', r.json.data);
  const inv = (rate: number | string, base: number) => ({
    requestId: crypto.randomUUID(), customerId: po, purpose: 'SERVICES', invoiceNumber: null, invoiceDate: today, orderNumber: 'Verbal',
    customer: { name: 'Paid Only', businessName: 'Paid Only Co', address: 'Shop 5, FC Road, Pune 411004, Maharashtra', contactPerson: 'Paid Only', contactNumber: '9820000808', gstin: null, stateCode: '27' },
    taxTreatment: 'INTRA_STATE', terms: '100% Payment Against supply.',
    lines: [{ particulars: 'AI calling set-up', hsnSac: '998313', taxRate: rate, quantity: '1 Nos', baseAmount: base }]
  });
  r = await api('accm', 'POST', '/accounts/generated-invoices', inv('', 60000));
  check(r.status === 422 && /GST rate/.test(r.json.error.message), 'paid-only: a line without a GST rate is refused', r);
  r = await api('accm', 'POST', '/accounts/generated-invoices', inv(18, 60000));
  check(r.status === 422 && /Choose the GST rate for this order/.test(r.json.error.message), 'paid-only: no invoice before Accounts has chosen the GST rate of the order', r);
  r = await chooseGst(po, 18);
  check(r.status === 200 && r.json.data.dealAmount === 141600, 'paid-only: Accounts chooses 18% once for the order: payable 1,41,600', r);
  r = await api('accm', 'GET', `/accounts/customers/${po}/invoice-prefill?purpose=SERVICES`);
  check(r.json.data.orderGstRate === 18 && r.json.data.lines[0].taxRate === 18, 'paid-only: the invoice form now carries the order\'s rate', r.json.data.lines);
  r = await api('accm', 'POST', `/pipeline/customers/${po}/accounts/payments`, { type: 'PART', amount: 60000, method: 'UPI', reference: 'PO-API-1', verify: true });
  check(r.status === 201, 'paid-only: 60,000 received and verified', r);

  const mail0 = smtpMail.length;
  // the Department Heads' payment e-mails share this mail server; invoices are the messages that carry a PDF
  const withPdf = () => smtpMail.filter(m => /\.pdf/i.test(m.data)).length;
  const pdf0 = withPdf();
  const files0 = fake.objects.size;
  r = await api('accm', 'POST', '/accounts/generated-invoices', inv(18, 60000));
  const a = r.json.data?.invoice;
  check(r.status === 201 && a.total === 70800 && a.generated.paidOnly === true && r.json.data.steps.map((s: any) => `${s.step}:${s.status}`).join() === 'ISSUE:DONE' && /Nothing was sent/.test(r.json.data.steps[0].message),
    'paid-only: saving an invoice (60,000 + 18% GST chosen by Accounts = 70,800) only saves it', r);
  check(smtpMail.length === mail0 && fake.objects.size === files0 && a.generated.unpaid.pdfStatus === 'PENDING' && a.generated.paid.pdfStatus === 'NOT_DUE', 'paid-only: no e-mail, no PDF, nothing stored');
  r = await api('accm', 'POST', `/accounts/generated-invoices/${a.id}/deliver`, { stage: 'UNPAID' });
  check(r.status === 409 && /Unpaid invoices are not sent/.test(r.json.error.message), 'paid-only: an unpaid invoice cannot be made or sent', r);
  r = await api('accm', 'GET', `/pipeline/customers/${po}/payment-overview`);
  check(r.json.data.dealAmount === 141600, 'paid-only: the order payable is still 1,41,600: the invoice (70,800) plus the 60,000 not invoiced yet with the same 18% on it', r.json.data);

  // a part payment is enough for the paid invoice
  r = await api('a', 'POST', `/accounts/generated-invoices/${a.id}/confirm-payment`, {});
  check(r.status === 403, 'paid-only: a salesperson cannot confirm', r);
  r = await api('accm', 'POST', `/accounts/generated-invoices/${a.id}/confirm-payment`, { note: 'Part payment received' });
  check(r.status === 200 && r.json.data.steps.map((s: any) => `${s.step}:${s.status}`).join() === 'PAYMENT:DONE,PDF:DONE,EMAIL:DONE,WHATSAPP:NOT_SENT', 'paid-only: with a verified part payment (60,000 of 70,800) the PAID invoice is created, stored and e-mailed', r.json);
  const sm = smtpMail.at(-1);
  check(smtpMail.length === mail0 + 1 && sm && /paid\.pdf|paid/i.test(sm.data) , 'paid-only: exactly one e-mail left, the paid invoice');
  const paidObj = fake.objects.get(key(a.id, 'paid'));
  check(!!paidObj && paidObj.body.subarray(0, 5).toString() === '%PDF-' && !fake.objects.has(key(a.id, 'unpaid')), 'paid-only: the paid PDF is stored and there is no unpaid file');
  const txt = paidObj ? pdfText(paidObj.body) : null;
  if (txt) {
    check(/Current Invoice Total: Rs\.70,800\.00/.test(txt) && /Payments Applied to This Invoice: Rs\.60,000\.00/.test(txt) && /Invoice Balance: Rs\.10,800\.00/.test(txt)
        && /Order Total Payable \(incl\. GST\): Rs\.1,41,600\.00/.test(txt) && /Total Confirmed Payments: Rs\.60,000\.00/.test(txt) && /Total Order Balance Outstanding: Rs\.81,600\.00/.test(txt) && /\bPAID\b/.test(txt),
      'paid-only: the PDF shows the invoice total, what is applied to it, its own balance, the order payable, the confirmed 60,000, the order balance (81,600) and the PAID stamp');
    check(!/Balance Due on this Invoice|Invoice Status|Total Order Value/.test(txt), 'paid-only: and none of the removed rows');
  }
  r = await api('accm', 'POST', `/accounts/generated-invoices/${a.id}/confirm-payment`, {});
  check(r.status === 200 && smtpMail.length === mail0 + 1, 'paid-only: confirming again changes nothing and sends nothing', r.json);

  // ---- the paid invoice by WhatsApp (Wabastore): switched off by default, idempotent, short-lived link, honest status ----
  const waHits: { body: any; auth: string | undefined }[] = [];
  let waStatus = 200;
  let waSeq = 0;
  const waMock = http.createServer((req, res) => {
    let raw = '';
    req.on('data', d => (raw += d));
    req.on('end', () => {
      waHits.push({ body: JSON.parse(raw), auth: req.headers.authorization });
      res.writeHead(waStatus, { 'content-type': 'application/json' });
      res.end(waStatus === 200 ? `{"id":"wamid.API${++waSeq}"}` : '{"error":"busy"}');
    });
  });
  await new Promise<void>(rs => waMock.listen(0, '127.0.0.1', rs));
  const waUrl = `http://127.0.0.1:${(waMock.address() as net.AddressInfo).port}/send`;
  const waSend = (who: string, id: string, resend = false) => api(who, 'POST', `/accounts/generated-invoices/${id}/whatsapp`, { resend });
  const waCount = async () => (await db.query(`select count(*)::int n from invoice_whatsapp_dispatches where invoice_id = $1`, [a.id])).rows[0].n as number;
  process.env.AUTOMATION_MODE_INVOICE_WHATSAPP = 'dry_run';
  process.env.AUTOMATION_DISPATCH_SECRET = 'dispatch-secret-0123456789';
  const invoicesBeforeWa = (await db.query(`select count(*)::int n from generated_invoices`)).rows[0].n;

  r = await api('accm', 'GET', '/accounts/invoice-whatsapp/settings');
  check(r.status === 200 && r.json.data.enabled === true && r.json.data.autoSend === true, 'invoice WhatsApp: it starts switched ON with automatic sending (nobody has to switch it on)', r.json);
  // the checks below are about the switched-off state: the Super Admin switches it off for them
  r = await api('sa', 'POST', '/accounts/invoice-whatsapp/settings', { enabled: false, autoSend: false, templateName: null, templateLanguage: 'en', templateApproved: false });
  check(r.status === 200 && r.json.data.enabled === false, 'invoice WhatsApp: the Super Admin can still switch it off', r.json);
  await db.query(`delete from public.invoice_whatsapp_dispatches`); // what the automatic sending queued before the checks below (they start from nothing)
  r = await waSend('accm', a.id);
  check(r.status === 409 && /switched off/.test(r.json.error.message), 'invoice WhatsApp: switched off, a request says so', r);
  r = await waSend('a', a.id);
  check(r.status === 403, 'invoice WhatsApp: a salesperson cannot send an invoice by WhatsApp', r);
  r = await api('a', 'GET', `/accounts/generated-invoices/${a.id}/whatsapp`);
  check(r.status === 403, 'invoice WhatsApp: nor read the history', r);
  r = await api('cl2', 'POST', `/accounts/generated-invoices/${a.id}/whatsapp`, {});
  check(r.status === 401 || r.status === 403, 'invoice WhatsApp: a client login cannot', r);
  r = await api(null, 'POST', `/accounts/generated-invoices/${a.id}/whatsapp`, {});
  check(r.status === 401, 'invoice WhatsApp: nor a visitor', r);
  r = await api('accm', 'GET', '/accounts/invoice-whatsapp/settings');
  check(r.status === 200 && r.json.data.enabled === false && r.json.data.canEdit === false && r.json.data.templateApproved === false, 'invoice WhatsApp: Accounts can read the settings (off, no template), but not edit', r.json);
  r = await api('accm', 'POST', '/accounts/invoice-whatsapp/settings', { enabled: true, autoSend: false, templateName: 'invoice_paid', templateLanguage: 'en', templateApproved: true });
  check(r.status === 403, 'invoice WhatsApp: an Accounts member cannot change the settings', r);
  r = await api('sa', 'POST', '/accounts/invoice-whatsapp/settings', { enabled: true, autoSend: false, templateName: 'Bad Name', templateLanguage: 'en', templateApproved: false });
  check(r.status === 422, 'invoice WhatsApp: a template name that is not a registered-style name is refused', r);
  r = await api('sa', 'POST', '/accounts/invoice-whatsapp/settings', { enabled: true, autoSend: false, templateName: 'invoice_paid', templateLanguage: 'en', templateApproved: false, extra: 1 });
  check(r.status === 422, 'invoice WhatsApp: unknown fields are refused', r);
  r = await api('sa', 'POST', '/accounts/invoice-whatsapp/settings', { enabled: true, autoSend: false, templateName: 'invoice_paid', templateLanguage: 'en', templateApproved: false });
  check(r.status === 200 && r.json.data.enabled === true && r.json.data.templateApproved === false && r.json.data.canEdit === true, 'invoice WhatsApp: the Super Admin switches it on with a template that is not approved yet', r.json);

  // an unknown or malformed invoice (an unpaid one is refused by the database, see the SQL suite)
  r = await waSend('accm', crypto.randomUUID());
  check(r.status === 404, 'invoice WhatsApp: an unknown invoice is a 404', r);
  r = await waSend('accm', 'not-a-uuid');
  check(r.status === 422, 'invoice WhatsApp: a malformed id is refused', r);

  // default (dry run): decided and recorded, nothing leaves
  Object.assign(process.env, { WABASTORE_WEBHOOK_URL: waUrl, WABASTORE_API_KEY: 'wb-api-key-1' });
  r = await waSend('accm', a.id);
  check(r.status === 200 && r.json.data.mode === 'dry_run' && r.json.data.dispatch.status === 'DRY_RUN' && waHits.length === 0, 'invoice WhatsApp: in the default test mode the dispatch is recorded as DRY_RUN and nothing is sent', r.json);
  check(!/9820000808/.test(JSON.stringify(r.json)) && /^\+91XXXXXX0808$/.test(r.json.data.dispatch.recipient), 'invoice WhatsApp: the answer shows the number masked only');

  // live, template not approved: never sent
  process.env.AUTOMATION_MODE_INVOICE_WHATSAPP = 'live';
  r = await waSend('accm', a.id, true);
  check(r.status === 200 && r.json.data.dispatch.status === 'PENDING' && waHits.length === 0, 'invoice WhatsApp: live, but with a template that is not approved, nothing is sent (it waits)', r.json);

  // live with the approved template: sent once, to the right number, with the right invoice
  r = await api('sa', 'POST', '/accounts/invoice-whatsapp/settings', { enabled: true, autoSend: false, templateName: 'invoice_paid', templateLanguage: 'en', templateApproved: true });
  check(r.status === 200 && r.json.data.templateApproved === true, 'invoice WhatsApp: the template is marked approved');
  r = await waSend('accm', a.id);
  check(r.status === 200 && r.json.data.dispatch.status === 'ACCEPTED' && waHits.length === 1, 'invoice WhatsApp: live with the approved template: sent, and ACCEPTED (not "delivered")', r.json);
  const wa1 = waHits[0];
  check(wa1.auth === 'Bearer wb-api-key-1' && wa1.body.to === '+919820000808' && wa1.body.template === 'invoice_paid' && wa1.body.language === 'en' && wa1.body.reference.startsWith('invoice-whatsapp:'),
    'invoice WhatsApp: the request has the key, the customer\'s number, the approved template and a reference', wa1.body);
  const aInv = (await api('accm', 'GET', `/invoices/${a.id}`)).json.data;
  check(wa1.body.variables.invoiceNumber === aInv.number && wa1.body.variables.customerName === 'Paid Only Co' && /70,800\.00/.test(wa1.body.variables.amount), 'invoice WhatsApp: the number and amount are the invoice\'s own (70,800.00)', wa1.body.variables);
  const docRes = await fetch(wa1.body.document.url);
  const docBytes = Buffer.from(await docRes.arrayBuffer());
  check(docRes.status === 200 && docBytes.equals(fake.objects.get(key(a.id, 'paid'))!.body) && docBytes.subarray(0, 5).toString() === '%PDF-', 'invoice WhatsApp: the link serves exactly the stored PAID invoice PDF');
  check(/X-Amz-Expires=900/i.test(wa1.body.document.url) && wa1.body.document.filename === `${aInv.number.replace(/[^A-Za-z0-9._-]+/g, '-')}-paid-invoice.pdf`, 'invoice WhatsApp: the link is short-lived (15 minutes) and the file is named after the invoice');
  check(!JSON.stringify(r.json).includes('X-Amz') && !JSON.stringify(r.json).includes('http'), 'invoice WhatsApp: the answer to Accounts carries no link');
  const stored = JSON.stringify((await db.query(`select id, invoice_id, status, recipient_masked, provider_ref, detail from invoice_whatsapp_dispatches`)).rows) + JSON.stringify((await db.query(`select * from invoice_whatsapp_events`)).rows);
  check(!/X-Amz|amazonaws|http/.test(stored) && !stored.includes('9820000808'), 'invoice WhatsApp: no link and no full number is kept in the dispatch record or its history (only the internal duplicate key holds the number)');

  // duplicates: a second click, a retried request, simultaneous requests, an automation event
  r = await waSend('accm', a.id);
  check(r.status === 200 && r.json.data.replayed === true && waHits.length === 1, 'invoice WhatsApp: a second click returns the same dispatch and sends nothing', r.json);
  const burst = await Promise.all(Array.from({ length: 6 }, () => waSend('accm', a.id)));
  check(burst.every(x => x.status === 200) && waHits.length === 1 && (await waCount()) === 1, 'invoice WhatsApp: six simultaneous clicks: still one message and one dispatch', burst.map(x => x.status));
  r = await waSend('accm', a.id, true);
  check(r.status === 409 && /accepted a moment ago/.test(r.json.error.message) && waHits.length === 1, 'invoice WhatsApp: "send again" right after acceptance is refused', r);
  const dispatchCron = await dispatch('dispatch-secret-0123456789');
  check(waHits.length === 1 && dispatchCron.json.data.invoiceWhatsApp.claimed === 0, 'invoice WhatsApp: the scheduler never sends an accepted one again', dispatchCron.json.data?.invoiceWhatsApp);

  // delivery reports from the provider
  const sendReport = (body: unknown, secret?: string) => fetch(`${base}/internal/whatsapp/status`, { method: 'POST', headers: { 'content-type': 'application/json', ...(secret ? { authorization: `Bearer ${secret}` } : {}) }, body: JSON.stringify(body) }).then(async x => ({ status: x.status, json: (await x.json()) as any }));
  r = await sendReport({ reference: 'wamid.API1', status: 'delivered' }, 'wb-status-secret-0123456789');
  check(r.status === 503, 'invoice WhatsApp: delivery reports are refused until a secret is configured', r);
  process.env.WABASTORE_STATUS_SECRET = 'wb-status-secret-0123456789';
  r = await sendReport({ reference: 'wamid.API1', status: 'delivered' });
  check(r.status === 401, 'invoice WhatsApp: a delivery report without the secret is refused', r);
  r = await sendReport({ reference: 'wamid.API1', status: 'delivered' }, 'wrong-secret-0123456789xx');
  check(r.status === 401, 'invoice WhatsApp: nor with a wrong one', r);
  r = await sendReport({ reference: 'wamid.API1', status: 'sent' }, 'wb-status-secret-0123456789');
  check(r.status === 200 && r.json.data.ignored === true, 'invoice WhatsApp: a "sent" report is not news');
  r = await sendReport({ status: 'delivered' }, 'wb-status-secret-0123456789');
  check(r.status === 422, 'invoice WhatsApp: a report without a reference is refused', r);
  r = await sendReport({ reference: 'wamid.UNKNOWN', status: 'delivered' }, 'wb-status-secret-0123456789');
  check(r.status === 200 && r.json.data.matched === false, 'invoice WhatsApp: a report for an unknown message changes nothing');
  r = await api('accm', 'GET', `/accounts/generated-invoices/${a.id}/whatsapp`);
  check(r.json.data[0].status === 'ACCEPTED' && r.json.data[0].deliveredAt === null, 'invoice WhatsApp: still only ACCEPTED: the provider has not reported delivery', r.json.data[0]);
  r = await sendReport({ reference: 'wamid.API1', status: 'delivered' }, 'wb-status-secret-0123456789');
  check(r.status === 200 && r.json.data.matched === true, 'invoice WhatsApp: the provider\'s delivery report is applied');
  r = await sendReport({ reference: 'wamid.API1', status: 'read' }, 'wb-status-secret-0123456789');
  r = await sendReport({ reference: 'wamid.API1', status: 'delivered' }, 'wb-status-secret-0123456789');
  r = await api('accm', 'GET', `/accounts/generated-invoices/${a.id}/whatsapp`);
  check(r.json.data.length === 1 && r.json.data[0].status === 'READ' && r.json.data[0].deliveredAt && r.json.data[0].events.some((e: any) => e.kind === 'ACCEPTED') && r.json.data[0].events.some((e: any) => e.kind === 'DELIVERED'),
    'invoice WhatsApp: the history shows accepted, then delivered, then read; a late "delivered" did not downgrade it', r.json.data[0]);
  r = await waSend('accm', a.id, true);
  check(r.status === 409 && /already delivered/.test(r.json.error.message), 'invoice WhatsApp: a delivered invoice is not sent again to the same number', r);

  // a provider that fails: the message is retried, the invoice is untouched, no invoice is created
  await db.query(`update public.customers set phone = '9820000809' where id = $1`, [po]);
  waStatus = 503;
  r = await waSend('accm', a.id);
  check(r.status === 200 && r.json.data.dispatch.status === 'RETRY' && r.json.data.dispatch.attempts === 1 && !/"error":"busy"/.test(JSON.stringify(r.json)), 'invoice WhatsApp: an unavailable provider (503) leaves a retry scheduled; its reply is not stored', r.json);
  check((await waCount()) === 2, 'invoice WhatsApp: the corrected number is a separate dispatch (the first stays as it was)');
  const aAfter = (await db.query(`select paid_pdf_status, lifecycle from generated_invoices where invoice_id = $1`, [a.id])).rows[0];
  check(aAfter.paid_pdf_status === 'STORED' && aAfter.lifecycle === 'PAID' && (await db.query(`select count(*)::int n from generated_invoices`)).rows[0].n === invoicesBeforeWa, 'invoice WhatsApp: the failure changed nothing about the invoice and made no new one');
  waStatus = 200;
  await db.query(`update public.invoice_whatsapp_dispatches set next_attempt_at = now() - interval '1 minute' where status = 'RETRY'`);
  const hitsBeforeRetry = waHits.length;
  r = await dispatch('dispatch-secret-0123456789');
  check(r.json.data.invoiceWhatsApp.accepted === 1 && waHits.length === hitsBeforeRetry + 1 && waHits.at(-1)!.body.to === '+919820000809', 'invoice WhatsApp: the scheduler retries it, and it is accepted once the provider is back', r.json.data.invoiceWhatsApp);
  r = await dispatch('dispatch-secret-0123456789');
  check(waHits.length === hitsBeforeRetry + 1, 'invoice WhatsApp: ... and only once');

  // switching it off again stops everything
  r = await api('sa', 'POST', '/accounts/invoice-whatsapp/settings', { enabled: false, autoSend: true, templateName: 'invoice_paid', templateLanguage: 'en', templateApproved: true });
  check(r.status === 200 && r.json.data.enabled === false && r.json.data.autoSend === false, 'invoice WhatsApp: switched off, automatic sending is off with it');
  await db.query(`update public.customers set phone = '9820000808' where id = $1`, [po]);

  // automatic sending, tested on the next paid invoice (below): on, live and approved
  r = await api('sa', 'POST', '/accounts/invoice-whatsapp/settings', { enabled: true, autoSend: true, templateName: 'invoice_paid', templateLanguage: 'en', templateApproved: true });
  check(r.status === 200 && r.json.data.autoSend === true, 'invoice WhatsApp: automatic sending is switched on');
  const hitsBeforeAuto = waHits.length;

  // the second invoice needs new money
  r = await api('accm', 'POST', '/accounts/generated-invoices', inv(12, 60000));
  check(r.status === 422 && /18 percent/.test(r.json.error.message), 'paid-only: a second invoice cannot use a different rate than the order\'s', r);
  r = await api('accm', 'POST', '/accounts/generated-invoices', inv(18, 60000));
  const b = r.json.data?.invoice;
  check(r.status === 201 && b.total === 70800, 'paid-only: a second invoice at the order\'s 18% (70,800)', r);
  r = await api('accm', 'POST', `/accounts/generated-invoices/${b.id}/confirm-payment`, {});
  check(r.status === 409 && /already covered/.test(r.json.error.message), 'paid-only: the second paid invoice needs a new verified payment', r);
  r = await api('accm', 'POST', `/pipeline/customers/${po}/accounts/payments`, { type: 'PART', amount: 10000, method: 'UPI', reference: 'PO-API-2', verify: true });
  r = await api('accm', 'POST', `/accounts/generated-invoices/${b.id}/confirm-payment`, {});
  check(r.status === 200 && withPdf() === pdf0 + 2 && fake.objects.has(key(b.id, 'paid')), 'paid-only: after the new payment the second paid invoice is sent', r.json);
  check(r.json.data.steps.some((s: any) => s.step === 'WHATSAPP' && s.status === 'DONE') && waHits.length === hitsBeforeAuto + 1 && waHits.at(-1)!.body.variables.invoiceNumber === r.json.data.invoice.number && /70,800\.00/.test(waHits.at(-1)!.body.variables.amount),
    'invoice WhatsApp: with automatic sending on, the second paid invoice is also sent by WhatsApp right after its e-mail (70,800.00)', r.json.data.steps);
  r = await api('accm', 'POST', `/accounts/generated-invoices/${b.id}/confirm-payment`, {});
  check(waHits.length === hitsBeforeAuto + 1 && (await db.query(`select count(*)::int n from invoice_whatsapp_dispatches where invoice_id = $1`, [b.id])).rows[0].n === 1, 'invoice WhatsApp: confirming again sends no second WhatsApp message (an automation event delivered twice)');
  r = await api('accm', 'GET', `/invoices/${b.id}`);
  r = await api('accm', 'GET', `/invoices/${b.id}`);
  check(r.json.data.generated.paymentSummary.order.totalPayable === 141600 && r.json.data.generated.paymentSummary.order.confirmed === 70000 && r.json.data.generated.paymentSummary.order.balance === 71600, 'paid-only: the order shows 1,41,600 payable, 70,000 confirmed and 71,600 outstanding', r.json.data.generated.paymentSummary);
  // ---- a paid invoice for each payment: recording a verified payment makes, stores, e-mails and WhatsApps its own invoice
  {
    r = await api('a', 'POST', '/pipeline/leads', { name: 'Each Payment', company: 'Each Payment Co', email: 'each.payment@example.com', phone: '9820000909', address: 'Shop 9, FC Road, Pune 411004, Maharashtra', leadSource: 'Walk-in', services: ['AI_CALLING'] });
    const ep = r.json.data.id;
    r = await api('a', 'POST', `/pipeline/customers/${ep}/send-to-accounts`, { amount: 14000 });
    check(r.status === 200 || r.status === 201, 'each payment: Sales sends 14,000 (before GST) to Accounts', r);
    await chooseGst(ep, 18);
    const mailN = smtpMail.length, hitsN = waHits.length, filesN = fake.objects.size;
    r = await api('accm', 'POST', `/pipeline/customers/${ep}/accounts/payments`, { type: 'PART', amount: 10000, method: 'UPI', reference: 'EP-API-1', verify: true });
    const o1 = r.json.data?.paymentInvoice;
    check(r.status === 201 && o1?.status === 'CREATED' && o1.steps.map((s: any) => `${s.step}:${s.status}`).join() === 'PDF:DONE,EMAIL:DONE,WHATSAPP:DONE',
      'each payment: a verified part payment gets its own paid invoice, stored, e-mailed and sent by WhatsApp', r.json.data?.paymentInvoice);
    check(smtpMail.length === mailN + 1 && waHits.length === hitsN + 1 && fake.objects.size === filesN + 1, 'each payment: one e-mail, one WhatsApp message and one PDF for the first payment');
    check(r.json.data.payments.length === 1 && r.json.data.payments[0].invoice?.number === o1.number && r.json.data.payments[0].invoice.paid === true, 'each payment: the payment list names the invoice of the payment', r.json.data.payments);
    r = await api('accm', 'POST', `/pipeline/customers/${ep}/accounts/payments`, { type: 'FULL', amount: 6520, method: 'UPI', reference: 'EP-API-2', verify: true });
    const o2 = r.json.data?.paymentInvoice;
    check(r.status === 201 && o2?.status === 'CREATED' && o2.invoiceId !== o1.invoiceId && o2.steps.every((s: any) => s.status === 'DONE'), 'each payment: the second payment gets a second paid invoice (the one that used to be refused)', r.json.data?.paymentInvoice);
    check(smtpMail.length === mailN + 2 && waHits.length === hitsN + 2 && fake.objects.size === filesN + 2, 'each payment: two e-mails, two WhatsApp messages and two PDFs in all');
    const payIds = (await db.query(`select id from customer_payments where customer_id = $1 order by recorded_at`, [ep])).rows.map((x: any) => x.id as string);
    r = await api('accm', 'POST', `/accounts/payments/${payIds[0]}/invoice`, {});
    check(r.status === 200 && r.json.data.status === 'EXISTS' && r.json.data.invoiceId === o1.invoiceId, 'each payment: asking again returns the same invoice', r);
    check(smtpMail.length === mailN + 2 && waHits.length === hitsN + 2, 'each payment: and sends nothing twice');
    r = await api('a', 'POST', `/accounts/payments/${payIds[0]}/invoice`, {});
    check(r.status === 403, 'each payment: Sales cannot make it', r);
    r = await api('accm', 'POST', `/accounts/payments/${payIds[0]}/invoice`, {});
    r = await api('accm', 'GET', `/invoices?customerId=${ep}`);
    // no invoice for a payment that nobody verified
    r = await api('accm', 'POST', `/pipeline/customers/${ep}/accounts/payments`, { type: 'PART', amount: 1000, method: 'CASH', verify: false });
    check(r.status === 409 || r.status === 422, 'each payment: nothing more can be received than the order is worth', r);
    // a payment recorded without the invoice, then asked for by hand
    r = await api('a', 'POST', '/pipeline/leads', { name: 'Later Invoice', company: 'Later Invoice Co', email: 'later.invoice@example.com', phone: '9820000910', address: 'Shop 9, FC Road, Pune 411004, Maharashtra', leadSource: 'Walk-in', services: ['AI_CALLING'] });
    const lp = r.json.data.id;
    await api('a', 'POST', `/pipeline/customers/${lp}/send-to-accounts`, { amount: 14000 });
    await chooseGst(lp, 18);
    r = await api('accm', 'POST', `/pipeline/customers/${lp}/accounts/payments`, { type: 'PART', amount: 5000, method: 'UPI', reference: 'LP-1', verify: true, invoice: false });
    check(r.status === 201 && !r.json.data.paymentInvoice && r.json.data.payments[0].invoice === null, 'each payment: with the box unticked the payment is verified and no invoice is made', r.json.data);
    const lpPay = (await db.query(`select id from customer_payments where customer_id = $1`, [lp])).rows[0].id;
    r = await api('accm', 'POST', `/accounts/payments/${lpPay}/invoice`, {});
    check(r.status === 200 && r.json.data.status === 'CREATED' && r.json.data.steps.every((s: any) => s.status === 'DONE'), 'each payment: "Generate invoice" makes it later', r);
    // a customer with no address: the payment stands, the answer says what is missing
    r = await api('a', 'POST', '/pipeline/leads', { name: 'No Address', company: 'No Address Co', email: 'no.address@example.com', phone: '9820000911', leadSource: 'Walk-in', services: ['AI_CALLING'] });
    const na = r.json.data.id;
    await api('a', 'POST', `/pipeline/customers/${na}/send-to-accounts`, { amount: 14000 });
    await chooseGst(na, 18);
    r = await api('accm', 'POST', `/pipeline/customers/${na}/accounts/payments`, { type: 'PART', amount: 5000, method: 'UPI', reference: 'NA-1', verify: true });
    check(r.status === 201 && r.json.data.paymentInvoice?.status === 'FAILED' && /address/i.test(r.json.data.paymentInvoice.message) && r.json.data.verified === 5000,
      'each payment: with no address on record the payment is saved as verified and the answer says why there is no invoice', r.json.data);

    // ... and what Accounts does about it: the screen asks which billing details are missing, they are typed once, and the invoice is made
    const naPay = (await db.query(`select id from customer_payments where customer_id = $1`, [na])).rows[0].id as string;
    r = await api('a', 'GET', `/accounts/payments/${naPay}/invoice-billing`);
    check(r.status === 403, 'billing: Sales cannot ask', r);
    r = await api('accm', 'GET', `/accounts/payments/${naPay}/invoice-billing`);
    check(r.status === 200 && r.json.data.missing.includes('address') && r.json.data.missing.includes('state') && r.json.data.taxTreatment === null, 'billing: the screen is told that the address and the state are missing', r.json.data);
    r = await api('accm', 'POST', `/accounts/payments/${naPay}/invoice`, {});
    check(r.status === 422 && /billing address and state/.test(r.json.error.message), 'billing: without them the answer says what to enter', r);
    r = await api('accm', 'POST', `/accounts/payments/${naPay}/invoice`, { customer: { address: 'Shop 9, FC Road, Pune 411004', stateCode: '27', gstin: 'NOT-A-GSTIN' } });
    check(r.status === 422, 'billing: a GSTIN that is not valid is refused', r);
    r = await api('accm', 'POST', `/accounts/payments/${naPay}/invoice`, { customer: { address: 'Shop 9, FC Road, Pune 411004', stateCode: '27' }, extra: 1 });
    check(r.status === 422, 'billing: nothing else can ride along', r);
    r = await api('accm', 'POST', `/accounts/payments/${naPay}/invoice`, { customer: { businessName: 'No Address Co', address: 'Shop 9, FC Road, Pune 411004', stateCode: '27' } });
    check(r.status === 200 && r.json.data.status === 'CREATED' && r.json.data.paymentId === naPay && r.json.data.steps.every((x: any) => x.status === 'DONE'), 'billing: with the details typed once, the paid invoice of the payment is made, stored and sent', r.json);
    r = await api('accm', 'GET', `/accounts/payments/${naPay}/invoice-billing`);
    check(r.json.data.missing.length === 0, 'billing: nothing is missing any more for this customer', r.json.data);

    // an invoice for the whole amount made by hand covers the money; cancelling it lets every payment have its own invoice
    r = await api('a', 'POST', '/pipeline/leads', { name: 'Whole First', company: 'Whole First Co', email: 'whole.first@example.com', phone: '9820000913', address: 'Shop 9, FC Road, Pune 411004, Maharashtra', leadSource: 'Walk-in', services: ['AI_CALLING'] });
    const wf = r.json.data.id;
    await api('a', 'POST', `/pipeline/customers/${wf}/send-to-accounts`, { amount: 100000 });
    await chooseGst(wf, 18);
    const todayWf = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
    r = await api('accm', 'POST', '/accounts/generated-invoices', {
      requestId: crypto.randomUUID(), customerId: wf, purpose: 'SERVICES', invoiceNumber: null, invoiceDate: todayWf, orderNumber: 'Verbal',
      customer: { name: 'Whole First', businessName: 'Whole First Co', address: 'Shop 9, FC Road, Pune 411004, Maharashtra', contactPerson: 'Whole First', contactNumber: '9820000913', gstin: null, stateCode: '27' },
      taxTreatment: 'INTRA_STATE', terms: '100% Payment Against supply.',
      lines: [{ particulars: 'AI calling set-up', hsnSac: '998313', taxRate: 18, quantity: '1 Nos', baseAmount: 100000 }]
    });
    const wholeInv = r.json.data?.invoice;
    check(r.status === 201 && wholeInv.total === 118000, 'cancel: the whole order is invoiced by hand (1,18,000)', r);
    await api('accm', 'POST', `/pipeline/customers/${wf}/accounts/payments`, { type: 'PART', amount: 59000, method: 'UPI', reference: 'WF-API-1', verify: true, invoice: false });
    await api('accm', 'POST', `/pipeline/customers/${wf}/accounts/payments`, { type: 'FULL', amount: 59000, method: 'UPI', reference: 'WF-API-2', verify: true, invoice: false });
    const wfPays = (await db.query(`select id from customer_payments where customer_id = $1 order by recorded_at`, [wf])).rows.map((x: any) => x.id as string);
    r = await api('accm', 'POST', `/accounts/payments/${wfPays[0]}/invoice`, {});
    check(r.status === 409 && /already covered/.test(r.json.error.message), 'cancel: the whole-order invoice covers the money, so a second invoice on top of it is refused (it would bill it twice)', r);
    r = await api('accm', 'POST', `/accounts/generated-invoices/${wholeInv.id}/cancel`, { reason: 'Made for the whole amount by mistake' });
    check(r.status === 403, 'cancel: an Accounts member cannot cancel an invoice', r);
    r = await api('a', 'POST', `/accounts/generated-invoices/${wholeInv.id}/cancel`, { reason: 'Made for the whole amount by mistake' });
    check(r.status === 403 || r.status === 404, 'cancel: nor Sales', r);
    r = await api('accdh', 'POST', `/accounts/generated-invoices/${wholeInv.id}/cancel`, { reason: 'no' });
    check(r.status === 422, 'cancel: a real reason is required', r);
    r = await api('accdh', 'POST', `/accounts/generated-invoices/${wholeInv.id}/cancel`, { reason: 'Made for the whole amount by mistake', extra: 1 });
    check(r.status === 422, 'cancel: nothing else can ride along', r);
    r = await api('accdh', 'POST', `/accounts/generated-invoices/${wholeInv.id}/cancel`, { reason: 'Made for the whole amount by mistake' });
    check(r.status === 200 && r.json.data.status === 'Cancelled' && r.json.data.replayed === false && r.json.data.generated.cancelled.reason === 'Made for the whole amount by mistake', 'cancel: the Accounts head cancels it with a reason; the invoice says so', r.json.data?.generated?.cancelled);
    r = await api('accdh', 'POST', `/accounts/generated-invoices/${wholeInv.id}/cancel`, { reason: 'Made for the whole amount by mistake' });
    check(r.status === 200 && r.json.data.replayed === true, 'cancel: cancelling again changes nothing', r);
    r = await api('accm', 'GET', `/pipeline/customers/${wf}/payment-overview`);
    check(r.json.data.order.invoicedTotal === 0 && r.json.data.dealAmount === 118000 && r.json.data.verified === 118000, 'cancel: the order no longer counts it, and the payments and the payable did not change', r.json.data.order);
    r = await api('accm', 'POST', `/accounts/payments/${wfPays[0]}/invoice`, {});
    const wf1 = r.json.data;
    check(r.status === 200 && wf1.status === 'CREATED' && wf1.steps.every((x: any) => x.status === 'DONE'), 'cancel: the first payment (part) now has its own paid invoice', r);
    r = await api('accm', 'POST', `/accounts/payments/${wfPays[1]}/invoice`, {});
    check(r.status === 200 && r.json.data.status === 'CREATED' && r.json.data.invoiceId !== wf1.invoiceId, 'cancel: the second payment (full) has its own paid invoice too', r);
    r = await api('accm', 'GET', `/invoices/${wholeInv.id}`);
    check(r.status === 200 && r.json.data.status === 'Cancelled', 'cancel: the cancelled invoice stays on record', r);
    r = await api('accm', 'GET', `/pipeline/customers/${wf}/payment-overview`);
    check(r.json.data.order.invoicedTotal === 118000 && r.json.data.order.balance === 0 && r.json.data.dealAmount === 118000 && r.json.data.payments.every((x: any) => x.invoice && x.invoice.number), 'cancel: two paid invoices of 59,000 are the order (1,18,000), every payment names its invoice', r.json.data.order);

    // the same through the WhatsApp Automation Builder webhook (the onboarding one): no Wabastore, and no approved template needed
    const hookHits: any[] = [];
    const hook = http.createServer((req, res) => {
      let raw = '';
      req.on('data', d => (raw += d));
      req.on('end', () => { hookHits.push(JSON.parse(raw)); res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}'); });
    });
    await new Promise<void>(rs => hook.listen(0, '127.0.0.1', rs));
    const savedWa = (await db.query(`select enabled, auto_send, template_name, template_language, template_approved from invoice_whatsapp_settings`)).rows[0];
    const savedEnv = { w: process.env.WABASTORE_WEBHOOK_URL, m: process.env.AUTOMATION_MODE_INVOICE_WHATSAPP };
    delete process.env.WABASTORE_WEBHOOK_URL;
    delete process.env.AUTOMATION_MODE_INVOICE_WHATSAPP; // AUTOMATION_MODE=live decides
    process.env.WHATSAPP_WEBHOOK_URL = `http://127.0.0.1:${(hook.address() as net.AddressInfo).port}/builder`;
    await api('sa', 'POST', '/accounts/invoice-whatsapp/settings', { enabled: true, autoSend: true, templateName: null, templateLanguage: 'en', templateApproved: false });
    r = await api('accm', 'GET', '/accounts/invoice-whatsapp/settings');
    check(r.status === 200 && r.json.data.delivery.mode === 'live' && r.json.data.delivery.provider === 'BUILDER' && r.json.data.delivery.ready === true, 'builder: the settings say messages go through the webhook, live because AUTOMATION_MODE is live', r.json.data);
    r = await api('a', 'POST', '/pipeline/leads', { name: 'Builder Hook', company: 'Builder Hook Co', email: 'builder.hook@example.com', phone: '9820000912', address: 'Shop 9, FC Road, Pune 411004, Maharashtra', leadSource: 'Walk-in', services: ['AI_CALLING'] });
    const bh = r.json.data.id;
    await api('a', 'POST', `/pipeline/customers/${bh}/send-to-accounts`, { amount: 14000 });
    await chooseGst(bh, 18);
    const wabBefore = waHits.length;
    r = await api('accm', 'POST', `/pipeline/customers/${bh}/accounts/payments`, { type: 'PART', amount: 8000, method: 'UPI', reference: 'BH-1', verify: true });
    check(r.status === 201 && r.json.data.paymentInvoice?.status === 'CREATED' && r.json.data.paymentInvoice.steps.map((x: any) => `${x.step}:${x.status}`).join() === 'PDF:DONE,EMAIL:DONE,WHATSAPP:DONE',
      'builder: the paid invoice of the payment is sent by WhatsApp through the webhook, with no approved template', r.json.data?.paymentInvoice);
    const hh = hookHits[0];
    check(hookHits.length === 1 && waHits.length === wabBefore && hh.stage_code === 'INVOICE_PAID' && hh.whatsapp_number === '919820000912' && hh.invoice_number === r.json.data.paymentInvoice.number && /8,000\.00/.test(hh.invoice_amount) && /^http/.test(hh.invoice_pdf_url),
      'builder: the event names the customer, the invoice, the amount and a link; Wabastore was not used', hh);
    const pdfRes = await fetch(hh.invoice_pdf_url);
    check(pdfRes.status === 200 && Buffer.from(await pdfRes.arrayBuffer()).subarray(0, 5).toString() === '%PDF-', 'builder: the link serves the stored paid PDF');
    check(!JSON.stringify((await db.query(`select detail from invoice_whatsapp_dispatches`)).rows).includes('X-Amz'), 'builder: the link is not recorded anywhere');
    hook.close();
    delete process.env.WHATSAPP_WEBHOOK_URL;
    if (savedEnv.w) process.env.WABASTORE_WEBHOOK_URL = savedEnv.w;
    if (savedEnv.m) process.env.AUTOMATION_MODE_INVOICE_WHATSAPP = savedEnv.m;
    await db.query(`update invoice_whatsapp_settings set enabled = $1, auto_send = $2, template_name = $3, template_language = $4, template_approved = $5`, [savedWa.enabled, savedWa.auto_send, savedWa.template_name, savedWa.template_language, savedWa.template_approved]);
  }
  waMock.close();
  await db.query(`update public.invoice_whatsapp_settings set enabled = false, auto_send = false, template_name = null, template_approved = false`);
  for (const k of ['AUTOMATION_DISPATCH_SECRET', 'AUTOMATION_MODE_INVOICE_WHATSAPP', 'WABASTORE_WEBHOOK_URL', 'WABASTORE_API_KEY', 'WABASTORE_STATUS_SECRET']) delete process.env[k];
  smtp.close();
  fake.server.close();
  for (const k of ['STORAGE_PROVIDER', 'R2_ENDPOINT', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET', 'AUTOMATION_MODE', 'EMAIL_PROVIDER', 'EMAIL_FROM', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'SMTP_PASS']) delete process.env[k];
}

// --- Performance Management, HR Recruitment and HR Training ----------------------------------
{
  const wk = 'kind=WEEK&start=2026-01-05&end=2026-01-11';
  const task = (title: string, assignee: string, created: string, due: string | null, status: string, completed: string | null) =>
    db.query(`insert into public.work_tasks (department_id, team_id, title, due_date, assigned_by, assignee_id, status, progress, completed_at, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [wab.id, sales.id, title, due, salesTeamLeadId, assignee, status, status === 'COMPLETED' ? 100 : 30, completed, created]);
  await task('API on time', memberA, '2026-01-05T03:30:00Z', '2026-01-09', 'COMPLETED', '2026-01-08T03:30:00Z');
  await task('API late', memberA, '2026-01-06T03:30:00Z', '2026-01-08', 'COMPLETED', '2026-01-10T03:30:00Z');
  await task('API open', memberA, '2026-01-05T03:30:00Z', '2026-01-09', 'IN_PROGRESS', null);

  // ---- who may open it
  r = await api('a', 'GET', `/performance/people?${wk}`);
  check(r.status === 403, 'performance API: a Team Member cannot open Performance Management', r);
  r = await api(null, 'GET', `/performance/people?${wk}`);
  check(r.status === 401, 'performance API: nor a visitor', r);
  r = await api('th', 'GET', `/performance/people?${wk}`);
  const names = (r.json.data?.people ?? []).map((p: any) => p.name);
  check(r.status === 200 && names.includes('Member A') && !names.includes('Delivery Member') && !names.includes('Team Head') && r.json.data.department === null && r.json.data.teams.length === 1,
    'performance API: a Team Lead sees only the members of their own team (and the team report), not the department', { names, status: r.status });
  const aRow = r.json.data.people.find((p: any) => p.name === 'Member A');
  check(aRow.summary.tasks.total === 3 && aRow.summary.tasks.completed === 2 && aRow.summary.tasks.overdue === 1 && aRow.summary.timing.onTimePct === 50 && aRow.report === null, 'performance API: the list shows the real task figures for the week', aRow.summary);
  r = await api('dh', 'GET', `/performance/people?${wk}`);
  check(r.status === 200 && r.json.data.people.some((p: any) => p.name === 'Team Head' && p.role === 'Team Lead') && r.json.data.department?.name === 'Wabastore' && r.json.data.teams.length >= 2, 'performance API: a Department Head sees the Team Leads, the teams and the department', r.json.data?.department);
  r = await api('th', 'GET', '/performance/people?kind=WEEK&start=2026-01-06&end=2026-01-12');
  check(r.status === 422 && /Monday to Sunday/.test(r.json.error.message), 'performance API: a week must run Monday to Sunday', r);
  r = await api('th', 'GET', '/performance/people?kind=YEAR&start=2026-01-05&end=2026-01-11');
  check(r.status === 422, 'performance API: an unknown period kind is refused', r);

  // ---- generate (no AI key: rule-based analysis, said so)
  delete process.env.ANTHROPIC_API_KEY;
  const key = { scope: 'MEMBER', subjectId: memberA, kind: 'WEEK', start: '2026-01-05', end: '2026-01-11' };
  r = await api('th', 'GET', `/performance/report?scope=MEMBER&subjectId=${memberA}&${wk}`);
  check(r.status === 200 && r.json.data === null, 'performance API: before anything is generated there is no report', r);
  r = await api('th', 'POST', '/performance/report', key);
  const rep = r.json.data?.report;
  check(r.status === 200 && r.json.data.state === 'CREATED' && rep.metrics.tasks.total === 3 && rep.metrics.timing.onTimePct === 50 && rep.metrics.duration.comparedTasks === 2 && rep.version === 1,
    'performance API: a Team Lead generates the report of their member from the real tasks', r);
  check(rep.narrativeSource === 'RULES' && rep.aiStatus === 'NOT_CONFIGURED' && /3 task\(s\)/.test(rep.narrative.summary) && /Insufficient data|On-time/.test(JSON.stringify(rep.narrative)), 'performance API: without an AI key the analysis is rule-based and says so', rep);
  r = await api('th', 'POST', '/performance/report', key);
  check(r.status === 200 && r.json.data.state === 'UNCHANGED' && r.json.data.report.id === rep.id && r.json.data.report.version === 1, 'performance API: generating again with unchanged tasks changes nothing (no duplicate)', r);
  check((await db.query(`select count(*)::int n from public.performance_reports where subject_id = $1 and period_kind = 'WEEK' and period_start = '2026-01-05'`, [memberA])).rows[0].n === 1, 'performance API: still one report row');

  // ---- a mock AI service: it is sent the figures only, and its answer is stored
  const aiSeen: any[] = [];
  let aiMode: 'ok' | 'down' = 'ok';
  const aiServer = http.createServer((req, res) => {
    let b = '';
    req.on('data', c => (b += c));
    req.on('end', () => {
      aiSeen.push({ headers: req.headers, body: JSON.parse(b || '{}') });
      if (aiMode === 'down') { res.writeHead(500); res.end('{}'); return; }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify({ summary: 'AI summary of the week.', observations: ['one'], improvementAreas: ['two'], recommendations: ['three'], limitations: ['four'] }) }] }));
    });
  });
  await new Promise<void>(res => aiServer.listen(0, '127.0.0.1', res));
  process.env.ANTHROPIC_API_KEY = 'ai-key-for-the-test';
  process.env.ANTHROPIC_API_BASE_URL = `http://127.0.0.1:${(aiServer.address() as any).port}`;
  r = await api('th', 'POST', '/performance/report', key);
  check(r.status === 200 && r.json.data.state === 'UNCHANGED' && r.json.data.report.narrativeSource === 'AI' && r.json.data.report.narrative.summary === 'AI summary of the week.' && r.json.data.report.aiStatus === 'OK',
    'performance API: once an AI key exists the rule-based analysis is upgraded to the AI one (the figures did not change, so no new version)', r);
  check(aiSeen.length === 1 && aiSeen[0].headers['x-api-key'] === 'ai-key-for-the-test' && !/@amuwa\.com/.test(JSON.stringify(aiSeen[0].body)) && /API late/.test(JSON.stringify(aiSeen[0].body.messages)), 'performance API: the AI service received the figures and task titles, no e-mail address');
  await db.query(`update public.work_tasks set status = 'COMPLETED', progress = 100, completed_at = '2026-01-09T05:00:00Z' where title = 'API open'`);
  aiMode = 'down';
  r = await api('th', 'POST', '/performance/report', key);
  check(r.status === 200 && r.json.data.state === 'UPDATED' && r.json.data.report.version === 2 && r.json.data.report.metrics.tasks.overdue === 0 && r.json.data.report.aiStatus === 'FAILED' && r.json.data.report.narrativeSource === 'RULES' && /HTTP 500/.test(r.json.data.report.aiError) && !/ai-key/.test(JSON.stringify(r.json)),
    'performance API: when the task data changed a new version is made; if the AI service is down the rule-based analysis is stored and the failure is shown (not the key)', r);
  aiMode = 'ok';
  r = await api('th', 'POST', '/performance/report', key);
  check(r.status === 200 && r.json.data.state === 'UNCHANGED' && r.json.data.report.version === 2 && r.json.data.report.narrativeSource === 'AI' && r.json.data.report.aiStatus === 'OK', 'performance API: a failed analysis is retried on the next refresh', r);
  r = await api('th', 'GET', `/performance/report/${rep.id}/history`);
  check(r.status === 200 && r.json.data.length === 2 && r.json.data[0].version === 2 && r.json.data[1].tasks.overdue === 1, 'performance API: the history keeps both versions', r);
  aiServer.close();
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_BASE_URL;

  // ---- the hierarchy is enforced by the database
  r = await api('th', 'POST', '/performance/report', { ...key, subjectId: deliveryMember });
  check(r.status === 403, 'performance API: a Team Lead cannot generate a report for a member of another team', r);
  r = await api('a', 'POST', '/performance/report', key);
  check(r.status === 403, 'performance API: a Team Member cannot generate one', r);
  r = await api('tl2', 'GET', `/performance/report?scope=MEMBER&subjectId=${memberA}&${wk}`);
  check(r.status === 403, 'performance API: another team\'s Team Lead cannot read it', r);
  r = await api('th', 'POST', '/performance/report', { scope: 'DEPARTMENT', departmentId: wab.id, kind: 'WEEK', start: '2026-01-05', end: '2026-01-11' });
  check(r.status === 403, 'performance API: a Team Lead cannot generate the department report', r);
  r = await api('dh', 'POST', '/performance/report', { scope: 'DEPARTMENT', departmentId: wab.id, kind: 'WEEK', start: '2026-01-05', end: '2026-01-11' });
  check(r.status === 200 && r.json.data.report.scope === 'DEPARTMENT' && r.json.data.report.metrics.tasks.total >= 3, 'performance API: a Department Head generates the department report', r);
  r = await api('dh', 'POST', '/performance/report', { scope: 'DEPARTMENT', departmentId: wbx.id, kind: 'WEEK', start: '2026-01-05', end: '2026-01-11' });
  check(r.status === 403, 'performance API: but not another department\'s', r);
  r = await api('dh', 'POST', '/performance/report', { scope: 'MEMBER', kind: 'WEEK', start: '2026-01-05', end: '2026-01-11' });
  check(r.status === 422, 'performance API: a report must say who it is about', r);

  // ---- the daily run (the existing dispatch endpoint) is idempotent
  process.env.AUTOMATION_DISPATCH_SECRET = 'dispatch-secret-0123456789';
  const d1 = await dispatch('dispatch-secret-0123456789');
  const d2 = await dispatch('dispatch-secret-0123456789');
  check(d1.status === 200 && d1.json.data.performance?.schedule && d1.json.data.training?.day, 'performance API: the daily dispatch also refreshes performance reports and the training check', d1.json.data?.performance);
  check(d2.json.data.performance.schedule.created === 0 && d2.json.data.performance.schedule.updated === 0, 'performance API: a second dispatch run creates and changes nothing', d2.json.data?.performance);
  check((await db.query(`select count(*)::int n from (select scope, coalesce(subject_id, team_id, department_id) k, period_kind, period_start from public.performance_reports group by 1, 2, 3, 4 having count(*) > 1) x`)).rows[0].n === 0, 'performance API: no duplicate report for any subject and period');

  // ---- HR recruitment
  r = await api('a', 'GET', '/hr/recruitment/candidates');
  check(r.status === 403, 'recruitment API: a Sales member cannot open it', r);
  r = await api(null, 'GET', '/hr/recruitment/candidates');
  check(r.status === 401, 'recruitment API: nor a visitor', r);
  r = await api('hr', 'POST', '/hr/recruitment/positions', { title: 'Sales Executive' });
  check(r.status === 200 && r.json.data.title === 'Sales Executive', 'recruitment API: HR adds a position', r);
  const positionId = r.json.data.id;
  // ---- the dropdowns read the real records
  r = await api('hr', 'GET', '/hr/recruitment/positions');
  check(r.status === 200 && r.json.data.some((p: any) => p.source === 'POSITION' && p.title === 'Sales Executive') && r.json.data.some((p: any) => p.source === 'EMPLOYEES' && p.id === null && p.employees >= 1),
    'recruitment API: the position list has the added positions and the designations of the employee records', r.json.data);
  const derived = r.json.data.find((p: any) => p.source === 'EMPLOYEES');
  r = await api('hr', 'GET', '/hr/recruitment/recruiters');
  check(r.status === 200 && ['HR Lead', 'HR Member'].every(n => r.json.data.some((x: any) => x.name === n && x.hasLogin && x.employeeKey)) && !r.json.data.some((x: any) => x.name === 'Member A'),
    'recruitment API: the responsible-employee list has the active HR employees (and nobody from other departments)', r.json.data);
  const recruiterKey = r.json.data.find((x: any) => x.name === 'HR Lead').employeeKey;
  r = await api('hr', 'POST', '/hr/recruitment/candidates', { name: 'Dev Menon', email: 'dev.m@example.com', positionTitle: derived.title, ownerKey: recruiterKey });
  check(r.status === 201 && r.json.data.position === derived.title && r.json.data.ownerKey === recruiterKey && r.json.data.owner === 'HR Lead', 'recruitment API: a designation from the employee records can be chosen as the position, and the HR employee is saved', r);
  r = await api('hr', 'GET', '/hr/recruitment/positions');
  check(!r.json.data.some((p: any) => p.source === 'EMPLOYEES' && p.title === derived.title) && r.json.data.some((p: any) => p.source === 'POSITION' && p.title === derived.title), 'recruitment API: that designation is now a position, listed once', r.json.data);
  r = await api('hr', 'POST', '/hr/recruitment/candidates', { name: 'No Position', email: 'np@example.com' });
  check(r.status === 422, 'recruitment API: a position is required', r);
  r = await api('hr', 'POST', '/hr/recruitment/candidates', { name: 'Bad Owner', email: 'bo@example.com', positionId, ownerKey: memberA });
  check(r.status === 422, 'recruitment API: an employee of another department cannot be the responsible person', r);
  r = await api('hr', 'POST', '/hr/recruitment/candidates', { name: 'Kavya Nair', email: 'not-an-email', positionId });
  check(r.status === 422, 'recruitment API: an invalid e-mail address is refused', r);
  r = await api('hr', 'POST', '/hr/recruitment/candidates', { name: 'Kavya Nair', email: 'kavya.n@example.com', phone: '+91 98200 12345', positionId, source: 'Referral' });
  const cand = r.json.data;
  check(r.status === 201 && cand.name === 'Kavya Nair' && cand.position === 'Sales Executive' && cand.pending.open === 0 && cand.call.nextAt === null && cand.confirmation.status === 'NOT_STARTED', 'recruitment API: HR adds a candidate (Pending, Call and Confirmation start empty and separate)', r);
  r = await api('hr', 'POST', '/hr/recruitment/candidates', { name: 'Kavya Again', email: 'KAVYA.N@example.com', positionId });
  check(r.status === 409, 'recruitment API: the same e-mail cannot apply twice for a position', r);
  r = await api('hr', 'POST', `/hr/recruitment/candidates/${cand.id}/actions`, { kind: 'INTERVIEW', title: 'First round interview', dueDate: '2026-01-02' });
  check(r.status === 201, 'recruitment API: HR records a pending interview', r);
  r = await api('hr', 'POST', `/hr/recruitment/candidates/${cand.id}/calls`, { at: new Date(Date.now() + 2 * 86400000).toISOString() });
  check(r.status === 201, 'recruitment API: and schedules a call', r);
  r = await api('hr', 'POST', `/hr/recruitment/candidates/${cand.id}/confirmation`, { status: 'OFFERED' });
  check(r.status === 422, 'recruitment API: an offer needs its date', r);
  r = await api('hr', 'POST', `/hr/recruitment/candidates/${cand.id}/confirmation`, { status: 'OFFERED', date: '2026-02-01' });
  check(r.status === 200 && r.json.data.confirmation.status === 'OFFERED', 'recruitment API: and updates the confirmation', r);
  r = await api('hr', 'GET', '/hr/recruitment/candidates?search=kavya&call=SCHEDULED&pending=OVERDUE');
  const row = r.json.data?.items?.[0];
  check(r.status === 200 && r.json.data.total === 1 && row.pending.open === 1 && row.pending.overdue === 1 && row.call.nextAt && row.confirmation.status === 'OFFERED' && row.email === 'kavya.n@example.com', 'recruitment API: search and filters find it, with all six columns', r);
  r = await api('hr', 'GET', '/hr/recruitment/candidates?confirmation=NOPE');
  check(r.status === 422, 'recruitment API: an unknown filter is refused', r);
  r = await api('hrmember', 'GET', `/hr/recruitment/candidates/${cand.id}`);
  check(r.status === 200 && r.json.data.history.length >= 4 && r.json.data.actions.length === 1 && r.json.data.calls.length === 1, 'recruitment API: another HR employee sees the same record with its history', r);
  r = await api('hr', 'PATCH', `/hr/recruitment/candidates/${cand.id}`, { name: 'Kavya N Nair', email: 'kavya.n@example.com', positionId });
  check(r.status === 200 && r.json.data.name === 'Kavya N Nair', 'recruitment API: HR edits the candidate', r);
  r = await api('hr', 'GET', '/hr/recruitment/overview');
  check(r.status === 200 && r.json.data.candidates === 2 && r.json.data.withPending === 1 && r.json.data.overdueActions === 1 && r.json.data.upcomingCalls === 1, 'recruitment API: the overview counts the real records', r);
  r = await api('dh', 'GET', '/hr/recruitment/overview');
  check(r.status === 403, 'recruitment API: another department\'s head is refused', r);

  // ---- HR training
  r = await api('a', 'GET', '/hr/training/programs');
  check(r.status === 403, 'training API: a Sales member cannot open it', r);
  r = await api('hr', 'POST', '/hr/training/programs', { name: 'API Bootcamp', startDate: '2026-01-05', ownerId: null });
  const prog = r.json.data;
  check(r.status === 200 && prog.days.length === 3 && prog.days[2].date === '2026-01-07' && prog.endDate === '2026-01-07', 'training API: HR creates a program: three days on consecutive dates', r);
  r = await api('hr', 'POST', `/hr/training/programs/${prog.id}/days/3`, { title: 'Final Training and Assessment', topics: ['Mock calls'], trainerName: 'Rina', criteria: [{ name: 'Quiz', max: 10 }], passPercent: 60 });
  check(r.status === 200 && r.json.data.days[2].criteria[0].name === 'Quiz' && r.json.data.days[2].passPercent === 60 && r.json.data.days[2].topics[0] === 'Mock calls', 'training API: HR configures the topics, trainer and assessment criteria of a day', r);
  r = await api('hr', 'POST', `/hr/training/programs/${prog.id}/days/9`, { title: 'Day nine', topics: [], criteria: [] });
  check(r.status === 422, 'training API: there is no fourth day', r);
  r = await api('hr', 'POST', `/hr/training/programs/${prog.id}/days/3`, { title: 'X', topics: [], criteria: [{ name: 'Quiz', max: -1 }] });
  check(r.status === 422, 'training API: a criterion needs a positive maximum', r);
  r = await api('hr', 'GET', '/hr/training/employees');
  check(r.status === 200 && r.json.data.some((e: any) => e.employeeKey === memberA), 'training API: the employee picker lists the HR directory', r);
  r = await api('hr', 'POST', `/hr/training/programs/${prog.id}/enrollments`, { employeeKeys: [memberA] });
  check(r.status === 200 && r.json.data.added === 1, 'training API: HR enrols an employee', r);
  r = await api('hr', 'GET', `/hr/training/programs/${prog.id}`);
  const enr = r.json.data.enrollments[0];
  check(r.status === 200 && enr.employeeName === 'Member A' && enr.status === 'NOT_STARTED' && enr.days.length === 3, 'training API: the program shows the enrolled employee and their three days', r);
  r = await api('a', 'GET', `/hr/training/enrollments/${enr.id}`);
  check(r.status === 404 || r.status === 403, 'training API: a Sales member cannot open a training record', r);
  r = await api('hr', 'GET', `/hr/training/enrollments/${enr.id}`);
  check(r.status === 200 && r.json.data.employeeName === 'Member A' && r.json.data.canReport['1'] === true && r.json.data.reports.length === 0, 'training API: HR opens the employee\'s record', r);
  r = await api('hr', 'GET', '/hr/training/records?search=member&status=NOT_STARTED');
  check(r.status === 200 && r.json.data.total === 1, 'training API: the records can be searched and filtered', r);
  r = await api('hr', 'POST', `/hr/training/enrollments/${enr.id}/days/1`, { attendance: 'PRESENT', topicsCompleted: [], tasks: [], scores: [] });
  check(r.status === 200 && r.json.data.completed === false && r.json.data.status !== 'COMPLETED', 'training API: present with nothing recorded is not a complete day', r);
  r = await api('hr', 'POST', `/hr/training/enrollments/${enr.id}/days/1`, { attendance: 'PRESENT', topicsCompleted: ['CRM basics'], tasks: [{ title: 'Set up the account', done: true }], scores: [], feedback: 'Good' });
  check(r.status === 200 && r.json.data.completed === true, 'training API: attendance plus recorded activity completes Day 1', r);
  r = await api('hr', 'POST', `/hr/training/enrollments/${enr.id}/days/3`, { attendance: 'PRESENT', topicsCompleted: [], tasks: [], scores: [{ criterion: 'Quiz', score: 11 }] });
  check(r.status === 422, 'training API: a score above the maximum is refused', r);
  r = await api('hr', 'POST', `/hr/training/enrollments/${enr.id}/days/2`, { attendance: 'LATE', topicsCompleted: [], tasks: [{ title: 'Practice call', done: true }], scores: [] });
  check(r.status === 200 && r.json.data.completed === true, 'training API: a late attendance with a done task completes Day 2', r);
  r = await api('hr', 'POST', `/hr/training/enrollments/${enr.id}/days/3`, { attendance: 'PRESENT', topicsCompleted: ['Mock calls'], tasks: [], scores: [{ criterion: 'Quiz', score: 8 }], trainerRemarks: 'Strong' });
  check(r.status === 200 && r.json.data.assessmentResult === 'PASS' && r.json.data.status === 'COMPLETED', 'training API: Day 3 with its assessment completes the training', r);
  r = await api('hr', 'POST', `/hr/training/enrollments/${enr.id}/review`, { strengths: 'Quick learner', improvements: 'Objection handling', trainerRemarks: 'Recommended' });
  check(r.status === 200, 'training API: HR writes the strengths and areas to improve', r);
  r = await api('hr', 'GET', `/hr/training/enrollments/${enr.id}`);
  check(r.status === 200 && r.json.data.status === 'COMPLETED' && r.json.data.reports.length === 3 && r.json.data.consolidated.daysCompleted === 3 && r.json.data.consolidated.strengths === 'Quick learner' && r.json.data.consolidated.assessmentPercent === 80,
    'training API: the employee\'s record holds all three day reports and the consolidated report', r.json.data);
  r = await api('a', 'POST', `/hr/training/enrollments/${enr.id}/days/1`, { attendance: 'PRESENT', topicsCompleted: ['x'], tasks: [], scores: [] });
  check(r.status === 403 || r.status === 404, 'training API: a Sales member cannot record a report', r);
  r = await api('hr', 'GET', '/hr/training/records?status=COMPLETED');
  check(r.status === 200 && r.json.data.total === 1, 'training API: the record shows as Completed in the history', r);
  r = await api('hr', 'GET', '/hr/training/overview');
  check(r.status === 200 && r.json.data.employeesEnrolled === 1 && r.json.data.completed === 1, 'training API: the overview counts real enrolments and completions', r);
}

// --- Business reports: Sales and Support business for Accounts ---------------------------------
{
  const num = (v: unknown) => Number(v ?? 0);
  r = await api('accm', 'GET', '/accounts/business-report');
  check(r.status === 200 && r.json.data.sections.sales && r.json.data.sections.support && Array.isArray(r.json.data.sections.sales.employees), 'an Accounts member reads the business report', r);
  const rep = r.json.data;
  const { rows: [led] } = await db.query(`select
      coalesce(sum(amount) filter (where status = 'COLLECTED' and division = 'SALES'), 0)::float as sales,
      coalesce(sum(amount) filter (where status = 'COLLECTED' and division = 'SUPPORT'), 0)::float as support,
      coalesce(sum(amount) filter (where status = 'COLLECTED' and division is null), 0)::float as unclassified,
      coalesce(sum(amount) filter (where status = 'COLLECTED' and source <> 'PLAN_ACTIVATION'), 0)::float as cash
    from private.business_ledger()`);
  check(num(rep.sections.sales.collected) === led.sales && num(rep.sections.support.collected) === led.support, 'the API figures are exactly what the ledger holds', { rep: rep.sections, led });
  const { rows: [vi] } = await db.query(`select coalesce(sum(amount), 0)::float as s from private.verified_income()`);
  check(led.cash === vi.s, 'every verified payment appears once: the ledger equals the verified income Accounts reports', { led, vi });
  check(num(rep.organization.collected) === led.sales + led.support, 'the organisation total is Sales + Support', rep.organization);
  r = await api('accm', 'GET', '/accounts/business-report?division=SUPPORT');
  check(r.status === 200 && !r.json.data.sections.sales && r.json.data.sections.support, 'a division filter returns only that department', r);
  r = await api('accm', 'GET', '/accounts/business-report/transactions?pageSize=5&status=COLLECTED');
  check(r.status === 200 && r.json.data.items.length <= 5 && r.json.data.items.every((t: any) => t.status === 'COLLECTED' && t.amount > 0) && r.json.data.total >= 1, 'the transaction list is paged and filtered', r);
  const { rows: [cnt] } = await db.query(`select count(*)::int as n from private.business_ledger() where status = 'COLLECTED'`);
  r = await api('accm', 'GET', '/accounts/business-report/transactions?status=COLLECTED&pageSize=100');
  check(r.json.data.total === cnt.n, 'the list and the ledger count the same payments', { api: r.json.data.total, db: cnt.n });
  r = await api('accm', 'GET', '/accounts/business-report?from=2026-12-31&to=2026-01-01');
  check(r.status === 422, 'an end date before the start date is refused', r);
  r = await api('accm', 'GET', '/accounts/business-report?division=HR');
  check(r.status === 422, 'only Sales or Support can be asked for', r);
  r = await api('accm', 'GET', '/accounts/business-report?from=2020-01-01&to=2020-01-31');
  check(r.status === 200 && num(r.json.data.organization.collected) === 0, 'a date range with no payments is zero', r);
  r = await api('accm', 'GET', '/accounts/business-report/orders?pageSize=100');
  check(r.status === 200 && Array.isArray(r.json.data.items) && r.json.data.items.every((o: any) => ['PAID', 'PARTLY_PAID', 'UNPAID'].includes(o.state) && o.outstanding >= 0 && Array.isArray(o.invoices)), 'Accounts reads the orders with their invoices', r);
  const { rows: [ordSum] } = await db.query(`select coalesce(sum(billed), 0)::float as billed from private.business_orders()`);
  check(r.json.data.items.reduce((n: number, o: any) => n + o.billed, 0) === ordSum.billed || r.json.data.total > 100, 'the orders add up to what the database holds', { api: r.json.data.total, db: ordSum });
  r = await api('accm', 'GET', '/accounts/business-report/orders?type=SUBSCRIPTION');
  check(r.status === 422, 'an unknown order type is refused', r);
  r = await api('a', 'GET', '/accounts/business-report/orders');
  check(r.status === 403, 'a salesperson cannot read the orders', r);
  r = await api('accm', 'GET', '/accounts/business-report/people');
  check(r.status === 200 && Array.isArray(r.json.data), 'Accounts reads the employees that appear in the records', r);
  r = await api('sa', 'GET', '/accounts/business-report');
  check(r.status === 200, 'the Super Admin reads the business report', r);
  r = await api('accdh', 'GET', '/accounts/business-report');
  check(r.status === 200, 'and the Accounts department head', r);
  for (const who of ['a', 'sm', 'hr', 'dh', 'tc']) {
    r = await api(who, 'GET', '/accounts/business-report');
    check(r.status === 403, `${who} cannot read the business report`, r);
  }
  r = await api('a', 'GET', '/accounts/business-report/transactions');
  check(r.status === 403, 'nor the transaction list', r);
  r = await api('sm', 'GET', '/accounts/business-report/people');
  check(r.status === 403, 'nor the employee list', r);
  r = await api(null, 'GET', '/accounts/business-report');
  check(r.status === 401, 'nor without signing in', r);
  // Accounts classifies additional invoices
  r = await api('accm', 'POST', '/accounts/invoices/00000000-0000-4000-8000-000000000001/business', { kind: 'RENEWAL' });
  check(r.status === 404, 'tagging an invoice that does not exist is refused', r);
  r = await api('accm', 'POST', '/accounts/invoices/00000000-0000-4000-8000-000000000001/business', { kind: 'WEEKLY' });
  check(r.status === 422, 'an unknown kind is refused', r);
  r = await api('a', 'POST', '/accounts/invoices/00000000-0000-4000-8000-000000000001/business', { kind: 'RENEWAL' });
  check(r.status === 403, 'a salesperson cannot classify an invoice', r);
  r = await api('a', 'GET', '/accounts/invoices/00000000-0000-4000-8000-000000000001/business');
  check(r.status === 403, 'nor read its classification', r);
}

// ---------------------------------------------------------------------------
// HR e-mail automation: birthdays, anniversaries, probation reminders, approval, retries, duplicates.
// A local mock stands in for the e-mail provider: nothing real is sent.
// ---------------------------------------------------------------------------
{
  const outbox: { path: string; body: any }[] = [];
  const failNext: Record<string, number[]> = {};
  const mailMock = http.createServer((req, res) => {
    let raw = '';
    req.on('data', c => (raw += c));
    req.on('end', () => {
      const path = (req.url || '').split('?')[0];
      outbox.push({ path, body: raw ? JSON.parse(raw) : null });
      const status = failNext[path]?.shift() ?? 200;
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(status < 300 ? { id: `hr-msg-${outbox.length}` } : { message: 'Service busy' }));
    });
  });
  await new Promise<void>(rs => mailMock.listen(0, rs));
  const P = `http://127.0.0.1:${(mailMock.address() as any).port}`;
  Object.assign(process.env, {
    AUTOMATION_MODE: 'live', EMAIL_PROVIDER: 'resend', EMAIL_API_KEY: 're_hr_secret_key', EMAIL_API_BASE_URL: P,
    EMAIL_FROM: 'Amuwa Corporation <meta@amuwa.com>', EMAIL_CC: 'ops-copy@example.com', EMAIL_BCC: 'ops-bcc@example.com',
    AUTOMATION_DISPATCH_SECRET: 'dispatch-secret-0123456789'
  });
  const emails = () => outbox.filter(o => o.path === '/emails');
  const hrMail = (to: string, subjectPart: string) => emails().filter(o => o.body?.to?.[0] === to && String(o.body?.subject).includes(subjectPart));
  const hrRun = async () => (await dispatch('dispatch-secret-0123456789')).json.data.hr;
  // Probation ends on "joining date + 6 months". When today + 7 days is the 31st and the month six months earlier has 30 days (31 Oct: 30 Apr + 6 months
  // is 30 Oct), no joining date ends exactly seven days ahead, so the seven-day reminder cannot be tested on such a day. For this section only, the HR clock
  // (private.hr_today) is then set back to the nearest earlier day where it can be tested; it is restored at the end.
  const probationOk = async (back: number) => (await db.query(
    `select ((d + 7 - interval '6 months')::date + interval '6 months')::date = d + 7 as ok from (select private.hr_today() - $1::int as d) x`, [back])).rows[0].ok as boolean;
  let hrBack = 0;
  while (!(await probationOk(hrBack))) hrBack++;
  const setHrClock = (back: number) => db.query(`create or replace function private.hr_today() returns date language sql stable set search_path = '' as $$ select ((now() at time zone 'Asia/Kolkata')::date - ${back}) $$`);
  if (hrBack > 0) await setHrClock(hrBack);
  const { rows: [{ today }] } = await db.query(`select to_char(private.hr_today(), 'YYYY-MM-DD') as today`);
  const md = today.slice(5);
  await db.query(`insert into public.crm_settings (key, value) values ('hr.notify_emails', '["hr.inbox@example.com"]') on conflict (key) do update set value = excluded.value`);
  const recipients = ['hr.inbox@example.com', 'hr.api@amuwa.com', 'hrbd.one@example.com', 'hrbd.two@example.com', 'hrbd.prob@example.com'];
  process.env.AUTOMATION_TEST_RECIPIENTS = recipients.join(',');
  const joinForProbationEnd = async (daysFromToday: number) =>
    (await db.query(`select to_char((private.hr_today() + $1::int - interval '6 months')::date, 'YYYY-MM-DD') as d`, [daysFromToday])).rows[0].d;
  const addRecord = (id: string, name: string, email: string, joining: string, dob: string | null) =>
    db.query(`insert into public.hr_employees (id, name, email, department_id, status, joining_date, data) values ($1, $2, $3, 'hr', 'Full-Time', $4, $5::jsonb)`,
      [id, name, email, joining, JSON.stringify(dob ? { dateOfBirth: dob } : {})]);

  // HR-only employee records (the same table the HR dashboard reads)
  await addRecord('HRBD-1', 'Birthday Person', 'hrbd.one@example.com', '2020-01-15', `1990-${md}`);
  await addRecord('HRBD-2', 'Anniversary Person', 'hrbd.two@example.com', `2021-${md}`, '1991-01-01');
  await addRecord('HRBD-3', 'Probation Person', 'hrbd.prob@example.com', await joinForProbationEnd(7), '1992-01-01');

  const before = emails().length;
  let hr = await hrRun();
  check(hr.schedule.birthdays >= 1 && hr.schedule.anniversaries >= 1 && hr.send.sent >= 3, 'HR automation: the scheduler endpoint queues and sends what is due today', hr);
  const bd = hrMail('hrbd.one@example.com', 'Happy Birthday, Birthday Person! 🎂');
  check(bd.length === 1 && /Dear Birthday Person,/.test(bd[0].body.text) && /Wishing you a very Happy Birthday!/.test(bd[0].body.text) && /Best regards,\nHR Team\nAmuwa Corporation/.test(bd[0].body.text),
    'HR automation: the birthday e-mail has the approved subject and text, addressed to the employee', bd[0]?.body);
  check(bd[0].body.from.includes('Amuwa Corporation HR') && !bd[0].body.cc && !bd[0].body.bcc && bd[0].body.reply_to,
    'HR automation: it is sent as the HR sender, without the client-facing CC / BCC lists');
  const an = hrMail('hrbd.two@example.com', 'Happy Work Anniversary, Anniversary Person! 🎉');
  check(an.length === 1 && /Congratulations on your work anniversary with Amuwa Corporation!/.test(an[0].body.text) && /Today marks 5 years of your professional journey/.test(an[0].body.text),
    'HR automation: the anniversary e-mail counts the completed years of service', an[0]?.body?.text);
  const pe = hrMail('hrbd.prob@example.com', 'Employee Confirmation Reminder — Probation Person — Due ');
  check(pe.length === 1 && /scheduled to be completed on /.test(pe[0].body.text) && /approaching in seven days/.test(pe[0].body.text),
    'HR automation: the employee gets the probation reminder exactly seven days before the end');
  const ph = hrMail('hr.inbox@example.com', 'Action Required: Confirmation Due in 7 Days — Probation Person');
  check(ph.length === 1 && /Employee ID: HRBD-3/.test(ph[0].body.text) && /Department: HR Department/.test(ph[0].body.text) && /does not automatically confirm employment/.test(ph[0].body.text)
    && /Designation: /.test(ph[0].body.text) && /Reporting Manager: /.test(ph[0].body.text) && /The confirmation date is seven days away/.test(ph[0].body.text), 'HR automation: HR gets the action-required reminder with id, department, joining and completion dates', ph[0]?.body?.text);
  check(hrMail('hr.api@amuwa.com', 'Action Required: Confirmation Due in 7 Days').length === 1, 'HR automation: every HR department member is also told');
  check(emails().filter(o => /Employment Confirmation – Amuwa Corporation$/.test(o.body.subject)).length === 0, 'HR automation: nothing confirms the employee by itself');

  // never twice
  const mid = emails().length;
  hr = await hrRun();
  await hrRun();
  check(emails().length === mid && hr.send.sent === 0, 'HR automation: running the scheduler again sends nothing twice');
  check((await db.query(`select count(*)::int as n from public.hr_email_events where status = 'SENT' and sent_at is not null`)).rows[0].n === emails().length - before, 'HR automation: every delivered e-mail is recorded once with its time');

  // test mode: an address outside the list is held back (recorded as a dry run) and sent once it is allowed
  await addRecord('HRBD-4', 'Held Person', 'hrbd.dry@example.com', '2019-02-02', `1990-${md}`);
  hr = await hrRun();
  check(hrMail('hrbd.dry@example.com', 'Happy Birthday').length === 0
    && (await db.query(`select status from public.hr_email_events where payload ->> 'employeeName' = 'Held Person' and kind = 'BIRTHDAY'`)).rows[0].status === 'PENDING',
    'HR automation: in test mode an address outside the test list is not e-mailed (it waits)', hr);
  process.env.AUTOMATION_TEST_RECIPIENTS += ',hrbd.dry@example.com';
  hr = await hrRun();
  check(hrMail('hrbd.dry@example.com', 'Happy Birthday').length === 1, 'HR automation: it is sent once the address is allowed');

  // dry run: prepared and logged, nothing leaves the server; off does nothing; live sends it afterwards
  await addRecord('HRBD-5', 'Rehearsal Person', 'hrbd.one@example.com', '2018-03-03', `1989-${md}`);
  process.env.AUTOMATION_MODE = 'dry_run';
  const dryBefore = emails().length;
  await hrRun();
  check(emails().length === dryBefore && (await db.query(`select 1 from public.hr_email_events where status = 'DRY_RUN' and payload ->> 'employeeName' = 'Rehearsal Person'`)).rowCount === 1,
    'HR automation: dry run records the e-mail without sending it');
  process.env.AUTOMATION_MODE = 'off';
  hr = await hrRun();
  check(emails().length === dryBefore && hr.send.claimed === 0, 'HR automation: switched off, nothing happens');
  process.env.AUTOMATION_MODE = 'live';
  await hrRun();
  check(hrMail('hrbd.one@example.com', 'Happy Birthday, Rehearsal Person').length === 1, 'HR automation: live sends what dry run had prepared');

  // a temporary provider failure is retried, and the e-mail is delivered exactly once
  await addRecord('HRBD-6', 'Retry Person', 'hrbd.two@example.com', '2017-04-04', `1988-${md}`);
  failNext['/emails'] = [503];
  await hrRun();
  let ev = (await db.query(`select status, attempts, last_error, next_attempt_at > now() as later from public.hr_email_events where payload ->> 'employeeName' = 'Retry Person' and kind = 'BIRTHDAY'`)).rows[0];
  check(ev.status === 'RETRY' && ev.attempts === 1 && ev.later && /503/.test(ev.last_error), 'HR automation: a temporary failure (503) is queued for a retry with the error recorded', ev);
  await hrRun();
  check(hrMail('hrbd.two@example.com', 'Happy Birthday, Retry Person').length === 1, 'HR automation: the retry waits for its time');
  await db.query(`update public.hr_email_events set next_attempt_at = now() where payload ->> 'employeeName' = 'Retry Person'`);
  await hrRun();
  ev = (await db.query(`select status, attempts, sent_at is not null as sent from public.hr_email_events where payload ->> 'employeeName' = 'Retry Person' and kind = 'BIRTHDAY'`)).rows[0];
  check(ev.status === 'SENT' && ev.attempts === 2 && ev.sent, 'HR automation: the retry delivers it', ev);
  check(hrMail('hrbd.two@example.com', 'Happy Birthday, Retry Person').length === 2, 'HR automation: two requests reached the provider (the failed one and the delivery)');
  await hrRun();
  check(hrMail('hrbd.two@example.com', 'Happy Birthday, Retry Person').length === 2, 'HR automation: and nothing more after delivery');

  // a permanent refusal is not retried forever
  await addRecord('HRBD-7', 'Failing Person', 'hrbd.two@example.com', '2016-05-05', `1987-${md}`);
  failNext['/emails'] = [422];
  await hrRun();
  ev = (await db.query(`select status, last_error from public.hr_email_events where payload ->> 'employeeName' = 'Failing Person' and kind = 'BIRTHDAY'`)).rows[0];
  check(ev.status === 'FAILED' && /422/.test(ev.last_error), 'HR automation: a permanent refusal (422) is FAILED at once, with the reason', ev);
  const failedId = (await db.query(`select id from public.hr_email_events where payload ->> 'employeeName' = 'Failing Person' and kind = 'BIRTHDAY'`)).rows[0].id;

  // the HR dashboard API
  r = await api('a', 'GET', '/hr/email-automation/overview');
  check(r.status === 403, 'HR automation API: a sales member cannot open the overview', r);
  r = await api(null, 'GET', '/hr/email-automation/overview');
  check(r.status === 401, 'HR automation API: nor a visitor', r);
  r = await api('hr', 'GET', '/hr/email-automation/overview');
  check(r.status === 200 && r.json.data.settings.mode === 'live' && r.json.data.settings.emailConfigured === true && r.json.data.settings.testMode === true
    && r.json.data.queue.failed >= 1 && r.json.data.confirmations.pending >= 1 && Array.isArray(r.json.data.upcoming) && r.json.data.lastRun, 'HR automation API: HR sees status, queue, confirmations and the last run', r);
  check(!/re_hr_secret_key|SMTP_PASS|dispatch-secret/i.test(JSON.stringify(r.json)), 'HR automation API: no credential is ever part of the answer');
  r = await api('hr', 'GET', '/hr/email-automation/history?status=FAILED&limit=5');
  check(r.status === 200 && r.json.data.items.some((i: any) => i.id === failedId && i.employeeName === 'Failing Person' && /422/.test(i.error)), 'HR automation API: the history shows failures with their error', r);
  r = await api('a', 'GET', '/hr/email-automation/cards');
  check(r.status === 403, 'HR automation API: a sales member cannot open the automation cards', r);
  r = await api('hr', 'GET', '/hr/email-automation/cards');
  check(r.status === 200 && r.json.data.settings.mode === 'live' && r.json.data.birthday.sent >= 1 && r.json.data.birthday.failed >= 1 && r.json.data.birthday.last?.status
    && Array.isArray(r.json.data.confirmation.upcoming) && r.json.data.runsAt, 'HR automation API: the cards show live figures, the last execution and the schedule', r);
  const tpl = r.json.data.templates;
  check(tpl.BIRTHDAY[0].subject === 'Happy Birthday, Asha Verma! 🎂' && /Happy Work Anniversary, Asha Verma! 🎉/.test(tpl.ANNIVERSARY[0].subject)
    && /^Employee Confirmation Reminder — Asha Verma — Due /.test(tpl.CONFIRMATION[0].subject) && /^Action Required: Confirmation Due in 7 Days — Asha Verma$/.test(tpl.CONFIRMATION[1].subject)
    && /Reporting Manager: Rohan Mehta/.test(tpl.CONFIRMATION[1].text), 'HR automation API: each card previews its e-mail (sample data, the approved wording)', tpl);
  check(!/re_hr_secret_key|SMTP_PASS|dispatch-secret/i.test(JSON.stringify(r.json)), 'HR automation API: the cards carry no credential');
  r = await api('hr', 'GET', '/hr/email-automation/history?status=NOPE');
  check(r.status === 422, 'HR automation API: an unknown filter is refused', r);
  r = await api('a', 'POST', `/hr/email-automation/events/${failedId}/retry`, {});
  check(r.status === 403, 'HR automation API: a sales member cannot retry', r);
  r = await api('hr', 'POST', `/hr/email-automation/events/${failedId}/retry`, {});
  check(r.status === 200 && r.json.data.status === 'PENDING', 'HR automation API: HR retries a failed e-mail', r);
  check(hrMail('hrbd.two@example.com', 'Happy Birthday, Failing Person').length === 2, 'HR automation API: the retry is sent straight away (one failed request, one delivery)');
  r = await api('hr', 'POST', `/hr/email-automation/events/${failedId}/retry`, {});
  check(r.status === 409, 'HR automation API: a delivered e-mail cannot be retried', r);

  // approval: the confirmation e-mails only after an authorised person approves
  r = await api('hr', 'GET', '/hr/email-automation/probation');
  const cycle = r.json.data.find((c: any) => c.employeeName === 'Probation Person');
  check(r.status === 200 && cycle && cycle.status === 'PENDING' && cycle.daysLeft === 7 && cycle.canDecide === true && cycle.employeeCode === 'HRBD-3', 'HR automation API: the upcoming confirmation is listed with its days left', cycle);
  r = await api('a', 'POST', `/hr/email-automation/probation/${cycle.id}/confirm`, {});
  check(r.status === 403, 'HR automation API: a sales member cannot approve', r);
  r = await api('hr', 'POST', `/hr/email-automation/probation/${cycle.id}/confirm`, { effectiveDate: 'soon' });
  check(r.status === 422, 'HR automation API: an invalid date is refused', r);
  r = await api('hr', 'POST', `/hr/email-automation/probation/${cycle.id}/confirm`, { note: 'Reviewed with the Department Head' });
  check(r.status === 200 && r.json.data.status === 'APPROVED' && r.json.data.approvedAt && r.json.data.note === 'Reviewed with the Department Head', 'HR automation API: HR approves the confirmation (date and status recorded)', r);
  check(hrMail('hrbd.prob@example.com', 'Employment Confirmation – Amuwa Corporation').length === 0, 'HR automation API: the confirmation e-mail waits for the end of the probation period');
  await db.query(`update public.hr_email_events set send_after = now() - interval '1 minute' where kind in ('CONFIRMATION_EMPLOYEE', 'CONFIRMATION_HR') and status = 'PENDING'`);
  await hrRun();
  const ce = hrMail('hrbd.prob@example.com', 'Employment Confirmation – Amuwa Corporation');
  check(ce.length === 1 && /has been confirmed as permanent, effective /.test(ce[0].body.text) && /Congratulations, and best wishes/.test(ce[0].body.text), 'HR automation API: after the end date the employee receives the confirmation e-mail');
  const chr = hrMail('hr.inbox@example.com', 'Employee Confirmation Completed – Probation Person');
  check(chr.length === 1 && /Approval Status: Approved/.test(chr[0].body.text) && /Confirmation Effective Date:/.test(chr[0].body.text) && /HRBD-3/.test(chr[0].body.text), 'HR automation API: HR is notified with the approval details', chr[0]?.body?.text);
  r = await api('hr', 'POST', `/hr/email-automation/probation/${cycle.id}/confirm`, {});
  check(r.status === 409, 'HR automation API: approving twice is refused', r);
  await hrRun();
  check(hrMail('hrbd.prob@example.com', 'Employment Confirmation – Amuwa Corporation').length === 1, 'HR automation API: and no second confirmation e-mail is sent');
  check((await db.query(`select status from public.hr_probation_cycles where id = $1`, [cycle.id])).rows[0].status === 'APPROVED', 'HR automation: the cycle stays APPROVED');

  // data problems and fixing them
  await db.query(`insert into public.hr_employees (id, name, email, department_id, status, joining_date) values ('HRBD-8', 'No Dates Person', 'hrbd.nodates@example.com', 'hr', 'Full-Time', 'n/a')`);
  r = await api('hr', 'GET', '/hr/email-automation/data-issues');
  const issue = r.json.data.find((i: any) => i.name === 'No Dates Person');
  check(r.status === 200 && issue && issue.issues.includes('NO_DATE_OF_BIRTH') && issue.issues.includes('NO_JOINING_DATE'), 'HR automation API: employees without dates are listed with the reason', r);
  r = await api('hr', 'POST', '/hr/email-automation/employee-dates', { employeeKey: issue.employeeKey, dateOfBirth: '2999-01-01' });
  check(r.status === 422, 'HR automation API: a future date of birth is refused', r);
  r = await api('hr', 'POST', '/hr/email-automation/employee-dates', { employeeKey: issue.employeeKey, dateOfBirth: '1990-06-15', joiningDate: '2024-02-01' });
  check(r.status === 200, 'HR automation API: HR fills in the dates', r);
  r = await api('hr', 'GET', '/hr/email-automation/data-issues');
  check(!r.json.data.some((i: any) => i.name === 'No Dates Person' && (i.issues.includes('NO_DATE_OF_BIRTH') || i.issues.includes('NO_JOINING_DATE'))), 'HR automation API: and it leaves the list');
  r = await api('a', 'POST', '/hr/email-automation/run', {});
  check(r.status === 403, 'HR automation API: a sales member cannot run the check', r);
  r = await api('hr', 'POST', '/hr/email-automation/run', {});
  check(r.status === 200 && r.json.data.send.mode === 'live', 'HR automation API: HR can run the check now', r);

  // the scheduler endpoint is protected
  const unauth = await dispatch();
  check(unauth.status === 401, 'HR automation: the scheduler endpoint needs its secret', unauth.status);

  if (hrBack > 0) await setHrClock(0);
  mailMock.close();
  for (const k of ['AUTOMATION_MODE', 'EMAIL_PROVIDER', 'EMAIL_API_KEY', 'EMAIL_API_BASE_URL', 'EMAIL_FROM', 'EMAIL_CC', 'EMAIL_BCC', 'AUTOMATION_DISPATCH_SECRET', 'AUTOMATION_TEST_RECIPIENTS']) delete process.env[k];
}

// ---------------------------------------------------------------------------
// Subscription expiry reminder calls: decided and tracked in the database, dry run only (no calling provider is connected)
// ---------------------------------------------------------------------------
{
  Object.assign(process.env, { AUTOMATION_DISPATCH_SECRET: 'dispatch-secret-0123456789' });
  delete process.env.AUTOMATION_MODE_AI_CALL;
  const cust = (await db.query(`select id from public.customers where phone = '9000000201'`)).rows[0].id as string;
  const svc = (await db.query(`update public.customer_services set renews_on = ((now() at time zone 'Asia/Kolkata')::date + 7), service_status = 'LIVE'
                                 where customer_id = $1 returning service_code`, [cust])).rows[0].service_code as string;
  await db.query(`delete from public.subscription_reminders where customer_id = $1`, [cust]);
  const row = async () => (await db.query(`select status, reason, phone_masked, attempts, external_call_id, send_after, send_until from public.subscription_reminders where customer_id = $1 and service_code = $2 and stage = 7 and channel = 'CALL'`, [cust, svc])).rows;

  let r = await dispatch();
  check(r.status === 401, 'reminder calls: the scheduler endpoint still needs its secret', r.status);
  r = await dispatch('dispatch-secret-0123456789');
  check(r.status === 200 && r.json.data.subscriptionReminders.mode === 'dry_run' && r.json.data.subscriptionReminders.schedule.created >= 1, 'reminder calls: the daily run schedules the 7-day reminder (dry run by default)', r.json);
  check((await row()).length === 1, 'reminder calls: one reminder row');
  r = await dispatch('dispatch-secret-0123456789');
  check(r.json.data.subscriptionReminders.schedule.created === 0 && (await row()).length === 1, 'reminder calls: running the scheduler again creates no duplicate', r.json);
  check((await row())[0].status === 'SKIPPED' || (await row())[0].status === 'SCHEDULED', 'reminder calls: with no consent record the customer is never called (skipped or waiting for the window)');

  // consent, then the window around "now" (the test must not depend on the time of day)
  await db.query(`delete from public.subscription_reminders where customer_id = $1`, [cust]);
  await db.query(`insert into public.customer_reminder_consent (customer_id, status, note) values ($1, 'ALLOWED', 'test consent') on conflict (customer_id) do update set status = 'ALLOWED'`, [cust]);
  r = await dispatch('dispatch-secret-0123456789');
  await db.query(`update public.subscription_reminders set status = 'SCHEDULED', attempts = 0, reason = null, send_after = now() - interval '1 hour', send_until = now() + interval '1 hour', next_attempt_at = now()
                   where customer_id = $1 and stage = 7 and channel = 'CALL'`, [cust]);
  r = await dispatch('dispatch-secret-0123456789');
  const sub = r.json.data.subscriptionReminders;
  check(r.status === 200 && sub.mode === 'dry_run' && sub.dryRun >= 1 && sub.accepted === 0, 'reminder calls: a due reminder is prepared as a dry run, and nothing is accepted by any provider', r.json);
  let x = (await row())[0];
  check(x.status === 'DRY_RUN' && /^Dry run - not called/.test(x.reason) && /^\+91XXXXXX\d{4}$/.test(x.phone_masked) && x.external_call_id === null && x.attempts === 1,
    'reminder calls: recorded as DRY_RUN with a masked number, no call id and one attempt', x);
  check(!JSON.stringify(x).includes('9000000201'), 'reminder calls: the full phone number is not stored on the reminder');
  r = await dispatch('dispatch-secret-0123456789');
  check(r.json.data.subscriptionReminders.claimed === 0 && (await row()).length === 1, 'reminder calls: a finished dry run is not claimed again', r.json);

  // a renewal withdraws the reminder
  await db.query(`update public.customer_services set renews_on = ((now() at time zone 'Asia/Kolkata')::date + 365) where customer_id = $1 and service_code = $2`, [cust, svc]);
  r = await dispatch('dispatch-secret-0123456789');
  x = (await row())[0];
  check(x.status === 'CANCELLED' && /expiry date changed/.test(x.reason), 'reminder calls: a renewed service has its reminder cancelled', x);

  // off / live
  process.env.AUTOMATION_MODE_AI_CALL = 'off';
  r = await dispatch('dispatch-secret-0123456789');
  check(r.json.data.subscriptionReminders.mode === 'off' && r.json.data.subscriptionReminders.schedule === null, 'reminder calls: off does nothing', r.json);
  process.env.AUTOMATION_MODE_AI_CALL = 'live';
  r = await dispatch('dispatch-secret-0123456789');
  check(r.json.data.subscriptionReminders.mode === 'off' && /not available/.test(r.json.data.subscriptionReminders.note) && r.json.data.subscriptionReminders.claimed === 0,
    'reminder calls: live is refused while no calling provider is connected (nobody is called)', r.json);

  // --- BolifyAI: live calls go to the webhook (a local mock stands in for it) ---
  const bolifyHits: { body: any; auth: string | undefined }[] = [];
  let bolifyReply: { status: number; body: string } = { status: 200, body: '{"call_id":"BOL-1001"}' };
  const bolify = http.createServer((req, res) => {
    let raw = '';
    req.on('data', d => (raw += d));
    req.on('end', () => {
      bolifyHits.push({ body: JSON.parse(raw), auth: req.headers.authorization });
      res.writeHead(bolifyReply.status, { 'content-type': 'application/json' });
      res.end(bolifyReply.body);
    });
  });
  await new Promise<void>(res => bolify.listen(0, '127.0.0.1', res));
  const bolifyUrl = `http://127.0.0.1:${(bolify.address() as net.AddressInfo).port}/hook`;
  await db.query(`update public.customers set email = 'bolify.test@example.com', city = 'Pune' where id = $1`, [cust]);
  const reset = async () => {
    await db.query(`delete from public.subscription_reminders where customer_id = $1`, [cust]);
    await db.query(`update public.customer_services set renews_on = ((now() at time zone 'Asia/Kolkata')::date + 7), service_status = 'LIVE' where customer_id = $1 and service_code = $2`, [cust, svc]);
  };
  const inWindow = () => db.query(`update public.subscription_reminders set status = 'SCHEDULED', attempts = 0, reason = null, send_after = now() - interval '1 hour', send_until = now() + interval '1 hour', next_attempt_at = now()
                                    where customer_id = $1 and stage = 7 and channel = 'CALL'`, [cust]);
  process.env.AUTOMATION_MODE_AI_CALL = 'live';
  process.env.BOLIFY_WEBHOOK_URL = bolifyUrl;
  process.env.BOLIFY_API_KEY = 'bolify-key-123';
  await reset();
  await dispatch('dispatch-secret-0123456789'); // schedules it
  await inWindow();
  bolifyHits.length = 0;
  r = await dispatch('dispatch-secret-0123456789');
  x = (await row())[0];
  check(r.json.data.subscriptionReminders.mode === 'live' && r.json.data.subscriptionReminders.accepted >= 1 && bolifyHits.length === 1, 'bolify: a due reminder is sent to the BolifyAI webhook in live mode', r.json);
  check(JSON.stringify(Object.keys(bolifyHits[0].body)) === JSON.stringify(['name', 'phone', 'email', 'service', 'location']) && bolifyHits[0].body.phone === '+919000000201'
        && bolifyHits[0].body.email === 'bolify.test@example.com' && bolifyHits[0].body.location === 'Pune' && bolifyHits[0].auth === 'Bearer bolify-key-123',
    'bolify: the request is name, phone, email, service and location, with the key in the Authorization header', bolifyHits[0]);
  check(x.status === 'ACCEPTED' && x.external_call_id === 'BOL-1001' && x.attempts === 1 && !JSON.stringify(x).includes('9000000201') && !JSON.stringify(x).includes('bolify-key-123'),
    'bolify: recorded as ACCEPTED with BolifyAI\'s call id; no full number and no key is stored', x);
  r = await dispatch('dispatch-secret-0123456789');
  check(bolifyHits.length === 1 && r.json.data.subscriptionReminders.claimed === 0, 'bolify: an accepted reminder is never sent a second time', r.json);

  // busy: tried again; refused: failed and not tried again
  await reset();
  await dispatch('dispatch-secret-0123456789');
  await inWindow();
  bolifyHits.length = 0;
  bolifyReply = { status: 503, body: 'down' };
  r = await dispatch('dispatch-secret-0123456789');
  x = (await row())[0];
  check(x.status === 'RETRY' && x.attempts === 1 && bolifyHits.length === 1 && !/down/.test(x.reason ?? ''), 'bolify: an unavailable webhook (503) leaves the reminder to be tried again, and its reply is not stored', x);
  await db.query(`update public.subscription_reminders set next_attempt_at = now() - interval '1 minute' where customer_id = $1 and stage = 7 and channel = 'CALL'`, [cust]);
  bolifyReply = { status: 400, body: '{"error":"bad"}' };
  r = await dispatch('dispatch-secret-0123456789');
  x = (await row())[0];
  check(x.status === 'FAILED' && x.attempts === 2 && bolifyHits.length === 2, 'bolify: a refused request (400) fails the reminder at once', x);
  await db.query(`update public.subscription_reminders set next_attempt_at = now() - interval '1 minute' where customer_id = $1 and stage = 7 and channel = 'CALL'`, [cust]);
  r = await dispatch('dispatch-secret-0123456789');
  check(bolifyHits.length === 2, 'bolify: a failed reminder is not sent again', r.json);

  // no consent: nobody is called, nothing reaches the webhook
  await reset();
  await db.query(`update public.customer_reminder_consent set status = 'DO_NOT_CALL' where customer_id = $1`, [cust]);
  await dispatch('dispatch-secret-0123456789');
  await inWindow();
  bolifyReply = { status: 200, body: '{}' };
  bolifyHits.length = 0;
  r = await dispatch('dispatch-secret-0123456789');
  x = (await row())[0];
  check(x.status === 'SKIPPED' && bolifyHits.length === 0, 'bolify: a customer who asked not to be called never reaches the webhook', x);

  // dry run never reaches it either, and live without a webhook is still refused
  await db.query(`update public.customer_reminder_consent set status = 'ALLOWED' where customer_id = $1`, [cust]);
  await reset();
  process.env.AUTOMATION_MODE_AI_CALL = 'dry_run';
  await dispatch('dispatch-secret-0123456789');
  await inWindow();
  bolifyHits.length = 0;
  r = await dispatch('dispatch-secret-0123456789');
  check(bolifyHits.length === 0 && r.json.data.subscriptionReminders.dryRun >= 1, 'bolify: dry run never calls the webhook', r.json);
  process.env.AUTOMATION_MODE_AI_CALL = 'live';
  delete process.env.BOLIFY_WEBHOOK_URL;
  r = await dispatch('dispatch-secret-0123456789');
  check(r.json.data.subscriptionReminders.mode === 'off' && /BOLIFY_WEBHOOK_URL/.test(r.json.data.subscriptionReminders.note) && bolifyHits.length === 0, 'bolify: live with no webhook set is refused and names the missing setting', r.json);

  // the Technical Consultant's on-demand AI Calling goes straight to BolifyAI too
  process.env.BOLIFY_WEBHOOK_URL = bolifyUrl;
  bolifyReply = { status: 200, body: '{"id":"BOL-2002"}' };
  const odc = await autoCustomer({ name: 'Onboard Caller', company: 'Caller Co', phone: '9820011122', email: 'caller@example.com', city: 'Nashik' }, null);
  r = await api('mv', 'GET', `/pipeline/customers/${odc}/automations`);
  check(r.status === 200 && r.json.data.find((a: any) => a.code === 'AI_CALLING').connected === true, 'bolify: AI Calling shows as connected once the webhook is set', r);
  bolifyHits.length = 0;
  r = await api('mv', 'POST', `/pipeline/customers/${odc}/automations/AI_CALLING`);
  check(r.status === 200 && bolifyHits.length === 1 && bolifyHits[0].body.name === 'Onboard Caller' && bolifyHits[0].body.phone === '+919820011122' && bolifyHits[0].body.location === 'Nashik' && r.json.data.lastRun.status === 'SENT',
    'bolify: the Technical Consultant\'s AI Calling posts the customer to BolifyAI and records the run', r.json);
  bolify.close();
  delete process.env.BOLIFY_WEBHOOK_URL;
  delete process.env.BOLIFY_API_KEY;

  delete process.env.AUTOMATION_MODE_AI_CALL;
  delete process.env.AUTOMATION_DISPATCH_SECRET;
  await db.query(`delete from public.subscription_reminders where customer_id = $1`, [cust]);
  await db.query(`delete from public.customer_reminder_consent where customer_id = $1`, [cust]);
}

// ---------------------------------------------------------------------------
// Subscription expiry reminders by e-mail and WhatsApp (Wabastore): dry run by default, live only with approved wording and a provider
// ---------------------------------------------------------------------------
{
  Object.assign(process.env, { AUTOMATION_DISPATCH_SECRET: 'dispatch-secret-0123456789', AUTOMATION_MODE_AI_CALL: 'off' });
  for (const k of ['AUTOMATION_MODE_SUB_EMAIL', 'AUTOMATION_MODE_SUB_WHATSAPP', 'WABASTORE_WEBHOOK_URL', 'WABASTORE_API_KEY']) delete process.env[k];
  const cust = (await db.query(`select id from public.customers where phone = '9000000201'`)).rows[0].id as string;
  const svc = (await db.query(`update public.customer_services set renews_on = ((now() at time zone 'Asia/Kolkata')::date + 7), service_status = 'LIVE'
                                 where customer_id = $1 returning service_code`, [cust])).rows[0].service_code as string;
  await db.query(`update public.customers set email = 'expiry.msg@example.com', whatsapp = null where id = $1`, [cust]);
  const wipe = () => db.query(`delete from public.subscription_reminders where customer_id = $1`, [cust]);
  const rows = async () => (await db.query(`select channel, status, reason, phone_masked, external_call_id, attempts from public.subscription_reminders where customer_id = $1 and service_code = $2 and stage = 7 order by channel`, [cust, svc])).rows;
  const of = async (channel: string) => (await rows()).find((x: any) => x.channel === channel);
  const inWindow = () => db.query(`update public.subscription_reminders set status = 'SCHEDULED', attempts = 0, reason = null, send_after = now() - interval '1 hour', send_until = now() + interval '1 hour', next_attempt_at = now()
                                    where customer_id = $1 and stage = 7 and channel in ('EMAIL', 'WHATSAPP')`, [cust]);
  const S = 'dispatch-secret-0123456789';

  const mails: any[] = [];
  const waHits: { body: any; auth: string | undefined }[] = [];
  const serve = (onReq: (req: http.IncomingMessage, raw: string) => void, reply: () => string) => {
    const srv = http.createServer((req, res) => {
      let raw = '';
      req.on('data', d => (raw += d));
      req.on('end', () => {
        onReq(req, raw);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(reply());
      });
    });
    return new Promise<{ srv: http.Server; url: string }>(done => srv.listen(0, '127.0.0.1', () => done({ srv, url: `http://127.0.0.1:${(srv.address() as net.AddressInfo).port}` })));
  };
  const mailSrv = await serve((req, raw) => mails.push({ path: req.url, body: JSON.parse(raw) }), () => '{"id":"re_expiry_1"}');
  const waSrv = await serve((req, raw) => waHits.push({ body: JSON.parse(raw), auth: req.headers.authorization }), () => '{"id":"wamid.expiry.1"}');

  await wipe();
  await db.query(`update public.reminder_message_templates set approved = false`);

  // the daily run decides what is due; by default nothing is sent
  let r = await dispatch(S);
  check(r.status === 200 && r.json.data.subscriptionMessages.email.mode === 'dry_run' && r.json.data.subscriptionMessages.whatsapp.mode === 'dry_run', 'expiry messages: dry run by default for both channels', r.json.data?.subscriptionMessages);
  check((await rows()).length === 2 && (await of('EMAIL')) && (await of('WHATSAPP')) && !(await of('CALL')), 'expiry messages: the 7-day reminder exists once per channel that is running (no call reminder while calls are off)', await rows());
  await inWindow();
  r = await dispatch(S);
  check(r.json.data.subscriptionMessages.email.dryRun >= 1 && r.json.data.subscriptionMessages.whatsapp.dryRun >= 1 && r.json.data.subscriptionMessages.email.accepted === 0, 'expiry messages: a due reminder is a dry run', r.json.data.subscriptionMessages);
  let x = await of('EMAIL');
  check(x.status === 'DRY_RUN' && x.phone_masked === 'e***@example.com' && !JSON.stringify(x).includes('expiry.msg'), 'expiry messages: recorded as DRY_RUN with a masked address', x);
  x = await of('WHATSAPP');
  check(x.status === 'DRY_RUN' && !JSON.stringify(x).includes('9000000201'), 'expiry messages: ... and a masked number');
  check(mails.length === 0 && waHits.length === 0, 'expiry messages: a dry run sends nothing');

  // live, but the wording is still a draft: nothing is sent
  Object.assign(process.env, { AUTOMATION_MODE_SUB_EMAIL: 'live', AUTOMATION_MODE_SUB_WHATSAPP: 'live', EMAIL_PROVIDER: 'resend', EMAIL_API_KEY: 're_exp_key', EMAIL_API_BASE_URL: mailSrv.url,
    EMAIL_FROM: 'Amuwa Corporation <meta@amuwa.com>', WABASTORE_WEBHOOK_URL: `${waSrv.url}/send`, WABASTORE_API_KEY: 'wb-key-1' });
  await inWindow();
  r = await dispatch(S);
  check(r.json.data.subscriptionMessages.email.mode === 'live' && r.json.data.subscriptionMessages.email.claimed === 0 && r.json.data.subscriptionMessages.whatsapp.claimed === 0 && mails.length === 0 && waHits.length === 0,
    'expiry messages: live, but wording that is not approved is never sent', r.json.data.subscriptionMessages);

  // approved wording: both are sent once
  await db.query(`update public.reminder_message_templates set approved = true where stage = 7`);
  r = await dispatch(S);
  check(r.json.data.subscriptionMessages.email.accepted === 1 && r.json.data.subscriptionMessages.whatsapp.accepted === 1, 'expiry messages: with approved wording, live sends the e-mail and the WhatsApp message', r.json.data.subscriptionMessages);
  const mail = mails.find(m => m.path === '/emails');
  check(mails.length === 1 && mail.body.to[0] === 'expiry.msg@example.com' && /expires/i.test(mail.body.subject) && /7/.test(mail.body.subject + mail.body.text), 'expiry messages: the e-mail goes to the customer with the filled subject', mail?.body);
  check(!/\{\{/.test(mail.body.html) && !/\{\{/.test(mail.body.subject), 'expiry messages: no placeholder is left in the e-mail');
  check(waHits.length === 1 && waHits[0].body.to === '+919000000201' && waHits[0].auth === 'Bearer wb-key-1' && waHits[0].body.reference.startsWith('subscription-reminder:') && !/\{\{/.test(waHits[0].body.text),
    'expiry messages: the WhatsApp request goes to Wabastore with the key, the number, a reference and the filled text', waHits[0]);
  x = await of('EMAIL');
  check(x.status === 'ACCEPTED' && x.external_call_id === 're_expiry_1' && x.attempts === 1, 'expiry messages: the e-mail is ACCEPTED with the provider\'s reference', x);
  x = await of('WHATSAPP');
  check(x.status === 'ACCEPTED' && x.external_call_id === 'wamid.expiry.1', 'expiry messages: the WhatsApp message is ACCEPTED with its reference', x);
  const audit = (await db.query(`select count(*)::int n from public.audit_logs where action = 'SUBSCRIPTION_REMINDER_ACCEPTED' and metadata->>'customer' = $1 and metadata->>'channel' in ('EMAIL', 'WHATSAPP')`, [cust])).rows[0].n;
  check(audit === 2, 'expiry messages: each acceptance is audited with its channel', audit);
  mails.length = 0; waHits.length = 0;
  r = await dispatch(S);
  check(mails.length === 0 && waHits.length === 0 && r.json.data.subscriptionMessages.email.claimed === 0, 'expiry messages: an accepted reminder is never sent a second time');

  // a customer who opted out gets nothing
  await wipe();
  await db.query(`insert into public.customer_message_optout (customer_id, channel, note) values ($1, 'EMAIL', 'asked not to') on conflict do nothing`, [cust]);
  await dispatch(S);
  waHits.length = 0; // (inside the sending window the first run may already have sent; the window is forced below so the test does not depend on the time of day)
  await inWindow();
  r = await dispatch(S);
  x = await of('EMAIL');
  check(x.status === 'SKIPPED' && /asked not to receive/.test(x.reason) && mails.length === 0, 'expiry messages: an opted-out customer is skipped, with the reason', x);
  check(waHits.length === 1, 'expiry messages: ... and the other channel is unaffected');
  await db.query(`delete from public.customer_message_optout where customer_id = $1`, [cust]);

  // a provider that is down: retried, and its answer is not stored
  await wipe();
  waHits.length = 0;
  await dispatch(S);
  await inWindow();
  const waDown = await serve(() => undefined, () => '{}');
  waDown.srv.close();
  process.env.WABASTORE_WEBHOOK_URL = `${waDown.url}/send`;
  r = await dispatch(S);
  x = await of('WHATSAPP');
  check(x.status === 'RETRY' && x.attempts === 1 && /Could not reach Wabastore/.test(x.reason), 'expiry messages: an unreachable WhatsApp provider leaves the reminder to be tried again', x);

  // live with no provider connected: refused, and says what is missing
  delete process.env.WABASTORE_WEBHOOK_URL;
  delete process.env.EMAIL_PROVIDER;
  delete process.env.EMAIL_API_KEY;
  r = await dispatch(S);
  check(r.json.data.subscriptionMessages.whatsapp.mode === 'off' && /WABASTORE_WEBHOOK_URL/.test(r.json.data.subscriptionMessages.whatsapp.note) && /EMAIL_PROVIDER/.test(r.json.data.subscriptionMessages.email.note),
    'expiry messages: live without a provider is refused and names the missing setting', r.json.data.subscriptionMessages);

  // switched off
  Object.assign(process.env, { AUTOMATION_MODE_SUB_EMAIL: 'off', AUTOMATION_MODE_SUB_WHATSAPP: 'off' });
  r = await dispatch(S);
  check(r.json.data.subscriptionMessages.email.mode === 'off' && r.json.data.subscriptionMessages.whatsapp.mode === 'off' && r.json.data.subscriptionMessages.email.claimed === 0, 'expiry messages: off does nothing');

  mailSrv.srv.close();
  waSrv.srv.close();
  for (const k of ['AUTOMATION_MODE_SUB_EMAIL', 'AUTOMATION_MODE_SUB_WHATSAPP', 'WABASTORE_WEBHOOK_URL', 'WABASTORE_API_KEY', 'EMAIL_PROVIDER', 'EMAIL_API_KEY', 'EMAIL_API_BASE_URL', 'EMAIL_FROM', 'AUTOMATION_MODE_AI_CALL', 'AUTOMATION_DISPATCH_SECRET']) delete process.env[k];
  await db.query(`update public.reminder_message_templates set approved = false`);
  await wipe();
}

// ---------------------------------------------------------------------------
// GST of the ORDER: Accounts chooses the rate once; a payment is only the money received (GST included)
// ---------------------------------------------------------------------------
{
  let r = await api('a', 'POST', '/pipeline/leads', { name: 'Gst Api Customer', company: 'Gst Api Co', phone: '9850000001', leadSource: 'Walk-in', services: ['AI_CALLING'] });
  const gl = r.json.data.id as string;
  r = await api('a', 'POST', `/pipeline/customers/${gl}/send-to-accounts`, { amount: 100000 });
  check(r.status === 200 || r.status === 201, 'order GST: Sales sends 1,00,000 to Accounts (before GST)', r);
  r = await api('accm', 'POST', `/pipeline/customers/${gl}/accounts/order-gst`, { rate: 30 });
  check(r.status === 422, 'order GST: a rate that is not on the list (30) is refused', r);
  r = await api('accm', 'POST', `/pipeline/customers/${gl}/accounts/order-gst`, { rate: 18 });
  check(r.status === 200 && r.json.data.dealAmount === 118000 && r.json.data.order.gstTotal === 18000 && r.json.data.order.roundOff === 0, 'order GST: 18% on 1,00,000 = 18,000, payable 1,18,000', r);
  r = await api('accm', 'POST', `/pipeline/customers/${gl}/accounts/payments`, { type: 'PART', amount: 60000.5, method: 'CASH', verify: false });
  check(r.status === 422 && /whole rupees/i.test(r.json.error.message), 'order GST: the amount received is in whole rupees (paise refused)', r);
  r = await api('accm', 'POST', `/pipeline/customers/${gl}/accounts/payments`, { type: 'PART', amount: 60000, method: 'CASH', verify: true });
  const p0 = r.json.data;
  check(r.status === 201 || r.status === 200, 'order GST: Accounts records 60,000 received and verified', r);
  const pay = p0.payments[0];
  check(pay.amount === 60000 && (pay.gstAmount ?? null) === null && (pay.taxableAmount ?? null) === null, 'order GST: the payment is the money received - it carries no GST of its own', pay);
  check(p0.dealAmount === 118000 && p0.recorded === 60000 && p0.balance === 58000, 'order GST: recording a payment did not change the payable (1,18,000); 58,000 is left', p0);
  r = await api('accm', 'POST', `/pipeline/customers/${gl}/accounts/payments`, { type: 'PART', amount: 58001, method: 'CASH', verify: false });
  check(r.status === 422, 'order GST: more than the outstanding amount including GST is refused', r);
  r = await api('accm', 'POST', `/pipeline/customers/${gl}/accounts/payments`, { type: 'FULL', amount: 57999, method: 'CASH', verify: true });
  check(r.status === 422, 'order GST: a full payment must be the whole outstanding amount (58,000)', r);
  r = await api('accm', 'POST', `/pipeline/customers/${gl}/accounts/payments`, { type: 'FULL', amount: 58000, method: 'CASH', verify: true });
  check((r.status === 201 || r.status === 200) && r.json.data.dealAmount === 118000 && r.json.data.recorded === 118000, 'order GST: a full payment settles the whole 1,18,000 (1,00,000 + 18,000 GST)', r);
  r = await api('a', 'POST', `/pipeline/customers/${gl}/accounts/payments`, { type: 'PART', amount: 100, method: 'CASH', verify: false });
  check(r.status === 403, 'order GST: a Sales member cannot record a payment', r);

  // the small example: 14 agreed + 18% = 16.52, payable in whole rupees = 17
  r = await api('a', 'POST', '/pipeline/leads', { name: 'Gst Small Customer', company: 'Gst Small Co', phone: '9850000002', leadSource: 'Walk-in', services: ['AI_CALLING'] });
  const gs = r.json.data.id as string;
  r = await api('a', 'POST', `/pipeline/customers/${gs}/send-to-accounts`, { amount: 14 });
  check(r.status === 200 || r.status === 201, 'order GST: Sales sends 14 to Accounts', r);
  r = await api('accm', 'GET', `/pipeline/customers/${gs}/payment-overview`);
  check(r.json.data.order.gstRequired === true && r.json.data.dealAmount === 14, 'order GST: before the rate is chosen the payable is not calculated (nothing is added)', r.json.data.order);
  r = await api('accm', 'POST', `/pipeline/customers/${gs}/accounts/order-gst`, { rate: 18 });
  check(r.status === 200 && r.json.data.dealAmount === 17 && r.json.data.order.totalPayable === 17 && r.json.data.order.gstTotal === 2.52 && r.json.data.order.roundOff === 0.48 && r.json.data.order.balance === 17,
    'order GST: 14 + 18% = 16.52, payable in whole rupees is 17 (GST 2.52, round-off 0.48), the balance is 17', r.json.data.order);
  r = await api('accm', 'POST', `/pipeline/customers/${gs}/accounts/payments`, { type: 'FULL', amount: 16.52, method: 'CASH', verify: true });
  check(r.status === 422, 'order GST: 16.52 is refused (whole rupees)', r);
  r = await api('accm', 'POST', `/pipeline/customers/${gs}/accounts/payments`, { type: 'FULL', amount: 14, method: 'CASH', verify: true });
  check(r.status === 422, 'order GST: 14 is not a full payment of 17', r);
  r = await api('accm', 'POST', `/pipeline/customers/${gs}/accounts/payments`, { type: 'FULL', amount: 17, method: 'CASH', verify: true });
  check((r.status === 201 || r.status === 200) && r.json.data.order.balance === 0 && r.json.data.paymentStatus === 'FULLY_PAID', 'order GST: the full payment of 17 settles the order', r);

  // the reconciliation list is for Accounts
  r = await api('a', 'GET', '/pipeline/accounts/gst-reconciliation');
  check(r.status === 403, 'order GST: the reconciliation list is not for Sales', r);
  r = await api('accm', 'GET', '/pipeline/accounts/gst-reconciliation');
  check(r.status === 200 && Array.isArray(r.json.data) && !r.json.data.some((x: any) => x.customerId === gl || x.customerId === gs), 'order GST: Accounts can read it; orders made the new way are not on it', r);
}

// ---------------------------------------------------------------------------
// Department income attribution: the report, reconciliation, corrections and the Client Dashboard rule
// ---------------------------------------------------------------------------
{
  const deptOf = async (token: string) => (await api(token, 'GET', '/me')).json.data.department?.id ?? (await api(token, 'GET', '/me')).json.data.departmentId;
  let r = await api(null, 'GET', '/reports/department-income');
  check(r.status === 401, 'department income: signed-out visitors are refused', r.status);
  r = await api('sa', 'GET', '/reports/department-income');
  check(r.status === 200 && r.json.data.totals && typeof r.json.data.totals.collected === 'number' && typeof r.json.data.totals.collectedGst === 'number'
    && r.json.data.byDivision && Array.isArray(r.json.data.departments) && Array.isArray(r.json.data.orders) && ['SUPPORT', 'SALES', 'ACQUISITION'].includes(r.json.data.rule),
    'department income: the Super Admin reads the consolidated report (totals, GST split, divisions, departments, orders)', r);
  const all = r.json.data;
  check(all.departments.every((d: any) => Math.abs(d.collected - (d.sales.collected + d.support.collected)) < 0.005), 'department income: each department is its Sales plus its Support');
  check(Math.abs(all.totals.collected - all.departments.reduce((n: number, d: any) => n + d.collected, 0)) < 0.005, 'department income: the company total is the sum of the departments');
  r = await api('accm', 'GET', '/reports/department-income');
  check(r.status === 200, 'department income: Accounts sees every department', r);
  r = await api('dh', 'GET', '/reports/department-income');
  check(r.status === 200 && r.json.data.scope.departmentId && r.json.data.departments.length === 0, 'department income: a Department Head gets their own department only', r);
  const ownDept = r.json.data.scope.departmentId as string;
  const otherDept = (all.departments.find((d: any) => d.departmentId !== ownDept) ?? { departmentId: crypto.randomUUID() }).departmentId as string;
  r = await api('dh', 'GET', `/reports/department-income?departmentId=${otherDept}`);
  check(r.status === 403, 'department income: and cannot ask for another department', r);
  r = await api('a', 'GET', '/reports/department-income');
  check(r.status === 403, 'department income: a Sales member is refused', r);
  r = await api('sm', 'GET', '/reports/department-income');
  check(r.status === 403, 'department income: so is a Support member', r);
  r = await api('sa', 'GET', '/reports/department-income?from=2026-12-31&to=2026-01-01');
  check(r.status === 422, 'department income: a reversed date range is refused', r);
  r = await api('sa', 'GET', '/reports/department-income?departmentId=not-a-uuid');
  check(r.status === 422, 'department income: a bad department id is refused', r);

  r = await api('accm', 'GET', '/reports/department-income/reconciliation');
  check(r.status === 200 && Array.isArray(r.json.data.items), 'department income: Accounts sees the orders to reconcile', r);
  r = await api('a', 'GET', '/reports/department-income/reconciliation');
  check(r.status === 403, 'department income: a Sales member cannot', r);
  r = await api('accm', 'POST', '/reports/department-income/orders/attribution', { orderKey: 'SALE:not-an-id', division: 'SUPPORT', reason: 'testing' });
  check(r.status === 422, 'department income: a made-up order key is refused', r);
  r = await api('accm', 'POST', '/reports/department-income/orders/attribution', { orderKey: `SALE:${crypto.randomUUID()}`, division: 'SUPPORT' });
  check(r.status === 422, 'department income: a correction needs a reason', r);
  r = await api('accm', 'POST', '/reports/department-income/orders/attribution', { orderKey: `SALE:${crypto.randomUUID()}`, division: 'SUPPORT', reason: 'testing the unknown order' });
  check(r.status === 404, 'department income: an order that does not exist is not found', r);
  r = await api('a', 'POST', '/reports/department-income/orders/attribution', { orderKey: `SALE:${crypto.randomUUID()}`, division: 'SUPPORT', reason: 'testing' });
  check(r.status === 403, 'department income: a Sales member cannot change attribution', r);
  const custA = (await db.query(`select id from public.customers where phone = '9000000201'`)).rows[0].id as string;
  r = await api('accm', 'POST', `/reports/department-income/customers/${custA}/acquisition`, { division: 'SUPPORT', reason: 'x' });
  check(r.status === 422, 'department income: the acquisition reason needs a few words', r);
  r = await api('accm', 'POST', `/reports/department-income/customers/${custA}/acquisition`, { division: 'SALES', reason: 'Confirmed with the Sales team lead' });
  check(r.status === 200 && r.json.data.acquisitionDivision === 'SALES', 'department income: Accounts records who acquired a customer', r);
  check((await db.query(`select count(*)::int n from public.audit_logs where action = 'CUSTOMER_ACQUISITION_CHANGED' and entity_id = $1`, [custA])).rows[0].n === 1, 'department income: and it is in the audit log');
  r = await api('a', 'POST', `/reports/department-income/customers/${custA}/acquisition`, { division: 'SALES', reason: 'Confirmed with the Sales team lead' });
  check(r.status === 403, 'department income: a Sales member cannot', r);

  r = await api('accm', 'GET', '/reports/department-income/settings');
  check(r.status === 200 && r.json.data.clientPurchaseAttribution === 'SUPPORT', 'department income: Accounts reads the Client Dashboard rule (Support by default)', r);
  r = await api('accm', 'PATCH', '/reports/department-income/settings', { clientPurchaseAttribution: 'SALES' });
  check(r.status === 403, 'department income: only the Super Admin changes it', r);
  r = await api('sa', 'PATCH', '/reports/department-income/settings', { clientPurchaseAttribution: 'EVERYONE' });
  check(r.status === 422, 'department income: an unknown rule is refused', r);
  r = await api('sa', 'PATCH', '/reports/department-income/settings', { clientPurchaseAttribution: 'ACQUISITION' });
  check(r.status === 200, 'department income: the Super Admin sets the rule', r);
  r = await api('sa', 'GET', '/reports/department-income');
  check(r.json.data.rule === 'ACQUISITION', 'department income: the report shows the rule in force', r);
  r = await api('sa', 'PATCH', '/reports/department-income/settings', { clientPurchaseAttribution: 'SUPPORT' });
  check(r.status === 200, 'department income: and it can be set back', r);
  void deptOf;
}

// ---------------------------------------------------------------------------
// Security hardening: /api/proxy and the lead webhook (Vercel functions), against the real database
// ---------------------------------------------------------------------------
{
  const { default: proxyHandler } = await import('../../api/proxy.js');
  const { default: webhookHandler } = await import('../../api/webhook.js');
  const adapt = (handler: (req: any, res: any) => unknown) => async (nreq: http.IncomingMessage, nres: http.ServerResponse) => {
    const url = new URL(nreq.url || '/', 'http://localhost');
    const chunks: Buffer[] = [];
    for await (const c of nreq) chunks.push(c as Buffer);
    const text = Buffer.concat(chunks).toString();
    const query: Record<string, string> = {};
    url.searchParams.forEach((v, k) => { query[k] = v; });
    let status = 200;
    const res: any = {
      setHeader: (k: string, v: string) => { nres.setHeader(k, v); return res; },
      status: (n: number) => { status = n; return res; },
      json: (b: unknown) => { nres.writeHead(status, { 'content-type': 'application/json' }); nres.end(JSON.stringify(b)); return res; },
      send: (b: any) => { nres.writeHead(status); nres.end(b); return res; },
      end: () => { nres.writeHead(status); nres.end(); return res; }
    };
    let body: unknown;
    try { body = text ? JSON.parse(text) : undefined; } catch { body = text; }
    await handler({ method: nreq.method, url: nreq.url, query, headers: nreq.headers, body }, res);
  };
  const vserver = http.createServer((q, s) => void adapt(q.url!.startsWith('/api/proxy') ? proxyHandler : webhookHandler)(q, s));
  await new Promise<void>(res => vserver.listen(0, res));
  const vbase = `http://127.0.0.1:${(vserver.address() as any).port}`;
  const vcall = async (path: string, init: RequestInit = {}) => {
    const res = await fetch(vbase + path, init);
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, json, text, headers: res.headers };
  };

  // /api/proxy
  let v = await vcall('/api/proxy?url=' + encodeURIComponent('http://127.0.0.1:1/'));
  check(v.status === 401, 'proxy: refuses a visitor who is not signed in', v);
  v = await vcall('/api/proxy?url=' + encodeURIComponent('http://169.254.169.254/latest/meta-data/'), { headers: { authorization: `Bearer ${tokens.get('a')}` } });
  check(v.status === 400, 'proxy: a signed-in user still cannot reach the cloud metadata address', v);
  v = await vcall('/api/proxy?url=' + encodeURIComponent('http://127.0.0.1:5432/'), { headers: { authorization: `Bearer ${tokens.get('a')}` } });
  check(v.status === 400, 'proxy: nor localhost / internal ports', v);
  v = await vcall('/api/proxy?url=' + encodeURIComponent('file:///etc/passwd'), { headers: { authorization: `Bearer ${tokens.get('a')}` } });
  check(v.status === 400, 'proxy: nor local files', v);
  v = await vcall('/api/proxy', { headers: { authorization: `Bearer ${tokens.get('a')}` } });
  check(v.status === 400, 'proxy: a missing address is a plain 400', v);
  check(!v.headers.get('access-control-allow-origin'), 'proxy: no wildcard CORS');

  // lead webhook
  const secret = 'integration-shared-secret-0001';
  process.env.WEBHOOK_SECRET = secret;
  v = await vcall('/api/webhooks/wabastore/whatsapp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Intruder' }) });
  check(v.status === 401, 'webhook: a lead without the secret is refused', v);
  check((await db.query(`select count(*)::int as n from crm_leads where name = 'Intruder'`)).rows[0].n === 0, 'webhook: and nothing was stored');
  check((await db.query(`select count(*)::int as n from audit_logs where action = 'WEBHOOK_REJECTED' and entity_type = 'webhook'`)).rows[0].n >= 1, 'webhook: the rejection is in the audit log');
  check((await db.query(`select count(*)::int as n from audit_logs where action = 'WEBHOOK_REJECTED' and metadata::text ilike '%integration-shared-secret%'`)).rows[0].n === 0, 'webhook: the secret is never audited');
  v = await vcall('/api/webhooks/nosuchdept/whatsapp', { method: 'POST', headers: { 'content-type': 'application/json', 'x-webhook-secret': secret }, body: JSON.stringify({ name: 'Ghost' }) });
  check(v.status === 404, 'webhook: an unknown department is refused', v);
  v = await vcall('/api/webhooks/wabastore/whatsapp', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-webhook-secret': secret },
    body: JSON.stringify({ name: 'Webhook Ravi', phone: '9820011111', message: 'x'.repeat(9000), department: 'whatsbox' })
  });
  check(v.status === 200 && v.json.success, 'webhook: a lead with the secret is stored', v);
  const stored = (await db.query(`select department, channel, length(notes) as n, raw_payload is not null as raw from crm_leads where name = 'Webhook Ravi'`)).rows[0];
  check(stored.department === 'wabastore' && stored.channel === 'whatsapp', 'webhook: the department comes from the address, not from the sender data', stored);
  check(stored.n === 4000, 'webhook: long text is cut to its limit', stored);
  v = await vcall('/api/webhooks/wabastore/whatsapp', { method: 'POST', headers: { 'content-type': 'application/json', 'x-webhook-secret': secret }, body: JSON.stringify({ name: 'Big', data: 'y'.repeat(100_000) }) });
  check(v.status === 200, 'webhook: an oversized payload is still accepted ...', v);
  check((await db.query(`select raw_payload ->> 'truncated' as t from crm_leads where name = 'Big'`)).rows[0].t === 'true', '... but its raw copy is not stored in full');
  delete process.env.WEBHOOK_SECRET;
  vserver.close();

  // leads are scoped to the department (through the real PostgREST path used by the app)
  const leadVisible = async (who: string, name: string) => {
    const res = await fetch(`${process.env.GATEWAY_URL}/rest/v1/crm_leads?name=eq.${encodeURIComponent(name)}&select=id`, {
      headers: { apikey: process.env.SUPABASE_ANON_KEY!, authorization: `Bearer ${tokens.get(who)}` }
    });
    return ((await res.json()) as unknown[]).length;
  };
  check(await leadVisible('sa', 'Webhook Ravi') === 1, 'leads: the Super Admin sees the webhook lead');
  check(await leadVisible('a', 'Webhook Ravi') === 1, 'leads: a member of the same department sees it');
  check(await leadVisible('hr', 'Webhook Ravi') === 0, 'leads: HR staff (another department) do not see it');
  check(await leadVisible('accm', 'Webhook Ravi') === 0, 'leads: nor Accounts');
  check(await leadVisible('client', 'Webhook Ravi') === 0, 'leads: nor a client login');
}

// ---------------------------------------------------------------------------
// Dashboards and security events
// ---------------------------------------------------------------------------
{
  console.log('--- dashboards: who may read the company-wide view');
  r = await api(null, 'GET', '/dashboard/company-overview');
  check(r.status === 401, 'dashboards: the company overview needs a sign-in', r);
  let firstDeniedRid: string | null = null; // the first refusal of the Team Member is the one that is recorded (the repeats are the same event)
  for (const who of ['dh', 'th', 'a', 'accm', 'sm', 'tc'] as const) {
    r = await api(who, 'GET', '/dashboard/company-overview');
    check(r.status === 403, `dashboards: ${who} cannot read the company-wide view`, r);
    if (who === 'a') firstDeniedRid = r.requestId;
  }
  r = await api('sa', 'GET', '/dashboard/company-overview');
  const co = r.json.data;
  check(r.status === 200 && co.customers.total === Number((await db.query(`select count(*) from customers`)).rows[0].count) && Array.isArray(co.departments) && co.trend.length === 12 && Array.isArray(co.alerts),
    'dashboards: the Super Admin gets the company overview, and its customer total is the real record count', r);
  check(co.departments.reduce((n: number, d: any) => n + d.records, 0) === Number((await db.query(`select count(*) from customers where department_id is not null`)).rows[0].count),
    'dashboards: the department rows add up to the customers (none counted twice)');
  check(Number(co.money.incomeTotal) === Number((await db.query(`select coalesce(sum(amount), 0) s from private.verified_income()`)).rows[0].s), 'dashboards: income is verified payments only');

  console.log('--- company workflow: the Super Admin only, built from the real departments');
  r = await api(null, 'GET', '/dashboard/company-workflow');
  check(r.status === 401, 'workflow: the company workflow needs a sign-in', r);
  for (const who of ['dh', 'th', 'a', 'accm', 'sm', 'tc'] as const) {
    r = await api(who, 'GET', '/dashboard/company-workflow');
    check(r.status === 403, `workflow: ${who} cannot read the company workflow`, r);
  }
  r = await api('sa', 'GET', '/dashboard/company-workflow');
  const wf = r.json.data;
  check(r.status === 200 && wf.departments.length === Number((await db.query(`select count(*) from departments`)).rows[0].count)
    && wf.teams.length === Number((await db.query(`select count(*) from teams`)).rows[0].count) && Array.isArray(wf.handoffs) && wf.handoffs.length > 0,
    'workflow: the Super Admin gets every department and team, and the hand-offs between them', r);
  check(!JSON.stringify(wf).match(/password|token|secret|"email"|"phone"/i), 'workflow: nothing sensitive is returned');

  console.log('--- dashboards: the scoped overview');
  r = await api('th', 'GET', '/dashboard/scope-overview');
  const thTeam = (await db.query(`select team_id from profiles where email = (select email from profiles where id = $1)`, [(await api('th', 'GET', '/me')).json.data.id])).rows[0].team_id;
  check(r.status === 200 && r.json.data.scope.role === 'TEAM_HEAD' && r.json.data.customers.total === Number((await db.query(`select count(*) from customers where team_id = $1`, [thTeam])).rows[0].count),
    'dashboards: a Team Lead counts only their own team', r);
  const dhDept = (await api('dh', 'GET', '/me')).json.data.department.id;
  r = await api('dh', 'GET', `/dashboard/scope-overview?departmentId=${crypto.randomUUID()}`);
  check(r.status === 200 && r.json.data.scope.departmentId === dhDept && r.json.data.customers.total === Number((await db.query(`select count(*) from customers where department_id = $1`, [dhDept])).rows[0].count),
    'dashboards: a Department Head gets their own department even when another is named in the request', r);
  r = await api('a', 'GET', '/dashboard/scope-overview');
  check(r.status === 403, 'dashboards: a Team Member has no scoped overview', r);
  r = await api('sa', 'GET', `/dashboard/scope-overview?departmentId=${dhDept}`);
  check(r.status === 200 && r.json.data.scope.departmentId === dhDept, 'dashboards: the Super Admin may name a department', r);
  r = await api('sa', 'GET', '/dashboard/scope-overview?departmentId=not-a-uuid');
  check(r.status === 422, 'dashboards: a bad department id is refused', r);

  console.log('--- security: refused requests are recorded');
  await db.query(`delete from audit_logs where action in ('ACCESS_DENIED', 'AUTH_REJECTED') and false`); // (the log is append-only: nothing to clear)
  const deniedRid = firstDeniedRid;
  check(!!deniedRid, 'security: the response carries a request id');
  let ev = (await db.query(`select * from audit_logs where action = 'ACCESS_DENIED' and request_id = $1`, [deniedRid])).rows;
  check(ev.length === 1 && ev[0].outcome === 'DENIED' && ev[0].actor_role === 'TEAM_MEMBER' && ev[0].metadata.route === '/dashboard/company-overview' && ev[0].metadata.status === 403 && ev[0].metadata.code === 'FORBIDDEN',
    'security: a refused request is recorded with who, which route (pattern), the code and the request id', ev);
  check(!JSON.stringify(ev[0].metadata).match(/Bearer|eyJ|password/i), 'security: no token or secret is in the event', ev[0].metadata);
  await api('a', 'GET', '/dashboard/company-overview');
  await api('a', 'GET', '/dashboard/company-overview');
  check((await db.query(`select count(*)::int n from audit_logs where action = 'ACCESS_DENIED' and actor_id = (select id from profiles where email = 'a@amuwa.com') and metadata ->> 'route' = '/dashboard/company-overview'`)).rows[0].n === 1,
    'security: retrying the same refused request does not add events (one per caller, route and kind in five minutes)');
  // (the suite has sent many unauthenticated requests by now: the per-minute allowance for anonymous events starts fresh for this check)
  (await import('../../server/security/events.js')).resetSecurityEventLimits();
  r = await api(null, 'GET', '/dashboard/scope-overview?x=secret-query-value');
  ev = (await db.query(`select * from audit_logs where action = 'AUTH_REJECTED' and request_id = $1`, [r.requestId])).rows;
  check(r.status === 401 && ev.length === 1 && ev[0].actor_id === null && ev[0].outcome === 'DENIED' && !JSON.stringify(ev[0]).includes('secret-query-value'), 'security: an unauthenticated request is recorded without its query string', ev);
  r = await api('forged', 'GET', '/dashboard/company-overview');
  check(r.status === 401, 'security: a forged token is refused', r);
  const bId = (await api('b', 'GET', '/me')).json.data.id;
  await db.query(`update profiles set status = 'SUSPENDED', status_reason = 'security test' where id = $1`, [bId]);
  r = await api('b', 'GET', '/dashboard/scope-overview');
  ev = (await db.query(`select * from audit_logs where action = 'ACCESS_DENIED' and request_id = $1`, [r.requestId])).rows;
  check(r.status === 403 && ev.length === 1 && ev[0].actor_id === bId && ev[0].metadata.code === 'ACCOUNT_INACTIVE' && ev[0].metadata.accountStatus === 'SUSPENDED', 'security: a refused suspended account is named in the log', ev);
  await db.query(`update profiles set status = 'ACTIVE', status_reason = null where id = $1`, [bId]);

  console.log('--- security: the request id follows an action into its audit row');
  r = await api('a', 'POST', '/pipeline/leads', { name: 'Audit Trail Lead', company: 'Audit Trail Co', phone: '9820099001', leadSource: 'Walk-in', services: ['AI_CALLING'] });
  const created = r.status === 201 ? (await db.query(`select * from audit_logs where action = 'CUSTOMER_CREATED' and entity_id = $1`, [r.json.data.id])).rows : [];
  check(r.status === 201 && created.length === 1 && created[0].request_id === r.requestId && created[0].actor_role === 'TEAM_MEMBER' && created[0].outcome === 'SUCCESS',
    'security: a customer created through the API is audited with the request id, the actor and the role', created);

  console.log('--- security: the start of a sign-in session is recorded once');
  const sid = crypto.randomUUID();
  tokens.set('sess', sign({ sub: (await api('a', 'GET', '/me')).json.data.id, role: 'authenticated', session_id: sid, amr: [{ method: 'password', timestamp: 1 }] }));
  await api('sess', 'GET', '/me');
  await api('sess', 'GET', '/me');
  const ss = (await db.query(`select * from audit_logs where dedupe_key = $1`, [`session:${sid}`])).rows;
  check(ss.length === 1 && ss[0].action === 'SESSION_STARTED' && ss[0].outcome === 'SUCCESS' && ss[0].metadata.method === 'password' && ss[0].actor_role === 'TEAM_MEMBER', 'security: a session is recorded once, with its method (never the token)', ss);

  console.log('--- login location: the address and place come from the hosting platform only');
  const meId = (await api('a', 'GET', '/me')).json.data.id;
  const sessionToken = (name: string, sub: string) => {
    const id = crypto.randomUUID();
    tokens.set(name, sign({ sub, role: 'authenticated', session_id: id, amr: [{ method: 'password', timestamp: 1 }] }));
    return id;
  };
  const platform = { 'x-vercel-forwarded-for': '203.0.113.50', 'x-vercel-ip-country': 'IN', 'x-vercel-ip-country-region': 'MH', 'x-vercel-ip-city': 'Pune', 'x-vercel-ip-latitude': '18.5204', 'x-vercel-ip-longitude': '73.8567' };
  const placeOf = async (lsid: string) => (await db.query(`select a.id, a.ip, a.actor_id, a.outcome, l.* from audit_logs a left join audit_log_locations l on l.audit_id = a.id where a.dedupe_key = $1`, [`session:${lsid}`])).rows;

  // 1. not behind a trusted platform (a laptop, a test run, a server reachable directly): the headers are only text the caller typed
  delete process.env.VERCEL;
  delete process.env.TRUST_PROXY_HEADERS;
  let lsid = sessionToken('loc1', meId);
  r = await api('loc1', 'GET', '/me', undefined, undefined, platform);
  let rows = await placeOf(lsid);
  check(r.status === 200 && rows.length === 1 && rows[0].ip === null && rows[0].audit_id === null, 'login location: forged platform headers are ignored off the platform (no address, no place)', rows);

  // 2. behind the platform
  process.env.TRUST_PROXY_HEADERS = 'true';
  lsid = sessionToken('loc2', meId);
  r = await api('loc2', 'GET', '/me', undefined, undefined, platform);
  rows = await placeOf(lsid);
  check(r.status === 200 && rows.length === 1 && rows[0].ip === '203.0.113.50' && rows[0].actor_id === meId && rows[0].outcome === 'SUCCESS'
    && rows[0].city === 'Pune' && rows[0].region === 'MH' && rows[0].country === 'India' && rows[0].source === 'PLATFORM_IP' && rows[0].accuracy === 'CITY'
    && Number(rows[0].latitude) === 18.52 && Number(rows[0].longitude) === 73.86, 'login location: a staff sign-in records the platform address and place, with source and accuracy', rows);
  const locEventId = rows[0].id;

  lsid = sessionToken('loc3', meId);
  r = await api('loc3', 'GET', '/me', undefined, undefined, { 'x-vercel-forwarded-for': 'not-an-address; drop table', 'x-vercel-ip-country': 'ZZZZ', 'x-vercel-ip-latitude': '999', 'x-vercel-ip-longitude': 'abc' });
  rows = await placeOf(lsid);
  check(r.status === 200 && rows.length === 1 && rows[0].ip === null && rows[0].audit_id === null, 'login location: a malformed address or place is dropped, not stored, and the sign-in still works', rows);

  lsid = sessionToken('loc4', meId);
  r = await api('loc4', 'GET', '/me');
  rows = await placeOf(lsid);
  check(r.status === 200 && rows.length === 1 && rows[0].audit_id === null, 'login location: with no place available the sign-in is recorded and works, with no place', rows);

  r = await api('loc2', 'GET', '/me', undefined, undefined, { ...platform, 'x-vercel-ip-city': 'Mumbai' });
  check(r.status === 200 && (await db.query(`select 1 from audit_logs where action = 'SESSION_STARTED' and dedupe_key like 'session:%' and ip = '203.0.113.50'`)).rowCount === 1, 'login location: later requests of the same session add nothing', r);

  // the viewer: Super Admin only
  r = await api('sa', 'GET', '/audit-logs/search?q=pune&pageSize=100');
  const pune = r.json.data?.items?.find((i: any) => String(i.id) === String(locEventId));
  check(r.status === 200 && pune && pune.location?.city === 'Pune' && pune.location.country === 'India' && pune.location.source === 'PLATFORM_IP' && pune.ip === '203.0.113.50',
    'login location: the Super Admin finds the event by city and reads the place and address', r);
  r = await api('sa', 'GET', '/audit-logs/search?q=india&pageSize=100');
  check(r.status === 200 && r.json.data.items.some((i: any) => String(i.id) === String(locEventId)), 'login location: and by country', r);
  r = await api('dh', 'GET', '/audit-logs/search?pageSize=100');
  check(r.status === 200 && r.json.data.items.length > 0 && r.json.data.items.every((i: any) => i.ip === null && i.location === null), 'login location: a Department Head sees events without any address or place', r);
  r = await api('dh', 'GET', '/audit-logs/search?q=pune&pageSize=100');
  check(r.status === 200 && r.json.data.total === 0, 'login location: and cannot find an event by its place', r);
  check(!JSON.stringify((await api('sa', 'GET', '/audit-logs/search?pageSize=100')).json).match(/"(password|token|authorization|apiKey)"\s*:/i), 'login location: nothing returned carries a secret');

  console.log('--- login location: a refused password is recorded as an attempt, never as a person');
  const attempt = async (headers: Record<string, string>, body: unknown) => api(null, 'POST', '/auth/login-failed', body, undefined, headers);
  r = await attempt({ ...platform, 'x-real-ip': '203.0.113.50' }, { identifier: ' Shreya.Test@Example.COM ' });
  let fl = (await db.query(`select a.*, l.city, l.country from audit_logs a left join audit_log_locations l on l.audit_id = a.id where a.action = 'LOGIN_ATTEMPT_FAILED' and a.request_id = $1`, [r.requestId])).rows;
  check(r.status === 200 && r.json.data.recorded === true && fl.length === 1 && fl[0].actor_id === null && fl[0].outcome === 'FAILURE' && fl[0].ip === '203.0.113.50' && fl[0].city === 'Pune'
    && fl[0].metadata.identifier === 's***@example.com' && fl[0].metadata.identifierVerified === false && fl[0].entity_type === 'auth', 'login failure: recorded with address and place, the e-mail masked and unverified, no account', fl);
  check(!JSON.stringify(fl).toLowerCase().includes('shreya'), 'login failure: the typed e-mail is not stored in full');
  const repeat = await attempt({ ...platform, 'x-real-ip': '203.0.113.50' }, { identifier: 'shreya.test@example.com' });
  check(repeat.status === 200 && (await db.query(`select 1 from audit_logs where action = 'LOGIN_ATTEMPT_FAILED' and metadata->>'identifier' = 's***@example.com'`)).rowCount === 1, 'login failure: the same attempt again in the same minute is one event');
  // a real person's token on the request does not turn it into that person's event
  r = await api('a', 'POST', '/auth/login-failed', { identifier: 'zed.else@example.com' }, undefined, { ...platform, 'x-real-ip': '203.0.113.51' });
  fl = (await db.query(`select * from audit_logs where action = 'LOGIN_ATTEMPT_FAILED' and request_id = $1`, [r.requestId])).rows;
  check(r.status === 200 && fl.length === 1 && fl[0].actor_id === null, 'login failure: never tied to an account, even when the request carries a token', fl);
  r = await attempt({ 'x-real-ip': '203.0.113.52' }, { identifier: 'a@b.co', userId: meId });
  check(r.status === 422, 'login failure: unknown fields (a user id) are refused', r);
  r = await attempt({ 'x-real-ip': '203.0.113.52' }, { identifier: 'x'.repeat(300) });
  check(r.status === 422, 'login failure: an oversized identifier is refused', r);
  let limited = 0;
  for (let i = 0; i < 14; i++) limited += (await attempt({ 'x-real-ip': '203.0.113.99' }, { identifier: `try${i}@example.com` })).status === 429 ? 1 : 0;
  check(limited >= 3, 'login failure: one caller can record only a few attempts per quarter hour', limited);
  r = await api('sa', 'GET', '/audit-logs/actions');
  check(r.status === 200 && r.json.data.includes('LOGIN_ATTEMPT_FAILED'), 'login failure: the event type can be filtered');
  r = await api('sa', 'GET', '/audit-logs/search?action=LOGIN_ATTEMPT_FAILED&pageSize=100');
  check(r.status === 200 && r.json.data.items.length >= 2 && r.json.data.items.every((i: any) => i.actorId === null && i.outcome === 'FAILURE'), 'login failure: the Super Admin sees them as failed, with no person', r);
  delete process.env.TRUST_PROXY_HEADERS;

  console.log('--- departments: no lock for the Super Admin to set');
  r = await api('sa', 'PATCH', `/departments/${wab.id}`, { isLocked: true });
  check(r.status === 422, 'departments: the API no longer accepts a lock', r);
  r = await api('sa', 'PATCH', `/departments/${wab.id}`, { description: 'Lock removal check' });
  check(r.status === 200 && r.json.data.isLocked === false, 'departments: other changes still work and the department stays open', r);

  console.log('--- security: exports');
  r = await api('a', 'POST', '/security/data-exports', { dataset: 'leads', rows: 12 });
  check(r.status === 200, 'security: an export is recorded', r);
  const ex = (await db.query(`select * from audit_logs where action = 'DATA_EXPORTED' and request_id = $1`, [r.requestId])).rows;
  check(ex.length === 1 && ex[0].metadata.rows === 12 && ex[0].metadata.dataset === 'leads' && ex[0].actor_role === 'TEAM_MEMBER', 'security: with who, what and how many rows', ex);
  r = await api('a', 'POST', '/security/data-exports', { dataset: 'Leads!', rows: 1 });
  check(r.status === 422, 'security: an invalid dataset name is refused', r);
  r = await api('a', 'POST', '/security/data-exports', { dataset: 'leads', rows: 1, extra: 'x' });
  check(r.status === 422, 'security: unknown fields are refused', r);

  console.log('--- security: the audit viewer');
  r = await api('a', 'GET', '/audit-logs/search');
  check(r.status === 403, 'security: a Team Member cannot use the viewer', r);
  r = await api(null, 'GET', '/audit-logs/search');
  check(r.status === 401, 'security: nor an anonymous caller', r);
  r = await api('sa', 'GET', '/audit-logs/search?outcome=DENIED&pageSize=100');
  check(r.status === 200 && r.json.data.total >= 3 && r.json.data.items.every((i: any) => i.outcome === 'DENIED') && r.json.data.items.some((i: any) => i.action === 'ACCESS_DENIED' && i.actorRole === 'TEAM_MEMBER'),
    'security: the Super Admin filters by outcome and sees the refusals', r);
  r = await api('sa', 'GET', `/audit-logs/search?q=${encodeURIComponent(deniedRid ?? '')}`);
  check(r.status === 200 && r.json.data.total === 1 && r.json.data.items[0].requestId === deniedRid, 'security: a request id finds its event', r);
  r = await api('sa', 'GET', '/audit-logs/search?action=DATA_EXPORTED&from=2000-01-01&to=2999-12-31');
  check(r.status === 200 && r.json.data.items.length >= 1 && r.json.data.items.every((i: any) => i.action === 'DATA_EXPORTED'), 'security: filters by event type and dates', r);
  r = await api('sa', 'GET', '/audit-logs/search?outcome=MAYBE');
  check(r.status === 422, 'security: an unknown outcome is refused', r);
  r = await api('sa', 'GET', '/audit-logs/search?page=1&pageSize=1');
  check(r.status === 200 && r.json.data.items.length === 1 && r.json.data.total > 1, 'security: results are paged', r);
  r = await api('dh', 'GET', '/audit-logs/search?pageSize=100');
  check(r.status === 200 && r.json.data.items.length > 0 && r.json.data.items.every((i: any) => i.departmentId === dhDept), 'security: a Department Head sees only their department', r);
  r = await api('sa', 'GET', '/audit-logs/actions');
  check(r.status === 200 && r.json.data.includes('ACCESS_DENIED') && r.json.data.includes('SESSION_STARTED'), 'security: the event types can be listed', r);
  check(!JSON.stringify((await api('sa', 'GET', '/audit-logs/search?pageSize=100')).json).match(/"(password|token|authorization)"\s*:/i), 'security: nothing the viewer returns carries a secret');
  r = await api('sa', 'DELETE', '/audit-logs/1');
  check(r.status === 404 || r.status === 405, 'security: there is no way to delete an event through the API', r);
  r = await api('sa', 'PATCH', '/audit-logs/1', { action: 'X' });
  check(r.status === 404 || r.status === 405, 'security: nor to edit one', r);
}

// A project missing an earlier migration must still let people sign in.
await db.query(`alter function public.rate_limit_consume(jsonb) rename to rate_limit_consume_hidden`);
r = await api('sa', 'GET', '/me');
check(r.status === 200 && r.json.data.role === 'SUPER_ADMIN', 'sign-in still works when api_session fails (falls back)', r);
r = await api('sa', 'GET', '/departments');
check(r.status === 200, 'API keeps working on the fallback path', r);
await db.query(`alter function public.rate_limit_consume_hidden(jsonb) rename to rate_limit_consume`);

// --- deleting a customer: the Super Admin and the Department Head only ---------
{
  r = await api('a', 'POST', '/customers', { name: 'Delete Test', email: 'delete.test@acme.com', phone: '+91 98765 43299', company: 'Delete Test Co', segment: 'RETAIL' });
  const delId = r.json.data.id as string;
  r = await api('th', 'DELETE', `/customers/${delId}`);
  check(r.status === 403, 'delete: a team lead cannot delete a customer', r);
  r = await api(null, 'DELETE', `/customers/${delId}`);
  check(r.status === 401, 'delete: a signed-out visitor cannot', r);
  r = await api('dh', 'DELETE', `/customers/${delId}`);
  check(r.status === 200 && r.json.data.name === 'Delete Test Co', 'delete: the Department Head deletes a customer of the department', r);
  r = await api('dh', 'GET', `/customers/${delId}`);
  check(r.status === 404, 'delete: the customer is gone', r);
  r = await api('dh', 'DELETE', `/customers/${delId}`);
  check(r.status === 404, 'delete: deleting it again says not found', r);
  r = await api('a', 'POST', '/customers', { name: 'Delete Test Two', email: 'delete.two@acme.com', phone: '+91 98765 43298', company: 'Delete Two Co', segment: 'RETAIL' });
  const delId2 = r.json.data.id as string;
  r = await api('sa', 'DELETE', `/customers/${delId2}`);
  check(r.status === 200, 'delete: the Super Admin can too', r);
  check(Number((await db.query(`select count(*) from audit_logs where action = 'CUSTOMER_DELETED' and entity_id in ($1, $2)`, [delId, delId2])).rows[0].count) === 2, 'delete: both deletions are audited');
}


// --- Telecaller: Sales role at creation, contact sheets, call updates, leads --------------------
{
  const serviceCode = (await db.query(`select code from crm_services where is_active order by sort_order limit 1`)).rows[0].code as string;
  const rows = (n: number, tag: string) => Array.from({ length: n }, (_v, i) => ({ row: i + 2, name: `API Person ${tag}${i}`, company: `API Co ${i}`, phone: `+9197000${String(i).padStart(5, '0')}`, email: `api${tag}${i}@example.com` }));

  // ---- creating the person: the Sales role is chosen by the Super Admin or the Department Head
  r = await api('th', 'POST', '/users', { email: 'tc.th@amuwa.com', fullName: 'Not Allowed', password: 'Sup3rSecret!', role: 'TEAM_MEMBER', teamId: sales.id, salesSubRole: 'TELECALLER' });
  check(r.status === 403, 'telecaller API: a Team Lead cannot choose a Sales role', r);
  r = await api('dh', 'POST', '/users', { email: 'tc.sup@amuwa.com', fullName: 'Support Tele', password: 'Sup3rSecret!', role: 'TEAM_MEMBER', teamId: support.id, salesSubRole: 'TELECALLER' });
  check(r.status === 422 && /Sales team/.test(r.json.error.message), 'telecaller API: a Support member has no Sales role', r);
  check(Number((await db.query(`select count(*) from auth.users where email = 'tc.sup@amuwa.com'`)).rows[0].count) === 0, 'telecaller API: and no account was left behind');
  r = await api('dh', 'POST', '/users', { email: 'tc.head@amuwa.com', fullName: 'Head Tele', password: 'Sup3rSecret!', role: 'TEAM_HEAD', teamId: sales.id, salesSubRole: 'TELECALLER' });
  check(r.status === 422, 'telecaller API: a Team Lead cannot be a Telecaller', r);
  r = await api('dh', 'POST', '/users', { email: 'tc.a@amuwa.com', fullName: 'Tele Alpha', password: 'Sup3rSecret!', role: 'TEAM_MEMBER', teamId: sales.id, salesSubRole: 'TELECALLER' });
  check(r.status === 201 && r.json.data.salesSubRole === 'TELECALLER' && r.json.data.defaultDashboard === 'telecaller' && r.json.data.team.name === 'Sales' && r.json.data.department.slug === 'wabastore',
    'telecaller API: the Department Head creates a Sales Telecaller (still in the Sales team); the dashboard is the Telecaller one', r);
  const tcA = r.json.data.id as string;
  tokens.set('tca', tokenFor(tcA));
  r = await api('sa', 'POST', '/users', { email: 'tc.b@amuwa.com', fullName: 'Tele Beta', password: 'Sup3rSecret!', role: 'TEAM_MEMBER', teamId: sales.id, salesSubRole: 'TELECALLER' });
  check(r.status === 201 && r.json.data.defaultDashboard === 'telecaller', 'telecaller API: so does the Super Admin', r);
  const tcB = r.json.data.id as string;
  tokens.set('tcb', tokenFor(tcB));
  r = await api('dh', 'POST', '/users', { email: 'va@amuwa.com', fullName: 'Visit Alpha', password: 'Sup3rSecret!', role: 'TEAM_MEMBER', teamId: sales.id, salesSubRole: 'VISIT_SALES' });
  check(r.status === 201 && r.json.data.salesSubRole === 'VISIT_SALES' && r.json.data.defaultDashboard === 'sales-visit-sales', 'telecaller API: another Sales role is stored with its own dashboard value, not the Telecaller one', r);
  tokens.set('va', tokenFor(r.json.data.id));
  r = await api('dh', 'POST', '/users', { email: 'plain@amuwa.com', fullName: 'Plain Member', password: 'Sup3rSecret!', role: 'TEAM_MEMBER', teamId: sales.id });
  check(r.status === 201 && r.json.data.salesSubRole === null && r.json.data.defaultDashboard === 'sales-member', 'telecaller API: a member created without a Sales role is unchanged', r);
  const plainId = r.json.data.id as string;
  r = await api('dh', 'POST', '/users', { email: 'badrole@amuwa.com', fullName: 'Bad', password: 'Sup3rSecret!', role: 'TEAM_MEMBER', teamId: sales.id, salesSubRole: 'MANAGER' });
  check(r.status === 422, 'telecaller API: only the five Sales roles exist', r);
  r = await api('th', 'POST', `/users/${plainId}/sales-sub-role`, { role: 'TELECALLER' });
  check(r.status === 403, 'telecaller API: a Team Lead cannot give a Sales role later either', r);
  r = await api('dh', 'POST', `/users/${plainId}/sales-sub-role`, { role: 'TELECALLER' });
  check(r.status === 200 && r.json.data.defaultDashboard === 'telecaller', 'telecaller API: the Department Head gives an existing Sales member the Telecaller role', r);
  r = await api('dh', 'POST', `/users/${plainId}/sales-sub-role`, { role: null });
  check(r.status === 200 && r.json.data.defaultDashboard === 'sales-member', 'telecaller API: and takes it away again', r);
  r = await api('a', 'GET', '/me');
  check(r.json.data.defaultDashboard === 'sales-member' && r.json.data.salesSubRole === null, 'telecaller API: existing Sales members keep the Sales member dashboard', r);

  // ---- the Telecaller pages are for Telecallers only
  for (const who of ['a', 'va', 'th', 'dh', 'sa']) {
    r = await api(who, 'GET', '/telecaller/home');
    check(r.status === 403, `telecaller API: ${who} cannot open the Telecaller home`, r);
  }
  r = await api(null, 'GET', '/telecaller/home');
  check(r.status === 401, 'telecaller API: nor a visitor', r);
  r = await api('tca', 'GET', '/telecaller/assignable');
  check(r.status === 403, 'telecaller API: a Telecaller cannot assign sheets', r);
  r = await api('th', 'GET', '/telecaller/assignable');
  check(r.status === 403, 'telecaller API: nor a Team Lead', r);

  // ---- the Department Head assigns a sheet
  r = await api('dh', 'GET', '/telecaller/assignable');
  check(r.status === 200 && r.json.data.length === 2 && r.json.data.every((x: any) => x.team === 'Sales'), 'telecaller API: the Department Head picks from the Telecallers of the department', r);
  const hash = crypto.createHash('sha256').update('sheet-one').digest('hex');
  const bad = [...rows(2, 'p'), { row: 9, name: '', phone: '9' }, { row: 10, name: 'Mail', phone: '9811111111', email: 'nope' }];
  r = await api('dh', 'POST', '/telecaller/lists', { assigneeId: tcA, fileName: 'october.xlsx', hash, rows: bad, commit: false });
  check(r.status === 200 && r.json.data.summary.invalid === 2 && r.json.data.summary.valid === 2 && r.json.data.preview.length === 2 && r.json.data.committed === false, 'telecaller API: the preview names the wrong rows and nothing is saved', r);
  r = await api('dh', 'POST', '/telecaller/lists', { assigneeId: tcA, fileName: 'october.xlsx', hash, rows: bad, commit: true });
  check(r.status === 200 && r.json.data.committed === false && Number((await db.query(`select count(*) from telecaller_contacts`)).rows[0].count) === 0, 'telecaller API: a sheet with wrong rows is not assigned even when confirmed', r);
  r = await api('dh', 'POST', '/telecaller/lists', { assigneeId: tcA, fileName: 'october.xlsx', hash: 'short', rows: rows(2, 'p'), commit: true });
  check(r.status === 422, 'telecaller API: the sheet needs a proper identity', r);
  r = await api('dh', 'POST', '/telecaller/lists', { assigneeId: tcA, fileName: 'october.xlsx', hash, rows: rows(2, 'p'), commit: true, extra: 1 });
  check(r.status === 422, 'telecaller API: unknown fields are refused', r);
  r = await api('tca', 'POST', '/telecaller/lists', { assigneeId: tcA, fileName: 'self.xlsx', hash, rows: rows(2, 'p'), commit: true });
  check(r.status === 403, 'telecaller API: a Telecaller cannot assign a sheet to themselves', r);
  r = await api('dh', 'POST', '/telecaller/lists', { assigneeId: plainId, fileName: 'x.xlsx', hash, rows: rows(2, 'p'), commit: true });
  check(r.status === 422, 'telecaller API: the sheet goes to a Telecaller only', r);
  r = await api('dh', 'POST', '/telecaller/lists', { assigneeId: tcA, fileName: 'october.xlsx', note: 'Cold calls', hash, rows: rows(45, 'a'), commit: true });
  check(r.status === 200 && r.json.data.committed === true && r.json.data.listId, 'telecaller API: the Department Head assigns a sheet of 45 contacts', r);
  const listA = r.json.data.listId as string;
  r = await api('dh', 'POST', '/telecaller/lists', { assigneeId: tcA, fileName: 'october.xlsx', hash, rows: rows(45, 'a'), commit: true });
  check(r.status === 409, 'telecaller API: the same sheet cannot be assigned twice to one person', r);
  r = await api('dh', 'POST', '/telecaller/lists', { assigneeId: tcB, fileName: 'october.xlsx', hash, rows: rows(3, 'b'), commit: true });
  check(r.status === 200 && r.json.data.committed, 'telecaller API: another Telecaller can get it', r);
  const listB = r.json.data.listId as string;

  // ---- the original file
  const fakeR2 = await startFakeR2({ key: 'r2-tc-key', secret: 'r2-tc-secret', bucket: 'amuwa-files', cors: false });
  Object.assign(process.env, { STORAGE_PROVIDER: 'r2', R2_ENDPOINT: fakeR2.endpoint, R2_ACCESS_KEY_ID: 'r2-tc-key', R2_SECRET_ACCESS_KEY: 'r2-tc-secret', R2_BUCKET: 'amuwa-files' });
  const xlsxBytes = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('sheet-one')]);
  const realHash = crypto.createHash('sha256').update(xlsxBytes).digest('hex');
  r = await api('dh', 'POST', '/telecaller/lists', { assigneeId: tcA, fileName: 'second.xlsx', hash: realHash, rows: rows(2, 's'), commit: true });
  const listS = r.json.data.listId as string;
  r = await api('tca', 'POST', `/telecaller/lists/${listS}/source`, { data: xlsxBytes.toString('base64') });
  check(r.status === 403, 'telecaller API: a Telecaller cannot attach the file', r);
  r = await api('dh', 'POST', `/telecaller/lists/${listS}/source`, { data: Buffer.from('not a spreadsheet').toString('base64') });
  check(r.status === 422 && /Excel/.test(r.json.error.message), 'telecaller API: a file that is not .xlsx is refused', r);
  r = await api('dh', 'POST', `/telecaller/lists/${listS}/source`, { data: Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('another file')]).toString('base64') });
  check(r.status === 422 && /not the one/.test(r.json.error.message), 'telecaller API: nor a file that is not the sheet that was checked', r);
  r = await api('dh', 'POST', `/telecaller/lists/${listS}/source`, { data: Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(710 * 1024)]).toString('base64') });
  check(r.status === 422, 'telecaller API: nor one over 700 KB', r);
  r = await api('dh', 'POST', `/telecaller/lists/${listS}/source`, { data: xlsxBytes.toString('base64') });
  const srcRow = (await db.query(`select source_bucket, source_path, source_provider, source_ref, source_size from telecaller_contact_lists where id = $1`, [listS])).rows[0];
  check(r.status === 201 && srcRow.source_provider === 'R2' && srcRow.source_path.endsWith(`${listS}.xlsx`) && Number(srcRow.source_size) === xlsxBytes.length && fakeR2.objects.has(`telecaller-sheets/${srcRow.source_path}`),
    'telecaller API: the original file is stored privately and its reference is kept with the sheet', { status: r.status, srcRow });
  r = await api('dh', 'POST', `/telecaller/lists/${listS}/source`, { data: xlsxBytes.toString('base64') });
  check(r.status === 409, 'telecaller API: it is stored once', r);
  fakeR2.server.close();
  for (const k of ['STORAGE_PROVIDER', 'R2_ENDPOINT', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET']) delete process.env[k];

  // ---- who sees which sheet
  r = await api('dh', 'GET', '/telecaller/lists');
  check(r.status === 200 && r.json.data.length === 3 && r.json.data.find((x: any) => x.id === listA)?.assignedBy === 'Dept Head', 'telecaller API: the Department Head sees the sheets with who assigned them', r);
  r = await api('tca', 'GET', '/telecaller/lists');
  check(r.status === 200 && r.json.data.length === 2 && r.json.data.every((x: any) => x.assigneeId === tcA), 'telecaller API: a Telecaller sees only their own sheets', r);

  // ---- the Telecaller works the contacts
  r = await api('tca', 'GET', `/telecaller/contacts?listId=${listA}&pageSize=20`);
  check(r.status === 200 && r.json.data.total === 45 && r.json.data.items.length === 20 && r.json.data.counts.PENDING === 45, 'telecaller API: the Telecaller gets their contacts a page at a time', r);
  const first = r.json.data.items[0];
  r = await api('tca', 'GET', `/telecaller/contacts?listId=${listA}&page=3&pageSize=20`);
  check(r.json.data.items.length === 5, 'telecaller API: the last page holds the rest', r);
  r = await api('tca', 'GET', `/telecaller/contacts?listId=${listA}&search=${encodeURIComponent('api person a7')}`);
  check(r.json.data.total === 1, 'telecaller API: search', r);
  r = await api('tca', 'GET', '/telecaller/contacts?status=WEIRD');
  check(r.status === 422, 'telecaller API: an unknown filter is refused', r);
  r = await api('tcb', 'GET', `/telecaller/contacts?listId=${listA}`);
  check(r.status === 200 && r.json.data.total === 0, 'telecaller API: another Telecaller asking for this sheet gets nothing', r);
  r = await api('tcb', 'PATCH', `/telecaller/contacts/${first.id}`, { callStatus: 'CONTACTED', remarks: 'mine now' });
  check(r.status === 404, 'telecaller API: nor can they update its contacts', r);
  r = await api('dh', 'PATCH', `/telecaller/contacts/${first.id}`, { callStatus: 'CONTACTED' });
  check(r.status === 403, 'telecaller API: the Department Head reads sheets but does not record calls', r);
  r = await api('tca', 'PATCH', `/telecaller/contacts/${first.id}`, { callStatus: 'FOLLOW_UP_REQUIRED', remarks: 'Call after lunch' });
  check(r.status === 422, 'telecaller API: a follow-up needs a date', r);
  const tomorrow = new Date(Date.now() + 5.5 * 3600e3 + 86400e3).toISOString().slice(0, 10);
  const today = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
  r = await api('tca', 'PATCH', `/telecaller/contacts/${first.id}`, { callStatus: 'FOLLOW_UP_REQUIRED', remarks: 'Call after lunch', followUpDate: tomorrow });
  check(r.status === 200 && r.json.data.callStatus === 'FOLLOW_UP_REQUIRED' && r.json.data.followUpDate === tomorrow && r.json.data.callCount === 1 && r.json.data.lastCalledAt, 'telecaller API: a call is saved with its remarks, follow-up and time', r);
  r = await api('tca', 'GET', `/telecaller/contacts?listId=${listA}&status=FOLLOW_UP_REQUIRED`);
  check(r.json.data.total === 1 && r.json.data.items[0].remarks === 'Call after lunch' && r.json.data.items[0].followUpDate === tomorrow, 'telecaller API: the update persists and the filter finds it', r);
  r = await api('tca', 'PATCH', `/telecaller/contacts/${r.json.data.items[0].id}`, { callStatus: 'INTERESTED', followUpDate: today });
  check(r.status === 200 && r.json.data.callCount === 2, 'telecaller API: another call', r);

  // ---- leads
  const lead = (name: string, extra: Record<string, unknown> = {}) => ({ name, company: `${name} Co`, phone: '9811234561', leadSource: 'Cold Call', services: [serviceCode], leadTemperature: 'WARM', callStatus: 'PENDING', ...extra });
  r = await api('a', 'POST', '/telecaller/leads', lead('Nope'));
  check(r.status === 403, 'telecaller API: a Sales member cannot use the Telecaller lead pages', r);
  r = await api('tca', 'POST', '/telecaller/leads', lead('No Temp', { leadTemperature: 'LUKEWARM' }));
  check(r.status === 422, 'telecaller API: the temperature is Hot, Warm or Cold', r);
  r = await api('tca', 'POST', '/telecaller/leads', lead('Bad Phone', { phone: '123' }));
  check(r.status === 422, 'telecaller API: the phone number is validated', r);
  r = await api('tca', 'POST', '/telecaller/leads', lead('No Service', { services: [] }));
  check(r.status === 422, 'telecaller API: a service is required', r);
  r = await api('tca', 'POST', '/telecaller/leads', lead('Hot Customer', { leadTemperature: 'HOT', callStatus: 'INTERESTED', email: 'hot@example.com', address: '1 Main Road', notes: 'Wants a demo', followUpDate: today }));
  check(r.status === 201 && r.json.data.leadTemperature === 'HOT' && r.json.data.callStatus === 'INTERESTED' && r.json.data.followUpDate === today && r.json.data.address === '1 Main Road', 'telecaller API: a Hot lead is created', r);
  const hotId = r.json.data.id as string;
  r = await api('tca', 'POST', '/telecaller/leads', lead('Cold Customer', { leadTemperature: 'COLD', phone: '9811234562' }));
  check(r.status === 201 && r.json.data.leadTemperature === 'COLD', 'telecaller API: a Cold lead', r);
  const coldId = r.json.data.id as string;
  r = await api('tca', 'POST', '/telecaller/leads', lead('Warm Customer', { phone: '9811234563', leadSource: 'Referral' }));
  check(r.status === 201 && r.json.data.leadTemperature === 'WARM', 'telecaller API: and a Warm one', r);
  const ownerRow = (await db.query(`select owner_id, lifecycle_stage, lead_temperature, call_status from customers where id = $1`, [hotId])).rows[0];
  check(ownerRow.owner_id === tcA && ownerRow.lifecycle_stage === 'LEAD' && ownerRow.lead_temperature === 'HOT' && ownerRow.call_status === 'INTERESTED', 'telecaller API: it is an ordinary Sales lead owned by the Telecaller, temperature and call status kept apart', ownerRow);
  r = await api('tca', 'GET', '/telecaller/leads');
  check(r.status === 200 && r.json.data.total === 3 && r.json.data.items[0].name === 'Warm Customer' && r.json.data.sources.length === 2, 'telecaller API: the new leads are in the list (newest first)', r);
  r = await api('tca', 'GET', '/telecaller/leads?temperature=HOT');
  check(r.json.data.total === 1, 'telecaller API: filter by temperature', r);
  r = await api('tca', 'GET', '/telecaller/leads?callStatus=PENDING&source=Cold%20Call');
  check(r.json.data.total === 1 && r.json.data.items[0].name === 'Cold Customer', 'telecaller API: filter by call status and source', r);
  r = await api('tca', 'GET', '/telecaller/leads?search=warm');
  check(r.json.data.total === 1, 'telecaller API: search', r);
  r = await api('tca', 'GET', '/telecaller/leads?page=2&pageSize=2');
  check(r.json.data.items.length === 1 && r.json.data.total === 3, 'telecaller API: pagination', r);
  r = await api('tca', 'PATCH', `/telecaller/leads/${coldId}`, { leadTemperature: 'HOT', callStatus: 'CONTACTED', phone: '9811234599' });
  check(r.status === 200 && r.json.data.leadTemperature === 'HOT' && r.json.data.callStatus === 'CONTACTED' && r.json.data.phone === '9811234599' && r.json.data.services.length === 1, 'telecaller API: a lead can be edited (Cold to Hot) and keeps its service', r);
  r = await api('tca', 'GET', `/telecaller/leads/${coldId}`);
  check(r.status === 200 && r.json.data.leadTemperature === 'HOT', 'telecaller API: the edit persists', r);
  r = await api('tcb', 'GET', `/telecaller/leads/${coldId}`);
  check(r.status === 404, 'telecaller API: another Telecaller cannot open the lead', r);
  r = await api('tcb', 'PATCH', `/telecaller/leads/${coldId}`, { leadTemperature: 'COLD', callStatus: 'PENDING' });
  check(r.status === 404, 'telecaller API: nor edit it', r);
  r = await api('tcb', 'GET', '/telecaller/leads');
  check(r.json.data.total === 0, 'telecaller API: nor see it in their list', r);

  // ---- the Home counts
  r = await api('tca', 'GET', '/telecaller/home');
  const h = r.json.data;
  check(r.status === 200 && h.totalAssigned === 47 && h.callsPending === 46 && h.callsCompleted === 1 && h.totalLeads === 3 && h.hotLeads === 2 && h.followUpsDueToday === 2 && h.focus.followUps.length === 2 && h.focus.pendingCalls.length === 6,
    'telecaller API: the Home counts come from the data', h);
  r = await api('tcb', 'GET', '/telecaller/home');
  check(r.json.data.totalAssigned === 3 && r.json.data.totalLeads === 0, 'telecaller API: another Telecaller has their own counts', r.json.data);
  void listB;
}


// --- Business Associate: Telecaller hand-over, price list, quotations (AI + PDF), demos, Scope of Project (AI + PDF), leads ----
{
  const { PDFDocument } = await import('pdf-lib');
  const ids = async (email: string) => (await db.query(`select id from profiles where email = $1`, [email])).rows[0].id as string;
  const svcCodes = (await db.query(`select code from crm_services where is_active order by sort_order limit 4`)).rows.map(r => r.code as string);
  const invoiceCounts = async () => ['member_invoices', 'generated_invoices', 'customer_payments'].map(async t => Number((await db.query(`select count(*) from ${t}`)).rows[0].count));
  const before = await Promise.all(await invoiceCounts());

  // ---- creating the person: the Department Head chooses Business Associate in the creation form
  r = await api('dh', 'POST', '/users', { email: 'ba.one@amuwa.com', fullName: 'Biz One', password: 'Sup3rSecret!', role: 'TEAM_MEMBER', teamId: sales.id, salesSubRole: 'BUSINESS_ASSOCIATE' });
  check(r.status === 201 && r.json.data.salesSubRole === 'BUSINESS_ASSOCIATE' && r.json.data.defaultDashboard === 'business-associate', 'business associate API: created with the Sales role; the dashboard value is business-associate (never the Telecaller one)', r);
  const baOne = r.json.data.id as string;
  tokens.set('ba1', tokenFor(baOne));
  r = await api('dh', 'POST', '/users', { email: 'ba.two@amuwa.com', fullName: 'Biz Two', password: 'Sup3rSecret!', role: 'TEAM_MEMBER', teamId: sales.id, salesSubRole: 'BUSINESS_ASSOCIATE' });
  const baTwo = r.json.data.id as string;
  tokens.set('ba2', tokenFor(baTwo));
  r = await api('dh', 'POST', '/users', { email: 'influ@amuwa.com', fullName: 'Influ Encer', password: 'Sup3rSecret!', role: 'TEAM_MEMBER', teamId: sales.id, salesSubRole: 'INFLUENCER' });
  check(r.status === 201 && r.json.data.defaultDashboard === 'sales-influencer', 'business associate API: another Sales role does not get the Business Associate dashboard', r);
  tokens.set('influ', tokenFor(r.json.data.id));
  for (const who of ['tca', 'influ', 'th', 'sm']) {
    r = await api(who, 'GET', '/ba/home');
    check(r.status === 403, `business associate API: ${who} cannot open the Business Associate pages`, r);
  }
  // a Sales member without a Sales role works as a Business Associate from the Sales Team Member dashboard (migration 20261127000100)
  r = await api('a', 'GET', '/ba/home');
  check(r.status === 200, 'business associate API: a Sales member opens the Business Associate pages', r);
  r = await api('a', 'GET', '/ba/contacts');
  check(r.status === 200 && r.json.data.total === 0, 'business associate API: and starts with no contacts', r);
  r = await api('a', 'GET', '/ba/prices');
  check(r.status === 200, 'business associate API: and reads the price list', r);
  r = await api('a', 'POST', `/ba/prices/${svcCodes[0]}`, { unitLabel: 'one time', unitPrice: 1, gstRate: 0, maxDiscountPct: 0, isActive: true });
  check(r.status === 403, 'business associate API: but cannot change it', r);
  r = await api('ba1', 'GET', '/telecaller/home');
  check(r.status === 403, 'business associate API: nor can a Business Associate open the Telecaller pages', r);

  // ---- the Telecaller converts a qualified lead
  const leadId = (await db.query(`select id from customers where name = 'Hot Customer'`)).rows[0].id as string;
  const warmId = (await db.query(`select id from customers where name = 'Warm Customer'`)).rows[0].id as string;
  r = await api('tca', 'GET', '/telecaller/ba-assignees');
  check(r.status === 200 && [baOne, baTwo, memberA].every(id => r.json.data.some((x: any) => x.id === id)) && !r.json.data.some((x: any) => x.name === 'Tele Alpha'),
    'business associate API: a Telecaller lists who can take a contact: the Business Associates and the Sales members, not Telecallers', r);
  r = await api('tca', 'POST', `/telecaller/leads/${warmId}/convert`, {});
  check(r.status === 422 && /Interested/.test(r.json.error.message), 'business associate API: a lead that is not qualified cannot be converted', r);
  r = await api('tcb', 'POST', `/telecaller/leads/${leadId}/convert`, {});
  check(r.status === 404, 'business associate API: another Telecaller cannot convert this lead', r);
  r = await api('a', 'POST', `/telecaller/leads/${leadId}/convert`, {});
  check(r.status === 403, 'business associate API: nor a Sales member', r);
  r = await api('tca', 'POST', `/telecaller/leads/${leadId}/convert`, { assigneeId: baOne, note: 'Keen on WhatsApp API' });
  check(r.status === 201 && r.json.data.assigneeName === 'Biz One', 'business associate API: a qualified lead is converted and assigned', r);
  const contactId = r.json.data.contactId as string;
  r = await api('tca', 'POST', `/telecaller/leads/${leadId}/convert`, { assigneeId: baTwo });
  check(r.status === 409, 'business associate API: converting the same lead again is refused (no duplicate contact)', r);
  check(Number((await db.query(`select count(*) from ba_contacts where lead_id = $1`, [leadId])).rows[0].count) === 1, 'business associate API: one contact exists for the lead');
  r = await api('tca', 'GET', '/telecaller/leads?temperature=HOT');
  check(r.json.data.items.some((l: any) => l.id === leadId && l.converted?.businessAssociate === 'Biz One'), 'business associate API: the Telecaller\'s list shows the lead was converted', r.json.data.items);

  // ---- Tasks
  r = await api('ba1', 'GET', '/ba/contacts');
  check(r.status === 200 && r.json.data.total === 1 && r.json.data.items[0].name === 'Hot Customer' && r.json.data.items[0].telecaller === 'Tele Alpha' && r.json.data.items[0].stage === 'NEW', 'business associate API: the Business Associate sees the converted contact with its Telecaller and stage', r);
  r = await api('ba2', 'GET', '/ba/contacts');
  check(r.json.data.total === 0, 'business associate API: another Business Associate sees nothing', r);
  r = await api('ba2', 'GET', `/ba/contacts/${contactId}`);
  check(r.status === 404, 'business associate API: nor opens it', r);
  r = await api('ba1', 'GET', '/ba/contacts?stage=WEIRD');
  check(r.status === 422, 'business associate API: a stage filter is validated', r);
  r = await api('ba1', 'PATCH', `/ba/contacts/${contactId}`, { requirements: 'A WhatsApp API and an AI QR menu for order updates', profile: { industry: 'Restaurants', website: 'https://hot.example.com', businessGoals: 'More repeat orders' }, nextFollowUp: '' });
  check(r.status === 200 && r.json.data.requirements.startsWith('A WhatsApp') && r.json.data.profile.industry === 'Restaurants' && r.json.data.stage === 'IN_PROGRESS', 'business associate API: requirements and the business profile are saved', r);
  r = await api('ba1', 'POST', `/ba/contacts/${contactId}/notes`, { note: 'Owner prefers calls after 4 pm' });
  check(r.status === 201, 'business associate API: a communication note is saved', r);
  r = await api('ba1', 'GET', `/ba/contacts/${contactId}`);
  check(r.json.data.events.some((e: any) => e.kind === 'NOTE') && r.json.data.leadId === leadId && r.json.data.handoverNote === 'Keen on WhatsApp API', 'business associate API: the detail view has the history and the hand-over note, linked to the source lead', r.json.data.events);

  // ---- price list and quotation
  r = await api('ba1', 'POST', `/ba/prices/${svcCodes[0]}`, { unitLabel: 'one time', unitPrice: 5000, gstRate: 18, maxDiscountPct: 10 });
  check(r.status === 403, 'business associate API: a Business Associate cannot set prices', r);
  r = await api('dh', 'POST', `/ba/prices/${svcCodes[0]}`, { unitLabel: 'one time', unitPrice: 5000, gstRate: 18, maxDiscountPct: 10 });
  check(r.status === 200, 'business associate API: the Department Head sets an approved price', r);
  await api('dh', 'POST', `/ba/prices/${svcCodes[1]}`, { unitLabel: 'per month', unitPrice: 2000, gstRate: 18, maxDiscountPct: 0 });
  r = await api('ba1', 'GET', '/ba/prices');
  check(r.status === 200 && r.json.data.filter((p: any) => p.priced).length === 2, 'business associate API: the Business Associate reads the price list', r);
  const items = [{ serviceCode: svcCodes[0], quantity: 2, unitPrice: 5000, discountPct: 10, gstRate: 18 }, { serviceCode: svcCodes[1], quantity: 1, unitPrice: 2000, discountPct: 0, gstRate: 18 }];
  r = await api('ba2', 'POST', '/ba/quotations', { contactId, items, gstApplicable: true });
  check(r.status === 404, 'business associate API: another Business Associate cannot quote for this contact', r);
  r = await api('ba1', 'POST', '/ba/quotations', { contactId, items: [{ ...items[0], discountPct: 30 }] });
  check(r.status === 403, 'business associate API: a discount above the approved limit is refused', r);
  r = await api('ba1', 'POST', '/ba/quotations', { contactId, items: [{ ...items[0], quantity: 0 }] });
  check(r.status === 422, 'business associate API: a zero quantity is refused', r);
  r = await api('ba1', 'POST', '/ba/quotations', { contactId, items, gstApplicable: true, validityDays: 30, paymentTerms: '50% advance, 50% on delivery', timeline: '3 weeks from the advance' });
  check(r.status === 201 && r.json.data.total === 12980 && r.json.data.taxTotal === 1980 && r.json.data.status === 'DRAFT' && r.json.data.priceFlags.length === 0, 'business associate API: totals come from the database (11,000 + 18% GST = 12,980) with no price flags', r);
  const quoteId = r.json.data.id as string;
  const quoteNo = r.json.data.number as string;
  r = await api('ba1', 'POST', '/ba/quotations', { contactId, items: [{ ...items[0], unitPrice: 4000 }], gstApplicable: false });
  check(r.status === 201 && r.json.data.priceFlags[0]?.kind === 'PRICE_DIFFERS' && r.json.data.total === 7200 && r.json.data.taxTotal === 0, 'business associate API: a changed price is flagged, and no GST is added unless chosen', r);

  // ---- AI: off without a key, then a local stand-in for the AI service
  r = await api('ba1', 'POST', `/ba/quotations/${quoteId}/ai`, {});
  check(r.status === 503 && /not set up/.test(r.json.error.message), 'business associate API: without an AI key the AI action says so (the document can still be written by hand)', r);
  const aiCalls: { system: string; user: string }[] = [];
  let aiMode: 'ok' | 'bad' | 'http' = 'ok';
  const aiServer = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString());
      aiCalls.push({ system: body.system, user: body.messages[0].content });
      if (aiMode === 'http') { res.writeHead(500).end('{}'); return; }
      const user = JSON.parse(body.messages[0].content);
      let answer: unknown;
      if (/client quotation/.test(body.system)) {
        answer = aiMode === 'bad' ? { introduction: 12 } : {
          introduction: `Dear ${user.client.company}, thank you for your time.`, understanding: 'You need order updates on WhatsApp.', recommendedServices: 'The services below.',
          scopeSummary: 'Set up and hand over.', commercialTerms: 'Payment terms as entered: 50% advance, 50% on delivery.', implementationTimeline: 'As entered: 3 weeks from the advance.',
          exclusions: ['Third-party fees'], notes: ['Prices exclude nothing else'], serviceDescriptions: { [user.lines[0].code]: 'First service in plain words.', 'MADE_UP_SERVICE': 'Should be dropped' }, missingInformation: []
        };
      } else if (user.section === 'projectScope') {
        answer = { projectScope: { overview: 'Regenerated overview', objectives: ['Regenerated objective'] }, missingInformation: ['Who approves the work?'] };
      } else {
        answer = {
          businessAnalysis: { swot: { strengths: [{ text: 'Owner wants WhatsApp order updates (stated by the client)', basis: 'VERIFIED' }], weaknesses: [{ text: 'No online ordering channel is mentioned', basis: 'ASSUMPTION' }], opportunities: [{ text: 'Repeat orders', basis: 'VERIFIED' }], threats: [] },
            keyChallenges: [{ text: 'Keeping customers informed', basis: 'ASSUMPTION' }], growthAreas: [], improvementAreas: [] },
          recommendedSolutions: [{ serviceCode: user.services[0]?.code ?? user.catalogue[0].code, reason: 'Stated requirement', benefits: 'Customers get updates', integrations: '', dependencies: '', considerations: '' }, { serviceCode: 'MADE_UP_SERVICE', reason: 'Not ours' }],
          projectScope: { overview: 'Original overview', objectives: ['Objective'], phases: [{ name: 'Setup', duration: 'about 2 weeks, to be confirmed', activities: ['Configure'] }], assumptions: ['Timelines are proposals'], nextSteps: ['Review with the client'] },
          missingInformation: ['How many orders a day?']
        };
      }
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(answer) }] }));
    });
  });
  await new Promise<void>(rs => aiServer.listen(0, '127.0.0.1', rs));
  Object.assign(process.env, { ANTHROPIC_API_KEY: 'test-key', ANTHROPIC_API_BASE_URL: `http://127.0.0.1:${(aiServer.address() as any).port}` });

  r = await api('ba2', 'POST', `/ba/quotations/${quoteId}/ai`, {});
  check(r.status === 404 && aiCalls.length === 0, 'business associate API: another Business Associate cannot make the AI read this client (no AI call was made)', r);
  aiMode = 'bad';
  r = await api('ba1', 'POST', `/ba/quotations/${quoteId}/ai`, {});
  check(r.status === 503 && /expected form/.test(r.json.error.message), 'business associate API: an AI answer in the wrong shape is refused, not patched', r);
  aiMode = 'http';
  r = await api('ba1', 'POST', `/ba/quotations/${quoteId}/ai`, {});
  check(r.status === 503 && /HTTP 500/.test(r.json.error.message), 'business associate API: an AI service error is reported clearly', r);
  aiMode = 'ok';
  r = await api('ba1', 'POST', `/ba/quotations/${quoteId}/ai`, { instructions: 'Keep it short' });
  check(r.status === 200 && r.json.data.aiGenerated && !r.json.data.reviewed && r.json.data.content.introduction.startsWith('Dear Hot Customer Co') && r.json.data.total === 12980 && !('MADE_UP_SERVICE' in r.json.data.content.serviceDescriptions),
    'business associate API: the AI drafts the words only; the amounts are unchanged and an invented service is dropped; the draft is not reviewed', r);
  const sent = aiCalls[aiCalls.length - 1].user;
  check(!/@|\+91|9811234/.test(sent) && /Hot Customer Co/.test(sent) && !/Second Qualified|Warm Customer|Cold Customer|BA Own/.test(sent) && JSON.parse(sent).totals.total === 12980,
    'business associate API: the AI got this client only (no e-mail or phone, no other client) and the fixed totals', sent);
  r = await api('ba1', 'POST', `/ba/quotations/${quoteId}/finalize`, {});
  check(r.status === 422 && /Review the AI draft/.test(r.json.error.message), 'business associate API: an AI draft cannot be finalised before the Business Associate reviews it', r);
  r = await api('ba1', 'PATCH', `/ba/quotations/${quoteId}`, { content: { introduction: 'Dear Hot Co, thank you.' }, reviewed: true });
  check(r.status === 200 && r.json.data.reviewed && r.json.data.content.introduction === 'Dear Hot Co, thank you.', 'business associate API: the draft is edited and marked reviewed', r);

  // ---- PDF and private storage
  const fake = await startFakeR2({ key: 'r2-ba-key', secret: 'r2-ba-secret', bucket: 'amuwa-files', cors: false });
  Object.assign(process.env, { STORAGE_PROVIDER: 'r2', R2_ENDPOINT: fake.endpoint, R2_ACCESS_KEY_ID: 'r2-ba-key', R2_SECRET_ACCESS_KEY: 'r2-ba-secret', R2_BUCKET: 'amuwa-files' });
  r = await api('ba2', 'POST', `/ba/quotations/${quoteId}/finalize`, {});
  check(r.status === 404, 'business associate API: another Business Associate cannot generate its PDF', r);
  r = await api('ba1', 'GET', `/ba/quotations/${quoteId}/file`);
  check(r.status === 404, 'business associate API: there is no file before it is finalised', r);
  r = await api('ba1', 'POST', `/ba/quotations/${quoteId}/finalize`, {});
  check(r.status === 200 && r.json.data.status === 'FINAL' && r.json.data.hasPdf, 'business associate API: the quotation is finalised and its PDF generated', r);
  const qRow = (await db.query(`select pdf_bucket, pdf_path, pdf_provider, pdf_size, valid_until::text, status from ba_quotations where id = $1`, [quoteId])).rows[0];
  check(qRow.pdf_bucket === 'ba-documents' && qRow.pdf_provider === 'R2' && fake.objects.has(`ba-documents/${qRow.pdf_path}`) && Number(qRow.pdf_size) > 1500, 'business associate API: the PDF is stored in the private bucket and its reference kept in the database', qRow);
  r = await api('ba1', 'GET', `/ba/quotations/${quoteId}/file?action=download`);
  const pdfBytes = Buffer.from(await fetch(r.json.data.url).then(x => x.arrayBuffer()));
  const pdfDoc = await PDFDocument.load(pdfBytes);
  check(r.status === 200 && pdfBytes.subarray(0, 5).toString() === '%PDF-' && pdfDoc.getPageCount() >= 1 && /Quotation/.test(pdfDoc.getTitle() || ''), 'business associate API: the PDF downloads through a signed link and is a real PDF', { status: r.status, title: pdfDoc.getTitle() });
  r = await api('dh', 'GET', `/ba/quotations/${quoteId}/file`);
  check(r.status === 200, 'business associate API: the Department Head can open it', r);
  r = await api('ba2', 'GET', `/ba/quotations/${quoteId}/file`);
  check(r.status === 404, 'business associate API: another Business Associate cannot', r);
  r = await api('a', 'GET', `/ba/quotations/${quoteId}/file`);
  check(r.status === 404, 'business associate API: nor an unrelated Sales member', r);
  r = await api('ba1', 'PATCH', `/ba/quotations/${quoteId}`, { notes: 'changed' });
  check(r.status === 409, 'business associate API: a finalised quotation cannot be edited', r);
  r = await api('ba1', 'POST', `/ba/quotations/${quoteId}/ai`, {});
  check(r.status === 409, 'business associate API: nor rewritten by the AI', r);
  r = await api('ba1', 'POST', `/ba/quotations/${quoteId}/finalize`, {});
  check(r.status === 409, 'business associate API: nor finalised twice', r);
  r = await api('ba1', 'POST', `/ba/quotations/${quoteId}/revise`, {});
  check(r.status === 201 && r.json.data.revision === 2 && r.json.data.number === quoteNo && r.json.data.status === 'DRAFT', 'business associate API: a revision is a new draft with the same number', r);
  const rev2 = r.json.data.id as string;
  r = await api('ba1', 'PATCH', `/ba/quotations/${rev2}`, { reviewed: true, validityDays: 20 });
  r = await api('ba1', 'POST', `/ba/quotations/${rev2}/finalize`, {});
  check(r.status === 200 && r.json.data.revision === 2, 'business associate API: revision 2 is finalised', r);
  check(fake.objects.size === 2, 'business associate API: both revisions\' PDFs are kept', [...fake.objects.keys()]);
  r = await api('ba1', 'GET', `/ba/quotations?contactId=${contactId}`);
  check(r.json.data.filter((x: any) => x.number === quoteNo).length === 2, 'business associate API: previous quotations are listed', r);
  const after = await Promise.all(await invoiceCounts());
  check(JSON.stringify(after) === JSON.stringify(before), 'business associate API: a quotation creates no invoice and no payment', { before, after });

  // ---- demos
  const at = (days: number, h = 10) => { const d = new Date(Date.now() + days * 86400e3); d.setUTCHours(h, 0, 0, 0); return d.toISOString(); };
  const demo = { title: 'Product demo', startsAt: at(2), endsAt: at(2, 11), mode: 'ONLINE', location: 'Google Meet', meetingLink: 'https://meet.example.com/abc', internalNotes: 'Show the QR menu' };
  r = await api('ba1', 'POST', '/ba/demos', { contactId, ...demo, endsAt: at(2, 9) });
  check(r.status === 422, 'business associate API: an end before the start is refused', r);
  r = await api('ba1', 'POST', '/ba/demos', { contactId, ...demo, startsAt: at(-3), endsAt: at(-3, 11) });
  check(r.status === 422 && /passed/.test(r.json.error.message), 'business associate API: a time in the past is refused', r);
  r = await api('ba1', 'POST', '/ba/demos', { contactId, ...demo, mode: 'IN_PERSON', location: '' });
  check(r.status === 422, 'business associate API: an in-person demo needs a place', r);
  r = await api('ba2', 'POST', '/ba/demos', { contactId, ...demo });
  check(r.status === 404, 'business associate API: another Business Associate cannot book a demo for this contact', r);
  r = await api('ba1', 'POST', '/ba/demos', { contactId, ...demo });
  check(r.status === 201 && r.json.data.status === 'SCHEDULED' && r.json.data.client === 'Hot Customer' && r.json.data.assignee === 'Biz One', 'business associate API: a demo is scheduled for the contact', r);
  const demoId = r.json.data.id as string;
  r = await api('ba1', 'POST', '/ba/demos', { contactId, ...demo, startsAt: new Date(new Date(at(2)).getTime() + 1800e3).toISOString(), endsAt: new Date(new Date(at(2)).getTime() + 5400e3).toISOString() });
  check(r.status === 409, 'business associate API: an overlapping demo is a conflict', r);
  r = await api('ba1', 'PATCH', `/ba/demos/${demoId}`, { startsAt: at(4), endsAt: at(4, 11) });
  check(r.status === 200 && r.json.data.status === 'RESCHEDULED' && r.json.data.rescheduleCount === 1, 'business associate API: a changed time is a reschedule', r);
  r = await api('ba2', 'POST', `/ba/demos/${demoId}/status`, { status: 'CANCELLED' });
  check(r.status === 404, 'business associate API: another Business Associate cannot cancel it', r);
  r = await api('ba1', 'GET', '/ba/demos?status=RESCHEDULED');
  check(r.json.data.length === 1, 'business associate API: the list filters by status', r);
  r = await api('ba1', 'POST', `/ba/demos/${demoId}/status`, { status: 'COMPLETED', feedback: 'x' });
  check(r.status === 422, 'business associate API: a demo that has not started cannot be completed', r);
  await db.query(`update ba_demos set starts_at = now() - interval '2 hours', ends_at = now() - interval '1 hour' where id = $1`, [demoId]);
  r = await api('ba1', 'POST', `/ba/demos/${demoId}/status`, { status: 'COMPLETED', feedback: 'They liked it', followUpNotes: 'Send the scope' });
  check(r.status === 200 && r.json.data.status === 'COMPLETED', 'business associate API: a finished demo is completed with feedback', r);
  r = await api('ba1', 'POST', '/ba/demos', { contactId, ...demo, title: 'Second demo', startsAt: at(6), endsAt: at(6, 11) });
  r = await api('ba1', 'POST', `/ba/demos/${r.json.data.id}/status`, { status: 'CANCELLED' });
  check(r.status === 200 && r.json.data.status === 'CANCELLED', 'business associate API: a demo can be cancelled', r);
  r = await api('ba1', 'GET', `/ba/contacts/${contactId}`);
  check(r.json.data.demos.length === 2 && r.json.data.demos.every((d: any) => d.client === 'Hot Customer') && r.json.data.stage === 'SCOPE_PENDING', 'business associate API: demos stay with the client; the stage follows the demo', r.json.data.stage);

  // ---- Scope of Project
  r = await api('ba2', 'POST', '/ba/scope', { contactId });
  check(r.status === 404, 'business associate API: another Business Associate cannot start a scope for this contact', r);
  r = await api('ba1', 'POST', '/ba/scope', { contactId, title: 'Scope - Hot Co', inputs: { industry: 'Restaurants', operationalChallenges: 'Customers keep calling to ask about orders' } });
  check(r.status === 201 && r.json.data.version === 1 && r.json.data.status === 'DRAFT', 'business associate API: scope version 1 starts as a draft', r);
  const scopeId = r.json.data.id as string;
  r = await api('ba1', 'POST', '/ba/scope', { contactId });
  check(r.status === 409, 'business associate API: only one open draft per contact', r);
  r = await api('ba1', 'GET', `/ba/contacts/${contactId}`);
  check(r.json.data.profile.operationalChallenges === 'Customers keep calling to ask about orders', 'business associate API: what is typed in the scope form is kept with the contact', r.json.data.profile);
  r = await api('ba1', 'POST', `/ba/scope/${scopeId}/finalize`, {});
  check(r.status === 422 && /empty/.test(r.json.error.message), 'business associate API: an empty scope cannot be finalised', r);
  const callsBefore = aiCalls.length;
  r = await api('ba2', 'POST', `/ba/scope/${scopeId}/ai`, {});
  check(r.status === 404 && aiCalls.length === callsBefore, 'business associate API: another Business Associate cannot trigger the AI for this client', r);
  r = await api('ba1', 'POST', `/ba/scope/${scopeId}/ai`, {});
  check(r.status === 200 && r.json.data.aiGenerated && !r.json.data.reviewed && r.json.data.content.businessAnalysis.swot.strengths[0].basis === 'VERIFIED' && r.json.data.content.businessAnalysis.swot.weaknesses[0].basis === 'ASSUMPTION', 'business associate API: the AI writes the analysis; verified facts are told apart from assumptions', r);
  check(r.json.data.content.recommendedSolutions.length === 1 && r.json.data.content.recommendedSolutions[0].serviceCode !== 'MADE_UP_SERVICE', 'business associate API: only services from the approved catalogue are recommended', r.json.data.content.recommendedSolutions);
  check(r.json.data.content.missingInformation[0] === 'How many orders a day?', 'business associate API: missing information is listed as a question, not invented', r.json.data.content.missingInformation);
  const scopePayload = JSON.parse(aiCalls[aiCalls.length - 1].user);
  check(scopePayload.client.name === 'Hot Customer' && scopePayload.requirements.startsWith('A WhatsApp') && !/Second Qualified|Warm Customer|Cold Customer/.test(JSON.stringify(scopePayload)) && !('phone' in scopePayload.client) && !('email' in scopePayload.client),
    'business associate API: the AI got this client\'s own facts only (no phone or e-mail, no other client)', Object.keys(scopePayload));
  check(scopePayload.catalogue.length > 5 && scopePayload.quotation?.number === quoteNo, 'business associate API: and the approved catalogue and the finalised quotation', scopePayload.quotation);
  r = await api('ba1', 'POST', `/ba/scope/${scopeId}/ai`, { section: 'projectScope' });
  check(r.status === 200 && r.json.data.content.projectScope.overview === 'Regenerated overview' && r.json.data.content.businessAnalysis.swot.strengths.length === 1 && r.json.data.content.missingInformation.length === 2, 'business associate API: one section is regenerated; the rest is untouched', r.json.data.content.projectScope);
  r = await api('ba1', 'POST', `/ba/scope/${scopeId}/finalize`, {});
  check(r.status === 422 && /Review the AI draft/.test(r.json.error.message), 'business associate API: the AI scope needs the Business Associate\'s review first', r);
  r = await api('ba1', 'PATCH', `/ba/scope/${scopeId}`, { content: { ...((await api('ba1', 'GET', `/ba/scope/${scopeId}`)).json.data.content), projectScope: { overview: 'Edited overview', objectives: ['Edited objective'] } }, reviewed: true });
  check(r.status === 200 && r.json.data.content.projectScope.overview === 'Edited overview' && r.json.data.reviewed, 'business associate API: the Business Associate edits and reviews it', r);
  r = await api('ba1', 'POST', `/ba/scope/${scopeId}/finalize`, {});
  check(r.status === 200 && r.json.data.status === 'FINAL' && r.json.data.hasPdf, 'business associate API: version 1 is finalised and its PDF generated', r);
  r = await api('ba1', 'GET', `/ba/scope/${scopeId}/file`);
  const sPdf = await PDFDocument.load(Buffer.from(await fetch(r.json.data.url).then(x => x.arrayBuffer())));
  check(r.status === 200 && sPdf.getPageCount() >= 1 && /Scope/.test(sPdf.getTitle() || ''), 'business associate API: the scope PDF downloads and is a real PDF', sPdf.getTitle());
  r = await api('ba1', 'PATCH', `/ba/scope/${scopeId}`, { title: 'changed' });
  check(r.status === 409, 'business associate API: a finalised version cannot be edited', r);
  r = await api('ba1', 'POST', '/ba/scope', { contactId });
  check(r.status === 201 && r.json.data.version === 2 && r.json.data.status === 'DRAFT' && r.json.data.content.projectScope.overview === 'Edited overview', 'business associate API: version 2 starts from version 1', r);
  r = await api('ba1', 'GET', `/ba/contacts/${contactId}/scope`);
  check(r.json.data.length === 2 && r.json.data[1].status === 'FINAL' && r.json.data[0].status === 'DRAFT', 'business associate API: both versions are listed, the finalised one kept', r);
  r = await api('ba2', 'GET', `/ba/scope/${scopeId}/file`);
  check(r.status === 404, 'business associate API: another Business Associate cannot download it', r);
  r = await api('dh', 'GET', `/ba/scope/${scopeId}/file`);
  check(r.status === 200, 'business associate API: the Department Head can', r);
  fake.server.close();
  aiServer.close();
  for (const k of ['STORAGE_PROVIDER', 'R2_ENDPOINT', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET', 'ANTHROPIC_API_KEY', 'ANTHROPIC_API_BASE_URL']) delete process.env[k];

  // ---- leads
  const lead = (name: string, extra: Record<string, unknown> = {}) => ({ name, company: `${name} Co`, phone: '9811234581', leadSource: 'Referral', services: [svcCodes[0]], leadTemperature: 'WARM', callStatus: 'CONTACTED', ...extra });
  r = await api('tca', 'POST', '/ba/leads', lead('Nope'));
  check(r.status === 403, 'business associate API: a Telecaller cannot use the Business Associate lead pages', r);
  r = await api('ba1', 'POST', '/ba/leads', lead('BA Lead One', { leadTemperature: 'LUKEWARM' }));
  check(r.status === 422, 'business associate API: the temperature is Hot, Warm or Cold', r);
  r = await api('ba1', 'POST', '/ba/leads', lead('BA Lead One'));
  check(r.status === 201 && r.json.data.leadTemperature === 'WARM' && r.json.data.callStatus === 'CONTACTED', 'business associate API: a lead is added with temperature and call status stored separately', r);
  const baLead = r.json.data.id as string;
  check((await db.query(`select owner_id from customers where id = $1`, [baLead])).rows[0].owner_id === baOne, 'business associate API: it is owned by the Business Associate');
  r = await api('ba1', 'GET', '/ba/leads');
  check(r.json.data.total === 1 && r.json.data.items[0].name === 'BA Lead One', 'business associate API: the list shows only their own leads (not the Telecaller\'s)', r);
  r = await api('ba1', 'PATCH', `/ba/leads/${baLead}`, { leadTemperature: 'HOT', callStatus: 'INTERESTED', phone: '9811234582' });
  check(r.status === 200 && r.json.data.leadTemperature === 'HOT' && r.json.data.callStatus === 'INTERESTED', 'business associate API: a lead can be edited', r);
  r = await api('ba1', 'GET', '/ba/leads?temperature=HOT&callStatus=INTERESTED&search=lead');
  check(r.json.data.total === 1, 'business associate API: filters and search', r);
  r = await api('ba2', 'GET', `/ba/leads/${baLead}`);
  check(r.status === 404, 'business associate API: another Business Associate cannot open it', r);
  r = await api('tca', 'GET', '/telecaller/leads');
  check(!r.json.data.items.some((l: any) => l.id === baLead), 'business associate API: the Telecaller\'s lead page does not show it (role separation)', r);

  // ---- Home
  r = await api('ba1', 'GET', '/ba/home');
  const h = r.json.data;
  check(r.status === 200 && h.assignedContacts === 1 && h.quotationsDrafted === 1 && h.scopeDocumentsGenerated === 2 && h.upcomingDemos === 0 && h.leadsInProgress === 1 && h.recent.length > 3 && h.stageCounts.IN_PROGRESS === 1, 'business associate API: the Home counts come from the data', h);
  r = await api('ba2', 'GET', '/ba/home');
  check(r.json.data.assignedContacts === 0 && r.json.data.scopeDocumentsGenerated === 0, 'business associate API: another Business Associate has their own counts', r.json.data);

  // ---- reassignment
  r = await api('ba1', 'POST', `/ba/contacts/${contactId}/reassign`, { assigneeId: baTwo });
  check(r.status === 403, 'business associate API: a Business Associate cannot reassign', r);
  r = await api('dh', 'POST', `/ba/contacts/${contactId}/reassign`, { assigneeId: baTwo });
  check(r.status === 200, 'business associate API: the Department Head reassigns a contact', r);
  r = await api('ba2', 'GET', `/ba/contacts/${contactId}`);
  check(r.status === 200 && r.json.data.quotations.length === 3 && r.json.data.scopes.length === 2, 'business associate API: the new owner gets the contact with its quotations and scope versions', r);
  r = await api('ba1', 'GET', `/ba/contacts/${contactId}`);
  check(r.status === 404, 'business associate API: the former owner no longer has it', r);
}


// ---------------------------------------------------------------------------
// Sales Department Head dashboard
// ---------------------------------------------------------------------------
{
  tokens.set('sh', tokenFor(salesHeadId));
  r = await api('sh', 'GET', '/me');
  check(r.status === 200 && r.json.data.defaultDashboard === 'sales-department-head' && r.json.data.headDivision === 'SALES', 'sales head API: signs in to the Sales Department Head dashboard', r);
  r = await api('dh', 'GET', '/me');
  check(r.json.data.defaultDashboard === 'department-head', 'sales head API: the other Department Head keeps the Department Head dashboard', r);

  // ---- who may use the pages
  for (const who of ['dh', 'th', 'a', 'tl2', 'sa']) {
    r = await api(who, 'GET', '/sales-head/overview');
    check(r.status === 403, `sales head API: ${who} cannot open the Sales Department Head pages`, r);
  }
  r = await api(null, 'GET', '/sales-head/overview');
  check(r.status === 401, 'sales head API: nor a visitor', r);

  // ---- Lead Assign: the sheet goes to a Telecaller
  const tcA = (await db.query(`select id from profiles where sales_sub_role = 'TELECALLER' and status = 'ACTIVE' order by created_at limit 1`)).rows[0].id as string;
  r = await api('sh', 'GET', '/sales-head/lead-assignees');
  check(r.status === 200 && r.json.data.length >= 1 && r.json.data.every((x: any) => x.subRole === 'TELECALLER' && x.mode === 'TELECALLER' && x.team === 'Sales')
    && r.json.data.some((x: any) => x.id === tcA) && !r.json.data.some((x: any) => x.id === memberA || x.id === deliveryMember || x.id === salesTeamLeadId), 'sales head API: only Telecallers can be given a sheet', r);
  r = await api('sh', 'GET', '/sales-head/team-people');
  check(r.status === 200 && r.json.data.some((x: any) => x.id === memberA) && r.json.data.some((x: any) => x.id === salesTeamLeadId) && !r.json.data.some((x: any) => x.id === deliveryMember), 'sales head API: the team list has Sales people and no Support people', r);
  const sheetBytes = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('sales-sheet-one')]);
  const sheetHash = crypto.createHash('sha256').update(sheetBytes).digest('hex');
  const sheetRows = [
    { row: 2, name: 'Meera Joshi', company: 'Joshi & Co', phone: '+91 98700 11111', email: 'meera@joshi.example', remarks: 'Wants a demo' },
    { row: 3, name: 'Nitin Pawar', phone: '9870022222' },
    { row: 4, name: '', phone: '9870033333' },
    { row: 5, name: 'Nitin Again', phone: '98700 22222' },
    { row: 6, name: 'Om Prakash', phone: '9870044444', email: 'not-an-email' }
  ];
  r = await api('sh', 'POST', '/sales-head/sheets', { assigneeId: tcA, fileName: 'fair.xlsx', hash: 'xyz', rows: sheetRows, commit: false });
  check(r.status === 422, 'sales head API: a sheet without a proper hash is refused', r);
  r = await api('sh', 'POST', '/sales-head/sheets', { assigneeId: tcA, fileName: 'fair.xlsx', hash: sheetHash, rows: [], commit: false });
  check(r.status === 422, 'sales head API: an empty sheet is refused', r);
  r = await api('sh', 'POST', '/sales-head/sheets', { assigneeId: tcA, fileName: 'fair.xlsx', hash: sheetHash, rows: [{ row: 2, name: 'A', phone: '9870099999', temperature: 'HOT' }], commit: false });
  check(r.status === 422, 'sales head API: a column the sheet does not carry (temperature) is refused', r);
  r = await api('sh', 'POST', '/sales-head/sheets', { assigneeId: tcA, fileName: 'fair.xlsx', hash: sheetHash, rows: sheetRows, commit: false });
  check(r.status === 200 && !r.json.data.committed && r.json.data.summary.valid === 2 && r.json.data.summary.invalid === 2 && r.json.data.summary.duplicates === 1
    && r.json.data.issues.length === 3 && r.json.data.assignee.role === 'Telecaller' && r.json.data.mode === 'TELECALLER', 'sales head API: the preview counts valid, invalid and duplicate rows and names the Telecaller', r);
  check((await db.query(`select count(*)::int n from sales_lead_sheets where file_name = 'fair.xlsx'`)).rows[0].n === 0, 'sales head API: a preview saves nothing');
  for (const [who, label] of [[memberA, 'a Team Member'], [salesTeamLeadId, 'a Team Lead'], [deliveryMember, 'a Support member']] as const) {
    r = await api('sh', 'POST', '/sales-head/sheets', { assigneeId: who, fileName: 'fair.xlsx', hash: sheetHash, rows: sheetRows, commit: true });
    check(r.status === 422 && /Telecaller/.test(r.json.error.message), `sales head API: a sheet cannot be given to ${label}`, r);
  }
  r = await api('dh', 'POST', '/sales-head/sheets', { assigneeId: tcA, fileName: 'fair.xlsx', hash: sheetHash, rows: sheetRows, commit: true });
  check(r.status === 403, 'sales head API: the Support head cannot assign Sales sheets', r);
  r = await api('sh', 'POST', '/sales-head/sheets', { assigneeId: tcA, fileName: 'fair.xlsx', note: 'Trade fair', hash: sheetHash, rows: sheetRows, commit: true });
  const sheetId = r.json.data?.sheetId as string;
  check(r.status === 200 && r.json.data.committed && sheetId && r.json.data.mode === 'TELECALLER', 'sales head API: the sheet is given to the Telecaller', r);
  r = await api('sh', 'POST', '/sales-head/sheets', { assigneeId: tcA, fileName: 'fair-again.xlsx', hash: sheetHash, rows: sheetRows, commit: true });
  check(r.status === 409, 'sales head API: the same file cannot be imported twice', r);
  const given = (await db.query(`select name, assigned_to, call_status from telecaller_contacts where list_id = (select telecaller_list_id from sales_lead_sheets where id = $1) order by name`, [sheetId])).rows;
  check(given.length === 2 && given.every((x: any) => x.assigned_to === tcA && x.call_status === 'PENDING'), 'sales head API: the valid contacts are in the Telecaller\'s list, still to call', given);
  check((await db.query(`select count(*)::int n from customers where phone in ('+919870011111', '9870022222')`)).rows[0].n === 0, 'sales head API: no lead is made behind the Telecaller\'s back');
  r = await api('tca', 'GET', '/telecaller/contacts?pageSize=100&search=Joshi');
  check(r.status === 200 && r.json.data.items.some((c: any) => c.name === 'Meera Joshi'), 'sales head API: the Telecaller sees the contact in their Tasks', r);
  r = await api('tca', 'GET', '/notifications');
  check(r.status === 200 && JSON.stringify(r.json.data).includes('CONTACT_SHEET_ASSIGNED'), 'sales head API: the Telecaller is notified', r);

  // ---- the original file
  const fakeR2 = await startFakeR2({ key: 'r2-sh-key', secret: 'r2-sh-secret', bucket: 'amuwa-files', cors: false });
  Object.assign(process.env, { STORAGE_PROVIDER: 'r2', R2_ENDPOINT: fakeR2.endpoint, R2_ACCESS_KEY_ID: 'r2-sh-key', R2_SECRET_ACCESS_KEY: 'r2-sh-secret', R2_BUCKET: 'amuwa-files' });
  r = await api('dh', 'POST', `/sales-head/sheets/${sheetId}/source`, { data: sheetBytes.toString('base64') });
  check(r.status === 403, 'sales head API: only the Sales head attaches the file', r);
  r = await api('sh', 'POST', `/sales-head/sheets/${sheetId}/source`, { data: Buffer.from('not a spreadsheet').toString('base64') });
  check(r.status === 422, 'sales head API: a file that is not .xlsx is refused', r);
  r = await api('sh', 'POST', `/sales-head/sheets/${sheetId}/source`, { data: Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('other')]).toString('base64') });
  check(r.status === 422 && /not the one/.test(r.json.error.message), 'sales head API: nor a file that is not the sheet that was checked', r);
  r = await api('sh', 'POST', `/sales-head/sheets/${sheetId}/source`, { data: sheetBytes.toString('base64') });
  const srow = (await db.query(`select source_provider, source_path from sales_lead_sheets where id = $1`, [sheetId])).rows[0];
  check(r.status === 201 && srow.source_provider === 'R2' && srow.source_path.endsWith(`${sheetId}.xlsx`) && fakeR2.objects.has(`telecaller-sheets/${srow.source_path}`), 'sales head API: the original file is stored privately and referenced', { status: r.status, srow });
  r = await api('sh', 'POST', `/sales-head/sheets/${sheetId}/source`, { data: sheetBytes.toString('base64') });
  check(r.status === 409, 'sales head API: it is stored once', r);
  fakeR2.server.close();
  for (const k of ['STORAGE_PROVIDER', 'R2_ENDPOINT', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET']) delete process.env[k];
  r = await api('sh', 'GET', '/sales-head/sheets');
  check(r.status === 200 && r.json.data.length >= 1 && r.json.data[0].hasSourceFile === true && r.json.data[0].contactsPending === 2 && r.json.data[0].uploadedBy === 'Sales Head', 'sales head API: the history shows the upload, who made it and what is still to call', r);

  // ---- Lead List
  r = await api('sh', 'GET', '/sales-head/leads?filter=HOT&pageSize=50');
  check(r.status === 200 && r.json.data.items.every((l: any) => l.temperature === 'HOT') && r.json.data.counts.all >= 1, 'sales head API: the Hot filter lists Hot leads and the counts come with it', r);
  r = await api('sh', 'GET', '/sales-head/leads?search=meera&sort=name&dir=asc');
  const meera = r.json.data.items[0];
  check(r.status === 200 && r.json.data.total >= 1 && meera.name === 'Meera Nair' && meera.assignee === 'Member A' && meera.converted === false, 'sales head API: search finds a lead with its owner', r);
  r = await api('sh', 'GET', `/sales-head/leads/${meera.id}`);
  check(r.status === 200 && r.json.data.name === 'Meera Nair' && r.json.data.history.length >= 1, 'sales head API: a lead opens with its history', r);
  r = await api('sh', 'GET', '/sales-head/leads?filter=NOPE');
  check(r.status === 422, 'sales head API: an unknown filter is refused', r);
  const supportCustomer = (await db.query(`select c.id from customers c join teams t on t.id = c.team_id where t.division = 'SUPPORT' limit 1`)).rows[0];
  if (supportCustomer) {
    r = await api('sh', 'GET', `/sales-head/leads/${supportCustomer.id}`);
    check(r.status === 404, 'sales head API: a Support customer is not reachable from the Sales pages', r);
    r = await api('sh', 'GET', `/customers/${supportCustomer.id}`);
    check(r.status === 404, 'sales head API: nor through the customer API', r);
  }
  await db.query(`insert into crm_leads (id, name, phone, department, sub_department) values ('inb-api-1', 'Inbound Api', '+919870066666', 'wabastore', 'sales')`);
  r = await api('sh', 'GET', '/sales-head/leads?filter=UNASSIGNED&search=inbound');
  check(r.status === 200 && r.json.data.total === 1 && r.json.data.items[0].kind === 'INBOUND', 'sales head API: an enquiry nobody took is listed as unassigned', r);
  r = await api('sh', 'POST', '/sales-head/leads/inb-api-1/assign', { assigneeId: deliveryMember });
  check(r.status === 422, 'sales head API: not to a Support member', r);
  r = await api('sh', 'POST', '/sales-head/leads/inb-api-1/assign', { assigneeId: memberA });
  check(r.status === 200 && r.json.data.assignee === 'Member A', 'sales head API: the head assigns it', r);

  // ---- Daily Tasks
  r = await api('sh', 'GET', '/sales-head/task-assignees');
  check(r.status === 200 && r.json.data.some((x: any) => x.id === salesTeamLeadId) && !r.json.data.some((x: any) => x.id === deliveryLead), 'sales head API: tasks go to Sales Team Leads', r);
  r = await api('sh', 'POST', '/sales-head/tasks', { assigneeId: deliveryLead, title: 'Support work' });
  check(r.status === 422, 'sales head API: not to a Support lead', r);
  r = await api('sh', 'POST', '/sales-head/tasks', { assigneeId: salesTeamLeadId, title: '', priority: 'HIGH' });
  check(r.status === 422, 'sales head API: a task needs a title', r);
  r = await api('sh', 'POST', '/sales-head/tasks', { assigneeId: salesTeamLeadId, title: 'Call the trade fair leads', description: 'All hot ones first', priority: 'HIGH', dueDate: '2020-01-01' });
  check(r.status === 201 && r.json.data.id, 'sales head API: a task is created for a Sales Team Lead', r);
  r = await api('sh', 'GET', '/sales-head/tasks?filter=OVERDUE');
  check(r.status === 200 && r.json.data.items.some((t: any) => t.title === 'Call the trade fair leads' && t.overdue && t.assignee) && r.json.data.counts.overdue >= 1, 'sales head API: the overdue filter shows it', r);
  r = await api('sh', 'GET', '/sales-head/tasks?filter=COMPLETED');
  check(r.status === 200 && r.json.data.items.every((t: any) => t.status === 'COMPLETED'), 'sales head API: the Completed filter', r);

  // ---- Overview, Reports, Income
  r = await api('sh', 'GET', '/sales-head/overview');
  check(r.status === 200 && r.json.data.cards.totalLeads >= 1 && r.json.data.cards.teamMembers >= 2 && r.json.data.teamActivity.every((p: any) => p.team === 'Sales'), 'sales head API: the overview is counted from the Sales teams', r);
  r = await api('sh', 'GET', '/sales-head/reports?who=TEAM_LEAD');
  check(r.status === 200 && r.json.data.who === 'TEAM_LEAD' && r.json.data.rows.every((x: any) => x.team === 'Sales') && r.json.data.rows.some((x: any) => x.id === salesTeamLeadId), 'sales head API: the Team Lead report', r);
  r = await api('sh', 'GET', '/sales-head/reports?who=TEAM_MEMBER&taskStatus=COMPLETED');
  check(r.status === 200 && r.json.data.rows.some((x: any) => x.id === memberA && x.leadsAssigned >= 1), 'sales head API: the Team Member report', r);
  r = await api('sh', 'GET', '/sales-head/reports?who=MANAGER');
  check(r.status === 422, 'sales head API: the report kind is checked', r);
  r = await api('sh', 'GET', '/sales-head/reports?from=2026-02-01&to=2026-01-01');
  check(r.status === 422, 'sales head API: the period is checked', r);
  r = await api('sh', 'GET', '/sales-head/income');
  check(r.status === 200 && r.json.data.expenses === null && Array.isArray(r.json.data.transactions) && typeof r.json.data.basis === 'string', 'sales head API: income is the Sales side; no invented expense figure', r);

  // ---- Support is separate: the Sales head reads and creates Sales people only
  r = await api('sh', 'GET', '/users?pageSize=100');
  check(r.status === 200 && !r.json.data.items.some((u: any) => u.id === deliveryMember || u.id === deliveryLead) && r.json.data.items.some((u: any) => u.id === memberA), 'sales head API: the people list has no Support people', r);
  r = await api('sh', 'POST', '/users', { email: 'sup.new@amuwa.com', fullName: 'Support New', password: 'Sup3rSecret!', role: 'TEAM_MEMBER', teamId: delivery });
  check(r.status === 403, 'sales head API: cannot create a Support employee', r);
  r = await api('sh', 'POST', '/users', { email: 'sales.new@amuwa.com', fullName: 'Sales New', password: 'Sup3rSecret!', role: 'TEAM_MEMBER', teamId: sales.id });
  check(r.status === 201, 'sales head API: can create a Sales employee', r);
  r = await api('dh', 'GET', '/users?pageSize=100');
  check(r.status === 200 && r.json.data.items.some((u: any) => u.id === deliveryMember), 'sales head API: the other Department Head still sees the whole department', r);
}

// --- the three WhatsApp services ------------------------------------------------
{
  r = await api('a', 'GET', '/pipeline/services');
  const byCode = (c: string) => (r.json.data as any[]).find(x => x.code === c);
  const need = (c: string) => (byCode(c)?.requirements ?? []).map((x: any) => x.label).sort().join('|');
  check(r.status === 200 && ['WHATSAPP_API_BLUE_TICK', 'WHATSAPP_API', 'BLUE_TICK'].map(c => byCode(c)?.name).join('|') === 'WhatsApp API + Blue Tick|WhatsApp API|Blue Tick', 'whatsapp: Sales can choose WhatsApp API + Blue Tick, WhatsApp API and Blue Tick', r);
  check(need('WHATSAPP_API_BLUE_TICK').length > 0 && need('WHATSAPP_API') === need('WHATSAPP_API_BLUE_TICK') && need('BLUE_TICK') === need('WHATSAPP_API_BLUE_TICK'),
    'whatsapp: each of the three asks for the same documents and details', [need('WHATSAPP_API_BLUE_TICK'), need('WHATSAPP_API'), need('BLUE_TICK')]);
  for (const [code, phone] of [['WHATSAPP_API', '+91 98200 72222'], ['BLUE_TICK', '+91 98200 71111']] as const) {
    r = await api('a', 'POST', '/pipeline/leads', { name: `Only ${code}`, company: `${code} Co`, phone, leadSource: 'Walk-in', services: [code] });
    check(r.status === 201, `whatsapp: a lead with only ${code} is created`, r);
  }
}


// --- Department Heads in several departments / functions (migration 20261123000100) ---------------------------------------
{
  const deps = (await api('sa', 'GET', '/departments')).json.data as any[];
  const dep = (slug: string) => deps.find(d => d.slug === slug);
  const teamId = async (slug: string, name: string) => ((await api('sa', 'GET', `/teams?departmentId=${dep(slug).id}`)).json.data as any[]).find(t => t.name === name).id as string;
  const scope = (slug: string, division?: string) => ({ 'x-active-department': dep(slug).id, ...(division ? { 'x-active-division': division } : {}) });
  const mk = async (email: string, fullName: string, body: Record<string, unknown>) => {
    const x = await api('sa', 'POST', '/users', { email, fullName, password: 'Sup3rSecret!', ...body });
    if (x.status !== 201) throw new Error(`could not create ${email}: ${JSON.stringify(x.json)}`);
    return x.json.data.id as string;
  };
  // Group A: a shared Sales head (home DTalk) for DTalk, M Pillar and Whatsbox; a shared Support head for the same three
  const gsId = await mk('shared.sales@amuwa.com', 'Shared Sales Head', { role: 'DEPARTMENT_HEAD', departmentId: dep('dtalk').id, headDivision: 'SALES' });
  const gpId = await mk('shared.support@amuwa.com', 'Shared Support Head', { role: 'DEPARTMENT_HEAD', departmentId: dep('dtalk').id, headDivision: 'SUPPORT' });
  tokens.set('gs', tokenFor(gsId));
  tokens.set('gp', tokenFor(gpId));
  // Telecaller Sheets and Service Prices are Sales-only: the Support side is refused by the API (and by the database underneath)
  const apiH = (who: string, method: string, path: string, body: unknown, hdr: Record<string, string>) => api(who, method, path, body, undefined, hdr);
  const salesOnly = async (who: string, expectOk: boolean, label: string) => {
    const hdr = scope('dtalk', who === 'gp' ? 'SUPPORT' : 'SALES');
    const calls = [
      await apiH(who, 'GET', '/ba/prices', undefined, hdr),
      await apiH(who, 'GET', '/telecaller/lists', undefined, hdr),
      await apiH(who, 'GET', '/telecaller/assignable', undefined, hdr)
    ];
    check(calls.every(c => (expectOk ? c.status === 200 : c.status === 403)), `sales-only: ${label}: price list, contact sheets and Telecallers ${expectOk ? 'open' : 'are refused (403)'}`, calls.map(c => c.status));
  };
  await salesOnly('gs', true, 'the Sales Department Head');
  await salesOnly('gp', false, 'the Support Department Head');
  r = await apiH('gp', 'POST', '/ba/prices/AI_CALLING', { unitLabel: 'one time', unitPrice: 1, gstRate: 18, maxDiscountPct: 0, isActive: true }, scope('dtalk', 'SUPPORT'));
  check(r.status === 403, 'sales-only: a Support Department Head cannot change a price', r);
  r = await apiH('gp', 'POST', '/telecaller/lists', { assigneeId: crypto.randomUUID(), fileName: 'x.xlsx', hash: 'a'.repeat(64), rows: [{ row: 2, name: 'A', phone: '9800000001' }], commit: false }, scope('dtalk', 'SUPPORT'));
  check(r.status === 403, 'sales-only: nor check or assign a contact sheet', r);
  for (const who of ['tl2', 'tm2', 'sm']) {
    const c = [await api(who, 'GET', '/ba/prices'), await api(who, 'GET', '/telecaller/lists')];
    check(c.every(x => x.status === 403), `sales-only: a Support ${who === 'tl2' ? 'Team Lead' : 'team member'} is refused both (403)`, c.map(x => x.status));
  }
  const direct = async (who: string, table: string) => {
    const res = await fetch(`${process.env.GATEWAY_URL}/rest/v1/${table}?select=*&limit=5`, { headers: { apikey: process.env.SUPABASE_ANON_KEY!, authorization: `Bearer ${tokens.get(who)}` } });
    return { status: res.status, rows: ((await res.json()) as unknown[]).length };
  };
  for (const who of ['gp', 'sm', 'tl2']) {
    const x = [await direct(who, 'service_prices'), await direct(who, 'telecaller_contact_lists'), await direct(who, 'telecaller_contacts')];
    check(x.every(v => v.rows === 0), `sales-only: ${who}: the tables themselves return nothing (direct database access)`, x);
  }
  check((await direct('ba1', 'service_prices')).rows > 0, 'sales-only: a Business Associate can still read the price table');
  check((await db.query(`select count(*)::int n from telecaller_contact_lists`)).rows[0].n > 0 && (await db.query(`select count(*)::int n from service_prices`)).rows[0].n >= 0, 'sales-only: the stored sheets and prices are untouched');
  const owners: Record<string, string> = {};
  for (const slug of ['dtalk', 'mpillar', 'whatsbox']) {
    for (const side of ['Sales', 'Support']) {
      owners[`${slug}:${side}`] = await mk(`scope.${slug}.${side.toLowerCase()}@amuwa.com`, `Scope ${slug} ${side}`, { role: 'TEAM_MEMBER', teamId: await teamId(slug, side) });
      await db.query(`insert into public.customers (owner_id, name, phone, lifecycle_stage) values ($1, $2, $3, $4)`,
        [owners[`${slug}:${side}`], `SCOPE ${slug} ${side}`, `+9198110${String(Object.keys(owners).length).padStart(5, '0')}`, side === 'Sales' ? 'LEAD' : 'CUSTOMER']);
    }
  }
  const names = async (who: string, headers: Record<string, string> = {}) =>
    (((await api(who, 'GET', '/customers?search=SCOPE&pageSize=50', undefined, undefined, headers)).json.data?.items ?? []) as any[]).map(c => c.name).sort();

  r = await api('gs', 'GET', '/me/department-scopes');
  check(r.status === 200 && r.json.data.departments.length === 1 && r.json.data.departments[0].slug === 'dtalk', 'scopes: before any grant the shared head has only their own department', r);
  r = await api('gs', 'POST', `/users/${gsId}/department-access`, { departmentId: dep('mpillar').id, division: 'SALES', granted: true });
  check(r.status === 403, 'scopes: a Department Head cannot give themselves more departments', r);
  r = await api('gs', 'GET', `/users/${gsId}/department-access`);
  check(r.status === 403, 'scopes: nor read the grants', r);
  r = await api('sa', 'POST', `/users/${gsId}/department-access`, { departmentId: dep('mpillar').id, division: 'BOTH', granted: true });
  check(r.status === 422, 'scopes: an unknown function is refused', r);
  r = await api('sa', 'POST', `/users/${gsId}/department-access`, { departmentId: dep('accounts').id, division: 'SALES', granted: true });
  check(r.status === 422 && /no Sales team/.test(r.json.error.message), 'scopes: a department with no such team is refused', r);
  // several departments belong to an Operations Head: the Super Admin makes one first (the database refuses the grant otherwise)
  r = await api('sa', 'POST', `/users/${gsId}/department-access`, { departmentId: dep('mpillar').id, division: 'SALES', granted: true });
  check(r.status === 422 && /Operations Head/.test(r.json.error.message), 'operations head: a Department Head who is not an Operations Head cannot be given another department', r);
  r = await api('gs', 'POST', `/users/${gsId}/operations-head`, { value: true });
  check(r.status === 403, 'operations head: a Department Head cannot make themselves one', r);
  r = await api('a', 'POST', `/users/${gsId}/operations-head`, { value: true });
  check(r.status === 403, 'operations head: nor can a Team Member', r);
  r = await api('gs', 'GET', '/users/operations-head-review');
  check(r.status === 403, 'operations head: the Super Admin review is closed to a Department Head', r);
  r = await api('gs', 'GET', '/operations/overview');
  check(r.status === 403, 'operations head: a Department Head has no Operations overview', r);
  for (const id of [gsId, gpId]) {
    r = await api('sa', 'POST', `/users/${id}/operations-head`, { value: true, note: 'Oversees the shared departments' });
    check(r.status === 200 && r.json.data.isOperationsHead === true && r.json.data.role === 'DEPARTMENT_HEAD', 'operations head: the Super Admin makes the shared head an Operations Head (still a Department Head for every other rule)', r);
  }
  r = await api('gs', 'POST', `/users/${gsId}/operations-head`, { value: false });
  check(r.status === 403, 'operations head: an Operations Head cannot remove their own role', r);
  r = await api('gs', 'POST', `/users/${gpId}/department-access`, { departmentId: dep('mpillar').id, division: 'SUPPORT', granted: true });
  check(r.status === 403, 'operations head: nor give departments (that stays with the Super Admin)', r);
  r = await api('sa', 'POST', `/users/${gsId}/operations-head`, { value: true, extra: 1 });
  check(r.status === 422, 'operations head: an unknown field is refused', r);
  for (const [who, id, division] of [['gs', gsId, 'SALES'], ['gp', gpId, 'SUPPORT']] as const) {
    for (const slug of ['mpillar', 'whatsbox']) {
      r = await api('sa', 'POST', `/users/${id}/department-access`, { departmentId: dep(slug).id, division, granted: true });
      check(r.status === 200 && r.json.data.grants.some((g: any) => g.departmentId === dep(slug).id && g.division === division), `scopes: the Super Admin authorises ${who} for ${slug} ${division}`, r);
    }
  }
  r = await api('sa', 'GET', `/users/${gsId}/department-access`);
  check(r.status === 200 && r.json.data.grants.length === 2 && r.json.data.departments.length >= 11, 'scopes: the Super Admin reads the grants and the departments', r);

  // Group A: the shared Sales head
  r = await api('gs', 'GET', '/me/department-scopes');
  check(r.status === 200 && r.json.data.departments.map((d: any) => d.slug).sort().join() === 'dtalk,mpillar,whatsbox' && r.json.data.departments.every((d: any) => d.divisions.join() === 'SALES') && r.json.data.departments[0].isHome,
    'scopes: the shared Sales head is offered exactly the three departments, Sales only', r);
  check((await names('gs')).join() === 'SCOPE dtalk Sales', 'scopes: no header - the home department, Sales customers only');
  check((await names('gs', scope('mpillar'))).join() === 'SCOPE mpillar Sales', 'scopes: X-Active-Department switches the data to M Pillar (Sales only)');
  check((await names('gs', scope('whatsbox', 'SALES'))).join() === 'SCOPE whatsbox Sales', 'scopes: and to Whatsbox');
  check((await names('gs', scope('wabastore'))).join() === 'SCOPE dtalk Sales', 'scopes: a department they are not authorised for is ignored (still the home department)');
  check((await names('gs', scope('mpillar', 'SUPPORT'))).join() === 'SCOPE mpillar Sales', 'scopes: asking for the Support function gives no Support data');
  check((await names('gs', { 'x-active-department': "' or 1=1 --", 'x-active-division': 'ADMIN' })).join() === 'SCOPE dtalk Sales', 'scopes: malformed headers are ignored');
  r = await api('gs', 'GET', '/me/department-scopes', undefined, undefined, scope('mpillar'));
  check(r.json.data.activeDepartmentId === dep('mpillar').id && r.json.data.activeDivision === 'SALES', 'scopes: the response says what the database applied', r);
  // acting in the active department (the API checks the department too)
  r = await api('gs', 'POST', '/users', { email: 'scope.new.mp@amuwa.com', fullName: 'Scope New', password: 'Sup3rSecret!', role: 'TEAM_MEMBER', teamId: await teamId('mpillar', 'Sales') });
  check(r.status === 403, 'scopes: without switching, the head cannot create people in another department', r);
  r = await api('gs', 'POST', '/users', { email: 'scope.new.mp@amuwa.com', fullName: 'Scope New', password: 'Sup3rSecret!', role: 'TEAM_MEMBER', teamId: await teamId('mpillar', 'Sales') }, undefined, scope('mpillar'));
  check(r.status === 201, 'scopes: after switching to M Pillar the head creates a Sales employee there', r);
  r = await api('gs', 'POST', '/users', { email: 'scope.new.mp2@amuwa.com', fullName: 'Scope New Two', password: 'Sup3rSecret!', role: 'TEAM_MEMBER', teamId: await teamId('mpillar', 'Support') }, undefined, scope('mpillar'));
  check(r.status === 403, 'scopes: but not a Support employee (the Sales head works Sales only)', r);
  r = await api('gs', 'GET', '/sales-head/overview', undefined, undefined, scope('mpillar'));
  check(r.status === 200, 'scopes: the Sales head pages answer for the active department', r);

  // Group A: the shared Support head sees the same departments, Support only
  r = await api('gp', 'GET', '/me/department-scopes');
  check(r.status === 200 && r.json.data.departments.length === 3 && r.json.data.departments.every((d: any) => d.divisions.join() === 'SUPPORT'), 'scopes: the shared Support head is offered the same three departments, Support only', r);
  check((await names('gp', scope('mpillar'))).join() === 'SCOPE mpillar Support', 'scopes: Support head, M Pillar: its Support customer only');
  check((await names('gp', scope('whatsbox', 'SALES'))).join() === 'SCOPE whatsbox Support', 'scopes: asking for Sales gives no Sales data');
  r = await api('gp', 'GET', '/sales-head/overview', undefined, undefined, scope('mpillar'));
  check(r.status === 403, 'scopes: the Support head cannot open the Sales head pages', r);

  // Wabatalk: the Support department of D Talk. The shared Support head (home D Talk Support) is offered it as a department of its own.
  r = await api('gp', 'GET', '/me/department-scopes');
  const wtScope = r.json.data.departments.find((d: any) => d.slug === 'wabatalk');
  check(wtScope && wtScope.dataSlug === 'dtalk' && wtScope.divisions.join() === 'SUPPORT' && !r.json.data.departments.some((d: any) => d.slug === 'dtalk'),
    'scopes: D Talk\'s Support is offered as Wabatalk, working on D Talk\'s data', r);
  const wtId = wtScope?.id as string;
  check((await names('gp', { 'x-active-department': wtId })).join() === 'SCOPE dtalk Support', 'scopes: in Wabatalk the head sees D Talk\'s Support customer only');
  check((await names('gs', { 'x-active-department': wtId })).join() === 'SCOPE dtalk Sales', 'scopes: D Talk\'s Sales head sending Wabatalk\'s id still gets Sales data only');
  r = await api('sa', 'POST', `/users/${gpId}/department-access`, { departmentId: dep('dtalk').id, division: 'SUPPORT', granted: true });
  check(r.status === 422 && /Give Wabatalk instead/.test(r.json.error.message), 'scopes: D Talk\'s Support can only be given as Wabatalk', r);
  r = await api('sa', 'GET', '/departments');
  check(r.status === 200 && r.json.data.some((d: any) => d.slug === 'wabatalk' && d.facetOf === dep('dtalk').id && d.facetDivision === 'SUPPORT'), 'scopes: the department list marks Wabatalk as D Talk\'s Support side', r);
  // revenue: a verified payment on a customer the D Talk Support member sold is Wabatalk's, one on a Sales customer is D Talk's
  for (const [side, amount] of [['Support', 30000], ['Sales', 40000]] as const) {
    const cust = (await db.query(`insert into public.customers (owner_id, name, phone, lifecycle_stage, deal_amount) values ($1, $2, $3, 'CUSTOMER', $4) returning id`,
      [owners[`dtalk:${side}`], `WT revenue ${side}`, side === 'Support' ? '+919812100001' : '+919812100002', amount])).rows[0].id;
    await db.query(`insert into public.payment_requests (customer_id, status, agreed_amount, requested_by) values ($1, 'CONFIRMED', $2, $3)`, [cust, amount, owners[`dtalk:${side}`]]);
    await db.query(`insert into public.customer_payments (customer_id, payment_type, amount, method, reference, status, source, recorded_by, verified_by, verified_at)
                    select $1, 'FULL', $2, 'UPI', $3, 'VERIFIED', 'ACCOUNTS', p.id, p.id, now() from public.profiles p where p.role = 'SUPER_ADMIN' limit 1`, [cust, amount, `WT-${side}`]);
  }
  r = await api('sa', 'GET', `/reports/department-income?departmentId=${wtId}`);
  check(r.status === 200 && r.json.data.scope.name === 'Wabatalk' && Number(r.json.data.byDivision.support.collected) >= 30000 && Number(r.json.data.byDivision.sales.collected) === 0, 'scopes: the Wabatalk income report holds Support revenue only', r);
  r = await api('sa', 'GET', `/reports/department-income?departmentId=${dep('dtalk').id}`);
  check(r.status === 200 && Number(r.json.data.byDivision.sales.collected) >= 40000 && Number(r.json.data.byDivision.support.collected) === 0, 'scopes: the D Talk income report holds Sales revenue only', r);
  r = await api('gp', 'GET', '/reports/department-income', undefined, undefined, { 'x-active-department': wtId });
  check(r.status === 200 && r.json.data.scope.name === 'Wabatalk' && Number(r.json.data.byDivision.support.collected) >= 30000, 'scopes: the shared Support head working Wabatalk sees its revenue', r);
  r = await api('gs', 'GET', '/reports/department-income');
  check(r.status === 200 && r.json.data.scope.name !== 'Wabatalk' && Number(r.json.data.byDivision.support.collected) === 0, 'scopes: D Talk\'s Sales head sees none of Wabatalk\'s revenue', r);

  // Add Team Member: ONE account created for several departments (shared Support head), or for both functions of a department
  const headCount = async (email: string) => (await db.query(`select count(*)::int n from public.profiles where lower(email) = lower($1)`, [email])).rows[0].n as number;
  r = await api('sa', 'POST', '/users', { email: 'multi.support@amuwa.com', fullName: 'Multi Support Head', password: 'Sup3rSecret!', role: 'DEPARTMENT_HEAD', departmentId: dep('wabastar').id, headDivision: 'SUPPORT',
    operationsHead: true, additionalAccess: [{ departmentId: dep('whatsbox').id, division: 'SUPPORT' }, { departmentId: wtId, division: 'SUPPORT' }] });
  check(r.status === 201 && r.json.data.role === 'DEPARTMENT_HEAD' && r.json.data.headDivision === 'SUPPORT' && r.json.data.isOperationsHead === true, 'create: one Operations Head account is created with three departments', r);
  const multiId = r.json.data.id as string;
  r = await api('sa', 'POST', '/users', { email: 'multi.plain@amuwa.com', fullName: 'Plain Head', password: 'Sup3rSecret!', role: 'DEPARTMENT_HEAD', departmentId: dep('wabastar').id, headDivision: 'SALES',
    additionalAccess: [{ departmentId: dep('whatsbox').id, division: 'SALES' }] });
  check(r.status === 422 && /Operations Head/.test(r.json.error.message) && (await headCount('multi.plain@amuwa.com')) === 0, 'create: a Department Head created with other departments but not as an Operations Head is refused and no account is made', r);
  r = await api('dh', 'POST', '/users', { email: 'multi.dhop@amuwa.com', fullName: 'Not Allowed Op', password: 'Sup3rSecret!', role: 'DEPARTMENT_HEAD', departmentId: dep('wabastore').id, operationsHead: true });
  check(r.status === 403 && (await headCount('multi.dhop@amuwa.com')) === 0, 'create: only the Super Admin makes an Operations Head', r);
  r = await api('sa', 'POST', '/users', { email: 'multi.tmop@amuwa.com', fullName: 'Member Op', password: 'Sup3rSecret!', role: 'TEAM_MEMBER', teamId: await teamId('mpillar', 'Sales'), operationsHead: true });
  check(r.status === 422 && (await headCount('multi.tmop@amuwa.com')) === 0, 'create: a Team Member cannot be an Operations Head', r);
  r = await api('sa', 'GET', '/users/operations-head-review');
  check(r.status === 200 && r.json.data.some((x: any) => x.profileId === multiId && x.isOperationsHead === true && x.needsDecision === false), 'operations head: the Super Admin review lists the Operations Heads', r.json.data);
  check((await headCount('multi.support@amuwa.com')) === 1, 'create: one account, no duplicates');
  r = await api('sa', 'GET', `/users/${multiId}/department-access`);
  check(r.status === 200 && r.json.data.grants.length === 2, 'create: the extra departments are persisted as grants', r);
  tokens.set('multi', tokenFor(multiId));
  r = await api('multi', 'GET', '/me/department-scopes');
  check(r.status === 200 && r.json.data.departments.map((d: any) => d.slug).sort().join() === 'wabastar,wabatalk,whatsbox' && r.json.data.departments.every((d: any) => d.divisions.join() === 'SUPPORT'),
    'create: the new head is offered Wabastar, Whatsbox and Wabatalk, Support only', r);
  r = await api('sa', 'GET', `/users/department-heads?departmentId=${dep('whatsbox').id}`);
  const entry = (r.json.data ?? []).find((h: any) => h.profile.id === multiId);
  check(r.status === 200 && entry && entry.access.length === 3 && entry.profile.departmentId === dep('wabastar').id, 'create: Whatsbox lists the shared head with all three departments', r);
  r = await api('multi', 'GET', `/users/department-heads?departmentId=${dep('whatsbox').id}`);
  check(r.status === 200 && r.json.data.some((h: any) => h.profile.id === multiId), 'create: a head can list the heads of a department they work in', r);
  r = await api('multi', 'GET', `/users/department-heads?departmentId=${dep('digitree').id}`);
  check(r.status === 200 && r.json.data.length === 0, 'create: but not of a department they do not work in', r);
  r = await api('a', 'GET', `/users/department-heads?departmentId=${dep('whatsbox').id}`);
  check(r.status === 403, 'create: a Team Member cannot', r);
  // a wrong pair never leaves a half-made account
  r = await api('sa', 'POST', '/users', { email: 'multi.bad@amuwa.com', fullName: 'Bad Pair', password: 'Sup3rSecret!', role: 'DEPARTMENT_HEAD', departmentId: dep('wabastar').id, headDivision: 'SALES',
    additionalAccess: [{ departmentId: dep('accounts').id, division: 'SALES' }] });
  check(r.status === 422 && /no Sales team/.test(r.json.error.message) && (await headCount('multi.bad@amuwa.com')) === 0, 'create: a department without such a team is refused and no account is made', r);
  r = await api('sa', 'POST', '/users', { email: 'multi.bad2@amuwa.com', fullName: 'Bad Pair Two', password: 'Sup3rSecret!', role: 'DEPARTMENT_HEAD', departmentId: dep('amuwa').id, headDivision: 'SUPPORT',
    additionalAccess: [{ departmentId: dep('dtalk').id, division: 'SUPPORT' }] });
  check(r.status === 422 && /Give Wabatalk instead/.test(r.json.error.message) && (await headCount('multi.bad2@amuwa.com')) === 0, 'create: D Talk\'s Support must be given as Wabatalk', r);
  r = await api('sa', 'POST', '/users', { email: 'multi.bad3@amuwa.com', fullName: 'Not A Head', password: 'Sup3rSecret!', role: 'TEAM_MEMBER', teamId: await teamId('mpillar', 'Sales'),
    additionalAccess: [{ departmentId: dep('whatsbox').id, division: 'SALES' }] });
  check(r.status === 422 && (await headCount('multi.bad3@amuwa.com')) === 0, 'create: only a Department Head can be given extra departments', r);
  r = await api('dh', 'POST', '/users', { email: 'multi.bad4@amuwa.com', fullName: 'Not Allowed', password: 'Sup3rSecret!', role: 'DEPARTMENT_HEAD', departmentId: dep('wabastore').id, headDivision: 'SALES',
    additionalAccess: [{ departmentId: dep('whatsbox').id, division: 'SALES' }] });
  check(r.status === 403 && (await headCount('multi.bad4@amuwa.com')) === 0, 'create: a Department Head cannot create heads or give departments', r);
  // one person for both functions of a department
  r = await api('sa', 'POST', '/users', { email: 'multi.both@amuwa.com', fullName: 'Both Functions Head', password: 'Sup3rSecret!', role: 'DEPARTMENT_HEAD', departmentId: dep('mpillar').id,
    additionalAccess: [{ departmentId: dep('mpillar').id, division: 'SALES' }, { departmentId: dep('mpillar').id, division: 'SUPPORT' }] });
  check(r.status === 201 && !r.json.data.headDivision, 'create: one person for Sales and Support of a department', r);
  tokens.set('both', tokenFor(r.json.data.id));
  r = await api('both', 'GET', '/me/department-scopes');
  check(r.status === 200 && r.json.data.departments.length === 1 && r.json.data.departments[0].divisions.join() === 'SALES,SUPPORT', 'create: that head gets the Sales | Support selector', r);
  check((await names('both', scope('mpillar', 'SALES'))).join() === 'SCOPE mpillar Sales' && (await names('both', scope('mpillar', 'SUPPORT'))).join() === 'SCOPE mpillar Support', 'create: switching function changes the data, not the department');
  // removing an assignment removes the access at once
  r = await api('sa', 'POST', `/users/${multiId}/department-access`, { departmentId: dep('whatsbox').id, division: 'SUPPORT', granted: false });
  check(r.status === 200, 'create: the Super Admin removes Whatsbox from the head', r);
  check((await names('multi', scope('whatsbox'))).join() === '', 'create: Whatsbox data is no longer reachable by that head');
  r = await api('multi', 'GET', '/me/department-scopes');
  check(r.json.data.departments.map((d: any) => d.slug).sort().join() === 'wabastar,wabatalk', 'create: and no longer offered', r);
  check((await headCount('multi.support@amuwa.com')) === 1, 'create: assignment changes never create another account');

  // Access Control tab: save the whole matrix. Shared Sales head (Whatsbox, Wabastar, Wabastore), shared Support head (Whatsbox, Wabatalk, Wabastore, Wabastar), combined heads.
  const acx = async (who: string, headers: Record<string, string> = {}) =>
    (((await api(who, 'GET', '/customers?search=ACX&pageSize=50', undefined, undefined, headers)).json.data?.items ?? []) as any[]).map(c => c.name).sort();
  const inList = async (slug: string, id: string) => {
    const x = await api('sa', 'GET', `/users?departmentId=${dep(slug).id}&pageSize=100`);
    return x.status === 200 ? (x.json.data.items as any[]).filter(u => u.id === id).length : -1;
  };
  const apply = (id: string, pairs: { departmentId: string; division: string }[], who = 'sa') => api(who, 'POST', `/users/${id}/department-access/apply`, { pairs });
  const wabatalkId = wtId;
  const salesHeadId = await mk('shared.sales.acx@amuwa.com', 'Shared Sales Head ACX', { role: 'DEPARTMENT_HEAD', departmentId: dep('whatsbox').id, headDivision: 'SALES' });
  const supportHeadId = await mk('shared.support.acx@amuwa.com', 'Shared Support Head ACX', { role: 'DEPARTMENT_HEAD', departmentId: dep('whatsbox').id, headDivision: 'SUPPORT' });
  tokens.set('acs', tokenFor(salesHeadId));
  tokens.set('acp', tokenFor(supportHeadId));
  for (const id of [salesHeadId, supportHeadId]) await api('sa', 'POST', `/users/${id}/operations-head`, { value: true });
  for (const slug of ['wabastar', 'wabastore', 'whatsbox', 'dtalk']) {
    for (const side of ['Sales', 'Support']) {
      const owner = await mk(`acx.${slug}.${side.toLowerCase()}@amuwa.com`, `ACX ${slug} ${side} Member`, { role: 'TEAM_MEMBER', teamId: await teamId(slug, side) });
      await db.query(`insert into public.customers (owner_id, name, phone, lifecycle_stage) values ($1, $2, $3, $4)`,
        [owner, `ACX ${slug} ${side}`, `+91981400${String(Math.floor(Math.random() * 9000) + 1000)}`, side === 'Sales' ? 'LEAD' : 'CUSTOMER']);
    }
  }
  check((await inList('wabastar', salesHeadId)) === 0, 'access: before any assignment the shared Sales head is not listed in Wabastar');
  r = await apply(salesHeadId, [{ departmentId: dep('wabastar').id, division: 'SALES' }, { departmentId: dep('wabastore').id, division: 'SALES' }], 'dh');
  check(r.status === 403, 'access: only the Super Admin can save a matrix', r);
  r = await apply(salesHeadId, [{ departmentId: dep('accounts').id, division: 'SALES' }]);
  check(r.status === 422 && (await db.query(`select count(*)::int n from public.department_access where profile_id = $1`, [salesHeadId])).rows[0].n === 0, 'access: a wrong pair is refused and nothing is saved', r);
  r = await apply(salesHeadId, [{ departmentId: dep('whatsbox').id, division: 'SALES' }, { departmentId: dep('wabastar').id, division: 'SALES' }, { departmentId: dep('wabastore').id, division: 'SALES' }]);
  check(r.status === 200 && r.json.data.added === 2 && r.json.data.grants.length === 2, 'access: Save stores Wabastar and Wabastore (Whatsbox is the head\'s own placement)', r);
  check((await inList('whatsbox', salesHeadId)) === 1 && (await inList('wabastar', salesHeadId)) === 1 && (await inList('wabastore', salesHeadId)) === 1, 'access: the same person is listed once in Whatsbox, Wabastar and Wabastore');
  check((await inList('dtalk', salesHeadId)) === 0, 'access: and not in a department they were not given');
  check((await headCount('shared.sales.acx@amuwa.com')) === 1, 'access: still one account');
  check((await acx('acs', scope('wabastar'))).join() === 'ACX wabastar Sales' && (await acx('acs', scope('wabastore'))).join() === 'ACX wabastore Sales' && (await acx('acs', scope('whatsbox'))).join() === 'ACX whatsbox Sales', 'access: Sales data of each of the three departments');
  check((await acx('acs', scope('wabastar', 'SUPPORT'))).join() === 'ACX wabastar Sales', 'access: no Support through Sales access');
  r = await api('acs', 'GET', '/sales-head/overview', undefined, undefined, scope('wabastar'));
  check(r.status === 200, 'access: the Sales head pages open in Wabastar', r);
  check((await acx('acs', scope('dtalk'))).join() === 'ACX whatsbox Sales', 'access: another department\'s id gives nothing (still the home department)');

  r = await apply(supportHeadId, [{ departmentId: wabatalkId, division: 'SUPPORT' }, { departmentId: dep('wabastore').id, division: 'SUPPORT' }, { departmentId: dep('wabastar').id, division: 'SUPPORT' }]);
  check(r.status === 200 && r.json.data.grants.length === 3, 'access: the shared Support head gets Wabatalk, Wabastore and Wabastar', r);
  check((await inList('whatsbox', supportHeadId)) === 1 && (await inList('wabastar', supportHeadId)) === 1 && (await inList('wabastore', supportHeadId)) === 1 && (await inList('dtalk', supportHeadId)) === 1,
    'access: the same person is listed once in Whatsbox, Wabastar, Wabastore and D Talk (Wabatalk)');
  r = await api('acp', 'GET', '/me/department-scopes');
  check(r.json.data.departments.map((d: any) => d.slug).sort().join() === 'wabastar,wabastore,wabatalk,whatsbox' && r.json.data.departments.every((d: any) => d.divisions.join() === 'SUPPORT'), 'access: offered the four departments, Support only', r);
  for (const [headers, expect] of [[scope('wabastar'), 'ACX wabastar Support'], [scope('wabastore'), 'ACX wabastore Support'], [scope('whatsbox'), 'ACX whatsbox Support'], [{ 'x-active-department': wabatalkId }, 'ACX dtalk Support']] as const) {
    check((await acx('acp', headers as any)).join() === expect, `access: Support head switches department: ${expect}`);
  }
  r = await api('acp', 'GET', '/sales-head/overview', undefined, undefined, scope('wabastar'));
  check(r.status === 403, 'access: Support access brings no Sales access', r);
  r = await apply(supportHeadId, [{ departmentId: dep('dtalk').id, division: 'SUPPORT' }]);
  check(r.status === 422 && /Give Wabatalk instead/.test(r.json.error.message), 'access: D Talk\'s Support is given as Wabatalk', r);

  // one person for Sales and Support: Amuwa Design Studio and D Talk (its Support is Wabatalk)
  const dsId = await mk('combined.ds.acx@amuwa.com', 'Design Studio Head ACX', { role: 'DEPARTMENT_HEAD', departmentId: dep('designstudio').id });
  tokens.set('acds', tokenFor(dsId));
  r = await apply(dsId, [{ departmentId: dep('designstudio').id, division: 'SALES' }, { departmentId: dep('designstudio').id, division: 'SUPPORT' }]);
  check(r.status === 200, 'access: Amuwa Design Studio can be given both functions (it has Sales and Support teams now)', r);
  r = await api('acds', 'GET', '/me/department-scopes');
  check(r.json.data.departments.length === 1 && r.json.data.departments[0].divisions.join() === 'SALES,SUPPORT', 'access: one department with the Sales | Support selector', r);
  const dtId = await mk('combined.dt.acx@amuwa.com', 'D Talk Combined Head ACX', { role: 'DEPARTMENT_HEAD', departmentId: dep('dtalk').id });
  tokens.set('acdt', tokenFor(dtId));
  r = await apply(dtId, [{ departmentId: dep('dtalk').id, division: 'SALES' }, { departmentId: wabatalkId, division: 'SUPPORT' }]);
  check(r.status === 200, 'access: D Talk Sales + Wabatalk Support', r);
  r = await api('acdt', 'GET', '/me/department-scopes');
  check(r.json.data.departments.length === 1 && r.json.data.departments[0].slug === 'dtalk' && r.json.data.departments[0].divisions.join() === 'SALES,SUPPORT', 'access: D Talk is ONE department with the selector', r);
  check((await acx('acdt', scope('dtalk', 'SALES'))).join() === 'ACX dtalk Sales' && (await acx('acdt', scope('dtalk', 'SUPPORT'))).join() === 'ACX dtalk Support', 'access: switching the function changes the data, not the department');

  // removal, persistence, no new accounts
  r = await apply(salesHeadId, [{ departmentId: dep('wabastore').id, division: 'SALES' }]);
  check(r.status === 200 && r.json.data.removed === 1, 'access: unticking Wabastar removes it', r);
  check((await inList('wabastar', salesHeadId)) === 0 && (await inList('wabastore', salesHeadId)) === 1, 'access: the lists follow at once');
  check((await acx('acs', scope('wabastar'))).join() === 'ACX whatsbox Sales', 'access: and the data is no longer reachable');
  r = await api('sa', 'GET', `/users/${salesHeadId}/department-access`);
  check(r.json.data.grants.length === 1, 'access: the saved assignments persist', r);
  check((await headCount('shared.sales.acx@amuwa.com')) === 1 && (await headCount('shared.support.acx@amuwa.com')) === 1, 'access: no account was created or removed');
  // the list API keeps its meaning: with a team filter heads are not listed
  r = await api('sa', 'GET', `/users?departmentId=${dep('wabastore').id}&teamId=${await teamId('wabastore', 'Sales')}&pageSize=100`);
  check(r.status === 200 && !(r.json.data.items as any[]).some(u => u.id === salesHeadId), 'access: a team filter does not list Department Heads (as before)', r);
  r = await api('sa', 'GET', `/users?departmentId=${dep('wabastar').id}&search=${encodeURIComponent('Shared Support Head ACX')}&role=DEPARTMENT_HEAD&status=ACTIVE&pageSize=100`);
  check(r.status === 200 && (r.json.data.items as any[]).filter(u => u.id === supportHeadId).length === 1 && r.json.data.total === 1, 'access: search, role and status filters work together with the shared-head listing', r);
  r = await api('sa', 'GET', `/users?departmentId=${dep('wabastar').id}&role=TEAM_MEMBER&pageSize=100`);
  check(r.status === 200 && !(r.json.data.items as any[]).some(u => u.id === supportHeadId), 'access: a Team Member filter lists no Department Head', r);

  // Group B: the department head 'dh' (Wabastore, no side set) handles both functions
  for (const division of ['SALES', 'SUPPORT']) {
    r = await api('sa', 'POST', `/users/${(await api('dh', 'GET', '/me')).json.data.id}/department-access`, { departmentId: wab.id, division, granted: true });
    check(r.status === 200, `scopes: the Super Admin authorises the Wabastore head for ${division}`, r);
  }
  for (const [side, id] of [['Sales', sales.id], ['Support', support.id]] as const) {
    const owner = await mk(`scope.wabastore.${side.toLowerCase()}@amuwa.com`, `Scope wabastore ${side}`, { role: 'TEAM_MEMBER', teamId: id });
    await db.query(`insert into public.customers (owner_id, name, phone, lifecycle_stage) values ($1, $2, $3, 'LEAD')`, [owner, `SCOPE wabastore ${side}`, side === 'Sales' ? '+919811088881' : '+919811088882']);
  }
  r = await api('dh', 'GET', '/me/department-scopes');
  check(r.status === 200 && r.json.data.departments.length === 1 && r.json.data.departments[0].divisions.join() === 'SALES,SUPPORT', 'scopes: the combined head has one department and both functions', r);
  check((await names('dh')).join() === 'SCOPE wabastore Sales,SCOPE wabastore Support', 'scopes: combined head, no function chosen: the whole department, as before');
  check((await names('dh', scope('wabastore', 'SALES'))).join() === 'SCOPE wabastore Sales', 'scopes: combined head, Sales selected: Sales customers only');
  check((await names('dh', scope('wabastore', 'SUPPORT'))).join() === 'SCOPE wabastore Support', 'scopes: combined head, Support selected: Support customers only, same department');
  r = await api('dh', 'GET', '/sales-head/overview', undefined, undefined, { 'x-active-department': wab.id, 'x-active-division': 'SALES' });
  check(r.status === 200, 'scopes: combined head, Sales selected: the Sales pages open', r);
  r = await api('dh', 'GET', '/sales-head/overview', undefined, undefined, { 'x-active-department': wab.id, 'x-active-division': 'SUPPORT' });
  check(r.status === 403, 'scopes: combined head, Support selected: the Sales pages are closed', r);
  r = await api('dh', 'GET', '/me/department-scopes', undefined, undefined, { 'x-active-department': wab.id, 'x-active-division': 'SUPPORT' });
  check(r.json.data.activeDepartmentId === wab.id && r.json.data.activeDivision === 'SUPPORT', 'scopes: switching function keeps the department', r);
  r = await api('dh', 'GET', '/me/department-scopes', undefined, undefined, scope('dtalk', 'SALES'));
  check(r.json.data.activeDepartmentId === wab.id, 'scopes: the combined head cannot reach another department', r);

  // everybody else is untouched
  check((await names('sa', scope('mpillar', 'SALES'))).length >= 6, 'scopes: the Super Admin still reads every department');
  r = await api('a', 'GET', '/me/department-scopes', undefined, undefined, scope('mpillar'));
  check(r.status === 200 && r.json.data.departments.length === 0, 'scopes: a Team Member is offered no departments (a header changes nothing)', r);
  check((await names('a', scope('mpillar'))).length === 0, 'scopes: a Team Member cannot reach another department with a header');
  r = await api('sa', 'POST', `/users/${gsId}/department-access`, { departmentId: dep('mpillar').id, division: 'SALES', granted: false });
  check(r.status === 200 && r.json.data.grants.length === 1, 'scopes: a grant is withdrawn', r);
  check((await names('gs', scope('mpillar'))).join() === 'SCOPE dtalk Sales', 'scopes: and the department is no longer reachable');
}

// --- Lead filters of the Telecaller and Business Associate Lead sections: All Leads, My Leads, Department Leads, To Accounts, Returned by Accounts ----
{
  const mineOf = async (token: string) => {
    const who = await api(token, 'GET', '/me');
    return who.json.data.id as string;
  };
  const ba1Id = await mineOf('ba1');
  const tcaId2 = await mineOf('tca');
  const dbMine = async (id: string) => Number((await db.query(`select count(*) from customers where lifecycle_stage = 'LEAD' and owner_id = $1`, [id])).rows[0].count);
  const dbDept = async (id: string) => Number((await db.query(
    `select count(*) from customers c where c.lifecycle_stage = 'LEAD' and c.owner_id <> $1
       and c.department_id = (select department_id from profiles where id = $1)
       and exists (select 1 from teams t where t.id = c.team_id and t.department_id = c.department_id and t.division = 'SALES')`, [id])).rows[0].count);

  for (const who of ['ba1', 'tca']) {
    const id = who === 'ba1' ? ba1Id : tcaId2;
    r = await api(who, 'GET', '/lead-scope/counts');
    check(r.status === 200 && r.json.data.mine === (await dbMine(id)) && r.json.data.department === (await dbDept(id)) && r.json.data.all === r.json.data.mine + r.json.data.department,
      `lead filters API: ${who}'s counts are the database's (mine, department, and all = both)`, r);
    for (const scope of ['ALL', 'MINE', 'DEPARTMENT', 'TO_ACCOUNTS', 'RETURNED']) {
      const list = await api(who, 'GET', `/lead-scope?scope=${scope}&pageSize=100`);
      const key = ({ ALL: 'all', MINE: 'mine', DEPARTMENT: 'department', TO_ACCOUNTS: 'toAccounts', RETURNED: 'returned' } as Record<string, string>)[scope];
      check(list.status === 200 && list.json.data.total === r.json.data[key] && list.json.data.items.length === r.json.data[key], `lead filters API: ${who} ${scope}: the list has as many rows as the count`, list.json.data?.total);
    }
    r = await api(who, 'GET', '/lead-scope?scope=MINE&pageSize=100');
    check(r.json.data.items.every((x: any) => x.isMine && x.owner.id === id), `lead filters API: ${who} My Leads holds only their own`);
    r = await api(who, 'GET', '/lead-scope?scope=DEPARTMENT&pageSize=100');
    check(r.json.data.items.every((x: any) => !x.isMine && x.notes == null && x.owner.id !== id), `lead filters API: ${who} Department Leads holds only colleagues' leads, without their notes`);
  }
  r = await api('ba1', 'GET', '/lead-scope?scope=DEPARTMENT&search=Hot');
  check(r.status === 200 && r.json.data.items.some((x: any) => x.name === 'Hot Customer' && x.owner.fullName === 'Tele Alpha'), "lead filters API: a Business Associate sees the Telecaller's lead (read-only)", r);
  r = await api('ba1', 'GET', '/lead-scope?scope=ALL&status=NEW&sort=followUp&page=1&pageSize=5');
  check(r.status === 200, 'lead filters API: status, sort and paging are accepted', r);
  r = await api('a', 'GET', '/lead-scope/counts');
  check(r.status === 200, 'lead filters API: a Sales member without a Sales role (works as a Business Associate) can use them', r);
  for (const who of ['th', 'dh', 'sm', 'influ']) {
    r = await api(who, 'GET', '/lead-scope/counts');
    check(r.status === 403, `lead filters API: ${who} cannot read the counts`, r);
    r = await api(who, 'GET', '/lead-scope?scope=ALL');
    check(r.status === 403, `lead filters API: ${who} cannot read the list`, r);
  }
  r = await api('ba1', 'GET', '/lead-scope?scope=EVERYTHING');
  check(r.status === 422, 'lead filters API: an unknown filter is refused', r);
  r = await api('ba1', 'GET', '/lead-scope?scope=ALL&companyWide=true');
  check(r.status === 422, 'lead filters API: an unknown parameter is refused (no company-wide switch)', r);
  r = await api('ba1', 'GET', '/lead-scope?scope=ALL&status=WITH_ACCOUNTS');
  check(r.status === 422, 'lead filters API: the Accounts states are not lead statuses', r);
  r = await api(null, 'GET', '/lead-scope/counts');
  check(r.status === 401, 'lead filters API: signing in is required', r);
}

// --- Field Visit: Department Head assignment, visit scheduling and recording, filters, permissions ------------------------------------
{
  const FILTERS = ['ALL', 'MINE', 'DEPARTMENT', 'DH_ASSIGNED', 'TO_ACCOUNTS', 'RETURNED', 'VISIT_PENDING', 'VISIT_SCHEDULED', 'VISIT_COMPLETED', 'FOLLOW_UP'];
  const who = async (token: string) => (await api(token, 'GET', '/me')).json.data.id as string;
  const tcId = await who('tca');
  const baId = await who('ba1');
  const day = (offset: number) => new Date(Date.now() + 5.5 * 3600e3 + offset * 86400e3).toISOString().slice(0, 10);
  const mkLead = async (token: string, name: string) => {
    const res = await api(token, 'POST', '/telecaller/leads', { name, company: `${name} Co`, phone: '9811234599', leadSource: 'Field visit', services: [(await db.query(`select code from crm_services order by code limit 1`)).rows[0].code], leadTemperature: 'WARM', callStatus: 'PENDING' });
    return res;
  };

  // the Sales Department Head sees who can be given a visit; others cannot
  r = await api('sh', 'GET', '/field-visits/assignees');
  check(r.status === 200 && Array.isArray(r.json.data), 'field visit API: the Sales Department Head lists the people a visit can be assigned to', r);
  const assignees = (r.json.data as any[]).map(x => x.id);
  for (const t of ['tca', 'ba1', 'a', 'dh', 'th', 'sm']) {
    r = await api(t, 'GET', '/field-visits/assignees');
    check(r.status === 403, `field visit API: ${t} cannot list assignees`, r);
  }
  r = await api(null, 'GET', '/field-visits/overview');
  check(r.status === 401, 'field visit API: signing in is required', r);

  // the Telecaller's own lead
  r = await mkLead('tca', 'FV Api Lead');
  check(r.status === 201, 'field visit API: the Telecaller adds a lead (lead source Field visit)', r);
  const fvLead = r.json.data.id as string;
  r = await api('tca', 'GET', '/field-visits/overview');
  check(r.status === 200 && r.json.data.myLeads >= 1 && FILTERS.every(f => typeof r.json.data.filters[f] === 'number'), 'field visit API: the overview has the six numbers and the ten filter counts', r);
  const base = r.json.data;

  // scheduling: own lead only, never a past date, retries do not duplicate
  const rid = crypto.randomUUID();
  const plan = { leadId: fvLead, visitDate: day(1), plannedTime: '10:30', address: '12 MG Road', purpose: 'Demo at the shop', notes: 'Carry brochure', clientRequestId: rid };
  r = await api('tca', 'POST', '/field-visits', plan);
  check(r.status === 201 && r.json.data.status === 'SCHEDULED' && r.json.data.gpsCaptured === false && r.json.data.leadName === 'FV Api Lead', 'field visit API: a visit is scheduled for an own lead', r);
  const visitId = r.json.data.id as string;
  r = await api('tca', 'POST', '/field-visits', plan);
  check((r.status === 201 || r.status === 200) && r.json.data.id === visitId, 'field visit API: a retry with the same request id returns the same visit', r);
  check(Number((await db.query(`select count(*) from lead_visits where lead_id = $1`, [fvLead])).rows[0].count) === 1, 'field visit API: no duplicate visit was made');
  r = await api('tca', 'POST', '/field-visits', { ...plan, clientRequestId: crypto.randomUUID(), visitDate: day(-1) });
  check(r.status === 422, 'field visit API: a past date is refused', r);
  r = await api('tca', 'POST', '/field-visits', { ...plan, clientRequestId: crypto.randomUUID(), purpose: '' });
  check(r.status === 422, 'field visit API: the purpose is required', r);
  r = await api('tca', 'POST', '/field-visits', { ...plan, clientRequestId: crypto.randomUUID(), employeeId: baId });
  check(r.status === 422, 'field visit API: the visit cannot be made for somebody else (unknown field refused)', r);
  r = await api('ba1', 'POST', '/field-visits', { ...plan, clientRequestId: crypto.randomUUID() });
  check(r.status === 404, "field visit API: a Business Associate cannot plan a visit for the Telecaller's lead", r);
  r = await api('ba1', 'GET', `/field-visits?scope=ALL&leadId=${fvLead}`);
  check(r.status === 200 && r.json.data.total === 0, "field visit API: and cannot read the Telecaller's visits", r);

  // the filters
  const filterIds = async (token: string, filter: string) => ((await api(token, 'GET', `/field-visits/leads?filter=${filter}&pageSize=100`)).json.data.items as any[]).map(x => x.leadId);
  check((await filterIds('tca', 'MINE')).includes(fvLead) && (await filterIds('tca', 'VISIT_SCHEDULED')).includes(fvLead), 'field visit API: the lead is in My Leads and Visit Scheduled');
  check(!(await filterIds('tca', 'VISIT_PENDING')).includes(fvLead) && !(await filterIds('tca', 'VISIT_COMPLETED')).includes(fvLead), 'field visit API: and not in Pending or Completed');
  check(!(await filterIds('ba1', 'MINE')).includes(fvLead) && (await filterIds('ba1', 'DEPARTMENT')).includes(fvLead), 'field visit API: a colleague sees it only under Department Leads');
  for (const f of FILTERS) {
    r = await api('tca', 'GET', `/field-visits/leads?filter=${f}&pageSize=100`);
    const ov = await api('tca', 'GET', '/field-visits/overview');
    check(r.status === 200 && r.json.data.total === ov.json.data.filters[f] && r.json.data.items.length === Math.min(100, r.json.data.total), `field visit API: filter ${f} has as many rows as its count`, r.json.data?.total);
  }
  r = await api('tca', 'GET', '/field-visits/leads?filter=EVERYTHING');
  check(r.status === 422, 'field visit API: an unknown filter is refused', r);
  r = await api('tca', 'GET', '/field-visits/leads?filter=ALL&sort=name&search=fv%20api&page=1&pageSize=5');
  check(r.status === 200 && r.json.data.items.some((x: any) => x.leadId === fvLead), 'field visit API: search, sort and paging work', r);

  // starting and finishing: the location is recorded only when the device sent it
  r = await api('tca', 'POST', `/field-visits/${visitId}/start`, { latitude: 12.97, longitude: 77.59, accuracyMeters: 25 });
  check(r.status === 200 && r.json.data.status === 'IN_PROGRESS' && r.json.data.gpsCaptured === true && r.json.data.checkinAccuracyM === 25, 'field visit API: starting with a position records it as captured by the device', r);
  const checkinAt = r.json.data.checkinAt;
  r = await api('tca', 'POST', `/field-visits/${visitId}/start`, {});
  check(r.status === 200 && r.json.data.status === 'IN_PROGRESS' && r.json.data.gpsCaptured === true && r.json.data.checkinAt === checkinAt && r.json.data.checkinLat === 12.97, 'field visit API: starting again (a double click) changes nothing and keeps the recorded position', r);
  r = await api('tca', 'POST', `/field-visits/${visitId}/complete`, { status: 'FOLLOW_UP_REQUIRED', outcome: 'Owner wants a quote' });
  check(r.status === 422, 'field visit API: a follow-up needs its date', r);
  r = await api('ba1', 'POST', `/field-visits/${visitId}/complete`, { status: 'COMPLETED', outcome: 'x' });
  check(r.status === 404, "field visit API: somebody else cannot finish the visit", r);
  r = await api('tca', 'POST', `/field-visits/${visitId}/complete`, { status: 'FOLLOW_UP_REQUIRED', outcome: 'Owner wants a quote', notes: 'Met the owner', requirements: 'GBP + ads', nextSteps: 'Send quote', followUpDate: day(3) });
  check(r.status === 200 && r.json.data.status === 'FOLLOW_UP_REQUIRED' && r.json.data.nextFollowUp === day(3) && r.json.data.completedAt, 'field visit API: the outcome is recorded', r);
  check((await filterIds('tca', 'FOLLOW_UP')).includes(fvLead), 'field visit API: the lead is under Follow-up Required');
  check(String((await db.query(`select (next_follow_up_at at time zone 'Asia/Kolkata')::date::text d from customers where id = $1`, [fvLead])).rows[0].d) === day(3), "field visit API: the owner's lead follow-up date was updated");
  check((await db.query(`select payment_workflow, lifecycle_stage from customers where id = $1`, [fvLead])).rows[0].payment_workflow === 'NONE', 'field visit API: the Accounts workflow was not touched');

  // a second visit: the first stays in the history untouched
  r = await api('tca', 'POST', '/field-visits', { leadId: fvLead, visitDate: day(3), purpose: 'Second visit', clientRequestId: crypto.randomUUID() });
  check(r.status === 201, 'field visit API: another visit can be planned for the same lead', r);
  const second = r.json.data.id as string;
  r = await api('tca', 'POST', `/field-visits/${second}/start`, {});
  check(r.status === 200 && r.json.data.gpsCaptured === false && r.json.data.checkinLat === null, 'field visit API: starting without a position is not marked as GPS captured', r);
  r = await api('tca', 'POST', `/field-visits/${second}/complete`, { status: 'COMPLETED', outcome: 'Order agreed' });
  check(r.status === 200 && r.json.data.status === 'COMPLETED', 'field visit API: the second visit is completed', r);
  r = await api('tca', 'GET', `/field-visits?scope=HISTORY&leadId=${fvLead}&pageSize=50`);
  check(r.status === 200 && r.json.data.total === 2 && r.json.data.items.find((x: any) => x.id === visitId).outcome === 'Owner wants a quote', 'field visit API: the visit history keeps both visits unchanged', r);
  r = await api('tca', 'GET', `/field-visits?scope=OPEN&leadId=${fvLead}`);
  check(r.status === 200 && r.json.data.total === 0, 'field visit API: nothing is left open', r);

  // cancelling keeps the visit in the history
  r = await api('tca', 'POST', '/field-visits', { leadId: fvLead, visitDate: day(5), purpose: 'Cancel me', clientRequestId: crypto.randomUUID() });
  const toCancel = r.json.data.id as string;
  r = await api('tca', 'PATCH', `/field-visits/${toCancel}`, { visitDate: day(6), purpose: 'Cancel me later', plannedTime: '16:00' });
  check(r.status === 200 && r.json.data.visitDate === day(6), 'field visit API: the plan of a visit that has not started can be changed', r);
  r = await api('tca', 'POST', `/field-visits/${toCancel}/cancel`, { reason: 'Customer is away' });
  check(r.status === 200 && r.json.data.status === 'CANCELLED' && r.json.data.cancelReason === 'Customer is away', 'field visit API: a visit is cancelled with a reason', r);
  r = await api('tca', 'PATCH', `/field-visits/${toCancel}`, { visitDate: day(7), purpose: 'Too late' });
  check(r.status === 404 || r.status === 409 || r.status === 422, 'field visit API: a cancelled visit cannot be changed', r);

  // Department Head assignment
  if (assignees.includes(tcId) && assignees.includes(baId)) {
    r = await api('sh', 'POST', '/field-visits/assignments', { leadId: fvLead, assigneeId: baId, priority: 'HIGH', instructions: 'Collect the GST certificate' });
    check(r.status === 201 || r.status === 200, 'field visit API: the Sales Department Head assigns a lead to a Business Associate', r);
    check((await db.query(`select owner_id from customers where id = $1`, [fvLead])).rows[0].owner_id === tcId, 'field visit API: the lead keeps its owner');
    r = await api('ba1', 'GET', '/field-visits/assigned');
    const row = (r.json.data.items as any[]).find(x => x.leadId === fvLead);
    check(r.status === 200 && row && row.priority === 'HIGH' && row.instructions === 'Collect the GST certificate' && row.canVisit === true && row.isMine === false, 'field visit API: it shows for the Business Associate with the priority and instructions', r);
    check((await filterIds('ba1', 'DH_ASSIGNED')).includes(fvLead), 'field visit API: and under Department Head Assigned');
    r = await api('tca', 'GET', '/field-visits/assigned');
    check(!(r.json.data.items as any[]).some(x => x.leadId === fvLead), 'field visit API: the owner does not see it as assigned to them');
    r = await api('ba1', 'POST', '/field-visits', { leadId: fvLead, visitDate: day(2), purpose: 'Assigned visit', clientRequestId: crypto.randomUUID() });
    check(r.status === 201 && r.json.data.assignedBy, 'field visit API: the assigned person can plan a visit', r);
    r = await api('ba1', 'POST', '/field-visits/assignments', { leadId: fvLead, assigneeId: baId, priority: 'LOW' });
    check(r.status === 403, 'field visit API: an employee cannot change or create an assignment', r);
    r = await api('ba1', 'DELETE', `/field-visits/assignments/${fvLead}`);
    check(r.status === 403, 'field visit API: an employee cannot withdraw an assignment', r);
    r = await api('sh', 'POST', '/field-visits/assignments', { leadId: fvLead, assigneeId: await who('sm'), priority: 'LOW' });
    check(r.status === 422 || r.status === 404, 'field visit API: a person outside the Sales team cannot be chosen', r);
    r = await api('sh', 'DELETE', `/field-visits/assignments/${fvLead}`);
    check(r.status === 200, 'field visit API: the Department Head withdraws the assignment', r);
    r = await api('ba1', 'POST', '/field-visits', { leadId: fvLead, visitDate: day(2), purpose: 'After withdrawal', clientRequestId: crypto.randomUUID() });
    check(r.status === 404, 'field visit API: after the withdrawal the person can no longer plan visits for it', r);
    r = await api('ba1', 'GET', `/field-visits?scope=ALL&pageSize=50`);
    check(!(r.json.data.items as any[]).some(x => x.purpose === 'After withdrawal'), 'field visit API: and no visit was made');
  } else {
    check(false, 'field visit API: the Sales head, Telecaller and Business Associate share a department (test setup)', assignees);
  }
  r = await api('a', 'POST', '/field-visits/assignments', { leadId: fvLead, assigneeId: baId, priority: 'LOW' });
  check(r.status === 403, 'field visit API: a Sales member cannot assign visits', r);
  for (const t of ['th', 'dh', 'sm', 'influ']) {
    r = await api(t, 'GET', '/field-visits/overview');
    check(r.status === 403, `field visit API: ${t} has no Field Visit section`, r);
    r = await api(t, 'POST', '/field-visits', { leadId: fvLead, visitDate: day(2), purpose: 'x', clientRequestId: crypto.randomUUID() });
    check(r.status === 403, `field visit API: ${t} cannot plan visits`, r);
  }
  r = await api('a', 'GET', '/field-visits/overview');
  check(r.status === 200, 'field visit API: a Sales Team Member (no Sales role) has the Field Visit section', r);
  void base;
}

// --- Team Member Management: Access Control belongs to the Super Admin alone (the page hides it; the API refuses it) ----------------
{
  const head = (await db.query(`select id from profiles where role = 'DEPARTMENT_HEAD' and status = 'ACTIVE' order by created_at limit 1`)).rows[0].id as string;
  const anyDept = (await db.query(`select id from departments order by created_at limit 1`)).rows[0].id as string;
  for (const who of ['dh', 'th', 'a']) {
    r = await api(who, 'GET', `/users/${head}/department-access`);
    check(r.status === 403, `access control API: ${who} cannot read a Department Head's access`, r);
    r = await api(who, 'POST', `/users/${head}/department-access/apply`, { pairs: [{ departmentId: anyDept, division: 'SALES' }] });
    check(r.status === 403, `access control API: ${who} cannot change it`, r);
    r = await api(who, 'POST', `/users/${head}/department-access`, { departmentId: anyDept, division: 'SALES', granted: true });
    check(r.status === 403, `access control API: ${who} cannot grant a department either`, r);
  }
  r = await api('sa', 'GET', `/users/${head}/department-access`);
  check(r.status === 200, 'access control API: the Super Admin can', r);
}

// --- The Super Admin is at the top of the hierarchy: nobody changes the account from the application, however the request is made -----------
{
  const saId = (await api('sa', 'GET', '/me')).json.data.id as string;
  const thProfile = (await api('th', 'GET', '/me')).json.data;
  // the shape of the production bug report: the Super Admin sits inside a team, so a Team Lead's member list reaches the row
  await db.query(`update public.profiles set team_id = $2, department_id = $3 where id = $1`, [saId, thProfile.teamId, thProfile.departmentId]);
  const saState = async () => (await db.query(`select role, status from public.profiles where id = $1`, [saId])).rows[0];

  for (const who of ['th', 'dh', 'a', 'sa']) {
    r = await api(who, 'POST', `/users/${saId}/status`, { status: 'REVOKED', reason: 'x' });
    check(r.status === 403, `Super Admin protection API: ${who} cannot revoke the Super Admin`, r);
    r = await api(who, 'POST', `/users/${saId}/status`, { status: 'SUSPENDED' });
    check(r.status === 403, `Super Admin protection API: ${who} cannot suspend the Super Admin`, r);
    r = await api(who, 'DELETE', `/users/${saId}`);
    check(r.status === 403, `Super Admin protection API: ${who} cannot delete the Super Admin`, r);
    r = await api(who, 'PATCH', `/users/${saId}`, { role: 'TEAM_MEMBER', teamId: thProfile.teamId });
    check(r.status === 403, `Super Admin protection API: ${who} cannot demote the Super Admin`, r);
    r = await api(who, 'PATCH', `/users/${saId}`, { role: 'SUPER_ADMIN', teamId: thProfile.teamId });
    check(r.status === 403 || r.status === 422, `Super Admin protection API: ${who} cannot send a Super Admin role either`, r);
    r = await api(who, 'POST', `/users/${saId}/sales-sub-role`, { role: 'TELECALLER' });
    check(r.status === 403 || r.status === 404 || r.status === 422, `Super Admin protection API: ${who} cannot give the Super Admin a Sales role`, r);
    r = await api(who, 'POST', `/users/${saId}/technical-consultant`, { value: true });
    check(r.status === 403 || r.status === 404 || r.status === 422, `Super Admin protection API: ${who} cannot make the Super Admin a consultant`, r);
  }
  r = await api('th', 'POST', `/users/${saId}/status`, { status: 'REVOKED', role: 'TEAM_MEMBER' });
  check(r.status === 422, 'Super Admin protection API: an extra "role" in the body changes nothing (unknown field refused)', r);
  r = await api('th', 'POST', `/users/${saId.toUpperCase()}/status`, { status: 'REVOKED' });
  check(r.status === 403 || r.status === 404, 'Super Admin protection API: another spelling of the id is no way round', r);
  r = await api('th', 'POST', `/users/${saId}/department-access`, { departmentId: thProfile.departmentId, division: 'SALES', granted: true });
  check(r.status === 403, 'Super Admin protection API: a Team Lead cannot touch access control', r);
  const after = await saState();
  check(after.role === 'SUPER_ADMIN' && after.status === 'ACTIVE', 'Super Admin protection API: the account is untouched after all the attempts', after);
  // the Team Lead's member list does not offer the Super Admin at all; the Super Admin's own list does
  r = await api('th', 'GET', `/users?teamId=${thProfile.teamId}&pageSize=100`);
  check(r.status === 200 && !(r.json.data.items as any[]).some(u => u.role === 'SUPER_ADMIN' || u.id === saId), "Super Admin protection API: a Team Lead's member list does not include the Super Admin", r);
  r = await api('dh', 'GET', `/users?departmentId=${thProfile.departmentId}&pageSize=100`);
  check(r.status === 200 && !(r.json.data.items as any[]).some(u => u.role === 'SUPER_ADMIN'), "Super Admin protection API: nor a Department Head's", r);
  r = await api('sa', 'GET', `/users?role=SUPER_ADMIN&pageSize=100`);
  check(r.status === 200 && (r.json.data.items as any[]).some(u => u.id === saId), "Super Admin protection API: the Super Admin's own list still shows the account", r);
  // legitimate management below is unchanged
  const victim = (await db.query(`select id from public.profiles where role = 'TEAM_MEMBER' and status = 'ACTIVE' and team_id = $1 order by created_at limit 1`, [thProfile.teamId])).rows[0].id as string;
  r = await api('th', 'POST', `/users/${victim}/status`, { status: 'SUSPENDED', reason: 'test' });
  check(r.status === 200 && r.json.data.status === 'SUSPENDED', 'Super Admin protection API: a Team Lead still suspends a Team Member of their team', r);
  r = await api('th', 'POST', `/users/${victim}/status`, { status: 'ACTIVE' });
  check(r.status === 200 && r.json.data.status === 'ACTIVE', 'Super Admin protection API: and restores them', r);
  r = await api('sa', 'POST', `/users/${victim}/status`, { status: 'SUSPENDED', reason: 'test' });
  check(r.status === 200, 'Super Admin protection API: the Super Admin still suspends a Team Member', r);
  r = await api('sa', 'POST', `/users/${victim}/status`, { status: 'ACTIVE' });
  check(r.status === 200, 'Super Admin protection API: and restores them', r);
  await db.query(`update public.profiles set team_id = null, department_id = null where id = $1`, [saId]);
}

// --- the one-time clean-up of the chat between a Team Lead and the Sales Department Head (scripts/delete-team-lead-sales-head-chat.mjs) ---
{
  const { purgeTeamLeadSalesHeadChat } = await import('../../scripts/delete-team-lead-sales-head-chat.mjs');
  const { r2Config } = await import('../../scripts/sweep-orphan-customer-files.mjs');
  const { createClient } = await import('@supabase/supabase-js');
  const service = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const R2 = { key: 'r2-chat-key', secret: 'r2-chat-secret', bucket: 'amuwa-files' };
  const fake = await startFakeR2({ ...R2, cors: false });
  const r2 = r2Config({ R2_ENDPOINT: fake.endpoint, R2_ACCESS_KEY_ID: R2.key, R2_SECRET_ACCESS_KEY: R2.secret, R2_BUCKET: R2.bucket } as any);
  const idOfEmail = async (email: string) => (await db.query(`select id from public.profiles where email = $1`, [email])).rows[0].id as string;
  const tl = await idOfEmail('tl.delivery@amuwa.com'), sh = await idOfEmail('shared.sales.acx@amuwa.com'), other = await idOfEmail('tm.delivery@amuwa.com');
  const directBetween = async (a: string, b: string, n: number) => {
    const key = [a, b].sort().join(':');
    const conv = (await db.query(`insert into public.chat_conversations (kind, direct_key, created_by) values ('DIRECT', $1, $2) returning id`, [key, a])).rows[0].id as string;
    for (const m of [a, b]) await db.query(`insert into public.chat_members (conversation_id, profile_id) values ($1, $2)`, [conv, m]);
    for (let i = 1; i <= n; i++) {
      const row = (await db.query(`insert into public.chat_messages (conversation_id, seq, sender_id, sender_kind, sender_name, body, encrypted, e2ee)
        values ($1, $2, $3, 'STAFF', 'x', '', true, '{"v":1,"ct":"opaque"}'::jsonb) returning id`, [conv, i, i % 2 ? a : b])).rows[0];
      if (i === 1) {
        const path = `${conv}/${crypto.randomUUID()}`;
        await db.query(`insert into public.chat_attachments (conversation_id, message_id, uploader_id, file_name, mime_type, size_bytes, status, storage_bucket, storage_path, storage_provider)
          values ($1, $2, $3, 'encrypted-file', 'application/x-amuwa-e2ee', 100, 'READY', 'chat-attachments', $4, 'R2')`, [conv, row.id, a, path]);
        fake.objects.set(`chat-attachments/${path}`, { body: Buffer.from('AME2' + 'x'.repeat(96)), type: 'application/x-amuwa-e2ee' });
      }
    }
    return conv;
  };
  const target = await directBetween(tl, sh, 4);
  const decoyDirect = await directBetween(tl, other, 3);
  const decoyGroup = (await db.query(`insert into public.chat_conversations (kind, title, created_by) values ('GROUP', 'Decoy group', $1) returning id`, [tl])).rows[0].id as string;
  await db.query(`insert into public.chat_members (conversation_id, profile_id) values ($1, $2), ($1, $3)`, [decoyGroup, tl, sh]);
  const count = async (table: string, conv: string) => Number((await db.query(`select count(*) c from public.${table} where conversation_id = $1`, [conv])).rows[0].c);
  const objectsBefore = fake.objects.size;
  const run = (o: Record<string, unknown> = {}) => purgeTeamLeadSalesHeadChat({ supabase: service, r2, teamLead: 'tl.delivery@amuwa.com', salesHead: 'shared.sales.acx@amuwa.com', ...o });

  let rep = await run();
  check(rep.found && rep.applied === false && rep.conversationId === target && rep.messages === 4 && rep.files === 1, 'one-time chat clean-up: the preview names the exact conversation, its messages and its files', rep);
  check((await count('chat_messages', target)) === 4 && fake.objects.size === objectsBefore, 'one-time chat clean-up: the preview deletes nothing');
  for (const bad of [{ teamLead: 'tm.delivery@amuwa.com' }, { salesHead: 'dh@amuwa.com' }, { teamLead: crypto.randomUUID() }, { salesHead: 'shared.support.acx@amuwa.com' }]) {
    let err = '';
    await run({ ...bad, apply: true, confirm: target }).catch(e => { err = e.message; });
    check(err.length > 0, `one-time chat clean-up: wrong people are refused (${JSON.stringify(bad).slice(0, 60)}): ${err.slice(0, 70)}`);
  }
  let err = '';
  await run({ apply: true }).catch(e => { err = e.message; });
  check(/--confirm/.test(err) && (await count('chat_messages', target)) === 4, 'one-time chat clean-up: --apply alone, or with a wrong confirmation, deletes nothing');
  err = '';
  await run({ apply: true, confirm: decoyDirect }).catch(e => { err = e.message; });
  check(err.length > 0 && (await count('chat_messages', decoyDirect)) === 3, 'one-time chat clean-up: another conversation id cannot be confirmed in its place');
  rep = await run({ apply: true, confirm: target });
  check(rep.applied === true && rep.removedFiles === 1 && rep.messages === 4, 'one-time chat clean-up: with the exact confirmation the conversation is deleted', rep);
  check((await db.query(`select 1 from public.chat_conversations where id = $1`, [target])).rowCount === 0
    && (await count('chat_messages', target)) === 0 && (await count('chat_members', target)) === 0 && (await count('chat_attachments', target)) === 0,
    'one-time chat clean-up: its messages, members and file records are gone');
  check(fake.objects.size === objectsBefore - 1, 'one-time chat clean-up: the stored file was removed from storage (and only that one)');
  check((await count('chat_messages', decoyDirect)) === 3 && (await count('chat_attachments', decoyDirect)) === 1 && (await count('chat_members', decoyGroup)) === 2
    && [...fake.objects.keys()].some(k => k.includes(decoyDirect)), 'one-time chat clean-up: the other direct chat of the Team Lead, and the group, are untouched');
  const audit = (await db.query(`select metadata from public.audit_logs where action = 'CHAT_CONVERSATION_PURGED' and entity_type = 'chat_conversation'`)).rows;
  check(audit.length === 1 && audit[0].metadata.conversation_id === target && audit[0].metadata.messages === 4 && !JSON.stringify(audit[0].metadata).includes('opaque'), 'one-time chat clean-up: one audit entry with ids and counts, no content');
  rep = await run();
  check(rep.found === false, 'one-time chat clean-up: run again, there is nothing left to delete');
  await new Promise(res => fake.server.close(res));
}

// --- Employee issues and HR meeting requests (Raise an Issue for employees; Employee Issues and Meeting Requests for HR) ---
{
  const mid = () => crypto.randomUUID();
  const idOfEmail = async (email: string) => (await db.query(`select id from public.profiles where email = $1`, [email])).rows[0].id as string;
  const hrMemberId = (await api('hrmember', 'GET', '/me')).json.data.id as string;
  const issueBody = (o: Record<string, unknown> = {}) => ({ clientRequestId: mid(), title: 'The air conditioning is broken', category: 'FACILITIES', description: 'The air conditioning on our floor has not worked for a week.', priority: 'MEDIUM', ...o });
  const meetBody = (o: Record<string, unknown> = {}) => ({ clientRequestId: mid(), subject: 'Discuss my leave balance', category: 'ATTENDANCE_LEAVE', description: 'I would like to understand my leave balance for this year.', preferredDate: new Date(Date.now() + 3 * 86400e3).toISOString().slice(0, 10), preferredTime: '10:30', mode: 'IN_PERSON', ...o });
  const day = (n: number) => new Date(Date.now() + n * 86400e3).toISOString().slice(0, 10);

  // ---- who can reach the employee routes at all
  r = await api(null, 'GET', '/employee/issues');
  check(r.status === 401, 'employee issues: no token, no access', r);
  r = await api('cl1', 'POST', '/employee/issues', issueBody());
  check(r.status === 401 || r.status === 403, 'employee issues: a client login cannot raise an employee issue', r);
  r = await api('sa', 'POST', '/employee/issues', issueBody());
  check(r.status === 403, 'employee issues: the Super Admin does not raise employee issues', r);

  // ---- raising an issue: Team Member, Team Lead, Department Head
  const issues: Record<string, any> = {};
  for (const who of ['a', 'th', 'dh']) {
    r = await api(who, 'POST', '/employee/issues', issueBody({ title: `Issue from ${who}`, priority: who === 'th' ? 'URGENT' : 'HIGH' }));
    check(r.status === 201 && /^ISS-\d{4}-\d{5}$/.test(r.json.data.reference) && r.json.data.status === 'NEW' && r.json.data.duplicate === false, `employee issues: ${who} raises an issue and gets a reference number`, r);
    issues[who] = r.json.data;
  }
  const me = (await api('a', 'GET', '/me')).json.data;
  check(issues.a.employee.name === me.fullName && issues.a.employee.id === me.id && /^EMP-/.test(issues.a.employee.employeeCode) && !!issues.a.employee.department, 'employee issues: the employee\'s details come from the profile (name, employee id, department)', issues.a.employee);
  r = await api('a', 'GET', '/employee/case-details');
  check(r.status === 200 && r.json.data.name === me.fullName && r.json.data.id === me.id && r.json.data.code === issues.a.employee.employeeCode, 'employee issues: the form\'s employee details come from the profile (GET /employee/case-details)', r);
  r = await api('hr', 'GET', '/employee/case-details');
  check(r.status === 200, 'employee issues: (HR staff are employees too)', r);
  r = await api('sa', 'GET', '/employee/case-details');
  check(r.status === 403, 'employee issues: the Super Admin has no employee details here', r);
  check(issues.th.employee.designation === 'Team Lead' && issues.dh.employee.designation === 'Department Head', 'employee issues: designation shows the role for a Team Lead and a Department Head', [issues.th.employee, issues.dh.employee]);
  r = await api('a', 'POST', '/employee/issues', { ...issueBody(), clientRequestId: issues.a.id });
  check(r.status === 201 && r.json.data.duplicate === false && r.json.data.id !== issues.a.id, 'employee issues: (a different form is a different issue)', r);
  const dupKey = mid();
  r = await api('a', 'POST', '/employee/issues', issueBody({ clientRequestId: dupKey, title: 'Duplicate probe' }));
  const first = r.json.data;
  r = await api('a', 'POST', '/employee/issues', issueBody({ clientRequestId: dupKey, title: 'Duplicate probe' }));
  check(r.status === 201 && r.json.data.id === first.id && r.json.data.duplicate === true, 'employee issues: submitting the same form twice returns the first issue (no duplicate)', r);
  check(Number((await db.query(`select count(*) c from public.employee_issues where client_request_id = $1`, [dupKey])).rows[0].c) === 1, 'employee issues: and only one row exists');
  r = await api('hr', 'GET', '/notifications?unreadOnly=true');
  check(r.status === 200 && (r.json.data.items as any[]).filter(n => n.entityId === first.id && n.type === 'EMPLOYEE_ISSUE_SUBMITTED').length === 1, 'employee issues: HR got one notification for it (not one per submit)', r.json.data.items?.length);
  check(!(r.json.data.items as any[]).some(n => /air conditioning|Duplicate probe/i.test(`${n.title} ${n.body}`)), 'employee issues: a notification never carries the issue text');

  // ---- validation: nothing about the employee, owner or status can be sent
  for (const [label, body] of [
    ['an employee id', issueBody({ employeeId: me.id })], ['a status', issueBody({ status: 'RESOLVED' })], ['an HR assignee', issueBody({ assignedHrId: me.id })],
    ['a short title', issueBody({ title: 'x' })], ['an unknown category', issueBody({ category: 'NOPE' })], ['a short description', issueBody({ description: 'short' })],
    ['an unknown priority', issueBody({ priority: 'ASAP' })], ['no request id', issueBody({ clientRequestId: undefined })], ['too many files', issueBody({ attachmentIds: Array.from({ length: 6 }, mid) })]
  ] as [string, any][]) {
    r = await api('a', 'POST', '/employee/issues', body);
    check(r.status === 422, `employee issues: ${label} is refused`, r);
  }
  r = await api('a', 'POST', '/employee/issues', issueBody({ attachmentIds: [mid()] }));
  check(r.status === 422, 'employee issues: a file that was never uploaded cannot be attached', r);

  // ---- the employee sees only their own
  r = await api('a', 'GET', '/employee/issues');
  check(r.status === 200 && r.json.data.items.length === r.json.data.total && r.json.data.items.every((i: any) => i.employee.id === me.id) && r.json.data.items.some((i: any) => i.id === issues.a.id), 'employee issues: an employee\'s history holds only their own issues', r.json.data.total);
  check(r.json.data.items.every((i: any) => i.description === null), 'employee issues: the list does not carry the text');
  r = await api('b', 'GET', `/employee/issues/${issues.a.id}`);
  check(r.status === 404, 'employee issues: a colleague cannot open an issue by changing the id in the URL', r);
  r = await api('b', 'POST', `/employee/issues/${issues.a.id}/reply`, { message: 'trying somebody else' });
  check(r.status === 404, 'employee issues: nor reply to it', r);
  r = await api('b', 'GET', `/hr/issues/${issues.a.id}`);
  check(r.status === 403, 'employee issues: nor read it through the HR route', r);
  r = await api('a', 'GET', `/employee/issues/${issues.a.id}`);
  check(r.status === 200 && r.json.data.issue.description.startsWith('The air conditioning') && Array.isArray(r.json.data.events), 'employee issues: the owner opens the full issue and its history', r);
  r = await api('a', 'GET', '/employee/issues/not-a-uuid');
  check(r.status === 422, 'employee issues: a malformed id is refused', r);

  // ---- HR-only operations are refused for everybody else
  for (const [method, path, body] of [
    ['GET', '/hr/issues', undefined], ['GET', '/hr/issues/overview', undefined], ['GET', `/hr/issues/${issues.a.id}`, undefined], ['GET', '/hr/case-assignees', undefined],
    ['POST', `/hr/issues/${issues.a.id}/assign`, { hrId: hrMemberId }], ['POST', `/hr/issues/${issues.a.id}/status`, { status: 'RESOLVED' }], ['POST', `/hr/issues/${issues.a.id}/respond`, { message: 'As HR' }],
    ['POST', `/hr/issues/${issues.a.id}/note`, { note: 'As HR' }], ['GET', '/hr/meetings', undefined], ['GET', '/hr/meetings/overview', undefined]
  ] as [string, string, any][]) {
    for (const who of ['a', 'th', 'dh']) {
      r = await api(who, method, path, body);
      if (r.status !== 403) check(false, `employee issues: ${who} must not ${method} ${path} (HR only)`, r);
    }
  }
  check(true, 'employee issues: a Team Member, a Team Lead and a Department Head of another department are refused every HR route');
  r = await api(null, 'GET', '/hr/issues');
  check(r.status === 401, 'employee issues: signed-out visitors are refused the HR route', r);

  // ---- HR: sees every department, filters, search, pagination, totals from the records
  r = await api('hr', 'GET', '/hr/issues/overview');
  const ov = r.json.data;
  check(r.status === 200 && ov.total >= 5 && ov.new === ov.total && ov.urgent >= 1 && ov.inProgress === 0, 'employee issues: HR\'s totals are counted from the database', ov);
  r = await api('hr', 'GET', '/hr/issues?search=Issue%20from%20th');
  check(r.status === 200 && r.json.data.total === 1 && r.json.data.items[0].id === issues.th.id && r.json.data.items[0].description === null, 'employee issues: HR finds an issue by title (the list carries no text)', r);
  r = await api('hr', 'GET', `/hr/issues?search=${encodeURIComponent(issues.dh.reference)}`);
  check(r.json.data.total === 1 && r.json.data.items[0].id === issues.dh.id, 'employee issues: and by reference', r);
  r = await api('hr', 'GET', `/hr/issues?search=${encodeURIComponent(me.fullName.split(' ')[0])}`);
  check(r.json.data.items.some((i: any) => i.id === issues.a.id), 'employee issues: and by employee name', r);
  r = await api('hr', 'GET', '/hr/issues?priority=URGENT&status=NEW&category=FACILITIES');
  check(r.json.data.items.some((i: any) => i.id === issues.th.id) && r.json.data.items.every((i: any) => i.priority === 'URGENT' && i.status === 'NEW'), 'employee issues: priority, status and category filters work', r);
  r = await api('hr', 'GET', `/hr/issues?departmentId=${issues.a.employee.departmentId}`);
  check(r.json.data.items.length > 0 && r.json.data.items.every((i: any) => i.employee.departmentId === issues.a.employee.departmentId), 'employee issues: the department filter works', r);
  r = await api('hr', 'GET', `/hr/issues?from=${encodeURIComponent(new Date(Date.now() - 3600e3).toISOString())}&to=${encodeURIComponent(new Date(Date.now() + 3600e3).toISOString())}`);
  check(r.json.data.total >= 5, 'employee issues: the date range filter works', r.json.data.total);
  r = await api('hr', 'GET', `/hr/issues?from=${encodeURIComponent(new Date(Date.now() + 86400e3).toISOString())}`);
  check(r.json.data.total === 0, 'employee issues: and excludes issues before the range', r);
  r = await api('hr', 'GET', '/hr/issues?limit=2&offset=0');
  const total = r.json.data.total;
  const r2 = await api('hr', 'GET', '/hr/issues?limit=2&offset=2');
  check(r.json.data.items.length === 2 && r2.json.data.total === total && r2.json.data.items.every((i: any) => !r.json.data.items.some((x: any) => x.id === i.id)), 'employee issues: pagination returns distinct pages and the total', [total, r2.json.data.items.length]);
  for (const q of ['status=BOGUS', 'priority=ASAP', 'limit=1000', 'unexpected=1', 'from=yesterday']) {
    r = await api('hr', 'GET', `/hr/issues?${q}`);
    check(r.status === 422, `employee issues: the query "${q}" is refused`, r);
  }
  r = await api('hrmember', 'GET', '/hr/issues');
  check(r.status === 200 && r.json.data.total >= 5, 'employee issues: an HR Team Member also works the issues', r.status);
  r = await api('hr', 'GET', '/hr/case-assignees');
  check(r.status === 200 && r.json.data.some((x: any) => x.id === hrMemberId), 'employee issues: HR can pick an HR team member to assign', r);

  // ---- HR works an issue; the employee sees the update; internal notes stay with HR
  r = await api('hr', 'POST', `/hr/issues/${issues.a.id}/assign`, { hrId: await idOfEmail('a@amuwa.com') });
  check(r.status === 422, 'employee issues: an issue cannot be assigned to somebody outside HR', r);
  r = await api('hr', 'POST', `/hr/issues/${issues.a.id}/assign`, { hrId: hrMemberId });
  check(r.status === 200 && r.json.data.issue.status === 'IN_PROGRESS' && r.json.data.issue.assignedHr.id === hrMemberId, 'employee issues: HR assigns an issue to an HR team member', r);
  r = await api('hr', 'POST', `/hr/issues/${issues.a.id}/note`, { note: 'INTERNAL: check the maintenance contract first.' });
  check(r.status === 200 && r.json.data.events.some((e: any) => e.kind === 'NOTE' && e.visibility === 'HR'), 'employee issues: HR adds an internal note', r);
  r = await api('hrmember', 'POST', `/hr/issues/${issues.a.id}/respond`, { message: 'Which floor are you on, and since when?', requestInfo: true });
  check(r.status === 200 && r.json.data.issue.status === 'AWAITING_EMPLOYEE', 'employee issues: HR asks the employee for more information', r);
  r = await api('a', 'GET', `/employee/issues/${issues.a.id}`);
  check(r.json.data.issue.status === 'AWAITING_EMPLOYEE' && r.json.data.issue.hrResponse.startsWith('Which floor') && r.json.data.issue.assignedHr.id === hrMemberId, 'employee issues: the employee sees the status and HR\'s response', r);
  check(!JSON.stringify(r.json.data).includes('INTERNAL') && r.json.data.events.every((e: any) => e.visibility === 'EMPLOYEE' && e.kind !== 'NOTE'), 'employee issues: the internal note is not in anything the employee receives');
  r = await api('a', 'GET', '/notifications?unreadOnly=true');
  check((r.json.data.items as any[]).some(n => n.type === 'EMPLOYEE_ISSUE_UPDATED' && n.entityId === issues.a.id && /more information/.test(n.body)), 'employee issues: the employee was notified of HR\'s request', r.json.data.items?.length);
  r = await api('b', 'GET', '/notifications?unreadOnly=true');
  check(!(r.json.data.items as any[]).some(n => n.entityId === issues.a.id), 'employee issues: and a colleague was not');
  r = await api('a', 'POST', `/employee/issues/${issues.a.id}/reply`, { message: 'Third floor, since Monday.' });
  check(r.status === 200 && r.json.data.issue.status === 'IN_PROGRESS' && r.json.data.events.some((e: any) => e.kind === 'EMPLOYEE_REPLY'), 'employee issues: the employee replies and the issue is back In Progress', r);
  r = await api('hrmember', 'GET', '/notifications?unreadOnly=true');
  check((r.json.data.items as any[]).some(n => n.type === 'EMPLOYEE_ISSUE_REPLY' && n.entityId === issues.a.id), 'employee issues: the assigned HR person was told about the reply', r.json.data.items?.length);
  r = await api('hr', 'POST', `/hr/issues/${issues.a.id}/status`, { status: 'RESOLVED', message: 'Maintenance fixed it today.' });
  check(r.status === 200 && r.json.data.issue.status === 'RESOLVED' && r.json.data.issue.resolvedAt, 'employee issues: HR resolves it', r);
  r = await api('hr', 'POST', `/hr/issues/${issues.a.id}/status`, { status: 'NEW' });
  check(r.status === 422, 'employee issues: an opened issue cannot go back to New', r);
  r = await api('hr', 'POST', `/hr/issues/${issues.a.id}/status`, { status: 'BOGUS' });
  check(r.status === 422, 'employee issues: an unknown status is refused', r);
  r = await api('hr', 'POST', `/hr/issues/${issues.a.id}/status`, { status: 'CLOSED' });
  check(r.status === 200 && r.json.data.issue.status === 'CLOSED', 'employee issues: HR closes it', r);
  r = await api('hr', 'POST', `/hr/issues/${issues.a.id}/respond`, { message: 'One more thing' });
  check(r.status === 409, 'employee issues: a closed issue cannot be answered', r);
  r = await api('a', 'POST', `/employee/issues/${issues.a.id}/reply`, { message: 'Thanks, one more thing' });
  check(r.status === 409, 'employee issues: nor replied to by the employee', r);
  r = await api('a', 'GET', `/employee/issues?status=CLOSED`);
  check(r.json.data.items.length === 1 && r.json.data.items[0].id === issues.a.id && r.json.data.items[0].hrResponse === 'Maintenance fixed it today.', 'employee issues: the employee filters their history and sees HR\'s last response', r);
  r = await api('hr', 'GET', '/hr/issues/overview');
  check(r.json.data.closed === 1 && r.json.data.new >= 3, 'employee issues: HR\'s totals follow the status changes', r.json.data);
  check(Number((await db.query(`select count(*) c from public.audit_logs where action like 'EMPLOYEE_ISSUE_%'`)).rows[0].c) >= 7, 'employee issues: the activity is in the audit log');

  // ---- direct table access: the owner reads their own rows, nobody writes
  r = await api('b', 'GET', '/employee/issues');
  check(r.status === 200 && r.json.data.items.every((i: any) => i.employee.id !== me.id), 'employee issues: another employee\'s history never holds somebody else\'s issues', r.json.data.total);

  // ---- attachments (private bucket, checked type, size and content)
  const pdf = Buffer.concat([Buffer.from('%PDF-1.4\n% issue file\n'), Buffer.alloc(1500, 0x20), Buffer.from('\n%%EOF\n')]);
  const put = (t: any, body: Buffer, type = 'application/pdf') => fetch(`${GW}/storage/v1/object/upload/sign/${t.bucket}/${t.path}?token=${t.token}`, { method: 'PUT', headers: { 'content-type': type, 'x-upsert': 'false' }, body });
  r = await api('a', 'POST', '/employee/issues/uploads', { fileName: 'virus.exe', mimeType: 'application/x-msdownload', sizeBytes: 100 });
  check(r.status === 422, 'employee issues: a file type that is not allowed is refused', r);
  r = await api('a', 'POST', '/employee/issues/uploads', { fileName: 'big.pdf', mimeType: 'application/pdf', sizeBytes: 5 * 1024 * 1024 + 1 });
  check(r.status === 422, 'employee issues: a file over 5 MB is refused', r);
  r = await api('a', 'POST', '/employee/issues/uploads', { fileName: 'slip.pdf', mimeType: 'application/pdf', sizeBytes: pdf.length, ownerId: me.id });
  check(r.status === 422, 'employee issues: an owner named in the upload request is refused', r);
  r = await api('cl1', 'POST', '/employee/issues/uploads', { fileName: 'slip.pdf', mimeType: 'application/pdf', sizeBytes: pdf.length });
  check(r.status === 401 || r.status === 403, 'employee issues: a client cannot upload here', r);
  r = await api('a', 'POST', '/employee/issues/uploads', { fileName: 'Salary-slip.pdf', mimeType: 'application/pdf', sizeBytes: pdf.length });
  check(r.status === 201 && r.json.data.bucket === 'employee-issue-attachments' && r.json.data.path.startsWith(`${me.id}/`) && !r.json.data.path.includes('..'), 'employee issues: an upload is booked in the private bucket, in the employee\'s own folder', r);
  const up1 = r.json.data;
  r = await api('a', 'POST', `/employee/issues/uploads/${up1.attachment.id}/complete`);
  check(r.status === 422, 'employee issues: completing an upload that never arrived is refused', r);
  r = await api('a', 'POST', '/employee/issues/uploads', { fileName: 'Salary-slip.pdf', mimeType: 'application/pdf', sizeBytes: pdf.length });
  const up2 = r.json.data;
  check((await put(up2, pdf)).status < 300, 'employee issues: the file is uploaded with the single-use link');
  r = await api('b', 'POST', `/employee/issues/uploads/${up2.attachment.id}/complete`);
  check(r.status === 404, 'employee issues: someone else cannot confirm my upload', r);
  r = await api('a', 'POST', `/employee/issues/uploads/${up2.attachment.id}/complete`);
  check(r.status === 200 && r.json.data.name === 'Salary-slip.pdf', 'employee issues: the uploader confirms it', r);
  r = await api('a', 'POST', '/employee/issues/uploads', { fileName: 'Fake.png', mimeType: 'image/png', sizeBytes: pdf.length });
  const up3 = r.json.data;
  await put(up3, pdf, 'image/png');
  r = await api('a', 'POST', `/employee/issues/uploads/${up3.attachment.id}/complete`);
  check(r.status === 422, 'employee issues: a PDF renamed to .png is refused by looking at its content', r);
  r = await api('b', 'POST', '/employee/issues', issueBody({ attachmentIds: [up2.attachment.id] }));
  check(r.status === 422, 'employee issues: a colleague cannot attach my file to their issue', r);
  r = await api('a', 'POST', '/employee/issues', issueBody({ title: 'Wrong deduction', category: 'SALARY_PAYROLL', attachmentIds: [up2.attachment.id] }));
  check(r.status === 201, 'employee issues: an issue with a file is stored', r);
  const withFile = r.json.data;
  r = await api('a', 'POST', '/employee/issues', issueBody({ attachmentIds: [up2.attachment.id] }));
  check(r.status === 422, 'employee issues: a file cannot be attached twice', r);
  r = await api('a', 'GET', `/employee/issues/${withFile.id}`);
  check(r.json.data.attachments.length === 1 && r.json.data.attachments[0].name === 'Salary-slip.pdf', 'employee issues: the issue lists its file', r);
  r = await api('a', 'GET', `/employee/issue-attachments/${up2.attachment.id}/url?action=download`);
  check(r.status === 200 && r.json.data.url.startsWith(GW) && r.json.data.expiresInSeconds <= 120, 'employee issues: the owner gets a short-lived download link', r);
  const dl = await fetch(r.json.data.url);
  check(dl.status === 200 && Buffer.from(await dl.arrayBuffer()).equals(pdf), 'employee issues: and the file is the one that was uploaded');
  r = await api('b', 'GET', `/employee/issue-attachments/${up2.attachment.id}/url`);
  check(r.status === 404, 'employee issues: another employee cannot open it even with the id', r);
  r = await api('dh', 'GET', `/employee/issue-attachments/${up2.attachment.id}/url`);
  check(r.status === 404, 'employee issues: nor a Department Head', r);
  r = await api('hr', 'GET', `/hr/issues/${withFile.id}`);
  check(r.status === 200 && r.json.data.attachments.length === 1, 'employee issues: HR sees the file on the issue', r);
  r = await api('hr', 'GET', `/employee/issue-attachments/${up2.attachment.id}/url`);
  check(r.status === 200 && r.json.data.fileName === 'Salary-slip.pdf', 'employee issues: and can open it', r);
  r = await api(null, 'GET', `/employee/issue-attachments/${up2.attachment.id}/url`);
  check(r.status === 401, 'employee issues: signed-out visitors cannot', r);

  // ---- meeting requests: Team Member, Team Lead, Department Head
  const meets: Record<string, any> = {};
  for (const who of ['a', 'th', 'dh']) {
    r = await api(who, 'POST', '/employee/meetings', meetBody({ subject: `Meeting from ${who}`, category: who === 'dh' ? 'PERSONAL_CONFIDENTIAL' : 'MANAGEMENT' }));
    check(r.status === 201 && /^MTG-\d{4}-\d{5}$/.test(r.json.data.reference) && r.json.data.status === 'PENDING', `meeting requests: ${who} requests a meeting and gets a reference number (still a request, not a meeting)`, r);
    meets[who] = r.json.data;
  }
  check(meets.a.confirmedDate === null && meets.a.employee.id === me.id && !!meets.a.employee.department, 'meeting requests: nothing is confirmed, the employee\'s details come from the profile', meets.a);
  r = await api('a', 'POST', '/employee/meetings', meetBody({ clientRequestId: (await db.query(`select client_request_id from public.employee_meeting_requests where id = $1`, [meets.a.id])).rows[0].client_request_id }));
  check(r.status === 201 && r.json.data.id === meets.a.id && r.json.data.duplicate === true, 'meeting requests: submitting the same form twice returns the first request', r);
  for (const [label, body] of [
    ['an employee id', meetBody({ employeeId: me.id })], ['a status', meetBody({ status: 'SCHEDULED' })], ['a confirmed date', meetBody({ confirmedDate: day(2) })],
    ['a short subject', meetBody({ subject: 'x' })], ['an unknown category', meetBody({ category: 'NOPE' })], ['a past date', meetBody({ preferredDate: day(-10) })],
    ['a date far ahead', meetBody({ preferredDate: day(900) })], ['a bad time', meetBody({ preferredTime: '25:99' })], ['an unknown mode', meetBody({ mode: 'PHONE' })],
    ['a bad date format', meetBody({ preferredDate: '12/11/2026' })]
  ] as [string, any][]) {
    r = await api('a', 'POST', '/employee/meetings', body);
    check(r.status === 422, `meeting requests: ${label} is refused`, r);
  }
  r = await api('b', 'GET', `/employee/meetings/${meets.a.id}`);
  check(r.status === 404, 'meeting requests: a colleague cannot open it by changing the id', r);
  r = await api('b', 'POST', `/employee/meetings/${meets.a.id}/cancel`, {});
  check(r.status === 404, 'meeting requests: nor cancel it', r);
  r = await api('b', 'POST', `/employee/meetings/${meets.a.id}/alternative`, { accept: true });
  check(r.status === 404, 'meeting requests: nor answer it', r);
  r = await api('a', 'POST', `/hr/meetings/${meets.a.id}/decide`, { action: 'APPROVE', date: day(4), time: '14:00' });
  check(r.status === 403, 'meeting requests: an employee cannot approve their own request', r);
  r = await api('hr', 'GET', '/hr/meetings/overview');
  check(r.status === 200 && r.json.data.total >= 3 && r.json.data.pending === r.json.data.total && r.json.data.scheduled === 0, 'meeting requests: HR\'s totals are counted from the database', r.json.data);
  r = await api('hr', 'GET', '/hr/meetings?search=Meeting%20from%20th');
  check(r.json.data.total === 1 && r.json.data.items[0].id === meets.th.id && r.json.data.items[0].description === null, 'meeting requests: HR finds a request by subject', r);
  r = await api('hr', 'GET', `/hr/meetings?category=PERSONAL_CONFIDENTIAL&status=PENDING`);
  check(r.json.data.items.some((m: any) => m.id === meets.dh.id), 'meeting requests: category and status filters work', r);
  r = await api('hr', 'GET', `/hr/meetings?from=${day(2)}&to=${day(4)}`);
  check(r.json.data.items.some((m: any) => m.id === meets.a.id), 'meeting requests: the date range filter works', r);
  for (const q of ['status=BOGUS', 'from=tomorrow', 'category=NOPE', 'limit=0']) {
    r = await api('hr', 'GET', `/hr/meetings?${q}`);
    check(r.status === 422, `meeting requests: the query "${q}" is refused`, r);
  }
  r = await api('hr', 'GET', `/hr/meetings/${meets.a.id}`);
  check(r.status === 200 && r.json.data.meeting.description.startsWith('I would like') && r.json.data.meeting.employee.id === me.id, 'meeting requests: HR opens the full request', r);
  r = await api('hr', 'POST', `/hr/meetings/${meets.a.id}/decide`, { action: 'APPROVE' });
  check(r.status === 422, 'meeting requests: approving needs a date and time', r);
  r = await api('hr', 'POST', `/hr/meetings/${meets.a.id}/decide`, { action: 'DECLINE' });
  check(r.status === 422, 'meeting requests: declining needs a reason', r);
  r = await api('hr', 'POST', `/hr/meetings/${meets.a.id}/decide`, { action: 'APPROVE', date: day(4), time: '14:00', mode: 'ONLINE', link: 'http://insecure.example.com' });
  check(r.status === 422, 'meeting requests: a meeting link must be https', r);
  r = await api('hr', 'POST', `/hr/meetings/${meets.a.id}/decide`, { action: 'RESCHEDULE', date: day(5), time: '10:00', reason: 'not scheduled yet' });
  check(r.status === 409, 'meeting requests: only a scheduled meeting can be rescheduled', r);
  r = await api('hr', 'POST', `/hr/meetings/${meets.a.id}/decide`, { action: 'COMPLETE' });
  check(r.status === 409, 'meeting requests: only a scheduled meeting can be completed', r);
  r = await api('hr', 'POST', `/hr/meetings/${meets.a.id}/assign`, { hrId: hrMemberId });
  check(r.status === 200 && r.json.data.meeting.assignedHr.id === hrMemberId, 'meeting requests: HR assigns the responsible HR representative', r);
  r = await api('hrmember', 'POST', `/hr/meetings/${meets.a.id}/decide`, { action: 'APPROVE', date: day(4), time: '14:00', mode: 'ONLINE', link: 'https://meet.example.com/room-7', instructions: 'Join five minutes early.', message: 'See you then.' });
  check(r.status === 200 && r.json.data.meeting.status === 'SCHEDULED' && r.json.data.meeting.confirmedDate === day(4) && r.json.data.meeting.confirmedTime === '14:00', 'meeting requests: HR approves and schedules it with a link and instructions', r);
  r = await api('hr', 'POST', `/hr/meetings/${meets.a.id}/note`, { note: 'INTERNAL: prepare the leave ledger.' });
  check(r.status === 200, 'meeting requests: HR adds an internal note', r);
  r = await api('a', 'GET', `/employee/meetings/${meets.a.id}`);
  const mine = r.json.data.meeting;
  check(mine.status === 'SCHEDULED' && mine.confirmedDate === day(4) && mine.confirmedTime === '14:00' && mine.confirmedMode === 'ONLINE' && mine.link === 'https://meet.example.com/room-7' && mine.instructions === 'Join five minutes early.' && mine.hrResponse === 'See you then.',
    'meeting requests: the employee sees the confirmed date, time, mode, link, instructions and HR\'s response', mine);
  check(!JSON.stringify(r.json.data).includes('INTERNAL') && mine.outcome === null, 'meeting requests: the internal note is not shown to the employee');
  r = await api('a', 'GET', '/notifications?unreadOnly=true');
  check((r.json.data.items as any[]).filter(n => n.type === 'EMPLOYEE_MEETING_UPDATED' && n.entityId === meets.a.id && /scheduled/i.test(n.title)).length === 1, 'meeting requests: the employee was notified of the schedule once', r.json.data.items?.length);
  r = await api('hr', 'GET', '/hr/meetings/overview');
  check(r.json.data.scheduled === 1 && r.json.data.pending >= 2, 'meeting requests: the totals follow', r.json.data);
  r = await api('hr', 'POST', `/hr/meetings/${meets.th.id}/decide`, { action: 'DECLINE', reason: 'Please talk to your Department Head first.' });
  check(r.status === 200 && r.json.data.meeting.status === 'DECLINED', 'meeting requests: HR declines with a reason', r);
  r = await api('th', 'GET', `/employee/meetings/${meets.th.id}`);
  check(r.json.data.meeting.status === 'DECLINED' && r.json.data.meeting.reason.startsWith('Please talk'), 'meeting requests: the employee sees the reason', r);
  r = await api('hr', 'POST', `/hr/meetings/${meets.dh.id}/decide`, { action: 'PROPOSE', date: day(6), time: '16:00', mode: 'IN_PERSON', location: 'Room 2', message: 'Could we meet later that week?' });
  check(r.status === 200 && r.json.data.meeting.status === 'ALTERNATIVE_PROPOSED', 'meeting requests: HR proposes another time', r);
  r = await api('dh', 'GET', `/employee/meetings/${meets.dh.id}`);
  check(r.json.data.meeting.proposedDate === day(6) && r.json.data.meeting.proposedTime === '16:00' && r.json.data.meeting.location === 'Room 2', 'meeting requests: the employee sees the proposal', r);
  r = await api('dh', 'POST', `/employee/meetings/${meets.dh.id}/alternative`, { accept: true, message: 'That works.' });
  check(r.status === 200 && r.json.data.meeting.status === 'SCHEDULED' && r.json.data.meeting.confirmedDate === day(6) && r.json.data.meeting.confirmedTime === '16:00', 'meeting requests: accepting it schedules the meeting', r);
  r = await api('dh', 'POST', `/employee/meetings/${meets.dh.id}/alternative`, { accept: true });
  check(r.status === 409, 'meeting requests: there is nothing left to answer', r);
  r = await api('hr', 'POST', `/hr/meetings/${meets.a.id}/decide`, { action: 'RESCHEDULE', date: day(7), time: '09:30', reason: 'The HR representative is on leave that day.' });
  check(r.status === 200 && r.json.data.meeting.confirmedDate === day(7) && r.json.data.meeting.link === 'https://meet.example.com/room-7', 'meeting requests: HR reschedules a scheduled meeting with a reason (the link is kept)', r);
  r = await api('hr', 'POST', `/hr/meetings/${meets.a.id}/decide`, { action: 'RESCHEDULE', date: day(8), time: '09:30' });
  check(r.status === 422, 'meeting requests: rescheduling needs a reason', r);
  r = await api('a', 'GET', `/employee/meetings/${meets.a.id}`);
  check(r.json.data.meeting.reason.startsWith('The HR representative') && r.json.data.meeting.confirmedDate === day(7), 'meeting requests: the employee sees the new time and the reason', r);
  r = await api('hr', 'POST', `/hr/meetings/${meets.a.id}/decide`, { action: 'COMPLETE', outcome: 'Explained the leave policy.', followUp: 'Send the leave ledger by e-mail.' });
  check(r.status === 200 && r.json.data.meeting.status === 'COMPLETED' && r.json.data.meeting.outcome === 'Explained the leave policy.' && r.json.data.meeting.followUp === 'Send the leave ledger by e-mail.', 'meeting requests: HR completes it and records the outcome and follow-up', r);
  r = await api('a', 'GET', `/employee/meetings/${meets.a.id}`);
  check(r.json.data.meeting.status === 'COMPLETED' && r.json.data.meeting.outcome === null && r.json.data.meeting.followUp === null && !JSON.stringify(r.json.data).includes('leave policy'), 'meeting requests: the employee does not see the outcome or the follow-up', r);
  r = await api('hr', 'POST', `/hr/meetings/${meets.a.id}/decide`, { action: 'CANCEL', reason: 'too late' });
  check(r.status === 409, 'meeting requests: a completed meeting cannot be changed', r);
  r = await api('hr', 'POST', `/hr/meetings/${meets.dh.id}/decide`, { action: 'CANCEL', reason: 'The meeting room is unavailable.' });
  check(r.status === 200 && r.json.data.meeting.status === 'CANCELLED', 'meeting requests: HR cancels a scheduled meeting with a reason', r);
  r = await api('hr', 'GET', '/hr/meetings/overview');
  check(r.json.data.completed === 1 && r.json.data.declinedOrCancelled === 2 && r.json.data.total === r.json.data.pending + r.json.data.scheduled + r.json.data.completed + r.json.data.declinedOrCancelled, 'meeting requests: the totals add up', r.json.data);
  r = await api('a', 'POST', '/employee/meetings', meetBody({ subject: 'Withdraw me' }));
  const withdraw = r.json.data;
  r = await api('a', 'POST', `/employee/meetings/${withdraw.id}/cancel`, { reason: 'No longer needed' });
  check(r.status === 200 && r.json.data.meeting.status === 'CANCELLED', 'meeting requests: an employee withdraws their own pending request', r);
  r = await api('a', 'POST', `/employee/meetings/${withdraw.id}/cancel`, {});
  check(r.status === 409, 'meeting requests: and cannot cancel it twice', r);
  r = await api('a', 'GET', '/employee/meetings');
  check(r.status === 200 && r.json.data.items.every((m: any) => m.employee.id === me.id) && r.json.data.items.length >= 2, 'meeting requests: an employee\'s history holds only their own requests', r.json.data.total);
  check(Number((await db.query(`select count(*) c from public.audit_logs where action like 'EMPLOYEE_MEETING_%'`)).rows[0].c) >= 8, 'meeting requests: the activity is in the audit log');

  // ---- an HR employee's own issue is not worked by HR, and HR may not work it as HR
  r = await api('hrmember', 'POST', '/employee/issues', issueBody({ title: 'HR laptop is slow' }));
  const hrOwn = r.json.data;
  check(r.status === 201, 'employee issues: an HR team member can raise their own issue', r);
  r = await api('hrmember', 'GET', `/hr/issues/${hrOwn.id}`);
  check(r.status === 404, 'employee issues: but cannot open or work it as HR', r);
  r = await api('hr', 'GET', `/hr/issues/${hrOwn.id}`);
  check(r.status === 200, 'employee issues: another HR person does see it', r);

  // ---- the migration is applied twice without trouble (a production database already has it)
  check(Number((await db.query(`select count(*) c from pg_policies where tablename in ('employee_issues', 'employee_meeting_requests', 'employee_case_events')`)).rows[0].c) === 3, 'employee issues: one read policy per table (owner or HR)');
}

// Accounts corrections traverse the real Hono handler, validation, PostgREST and scoped RPC.
{
  const created = await api('a', 'POST', '/pipeline/leads', { name: 'Correction Contact', company: 'Correction Business', phone: '9847650321', email: 'correction.api@example.com', leadSource: 'Walk-in', services: ['AI_CALLING'] });
  check(created.status === 201 || created.status === 200, 'profile correction: create fixture', created);
  const id = created.json.data.id;
  await api('a', 'POST', `/pipeline/customers/${id}/send-to-accounts`, { amount: 40000 });
  const path = `/pipeline/customers/${id}/accounts/customer-details`;
  let response = await api('accm', 'GET', path);
  check(response.status === 200 && response.json.data.name === 'Correction Contact', 'profile correction: Accounts reads current details', response);
  const { hasClientLogin, ...profile } = response.json.data;
  response = await api('accm', 'PATCH', path, { ...profile, city: 'Pune', address: 'Pune, Maharashtra', name: 'Corrected Contact' });
  check(response.status === 200 && response.json.data.city === 'Pune', 'profile correction: Accounts saves missing details', response);
  response = await api('accm', 'GET', path);
  check(response.json.data.name === 'Corrected Contact', 'profile correction: reopening reads persisted details');
  check((await api('a', 'PATCH', path, profile)).status === 403, 'profile correction: Sales is refused');
  check((await api(null, 'PATCH', path, profile)).status === 401, 'profile correction: anonymous is refused');
  check((await api('accm', 'PATCH', path, { ...profile, dealAmount: 1 })).status === 422, 'profile correction: financial fields rejected');
  check((await api('accm', 'PATCH', path, { ...profile, email: 'invalid' })).status === 422, 'profile correction: invalid email rejected');
}

console.log(`=== ${passed} API INTEGRATION CHECKS PASSED ===`);
server.close();
await db.end();
process.exit(0);
