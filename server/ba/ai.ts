import type { ZodTypeAny, z } from 'zod';
import { aiSettings, type AiSettings } from '../performance/ai.js';
import { AppError } from '../http/errors.js';

/**
 * The AI that drafts quotations and Scope of Project documents. It uses the same server-side configuration as the performance reports
 * (ANTHROPIC_API_KEY on the server; never in the browser or the database) with its own model and time limit:
 *   BA_AI_MODEL (default: PERFORMANCE_AI_MODEL, then claude-sonnet-5-5), BA_AI_TIMEOUT_MS (default 120 s).
 * Without a key the AI actions answer "not configured" and the documents can still be written by hand.
 *
 * What is sent: only the one client the signed-in Business Associate owns (name, company, requirements, the profile they typed, the services,
 * their notes). No phone numbers or e-mail addresses. Prices, tax and totals are worked out by the database and sent as fixed figures: the AI
 * writes words, never numbers, and every answer is checked against a schema before it is used.
 */
export function baAiSettings(env: NodeJS.ProcessEnv = process.env): AiSettings {
  const base = aiSettings(env);
  return { ...base, model: env.BA_AI_MODEL?.trim() || base.model, timeoutMs: Math.max(10_000, Number(env.BA_AI_TIMEOUT_MS) || 120_000) };
}

export const QUOTATION_SYSTEM = `You draft the TEXT of a client quotation for Amuwa Corporation, a digital services company. A person will review and edit it before it is sent.
Rules:
- Use ONLY the facts in the JSON the user sends. Never invent a fact about the client, a price, a discount, a tax rate, a payment term, a date, a number, a company detail (registration, GST number, bank details, address) or a service feature.
- You do not write numbers for money: the amounts in "lines" and "totals" are fixed and are shown by the system. Refer to services by their name only. Do not repeat or recalculate amounts.
- Describe each service only in general terms from its name and category, and tie it to the client's stated requirements. Do not promise results, performance, deadlines or features that are not in the data.
- "paymentTerms", "validityDays" and "timeline" are what the Business Associate entered. Restate them; if one is null, write "To be confirmed" and add a question to "missingInformation". Never make one up.
- Keep a professional, plain tone. Address the client company by name.
- Answer with ONE JSON object and nothing else, with exactly these keys: introduction (string), understanding (string: the client's needs as stated), recommendedServices (string), scopeSummary (string), commercialTerms (string: the entered payment terms and validity only), implementationTimeline (string: the entered timeline only), exclusions (array of strings: things the data shows are not included, or common sense exclusions like "Third-party fees are not included unless stated"), notes (array of strings), serviceDescriptions (object: service code -> one short paragraph, for the codes in "lines" only), missingInformation (array of questions for the Business Associate).`;

export const SCOPE_SYSTEM = `You write a Scope of Project (a business analysis and project blueprint) for a client of Amuwa Corporation, a digital services company. A Business Associate will review and edit it before anyone relies on it.
Rules:
- Use ONLY the facts in the JSON the user sends ("client", "requirements", "profile", "inputs", "communicationNotes", "services", "quotation", "demos"). Never invent a fact about the client: no revenue, staff numbers, locations, customers, competitors, tools, dates or results.
- Every point of the analysis has a "basis": "VERIFIED" only when a provided fact directly supports it; otherwise "ASSUMPTION". When in doubt, use "ASSUMPTION". Never present an assumption as a confirmed fact.
- Recommend ONLY services from "catalogue", using the exact "code". Prefer the services the client asked for ("services"). Do not invent services or features: describe a service only by its name and category and how it could address the stated needs.
- Do not write prices, discounts or taxes. Timelines and durations are proposals: write them as proposals (for example "about 2 weeks, to be confirmed") and list them under assumptions.
- If information needed for a good document is missing, do NOT guess: list a question for the Business Associate in "missingInformation" and keep the related text short and clearly general.
- Be specific and concise. Lists are short, plain sentences.
- Answer with ONE JSON object and nothing else.
Keys: businessAnalysis { swot { strengths, weaknesses, opportunities, threats }, keyChallenges, growthAreas, improvementAreas } where each list is an array of { text, basis };
recommendedSolutions: array of { serviceCode, reason, benefits, integrations, dependencies, considerations };
projectScope { overview, objectives[], challenges[], proposedSolution, servicesIncluded[] (service names), deliverables[], functionalRequirements[], phases[{ name, duration, activities[] }], milestones[{ name, timing }], clientResponsibilities[], amuwaResponsibilities[], assumptions[], dependencies[], outOfScope[], risks[{ risk, mitigation }], kpis[], nextSteps[] };
missingInformation: array of strings.`;

export type AiJson = { ok: true; data: unknown; model: string };

/** One call to the model; returns the JSON object it answered. Failures become clear, safe messages (the AI's raw answer is never shown or stored). */
export async function callAiJson(settings: AiSettings, system: string, payload: unknown, maxTokens: number): Promise<AiJson> {
  if (!settings.apiKey) throw new AppError('SERVICE_UNAVAILABLE', 'AI is not set up on the server yet (ANTHROPIC_API_KEY). You can still write the document by hand.');
  let res: Response;
  try {
    res = await fetch(`${settings.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': settings.apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: settings.model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: JSON.stringify(payload) }] }),
      signal: AbortSignal.timeout(settings.timeoutMs)
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'TimeoutError') throw new AppError('SERVICE_UNAVAILABLE', 'The AI service did not answer in time. Please try again.');
    throw new AppError('SERVICE_UNAVAILABLE', 'The AI service could not be reached. Please try again.');
  }
  if (!res.ok) throw new AppError('SERVICE_UNAVAILABLE', `The AI service answered HTTP ${res.status}. Please try again.`);
  let raw = '';
  try {
    const body = (await res.json()) as { content?: { type: string; text?: string }[] };
    raw = (body.content || []).filter(c => c.type === 'text').map(c => c.text || '').join('');
  } catch {
    throw new AppError('SERVICE_UNAVAILABLE', 'The AI answer could not be read. Please try again.');
  }
  const body = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) throw new AppError('SERVICE_UNAVAILABLE', 'The AI answer could not be read. Please try again.');
  try {
    return { ok: true, data: JSON.parse(body.slice(start, end + 1)), model: settings.model };
  } catch {
    throw new AppError('SERVICE_UNAVAILABLE', 'The AI answer could not be read. Please try again.');
  }
}

/** Validates the answer against the schema; a wrong shape is an error, never silently patched. */
export function checkAnswer<S extends ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const r = schema.safeParse(data);
  if (!r.success) throw new AppError('SERVICE_UNAVAILABLE', 'The AI answer was not in the expected form. Please try again.');
  return r.data;
}
