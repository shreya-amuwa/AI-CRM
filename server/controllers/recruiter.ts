import type { SupabaseClient } from '@supabase/supabase-js';
import type { ApiRequest, HandlerResult } from '../http/types.js';
import { RecruiterRepository } from '../recruitment/RecruiterRepository.js';
import { RecruiterService } from '../recruitment/RecruiterService.js';
import { recruitmentEmailQuietly } from '../recruitment/emailDispatcher.js';

interface RecruiterContextArgs { db: SupabaseClient; req: ApiRequest; params: Record<string, string> }
type Action = (s: RecruiterService, c: RecruiterContextArgs) => Promise<unknown>;
const handle = (fn: Action) => async (c: RecruiterContextArgs): Promise<HandlerResult> => ({ data: await fn(new RecruiterService(new RecruiterRepository(c.db)), c) });

/**
 * HR Recruiter workspace endpoints. The final decision is the only route that ends in an e-mail, and it does not mention one: the database queued the
 * e-mail event in the same transaction as the decision, and the server sends it afterwards on its own (never failing or undoing the decision).
 */
const decided = (fn: Action): Action => async (s, c) => {
  const result = await fn(s, c);
  await recruitmentEmailQuietly();
  return result;
};

export const recruiterController = {
  context: handle(s => s.context()),
  directory: handle(s => s.directory()),
  filterOptions: handle(s => s.filterOptions()),
  overview: handle((s, c) => s.overview(c.req.query)),
  vacancies: handle((s, c) => s.vacancies(c.req.query)),
  vacancy: handle((s, c) => s.vacancy(c.params.id)),
  assignVacancy: handle((s, c) => s.assignVacancy(c.params.id, c.req.body)),
  vacancyStatus: handle((s, c) => s.vacancyStatus(c.params.id, c.req.body)),
  createVacancy: handle((s, c) => s.saveVacancy(null, c.req.body)),
  updateVacancy: handle((s, c) => s.saveVacancy(c.params.id, c.req.body)),
  applications: handle((s, c) => s.applications(c.req.query)),
  pipeline: handle((s, c) => s.pipeline(c.req.query)),
  application: handle((s, c) => s.application(c.params.id)),
  addNote: handle((s, c) => s.addNote(c.params.id, c.req.body)),
  stage: handle((s, c) => s.stage(c.params.id, c.req.body)),
  tests: handle(s => s.tests()),
  invite: handle((s, c) => s.invite(c.params.id, c.req.body)),
  calls: handle(s => s.calls()),
  saveCall: handle((s, c) => s.saveCall(c.params.id, c.req.body)),
  interviews: handle(s => s.interviews()),
  saveInterview: handle((s, c) => s.saveInterview(c.params.id, c.req.body)),
  decide: handle(decided((s, c) => s.decide(c.params.id, c.req.body))),
  correctDecision: handle(decided((s, c) => s.correctDecision(c.params.id, c.req.body))),
  decisions: handle((s, c) => s.decisions(c.req.query)),
  reports: handle((s, c) => s.reports(c.req.query)),
  // technical, Super Admin only (the database refuses everyone else); there is no screen for these
  emailRecords: handle((s, c) => s.emailRecords(c.req.query)),
  emailRequeue: handle(async (s, c) => {
    const r = await s.emailRequeue(c.params.id);
    await recruitmentEmailQuietly();
    return r;
  })
};
