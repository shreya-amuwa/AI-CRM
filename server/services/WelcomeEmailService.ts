import type { WelcomeEmailItem, WelcomeEmailList } from '../../shared/contracts.js';
import { uuidSchema, welcomeEmailListQuerySchema } from '../../shared/validation.js';
import { parse } from '../http/validate.js';
import type { WelcomeEmailRepository } from '../repositories/WelcomeEmailRepository.js';

/** The status of the welcome e-mails and the secure resend. The password link is made when the e-mail is sent; nothing here ever sees or returns it. */
export class WelcomeEmailService {
  constructor(private readonly repo: WelcomeEmailRepository) {}
  list(query: unknown): Promise<WelcomeEmailList> { return this.repo.list(parse(welcomeEmailListQuerySchema, query ?? {})); }
  resend(employeeId: string): Promise<WelcomeEmailItem> { return this.repo.resend(parse(uuidSchema, employeeId)); }
}
