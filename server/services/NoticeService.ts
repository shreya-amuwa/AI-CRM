import type { CompanyNotice, NoticeAcknowledged, NoticeAudienceOptions, NoticeList, NoticeManagers, NoticePending, NoticeReceipts } from '../../shared/contracts.js';
import { noticeListQuerySchema, noticeManagerSetSchema, noticePublishSchema, noticeUpdateSchema, uuidSchema } from '../../shared/validation.js';
import { processDeliveries } from '../automations/notificationDelivery.js';
import { vapidConfig } from '../automations/webPush.js';
import { parse } from '../http/validate.js';
import type { NoticeRepository } from '../repositories/NoticeRepository.js';

/**
 * Company Notice Board (migration 20270131000200). This layer validates; the database decides who may read, publish, edit and archive
 * (the Super Admin, an Operations Head within their departments, HR and the Developers team publish; everyone else only reads).
 * A notice published now is pushed at once (its deliveries from the outbox); anything not sent here goes with the 5-minute scheduled run.
 */
export class NoticeService {
  constructor(private readonly repo: NoticeRepository) {}
  list(query: unknown): Promise<NoticeList> { return this.repo.list(parse(noticeListQuerySchema, query ?? {})); }
  async unreadCount(): Promise<{ unread: number }> { return { unread: Number(await this.repo.unreadCount()) || 0 }; }
  open(id: string): Promise<CompanyNotice> { return this.repo.open(parse(uuidSchema, id)); }
  receipts(id: string): Promise<NoticeReceipts> { return this.repo.receipts(parse(uuidSchema, id)); }
  audienceOptions(): Promise<NoticeAudienceOptions> { return this.repo.audienceOptions(); }
  async publish(body: unknown): Promise<CompanyNotice> {
    const i = parse(noticePublishSchema, body);
    const vapid = vapidConfig();
    const n = await this.repo.publish({ ...i, push: !!vapid });
    const ids = (n.deliveryIds ?? []).map(Number).filter(Number.isFinite);
    if (ids.length && vapid) {
      // best effort: the notice is published and in everyone's bell already; what does not go now is retried by the scheduled run
      try { await processDeliveries({ ids, budgetMs: 10_000 }); } catch (e) { console.error('[notices] push failed:', e instanceof Error ? e.message : 'error'); }
    }
    const { deliveryIds: _ids, ...rest } = n;
    void _ids;
    return rest;
  }
  update(id: string, body: unknown): Promise<CompanyNotice> { return this.repo.update(parse(uuidSchema, id), parse(noticeUpdateSchema, body)); }
  /** The notices this employee must still acknowledge (the popup queue). */
  pending(): Promise<NoticePending> { return this.repo.pending(); }
  /** "Acknowledge" / "Mark as read" on the signed-in employee's own row: the database knows who is asking, nothing about whom is sent. */
  acknowledge(id: string): Promise<NoticeAcknowledged> { return this.repo.acknowledge(parse(uuidSchema, id)); }
  managers(): Promise<NoticeManagers> { return this.repo.managers(); }
  managerSet(profileId: string, body: unknown): Promise<{ profileId: string; manager: boolean }> {
    return this.repo.managerSet(parse(uuidSchema, profileId), parse(noticeManagerSetSchema, body).enabled);
  }
  archive(id: string): Promise<CompanyNotice> { return this.repo.archive(parse(uuidSchema, id)); }
}
