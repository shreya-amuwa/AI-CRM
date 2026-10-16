import { getSupabase } from '../services/supabaseClient';
import type { Employee, EmployeeStatus } from '../types/amuwaHq';

/**
 * Data access for the HR dashboard (migration 20261013000100_hr_employee_directory.sql).
 *
 * The employee list is the database: every CRM member (profiles) merged with
 * the HR record kept for them (hr_employees), plus HR-only records. The
 * function behind it is limited to HR staff and Super Admins.
 */

export interface HrDepartment {
  id: string;
  slug: string;
  name: string;
  headName: string | null;
  memberCount: number;
  isLocked: boolean;
}

export interface HrDirectory {
  employees: Employee[];
  pending: Employee[];
  departments: HrDepartment[];
}

interface DirectoryRow {
  source: 'account' | 'hr_record';
  profileId: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  designation: string | null;
  role: 'DEPARTMENT_HEAD' | 'TEAM_HEAD' | 'TEAM_MEMBER' | null;
  accountStatus: Employee['accountStatus'] | null;
  approvalStatus: 'PENDING' | 'APPROVED' | 'REJECTED';
  approvedAt?: string | null;
  approvedBy?: string | null;
  createdAt: string | null;
  departmentSlug: string | null;
  departmentName: string | null;
  teamName?: string | null;
  teamLead?: string | null;
  departmentHead?: string | null;
  hrRecordId: string | null;
  hrStatus: string | null;
  joiningDate: string | null;
  monthlySalary: string | null;
  workingHours: string | null;
  hrData: { documentsCollected?: boolean; notes?: string; leftDate?: string; trainingEndDate?: string };
}

export const ROLE_LABEL: Record<string, string> = {
  DEPARTMENT_HEAD: 'Department Head',
  TEAM_HEAD: 'Team Lead',
  TEAM_MEMBER: 'Team Member'
};

const HR_STATUSES: EmployeeStatus[] = ['Full-Time', 'Training / Probation', 'Intern', 'Left'];
const DEFAULT_HOURS = '09:30 AM - 06:30 PM (Mon-Sat)';

function db() {
  const supabase = getSupabase();
  if (!supabase) throw new Error('The CRM is not connected to its database.');
  return supabase;
}

function toEmployee(r: DirectoryRow): Employee {
  const inactive = r.accountStatus === 'REVOKED' || r.accountStatus === 'SUSPENDED';
  const hrStatus = HR_STATUSES.find(s => s === r.hrStatus) ?? 'Full-Time';
  const joined = r.joiningDate || (r.approvedAt || r.createdAt || '').slice(0, 10);
  const roleLabel = r.role ? ROLE_LABEL[r.role] : undefined;
  return {
    id: r.hrRecordId || (r.profileId ? `EMP-${r.profileId.slice(0, 8).toUpperCase()}` : ''),
    name: r.name,
    email: r.email || '',
    phone: r.phone || '',
    designation: r.designation || roleLabel || '',
    departmentId: r.departmentSlug || '',
    status: inactive ? 'Left' : hrStatus,
    joiningDate: joined,
    trainingEndDate: r.hrData?.trainingEndDate,
    leftDate: r.hrData?.leftDate,
    workingHours: r.workingHours || DEFAULT_HOURS,
    monthlySalary: r.monthlySalary || '',
    documentsCollected: !!r.hrData?.documentsCollected,
    uploadedDocs: [],
    leaveHistory: [],
    halfDaysCount: 0,
    totalLeavesCount: 0,
    notes: r.hrData?.notes,
    profileId: r.profileId ?? undefined,
    source: r.source,
    departmentName: r.departmentName ?? undefined,
    departmentSlug: r.departmentSlug ?? undefined,
    roleLabel,
    teamName: r.teamName ?? undefined,
    teamLead: r.teamLead ?? undefined,
    departmentHead: r.departmentHead ?? undefined,
    accountStatus: r.accountStatus ?? undefined,
    approvalStatus: r.approvalStatus,
    approvedBy: r.approvedBy ?? undefined
  };
}

/** One row per person: CRM members merged with their HR record. */
export async function fetchHrDirectory(): Promise<HrDirectory> {
  const { data, error } = await db().rpc('hr_employee_directory');
  if (error) throw new Error(error.message.replace(/^[A-Z_]+:\s*/, ''));
  const rows = ((data?.employees ?? []) as DirectoryRow[]).map(toEmployee);
  // Details collected when a member is added (joining date, birth date, blood group, emergency contact, designation).
  // A database that has not applied that migration yet simply has none.
  const details = await db().rpc('hr_personal_details');
  const byProfile = new Map<string, Record<string, string | null>>(
    ((details.error ? [] : details.data) as Record<string, string | null>[]).map(d => [d.profileId as string, d])
  );
  for (const e of rows) {
    const d = e.profileId ? byProfile.get(e.profileId) : undefined;
    if (!d) continue;
    if (d.joiningDate) e.joiningDate = d.joiningDate;
    e.dateOfBirth = d.dateOfBirth ?? undefined;
    e.bloodGroup = d.bloodGroup ?? undefined;
    e.emergencyContact = d.emergencyContact ?? undefined;
    e.designationType = d.designation ?? undefined;
  }
  return {
    employees: rows.filter(e => e.approvalStatus === 'APPROVED'),
    pending: rows.filter(e => e.approvalStatus === 'PENDING'),
    departments: (data?.departments ?? []) as HrDepartment[]
  };
}

/** Saves the HR-only part of a person (type, salary, documents, left date). */
export async function saveHrRecord(emp: Employee): Promise<void> {
  const { error } = await db().from('hr_employees').upsert({
    id: emp.id,
    name: emp.name,
    email: emp.email || null,
    phone: emp.phone || null,
    designation: emp.designation || null,
    department_id: emp.departmentSlug || emp.departmentId || null,
    status: emp.status,
    joining_date: emp.joiningDate || null,
    monthly_salary: emp.monthlySalary || null,
    working_hours: emp.workingHours || DEFAULT_HOURS,
    profile_id: emp.profileId ?? null,
    data: {
      documentsCollected: emp.documentsCollected,
      notes: emp.notes ?? null,
      leftDate: emp.leftDate ?? null,
      trainingEndDate: emp.trainingEndDate ?? null
    },
    updated_at: new Date().toISOString()
  });
  if (error) throw new Error(error.message);
}
