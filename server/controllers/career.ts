import type { SupabaseClient } from '@supabase/supabase-js';
import type { ApiRequest, HandlerResult } from '../http/types.js';
import { CareerRepository } from '../repositories/CareerRepository.js';
import { CareerService } from '../services/CareerService.js';
interface CareerContext {
  db: SupabaseClient;
  req: ApiRequest;
  params: Record<string, string>;
}
type Action = (s: CareerService, c: CareerContext) => Promise<unknown>;
const handle =
  (fn: Action) =>
  async (c: CareerContext): Promise<HandlerResult> => ({
    data: await fn(new CareerService(new CareerRepository(c.db)), c),
  });
export const careerController = {
  tests: handle((s) => s.tests()),
  saveTest: handle((s, c) => s.tests(c.req.body)),
  invite: handle((s, c) => s.invite(c.req.body)),
  assessments: handle((s) => s.assessments()),
  attempt: handle((s, c) => s.attempt(c.params.id)),
  saveAttempt: handle((s, c) => s.attempt(c.params.id, c.req.body)),
  staffApplications: handle((s, c) => s.staffApplications(c.req.query)),
  stage: handle((s, c) => s.stage(c.req.body)),
  interviews: handle((s) => s.interviews()),
  interview: handle((s, c) => s.interview(c.req.body)),
  offers: handle((s) => s.offers()),
  offerReply: handle((s, c) => s.offerReply(c.params.id, c.req.body)),
  staffOffer: handle((s, c) => s.staffOffer(c.req.body)),
  documents: handle((s) => s.documents()),
  document: handle((s, c) => s.document(c.params.id, c.req.body)),
  staffDocument: handle((s, c) => s.staffDocument(c.req.body)),
  training: handle((s) => s.training()),
  staffTraining: handle((s, c) => s.staffTraining(c.req.body)),
  withdraw: handle((s, c) => s.withdraw(c.params.id)),
  trainingInvite: handle((s, c) => s.trainingInvite(c.req.body)),
  notifications: handle((s) => s.notifications()),
  profile: handle((s) => s.profile()),
  saveProfile: handle((s, c) => s.saveProfile(c.req.body)),
  jobs: handle((s, c) => s.jobs(c.req.query)),
  files: handle((s) => s.files()),
  beginUpload: handle((s, c) => s.beginUpload(c.req.body)),
  completeUpload: handle((s, c) => s.completeUpload(c.params.id)),
  fileUrl: handle((s, c) => s.fileUrl(c.params.id)),
  hrFileUrl: handle((s, c) => s.fileUrl(c.params.id, true)),
  recruiterFileUrl: handle((s, c) => s.fileUrl(c.params.id, 'RECRUITER')),
  applications: handle((s) => s.applications()),
  apply: handle((s, c) => s.apply(c.req.body)),
  postings: handle((s) => s.postings()),
  savePosting: handle((s, c) => s.postings(c.req.body)),
};
