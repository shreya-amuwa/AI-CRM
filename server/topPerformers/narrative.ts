import { z } from 'zod';
import type { PerformerComponent, PerformerMetrics } from '../../shared/contracts.js';

/**
 * The written evaluation of one ranked person. The AI writes it when ANTHROPIC_API_KEY is set (ai.ts); otherwise, or when the AI fails, these
 * rules write it from the same figures. Never a number that is not in the figures; never a rank position (ranks move while the figures do not).
 */
export interface EvaluationInput {
  scoreId: string;
  fingerprint: string;
  roleKind: 'MEMBER' | 'TEAM_LEAD';
  status: string;
  month: string;
  designation: string;
  score: number | null;
  previousScore: number | null;
  components: PerformerComponent[];
  metrics: PerformerMetrics;
  reasons: string[];
  department: { avgScore: number | null; ranked: number } | null;
  feedback: string[];
}

const text = (max: number) => z.string().trim().min(1).max(max);
export const evaluationSchema = z.object({
  summary: text(1000),
  strengths: z.array(text(400)).max(6),
  improvementAreas: z.array(text(400)).max(6),
  whyRanked: text(800)
});
export type EvaluationNarrative = z.infer<typeof evaluationSchema>;

const one = (n: number | null) => (n === null ? 'no data' : `${Math.round(n * 10) / 10}`);
const monthName = (m: string) => new Date(`${m}T00:00:00Z`).toLocaleString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });

export function ruleEvaluation(i: EvaluationInput): EvaluationNarrative {
  const withData = i.components.filter(c => c.value !== null);
  const strong = withData.filter(c => (c.value as number) >= 85).sort((a, b) => (b.value as number) - (a.value as number));
  const weak = withData.filter(c => (c.value as number) < 60).sort((a, b) => (a.value as number) - (b.value as number));
  const t = i.metrics.tasks;
  const r = i.metrics.reports;
  const dept = i.department?.avgScore ?? null;
  const diff = i.score !== null && dept !== null ? Math.round((i.score - dept) * 10) / 10 : null;
  const trend = i.score !== null && i.previousScore !== null ? Math.round((i.score - i.previousScore) * 10) / 10 : null;

  const summary =
    i.score === null
      ? `Not enough data to score ${monthName(i.month)}.`
      : `Overall score ${one(i.score)} for ${monthName(i.month)}` +
        (diff === null ? '.' : diff === 0 ? ', the same as the department average.' : `, ${Math.abs(diff)} points ${diff > 0 ? 'above' : 'below'} the department average (${one(dept)}).`) +
        (i.roleKind === 'MEMBER'
          ? ` ${t.judgedDone} of ${t.judged} judged tasks were completed (${t.onTime} on time, ${t.late} late); ${r.approved} approved report(s) covered ${one(r.coveragePct)}% of the working days.`
          : ` The team completed ${i.metrics.team?.judgedDone ?? 0} of ${i.metrics.team?.judged ?? 0} judged tasks; ${i.metrics.team?.reviewsTimely ?? 0} team report(s) were reviewed within 48 hours and ${i.metrics.team?.reviewsLate ?? 0} later or not yet.`);

  const strengths = strong.slice(0, 4).map(c => `${c.label}: ${one(c.value)}% (${c.detail}).`);
  const improvementAreas = weak.slice(0, 4).map(c => `${c.label}: ${one(c.value)}% (${c.detail}).`);
  if (r.pending > 0) improvementAreas.push(`${r.pending} report(s) were still waiting for approval and are not counted yet.`);
  if (r.rejected + r.revision > 0) improvementAreas.push(`${r.rejected + r.revision} report(s) were rejected or sent back for revision.`);
  if (t.excluded.duplicates > 0) improvementAreas.push(`${t.excluded.duplicates} duplicate task entr${t.excluded.duplicates === 1 ? 'y was' : 'ies were'} counted once.`);

  const best = strong[0];
  const worst = weak[0];
  const whyRanked = [
    best ? `The strongest measure was ${best.label.toLowerCase()} (${one(best.value)}%).` : 'No measure stood out above 85%.',
    worst ? `The weakest was ${worst.label.toLowerCase()} (${one(worst.value)}%).` : 'No measure fell below 60%.',
    trend === null ? 'There is no earlier month to compare with.' : trend === 0 ? 'The score is unchanged from last month.' : `The score is ${Math.abs(trend)} points ${trend > 0 ? 'higher' : 'lower'} than last month.`,
    ...(i.feedback.length ? [`Reviewer feedback on the reports: ${i.feedback.slice(0, 2).join(' | ')}`] : [])
  ].join(' ');
  return { summary, strengths, improvementAreas, whyRanked };
}
