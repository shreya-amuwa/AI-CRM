// Unit test of the error-reporting rules (shared/sentryScrub.ts, server/monitoring.ts): nothing personal leaves in a report, and only
// defects / outages (5xx) are reported, never the caller's own mistakes (4xx).
import { cleanUrl, maskText, scrubBreadcrumb, scrubSentryEvent, IGNORED_ERRORS, MASK } from '../../shared/sentryScrub';
import { reportServerError, setErrorReporter, shouldReportError, type ErrorReport } from '../../server/monitoring';
import { AppError } from '../../server/http/errors';
import { ConfigurationError } from '../../server/config/env';

let passed = 0;
const check = (ok: boolean, name: string, extra?: unknown) => { if (!ok) { console.error('not ok -', name, extra ?? ''); process.exit(1); } passed++; console.log('ok -', name); };
const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1rwWvRPHDpTz1Z4M';

// --- masking
check(maskText('Could not send to asha.k+crm@amuwa.com now') === `Could not send to ${MASK} now`, 'an e-mail address in a message is masked');
check(maskText('call 9876543210 or +91 98765 43210 or 098765-43210') === `call ${MASK} or ${MASK} or ${MASK}`, 'Indian mobile numbers are masked');
check(maskText('order 1794814580023 at 2026-11-16') === 'order 1794814580023 at 2026-11-16', 'long ids and dates are left alone');
check(!maskText(`token ${jwt} failed`).includes('eyJ') && maskText('Authorization: Bearer abcdefghijklmnop').includes(`Bearer ${MASK}`), 'login tokens (JWT, Bearer) are masked');
check(maskText('/set-password?token_hash=abc123&type=recovery#access_token=xyz') === `/set-password?token_hash=${MASK}&type=recovery#access_token=${MASK}`, 'token_hash / access_token pairs are masked');
check(cleanUrl('https://crm.example.com/api/v1/profiles?email=eq.asha@amuwa.com#x') === 'https://crm.example.com/api/v1/profiles', 'a URL loses its query string and fragment');

// --- a whole event
const event: any = {
  event_id: 'abc123abc123abc123abc123abc123ab', message: 'Failed for rahul@example.com',
  user: { id: 'u1', email: 'a@b.com', ip_address: '1.2.3.4' },
  request: { url: 'https://crm.example.com/api/v1/customers?phone=9876543210', method: 'GET', cookies: { sb: 'x' }, headers: { authorization: `Bearer ${jwt}` }, data: { name: 'Rahul' }, query_string: 'phone=9876543210' },
  contexts: { geo: { city: 'Pune' }, runtime: { name: 'node' } },
  exception: { values: [{ type: 'Error', value: 'duplicate key for 9876543210', stacktrace: { frames: [{ filename: '/var/task/server/app.js', lineno: 10 }] } }] },
  breadcrumbs: [{ category: 'fetch', data: { url: 'https://x.supabase.co/rest/v1/profiles?email=eq.a@b.com', status_code: 500 } }],
  tags: { route: '/customers/:id' }
};
const out: any = scrubSentryEvent(event);
check(out.user === undefined && out.request.cookies === undefined && out.request.headers === undefined && out.request.data === undefined && out.request.query_string === undefined && out.contexts.geo === undefined,
  'user, cookies, headers, body, query string and location are removed from an event');
check(out.request.url === 'https://crm.example.com/api/v1/customers' && out.message === `Failed for ${MASK}` && out.exception.values[0].value === `duplicate key for ${MASK}`, 'texts and the request URL are masked');
check(out.event_id === 'abc123abc123abc123abc123abc123ab' && out.exception.values[0].stacktrace.frames[0].filename === '/var/task/server/app.js' && out.tags.route === '/customers/:id' && out.contexts.runtime.name === 'node',
  'what is needed to find the defect is kept: event id, stack frames, route, runtime');
check(out.breadcrumbs[0].data.url === 'https://x.supabase.co/rest/v1/profiles' && out.breadcrumbs[0].data.status_code === 500, 'a breadcrumb keeps the status but not the query');
check(scrubBreadcrumb({ category: 'console', message: 'user said hello' }) === null && scrubBreadcrumb({ category: 'ui.click', message: 'body > button.save' })?.message === 'body > button.save', 'console output is dropped, clicks are kept');
check(IGNORED_ERRORS.some(r => r instanceof RegExp && r.test('Failed to fetch dynamically imported module: https://x/assets/a.js')) && IGNORED_ERRORS.includes('ResizeObserver loop limit exceeded'), 'browser noise is ignored');

// --- what the API reports
check(shouldReportError(new AppError('INTERNAL')) && shouldReportError(new AppError('SERVICE_UNAVAILABLE')), '500 and 503 (a defect, a busy database) are reported');
check(!shouldReportError(new AppError('VALIDATION_ERROR')) && !shouldReportError(new AppError('FORBIDDEN')) && !shouldReportError(new AppError('UNAUTHENTICATED')) && !shouldReportError(new AppError('RATE_LIMITED')) && !shouldReportError(new AppError('NOT_FOUND')),
  'the caller\'s own mistakes (422, 403, 401, 429, 404) are not');
check(shouldReportError(new TypeError('x is undefined')) && shouldReportError(new ConfigurationError('missing SUPABASE_URL')), 'an unexpected exception and a missing setting are reported');
check(!shouldReportError(Object.assign(new Error('Payload Too Large'), { status: 413 })) && shouldReportError(Object.assign(new Error('boom'), { status: 502 })), 'a framework exception with a client status is not reported');

const seen: ErrorReport[] = [];
reportServerError({ error: new AppError('INTERNAL') });
check(seen.length === 0, 'with no reporter registered (Worker, tests) reporting does nothing');
setErrorReporter(r => { seen.push(r); });
reportServerError({ error: new AppError('INTERNAL'), requestId: 'r1', route: '/customers/:id', method: 'POST', status: 500, role: 'TEAM_MEMBER' });
reportServerError({ error: new AppError('VALIDATION_ERROR') });
check(seen.length === 1 && seen[0].requestId === 'r1' && seen[0].route === '/customers/:id', 'a registered reporter gets the 5xx, not the 422');
setErrorReporter(() => { throw new Error('reporter is down'); });
let threw = false;
try { reportServerError({ error: new Error('x') }); } catch { threw = true; }
check(!threw, 'a failing reporter never breaks the request');
setErrorReporter(null);
console.log(`=== SENTRY REPORTING TESTS PASSED (${passed}) ===`);
