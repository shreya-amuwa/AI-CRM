import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { StaffManagementPanel } from '../../../src/components/common/StaffManagementPanel';
import { EmployeeRequestForm } from '../../../src/components/employees/EmployeeRequestForm';
import './withAppFeedback';

/** The department chosen at the top of the window drives the panel, exactly like the Super Admin's department hub. */
const Harness: React.FC = () => {
  const [slug, setSlug] = useState('hr');
  const deps = (window as any).__departments as { id: string; name: string }[];
  return (
    <div className="p-3">
      <label htmlFor="dept">Department</label>
      <select id="dept" value={slug} onChange={e => setSlug(e.target.value)}>{deps.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
      <StaffManagementPanel departmentSlug={slug} view="add" />
    </div>
  );
};
(window as any).mount = () => createRoot(document.getElementById('root')!).render(<Harness />);
// HR's "New employee request" form (the approval workflow): the same department-driven role dropdown
(window as any).mountRequest = () => createRoot(document.getElementById('root')!).render(<div className="p-3"><EmployeeRequestForm /></div>);
