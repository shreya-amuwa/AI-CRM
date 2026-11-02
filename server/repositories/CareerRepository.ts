import { getServiceClient } from '../db/supabase.js';
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  CareerApplication,
  CareerFile,
  CareerJob,
  CareerProfile,
  CareerTest,
  CareerAttempt,
  CareerInterview,
  CareerStaffApplication,
} from '../../shared/contracts.js';
import { unwrap } from './base.js';

export class CareerRepository {
  constructor(private readonly db: SupabaseClient) {}
  profile(data: unknown = null): Promise<CareerProfile> {
    return this.call('career_profile', { p_data: data });
  }
  jobs(
    page: number,
    search: string,
  ): Promise<{ items: CareerJob[]; total: number }> {
    return this.call('career_jobs', { p_page: page, p_search: search });
  }
  postings(data: unknown = null): Promise<CareerJob[]> {
    return this.call('hr_career_posting', { p_data: data });
  }
  files(): Promise<CareerFile[]> {
    return this.call('career_file', {});
  }
  file(id: string | null, data: unknown = null): Promise<CareerFile> {
    return this.call('career_file', { p_id: id, p_data: data });
  }
  apply(posting: string, resume: string): Promise<CareerApplication> {
    return this.call('career_apply', { p_posting: posting, p_resume: resume });
  }
  applications(): Promise<CareerApplication[]> {
    return this.call('career_applications', {});
  }
  tests(data: unknown = null): Promise<CareerTest[]> {
    return this.call('hr_career_tests', { p_data: data });
  }
  invite(
    application: string,
    test: string,
    until: string,
  ): Promise<CareerAttempt> {
    return this.call('hr_career_invite', {
      p_application: application,
      p_test: test,
      p_until: until,
    });
  }
  assessments(): Promise<CareerAttempt[]> {
    return this.call('career_assessment', {});
  }
  attempt(id: string, data: unknown = null): Promise<CareerAttempt> {
    return this.call('career_assessment', { p_id: id, p_data: data });
  }
  staffApplications(
    page: number,
  ): Promise<{ items: CareerStaffApplication[]; total: number }> {
    return this.call('hr_career_applications', { p_page: page });
  }
  stage(
    application: string,
    stage: string,
    version: number,
    message: string | null,
  ): Promise<null> {
    return this.call('hr_career_stage', {
      p_application: application,
      p_stage: stage,
      p_version: version,
      p_message: message,
    });
  }
  interview(application: string, data: unknown): Promise<CareerInterview> {
    return this.call('hr_career_interview', {
      p_application: application,
      p_data: data,
    });
  }
  interviews(): Promise<CareerInterview[]> {
    return this.call('career_interviews', {});
  }
  async call<T>(name: string, args: Record<string, unknown>): Promise<T> {
    return unwrap(await this.db.rpc(name, args)) as T;
  }
  /** Server-only completion after ownership and stored-content verification in the service. */
  async recordVerifiedFile(id: string, size: number, path: string): Promise<CareerFile> {
    return unwrap(await getServiceClient().rpc('career_file_verified', { p_id: id, p_size: size, p_path: path })) as CareerFile;
  }

}
