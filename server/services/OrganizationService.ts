import type { Department, Team } from '../../shared/contracts.js';
import {
  departmentCreateSchema,
  departmentUpdateSchema,
  teamCreateSchema,
  teamListQuerySchema,
  teamUpdateSchema,
  uuidSchema
} from '../../shared/validation.js';
import type { Actor } from '../auth/authenticate.js';
import { assertCanManageTeamsIn, assertSuperAdmin } from '../authz/policies.js';
import { parse } from '../http/validate.js';
import { OrganizationRepository } from '../repositories/OrganizationRepository.js';

const slugify = (name: string) =>
  name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

export class OrganizationService {
  constructor(private readonly org: OrganizationRepository) {}

  listDepartments(): Promise<Department[]> {
    return this.org.listDepartments();
  }

  createDepartment(actor: Actor, body: unknown): Promise<Department> {
    assertSuperAdmin(actor);
    const input = parse(departmentCreateSchema, body);
    return this.org.createDepartment({ ...input, slug: input.slug || slugify(input.name) });
  }

  updateDepartment(actor: Actor, id: string, body: unknown): Promise<Department> {
    assertSuperAdmin(actor);
    return this.org.updateDepartment(parse(uuidSchema, id), parse(departmentUpdateSchema, body));
  }

  deleteDepartment(actor: Actor, id: string): Promise<void> {
    assertSuperAdmin(actor);
    return this.org.deleteDepartment(parse(uuidSchema, id));
  }

  listTeams(query: unknown): Promise<Team[]> {
    return this.org.listTeams(parse(teamListQuerySchema, query).departmentId);
  }

  createTeam(actor: Actor, body: unknown): Promise<Team> {
    const input = parse(teamCreateSchema, body);
    assertCanManageTeamsIn(actor, input.departmentId);
    return this.org.createTeam(input);
  }

  async updateTeam(actor: Actor, id: string, body: unknown): Promise<Team> {
    const team = await this.org.findTeam(parse(uuidSchema, id));
    assertCanManageTeamsIn(actor, team.departmentId);
    return this.org.updateTeam(team.id, parse(teamUpdateSchema, body));
  }

  async deleteTeam(actor: Actor, id: string): Promise<void> {
    const team = await this.org.findTeam(parse(uuidSchema, id));
    assertCanManageTeamsIn(actor, team.departmentId);
    await this.org.deleteTeam(team.id);
  }
}
