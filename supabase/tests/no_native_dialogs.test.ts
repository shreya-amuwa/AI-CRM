/**
 * Guard (docs/APP_FEEDBACK_SYSTEM.md): the browser's own alert() / confirm() / prompt() are not used in the CRM's code, in any spelling
 * (alert(, window.confirm, globalThis.prompt, self.alert, a destructured or aliased reference such as `const { confirm } = window`).
 * Use toast / confirmAction / promptInput / showDetails from src/components/feedback/AppFeedback.tsx instead.
 *
 * Allowed, and only these:
 *   - a function the same file defines itself and happens to call confirm (const confirm = ...); it is checked to exist in that file;
 *   - the PWA install event's own prompt() method (beforeinstallprompt, src/lib/push/pushSupport.ts), which the browser owns;
 *   - third-party bundles shipped as they are (public/ocr: the OCR engine) are not scanned.
 * The browser's "Leave site?" warning (beforeunload) and permission requests (notifications, camera, location) are not dialogs called
 * by the CRM and stay.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOTS = ['src', 'server', 'shared', 'api', 'worker', 'public/sw.js'];
const SKIP_DIRS = new Set(['node_modules', 'dist', 'ocr']);
const EXT = /\.(ts|tsx|js|mjs|jsx)$/;

const files: string[] = [];
const walk = (p: string) => {
  let st;
  try { st = statSync(p); } catch { return; }
  if (st.isDirectory()) { for (const f of readdirSync(p)) if (!SKIP_DIRS.has(f)) walk(path.join(p, f)); }
  else if (EXT.test(p)) files.push(p);
};
ROOTS.forEach(walk);

// comments are not code: strip them (keeping line numbers) before scanning
const stripComments = (src: string) => src
  .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
  .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length));

const CALL = /(?:^|[^.\w$])(alert|confirm|prompt)\s*\(/g;                       // alert(  confirm(  prompt(
const MEMBER = /\b(window|globalThis|self|top|parent)\s*(?:\.\s*|\[\s*['"`])(alert|confirm|prompt)\b/g; // window.confirm  window['alert']
const DESTRUCTURE = /\{[^}]*\b(alert|confirm|prompt)\b[^}]*\}\s*=\s*(window|globalThis|self)\b/g; // const { confirm } = window

const problems: string[] = [];
for (const f of files) {
  const raw = readFileSync(f, 'utf8');
  const src = stripComments(raw);
  const lineOf = (i: number) => src.slice(0, i).split('\n').length;
  for (const m of src.matchAll(MEMBER)) problems.push(`${f}:${lineOf(m.index!)} ${m[0].trim()}`);
  for (const m of src.matchAll(DESTRUCTURE)) problems.push(`${f}:${lineOf(m.index!)} destructures ${m[1]} from ${m[2]}`);
  for (const m of src.matchAll(CALL)) {
    const name = m[1];
    const at = lineOf(m.index!);
    const line = src.split('\n')[at - 1] ?? '';
    // a method declaration or call on an object (event.prompt(), interface { prompt(): ... }) is not the global
    if (/\.\s*$/.test(line.slice(0, line.indexOf(name + '(')))) continue;
    if (name === 'prompt' && /prompt\(\)\s*:\s*Promise/.test(line)) continue; // the PWA install event's own method (typed)
    // the file's own function of that name
    if (new RegExp(`\\b(const|let|function)\\s+${name}\\b`).test(src)) continue;
    problems.push(`${f}:${at} ${name}(`);
  }
}

if (problems.length) {
  console.error('FAILED: the browser\'s own dialogs are used. Use toast / confirmAction / promptInput (src/components/feedback/AppFeedback.tsx):');
  for (const p of problems) console.error('  ' + p);
  process.exit(1);
}
console.log(`ok - ${files.length} files scanned: no alert(), confirm() or prompt() of the browser`);

// the scanner itself finds every spelling (so a "pass" means something)
const samples = ['alert("x")', 'window.confirm("x")', "window['prompt']('x')", 'globalThis.alert(1)', 'const { confirm } = window;', 'self.prompt()'];
for (const s of samples) {
  const hit = [...s.matchAll(MEMBER)].length + [...s.matchAll(DESTRUCTURE)].length + [...s.matchAll(CALL)].length;
  if (!hit) { console.error(`FAILED: the scanner misses ${s}`); process.exit(1); }
}
const clean = ['await confirmAction({ title: "x" })', 'toast.error("x")', 'deferredEvent.prompt()', 'promptInput({ title: "x", label: "y" })'];
for (const s of clean) {
  const hit = [...s.matchAll(MEMBER)].length + [...s.matchAll(CALL)].filter(m => !/\.\s*$/.test(s.slice(0, m.index! + m[0].indexOf(m[1])))).length;
  if (hit) { console.error(`FAILED: the scanner flags ${s}`); process.exit(1); }
}
console.log(`ok - the scanner finds ${samples.length} spellings and leaves ${clean.length} allowed ones alone`);
console.log('\n=== NO NATIVE DIALOGS: PASSED ===');
