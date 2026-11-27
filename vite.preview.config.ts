import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Dashboard Explorer's preview runtime (docs/DASHBOARD_EXPLORER.md): a SEPARATE bundle, served at /dashboard-preview/ inside a sandboxed frame.
 *
 * It renders the real dashboards (the same App, role mapping, routing and pages), but the modules that reach the live CRM are replaced at build
 * time by demonstration modules, so the production network code is not in this bundle at all:
 *   src/services/supabaseClient.ts        -> the in-memory demo Supabase client (no auth, no PostgREST, no Realtime, no Storage)
 *   src/lib/api/client.ts                 -> the demo API client (answers from demonstration data; never fetch())
 *   src/context/AuthContext.tsx           -> the preview identity (a synthetic profile; no Supabase session, no sign-in tracking)
 *   src/lib/push/registerServiceWorker.ts -> nothing (no service worker, no push registration)
 * Defence in depth: the page's Content-Security-Policy (worker/securityHeaders.ts, PREVIEW_HEADERS) has connect-src 'none' and a sandbox
 * without allow-same-origin, so even a missed direct fetch() cannot leave the frame, and the frame cannot read the Managing Director's session.
 */
const root = path.resolve(__dirname);
const SWAPS: Record<string, string> = {
  'src/services/supabaseClient.ts': 'src/dashboard-preview/runtime/demoSupabase.ts',
  'src/lib/api/client.ts': 'src/dashboard-preview/runtime/demoApi.ts',
  'src/context/AuthContext.tsx': 'src/dashboard-preview/runtime/PreviewAuthContext.tsx',
  'src/lib/push/registerServiceWorker.ts': 'src/dashboard-preview/runtime/noServiceWorker.ts'
};
const swapped = new Map(Object.entries(SWAPS).map(([from, to]) => [path.join(root, from), path.join(root, to)]));

function previewSwaps(): Plugin {
  return {
    name: 'dashboard-preview-swaps',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (!importer) return null;
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      if (!resolved) return null;
      const file = resolved.id.split('?')[0];
      const to = swapped.get(file);
      // the demo modules themselves never import the module they replace, so this cannot loop
      return to ? { id: to } : null;
    }
  };
}

export default defineConfig({
  root: path.join(root, 'src/dashboard-preview'),
  base: '/dashboard-preview/',
  publicDir: false,
  plugins: [previewSwaps(), react({ fastRefresh: false })],
  // the preview never knows the live project's address or key
  define: {
    'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(''),
    'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(''),
    'import.meta.env.VITE_SENTRY_DSN': JSON.stringify('')
  },
  css: { postcss: path.join(root, 'postcss.config.js') },
  build: {
    outDir: path.join(root, 'dist/dashboard-preview'),
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      output: { manualChunks: { 'vendor-react': ['react', 'react-dom'] } }
    }
  }
});
