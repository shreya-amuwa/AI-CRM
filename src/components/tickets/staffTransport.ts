import { ticketFilesApi } from '../../lib/api/endpoints';
import type { TicketFileTransport } from './TicketFiles';

/** Staff upload and open ticket files through the employee endpoints (the server checks the person may see the ticket). */
export const staffTicketFiles: TicketFileTransport = {
  begin: b => ticketFilesApi.begin(b),
  complete: id => ticketFilesApi.complete(id),
  abort: id => ticketFilesApi.abort(id),
  url: (id, action) => ticketFilesApi.url(id, action)
};
