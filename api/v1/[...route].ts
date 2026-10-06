import type { VercelRequest, VercelResponse } from '@vercel/node';
import { handleApiRequest } from '../../server/app.js';

/** Single serverless function serving the whole /api/v1 surface (see server/routes.ts). */
export default function handler(req: VercelRequest, res: VercelResponse) {
  return handleApiRequest(req, res);
}
