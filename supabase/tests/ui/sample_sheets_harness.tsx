import React from 'react';
import { createRoot } from 'react-dom/client';
import { ContactSheets } from '../../../src/components/telecaller/ContactSheets';
import { LeadAssign } from '../../../src/components/sales-head/LeadAssign';
import { writeXlsx } from '../../../src/lib/xlsxWriter';
import { readXlsx } from '../../../src/lib/xlsxReader';
import { parseContactSheet } from '../../../src/lib/telecallerSheet';
import { contactSampleRows } from '../../../src/lib/sampleSheetDownload';

const w = window as any;
// Department Head: Telecaller Sheets (Excel only)
w.mountContacts = () => createRoot(document.getElementById('root')!).render(<div className="p-4 max-w-5xl"><ContactSheets /></div>);
// Sales Department Head: Sheet Upload (Excel or CSV)
w.mountLeadAssign = () => createRoot(document.getElementById('root')!).render(<div className="p-4 max-w-5xl"><LeadAssign title="Sheet Upload" /></div>);
// an .xlsx made with the real writer, as base64 (to upload it from the test)
w.makeSheet = async (rows: string[][]) => {
  const bytes = new Uint8Array(await (await writeXlsx('Contacts', rows, [20, 20, 20, 20, 20])).arrayBuffer());
  let s = '';
  bytes.forEach(b => { s += String.fromCharCode(b); });
  return btoa(s);
};
// the downloaded sample read back with the real Excel reader and parsed by the real contact-sheet reader
w.roundTrip = async () => {
  const book = await readXlsx(await writeXlsx('Contacts', contactSampleRows(), [20, 20, 20, 20, 20]));
  return { rows: book.sheets[0].rows, parsed: parseContactSheet(book.sheets[0].rows) };
};
