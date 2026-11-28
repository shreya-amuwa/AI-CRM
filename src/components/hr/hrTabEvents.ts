import { useEffect } from 'react';

/** Other screens (an HR overview card, a notification) can switch the HR dashboard to one of its sidebar pages. */
export const OPEN_HR_TAB_EVENT = 'crm:open-hr-tab';
export type HrTab = 'hr_probation' | 'hr_internships' | 'hr_attendance_statement' | 'hr_telecaller_performance';
export const openHrTab = (tab: HrTab) => window.dispatchEvent(new CustomEvent<HrTab>(OPEN_HR_TAB_EVENT, { detail: tab }));

export function useOpenHrTabRequest(handler: (tab: HrTab) => void) {
  useEffect(() => {
    const on = (e: Event) => handler((e as CustomEvent<HrTab>).detail);
    window.addEventListener(OPEN_HR_TAB_EVENT, on);
    return () => window.removeEventListener(OPEN_HR_TAB_EVENT, on);
  }, [handler]);
}
