// Guard: no credential is written into the code. A key in `src/` ships in the public JavaScript bundle every visitor downloads; one in `server/`,
// `api/`, `worker/` or `vite.config.ts` stays in the repository and its history. Secrets belong in environment variables (.env.example lists
// them). The scan looks for the SHAPE of a credential (a key-like name assigned a UUID or a long token, a Bearer UUID, a signed token, a
// well-known key prefix), so it holds no secret itself.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

let passed = 0;
const check = (ok: boolean, name: string, extra?: unknown) => { if (!ok) { console.error('not ok -', name, extra ?? ''); process.exit(1); } passed++; console.log('ok -', name); };

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const NAMES = '(?:api[_-]?key|apikey|secret|token|password|passwd|authorization|x-api-key|x-webhook-secret|client[_-]?secret|private[_-]?key)';
const PATTERNS: [string, RegExp][] = [
  ['a key-like name assigned a UUID', new RegExp(`['"\`]?${NAMES}['"\`]?\\s*[:=]\\s*['"\`]${UUID}['"\`]`, 'i')],
  ['a header set to a UUID', new RegExp(`\\[\\s*['"](?:authorization|x-api-key|apikey|x-webhook-secret)['"]\\s*\\]\\s*=\\s*['"\`](?:Bearer\\s+)?${UUID}['"\`]`, 'i')],
  ['a Bearer UUID', new RegExp(`Bearer\\s+${UUID}`, 'i')],
  ['a key-like name assigned a long token', new RegExp(`['"\`]?${NAMES}['"\`]?\\s*[:=]\\s*['"\`][A-Za-z0-9_\\-+/=]{32,}['"\`]`, 'i')],
  ['a signed token (JWT)', /['"`]eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}['"`]/],
  ['a well-known secret key prefix', /\b(?:sk_live_|sk-ant-|sntryc_|sntryh_|sntrys_|ghp_|github_pat_|AKIA[0-9A-Z]{16}|xox[bap]-)[A-Za-z0-9_-]{8,}/]
];
export const findSecrets = (text: string): string[] => PATTERNS.filter(([, rx]) => rx.test(text)).map(([why]) => why);

// the scan itself works (made-up values, not real keys)
const fakeUuid = '12345678-1234-4234-8234-123456789abc';
check(findSecrets(`const c = { apiKey: '${fakeUuid}' };`).length > 0, 'it catches a key-like name assigned a UUID');
check(findSecrets(`headers['Authorization'] = 'Bearer ${fakeUuid}';`).length > 0, 'it catches a Bearer UUID in a header');
check(findSecrets(`const token = 'abcdefghijklmnopqrstuvwxyz0123456789ABCD';`).length > 0, 'it catches a long token assigned to "token"');
check(findSecrets("const s = process.env.EMAIL_API_KEY; const apiKey = cfg.apiKey || '';").length === 0, 'it leaves environment reads and empty defaults alone');

const walk = (d: string): string[] => readdirSync(d).flatMap(f => {
  if (f === 'node_modules' || f === 'dist' || f.startsWith('.')) return [];
  const p = join(d, f);
  return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx|js|mjs|cjs)$/.test(p) ? [p] : [];
});
const files = [...walk('src'), ...walk('server'), ...walk('api'), ...walk('worker'), ...walk('shared'), 'vite.config.ts'];
check(files.length > 200, `the scan found the code to check (${files.length} files)`);
const hits: string[] = [];
for (const f of files) {
  const text = readFileSync(f, 'utf8');
  text.split('\n').forEach((line, i) => { const why = findSecrets(line); if (why.length) hits.push(`${f}:${i + 1} (${why.join(', ')})`); });
}
check(hits.length === 0, 'no credential is written into src/, server/, api/, worker/, shared/ or vite.config.ts', hits);
console.log(`=== NO HARD-CODED SECRETS TESTS PASSED (${passed}) ===`);
