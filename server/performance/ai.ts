import { z } from 'zod';
import type { PerformanceMetrics, PerformanceNarrative } from '../../shared/contracts.js';
import type { NarrativeSubject } from './narrative.js';

/**
 * The AI analysis of a performance report. The project had no AI service before this: it is OFF until ANTHROPIC_API_KEY is set on the
 * server (Vercel / the API's environment; never in the browser or the database). Without it, reports are written by rules
 * (narrative.ts) and say so.
 *
 * What is sent to the AI service: the figures of ONE report (counts, percentages, dates) and, for the delayed or open work, the task
 * titles and the reasons people wrote (shortened). No e-mail addresses, phone numbers or customer details. The model is told to use
 * only these figures, to write "Insufficient data" for a missing one, and never to treat longer hours as better performance.
 */
export interface AiSettings {
  apiKey: string | null;
  model: string;
  baseUrl: string;
  timeoutMs: number;
}

export function aiSettings(env: NodeJS.ProcessEnv = process.env): AiSettings {
  return {
    apiKey: env.ANTHROPIC_API_KEY?.trim() || null,
    model: env.PERFORMANCE_AI_MODEL?.trim() || 'claude-sonnet-5-5',
    baseUrl: (env.ANTHROPIC_API_BASE_URL?.trim() || 'https://api.anthropic.com').replace(/\/+$/, ''),
    timeoutMs: Math.max(5_000, Number(env.PERFORMANCE_AI_TIMEOUT_MS) || 40_000)
  };
}

const text = (max: number) => z.string().trim().min(1).max(max);
export const narrativeSchema = z.object({
  summary: text(1200),
  observations: z.array(text(600)).max(10),
  improvementAreas: z.array(text(600)).max(8),
  recommendations: z.array(text(600)).max(8),
  limitations: z.array(text(600)).max(8)
});

const SYSTEM = `You write the analysis part of an employee performance report for a CRM.
Rules:
- Use ONLY the figures in the JSON the user sends. Never invent a number, a cause, a task or a person.
- If a figure is null or missing, write "Insufficient data" for it. Do not estimate it.
- The CRM has no working-hours data. Never treat longer hours as better performance and never mention hours.
- Judge delivery against deadlines, workload (open tasks, priorities), the status history and the reasons people wrote. Do not speculate about motives, skills or personality.
- Where a delay has a recorded reason, quote it; where none is recorded, say none was recorded.
- Be specific and brief. Recommendations must be practical next steps for the manager and tied to a figure.
- Answer with ONE JSON object and nothing else, with exactly these keys: summary (string), observations (array of strings), improvementAreas (array of strings), recommendations (array of strings), limitations (array of strings). Repeat the report's limitations in "limitations".`;

/** The part of the figures the model gets: summary numbers, the weekly series, and a short list of the tasks that were late / open. */
export function aiInput(subject: NarrativeSubject, periodKind: string, m: PerformanceMetrics) {
  const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
  return {
    report: { about: subject.name, type: subject.scope === 'MEMBER' ? subject.role ?? 'Employee' : subject.scope === 'TEAM' ? 'Team' : 'Department', period: `${m.periodStart} to ${m.periodEnd}`, periodKind },
    tasks: m.tasks,
    completionPct: m.completionPct,
    timing: m.timing,
    duration: m.duration,
    activity: m.activity,
    workload: m.workload,
    trend: m.trend,
    weekly: m.weekly,
    tasksToDiscuss: m.taskList
      .filter(t => t.overdue || t.onTime === false || t.status === 'BLOCKED' || t.status === 'NOT_COMPLETED')
      .slice(0, 12)
      .map(t => ({ title: clip(t.title, 80), priority: t.priority, status: t.status, dueDate: t.dueDate, daysLate: t.daysLate, daysToComplete: t.daysToComplete, plannedDays: t.plannedDays })),
    recordedDelayReasons: m.delayReasons.slice(0, 6).map(r => ({ task: clip(r.task, 60), status: r.status, note: clip(r.note, 200) })),
    limitations: m.limitations
  };
}

/** Pulls the JSON object out of the model's answer (it may be wrapped in a code fence). */
export function parseNarrative(raw: string): PerformanceNarrative {
  const body = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('The AI answer was not a JSON object.');
  return narrativeSchema.parse(JSON.parse(body.slice(start, end + 1)));
}

export type AiResult = { ok: true; narrative: PerformanceNarrative; model: string } | { ok: false; error: string };

export async function writeWithAi(settings: AiSettings, subject: NarrativeSubject, periodKind: string, m: PerformanceMetrics): Promise<AiResult> {
  if (!settings.apiKey) return { ok: false, error: 'AI is not configured.' };
  try {
    const res = await fetch(`${settings.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': settings.apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: settings.model,
        max_tokens: 1800,
        system: SYSTEM,
        messages: [{ role: 'user', content: JSON.stringify(aiInput(subject, periodKind, m)) }]
      }),
      signal: AbortSignal.timeout(settings.timeoutMs)
    });
    if (!res.ok) return { ok: false, error: `The AI service answered HTTP ${res.status}.` };
    const body = (await res.json()) as { content?: { type: string; text?: string }[] };
    const raw = (body.content || []).filter(c => c.type === 'text').map(c => c.text || '').join('');
    return { ok: true, narrative: parseNarrative(raw), model: settings.model };
  } catch (err) {
    if (err instanceof Error && err.name === 'TimeoutError') return { ok: false, error: 'The AI service did not answer in time.' };
    if (err instanceof SyntaxError || (err as { name?: string })?.name === 'ZodError') return { ok: false, error: 'The AI answer could not be read.' };
    return { ok: false, error: err instanceof Error && /JSON/.test(err.message) ? 'The AI answer could not be read.' : 'The AI service could not be reached.' };
  }
}
