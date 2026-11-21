import React from 'react';
import { createRoot } from 'react-dom/client';
import { ReminderBanner } from '../../../src/components/attendance/ReminderBanner';
import { RemindersPanel } from '../../../src/components/attendance/RemindersPanel';
import { unsubscribeThisDevice } from '../../../src/lib/push/pushSupport';
import { openFromNotification } from '../../../src/components/issues/issueEvents';
import { useStaffReminders } from '../../../src/components/attendance/StaffReminders';
import { OPEN_CHAT_EVENT } from '../../../src/components/chat/chatEvents';
import { NotificationHealth } from '../../../src/components/notifications/NotificationHealth';
import { DepartmentContext } from '../../../src/context/DepartmentContext';
(window as any).__chatOpened = [];
window.addEventListener(OPEN_CHAT_EVENT, e => (window as any).__chatOpened.push((e as CustomEvent).detail));

const OpenProbe = () => {
  const [opened, setOpened] = React.useState(0);
  const [closed, setClosed] = React.useState(0);
  useStaffReminders(React.useCallback(() => setOpened(n => n + 1), []), React.useCallback(() => setClosed(n => n + 1), []));
  return <><span data-testid="attendance-opened">{opened}</span><span data-testid="overlay-closed">{closed}</span></>;
};
(window as any).mountBanner = () => createRoot(document.getElementById('root')!).render(<div className="p-4 max-w-4xl"><ReminderBanner /><OpenProbe /></div>);
(window as any).unsubscribeThisDevice = unsubscribeThisDevice;
(window as any).openFromNotification = openFromNotification;
(window as any).mountPanel = (role: 'staff' | 'hr' | 'sa') => {
  (window as any).__state.role = role;
  createRoot(document.getElementById('root')!).render(<div className="p-4 max-w-4xl"><RemindersPanel /></div>);
};

// Notification Health (20270125000200) with two departments; the data comes from the test server's /api/v1/notifications/health stand-in.
(window as any).mountHealth = () => {
  const departments = [{ id: 'sales', dbId: '11111111-1111-4111-8111-111111111111', name: 'Sales' }, { id: 'hr', dbId: '22222222-2222-4222-8222-222222222222', name: 'HR' }];
  createRoot(document.getElementById('root')!).render(
    <DepartmentContext.Provider value={{ departments } as never}><div className="p-4"><NotificationHealth /></div></DepartmentContext.Provider>);
};
