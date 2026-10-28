import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatAttachment, ChatConversation, ChatMessage } from '../../../shared/contracts';
import { getSupabase } from '../../services/supabaseClient';
import { ApiError, errorMessage } from '../api/client';
import type { ChatTransport } from './api';
import { SecureSendError } from './secureChat';
import { useSecureChat, useSecureSnapshot } from './useSecureChat';

const FIRST_PAGE = 30;

/** A message the person just sent that the server has not confirmed yet (or could not take). */
export interface PendingMessage {
  clientMsgId: string;
  body: string;
  attachments: ChatAttachment[];
  replyTo: ChatMessage['replyTo'];
  status: 'sending' | 'failed';
  error: string;
  createdAt: string;
}

export interface SendInput {
  body: string;
  attachments: ChatAttachment[];
  replyTo: ChatMessage['replyTo'];
}

export function newId(): string {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  const b = c.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Messages by id, oldest first. The same message arriving twice (answer to the send AND the live event) stays one. */
function merge(current: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  if (incoming.length === 0) return current;
  const byId = new Map(current.map(m => [m.id, m]));
  for (const m of incoming) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => a.seq - b.seq);
}

const isGone = (e: unknown) => e instanceof ApiError && (e.status === 403 || e.status === 404);
/** Direct messages and groups are end-to-end encrypted; client conversations are not. */
const isSecureKind = (c: { kind: string } | null | undefined) => c?.kind === 'DIRECT' || c?.kind === 'GROUP';
/** A message that was deleted for everyone: only a tombstone is left. */
const tombstone = (m: ChatMessage): ChatMessage => ({ ...m, deleted: true, body: '', attachments: [], e2ee: null, secure: undefined, replyTo: m.replyTo ? { ...m.replyTo } : null });

/**
 * One conversation, live. The history comes from the API a page at a time; the database tells us (Supabase Realtime,
 * which only delivers rows the person may read) when something happened, and we ask the API for what is new. There is no
 * timer: we also catch up when the tab comes back into view, the network returns, or the live connection is re-made.
 */
export function useChatThread(transport: ChatTransport, opts: { active?: boolean; onChange?: (c: ChatConversation) => void } = {}) {
  const active = opts.active ?? true;
  const secure = useSecureChat();
  const secureState = useSecureSnapshot(secure);
  const [conversation, setConversation] = useState<ChatConversation | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pending, setPending] = useState<PendingMessage[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState('');
  const [denied, setDenied] = useState(false);
  const [visible, setVisible] = useState(() => document.visibilityState === 'visible');

  const tp = useRef(transport);
  tp.current = transport;
  const onChange = useRef(opts.onChange);
  onChange.current = opts.onChange;
  const msgs = useRef<ChatMessage[]>([]);
  const conv = useRef<ChatConversation | null>(null);
  const alive = useRef(0);
  const pendingRef = useRef<PendingMessage[]>([]);
  pendingRef.current = pending;
  const syncing = useRef(false);
  const again = useRef(false);

  const setConv = useCallback((c: ChatConversation | null) => {
    conv.current = c;
    setConversation(c);
    if (c) onChange.current?.(c);
  }, []);
  const setMsgs = useCallback((next: ChatMessage[]) => {
    msgs.current = next;
    setMessages(next);
  }, []);
  const secureRef = useRef(secure);
  secureRef.current = secure;
  /** Encrypted messages are opened here, in the browser; everything else passes through unchanged. */
  const unseal = useCallback(async (c: ChatConversation | null, list: ChatMessage[]): Promise<ChatMessage[]> => {
    const s = secureRef.current;
    if (!c || !isSecureKind(c) || !s || !list.some(m => m.kind === 'TEXT')) return list;
    return s.open(c.id, list);
  }, []);

  // ---- first load (and whenever the conversation changes)
  const load = useCallback(async () => {
    const run = ++alive.current;
    setLoading(true); setError(''); setDenied(false);
    try {
      const view = await tp.current.open(FIRST_PAGE);
      const opened = await unseal(view.conversation, view.page.messages);
      if (run !== alive.current) return;
      setMsgs(opened);
      setHasMore(view.page.hasMore);
      setConv(view.conversation);
    } catch (e) {
      if (run !== alive.current) return;
      if (isGone(e)) setDenied(true);
      setError(errorMessage(e));
    } finally {
      if (run === alive.current) setLoading(false);
    }
  }, [setConv, setMsgs, unseal]);

  useEffect(() => {
    setConversation(null); conv.current = null; setMsgs([]); setPending([]); setHasMore(false);
    void load();
    return () => { alive.current++; };
  }, [transport.key, load, setMsgs]);

  // keys unlocked, set up or reset: what could not be opened before is tried again
  const lastSecure = useRef(secureState.status);
  useEffect(() => {
    const was = lastSecure.current;
    lastSecure.current = secureState.status;
    if (was !== secureState.status && secureState.status === 'ready' && isSecureKind(conv.current)) {
      secureRef.current?.forget();
      void load();
    }
  }, [secureState.status, load]);

  // ---- catching up with what happened while we were not looking
  const refreshConversation = useCallback(async () => {
    const run = alive.current;
    try {
      const c = await tp.current.detail();
      if (run === alive.current) setConv(c);
    } catch (e) {
      if (run === alive.current && isGone(e)) { setDenied(true); setError(errorMessage(e)); }
    }
  }, [setConv]);

  const sync = useCallback(async () => {
    if (!conv.current) return;
    if (syncing.current) { again.current = true; return; }
    syncing.current = true;
    const run = alive.current;
    try {
      do {
        again.current = false;
        let more = true;
        while (more && run === alive.current) {
          const last = msgs.current.length ? msgs.current[msgs.current.length - 1].seq : 0;
          const page = await tp.current.messages({ after: last, limit: 100 });
          const fresh = await unseal(conv.current, page.messages);
          if (run !== alive.current) return;
          if (page.deletedIds?.length) {
            const gone = new Set(page.deletedIds);
            setMsgs(msgs.current.map(m => (gone.has(m.id) && !m.deleted ? tombstone(m) : m)));
          }
          if (fresh.length) {
            setMsgs(merge(msgs.current, fresh));
            const mine = new Set(fresh.map(m => m.clientMsgId).filter(Boolean));
            if (mine.size) setPending(p => p.filter(x => !mine.has(x.clientMsgId)));
          }
          more = page.hasMore && page.messages.length > 0;
        }
        if (run === alive.current) await refreshConversation();
      } while (again.current && run === alive.current);
    } catch (e) {
      if (isGone(e)) { setDenied(true); setError(errorMessage(e)); }
    } finally {
      syncing.current = false;
    }
  }, [refreshConversation, setMsgs, unseal]);

  // ---- live: new messages, read receipts, losing access
  const convId = conversation?.id;
  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase || !convId) return undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let subscribedBefore = false;
    const soon = (fn: () => void) => { clearTimeout(timer); timer = setTimeout(fn, 150); };
    const channel = supabase
      .channel(`chat-${convId}-${Math.random().toString(36).slice(2, 8)}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `conversation_id=eq.${convId}` }, payload => {
        const row = payload.new as { id?: string } | undefined;
        // Our own message is already on screen from the answer to the send.
        if (row?.id && msgs.current.some(m => m.id === row.id)) return;
        soon(() => void sync());
      })
      // a message deleted for everyone: its place on the screen becomes a tombstone at once (the row carries no text any more)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'chat_messages', filter: `conversation_id=eq.${convId}` }, payload => {
        const row = payload.new as { id?: string; deleted_at?: string | null } | undefined;
        if (row?.id && row.deleted_at) setMsgs(msgs.current.map(m => (m.id === row.id && !m.deleted ? tombstone(m) : m)));
      })
      // One catch-up for every kind of event (it fetches new messages and the conversation): events can arrive in any order, so a
      // second kind of event must never cancel the first one's work.
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'chat_conversations', filter: `id=eq.${convId}` }, () => soon(() => void sync()))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_members', filter: `conversation_id=eq.${convId}` }, () => soon(() => void sync()))
      .subscribe(status => {
        if (status !== 'SUBSCRIBED') return;
        // A connection made again after a drop: whatever happened in between has to be fetched.
        if (subscribedBefore) void sync();
        subscribedBefore = true;
      });
    const wake = () => { if (document.visibilityState === 'visible') void sync(); };
    window.addEventListener('focus', wake);
    window.addEventListener('online', wake);
    document.addEventListener('visibilitychange', wake);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('focus', wake);
      window.removeEventListener('online', wake);
      document.removeEventListener('visibilitychange', wake);
      void supabase.removeChannel(channel);
    };
  }, [convId, sync, setMsgs]);

  useEffect(() => {
    const on = () => setVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);

  // ---- older messages
  const loadOlder = useCallback(async () => {
    const first = msgs.current[0];
    if (!first || loadingOlder) return;
    const run = alive.current;
    setLoadingOlder(true);
    try {
      const page = await tp.current.messages({ before: first.seq, limit: 30 });
      const older = await unseal(conv.current, page.messages);
      if (run !== alive.current) return;
      setMsgs(merge(msgs.current, older));
      setHasMore(page.hasMore);
    } catch (e) {
      if (run === alive.current) setError(errorMessage(e));
    } finally {
      setLoadingOlder(false);
    }
  }, [loadingOlder, setMsgs, unseal]);

  // ---- sending (idempotent: a retry carries the same clientMsgId, so the server never stores it twice)
  const post = useCallback(async (p: PendingMessage) => {
    const run = alive.current;
    setPending(list => list.map(x => (x.clientMsgId === p.clientMsgId ? { ...x, status: 'sending', error: '' } : x)));
    try {
      const c = conv.current;
      let sent: ChatMessage;
      if (isSecureKind(c)) {
        // the message is encrypted HERE; the server is given the envelope only
        const s = secureRef.current;
        if (!s || !tp.current.sendSecure) throw new SecureSendError('LOCKED', 'Secure messaging is not available. Reload the page.');
        const sealed = await s.seal(c!, p.clientMsgId, {
          t: p.body,
          ...(p.replyTo ? { r: { id: p.replyTo.id, seq: p.replyTo.seq, senderName: p.replyTo.senderName, text: (p.replyTo.body || '').slice(0, 140) } } : {}),
          ...(p.attachments.length ? { a: p.attachments.map(a => ({ id: a.id, name: a.name, mime: a.mime, size: a.size, k: a.secretKey ?? '' })) } : {})
        });
        sent = await tp.current.sendSecure({ clientMsgId: p.clientMsgId, replyTo: p.replyTo?.id, attachmentIds: p.attachments.map(a => a.id), e2ee: sealed });
      } else {
        sent = await tp.current.send({ body: p.body, clientMsgId: p.clientMsgId, replyTo: p.replyTo?.id, attachmentIds: p.attachments.map(a => a.id) });
      }
      const [saved] = await unseal(c, [sent]);
      if (run !== alive.current) return;
      setMsgs(merge(msgs.current, [saved]));
      setPending(list => list.filter(x => x.clientMsgId !== p.clientMsgId));
      const cur = conv.current;
      if (cur && saved.seq > cur.lastSeq) setConv({ ...cur, lastSeq: saved.seq, lastMessageAt: saved.createdAt, lastMessagePreview: sent.encrypted ? 'Encrypted message' : saved.body || saved.attachments[0]?.name || null });
    } catch (e) {
      if (run !== alive.current) return;
      if (isGone(e)) setDenied(true);
      // a key changed or somebody has not set up yet: the screen looks at the people's keys again and says so
      if (e instanceof SecureSendError || (e instanceof ApiError && e.status === 409)) secureRef.current?.refresh();
      setPending(list => list.map(x => (x.clientMsgId === p.clientMsgId ? { ...x, status: 'failed', error: errorMessage(e) } : x)));
    }
  }, [setConv, setMsgs, unseal]);

  const send = useCallback((input: SendInput) => {
    const p: PendingMessage = { clientMsgId: newId(), body: input.body.trim(), attachments: input.attachments, replyTo: input.replyTo, status: 'sending', error: '', createdAt: new Date().toISOString() };
    setPending(list => [...list, p]);
    return post(p);
  }, [post]);
  const retry = useCallback((clientMsgId: string) => {
    const p = pendingRef.current.find(x => x.clientMsgId === clientMsgId);
    if (p && p.status === 'failed') void post(p);
  }, [post]);
  const discard = useCallback((clientMsgId: string) => setPending(list => list.filter(x => x.clientMsgId !== clientMsgId)), []);

  // ---- deleting (the server decides; the screen follows)
  /** Hide a message for the signed-in person only. */
  const deleteForMe = useCallback(async (m: ChatMessage) => {
    if (!tp.current.deleteForMe) throw new Error('Messages cannot be deleted here.');
    await tp.current.deleteForMe(m.id);
    setMsgs(msgs.current.filter(x => x.id !== m.id));
  }, [setMsgs]);
  /** Remove a message of mine for everybody (the database wipes it; a tombstone stays). */
  const deleteForEveryone = useCallback(async (m: ChatMessage) => {
    if (!tp.current.deleteForEveryone) throw new Error('Messages cannot be deleted here.');
    await tp.current.deleteForEveryone(m.id);
    setMsgs(msgs.current.map(x => (x.id === m.id ? tombstone(x) : x)));
    void refreshConversation();
  }, [setMsgs, refreshConversation]);

  // ---- "read" means it was on screen: the tab is in view, and this thread is the one being shown
  const lastSeq = messages.length ? messages[messages.length - 1].seq : 0;
  useEffect(() => {
    const c = conv.current;
    if (!active || !visible || !c || c.access === 'REVIEWER' || lastSeq <= c.readSeq) return undefined;
    const t = setTimeout(() => {
      tp.current.markRead(lastSeq).then(
        () => { const cur = conv.current; if (cur && cur.id === c.id) setConv({ ...cur, readSeq: Math.max(cur.readSeq, lastSeq), unread: 0 }); },
        () => { /* the next message or focus tries again */ }
      );
    }, 300);
    return () => clearTimeout(t);
  }, [active, visible, lastSeq, conversation?.readSeq, setConv]);

  return { conversation, messages, pending, hasMore, loading, loadingOlder, error, denied, loadOlder, send, retry, discard, deleteForMe, deleteForEveryone, reload: load, refreshConversation };
}
