import type { SupabaseClient } from '@supabase/supabase-js';
import type { Notification, Paginated, TeamDivision } from '../../shared/contracts.js';
import { AppError } from '../http/errors.js';
import { pageRange, unwrap, type PageRequest } from './base.js';

const COLUMNS = 'id, type, title, body, priority, entity_type, entity_id, actor_id, data, read_at, created_at';

function mapNotification(row: any): Notification {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    priority: row.priority,
    entityType: row.entity_type,
    entityId: row.entity_id,
    actorId: row.actor_id,
    data: row.data ?? {},
    readAt: row.read_at,
    createdAt: row.created_at
  };
}

/** All queries are implicitly scoped to the caller by RLS (recipient_id = auth.uid()). */
export class NotificationRepository {
  constructor(private readonly db: SupabaseClient) {}

  async list(unreadOnly: boolean, page: PageRequest): Promise<Paginated<Notification>> {
    let query = this.db.from('notifications').select(COLUMNS, { count: 'exact' });
    if (unreadOnly) query = query.is('read_at', null);
    const { data, error, count } = await query.order('created_at', { ascending: false }).range(...pageRange(page));
    const rows = unwrap({ data, error });
    return { items: rows.map(mapNotification), ...page, total: count ?? rows.length };
  }

  async unreadCount(): Promise<number> {
    const { count, error } = await this.db.from('notifications').select('id', { count: 'exact', head: true }).is('read_at', null);
    unwrap({ data: null, error });
    return count ?? 0;
  }

  async markRead(id: string): Promise<Notification> {
    const rows = unwrap(
      await this.db.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', id).select(COLUMNS)
    );
    if (!rows.length) throw new AppError('NOT_FOUND', 'Notification not found.');
    return mapNotification(rows[0]);
  }

  async markAllRead(): Promise<number> {
    const rows = unwrap(
      await this.db.from('notifications').update({ read_at: new Date().toISOString() }).is('read_at', null).select('id')
    );
    return rows.length;
  }

  async delete(id: string): Promise<void> {
    const rows = unwrap(await this.db.from('notifications').delete().eq('id', id).select('id'));
    if (!rows.length) throw new AppError('NOT_FOUND', 'Notification not found.');
  }

  async broadcast(input: { title: string; body: string; priority: string; departmentId?: string; division?: TeamDivision }): Promise<number> {
    return unwrap(
      await this.db.rpc('broadcast_announcement', {
        p_title: input.title,
        p_body: input.body,
        p_priority: input.priority,
        p_department_id: input.departmentId ?? null,
        p_division: input.division ?? null
      })
    ) as number;
  }
}
