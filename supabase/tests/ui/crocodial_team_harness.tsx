import React from 'react';
import { createRoot } from 'react-dom/client';
import { CrocodialManagerPage, CrocodialTeamPanel } from '../../../src/components/crocodial/CrocodialTeamPanel';

(window as any).mount = () => createRoot(document.getElementById('root')!).render(<div className="p-4 max-w-6xl"><CrocodialTeamPanel /></div>);
// a Department Head's / Team Lead's page: their own activity (when connected) and the people they oversee
(window as any).mountManager = () => createRoot(document.getElementById('root')!).render(<div className="p-4 max-w-6xl"><CrocodialManagerPage /></div>);
