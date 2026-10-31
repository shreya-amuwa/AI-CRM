import type { SupabaseClient } from '@supabase/supabase-js';
import type { PerformerRecognition, PerformersCompany, PerformersDepartment } from '../../shared/contracts.js';
import { unwrap } from './base.js';

/** Top performers. Every call is a database function that checks who the caller is (Department Head of that department, Operations Head, Super Admin). */
export class PerformersRepository {
  constructor(private readonly db: SupabaseClient) {}

  department(i: { month?: string; departmentId?: string }) {
    return this.rpc<PerformersDepartment>('performers_department', { p_month: i.month ?? null, p_department: i.departmentId ?? null });
  }
  company(i: { month?: string }) {
    return this.rpc<PerformersCompany>('performers_company', { p_month: i.month ?? null });
  }
  decide(id: string, decision: 'APPROVE' | 'REJECT', note?: string) {
    return this.rpc<PerformerRecognition>('performer_recognition_decide', { p_id: id, p_decision: decision, p_note: note ?? null });
  }
  private async rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
    return unwrap(await this.db.rpc(name, args)) as T;
  }
}
