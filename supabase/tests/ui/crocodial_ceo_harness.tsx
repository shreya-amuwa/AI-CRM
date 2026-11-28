import React from 'react';
import { createRoot } from 'react-dom/client';
import { CrocodialAdminPage } from '../../../src/components/crocodial/CrocodialAdminPage';
import './withAppFeedback';

// a CEO's Crocodial Integration page (Task 9): the MD's page, scoped to the connections the CEO manages
(window as any).mount = (scope: 'MD' | 'CEO' = 'CEO') => createRoot(document.getElementById('root')!).render(<div className="p-2 sm:p-4 max-w-5xl"><CrocodialAdminPage scope={scope} /></div>);
