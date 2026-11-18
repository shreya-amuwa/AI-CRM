// The installable CRM (attendance reminders, PR 3): the web app manifest and its icons, the push-only service worker and how it is served.
import { existsSync, readFileSync } from 'node:fs';

let passed = 0;
const check = (ok: boolean, name: string, extra?: unknown) => { if (!ok) { console.error('not ok -', name, extra ?? ''); process.exit(1); } passed++; console.log('ok -', name); };
const pngSize = (file: string) => { const b = readFileSync(file); return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }; };

// --- the manifest
const manifest = JSON.parse(readFileSync('public/manifest.webmanifest', 'utf8'));
check(manifest.name === 'Amuwa CRM' && manifest.short_name === 'Amuwa CRM' && manifest.display === 'standalone'
  && manifest.start_url === '/' && manifest.scope === '/', 'manifest parses and has standalone display, start_url "/"', manifest);
const icons = manifest.icons as { src: string; sizes: string; type: string; purpose?: string }[];
for (const size of ['192x192', '512x512']) {
  const icon = icons.find(i => i.sizes === size && (i.purpose ?? 'any') === 'any');
  const file = icon && `public${icon.src}`;
  check(!!file && existsSync(file) && icon!.type === 'image/png' && `${pngSize(file).w}x${pngSize(file).h}` === size, `a ${size} icon that exists on disk at that size`, icon);
}
const maskable = icons.find(i => i.purpose === 'maskable');
check(!!maskable && existsSync(`public${maskable.src}`) && pngSize(`public${maskable.src}`).w === 512, 'one maskable 512 icon (Android crops it to its own shape)');
check(/^#[0-9a-f]{6}$/i.test(manifest.theme_color) && /^#[0-9a-f]{6}$/i.test(manifest.background_color), 'theme and background colours are set');

// --- the page
const html = readFileSync('index.html', 'utf8');
check(/<link rel="manifest" href="\/manifest\.webmanifest"/.test(html), 'index.html links the manifest');
check(/<meta name="theme-color" content="#[0-9a-fA-F]{6}"/.test(html) && /<meta name="apple-mobile-web-app-capable" content="yes"/.test(html)
  && /<meta name="apple-mobile-web-app-title" content="Amuwa CRM"/.test(html), 'iPhone opens the installed app full-screen, named Amuwa CRM');

// --- the service worker: reminders only, never a cache of the CRM
const sw = readFileSync('public/sw.js', 'utf8');
for (const event of ['push', 'notificationclick', 'pushsubscriptionchange']) {
  check(new RegExp(`addEventListener\\(\\s*['"]${event}['"]`).test(sw), `sw.js handles "${event}"`);
}
check(!/addEventListener\(\s*['"]fetch/.test(sw) && !/caches\./.test(sw), 'sw.js has no fetch handler and caches nothing (every page and API call goes to the network)');
check(/\/api\/v1\/attendance\/push-resubscribe/.test(sw), 'a replaced subscription is sent to the resubscribe route');

// --- how it is served
const headers = readFileSync('public/_headers', 'utf8');
check(/\n\/sw\.js\n\s+Cache-Control: no-cache/.test(headers), '_headers serves /sw.js with no-cache (a new version is picked up at once)');

console.log(`=== PWA ASSET TESTS PASSED (${passed}) ===`);
