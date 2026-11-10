import { useEffect, useRef } from 'react';
import { getSupabase } from '../../services/supabaseClient';

/**
 * Calls onChange when a conversation the person can read changes (a new message moves its preview, they are added to or removed from a
 * conversation) and when the tab comes back into view after something changed. Supabase Realtime only delivers rows the database lets this
 * person read. There is no timer.
 *
 * Built for many people online at once (~200): ONE Realtime subscription per browser tab, shared by every badge and list that uses this
 * hook (it used to be one per badge or list); the membership feed is limited to the person's own rows; a hidden tab does not reload
 * anything until it is shown again; and the reload is spread over a few seconds so that one message does not make every screen in the
 * company call the API in the same instant.
 */
type Listener = () => void;
const listeners = new Set<Listener>();
let channel: any = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let dirty = false;
let lastRun = 0;
let subscribedBefore = false;
const STALE_MS = 60_000;

const visible = () => typeof document === 'undefined' || document.visibilityState === 'visible';
let clientOverride: any;
/** Tests only: use this Supabase client instead of the app's. */
export function setChatLiveClientForTests(c: any) { clientOverride = c; }
const client = () => (clientOverride !== undefined ? clientOverride : getSupabase()) as any;

function run() {
  timer = undefined;
  dirty = false;
  lastRun = Date.now();
  listeners.forEach(l => { try { l(); } catch { /* a listener's own problem */ } });
}

/** Reload soon, at a random moment within the spread (so not every screen asks at once); a hidden tab only remembers that it must. */
function schedule(spreadMs = 2500) {
  if (!visible()) { dirty = true; return; }
  if (timer) return;
  timer = setTimeout(run, 400 + Math.floor(Math.random() * spreadMs));
}

const wake = () => { if (visible() && (dirty || Date.now() - lastRun > STALE_MS)) schedule(600); };

function start() {
  const supabase = client();
  if (!supabase || channel) return;
  const subscribe = (me: string | null) => {
    if (channel || !listeners.size) return;
    const ch = supabase.channel(`chat-live-${Math.random().toString(36).slice(2, 8)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_conversations' }, () => schedule())
      .on('postgres_changes', me ? { event: '*', schema: 'public', table: 'chat_members', filter: `profile_id=eq.${me}` } : { event: '*', schema: 'public', table: 'chat_members' }, () => schedule());
    channel = ch;
    if (typeof ch?.subscribe === 'function') {
      ch.subscribe((status: string) => {
        if (status !== 'SUBSCRIBED') return;
        // connected again after a drop: whatever happened in between has to be fetched
        if (subscribedBefore) schedule();
        subscribedBefore = true;
      });
    }
  };
  const session = supabase.auth?.getSession?.();
  if (session && typeof session.then === 'function') {
    session.then((r: any) => subscribe(r?.data?.session?.user?.id ?? null), () => subscribe(null));
  } else {
    subscribe(null);
  }
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', wake);
  if (typeof window !== 'undefined') window.addEventListener('focus', wake);
}

function stop() {
  if (timer) { clearTimeout(timer); timer = undefined; }
  if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', wake);
  if (typeof window !== 'undefined') window.removeEventListener('focus', wake);
  const supabase = client();
  if (channel && supabase && typeof supabase.removeChannel === 'function') void supabase.removeChannel(channel);
  channel = null;
  subscribedBefore = false;
}

/** Add / remove a listener of the shared feed (what the hook does; exported for tests). */
export const chatLiveHub = {
  add(listener: Listener) { listeners.add(listener); if (listeners.size === 1) { lastRun = Date.now(); start(); } },
  remove(listener: Listener) { listeners.delete(listener); if (!listeners.size) stop(); },
  get channelOpen() { return !!channel; }
};

export function useChatLive(onChange: () => void, enabled = true) {
  const cb = useRef(onChange);
  cb.current = onChange;
  useEffect(() => {
    if (!enabled) return undefined;
    const listener: Listener = () => cb.current();
    chatLiveHub.add(listener);
    return () => chatLiveHub.remove(listener);
  }, [enabled]);
}
