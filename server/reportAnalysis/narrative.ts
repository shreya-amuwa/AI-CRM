import { z } from 'zod';
import type { AnalysisFact, AnalysisFacts, AnalysisNarrative } from '../../shared/contracts.js';

/**
 * The written analysis for the Super Admin. It is built ONLY from the measurable facts the database returned (each fact names its person /
 * team / department, the numbers and the records it comes from). It never states a reason for a result, never invents an activity, and every
 * item points at the facts it is based on (factIds), so it can be traced back. It is kept apart from the reports and from the HR ratings and
 * changes neither.
 */
const text = (max: number) => z.string().trim().min(1).max(max);
export const analysisSchema = z.object({
  summary: text(1500),
  sections: z.array(z.object({
    key: z.string().trim().min(1).max(60),
    title: text(120),
    items: z.array(z.object({ text: text(500), factIds: z.array(z.string().trim().min(1).max(60)).min(1).max(10) })).max(15)
  })).max(10),
  limitations: z.array(text(500)).max(8)
});

export const SECTIONS: { key: keyof AnalysisFacts; title: string }[] = [
  { key: 'strongCompletion', title: 'Consistently strong task completion' },
  { key: 'lowCompletion', title: 'Low task completion rates' },
  { key: 'missingReports', title: 'Incomplete or missing reports' },
  { key: 'repeatedRevisions', title: 'Repeated revision requests' },
  { key: 'wellPerformingTeams', title: 'Teams performing consistently well' },
  { key: 'departmentDelays', title: 'Departments with reporting delays' },
  { key: 'taskGaps', title: 'Assigned versus completed tasks' },
  { key: 'performanceChanges', title: 'Changes across reporting periods' }
];

export const FIXED_LIMITATIONS = [
  'Only recorded data is used: task records, submitted reports, approvals and submitted HR reviews. No reason is assumed for any result.',
  'Approved full-day leave is not counted as a missing report, and people with too little data in the period are not ranked or judged.',
  'HR ratings are shown as given by HR and are not changed by this analysis.'
];

const pct = (v: unknown) => (typeof v === 'number' ? `${v}%` : 'no value');
const num = (v: unknown) => (typeof v === 'number' ? String(v) : '0');

/** One sentence per fact, from its own numbers. */
export function factSentence(key: keyof AnalysisFacts, f: AnalysisFact): string {
  switch (key) {
    case 'strongCompletion': return `completed ${num(f.completed)} of ${num(f.tasks)} tasks (${pct(f.completionRate)}), with at least 85% in every week that had tasks`;
    case 'lowCompletion': return `completed ${num(f.completed)} of ${num(f.tasks)} assigned tasks (${pct(f.completionRate)})`;
    case 'missingReports': return `submitted ${num(f.submitted)} of ${num(f.expected)} expected daily reports (${pct(f.compliance)}); leave days are not counted`;
    case 'repeatedRevisions': return `${num(f.revisionRequests)} revision requests on ${num(f.reportsSubmitted)} submitted reports, in ${num(f.weeksWithRevision)} of the last 4 weeks`;
    case 'wellPerformingTeams': return `team score ${num(f.score)} now and ${num(f.previousScore)} in the previous period, task completion ${pct(f.completionRate)}`;
    case 'taskGaps': return `${num(f.completed)} of ${num(f.assigned)} assigned tasks completed (${pct(f.completionRate)}), a gap of ${num(f.gap)}`;
    case 'performanceChanges': return `score moved from ${num(f.previousScore)} to ${num(f.score)} (${(f.change as number) > 0 ? '+' : ''}${num(f.change)}), ${String(f.direction).toLowerCase()}`;
    case 'departmentDelays':
      return f.submittedAt ? `weekly report for ${String(f.weekStart)} was submitted ${num(f.daysLate)} days after the week ended` : `no weekly report was submitted for the week of ${String(f.weekStart)} (status ${String(f.status).replace(/_/g, ' ').toLowerCase()})`;
    default: return '';
  }
}

/** The analysis written by rules from the same facts (used when no AI key is configured or the AI fails). */
export function ruleNarrative(facts: AnalysisFacts): AnalysisNarrative {
  const sections = SECTIONS.map(s => ({
    key: s.key as string,
    title: s.title,
    items: ((facts[s.key] as AnalysisFact[]) ?? []).map(f => ({ text: `${f.name}${f.department && f.subjectType !== 'DEPARTMENT' ? ` (${f.department})` : ''}: ${factSentence(s.key, f)}.`, factIds: [f.factId] }))
  })).filter(s => s.items.length > 0);
  const c = facts.counts;
  const summary = [
    `Period ${facts.period.from} to ${facts.period.to}: ${c.people} people, ${c.ranked} with enough data to be scored and ${c.insufficient} with insufficient data (not judged).`,
    sections.length === 0 ? 'No finding crossed the thresholds in this period.' : `Findings: ${sections.map(s => `${s.title.toLowerCase()} (${s.items.length})`).join('; ')}.`
  ].join(' ');
  return { summary, sections, limitations: [...FIXED_LIMITATIONS] };
}

/**
 * Checks an AI answer against the facts: every item must cite only facts that exist, so nothing untraceable is kept. Items without a valid
 * fact are dropped; the fixed limitations are always added.
 */
export function validateNarrative(raw: unknown, facts: AnalysisFacts): AnalysisNarrative {
  const parsed = analysisSchema.parse(raw);
  const known = new Set<string>();
  for (const s of SECTIONS) for (const f of (facts[s.key] as AnalysisFact[]) ?? []) known.add(f.factId);
  const sections = parsed.sections
    .map(s => ({ ...s, items: s.items.map(i => ({ ...i, factIds: i.factIds.filter(id => known.has(id)) })).filter(i => i.factIds.length > 0) }))
    .filter(s => s.items.length > 0);
  return { summary: parsed.summary, sections, limitations: [...new Set([...parsed.limitations, ...FIXED_LIMITATIONS])].slice(0, 8) };
}
