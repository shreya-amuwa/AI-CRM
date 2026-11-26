import { PDFDocument, StandardFonts, type PDFPage } from 'pdf-lib';
import { boldRuns } from '../../shared/hrLetters.js';
import { fillOfferText, OFFER_MAX_PAGES, type OfferBlock, type OfferTemplateContent } from '../../shared/offerTemplates.js';
import { AppError } from '../http/errors.js';
import { assertPrintable, BLACK, drawRuns, drawWords, LEADING, lineWidth, SIZE, toWords, widthOf, wrap, drawText, type Fonts, type Run, type Word } from './offer.js';
import type { OfferLetterheadLayout } from './offerLetterheads.js';

/**
 * A role-based Offer Letter (shared/offerTemplates.ts) on its own letterhead: the letterhead page (from the supplied sample, or a PDF HR uploaded)
 * is copied for every page of the letter and the wording is written in its body area, laid out as on the samples - the reference and the date
 * line, the title, paragraphs, headings, bulleted lists, signature lines - flowing onto further pages, with "n/N" page numbers.
 *
 * The same template, letterhead and values always give the same bytes, so the preview HR sees is exactly the file that is stored.
 */

const LEFT = 33.5;
const RIGHT = 549;
const BULLET_X = 44.6;
const BULLET_TEXT_X = 52;
const GAP = 13.5;

/** The layout used for a letterhead HR uploaded (the Amuwa letterhead's measurements: an A4 page with a header and footer band). */
export const DEFAULT_LETTERHEAD_LAYOUT: OfferLetterheadLayout = { dateY: 652, dateRight: 536.5, top: 676, bottom: 222, pageNo: { right: 565.2, y: 10.6 } };

interface Block { lines: Word[][]; x: number; center?: boolean; bullet?: boolean; gapBefore: number; keepWithNext?: boolean; rule?: Run[]; pageBreak?: boolean }

export interface OfferTemplateRenderInput {
  content: OfferTemplateContent;
  /** the printed values (shared/offerTemplates.ts checkOfferValues) */
  values: Record<string, string>;
  letterhead: { bytes: Uint8Array; layout: OfferLetterheadLayout };
  /** the PDF's title and the date it carries (for identical bytes on every rendering) */
  documentTitle: string;
  letterDateIso: string;
}

export async function renderOfferTemplatePdf(input: OfferTemplateRenderInput): Promise<Uint8Array> {
  const { content, values, letterhead } = input;
  const L = letterhead.layout;
  let template: PDFDocument;
  try {
    template = await PDFDocument.load(letterhead.bytes, { ignoreEncryption: false });
  } catch {
    throw new AppError('VALIDATION_ERROR', "The template's letterhead PDF cannot be read. Upload the letterhead again.");
  }
  if (template.getPageCount() < 1) throw new AppError('VALIDATION_ERROR', "The template's letterhead PDF has no page.");
  const doc = await PDFDocument.create();
  const fonts: Fonts = { regular: await doc.embedFont(StandardFonts.Helvetica), bold: await doc.embedFont(StandardFonts.HelveticaBold) };
  for (const [k, v] of Object.entries(values)) assertPrintable(fonts, v, `The value of "${k}"`);

  const fill = (t: string) => fillOfferText(t, values);
  const runs = (t: string, bold = false): Run[] => boldRuns(fill(t)).map(r => ({ text: r.text, bold: bold || r.bold }));
  const body = RIGHT - LEFT;
  const lines = (r: Run[], width: number) => wrap(toWords(r, fonts), fonts, width);

  const blocks: Block[] = [];
  let prev: OfferBlock | null = null;
  let first = true;
  for (const b of content.blocks) {
    switch (b.type) {
      case 'title':
        blocks.push({ lines: lines(runs(b.text, true), body), x: LEFT, center: true, gapBefore: first ? 30 : 18, keepWithNext: true });
        break;
      case 'heading':
        blocks.push({ lines: lines(runs(b.text, !b.plain), body), x: LEFT, gapBefore: GAP, keepWithNext: true });
        break;
      case 'paragraph': {
        const gap = first ? 30 : b.tight ? 1 : prev?.type === 'title' ? 12 : GAP;
        blocks.push({ lines: lines(runs(b.text), body), x: LEFT, center: b.align === 'center', gapBefore: gap });
        break;
      }
      case 'bullets':
        b.items.forEach((item, i) => blocks.push({
          lines: lines(runs(item), RIGHT - BULLET_TEXT_X), x: BULLET_TEXT_X, bullet: true,
          gapBefore: i > 0 || prev?.type === 'heading' ? 0.5 : 4
        }));
        break;
      case 'signature':
        blocks.push({ lines: [], x: LEFT, gapBefore: prev?.type === 'signature' ? 14 : 12, rule: runs(b.label) });
        break;
      case 'pageBreak':
        blocks.push({ lines: [], x: LEFT, gapBefore: 0, pageBreak: true });
        break;
    }
    prev = b;
    first = false;
  }
  // signature lines stay together and with the lines just above them ("Regards, / the company / the signatory / Signature:"), so a block that
  // is signed is never split from its signature
  blocks.forEach((b, i) => { if (blocks[i + 1]?.rule && !b.pageBreak) b.keepWithNext = true; });
  for (let i = blocks.length - 1; i > 0; i--) {
    if (blocks[i].keepWithNext && blocks[i].gapBefore <= 1 && !blocks[i - 1].pageBreak && !blocks[i - 1].rule) blocks[i - 1].keepWithNext = true;
  }

  const heightOf = (b: Block) => b.gapBefore + (b.rule ? LEADING : Math.max(1, b.lines.length) * LEADING);
  const pages: PDFPage[] = [];
  const newPage = async () => {
    if (pages.length >= OFFER_MAX_PAGES) throw new AppError('VALIDATION_ERROR', `The letter is longer than ${OFFER_MAX_PAGES} pages. Shorten the wording.`);
    const [p] = await doc.copyPages(template, [0]);
    doc.addPage(p);
    pages.push(p);
    return p;
  };
  let page = await newPage();

  // the reference (left) and the date (right) on page 1, as on the samples
  const left = content.dateLine.left ? fill(content.dateLine.left) : '';
  const right = fill(content.dateLine.right);
  if (left) drawRuns(page, boldRuns(left).map(r => ({ text: r.text, bold: r.bold })), LEFT - 2, L.dateY, fonts);
  if (right) {
    const r = boldRuns(right).map(x => ({ text: x.text, bold: x.bold }));
    const w = r.reduce((s, x) => s + widthOf(x.text, x.bold ? fonts.bold : fonts.regular, SIZE), 0);
    drawRuns(page, r, L.dateRight - w, L.dateY, fonts);
  }
  let y = L.dateY;

  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.pageBreak) { page = await newPage(); y = L.top + GAP; continue; }
    // a heading or a signature line moves with what follows it, so it never ends a page alone
    let need = heightOf(b);
    for (let j = i; blocks[j]?.keepWithNext && j + 1 < blocks.length && !blocks[j + 1].pageBreak; j++) need += heightOf(blocks[j + 1]);
    if (y - need < L.bottom && y < L.top - 1) { page = await newPage(); y = L.top + b.gapBefore; }
    y -= b.gapBefore;
    if (b.rule) {
      const end = drawRuns(page, b.rule, b.x, y, fonts);
      page.drawLine({ start: { x: end + 4, y: y - 2 }, end: { x: end + 4 + 140, y: y - 2 }, thickness: 0.6, color: BLACK });
      y -= LEADING;
      continue;
    }
    for (let k = 0; k < b.lines.length; k++) {
      // a paragraph longer than the space left continues on the next page
      if (k > 0 && y - LEADING < L.bottom) { page = await newPage(); y = L.top; }
      const l = b.lines[k];
      const x = b.center ? LEFT + (body - lineWidth(l, fonts)) / 2 : b.x;
      if (b.bullet && k === 0) page.drawCircle({ x: BULLET_X, y: y + 3.4, size: 2.6, color: BLACK });
      drawWords(page, l, x, y, fonts);
      y -= LEADING;
    }
  }

  // "n/N" where the sample's page number was
  pages.forEach((p, i) => {
    const t = `${i + 1}/${pages.length}`;
    drawText(p, t, L.pageNo.right - fonts.regular.widthOfTextAtSize(t, 7.6), L.pageNo.y, fonts.regular, 7.6);
  });

  const when = new Date(`${input.letterDateIso}T00:00:00Z`);
  doc.setTitle(input.documentTitle); doc.setAuthor('Amuwa Corporation'); doc.setCreator('Amuwa Corporation'); doc.setProducer('Amuwa Corporation');
  doc.setCreationDate(when); doc.setModificationDate(when);
  return doc.save({ useObjectStreams: false });
}
