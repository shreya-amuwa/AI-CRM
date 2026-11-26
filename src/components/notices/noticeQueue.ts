import type { CompanyNotice, NoticePriority } from '../../../shared/contracts';

/**
 * The popup queue of company notices (20270202000100). The database already returns the notices an employee has not acknowledged, in this order: Urgent first,
 * then Important, then Normal, the oldest first inside a priority. This keeps the screen to the same rule when a notice arrives while the CRM is open.
 */
const RANK: Record<NoticePriority, number> = { URGENT: 0, IMPORTANT: 1, NORMAL: 2 };

export const sortQueue = (items: CompanyNotice[]): CompanyNotice[] =>
  [...items].sort((a, b) => RANK[a.priority] - RANK[b.priority] || a.publishAt.localeCompare(b.publishAt) || a.id.localeCompare(b.id));

/** An Urgent notice cannot be put off: it stays until it is acknowledged. Normal and Important ones may be left for later (they return the next time the CRM opens). */
export const canPostpone = (n: Pick<CompanyNotice, 'priority'>) => n.priority !== 'URGENT';

/** What still has to be shown: the pending notices minus the ones put off in this session. */
export const visibleQueue = (pending: CompanyNotice[], postponed: ReadonlySet<string>): CompanyNotice[] =>
  sortQueue(pending).filter(n => !postponed.has(n.id) || n.priority === 'URGENT');

/** The index to show after the list changed (a notice was acknowledged, or a new one arrived): stay on the same notice when it is still there. */
export const indexAfterChange = (before: CompanyNotice[], index: number, after: CompanyNotice[]): number => {
  const id = before[index]?.id;
  const same = id ? after.findIndex(n => n.id === id) : -1;
  if (same >= 0) return same;
  return Math.min(Math.max(index, 0), Math.max(after.length - 1, 0));
};
