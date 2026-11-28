import React from 'react';
import { createRoot } from 'react-dom/client';
import { AttendanceStatement } from '../../../src/components/hr/AttendanceStatement';
import './withAppFeedback';

// HR > Attendance Statement & Export (docs/hr-dashboard-upgrade.md, Phase 2)
(window as any).mountStatement = () => { try { sessionStorage.clear(); } catch { /* */ } createRoot(document.getElementById('root')!).render(<div className="p-4 max-w-6xl"><AttendanceStatement /></div>); };
