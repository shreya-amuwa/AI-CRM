// Runs the mobile audit (docs/MOBILE_UI_GUIDELINES.md) over the browser tests and prints what scrolls sideways, by screen and width.
//   npm run build && node scripts/mobile-audit/run.mjs [ui_client_journey ui_hr_shell ...]
// With no names, every supabase/tests/ui_*.test.mjs is run. Exit code 1 when anything overflows.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const names = process.argv.slice(2);
const tests = (names.length ? names.map(n => `supabase/tests/${n.replace(/\.test\.mjs$/, '')}.test.mjs`) : readdirSync('supabase/tests').filter(f => /^ui_.*\.test\.mjs$/.test(f)).map(f => `supabase/tests/${f}`));
const out = path.join(mkdtempSync(path.join(tmpdir(), 'mobile-audit-')), 'findings.jsonl');
const hook = path.resolve('scripts/mobile-audit/hook.mjs');
// the portals and dashboards whose stand-in data answers every side-menu item: open every item and measure each screen. Other tests
// are measured on the screens they show themselves (opening a menu item their stand-in server does not answer only raises a stub error).
const NAV = '.cd-nav a, .cd-nav button, nav[aria-label$="pages"] button, aside nav button, aside nav a';
const NAV_TESTS = new Set(['ui_client_journey.test.mjs', 'ui_notice_board.test.mjs']);
let failedTests = 0;
for (const t of tests) {
  const r = spawnSync(process.execPath, ['--import', hook, t], { env: { ...process.env, AUDIT_OUT: out, AUDIT_NAV: process.env.AUDIT_NAV ?? (NAV_TESTS.has(path.basename(t)) ? NAV : '') }, encoding: 'utf8', timeout: 900_000 });
  const last = `${r.stdout ?? ''}`.trim().split('\n').pop();
  if (r.status !== 0) failedTests++;
  console.log(`${r.status === 0 ? 'ran ' : 'FAIL'} ${path.basename(t)}  ${last ?? ''}`);
}
const rows = existsSync(out) ? readFileSync(out, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
const byKey = new Map();
for (const r of rows) {
  if (r.error) { console.log(`audit error in ${r.test}: ${r.error}`); continue; }
  for (const o of r.out) {
    const k = `${r.test} | ${r.screen || '(final screen)'} | <${o.tag} class="${o.cls.slice(0, 80)}"> ${o.text.slice(0, 40)}`;
    if (!byKey.has(k)) byKey.set(k, new Set());
    byKey.get(k).add(r.width);
  }
}
console.log(`\n${byKey.size} overflow source(s) across ${tests.length} test(s)${failedTests ? `; ${failedTests} test(s) failed on their own` : ''}`);
for (const [k, w] of byKey) console.log(`  [${[...w].sort((a, b) => a - b).join(', ')}] ${k}`);
process.exit(byKey.size || failedTests ? 1 : 0);
