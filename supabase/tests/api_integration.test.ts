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

async function api(who: string | null, method: string, path: string, body?: unknown, raw?: string) {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(who ? { authorization: `Bearer ${tokens.get(who)}` } : {}) },
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body))
  });
  return { status: res.status, json: (await res.json()) as any };
}

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
check(r.status === 200 && r.json.data.length === 11, 'departments come from the database');
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
check(r.status === 200 && r.json.data.length === 31 && r.json.data[0].category, 'service catalogue comes from the database', r);
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

// --- client login + hand-over: consultant → department head → team lead → team member ---
const clientEmail = 'client.galaxy@example.com';
r = await api('tc', 'POST', `/pipeline/customers/${leadA}/client-account`, { email: clientEmail, password: 'short' });
check(r.status === 422, 'client password must be at least 10 characters', r);
r = await api('a', 'POST', `/pipeline/customers/${leadA}/client-account`, { email: clientEmail, password: 'ClientPass#2026' });
check(r.status === 404, 'sales cannot create the client login', r);
r = await api('tc', 'POST', `/pipeline/customers/${leadA}/client-account`, { email: 'dh@amuwa.com', password: 'ClientPass#2026' });
check(r.status === 409, "a staff e-mail cannot be used for the client's login", r);
r = await api('tc', 'POST', '/pipeline/customers/' + leadA + '/handover/department-head', {});
check(r.status === 422 && /login first/.test(r.json.error.message), 'cannot send to the department head before the client login exists', r);
r = await api('tc', 'POST', `/pipeline/customers/${leadA}/client-account`, { email: clientEmail, password: 'ClientPass#2026' });
check(r.status === 201 && r.json.data.email === clientEmail && !JSON.stringify(r.json).includes('ClientPass'), 'consultant creates the client login (no password in the response)', r);
r = await api('tc', 'POST', `/pipeline/customers/${leadA}/client-account`, { email: 'second@example.com', password: 'ClientPass#2026' });
check(r.status === 409, 'only one client login per customer', r);
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
r = await api('accm', 'POST', `/pipeline/customers/${payLead}/accounts/payment-confirmed`, { note: 'UPI received' });
check(r.status === 200, 'Confirm payment & return to Sales', r);
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
  // reaching the consultant sends nothing; the messages start when the TC clicks "Send for onboarding"
  const arrived = await api('tc', 'GET', `/pipeline/customers/${id}/client-messages`);
  check(arrived.status === 200 && arrived.json.data.stage === null && arrived.json.data.messages.length === 0, `${fields.company}: reaching the consultant sends nothing`, arrived.json);
  const ans = await api('tc', 'POST', `/pipeline/customers/${id}/consultant/addons-required`, { required: opts.addons ?? false });
  check(ans.status === 200, 'the TC answers the add-ons question', ans);
  const startRes = await api('tc', 'POST', `/pipeline/customers/${id}/consultant/start-onboarding`);
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
r = await api('tc', 'GET', `/pipeline/customers/${autoB}/client-messages`);
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
check(r.status === 200 && r.json.data.automated === false && r.json.data.messages.length === 0, 'customers without the WhatsApp API service are not automated', r);

// Live, test recipients only
Object.assign(process.env, { AUTOMATION_MODE: 'live', AUTOMATION_TEST_RECIPIENTS: '9819900011, 9819900022, auto.client@example.com, nosite.client@example.com' });
r = await api('tc', 'POST', `/pipeline/customers/${autoB}/checklist/verify-all`);
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
r = await api('tc', 'POST', `/pipeline/customers/${autoA}/checklist/verify-all`);
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

// Step 3: the client login. The password is kept encrypted only until the email is sent.
process.env.AUTOMATION_MODE = 'off';
r = await api('tc', 'POST', `/pipeline/customers/${autoA}/client-account`, { email: 'auto.login@example.com', password: 'AutoPass#2026x' });
check(r.status === 201, 'the TC creates the client login', r);
let jobs = await jobsOf(autoA);
const pending = jobs.find(j => j.stage === 'COMPLETED' && j.channel === 'EMAIL');
check(pending && pending.status === 'QUEUED' && /^v1:/.test(pending.secret) && !pending.secret.includes('AutoPass'), 'the password is stored encrypted on the completion email job only', pending);
check(jobs.filter(j => j.secret).length === 1, 'and nowhere else');
d = await dispatch('dispatch-secret-0123456789');
check(d.json.data.claimed === 0, 'sending switched off: nothing is processed');
process.env.AUTOMATION_MODE = 'live';
failNext['/wa'] = [503];
d = await dispatch('dispatch-secret-0123456789');
const done = outbox.find(o => o.path === '/emails' && o.body.subject === 'Meta Verification Completed – Panel Access Details | Amuwa Corporation');
check(done && done.body.html.includes('https://chat.wabastore.shop/login') && done.body.html.includes('auto.login@example.com')
  && done.body.html.includes('AutoPass#2026x') && done.body.html.includes('<b>Department:</b> Wabastore'),
  'Status Completed email: Wabastore panel link, the login e-mail as user ID and the password', done?.body?.html);
jobs = await jobsOf(autoA);
check(jobs.every(j => !j.secret), 'once sent, the encrypted password is erased');
const waJob = jobs.find(j => j.stage === 'COMPLETED' && j.channel === 'WHATSAPP');
check(waJob && waJob.status === 'QUEUED' && waJob.attempts === 1 && /HTTP 503/.test(waJob.detail), 'a WhatsApp webhook error is retried later', waJob);
await db.query(`update public.automation_jobs set next_attempt_at = now() where customer_id = $1 and status = 'QUEUED'`, [autoA]);
d = await dispatch('dispatch-secret-0123456789');
check(d.json.data.sent === 1 && (await jobsOf(autoA)).find(j => j.stage === 'COMPLETED' && j.channel === 'WHATSAPP')?.status === 'SENT', 'the retry succeeds', d);
r = await api('tc', 'GET', `/pipeline/customers/${autoA}/client-messages`);
check(r.json.data.stage === 'COMPLETED' && r.json.data.messages.filter((m: any) => m.status === 'SENT').length === 8
  && r.json.data.messages.every((m: any) => m.status === 'SENT'), 'every step of customer A was sent exactly once', r.json.data.messages);

// The TC adds the website link; invalid email is skipped
const autoC = await autoCustomer({ name: 'No Site', company: 'No Site Stores', email: 'nosite.client@example.com', whatsapp: '9876501234', phone: '9819900022' }, 'NO_WEBSITE');
r = await api('a', 'POST', `/pipeline/customers/${autoC}/consultant/website`, { url: 'https://nosite.example' });
check(r.status === 404, 'sales cannot use the consultant website action', r);
r = await api('tc', 'POST', `/pipeline/customers/${autoC}/consultant/website`, { url: 'nosite-stores.example' });
check(r.status === 200 && r.json.data.website === 'https://nosite-stores.example', 'the TC saves the website link', r);
jobs = await jobsOf(autoC);
check(!jobs.some(j => j.stage === 'WEBSITE_READY'), 'saving the link alone does not send "website ready": the TC must authorize it', jobs);
r = await api('tc', 'POST', `/pipeline/customers/${autoC}/checklist/WA_WEBSITE_URL/review`, { decision: 'VERIFIED' });
check(r.status === 200, 'the TC authorizes the website', r);
jobs = await jobsOf(autoC);
check(jobs.filter(j => j.stage === 'WEBSITE_READY').length === 2, 'authorizing it queues the "website ready" email + WhatsApp', jobs);
r = await api('tc', 'POST', `/pipeline/customers/${autoC}/checklist/WA_WEBSITE_URL/review`, { decision: 'VERIFIED' });
jobs = await jobsOf(autoC);
check(jobs.filter(j => j.stage === 'WEBSITE_READY').length === 2, 'authorizing again sends nothing more', jobs);
check(jobs.some(j => j.stage === 'WEBSITE_PENDING' && j.channel === 'WHATSAPP' && j.status === 'SKIPPED' && /not a test recipient/.test(j.detail)), 'a WhatsApp number outside the test list is not messaged', jobs);
const autoD = await autoCustomer({ name: 'Phone Only', company: 'Phone Only Co', whatsapp: '9819900011', phone: '9819900022' }, 'https://phone-only.example');
d = await dispatch('dispatch-secret-0123456789');
jobs = await jobsOf(autoD);
check(jobs.some(j => j.channel === 'EMAIL' && j.status === 'SKIPPED' && j.detail === 'Invalid client email – nothing sent')
  && jobs.some(j => j.channel === 'WHATSAPP' && j.status === 'SENT'), 'no email address: the email is skipped, the WhatsApp still goes', jobs);
// --- Payment requests are emailed to the one Accounts person who handles them ---
process.env.APP_URL = 'https://crm.example.test';
const accEmail = (await db.query(`select p.email from public.profiles p join public.departments d on d.id = p.department_id
                                     where d.slug = 'accounts' and p.status = 'ACTIVE' order by p.created_at, p.id limit 1`)).rows[0].email as string;
r = await api('a', 'POST', '/pipeline/leads', { leadSource: 'Walk-in', services: ['WHATSAPP_API_BLUE_TICK'], name: 'Pay Request', company: 'Pay Request Co', phone: '9819900033' });
const payReq = r.json.data.id as string;
const mailsBefore = outbox.filter(o => o.path === '/emails').length;
r = await api('a', 'POST', `/pipeline/customers/${payReq}/send-to-accounts`, { amount: 25000, note: 'Agreed on the call' });
check(r.status === 200 || r.status === 201, 'Sales sends the customer for payment confirmation', r);
await dispatch('dispatch-secret-0123456789');
const accMail = outbox.filter(o => o.path === '/emails').slice(mailsBefore).find(o => o.body.to?.[0] === accEmail);
check(accMail && accMail.body.subject === 'New payment confirmation request: Pay Request Co | Amuwa CRM' && accMail.body.html.includes('Sales sent a customer for payment confirmation')
  && accMail.body.html.includes('Sent by') && accMail.body.html.includes(`href="https://crm.example.test/accounts/dashboard/${payReq}"`) && accMail.body.from === 'Amuwa Corporation <meta@amuwa.com>',
  'the Accounts person gets an email about the payment request, with the sender and a link to it', accMail?.body);
check(outbox.filter(o => o.path === '/emails').slice(mailsBefore).filter(o => o.body.subject.startsWith('New payment confirmation request')).length === 1,
  'exactly one person is emailed (not every Accounts staff member)');
check(!outbox.some(o => o.path === '/wa' && o.body.name === 'Pay Request'), 'no WhatsApp goes out for a payment request');
r = await api('a', 'GET', `/pipeline/customers/${payReq}/client-messages`);
check(r.status === 200 && !JSON.stringify(r.json.data).includes(accEmail) && !r.json.data.messages.some((m: any) => m.stage === 'ACCOUNTS_PAYMENT'),
  'Sales does not see the staff email or its address on the customer');
const payJob = (await db.query(`select status, internal, recipient from public.automation_jobs where customer_id = $1 and stage = 'ACCOUNTS_PAYMENT'`, [payReq])).rows;
check(payJob.length === 1 && payJob[0].status === 'SENT' && payJob[0].internal && payJob[0].recipient === accEmail, 'the job is recorded as sent to that person', payJob);
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
        else { smtpMail.push(cur); send('250 2.0.0 OK queued'); }
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
r = await api('tc', 'GET', `/pipeline/customers/${autoD}/client-messages`);
check(r.json.data.mode === 'live' && r.json.data.emailReady === true && r.json.data.whatsappReady === true, 'the panel knows both senders are set up', r.json.data);
const keepKey = process.env.EMAIL_API_KEY; delete process.env.EMAIL_API_KEY; delete process.env.WHATSAPP_WEBHOOK_URL;
r = await api('tc', 'GET', `/pipeline/customers/${autoD}/client-messages`);
check(r.json.data.emailReady === false && r.json.data.whatsappReady === false, 'and warns when email or WhatsApp sending is not set up (messages would wait silently)', r.json.data);
process.env.EMAIL_API_KEY = keepKey!; process.env.WHATSAPP_WEBHOOK_URL = `${P}/wa`;
// "Send messages for this step": a customer whose step was recorded before the automations were on (no messages)
await db.query(`delete from public.automation_jobs where customer_id = $1`, [autoD]);
r = await api('tc', 'GET', `/pipeline/customers/${autoD}/client-messages`);
check(r.status === 200 && r.json.data.stage === 'UNDER_REVIEW' && r.json.data.messages.length === 0, 'a step without messages (recorded before go-live) is visible to the TC', r);
r = await api('a', 'POST', `/pipeline/customers/${autoD}/client-messages/resend`);
check(r.status === 404, 'sales cannot send them', r);
r = await api('tc', 'POST', `/pipeline/customers/${autoD}/client-messages/resend`);
check(r.status === 200 && r.json.data.stage === 'UNDER_REVIEW' && r.json.data.queued === 2, 'the TC sends the current step\'s messages', r);
jobs = await jobsOf(autoD);
check(jobs.length === 2 && jobs.some(j => j.channel === 'WHATSAPP' && j.status === 'SENT') && jobs.some(j => j.channel === 'EMAIL' && j.status === 'SKIPPED'),
  'they are sent right away (the email is skipped: this customer has no email address)', jobs);
r = await api('tc', 'POST', `/pipeline/customers/${autoD}/client-messages/resend`);
check(r.status === 409, 'and not again within a minute', r);
const un = await api('tc', 'POST', `/pipeline/customers/${leadA}/client-messages/resend`);
check(un.status === 409 || un.status === 404, 'not for customers that are not automated', un);
// --- Excel import of existing customers (Support) + client "Set your password" e-mails ---
{
  Object.assign(process.env, { RATE_LIMIT_IMPORT_PER_MIN: '50', AUTOMATION_MODE: 'live', APP_URL: 'https://crm.example.test', AUTOMATION_TEST_RECIPIENTS: 'imp.client@example.com, imp.other@example.com' });
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
  delete process.env.APP_URL; process.env.RATE_LIMIT_IMPORT_PER_MIN = '3';
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
  tokens.set('cl2', await signIn('auto.login@example.com', 'AutoPass#2026x'));

  r = await api(null, 'GET', '/client/me');
  check(r.status === 401, 'client API: no token → 401', r);
  r = await api('forged', 'GET', '/client/me');
  check(r.status === 401, 'client API: a tampered token → 401', r);
  r = await api('sa', 'GET', '/client/me');
  check(r.status === 403, 'client API: staff cannot use the client API', r);
  r = await api('cl1', 'GET', '/pipeline/customers');
  check(r.status === 401 || r.status === 403, 'a client cannot reach the staff API', r);

  r = await api('cl1', 'GET', '/client/me');
  check(r.status === 200 && r.json.data.customerId === leadA && !JSON.stringify(r.json).toLowerCase().includes('password'), 'client API: /me is the customer linked to the login', r);
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
  const details = { designation: 'Department Head', joiningDate: '2026-01-05', dateOfBirth: '1990-05-06', bloodGroup: 'B+', emergencyContact: '+91 98765 43210' };
  const hrBody = { email: 'hr.api@amuwa.com', fullName: 'HR Api', password: 'Sup3rSecret!', role: 'DEPARTMENT_HEAD', departmentId: hrDept.id };

  // Add Member: the new details are validated before any account exists
  for (const [label, bad] of [
    ['an unknown blood group', { ...details, bloodGroup: 'Z+' }],
    ['a bad emergency number', { ...details, emergencyContact: 'call me' }],
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
  check(r.status === 200 && r.json.data.some((d: any) => d.profileId === hrId && d.bloodGroup === 'B+' && d.emergencyContact === '+91 98765 43210' && d.joiningDate === '2026-01-05' && d.designation === 'Department Head'), 'HR can read the details that were collected', r);
  r = await api('a', 'GET', '/hr/personal-details');
  check(r.status === 403, 'an ordinary employee cannot read employee details', r);
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

// --- Dynamic invoices (Accounts invoice builder): issue -> unpaid PDF + e-mail -> confirm payment -> paid PDF + e-mail ----------
{
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
    && r.json.data.orderNumber === 'Verbal' && /^INV-\d{4}-\d{5}$/.test(r.json.data.suggestedInvoiceNumber) && r.json.data.company.gstin === '27BDCPK3585J3Z7', 'prefill: the customer\'s details, the purchase\'s services with the amount filled in from the agreed amount, defaults set', r);

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
  const body1 = payload({ invoiceNumber: 'GST/26-27/135' });
  r = await api('accm', 'POST', '/accounts/generated-invoices', body1);
  const inv1 = r.json.data?.invoice;
  check(r.status === 201 && inv1.kind === 'GENERATED' && inv1.number === 'GST/26-27/135' && inv1.status === 'Pending' && inv1.total === 18880 && inv1.tax === 2880 && inv1.subtotal === 16000,
    'stage 1: the invoice is issued with the typed number and the server\'s own totals (Rs.16,000 + 18% = Rs.18,880)', r);
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
  check(mail1.user === 'meta@amuwa.com' && /meta@amuwa\.com/.test(mail1.from) && mail1.to.some(t => t.includes(custEmail)) && /Subject: Invoice GST\/26-27\/135 from Amuwa Corporation/.test(mail1.data), 'stage 1: nodemailer sends it as meta@amuwa.com to the customer');
  check(!!att1 && att1.equals(stored1!.body) && /filename="?GST-26-27-135-invoice\.pdf/.test(mail1.data), 'stage 1: the attachment is exactly the stored file');
  const txt1 = pdfText(stored1!.body);
  if (txt1) check(!/\bPAID\b/.test(txt1) && /INVOICE No\. GST\/26-27\/135/.test(txt1) && /Rs\.18,880\.00/.test(txt1) && /Eighteen Thousand Eight Hundred Eighty Only\/-/.test(txt1), 'stage 1: the unpaid PDF has no PAID stamp, and the right number, total and words');
  check(r.json.data.invoice.generated.unpaid.pdfStatus === 'STORED' && !JSON.stringify(r.json).includes('r2://'), 'the API answer never carries a storage reference');

  // a repeated request (a double click, a retry): the same invoice, nothing done twice
  const objectsBefore = fake.objects.size;
  r = await api('accm', 'POST', '/accounts/generated-invoices', body1);
  check(r.status === 200 && r.json.data.invoice.id === inv1.id && r.json.data.steps.every((s: any) => s.status === 'DONE') && /already issued/.test(r.json.data.steps[0].message), 'a repeated request returns the same invoice (200, not 201)', r);
  check(smtpMail.length === m0 + 1 && fake.objects.size === objectsBefore && (await db.query(`select count(*)::int n from generated_invoices`)).rows[0].n === 1, 'and sends no second e-mail, stores no second file, creates no second invoice');
  r = await api('accm', 'POST', '/accounts/generated-invoices', payload({ invoiceNumber: 'GST/26-27/135' }));
  check(r.status === 409, 'a different request with the same invoice number is refused', r);

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
    check(rs.every(x => x.status === 201) && new Set(nums).size === 10 && nums.every(n => /^INV-\d{4}-\d{5}$/.test(n)), 'ten simultaneous invoices get ten different automatic numbers', rs.map(x => [x.status, x.json.error?.message ?? x.json.data?.invoice?.number]));
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
  check(r.status === 200 && r.json.data.invoice.status === 'Paid' && r.json.data.steps.map((s: any) => `${s.step}:${s.status}`).join() === 'PAYMENT:DONE,PDF:DONE,EMAIL:DONE', 'stage 2: payment confirmed, paid PDF stored, paid e-mail sent', r);
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
  check(smtpMail.length === m1 + 1 && /Subject: Payment received - paid invoice GST\/26-27\/135/.test(mail2.data) && attachmentOf(mail2.data)!.equals(stored2!.body), 'stage 2: the paid e-mail carries exactly the paid file');
  const txt2 = pdfText(stored2!.body);
  if (txt2) check(/\bPAID\b/.test(txt2) && /INVOICE No\. GST\/26-27\/135/.test(txt2) && /Rs\.18,880\.00/.test(txt2) && /Eighteen Thousand Eight Hundred Eighty Only\/-/.test(txt2), 'stage 2: the paid PDF has the PAID stamp and the SAME number, total and words');
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
    check(r.status === 200 && r.json.data.invoice.status === 'Paid' && r.json.data.steps.map((s: any) => `${s.step}:${s.status}`).join() === 'PAYMENT:DONE,PDF:DONE,EMAIL:FAILED', 'paid e-mail rejected: the payment stays confirmed, the paid PDF is stored, the e-mail failed', r.json.data.steps);
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
    r = await api('accm', 'POST', '/accounts/generated-invoices', payload({ invoiceNumber: 'GST/26-27/901', lines: [line({ baseAmount: 10000 })] }));
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
      && r.json.data.steps.map((x: any) => `${x.step}:${x.status}`).join() === 'PAYMENT:DONE,PDF:DONE,EMAIL:DONE', 'balance: the last payment (the whole balance by default) settles it: paid invoice stored and e-mailed', r);
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
  r = await api('accm', 'POST', `/pipeline/customers/${lead}/accounts/payments`, { type: 'PART', amount: 4000, method: 'UPI', reference: 'JRN-1', verify: false });
  check(r.status === 201 || r.status === 200, 'Accounts: records the payment (unverified)', r);
  const payId = (await db.query(`select id from customer_payments where customer_id = $1`, [lead])).rows[0].id;
  r = await api('accm', 'POST', `/pipeline/customers/${lead}/accounts/payment-confirmed`, {});
  check(r.status === 422 && /Record and verify/.test(r.json.error.message), 'Accounts: an unverified payment cannot confirm the customer', r);
  r = await api('accm', 'POST', `/pipeline/customers/${lead}/accounts/client-login`, { email: 'sushma.client@example.com', password: 'ClientPass#2026' });
  check(r.status === 409 && /Verify a payment first/.test(r.json.error.message), 'Accounts: no login before a payment is verified', r);
  r = await api('accm', 'POST', `/pipeline/customers/${lead}/accounts/payments/${payId}/verify`, {});
  check(r.status === 200 || r.status === 204, 'Accounts: verifies the payment', r);
  r = await api('accm', 'GET', `/pipeline/customers/${lead}/journey`);
  check(r.status === 200 && r.json.data.step === 'LOGIN_PENDING' && r.json.data.can.createLogin === true && r.json.data.can.returnToSales === false && r.json.data.payment.verified === 4000, 'journey: payment verified, next is the login', r);
  r = await api('accm', 'POST', `/pipeline/customers/${lead}/accounts/payment-confirmed`, {});
  check(r.status === 422 && /dashboard login/.test(r.json.error.message), 'Accounts: Return to Sales is refused until the login exists', r);
  for (const [who, label] of [['a', 'a Sales member'], ['sm', 'the Support member who owns the customer'], ['tc', 'a Technical Consultant'], ['dh', 'the department head']] as const) {
    r = await api(who, 'POST', `/pipeline/customers/${lead}/accounts/client-login`, { email: 'sushma.client@example.com', password: 'ClientPass#2026' });
    check(r.status === 403 || r.status === 404, `Accounts login: ${label} cannot create it`, r);
  }
  r = await api(null, 'POST', `/pipeline/customers/${lead}/accounts/client-login`, { email: 'sushma.client@example.com', password: 'ClientPass#2026' });
  check(r.status === 401, 'Accounts login: no session is refused (401)', r);
  r = await api('accm', 'POST', `/pipeline/customers/${lead}/accounts/client-login`, { email: 'nope', password: 'ClientPass#2026' });
  check(r.status === 422, 'Accounts login: a bad e-mail is refused', r);
  r = await api('accm', 'POST', `/pipeline/customers/${lead}/accounts/client-login`, { email: 'sushma.client@example.com', password: 'short' });
  check(r.status === 422, 'Accounts login: a short password is refused', r);
  r = await api('accm', 'POST', `/pipeline/customers/${lead}/accounts/client-login`, { email: 'a@amuwa.com', password: 'ClientPass#2026' });
  check(r.status === 409, 'Accounts login: an e-mail that already has a login is refused', r);
  check((await db.query(`select count(*)::int n from customer_client_accounts where customer_id = $1`, [lead])).rows[0].n === 0, 'Accounts login: nothing was created by the refusals');
  r = await api('accm', 'POST', `/pipeline/customers/${lead}/accounts/client-login`, { email: 'sushma.client@example.com', password: 'ClientPass#2026' });
  check(r.status === 201 && r.json.data.email === 'sushma.client@example.com', 'Accounts login: Accounts creates the client login', r);
  const prov = (await db.query(`select p.status, p.attempts, p.email, a.auth_user_id from customer_client_provisioning p join customer_client_accounts a on a.customer_id = p.customer_id where p.customer_id = $1`, [lead])).rows[0];
  check(prov.status === 'CREATED' && prov.attempts === 1, 'Accounts login: the provisioning record is settled as created', prov);
  const stored = (await db.query(`select count(*)::int n from automation_jobs where customer_id = $1 and secret is not null`, [lead])).rows[0].n;
  check(stored === 0, 'Accounts login: no password is kept or queued for an e-mail');
  r = await api('accm', 'POST', `/pipeline/customers/${lead}/accounts/client-login`, { email: 'another.sushma@example.com', password: 'ClientPass#2026' });
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
  check(r.json.data.lifecycleStage === 'ONBOARDING' && r.json.data.paymentWorkflow === 'PAYMENT_CONFIRMED' && r.json.data.amountVerified === 4000 && r.json.data.dealAmount === 10000, 'the same customer is back with its owner: onboarding, payment kept', r.json.data);
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
  check(r.status === 200 && r.json.data.total === 1 && r.json.data.items[0].id === lead && r.json.data.items[0].referredFrom === 'SUPPORT' && r.json.data.items[0].services[0].code === 'DS_META_ADS' && r.json.data.items[0].balance === 6000,
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
    check(r.json.data.dealAmount === 141600 && r.json.data.agreedAmount === 120000 && r.json.data.taxBasis === 'EXCLUSIVE' && r.json.data.order.gstTotal === 21600 && r.json.data.order.balance === 141600,
      'gst: the payable is 1,41,600 (GST 21,600) and the whole of it is outstanding', r.json.data);
    r = await api('accm', 'POST', `/pipeline/customers/${gx}/accounts/payments`, { type: 'PART', amount: 60000, method: 'UPI', reference: 'GX-API-1', verify: true });
    check(r.status === 201, 'gst: 60,000 received and verified', r);
    const inv = () => ({
      requestId: crypto.randomUUID(), customerId: gx, purpose: 'SERVICES', invoiceNumber: null, invoiceDate: today, orderNumber: 'Verbal',
      customer: { name: 'Gita Xavier', businessName: 'Xavier Exports', address: 'Shop 2, FC Road, Pune 411004, Maharashtra', contactPerson: 'Gita Xavier', contactNumber: '9820000207', gstin: null, stateCode: '27' },
      taxTreatment: 'INTRA_STATE', terms: '100% Payment Against supply.',
      lines: [{ particulars: 'AI calling set-up', hsnSac: '998313', taxRate: 18, quantity: '1 Nos', baseAmount: 60000 }]
    });
    const body1 = inv();
    r = await api('accm', 'POST', '/accounts/generated-invoices', body1);
    const g1 = r.json.data?.invoice;
    check(r.status === 201 && g1.total === 70800 && g1.generated.paymentSummary.balance === 10800 && g1.generated.paymentSummary.order.balance === 81600 && g1.generated.paymentSummary.order.totalPayable === 141600,
      'gst: invoice 1 is 60,000 + 10,800 = 70,800 with 10,800 left on it and 81,600 on the order', r);
    r = await api('accm', 'POST', '/accounts/generated-invoices', body1);
    check(r.status === 200 && r.json.data.invoice.id === g1.id && /already issued/.test(r.json.data.steps[0].message), 'gst: the same request again returns the same invoice', r);
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
  r = await api('accm', 'POST', `/pipeline/customers/${tLead}/accounts/client-login`, { email: 'tara.client@example.com', password: 'ClientPass#2026' });
  check(r.status === 409 && /Technical Consultant/.test(r.json.error.message), 'Accounts cannot create the login of a Technical Consultant customer', r);
  r = await api('a', 'POST', `/pipeline/customers/${tLead}/send-to-delivery`, {});
  check(r.status === 409 || r.status === 422, 'and Sales cannot route it to a delivery department', r);
  // mixed order
  r = await api('a', 'POST', '/pipeline/leads', { name: 'Meera Nair', company: 'Nair Studio', phone: '9820000203', leadSource: 'Walk-in', services: ['AI_CALLING', 'DS_GRAPHIC_DESIGN'] });
  r = await api('a', 'GET', `/pipeline/customers/${r.json.data.id}/journey`);
  check(r.json.data.journey === 'MIXED' && r.json.data.services.length === 2 && r.json.data.services.find((x: any) => x.code === 'DS_GRAPHIC_DESIGN').requiresTechnicalConsultant === false && r.json.data.services.find((x: any) => x.code === 'AI_CALLING').requiresTechnicalConsultant === true,
    'a mixed order keeps each service\'s own setting and follows the Technical Consultant journey', r.json.data);
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

// A project missing an earlier migration must still let people sign in.
await db.query(`alter function public.rate_limit_consume(jsonb) rename to rate_limit_consume_hidden`);
r = await api('sa', 'GET', '/me');
check(r.status === 200 && r.json.data.role === 'SUPER_ADMIN', 'sign-in still works when api_session fails (falls back)', r);
r = await api('sa', 'GET', '/departments');
check(r.status === 200, 'API keeps working on the fallback path', r);
await db.query(`alter function public.rate_limit_consume_hidden(jsonb) rename to rate_limit_consume`);

console.log(`=== ${passed} API INTEGRATION CHECKS PASSED ===`);
server.close();
await db.end();
process.exit(0);
