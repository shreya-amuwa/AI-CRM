import { useEffect, useRef, useSyncExternalStore } from 'react';

/**
 * A short, quiet chime for a new incoming chat message. Played from the live unread count (useChatUnread), which the database computes
 * without the person's own messages, so: nothing for your own message, one chime when the count goes up (a reconnect that re-reads the same
 * count plays nothing), at most one chime every few seconds during a burst, and none while the chat page is on screen and in focus.
 * Browsers block sound until the page was touched once; then the chime waits for the first tap / click / key (never forced).
 * The badge and the chat list update regardless of the sound setting.
 */
const KEY = 'crm.chatSound';
const MIN_GAP_MS = 4000;
const listeners = new Set<() => void>();
let enabled = read();
let ctx: AudioContext | null = null;
let lastAt = 0;
let armed = false;

function read(): boolean {
  try { return window.localStorage.getItem(KEY) !== 'off'; } catch { return true; }
}

export function chatSoundEnabled() { return enabled; }
export function setChatSoundEnabled(on: boolean) {
  enabled = on;
  try { window.localStorage.setItem(KEY, on ? 'on' : 'off'); } catch { /* private window: kept for this page only */ }
  listeners.forEach(l => l());
  if (on) unlock();
}
const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
export function useChatSoundEnabled(): boolean { return useSyncExternalStore(subscribe, chatSoundEnabled, () => true); }

/** Make (or resume) the audio context inside a user gesture, the only moment browsers allow it. */
function unlock() {
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    if (!ctx) ctx = new AC();
    if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
  } catch { /* no audio on this device */ }
}
function armUnlock() {
  if (armed || typeof window === 'undefined') return;
  armed = true;
  const once = () => { unlock(); window.removeEventListener('pointerdown', once); window.removeEventListener('keydown', once); };
  window.addEventListener('pointerdown', once, { passive: true });
  window.addEventListener('keydown', once);
}

/** Is the person looking at the chat right now? Then the new message is on screen already. */
function chatOnScreen(): boolean {
  try { return document.visibilityState === 'visible' && document.hasFocus() && !!document.querySelector('.ch-thread'); } catch { return false; }
}

export function playChatSound(now = Date.now()): boolean {
  if (!enabled || now - lastAt < MIN_GAP_MS || chatOnScreen()) return false;
  armUnlock();
  if (!ctx || ctx.state !== 'running') return false;           // not allowed yet: the badge still shows it
  lastAt = now;
  try {
    const t = ctx.currentTime;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.06, t + 0.02);       // quiet
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
    gain.connect(ctx.destination);
    for (const [freq, start] of [[880, 0], [1320, 0.12]] as const) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, t + start);
      osc.connect(gain);
      osc.start(t + start);
      osc.stop(t + start + 0.3);
    }
    return true;
  } catch { return false; }
}

/** Plays the chime when an unread count goes UP (never on the first value, never when it stays the same or goes down). */
export function useChatSoundOnIncrease(count: number) {
  const prev = useRef<number | null>(null);
  useEffect(() => { armUnlock(); }, []);
  useEffect(() => {
    if (prev.current !== null && count > prev.current) playChatSound();
    prev.current = count;
  }, [count]);
}
