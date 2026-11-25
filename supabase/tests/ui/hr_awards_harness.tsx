// Mounts the real HR dashboard panel (HRDepartmentPanel) for the HR Awards browser test; the CRM API is answered by the test (page.route).
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { HRDepartmentPanel } from '../../../src/components/departments/hr/HRDepartmentPanel';
import './withAppFeedback';

let root: Root | null = null;
(window as any).mount = () => {
  root?.unmount();
  root = createRoot(document.getElementById('root')!);
  root.render(<HRDepartmentPanel activeTab="dashboard" />);
};
