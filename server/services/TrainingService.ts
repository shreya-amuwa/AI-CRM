import type { TrainingEmployee, TrainingEnrollmentDetail, TrainingOverview, TrainingProgram, TrainingProgramDetail, TrainingRecords } from '../../shared/contracts.js';
import {
  trainingCancelSchema, trainingDaySchema, trainingEnrollSchema, trainingProgramSchema, trainingRecordsQuerySchema, trainingReportSchema, trainingReviewSchema, uuidSchema
} from '../../shared/validation.js';
import { AppError } from '../http/errors.js';
import { parse } from '../http/validate.js';
import type { TrainingRepository } from '../repositories/TrainingRepository.js';

/** HR training workspace. What a person may do is decided by the database (HR staff manage; the trainer of a day records that day). */
export class TrainingService {
  constructor(private readonly repo: TrainingRepository) {}

  overview(): Promise<TrainingOverview> { return this.repo.overview(); }
  programs(): Promise<TrainingProgram[]> { return this.repo.programs(); }
  employees(): Promise<TrainingEmployee[]> { return this.repo.employees(); }
  program(id: string): Promise<TrainingProgramDetail> { return this.repo.program(parse(uuidSchema, id)); }
  enrollment(id: string): Promise<TrainingEnrollmentDetail> { return this.repo.enrollment(parse(uuidSchema, id)); }
  records(query: unknown): Promise<TrainingRecords> { return this.repo.records(parse(trainingRecordsQuerySchema, query)); }
  saveProgram(body: unknown): Promise<TrainingProgram> { return this.repo.saveProgram(parse(trainingProgramSchema, body)); }
  cancelProgram(id: string, body: unknown): Promise<TrainingProgram> { return this.repo.cancelProgram(parse(uuidSchema, id), parse(trainingCancelSchema, body ?? {}).cancel); }
  saveDay(id: string, day: string, body: unknown): Promise<TrainingProgram> {
    const n = Number(day);
    if (![1, 2, 3].includes(n)) throw new AppError('VALIDATION_ERROR', 'A training program has three days.');
    return this.repo.saveDay(parse(uuidSchema, id), n, parse(trainingDaySchema, body));
  }
  enroll(id: string, body: unknown) { return this.repo.enroll(parse(uuidSchema, id), parse(trainingEnrollSchema, body).employeeKeys); }
  unenroll(id: string) { return this.repo.unenroll(parse(uuidSchema, id)); }
  saveReport(id: string, day: string, body: unknown) {
    const n = Number(day);
    if (![1, 2, 3].includes(n)) throw new AppError('VALIDATION_ERROR', 'A training program has three days.');
    return this.repo.saveReport(parse(uuidSchema, id), n, parse(trainingReportSchema, body));
  }
  review(id: string, body: unknown) { return this.repo.review(parse(uuidSchema, id), parse(trainingReviewSchema, body)); }
}
