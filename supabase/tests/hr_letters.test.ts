/**
 * HR letters (no database): the placeholder language of the Offer and Experience Letter templates, the validation of edited wording, and the
 * Offer Letter renderer (same values -> same file, the values on the page, the rupee sign, long wording spills onto more pages). Run: npm run test:unit
 */
import { PDFDocument } from 'pdf-lib';
import { renderOfferPdf } from '../../server/hrDocuments/offer.js';
import { DEFAULT_EXPERIENCE_CONTENT, DEFAULT_OFFER_CONTENT, boldRuns, fillPlaceholders, pronounValues, unknownPlaceholders } from '../../shared/hrLetters.js';
import { hrExperienceLetterFieldsSchema, hrLetterTemplateSaveSchema, hrOfferFieldsSchema } from '../../shared/validation.js';
import type { HrDocOfferFields } from '../../shared/contracts.js';

let passed = 0;
function check(cond: unknown, label: string, extra?: unknown) {
  if (!cond) { console.error(`FAILED: ${label}`, extra === undefined ? '' : JSON.stringify(extra)); process.exit(1); }
  passed++;
  console.log(`ok - ${label}`);
}

// the template language
check(fillPlaceholders('Dear {name}, as {designation}', { name: 'Asha', designation: 'Executive' }) === 'Dear Asha, as Executive', 'placeholders are filled');
check(fillPlaceholders('{unknown} stays', {}) === '{unknown} stays', 'a placeholder without a value stays visible (never silently blank)');
check(JSON.stringify(boldRuns('the **Executive** role')) === JSON.stringify([{ text: 'the ', bold: false }, { text: 'Executive', bold: true }, { text: ' role', bold: false }]), '**text** is bold');
check(pronounValues('Mr.').his === 'his' && pronounValues('Miss').He === 'She' && pronounValues('Ms.').him === 'her', 'pronouns follow the chosen title');
check(unknownPlaceholders('OFFER', DEFAULT_OFFER_CONTENT).length === 0 && unknownPlaceholders('EXPERIENCE', DEFAULT_EXPERIENCE_CONTENT).length === 0, 'the default templates use only known placeholders');
check(unknownPlaceholders('OFFER', { ...DEFAULT_OFFER_CONTENT, salutation: 'Dear {title} {name},' }).join() === 'title', 'the Experience Letter\'s {title} is unknown in an Offer Letter');
check(JSON.stringify(DEFAULT_OFFER_CONTENT).indexOf('Lokesh') === -1 && JSON.stringify(DEFAULT_EXPERIENCE_CONTENT).indexOf('Priya') === -1, 'no sample person in the templates');

// validation of the wording and the values
const offer: HrDocOfferFields = {
  letterDate: '2026-09-30', employeeName: 'Asha Joining', designation: 'Technical Support Executive', department: 'Wabastore', employmentType: 'Full-Time', joiningDate: '2026-10-01',
  salary: '₹10,000/- per month (Fixed)', probation: '6 Months', reportingTo: 'Team Leader', signatoryName: 'Miss Aarti Kalange', content: DEFAULT_OFFER_CONTENT, templateVersion: 1
};
check(hrOfferFieldsSchema.safeParse(offer).success, 'an Offer Letter with the default wording is valid');
check(!hrOfferFieldsSchema.safeParse({ ...offer, content: { ...offer.content, subject: 'For {nickname}' } }).success, 'an unknown placeholder is refused');
check(!hrOfferFieldsSchema.safeParse({ ...offer, content: { ...offer.content, paragraphs: [] } }).success, 'at least one paragraph');
check(!hrOfferFieldsSchema.safeParse({ ...offer, salary: '' }).success && !hrOfferFieldsSchema.safeParse({ ...offer, joiningDate: '01-10-2026' }).success, 'the salary is required and dates are ISO dates');
check(hrExperienceLetterFieldsSchema.safeParse({ letterDate: '2026-09-18', title: 'Miss', employeeName: 'Priya Sharma', designation: 'Executive', lastWorkingDate: '2026-09-17', signatoryName: 'Aarti Kalange', signatoryTitle: 'Ceo' }).success,
  'an Experience Letter without wording is still valid (the official wording is used)');
check(hrLetterTemplateSaveSchema.safeParse({ type: 'EXPERIENCE', content: DEFAULT_EXPERIENCE_CONTENT, baseVersion: 1 }).success
  && !hrLetterTemplateSaveSchema.safeParse({ type: 'EXPERIENCE', content: DEFAULT_OFFER_CONTENT, baseVersion: 1 }).success
  && !hrLetterTemplateSaveSchema.safeParse({ type: 'NDA', content: DEFAULT_EXPERIENCE_CONTENT, baseVersion: 1 }).success, 'a master template save is checked against its own letter; the NDA has none');

// the Offer Letter renderer
const a = await renderOfferPdf(offer), b = await renderOfferPdf(offer);
check(Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0, 'the same Offer Letter values give the same bytes');
check(Buffer.compare(Buffer.from(a), Buffer.from(await renderOfferPdf({ ...offer, employeeName: 'Ravi Joining' }))) !== 0, 'another name gives another file');
const doc = await PDFDocument.load(a);
check(doc.getPageCount() >= 1 && doc.getPageCount() <= 2 && doc.getTitle() === 'Offer Letter', 'the supplied wording fits on one or two pages, like the original', doc.getPageCount());
const para = 'This paragraph is a long one, written to fill the letter so that the wording has to continue on the next page of the letterhead. '.repeat(6);
const long = await renderOfferPdf({ ...offer, content: { ...offer.content, paragraphs: [para, para, para], responsibilities: Array.from({ length: 15 }, (_, i) => `Responsibility number ${i + 1} described in a sentence long enough to wrap onto a second line of the letter.`) } });
const longPages = (await PDFDocument.load(long)).getPageCount();
check(longPages > doc.getPageCount() && longPages <= 4, 'longer wording continues on another letterhead page', { normal: doc.getPageCount(), long: longPages });
let refused = '';
try { await renderOfferPdf({ ...offer, employeeName: 'Asha श' }); } catch (e) { refused = (e as Error).message; }
check(/cannot be printed/.test(refused), 'a character the printing font cannot show is refused', refused);

console.log(`=== ${passed} HR LETTER CHECKS PASSED ===`);
