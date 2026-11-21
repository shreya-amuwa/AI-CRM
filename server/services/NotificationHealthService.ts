import type { NotificationHealthDetail, NotificationHealthReport, NotificationTestResult } from '../../shared/contracts.js';
import { notificationHealthQuerySchema, uuidSchema } from '../../shared/validation.js';
import { sendQueuedTest } from '../automations/attendanceReminders.js';
import { vapidConfig } from '../automations/webPush.js';
import { parse } from '../http/validate.js';
import { NotificationHealthRepository } from '../repositories/NotificationHealthRepository.js';

/**
 * Notification Health for the Super Admin and HR. Whether push works at all depends on the server's VAPID keys, which only the API can
 * check, so it is passed to the database for display (it grants nothing).
 */
export class NotificationHealthService {
  constructor(private readonly repo: NotificationHealthRepository) {}

  report(query: unknown): Promise<NotificationHealthReport> {
    return this.repo.report(parse(notificationHealthQuerySchema, query), !!vapidConfig());
  }

  employee(profileId: string): Promise<NotificationHealthDetail> {
    return this.repo.employee(parse(uuidSchema, profileId));
  }

  /** A controlled test to one employee's devices: queued as the caller (checked and audited by the database), then sent at once. */
  async sendTest(profileId: string): Promise<NotificationTestResult> {
    const queued = await this.repo.queueAdminTest(parse(uuidSchema, profileId));
    const r = await sendQueuedTest(queued);
    return { devices: r.devices, sent: r.sent, retry: r.retry, failed: r.failed, gone: r.gone, pushConfigured: r.pushConfigured };
  }
}
