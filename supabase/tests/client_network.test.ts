/**
 * Where a request came from (server/security/clientNetwork.ts): the address and place are believed only when the hosting platform set
 * them, a place is never invented, and a slow or failing lookup service can only ever mean "unavailable".
 */
import { geoProviderConfig, isPublicIp, locateRequest, platformLocation, providerLocation, resetGeoCache, trustedClientIp, type GeoFetch } from '../../server/security/clientNetwork.js';

let passed = 0;
function check(ok: unknown, label: string, extra?: unknown) {
  if (!ok) {
    console.error(`FAILED: ${label}`, extra === undefined ? '' : JSON.stringify(extra));
    process.exit(1);
  }
  passed++;
  console.log(`ok - ${label}`);
}
const hdr = (h: Record<string, string>) => (name: string) => h[name];
const VERCEL = { VERCEL: '1' } as NodeJS.ProcessEnv;
const NONE = {} as NodeJS.ProcessEnv;

// --- the address
const forged = hdr({ 'x-real-ip': '6.6.6.6', 'x-forwarded-for': '7.7.7.7, 8.8.8.8' });
check(trustedClientIp(forged, NONE) === null, 'off the platform no address is believed (the headers are what the caller typed)');
check(trustedClientIp(forged, { TRUST_PROXY_HEADERS: 'true' } as any) === '6.6.6.6', 'a proxy declared trusted: x-real-ip');
check(trustedClientIp(hdr({ 'x-vercel-forwarded-for': '203.0.113.5', 'x-real-ip': '6.6.6.6' }), VERCEL) === '203.0.113.5', 'on Vercel its own header wins');
check(trustedClientIp(hdr({ 'x-forwarded-for': '203.0.113.9, 10.0.0.1' }), VERCEL) === '203.0.113.9', 'x-forwarded-for: the first entry');
check(trustedClientIp(hdr({ 'x-real-ip': 'not an ip' }), VERCEL) === null, 'text that is not an address is dropped');
check(trustedClientIp(hdr({ 'x-vercel-forwarded-for': '2001:db8::1' }), VERCEL) === '2001:db8::1', 'IPv6 addresses work');
check(!isPublicIp('10.1.2.3') && !isPublicIp('192.168.0.5') && !isPublicIp('127.0.0.1') && !isPublicIp('::1') && !isPublicIp('172.20.1.1') && !isPublicIp('nope') && isPublicIp('203.0.113.5') && isPublicIp('8.8.8.8'),
  'private, loopback and invalid addresses are not looked up');

// --- the platform's place
const pune = hdr({ 'x-vercel-ip-country': 'IN', 'x-vercel-ip-country-region': 'MH', 'x-vercel-ip-city': 'Pune', 'x-vercel-ip-latitude': '18.5204', 'x-vercel-ip-longitude': '73.8567' });
check(platformLocation(pune, NONE) === null, 'off the platform no place is believed');
let p = platformLocation(pune, VERCEL)!;
check(p.country === 'India' && p.region === 'MH' && p.city === 'Pune' && p.latitude === 18.5204 && p.longitude === 73.8567 && p.source === 'PLATFORM_IP' && p.accuracy === 'CITY', 'a city, region and country with coordinates', p);
p = platformLocation(hdr({ 'x-vercel-ip-city': 'S%C3%A3o%20Paulo', 'x-vercel-ip-country': 'BR' }), VERCEL)!;
check(p.city === 'São Paulo' && p.country === 'Brazil' && p.latitude === null && p.longitude === null, 'a URL-encoded city is decoded; no coordinates are made up');
p = platformLocation(hdr({ 'x-vercel-ip-country': 'in' }), VERCEL)!;
check(p.country === 'India' && p.city === null && p.accuracy === 'COUNTRY', 'country only is country-level');
p = platformLocation(hdr({ 'x-vercel-ip-country': 'IN', 'x-vercel-ip-country-region': 'MH' }), VERCEL)!;
check(p.accuracy === 'REGION', 'region without city is region-level');
check(platformLocation(hdr({}), VERCEL) === null, 'nothing sent: no place');
check(platformLocation(hdr({ 'x-vercel-ip-country': 'ZZZZ', 'x-vercel-ip-latitude': '999' }), VERCEL) === null, 'malformed values give no place');
p = platformLocation(hdr({ 'x-vercel-ip-city': 'Pune', 'x-vercel-ip-latitude': '18.5', 'x-vercel-ip-longitude': 'abc' }), VERCEL)!;
check(p.latitude === null && p.longitude === null, 'one usable coordinate is not enough');
p = platformLocation(hdr({ 'x-vercel-ip-city': 'Pu\u0000ne\n' + 'x'.repeat(300) }), VERCEL)!;
check(p.city!.length <= 100 && !/[\u0000-\u001f]/.test(p.city!), 'control characters are removed and the length is bounded');

// --- the lookup service
check(geoProviderConfig(NONE) === null && geoProviderConfig({ GEOIP_PROVIDER: 'ipinfo' } as any) === null && geoProviderConfig({ GEOIP_PROVIDER: 'other', GEOIP_API_KEY: 'k' } as any) === null, 'no service without a provider and a key');
const cfg = { GEOIP_PROVIDER: 'ipinfo', GEOIP_API_KEY: 'secret-key', ...VERCEL } as NodeJS.ProcessEnv;
check(geoProviderConfig(cfg)!.timeoutMs === 1500 && geoProviderConfig({ ...cfg, GEOIP_TIMEOUT_MS: '100' })!.timeoutMs === 1500 && geoProviderConfig({ ...cfg, GEOIP_TIMEOUT_MS: '2500' })!.timeoutMs === 2500, 'the time limit has a default and bounds');

let calls: { url: string; init: any }[] = [];
const ok = (body: unknown): GeoFetch => async (url, init) => { calls.push({ url, init }); return { ok: true, json: async () => body }; };
resetGeoCache();
p = (await providerLocation('203.0.113.77', cfg, ok({ ip: '203.0.113.77', city: 'Mumbai', region: 'Maharashtra', country: 'IN', loc: '19.0728,72.8826' })))!;
check(p.city === 'Mumbai' && p.region === 'Maharashtra' && p.country === 'India' && p.latitude === 19.0728 && p.source === 'IP_PROVIDER' && p.accuracy === 'CITY', 'the service answer is read', p);
check(calls.length === 1 && calls[0].url === 'https://ipinfo.io/203.0.113.77' && calls[0].init.headers.authorization === 'Bearer secret-key' && !calls[0].url.includes('secret-key'), 'the key goes in a header, never in the address');
await providerLocation('203.0.113.77', cfg, ok({}));
check(calls.length === 1, 'the same address is asked once (cached)');
check((await providerLocation('10.0.0.4', cfg, ok({ city: 'X', country: 'IN' }))) === null && calls.length === 1, 'a private address is never sent to the service');
check((await providerLocation('203.0.113.78', NONE, ok({ city: 'X', country: 'IN' }))) === null && calls.length === 1, 'without a configured service nothing leaves the server');
check((await providerLocation('203.0.113.79', cfg, ok({ ip: '203.0.113.79', bogon: true }))) === null, 'a bogon answer is no place');
check((await providerLocation('203.0.113.80', cfg, async () => ({ ok: false, json: async () => ({ city: 'X', country: 'IN' }) }))) === null, 'a refusal is no place');
check((await providerLocation('203.0.113.81', cfg, async () => { throw new Error('down'); })) === null, 'a failure is no place and does not throw');
const slow: GeoFetch = (_u, init) => new Promise((_res, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
const started = Date.now();
check((await providerLocation('203.0.113.82', { ...cfg, GEOIP_TIMEOUT_MS: '300' }, slow)) === null && Date.now() - started < 1500, 'a service that does not answer is given up on within its time limit');

// --- the whole: the platform first, the service only when the platform gave nothing, never an exception
resetGeoCache();
calls = [];
p = (await locateRequest(pune, '203.0.113.90', cfg, ok({ city: 'Elsewhere', country: 'IN' })))!;
check(p.city === 'Pune' && calls.length === 0, 'the platform place is used and the service is not asked');
p = (await locateRequest(hdr({}), '203.0.113.91', cfg, ok({ city: 'Chennai', country: 'IN' })))!;
check(p.city === 'Chennai' && calls.length === 1, 'without a platform place the service is asked');
check((await locateRequest(hdr({}), null, cfg, ok({ city: 'X', country: 'IN' }))) === null, 'without an address there is nothing to look up');
check((await locateRequest(hdr({}), '203.0.113.92', cfg, async () => { throw new Error('boom'); })) === null, 'a failing service gives "unavailable"');

// --- Cloudflare Workers (worker/index.ts writes these headers from Cloudflare's own data, after dropping any the caller sent)
{
  const CF = { CRM_PLATFORM: 'cloudflare' } as NodeJS.ProcessEnv;
  check(trustedClientIp(hdr({ 'cf-connecting-ip': '203.0.113.20', 'x-real-ip': '6.6.6.6' }), CF) === '203.0.113.20', 'on Cloudflare its own cf-connecting-ip wins');
  check(trustedClientIp(hdr({ 'x-vercel-forwarded-for': '6.6.6.6', 'x-forwarded-for': '7.7.7.7' }), CF) === null, 'on Cloudflare Vercel headers and x-forwarded-for are not believed');
  check(trustedClientIp(hdr({ 'cf-connecting-ip': '203.0.113.20' }), NONE) === null && trustedClientIp(hdr({ 'cf-connecting-ip': '203.0.113.20' }), VERCEL) === null, 'cf-connecting-ip is believed only on Cloudflare');
  let c = platformLocation(hdr({ 'cf-ipcountry': 'IN', 'cf-region': 'Maharashtra', 'cf-ipcity': 'Pune', 'cf-iplatitude': '18.5204', 'cf-iplongitude': '73.8567' }), CF)!;
  check(c.country === 'India' && c.region === 'Maharashtra' && c.city === 'Pune' && c.latitude === 18.5204 && c.longitude === 73.8567 && c.source === 'PLATFORM_IP' && c.accuracy === 'CITY', 'Cloudflare place with coordinates', c);
  c = platformLocation(hdr({ 'cf-ipcountry': 'BR', 'cf-ipcity': 'S%C3%A3o%20Paulo' }), CF)!;
  check(c.city === 'São Paulo' && c.country === 'Brazil', 'a URL-encoded Cloudflare city is decoded');
  check(platformLocation(hdr({ 'cf-ipcountry': 'XX' }), CF) === null && platformLocation(hdr({ 'cf-ipcountry': 'T1' }), CF) === null, 'unknown (XX) and Tor (T1) are no country');
  check(platformLocation(hdr({ 'cf-ipcity': 'Pune' }), NONE) === null && platformLocation(hdr({ 'x-vercel-ip-city': 'Pune' }), CF) === null, 'each platform only believes its own place headers');
}

console.log(`${passed} client network checks passed`);
