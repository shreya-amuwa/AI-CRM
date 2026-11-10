import { getSupabase } from '../../services/supabaseClient';

/**
 * "Something about the ticks of this conversation changed" (migration 20261231000400).
 *
 * Reporting "delivered" or "seen" used to rewrite the conversation row so that the sender's screen would notice; every such UPDATE went to
 * every signed-in screen through Realtime and overloaded the database with ~200 people online. Now the reporting screen sends a Realtime
 * BROADCAST on the conversation's topic (no database work), and only screens that have that conversation open listen to it. The broadcast
 * carries nothing but the event: the listening screen asks the API for the ticks, which checks access as always.
 *
 * One channel per conversation per tab, shared by everything that uses it (supabase-js returns the same channel for the same topic, so it is
 * reference-counted here and removed when the last user leaves).
 */
type Listener = () => void;
interface Entry { channel: any; listeners: Set<Listener>; users: number; ready: boolean; queued: boolean }
const entries = new Map<string, Entry>();
const topicOf = (conversationId: string) => `chat-receipts:${conversationId}`;
let clientOverride: any;
/** Tests only: use this Supabase client instead of the app's. */
export function setReceiptClientForTests(c: any) { clientOverride = c; }
const client = () => (clientOverride !== undefined ? clientOverride : getSupabase()) as any;

function acquire(conversationId: string): Entry | null {
  const supabase = client();
  if (!supabase || typeof supabase.channel !== 'function') return null;
  let e = entries.get(conversationId);
  if (!e) {
    const entry: Entry = { channel: null, listeners: new Set(), users: 0, ready: false, queued: false };
    const ch = supabase.channel(topicOf(conversationId), { config: { broadcast: { self: false, ack: false } } });
    entry.channel = ch;
    if (typeof ch?.on === 'function') ch.on('broadcast', { event: 'receipt' }, () => entry.listeners.forEach(l => { try { l(); } catch { /* a listener's own problem */ } }));
    if (typeof ch?.subscribe === 'function') {
      ch.subscribe((status: string) => {
        if (status !== 'SUBSCRIBED') return;
        entry.ready = true;
        if (entry.queued) { entry.queued = false; send(entry); }
      });
    }
    entries.set(conversationId, entry);
    e = entry;
  }
  e.users += 1;
  return e;
}

function release(conversationId: string) {
  const e = entries.get(conversationId);
  if (!e) return;
  e.users -= 1;
  if (e.users > 0) return;
  entries.delete(conversationId);
  const supabase = client();
  if (e.channel && supabase && typeof supabase.removeChannel === 'function') void supabase.removeChannel(e.channel);
}

function send(e: Entry) {
  if (!e.channel || typeof e.channel.send !== 'function') return;
  try { void Promise.resolve(e.channel.send({ type: 'broadcast', event: 'receipt', payload: {} })).catch(() => undefined); } catch { /* best effort */ }
}

/** Tell the other screens that have this conversation open that the ticks changed (best effort; they also refresh on their own). */
export function signalReceipt(conversationId: string) {
  const e = acquire(conversationId);
  if (!e) return;
  if (e.ready) send(e); else e.queued = true;
  // keep the channel a little while so a queued signal can go out, then let it go
  setTimeout(() => release(conversationId), 5000);
}

/** Listen to the ticks of one conversation changing; returns the function that stops listening. */
export function onReceipt(conversationId: string, listener: Listener): () => void {
  const e = acquire(conversationId);
  if (!e) return () => undefined;
  e.listeners.add(listener);
  return () => { e.listeners.delete(listener); release(conversationId); };
}
