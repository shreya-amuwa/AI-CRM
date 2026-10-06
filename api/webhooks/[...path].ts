import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // 1. CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Webhook-Secret, X-Hub-Signature-256');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  // 2. GET handler (Meta / WhatsApp challenge handshake & healthcheck)
  if (req.method === 'GET') {
    const challenge = req.query['hub.challenge'] || req.query['hub_challenge'];
    if (challenge) {
      res.setHeader('Content-Type', 'text/plain');
      return res.status(200).send(String(challenge));
    }
    return res.status(200).json({ status: 'active' });
  }

  // Only allow POST for ingesting leads
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // 3. Parse JSON body
  let rawBody: any = req.body;
  let parsedBody: any = null;

  if (typeof rawBody === 'string') {
    try {
      parsedBody = JSON.parse(rawBody);
    } catch {
      return res.status(400).json({ error: 'Invalid JSON body' });
    }
  } else if (Buffer.isBuffer(rawBody)) {
    try {
      parsedBody = JSON.parse(rawBody.toString('utf-8'));
    } catch {
      return res.status(400).json({ error: 'Invalid JSON body' });
    }
  } else if (rawBody && typeof rawBody === 'object') {
    parsedBody = rawBody;
  } else {
    // Attempt to read body stream if not pre-parsed
    try {
      const buffers: Buffer[] = [];
      for await (const chunk of req as any) {
        buffers.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
      }
      if (buffers.length > 0) {
        parsedBody = JSON.parse(Buffer.concat(buffers).toString('utf-8'));
      }
    } catch {
      return res.status(400).json({ error: 'Invalid JSON body' });
    }
  }

  if (!parsedBody || typeof parsedBody !== 'object') {
    return res.status(400).json({ error: 'Invalid or missing JSON body' });
  }

  const rawPayload = parsedBody;

  // 4. Unwrap array or { data: {...} } structure
  let item = parsedBody;
  if (Array.isArray(item)) {
    item = item[0] || {};
  }
  if (item && typeof item === 'object') {
    if (item.data && typeof item.data === 'object') {
      item = Array.isArray(item.data) ? (item.data[0] || {}) : item.data;
    } else if (item.body && typeof item.body === 'object') {
      item = Array.isArray(item.body) ? (item.body[0] || {}) : item.body;
    }
  }

  // 5. Extract fields with fallbacks
  const name = String(item.name || item.customer_name || item.full_name || '').trim();
  const phone = String(item.phone || item.contact || item.mobile || '').trim();
  const email = String(item.email || '').trim();
  const company = String(item.store || item.company || item.organization || '').trim();
  const notes = String(item.notes || item.message || '').trim();

  // 6. Extract :department and :source from URL path
  let department = 'wabastore';
  let source = 'whatsapp';

  const pathParam = req.query.path;
  let segments: string[] = [];

  if (Array.isArray(pathParam)) {
    segments = pathParam;
  } else if (typeof pathParam === 'string') {
    segments = pathParam.split('/').filter(Boolean);
  } else if (req.url) {
    const parsedUrl = new URL(req.url, 'http://localhost');
    const allSegs = parsedUrl.pathname.split('/').filter(Boolean);
    const webhookIdx = allSegs.indexOf('webhooks');
    if (webhookIdx !== -1 && allSegs.length > webhookIdx + 1) {
      segments = allSegs.slice(webhookIdx + 1);
    }
  }

  if (segments.length >= 1 && segments[0]) {
    department = segments[0];
  }
  if (segments.length >= 2 && segments[1]) {
    source = segments[1];
  }

  // 7. Supabase client with server-side environment variables
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  // Server-side only. crm_leads is RLS-protected, so the anon key cannot (and must not) be used here.
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({
      error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY server environment variable'
    });
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  // 8. Insert row into public.crm_leads table
  const { error } = await supabase.from('crm_leads').insert([
    {
      name: name || 'Inbound Lead',
      phone: phone || null,
      email: email || null,
      company: company || null,
      notes: notes || null,
      channel: source,
      department: department || 'wabastore',
      sub_department: 'support',
      status: 'New',
      raw_payload: rawPayload
    }
  ]);

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  return res.status(200).json({ success: true });
}
