import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowLeft, Ban, Check, CheckCheck, CornerUpLeft, Eye, FileText, Loader2, Lock, MoreVertical, Paperclip, RefreshCw, Send, ShieldAlert, ShieldCheck, Smile, SmilePlus, Trash2, Users, X } from 'lucide-react';
import type { ChatAttachment, ChatConversation, ChatMessage, ChatReceipt } from '../../../shared/contracts';
import { errorMessage } from '../../lib/api/client';
import type { ChatTransport } from '../../lib/chat/api';
import { useChatThread, type PendingMessage } from '../../lib/chat/useChatThread';
import { useInternalChatMode, useSecureChat, useSecureSnapshot } from '../../lib/chat/useSecureChat';
import type { PeerInfo } from '../../lib/chat/secureChat';
import { uploadToTicket } from '../../lib/uploadToTicket';
import { looksLike } from '../../lib/checklistUpload';
import { ChatModal } from './ChatBits';
import { EmojiPicker } from './EmojiPicker';
import { CHAT_REACTIONS } from '../../../shared/validation';
import { activeMentions, applyMention, mentionQuery, mentionSuggestions, splitMentions, type MentionPerson } from '../../lib/chat/mentions';
import { NewKeyDialog, SecureSetupDialog, SecureStateNotice, SecurityDialog, type SecureDialogMode } from './SecureDialogs';
import './chat.css';


/** ✓ Sent (stored), ✓✓ Delivered (every recipient's device has it), blue ✓✓ Seen (every recipient read it). The title lists each recipient. */
const ReceiptTick: React.FC<{ r: ChatReceipt }> = ({ r }) => {
  const label = r.status === 'SEEN' ? 'Seen' : r.status === 'DELIVERED' ? 'Delivered' : 'Sent';
  const detail = r.recipients.map(x => `${x.name} (${x.label}): ${x.seen ? 'seen' : x.delivered ? 'delivered' : 'not delivered yet'}`).join('\n');
  const title = detail ? `${label}\n${detail}` : label;
  return (
    <span className="inline-flex" title={title} data-status={r.status}>
      {r.status === 'SENT' ? <Check size={14} aria-label={label} /> : <CheckCheck size={14} className={r.status === 'SEEN' ? 'ch-seen' : undefined} aria-label={label} />}
    </span>
  );
};
export const CHAT_MAX_BODY = 4000;
const MAX_FILE = 5 * 1024 * 1024;
const MAX_FILES = 5;
const TYPES: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', pdf: 'application/pdf', txt: 'text/plain', csv: 'text/csv',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
};
const ACCEPT = Object.keys(TYPES).map(e => `.${e}`).join(',');
const TYPE_LIST = 'images, PDF, text, CSV, Word or Excel';

export const sizeLabel = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1048576).toFixed(1)} MB`);
const dayKey = (iso: string) => new Date(iso).toDateString();
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
export function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(); yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
}
/** "10:42" today, "Yesterday", or the date: for conversation lists. */
export function listTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return timeOf(iso);
  const yesterday = new Date(); yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

type Row =
  | { type: 'day'; key: string; label: string }
  | { type: 'msg'; key: string; msg: ChatMessage; showName: boolean }
  | { type: 'pending'; key: string; p: PendingMessage };

export interface ChatThreadProps {
  transport: ChatTransport;
  /** The conversation is on screen (false while another tab or panel covers it): nothing is marked read then. */
  active?: boolean;
  /** Shown above the messages. Gets the conversation once it is known. */
  header?: (c: ChatConversation | null) => React.ReactNode;
  onBack?: () => void;
  /** The conversation changed (new preview, read position, members): lists can refresh themselves. */
  onConversation?: (c: ChatConversation) => void;
  emptyTitle?: string;
  emptyText?: string;
  /** Replaces the composer when nobody can write (reviewer, or a client with no team yet). */
  readOnlyText?: (c: ChatConversation) => string | null;
  /** Whether sender names show on every incoming message (groups, and client chats where Team Member and Team Lead share it). */
  showNames?: boolean;
  /** Open on this message (a notification about an @mention): earlier pages are loaded until it is found, then it is shown highlighted. */
  focusMessageId?: string | null;
}

const FAILED_TEXT: Record<string, string> = {
  locked: 'Unlock secure messaging to read this message.',
  'no-key': 'This message was not sealed for you.',
  'old-key': 'This message was sealed for a security key this device does not have (for example before a reset).',
  'bad-signature': 'This message could not be verified as sent by this person, so it is not shown.',
  damaged: 'This message is damaged and cannot be shown.',
  'unknown-sender': 'The sender of this message could not be checked.'
};

/** Company-readable mode: an older end-to-end encrypted message that this device cannot open. It blocks nothing. */
const OLD_ENCRYPTED_TEXT = 'Sent while chats were end-to-end encrypted. It can only be read on a device that kept your earlier secure-messaging key.';

const Bubble: React.FC<{
  m: ChatMessage;
  showName: boolean;
  seen: boolean | null;
  /** 20261230000500: the server's status of my message, with each recipient (null = not known yet: the old tick is shown). */
  receipt?: ChatReceipt | null;
  canReply: boolean;
  onReply: () => void;
  onOpen: (a: ChatAttachment) => void;
  opening: string;
  /** Internal chat: messages can be deleted. */
  canDelete: boolean;
  secureKind: boolean;
  menuOpen: boolean;
  onMenu: (open: boolean) => void;
  onDelete: (mode: 'me' | 'all') => void;
  /** Direct messages and groups: reactions (one per person). */
  canReact?: boolean;
  reactOpen?: boolean;
  onReactOpen?: (open: boolean) => void;
  onReact?: (emoji: string | null) => void;
  onWho?: () => void;
  /** The message a notification pointed at (highlighted for a moment). */
  focused?: boolean;
}> = ({ m, showName, seen, receipt, canReply, onReply, onOpen, opening, canDelete, secureKind, menuOpen, onMenu, onDelete, canReact, reactOpen, onReactOpen, onReact, onWho, focused }) => {
  const mine = (m.reactions ?? []).find(r => r.mine)?.emoji ?? null;
  const reactable = Boolean(canReact) && !m.deleted && m.kind === 'TEXT' && m.secure?.state !== 'failed';
  return (
  <div className={`ch-row ${m.mine ? 'mine' : 'theirs'}${focused ? ' ch-focus' : ''}`} data-seq={m.seq} data-id={m.id} data-testid="chat-message" data-deleted={m.deleted ? 'true' : undefined}>
    <div className="ch-bubble">
      {!m.mine && showName && (
        <p className="ch-sender">
          {m.senderName || 'Someone'}
          {m.senderLabel ? <span className="ch-sender-role">{m.senderLabel}</span> : null}
        </p>
      )}
      {m.deleted ? (
        <p className="ch-deleted" data-testid="message-deleted"><Ban size={14} aria-hidden /> This message was deleted</p>
      ) : m.secure?.state === 'failed' ? (
        <p className="ch-locked-msg" data-testid="message-undecryptable" data-reason={m.secure.reason}><Lock size={14} aria-hidden style={{ flex: 'none', marginTop: 2 }} /> <span><b>Encrypted message.</b> {secureKind ? FAILED_TEXT[m.secure.reason] : OLD_ENCRYPTED_TEXT}</span></p>
      ) : (
        <>
          {m.replyTo && (
            <div className={`ch-quote ${m.replyTo.deleted ? 'gone' : ''}`}>
              <b>{m.replyTo.senderName || 'Message'}</b>
              <span>{m.replyTo.deleted ? 'This message was deleted' : m.replyTo.body || 'Attachment'}</span>
            </div>
          )}
          {m.body && (
            <p className="ch-text">
              {m.mentions?.length
                ? splitMentions(m.body, m.mentions.map(x => x.name)).map((part, i) => (part.mention
                  ? <mark key={i} className={`ch-mention${m.mentions!.some(x => x.me && part.text === `@${x.name}`) ? ' me' : ''}`} data-testid="chat-mention">{part.text}</mark>
                  : <React.Fragment key={i}>{part.text}</React.Fragment>))
                : m.body}
            </p>
          )}
          {m.attachments.length > 0 && (
            <ul className="ch-files">
              {m.attachments.map(a => (
                <li key={a.id}>
                  <button type="button" className="ch-file" onClick={() => onOpen(a)} aria-label={`Open ${a.name}`}>
                    {opening === a.id ? <Loader2 size={16} className="ch-spin" aria-hidden /> : <FileText size={16} aria-hidden />}
                    <span className="ch-file-name">{a.name}</span>
                    <span className="ch-file-size">{sizeLabel(a.size)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {secureKind && m.secure?.state === 'legacy' && <span className="ch-legacy">Sent before end-to-end encryption was turned on</span>}
        </>
      )}
      <span className="ch-meta">
        {timeOf(m.createdAt)}
        {m.mine && !m.deleted && receipt ? <ReceiptTick r={receipt} />
          : m.mine && !m.deleted && seen !== null ? (seen ? <CheckCheck size={14} className="ch-seen" aria-label="Seen" /> : <Check size={14} aria-label="Sent" />) : null}
      </span>
      {!m.deleted && (m.reactions?.length ?? 0) > 0 && (
        <div className="ch-reactions" data-testid="chat-reactions">
          {m.reactions!.map(r => (
            <button key={r.emoji} type="button" className={`ch-reaction${r.mine ? ' mine' : ''}`} disabled={!reactable}
              onClick={() => onReact?.(r.mine ? null : r.emoji)} data-testid="chat-reaction" data-emoji={r.emoji}
              title={`${r.people.map(x => (x.me ? 'You' : x.name)).join(', ')} reacted ${r.emoji}`}
              aria-label={`${r.emoji} ${r.count}: ${r.people.map(x => (x.me ? 'you' : x.name)).join(', ')}${r.mine ? '. Press to remove your reaction' : ''}`}>
              <span aria-hidden>{r.emoji}</span> <span>{r.count}</span>
            </button>
          ))}
          <button type="button" className="ch-reaction who" onClick={onWho} aria-label="See who reacted" title="See who reacted" data-testid="chat-reactions-who"><Users size={12} aria-hidden /></button>
        </div>
      )}
    </div>
    {reactable && (
      <span className="ch-react-wrap">
        <button type="button" className="ch-react-btn" onClick={() => onReactOpen?.(!reactOpen)} aria-label="React to this message" aria-haspopup="menu" aria-expanded={reactOpen} title="React" data-testid="react-button">
          <SmilePlus size={14} aria-hidden />
        </button>
        {reactOpen && (
          <div className="ch-react-menu" role="menu" aria-label="Reactions" data-testid="react-menu">
            {CHAT_REACTIONS.map(e => (
              <button key={e} type="button" role="menuitemradio" aria-checked={mine === e} className={mine === e ? 'on' : undefined}
                onClick={() => { onReactOpen?.(false); onReact?.(mine === e ? null : e); }} aria-label={`${REACTION_LABEL[e]}${mine === e ? ' (remove)' : ''}`} title={REACTION_LABEL[e]} data-emoji={e}>
                {e}
              </button>
            ))}
          </div>
        )}
      </span>
    )}
    {canReply && !m.deleted && m.secure?.state !== 'failed' && (
      <button type="button" className="ch-reply-btn" onClick={onReply} aria-label={`Reply to ${m.senderName || 'message'}`} title="Reply">
        <CornerUpLeft size={14} aria-hidden />
      </button>
    )}
    {canDelete && !m.deleted && (
      <span className="ch-menu-wrap">
        <button type="button" className="ch-menu-btn" onClick={() => onMenu(!menuOpen)} aria-label="Message actions" aria-haspopup="menu" aria-expanded={menuOpen} data-testid="message-menu-button">
          <MoreVertical size={14} aria-hidden />
        </button>
        {menuOpen && (
          <div className="ch-menu" role="menu" data-testid="message-menu">
            <button type="button" role="menuitem" onClick={() => { onMenu(false); onDelete('me'); }} data-testid="delete-for-me"><Trash2 size={14} aria-hidden /> Delete for me</button>
            {m.mine && <button type="button" role="menuitem" className="danger" onClick={() => { onMenu(false); onDelete('all'); }} data-testid="delete-for-everyone"><Trash2 size={14} aria-hidden /> Delete for everyone</button>}
          </div>
        )}
      </span>
    )}
  </div>
  );
};

const REACTION_LABEL: Record<string, string> = { '👍': 'Like', '❤️': 'Love', '😂': 'Laugh', '😮': 'Surprised', '😢': 'Sad', '🙏': 'Thanks' };

export const ChatThread: React.FC<ChatThreadProps> = ({ transport, active = true, header, onBack, onConversation, emptyTitle, emptyText, readOnlyText, showNames, focusMessageId }) => {
  const t = useChatThread(transport, { active, onChange: onConversation });
  const { conversation: c, messages, pending, hasMore, loading, loadingOlder, error, denied } = t;
  const [text, setText] = useState('');
  const [staged, setStaged] = useState<ChatAttachment[]>([]);
  const [uploading, setUploading] = useState<string[]>([]);
  const [fileError, setFileError] = useState('');
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [opening, setOpening] = useState('');
  const [fresh, setFresh] = useState(0);
  // emoji, message menu and deleting
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ m: ChatMessage; mode: 'me' | 'all' } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  // reactions and @mentions
  const [reactId, setReactId] = useState<string | null>(null);
  const [reactError, setReactError] = useState('');
  const [whoFor, setWhoFor] = useState<ChatMessage | null>(null);
  const [picked, setPicked] = useState<MentionPerson[]>([]);
  const [suggest, setSuggest] = useState<{ start: number; query: string; index: number } | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  // secure messaging (direct messages and groups)
  const secure = useSecureChat();
  const secureState = useSecureSnapshot(secure);
  const [secureDialog, setSecureDialog] = useState<SecureDialogMode | null>(null);
  const [securityOpen, setSecurityOpen] = useState(false);
  const [peers, setPeers] = useState<PeerInfo[]>([]);
  const body = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const stick = useRef(true);
  const lastTop = useRef<{ first: string; height: number } | null>(null);
  const lastCount = useRef(0);

  // a different conversation starts clean
  useEffect(() => { setText(''); setStaged([]); setReplyTo(null); setFileError(''); setFresh(0); setEmojiOpen(false); setMenuId(null); setReactId(null); setPicked([]); setSuggest(null); stick.current = true; lastCount.current = 0; }, [transport.key]);

  const secureKind = c?.kind === 'DIRECT' || c?.kind === 'GROUP';
  // end-to-end mode only (20261224000200): in the company-readable mode direct and group chats need no key, no passphrase and no set-up
  const chatMode = useInternalChatMode();
  const e2ee = secureKind && chatMode === 'E2EE';
  const memberKey = (c?.members ?? []).map(x => x.id).join(',');
  // who is in the chat and whether their keys are the ones this device trusts (checked again when the people or the keys change)
  const refreshPeers = useCallback(() => {
    if (!secure || !c || !e2ee || secureState.status !== 'ready') { setPeers([]); return; }
    secure.peers(c.id).then(setPeers, () => setPeers([]));
  }, [secure, c?.id, e2ee, secureState.status, secureState.revision]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(refreshPeers, [refreshPeers, memberKey, c?.lastSeq]);
  const changedPeers = peers.filter(p => p.changed);
  const missingPeers = peers.filter(p => !p.me && !p.fingerprint);

  const insertEmoji = (emoji: string) => {
    const el = box.current;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    const next = text.slice(0, start) + emoji + text.slice(end);
    setText(next);
    requestAnimationFrame(() => {
      const t = box.current;
      if (!t) return;
      const at = start + emoji.length;
      t.focus();
      t.setSelectionRange(at, at);
      t.style.height = 'auto';
      t.style.height = `${Math.min(t.scrollHeight, 140)}px`;
    });
  };

  // ---- @mentions (groups): the members of this group, without me
  const groupPeople = useMemo<MentionPerson[]>(() => (c?.kind === 'GROUP' ? (c.members ?? []).filter(x => !x.me).map(x => ({ id: x.id, name: x.name })) : []), [c?.kind, c?.members]);
  const options = suggest && groupPeople.length ? mentionSuggestions(groupPeople, suggest.query, picked.filter(p => text.includes(`@${p.name}`)).map(p => p.id)) : [];
  const watchMention = (value: string, caret: number) => {
    if (!groupPeople.length) return setSuggest(null);
    const q = mentionQuery(value, caret);
    setSuggest(q ? { ...q, index: 0 } : null);
  };
  const pickMention = (person: MentionPerson) => {
    const el = box.current;
    const caret = el?.selectionStart ?? text.length;
    const start = suggest?.start ?? caret;
    const next = applyMention(text, start, caret, person.name);
    setText(next.text);
    setPicked(list => (list.some(p => p.id === person.id) ? list : [...list, person]));
    setSuggest(null);
    requestAnimationFrame(() => { const t2 = box.current; if (t2) { t2.focus(); t2.setSelectionRange(next.caret, next.caret); grow(t2); } });
  };

  // ---- reactions
  const runReact = async (m: ChatMessage, emoji: string | null) => {
    setReactError('');
    try {
      await t.react(m, emoji);
    } catch (e) {
      setReactError(errorMessage(e));
    }
  };

  // ---- a notification pointed at a message: find it (loading earlier pages if needed), show it and highlight it for a moment
  const focusTries = useRef(0);
  useEffect(() => { focusTries.current = 0; }, [focusMessageId, transport.key]);
  useEffect(() => {
    if (!focusMessageId || loading || !c) return undefined;
    if (messages.some(m => m.id === focusMessageId)) {
      const el = body.current?.querySelector<HTMLElement>(`[data-id="${focusMessageId}"]`);
      if (el && focused !== focusMessageId) {
        stick.current = false;
        el.scrollIntoView({ block: 'center' });
        setFocused(focusMessageId);
        const tm = setTimeout(() => setFocused(f => (f === focusMessageId ? null : f)), 4000);
        return () => clearTimeout(tm);
      }
      return undefined;
    }
    if (hasMore && !loadingOlder && focusTries.current < 25) {
      focusTries.current += 1;
      stick.current = false;
      void t.loadOlder();
    }
    return undefined;
  }, [focusMessageId, messages, hasMore, loadingOlder, loading, c]); // eslint-disable-line react-hooks/exhaustive-deps

  const runDelete = async () => {
    if (!confirm || deleting) return;
    setDeleting(true); setDeleteError('');
    try {
      if (confirm.mode === 'me') await t.deleteForMe(confirm.m);
      else await t.deleteForEveryone(confirm.m);
      setConfirm(null);
    } catch (e) {
      setDeleteError(errorMessage(e));
    } finally {
      setDeleting(false);
    }
  };

  const nearBottom = () => {
    const el = body.current;
    return !el || el.scrollHeight - el.scrollTop - el.clientHeight < 140;
  };
  const toBottom = useCallback((smooth = false) => {
    const el = body.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
    setFresh(0);
  }, []);

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    let day = '';
    let prev: ChatMessage | null = null;
    for (const m of messages) {
      const k = dayKey(m.createdAt);
      if (k !== day) { out.push({ type: 'day', key: `d-${k}`, label: dayLabel(m.createdAt) }); day = k; prev = null; }
      const same = prev && prev.kind === 'TEXT' && m.kind === 'TEXT' && prev.senderName === m.senderName && prev.senderLabel === m.senderLabel && prev.mine === m.mine;
      out.push({ type: 'msg', key: m.id, msg: m, showName: m.kind === 'TEXT' && !same });
      prev = m;
    }
    for (const p of pending) out.push({ type: 'pending', key: `p-${p.clientMsgId}`, p });
    return out;
  }, [messages, pending]);

  // scrolling: stay at the bottom while new things arrive (unless the person scrolled up), keep the place when older ones load
  useLayoutEffect(() => {
    const el = body.current;
    if (!el) return;
    const first = messages[0]?.id ?? '';
    const prevTop = lastTop.current;
    if (prevTop && first && prevTop.first !== first && messages.length > lastCount.current && stick.current === false) {
      el.scrollTop += el.scrollHeight - prevTop.height; // older messages were added above
    } else if (lastCount.current === 0 || stick.current) {
      toBottom();
    } else if (messages.length > lastCount.current || pending.length) {
      setFresh(n => n + Math.max(0, messages.length - lastCount.current));
    }
    lastTop.current = { first, height: el.scrollHeight };
    lastCount.current = messages.length;
  }, [messages, pending.length, toBottom]);

  // the message area changes height when the keyboard opens or closes (or the window turns): a reader at the bottom stays at the bottom
  const hasBody = !!c;
  useEffect(() => {
    const el = body.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    let height = el.clientHeight;
    const ro = new ResizeObserver(() => {
      if (el.clientHeight === height) return;
      height = el.clientHeight;
      if (stick.current) el.scrollTop = el.scrollHeight;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [hasBody, transport.key]);

  const onScroll = () => {
    stick.current = nearBottom();
    if (stick.current) setFresh(0);
  };

  // mine: always follow
  useEffect(() => { if (pending.length) { stick.current = true; toBottom(); } }, [pending.length, toBottom]);

  const sending = pending.some(p => p.status === 'sending');
  const busy = uploading.length > 0;
  const secureBlock = e2ee && c?.canWrite
    ? secureState.status === 'preparing' ? 'Secure messaging is being set up. You can send in a moment.'
      : secureState.status === 'setup' ? 'Secure messaging is not available in this browser yet. See the message above.'
      : secureState.status === 'locked' ? (secureState.recovery === 'passphrase' ? 'Unlock secure messaging to send messages in this chat.' : 'Set up this device for secure messaging to send messages in this chat.')
      : secureState.status === 'ready' && changedPeers.length > 0 ? 'Review the changed security key before you send a message.'
      : secureState.status === 'ready' && missingPeers.length > 0 ? `${missingPeers.map(p => p.name).join(', ')} ${missingPeers.length === 1 ? 'has' : 'have'} not turned on secure messaging yet. You can send as soon as ${missingPeers.length === 1 ? 'they do' : 'they have'}: ask them to open Chat once.`
      : secureState.status === 'loading' || secureState.status === 'error' ? 'Secure messaging is not available right now.'
      : null
    : null;
  const lockedText = c ? (c.canWrite ? secureBlock : readOnlyText?.(c) ?? 'You can read this conversation but not write in it.') : null;
  const peer = c?.peerReadSeq ?? null;

  const submit = () => {
    const value = text.trim();
    if ((!value && staged.length === 0) || sending || busy || !c?.canWrite) return;
    if (value.length > CHAT_MAX_BODY) { setFileError(`A message can have at most ${CHAT_MAX_BODY} characters.`); return; }
    const reply = replyTo ? { id: replyTo.id, seq: replyTo.seq, senderName: replyTo.senderName, body: replyTo.body } : null;
    const mentions = c?.kind === 'GROUP' ? activeMentions(value, picked) : [];
    void t.send({ body: value, attachments: staged, replyTo: reply, mentions });
    setText(''); setStaged([]); setReplyTo(null); setFileError(''); setPicked([]); setSuggest(null);
    requestAnimationFrame(() => { if (box.current) box.current.style.height = 'auto'; box.current?.focus(); });
  };

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // the @ list is open: arrows move, Enter / Tab pick, Escape closes
    if (suggest && options.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSuggest({ ...suggest, index: (suggest.index + 1) % options.length }); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSuggest({ ...suggest, index: (suggest.index - 1 + options.length) % options.length }); return; }
      if ((e.key === 'Enter' || e.key === 'Tab') && !e.nativeEvent.isComposing) { e.preventDefault(); pickMention(options[Math.min(suggest.index, options.length - 1)]); return; }
      if (e.key === 'Escape') { e.preventDefault(); setSuggest(null); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); }
  };
  const grow = (el: HTMLTextAreaElement) => { el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight, 140)}px`; };

  const addFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setFileError('');
    for (const file of Array.from(files)) {
      if (staged.length + uploading.length >= MAX_FILES) { setFileError(`You can attach up to ${MAX_FILES} files to one message.`); break; }
      const ext = file.name.split('.').pop()?.toLowerCase() || '';
      const mime = TYPES[ext];
      if (!mime) { setFileError(`${file.name}: this file type cannot be sent. Use ${TYPE_LIST}.`); continue; }
      if (file.size === 0) { setFileError(`${file.name} is empty.`); continue; }
      if (file.size > MAX_FILE) { setFileError(`${file.name} is larger than 5 MB.`); continue; }
      setUploading(u => [...u, file.name]);
      let id: string | null = null;
      try {
        if (!(await looksLike(file, mime)) && ['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'text/csv', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'].includes(mime)) {
          throw new Error(`${file.name} is not a real ${ext.toUpperCase()} file.`);
        }
        if (e2ee) {
          // encrypted here, with its own key; the server only ever stores an opaque envelope
          if (!secure || secureState.status !== 'ready') throw new Error('Unlock secure messaging first.');
          const sealed = await secure.encryptAttachment(new Uint8Array(await file.arrayBuffer()));
          const envelope = new File([sealed.blob], 'file.enc', { type: 'application/x-amuwa-e2ee' });
          const ticket = await transport.beginUpload({ fileName: 'file.enc', mimeType: 'application/x-amuwa-e2ee', sizeBytes: envelope.size });
          id = ticket.attachment.id;
          await uploadToTicket(ticket, envelope, 'application/x-amuwa-e2ee');
          const done = await transport.completeUpload(id);
          id = null;
          setStaged(s => [...s, { id: done.id, name: file.name, mime, size: file.size, secretKey: sealed.key }]);
        } else {
          const ticket = await transport.beginUpload({ fileName: file.name, mimeType: mime, sizeBytes: file.size });
          id = ticket.attachment.id;
          await uploadToTicket(ticket, file, mime);
          const done = await transport.completeUpload(id);
          id = null;
          setStaged(s => [...s, done]);
        }
      } catch (e) {
        setFileError(errorMessage(e));
        if (id) void transport.abortUpload(id).catch(() => undefined);
      } finally {
        setUploading(u => { const i = u.indexOf(file.name); return i < 0 ? u : [...u.slice(0, i), ...u.slice(i + 1)]; });
      }
    }
    if (picker.current) picker.current.value = '';
  };

  const openFile = async (a: ChatAttachment) => {
    setOpening(a.id); setFileError('');
    if (a.secretKey && secure) {
      // an encrypted file: fetched as it is stored, opened here with the key that came inside the message
      try {
        const { url } = await transport.attachmentUrl(a.id, 'download');
        const res = await fetch(url);
        if (!res.ok) throw new Error('The file could not be downloaded.');
        const bytes = await secure.decryptAttachment(new Uint8Array(await res.arrayBuffer()), a.secretKey);
        const blobUrl = URL.createObjectURL(new Blob([bytes], { type: a.mime }));
        const viewable = a.mime.startsWith('image/') || a.mime === 'application/pdf' || a.mime.startsWith('text/');
        if (viewable) window.open(blobUrl, '_blank', 'noopener');
        else { const link = document.createElement('a'); link.href = blobUrl; link.download = a.name; link.click(); }
        setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
      } catch (e) {
        setFileError(errorMessage(e));
      } finally {
        setOpening('');
      }
      return;
    }
    // opened before the answer arrives, so the browser does not take it for a pop-up
    const win = window.open('', '_blank');
    try {
      const { url } = await transport.attachmentUrl(a.id, 'view');
      if (win) { win.opener = null; win.location.href = url; } else window.location.assign(url);
    } catch (e) {
      win?.close();
      setFileError(errorMessage(e));
    } finally {
      setOpening('');
    }
  };

  // the last of my messages that the other side has read gets the double tick
  const seenFor = (m: ChatMessage): boolean | null => (peer === null ? null : m.seq <= peer);

  if (denied) {
    return (
      <section className="ch-thread" aria-label="Conversation">
        {onBack && <div className="ch-head"><button type="button" className="ch-icon" onClick={onBack} aria-label="Back to conversations"><ArrowLeft size={18} /></button></div>}
        <div className="ch-state" role="alert">
          <ShieldAlert size={28} aria-hidden />
          <p><b>This conversation is not available.</b></p>
          <p>{error || 'You no longer have access to it.'}</p>
        </div>
      </section>
    );
  }

  return (
    <section className="ch-thread" aria-label="Conversation">
      {header ? header(c) : onBack ? (
        <div className="ch-head"><button type="button" className="ch-icon" onClick={onBack} aria-label="Back to conversations"><ArrowLeft size={18} /></button></div>
      ) : null}

      {e2ee && !loading && secure && <SecureStateNotice client={secure} variant="thread" onDialog={setSecureDialog} onSecurity={() => setSecurityOpen(true)} />}
      {e2ee && changedPeers.length > 0 && (
        <div className="ch-secure-bar bad" role="alert" data-testid="key-changed-bar">
          <ShieldAlert size={15} aria-hidden /> <span>The security key of {changedPeers.map(p => p.name).join(', ')} changed. Check it before you send anything.</span>
          <button type="button" className="ch-link" onClick={() => setSecurityOpen(true)}>Review</button>
        </div>
      )}
      {loading && !c ? (
        <div className="ch-state" role="status"><Loader2 className="ch-spin" size={22} aria-hidden /><p>Loading messages</p></div>
      ) : error && !c ? (
        <div className="ch-state" role="alert">
          <p>{error}</p>
          <button type="button" className="ch-btn" onClick={() => void t.reload()}><RefreshCw size={14} aria-hidden /> Try again</button>
        </div>
      ) : (
        <>
          <div className="ch-body" ref={body} onScroll={onScroll} role="log" aria-live="polite" aria-label="Messages" tabIndex={0}>
            {hasMore && (
              <div className="ch-older">
                <button type="button" className="ch-btn ghost" onClick={() => void t.loadOlder()} disabled={loadingOlder}>
                  {loadingOlder ? <Loader2 size={14} className="ch-spin" aria-hidden /> : null} Load earlier messages
                </button>
              </div>
            )}
            {messages.length === 0 && pending.length === 0 && (
              <div className="ch-empty">
                <p><b>{emptyTitle || 'No messages yet'}</b></p>
                <p>{emptyText || 'Say hello to start the conversation.'}</p>
              </div>
            )}
            {rows.map(r => {
              if (r.type === 'day') return <div key={r.key} className="ch-day"><span>{r.label}</span></div>;
              if (r.type === 'pending') {
                const p = r.p;
                return (
                  <div key={r.key} className="ch-row mine pending" data-state={p.status}>
                    <div className="ch-bubble">
                      {p.body && <p className="ch-text">{p.body}</p>}
                      {p.attachments.length > 0 && <ul className="ch-files">{p.attachments.map(a => <li key={a.id}><span className="ch-file"><FileText size={16} aria-hidden /><span className="ch-file-name">{a.name}</span></span></li>)}</ul>}
                      <span className="ch-meta">
                        {p.status === 'sending' ? <><Loader2 size={12} className="ch-spin" aria-hidden /> Sending</> : <span className="ch-fail">Not sent</span>}
                      </span>
                      {p.status === 'failed' && (
                        <p className="ch-fail-row" role="alert">
                          {p.error || 'This message could not be sent.'}
                          <button type="button" className="ch-link" onClick={() => t.retry(p.clientMsgId)}>Retry</button>
                          <button type="button" className="ch-link" onClick={() => t.discard(p.clientMsgId)}>Delete</button>
                        </p>
                      )}
                    </div>
                  </div>
                );
              }
              const m = r.msg;
              if (m.kind === 'SYSTEM') return <div key={r.key} className="ch-system" data-seq={m.seq}><span>{m.body}</span></div>;
              return (
                <Bubble
                  key={r.key}
                  m={m}
                  showName={Boolean(showNames) && r.showName}
                  seen={m.mine ? seenFor(m) : null}
                  receipt={m.mine ? t.receipts?.get(m.seq) ?? null : null}
                  canReply={Boolean(c?.canWrite)}
                  onReply={() => { setReplyTo(m); box.current?.focus(); }}
                  onOpen={a => void openFile(a)}
                  opening={opening}
                  canDelete={secureKind && c?.access === 'MEMBER'}
                  secureKind={e2ee}
                  menuOpen={menuId === m.id}
                  onMenu={open => setMenuId(open ? m.id : null)}
                  onDelete={mode => { setDeleteError(''); setConfirm({ m, mode }); }}
                  canReact={secureKind && c?.access === 'MEMBER' && Boolean(transport.react)}
                  reactOpen={reactId === m.id}
                  onReactOpen={open => setReactId(open ? m.id : null)}
                  onReact={emoji => void runReact(m, emoji)}
                  onWho={() => setWhoFor(m)}
                  focused={focused === m.id}
                />
              );
            })}
          </div>

          {fresh > 0 && (
            <button type="button" className="ch-jump" onClick={() => { stick.current = true; toBottom(true); }}>
              <ArrowDown size={14} aria-hidden /> {fresh} new {fresh === 1 ? 'message' : 'messages'}
            </button>
          )}

          {lockedText ? (
            <div className="ch-locked" role="note" data-testid="composer-locked"><Eye size={16} aria-hidden /> {lockedText}</div>
          ) : (
            <form className="ch-composer" onSubmit={e => { e.preventDefault(); submit(); }}>
              {replyTo && (
                <div className="ch-replying">
                  <CornerUpLeft size={14} aria-hidden />
                  <span><b>{replyTo.senderName || 'Message'}</b> {replyTo.body || 'Attachment'}</span>
                  <button type="button" className="ch-icon" onClick={() => setReplyTo(null)} aria-label="Cancel reply"><X size={14} /></button>
                </div>
              )}
              {(staged.length > 0 || uploading.length > 0) && (
                <ul className="ch-staged" aria-label="Attached files">
                  {staged.map(a => (
                    <li key={a.id}><FileText size={14} aria-hidden /><span>{a.name}</span><button type="button" className="ch-icon" onClick={() => setStaged(s => s.filter(x => x.id !== a.id))} aria-label={`Remove ${a.name}`}><X size={12} /></button></li>
                  ))}
                  {uploading.map((n, i) => <li key={`u${i}`} className="busy"><Loader2 size={14} className="ch-spin" aria-hidden /><span>{n}</span></li>)}
                </ul>
              )}
              {fileError && <p className="ch-error" role="alert">{fileError}</p>}
              {(reactError || t.warning) && (
                <p className="ch-error" role="alert">{reactError || t.warning}
                  <button type="button" className="ch-link" onClick={() => { setReactError(''); t.clearWarning(); }}>Dismiss</button></p>
              )}
              {suggest && options.length > 0 && (
                <ul className="ch-mentions" role="listbox" aria-label="Tag a member of this group" data-testid="mention-list">
                  {options.map((p, i) => (
                    <li key={p.id} role="option" aria-selected={i === suggest.index}>
                      <button type="button" className={i === suggest.index ? 'on' : undefined} onMouseDown={e => e.preventDefault()} onClick={() => pickMention(p)} data-testid="mention-option">
                        @{p.name}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="ch-input">
                <input ref={picker} type="file" accept={ACCEPT} multiple hidden onChange={e => void addFiles(e.target.files)} />
                <button type="button" className="ch-icon" data-emoji-toggle onClick={() => setEmojiOpen(o => !o)} aria-label="Insert emoji" aria-expanded={emojiOpen} title="Emoji" data-testid="emoji-button"><Smile size={20} /></button>
                {emojiOpen && <EmojiPicker onPick={insertEmoji} onClose={() => setEmojiOpen(false)} />}
                <button type="button" className="ch-icon" onClick={() => picker.current?.click()} disabled={busy} aria-label="Attach a file" title="Attach a file (up to 5 MB)"><Paperclip size={18} /></button>
                <textarea
                  ref={box}
                  value={text}
                  rows={1}
                  maxLength={CHAT_MAX_BODY + 200}
                  placeholder={groupPeople.length ? 'Write a message (type @ to tag someone)' : 'Write a message'}
                  aria-label="Message"
                  aria-autocomplete={groupPeople.length ? 'list' : undefined}
                  onChange={e => { setText(e.target.value); grow(e.target); watchMention(e.target.value, e.target.selectionStart ?? e.target.value.length); }}
                  onKeyDown={onKey}
                  onClick={e => watchMention(e.currentTarget.value, e.currentTarget.selectionStart ?? 0)}
                />
                <button type="submit" className="ch-send" disabled={(!text.trim() && staged.length === 0) || sending || busy} aria-label="Send message"><Send size={18} /></button>
              </div>
              <p className="ch-hint">Enter to send, Shift+Enter for a new line</p>
            </form>
          )}
        </>
      )}
      {confirm && (
        <ChatModal title={confirm.mode === 'me' ? 'Delete this message for you?' : 'Delete this message for everyone?'} onClose={() => (deleting ? undefined : setConfirm(null))}
          footer={<>
            <button type="button" className="ch-btn" onClick={() => setConfirm(null)} disabled={deleting}>Cancel</button>
            <button type="button" className="ch-btn danger" onClick={() => void runDelete()} disabled={deleting} data-testid="confirm-delete">
              {deleting ? <Loader2 size={14} className="ch-spin" aria-hidden /> : <Trash2 size={14} aria-hidden />} {confirm.mode === 'me' ? 'Delete for me' : 'Delete for everyone'}
            </button>
          </>}>
          {confirm.mode === 'me' ? (
            <p className="ch-note">The message is removed from your chat only, on all your devices. The other people in this chat still see it.</p>
          ) : (
            <>
              <p className="ch-note">The message is removed for every person in this chat and the server deletes {confirm.m.encrypted ? 'its encrypted copy' : 'its text'}{confirm.m.attachments.length ? ' and its files' : ''}. People will see "This message was deleted".</p>
              <p className="ch-note warn">Deleting cannot take back a screenshot, a copy somebody made, or a message that already reached a phone that is offline and was opened there.</p>
            </>
          )}
          {deleteError && <p className="ch-note" role="alert" style={{ color: 'var(--ch-danger)' }}>{deleteError}</p>}
        </ChatModal>
      )}
      {whoFor && (
        <ChatModal title="Reactions" onClose={() => setWhoFor(null)} footer={<button type="button" className="ch-btn" onClick={() => setWhoFor(null)}>Close</button>}>
          <ul className="ch-who" data-testid="reactions-who">
            {(messages.find(x => x.id === whoFor.id)?.reactions ?? []).map(r => (
              <li key={r.emoji}><span className="ch-who-emoji" aria-hidden>{r.emoji}</span> <span className="sr-only">{REACTION_LABEL[r.emoji]}: </span>{r.people.map(x => (x.me ? 'You' : x.name)).join(', ')}</li>
            ))}
            {!(messages.find(x => x.id === whoFor.id)?.reactions ?? []).length && <li>No reactions any more.</li>}
          </ul>
        </ChatModal>
      )}
      {secureDialog === 'new-key' && secure && <NewKeyDialog client={secure} onClose={() => setSecureDialog(null)} />}
      {secureDialog && secureDialog !== 'new-key' && secure && <SecureSetupDialog client={secure} mode={secureDialog} onClose={() => setSecureDialog(null)} onSwitch={setSecureDialog} />}
      {securityOpen && secure && c && <SecurityDialog client={secure} conversationId={c.id} onClose={() => setSecurityOpen(false)} onChanged={refreshPeers} />}
    </section>
  );
};
