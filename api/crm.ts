import { handleApiRequest } from '../server/app.js';

/**
 * Single Vercel serverless function serving the whole /api/v1 surface via
 * Hono (server/app.ts). vercel.json rewrites /api/v1/<path> →
 * /api/crm?__path=<path>, so routing does not depend on catch-all filenames.
 */
export default handleApiRequest;
