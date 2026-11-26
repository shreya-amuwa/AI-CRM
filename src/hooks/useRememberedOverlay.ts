import { useCallback, useState, type Dispatch, type SetStateAction } from 'react';
import { useAuth } from '../context/AuthContext';
import { PREFIX, clear, read, write } from '../lib/rememberedPage';

/**
 * The overlay page of a dashboard (Attendance, Meetings, Bugs: pages every dashboard shows in its own content area) kept across a refresh,
 * the way the dashboard's own page is. null is "no overlay: the dashboard's own page". It is remembered per signed-in person and per
 * dashboard (the first four parts of the address, e.g. /team-member/dashboard/<id>), so a refresh stays on Meeting Request instead of
 * returning to the Overview. `valid` lists the overlays that exist; anything else stored is ignored. `requested` (a notification or a
 * link opening a page) wins over what was remembered.
 */
const dashboardBase = () => (typeof window === 'undefined' ? '' : window.location.pathname.split('/').slice(0, 4).join('/'));

export function useRememberedOverlay<T extends string>(valid: readonly T[], requested: T | null): [T | null, Dispatch<SetStateAction<T | null>>] {
  const { user } = useAuth();
  const key = user ? `${PREFIX}${user.id}.overlay.${dashboardBase()}` : null;
  const [overlay, setOverlay] = useState<T | null>(() => requested ?? (key ? read(key, valid) : null));
  const set: Dispatch<SetStateAction<T | null>> = useCallback(
    next => {
      setOverlay(prev => {
        const value = typeof next === 'function' ? (next as (p: T | null) => T | null)(prev) : next;
        if (key && value !== prev) (value ? write(key, value) : clear(key));
        return value;
      });
    },
    [key]
  );
  return [overlay, set];
}
