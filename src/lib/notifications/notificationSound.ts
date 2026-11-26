import { useSyncExternalStore } from 'react';

/**
 * In-app notification sounds, shared by the Notification Center (attendance reminders and other notifications) and the chat
 * (lib/chat/chatSound.ts). One audio context for the whole page, made or resumed only inside a real tap / click / key press (browsers
 * block sound until then; this never tries to get around that). The visual notification never depends on the sound.
 *
 * - Three switches, each remembered in this browser and saved with the person's settings (attendance reminders, chat, other notifications).
 * - The same notification never chimes twice: not after a refresh, not in a second tab (a short list of chimed ids in localStorage;
 *   a hidden tab waits a moment so the tab on screen chimes first), not when the list is re-read after a reconnect.
 * - At most one chime every 2.5 seconds, so a burst of notifications is one sound.
 * - When the page is hidden and this device has push notifications on, the operating system's notification (with its own sound and
 *   Do Not Disturb rules) is the alert: the page stays quiet so the person does not hear two sounds.
 * Websites cannot choose the sound of a notification shown by the operating system while the CRM is closed.
 */
export type SoundCategory = 'attendance' | 'chat' | 'general';
export type AudioState = 'running' | 'suspended' | 'unsupported' | 'unknown';

const KEYS: Record<SoundCategory, string> = { attendance: 'crm.sound.attendance', chat: 'crm.chatSound', general: 'crm.sound.general' };
const PLAYED_KEY = 'crm.sound.played';
const GLOBAL_GAP_MS = 2500;
const HIDDEN_DELAY_MS = 900;

type Win = Window & { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
const win = (): Win | null => (typeof window === 'undefined' ? null : (window as Win));
const storage = () => { try { return win()?.localStorage ?? null; } catch { return null; } };

function readEnabled(c: SoundCategory): boolean {
  try { return storage()?.getItem(KEYS[c]) !== 'off'; } catch { return true; }
}
const enabled: Record<SoundCategory, boolean> = { attendance: readEnabled('attendance'), chat: readEnabled('chat'), general: readEnabled('general') };
let snapshot = { ...enabled };
const listeners = new Set<() => void>();
const changeListeners = new Set<(prefs: Record<SoundCategory, boolean>) => void>();
const emit = () => { snapshot = { ...enabled }; listeners.forEach(l => l()); };

export function soundEnabled(c: SoundCategory): boolean { return enabled[c]; }
export function soundPrefs(): Record<SoundCategory, boolean> { return snapshot; }

/** A switch changed by the person (saved to their settings by onSoundPrefsChange listeners). */
export function setSoundEnabled(c: SoundCategory, on: boolean): void {
  if (enabled[c] === on) return;
  enabled[c] = on;
  try { storage()?.setItem(KEYS[c], on ? 'on' : 'off'); } catch { /* private window: kept for this page only */ }
  emit();
  changeListeners.forEach(l => l(snapshot));
  if (on) unlockAudio();
}
/** The person's saved settings, read from the server (no save back). */
export function applySoundPrefs(p: Partial<Record<SoundCategory, boolean>>): void {
  let changed = false;
  for (const c of Object.keys(KEYS) as SoundCategory[]) {
    if (typeof p[c] !== 'boolean' || enabled[c] === p[c]) continue;
    enabled[c] = p[c]!;
    try { storage()?.setItem(KEYS[c], p[c] ? 'on' : 'off'); } catch { /* */ }
    changed = true;
  }
  if (changed) emit();
}
export function onSoundPrefsChange(l: (prefs: Record<SoundCategory, boolean>) => void): () => void {
  changeListeners.add(l);
  return () => { changeListeners.delete(l); };
}
const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
export function useSoundPrefs(): Record<SoundCategory, boolean> { return useSyncExternalStore(subscribe, soundPrefs, soundPrefs); }
export function useSoundEnabled(c: SoundCategory): boolean { return useSyncExternalStore(subscribe, () => enabled[c], () => true); }

// --- the audio context
let ctx: AudioContext | null = null;
let armed = false;
const audioListeners = new Set<() => void>();

/** Make (or resume) the audio context. Only works inside a user gesture; elsewhere the context simply stays suspended. */
export function unlockAudio(): void {
  try {
    const w = win();
    const AC = w?.AudioContext || w?.webkitAudioContext;
    if (!AC) return;
    const audio = ctx ?? new AC();
    ctx = audio;
    if (audio.state === 'suspended') void audio.resume().then(() => audioListeners.forEach(l => l()), () => undefined);
    audioListeners.forEach(l => l());
  } catch { /* no audio on this device */ }
}
/** Wait for the first tap / click / key press on the page to unlock audio (never forced). */
export function armAudioUnlock(): void {
  const w = win();
  if (armed || !w) return;
  armed = true;
  const once = () => { unlockAudio(); w.removeEventListener('pointerdown', once); w.removeEventListener('keydown', once); };
  w.addEventListener('pointerdown', once, { passive: true });
  w.addEventListener('keydown', once);
}
export function audioState(): AudioState {
  const w = win();
  if (!w || !(w.AudioContext || w.webkitAudioContext)) return 'unsupported';
  if (!ctx) return 'suspended';
  return ctx.state === 'running' ? 'running' : ctx.state === 'suspended' ? 'suspended' : 'unknown';
}
export function onAudioStateChange(l: () => void): () => void { audioListeners.add(l); return () => { audioListeners.delete(l); }; }

/** The running context, or null when the browser does not allow sound yet. */
export function runningAudio(): AudioContext | null {
  armAudioUnlock();
  return ctx && ctx.state === 'running' ? ctx : null;
}

/** A short chime: notes [frequency Hz, start s], at a gentle volume (0..1, kept low). */
export function chime(audio: AudioContext, notes: readonly (readonly [number, number])[], volume: number, length = 0.42): boolean {
  try {
    const t = audio.currentTime;
    const gain = audio.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(Math.min(volume, 0.2), t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + length);
    gain.connect(audio.destination);
    for (const [freq, start] of notes) {
      const osc = audio.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, t + start);
      osc.connect(gain);
      osc.start(t + start);
      osc.stop(t + start + 0.3);
    }
    return true;
  } catch { return false; }
}

// Attendance reminders: three rising notes, a little louder; other notifications: two notes. Both short and professional.
const TONES: Record<Exclude<SoundCategory, 'chat'>, { notes: readonly (readonly [number, number])[]; volume: number; length: number }> = {
  attendance: { notes: [[784, 0], [988, 0.13], [1175, 0.26]], volume: 0.11, length: 0.62 },
  general: { notes: [[660, 0], [990, 0.12]], volume: 0.08, length: 0.45 }
};

// --- once per notification, across tabs
function playedRecently(id: string, now: number): boolean {
  try {
    const list = JSON.parse(storage()?.getItem(PLAYED_KEY) || '[]') as { id: string; at: number }[];
    return list.some(x => x.id === id && now - x.at < 24 * 3600_000);
  } catch { return false; }
}
function markPlayed(id: string, now: number): void {
  try {
    const list = (JSON.parse(storage()?.getItem(PLAYED_KEY) || '[]') as { id: string; at: number }[])
      .filter(x => now - x.at < 24 * 3600_000 && x.id !== id).slice(-80);
    list.push({ id, at: now });
    storage()?.setItem(PLAYED_KEY, JSON.stringify(list));
  } catch { /* */ }
}

let lastAt = 0;
let pushOnThisDevice = false;
/** Set from the device check (lib/push/pushSupport.ts): this browser shows push notifications itself when the page is hidden. */
export function setPushActiveOnThisDevice(on: boolean): void { pushOnThisDevice = on; }

const pageHidden = () => { try { return typeof document !== 'undefined' && document.visibilityState === 'hidden'; } catch { return false; } };

function playNow(c: Exclude<SoundCategory, 'chat'>, id: string | undefined, now: number): boolean {
  if (!enabled[c] || now - lastAt < GLOBAL_GAP_MS) return false;
  if (id && playedRecently(id, now)) return false;
  const audio = runningAudio();
  if (!audio) return false;                // not allowed yet: the badge and the list still show it
  if (id) markPlayed(id, now);
  lastAt = now;
  return chime(audio, TONES[c].notes, TONES[c].volume, TONES[c].length);
}

/**
 * Chime for a NEW notification (the caller decides what is new: never the ones loaded at sign-in). `id` makes it once only, also across
 * tabs. Returns whether a sound was started (false when muted, not allowed yet, already chimed, or left to the operating system).
 */
export function playNotificationSound(c: Exclude<SoundCategory, 'chat'>, id?: string, now = Date.now()): boolean {
  if (!enabled[c]) return false;
  if (pageHidden()) {
    if (pushOnThisDevice) return false;    // the operating system's notification is the alert
    // a tab on screen chimes first; a hidden tab only if no tab did
    if (typeof setTimeout === 'function') setTimeout(() => { if (!id || !playedRecently(id, Date.now())) playNow(c, id, Date.now()); }, HIDDEN_DELAY_MS);
    return false;
  }
  return playNow(c, id, now);
}

/** "Test sound": inside the click itself, so the browser allows it. Ignores the switches and the gap. */
export function playTestSound(c: SoundCategory = 'attendance'): boolean {
  unlockAudio();
  if (!ctx) return false;
  const tone = c === 'chat' ? { notes: [[880, 0], [1320, 0.12]] as const, volume: 0.06, length: 0.42 } : TONES[c];
  if (ctx.state !== 'running') {
    // the first resume() is still settling: play as soon as it is running
    void ctx.resume().then(() => { if (ctx) chime(ctx, tone.notes, tone.volume, tone.length); }, () => undefined);
    return true;
  }
  return chime(ctx, tone.notes, tone.volume, tone.length);
}
