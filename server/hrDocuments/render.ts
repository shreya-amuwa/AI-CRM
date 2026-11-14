import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from 'pdf-lib';
import type { HrDocExperienceFields, HrDocNdaFields, HrDocTitle } from '../../shared/contracts.js';
import { boldRuns, DEFAULT_EXPERIENCE_CONTENT, fillPlaceholders, pronounValues, type HrExperienceContent } from '../../shared/hrLetters.js';
import { AppError } from '../http/errors.js';
import { EXPERIENCE_TEMPLATE_BASE64, NDA_TEMPLATE_BASE64 } from './templateAssets.js';

/**
 * NDA and Experience Letter, drawn on the official templates (templateAssets.ts). Everything that is not a field - the artwork, the
 * header and footer, every clause of the NDA, the wording of the letter - is the template itself or its exact text. Only the few
 * values below are written, at the positions of the template's own sample values:
 *
 *   NDA, page 1     "Date: dd-mm-yyyy" (bold, right-aligned under the title)
 *   NDA, page 5     the Employee Acceptance line "I, <name> acknowledge and accept the same. ..."
 *   Experience Letter: date, the paragraph naming the employee, designation and dates, the pronouns, and the signatory block.
 *
 * The same fields give the same bytes (the PDF dates are the letter's date), so a preview is exactly what is stored.
 */

// (the file-name prefixes and the default signatory live in ./constants.ts so callers that only need them do not load pdf-lib)
export { NDA_FILE_PREFIX, EXPERIENCE_FILE_PREFIX, DEFAULT_SIGNATORY } from './constants.js';

type Fonts = { regular: PDFFont; bold: PDFFont };
interface Run { text: string; bold?: boolean }
interface Word { text: string; bold: boolean; width: number }

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** dd-mm-yyyy (the NDA) / dd/mm/yyyy (the letter), as on the templates. */
export function numericDate(iso: string, sep: '-' | '/'): string {
  const m = DAY.exec(iso);
  if (!m) throw new AppError('VALIDATION_ERROR', 'Enter a real date.');
  return `${m[3]}${sep}${m[2]}${sep}${m[1]}`;
}
/** "04th May 2026", the style of the template's own sample. */
export function longDate(iso: string): string {
  const m = DAY.exec(iso);
  if (!m) throw new AppError('VALIDATION_ERROR', 'Enter a real date.');
  const day = Number(m[3]);
  const suffix = day % 100 >= 11 && day % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[day % 10] ?? 'th';
  return `${m[3]}${suffix} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

/** The pronouns follow the title HR chooses; they are never guessed from a name. */
export function pronouns(title: HrDocTitle): { subject: string; object: string; possessive: string; Subject: string } {
  return title === 'Mr.'
    ? { subject: 'he', object: 'him', possessive: 'his', Subject: 'He' }
    : { subject: 'she', object: 'her', possessive: 'her', Subject: 'She' };
}

async function embed(doc: PDFDocument): Promise<Fonts> {
  return { regular: await doc.embedFont(StandardFonts.Helvetica), bold: await doc.embedFont(StandardFonts.HelveticaBold) };
}

/** A value the printing font cannot show is refused with a clear message (never replaced by a question mark). */
function assertPrintable(fonts: Fonts, text: string, label: string): void {
  try {
    fonts.regular.widthOfTextAtSize(text, 10);
    fonts.bold.widthOfTextAtSize(text, 10);
  } catch {
    throw new AppError('VALIDATION_ERROR', `${label} contains a character that cannot be printed on the document. Use letters of the English alphabet.`);
  }
}

function words(runs: Run[], fonts: Fonts, size: number): Word[] {
  const out: Word[] = [];
  for (const r of runs) {
    for (const w of r.text.split(/\s+/).filter(Boolean)) {
      const font = r.bold ? fonts.bold : fonts.regular;
      out.push({ text: w, bold: !!r.bold, width: font.widthOfTextAtSize(w, size) });
    }
  }
  return out;
}

/** Greedy line breaking of styled words. A word that is longer than the line stays on a line of its own. */
function wrap(list: Word[], fonts: Fonts, size: number, maxWidth: number): Word[][] {
  const space = fonts.regular.widthOfTextAtSize(' ', size);
  const lines: Word[][] = [];
  let line: Word[] = [];
  let used = 0;
  for (const w of list) {
    const need = line.length ? used + space + w.width : w.width;
    if (line.length && need > maxWidth) { lines.push(line); line = []; used = 0; }
    used = line.length ? used + space + w.width : w.width;
    line.push(w);
  }
  if (line.length) lines.push(line);
  return lines;
}

function drawLine(page: PDFPage, line: Word[], fonts: Fonts, size: number, x: number, y: number, color: ReturnType<typeof rgb>): void {
  const space = fonts.regular.widthOfTextAtSize(' ', size);
  let cx = x;
  for (const w of line) {
    page.drawText(w.text, { x: cx, y, size, font: w.bold ? fonts.bold : fonts.regular, color });
    cx += w.width + space;
  }
}

/** Draws a paragraph and returns the baseline of its last line. */
function paragraph(page: PDFPage, runs: Run[], fonts: Fonts, o: { x: number; y: number; size: number; maxWidth: number; leading: number; color: ReturnType<typeof rgb> }): number {
  const lines = wrap(words(runs, fonts, o.size), fonts, o.size, o.maxWidth);
  let y = o.y;
  lines.forEach((l, i) => { if (i) y -= o.leading; drawLine(page, l, fonts, o.size, o.x, y, o.color); });
  return y;
}

function stamp(doc: PDFDocument, title: string, iso: string): void {
  const when = new Date(`${iso}T00:00:00Z`);
  doc.setTitle(title);
  doc.setAuthor('Amuwa Corporation');
  doc.setCreator('Amuwa Corporation');
  doc.setProducer('Amuwa Corporation');
  doc.setCreationDate(when);
  doc.setModificationDate(when);
}

const BLACK = rgb(0, 0, 0);
/** The Employee Acceptance line of the NDA is dark green in the template. */
const NDA_GREEN = rgb(0, 0.192, 0.122);

export async function renderNdaPdf(f: HrDocNdaFields): Promise<Uint8Array> {
  const doc = await PDFDocument.load(Buffer.from(NDA_TEMPLATE_BASE64, 'base64'));
  const fonts = await embed(doc);
  assertPrintable(fonts, f.employeeName, 'The employee name');

  // page 1: "Date: dd-mm-yyyy", bold, ending where the template's date ended
  const date = `Date: ${numericDate(f.letterDate, '-')}`;
  const p1 = doc.getPage(0);
  // Helvetica sets wider than the template's Verdana / Calibri, so the sizes are a little under the template's 11.04
  p1.drawText(date, { x: 557.76 - fonts.bold.widthOfTextAtSize(date, 10.2), y: 653.5, size: 10.2, font: fonts.bold, color: BLACK });

  // page 5: the Employee Acceptance line. The name is bold; a long name moves the end of the sentence onto a second line.
  const p5 = doc.getPage(4);
  paragraph(p5, [
    { text: 'I,' },
    { text: f.employeeName, bold: true },
    { text: 'acknowledge and accept the same. I undertake to comply with all the obligations contained herein.' }
  ], fonts, { x: 28.32, y: 582.43, size: 10.3, maxWidth: 565.2 - 28.32, leading: 13.44, color: NDA_GREEN });

  stamp(doc, 'Non-Disclosure Agreement', f.letterDate);
  return doc.save({ useObjectStreams: false });
}

/**
 * joiningDate is the HR record's, not an edited value: the server passes it in. The wording is the letter's own (a master template version,
 * possibly edited for this letter); version 1 is the supplied letter's text, so without an edit the letter is exactly the template's.
 */
export async function renderExperiencePdf(f: HrDocExperienceFields, joiningDate: string, content: HrExperienceContent = DEFAULT_EXPERIENCE_CONTENT): Promise<Uint8Array> {
  const doc = await PDFDocument.load(Buffer.from(EXPERIENCE_TEMPLATE_BASE64, 'base64'));
  const fonts = await embed(doc);
  for (const [value, label] of [[f.employeeName, 'The employee name'], [f.designation, 'The designation'], [f.signatoryName, 'The signatory name'], [f.signatoryTitle, 'The signatory title']] as const) {
    assertPrintable(fonts, value, label);
  }
  const page = doc.getPage(0);
  const o = { x: 62.5, size: 10, maxWidth: 468, leading: 12.7, color: BLACK };
  const NEXT = 20.85; // baseline to baseline between one paragraph's last line and the next block, as on the template

  page.drawText(`Date: ${numericDate(f.letterDate, '/')}`, { x: 62.5, y: 639.039, size: 10, font: fonts.regular, color: BLACK });
  // The wording of the letter, with the employee, the designation, the dates and the pronouns filled in.
  const values: Record<string, string> = {
    title: f.title, name: f.employeeName, designation: f.designation, from: longDate(joiningDate), to: longDate(f.lastWorkingDate),
    letterDate: longDate(f.letterDate), ...pronounValues(f.title)
  };
  const fill = (t: string) => fillPlaceholders(t, values);
  for (const t of [content.greeting, ...content.paragraphs, content.signOff]) assertPrintable(fonts, fill(t).replace(/\*\*/g, ''), 'The letter text');
  page.drawText(fill(content.greeting), { x: 62.5, y: 600.439, size: 10, font: fonts.regular, color: BLACK });
  const paragraphs: Run[][] = content.paragraphs.map(t => boldRuns(fill(t)));
  let y = 579.639;
  for (const runs of paragraphs) {
    y = paragraph(page, runs, fonts, { ...o, y }) - NEXT;
  }
  // "Sincerely," then room to sign, then the signatory and the company (bold), as on the template
  page.drawText(fill(content.signOff), { x: 62.5, y, size: 10, font: fonts.regular, color: BLACK });
  y -= 33.75;
  page.drawText(f.signatoryName, { x: 62.5, y, size: 10, font: fonts.regular, color: BLACK });
  y -= 13.9;
  page.drawText(f.signatoryTitle, { x: 62.5, y, size: 10, font: fonts.regular, color: BLACK });
  y -= 13.9;
  page.drawText('Amuwa Corporation', { x: 62.5, y, size: 10, font: fonts.bold, color: BLACK });
  if (y < 290) throw new AppError('VALIDATION_ERROR', 'The letter does not fit on the page. Shorten the wording or the designation.');

  stamp(doc, 'Experience Letter', f.letterDate);
  return doc.save({ useObjectStreams: false });
}
