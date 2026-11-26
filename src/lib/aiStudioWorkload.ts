import type { AiStudioAssignee } from '../../shared/contracts';

/**
 * AI Studio cross-team assignment (20270218000100): when a person's open work is heavy (several open tasks, two or more urgent ones, or anything
 * overdue) the assign form warns before the task is given. It never blocks: there is no organizational limit on assignments.
 */
export function workloadWarning(p: Pick<AiStudioAssignee, 'workload'>): string | null {
  const w = p.workload;
  if (w.active >= 4 || w.highPriority >= 2 || w.overdue > 0) {
    const extra = [w.highPriority ? `${w.highPriority} high-priority` : '', w.overdue ? `${w.overdue} overdue` : ''].filter(Boolean).join(' and ');
    return `This employee currently has ${w.active} active task${w.active === 1 ? '' : 's'}${extra ? `, including ${extra}` : ''}. Please coordinate the workload before assigning additional work.`;
  }
  return null;
}

/** Hours and minutes typed in a daily report entry, as minutes (null when neither was entered). */
export function entryMinutes(hours: string, minutes: string): number | null {
  if (hours.trim() === '' && minutes.trim() === '') return null;
  const h = hours.trim() === '' ? 0 : Number(hours);
  const m = minutes.trim() === '' ? 0 : Number(minutes);
  return Number.isFinite(h) && Number.isFinite(m) ? Math.round(h * 60 + m) : null;
}
