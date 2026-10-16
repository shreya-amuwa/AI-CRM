/**
 * Display helpers shared by the staff and the client ticket screens.
 * The stored ticket number (TKT-000042) never changes; screens show it as #AMW-0042.
 */
export const displayTicketNo = (ticketNo: string): string => {
  const digits = /(\d+)\s*$/.exec(ticketNo)?.[1];
  return digits ? `#AMW-${String(Number(digits)).padStart(4, '0')}` : ticketNo;
};

/** Everything a search box should match for a ticket number (stored form, display form, bare digits). */
export const ticketNoSearchText = (ticketNo: string): string => {
  const digits = /(\d+)\s*$/.exec(ticketNo)?.[1];
  return `${ticketNo} ${displayTicketNo(ticketNo)} ${digits ? String(Number(digits)) : ''}`.toLowerCase();
};

/** "just now", "5m ago", "5h ago", "1d ago", then the date. */
export function ago(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '';
  const diff = Math.max(0, now - new Date(iso).getTime());
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: d > 300 ? 'numeric' : undefined });
}

export const initialsOf = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(w => w[0]?.toUpperCase())
    .join('') || '?';

/** A random id for a message, so a retry or a double click is stored once. */
export const newMessageKey = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = (Math.random() * 16) | 0;
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
      });
