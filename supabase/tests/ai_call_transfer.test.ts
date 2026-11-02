/** The transfer lookup the AI calling agent makes (server/automations/aiCallTransfer.ts): the secret, the many ways a tool names things, the answers. */
import { lookupTransfer, parseTransferRequest, toolSecretOk, toolSecrets } from '../../server/automations/aiCallTransfer.js';

let passed = 0;
function check(ok: unknown, label: string, extra?: unknown) {
  if (!ok) { console.error(`FAILED: ${label}`, extra === undefined ? '' : JSON.stringify(extra)); process.exit(1); }
  passed++; console.log(`ok - ${label}`);
}

// the secret
const env = { BOLIFY_TOOL_SECRET: 'first-secret-0123456, second-secret-012345, short' } as any;
check(toolSecrets(env).length === 2 && toolSecrets({} as any).length === 0, 'secrets are 16+ characters, several may be listed, none means "not configured"');
check(toolSecretOk({ apiKey: 'first-secret-0123456' }, env) && toolSecretOk({ authorization: 'Bearer second-secret-012345' }, env), 'x-api-key and Bearer are both accepted');
check(!toolSecretOk({ apiKey: 'first-secret-0123457' }, env) && !toolSecretOk({}, env) && !toolSecretOk({ apiKey: 'short' }, env) && !toolSecretOk({ apiKey: 'first-secret-0123456' }, {} as any), 'a wrong, missing, short or unconfigured secret is refused');

// the request, however the tool names things
const p = parseTransferRequest;
check(p({ phone: '+91 98765 43210' }).phone === '+91 98765 43210' && p({ phone_number: ['9876543210'] }).phone === '9876543210' && p({ customerPhone: 9876543210 }).phone === '9876543210', 'the number: phone, phone_number (a list), customerPhone (a number)');
check(p({ variables: { customer_phone: '9876543210' }, call_id: 'abc' }).phone === '9876543210' && p({ data: { call_uuid: 'u1' } }).callId === 'u1', 'nested one level down: variables and data');
check(p({ reference: 'r1', call_id: 'c1' }).reference === 'r1' && p({ callId: 'c2' }).callId === 'c2', 'reference and call id');
check(p(null).phone === null && p('text').phone === null && p([]).phone === null && p({ phone: { a: 1 } }).phone === null && p({ phone: 'x'.repeat(500) }).phone!.length === 200, 'garbage gives nothing; long values are cut');

// the answers (a stand-in database)
const db = (data: unknown, error: unknown = null) => ({ rpc: async (fn: string, args: unknown) => { calls.push({ fn, args }); return { data, error }; } }) as any;
const calls: { fn: string; args: any }[] = [];
let a = await lookupTransfer(db({ found: true, transferTo: '+919000000001', consultantName: 'Meera Joshi', consultantFirstName: 'Meera', department: 'Wabastore', how: 'ROTATION' }), { phone: '9876543210', reference: null, callId: 'c9' });
check(a.found && a.transfer_to === '+919000000001' && a.consultant_first_name === 'Meera' && a.assigned_by === 'ROTATION' && /connecting you to Meera from the Wabastore team/.test(a.say), 'a found consultant: the number, the name and a sentence to say');
check(calls[0].fn === 'ai_call_transfer_target' && calls[0].args.p_phone === '9876543210' && calls[0].args.p_call_id === 'c9' && calls[0].args.p_reference === null, 'the database function is asked with what the agent sent');
a = await lookupTransfer(db({ found: false, reason: 'NO_CONSULTANT', department: 'Wabastore' }), { phone: '9876543210', reference: null, callId: null }, { BOLIFY_DEFAULT_TRANSFER_NUMBER: '9822345678' } as any);
check(!a.found && a.reason === 'NO_CONSULTANT' && a.transfer_to === undefined && /call you back/.test(a.say), 'a known customer with nobody reachable is never sent to the default number');
a = await lookupTransfer(db({ found: false, reason: 'NO_CUSTOMER' }), { phone: '9811111111', reference: null, callId: null }, { BOLIFY_DEFAULT_TRANSFER_NUMBER: '9822345678' } as any);
check(a.found && a.transfer_to === '+919822345678' && a.assigned_by === 'DEFAULT', 'an unknown number goes to the default number when one is set');
a = await lookupTransfer(db({ found: false, reason: 'NO_CUSTOMER' }), { phone: '9811111111', reference: null, callId: null }, { BOLIFY_DEFAULT_TRANSFER_NUMBER: '123' } as any);
check(!a.found && a.reason === 'NO_CUSTOMER', 'a default number that is not a mobile number is ignored');
let threw = '';
try { await lookupTransfer(db({}), { phone: null, reference: null, callId: null }); } catch (e: any) { threw = e.code; }
check(threw === 'VALIDATION_ERROR', 'a request that names nothing is refused');
threw = '';
try { await lookupTransfer(db(null, { message: 'FORBIDDEN: nope', code: '42501' }), { phone: '9876543210', reference: null, callId: null }); } catch (e: any) { threw = e.code; }
check(threw !== '', 'a database error is raised, not turned into an answer');

console.log(`=== ${passed} AI CALL TRANSFER CHECKS PASSED ===`);
