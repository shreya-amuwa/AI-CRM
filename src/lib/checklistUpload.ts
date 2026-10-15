import type { ChecklistItem } from '../../shared/contracts';
import type { UploadMimeType } from '../../shared/validation';
import { documentsApi } from './api/endpoints';
import { uploadToTicket } from './uploadToTicket';

export const MIME_LABEL: Record<string, string> = {
  'application/pdf': 'PDF',
  'image/jpeg': 'JPG',
  'image/png': 'PNG',
  'image/webp': 'WEBP',
  'text/csv': 'CSV',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'Excel',
  'audio/mpeg': 'MP3',
  'audio/wav': 'WAV',
  'audio/mp4': 'M4A'
};

export const EXT_MIME: Record<string, UploadMimeType> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  csv: 'text/csv',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4'
};

/** The first bytes of the file must really be what its type says (a PDF renamed to .png is refused). */
export async function looksLike(file: File, mime: string): Promise<boolean> {
  const head = new Uint8Array(await file.slice(0, 1024).arrayBuffer());
  const ascii = (a: number, b: number) => String.fromCharCode(...head.subarray(a, b));
  switch (mime) {
    case 'application/pdf':
      return String.fromCharCode(...head).includes('%PDF-');
    case 'image/png':
      return head[0] === 0x89 && ascii(1, 4) === 'PNG';
    case 'image/jpeg':
      return head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
    case 'image/webp':
      return ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP';
    case 'audio/wav':
      return ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE';
    case 'audio/mp4':
      return ascii(4, 8) === 'ftyp';
    case 'audio/mpeg':
      return ascii(0, 3) === 'ID3' || (head[0] === 0xff && (head[1] & 0xe0) === 0xe0);
    case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
      return head[0] === 0x50 && head[1] === 0x4b && head[2] === 3 && head[3] === 4;
    case 'text/csv':
      return head.length > 0 && !head.includes(0);
    default:
      return false;
  }
}

/** What the file picker should offer for an item: its allowed types and their extensions. */
export const acceptFor = (allowed: string[]) => allowed.flatMap(m => [m, ...Object.entries(EXT_MIME).filter(([, v]) => v === m).map(([e]) => `.${e}`)]).join(',');

/**
 * Checks one file against an item of the checklist, then uploads it (begin -> store -> complete).
 * Throws an Error with a readable message; the caller shows it. `onPhase` lets the screen show progress.
 */
export async function uploadChecklistFile(
  customerId: string,
  item: Pick<ChecklistItem, 'code' | 'allowedMimeTypes' | 'maxSizeBytes'>,
  file: File,
  onPhase: (phase: 'checking' | 'uploading' | 'verifying' | null) => void = () => undefined
): Promise<void> {
  const allowed = item.allowedMimeTypes || ['application/pdf'];
  const typesText = allowed.map(m => MIME_LABEL[m] || m).join(', ');
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  const mime = (allowed.includes(file.type) ? file.type : EXT_MIME[ext]) as UploadMimeType | undefined;
  if (!mime || !allowed.includes(mime)) throw new Error(`Accepted: ${typesText}. Upload a single file.`);
  if (file.size === 0) throw new Error('This file is empty.');
  if (file.size > (item.maxSizeBytes || 0)) {
    const mb = (item.maxSizeBytes || 0) / 1048576;
    throw new Error(`The file is larger than ${mb >= 1 ? `${mb} MB` : `${Math.round((item.maxSizeBytes || 0) / 1024)} KB`}. Please compress it and try again.`);
  }
  onPhase('checking');
  try {
    if (!(await looksLike(file, mime))) {
      throw new Error(mime === 'application/pdf' ? 'Only a single PDF file is accepted. Please combine the documents into one PDF.' : `This file is not a real ${MIME_LABEL[mime]} file.`);
    }
    let documentId: string | null = null;
    try {
      const ticket = await documentsApi.beginUpload(customerId, { documentType: item.code, fileName: file.name, mimeType: mime, sizeBytes: file.size });
      documentId = ticket.document.id;
      onPhase('uploading');
      await uploadToTicket(ticket, file, mime);
      onPhase('verifying');
      await documentsApi.complete(documentId);
      documentId = null;
    } finally {
      if (documentId) await documentsApi.abort(documentId).catch(() => undefined);
    }
  } finally {
    onPhase(null);
  }
}
