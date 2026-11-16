import '../server/sentry.js'; // error reporting: first (does nothing without SENTRY_DSN on the server)
import { handleApiRequest } from '../server/app.js';
import { flushSentry } from '../server/sentry.js';

/**
 * Single Vercel serverless function serving the whole /api/v1 surface via
 * Hono (server/app.ts). vercel.json rewrites /api/v1/<path> →
 * /api/crm?__path=<path>, so routing does not depend on catch-all filenames.
 */
export default async function handler(...args: Parameters<typeof handleApiRequest>): Promise<void> {
  try {
    return await handleApiRequest(...args);
  } finally {
    // only waits when this request produced an error report (see server/sentry.ts)
    await flushSentry();
  }
}
