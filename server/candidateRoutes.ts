import type { HttpMethod, ApiRequest, HandlerResult } from './http/types.js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { careerController as career } from './controllers/career.js';
interface CandidateRoute { method: Exclude<HttpMethod,'PUT'>; path: string; public?: boolean; handler: (c: { db: SupabaseClient; req: ApiRequest; params: Record<string,string> })=>Promise<HandlerResult> }
export const candidateRoutes: CandidateRoute[] = [
  {method:'GET',path:'/careers/jobs',public:true,handler:career.jobs},
  {method:'GET',path:'/candidate/assessments',handler:career.assessments},
  {method:'GET',path:'/candidate/assessments/:id',handler:career.attempt},
  {method:'POST',path:'/candidate/assessments/:id',handler:career.saveAttempt},
  {method:'GET',path:'/candidate/interviews',handler:career.interviews},
  {method:'GET',path:'/candidate/profile',handler:career.profile},
  {method:'PATCH',path:'/candidate/profile',handler:career.saveProfile},
  {method:'GET',path:'/candidate/resumes',handler:career.files},
  {method:'POST',path:'/candidate/resumes',handler:career.beginUpload},
  {method:'POST',path:'/candidate/resumes/:id/complete',handler:career.completeUpload},
  {method:'GET',path:'/candidate/resumes/:id/url',handler:career.fileUrl},
  {method:'GET',path:'/candidate/applications',handler:career.applications},
  {method:'POST',path:'/candidate/applications',handler:career.apply}
];
