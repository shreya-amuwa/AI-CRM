/**
 * Dashboard Explorer (docs/DASHBOARD_EXPLORER.md), without a browser:
 *  - every registry entry's synthetic profile opens the expected dashboard through the PRODUCTION role mapping (toAuthUser), in every
 *    department it can be previewed in - so the preview and production navigation cannot drift apart silently;
 *  - the database allowlist (migration 20270225000100) is the registry;
 *  - the preview frame's headers: sandbox without allow-same-origin, connect-src 'none', framed only by the CRM itself;
 *  - the Worker serves /dashboard-preview/* itself with those headers and never answers the app there;
 *  - the preview build swaps the live modules out (no Supabase client library in the preview bundle) when the bundle is present.
 * Run: npm run test:unit
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { DASHBOARD_IDS, DASHBOARD_REGISTRY, PREVIEW_DEPARTMENTS, improvementRequestSchema, previewLaunchSchema, previewSessionSchema } from '../../shared/dashboardExplorer.js';
import { toAuthUser } from '../../src/lib/auth/roleMapping.js';
import { buildPreviewIdentity, DEMO_ME_ID } from '../../src/dashboard-preview/runtime/previewIdentity.js';
import { PREVIEW_HEADERS, SECURITY_HEADERS, withPreviewHeaders } from '../../worker/securityHeaders.js';

let passed = 0;
function check(cond: unknown, label: string, extra?: unknown) {
  if (!cond) {
    console.error(`FAILED: ${label}`, extra === undefined ? '' : JSON.stringify(extra));
    process.exit(1);
  }
  passed++;
  console.log(`ok - ${label}`);
}

// ---- the registry follows the production role mapping ------------------------------------------------------------------------
{
  check(new Set(DASHBOARD_IDS).size === DASHBOARD_IDS.length, 'every dashboard id is unique');
  const wrong: string[] = [];
  for (const e of DASHBOARD_REGISTRY) {
    for (const dept of e.departments) {
      const id = buildPreviewIdentity(e.id, dept);
      if (!id) { wrong.push(`${e.id}@${dept}: no identity`); continue; }
      const role = toAuthUser(id.profile).role;
      if (role !== e.expectedRole) wrong.push(`${e.id}@${dept}: ${role} (expected ${e.expectedRole})`);
      if (id.profile.id !== DEMO_ME_ID || !id.profile.email.endsWith('@example.invalid') || id.profile.role === ('SUPER_ADMIN' as string)) wrong.push(`${e.id}: not synthetic`);
    }
  }
  check(wrong.length === 0, `each of the ${DASHBOARD_REGISTRY.length} positions opens its production dashboard in every department it lists`, wrong);
  check(buildPreviewIdentity('ceo-sales', 'hr') === null && buildPreviewIdentity('nope', 'mpillar') === null, 'a position outside its departments, or outside the registry, has no preview');
  const ceo = buildPreviewIdentity('ceo-sales', 'mpillar')!;
  check(ceo.profile.isOperationsHead === true && ceo.profile.role === 'DEPARTMENT_HEAD' && toAuthUser(ceo.profile).role === 'sales-head', 'CEO – Sales is a Department Head with the CEO flag on the Sales side (internal names unchanged)');
  const multi = buildPreviewIdentity('ceo-multi', 'mpillar')!;
  check((multi.scopes?.departments.length ?? 0) >= 2, 'the CEO with several departments gets the production department choice');
  check(DASHBOARD_REGISTRY.filter(e => e.availability === 'NO_DASHBOARD_YET').every(e => e.expectedRole === 'sales-role'), 'roles without a dashboard open the production "not set up yet" page, nothing invented');
}

// ---- payloads ----------------------------------------------------------------------------------------------------------------------
{
  check(previewLaunchSchema.safeParse({ dashboardId: 'sales-team-lead', department: 'mpillar', scenario: 'normal', epoch: 1 }).success, 'a launch message for a listed dashboard is accepted');
  check(!previewLaunchSchema.safeParse({ dashboardId: 'super-admin', department: 'mpillar', scenario: 'normal', epoch: 1 }).success, 'the Managing Director\'s own dashboard is not previewable');
  check(!previewSessionSchema.safeParse({ dashboardId: 'sales-team-lead', department: 'atlantis' }).success, 'a session for an unknown department is refused');
  const base = { dashboardId: 'support-department-head', department: 'mpillar', viewport: 'mobile', title: 'Show overdue tickets', description: 'Overdue tickets first, please.', priority: 'HIGH', clientRequestId: 'abcdefgh-1' };
  check(improvementRequestSchema.safeParse(base).success, 'a complete improvement request is accepted');
  check(!improvementRequestSchema.safeParse({ ...base, title: 'x' }).success && !improvementRequestSchema.safeParse({ ...base, priority: 'NOW' }).success, 'a short title or an unknown priority is refused');
}

// ---- the database allowlist is the registry ----------------------------------------------------------------------------------------
{
  const sql = readFileSync('supabase/migrations/20270225000100_dashboard_explorer.sql', 'utf8');
  const arr = (fn: string) => {
    const body = sql.slice(sql.indexOf(`function private.${fn}()`));
    return [...body.slice(0, body.indexOf(']::text[]')).matchAll(/'([a-z0-9-]+)'/g)].map(m => m[1]);
  };
  check(JSON.stringify(arr('dashboard_explorer_ids')) === JSON.stringify([...DASHBOARD_IDS]), 'the migration\'s dashboard allowlist equals shared/dashboardExplorer.ts', { db: arr('dashboard_explorer_ids') });
  check(JSON.stringify(arr('dashboard_explorer_departments')) === JSON.stringify(PREVIEW_DEPARTMENTS.map(d => d.slug)), 'the migration\'s department list equals the registry');
  check(/me\.role <> 'SUPER_ADMIN'/.test(sql) && !/is_operations_head\s*=\s*true/.test(sql), 'only SUPER_ADMIN passes; the CEO flag grants nothing');
}

// ---- the preview frame's headers ---------------------------------------------------------------------------------------------------
{
  const csp = PREVIEW_HEADERS['Content-Security-Policy'];
  const sandbox = csp.split(';').map(s => s.trim()).find(s => s.startsWith('sandbox')) ?? '';
  check(sandbox.includes('allow-scripts') && !sandbox.includes('allow-same-origin') && !sandbox.includes('allow-top-navigation') && !sandbox.includes('allow-popups'),
    'sandbox: scripts yes; same origin, top navigation and pop-ups no (the frame cannot read the Managing Director\'s session)', sandbox);
  for (const d of ["connect-src 'none'", "worker-src 'none'", "frame-src 'none'", "form-action 'none'", "frame-ancestors 'self'", "default-src 'none'"]) check(csp.includes(d), `CSP has ${d}`);
  check(!/https:\s|wss:/.test(csp.replace(/https:\/\/fonts\.(googleapis|gstatic)\.com/g, '')), 'no network origin is allowed apart from the fonts', csp);
  check(PREVIEW_HEADERS['X-Frame-Options'] === 'SAMEORIGIN' && SECURITY_HEADERS['X-Frame-Options'] === 'DENY', 'the preview may be framed by the CRM only; every other page stays unframeable');
  const r = withPreviewHeaders(new Response('x', { headers: { 'Content-Security-Policy': SECURITY_HEADERS['Content-Security-Policy'] } }));
  check(r.headers.get('content-security-policy') === csp, 'the preview policy replaces (not joins) the site-wide one');
}

// ---- the Worker serves /dashboard-preview/* itself -----------------------------------------------------------------------------------
{
  Object.assign(process.env, { SUPABASE_URL: 'https://project.supabase.example', SUPABASE_ANON_KEY: 'anon', API_ACCESS_LOG: 'off' });
  const { handleRequest } = await import('../../worker/index.js');
  const seen: string[] = [];
  const assets = { fetch: async (req: Request) => { const p = new URL(req.url).pathname; seen.push(p); return p === '/dashboard-preview/index.html' || p === '/dashboard-preview/assets/main.js' ? new Response('ok', { status: 200 }) : new Response('nf', { status: 404 }); } };
  const env = { ASSETS: assets } as never;
  const home = await handleRequest(new Request('https://crm.example/dashboard-preview/'), env);
  check(home.status === 200 && seen.includes('/dashboard-preview/index.html') && home.headers.get('content-security-policy') === PREVIEW_HEADERS['Content-Security-Policy'], '/dashboard-preview/ is the preview page with the preview headers');
  const js = await handleRequest(new Request('https://crm.example/dashboard-preview/assets/main.js'), env);
  check(js.headers.get('access-control-allow-origin') === '*' && js.headers.get('x-frame-options') === 'SAMEORIGIN', 'its files carry the preview headers (CORS for the opaque-origin frame)');
  const missing = await handleRequest(new Request('https://crm.example/dashboard-preview/sales-head/dashboard/x'), env);
  check(missing.status === 404 && !seen.includes('/'), 'a missing preview path is a 404, never the CRM app');
  const post = await handleRequest(new Request('https://crm.example/dashboard-preview/', { method: 'POST' }), env);
  check(post.status === 405, 'the preview path accepts no writes');
  const wr = readFileSync('wrangler.jsonc', 'utf8');
  check(/"run_worker_first":\s*\["\/dashboard-preview\/\*"\]/.test(wr), 'wrangler routes /dashboard-preview/* to the Worker first');
}

// ---- the preview bundle has no live-data client (when it has been built) ------------------------------------------------------------
{
  const dir = 'dist/dashboard-preview/assets';
  if (!existsSync(dir)) {
    console.log('skipped - dist/dashboard-preview is not built (npm run build); the browser test builds and checks it');
  } else {
    const js = readdirSync(dir).filter(f => f.endsWith('.js')).map(f => readFileSync(`${dir}/${f}`, 'utf8')).join('\n');
    check(!/GoTrueClient|PostgrestClient|RealtimeClient/.test(js), 'the preview bundle contains no Supabase auth, PostgREST or Realtime client');
    check(!/eyJhbGciOi[A-Za-z0-9_-]{10,}|sb_publishable_[A-Za-z0-9]{8,}|\.supabase\.co\b[^/]/.test(js), 'and no Supabase key or project address');
  }
}

console.log(`=== ${passed} DASHBOARD EXPLORER CHECKS PASSED ===`);
