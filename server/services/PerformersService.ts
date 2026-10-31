import type { PerformerEvaluationRun, PerformerRecognition, PerformersCompany, PerformersDepartment } from '../../shared/contracts.js';
import { performerDecisionSchema, performersEvaluateSchema, performersQuerySchema, uuidSchema } from '../../shared/validation.js';
import { hasServiceClient } from '../db/supabase.js';
import { parse } from '../http/validate.js';
import { aiSettings } from '../performance/ai.js';
import type { PerformersRepository } from '../repositories/PerformersRepository.js';
import { writeMissingEvaluations } from '../topPerformers/writer.js';

/**
 * Top performers and monthly recognition. Who may see what is decided by the database (a Department Head gets only their own department, an
 * Operations Head only the departments they manage, the Super Admin all; nobody else), and only the Department Head decides recognition.
 */
export class PerformersService {
  constructor(private readonly repo: PerformersRepository) {}

  department(query: unknown): Promise<PerformersDepartment> {
    return this.repo.department(parse(performersQuerySchema, query));
  }

  company(query: unknown): Promise<PerformersCompany> {
    const q = parse(performersQuerySchema, query);
    return this.repo.company({ month: q.month });
  }

  /**
   * Write the evaluations that are missing for the current figures of a department (AI when configured, otherwise rules) and return the fresh
   * rankings. The caller's permission is checked first by the database call that recalculates the department.
   */
  async evaluate(body: unknown): Promise<PerformerEvaluationRun> {
    const q = parse(performersEvaluateSchema, body);
    const before = await this.repo.department(q);
    const ai = aiSettings();
    if (!hasServiceClient() || before.evaluationsPending === 0) return { written: 0, ai: { configured: !!ai.apiKey, ok: 0, failed: 0 }, data: before };
    const run = await writeMissingEvaluations(before.department.id, before.month, { ai });
    return { ...run, data: await this.repo.department({ month: before.month, departmentId: q.departmentId }) };
  }

  decide(id: string, body: unknown): Promise<PerformerRecognition> {
    const input = parse(performerDecisionSchema, body);
    return this.repo.decide(parse(uuidSchema, id), input.decision, input.note);
  }
}
