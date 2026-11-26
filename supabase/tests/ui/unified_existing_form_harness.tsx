import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { StaffManagementPanel } from '../../../src/components/common/StaffManagementPanel';
import { organizationApi } from '../../../src/lib/api/endpoints';
import './withAppFeedback';

/** The Super Admin's Add Team Member form for a department chosen at the top, like the department hub. `load()` reads the department list through the real organizationApi. */
const Harness: React.FC = () => {
  const [slug, setSlug] = useState('amuwa-international-department');
  const deps = (window as any).__departments as { id: string; name: string }[];
  return (
    <div className="p-3">
      <label htmlFor="dept">Department</label>
      <select id="dept" value={slug} onChange={e => setSlug(e.target.value)}>{deps.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
      <StaffManagementPanel departmentSlug={slug} view="add" />
    </div>
  );
};
(window as any).load = () => organizationApi.departments();
(window as any).mount = () => createRoot(document.getElementById('root')!).render(<Harness />);
