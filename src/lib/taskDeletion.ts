import { confirmAction } from './feedback/feedbackStore';

/**
 * The one confirmation used before an assigned task is deleted (Task module, AI Studio, AI Design Studio). It names the task, says who it is with
 * and what goes with it, and runs the delete inside the dialog: the dialog shows "working…" once and keeps the server's message if the delete is
 * refused. The Delete button is shown only when the database said the person may delete the task; the delete itself is checked again there.
 */
export interface TaskDeletionPrompt {
  /** "task" or "assignment" (AI Design Studio's word) */
  noun?: 'task' | 'assignment';
  title: string;
  assigneeName?: string | null;
  status?: string | null;
  dueDate?: string | null;
  /** what is removed with it ("2 sub-tasks", "5 progress updates"); empty lines are dropped */
  alsoRemoved?: (string | null | false | undefined)[];
  run: () => Promise<unknown>;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
export const countLine = (n: number | null | undefined, one: string, many?: string) => (n && n > 0 ? plural(n, one, many) : null);

// a raw status (IN_PROGRESS) reads as "In progress"; a screen's own label ("Pending") is kept as it is
const readable = (s: string) => (/^[A-Z_]+$/.test(s) ? s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ') : s);

export function confirmTaskDeletion(p: TaskDeletionPrompt): Promise<boolean> {
  const noun = p.noun ?? 'task';
  const removed = (p.alsoRemoved ?? []).filter((x): x is string => !!x);
  const details = [
    `${noun === 'task' ? 'Task' : 'Assignment'}: ${p.title}`,
    p.assigneeName ? `Assigned to: ${p.assigneeName}` : null,
    p.status ? `Status: ${readable(p.status)}` : null,
    p.dueDate ? `Due: ${p.dueDate}` : null,
    removed.length ? `Also removed: ${removed.join(', ')}` : null
  ].filter((x): x is string => !!x);
  return confirmAction({
    title: `Delete this ${noun}?`,
    description: `The ${noun} is removed for the person it was assigned to and for everyone else, and they are told it was deleted. This cannot be undone.`,
    details,
    confirmLabel: `Delete ${noun}`,
    cancelLabel: `Keep ${noun}`,
    variant: 'destructive',
    onConfirm: p.run
  });
}
