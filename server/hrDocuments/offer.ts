import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from 'pdf-lib';
import type { HrDocOfferFields } from '../../shared/contracts.js';
import { boldRuns, fillPlaceholders, type HrOfferContent } from '../../shared/hrLetters.js';
import { AppError } from '../http/errors.js';
import { OFFER_TEMPLATE_BASE64 } from './offerTemplateAsset.js';
import { longDate } from './render.js';

/**
 * The Offer Letter on the official letterhead (offerTemplateAsset.ts: page 1 of the supplied letter with the sample letter removed). The letter is
 * laid out as on the supplied one - date on the right, OFFER LETTER, the subject, the salutation, the paragraphs, Key Responsibilities and
 * Employment Terms as bulleted lists, the closing paragraphs, "For Amuwa Corporation," with the signatory and signature lines, and the Acceptance
 * block - and flows onto as many copies of the letterhead as it needs, each numbered "n/N" where the template's page number was.
 *
 * The wording is the letter's own (shared/hrLetters.ts: a master template version, possibly edited for this letter) with the employee's values
 * filled in. The same fields give the same bytes, so a preview is exactly what is stored.
 */
export { OFFER_FILE_PREFIX } from './constants.js';

const BLACK = rgb(0, 0, 0);
const SIZE = 10.5;
const LEADING = 13.4;
const LEFT = 33.5;
const RIGHT = 549;
const BULLET_X = 44.6;
const BULLET_TEXT_X = 52;
const TOP_FIRST = 652;      // the date's baseline on page 1 (as on the supplied letter)
const TOP_NEXT = 676;       // the first line on a following page
const BOTTOM = 222;         // nothing is written below this line (the toll-free line and the footer)
const GAP = 13.5;           // between blocks

/**
 * The rupee sign (U+20B9) is not in the standard PDF fonts, so it is drawn as a shape: the outline of the DejaVu Sans glyph (units per em 2048,
 * advance 1303), with the y axis turned to SVG's (downward) orientation for drawSvgPath.
 */
const RUPEE_PATH = 'M106 -1370 161 -1493H1199L1144 -1370H790Q869 -1292 890 -1163H1199L1144 -1040H898Q893 -914 832 -829Q767 -736 642 -700Q707 -678 768 -606Q827 -538 892 -408L1097 0H880L689 -383Q614 -534 546 -582Q476 -631 356 -631H136V-797H390Q536 -797 610 -864Q678 -926 684 -1040H106L161 -1163H673Q655 -1230 610 -1282Q536 -1370 390 -1370Z';
const RUPEE_ADVANCE = 1303 / 2048;
const RUPEE = '₹';

type Fonts = { regular: PDFFont; bold: PDFFont };
interface Run { text: string; bold: boolean }
/** A word may change style part-way ("**2026**." is a bold 2026 and a plain full stop with no space between). */
interface Word { parts: Run[]; width: number }

/** Width of a piece of text, the rupee sign included. */
function widthOf(text: string, font: PDFFont, size: number): number {
  let w = 0;
  for (const part of text.split(RUPEE)) w += part ? font.widthOfTextAtSize(part, size) : 0;
  return w + (text.split(RUPEE).length - 1) * RUPEE_ADVANCE * size;
}

function drawText(page: PDFPage, text: string, x: number, y: number, font: PDFFont, size: number): number {
  let cx = x;
  text.split(RUPEE).forEach((part, i) => {
    if (i > 0) {
      page.drawSvgPath(RUPEE_PATH, { x: cx, y, scale: size / 2048, color: BLACK });
      cx += RUPEE_ADVANCE * size;
    }
    if (part) { page.drawText(part, { x: cx, y, size, font, color: BLACK }); cx += font.widthOfTextAtSize(part, size); }
  });
  return cx;
}

/** A value the printing font cannot show is refused with a clear message (never replaced by a question mark). */
function assertPrintable(fonts: Fonts, text: string, label: string): void {
  const plain = text.split(RUPEE).join('');
  try {
    fonts.regular.widthOfTextAtSize(plain, SIZE);
    fonts.bold.widthOfTextAtSize(plain, SIZE);
  } catch {
    throw new AppError('VALIDATION_ERROR', `${label} contains a character that cannot be printed on the letter. Use letters of the English alphabet.`);
  }
}

function toWords(runs: Run[], fonts: Fonts): Word[] {
  const out: Word[] = [];
  let joinNext = false; // the previous run ended inside a word (no space after it)
  for (const r of runs) {
    const pieces = r.text.split(/(\s+)/);
    pieces.forEach((piece, i) => {
      if (!piece) return;
      if (/^\s+$/.test(piece)) { joinNext = false; return; }
      const width = widthOf(piece, r.bold ? fonts.bold : fonts.regular, SIZE);
      const prev = out[out.length - 1];
      if (joinNext && i === 0 && prev) { prev.parts.push({ text: piece, bold: r.bold }); prev.width += width; }
      else out.push({ parts: [{ text: piece, bold: r.bold }], width });
      joinNext = true;
    });
  }
  return out;
}
function wrap(list: Word[], fonts: Fonts, maxWidth: number): Word[][] {
  const space = fonts.regular.widthOfTextAtSize(' ', SIZE);
  const lines: Word[][] = [];
  let line: Word[] = [];
  let used = 0;
  for (const w of list) {
    if (line.length && used + space + w.width > maxWidth) { lines.push(line); line = []; used = 0; }
    used = line.length ? used + space + w.width : w.width;
    line.push(w);
  }
  if (line.length) lines.push(line);
  return lines;
}
const lineWidth = (l: Word[], fonts: Fonts) => l.reduce((s, w) => s + w.width, 0) + Math.max(0, l.length - 1) * fonts.regular.widthOfTextAtSize(' ', SIZE);

/** One thing on the page: a list of lines (each drawn at x, left- or centre-aligned), optionally with a bullet, kept together with what follows. */
interface Block { lines: Word[][]; x: number; maxWidth: number; center?: boolean; bullet?: boolean; gapBefore: number; keepWithNext?: boolean; rule?: { label: Run[]; width: number } }

export async function renderOfferPdf(f: HrDocOfferFields): Promise<Uint8Array> {
  const template = await PDFDocument.load(Buffer.from(OFFER_TEMPLATE_BASE64, 'base64'));
  const doc = await PDFDocument.create();
  const fonts: Fonts = { regular: await doc.embedFont(StandardFonts.Helvetica), bold: await doc.embedFont(StandardFonts.HelveticaBold) };
  const c: HrOfferContent = f.content;

  const values: Record<string, string> = {
    name: f.employeeName, designation: f.designation, department: f.department, joiningDate: longDate(f.joiningDate), employmentType: f.employmentType,
    salary: f.salary, probation: f.probation, reportingTo: f.reportingTo, letterDate: longDate(f.letterDate)
  };
  const fill = (t: string) => fillPlaceholders(t, values);
  const runs = (t: string, bold = false): Run[] => boldRuns(fill(t)).map(r => ({ text: r.text, bold: bold || r.bold }));
  for (const [v, label] of [[f.employeeName, 'The employee name'], [f.designation, 'The designation'], [f.department, 'The department'], [f.salary, 'The salary'], [f.signatoryName, 'The signatory name']] as const) {
    assertPrintable(fonts, v, label);
  }

  const body = RIGHT - LEFT;
  const para = (r: Run[], gapBefore = GAP, extra: Partial<Block> = {}): Block => ({ lines: wrap(toWords(r, fonts), fonts, extra.maxWidth ?? body), x: LEFT, maxWidth: body, gapBefore, ...extra });
  const heading = (t: string): Block => para(runs(t, true), GAP, { keepWithNext: true });
  const bullet = (r: Run[]): Block => ({ lines: wrap(toWords(r, fonts), fonts, RIGHT - BULLET_TEXT_X), x: BULLET_TEXT_X, maxWidth: RIGHT - BULLET_TEXT_X, bullet: true, gapBefore: 0.5 });

  const blocks: Block[] = [];
  blocks.push({ ...para([{ text: 'OFFER LETTER', bold: true }], 30), center: true });
  blocks.push({ ...para([{ text: 'Subject: ', bold: true }, ...runs(c.subject)], 12), center: true });
  blocks.push(para(runs(c.salutation, true), 15));
  c.paragraphs.forEach((p, i) => blocks.push(para(runs(p), i === 0 ? GAP : 1)));
  if (c.responsibilities.length) {
    blocks.push(heading(c.responsibilitiesHeading));
    c.responsibilities.forEach(r => blocks.push(bullet(runs(r))));
  }
  blocks.push(heading(c.termsHeading));
  c.terms.forEach(t => blocks.push(bullet([...runs(`${t.label}: `), ...runs(t.value)])));
  c.closing.forEach((p, i) => blocks.push(para(runs(p), i === 0 ? GAP + 6 : 1)));
  // the company's signature: kept together
  blocks.push({ ...para(runs(c.signOff, true), GAP + 2), keepWithNext: true });
  blocks.push({ ...para([{ text: 'Name:- ', bold: true }, { text: f.signatoryName, bold: true }], 11), keepWithNext: true });
  blocks.push({ lines: [], x: LEFT, maxWidth: body, gapBefore: 11, rule: { label: [{ text: 'Signature:-', bold: true }], width: 125 } });
  // the employee's acceptance: kept together
  blocks.push({ ...heading(c.acceptanceHeading), gapBefore: GAP + 10 });
  blocks.push({ ...para(runs(c.acceptance), 6), keepWithNext: true });
  blocks.push({ lines: [], x: LEFT, maxWidth: body, gapBefore: 14, rule: { label: [{ text: 'Signature:', bold: true }], width: 140 }, keepWithNext: true });
  blocks.push({ lines: [], x: LEFT, maxWidth: body, gapBefore: 22, rule: { label: [{ text: 'Date:', bold: true }], width: 140 } });

  const heightOf = (b: Block) => b.gapBefore + (b.rule ? LEADING : Math.max(1, b.lines.length) * LEADING);
  // the date: right-aligned on page 1, as on the supplied letter
  const pages: PDFPage[] = [];
  const newPage = async () => { const [p] = await doc.copyPages(template, [0]); doc.addPage(p); pages.push(p); return p; };
  let page = await newPage();
  const dateText = `Date: ${longDate(f.letterDate)}`;
  drawText(page, dateText, 536.5 - widthOf(dateText, fonts.regular, SIZE), TOP_FIRST, fonts.regular, SIZE);
  let y = TOP_FIRST;

  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    // a heading or a signature line moves with what follows it, so it never ends a page alone
    let need = heightOf(b);
    for (let j = i; blocks[j]?.keepWithNext && j + 1 < blocks.length; j++) need += heightOf(blocks[j + 1]);
    if (y - need < BOTTOM && y < TOP_NEXT - 1) { page = await newPage(); y = TOP_NEXT + b.gapBefore; }
    y -= b.gapBefore;
    if (b.rule) {
      const end = drawRuns(page, b.rule.label, b.x, y, fonts);
      page.drawLine({ start: { x: end + 4, y: y - 2 }, end: { x: end + 4 + b.rule.width, y: y - 2 }, thickness: 0.6, color: BLACK });
      y -= LEADING;
      continue;
    }
    b.lines.forEach((l, k) => {
      if (k > 0 && y - LEADING < BOTTOM) {
        // a long paragraph continues on the next page (only reached when one block is taller than a page)
        throw new AppError('VALIDATION_ERROR', 'A paragraph of the letter is too long to fit on one page. Shorten it.');
      }
      const x = b.center ? LEFT + (body - lineWidth(l, fonts)) / 2 : b.x;
      if (b.bullet && k === 0) page.drawCircle({ x: BULLET_X, y: y + 3.4, size: 2.6, color: BLACK });
      drawWords(page, l, x, y, fonts);
      y -= LEADING;
    });
  }
  if (pages.length > 4) throw new AppError('VALIDATION_ERROR', 'The letter is longer than four pages. Shorten the wording.');

  // "n/N" where the template's page number was
  pages.forEach((p, i) => {
    const t = `${i + 1}/${pages.length}`;
    p.drawText(t, { x: 565.2 - fonts.regular.widthOfTextAtSize(t, 7.6), y: 10.6, size: 7.6, font: fonts.regular, color: BLACK });
  });

  const when = new Date(`${f.letterDate}T00:00:00Z`);
  doc.setTitle('Offer Letter'); doc.setAuthor('Amuwa Corporation'); doc.setCreator('Amuwa Corporation'); doc.setProducer('Amuwa Corporation');
  doc.setCreationDate(when); doc.setModificationDate(when);
  return doc.save({ useObjectStreams: false });
}

function drawWords(page: PDFPage, line: Word[], x: number, y: number, fonts: Fonts): void {
  const space = fonts.regular.widthOfTextAtSize(' ', SIZE);
  let cx = x;
  for (const w of line) {
    let px = cx;
    for (const part of w.parts) px = drawText(page, part.text, px, y, part.bold ? fonts.bold : fonts.regular, SIZE);
    cx += w.width + space;
  }
}
function drawRuns(page: PDFPage, r: Run[], x: number, y: number, fonts: Fonts): number {
  const ws = toWords(r, fonts);
  drawWords(page, ws, x, y, fonts);
  return x + lineWidth(ws, fonts);
}
