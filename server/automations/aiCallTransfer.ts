import { timingSafeEqual } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { cleanIndianMobile } from '../../shared/contactValidation.js';
import { AppError, fromDatabaseError } from '../http/errors.js';

/**
 * "Who do I transfer this call to?" for the AI calling agent (BolifyAI).
 *
 * The agent used to transfer to ONE number typed into its settings. Each department has its own Technical Consultants, so during the call the
 * agent asks the CRM (an HTTPS tool, see docs/BOLIFY_AI.md) and the database answers from its own records (ai_call_transfer_target): the
 * customer being called decides the department, and that department's consultant who can be reached takes the call.
 *
 * The endpoint has no user: the agent presents a shared secret (BOLIFY_TOOL_SECRET, 16+ characters, several allowed while it is changed) in
 * "x-api-key" or "Authorization: Bearer". Only the service key can run the database function; the answer holds the one number to transfer to,
 * the consultant's name and the department, and nothing else about the customer or the staff.
 */
export const toolSecrets = (env: NodeJS.ProcessEnv = process.env) => (env.BOLIFY_TOOL_SECRET || '').split(',').map(s => s.trim()).filter(s => s.length >= 16);

export function toolSecretOk(given: { apiKey?: string | null; authorization?: string | null }, env: NodeJS.ProcessEnv = process.env): boolean {
  const presented = Buffer.from((given.apiKey || (given.authorization || '').replace(/^Bearer\s+/i, '') || '').trim());
  return toolSecrets(env).some(sec => {
    const want = Buffer.from(sec);
    return want.length === presented.length && timingSafeEqual(want, presented);
  });
}

export interface TransferRequest { phone: string | null; reference: string | null; callId: string | null }

const PHONE_KEYS = ['phone', 'phone_number', 'phoneNumber', 'customer_phone', 'customerPhone', 'contact_number', 'called_number', 'to', 'number'];
const REF_KEYS = ['reference', 'ref', 'reminder_id', 'reminderId'];
const CALL_KEYS = ['call_id', 'callId', 'call_uuid', 'callUuid', 'id'];

const text = (v: unknown): string | null => {
  const x = Array.isArray(v) ? v[0] : v;
  return (typeof x === 'string' || typeof x === 'number') && String(x).trim() ? String(x).trim().slice(0, 200) : null;
};

/** The agent's tool call can name things in several ways (and nest them one level down): take the first usable value of each kind. */
export function parseTransferRequest(input: unknown): TransferRequest {
  const layers: Record<string, unknown>[] = [];
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    const o = input as Record<string, unknown>;
    layers.push(o);
    for (const k of ['data', 'variables', 'metadata', 'arguments', 'params']) if (o[k] && typeof o[k] === 'object' && !Array.isArray(o[k])) layers.push(o[k] as Record<string, unknown>);
  }
  const first = (keys: string[]) => {
    for (const l of layers) for (const k of keys) { const v = text(l[k]); if (v) return v; }
    return null;
  };
  return { phone: first(PHONE_KEYS), reference: first(REF_KEYS), callId: first(CALL_KEYS) };
}

export interface TransferAnswer {
  found: boolean;
  transfer_to?: string;
  consultant_name?: string;
  consultant_first_name?: string;
  department?: string | null;
  assigned_by?: 'ASSIGNED' | 'ROTATION' | 'TEAM_LEAD' | 'DEFAULT';
  reason?: 'NO_CUSTOMER' | 'NO_CONSULTANT' | 'INVALID_REQUEST';
  /** A sentence the agent can say next. */
  say: string;
}

/** The default number (BOLIFY_DEFAULT_TRANSFER_NUMBER) is only for a number that is no customer at all (for example a test lead): never for a known customer. */
export async function lookupTransfer(db: SupabaseClient, req: TransferRequest, env: NodeJS.ProcessEnv = process.env): Promise<TransferAnswer> {
  if (!req.phone && !req.reference && !req.callId) {
    throw new AppError('VALIDATION_ERROR', 'Send the customer\'s phone number, or the call\'s reference or id.');
  }
  const { data, error } = await db.rpc('ai_call_transfer_target', { p_phone: req.phone, p_reference: req.reference, p_call_id: req.callId });
  if (error) throw fromDatabaseError(error);
  const d = (data ?? {}) as { found?: boolean; transferTo?: string; consultantName?: string; consultantFirstName?: string; department?: string | null; how?: TransferAnswer['assigned_by']; reason?: TransferAnswer['reason'] };
  if (d.found && d.transferTo) {
    return {
      found: true, transfer_to: d.transferTo, consultant_name: d.consultantName, consultant_first_name: d.consultantFirstName, department: d.department ?? null, assigned_by: d.how,
      say: `Please hold on, I am connecting you to ${d.consultantFirstName ?? 'our technical consultant'}${d.department ? ` from the ${d.department} team` : ''}.`
    };
  }
  const fallback = cleanIndianMobile(env.BOLIFY_DEFAULT_TRANSFER_NUMBER);
  if (d.reason === 'NO_CUSTOMER' && fallback) {
    return { found: true, transfer_to: `+91${fallback}`, assigned_by: 'DEFAULT', department: null, say: 'Please hold on, I am connecting you to our technical team.' };
  }
  return {
    found: false, reason: d.reason ?? 'NO_CUSTOMER',
    say: d.reason === 'NO_CONSULTANT'
      ? 'Our technical consultants are not available right now. I will arrange for one of them to call you back shortly.'
      : 'I could not find your details, so I cannot transfer you right now. Our team will contact you shortly.'
  };
}
