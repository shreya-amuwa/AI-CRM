// Minimal URL routing for departments.
//
// This project has no router library and no server-side history-fallback
// config, so a real path-based URL (e.g. `/department/hr`) would 404 on
// direct load/refresh outside of Vite's dev server. A hash-based URL
// (`#/department/hr`) gives every department its own distinct, bookmarkable,
// refresh-safe URL with zero server/build configuration required.
//
// This module is the ONLY place that reads/writes the department portion of
// the URL, so there is a single source of truth for the URL <-> department
// mapping.

const HASH_PREFIX = '#/department/';

export const getDepartmentIdFromLocation = (): string | null => {
  const hash = window.location.hash || '';
  if (!hash.startsWith(HASH_PREFIX)) return null;
  const id = decodeURIComponent(hash.slice(HASH_PREFIX.length)).trim();
  return id || null;
};

export const setDepartmentIdInLocation = (departmentId: string | null): void => {
  const desired = departmentId ? `${HASH_PREFIX}${encodeURIComponent(departmentId)}` : '';
  const current = window.location.hash || '';
  if (current === desired) return;

  if (desired) {
    window.location.hash = desired;
  } else {
    // Clear back to the Department Hub without leaving a trailing '#'.
    const { pathname, search } = window.location;
    window.history.replaceState(null, '', pathname + search);
  }
};
