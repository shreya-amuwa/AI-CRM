import type { DevBug, DevBugAccess, DevBugList, DevBugRow, DevTeamMember } from '../../shared/contracts.js';
import { bugAssignSchema, bugCommentSchema, bugListQuerySchema, bugStatusSchema, bugSubmitSchema, devTeamSetSchema, uuidSchema } from '../../shared/validation.js';
import { parse } from '../http/validate.js';
import type { BugRepository } from '../repositories/BugRepository.js';

/**
 * Bugs for the Developers team (migration 20270122000300). The database decides who may do what from the caller's own login: an employee
 * reports and follows their own bugs; only the developers on the list (Shreya Mande, Ashish Sinha, Siddhesh Shinde) open the Bugs section;
 * the Super Admin keeps that list. This layer only validates. Files use the existing issue upload / download routes.
 */
export class BugService {
  constructor(private readonly repo: BugRepository) {}
  access(): Promise<DevBugAccess> { return this.repo.access(); }
  submit(body: unknown): Promise<DevBug> { return this.repo.submit(parse(bugSubmitSchema, body)); }
  mine(): Promise<DevBugRow[]> { return this.repo.mine(); }
  myDetail(id: string): Promise<DevBug> { return this.repo.myDetail(parse(uuidSchema, id)); }
  list(query: unknown): Promise<DevBugList> { return this.repo.list(parse(bugListQuerySchema, query ?? {})); }
  detail(id: string): Promise<DevBug> { return this.repo.detail(parse(uuidSchema, id)); }
  assign(id: string, body: unknown): Promise<DevBug> { return this.repo.assign(parse(uuidSchema, id), parse(bugAssignSchema, body).developerId); }
  setStatus(id: string, body: unknown): Promise<DevBug> {
    const i = parse(bugStatusSchema, body);
    return this.repo.setStatus(parse(uuidSchema, id), i.status, i.note);
  }
  comment(id: string, body: unknown): Promise<DevBug> { return this.repo.comment(parse(uuidSchema, id), parse(bugCommentSchema, body).note); }
  team(): Promise<DevTeamMember[]> { return this.repo.team(); }
  setTeam(body: unknown): Promise<DevTeamMember[]> {
    const i = parse(devTeamSetSchema, body);
    return this.repo.setTeam(i.profileId, i.member);
  }
}
