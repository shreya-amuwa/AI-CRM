import React from 'react';
import { createRoot } from 'react-dom/client';
import { OperationsAssign } from '../../../src/components/tasks/head/TaskHierarchy';

(window as any).mount = () => createRoot(document.getElementById('root')!).render(<div className="p-4"><OperationsAssign /></div>);
