/**
 * After a new deployment the hashed files of the previous build disappear. A tab
 * that was opened before the deploy then fails to load a lazy screen with
 * "Failed to fetch dynamically imported module". The fix is a reload (the page
 * then picks up the new build), done once so a real outage cannot loop.
 */
const KEY = 'crm:chunk-reload-at';
const WINDOW_MS = 30_000;

export const isChunkLoadError = (e: unknown): boolean =>
  /dynamically imported module|Importing a module script failed|error loading dynamically|ChunkLoadError|Unable to preload CSS/i.test(
    String((e as { message?: unknown } | null)?.message ?? e)
  );

/** Reloads once per 30 seconds; returns false when it already tried (or storage is unavailable). */
export function reloadForNewVersion(): boolean {
  try {
    const last = Number(sessionStorage.getItem(KEY) || 0);
    if (Date.now() - last < WINDOW_MS) return false;
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    return false;
  }
  window.location.reload();
  return true;
}

export function installChunkReload(): void {
  // Vite fires this when a lazy chunk (or its CSS) cannot be preloaded.
  window.addEventListener('vite:preloadError', e => {
    e.preventDefault();
    reloadForNewVersion();
  });
  window.addEventListener('unhandledrejection', e => {
    if (isChunkLoadError(e.reason)) reloadForNewVersion();
  });
}
