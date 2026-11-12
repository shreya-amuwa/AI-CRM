/**
 * The wording of the HR letters that HR can edit (Offer Letter, Experience Letter): the master templates' structure, the placeholders they may use,
 * and how a template is filled in for one employee. The NDA is not here on purpose: it is the official PDF itself and its clauses are never edited.
 *
 * Version 1 of each master template is the wording of the official letters the company supplied (Offer Letter of 30 Sep 2026, Experience Letter of
 * 18 Sep 2026) with the sample person's details replaced by placeholders. The migration 20261231000700 seeds exactly these texts; the API test checks
 * that the seeded version 1 equals these constants.
 *
 *   {placeholder}   replaced by the employee's value when the letter is made (see *_PLACEHOLDERS)
 *   **text**        printed in bold
 */

export type HrLetterType = 'OFFER' | 'EXPERIENCE';

export interface HrLetterTerm { label: string; value: string }

/** The Offer Letter: everything between the date and the signature lines. */
export interface HrOfferContent {
  subject: string;
  salutation: string;
  paragraphs: string[];
  responsibilitiesHeading: string;
  responsibilities: string[];
  termsHeading: string;
  terms: HrLetterTerm[];
  closing: string[];
  signOff: string;
  acceptanceHeading: string;
  acceptance: string;
}

/** The Experience Letter: the greeting, the paragraphs and the closing word (the date and the signatory are fields). */
export interface HrExperienceContent {
  greeting: string;
  paragraphs: string[];
  signOff: string;
}

export const OFFER_PLACEHOLDERS = ['name', 'designation', 'department', 'joiningDate', 'employmentType', 'salary', 'probation', 'reportingTo', 'letterDate'] as const;
export const EXPERIENCE_PLACEHOLDERS = ['title', 'name', 'designation', 'from', 'to', 'letterDate', 'he', 'him', 'his', 'He', 'His'] as const;
export type OfferPlaceholder = (typeof OFFER_PLACEHOLDERS)[number];
export type ExperiencePlaceholder = (typeof EXPERIENCE_PLACEHOLDERS)[number];

/** What each placeholder means, for the editor's help text. */
export const PLACEHOLDER_HELP: Record<string, string> = {
  name: "the employee's name", designation: 'the designation', department: 'the department', joiningDate: 'the date of joining',
  employmentType: 'the employment type', salary: 'the salary', probation: 'the probation period', reportingTo: 'who the employee reports to',
  letterDate: "the letter's date", title: 'Mr. / Miss / Mrs. / Ms.', from: 'the joining date', to: 'the last working date',
  he: 'he / she', him: 'him / her', his: 'his / her', He: 'He / She', His: 'His / Her'
};

export const DEFAULT_OFFER_CONTENT: HrOfferContent = {
  subject: 'Offer Letter for the Position of **{designation}**',
  salutation: 'Dear {name},',
  paragraphs: [
    'With reference to your application and our discussions, we are pleased to offer you the position of **{designation}** in the {department} Department at Amuwa Corporation, effective from **{joiningDate}**.',
    'In this role, you will be responsible for providing Technical assistance, resolving system-related issues, and ensuring smooth operational support for {department}.'
  ],
  responsibilitiesHeading: 'Key Responsibilities',
  responsibilities: [
    'Providing Technical support for systems, tools, and platforms used by the team',
    'Resolving technical issues related to orders, dashboards, and internal processes',
    'Assisting in troubleshooting technical-related technical concerns',
    'Coordinating with internal teams for issue resolution',
    'Maintaining system records and technical documentation',
    'Ensuring smooth functioning of day-to-day technical operations',
    'Supporting team members with basic technical guidance'
  ],
  termsHeading: 'Employment Terms',
  terms: [
    { label: 'Designation', value: '{designation}' },
    { label: 'Department', value: '{department}' },
    { label: 'Employment Type', value: '{employmentType}' },
    { label: 'Date of Joining', value: '{joiningDate}' },
    { label: 'Salary', value: '{salary}' },
    { label: 'Working Hours', value: 'As per company policy' },
    { label: 'Probation Period', value: '{probation}' },
    { label: 'Reporting To', value: '{reportingTo}' }
  ],
  closing: [
    'This offer is subject to your acceptance and adherence to company policies, rules, and regulations.',
    'We look forward to your contribution and a successful association with Amuwa Corporation.'
  ],
  signOff: 'For Amuwa Corporation,',
  acceptanceHeading: 'Acceptance',
  acceptance: 'I, **{name}**, hereby accept the offer for the position of {designation} at Amuwa Corporation and agree to abide by all the terms and conditions mentioned above.'
};

export const DEFAULT_EXPERIENCE_CONTENT: HrExperienceContent = {
  greeting: 'To Whom It May Concern,',
  paragraphs: [
    'This is to certify that {title} {name} was employed with Amuwa Corporation as **{designation}** from {from} to {to}.',
    'During {his} tenure with us, {he} demonstrated dedication, professionalism, and a strong work ethic. {He} performed {his} responsibilities efficiently and contributed positively to the growth of the organization.',
    'We appreciate {his} efforts and the work {he} has done during {his} time with us.',
    'We wish {him} all the best for {his} future endeavors and continued success in {his} career. Good luck for a bright future.'
  ],
  signOff: 'Sincerely,'
};

/** Every {placeholder} used in a text. */
export function placeholdersIn(text: string): string[] {
  return Array.from(text.matchAll(/\{([A-Za-z]+)\}/g), m => m[1]);
}

/** The texts of a template, for checks that look at every string. */
export function textsOf(type: HrLetterType, c: HrOfferContent | HrExperienceContent): string[] {
  if (type === 'OFFER') {
    const o = c as HrOfferContent;
    return [o.subject, o.salutation, ...o.paragraphs, o.responsibilitiesHeading, ...o.responsibilities, o.termsHeading,
      ...o.terms.flatMap(t => [t.label, t.value]), ...o.closing, o.signOff, o.acceptanceHeading, o.acceptance];
  }
  const e = c as HrExperienceContent;
  return [e.greeting, ...e.paragraphs, e.signOff];
}

/** The placeholders a template uses that this letter does not know (an empty list when it is fine). */
export function unknownPlaceholders(type: HrLetterType, c: HrOfferContent | HrExperienceContent): string[] {
  const allowed = new Set<string>(type === 'OFFER' ? OFFER_PLACEHOLDERS : EXPERIENCE_PLACEHOLDERS);
  return Array.from(new Set(textsOf(type, c).flatMap(placeholdersIn).filter(p => !allowed.has(p))));
}

/** Fills the placeholders of one text. A placeholder without a value stays visible as {name} (the validators refuse unknown ones first). */
export function fillPlaceholders(text: string, values: Record<string, string>): string {
  return text.replace(/\{([A-Za-z]+)\}/g, (all, key: string) => (Object.prototype.hasOwnProperty.call(values, key) ? values[key] : all));
}

/** Splits a filled text into plain and **bold** runs. */
export function boldRuns(text: string): { text: string; bold: boolean }[] {
  const out: { text: string; bold: boolean }[] = [];
  text.split('**').forEach((part, i) => { if (part) out.push({ text: part, bold: i % 2 === 1 }); });
  return out;
}

/** The pronoun placeholders follow the title HR chooses (never guessed from a name). */
export function pronounValues(title: string): Record<'he' | 'him' | 'his' | 'He' | 'His', string> {
  return title === 'Mr.'
    ? { he: 'he', him: 'him', his: 'his', He: 'He', His: 'His' }
    : { he: 'she', him: 'her', his: 'her', He: 'She', His: 'Her' };
}

/** The signatory printed on the supplied Offer Letter ("Name:- Miss Aarti Kalange"); HR can change it per letter. */
export const DEFAULT_OFFER_SIGNATORY = 'Miss Aarti Kalange';
