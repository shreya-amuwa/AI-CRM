import type { ReminderCallList } from '../../shared/contracts.js';
import { reminderCallListQuerySchema } from '../../shared/validation.js';
import { parse } from '../http/validate.js';
import type { ReminderCallRepository } from '../repositories/ReminderCallRepository.js';

/** Read-only monitoring of the panel recharge reminder calls (7, 5 and 1 day before expiry). Placing calls is the scheduler's job only. */
export class ReminderCallService {
  constructor(private readonly repo: ReminderCallRepository) {}
  list(query: unknown): Promise<ReminderCallList> { return this.repo.list(parse(reminderCallListQuerySchema, query ?? {})); }
}
