import React, { Suspense, useEffect } from 'react';
import { registerServiceWorker } from '../../lib/push/registerServiceWorker';
import { useOpenAttendanceRequest } from './attendanceEvents';

const ReminderBanner = React.lazy(() => import('./ReminderBanner'));

/**
 * The attendance reminders in a staff layout (DashboardShell, TeamMemberLayout, any future one): the service worker (public/sw.js), and
 * Attendance opening when a reminder asks for it (the bell, or a tapped notification while the CRM is open). Staff only: the client and
 * candidate portals never call this. supabase/tests/pwa_assets.test.ts checks every staff layout uses it with StaffReminderBanner.
 */
export function useStaffReminders(showAttendance: () => void) {
  useEffect(() => { void registerServiceWorker(); }, []);
  useOpenAttendanceRequest(showAttendance);
}

/** "Turn on reminders" at the top of the page; hidden above a page that fills the screen (Chat), and for the Super Admin. */
export const StaffReminderBanner: React.FC<{ hidden?: boolean }> = ({ hidden = false }) =>
  hidden ? null : <Suspense fallback={null}><ReminderBanner /></Suspense>;
