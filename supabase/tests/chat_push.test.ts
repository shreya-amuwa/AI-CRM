// Unit test of the chat push sender (server/automations/chatPush.ts): reading the new message id from the API's answer, and doing nothing
// (without throwing) when push is not set up. The recipients and wording are tested in supabase/tests/chat_push_test.sql.
import { messageIdFrom, pushChatMessage } from '../../server/automations/chatPush';

let passed = 0;
const check = (ok: boolean, name: string, extra?: unknown) => { if (!ok) { console.error('not ok -', name, extra ?? ''); process.exit(1); } passed++; console.log('ok -', name); };

const id = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';
check(messageIdFrom({ success: true, data: { id, conversationId: 'x' } }) === id, 'messageIdFrom reads data.id');
check(messageIdFrom({ success: false, error: { code: 'VALIDATION_ERROR' } }) === null && messageIdFrom({ success: true, data: { id: 'not-a-uuid' } }) === null
  && messageIdFrom(null) === null && messageIdFrom('text') === null, 'messageIdFrom is null for an error envelope or a non-uuid');
for (const k of ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']) delete process.env[k];
const r = await pushChatMessage(id);
check(r.recipients === 0 && r.pushed === 0 && r.failed === 0, 'pushChatMessage without VAPID keys or a database pushes nothing and does not throw', r);
console.log(`=== CHAT PUSH TESTS PASSED (${passed}) ===`);
