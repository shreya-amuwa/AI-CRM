import type { Notification, Paginated } from '../../shared/contracts.js';
import { announcementSchema, notificationListQuerySchema, uuidSchema } from '../../shared/validation.js';
import type { Actor } from '../auth/authenticate.js';
import { assertCanBroadcast } from '../authz/policies.js';
import { parse } from '../http/validate.js';
import { NotificationRepository } from '../repositories/NotificationRepository.js';

export class NotificationService {
  constructor(private readonly notifications: NotificationRepository) {}

  list(query: unknown): Promise<Paginated<Notification>> {
    const { unreadOnly, page, pageSize } = parse(notificationListQuerySchema, query);
    return this.notifications.list(unreadOnly, { page, pageSize });
  }

  async unreadCount(): Promise<{ count: number }> {
    return { count: await this.notifications.unreadCount() };
  }

  markRead(id: string): Promise<Notification> {
    return this.notifications.markRead(parse(uuidSchema, id));
  }

  async markAllRead(): Promise<{ updated: number }> {
    return { updated: await this.notifications.markAllRead() };
  }

  delete(id: string): Promise<void> {
    return this.notifications.delete(parse(uuidSchema, id));
  }

  async broadcast(actor: Actor, body: unknown): Promise<{ recipients: number }> {
    const input = parse(announcementSchema, body);
    assertCanBroadcast(actor, input.departmentId);
    return { recipients: await this.notifications.broadcast(input) };
  }
}
