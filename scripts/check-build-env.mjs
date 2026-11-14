#!/usr/bin/env node
/**
 * Stops a Cloudflare build that would ship a frontend which cannot sign anyone in.
 *
 * VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are baked into the browser bundle WHEN IT IS BUILT. On Cloudflare they must therefore be BUILD
 * variables (Workers & Pages -> the Worker -> Settings -> Build -> Variables and secrets), not only runtime variables: a Worker variable is
 * not visible to `vite build`. Without them the build succeeds and the site loads, but sign-in is broken.
 *
 * Only enforced where it is certain the build is the real one: Cloudflare's build system sets WORKERS_CI (or CF_PAGES); anything else can opt in
 * with REQUIRE_BUILD_ENV=1. Local builds, GitHub CI and Vercel are not affected.
 */
const enforce = !!(process.env.WORKERS_CI || process.env.CF_PAGES || process.env.REQUIRE_BUILD_ENV === '1');
if (!enforce) process.exit(0);

const problems = [];
const url = (process.env.VITE_SUPABASE_URL || '').trim();
const key = (process.env.VITE_SUPABASE_ANON_KEY || '').trim();
if (!url) problems.push('VITE_SUPABASE_URL is not set');
else if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(url) && !/^https:\/\//i.test(url)) problems.push('VITE_SUPABASE_URL is not an https:// address');
else if (/YOUR_PROJECT_REF/i.test(url)) problems.push('VITE_SUPABASE_URL is still the placeholder from .env.example');
if (!key) problems.push('VITE_SUPABASE_ANON_KEY is not set');
else if (/YOUR_SUPABASE/i.test(key)) problems.push('VITE_SUPABASE_ANON_KEY is still the placeholder from .env.example');
for (const name of Object.keys(process.env)) {
  if (/^VITE_.*(SERVICE_ROLE|SECRET|PRIVATE|PASSWORD)/i.test(name)) problems.push(`${name} would be published to every visitor: a VITE_ variable must never hold a secret`);
}
if (problems.length) {
  console.error('\nBuild stopped: the frontend would not be able to sign anyone in, or would expose a secret.\n  - ' + problems.join('\n  - '));
  console.error('\nSet them under the Worker -> Settings -> Build -> Variables and secrets (public values only), then build again. See docs/DEPLOYMENT_CLOUDFLARE.md, step B1.\n');
  process.exit(1);
}
console.log('build env: VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are set');
