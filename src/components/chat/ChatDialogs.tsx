import React, { useEffect, useState } from 'react';
import { Loader2, LogOut, Pencil, ShieldCheck, ShieldOff, UserMinus, UserPlus, X } from 'lucide-react';
import type { ChatConversation, ChatDirectoryPerson } from '../../../shared/contracts';
import { errorMessage } from '../../lib/api/client';
import { chatApi } from '../../lib/chat/api';
import { organizationApi } from '../../lib/api/endpoints';
import { Avatar, ChatModal } from './ChatBits';

/** People the person can chat with: name, role, department. Nothing confidential comes back from the server. */
function usePeople(term: string, enabled = true, department = '') {
  const [people, setPeople] = useState<ChatDirectoryPerson[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!enabled) return undefined;
    let live = true;
    setLoading(true);
    const t = setTimeout(() => {
      chatApi.directory(term.trim() || undefined, 30, department || undefined).then(
        p => { if (live) { setPeople(p); setError(''); setLoading(false); } },
        e => { if (live) { setError(errorMessage(e)); setLoading(false); } }
      );
    }, term ? 250 : 0);
    return () => { live = false; clearTimeout(t); };
  }, [term, enabled, department]);
  return { people, loading, error };
}

const PersonLine: React.FC<{ p: ChatDirectoryPerson }> = ({ p }) => (
  <span className="ch-person-main"><b>{p.name}</b><small>{[p.designation || p.position || p.label, p.department].filter(Boolean).join(' - ')}</small></span>
);

export const NewChatDialog: React.FC<{ onClose: () => void; onOpened: (c: ChatConversation) => void }> = ({ onClose, onOpened }) => {
  const [mode, setMode] = useState<'direct' | 'group'>('direct');
  const [term, setTerm] = useState('');
  const [title, setTitle] = useState('');
  const [picked, setPicked] = useState<ChatDirectoryPerson[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [department, setDepartment] = useState('');
  // the departments of the company, to narrow the list (the server filters; the list itself is only names)
  const [departments, setDepartments] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    let live = true;
    organizationApi.departments().then(d => { if (live) setDepartments(d.filter(x => !x.facetOf).map(x => ({ id: x.id, name: x.name })).sort((a, b) => a.name.localeCompare(b.name))); }, () => undefined);
    return () => { live = false; };
  }, []);
  const { people, loading, error: listError } = usePeople(term, true, department);

  const run = async (fn: () => Promise<ChatConversation>) => {
    setBusy(true); setError('');
    try { onOpened(await fn()); } catch (e) { setError(errorMessage(e)); setBusy(false); }
  };
  const toggle = (p: ChatDirectoryPerson) => setPicked(list => (list.some(x => x.id === p.id) ? list.filter(x => x.id !== p.id) : [...list, p]));

  return (
    <ChatModal
      title={mode === 'direct' ? 'New message' : 'New group'}
      onClose={onClose}
      footer={mode === 'group' ? (
        <>
          <button type="button" className="ch-btn" onClick={onClose}>Cancel</button>
          <button type="button" className="ch-btn primary" disabled={busy || !title.trim() || picked.length === 0} onClick={() => void run(() => chatApi.createGroup(title.trim(), picked.map(p => p.id)))}>
            {busy ? <Loader2 size={14} className="ch-spin" aria-hidden /> : null} Create group
          </button>
        </>
      ) : undefined}
    >
      <div className="ch-tabs" role="tablist" style={{ padding: 0, border: 0 }}>
        <button type="button" role="tab" className="ch-tab" aria-selected={mode === 'direct'} onClick={() => setMode('direct')}>One person</button>
        <button type="button" role="tab" className="ch-tab" aria-selected={mode === 'group'} onClick={() => setMode('group')}>Group</button>
      </div>
      {mode === 'group' && (
        <label className="ch-field">Group name
          <input value={title} maxLength={80} onChange={e => setTitle(e.target.value)} placeholder="For example: Delivery team" />
        </label>
      )}
      {picked.length > 0 && (
        <div className="ch-picked" aria-label="People in the group">
          {picked.map(p => <span key={p.id}>{p.name}<button type="button" className="ch-icon" style={{ width: 20, height: 20 }} onClick={() => toggle(p)} aria-label={`Remove ${p.name}`}><X size={12} /></button></span>)}
        </div>
      )}
      <label className="ch-field">Find a colleague
        <input value={term} onChange={e => setTerm(e.target.value)} placeholder="Search by name, designation or department" autoComplete="off" />
      </label>
      {departments.length > 0 && (
        <label className="ch-field">Department
          <select value={department} onChange={e => setDepartment(e.target.value)} data-testid="chat-department-filter">
            <option value="">All departments</option>
            {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </label>
      )}
      {(error || listError) && <p className="ch-error" role="alert">{error || listError}</p>}
      <div role="list" aria-label="Colleagues">
        {loading ? <p className="ch-note"><Loader2 size={14} className="ch-spin" aria-hidden /> Searching</p> : people.length === 0 ? <p className="ch-note">{department ? 'Nobody in this department matches.' : 'Nobody matches that name.'}</p> : people.map(p => {
          const on = picked.some(x => x.id === p.id);
          return (
            <button key={p.id} type="button" role="listitem" className="ch-person" disabled={busy} aria-pressed={mode === 'group' ? on : undefined}
              onClick={() => (mode === 'direct' ? void run(() => chatApi.openDirect(p.id)) : toggle(p))}>
              <Avatar name={p.name} /><PersonLine p={p} />
              {mode === 'group' && on ? <span className="ch-chip">Added</span> : null}
            </button>
          );
        })}
      </div>
      {mode === 'group' && <p className="ch-note">People you add can see messages sent after they join. You become the group admin.</p>}
    </ChatModal>
  );
};

type Confirm = { kind: 'remove'; id: string; name: string } | { kind: 'leave' } | null;

/** Group details: who is in it, and (for admins) rename, add, remove, make admin. Every change is checked again by the server. */
export const GroupInfoDialog: React.FC<{ conversation: ChatConversation; onClose: () => void; onChanged: (c: ChatConversation) => void; onLeft: () => void }> = ({ conversation, onClose, onChanged, onLeft }) => {
  const [c, setC] = useState(conversation);
  const [title, setTitle] = useState(conversation.title || '');
  const [renaming, setRenaming] = useState(false);
  const [adding, setAdding] = useState(false);
  const [term, setTerm] = useState('');
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const { people, loading } = usePeople(term, adding);
  useEffect(() => { setC(conversation); }, [conversation]);

  const members = c.members || [];
  const inGroup = new Set(members.map(m => m.id));

  const apply = async (fn: () => Promise<ChatConversation>, after?: () => void) => {
    setBusy(true); setError('');
    try { const next = await fn(); setC(next); onChanged(next); after?.(); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };

  return (
    <ChatModal title="Group details" onClose={onClose}>
      {error && <p className="ch-error" role="alert">{error}</p>}
      <div>
        {renaming ? (
          <form className="ch-search" style={{ padding: 0 }} onSubmit={e => { e.preventDefault(); void apply(() => chatApi.renameGroup(c.id, title.trim()), () => setRenaming(false)); }}>
            <input value={title} maxLength={80} onChange={e => setTitle(e.target.value)} aria-label="Group name" />
            <button type="submit" className="ch-btn primary" disabled={busy || !title.trim()}>Save</button>
            <button type="button" className="ch-btn" onClick={() => { setRenaming(false); setTitle(c.title || ''); }}>Cancel</button>
          </form>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <h3 style={{ margin: 0, fontSize: 17, fontWeight: 800, flex: 1 }}>{c.title}</h3>
            {c.isAdmin && <button type="button" className="ch-btn" onClick={() => setRenaming(true)}><Pencil size={13} aria-hidden /> Rename</button>}
          </div>
        )}
        <p className="ch-note">{members.length} {members.length === 1 ? 'person' : 'people'}</p>
      </div>

      <p className="ch-section-title">Members</p>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {members.map(m => (
          <li key={m.id} className="ch-person">
            <Avatar name={m.name} />
            <span className="ch-person-main"><b>{m.name}{m.me ? ' (you)' : ''}</b><small>{[m.position || m.label, m.department].filter(Boolean).join(' - ')}</small></span>
            {m.role === 'ADMIN' ? <span className="ch-chip">Admin</span> : null}
            {c.isAdmin && !m.me && (
              <>
                <button type="button" className="ch-icon" disabled={busy} title={m.role === 'ADMIN' ? 'Remove admin rights' : 'Make admin'} aria-label={m.role === 'ADMIN' ? `Remove admin rights from ${m.name}` : `Make ${m.name} an admin`}
                  onClick={() => void apply(() => chatApi.setAdmin(c.id, m.id, m.role !== 'ADMIN'))}>
                  {m.role === 'ADMIN' ? <ShieldOff size={16} /> : <ShieldCheck size={16} />}
                </button>
                <button type="button" className="ch-icon" disabled={busy} title="Remove from group" aria-label={`Remove ${m.name} from the group`} onClick={() => setConfirm({ kind: 'remove', id: m.id, name: m.name })}><UserMinus size={16} /></button>
              </>
            )}
          </li>
        ))}
      </ul>

      {confirm && (
        <div role="alertdialog" aria-label="Confirm" className="ch-replying" style={{ borderLeftColor: 'var(--ch-danger)', flexWrap: 'wrap' }}>
          <span style={{ flexBasis: '100%', whiteSpace: 'normal' }}>
            {confirm.kind === 'leave'
              ? 'Leave this group? You will stop receiving its messages and cannot read it again unless an admin adds you back.'
              : `Remove ${confirm.name} from the group? They will lose access to it.`}
          </span>
          <button type="button" className="ch-btn" onClick={() => setConfirm(null)}>Cancel</button>
          <button type="button" className="ch-btn danger" disabled={busy} onClick={() => {
            const act = confirm;
            if (act.kind === 'leave') {
              setBusy(true); setError('');
              chatApi.leave(c.id).then(onLeft, e => { setError(errorMessage(e)); setBusy(false); setConfirm(null); });
            } else {
              setConfirm(null);
              void apply(() => chatApi.removeMember(c.id, act.id));
            }
          }}>{confirm.kind === 'leave' ? 'Leave group' : 'Remove'}</button>
        </div>
      )}

      {c.isAdmin && (
        <>
          <p className="ch-section-title">Add people</p>
          {!adding ? (
            <button type="button" className="ch-btn" onClick={() => setAdding(true)}><UserPlus size={14} aria-hidden /> Add people</button>
          ) : (
            <>
              <input className="ch-search-input" style={{ font: 'inherit', padding: '8px 12px', borderRadius: 10, border: '1px solid var(--ch-border)' }} value={term} onChange={e => setTerm(e.target.value)} placeholder="Search by name" aria-label="Find a colleague" />
              <div role="list" aria-label="Colleagues">
                {loading ? <p className="ch-note">Searching</p> : people.filter(p => !inGroup.has(p.id)).map(p => (
                  <button key={p.id} type="button" role="listitem" className="ch-person" disabled={busy} onClick={() => void apply(() => chatApi.addMembers(c.id, [p.id]))}>
                    <Avatar name={p.name} /><PersonLine p={p} /><UserPlus size={15} aria-hidden />
                  </button>
                ))}
              </div>
              <button type="button" className="ch-btn ghost" onClick={() => { setAdding(false); setTerm(''); }}>Done</button>
            </>
          )}
        </>
      )}

      <hr style={{ border: 0, borderTop: '1px solid var(--ch-border)', margin: '6px 0' }} />
      <button type="button" className="ch-btn danger" disabled={busy} onClick={() => setConfirm({ kind: 'leave' })} style={{ alignSelf: 'flex-start' }}>
        <LogOut size={14} aria-hidden /> Leave group
      </button>
    </ChatModal>
  );
};
