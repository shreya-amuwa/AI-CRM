/**
 * Regression guard: no secret, API key or token may be written as a literal in the front end or the server code.
 * Anything under src/ is shipped to every browser and stays in git history; credentials belong in server environment variables
 * (docs/SECURITY.md). Run: npm run test:unit
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

let passed = 0;
function check(cond: unknown, label: string, extra?: unknown) {
  if (!cond) {
    console.error(`FAILED: ${label}`, extra === undefined ? '' : JSON.stringify(extra));
    process.exit(1);
  }
  passed++;
  console.log(`ok - ${label}`);
}

const KEY = '(?:secret|authorization|api[_-]?key|token|accessToken|authToken|password|clientSecret|bearer)';
/** a long token-like literal: 20+ URL-safe characters with at least one digit and one letter (so plain words and CONSTANT_NAMES pass). */
const VALUE = `(['"\`])(?:Bearer\\s+)?(?=[A-Za-z0-9_\\-.]*\\d)(?=[A-Za-z0-9_\\-.]*[A-Za-z])[A-Za-z0-9_\\-.]{20,}\\1`;
const PATTERNS: { why: string; re: RegExp }[] = [
  // secret: '...'   apiKey = "..."   'x-api-key': '...'
  { why: 'long literal assigned to a secret / apiKey / token key', re: new RegExp(`['"]?\\b${KEY}['"]?\\]?\\s*[:=]\\s*${VALUE}`, 'i') },
  // const [remoteApiToken, setRemoteApiToken] = useState('...')
  { why: 'long literal as the initial value of a token state', re: new RegExp(`\\[\\w*${KEY}\\w*\\s*,[^\\]]*\\]\\s*=\\s*useState\\(\\s*${VALUE}`, 'i') },
  // activeCfg.secret || (x ? '...' : ...)   -> a built-in fallback token on a line that handles a token
  { why: 'long literal used as a fallback on a line that handles a token', re: new RegExp(`\\b${KEY}\\b[^\\n]*(?:\\|\\||\\?\\?|\\?|:)\\s*\\(?\\s*${VALUE}`, 'i') }
];

export function findSecretLiterals(source: string): { line: number; why: string }[] {
  const out: { line: number; why: string }[] = [];
  source.split('\n').forEach((text, i) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(text)) return; // comments
    for (const p of PATTERNS) if (p.re.test(text)) { out.push({ line: i + 1, why: p.why }); break; }
  });
  return out;
}

// The scanner must catch the shapes that were removed (made-up values), and leave ordinary code alone.
const bad = [
  "    secret: 'abcDEF123456ghiJKL789',",
  "    apiKey: 'aaaaaaaa-1111-4222-8333-bbbbbbbbbbbb',",
  "const [remoteApiToken, setRemoteApiToken] = useState('abcDEF123456ghiJKL789');",
  "const token = cfg.apiKey || cfg.secret || (cfg.sourceId === 'aicalling' ? 'aaaaaaaa-1111-4222-8333-bbbbbbbbbbbb' : undefined);",
  "  headers: { 'x-api-key': 'abcDEF123456ghiJKL789xyz' }",
  "forwardHeaders['Authorization'] = 'Bearer aaaaaaaa-1111-4222-8333-bbbbbbbbbbbb';",
  "forwardHeaders['X-Webhook-Secret'] = 'aaaaaaaa-1111-4222-8333-bbbbbbbbbbbb';"
];
for (const line of bad) check(findSecretLiterals(line).length === 1, `scanner flags: ${line.replace(/[A-Za-z0-9\-]{20,}/g, '<value>')}`);
const fine = [
  "const [remoteApiToken, setRemoteApiToken] = useState('');",
  "const token = remoteApiToken || undefined;",
  "token: process.env.WABASTORE_SOURCE_TOKEN_AICALLING,",
  "const SECRET_HEADER = 'X_WEBHOOK_SECRET_HEADER_NAME';",
  "password: 'short',",
  "// secret: 'abcDEF123456ghiJKL789'",
  "q.in('team_id', ['00000000-0000-0000-0000-000000000000'])",
  "const url = `https://example.com/oauth/token`;",
  "forwardHeaders['Authorization'] = `Bearer ${aiCallToken}`;",
  "headers: { authorization: `Bearer ${apiKey}` }"
];
for (const line of fine) check(findSecretLiterals(line).length === 0, `scanner ignores: ${line}`);

// The real code.
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(name)) out.push(p);
  }
  return out;
}
const found: string[] = [];
// vite.config.ts holds the dev-server middleware; api/ and worker/ are the deployed entry points.
const roots = ['src', 'server', 'api', 'worker', 'vite.config.ts'].filter(r => existsSync(r));
for (const root of roots) {
  for (const file of statSync(root).isDirectory() ? walk(root) : [root]) {
    for (const hit of findSecretLiterals(readFileSync(file, 'utf8'))) found.push(`${file}:${hit.line} (${hit.why})`);
  }
}
// Only the place is printed, never the value.
check(found.length === 0, 'no hard-coded secret / apiKey / token literal in src/, server/, api/, worker/ or vite.config.ts', found);

console.log(`\n${passed} NO HARD-CODED SECRETS CHECKS PASSED`);
