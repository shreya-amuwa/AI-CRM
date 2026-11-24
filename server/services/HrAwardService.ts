import type { HrAwardDetail, HrAwardOptions, HrAwardsOverview } from '../../shared/contracts.js';
import {
  awardCodeSchema, awardDeclareWinnersSchema, awardMonthQuerySchema, awardNominateSchema, awardNomineeRemoveSchema, awardNomineeUpdateSchema,
  awardWinnerRevokeSchema, awardWinnerUpdateSchema, uuidSchema
} from '../../shared/validation.js';
import { parse } from '../http/validate.js';
import type { HrAwardRepository } from '../repositories/HrAwardRepository.js';

/** The database takes the award month as its first day. */
const firstDay = (month: string) => `${month}-01`;

/**
 * HR Awards (migration 20270203000100): seven monthly awards with any number of nominees and winners per month.
 * This layer validates; the database decides who may (HR staff and the Super Admin) and keeps every month's records.
 * Every change returns the award's detail as it now is, so the screen shows the saved state.
 */
export class HrAwardService {
  constructor(private readonly repo: HrAwardRepository) {}
  overview(query: unknown): Promise<HrAwardsOverview> { return this.repo.overview(firstDay(parse(awardMonthQuerySchema, query ?? {}).month)); }
  detail(code: string, query: unknown): Promise<HrAwardDetail> {
    return this.repo.detail(parse(awardCodeSchema, code), firstDay(parse(awardMonthQuerySchema, query ?? {}).month));
  }
  options(): Promise<HrAwardOptions> { return this.repo.options(); }
  nominate(code: string, body: unknown): Promise<HrAwardDetail> {
    const i = parse(awardNominateSchema, body);
    return this.repo.nominate(parse(awardCodeSchema, code), { ...i, month: firstDay(i.month) });
  }
  updateNominee(id: string, body: unknown): Promise<HrAwardDetail> {
    const i = parse(awardNomineeUpdateSchema, body);
    return this.repo.updateNominee(parse(uuidSchema, id), i.reason, i.remarks);
  }
  removeNominee(id: string, body: unknown): Promise<HrAwardDetail> {
    const i = parse(awardNomineeRemoveSchema, body ?? {});
    return this.repo.removeNominee(parse(uuidSchema, id), i.reason?.trim() || null);
  }
  declareWinners(body: unknown): Promise<HrAwardDetail> {
    const i = parse(awardDeclareWinnersSchema, body);
    return this.repo.declareWinners([...new Set(i.nomineeIds)], i.remarks);
  }
  updateWinner(id: string, body: unknown): Promise<HrAwardDetail> {
    return this.repo.updateWinner(parse(uuidSchema, id), parse(awardWinnerUpdateSchema, body).remarks);
  }
  revokeWinner(id: string, body: unknown): Promise<HrAwardDetail> {
    return this.repo.revokeWinner(parse(uuidSchema, id), parse(awardWinnerRevokeSchema, body).reason);
  }
}
