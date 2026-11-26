import { useEffect, useRef } from 'react';
import { armAudioUnlock, chime, runningAudio, setSoundEnabled, soundEnabled, useSoundEnabled } from '../notifications/notificationSound';

/**
 * A short, quiet chime for a new incoming chat message. Played from the live unread count (useChatUnread), which the database computes
 * without the person's own messages, so: nothing for your own message, one chime when the count goes up (a reconnect that re-reads the same
 * count plays nothing), at most one chime every few seconds during a burst, and none while the chat page is on screen and in focus.
 * Browsers block sound until the page was touched once; then the chime waits for the first tap / click / key (never forced).
 * The badge and the chat list update regardless of the sound setting. The audio context and the on / off switch are shared with the other
 * notification sounds (lib/notifications/notificationSound.ts); the switch is still remembered under "crm.chatSound".
 */
const MIN_GAP_MS = 4000;
let lastAt = 0;

export function chatSoundEnabled() { return soundEnabled('chat'); }
export function setChatSoundEnabled(on: boolean) { setSoundEnabled('chat', on); }
export function useChatSoundEnabled(): boolean { return useSoundEnabled('chat'); }

/** Is the person looking at the chat right now? Then the new message is on screen already. */
function chatOnScreen(): boolean {
  try { return document.visibilityState === 'visible' && document.hasFocus() && !!document.querySelector('.ch-thread'); } catch { return false; }
}

export function playChatSound(now = Date.now()): boolean {
  if (!soundEnabled('chat') || now - lastAt < MIN_GAP_MS || chatOnScreen()) return false;
  const ctx = runningAudio();
  if (!ctx) return false;           // not allowed yet: the badge still shows it
  lastAt = now;
  return chime(ctx, [[880, 0], [1320, 0.12]], 0.06);
}

/** Plays the chime when an unread count goes UP (never on the first value, never when it stays the same or goes down). */
export function useChatSoundOnIncrease(count: number) {
  const prev = useRef<number | null>(null);
  useEffect(() => { armAudioUnlock(); }, []);
  useEffect(() => {
    if (prev.current !== null && count > prev.current) playChatSound();
    prev.current = count;
  }, [count]);
}
