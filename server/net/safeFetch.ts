import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';

/**
 * Outbound requests to addresses a caller names (the /api/proxy helper). Server-side request forgery protection:
 *  - only http / https on the standard ports, no credentials in the URL;
 *  - every address the host name resolves to is checked AT CONNECTION TIME (a custom lookup, so a DNS answer that
 *    changes between the check and the connection cannot reach an internal address);
 *  - loopback, private, link-local (cloud metadata 169.254.169.254), CGNAT, multicast and reserved ranges are refused;
 *  - redirects are followed by hand (max 3) and every hop goes through the same checks;
 *  - GET only, a time limit and a response size limit.
 */
export class BlockedTargetError extends Error {}

const ALLOWED_PORTS = new Set(['', '80', '443']);

/** true when the address is not a public internet address. */
export function isPrivateAddress(address: string): boolean {
  const v = net.isIP(address);
  if (v === 4) return isPrivateV4(address);
  if (v === 6) return isPrivateV6(address);
  return true;
}

function isPrivateV4(ip: string): boolean {
  const [a, b, c] = ip.split('.').map(Number);
  return (
    a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local, cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224 // multicast, reserved, broadcast
  );
}

function isPrivateV6(ip: string): boolean {
  const s = ip.toLowerCase();
  const mapped = /^(?:0{0,4}:){2,5}(?:ffff:)?(\d+\.\d+\.\d+\.\d+)$/.exec(s) || /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (mapped) return isPrivateV4(mapped[1]);
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(s);
  if (hex) {
    const hi = parseInt(hex[1], 16);
    const lo = parseInt(hex[2], 16);
    return isPrivateV4(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }
  return (
    s === '::' || s === '::1' ||
    /^f[cd]/.test(s) || // unique local fc00::/7
    /^fe[89ab]/.test(s) || // link-local fe80::/10
    /^ff/.test(s) || // multicast
    s.startsWith('2001:db8') || s.startsWith('64:ff9b') // documentation, NAT64
  );
}

/** Rejects an unsafe URL before any connection is made. */
export function assertPublicUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new BlockedTargetError('The address is not a valid URL.');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new BlockedTargetError('Only http and https addresses are allowed.');
  if (url.username || url.password) throw new BlockedTargetError('Addresses with a user name or password are not allowed.');
  if (!ALLOWED_PORTS.has(url.port)) throw new BlockedTargetError('Only the standard web ports are allowed.');
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local')) {
    throw new BlockedTargetError('This address is not allowed.');
  }
  if (net.isIP(host) && isPrivateAddress(host)) throw new BlockedTargetError('This address is not allowed.');
  return url;
}

const safeLookup: net.LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { ...options, all: true, verbatim: true }, (err, addresses) => {
    if (err) return (callback as (e: NodeJS.ErrnoException | null) => void)(err);
    const list = (Array.isArray(addresses) ? addresses : []) as dns.LookupAddress[];
    if (!list.length || list.some(a => isPrivateAddress(a.address))) {
      return (callback as (e: NodeJS.ErrnoException | null) => void)(Object.assign(new BlockedTargetError('This address is not allowed.'), { code: 'EBLOCKED' }) as NodeJS.ErrnoException);
    }
    if (options.all) return (callback as (e: null, a: dns.LookupAddress[]) => void)(null, list);
    return (callback as (e: null, a: string, f: number) => void)(null, list[0].address, list[0].family);
  });
};

export interface SafeResponse {
  status: number;
  contentType: string;
  body: Buffer;
}

export interface SafeFetchOptions {
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
}

/**
 * Cloudflare Workers: node:http cannot be given a custom DNS lookup there, so the request is made with fetch. The same URL checks run
 * on every hop; the address check at connection time is Cloudflare's own: a Worker's outgoing requests leave from Cloudflare's network,
 * which has no route to private, loopback or cloud-metadata addresses and refuses host names that resolve to them.
 */
const onWorkers = typeof navigator !== 'undefined' && navigator.userAgent === 'Cloudflare-Workers';

export async function safeGet(raw: string, opts: SafeFetchOptions = {}): Promise<SafeResponse> {
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const maxBytes = opts.maxBytes ?? 2_000_000;
  let url = assertPublicUrl(raw);
  for (let hop = 0; hop <= (opts.maxRedirects ?? 3); hop++) {
    const res = await (onWorkers ? onceWithFetch : once)(url, timeoutMs, maxBytes);
    if (res.status >= 300 && res.status < 400 && res.location) {
      url = assertPublicUrl(new URL(res.location, url).toString());
      continue;
    }
    return { status: res.status, contentType: res.contentType, body: res.body };
  }
  throw new BlockedTargetError('Too many redirects.');
}

function once(url: URL, timeoutMs: number, maxBytes: number): Promise<{ status: number; contentType: string; body: Buffer; location?: string }> {
  return new Promise((resolve, reject) => {
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.request(
      url,
      {
        method: 'GET',
        lookup: safeLookup,
        timeout: timeoutMs,
        headers: { Accept: 'application/json, text/plain, text/csv, */*', 'User-Agent': 'AI-CRM Fetcher' }
      },
      res => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (c: Buffer) => {
          size += c.length;
          if (size > maxBytes) {
            req.destroy(new BlockedTargetError('The response is too large.'));
            return;
          }
          chunks.push(c);
        });
        res.on('end', () =>
          resolve({
            status: res.statusCode || 502,
            contentType: String(res.headers['content-type'] || 'text/plain'),
            body: Buffer.concat(chunks),
            location: typeof res.headers.location === 'string' ? res.headers.location : undefined
          })
        );
        res.on('error', reject);
      }
    );
    req.on('timeout', () => req.destroy(new Error('The address took too long to answer.')));
    req.on('error', reject);
    req.end();
  });
}

async function onceWithFetch(url: URL, timeoutMs: number, maxBytes: number): Promise<{ status: number; contentType: string; body: Buffer; location?: string }> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'GET',
      redirect: 'manual',
      headers: { Accept: 'application/json, text/plain, text/csv, */*', 'User-Agent': 'AI-CRM Fetcher' },
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (err) {
    const timeout = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
    throw new Error(timeout ? 'The address took too long to answer.' : 'Could not reach the address.');
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (res.body) {
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new BlockedTargetError('The response is too large.');
      }
      chunks.push(value);
    }
  }
  return {
    status: res.status || 502,
    contentType: res.headers.get('content-type') || 'text/plain',
    body: Buffer.concat(chunks),
    location: res.headers.get('location') ?? undefined
  };
}
