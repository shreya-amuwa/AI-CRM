/**
 * File-name prefixes and the default signatory of the HR letters. Kept apart from the PDF drawing code so that code that only needs a
 * name (the service building a file name) does not load the PDF library (pdf-lib), which is slow to load and only needed to draw a PDF.
 */
export const OFFER_FILE_PREFIX = 'Offer-Letter';
export const NDA_FILE_PREFIX = 'NDA';
export const EXPERIENCE_FILE_PREFIX = 'Experience-Letter';
/** The signatory printed on the supplied Experience Letter. HR can change it per letter. */
export const DEFAULT_SIGNATORY = { name: 'Aarti Kalange', title: 'Ceo' };
