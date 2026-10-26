# Fill a field visit from a photo of the shop

**Dispatch Field Visit** has a card *Fill from a photo of the shop*. The visitor taps **Take / choose photo** (the phone's camera opens), the text on the board is read **on the phone** and the form is filled: shop name, address and contact phone. Nothing is uploaded for reading and nothing is paid for.

## What it does
1. The photo is made upright, scaled to at most 1600 px, turned grey and its contrast stretched (`src/lib/ocr/preparePhoto.ts`).
2. **Tesseract.js** (free, open source, WebAssembly) reads it in a background worker as *sparse text*, which suits signboards (`src/lib/ocr/readShopPhoto.ts`). The engine and its English data are served by the app itself from `/ocr` (copied from `node_modules` by `scripts/copy-ocr-assets.mjs` before `npm run dev` / `npm run build`; not committed). First scan on a phone downloads about 7 MB once; after that it is cached by the browser. The reader frees its memory two minutes after the last scan.
3. `src/lib/ocr/shopText.ts` turns the lines into fields:
   - **Shop name**: the most prominent text that is not contact data (tall and readable, two close lines of similar size are joined); CAPITALS are tidied.
   - **Phones**: Indian mobiles (`+91 98112 00000`) and landlines; digits misread as letters (O, l, I, S, B, Z) are repaired inside number-like strings. More than one number: the first is filled, the others are one tap away.
   - **Address**: lines that look like one (road, market, sector, near, shop no. ...) joined with the pincode line.
   - **Also read, saved with the visit** (`field_visits.details.shopDetails`, no migration): shop type guess (pharmacy, mobile & electronics, kirana ...), e-mail, website, GSTIN, pincode and the raw text.
4. `src/lib/ocr/scanFill.ts` decides what is filled: empty fields, and fields that still hold a value from an earlier photo. **What the person typed is never overwritten.**

## Trust
Reading a sign is a good guess, not a fact. Filled fields say *Read from the photo* (amber *not sure, please check* when the engine was unsure, or a code such as a GSTIN looks damaged); typing in a field removes the note. The photo itself is not stored by this feature.

## Tested
`supabase/tests/shop_text.test.ts` (parser and fill rules) and `supabase/tests/ocr_shop_photo.test.mjs`: the real engine in Chromium under the production Content-Security-Policy against drawn shop boards (clean, and tilted + dim + noisy), then the form: photo in, fields out, one-tap alternatives, typed values kept, a non-photo refused, no sideways scrolling at phone width. The boards are synthetic: **try real photos** (decorative fonts, Hindi or regional-language boards and strong glare read much worse; English text on a plain board reads well).

## Deployment notes
* `vercel.json`: the Content-Security-Policy `script-src` now allows `'wasm-unsafe-eval'` (WebAssembly only; it does not allow `eval()` of strings). The `/ocr/` files are excluded from the single-page-app rewrite.
* Hindi or another language: add its `*.traineddata.gz` (package `@tesseract.js-data/<lang>`) to `scripts/copy-ocr-assets.mjs` and `createWorker('eng+hin', ...)`; the data files are several MB each.
* If real photos read badly, the next step is a fallback to Google Cloud Vision (first 1,000 images a month free) called from the API when the reader is unsure.
