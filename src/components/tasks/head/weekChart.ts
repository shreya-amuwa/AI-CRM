import { localDateKey } from '../../../lib/workTasks';

/** Monday-to-Sunday of the current week, as local date keys with a short weekday label. */
export function dayLabelsOfWeek(now: Date = new Date()): { key: string; label: string }[] {
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i);
    return { key: localDateKey(d), label: d.toLocaleDateString('en-IN', { weekday: 'short' }) };
  });
}
