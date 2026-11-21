import { useEffect } from 'react';

/** A bug notification clicked by a developer (a new bug, one assigned to them): the dashboard shows the Bugs section (20270122000300). */
export const OPEN_BUGS_EVENT = 'crm:open-bugs';
export const openBugs = () => window.dispatchEvent(new CustomEvent(OPEN_BUGS_EVENT));
export function useOpenBugsRequest(show: () => void) {
  useEffect(() => {
    window.addEventListener(OPEN_BUGS_EVENT, show);
    return () => window.removeEventListener(OPEN_BUGS_EVENT, show);
  }, [show]);
}
