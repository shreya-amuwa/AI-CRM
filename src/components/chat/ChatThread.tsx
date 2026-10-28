import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowLeft, Ban, Check, CheckCheck, CornerUpLeft, Eye, FileText, Loader2, Lock, MoreVertical, Paperclip, RefreshCw, Send, ShieldAlert, ShieldCheck, Smile, Trash2, X } from 'lucide-react';
import type { ChatAttachment, ChatConversation, ChatMessage } from '../../../shared/contracts';
import { errorMessage } from '../../lib/api/client';
import type { ChatTransport } from '../../lib/chat/api';
import { useChatThread, type PendingMessage } from '../../lib/chat/useChatThread';
import { useSecureChat, useSecureSnapshot } from '../../lib/chat/useSecureChat';
import type { PeerInfo } from '../../lib/chat/secureChat';
import { uploadToTicket } from '../../lib/uploadToTicket';
import { looksLike } from '../../lib/checklistUpload';
import { ChatModal } from './ChatBits';
import { EmojiPicker } from './EmojiPicker';
import { SecureSetupDialog, SecurityDialog, type SecureMode } from './SecureDialogs';
import './chat.css';

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
}

const FAILED_TEXT: Record<string, string> = {
  locked: 'Unlock secure messaging to read this message.',
  'no-key': 'This message was not sealed for you.',
  'old-key': 'This message was sealed for a security key this device does not have (for example before a reset).',
  'bad-signature': 'This message could not be verified as sent by this person, so it is not shown.',
  damaged: 'This message is damaged and cannot be shown.',
  'unknown-sender': 'The sender of this message could not be checked.'
};

const Bubble: React.FC<{
  m: ChatMessage;
  showName: boolean;
  seen: boolean | null;
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
}> = ({ m, showName, seen, canReply, onReply, onOpen, opening, canDelete, secureKind, menuOpen, onMenu, onDelete }) => (
  <div className={`ch-row ${m.mine ? 'mine' : 'theirs'}`} data-seq={m.seq} data-testid="chat-message" data-deleted={m.deleted ? 'true' : undefined}>
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
        <p className="ch-locked-msg" data-testid="message-undecryptable" data-reason={m.secure.reason}><Lock size={14} aria-hidden style={{ flex: 'none', marginTop: 2 }} /> <span><b>Encrypted message.</b> {FAILED_TEXT[m.secure.reason]}</span></p>
      ) : (
        <>
          {m.replyTo && (
            <div className={`ch-quote ${m.replyTo.deleted ? 'gone' : ''}`}>
              <b>{m.replyTo.senderName || 'Message'}</b>
              <span>{m.replyTo.deleted ? 'This message was deleted' : m.replyTo.body || 'Attachment'}</span>
            </div>
          )}
          {m.body && <p className="ch-text">{m.body}</p>}
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
        {m.mine && !m.deleted && seen !== null ? (seen ? <CheckCheck size={14} className="ch-seen" aria-label="Seen" /> : <Check size={14} aria-label="Sent" />) : null}
      </span>
    </div>
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

export const ChatThread: React.FC<ChatThreadProps> = ({ transport, active = true, header, onBack, onConversation, emptyTitle, emptyText, readOnlyText, showNames }) => {
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
  // secure messaging (direct messages and groups)
  const secure = useSecureChat();
  const secureState = useSecureSnapshot(secure);
  const [secureDialog, setSecureDialog] = useState<SecureMode | null>(null);
  const [securityOpen, setSecurityOpen] = useState(false);
  const [peers, setPeers] = useState<PeerInfo[]>([]);
  const body = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const stick = useRef(true);
  const lastTop = useRef<{ first: string; height: number } | null>(null);
  const lastCount = useRef(0);

  // a different conversation starts clean
  useEffect(() => { setText(''); setStaged([]); setReplyTo(null); setFileError(''); setFresh(0); setEmojiOpen(false); setMenuId(null); stick.current = true; lastCount.current = 0; }, [transport.key]);

  const secureKind = c?.kind === 'DIRECT' || c?.kind === 'GROUP';
  const memberKey = (c?.members ?? []).map(x => x.id).join(',');
  // who is in the chat and whether their keys are the ones this device trusts (checked again when the people or the keys change)
  const refreshPeers = useCallback(() => {
    if (!secure || !c || !secureKind || secureState.status !== 'ready') { setPeers([]); return; }
    secure.peers(c.id).then(setPeers, () => setPeers([]));
  }, [secure, c?.id, secureKind, secureState.status, secureState.revision]); // eslint-disable-line react-hooks/exhaustive-deps
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

  const onScroll = () => {
    stick.current = nearBottom();
    if (stick.current) setFresh(0);
  };

  // mine: always follow
  useEffect(() => { if (pending.length) { stick.current = true; toBottom(); } }, [pending.length, toBottom]);

  const sending = pending.some(p => p.status === 'sending');
  const busy = uploading.length > 0;
  const secureBlock = secureKind && c?.canWrite
    ? secureState.status === 'setup' ? 'Turn on secure messaging to send messages in this chat.'
      : secureState.status === 'locked' ? 'Unlock secure messaging to send messages in this chat.'
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
    void t.send({ body: value, attachments: staged, replyTo: reply });
    setText(''); setStaged([]); setReplyTo(null); setFileError('');
    requestAnimationFrame(() => { if (box.current) box.current.style.height = 'auto'; box.current?.focus(); });
  };

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
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
        if (secureKind) {
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

      {secureKind && !loading && (
        secureState.status === 'ready' ? (
          <div className="ch-secure-bar" data-testid="secure-bar" data-state="ready">
            <ShieldCheck size={15} aria-hidden /> <span>End-to-end encrypted. Only the people in this chat can read these messages.</span>
            <button type="button" className="ch-link" onClick={() => setSecurityOpen(true)} data-testid="open-security">Security</button>
          </div>
        ) : secureState.status === 'setup' ? (
          <div className="ch-secure-bar warn" role="status" data-testid="secure-bar" data-state="setup">
            <Lock size={15} aria-hidden /> <span>Secure messaging is not turned on for your account yet.</span>
            <button type="button" className="ch-link" onClick={() => setSecureDialog('setup')} data-testid="secure-turn-on">Turn on</button>
          </div>
        ) : secureState.status === 'locked' ? (
          <div className="ch-secure-bar warn" role="status" data-testid="secure-bar" data-state="locked">
            <Lock size={15} aria-hidden /> <span>Secure messaging is locked on this device. Unlock it to read and send messages.</span>
            <button type="button" className="ch-link" onClick={() => setSecureDialog('unlock')} data-testid="secure-unlock">Unlock</button>
          </div>
        ) : secureState.status === 'error' ? (
          <div className="ch-secure-bar bad" role="alert" data-testid="secure-bar" data-state="error"><ShieldAlert size={15} aria-hidden /> <span>{secureState.error || 'Secure messaging could not start.'}</span></div>
        ) : null
      )}
      {secureKind && changedPeers.length > 0 && (
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
                  canReply={Boolean(c?.canWrite)}
                  onReply={() => { setReplyTo(m); box.current?.focus(); }}
                  onOpen={a => void openFile(a)}
                  opening={opening}
                  canDelete={secureKind && c?.access === 'MEMBER'}
                  secureKind={secureKind}
                  menuOpen={menuId === m.id}
                  onMenu={open => setMenuId(open ? m.id : null)}
                  onDelete={mode => { setDeleteError(''); setConfirm({ m, mode }); }}
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
                  placeholder="Write a message"
                  aria-label="Message"
                  onChange={e => { setText(e.target.value); grow(e.target); }}
                  onKeyDown={onKey}
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
              <p className="ch-note">The message is removed for every person in this chat and the server deletes its encrypted copy{confirm.m.attachments.length ? ' and its files' : ''}. People will see "This message was deleted".</p>
              <p className="ch-note warn">Deleting cannot take back a screenshot, a copy somebody made, or a message that already reached a phone that is offline and was opened there.</p>
            </>
          )}
          {deleteError && <p className="ch-note" role="alert" style={{ color: 'var(--ch-danger)' }}>{deleteError}</p>}
        </ChatModal>
      )}
      {secureDialog && secure && <SecureSetupDialog client={secure} mode={secureDialog} onClose={() => setSecureDialog(null)} onSwitch={setSecureDialog} />}
      {securityOpen && secure && c && <SecurityDialog client={secure} conversationId={c.id} onClose={() => setSecurityOpen(false)} onChanged={refreshPeers} />}
    </section>
  );
};
