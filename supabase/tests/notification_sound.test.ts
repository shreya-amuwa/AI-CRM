// In-app notification sounds (src/lib/notifications/notificationSound.ts): nothing before the browser allows audio (a first tap), one chime
// per notification even when it is read again or seen by a second tab, one chime for a burst, per-category switches, silence when hidden
// and the operating system's push notification is the alert, and a test button that works inside a click.
let played = 0;
let state: 'suspended' | 'running' = 'suspended';
class FakeNode { connect() { /* */ } }
class FakeGain extends FakeNode { gain = { setValueAtTime() { /* */ }, exponentialRampToValueAtTime() { /* */ } }; }
class FakeOsc extends FakeNode { type = 'sine'; frequency = { setValueAtTime() { /* */ } }; start() { played++; } stop() { /* */ } }
class FakeAudioContext {
  currentTime = 0; destination = {};
  get state() { return state; }
  resume() { state = 'running'; return Promise.resolve(); }
  createGain() { return new FakeGain(); }
  createOscillator() { return new FakeOsc(); }
}
const store = new Map<string, string>();
const handlers = new Map<string, Array<() => void>>();
let visibility: 'visible' | 'hidden' = 'visible';
(globalThis as any).window = {
  AudioContext: FakeAudioContext,
  localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } },
  addEventListener: (k: string, f: () => void) => { handlers.set(k, [...(handlers.get(k) ?? []), f]); },
  removeEventListener: (k: string, f: () => void) => { handlers.set(k, (handlers.get(k) ?? []).filter(x => x !== f)); }
};
(globalThis as any).document = { get visibilityState() { return visibility; }, hasFocus: () => true, querySelector: () => null };

const m = await import('../../src/lib/notifications/notificationSound');
let passed = 0;
const check = (ok: boolean, name: string, extra?: unknown) => { if (!ok) { console.error('not ok -', name, extra ?? ''); process.exit(1); } passed++; console.log('ok -', name); };

check(m.soundEnabled('attendance') && m.soundEnabled('chat') && m.soundEnabled('general'), 'every sound is on by default');
check(m.audioState() === 'suspended', 'before any tap the audio is suspended (the browser decides)');
check(!m.playNotificationSound('attendance', 'n1', 10_000) && played === 0, 'no sound is forced before the page was touched');
handlers.get('pointerdown')?.forEach(f => f());
await Promise.resolve();
check(m.audioState() === 'running', 'the first tap unlocks audio');
check(m.playNotificationSound('attendance', 'n2', 20_000) && played === 3, 'a new attendance reminder plays the three-note chime');
check(!m.playNotificationSound('attendance', 'n2', 40_000) && played === 3, 'the same notification read again (refresh, reconnect) plays nothing');
check(!m.playNotificationSound('general', 'n3', 21_000) && played === 3, 'a second notification in the same burst plays nothing');
check(m.playNotificationSound('general', 'n4', 30_000) && played === 5, 'a later general notification plays the two-note chime');
check(JSON.parse(store.get('crm.sound.played') || '[]').some((x: any) => x.id === 'n4'), 'chimed ids are shared with the other tabs (localStorage)');
// "another tab" chimed n5: this tab stays quiet
store.set('crm.sound.played', JSON.stringify([...JSON.parse(store.get('crm.sound.played')!), { id: 'n5', at: 49_000 }]));
check(!m.playNotificationSound('general', 'n5', 50_000) && played === 5, 'a notification another tab already chimed plays nothing here');
m.setSoundEnabled('general', false);
check(store.get('crm.sound.general') === 'off' && !m.playNotificationSound('general', 'n6', 60_000), 'muting general notifications is remembered and respected');
check(m.playNotificationSound('attendance', 'n7', 70_000), 'attendance reminders keep their own switch');
let saved: any = null;
const off = m.onSoundPrefsChange(p => { saved = p; });
m.setSoundEnabled('attendance', false);
check(saved && saved.attendance === false && saved.general === false, 'a change by the person is handed to the saver (server settings)');
off();
m.applySoundPrefs({ attendance: true, general: true });
check(m.soundEnabled('attendance') && m.soundEnabled('general'), 'settings read from the server are applied');
visibility = 'hidden';
m.setPushActiveOnThisDevice(true);
check(!m.playNotificationSound('attendance', 'n8', 90_000) && played === 8, 'hidden page with push on this device: the operating system notification is the alert');
m.setPushActiveOnThisDevice(false);
visibility = 'visible';
const before = played;
check(m.playTestSound('attendance') && played === before + 3, '"Test sound" plays at once inside the click, whatever the gap');
const { setChatSoundEnabled, chatSoundEnabled } = await import('../../src/lib/chat/chatSound');
setChatSoundEnabled(false);
check(!chatSoundEnabled() && !m.soundEnabled('chat') && store.get('crm.chatSound') === 'off', 'the chat switch is the shared chat switch, under its old key');
// --- which new notification chimes (src/lib/notifications/notificationSync.ts)
const { pickNotificationToChime, backoffMs, soundCategoryOf, reconnectDelayMs } = await import('../../src/lib/notifications/notificationSync');
const now = Date.parse('2027-01-11T05:00:00Z');
const n = (id: string, type: string, minsAgo: number, extra: Record<string, unknown> = {}) =>
  ({ id, type, title: 't', body: '', priority: 'normal', entityType: null, entityId: null, actorId: null, data: {}, readAt: null,
     createdAt: new Date(now - minsAgo * 60_000).toISOString(), ...extra }) as any;
const seen = new Set(['old']);
check(pickNotificationToChime([n('old', 'TASK_ASSIGNED', 1)], seen, 'me', now) === null, 'a notification already seen (loaded at sign-in) never chimes');
check(pickNotificationToChime([n('x', 'TASK_ASSIGNED', 1, { readAt: new Date(now).toISOString() })], seen, 'me', now) === null, 'one read on another device does not chime');
check(pickNotificationToChime([n('x', 'TASK_ASSIGNED', 1, { actorId: 'me' })], seen, 'me', now) === null, 'your own action does not chime');
check(pickNotificationToChime([n('x', 'TASK_ASSIGNED', 40)], seen, 'me', now) === null, 'a notification that arrives very late is shown silently');
check(pickNotificationToChime([n('x', 'CHAT_MENTION', 1)], seen, 'me', now) === null && soundCategoryOf('CHAT_MENTION') === null, 'chat has its own chime (no double sound)');
const p = pickNotificationToChime([n('g', 'MEETING_INVITE', 1), n('a', 'ATTENDANCE_REMINDER', 2)], seen, 'me', now);
check(p?.id === 'a' && p.category === 'attendance', 'in a burst, one chime: the attendance reminder wins');
check(pickNotificationToChime([n('t', 'TASK_ASSIGNED', 1)], seen, 'me', now)?.category === 'general', 'task, meeting and approval notifications use the general sound');
check(backoffMs(1, () => 0.5) === 2000 && backoffMs(3, () => 0.5) === 8000 && backoffMs(20, () => 0.5) === 60000, 'retries wait 2 s, 4 s, 8 s ... at most 60 s');
check(reconnectDelayMs(() => 0) === 500 && reconnectDelayMs(() => 0.999) <= 5000 && reconnectDelayMs(() => 0.5) > 500,
  'after a reconnect the bell re-reads within 0.5-5 s, at a random moment (the office does not all re-read at once after a stall)');
console.log(`=== NOTIFICATION SOUND CHECKS PASSED (${passed}) ===`);
