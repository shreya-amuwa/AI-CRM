import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Info, Loader2, Plus, RefreshCw } from 'lucide-react';
import type { ChatConversation } from '../../../shared/contracts';
import { useAuth } from '../../context/AuthContext';
import { errorMessage } from '../../lib/api/client';
import { chatApi, staffTransport } from '../../lib/chat/api';
import { useChatLive } from '../../lib/chat/useChatLive';
import { SecureChatProvider, useSecureChat, useSecureSnapshot } from '../../lib/chat/useSecureChat';
import { SecureSetupDialog, type SecureMode } from './SecureDialogs';
import { Avatar, ConversationItem, Split, previewOf } from './ChatBits';
import { ChatThread } from './ChatThread';
import { GroupInfoDialog, NewChatDialog } from './ChatDialogs';

/** Direct messages and groups between employees: end-to-end encrypted (the keys live in this browser; see lib/chat/secureChat.ts). */
export const InternalChats: React.FC<{ active: boolean; onUnreadChange: () => void; initialId?: string | null }> = props => {
  const { profile } = useAuth();
  if (!profile?.id) return null;
  return <SecureChatProvider userId={profile.id}><InternalChatsInner {...props} /></SecureChatProvider>;
};

const InternalChatsInner: React.FC<{ active: boolean; onUnreadChange: () => void; initialId?: string | null }> = ({ active, onUnreadChange, initialId }) => {
  const [items, setItems] = useState<ChatConversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [term, setTerm] = useState('');
  const [selected, setSelected] = useState<string | null>(initialId ?? null);
  const [creating, setCreating] = useState(false);
  const [info, setInfo] = useState(false);
  const secure = useSecureChat();
  const secureState = useSecureSnapshot(secure);
  const [secureDialog, setSecureDialog] = useState<SecureMode | null>(null);

  const load = useCallback(() => {
    chatApi.internal(term.trim() || undefined).then(
      list => { setItems(list); setError(''); setLoading(false); },
      e => { setError(errorMessage(e)); setLoading(false); }
    );
  }, [term]);
  useEffect(() => { const t = setTimeout(load, term ? 250 : 0); return () => clearTimeout(t); }, [load, term]);
  useChatLive(load, active);

  // The thread tells us what changed (read position, preview); the list follows without another request.
  const patch = useCallback((c: ChatConversation) => {
    setItems(list => (list.some(x => x.id === c.id) ? list.map(x => (x.id === c.id ? { ...x, ...c } : x)) : list));
    onUnreadChange();
  }, [onUnreadChange]);

  const open = (c: ChatConversation) => {
    setItems(list => (list.some(x => x.id === c.id) ? list : [c, ...list]));
    setSelected(c.id); setCreating(false);
  };

  const current = items.find(c => c.id === selected) || null;
  const transport = useMemo(() => (selected ? staffTransport(selected) : null), [selected]);
  const lostSelected = Boolean(selected) && !loading && !current;

  const list = (
    <>
      {secure && (secureState.status === 'setup' || secureState.status === 'locked') && (
        <div className="ch-secure-bar warn" role="status" data-testid="secure-list-bar" data-state={secureState.status}>
          <span>{secureState.status === 'setup' ? 'Turn on secure messaging: your chats with colleagues are end-to-end encrypted.' : 'Secure messaging is locked on this device.'}</span>
          <button type="button" className="ch-link" onClick={() => setSecureDialog(secureState.status === 'setup' ? 'setup' : 'unlock')} data-testid="secure-list-action">{secureState.status === 'setup' ? 'Turn on' : 'Unlock'}</button>
        </div>
      )}
      <div className="ch-search">
        <input type="search" value={term} onChange={e => setTerm(e.target.value)} placeholder="Search chats" aria-label="Search chats" />
        <button type="button" className="ch-btn primary" onClick={() => setCreating(true)}><Plus size={14} aria-hidden /> New</button>
      </div>
      {error ? (
        <div className="ch-list-empty" role="alert"><p>{error}</p><button type="button" className="ch-btn" onClick={load}><RefreshCw size={13} aria-hidden /> Try again</button></div>
      ) : loading ? (
        <div className="ch-list-empty" role="status"><Loader2 className="ch-spin" size={18} aria-hidden /></div>
      ) : items.length === 0 ? (
        <div className="ch-list-empty"><p><b>{term ? 'No chats match' : 'No chats yet'}</b></p><p>{term ? 'Try another name.' : 'Start one with a colleague or create a group.'}</p></div>
      ) : (
        <ul className="ch-list" aria-label="Chats">
          {items.map(c => (
            <ConversationItem key={c.id} selected={c.id === selected} onClick={() => setSelected(c.id)}
              item={{ id: c.id, name: c.title || 'Chat', group: c.kind === 'GROUP', preview: previewOf(c), time: c.lastMessageAt, unread: c.unread }} />
          ))}
        </ul>
      )}
    </>
  );

  const header = (c: ChatConversation | null) => {
    const base = c || current;
    return (
      <div className="ch-head">
        <button type="button" className="ch-icon ch-back" onClick={() => setSelected(null)} aria-label="Back to chats">&larr;</button>
        <Avatar name={base?.title || '?'} group={base?.kind === 'GROUP'} />
        <div className="ch-head-main">
          <h2>{base?.title || 'Chat'}</h2>
          <p>{base?.kind === 'GROUP' ? `${base.members?.length ?? 0} people` : (base?.members || []).find(m => !m.me)?.position || 'Direct message'}</p>
        </div>
        {base?.kind === 'GROUP' && <button type="button" className="ch-icon" onClick={() => setInfo(true)} aria-label="Group details"><Info size={18} /></button>}
      </div>
    );
  };

  return (
    <>
      <Split
        open={Boolean(selected)}
        list={list}
        empty={<div><p><b>Select a chat</b></p><p>Pick a conversation on the left, or start a new one.</p></div>}
        detail={transport && !lostSelected ? (
          <ChatThread key={selected!} transport={transport} active={active} header={header} onConversation={patch} showNames={current?.kind === 'GROUP'}
            emptyTitle="No messages yet" emptyText={current?.kind === 'GROUP' ? 'Send the first message to the group.' : 'Say hello.'} />
        ) : (
          <div className="ch-pane-empty" style={{ flex: 1 }} role="alert"><div><p><b>This chat is not available</b></p><p>You may have been removed from it.</p><button type="button" className="ch-btn" onClick={() => setSelected(null)}>Back to chats</button></div></div>
        )}
      />
      {secureDialog && secure && <SecureSetupDialog client={secure} mode={secureDialog} onClose={() => setSecureDialog(null)} onSwitch={setSecureDialog} />}
      {creating && <NewChatDialog onClose={() => setCreating(false)} onOpened={open} />}
      {info && current && current.kind === 'GROUP' && (
        <GroupInfoDialog conversation={current} onClose={() => setInfo(false)}
          onChanged={c => { setItems(l => l.map(x => (x.id === c.id ? { ...x, ...c } : x))); }}
          onLeft={() => { setInfo(false); setSelected(null); setItems(l => l.filter(x => x.id !== current.id)); onUnreadChange(); }} />
      )}
    </>
  );
};
