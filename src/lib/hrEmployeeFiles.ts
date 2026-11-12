import type { HrEmployeeFile, HrEmployeeFileKind } from '../../shared/contracts';
import { HR_EMPLOYEE_FILE_MAX_BYTES, HR_EMPLOYEE_FILE_MAX_LABEL } from '../../shared/contracts';
import { hrEmployeeFileMimeOf } from '../../shared/validation';
import type { Employee } from '../types/amuwaHq';
import { hrEmployeeFilesApi } from './api/endpoints';
import { uploadToTicket } from './uploadToTicket';

/** The key the database uses for an employee: the CRM account (profile id), or 'HR:' + the HR record id for a record without a login. */
export const hrEmployeeKeyOf = (e: Pick<Employee, 'profileId' | 'id'>) => e.profileId ?? `HR:${e.id}`;

/**
 * Uploads one file to an employee's HR profile: the server books it (the database checks HR staff, kind, type and size), the
 * browser sends the bytes straight to R2 with the single-use signed upload, then the server checks the stored object and the
 * file is kept. Only the metadata goes to the database. Throws an Error with a readable message.
 */
export async function uploadHrEmployeeFile(
  employee: Pick<Employee, 'profileId' | 'id'>,
  file: File,
  kind: HrEmployeeFileKind,
  extra: { leaveRef?: string | null; note?: string | null } = {}
): Promise<HrEmployeeFile> {
  const mimeType = hrEmployeeFileMimeOf(file.name, file.type);
  if (!mimeType) throw new Error(`${file.name}: upload a PDF, JPG, PNG, Word (.docx) or e-mail (.eml) file.`);
  if (file.size <= 0) throw new Error(`${file.name}: the file is empty.`);
  if (file.size > HR_EMPLOYEE_FILE_MAX_BYTES) throw new Error(`${file.name}: files can be at most ${HR_EMPLOYEE_FILE_MAX_LABEL}.`);
  const ticket = await hrEmployeeFilesApi.begin({
    employeeKey: hrEmployeeKeyOf(employee), kind, fileName: file.name, mimeType, sizeBytes: file.size,
    leaveRef: extra.leaveRef ?? null, note: extra.note ?? null
  });
  try {
    await uploadToTicket(ticket, file, mimeType);
  } catch (err) {
    await hrEmployeeFilesApi.abort(ticket.file.id).catch(() => undefined);
    throw err;
  }
  return hrEmployeeFilesApi.complete(ticket.file.id);
}
