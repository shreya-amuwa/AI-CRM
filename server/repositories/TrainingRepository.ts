import type { SupabaseClient } from '@supabase/supabase-js';
import type { TrainingEmployee, TrainingEnrollmentDetail, TrainingOverview, TrainingProgram, TrainingProgramDetail, TrainingRecords } from '../../shared/contracts.js';
import { unwrap } from './base.js';

/** HR training. Every function checks the caller itself: HR staff and the Super Admin manage everything, the trainer of a day can record that day. */
export class TrainingRepository {
  constructor(private readonly db: SupabaseClient) {}

  private async rpc<T>(name: string, args?: Record<string, unknown>): Promise<T> {
    return unwrap(await this.db.rpc(name, args)) as T;
  }

  overview() { return this.rpc<TrainingOverview>('hr_training_overview'); }
  programs() { return this.rpc<TrainingProgram[]>('hr_training_programs_list'); }
  employees() { return this.rpc<TrainingEmployee[]>('hr_training_employees'); }
  program(id: string) { return this.rpc<TrainingProgramDetail>('hr_training_program_get', { p_program: id }); }
  enrollment(id: string) { return this.rpc<TrainingEnrollmentDetail>('hr_training_enrollment_get', { p_enrollment: id }); }
  records(i: { search?: string; status?: string; limit: number; offset: number }) {
    return this.rpc<TrainingRecords>('hr_training_records', { p_search: i.search || null, p_status: i.status ?? null, p_limit: i.limit, p_offset: i.offset });
  }
  saveProgram(i: { id?: string; name: string; description?: string | null; startDate: string; ownerId?: string | null }) {
    return this.rpc<TrainingProgram>('hr_training_program_save', { p_id: i.id ?? null, p_name: i.name, p_description: i.description ?? null, p_start: i.startDate, p_owner: i.ownerId ?? null });
  }
  cancelProgram(id: string, cancel: boolean) { return this.rpc<TrainingProgram>('hr_training_program_cancel', { p_program: id, p_cancel: cancel }); }
  saveDay(program: string, day: number, i: { title: string; topics: string[]; trainerName?: string | null; trainerId?: string | null; criteria: { name: string; max: number }[]; passPercent?: number | null }) {
    return this.rpc<TrainingProgram>('hr_training_day_save', {
      p_program: program, p_day: day, p_title: i.title, p_topics: i.topics, p_trainer_name: i.trainerName ?? null, p_trainer_id: i.trainerId ?? null, p_criteria: i.criteria, p_pass_percent: i.passPercent ?? null
    });
  }
  enroll(program: string, keys: string[]) { return this.rpc<{ added: number; skipped: number; unknown: string[] }>('hr_training_enroll', { p_program: program, p_employee_keys: keys }); }
  async unenroll(enrollment: string): Promise<void> { await this.rpc('hr_training_unenroll', { p_enrollment: enrollment }); }
  saveReport(enrollment: string, day: number, i: { attendance?: string | null; topicsCompleted: string[]; tasks: { title: string; done: boolean }[]; scores: { criterion: string; score: number }[]; feedback?: string | null; trainerRemarks?: string | null; report?: string | null }) {
    return this.rpc<{ dayNo: number; completed: boolean; status: string; assessmentResult: string | null }>('hr_training_report_save', {
      p_enrollment: enrollment, p_day: day, p_attendance: i.attendance ?? null, p_topics_completed: i.topicsCompleted, p_tasks: i.tasks, p_scores: i.scores,
      p_feedback: i.feedback ?? null, p_trainer_remarks: i.trainerRemarks ?? null, p_report: i.report ?? null
    });
  }
  review(enrollment: string, i: { strengths?: string | null; improvements?: string | null; trainerRemarks?: string | null }) {
    return this.rpc<{ id: string; status: string }>('hr_training_enrollment_review', { p_enrollment: enrollment, p_strengths: i.strengths ?? null, p_improvements: i.improvements ?? null, p_remarks: i.trainerRemarks ?? null });
  }
}
