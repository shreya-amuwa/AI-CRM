import type { LeadTag } from '../../shared/contracts.js';
import { leadTagListQuerySchema, leadTagRetireSchema, leadTagSaveSchema, leadTagSetSchema, uuidSchema } from '../../shared/validation.js';
import { enforce } from '../http/rateLimit.js';
import { parse } from '../http/validate.js';
import type { LeadTagRepository } from '../repositories/LeadTagRepository.js';

/**
 * Lead tags (migration 20270305000100). This layer validates and rate limits creation; the database decides who may manage which tag
 * (the Managing Director: any; a CEO: department tags for departments they run), refuses duplicates, and moves leads when a tag's stage
 * or departments change. Tagging a lead follows the lead's own edit rules.
 */
export class LeadTagService {
  constructor(private readonly repo: LeadTagRepository) {}
  list(query: unknown): Promise<LeadTag[]> {
    return this.repo.list(parse(leadTagListQuerySchema, query ?? {}).departmentId ?? null);
  }
  /** Create (no id) or change a tag. Creating is limited to 30 tags a day per person. */
  async save(actorId: string, body: unknown): Promise<LeadTag> {
    const input = parse(leadTagSaveSchema, body);
    if (!input.id) await enforce([{ key: 'lead-tag-create:' + actorId, limit: 30, window: 86400 }], 'shared');
    return this.repo.save(input);
  }
  retire(id: string, body: unknown): Promise<LeadTag> {
    return this.repo.retire(parse(uuidSchema, id), parse(leadTagRetireSchema, body).retired);
  }
  async setOnLead(leadId: string, body: unknown): Promise<{ id: string; tagId: string }> {
    const id = parse(uuidSchema, leadId);
    const { tagId } = parse(leadTagSetSchema, body);
    await this.repo.setOnLead(id, tagId);
    return { id, tagId };
  }
}
