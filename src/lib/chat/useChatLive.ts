import { useEffect, useRef } from 'react';
import { getSupabase } from '../../services/supabaseClient';

/**
 * Calls onChange when a conversation the person can read changes (a new message moves its preview, a member is added or
 * removed) and when the tab comes back into view. Supabase Realtime only delivers rows the database lets this person read.
 * There is no timer.
 */
export function useChatLive(onChange: () => void, enabled = true) {
  const cb = useRef(onChange);
  cb.current = onChange;
  useEffect(() => {
    if (!enabled) return undefined;
    const supabase = getSupabase();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const soon = () => { clearTimeout(timer); timer = setTimeout(() => cb.current(), 400); };
    const channel = supabase
      ?.channel(`chat-live-${Math.random().toString(36).slice(2, 8)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_conversations' }, soon)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_members' }, soon)
      .subscribe();
    const wake = () => { if (document.visibilityState === 'visible') soon(); };
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('focus', wake);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('focus', wake);
      if (channel) void supabase?.removeChannel(channel);
    };
  }, [enabled]);
}
