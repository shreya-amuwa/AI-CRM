import { defineConfig, loadEnv, Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import http from 'http';
import https from 'https';

const sseClients = new Set<any>();

function requestFollowRedirect(
  targetUrlStr: string,
  method: string,
  headers: Record<string, string>,
  postData?: string,
  redirectCount = 0
): Promise<{ statusCode: number; headers: any; body: string; finalUrl: string }> {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) {
      return reject(new Error('Too many HTTP redirects'));
    }
    const targetUrl = new URL(targetUrlStr);
    const isHttps = targetUrl.protocol === 'https:';
    const httpLib = isHttps ? https : http;

    const reqHeaders = { ...headers };
    delete reqHeaders['Host'];
    delete reqHeaders['host'];

    const req = httpLib.request({
      protocol: targetUrl.protocol,
      hostname: targetUrl.hostname,
      port: targetUrl.port || (isHttps ? 443 : 80),
      path: targetUrl.pathname + targetUrl.search,
      method: method,
      headers: reqHeaders
    }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const redirectUrl = new URL(res.headers.location, targetUrlStr).toString();
        const nextMethod = (res.statusCode === 303 || (res.statusCode === 302 && method === 'POST')) ? 'GET' : method;
        const nextHeaders = { ...headers };
        if (nextMethod === 'GET') {
          delete nextHeaders['Content-Type'];
          delete nextHeaders['content-type'];
          delete nextHeaders['Content-Length'];
          delete nextHeaders['content-length'];
        }
        return requestFollowRedirect(redirectUrl, nextMethod, nextHeaders, nextMethod === 'GET' ? undefined : postData, redirectCount + 1)
          .then(resolve)
          .catch(reject);
      }

      let resBody = '';
      res.on('data', chunk => { resBody += chunk; });
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode || 200,
          headers: res.headers,
          body: resBody,
          finalUrl: targetUrlStr
        });
      });
    });

    req.on('error', reject);
    req.setTimeout(12000, () => {
      req.abort();
      reject(new Error('Request timed out (12s)'));
    });

    if (postData && (method === 'POST' || method === 'PUT')) {
      req.write(postData);
    }
    req.end();
  });
}

function extractLeadsFromAnyResponse(parsedJson: any): any[] {
  if (!parsedJson) return [];
  let list: any[] = [];
  if (Array.isArray(parsedJson)) {
    list = parsedJson;
  } else if (Array.isArray(parsedJson.leads)) {
    list = parsedJson.leads;
  } else if (Array.isArray(parsedJson.data)) {
    list = parsedJson.data;
  } else if (Array.isArray(parsedJson.records)) {
    list = parsedJson.records;
  } else if (Array.isArray(parsedJson.rows)) {
    list = parsedJson.rows;
  } else if (Array.isArray(parsedJson.values)) {
    list = parsedJson.values;
  } else if (Array.isArray(parsedJson.items)) {
    list = parsedJson.items;
  } else if (Array.isArray(parsedJson.result)) {
    list = parsedJson.result;
  }

  // Handle 2D spreadsheet array [["Customer Name", "Phone", ...], ["Rahul", "987...", ...]]
  if (list.length > 1 && Array.isArray(list[0])) {
    const headers = list[0].map((h: any) => String(h ?? '').trim());
    return list.slice(1).map(row => {
      const obj: Record<string, any> = {};
      headers.forEach((h: string, idx: number) => {
        obj[h] = row[idx] !== undefined ? row[idx] : '';
      });
      return obj;
    });
  }

  // Handle single lead object if parsedJson or parsedJson.data has lead attributes
  if (list.length === 0) {
    const candidate = (parsedJson && typeof parsedJson.data === 'object' && !Array.isArray(parsedJson.data))
      ? parsedJson.data
      : parsedJson;
    if (candidate && typeof candidate === 'object') {
      const hasLeadProps = candidate.name || candidate.customer_name || candidate.phone || candidate.contact || candidate.mobile || candidate.full_name;
      if (hasLeadProps) {
        list = [candidate];
      }
    }
  }

  return list;
}

function parseCsvRows(csvText: string): any[] {
  if (!csvText || typeof csvText !== 'string') return [];
  // Clean BOM if present
  const cleaned = csvText.replace(/^\uFEFF/, '').trim();
  const lines = cleaned.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
  if (lines.length === 0) return [];

  const splitLine = (text: string): string[] => {
    const cells: string[] = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === '"' || c === "'") {
        inQuotes = !inQuotes;
      } else if (c === ',' && !inQuotes) {
        cells.push(cur.replace(/^["']|["']$/g, '').trim());
        cur = '';
      } else {
        cur += c;
      }
    }
    cells.push(cur.replace(/^["']|["']$/g, '').trim());
    return cells;
  };

  const firstLineCells = splitLine(lines[0]);
  const isLikelyHeader = firstLineCells.some(c => {
    const lower = c.toLowerCase();
    return (
      lower.includes('name') ||
      lower.includes('phone') ||
      lower.includes('email') ||
      lower.includes('contact') ||
      lower.includes('store') ||
      lower.includes('company') ||
      lower.includes('lead') ||
      lower.includes('channel') ||
      lower.includes('mobile') ||
      lower.includes('status')
    );
  });

  const headers = isLikelyHeader
    ? firstLineCells.map(h => h.trim())
    : ['name', 'phone', 'email', 'company', 'notes'];

  const startIndex = isLikelyHeader ? 1 : 0;
  const rows: any[] = [];

  for (let i = startIndex; i < lines.length; i++) {
    const values = splitLine(lines[i]);
    if (values.every(v => v === '')) continue;
    const rowObj: Record<string, any> = {};
    headers.forEach((h, idx) => {
      rowObj[h] = values[idx] !== undefined ? values[idx] : '';
    });
    if (!rowObj.name && values[0]) {
      rowObj.name = values[0];
    }
    rows.push(rowObj);
  }
  return rows;
}

function liveWebhookPlugin(): Plugin {
  return {
    name: 'live-webhook-receiver',
    configureServer(server) {
      // 1. SSE Stream for Real-Time Browser Updates
      server.middlewares.use((req, res, next) => {
        const parsedUrl = new URL(req.url || '', `http://${req.headers.host}`);

        if (parsedUrl.pathname === '/api/webhooks/stream') {
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*'
          });
          res.write(`data: ${JSON.stringify({ type: 'connected', time: new Date().toISOString() })}\n\n`);
          sseClients.add(res);
          req.on('close', () => {
            sseClients.delete(res);
          });
          return;
        }

        // 2. Inbound Webhook Endpoint: /api/webhooks/:department/:source
        if (parsedUrl.pathname.startsWith('/api/webhooks/')) {
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
          res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Webhook-Secret, X-Hub-Signature-256');

          if (req.method === 'OPTIONS') {
            res.statusCode = 204;
            res.end();
            return;
          }

          // Meta / WhatsApp Webhook Handshake (GET hub.challenge)
          if (req.method === 'GET') {
            const challenge = parsedUrl.searchParams.get('hub.challenge');
            res.statusCode = 200;
            res.setHeader('Content-Type', 'text/plain');
            res.end(challenge || JSON.stringify({ status: 'active', message: 'Webhook endpoint listening' }));
            return;
          }

          // Inbound Webhook Ingestion (POST)
          if (req.method === 'POST') {
            let body = '';
            req.on('data', chunk => {
              body += chunk;
            });
            req.on('end', () => {
              try {
                const parts = parsedUrl.pathname.split('/').filter(Boolean); // e.g. ['api', 'webhooks', 'wabastore', 'whatsapp']
                const department = parts[2] || 'wabastore';
                const source = parts[3] || 'whatsapp';
                const payload = body ? JSON.parse(body) : {};

                const broadcastEvent = {
                  type: 'lead_inbound',
                  department,
                  source,
                  payload,
                  receivedAt: new Date().toISOString()
                };

                const messageString = `data: ${JSON.stringify(broadcastEvent)}\n\n`;
                for (const client of sseClients) {
                  try {
                    client.write(messageString);
                  } catch {
                    sseClients.delete(client);
                  }
                }

                res.statusCode = 200;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({
                  success: true,
                  message: 'Lead ingested successfully into unified CRM',
                  department,
                  source,
                  receivedAt: broadcastEvent.receivedAt
                }));

                // Forward to user's remote n8n webhook in the background
                try {
                  const isAiCall = (source === 'aicalling' || source === 'ai_calling' || source === 'lead_src_5');
                  const targetForwardUrl = isAiCall
                    ? 'https://webhooks.wabastore.com/webhook/6a7d9f4e13d7ab0d552aaa9e'
                    : 'https://webhooks.wabastore.com/webhook/6aba0b2fc277c1989c61cd57';

                  const forwardHeaders: Record<string, string> = {
                    'Content-Type': 'application/json',
                    'Content-Length': String(Buffer.byteLength(body))
                  };

                  if (isAiCall) {
                    forwardHeaders['Authorization'] = 'Bearer da5fe28f-9924-4d10-bac3-1b2446f1fe56';
                    forwardHeaders['x-api-key'] = 'da5fe28f-9924-4d10-bac3-1b2446f1fe56';
                    forwardHeaders['apikey'] = 'da5fe28f-9924-4d10-bac3-1b2446f1fe56';
                    forwardHeaders['X-Webhook-Secret'] = 'da5fe28f-9924-4d10-bac3-1b2446f1fe56';
                  }

                  const forwardReq = https.request(targetForwardUrl, {
                    method: 'POST',
                    headers: forwardHeaders
                  });
                  forwardReq.on('error', () => {});
                  forwardReq.write(body);
                  forwardReq.end();
                } catch {
                  // Non-blocking
                }
              } catch (err: any) {
                res.statusCode = 400;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ success: false, error: 'Invalid JSON payload: ' + err.message }));
              }
            });
            return;
          }
        }

        // 3. Remote Server Lead Fetch Proxy: /api/wabastore-remote/fetch
        if (parsedUrl.pathname === '/api/wabastore-remote/fetch') {
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
          res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

          if (req.method === 'OPTIONS') {
            res.statusCode = 204;
            res.end();
            return;
          }

          const handleProxyFetch = (targetUrlStr: string, token?: string, method = 'GET', bodyData?: any) => {
            let effectiveUrl = targetUrlStr.trim();
            const isGoogleSheet = effectiveUrl.includes('docs.google.com/spreadsheets');
            if (isGoogleSheet) {
              const sheetMatch = effectiveUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
              const gidMatch = effectiveUrl.match(/[#?&]gid=([0-9]+)/);
              if (sheetMatch && sheetMatch[1]) {
                const sheetId = sheetMatch[1];
                const gidParam = gidMatch ? `&gid=${gidMatch[1]}` : (sheetId === '1-zJLKmYkio7ussaalkJoS2yr_IMzLogx9M1xQLiBAN4' ? '&gid=1733395287' : '');
                effectiveUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv${gidParam}`;
              }
            }

            const headers: Record<string, string> = {
              'Accept': 'application/json, text/csv, text/plain, */*',
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Wabastore-Sales-OS/2.0'
            };
            if (token) {
              const cleanToken = token.trim();
              headers['Authorization'] = cleanToken.startsWith('Bearer ') ? cleanToken : `Bearer ${cleanToken}`;
              headers['x-api-key'] = cleanToken;
              headers['apikey'] = cleanToken;
            }

            requestFollowRedirect(
              effectiveUrl,
              method,
              headers,
              bodyData ? JSON.stringify(bodyData) : undefined
            )
              .then(remoteRes => {
                let parsedJson: any = null;
                try {
                  parsedJson = JSON.parse(remoteRes.body);
                } catch {}

                let mode = 'unknown';
                let extractedLeads: any[] = [];

                const isGoogleScript = effectiveUrl.includes('script.google.com') || effectiveUrl.includes('script.googleusercontent.com');
                const isHtml = remoteRes.body && (
                  remoteRes.body.trim().startsWith('<') ||
                  remoteRes.body.includes('<!DOCTYPE html') ||
                  (remoteRes.headers && remoteRes.headers['content-type'] && remoteRes.headers['content-type'].includes('text/html'))
                );

                if (parsedJson) {
                  const possibleLeads = extractLeadsFromAnyResponse(parsedJson);
                  if (possibleLeads.length > 0) {
                    mode = 'leads_array';
                    extractedLeads = possibleLeads;
                  } else if (parsedJson.accepted === false) {
                    mode = 'webhook_rejected';
                  } else if (parsedJson.accepted === true || parsedJson.status === 'success' || parsedJson.message || parsedJson.data) {
                    mode = 'webhook_sink';
                  }
                } else if (!isHtml && remoteRes.body) {
                  // Attempt CSV parse for real CSV text
                  const csvRows = parseCsvRows(remoteRes.body);
                  if (csvRows.length > 0) {
                    mode = 'leads_array';
                    extractedLeads = csvRows;
                  }
                }

                // Detect Google Apps Script & Sheet States
                if (
                  remoteRes.body.includes('Script function not found: doGet') ||
                  remoteRes.body.includes('Script function not found: doPost')
                ) {
                  mode = 'missing_do_get';
                  extractedLeads = [];
                } else if (isGoogleSheet && (
                  remoteRes.statusCode === 401 ||
                  remoteRes.statusCode === 403 ||
                  remoteRes.finalUrl.includes('accounts.google.com') ||
                  remoteRes.body.includes('ServiceLogin') ||
                  remoteRes.body.includes('Sign in - Google Accounts')
                )) {
                  mode = 'sheet_access_required';
                  extractedLeads = [];
                } else if (isGoogleScript && (
                  remoteRes.statusCode === 401 ||
                  remoteRes.statusCode === 403 ||
                  remoteRes.finalUrl.includes('accounts.google.com') ||
                  remoteRes.body.includes('ServiceLogin') ||
                  remoteRes.body.includes('Sign in - Google Accounts')
                )) {
                  mode = 'google_auth_required';
                  extractedLeads = [];
                } else if (mode === 'unknown' && (remoteRes.statusCode === 401 || remoteRes.statusCode === 403)) {
                  mode = 'auth_required';
                  extractedLeads = [];
                }

                res.statusCode = 200;
                res.setHeader('Content-Type', 'application/json');
                res.end(
                  JSON.stringify({
                    success:
                      mode !== 'webhook_rejected' &&
                      mode !== 'google_auth_required' &&
                      mode !== 'sheet_access_required' &&
                      mode !== 'missing_do_get' &&
                      mode !== 'auth_required' &&
                      remoteRes.statusCode >= 200 &&
                      remoteRes.statusCode < 300,
                    statusCode: remoteRes.statusCode,
                    mode,
                    leads: extractedLeads,
                    raw: parsedJson || (remoteRes.body.length > 500 ? remoteRes.body.slice(0, 500) + '...' : remoteRes.body),
                    url: targetUrlStr,
                    effectiveUrl,
                    finalUrl: remoteRes.finalUrl
                  })
                );
              })
              .catch(err => {
                res.statusCode = 200;
                res.setHeader('Content-Type', 'application/json');
                res.end(
                  JSON.stringify({
                    success: false,
                    statusCode: 502,
                    error: err.message,
                    url: targetUrlStr
                  })
                );
              });
          };

          if (req.method === 'GET') {
            const targetUrlStr = parsedUrl.searchParams.get('url') || 'https://script.google.com/macros/s/AKfycbyeCTmyncacqe88DEx83oGOqq3ltFfKuR_gTT_9viKr9FxrmpeU0Jw3gjLsJuKCnODSDQ/exec';
            const token = parsedUrl.searchParams.get('token') || undefined;
            handleProxyFetch(targetUrlStr, token, 'GET');
            return;
          }

          let body = '';
          req.on('data', chunk => { body += chunk; });
          req.on('end', () => {
            try {
              const reqData = body ? JSON.parse(body) : {};
              const targetUrlStr = reqData.url || 'https://script.google.com/macros/s/AKfycbyeCTmyncacqe88DEx83oGOqq3ltFfKuR_gTT_9viKr9FxrmpeU0Jw3gjLsJuKCnODSDQ/exec';
              handleProxyFetch(targetUrlStr, reqData.token, reqData.method || 'GET', reqData.body);
            } catch (err: any) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ success: false, error: err.message }));
            }
          });
          return;
        }

        next();
      });
    }
  };
}


/**
 * Serves the backend API (server/app.ts) under /api/v1 during `npm run dev`,
 * mirroring the Vercel function in api/v1/[...route].ts.
 */
function apiV1Plugin(): Plugin {
  return {
    name: 'api-v1',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/v1/') && req.url !== '/api/v1') return next();
        const { handleApiRequest } = await server.ssrLoadModule('/server/app.ts');
        await handleApiRequest(req, res);
      });
    }
  };
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Expose server-only variables (SUPABASE_SERVICE_ROLE_KEY, …) to the dev API
  // middleware. Only VITE_-prefixed variables ever reach the browser bundle.
  const env = loadEnv(mode, process.cwd(), '');
  for (const key of ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'API_ALLOWED_ORIGINS']) {
    if (env[key] && !process.env[key]) process.env[key] = env[key];
  }
  return {
  plugins: [
    apiV1Plugin(),
    liveWebhookPlugin(),
    react({
      fastRefresh: false
    })
  ],
  server: {
    port: 3000,
    host: true
  }
};
});
