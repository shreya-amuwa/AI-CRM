import { getSupabase } from '../services/supabaseClient';

/**
 * One Realtime channel per browser tab and per set of tables, shared by every component that listens to the same tables.
 *
 * Supabase checks Row Level Security once per subscription for every changed row, so ten components listening to the same table in
 * one tab used to cost ten checks per change. Each listener is still called on every change (and keeps its own delay); the channel
 * opens with the first listener and closes when the last one leaves. Without a configured Supabase client nothing happens, as before.
 */
type Supabase = NonNullable<ReturnType<typeof getSupabase>>;
type Shared = { sb: Supabase; channel: ReturnType<Supabase['channel']>; listeners: Set<() => void> };
const shared = new Map<string, Shared>();

/** `client` is for tests only; the app always uses the browser's Supabase client. */
export function listenToTables(tables: readonly string[], listener: () => void, client: Supabase | null = getSupabase()): () => void {
  const key = [...tables].sort().join(',');
  let entry = shared.get(key);
  if (!entry) {
    const sb = client;
    if (!sb) return () => undefined;
    const listeners = new Set<() => void>();
    const notify = () => listeners.forEach(l => l());
    let channel = sb.channel(`shared-${key.replace(/[^a-z0-9_,]/gi, '')}-${Math.random().toString(36).slice(2, 8)}`);
    for (const table of tables) channel = channel.on('postgres_changes', { event: '*', schema: 'public', table }, notify);
    channel.subscribe();
    entry = { sb, channel, listeners };
    shared.set(key, entry);
  }
  entry.listeners.add(listener);
  const mine = entry;
  return () => {
    mine.listeners.delete(listener);
    if (!mine.listeners.size && shared.get(key) === mine) {
      shared.delete(key);
      void mine.sb.removeChannel(mine.channel);
    }
  };
}
