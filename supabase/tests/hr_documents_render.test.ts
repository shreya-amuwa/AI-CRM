/**
 * HR documents (no database): the date styles of the templates, the pronouns that follow the chosen title, the printing-font guard, the
 * employment duration shown to HR, and that the same values give the same file. Run: npm run test:unit
 */
import { longDate, numericDate, pronouns, renderExperiencePdf, renderNdaPdf } from '../../server/hrDocuments/render.js';
import { employmentDuration } from '../../src/lib/employmentDuration.js';
import { hrExperienceFieldsSchema, hrNdaFieldsSchema } from '../../shared/validation.js';
import { PDFDocument } from 'pdf-lib';

let passed = 0;
function check(cond: unknown, label: string, extra?: unknown) {
  if (!cond) { console.error(`FAILED: ${label}`, extra === undefined ? '' : JSON.stringify(extra)); process.exit(1); }
  passed++;
  console.log(`ok - ${label}`);
}

check(numericDate('2026-09-11', '-') === '11-09-2026' && numericDate('2026-09-18', '/') === '18/09/2026', 'dates read as the templates show them (11-09-2026, 18/09/2026)');
check(longDate('2026-05-04') === '04th May 2026' && longDate('2026-09-17') === '17th September 2026' && longDate('2026-01-01') === '01st January 2026'
  && longDate('2026-02-02') === '02nd February 2026' && longDate('2026-03-03') === '03rd March 2026' && longDate('2026-04-11') === '11th April 2026' && longDate('2026-04-22') === '22nd April 2026', 'ordinal dates: 04th, 17th, 01st, 02nd, 03rd, 11th, 22nd');
check(pronouns('Mr.').subject === 'he' && pronouns('Mr.').possessive === 'his' && pronouns('Miss').object === 'her' && pronouns('Mrs.').Subject === 'She' && pronouns('Ms.').possessive === 'her', 'the pronouns follow the title');

check(employmentDuration('2026-05-04', '2026-09-17') === '4 months, 14 days', 'duration: 04 May to 17 September 2026 = 4 months, 14 days', employmentDuration('2026-05-04', '2026-09-17'));
check(employmentDuration('2025-01-01', '2026-01-31') === '1 year, 1 month', 'duration: whole months and years', employmentDuration('2025-01-01', '2026-01-31'));
check(employmentDuration('2026-01-10', '2026-01-10') === '1 day' && employmentDuration('2026-02-01', '2026-01-01') === null && employmentDuration(null, '2026-01-01') === null, 'duration: one day, a reversed range and a missing date');
check(employmentDuration('2024-02-29', '2025-02-28') === '1 year', 'duration: a leap-day joiner', employmentDuration('2024-02-29', '2025-02-28'));

const nda = { letterDate: '2026-09-11', employeeName: 'Priya Sharma' };
const exp = { letterDate: '2026-09-18', title: 'Miss' as const, employeeName: 'Priya Sharma', designation: 'Business Development Executive', lastWorkingDate: '2026-09-17', signatoryName: 'Aarti Kalange', signatoryTitle: 'Ceo' };
const a = await renderNdaPdf(nda), b = await renderNdaPdf(nda);
check(Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0, 'the same NDA values give the same bytes');
const c = await renderExperiencePdf(exp, '2026-05-04'), d = await renderExperiencePdf(exp, '2026-05-04');
check(Buffer.compare(Buffer.from(c), Buffer.from(d)) === 0 && Buffer.compare(Buffer.from(c), Buffer.from(await renderExperiencePdf({ ...exp, title: 'Mr.' }, '2026-05-04'))) !== 0, 'the same letter values give the same bytes; another title gives another file');
check((await PDFDocument.load(a)).getPageCount() === 5 && (await PDFDocument.load(c)).getPageCount() === 1, 'the NDA keeps its five pages and the letter its one');
check((await PDFDocument.load(a)).getTitle() === 'Non-Disclosure Agreement' && (await PDFDocument.load(c)).getTitle() === 'Experience Letter', 'the file properties carry no sample person');
let refused = '';
try { await renderNdaPdf({ ...nda, employeeName: 'Priya श' }); } catch (e) { refused = (e as Error).message; }
check(/cannot be printed/.test(refused), 'a name the printing font cannot show is refused, never replaced by a question mark', refused);
let tooLong = '';
try { await renderExperiencePdf({ ...exp, designation: 'Senior Vice President of '.repeat(3) + 'Business Development and Strategic Partnerships Across Regions'.repeat(2) }, '2026-05-04'); } catch (e) { tooLong = (e as Error).message; }
check(tooLong === '' || /does not fit/.test(tooLong), 'an over-long designation either fits or is refused');

check(hrNdaFieldsSchema.safeParse(nda).success && hrExperienceFieldsSchema.safeParse(exp).success, 'valid values are accepted');
check(!hrNdaFieldsSchema.safeParse({ ...nda, employeeName: '<b>x</b>' }).success && !hrNdaFieldsSchema.safeParse({ ...nda, letterDate: '2026-02-30' }).success && !hrExperienceFieldsSchema.safeParse({ ...exp, title: 'Dr.' }).success, 'markup, impossible dates and unknown titles are refused');
check(hrNdaFieldsSchema.parse({ ...nda, employeeName: '  Priya    Sharma ' }).employeeName === 'Priya Sharma' && hrNdaFieldsSchema.safeParse({ ...nda, employeeName: "Mary-Anne O'Neil Jr." }).success, 'spaces are tidied; hyphens, apostrophes and full stops are allowed in names');

console.log(`=== ${passed} HR DOCUMENT RENDER CHECKS PASSED ===`);
process.exit(0);
