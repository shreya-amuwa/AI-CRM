import React from 'react';
import { createRoot } from 'react-dom/client';
import { MyAttendance } from '../../../src/components/attendance/AttendancePage';

(window as any).mount = () => createRoot(document.getElementById('root')!).render(<div className="p-4 max-w-4xl"><MyAttendance /></div>);
