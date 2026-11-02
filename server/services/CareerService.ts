import { randomUUID } from 'node:crypto';
import { matchesSignature } from '../storage/signature.js';
import type { CareerFile, CareerUpload } from '../../shared/contracts.js';
import { careerApplySchema, careerJobQuerySchema, careerPostingSchema, careerProfileSchema, careerUploadSchema, uuidSchema } from '../../shared/validation.js';
import { parse } from '../http/validate.js';
import { AppError } from '../http/errors.js';
import { CareerRepository } from '../repositories/CareerRepository.js';
import { StorageRepository } from '../repositories/StorageRepository.js';

export class CareerService {
  constructor(private readonly repo: CareerRepository, private readonly storage = new StorageRepository()) {}
  profile() { return this.repo.profile(); }
  saveProfile(body: unknown) { return this.repo.profile(parse(careerProfileSchema,body)); }
  jobs(query: unknown) { const q=parse(careerJobQuerySchema,query); return this.repo.jobs(q.page,q.search); }
  postings(body?: unknown) { return this.repo.postings(body === undefined ? null : parse(careerPostingSchema,body)); }
  files() { return this.repo.files(); }
  applications() { return this.repo.applications(); }
  apply(body: unknown) { const i=parse(careerApplySchema,body); return this.repo.apply(i.posting_id,i.resume_id); }
  async beginUpload(body: unknown): Promise<CareerUpload> {
    const i=parse(careerUploadSchema,body);
    const driver=this.storage.active();
    const f=await this.repo.file(null,{...i,storage_provider:driver.provider});
    try {
      const t=await driver.createUploadTarget(f.storage_bucket!,f.storage_path!,'application/pdf');
      return {file:f,bucket:f.storage_bucket!,path:f.storage_path!,provider:t.provider,token:t.token,
        ...(t.url ? {upload:{url:t.url,headers:t.headers??{}}}: {})};
    } catch(e) { await this.repo.file(f.id,{action:'ABORT'}).catch(()=>undefined); throw e; }
  }
  async completeUpload(id: string): Promise<CareerFile> {
    const f=await this.repo.file(parse(uuidSchema,id));
    if(f.status==='READY') return f;
    const result=await this.storage.inspectFile(f.storage_provider,f.storage_bucket!,f.storage_path!,'application/pdf');
    if(!result.exists || !result.matches || result.size!==Number(f.size_bytes)) {
      await this.repo.file(f.id,{action:'ABORT'});
      await this.storage.remove(f.storage_bucket!,[f.storage_path!],f.storage_provider).catch(()=>undefined);
      throw new AppError('VALIDATION_ERROR','The PDF did not finish uploading or its content/size is invalid. Upload it again.');
    }
    // Seal a new object never exposed by an upload URL. Reusing a PUT URL cannot mutate a submitted resume.
    const bytes=await this.storage.readStored(f.storage_provider,f.storage_bucket!,f.storage_path!);
    if(bytes.length!==Number(f.size_bytes) || !matchesSignature(Buffer.from(bytes.subarray(0,1024)),'application/pdf')) {
      throw new AppError('VALIDATION_ERROR','The PDF changed during upload. Upload it again.');
    }
    const sealed=`${f.storage_path!.split('/')[0]}/sealed/${randomUUID()}.pdf`;
    await this.storage.driver(f.storage_provider).put(f.storage_bucket!,sealed,bytes,'application/pdf');
    try {
      const done=await this.repo.recordVerifiedFile(f.id,bytes.length,sealed);
      if(done.storage_path!==sealed) await this.storage.remove(f.storage_bucket!,[sealed],f.storage_provider).catch(()=>undefined);
      return done;
    } catch(e) { await this.storage.remove(f.storage_bucket!,[sealed],f.storage_provider).catch(()=>undefined); throw e; }
  }
  async fileUrl(id: string, hr=false) {
    const f=await this.repo.file(parse(uuidSchema,id),hr ? {action:'READ_HR'} : null);
    if(f.status!=='READY') throw new AppError('NOT_FOUND','Resume not available.');
    return {url:await this.storage.signedDownloadUrl(f.storage_bucket!,f.storage_path!,120,f.file_name,f.storage_provider)};
  }
}
