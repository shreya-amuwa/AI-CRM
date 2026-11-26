import type { TaskDeletePreview, TaskDeleteResult } from '../../shared/contracts.js';
import { uuidSchema } from '../../shared/validation.js';
import { parse } from '../http/validate.js';
import type { WorkTaskRepository } from '../repositories/WorkTaskRepository.js';

/** Task module deletion: the id is validated here; who may delete is decided by the database function. */
export class WorkTaskService {
  constructor(private readonly repo: WorkTaskRepository) {}

  deletePreview(id: string): Promise<TaskDeletePreview> { return this.repo.deletePreview(parse(uuidSchema, id)); }
  remove(id: string): Promise<TaskDeleteResult> { return this.repo.remove(parse(uuidSchema, id)); }
}
