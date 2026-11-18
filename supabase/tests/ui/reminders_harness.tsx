import React from 'react';
import { createRoot } from 'react-dom/client';
import { ReminderBanner } from '../../../src/components/attendance/ReminderBanner';
import { RemindersPanel } from '../../../src/components/attendance/RemindersPanel';
import { unsubscribeThisDevice } from '../../../src/lib/push/pushSupport';
import { openFromNotification } from '../../../src/components/issues/issueEvents';
import { useStaffReminders } from '../../../src/components/attendance/StaffReminders';
import { OPEN_CHAT_EVENT } from '../../../src/components/chat/chatEvents';
(window as any).__chatOpened = [];
window.addEventListener(OPEN_CHAT_EVENT, e => (window as any).__chatOpened.push((e as CustomEvent).detail));

const OpenProbe = () => {
  const [opened, setOpened] = React.useState(0);
  useStaffReminders(React.useCallback(() => setOpened(n => n + 1), []));
  return <span data-testid="attendance-opened">{opened}</span>;
};
(window as any).mountBanner = () => createRoot(document.getElementById('root')!).render(<div className="p-4 max-w-4xl"><ReminderBanner /><OpenProbe /></div>);
(window as any).unsubscribeThisDevice = unsubscribeThisDevice;
(window as any).openFromNotification = openFromNotification;
(window as any).mountPanel = (role: 'staff' | 'hr' | 'sa') => {
  (window as any).__state.role = role;
  createRoot(document.getElementById('root')!).render(<div className="p-4 max-w-4xl"><RemindersPanel /></div>);
};
