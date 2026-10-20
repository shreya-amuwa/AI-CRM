import type { VercelRequest, VercelResponse } from '@vercel/node';
import { ingestLead } from '../server/webhooks/leadIngest.js';

/** /api/webhook[?department=&source=] and /api/webhooks/:department/:source (rewritten here by vercel.json). */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  let department = one(req.query.department);
  let source = one(req.query.source);

  if (req.url) {
    const segs = new URL(req.url, 'http://localhost').pathname.split('/').filter(Boolean);
    const i = segs.indexOf('webhooks');
    if (i !== -1 && segs.length > i + 1) {
      department = segs[i + 1] || department;
      if (segs.length > i + 2) source = segs[i + 2] || source;
    }
  }
  return ingestLead(req, res, { department, source });
}
