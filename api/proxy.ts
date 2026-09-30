import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-key');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  const targetUrl = (req.query.url as string) || (req.body && req.body.url);
  if (!targetUrl || typeof targetUrl !== 'string') {
    return res.status(400).json({ error: 'Missing target url parameter' });
  }

  try {
    const fetchOptions: RequestInit = {
      method: req.method === 'POST' ? 'POST' : 'GET',
      headers: {
        'Accept': 'application/json, text/plain, text/csv, */*',
        'User-Agent': 'Mozilla/5.0 (AI-CRM Webhook Fetcher)'
      }
    };

    if (req.headers.authorization) {
      (fetchOptions.headers as any)['Authorization'] = req.headers.authorization;
    }
    if (req.headers['x-api-key']) {
      (fetchOptions.headers as any)['x-api-key'] = req.headers['x-api-key'];
    }

    if (req.method === 'POST' && req.body && req.body.payload) {
      fetchOptions.body = typeof req.body.payload === 'string' ? req.body.payload : JSON.stringify(req.body.payload);
      (fetchOptions.headers as any)['Content-Type'] = 'application/json';
    }

    const response = await fetch(targetUrl, fetchOptions);
    const contentType = response.headers.get('content-type') || 'text/plain';
    const text = await response.text();

    res.setHeader('Content-Type', contentType);
    return res.status(response.status).send(text);
  } catch (err: any) {
    return res.status(502).json({
      error: 'Failed to proxy request: ' + (err?.message || 'Unknown network error')
    });
  }
}
