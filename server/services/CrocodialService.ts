import type {
  CrocodialAdminOverview, CrocodialConnection, CrocodialMapping, CrocodialMappingCheck, CrocodialMyStatus, CrocodialTestResult
} from '../../shared/contracts.js';
import {
  crocodialConnectionSaveSchema, crocodialDepartmentLinkSchema, crocodialMappingSchema, crocodialRevokeSchema, crocodialRolloutSchema, uuidSchema
} from '../../shared/validation.js';
import { crocodialToken } from '../crocodial/client.js';
import { testCrocodialConnection } from '../crocodial/directory.js';
import { parse } from '../http/validate.js';
import type { CrocodialRepository } from '../repositories/CrocodialRepository.js';

/**
 * The Crocodial integration's configuration (Super Admin) and an employee's own switch. Every rule (who may configure, the rollout, who can
 * be mapped, who sees what) is enforced by the database; this layer validates the input, tells the Super Admin whether the server has the
 * token setting a connection names (a yes / no, never the value), and runs "Test connection" after the database has checked the caller.
 */
export class CrocodialService {
  constructor(private readonly repo: CrocodialRepository, private readonly env: NodeJS.ProcessEnv = process.env) {}

  private withCredential(c: CrocodialConnection): CrocodialConnection {
    return { ...c, credentialConfigured: crocodialToken(c.credentialRef, this.env) !== null };
  }

  async overview(): Promise<CrocodialAdminOverview> {
    const o = await this.repo.overview();
    return { ...o, connections: o.connections.map(c => this.withCredential(c)) };
  }
  async rolloutSet(body: unknown): Promise<CrocodialAdminOverview> {
    const b = parse(crocodialRolloutSchema, body);
    await this.repo.rolloutSet(b.departmentId, b.division, b.allowed, b.note ?? null);
    return this.overview();
  }
  async connectionSave(body: unknown): Promise<CrocodialConnection> {
    const b = parse(crocodialConnectionSaveSchema, body);
    return this.withCredential(await this.repo.connectionSave({ ...b, externalAccountLabel: b.externalAccountLabel ?? null }));
  }
  async testConnection(id: string): Promise<CrocodialTestResult> {
    // the database checks the caller is the Super Admin and returns the setting's NAME; the server reads the token from its own environment
    const c = await this.repo.connection(parse(uuidSchema, id));
    return testCrocodialConnection({ id: c.id, credentialRef: c.credentialRef }, { env: this.env }) as Promise<CrocodialTestResult>;
  }
  departmentLinkSave(body: unknown) {
    const b = parse(crocodialDepartmentLinkSchema, body);
    return this.repo.departmentLinkSave(b.connectionId, b.departmentId, b.division, b.enabled, b.stage);
  }
  mappingCheck(body: unknown): Promise<CrocodialMappingCheck> {
    const b = parse(crocodialMappingSchema, body);
    return this.repo.mappingCheck(b.connectionId, b.externalEmployeeId, b.profileId, b.departmentId);
  }
  mappingCreate(body: unknown): Promise<CrocodialMapping> {
    const b = parse(crocodialMappingSchema, body);
    return this.repo.mappingCreate(b.connectionId, b.externalEmployeeId, b.profileId, b.departmentId);
  }
  mappingApprove(id: string): Promise<CrocodialMapping> { return this.repo.mappingApprove(parse(uuidSchema, id)); }
  mappingRevoke(id: string, body: unknown): Promise<CrocodialMapping> {
    return this.repo.mappingRevoke(parse(uuidSchema, id), parse(crocodialRevokeSchema, body ?? {}).reason ?? null);
  }
  myStatus(): Promise<CrocodialMyStatus> { return this.repo.myStatus(); }
}
