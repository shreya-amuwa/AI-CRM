import { useEffect, useState } from 'react';
import { aiStudioApi } from './api/aiStudio';

/**
 * Whether the signed-in person may open HR > AI Studio Performance (20270302000100): the HR employees the Super Admin named, and the Super Admin.
 * The database decides (ai_studio_hr_access_info); this only shows or hides the menu entry, and every data call is checked again.
 * Asked once per person and kept for the session (a change by the Super Admin shows after the next sign-in or reload).
 */
const cache = new Map<string, Promise<boolean>>();
export function useAiStudioHrAccess(userId: string | undefined, enabled: boolean): boolean {
  const [allowed, setAllowed] = useState(false);
  useEffect(() => {
    if (!enabled || !userId) { setAllowed(false); return; }
    let live = true;
    let p = cache.get(userId);
    if (!p) {
      p = aiStudioApi.hrAccess().then(a => a.allowed, () => false);
      cache.set(userId, p);
    }
    void p.then(v => { if (live) setAllowed(v); });
    return () => { live = false; };
  }, [userId, enabled]);
  return allowed;
}
