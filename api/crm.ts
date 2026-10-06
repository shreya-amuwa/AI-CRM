import type { VercelRequest, VercelResponse } from '@vercel/node';
import { handleApiRequest } from '../server/app.js';

/**
 * Single serverless function serving the whole /api/v1 surface.
 * vercel.json rewrites /api/v1/<path> → /api/crm?__path=<path>, so routing
 * does not depend on catch-all filename support (see server/routes.ts).
 */
export default function handler(req: VercelRequest, res: VercelResponse) {
  return handleApiRequest(req, res);
}
