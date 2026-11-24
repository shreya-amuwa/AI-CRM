/**
 * A notification opens the screen it is about (src/components/notifications/openNotification.ts, used by the bell and the Notification Center):
 * a client chat, an @mention, a meeting, a task. Run with a stand-in for the browser window that records which screen was asked for.
 */
const events: { type: string; detail: any }[] = [];
const fake = new EventTarget();
const realAdd = fake.addEventListener.bind(fake);
(globalThis as any).window = fake;
(globalThis as any).document = { visibilityState: 'visible', addEventListener: () => undefined };
const record = (name: string) => realAdd(name, e => events.push({ type: name, detail: (e as CustomEvent).detail }));

const { openNotificationTarget } = await import('../../src/components/notifications/openNotification.js');
const { OPEN_CHAT_EVENT } = await import('../../src/components/chat/chatEvents.js');
const meetingEvents = await import('../../src/components/meetings/meetingEvents.js');
const taskEvents = await import('../../src/components/tasks/workUpdateEvents.js');
record(OPEN_CHAT_EVENT);
for (const k of Object.keys(meetingEvents)) if (/EVENT$/.test(k) && typeof (meetingEvents as any)[k] === 'string') record((meetingEvents as any)[k]);
for (const k of Object.keys(taskEvents)) if (/EVENT$/.test(k) && typeof (taskEvents as any)[k] === 'string') record((taskEvents as any)[k]);

let passed = 0;
function check(ok: unknown, label: string, extra?: unknown) {
  if (!ok) { console.error(`FAILED: ${label}`, extra === undefined ? '' : JSON.stringify(extra)); process.exit(1); }
  passed++; console.log(`ok - ${label}`);
}
const id = '00000000-0000-4000-8000-000000000042';
const open = (n: { type: string; entityType: string | null; entityId: string | null; messageId?: string | null }) => { events.length = 0; return openNotificationTarget(n); };

check(open({ type: 'CHAT_UNANSWERED', entityType: 'chat', entityId: id }) && events.length === 1 && events[0].type === OPEN_CHAT_EVENT && events[0].detail?.clientConversationId === id,
  'a client chat notification (new conversation, assigned, waiting) opens that client conversation', events);
check(open({ type: 'CHAT_MENTION', entityType: 'chat_mention', entityId: id, messageId: 'm1' }) && events[0]?.detail?.conversationId === id && events[0]?.detail?.messageId === 'm1',
  'a mention opens the group on the message', events);
check(open({ type: 'MEETING_APPROVED', entityType: 'meeting', entityId: id }) && events.length >= 1, 'a meeting notification opens Meetings', events);
check(open({ type: 'TASK_PRIORITY_CHANGED', entityType: 'work_task', entityId: id }) && events.length >= 1, 'a task notification opens the task', events);
check(open({ type: 'SOMETHING', entityType: null, entityId: null }) === false && events.length === 0, 'a notification about nothing in particular opens nothing (and says so)');
console.log(`=== NOTIFICATION OPEN TESTS PASSED (${passed}) ===`);
