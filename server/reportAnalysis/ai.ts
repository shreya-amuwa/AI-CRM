import type { AnalysisFact, AnalysisFacts, AnalysisNarrative } from '../../shared/contracts.js';
import type { AiSettings } from '../performance/ai.js';
import { SECTIONS, validateNarrative } from './narrative.js';

/**
 * The AI writing of the company analysis. Same switch as the other AI features: OFF until ANTHROPIC_API_KEY is set on the server.
 * What is sent: the measurable facts only, with every NAME removed (a fact is identified by its factId; the screen puts the name back), the
 * numbers and the period. No e-mail, phone, comments or customer data.
 */
const SYSTEM = `You write the performance analysis for the Super Admin of a CRM, from measurable facts about reporting and task completion.
Rules:
- Use ONLY the facts in the JSON the user sends. Never invent a number, a task, an activity or a person.
- Never give a REASON for a result (no "because", no guesses about motivation, skill, workload, health or hours). Say what was recorded, nothing about why.
- People are identified only by factId. Do not write names. Write each item as a short statement of the recorded numbers, and put the factId(s) it is based on in factIds. An item without a factId from the input is not allowed.
- People with insufficient data are not judged and not mentioned as poor performers.
- Do not mention HR ratings as something to change; do not recommend changing an HR rating.
- Be brief and neutral. Answer with ONE JSON object and nothing else, with exactly these keys: summary (string, 2 to 4 sentences about the whole period), sections (array of {key, title, items: [{text, factIds}]}) using only the section keys present in the input, limitations (array of strings).`;

/** The facts the model gets: no names. */
export function aiFactsInput(facts: AnalysisFacts) {
  const strip = (list: AnalysisFact[]) => list.map(f => {
    const { name: _name, department: _department, team: _team, subjectId: _subjectId, ...rest } = f;
    return { ...rest, subjectType: f.subjectType };
  });
  const out: Record<string, unknown> = { period: facts.period, thresholds: facts.thresholds, counts: facts.counts };
  for (const s of SECTIONS) out[s.key] = strip((facts[s.key] as AnalysisFact[]) ?? []);
  out.sectionTitles = Object.fromEntries(SECTIONS.map(s => [s.key, s.title]));
  return out;
}

export type AnalysisAiResult = { ok: true; narrative: AnalysisNarrative; model: string } | { ok: false; error: string };

export async function analyseWithAi(settings: AiSettings, facts: AnalysisFacts): Promise<AnalysisAiResult> {
  if (!settings.apiKey) return { ok: false, error: 'AI is not configured.' };
  try {
    const res = await fetch(`${settings.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': settings.apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: settings.model, max_tokens: 3000, system: SYSTEM, messages: [{ role: 'user', content: JSON.stringify(aiFactsInput(facts)) }] }),
      signal: AbortSignal.timeout(settings.timeoutMs)
    });
    if (!res.ok) return { ok: false, error: `The AI service answered HTTP ${res.status}.` };
    const body = (await res.json()) as { content?: { type: string; text?: string }[] };
    const raw = (body.content || []).filter(c => c.type === 'text').map(c => c.text || '').join('').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start < 0 || end <= start) return { ok: false, error: 'The AI answer was not a JSON object.' };
    return { ok: true, narrative: validateNarrative(JSON.parse(raw.slice(start, end + 1)), facts), model: settings.model };
  } catch (err) {
    if (err instanceof Error && err.name === 'TimeoutError') return { ok: false, error: 'The AI service did not answer in time.' };
    if (err instanceof SyntaxError || (err as { name?: string })?.name === 'ZodError') return { ok: false, error: 'The AI answer could not be read.' };
    return { ok: false, error: 'The AI service could not be reached.' };
  }
}
