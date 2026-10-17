/**
 * Accounts creating a client login (PipelineService.accountsCreateClientLogin) with a fake database and a fake sign-in service:
 * the order of the steps, what is recorded when something fails, and that a failed attempt leaves no half-made login behind.
 */
import { PipelineService } from '../../server/services/PipelineService.js';
import { AppError } from '../../server/http/errors.js';

let passed = 0;
function check(ok: unknown, label: string, extra?: unknown) {
  if (!ok) {
    console.error(`FAILED: ${label}`, extra === undefined ? '' : JSON.stringify(extra));
    process.exit(1);
  }
  passed++;
  console.log(`ok - ${label}`);
}

const CUSTOMER = '11111111-1111-4111-8111-111111111111';
const actor = { id: '22222222-2222-4222-8222-222222222222' } as any;

function make(opts: { begin?: () => void; createUser?: () => string; record?: () => void } = {}) {
  const log: string[] = [];
  const repo = {
    accountsClientLoginBegin: async (id: string, email: string) => { log.push(`begin ${email}`); opts.begin?.(); },
    recordClientAccount: async (id: string, userId: string, email: string, secret: string | null) => { log.push(`record ${userId} secret=${secret}`); opts.record?.(); },
    accountsClientLoginFailed: async (id: string, message: string) => { log.push(`failed: ${message}`); }
  };
  const authAdmin = {
    createClientUser: async (i: { email: string; password: string; customerId: string }) => { log.push(`create ${i.email}`); return opts.createUser ? opts.createUser() : 'user-1'; },
    deleteUser: async (id: string) => { log.push(`delete ${id}`); }
  };
  const svc = new PipelineService(repo as any, {} as any, authAdmin as any);
  return { svc, log };
}
const body = { email: 'Client@Example.com', password: 'ClientPass#2026' };

// success: begin -> create the Auth user -> record it; no password is passed on to be e-mailed
let t = make();
let out = await t.svc.accountsCreateClientLogin(actor, CUSTOMER, body);
check(out.email === 'client@example.com' && t.log.join('|') === 'begin client@example.com|create client@example.com|record user-1 secret=null', 'the steps run in order and no password is handed on to be stored or e-mailed', t.log);

// invalid input never reaches the database
t = make();
for (const bad of [{ email: 'nope', password: 'ClientPass#2026' }, { email: 'a@b.co', password: 'short' }, { email: 'a@b.co', password: 'ClientPass#2026', extra: 1 }, {}]) {
  try { await t.svc.accountsCreateClientLogin(actor, CUSTOMER, bad); check(false, 'invalid input must be refused'); } catch (e) { check(e instanceof AppError && e.code === 'VALIDATION_ERROR', 'invalid input is refused before anything is done'); }
}
try { await t.svc.accountsCreateClientLogin(actor, 'not-a-uuid', body); check(false, 'bad id'); } catch (e) { check(e instanceof AppError && e.code === 'VALIDATION_ERROR', 'a malformed customer id is refused'); }
check(t.log.length === 0, 'and nothing was started', t.log);

// refused by the database (not allowed / second click): nothing is created, nothing is marked failed
t = make({ begin: () => { throw new AppError('CONFLICT', 'The login is already being created.'); } });
try { await t.svc.accountsCreateClientLogin(actor, CUSTOMER, body); check(false, 'conflict'); } catch (e) { check(e instanceof AppError && e.code === 'CONFLICT', 'a refusal from the database reaches the caller'); }
check(t.log.join('|') === 'begin client@example.com', 'no Auth user is created and the running attempt is not marked failed', t.log);

// the sign-in service fails: recorded as failed with the reason, so Accounts can retry
t = make({ createUser: () => { throw new AppError('INTERNAL', 'Could not create the client login.'); } });
try { await t.svc.accountsCreateClientLogin(actor, CUSTOMER, body); check(false, 'internal'); } catch (e) { check(e instanceof AppError && e.code === 'INTERNAL', 'a sign-in service failure reaches the caller'); }
check(t.log.join('|') === 'begin client@example.com|create client@example.com|failed: Could not create the client login.', 'it is recorded as failed with a message safe to show', t.log);

// the Auth user was created but the record failed: the user is removed (a retry starts clean) and the failure recorded
t = make({ record: () => { throw new AppError('CONFLICT', 'This customer already has a login.'); } });
try { await t.svc.accountsCreateClientLogin(actor, CUSTOMER, body); check(false, 'record'); } catch (e) { check(e instanceof AppError && e.code === 'CONFLICT', 'a recording failure reaches the caller'); }
check(t.log.join('|') === 'begin client@example.com|create client@example.com|record user-1 secret=null|delete user-1|failed: This customer already has a login.', 'the half-made login is deleted and the failure recorded', t.log);

// an unexpected error never leaks its text into the stored reason
t = make({ createUser: () => { throw new Error('connect ECONNREFUSED postgres://user:secret@db.internal:5432/crm'); } });
try { await t.svc.accountsCreateClientLogin(actor, CUSTOMER, body); check(false, 'raw'); } catch { /* expected */ }
check(t.log.at(-1) === 'failed: The login could not be created.' && !t.log.join('').includes('secret@'), 'an unexpected error is stored as a generic message, never its details', t.log);

// a failure of the failure-recording itself does not hide the real error
{
  const log: string[] = [];
  const repo = { accountsClientLoginBegin: async () => {}, recordClientAccount: async () => {}, accountsClientLoginFailed: async () => { throw new Error('db down'); } };
  const authAdmin = { createClientUser: async () => { throw new AppError('INTERNAL', 'Could not create the client login.'); }, deleteUser: async () => { log.push('delete'); } };
  try { await new PipelineService(repo as any, {} as any, authAdmin as any).accountsCreateClientLogin(actor, CUSTOMER, body); check(false, 'x'); }
  catch (e) { check(e instanceof AppError && e.message === 'Could not create the client login.', 'the original error is what the caller sees even if recording the failure also fails'); }
}

console.log(`=== ALL JOURNEY SERVICE TESTS PASSED (${passed}) ===`);
