import React from 'react';
import { createRoot } from 'react-dom/client';
import { HrAttendanceRegister, MyAttendance } from '../../../src/components/attendance/AttendancePage';
import './withAppFeedback';

(window as any).mount = () => createRoot(document.getElementById('root')!).render(<div className="p-4 max-w-4xl"><MyAttendance /></div>);
(window as any).mountHr = () => createRoot(document.getElementById('root')!).render(<div className="p-4"><HrAttendanceRegister /></div>);
