/**
 * After a new deployment the hashed files of the previous build disappear. A tab
 * that was opened before the deploy then fails to load a lazy screen with
 * "Failed to fetch dynamically imported module". The fix is a reload (the page
 * then picks up the new build), done once so a real outage cannot loop.
 *
 * The "Something went wrong" flash: the preload listener used to cancel Vite's error (preventDefault) and reload. Cancelled, Vite hands
 * React.lazy an empty module instead of the screen, React throws "Cannot read properties of undefined (reading 'default')" (Chrome;
 * "evaluating 'x.default'" in Safari; "lazy: Expected the result of a dynamic import() call" in development), the error screen does not
 * recognise that as a new version and shows its dark "Something went wrong" page until the reload lands 2-4 seconds later. Now the
 * error is left to reach the screen as what it is, those empty-module messages count as a new version too, and while the reload is
 * under way the error screen shows a quiet "Loading the latest version" instead (isReloadingForNewVersion).
 */
const KEY = 'crm:chunk-reload-at';
const WINDOW_MS = 30_000;
let reloading = false;

const CHUNK_ERROR =
  /dynamically imported module|Importing a module script failed|error loading dynamically|ChunkLoadError|Unable to preload CSS|Expected the result of a dynamic import|Lazy element type must resolve|reading 'default'|evaluating '[\w$.]*\.default'|is not a valid JavaScript MIME type|Expected a JavaScript(-or-Wasm)? module script/i;

export const isChunkLoadError = (e: unknown): boolean =>
  CHUNK_ERROR.test(String((e as { message?: unknown } | null)?.message ?? e));

/** True from the moment a reload for a new version has been asked for (the page is about to be replaced). */
export const isReloadingForNewVersion = (): boolean => reloading;

/** Reloads once per 30 seconds; returns false when it already tried (or storage is unavailable). */
export function reloadForNewVersion(): boolean {
  if (reloading) return true;
  try {
    const last = Number(sessionStorage.getItem(KEY) || 0);
    if (Date.now() - last < WINDOW_MS) return false;
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    return false;
  }
  reloading = true;
  window.location.reload();
  return true;
}

export function installChunkReload(): void {
  // Vite fires this when a lazy chunk (or its CSS) cannot be preloaded. The error is NOT cancelled: cancelled, the screen would
  // receive an empty module and crash with a message that hides the real cause (see above). It reaches the error screen as a
  // "failed to fetch module" error, which shows "Loading the latest version" while this reload runs.
  window.addEventListener('vite:preloadError', () => { reloadForNewVersion(); });
  window.addEventListener('unhandledrejection', e => {
    if (isChunkLoadError(e.reason)) reloadForNewVersion();
  });
}
