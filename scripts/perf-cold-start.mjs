#!/usr/bin/env node
/**
 * How long does the API take to start? Bundles api/crm.ts the way a serverless function loads it (your code in one file, npm packages loaded
 * from node_modules) and measures `import()` of it in a FRESH node process, several times. Prints each run and the median.
 * A cold start on Vercel pays this on every new function instance, before the first request is answered.
 *
 *   node scripts/perf-cold-start.mjs            (default 7 runs)
 *   node scripts/perf-cold-start.mjs 15 --modules   (also prints the load time of each heavy npm package)
 */
import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
const runs = Number(process.argv[2]) || 7;
const outDir = resolve(root, '.perf-api.tmp');
const out = resolve(outDir, 'crm.js');
const b = spawnSync('npx', ['esbuild', 'api/crm.ts', '--bundle', '--splitting', '--platform=node', '--format=esm', '--packages=external', `--outdir=${outDir}`, '--log-level=error'], { cwd: root, encoding: 'utf8' });
if (b.status !== 0) { console.error(b.stderr); process.exit(1); }

const timeOf = (spec) => {
  const r = spawnSync(process.execPath, ['-e', `const t=process.hrtime.bigint();import(${JSON.stringify(spec)}).then(()=>console.log((Number(process.hrtime.bigint()-t)/1e6).toFixed(1)))`], {
    cwd: root, encoding: 'utf8', env: { ...process.env, SUPABASE_URL: 'http://localhost:1', SUPABASE_ANON_KEY: 'x' }
  });
  return Number(r.stdout.trim());
};

try {
  const times = [];
  for (let i = 0; i < runs; i++) times.push(timeOf(out));
  times.sort((a, c) => a - c);
  console.log(`API start-up (import of the bundled function), ${runs} fresh processes: ${times.map((t) => t.toFixed(0)).join(' ')} ms`);
  console.log(`median ${times[Math.floor(times.length / 2)].toFixed(0)} ms, best ${times[0].toFixed(0)} ms`);
  if (process.argv.includes('--modules')) {
    for (const m of ['@supabase/supabase-js', 'hono', 'zod', 'nodemailer', 'pdf-lib', 'jszip', '@hpke/core']) console.log(`  ${m.padEnd(24)} ${timeOf(m).toFixed(0)} ms`);
  }
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
