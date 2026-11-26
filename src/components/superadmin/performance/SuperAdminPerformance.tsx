import React, { useMemo, useState } from 'react';
import { useDepartments } from '../../../context/DepartmentContext';
import { isUnifiedDepartment } from '../../../lib/auth/departmentRoles';
import { PerformanceApprovals } from '../../performance/PerformanceApprovals';
import { fieldCls } from '../../tasks/head/headParts';

const STORE_KEY = 'amuwa.sa-performance-department';
const readStored = () => { try { return localStorage.getItem(STORE_KEY) ?? ''; } catch { return ''; } };
const writeStored = (v: string) => { try { localStorage.setItem(STORE_KEY, v); } catch { /* private window: the choice is simply not remembered */ } };

/**
 * Performance Management for the Managing Director (Super Admin): the same page the Department Head opens, for the department chosen here. The figures,
 * the Team Leads and teams, every member and each approval status come from `performance_overview(start, end, department)`, which lets the Super Admin
 * read any department. It is read only: Team Leads decide their members and Department Heads decide their Team Leads (the database refuses the Super Admin).
 */
export const SuperAdminPerformance: React.FC = () => {
  const { departments } = useDepartments();
  const list = useMemo(() => departments.filter(d => d.dbId).sort((a, b) => a.name.localeCompare(b.name)), [departments]);
  const [chosenId, setChosenId] = useState<string>(readStored);
  // the remembered department, else International / Reseller (where the Team Lead approval runs), else the first one
  const chosen = list.find(d => d.dbId === chosenId) ?? list.find(d => isUnifiedDepartment(d.id)) ?? list[0];
  if (!chosen?.dbId) return <p role="status" className="p-8 text-sm text-slate-500">No department yet.</p>;
  const picker = (
    <label className="block">
      <span className="block text-xs font-semibold text-slate-500 mb-1.5">Department</span>
      <select className={`${fieldCls} w-60`} value={chosen.dbId} data-testid="sa-performance-department"
        onChange={e => { setChosenId(e.target.value); writeStored(e.target.value); }}>
        {list.map(d => <option key={d.dbId} value={d.dbId}>{d.name}</option>)}
      </select>
    </label>
  );
  return (
    <PerformanceApprovals key={chosen.dbId} departmentId={chosen.dbId} title="Performance Management" filter={picker}
      subtitle={`${chosen.name}: every Team Lead and team member, their figures from the real task records and approved daily reports, and each approval. Read only: Team Leads decide their members, the Department Head decides the Team Leads.`} />
  );
};

export default SuperAdminPerformance;
