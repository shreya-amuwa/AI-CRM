import { AUTOMATIONS, type AutomationCode, type AutomationStatus } from '../../shared/contracts.js';
import { z } from 'zod';
import { AppError } from '../http/errors.js';
import { parse } from '../http/validate.js';
import { uuidSchema } from '../../shared/validation.js';
import type { PipelineRepository } from '../repositories/PipelineRepository.js';

/**
 * Onboarding automations. Each one is a Google Sheet behind an Apps Script web
 * app (see docs/TECHNICAL_CONSULTANT.md): the API posts one row per trigger and
 * the sheet's automation sends the email / WhatsApp message / AI call.
 * Webhook URLs and the shared secret are server-only environment variables.
 */
const ENV: Record<AutomationCode, string> = {
  EMAIL: 'AUTOMATION_EMAIL_WEBHOOK_URL',
  WHATSAPP: 'AUTOMATION_WHATSAPP_WEBHOOK_URL',
  AI_CALLING: 'AUTOMATION_AI_CALLING_WEBHOOK_URL'
};

function webhookUrl(code: AutomationCode): string | null {
  const raw = process.env[ENV[code]]?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    return url.protocol === 'https:' || (url.protocol === 'http:' && local) ? url.toString() : null;
  } catch {
    return null;
  }
}

const automationSchema = z.enum(AUTOMATIONS, { errorMap: () => ({ message: 'Unknown automation.' }) });

export class AutomationService {
  constructor(private readonly repo: PipelineRepository) {}

  async list(customerId: string): Promise<AutomationStatus[]> {
    const id = parse(uuidSchema, customerId);
    await this.repo.get(id); // 404 if the caller cannot see the customer
    const runs = await this.repo.automationRuns(id);
    return AUTOMATIONS.map(code => {
      const r = runs.get(code);
      return {
        code,
        connected: webhookUrl(code) !== null,
        lastRun: r ? { status: r.status, triggeredAt: r.triggered_at, triggeredBy: r.triggerer?.full_name ?? null, detail: r.detail } : null
      };
    });
  }

  /** Sends the customer to the automation's Google Sheet. Never reports success unless the sheet accepted it. */
  async trigger(customerId: string, automation: string): Promise<AutomationStatus> {
    const id = parse(uuidSchema, customerId);
    const code = parse(automationSchema, automation);
    const url = webhookUrl(code);
    if (!url) throw new AppError('CONFLICT', 'This automation is not connected to a Google Sheet yet.');

    const run = await this.repo.beginAutomation(id, code);
    let ok = false;
    let detail = '';
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          automation: code,
          secret: process.env.AUTOMATION_WEBHOOK_SECRET || undefined,
          runId: run.runId,
          triggeredAt: new Date().toISOString(),
          triggeredBy: run.triggeredBy,
          customer: run.customer,
          services: run.services
        }),
        redirect: 'follow',
        signal: AbortSignal.timeout(15000)
      });
      const text = (await res.text()).slice(0, 300);
      // Apps Script returns 200 even for script errors; it should answer {"ok":true}.
      let body: any = null;
      try {
        body = JSON.parse(text);
      } catch {
        /* not JSON */
      }
      ok = res.ok && (body === null || body.ok !== false);
      detail = ok ? `HTTP ${res.status}` : `HTTP ${res.status}${body?.error ? `: ${body.error}` : ''}`;
    } catch (err) {
      detail = err instanceof Error && err.name === 'TimeoutError' ? 'The Google Sheet did not answer in time.' : 'Could not reach the Google Sheet.';
    }
    await this.repo.finishAutomation(run.runId, ok, detail);
    if (!ok) throw new AppError('SERVICE_UNAVAILABLE', `The automation did not run: ${detail}`);
    return (await this.list(id)).find(a => a.code === code)!;
  }
}
