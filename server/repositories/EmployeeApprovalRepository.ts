import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  DepartmentEmployeeDirectory, EmployeeRequest, OperationsActivityEntry, OperationsDashboard, OperationsDepartmentDetail, OperationsHeadAdmin, OperationsHeadsAdmin,
  TeamAssignmentRecord
} from '../../shared/contracts.js';
import type { EmployeeRequestInput } from '../../shared/validation.js';
import { unwrap } from './base.js';

const DB_ROLE: Record<EmployeeRequestInput['role'], 'DEPARTMENT_HEAD' | 'TEAM_HEAD' | 'TEAM_MEMBER'> = {
  OPERATIONS_HEAD: 'DEPARTMENT_HEAD', DEPARTMENT_HEAD: 'DEPARTMENT_HEAD', TEAM_HEAD: 'TEAM_HEAD', TEAM_MEMBER: 'TEAM_MEMBER'
};

/** Employee requests, Operations Head scope and Department Head team assignment. Every rule is enforced by the database functions; this only calls them. */
export class EmployeeApprovalRepository {
  constructor(private readonly db: SupabaseClient) {}

  /** The database refuses a submission the caller may not make (and a duplicate e-mail or a second head) BEFORE any sign-in is created. */
  async assertCanSubmit(i: { email: string; role: EmployeeRequestInput['role']; departmentId: string; division?: string | null }): Promise<void> {
    unwrap(await this.db.rpc('assert_can_submit_employee', {
      p_email: i.email, p_role: DB_ROLE[i.role], p_operations_head: i.role === 'OPERATIONS_HEAD', p_department: i.departmentId, p_division: i.division ?? null
    }));
  }

  /** The department / role / designation combination is checked by the database before any account or request is made. */
  async assertDesignationAllowed(i: { role: EmployeeRequestInput['role']; departmentId: string; designation: string }): Promise<void> {
    unwrap(await this.db.rpc('assert_designation_allowed', {
      p_department: i.departmentId, p_team: null, p_role: DB_ROLE[i.role], p_designation: i.designation, p_operations_head: i.role === 'OPERATIONS_HEAD'
    }));
  }

  async list(status: string | null, toDecide: boolean): Promise<EmployeeRequest[]> {
    return unwrap(await this.db.rpc('employee_requests_list', { p_status: status, p_to_decide: toDecide, p_limit: 300 })) as EmployeeRequest[];
  }
  async get(id: string): Promise<EmployeeRequest> {
    return unwrap(await this.db.rpc('employee_request_get', { p_request: id })) as EmployeeRequest;
  }
  async decide(id: string, approve: boolean, note: string | null, departmentIds: string[] | null, primaryIds: string[] | null): Promise<EmployeeRequest> {
    return unwrap(await this.db.rpc('employee_request_decide', { p_request: id, p_approve: approve, p_note: note, p_departments: departmentIds, p_primary: primaryIds })) as EmployeeRequest;
  }
  async resubmit(id: string, i: { role: EmployeeRequestInput['role']; departmentId: string; division?: string | null; position?: string | null; employeeCode?: string | null }): Promise<EmployeeRequest> {
    return unwrap(await this.db.rpc('employee_request_resubmit', {
      p_request: id, p_role: DB_ROLE[i.role], p_operations_head: i.role === 'OPERATIONS_HEAD', p_department: i.departmentId,
      p_division: i.division ?? null, p_position: i.position ?? null, p_employee_code: i.employeeCode ?? null
    })) as EmployeeRequest;
  }

  // Super Admin: Operations Heads and the departments they manage
  async operationsHeads(): Promise<OperationsHeadsAdmin> { return unwrap(await this.db.rpc('operations_heads_list')) as OperationsHeadsAdmin; }
  async setScope(profileId: string, departmentIds: string[], primaryIds: string[] | null): Promise<OperationsHeadAdmin> {
    return unwrap(await this.db.rpc('operations_head_scope_set', { p_profile: profileId, p_departments: departmentIds, p_primary: primaryIds })) as OperationsHeadAdmin;
  }
  async headActivity(profileId: string): Promise<OperationsActivityEntry[]> {
    return unwrap(await this.db.rpc('operations_head_activity', { p_profile: profileId, p_limit: 100 })) as OperationsActivityEntry[];
  }

  // Operations Head
  async dashboard(): Promise<OperationsDashboard> { return unwrap(await this.db.rpc('operations_dashboard')) as OperationsDashboard; }
  async departmentActivity(departmentId: string): Promise<OperationsActivityEntry[]> {
    return unwrap(await this.db.rpc('operations_department_activity', { p_department: departmentId, p_limit: 60 })) as OperationsActivityEntry[];
  }
  async departmentDetail(departmentId: string): Promise<OperationsDepartmentDetail> {
    return unwrap(await this.db.rpc('operations_department_detail', { p_department: departmentId })) as OperationsDepartmentDetail;
  }

  // Department Head
  async directory(departmentId: string | null): Promise<DepartmentEmployeeDirectory> {
    return unwrap(await this.db.rpc('department_employee_directory', { p_department: departmentId })) as DepartmentEmployeeDirectory;
  }
  async assignToLead(memberId: string, leadId: string, note: string | null): Promise<void> {
    unwrap(await this.db.rpc('assign_member_to_team_lead', { p_member: memberId, p_lead: leadId, p_note: note }));
  }
  async assignments(memberId: string): Promise<TeamAssignmentRecord[]> {
    const rows = unwrap(await this.db.from('team_assignments')
      .select('id, kind, note, created_at, from_team:teams!team_assignments_from_team_id_fkey(name), to_team:teams!team_assignments_to_team_id_fkey(name), lead:profiles!team_assignments_lead_id_fkey(full_name), by:profiles!team_assignments_assigned_by_fkey(full_name)')
      .eq('profile_id', memberId).order('created_at', { ascending: false }).limit(100)) as any[];
    return rows.map(r => ({ id: r.id, kind: r.kind, note: r.note, createdAt: r.created_at, fromTeam: r.from_team?.name ?? null, toTeam: r.to_team?.name ?? null, lead: r.lead?.full_name ?? null, assignedBy: r.by?.full_name ?? null }));
  }
}
