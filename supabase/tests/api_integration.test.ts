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
process.env.RATE_LIMIT_IMPORT_PER_MIN = '3';
process.env.RATE_LIMIT_SENSITIVE_PER_MIN = '100';
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
check(r.status === 200 && r.json.data.length === 21 && r.json.data[0].category, 'service catalogue comes from the database', r);

const leadBody = { name: 'Siddhesh', company: 'Galaxy Jewellers', phone: '+91 98200 11111', leadSource: 'Instagram', services: ['META_ADS_MANAGEMENT', 'AI_CALLING'], expectedBudget: 35000 };
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

r = await api('a', 'POST', `/pipeline/customers/${leadA}/documents`, { documentType: 'INVOICE', fileName: 'inv.pdf', mimeType: 'application/pdf', sizeBytes: 100 });
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
check(r.json.data.total === 1 && r.json.data.items[0].id === leadA, 'part-paid onboarding listed under Get started', r);
r = await api('a', 'GET', '/pipeline/counts');
check(r.json.data.onboarding.GET_STARTED === 1, 'Get started count', r);
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
const begin = (who: string, customer: string, documentType: string, fileName = 'Galaxy Invoice.pdf', extra: object = {}) =>
  api(who, 'POST', `/pipeline/customers/${customer}/documents`, { documentType, fileName, mimeType: 'application/pdf', sizeBytes: PDF.length, ...extra });

r = await begin('a', leadA, 'INVOICE', 'x.png', { mimeType: 'image/png' });
check(r.status === 422, 'non-PDF declared type rejected', r);
r = await begin('a', leadA, 'INVOICE', 'big.pdf', { sizeBytes: 21 * 1024 });
check(r.status === 422, 'an invoice over 20 KB is refused', r);
r = await begin('a', leadA, 'IMPORTANT_DOCUMENTS', 'big.pdf', { sizeBytes: 501 * 1024 });
check(r.status === 422, 'any other document over 500 KB is refused', r);
r = await begin('a', leadA, 'INVOICE', 'big.pdf', { sizeBytes: 30 * 1024 * 1024 });
check(r.status === 422, 'oversize file rejected before upload', r);
r = await begin('b', leadA, 'INVOICE');
check(r.status === 404, "member B cannot upload to A's customer", r);

r = await begin('a', leadA, 'INVOICE', 'fake.pdf');
check(r.status === 201 && r.json.data.token && r.json.data.path === `customers/${leadA}/invoices/${r.json.data.document.id}.pdf` && r.json.data.document.status === 'PENDING',
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

r = await begin('a', leadA, 'INVOICE');
ticket = r.json.data;
r = await api('a', 'POST', `/documents/${ticket.document.id}/complete`);
check(r.status === 422 && /did not finish/.test(r.json.error.message), 'complete without an object → no fake success', r);

r = await begin('a', leadA, 'INVOICE');
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
check(r.status === 200 && r.json.data.status === 'UPLOADED' && r.json.data.version === 1 && r.json.data.sizeBytes === PDF.length, 'invoice v1 uploaded', r);
const invoiceV1 = r.json.data.id;

r = await api('b', 'GET', `/documents/${invoiceV1}/url`);
check(r.status === 404, "member B cannot get a URL for A's document", r);
const direct = await fetch(`${GW}/storage/v1/object/sign/${ticket.bucket}/${ticket.path}`, {
  method: 'POST', headers: { authorization: `Bearer ${tokens.get('b')}`, 'content-type': 'application/json' }, body: '{"expiresIn":60}' });
check(direct.status >= 400, 'storage cannot be signed with a user token (private bucket)');
r = await api('a', 'GET', `/documents/${invoiceV1}/url?action=view`);
check(r.status === 200 && r.json.data.expiresInSeconds <= 300 && r.json.data.fileName === 'Galaxy Invoice.pdf', 'short-lived signed view URL', r);
const fileText = await fetch(r.json.data.url).then(x => x.text());
check(fileText.startsWith('%PDF-'), 'signed URL serves the stored PDF');
r = await api('th', 'GET', `/documents/${invoiceV1}/url?action=download`);
check(r.status === 200 && /download=/.test(r.json.data.url), 'team head can download team documents', r);

r = await begin('a', leadA, 'INVOICE', 'Invoice v2.pdf');
ticket = r.json.data;
await put(ticket, PDF);
r = await api('a', 'POST', `/documents/${ticket.document.id}/complete`);
check(r.status === 200 && r.json.data.version === 2, 'replacement creates version 2', r);
r = await api('a', 'GET', `/pipeline/customers/${leadA}`);
const invoices = r.json.data.documents.filter((d: any) => d.documentType === 'INVOICE');
check(invoices.length === 2 && invoices.find((d: any) => d.version === 1).status === 'SUPERSEDED' && r.json.data.onboarding.mandatorySaved === 1,
  'old version superseded, progress 1 of 2', r.json.data);

r = await begin('a', leadA, 'IMPORTANT_DOCUMENTS', 'kyc.pdf');
ticket = r.json.data;
check(ticket.path.includes('/onboarding/'), 'important documents stored under onboarding/');
await put(ticket, PDF);
r = await api('a', 'POST', `/documents/${ticket.document.id}/complete`);
const importantDoc = r.json.data.id;
r = await api('a', 'GET', '/pipeline/customers?stage=ONBOARDING&onboarding=COLLECTING');
check(r.json.data.total === 1 && r.json.data.items[0].onboarding.mandatorySaved === 2 && r.json.data.items[0].onboarding.itemsSaved === 2,
  'onboarding filter: still collecting (2 of 13 items)', r);

// a pending upload abandoned by the browser
r = await begin('a', leadA, 'IMPORTANT_DOCUMENTS', 'abandoned.pdf');
const abandoned = r.json.data;
await put(abandoned, PDF);
r = await api('a', 'POST', `/documents/${abandoned.document.id}/abort`);
check(r.status === 200, 'aborted upload acknowledged');
keys = await fetch(`${GW}/storage/v1/__objects`, { headers: { authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` } }).then(x => x.json()) as string[];
check(!keys.some(k => k.includes(abandoned.document.id)), 'aborted upload object cleaned up');

// --- service checklist (Meta Ads + AI Calling) -----------------------------------
r = await api('a', 'GET', `/pipeline/customers/${leadA}`);
const checklist = r.json.data.checklist as any[];
check(checklist.length === 13 && !checklist.some((c: any) => c.code === 'GST_CERTIFICATE') && checklist[0].section === 'BUSINESS_BASICS' && checklist[checklist.length - 1].code === 'IMPORTANT_DOCUMENTS',
  'checklist built from the services sold (basics first, mandatory documents last)', checklist.map((c: any) => c.code));
check(checklist.filter((c: any) => c.entry?.status === 'SAVED').length === 2, 'uploaded mandatory documents already count as saved');
r = await api('a', 'POST', `/pipeline/customers/${leadA}/forward-to-support`);
check(r.status === 422 && /Complete these items first/.test(r.json.error.message), 'forward blocked until every checklist item is saved', r);
r = await api('a', 'PATCH', `/pipeline/customers/${leadA}/checklist/AI_CALL_PLAN`, { value: 'Weekly' });
check(r.status === 422, 'choice items only accept listed options', r);
r = await api('b', 'PATCH', `/pipeline/customers/${leadA}/checklist/META_AD_BUDGET`, { value: '15000' });
check(r.status === 404, "member B cannot fill A's checklist", r);
for (const [code, value] of Object.entries({
  BUSINESS_NAME_ADDRESS: 'Galaxy Jewellers, Thane', CONTACT_PERSON_MOBILE: 'Siddhesh +91 98200 11111', META_CAMPAIGN_GOAL: 'Diwali walk-ins',
  FACEBOOK_PAGE_ACCESS: 'Partner access granted', INSTAGRAM_PAGE_ACCESS: 'Connected', META_TARGET_AUDIENCE: 'Thane, 25-45', META_AD_BUDGET: '15000',
  AI_CALL_BUSINESS_ROLE: 'Jeweller; agent speaks as store manager', AI_CALL_CUSTOMER_NUMBER: '+91 98200 11111', AI_CALL_SCRIPT: 'Gold rate offers',
  AI_CALL_PLAN: 'Credit-based'
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
check(r.json.data.total === 1 && r.json.data.items[0].onboarding.itemsSaved === 13, 'ready for handover once all 13 items are saved', r);

r = await api('b', 'DELETE', `/documents/${importantDoc}`);
check(r.status === 404, "member B cannot delete A's document", r);
// Accounts confirms the amount before the Technical Consultant gets the customer.
const accountsDept = (await api('sa', 'GET', '/departments')).json.data.find((d: any) => d.slug === 'accounts');
r = await api('sa', 'POST', '/users', { email: 'dh.acc@amuwa.com', fullName: 'Accounts Head', password: 'Sup3rSecret!', role: 'DEPARTMENT_HEAD', departmentId: accountsDept.id });
check(r.status === 201, 'super admin creates the Accounts department head', r);
tokens.set('accdh', tokenFor(r.json.data.id));
const accTeam = (await api('sa', 'GET', `/teams?departmentId=${accountsDept.id}`)).json.data[0].id;
r = await api('accdh', 'POST', '/users', { email: 'acc.m@amuwa.com', fullName: 'Accounts Member', password: 'Sup3rSecret!', role: 'TEAM_MEMBER', teamId: accTeam });
check(r.status === 201 && r.json.data.defaultDashboard === 'accounts-staff', 'an Accounts member resolves to the Accounts dashboard', r);
tokens.set('accm', tokenFor(r.json.data.id));

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
r = await api('a', 'DELETE', `/documents/${invoiceV1}`);
check(r.status === 200, 'superseded version can be deleted', r);
r = await api('a', 'GET', `/documents/${invoiceV1}/url`);
check(r.status === 404, 'deleted document is no longer reachable');

const { rows: audit } = await db.query(
  `select action from public.audit_logs where entity_type = 'customer_document' order by created_at`);
const actions = audit.map((x: any) => x.action);
for (const a of ['INVOICE_UPLOADED', 'INVOICE_REPLACED', 'DOCUMENT_UPLOADED', 'DOCUMENT_VIEWED', 'DOCUMENT_DOWNLOADED', 'INVOICE_DELETED']) {
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
r = await api('tc', 'GET', '/pipeline/customers?stage=ONBOARDING&forwarded=true');
check(r.json.data.total === 1 && r.json.data.items[0].id === leadA, 'consultant sees forwarded customers of their department', r);
r = await api('tc', 'GET', `/pipeline/customers/${leadA}`);
check(r.status === 200 && r.json.data.checklist.length === 13, 'consultant opens the full checklist', r);
r = await api('tc', 'GET', `/documents/${importantDoc}/url?action=view`);
check(r.status === 200, 'consultant can view the documents', r);
r = await api('tc', 'PATCH', `/pipeline/customers/${leadA}/checklist/META_AD_BUDGET`, { value: '1' });
check(r.status === 404, 'consultant cannot change sales data', r);
r = await api('tc', 'POST', `/pipeline/customers/${leadA}/checklist/IMPORTANT_DOCUMENTS/review`, { decision: 'REJECTED' });
check(r.status === 422, 'rejection requires a note', r);
r = await api('tc', 'POST', `/pipeline/customers/${leadA}/checklist/IMPORTANT_DOCUMENTS/review`, { decision: 'REJECTED', note: 'Certificate is blurred' });
check(r.status === 200, 'consultant rejects an item with a note', r);
r = await api('tc', 'GET', '/pipeline/customers?stage=ONBOARDING&review=NEEDS_FIX');
check(r.json.data.total === 1, 'review queue filter: needs fixing', r);
r = await api('b', 'POST', `/pipeline/customers/${leadA}/checklist/AI_CALL_PLAN/review`, { decision: 'VERIFIED' });
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
check(r.json.data.total === 1 && r.json.data.items[0].onboarding.itemsVerified === 13, 'all items verified', r);
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
  && sheetRows[0].services.includes('Meta Ads Management'), 'sheet receives the customer, services and secret', sheetRows[0]);
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
check(normal.headers.get('ratelimit-limit') === '300' && normal.headers.get('x-request-id') && normal.headers.get('x-content-type-options') === 'nosniff',
  'responses carry RateLimit-*, X-Request-Id and security headers');

const health = await fetch(base + '/health').then(x => x.json()) as any;
check(health.success && health.data.checks.database.startsWith('ok'), 'public health check reports database ok', health);
const viaRewrite = await fetch(base.replace('/api/v1', '') + '/api/crm?__path=approval-requests/' + orphanReq.id + '/approve', {
  method: 'POST', headers: { authorization: `Bearer ${tokens.get('sa')}`, 'content-type': 'application/json' }, body: '{}'
});
check(viaRewrite.status === 409, 'Vercel rewrite form (?__path=) routes multi-segment POSTs', viaRewrite.status);
r = await api('sa', 'PUT', '/customers');
check(r.status === 405, 'wrong method → 405');

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
