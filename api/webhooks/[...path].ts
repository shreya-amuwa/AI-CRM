import type { VercelRequest, VercelResponse } from '@vercel/node';
import { ingestLead } from '../../server/webhooks/leadIngest.js';

/** /api/webhooks/:department/:source */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const pathParam = req.query.path;
  let segments: string[] = [];
  if (Array.isArray(pathParam)) segments = pathParam;
  else if (typeof pathParam === 'string') segments = pathParam.split('/').filter(Boolean);
  else if (req.url) {
    const segs = new URL(req.url, 'http://localhost').pathname.split('/').filter(Boolean);
    const i = segs.indexOf('webhooks');
    if (i !== -1 && segs.length > i + 1) segments = segs.slice(i + 1);
  }
  return ingestLead(req, res, { department: segments[0], source: segments[1] });
}
