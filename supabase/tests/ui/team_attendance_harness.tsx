import React from 'react';
import { createRoot } from 'react-dom/client';
import { TeamAttendance, TeamAttendanceSummary } from '../../../src/components/attendance/TeamAttendance';
import { AttendanceCorrections } from '../../../src/components/attendance/AttendanceCorrections';

(window as any).mountTeam = () => createRoot(document.getElementById('root')!).render(<div className="p-4"><TeamAttendance /></div>);
(window as any).mountSummary = () => createRoot(document.getElementById('root')!).render(<div className="p-4"><TeamAttendanceSummary /></div>);
(window as any).mountCorrections = () => createRoot(document.getElementById('root')!).render(<div className="p-4"><AttendanceCorrections canDecide /></div>);
