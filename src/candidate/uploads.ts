import type { CareerFile, CareerUpload } from '../../shared/contracts';
import { careerUploadSchema } from '../../shared/validation';
import { candidateAuth, candidateRequest } from './api';
export async function uploadCareerPdf(file: File): Promise<CareerFile> {
  const p = careerUploadSchema.safeParse({
    file_name: file.name,
    size_bytes: file.size,
  });
  if (!p.success) throw new Error(p.error.issues[0].message);
  const ticket = await candidateRequest<CareerUpload>(
    '/candidate/resumes',
    p.data,
  );
  if (ticket.upload) {
    const result = await fetch(ticket.upload.url, {
      method: 'PUT',
      headers: ticket.upload.headers,
      body: file,
    });
    if (!result.ok) throw new Error('The upload failed. Please try again.');
  } else {
    const result = await candidateAuth()
      .storage.from(ticket.bucket)
      .uploadToSignedUrl(ticket.path, ticket.token!, file, {
        contentType: 'application/pdf',
      });
    if (result.error) throw new Error('The upload failed. Please try again.');
  }
  return candidateRequest<CareerFile>(
    `/candidate/resumes/${ticket.file.id}/complete`,
    {},
  );
}
