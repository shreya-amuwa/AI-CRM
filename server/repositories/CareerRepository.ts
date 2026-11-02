import { getServiceClient } from '../db/supabase.js';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { CareerApplication, CareerFile, CareerJob, CareerProfile } from '../../shared/contracts.js';
import { unwrap } from './base.js';

export class CareerRepository {
  constructor(private readonly db: SupabaseClient) {}
  profile(data: unknown = null): Promise<CareerProfile> { return this.call('career_profile', { p_data: data }); }
  jobs(page: number, search: string): Promise<{ items: CareerJob[]; total: number }> { return this.call('career_jobs', { p_page: page, p_search: search }); }
  postings(data: unknown = null): Promise<CareerJob[]> { return this.call('hr_career_posting', { p_data: data }); }
  files(): Promise<CareerFile[]> { return this.call('career_file', {}); }
  file(id: string | null, data: unknown = null): Promise<CareerFile> { return this.call('career_file', { p_id: id, p_data: data }); }
  apply(posting: string, resume: string): Promise<CareerApplication> { return this.call('career_apply', { p_posting: posting, p_resume: resume }); }
  applications(): Promise<CareerApplication[]> { return this.call('career_applications', {}); }
  /** Server-only completion after ownership and stored-content verification in the service. */
  async recordVerifiedFile(id: string, size: number, path: string): Promise<CareerFile> {
    return unwrap(await getServiceClient().rpc('career_file_verified', { p_id: id, p_size: size, p_path: path })) as CareerFile;
  }
  async call<T>(name: string, args: Record<string, unknown>): Promise<T> { return unwrap(await this.db.rpc(name,args)) as T; }
}
