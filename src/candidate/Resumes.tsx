import React,{useCallback,useState} from 'react';
import type { CareerFile,CareerUpload } from '../../shared/contracts';
import {careerUploadSchema} from '../../shared/validation';
import {candidateAuth,candidateRequest} from './api';
import {Card,Failure,Loading,Notice,button,secondary,useRemote,readable,when} from './parts';
export const Resumes:React.FC=()=>{
 const get=useCallback(()=>candidateRequest<CareerFile[]>('/candidate/resumes'),[]);const r=useRemote(get);const [busy,setBusy]=useState(false);const [error,setError]=useState('');
 const upload=async(file:File)=>{setError('');const p=careerUploadSchema.safeParse({file_name:file.name,size_bytes:file.size});if(!p.success){setError(p.error.issues[0].message);return;}setBusy(true);try{
  const ticket=await candidateRequest<CareerUpload>('/candidate/resumes',p.data);
  if(ticket.upload){const result=await fetch(ticket.upload.url,{method:'PUT',headers:ticket.upload.headers,body:file});if(!result.ok)throw new Error('The upload failed. Please try again.');}
  else{const result=await candidateAuth().storage.from(ticket.bucket).uploadToSignedUrl(ticket.path,ticket.token!,file,{contentType:'application/pdf'});if(result.error)throw new Error('The upload failed. Please try again.');}
  await candidateRequest(`/candidate/resumes/${ticket.file.id}/complete`,{});r.reload();
 }catch(e){setError(readable(e));}finally{setBusy(false);}};
 const download=async(id:string)=>{try{const x=await candidateRequest<{url:string}>(`/candidate/resumes/${id}/url`);window.open(x.url,'_blank','noopener,noreferrer');}catch(e){setError(readable(e));}};
 return <div className="space-y-5"><Card title="Your resume"><p className="text-sm text-slate-500 mb-4">Upload a PDF up to 10 MB. Each upload is a new version; resumes attached to submitted applications stay unchanged.</p><label className={`${button} cursor-pointer ${busy?'opacity-50':''}`}>{busy?'Uploading and verifying…':'Upload PDF'}<input aria-label="Upload PDF resume" type="file" accept=".pdf,application/pdf" className="sr-only" disabled={busy} onChange={e=>{const f=e.target.files?.[0];e.target.value='';if(f)void upload(f);}}/></label>{error&&<div className="mt-4"><Notice error>{error}</Notice></div>}</Card><Card title="Resume versions">{r.loading?<Loading/>:r.error?<Failure message={r.error} retry={r.reload}/>:!r.data?.length?<p className="text-slate-500">No resume uploaded yet.</p>:<ul className="divide-y">{r.data.map(f=><li key={f.id} className="py-4 flex gap-3 justify-between items-center"><div><p className="font-semibold break-all">{f.file_name}</p><p className="text-xs text-slate-500">{when(f.created_at)} · {Math.ceil(f.size_bytes/1024)} KB</p></div><button className={secondary} onClick={()=>void download(f.id)}>Download</button></li>)}</ul>}</Card></div>;
};
