import React, { Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { ErrorBoundary } from '../../../src/components/common/ErrorBoundary';
import { installChunkReload } from '../../../src/lib/chunkReload';
import './withAppFeedback';

installChunkReload();
const w = window as any;
// what a screen of the previous build looks like after a deployment, in each of its forms
const LAZY: Record<string, () => Promise<any>> = {
  // the module is gone: the browser's own error
  missing: () => Promise.reject(new TypeError('Failed to fetch dynamically imported module: https://crm.example.com/assets/Wallet-old.js')),
  // the error Vite hands over when its preload error was cancelled: an empty module (the cause of the "Something went wrong" flash)
  empty: () => Promise.resolve(undefined),
  // a real crash of a screen (not a new version)
  crash: () => Promise.resolve({ default: () => { throw new Error('Real bug in a screen'); } })
};
w.mount = (kind: string) => {
  const Screen = React.lazy(LAZY[kind] as any);
  createRoot(document.getElementById('root')!).render(
    <ErrorBoundary><Suspense fallback={<p>Loading</p>}><Screen /></Suspense></ErrorBoundary>
  );
};
// Vite's preload helper: it reports a failed preload and throws only when the event was NOT cancelled
w.vitePreloadFails = () => {
  const e = new Event('vite:preloadError', { cancelable: true }) as Event & { payload?: unknown };
  e.payload = new Error('Unable to preload CSS for /assets/Wallet-old.css');
  window.dispatchEvent(e);
  return e.defaultPrevented;
};
