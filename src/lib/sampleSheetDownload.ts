import { CONTACT_SAMPLE_HEADINGS, CONTACT_SAMPLE_ROW, CONTACT_SAMPLE_WIDTHS, LEAD_IMPORT_SAMPLE_HEADINGS, LEAD_IMPORT_SAMPLE_ROW } from '../../shared/sampleSheets';
import { saveBlob, toCsv, writeXlsx } from './xlsxWriter';

/**
 * Downloads a sample sheet: the headings the CRM expects and one row of dummy details (placeholders such as Contact_Name, never a real person).
 * The upload skips that row, so leaving it in the file does no harm. The rows are built here so the sample can never drift from what is accepted.
 */
export type SampleFormat = 'xlsx' | 'csv';

export const contactSampleRows = (): string[][] => [[...CONTACT_SAMPLE_HEADINGS], [...CONTACT_SAMPLE_ROW]];
export const leadImportSampleRows = (): string[][] => [[...LEAD_IMPORT_SAMPLE_HEADINGS], [...LEAD_IMPORT_SAMPLE_ROW]];

/** The sheet of Sheet Upload and Telecaller Sheets: Contact Name, Company Name, Phone Number, Email, Remarks. */
export async function downloadContactSample(format: SampleFormat): Promise<void> {
  if (format === 'xlsx') saveBlob(await writeXlsx('Contacts', contactSampleRows(), CONTACT_SAMPLE_WIDTHS), 'Contact sheet sample.xlsx');
  else saveBlob(toCsv(contactSampleRows()), 'Contact sheet sample.csv');
}

/** The CSV of the Wabastore lead import: Name, Phone, Email, Company, Channel, Value. */
export function downloadLeadImportSample(): void {
  saveBlob(toCsv(leadImportSampleRows()), 'Lead import sample.csv');
}
