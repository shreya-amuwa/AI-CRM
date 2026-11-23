import type { ChatDeskClient, ChatHandler } from '../../../shared/contracts';

/** What the shared Support desk list can be narrowed to (the filtering itself is only a view: the database already decided what this person may see). */
export type DeskFilter = 'ALL' | 'UNREAD' | 'AWAITING' | 'HANDLING' | 'MINE';

export const DESK_FILTERS: { id: DeskFilter; label: string }[] = [
  { id: 'ALL', label: 'All' },
  { id: 'UNREAD', label: 'Unread' },
  { id: 'AWAITING', label: 'Awaiting reply' },
  { id: 'HANDLING', label: 'Being handled' },
  { id: 'MINE', label: 'Mine' }
];

/** Whether a client is one of this person's own (they are its Relationship Manager or Team Lead) rather than only reachable through the shared desk. */
export const isMineOnDesk = (c: ChatDeskClient): boolean => c.role === 'Relationship Manager' || c.role === 'Team Lead';

export function filterDesk(items: ChatDeskClient[], filter: DeskFilter): ChatDeskClient[] {
  switch (filter) {
    case 'UNREAD': return items.filter(c => c.unread > 0);
    case 'AWAITING': return items.filter(c => c.awaitingReply);
    case 'HANDLING': return items.filter(c => c.handler?.active);
    case 'MINE': return items.filter(isMineOnDesk);
    default: return items;
  }
}

/** "Support B" / "you" for the person currently handling; "" when nobody is (or the hold has lapsed, which is only shown as the last responder). */
export const handlerName = (h: ChatHandler | null | undefined): string => (h?.active ? (h.me ? 'you' : h.name) : '');

/** The second line of a desk row: the customer, the Relationship Manager, who is handling it and whether the client is waiting. */
export function deskSub(c: ChatDeskClient): string {
  const parts = [c.name, `RM: ${c.rm?.name ?? 'not assigned'}`];
  const h = handlerName(c.handler);
  if (h) parts.push(`Handling: ${h}`);
  else if (c.lastSenderName && !c.awaitingReply) parts.push(`Last reply: ${c.lastSenderName}`);
  if (c.awaitingReply) parts.push('Awaiting reply');
  return parts.join(' - ');
}
