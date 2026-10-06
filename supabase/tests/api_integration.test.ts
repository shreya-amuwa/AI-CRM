/**
 * End-to-end API test: real HTTP handler (server/app.ts) → supabase-js →
 * local gateway → PostgREST → PostgreSQL with all migrations + RLS.
 * Run via supabase/tests/run-api.sh.
 */
import http from 'node:http';
import crypto from 'node:crypto';
import pg from 'pg';

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
tokens.set('forged', sign({ sub: sa.id, role: 'authenticated' }).replace(/.$/, 'x'));
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

r = await api('th', 'POST', '/users', { email: 'a@amuwa.com', fullName: 'Member A', password: 'Sup3rSecret!', role: 'TEAM_MEMBER', teamId: sales.id });
check(r.status === 201, 'team head creates team member', r);
const memberA = r.json.data.id;
tokens.set('a', tokenFor(memberA));

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
check(r.status === 201 && r.json.data.recipients === 2, 'team head announcement reaches team', r);
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
r = await api('dh', 'DELETE', `/users/${pendingId}`);
check(r.status === 403, 'department head cannot delete users');
r = await api('sa', 'DELETE', `/users/${memberA}`);
check(r.status === 409, 'cannot delete user who owns customers', r);
r = await api('sa', 'DELETE', `/users/${pendingId}`);
check(r.status === 200, 'super admin deletes user', r);
r = await api('sa', 'GET', '/nope');
check(r.status === 404 && r.json.error.code === 'NOT_FOUND', 'unknown route → 404');
r = await api('sa', 'PUT', '/customers');
check(r.status === 405, 'wrong method → 405');

console.log(`=== ${passed} API INTEGRATION CHECKS PASSED ===`);
server.close();
await db.end();
process.exit(0);
