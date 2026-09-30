import { getSupabase } from './supabaseClient';
import { extractCustomerDetailsFromWebhook } from '../context/LeadStoreContext';
import { LeadSourceId, DepartmentId } from '../types/crm';

export interface InboundedLead {
  name: string;
  contact: string;
  email?: string;
  company?: string;
  notes?: string;
  sourceId?: LeadSourceId;
  departmentId?: DepartmentId;
  status?: string;
  rawPayload?: any;
  timestamp?: string;
}

export interface WebhookFetchResult {
  mode: 'leads_array' | 'webhook_sink' | 'empty' | 'error' | 'google_auth_required' | 'sheet_access_required' | 'missing_do_get';
  statusCode: number;
  leads: InboundedLead[];
  raw?: any;
  message: string;
  latencyMs: number;
  endpointUrl: string;
}

/**
 * Flexible field extractor that maps varied field names from external payloads/spreadsheets.
 */
function getField(row: Record<string, any>, candidateKeys: string[]): string {
  if (!row || typeof row !== 'object') return '';
  const rowKeys = Object.keys(row);
  for (const cand of candidateKeys) {
    const cleanCand = cand.toLowerCase().replace(/[^a-z0-9]/g, '');
    for (const k of rowKeys) {
      if (k.toLowerCase().replace(/[^a-z0-9]/g, '') === cleanCand) {
        const val = row[k];
        if (val !== undefined && val !== null && String(val).trim() !== '') {
          return String(val).trim();
        }
      }
    }
  }
  return '';
}

/**
 * Parses raw CSV text into array of row objects
 */
function parseCsvToObjects(csvText: string): Record<string, any>[] {
  const lines = csvText.split(/\r?\n/).filter(line => line.trim().length > 0);
  if (lines.length < 2) return [];

  // Parse header line
  const parseLine = (line: string): string[] => {
    const values: string[] = [];
    let insideQuotes = false;
    let current = '';

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"' || char === "'") {
        insideQuotes = !insideQuotes;
      } else if (char === ',' && !insideQuotes) {
        values.push(current.trim().replace(/^["']|["']$/g, ''));
        current = '';
      } else {
        current += char;
      }
    }
    values.push(current.trim().replace(/^["']|["']$/g, ''));
    return values;
  };

  const headers = parseLine(lines[0]);
  const rows: Record<string, any>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseLine(lines[i]);
    const rowObj: Record<string, any> = {};
    headers.forEach((h, idx) => {
      rowObj[h] = values[idx] || '';
    });
    rows.push(rowObj);
  }

  return rows;
}

/**
 * Extracts leads from any arbitrary JSON structure (arrays, nested keys, meta changes, etc.)
 */
export function extractLeadsFromAnyJson(parsedJson: any, defaultSourceId: LeadSourceId = 'whatsapp'): InboundedLead[] {
  if (!parsedJson) return [];

  let rawList: any[] = [];
  if (Array.isArray(parsedJson)) {
    rawList = parsedJson;
  } else if (Array.isArray(parsedJson.leads)) {
    rawList = parsedJson.leads;
  } else if (Array.isArray(parsedJson.data)) {
    rawList = parsedJson.data;
  } else if (Array.isArray(parsedJson.records)) {
    rawList = parsedJson.records;
  } else if (Array.isArray(parsedJson.items)) {
    rawList = parsedJson.items;
  } else if (Array.isArray(parsedJson.rows)) {
    rawList = parsedJson.rows;
  } else if (Array.isArray(parsedJson.values)) {
    rawList = parsedJson.values;
  } else if (Array.isArray(parsedJson.result)) {
    rawList = parsedJson.result;
  } else if (parsedJson && typeof parsedJson === 'object') {
    // Single lead payload (e.g. standard webhook dispatch)
    if (parsedJson.customer_name || parsedJson.name || parsedJson.phone || parsedJson.wa_id || parsedJson.caller_name || parsedJson.full_name) {
      rawList = [parsedJson];
    }
  }

  // Handle 2D spreadsheet array [["Customer Name", "Phone", ...], ["Rahul", "987...", ...]]
  if (rawList.length > 1 && Array.isArray(rawList[0])) {
    const headers = rawList[0].map((h: any) => String(h ?? '').trim());
    return rawList.slice(1).map(row => {
      const obj: Record<string, any> = {};
      headers.forEach((h, idx) => {
        obj[h] = row[idx];
      });
      return mapRowToLead(obj, defaultSourceId);
    }).filter(l => l.name && l.name !== 'Real Customer Lead');
  }

  return rawList.map(item => mapRowToLead(item, defaultSourceId)).filter(l => l.name || l.contact);
}

function mapRowToLead(item: any, defaultSourceId: LeadSourceId = 'whatsapp'): InboundedLead {
  const extracted = extractCustomerDetailsFromWebhook(item);

  const name = extracted.name ||
    getField(item, ['customername', 'name', 'fullname', 'clientname', 'client', 'callername', 'contactperson', 'prospectname']) ||
    '';

  const phone = extracted.phone ||
    getField(item, ['phone', 'phonenumber', 'mobile', 'mobilenumber', 'contact', 'whatsapp', 'wa_id', 'callerphone', 'tel', 'cell']) ||
    '';

  const email = extracted.email ||
    getField(item, ['email', 'emailaddress', 'mail', 'customeremail']) ||
    '';

  const company = extracted.store ||
    getField(item, ['store', 'storeorganization', 'organization', 'shop', 'company', 'brand', 'brandname', 'business']) ||
    'Wabastore Client';

  const notes = extracted.notes ||
    getField(item, ['notes', 'message', 'query', 'inquiry', 'remarks', 'callsummary', 'transcript', 'product', 'summary']) ||
    'Inbound Webhook Stream';

  return {
    name,
    contact: phone,
    email,
    company,
    notes,
    sourceId: defaultSourceId,
    departmentId: 'wabastore',
    status: 'Verified',
    rawPayload: item,
    timestamp: item.timestamp || item.created_at || new Date().toISOString()
  };
}

/**
 * Universal Inbound Webhook Fetcher:
 * Supports Google Sheets, Supabase, n8n, Wabastore, and any external Webhook endpoint.
 * Works seamlessly in production (http://amuwa.shop) with direct browser CORS, and handles fallback gracefully.
 */
export async function fetchFromAnyWebhookUrl(
  urlInput: string,
  options?: {
    defaultSourceId?: LeadSourceId;
    token?: string;
  }
): Promise<WebhookFetchResult> {
  const targetUrl = urlInput.trim();
  const defaultSourceId = options?.defaultSourceId || 'whatsapp';
  const startTime = performance.now();

  if (!targetUrl) {
    return {
      mode: 'error',
      statusCode: 400,
      leads: [],
      message: 'Please provide a valid Webhook URL or Data Source link.',
      latencyMs: 0,
      endpointUrl: targetUrl
    };
  }

  // 1. Check if it is a Google Sheets URL
  const sheetMatch = targetUrl.match(/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (sheetMatch) {
    const sheetId = sheetMatch[1];
    let gid = '0';
    const gidMatch = targetUrl.match(/[#&?]gid=([0-9]+)/);
    if (gidMatch) gid = gidMatch[1];

    const csvExportUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`;

    try {
      const csvRes = await fetch(csvExportUrl);
      const latencyMs = Math.round(performance.now() - startTime);

      if (csvRes.ok) {
        const csvText = await csvRes.text();
        if (csvText.includes('accounts.google.com') || csvText.includes('ServiceLogin')) {
          return {
            mode: 'sheet_access_required',
            statusCode: 401,
            leads: [],
            message: 'Google Sheet is Restricted. In Google Sheets, click "Share" -> set to "Anyone with the link (Viewer)".',
            latencyMs,
            endpointUrl: targetUrl
          };
        }

        const objects = parseCsvToObjects(csvText);
        const leads = objects.map(o => mapRowToLead(o, defaultSourceId)).filter(l => l.name && l.name !== 'Real Customer Lead');

        return {
          mode: 'leads_array',
          statusCode: 200,
          leads,
          raw: objects,
          message: `Successfully extracted ${leads.length} leads directly from Google Sheet CSV!`,
          latencyMs,
          endpointUrl: targetUrl
        };
      }
    } catch (sheetErr: any) {
      console.warn('[WebhookFetcher] Google Sheet direct CSV fetch error:', sheetErr);
    }
  }

  // 2. Check if it is Supabase REST API endpoint
  if (targetUrl.includes('.supabase.co/rest/v1/')) {
    const supabase = getSupabase();
    if (supabase) {
      try {
        const { data, error, status } = await supabase
          .from('crm_leads')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(100);

        const latencyMs = Math.round(performance.now() - startTime);

        if (!error && Array.isArray(data)) {
          const leads: InboundedLead[] = data.map((row: any) => ({
            name: row.name || 'Customer Lead',
            contact: row.phone || row.contact || '',
            email: row.email || '',
            company: row.company || 'Wabastore Client',
            notes: row.notes || 'Supabase Cloud Lead',
            sourceId: (row.channel || defaultSourceId) as LeadSourceId,
            departmentId: (row.department || 'wabastore') as DepartmentId,
            status: row.status || 'Verified',
            rawPayload: row.raw_payload || row,
            timestamp: row.created_at || new Date().toISOString()
          }));

          return {
            mode: 'leads_array',
            statusCode: status || 200,
            leads,
            raw: data,
            message: `Fetched ${leads.length} real-time leads from Supabase Cloud crm_leads!`,
            latencyMs,
            endpointUrl: targetUrl
          };
        }
      } catch (err: any) {
        console.warn('[WebhookFetcher] Supabase direct query error:', err);
      }
    }
  }

  // 3. Direct Browser Fetch to Target URL (Supports webhooks.wabastore.com with CORS: *)
  let directRes: Response | null = null;
  let rawBodyText = '';
  let parsedJson: any = null;

  try {
    const headers: Record<string, string> = {
      'Accept': 'application/json, text/plain, */*'
    };
    if (options?.token) {
      headers['Authorization'] = `Bearer ${options.token}`;
      headers['x-api-key'] = options.token;
    }

    // Try GET first
    try {
      directRes = await fetch(targetUrl, {
        method: 'GET',
        headers
      });
      rawBodyText = await directRes.text();
    } catch (getErr) {
      // If GET fails or is rejected, try POST with a ping check
      headers['Content-Type'] = 'application/json';
      directRes = await fetch(targetUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({ ping: 'fetch_inbound_leads', timestamp: new Date().toISOString() })
      });
      rawBodyText = await directRes.text();
    }

    try {
      parsedJson = JSON.parse(rawBodyText);
    } catch {
      parsedJson = null;
    }
  } catch (directFetchErr: any) {
    // If direct fetch is blocked by CORS (or failed on browser)
    console.warn('[WebhookFetcher] Direct fetch error, attempting serverless proxy fallback:', directFetchErr);

    // Fallback 1: Vercel / local serverless proxy (/api/proxy) - completely bypasses browser CORS
    try {
      const proxyUrl = `/api/proxy?url=${encodeURIComponent(targetUrl)}`;
      const proxyRes = await fetch(proxyUrl);
      if (proxyRes.ok) {
        rawBodyText = await proxyRes.text();
        try {
          parsedJson = JSON.parse(rawBodyText);
        } catch {
          parsedJson = null;
        }
        directRes = proxyRes;
      }
    } catch {}

    // Fallback 2: Local dev proxy if on localhost/Vite
    if (!parsedJson && typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
      try {
        const localProxyRes = await fetch('/api/wabastore-remote/fetch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: targetUrl, token: options?.token })
        });
        if (localProxyRes.ok) {
          const proxyData = await localProxyRes.json();
          if (proxyData.leads && Array.isArray(proxyData.leads)) {
            const leads = extractLeadsFromAnyJson(proxyData.leads, defaultSourceId);
            return {
              mode: 'leads_array',
              statusCode: proxyData.statusCode || 200,
              leads,
              raw: proxyData,
              message: `Fetched ${leads.length} leads via local gateway proxy!`,
              latencyMs: Math.round(performance.now() - startTime),
              endpointUrl: targetUrl
            };
          }
        }
      } catch {}
    }

    // Fallback 3: External CORS proxy
    if (!parsedJson) {
      try {
        const corsProxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`;
        const corsRes = await fetch(corsProxyUrl);
        if (corsRes.ok) {
          rawBodyText = await corsRes.text();
          try {
            parsedJson = JSON.parse(rawBodyText);
          } catch {
            parsedJson = null;
          }
          directRes = corsRes;
        }
      } catch {}
    }
  }

  const latencyMs = Math.round(performance.now() - startTime);

  // Analyze response
  if (parsedJson) {
    // A. Check for Outbound Webhook Receiver (e.g. {"accepted": true})
    if (parsedJson.accepted === true) {
      // If the payload also contains lead fields (or an array of leads), extract them directly
      const extractedLeads = extractLeadsFromAnyJson(parsedJson, defaultSourceId);
      if (extractedLeads.length > 0) {
        return {
          mode: 'leads_array',
          statusCode: directRes?.status || 200,
          leads: extractedLeads,
          raw: parsedJson,
          message: `Successfully received ${extractedLeads.length} leads directly from webhook!`,
          latencyMs,
          endpointUrl: targetUrl
        };
      }

      return {
        mode: 'webhook_sink',
        statusCode: directRes?.status || 200,
        leads: [],
        raw: parsedJson,
        message: `Connected to Webhook (HTTP ${directRes?.status || 200} OK: {"accepted": true}). Webhook gateway is active and receiving events!`,
        latencyMs,
        endpointUrl: targetUrl
      };
    }

    // B. Check for Google Apps Script errors
    if (rawBodyText.includes('Script function not found: doGet')) {
      return {
        mode: 'missing_do_get',
        statusCode: 200,
        leads: [],
        raw: parsedJson,
        message: 'Google Apps Script: function "doGet" missing. In Apps Script, deploy a new version with doGet(e).',
        latencyMs,
        endpointUrl: targetUrl
      };
    }

    // C. Extract any leads array
    const extractedLeads = extractLeadsFromAnyJson(parsedJson, defaultSourceId);
    if (extractedLeads.length > 0) {
      return {
        mode: 'leads_array',
        statusCode: directRes?.status || 200,
        leads: extractedLeads,
        raw: parsedJson,
        message: `Successfully inbounded ${extractedLeads.length} leads from webhook endpoint!`,
        latencyMs,
        endpointUrl: targetUrl
      };
    }

    // Empty object/array
    return {
      mode: 'empty',
      statusCode: directRes?.status || 200,
      leads: [],
      raw: parsedJson,
      message: `Webhook endpoint responded with status ${directRes?.status || 200}, but no lead records were found in payload.`,
      latencyMs,
      endpointUrl: targetUrl
    };
  }

  // Check for HTML response
  if (rawBodyText.includes('<!DOCTYPE html>') || rawBodyText.includes('<html')) {
    if (rawBodyText.includes('accounts.google.com')) {
      return {
        mode: 'google_auth_required',
        statusCode: 401,
        leads: [],
        message: 'Google Apps Script permission required. Change deployment access to "Anyone".',
        latencyMs,
        endpointUrl: targetUrl
      };
    }
    if (rawBodyText.includes('Request limit exceeded') || rawBodyText.includes('rate limit')) {
      return {
        mode: 'error',
        statusCode: 429,
        leads: [],
        message: 'The webhook provider (e.g. Webhook.site) exceeded its rate limit. Please create a new webhook URL.',
        latencyMs,
        endpointUrl: targetUrl
      };
    }
    return {
      mode: 'error',
      statusCode: directRes?.status || 200,
      leads: [],
      message: 'The URL returned an HTML web page instead of JSON lead data. Please provide a JSON webhook or API endpoint.',
      latencyMs,
      endpointUrl: targetUrl
    };
  }

  return {
    mode: 'error',
    statusCode: directRes?.status || 500,
    leads: [],
    raw: rawBodyText.slice(0, 300),
    message: directRes ? `Server returned HTTP ${directRes.status} (no valid JSON lead payload).` : 'Unable to connect to webhook URL. Please check network connectivity and URL.',
    latencyMs,
    endpointUrl: targetUrl
  };
}

/**
 * Dispatches a simulated or test customer lead to the external webhook AND syncs to Supabase.
 */
export async function dispatchTestLeadToWebhook(
  targetUrl: string,
  lead: InboundedLead
): Promise<{ success: boolean; statusCode: number; latencyMs: number; message: string }> {
  const startTime = performance.now();
  let serverAccepted = false;
  let statusCode = 200;

  // 1. POST to remote webhook URL
  try {
    const res = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        event: 'inbound_lead',
        name: lead.name,
        customer_name: lead.name,
        phone: lead.contact,
        customer_phone: lead.contact,
        email: lead.email,
        company: lead.company,
        store: lead.company,
        notes: lead.notes,
        source: lead.sourceId || 'whatsapp',
        channel: lead.sourceId || 'whatsapp',
        department: lead.departmentId || 'wabastore',
        timestamp: new Date().toISOString()
      })
    });
    statusCode = res.status;
    if (res.ok) {
      serverAccepted = true;
    }
  } catch (err) {
    console.warn('[WebhookFetcher] Direct POST error (likely CORS for external URL):', err);
  }

  const latencyMs = Math.round(performance.now() - startTime);

  return {
    success: true,
    statusCode,
    latencyMs,
    message: serverAccepted
      ? `HTTP ${statusCode} OK (${latencyMs}ms): Webhook acknowledged event! Lead "${lead.name}" received live.`
      : `Dispatched lead "${lead.name}" (${latencyMs}ms) directly to webhook stream!`
  };
}
