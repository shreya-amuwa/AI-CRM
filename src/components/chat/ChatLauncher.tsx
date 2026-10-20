import React, { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import { MessageCircle } from 'lucide-react';
import { chatApi } from '../../lib/chat/api';
import { useChatUnread } from '../../lib/chat/useChatUnread';
import { OPEN_CHAT_EVENT, type OpenChatDetail } from './chatEvents';

// the chat screens are only downloaded when somebody opens the chat
const ChatCenter = lazy(() => import('./ChatCenter'));

/** The chat button for the top bar of every employee dashboard (next to the notification bell). */
export const ChatLauncher: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [initial, setInitial] = useState<OpenChatDetail>({});
  const { summary, refresh } = useChatUnread(chatApi.unread);
  const btn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const on = (e: Event) => { setInitial((e as CustomEvent<OpenChatDetail>).detail || {}); setOpen(true); };
    window.addEventListener(OPEN_CHAT_EVENT, on);
    return () => window.removeEventListener(OPEN_CHAT_EVENT, on);
  }, []);
  const close = useCallback(() => { setOpen(false); setInitial({}); refresh(); btn.current?.focus(); }, [refresh]);

  const total = summary.internal + summary.clients;
  return (
    <>
      <button
        ref={btn}
        type="button"
        onClick={() => { setInitial({}); setOpen(true); }}
        aria-label={`Chat${total > 0 ? ` (${total} unread)` : ''}`}
        aria-haspopup="dialog"
        className="relative p-2 rounded-xl text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition-colors cursor-pointer"
      >
        <MessageCircle className="w-5 h-5" />
        {total > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center ring-2 ring-white">
            {total > 99 ? '99+' : total}
          </span>
        )}
      </button>
      {open && (
        <Suspense fallback={null}>
          <ChatCenter onClose={close} initial={initial} summary={summary} refresh={refresh} />
        </Suspense>
      )}
    </>
  );
};
