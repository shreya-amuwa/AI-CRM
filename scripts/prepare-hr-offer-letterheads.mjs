// Builds server/hrDocuments/offerLetterheads.ts: one letterhead per role-based Offer Letter template (run by hand when a supplied sample changes).
//
//   soffice --headless --convert-to pdf <sample>.docx          (LibreOffice, as for the other HR letters)
//   node scripts/prepare-hr-offer-letterheads.mjs technical-support=<Technical_Support.pdf> customer-support=<Customer_support.pdf> \
//        business-development=<BDE.pdf> sales-executive=<Sales_executive.pdf> ai-developer=<AI_developer.pdf>
//
// For each sample, page 1 is kept with its letterhead untouched (logo, contacts, partner badges, the toll-free line, the footer addresses, the
// department logos and artwork). Only the SAMPLE letter is removed from the page content (not painted over, so nothing of it can be copied out
// of a finished document): every text object between the header and the toll-free line (the date, the reference, the person's name, the
// dates and amounts, the wording) and the page number. The file properties are cleared. The server draws the real letter in that area, on as
// many copies of this page as the letter needs (server/hrDocuments/offerTemplate.ts), using the LAYOUT below (measured on each sample).
import { PDFDocument, PDFName, PDFArray, decodePDFRawStream } from 'pdf-lib';
import fs from 'node:fs';

// Where the sample letter is on page 1, in points from the TOP of the page (drop = text to remove), and where the server writes (PDF points
// from the BOTTOM: dateY = the date's baseline on page 1, top = first line on a following page, bottom = nothing below, pageNo = "n/N").
const LETTERHEADS = {
  'technical-support': { label: 'Amuwa Corporation (Whatsbox footer)', drop: [150, 622], layout: { dateY: 652, dateRight: 536.5, top: 676, bottom: 222, pageNo: { right: 565.2, y: 10.6 } } },
  'customer-support': { label: 'Amuwa Corporation (Customer & Technical Support footer)', drop: [150, 724], layout: { dateY: 640, dateRight: 536.5, top: 676, bottom: 128, pageNo: { right: 565.2, y: 10.6 } } },
  'business-development': { label: 'M Pillar Corporation', drop: [140, 700], layout: { dateY: 673, dateRight: 561, top: 676, bottom: 152, pageNo: { right: 566.5, y: 31.5 } } },
  'sales-executive': { label: 'Amuwa Corporation (Wabastore)', drop: [150, 600], layout: { dateY: 652, dateRight: 536.5, top: 676, bottom: 250, pageNo: { right: 565.2, y: 10.6 } } },
  'ai-developer': { label: 'Amuwa Corporation (AI Studio footer)', drop: [150, 690], layout: { dateY: 652, dateRight: 536.5, top: 676, bottom: 162, pageNo: { right: 565.2, y: 10.6 } } }
};

const args = Object.fromEntries(process.argv.slice(2).map(a => a.split(/=(.*)/s).slice(0, 2)));
const missing = Object.keys(LETTERHEADS).filter(k => !args[k]);
if (missing.length) { console.error(`usage: node scripts/prepare-hr-offer-letterheads.mjs ${Object.keys(LETTERHEADS).map(k => `${k}=<file.pdf>`).join(' ')}\nmissing: ${missing.join(', ')}`); process.exit(1); }

const BLOCK = /BT[\s\S]*?ET/g;
// the position of a text object: its last Tm (text matrix) or Td
const pos = b => {
  const tms = [...b.matchAll(/([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) Tm/g)];
  if (tms.length) { const m = tms[0]; return [+m[5], +m[6]]; }
  const m = /([-\d.]+) ([-\d.]+) Td/.exec(b);
  return m ? [+m[1], +m[2]] : null;
};

async function strip(doc, drop) {
  const page = doc.getPage(0);
  const contents = page.node.Contents();
  const refs = contents instanceof PDFArray ? contents.asArray() : [page.node.get(PDFName.of('Contents'))];
  let removed = 0;
  for (const ref of refs) {
    const stream = doc.context.lookup(ref);
    const text = Buffer.from(decodePDFRawStream(stream).decode()).toString('latin1');
    // the current transformation matrix can move text objects (cm before BT): follow the simple "1 0 0 1 tx ty cm" / "a 0 0 d tx ty cm" cases
    let out = '';
    let last = 0;
    let ctm = [1, 0, 0, 1, 0, 0];
    const stack = [];
    // (a placed image "a 0 0 d x y cm /ImageN Do" is tried first: only small ones in the body, the list bullets, are removed; its q ... Q stays)
    const tokens = /([\d.]+) 0 0 ([\d.]+) ([-\d.]+) ([-\d.]+) cm\s*\/Im\w* Do|(\bq\b)|(\bQ\b)|([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) cm|(BT[\s\S]*?ET)/g;
    for (const m of text.matchAll(tokens)) {
      if (m[1] !== undefined) {
        // a small image in the body: a list bullet
        const [w, h, x, y] = m.slice(1, 5).map(Number);
        if (w < 12 && h < 12) {
          const ax = ctm[0] * x + ctm[2] * y + ctm[4];
          const ay = ctm[1] * x + ctm[3] * y + ctm[5];
          if (drop(ax, ay)) { out += text.slice(last, m.index); last = m.index + m[0].length; removed++; }
        }
        continue;
      }
      if (m[5]) { stack.push(ctm); continue; }
      if (m[6]) { ctm = stack.pop() ?? [1, 0, 0, 1, 0, 0]; continue; }
      if (m[7] !== undefined) {
        const [a, b, c, d, e, f] = m.slice(7, 13).map(Number);
        ctm = [ctm[0] * a + ctm[2] * b, ctm[1] * a + ctm[3] * b, ctm[0] * c + ctm[2] * d, ctm[1] * c + ctm[3] * d, ctm[0] * e + ctm[2] * f + ctm[4], ctm[1] * e + ctm[3] * f + ctm[5]];
        continue;
      }
      if (m[13]) {
        const p = pos(m[13]);
        if (p) {
          const x = ctm[0] * p[0] + ctm[2] * p[1] + ctm[4];
          const y = ctm[1] * p[0] + ctm[3] * p[1] + ctm[5];
          if (drop(x, y)) { out += text.slice(last, m.index); last = m.index + m[0].length; removed++; }
        }
        continue;
      }
    }
    out += text.slice(last);
    if (out !== text) doc.context.assign(ref, doc.context.flateStream(Buffer.from(out, 'latin1')));
  }
  return removed;
}

const entries = [];
for (const [key, def] of Object.entries(LETTERHEADS)) {
  const src = await PDFDocument.load(fs.readFileSync(args[key]));
  const H = src.getPage(0).getHeight();
  const [top, bottom] = def.drop;
  // the sample letter (from under the header down to just above the toll-free line), and the page number "1/N" bottom right
  const removed = await strip(src, (x, y) => (y > H - bottom && y < H - top) || (y < 40 && x > 530));
  const out = await PDFDocument.create();
  const [page] = await out.copyPages(src, [0]);
  out.addPage(page);
  out.setTitle('Letterhead'); out.setAuthor(''); out.setSubject(''); out.setKeywords([]); out.setCreator('Amuwa CRM'); out.setProducer('Amuwa CRM');
  const epoch = new Date('2026-01-01T00:00:00Z');
  out.setCreationDate(epoch); out.setModificationDate(epoch);
  const bytes = await out.save({ useObjectStreams: false });
  console.log(key, { removed, kb: Math.round(bytes.length / 1024) });
  entries.push(`  '${key}': {\n    label: ${JSON.stringify(def.label)},\n    layout: ${JSON.stringify(def.layout)},\n    base64: '${Buffer.from(bytes).toString('base64')}'\n  }`);
}

fs.writeFileSync(new URL('../server/hrDocuments/offerLetterheads.ts', import.meta.url),
`/**
 * GENERATED by scripts/prepare-hr-offer-letterheads.mjs - do not edit by hand.
 * The letterhead of each role-based Offer Letter (page 1 of the supplied sample, with the sample letter removed) and where the letter is written
 * on it. Kept inline so the serverless function needs no file access. ONE string literal per letterhead on purpose (see templateAssets.ts).
 */
export interface OfferLetterheadLayout {
  /** baseline of the date line on page 1 (PDF points from the bottom) */
  dateY: number;
  /** the date line ends here */
  dateRight: number;
  /** the first line on a following page */
  top: number;
  /** nothing is written below this line (the toll-free line and the footer) */
  bottom: number;
  /** where the page number "n/N" ends, and its baseline */
  pageNo: { right: number; y: number };
}
export interface BuiltinLetterhead { label: string; layout: OfferLetterheadLayout; base64: string }

export const OFFER_LETTERHEADS: Record<string, BuiltinLetterhead> = {
${entries.join(',\n')}
};
`);
