/**
 * The page a person is on inside a dashboard, kept in this browser so a refresh (or opening the installed app again) returns to it instead of the
 * Overview. It holds only a page name, never data: it is stored per signed-in person (another person on the same computer starts at the Overview),
 * and a stored name that is not a page of this dashboard any more (an old version, a changed role) is ignored.
 */
export const PREFIX = 'amuwa.page.';

export function read<T extends string>(key: string, valid: readonly T[]): T | null {
  try {
    const v = window.localStorage.getItem(key);
    return v && (valid as readonly string[]).includes(v) ? (v as T) : null;
  } catch {
    return null; // private window: nothing remembered
  }
}

export function write(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* private window or full storage: the page is just not remembered */
  }
}

/** Forget one remembered value (used when a person leaves an overlay page such as Attendance or Meetings). */
export function clear(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* nothing to clear */
  }
}

/** Forget every remembered page of this browser (used when someone signs out on purpose). */
export function forgetRememberedPages(): void {
  try {
    const stale: string[] = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith(PREFIX)) stale.push(k);
    }
    stale.forEach(k => window.localStorage.removeItem(k));
  } catch {
    /* nothing to forget */
  }
}

/** The page and sub-department of a department panel (the Super Admin / department view in App.tsx), per person and department. */
export interface PanelPage {
  tab: string;
  subDept: string | null;
}
const panelKey = (userId: string, departmentId: string) => `${PREFIX}${userId}.department-panel.${departmentId}`;

export function readPanelPage(userId: string, departmentId: string): PanelPage | null {
  try {
    const v = JSON.parse(window.localStorage.getItem(panelKey(userId, departmentId)) || 'null');
    return v && typeof v.tab === 'string' ? { tab: v.tab, subDept: typeof v.subDept === 'string' ? v.subDept : null } : null;
  } catch {
    return null;
  }
}

export function writePanelPage(userId: string, departmentId: string, page: PanelPage): void {
  write(panelKey(userId, departmentId), JSON.stringify(page));
}

export function clearPanelPage(userId: string, departmentId: string): void {
  try {
    window.localStorage.removeItem(panelKey(userId, departmentId));
  } catch {
    /* nothing to clear */
  }
}
