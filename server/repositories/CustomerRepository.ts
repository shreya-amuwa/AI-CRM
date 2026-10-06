import type { SupabaseClient } from '@supabase/supabase-js';
import type { Customer, CustomerActivity, CustomerSummary, Paginated } from '../../shared/contracts.js';
import type { CustomerCreateInput, CustomerListQuery, CustomerUpdateInput } from '../../shared/validation.js';
import { AppError } from '../http/errors.js';
import { compact, likePattern, pageRange, unwrap, unwrapOne } from './base.js';

const COLUMNS = `id, owner_id, team_id, department_id, name, email, phone, company, segment, status, notes,
  last_order_date, last_order_amount, total_spent, order_count, created_at, updated_at,
  owner:profiles!customers_owner_id_fkey(id, full_name)`;

const SORT_COLUMNS: Record<CustomerListQuery['sort'], string> = {
  createdAt: 'created_at',
  name: 'name',
  lastOrderAmount: 'last_order_amount'
};

const toNumber = (v: unknown) => (v === null || v === undefined ? null : Number(v));

export function mapCustomer(row: any): Customer {
  return {
    id: row.id,
    ownerId: row.owner_id,
    owner: row.owner ? { id: row.owner.id, fullName: row.owner.full_name } : null,
    teamId: row.team_id,
    departmentId: row.department_id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    company: row.company,
    segment: row.segment,
    status: row.status,
    notes: row.notes,
    lastOrderDate: row.last_order_date,
    lastOrderAmount: toNumber(row.last_order_amount),
    totalSpent: Number(row.total_spent ?? 0),
    orderCount: row.order_count ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

/** Only writable columns; team/department/audit columns are set by the database. */
function toRow(input: Partial<CustomerCreateInput>) {
  return compact({
    owner_id: input.ownerId,
    name: input.name,
    email: input.email,
    phone: input.phone,
    company: input.company,
    segment: input.segment,
    status: input.status,
    notes: input.notes,
    last_order_date: input.lastOrderDate,
    last_order_amount: input.lastOrderAmount,
    total_spent: input.totalSpent,
    order_count: input.orderCount
  });
}

export class CustomerRepository {
  constructor(private readonly db: SupabaseClient) {}

  async list(q: CustomerListQuery): Promise<Paginated<Customer>> {
    let query = this.db.from('customers').select(COLUMNS, { count: 'exact' });
    if (q.status) query = query.eq('status', q.status);
    if (q.segment) query = query.eq('segment', q.segment);
    if (q.ownerId) query = query.eq('owner_id', q.ownerId);
    if (q.teamId) query = query.eq('team_id', q.teamId);
    if (q.departmentId) query = query.eq('department_id', q.departmentId);
    if (q.search) query = query.ilike('search_text', likePattern(q.search));
    const { data, error, count } = await query
      .order(SORT_COLUMNS[q.sort], { ascending: q.order === 'asc', nullsFirst: false })
      .order('id')
      .range(...pageRange(q));
    const rows = unwrap({ data, error });
    return { items: rows.map(mapCustomer), page: q.page, pageSize: q.pageSize, total: count ?? rows.length };
  }

  /** Aggregates over the customers visible to the caller (RLS-scoped). */
  async summary(): Promise<CustomerSummary> {
    return unwrap(await this.db.rpc('customer_summary')) as CustomerSummary;
  }

  async findById(id: string): Promise<Customer> {
    return mapCustomer(unwrapOne(await this.db.from('customers').select(COLUMNS).eq('id', id).maybeSingle(), 'Customer'));
  }

  async insert(input: CustomerCreateInput): Promise<Customer> {
    const row = unwrap(await this.db.from('customers').insert(toRow(input)).select(COLUMNS).single());
    return mapCustomer(row);
  }

  async update(id: string, input: CustomerUpdateInput): Promise<Customer> {
    const row = unwrapOne(
      await this.db.from('customers').update(toRow(input)).eq('id', id).select(COLUMNS).maybeSingle(),
      'Customer'
    );
    return mapCustomer(row);
  }

  async delete(id: string): Promise<void> {
    const rows = unwrap(await this.db.from('customers').delete().eq('id', id).select('id'));
    if (!rows.length) throw new AppError('NOT_FOUND', 'Customer not found.');
  }

  async listActivities(customerId: string): Promise<CustomerActivity[]> {
    const rows = unwrap(
      await this.db
        .from('customer_activities')
        .select('id, customer_id, actor_id, type, note, occurred_at')
        .eq('customer_id', customerId)
        .order('occurred_at', { ascending: false })
        .limit(200)
    );
    return rows.map(mapActivity);
  }

  async addActivity(customerId: string, input: { type: string; note?: string | null; occurredAt?: string }): Promise<CustomerActivity> {
    const row = unwrap(
      await this.db
        .from('customer_activities')
        .insert(compact({ customer_id: customerId, type: input.type, note: input.note, occurred_at: input.occurredAt }))
        .select('id, customer_id, actor_id, type, note, occurred_at')
        .single()
    );
    return mapActivity(row);
  }
}

function mapActivity(row: any): CustomerActivity {
  return {
    id: row.id,
    customerId: row.customer_id,
    actorId: row.actor_id,
    type: row.type,
    note: row.note,
    occurredAt: row.occurred_at
  };
}
