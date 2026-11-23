import React, { useEffect, useRef } from 'react';
import { Users, X } from 'lucide-react';
import type { ChatConversation } from '../../../shared/contracts';
import { listTime } from './ChatThread';
import './chat.css';

export const initialsOf = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase()).join('') || '?';

export const Avatar: React.FC<{ name: string; group?: boolean }> = ({ name, group }) => (
  <span className={`ch-avatar ${group ? 'group' : ''}`} aria-hidden>{group ? <Users size={18} /> : initialsOf(name)}</span>
);

export interface ItemData {
  id: string;
  name: string;
  group?: boolean;
  preview: string;
  time: string | null;
  unread: number;
  sub?: string;
  /** An extra line under the preview (the shared Support desk: Relationship Manager, who is handling it, awaiting reply). */
  meta?: string;
}

export const ConversationItem: React.FC<{ item: ItemData; selected: boolean; onClick: () => void }> = ({ item, selected, onClick }) => (
  <li>
    <button type="button" className={`ch-item ${item.unread > 0 ? 'unread' : ''}`} aria-current={selected} onClick={onClick}>
      <Avatar name={item.name} group={item.group} />
      <span className="ch-item-main">
        <span className="ch-item-top"><b>{item.name}</b><time>{listTime(item.time)}</time></span>
        <span className="ch-item-bottom">
          <span>{item.preview || item.sub || 'No messages yet'}</span>
          {item.unread > 0 ? <span className="ch-count" aria-label={`${item.unread} unread`} style={{ flex: 'none' }}>{item.unread > 99 ? '99+' : item.unread}</span> : null}
        </span>
        {item.meta ? <span className="ch-item-bottom" data-testid="item-meta" style={{ fontSize: 11, opacity: 0.8 }}><span>{item.meta}</span></span> : null}
      </span>
    </button>
  </li>
);

/** The line shown under a conversation in the list. */
export const previewOf = (c: ChatConversation): string => {
  if (!c.lastMessagePreview) return '';
  return c.kind === 'GROUP' && c.lastSenderName ? `${c.lastSenderName}: ${c.lastMessagePreview}` : c.lastMessagePreview;
};

/** List on the left, conversation on the right; on a phone one at a time. */
export const Split: React.FC<{ open: boolean; list: React.ReactNode; detail: React.ReactNode; empty: React.ReactNode }> = ({ open, list, detail, empty }) => (
  <div className="ch-split" data-open={open}>
    <div className="ch-list-panel">{list}</div>
    <div className="ch-detail">{open ? detail : <div className="ch-pane-empty" style={{ flex: 1 }}>{empty}</div>}</div>
  </div>
);

export const ChatModal: React.FC<{ title: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode }> = ({ title, onClose, children, footer }) => {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('input,button,textarea')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
    };
    document.addEventListener('keydown', onKey, true);
    return () => { document.removeEventListener('keydown', onKey, true); prev?.focus?.(); };
  }, [onClose]);
  return (
    <div className="ch-modal-wrap" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="ch-modal" role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <header><h2>{title}</h2><button type="button" className="ch-icon" onClick={onClose} aria-label="Close"><X size={18} /></button></header>
        <div className="ch-modal-body">{children}</div>
        {footer ? <footer>{footer}</footer> : null}
      </div>
    </div>
  );
};
