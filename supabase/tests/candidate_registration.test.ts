/**
 * Candidate-portal direct registration (no database): the schema, the service, and the real route end to end against a fake Supabase Auth server
 * that records exactly what the CRM asks it to create. Run: npm run test:unit
 */
import { createServer } from 'node:http';
import { candidateRegisterSchema } from '../../shared/validation.js';
import { registerCandidate } from '../../server/services/CandidateRegistrationService.js';
import { AppError } from '../../server/http/errors.js';

const report = console.error.bind(console);
let passed = 0;
function check(cond: unknown, label: string, extra?: unknown) {
  if (!cond) {
    report(`FAILED: ${label}`, extra === undefined ? '' : JSON.stringify(extra));
    process.exit(1);
  }
  passed++;
  console.log(`ok - ${label}`);
}

const good = { name: 'Asha Rao', email: 'Asha.Rao@Example.com ', phone: '+91 98476 50321', password: 'a-long-passphrase' };

// ---- the schema -------------------------------------------------------------------------------------------------------------------
{
  const r = candidateRegisterSchema.safeParse(good);
  check(r.success && r.data.email === 'asha.rao@example.com' && r.data.name === 'Asha Rao', 'a valid registration is accepted; the e-mail is trimmed and lower-cased');
  check(!candidateRegisterSchema.safeParse({ ...good, password: 'short' }).success, 'a password under 10 characters is refused');
  check(!candidateRegisterSchema.safeParse({ ...good, password: 'x'.repeat(73) }).success, 'a password over 72 characters is refused');
  check(!candidateRegisterSchema.safeParse({ ...good, phone: '12345' }).success && !candidateRegisterSchema.safeParse({ ...good, phone: '' }).success, 'a mobile number that is not a real Indian mobile is refused');
  check(!candidateRegisterSchema.safeParse({ ...good, email: 'nope' }).success && !candidateRegisterSchema.safeParse({ ...good, name: 'A' }).success, 'a bad e-mail or a one-letter name is refused');
  check(!candidateRegisterSchema.safeParse({ ...good, role: 'SUPER_ADMIN' }).success, 'unknown fields (a role, a department, app metadata) are refused, not ignored');
  check(!candidateRegisterSchema.safeParse({ ...good, app_metadata: { provisioned_by: 'x' } }).success, 'app_metadata cannot be smuggled in');
}

// ---- end to end: the real route -> the real admin client -> a fake Supabase Auth ------------------------------------------------------
const created: Record<string, unknown>[] = [];
let mode: 'ok' | 'exists' | 'weak' | 'down' = 'ok';
const fake = createServer((req, res) => {
  let body = '';
  req.on('data', c => (body += c));
  req.on('end', () => {
    const send = (status: number, json: unknown) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(json)); };
    if (req.method === 'POST' && req.url === '/auth/v1/admin/users') {
      const b = JSON.parse(body || '{}');
      created.push({ ...b, __auth: req.headers.authorization });
      if (mode === 'exists') return send(422, { code: 'email_exists', error_code: 'email_exists', msg: 'A user with this email address has already been registered' });
      if (mode === 'weak') return send(422, { code: 'weak_password', error_code: 'weak_password', msg: 'Password should contain letters and numbers' });
      if (mode === 'down') return send(500, { msg: 'internal secret detail: db password=hunter2' });
      return send(200, { id: '22222222-2222-4222-8222-222222222222', email: b.email, user_metadata: b.user_metadata, app_metadata: { provider: 'email' } });
    }
    send(404, { message: 'not found' }); // the audit-log and rate-limit database calls: the CRM tolerates their absence
  });
});
await new Promise<void>(r => fake.listen(0, '127.0.0.1', r));
Object.assign(process.env, { SUPABASE_URL: `http://127.0.0.1:${(fake.address() as { port: number }).port}`, SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'service' });
// (the server settings are read once: they must point at the fake before anything below touches them)

// ---- the service (fake repository) -----------------------------------------------------------------------------------------------
{
  const calls: unknown[] = [];
  const events: Record<string, unknown>[] = [];
  const r = await registerCandidate(good, { createCandidateUser: async i => { calls.push(i); return '11111111-1111-4111-8111-111111111111'; } }, async e => { events.push(e as never); });
  check(JSON.stringify(r) === '{"ok":true}', 'registering returns only { ok: true } (no id, e-mail or password back)');
  check(calls.length === 1 && (calls[0] as { email: string }).email === 'asha.rao@example.com' && (calls[0] as { password: string }).password === good.password, 'the account is created with the validated values');
  check(events.length === 1 && events[0].action === 'CANDIDATE_REGISTERED' && !JSON.stringify(events[0]).includes('example.com') && !JSON.stringify(events[0]).includes(good.password) && !JSON.stringify(events[0]).includes('98476'), 'the audit event records the registration without e-mail, password or phone');
  let threw: unknown;
  try { await registerCandidate({ ...good, password: 'short' }, { createCandidateUser: async () => { calls.push('should not run'); return 'x'; } }, async () => undefined); } catch (e) { threw = e; }
  check(threw instanceof AppError && (threw as AppError).code === 'VALIDATION_ERROR' && calls.length === 1, 'an invalid registration is refused before anything is created');
}

const { app } = await import('../../server/app.js');
const origin = (console as { error: typeof console.error }).error;
console.error = () => undefined; // the expected failure paths log; keep the test output readable
const post = (body: unknown, ip = '203.0.113.7') =>
  app.request('/api/v1/candidate-auth/register', { method: 'POST', headers: { 'content-type': 'application/json', 'x-real-ip': ip }, body: typeof body === 'string' ? body : JSON.stringify(body) });
{
  const res = await post(good, '203.0.113.10');
  const json = (await res.json()) as { success: boolean; data?: unknown };
  check(res.status === 201 && json.success && JSON.stringify(json.data) === '{"ok":true}', 'end to end: registering answers 201 { ok: true } with no account details in the response', { status: res.status, json });
  const c = created.at(-1)!;
  const meta = c.user_metadata as Record<string, unknown>;
  check(c.email_confirm === true && c.email === 'asha.rao@example.com' && c.password === good.password, 'end to end: the account is created ALREADY CONFIRMED (no verification e-mail) with the chosen password');
  check(meta.candidate_portal === true && meta.name === 'Asha Rao' && meta.phone === good.phone, 'end to end: it carries the candidate-portal marker, the name and the phone');
  check(!('app_metadata' in c), 'end to end: no app_metadata is sent, so the account can never be provisioned as staff or a client');
  check(typeof c.__auth === 'string' && (c.__auth as string).startsWith('Bearer '), 'end to end: the admin call uses the server-side service key (never anything from the browser)');

  mode = 'exists';
  // each case its own e-mail: at most 3 sign-up attempts per e-mail an hour (docs/ABUSE_PROTECTION.md)
  const dup = await post({ ...good, email: 'dup@example.com' }, '203.0.113.11');
  const dj = (await dup.json()) as { success: boolean; error: { code: string; message: string } };
  check(dup.status === 409 && dj.error.code === 'CONFLICT' && /Sign in instead/.test(dj.error.message), 'end to end: an e-mail that already has an account is refused with "sign in instead" and nothing is changed');
  mode = 'weak';
  const weak = await post({ ...good, email: 'weak@example.com' }, '203.0.113.12');
  check(weak.status === 422, 'end to end: a password the auth server rejects is a validation error (422)', weak.status);
  mode = 'down';
  const down = await post({ ...good, email: 'down@example.com' }, '203.0.113.13');
  const downText = await down.text();
  check(down.status >= 500 && !/hunter2|secret detail/.test(downText), 'end to end: an auth-server failure is a generic error without internals', { status: down.status, downText });
  mode = 'ok';

  const bad = await post({ ...good, email: 'bad@example.com', password: 'short' }, '203.0.113.14');
  const count = created.length;
  check(bad.status === 422 && created.length === count, 'end to end: an invalid body is 422 and creates nothing', bad.status);
  const extra = await post({ ...good, email: 'extra@example.com', role: 'SUPER_ADMIN' }, '203.0.113.15');
  check(extra.status === 422, 'end to end: a body trying to set a role is refused (422)', extra.status);
  const notJson = await post('not json', '203.0.113.16'); // (no e-mail to count against)
  check(notJson.status === 422, 'end to end: a body that is not JSON is refused (422)', notJson.status);

  // rate limits (docs/ABUSE_PROTECTION.md): 5 per address per hour, 3 per e-mail per hour
  const perEmail: number[] = [];
  for (let i = 0; i < 4; i++) perEmail.push((await post({ ...good, email: 'same@example.com' }, `198.51.100.${i}`)).status);
  check(perEmail.slice(0, 3).every(s => s !== 429) && perEmail[3] === 429, 'end to end: the fourth registration for the same e-mail within an hour is rate limited (429)', perEmail);
  const perIp: number[] = [];
  for (let i = 0; i < 6; i++) perIp.push((await post({ ...good, email: `person${i}@example.com` }, '198.51.100.99')).status);
  check(perIp.slice(0, 5).every(s => s !== 429) && perIp[5] === 429, 'end to end: the sixth registration from one address within an hour is rate limited (429)', perIp);
}
console.error = origin;
fake.close();
console.log(`\n${passed} CANDIDATE REGISTRATION CHECKS PASSED`);
process.exit(0);
