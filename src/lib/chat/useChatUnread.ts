import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatUnreadSummary } from '../../../shared/contracts';
import { useChatLive } from './useChatLive';

const NONE: ChatUnreadSummary = { total: 0, internal: 0, clients: 0, review: 0 };

/** The unread counts for a badge: read when the screen opens, then whenever a conversation changes (see useChatLive). */
export function useChatUnread(load: () => Promise<ChatUnreadSummary>, enabled = true) {
  const [summary, setSummary] = useState<ChatUnreadSummary>(NONE);
  const fn = useRef(load);
  fn.current = load;
  const refresh = useCallback(() => {
    fn.current().then(setSummary, () => { /* a badge is a convenience; the chat screens show their own errors */ });
  }, []);
  useEffect(() => { if (enabled) refresh(); }, [enabled, refresh]);
  useChatLive(refresh, enabled);
  return { summary, refresh };
}
