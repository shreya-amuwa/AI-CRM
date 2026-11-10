import net from 'node:net';

/**
 * Where a request came from, as far as the hosting platform can be believed.
 *
 * - The caller's address is read ONLY from headers the platform sets itself, and only when the app runs behind that platform
 *   (Vercel sets VERCEL; the Cloudflare Worker sets CRM_PLATFORM=cloudflare in wrangler.jsonc; any other trusted reverse proxy must say
 *   so with TRUST_PROXY_HEADERS=true). Anywhere else (a laptop, a test
 *   run, a server reachable directly) the same headers are just text the caller typed, so no address is recorded rather than a forged one.
 * - The place comes from the platform's own IP lookup (Vercel's x-vercel-ip-* headers; on Cloudflare the cf-ip* headers worker/index.ts
 *   writes from request.cf after dropping any the caller sent: no key, no extra request, cannot slow a sign-in).
 *   Only when those are absent AND an IP lookup service is configured (GEOIP_PROVIDER + GEOIP_API_KEY, server environment only) is it
 *   asked, with a short time limit; any failure means "unavailable", never a guess.
 * - A place found from an address is the network's location, not the person's: it is stored as such (source + accuracy), coordinates
 *   are rounded to about 1 km by the database, and nothing here asks the browser for its position.
 */
export type GeoSource = 'PLATFORM_IP' | 'IP_PROVIDER';
export type GeoAccuracy = 'COUNTRY' | 'REGION' | 'CITY';

export interface GeoLocation {
  country: string | null;
  region: string | null;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
  source: GeoSource;
  accuracy: GeoAccuracy;
}

export type HeaderReader = (name: string) => string | undefined;

export function proxyHeadersTrusted(env: NodeJS.ProcessEnv = process.env): boolean {
  return !!env.VERCEL || onCloudflare(env) || env.TRUST_PROXY_HEADERS === 'true';
}

/** Running as the Cloudflare Worker (worker/index.ts), where Cloudflare itself sets cf-connecting-ip on every request. */
function onCloudflare(env: NodeJS.ProcessEnv): boolean {
  return env.CRM_PLATFORM === 'cloudflare';
}

/** Loopback, private, link-local and similar addresses: nobody can be located from them. */
export function isPublicIp(ip: string): boolean {
  const kind = net.isIP(ip);
  if (kind === 4) {
    const [a, b] = ip.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168));
  }
  if (kind === 6) {
    const v = ip.toLowerCase();
    return !(v === '::' || v === '::1' || v.startsWith('fe80:') || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('::ffff:'));
  }
  return false;
}

/** The caller's address from platform-set headers; null when the platform is not trusted or sent nothing usable. */
export function trustedClientIp(header: HeaderReader, env: NodeJS.ProcessEnv = process.env): string | null {
  if (!proxyHeadersTrusted(env)) return null;
  const candidates = onCloudflare(env)
    ? [header('cf-connecting-ip'), header('x-real-ip')]
    : [header('x-vercel-forwarded-for'), header('x-real-ip'), header('x-forwarded-for')?.split(',')[0]];
  for (const raw of candidates) {
    const ip = raw?.trim();
    if (ip && net.isIP(ip)) return ip;
  }
  return null;
}

const countryNames = (() => {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' });
  } catch {
    return null;
  }
})();

function countryName(code: string): string {
  try {
    return countryNames?.of(code.toUpperCase()) || code.toUpperCase();
  } catch {
    return code.toUpperCase();
  }
}

function clean(v: string | null | undefined, max = 100): string | null {
  const s = (v ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return s ? s.slice(0, max) : null;
}

function decode(v: string | undefined): string | null {
  if (!v) return null;
  try {
    return clean(decodeURIComponent(v));
  } catch {
    return clean(v);
  }
}

function coordinate(v: string | null | undefined, limit: number): number | null {
  if (v === null || v === undefined || String(v).trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && Math.abs(n) <= limit ? n : null;
}

function describe(country: string | null, region: string | null, city: string | null, lat: number | null, lon: number | null, source: GeoSource): GeoLocation | null {
  if (!country && !region && !city) return null;
  const both = lat !== null && lon !== null;
  return {
    country,
    region,
    city,
    latitude: both ? lat : null,
    longitude: both ? lon : null,
    source,
    accuracy: city ? 'CITY' : region ? 'REGION' : 'COUNTRY'
  };
}

/** The platform's own lookup (Vercel, or Cloudflare's request.cf). Null off the platform or when it sent nothing. */
export function platformLocation(header: HeaderReader, env: NodeJS.ProcessEnv = process.env): GeoLocation | null {
  if (!proxyHeadersTrusted(env)) return null;
  if (onCloudflare(env)) {
    // XX = unknown, T1 = Tor: no country
    const cc = clean(header('cf-ipcountry'), 20);
    return describe(
      cc && /^[A-Za-z]{2}$/.test(cc) && cc.toUpperCase() !== 'XX' ? countryName(cc) : null,
      decode(header('cf-region')),
      decode(header('cf-ipcity')),
      coordinate(decode(header('cf-iplatitude')), 90),
      coordinate(decode(header('cf-iplongitude')), 180),
      'PLATFORM_IP'
    );
  }
  const code = clean(header('x-vercel-ip-country'), 20);
  return describe(
    code && /^[A-Za-z]{2}$/.test(code) ? countryName(code) : null,
    decode(header('x-vercel-ip-country-region')),
    decode(header('x-vercel-ip-city')),
    coordinate(header('x-vercel-ip-latitude'), 90),
    coordinate(header('x-vercel-ip-longitude'), 180),
    'PLATFORM_IP'
  );
}

// ---------------------------------------------------------------------------
// Optional IP lookup service (server environment only)
// ---------------------------------------------------------------------------
export interface GeoProviderConfig {
  provider: 'ipinfo';
  apiKey: string;
  timeoutMs: number;
}

/**
 * GEOIP_PROVIDER   "ipinfo" (https://ipinfo.io). Unset: no service is used and nothing leaves the server.
 * GEOIP_API_KEY    the service's access token. Never sent to the browser, never stored.
 * GEOIP_TIMEOUT_MS how long a sign-in may wait for it (default 1500, 300 to 5000). After that the place is "unavailable".
 */
export function geoProviderConfig(env: NodeJS.ProcessEnv = process.env): GeoProviderConfig | null {
  const provider = (env.GEOIP_PROVIDER || '').trim().toLowerCase();
  const apiKey = (env.GEOIP_API_KEY || '').trim();
  if (provider !== 'ipinfo' || !apiKey) return null;
  const t = Number(env.GEOIP_TIMEOUT_MS);
  return { provider, apiKey, timeoutMs: Number.isFinite(t) && t >= 300 && t <= 5000 ? t : 1500 };
}

export type GeoFetch = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

const CACHE_MAX = 2000;
const HIT_MS = 6 * 3600_000;
const MISS_MS = 5 * 60_000;
const cache = new Map<string, { at: number; value: GeoLocation | null }>();

export function resetGeoCache(): void {
  cache.clear();
}

export async function providerLocation(
  ip: string,
  env: NodeJS.ProcessEnv = process.env,
  doFetch: GeoFetch = (url, init) => fetch(url, init)
): Promise<GeoLocation | null> {
  const cfg = geoProviderConfig(env);
  if (!cfg || !isPublicIp(ip)) return null;
  const hit = cache.get(ip);
  if (hit && Date.now() - hit.at < (hit.value ? HIT_MS : MISS_MS)) return hit.value;

  let value: GeoLocation | null = null;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), cfg.timeoutMs);
  try {
    const res = await doFetch(`https://ipinfo.io/${encodeURIComponent(ip)}`, { headers: { accept: 'application/json', authorization: `Bearer ${cfg.apiKey}` }, signal: ctl.signal });
    if (res.ok) {
      const j = (await res.json()) as Record<string, unknown>;
      const [lat, lon] = typeof j.loc === 'string' ? j.loc.split(',') : [];
      const code = clean(typeof j.country === 'string' ? j.country : null, 20);
      value = j.bogon
        ? null
        : describe(
            code && /^[A-Za-z]{2}$/.test(code) ? countryName(code) : null,
            clean(typeof j.region === 'string' ? j.region : null),
            clean(typeof j.city === 'string' ? j.city : null),
            coordinate(lat, 90),
            coordinate(lon, 180),
            'IP_PROVIDER'
          );
    }
  } catch {
    value = null; // slow, down or refused: the place is "unavailable", the sign-in goes on
  } finally {
    clearTimeout(timer);
  }
  if (cache.size >= CACHE_MAX) cache.clear();
  cache.set(ip, { at: Date.now(), value });
  return value;
}

/** The place of a request: the platform's lookup first, the configured service only when the platform gave none. Never throws. */
export async function locateRequest(header: HeaderReader, ip: string | null, env: NodeJS.ProcessEnv = process.env, doFetch?: GeoFetch): Promise<GeoLocation | null> {
  try {
    return platformLocation(header, env) ?? (ip ? await providerLocation(ip, env, doFetch) : null);
  } catch {
    return null;
  }
}
