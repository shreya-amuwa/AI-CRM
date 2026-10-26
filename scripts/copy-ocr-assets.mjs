#!/usr/bin/env node
/**
 * Copies the files the in-browser text reader (Tesseract.js) needs into public/ocr, so the app serves them itself:
 * no third-party CDN at run time, nothing blocked by the Content-Security-Policy, and it keeps working on a weak connection once cached.
 * Run automatically before `npm run dev` and `npm run build` (the copies are not committed).
 */
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const pkgDir = name => path.dirname(require.resolve(`${name}/package.json`, { paths: [root] }));
const out = path.join(root, 'public', 'ocr');
mkdirSync(path.join(out, 'lang'), { recursive: true });

const files = [
  [path.join(pkgDir('tesseract.js'), 'dist', 'worker.min.js'), 'worker.min.js'],
  [path.join(pkgDir('tesseract.js-core'), 'tesseract-core-simd-lstm.wasm.js'), 'tesseract-core-simd-lstm.wasm.js'],
  [path.join(pkgDir('tesseract.js-core'), 'tesseract-core-lstm.wasm.js'), 'tesseract-core-lstm.wasm.js'],
  [path.join(pkgDir('@tesseract.js-data/eng'), '4.0.0_best_int', 'eng.traineddata.gz'), path.join('lang', 'eng.traineddata.gz')]
];
let copied = 0;
for (const [from, to] of files) {
  const dest = path.join(out, to);
  if (!existsSync(from)) throw new Error(`Missing ${from}. Run npm install.`);
  if (!existsSync(dest) || statSync(dest).size !== statSync(from).size) {
    copyFileSync(from, dest);
    copied++;
  }
}
console.log(`OCR assets: ${files.length} files in public/ocr (${copied} copied)`);
