import type { TicketUploadTicket } from '../../../shared/contracts';
import { employeeCasesApi } from '../../lib/api/employeeCases';
import type { TicketFileTransport } from '../tickets/TicketFiles';

/**
 * How the files of an issue get to the server and back. The picker, the limits (5 files, 5 MB, these types) and the checks are the ones
 * tickets and chat use; only the endpoints differ. The server checks the type, the size and the content again.
 */
export const issueFileTransport: TicketFileTransport = {
  begin: async b => (await employeeCasesApi.beginUpload({ fileName: b.fileName, mimeType: b.mimeType, sizeBytes: b.sizeBytes })) as TicketUploadTicket,
  complete: async id => ({ ...(await employeeCasesApi.completeUpload(id)) }),
  abort: id => employeeCasesApi.abortUpload(id),
  url: (id, action) => employeeCasesApi.fileUrl(id, action)
};
