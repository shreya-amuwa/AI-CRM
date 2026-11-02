import type { SupabaseClient } from '@supabase/supabase-js';
import type { ApiRequest, HandlerResult } from '../http/types.js';
import { CareerRepository } from '../repositories/CareerRepository.js';
import { CareerService } from '../services/CareerService.js';
interface CareerContext { db: SupabaseClient; req: ApiRequest; params: Record<string,string> }
type Action = (s: CareerService,c: CareerContext)=>Promise<unknown>;
const handle=(fn:Action)=>(async(c:CareerContext):Promise<HandlerResult>=>({data:await fn(new CareerService(new CareerRepository(c.db)),c)}));
export const careerController = {
  profile:handle(s=>s.profile()), saveProfile:handle((s,c)=>s.saveProfile(c.req.body)), jobs:handle((s,c)=>s.jobs(c.req.query)),
  files:handle(s=>s.files()), beginUpload:handle((s,c)=>s.beginUpload(c.req.body)), completeUpload:handle((s,c)=>s.completeUpload(c.params.id)),
  fileUrl:handle((s,c)=>s.fileUrl(c.params.id)), hrFileUrl:handle((s,c)=>s.fileUrl(c.params.id,true)),
  applications:handle(s=>s.applications()), apply:handle((s,c)=>s.apply(c.req.body)),
  postings:handle(s=>s.postings()), savePosting:handle((s,c)=>s.postings(c.req.body))
};
