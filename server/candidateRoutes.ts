import type { HttpMethod, ApiRequest, HandlerResult } from './http/types.js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { careerController as career } from './controllers/career.js';
interface CandidateRoute {
  method: Exclude<HttpMethod, 'PUT'>;
  path: string;
  public?: boolean;
  rate?: 'default' | 'sensitive';
  handler: (c: {
    db: SupabaseClient;
    req: ApiRequest;
    params: Record<string, string>;
  }) => Promise<HandlerResult>;
}
export const candidateRoutes: CandidateRoute[] = [
  { method: 'GET', path: '/careers/jobs', public: true, handler: career.jobs },
  {
    method: 'GET',
    path: '/candidate/assessments',
    handler: career.assessments,
  },
  {
    method: 'GET',
    path: '/candidate/assessments/:id',
    handler: career.attempt,
  },
  {
    method: 'POST',
    path: '/candidate/assessments/:id',
    rate: 'default',
    handler: career.saveAttempt,
  },
  { method: 'GET', path: '/candidate/interviews', handler: career.interviews },
  { method: 'GET', path: '/candidate/offers', handler: career.offers },
  { method: 'POST', path: '/candidate/offers/:id', handler: career.offerReply },
  { method: 'GET', path: '/candidate/documents', handler: career.documents },
  {
    method: 'POST',
    path: '/candidate/documents/:id',
    handler: career.document,
  },
  { method: 'GET', path: '/candidate/training', handler: career.training },
  {
    method: 'POST',
    path: '/candidate/applications/:id/withdraw',
    handler: career.withdraw,
  },
  {
    method: 'GET',
    path: '/candidate/notifications',
    handler: career.notifications,
  },
  { method: 'GET', path: '/candidate/profile', handler: career.profile },
  { method: 'PATCH', path: '/candidate/profile', handler: career.saveProfile },
  { method: 'GET', path: '/candidate/resumes', handler: career.files },
  { method: 'POST', path: '/candidate/resumes', handler: career.beginUpload },
  {
    method: 'POST',
    path: '/candidate/resumes/:id/complete',
    handler: career.completeUpload,
  },
  {
    method: 'GET',
    path: '/candidate/resumes/:id/url',
    handler: career.fileUrl,
  },
  {
    method: 'GET',
    path: '/candidate/applications',
    handler: career.applications,
  },
  { method: 'POST', path: '/candidate/applications', handler: career.apply },
];
