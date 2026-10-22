import type { PerformanceMetrics, PerformanceNarrative } from '../../shared/contracts.js';

/**
 * The written analysis of a performance report, produced WITHOUT an AI service: plain rules over the figures the database calculated.
 * It is the fallback when no AI key is configured or the AI service fails, and it follows the same rule as the AI: every statement is
 * backed by a figure, and a figure the CRM could not work out reads "Insufficient data". It never judges people by hours worked
 * (the CRM holds no hours) and never invents a cause for a delay: it quotes what people wrote.
 */
export interface NarrativeSubject {
  name: string;
  role: string | null;
  scope: 'MEMBER' | 'TEAM' | 'DEPARTMENT';
}

export const INSUFFICIENT = 'Insufficient data';
const pct = (v: number | null | undefined) => (v === null || v === undefined ? INSUFFICIENT : `${v}%`);
const days = (v: number | null | undefined) => (v === null || v === undefined ? INSUFFICIENT : `${v} day${v === 1 ? '' : 's'}`);
const clip = (s: string, n = 160) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function ruleNarrative(subject: NarrativeSubject, m: PerformanceMetrics): PerformanceNarrative {
  const t = m.tasks;
  const who = subject.scope === 'MEMBER' ? subject.name : subject.scope === 'TEAM' ? `The ${subject.name} team` : `The ${subject.name} department`;
  const limitations = [...m.limitations];
  if (t.total === 0) {
    return {
      summary: `${who} has no tasks with a deadline (or assignment date) between ${m.periodStart} and ${m.periodEnd}, so no performance conclusion can be drawn. ${INSUFFICIENT}.`,
      observations: [],
      improvementAreas: [],
      recommendations: ['Assign tasks with deadlines so that completion and timeliness can be measured.'],
      limitations
    };
  }

  const observations: string[] = [];
  observations.push(`Completion: ${t.completed} of ${t.total} tasks completed (${pct(m.completionPct)}); ${t.pending} pending, ${t.overdue} overdue${t.blocked ? `, ${t.blocked} blocked` : ''}.`);
  if (m.timing.onTimePct === null) observations.push(`Timeliness: ${INSUFFICIENT}. No completed task has both a deadline and a completion time.`);
  else observations.push(`Timeliness: ${m.timing.onTime} completed on time and ${m.timing.late} late (${pct(m.timing.onTimePct)} on time).`);
  if (m.duration.comparedTasks > 0) {
    const diff = m.duration.avgDifferenceDays as number;
    observations.push(
      `Duration: on ${m.duration.comparedTasks} completed task(s) with a deadline, the work took ${days(m.duration.comparedActualDays)} on average against a planned window (assignment to deadline) of ${days(m.duration.comparedPlannedDays)}` +
        `${diff === 0 ? ', the same.' : diff > 0 ? `, ${days(diff)} longer than planned.` : `, ${days(-diff)} shorter than planned.`}`
    );
  } else observations.push(`Duration: expected versus actual duration, ${INSUFFICIENT}. It needs completed tasks that have a deadline and a completion time.`);
  const w = m.workload;
  observations.push(`Workload: ${w.byPriority.HIGH} high, ${w.byPriority.MEDIUM} medium and ${w.byPriority.LOW} low priority tasks; most tasks open at once: ${w.peakOpenTasks ?? INSUFFICIENT}.`);
  if (m.trend) observations.push(`Trend: the completion rate was ${pct(m.trend.recentRate)} in the week of ${m.trend.recentWeek} against ${pct(m.trend.previousRate)} the week of ${m.trend.previousWeek} (${m.trend.change >= 0 ? '+' : ''}${m.trend.change} points).`);
  else observations.push(`Trend: ${INSUFFICIENT}. It needs two weeks that each have tasks.`);
  observations.push(`Updates: ${m.activity.updates} progress update(s) recorded; ${m.activity.tasksWithoutUpdates} task(s) have none.`);
  if (m.delayReasons.length) {
    observations.push(`Reasons recorded for delays: ${m.delayReasons.slice(0, 3).map(r => `"${clip(r.note)}" (${clip(r.task, 60)})`).join('; ')}.`);
  } else if (t.overdue + m.timing.late + t.blocked > 0) {
    observations.push('No reason was recorded for the delayed or blocked work.');
  }

  const improvementAreas: string[] = [];
  const recommendations: string[] = [];
  const overdue = m.taskList.filter(x => x.overdue);
  if (t.overdue > 0) {
    improvementAreas.push(`${t.overdue} task(s) are past their deadline: ${overdue.slice(0, 3).map(x => `${clip(x.title, 50)} (${x.daysLate ?? 0} day(s) late)`).join(', ')}.`);
    recommendations.push('Review the overdue tasks together, agree a new date for each, and record the reason for the delay on the task.');
  }
  if (m.timing.late > 0) {
    improvementAreas.push(`${m.timing.late} completed task(s) were finished after their deadline.`);
    recommendations.push('Look at what the late tasks have in common (size, priority, waiting for someone) before changing how work is assigned.');
  }
  if (t.blocked > 0) {
    improvementAreas.push(`${t.blocked} task(s) are blocked.`);
    recommendations.push('Remove the blockers or reassign the blocked tasks.');
  }
  if (m.activity.tasksWithoutUpdates > 0 && m.activity.tasksWithoutUpdates >= Math.ceil(t.total / 2)) {
    improvementAreas.push(`${m.activity.tasksWithoutUpdates} of ${t.total} task(s) have no progress update, so the status history is thin.`);
    recommendations.push('Ask for a short progress update on every open task so that delays are visible earlier.');
  }
  if (m.limitations.some(l => /no deadline/.test(l))) recommendations.push('Give every task a deadline so that timeliness can be measured.');
  if (m.duration.comparedTasks === 0 && t.completed > 0) recommendations.push('Record a completion time and a deadline on completed tasks so that expected and actual duration can be compared.');
  if (w.peakOpenTasks !== null && w.peakOpenTasks >= 8) {
    improvementAreas.push(`The workload peaked at ${w.peakOpenTasks} open tasks at once.`);
    recommendations.push('Check whether the workload is spread fairly before judging the completion rate.');
  }
  if (improvementAreas.length === 0) improvementAreas.push('No area of concern is visible in the recorded task data for this period.');
  if (recommendations.length === 0) recommendations.push('Keep the current way of working and keep recording deadlines and updates.');

  const summary =
    `${who} had ${t.total} task(s) in the period ${m.periodStart} to ${m.periodEnd}: ${t.completed} completed (${pct(m.completionPct)}), ${t.pending} pending and ${t.overdue} overdue. ` +
    (m.timing.onTimePct === null ? `On-time completion: ${INSUFFICIENT}.` : `Of the completed tasks that can be judged, ${pct(m.timing.onTimePct)} were on time.`);
  return { summary, observations, improvementAreas, recommendations, limitations };
}
