/**
 * The sample sheets people download before they upload a sheet (Sheet Upload, Telecaller Sheets, Upload Leads, Upload customers ...).
 *
 * The first row under the headings holds dummy details so people can see what goes in each column. They are placeholders such as Customer_Name or
 * Company_Name: never a real person, business, phone number or e-mail address. The dummy mobile number and e-mail address are made up
 * (the e-mail uses example.com, a domain reserved for examples). An upload skips its own sample row, so leaving it in the file does no harm.
 */
export const SAMPLE_PHONE = '9000000000';
export const SAMPLE_EMAIL = 'name@example.com';

/** The contact sheet of Sheet Upload and Telecaller Sheets (Contact Name and Phone Number are required). */
export const CONTACT_SAMPLE_HEADINGS = ['Contact Name', 'Company Name', 'Phone Number', 'Email', 'Remarks'] as const;
export const CONTACT_SAMPLE_ROW = ['Contact_Name', 'Company_Name', SAMPLE_PHONE, SAMPLE_EMAIL, 'Remarks'] as const;
export const CONTACT_SAMPLE_WIDTHS = [22, 24, 18, 28, 30];
/** True for the sample row of the contact sheet (its name and mobile number are the placeholders). */
export const isContactSampleRow = (name: string, phone: string) => name.trim() === CONTACT_SAMPLE_ROW[0] && phone.trim().replace(/\D/g, '') === SAMPLE_PHONE;

/** The customer CSV of Upload customers: its sample row. The first pair is the sample of earlier versions, still recognised in old downloads. */
export const CUSTOMER_SAMPLE_NAME = 'Customer_Name';
export const CUSTOMER_SAMPLE_COMPANY = 'Business_Name';
export const isCustomerSampleRow = (name: string, phone: string) => {
  const n = name.trim();
  const p = phone.trim().replace(/\D/g, '');
  return (n === CUSTOMER_SAMPLE_NAME && p === SAMPLE_PHONE) || (n === 'Asha Verma' && p === '9820012345');
};

/** The CSV a Wabastore import reads: Name, Phone, Email, Company, Channel, Value. */
export const LEAD_IMPORT_SAMPLE_HEADINGS = ['Name', 'Phone', 'Email', 'Company', 'Channel', 'Value'] as const;
export const LEAD_IMPORT_SAMPLE_ROW = ['Lead_Name', SAMPLE_PHONE, SAMPLE_EMAIL, 'Company_Name', 'WhatsApp API', '45000'] as const;
export const isLeadImportSampleRow = (name: string, phone: string) => name.trim() === LEAD_IMPORT_SAMPLE_ROW[0] && phone.trim().replace(/\D/g, '') === SAMPLE_PHONE;
