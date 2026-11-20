import React, { useEffect, useMemo, useState } from 'react';
import { UserPlus } from 'lucide-react';
import type { EmployeeRequest } from '../../../shared/contracts';
import { BLOOD_GROUPS, EMPLOYEE_REQUEST_ROLES, HR_DESIGNATIONS, HR_DESIGNATION_ROLE, designationProblem, employeeRequestSchema, type EmployeeRequestRole, type HrDesignation } from '../../../shared/validation';
import { useDepartments } from '../../context/DepartmentContext';
import { errorMessage } from '../../lib/api/client';
import { employeesApi } from '../../lib/api/endpoints';
import { requestSidesForDepartment, staffChoicesForDepartment } from '../../lib/auth/departmentRoles';
import { btn, inputCls } from '../team-member/pipeline/shared';

const SIDE_LABEL = { SALES: 'Sales', SUPPORT: 'Support', GENERAL: 'General' } as const;

export const ROLE_LABEL: Record<EmployeeRequestRole, string> = {
  OPERATIONS_HEAD: 'Operations Head', DEPARTMENT_HEAD: 'Department Head', TEAM_HEAD: 'Team Lead', TEAM_MEMBER: 'Team Member'
};
/** Who approves which role (the database decides; this only tells the person submitting what will happen). */
export const APPROVER_LABEL: Record<EmployeeRequestRole, string> = {
  OPERATIONS_HEAD: 'the Super Admin', DEPARTMENT_HEAD: 'the Operations Head who owns the department', TEAM_HEAD: 'the Department Head', TEAM_MEMBER: 'the Department Head'
};

/** The title of the approver, for the confirmation (the database decides who it is). */
const APPROVER_TITLE: Record<EmployeeRequestRole, string> = { OPERATIONS_HEAD: 'Super Admin', DEPARTMENT_HEAD: 'Operations Head', TEAM_HEAD: 'Department Head', TEAM_MEMBER: 'Department Head' };

const label = 'block text-xs font-semibold text-slate-700';

/**
 * Employee request: HR (any role of the HR department) asks for an Operations Head, Department Head, Team Lead or Team Member. Nobody becomes active here: the request
 * goes to the approver the database picks (for a Team Member or Team Lead: the Department Head), and the person signs in only after it is approved.
 * A Team Lead does not use this form: they add a Team Member of their own team directly (Team Members > Add Team Member).
 */
export const EmployeeRequestForm: React.FC<{ onSubmitted?: (request: EmployeeRequest) => void }> = ({ onSubmitted }) => {
  const { departments } = useDepartments();
  const usable = useMemo(() => departments.filter(d => d.dbId), [departments]);
  const [pickedRole, setRole] = useState<EmployeeRequestRole>('TEAM_MEMBER');
  const [departmentId, setDepartmentId] = useState('');
  const [hrDesignation, setHrDesignation] = useState<HrDesignation>('HR Assistant');
  const [division, setDivision] = useState<'SALES' | 'SUPPORT' | 'GENERAL' | ''>('');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [employeeCode, setEmployeeCode] = useState('');
  const [joiningDate, setJoiningDate] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [bloodGroup, setBloodGroup] = useState('');
  const [contactNumber, setContactNumber] = useState('');
  const [emergencyContact, setEmergencyContact] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<EmployeeRequest | null>(null);
  const [saving, setSaving] = useState(false);

  // The HR department has its own three designations instead of the generic roles: HR Assistant, HR Recruiter, HR Admin Head (the Department Head of HR). The choice maps to
  // the existing role, so the approval route is unchanged (a Department Head still needs the Super Admin / Operations Head). The database checks the same rule.
  const deptSlug = usable.find(d => d.dbId === departmentId)?.id;
  const isHrDept = deptSlug === 'hr';
  // Amuwa Design Studio: Department Head, Team Lead and Team Member only, and no Sales / Support side (the database refuses them too)
  const roles = useMemo(() => staffChoicesForDepartment(deptSlug, EMPLOYEE_REQUEST_ROLES), [deptSlug]);
  const sides = useMemo(() => requestSidesForDepartment(deptSlug), [deptSlug]);
  // switching the department never keeps a role or side the new department does not have
  useEffect(() => { if (!roles.includes(pickedRole)) setRole('TEAM_MEMBER'); }, [roles, pickedRole]);
  useEffect(() => { if (division && !sides.includes(division)) setDivision(''); }, [sides, division]);
  const role: EmployeeRequestRole = isHrDept ? HR_DESIGNATION_ROLE[hrDesignation] : pickedRole;
  // choosing HR clears a generic role that does not exist there (Operations Head / Team Lead), and leaving HR starts again from Team Member
  useEffect(() => { setRole('TEAM_MEMBER'); }, [isHrDept]);

  const reset = () => {
    setFullName(''); setEmail(''); setEmployeeCode(''); setJoiningDate(''); setDateOfBirth(''); setBloodGroup(''); setContactNumber(''); setEmergencyContact('');
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setDone(null);
    const mismatch = designationProblem({ departmentSlug: isHrDept ? 'hr' : undefined, role, designation: isHrDept ? hrDesignation : ROLE_LABEL[role], operationsHead: role === 'OPERATIONS_HEAD' });
    if (mismatch) return setError(mismatch);
    const parsed = employeeRequestSchema.safeParse({
      email, fullName, role, departmentId: departmentId || undefined, division: division || undefined, employeeCode: employeeCode || undefined,
      details: { designation: isHrDept ? hrDesignation : ROLE_LABEL[role], joiningDate, dateOfBirth, bloodGroup, contactNumber, emergencyContact }
    });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message || 'Please check the form.');
    setSaving(true);
    try {
      const request = await employeesApi.submit(parsed.data);
      setDone(request);
      reset();
      window.dispatchEvent(new Event('crm:employee-requests-changed'));
      onSubmitted?.(request);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="bg-white rounded-2xl border border-slate-200/80 p-5 space-y-4" aria-label="Employee request">
      <div className="flex items-center gap-3">
        <span className="w-9 h-9 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0" aria-hidden="true"><UserPlus className="w-4 h-4" /></span>
        <div>
          <h2 className="font-bold text-slate-900">New employee request</h2>
          <p className="text-xs text-slate-500">This employee needs approval first: the account stays inactive until {APPROVER_LABEL[role]} approves it. You are told the result. After the approval the employee is e-mailed a secure link to choose their own password, so nobody types or sees a password here.</p>
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <label className={label}>{role === 'OPERATIONS_HEAD' ? 'Home department' : 'Department'}
          <select className={`${inputCls} mt-1`} value={departmentId} onChange={e => setDepartmentId(e.target.value)} required>
            <option value="">Choose a department</option>
            {usable.map(d => <option key={d.dbId} value={d.dbId}>{d.name}</option>)}
          </select>
        </label>
        {isHrDept ? (
          <label className={label}>Role / Designation
            <select className={`${inputCls} mt-1`} value={hrDesignation} onChange={e => setHrDesignation(e.target.value as HrDesignation)} data-testid="hr-designation">
              {HR_DESIGNATIONS.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </label>
        ) : (
          <label className={label}>Designation
            <select className={`${inputCls} mt-1`} value={pickedRole} onChange={e => setRole(e.target.value as EmployeeRequestRole)}>
              {roles.map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </select>
          </label>
        )}
        {role !== 'OPERATIONS_HEAD' && (
          <label className={label}>Side
            <select className={`${inputCls} mt-1`} value={division} onChange={e => setDivision(e.target.value as typeof division)}>
              <option value="">Not specified</option>
              {sides.map(v => <option key={v} value={v}>{SIDE_LABEL[v]}</option>)}
            </select>
          </label>
        )}
        <label className={label}>Full name<input className={`${inputCls} mt-1`} value={fullName} onChange={e => setFullName(e.target.value)} required maxLength={160} /></label>
        <label className={label}>E-mail<input type="email" className={`${inputCls} mt-1`} value={email} onChange={e => setEmail(e.target.value)} required autoComplete="off" /></label>
        <label className={label}>Employee ID (optional)<input className={`${inputCls} mt-1`} value={employeeCode} onChange={e => setEmployeeCode(e.target.value)} maxLength={40} /></label>
        <label className={label}>Joining date<input type="date" className={`${inputCls} mt-1`} value={joiningDate} onChange={e => setJoiningDate(e.target.value)} required /></label>
        <label className={label}>Date of birth<input type="date" className={`${inputCls} mt-1`} value={dateOfBirth} onChange={e => setDateOfBirth(e.target.value)} required /></label>
        <label className={label}>Blood group
          <select className={`${inputCls} mt-1`} value={bloodGroup} onChange={e => setBloodGroup(e.target.value)} required>
            <option value="">Choose</option>{BLOOD_GROUPS.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
        </label>
        <label className={label}>Contact number<input className={`${inputCls} mt-1`} value={contactNumber} onChange={e => setContactNumber(e.target.value)} required placeholder="+91 98765 43210" /></label>
        <label className={label}>Emergency contact<input className={`${inputCls} mt-1`} value={emergencyContact} onChange={e => setEmergencyContact(e.target.value)} required placeholder="+91 98765 43210" /></label>
      </div>

      {error && <p role="alert" className="text-xs font-semibold text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2">{error}</p>}
      {done && (
        <p role="status" className="text-xs font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2" data-testid="submitted-for-approval">
          <span className="block text-sm font-bold">Employee Submitted for {APPROVER_TITLE[done.requestedRole as EmployeeRequestRole]} Approval</span>
          {done.employee?.name} is waiting for {done.approver?.name ?? (done.awaitingOwner ? 'an Operations Head to be assigned to the department' : APPROVER_LABEL[(done.requestedRole as EmployeeRequestRole)])}. The status is in "Requests you sent" below.
        </p>
      )}
      <div className="flex justify-end">
        <button type="submit" className={btn.primary} disabled={saving}>{saving ? 'Sending…' : 'Send for approval'}</button>
      </div>
    </form>
  );
};
