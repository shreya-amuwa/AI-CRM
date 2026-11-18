import React from 'react';
import { createRoot } from 'react-dom/client';
import { ReminderBanner } from '../../../src/components/attendance/ReminderBanner';
import { unsubscribeThisDevice } from '../../../src/lib/push/pushSupport';
import { openFromNotification } from '../../../src/components/issues/issueEvents';
import { useOpenAttendanceRequest } from '../../../src/components/attendance/attendanceEvents';

const OpenProbe = () => {
  const [opened, setOpened] = React.useState(0);
  useOpenAttendanceRequest(React.useCallback(() => setOpened(n => n + 1), []));
  return <span data-testid="attendance-opened">{opened}</span>;
};
(window as any).mountBanner = () => createRoot(document.getElementById('root')!).render(<div className="p-4 max-w-4xl"><ReminderBanner /><OpenProbe /></div>);
(window as any).unsubscribeThisDevice = unsubscribeThisDevice;
(window as any).openFromNotification = openFromNotification;
