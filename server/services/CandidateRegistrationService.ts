import { candidateRegisterSchema } from '../../shared/validation.js';
import { hasServiceClient } from '../db/supabase.js';
import { requestInfo } from '../http/context.js';
import { AppError } from '../http/errors.js';
import { parse } from '../http/validate.js';
import { AuthAdminRepository } from '../repositories/AuthAdminRepository.js';
import { recordSecurityEvent } from '../security/events.js';

/**
 * Candidate-portal registration with NO e-mail, phone, OTP or approval step: the account is created confirmed and active, and the portal signs
 * the candidate in straight away with the password they just chose (ordinary Supabase password sign-in, so every later visit is e-mail + password).
 *
 * Public on purpose (a new candidate has no login yet). It can only ever create a candidate-portal account: the account carries no staff or client
 * marker, and an e-mail that already has ANY account (candidate, staff or client) is refused without touching it.
 * Callers are rate limited per address and per e-mail before this runs (see app.ts).
 */
export async function registerCandidate(
  body: unknown,
  repo: Pick<AuthAdminRepository, 'createCandidateUser'> = new AuthAdminRepository(),
  record: typeof recordSecurityEvent = recordSecurityEvent
): Promise<{ ok: true }> {
  const input = parse(candidateRegisterSchema, body);
  if (!hasServiceClient()) throw new AppError('SERVICE_UNAVAILABLE', 'Registration is not available right now. Please try again later.');
  const id = await repo.createCandidateUser(input);
  const info = requestInfo.getStore();
  // the log never carries the e-mail, the password or the phone number
  await record({
    action: 'CANDIDATE_REGISTERED', entityType: 'candidate_account', entityId: id, actorId: null, outcome: 'SUCCESS', requestId: info?.requestId, ip: info?.ip,
    dedupeKey: `candidate-registered:${id}`, metadata: {}
  });
  return { ok: true };
}
