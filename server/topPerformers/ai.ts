import type { AiSettings } from '../performance/ai.js';
import { evaluationSchema, type EvaluationInput, type EvaluationNarrative } from './narrative.js';

/**
 * The AI evaluation of one ranked person. It uses the same switch as the performance reports: OFF until ANTHROPIC_API_KEY is set on the server.
 * What is sent: the figures of ONE person for ONE month (counts, percentages, the measures with their weights), the department average of the
 * same role, and the Team Lead's / Department Head's written review comments on the reports (shortened). No name, e-mail, phone or customer data.
 */
const SYSTEM = `You write the evaluation part of an employee's monthly performance card in a CRM.
Rules:
- Use ONLY the figures in the JSON the user sends. Never invent a number, a cause, a task or a person.
- A measure whose value is null has no data: say so, do not estimate it. Reports that are pending, rejected or sent back are NOT counted: say that when it matters.
- Never mention or guess a rank position (1st, 2nd, top 3 ...): ranks change. Explain the result by comparing the measures with the department average and with last month's score.
- Judge delivery against deadlines, priority-weighted completion, report approval and the reviewer's written feedback. Do not speculate about motives, skills, personality or hours worked.
- Tasks are weighted by priority, duplicates count once, instantly ticked tasks are not credited and blocked tasks are not penalised: do not argue with these rules.
- Be specific and brief. Answer with ONE JSON object and nothing else, with exactly these keys: summary (string), strengths (array of strings), improvementAreas (array of strings), whyRanked (string explaining why the score is what it is).`;

export function evaluationAiInput(i: EvaluationInput) {
  return {
    role: i.roleKind === 'TEAM_LEAD' ? 'Team Lead' : i.designation,
    month: i.month,
    status: i.status,
    score: i.score,
    previousMonthScore: i.previousScore,
    departmentAverageScore: i.department?.avgScore ?? null,
    rankedInDepartment: i.department?.ranked ?? null,
    measures: i.components.map(c => ({ measure: c.label, weight: c.weight, value: c.value, detail: c.detail })),
    tasks: i.metrics.tasks,
    reports: i.metrics.reports,
    team: i.metrics.team,
    productivityPct: i.metrics.productivityPct,
    reviewerFeedbackOnReports: i.feedback.map(f => f.slice(0, 200))
  };
}

export function parseEvaluation(raw: string): EvaluationNarrative {
  const body = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('The AI answer was not a JSON object.');
  return evaluationSchema.parse(JSON.parse(body.slice(start, end + 1)));
}

export type EvaluationAiResult = { ok: true; narrative: EvaluationNarrative; model: string } | { ok: false; error: string };

export async function evaluateWithAi(settings: AiSettings, i: EvaluationInput): Promise<EvaluationAiResult> {
  if (!settings.apiKey) return { ok: false, error: 'AI is not configured.' };
  try {
    const res = await fetch(`${settings.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': settings.apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: settings.model, max_tokens: 1200, system: SYSTEM, messages: [{ role: 'user', content: JSON.stringify(evaluationAiInput(i)) }] }),
      signal: AbortSignal.timeout(settings.timeoutMs)
    });
    if (!res.ok) return { ok: false, error: `The AI service answered HTTP ${res.status}.` };
    const body = (await res.json()) as { content?: { type: string; text?: string }[] };
    const raw = (body.content || []).filter(c => c.type === 'text').map(c => c.text || '').join('');
    return { ok: true, narrative: parseEvaluation(raw), model: settings.model };
  } catch (err) {
    if (err instanceof Error && err.name === 'TimeoutError') return { ok: false, error: 'The AI service did not answer in time.' };
    if (err instanceof SyntaxError || (err as { name?: string })?.name === 'ZodError') return { ok: false, error: 'The AI answer could not be read.' };
    return { ok: false, error: err instanceof Error && /JSON/.test(err.message) ? 'The AI answer could not be read.' : 'The AI service could not be reached.' };
  }
}
