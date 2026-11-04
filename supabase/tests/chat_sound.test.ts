// The new-message chime (src/lib/chat/chatSound.ts): plays for a genuinely new message only, quietly, at most once in a burst, never while
// the chat is on screen, respects the person's mute setting and waits for the browser's permission (a first tap) instead of forcing it.
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
let threadOnScreen = false;
(globalThis as any).window = {
  AudioContext: FakeAudioContext,
  localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } },
  addEventListener: (k: string, f: () => void) => { handlers.set(k, [...(handlers.get(k) ?? []), f]); },
  removeEventListener: (k: string, f: () => void) => { handlers.set(k, (handlers.get(k) ?? []).filter(x => x !== f)); }
};
(globalThis as any).document = { visibilityState: 'visible', hasFocus: () => true, querySelector: () => (threadOnScreen ? {} : null) };

const { chatSoundEnabled, playChatSound, setChatSoundEnabled } = await import('../../src/lib/chat/chatSound');
let passed = 0;
const check = (ok: boolean, name: string) => { if (!ok) { console.error('not ok -', name); process.exit(1); } passed++; console.log('ok -', name); };

check(chatSoundEnabled(), 'the sound is on by default');
check(!playChatSound(5_000) && played === 0, 'before the page was touched the browser does not allow sound: nothing is forced');
handlers.get('pointerdown')?.forEach(f => f());
await Promise.resolve();
check(state === 'running', 'the first tap unlocks audio');
check(playChatSound(10_000) && played === 2, 'a new message plays one short two-note chime');
check(!playChatSound(11_000) && played === 2, 'a second message one second later (a burst, or a repeated event) plays nothing');
check(playChatSound(15_000) && played === 4, 'after a few seconds the next message chimes again');
threadOnScreen = true;
check(!playChatSound(30_000), 'no chime while the chat is on screen and in focus');
threadOnScreen = false;
setChatSoundEnabled(false);
check(!chatSoundEnabled() && store.get('crm.chatSound') === 'off', 'muting is remembered');
check(!playChatSound(60_000) && played === 4, 'muted: no chime');
setChatSoundEnabled(true);
check(playChatSound(90_000), 'and it can be turned back on');
console.log(`=== CHAT SOUND CHECKS PASSED (${passed}) ===`);
