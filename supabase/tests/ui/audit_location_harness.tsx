import React from 'react';
import { createRoot } from 'react-dom/client';
import { DepartmentGrid } from '../../../src/components/dashboard/DepartmentSelector';
import { SecurityAuditLogs } from '../../../src/components/superadmin/SecurityAuditLogs';
import './withAppFeedback';

(window as any).mount = (which: 'departments' | 'audit') =>
  createRoot(document.getElementById('root')!).render(<div className="p-3">{which === 'departments' ? <DepartmentGrid /> : <SecurityAuditLogs />}</div>);
