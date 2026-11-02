import assert from 'node:assert/strict';
import http from 'node:http';
import type {SupabaseClient} from '@supabase/supabase-js';
import type {AddressInfo} from 'node:net';

const id='11111111-1111-4111-8111-111111111111';
const bytes=Buffer.from('%PDF-1.4 verified resume fixture');
const row={id,file_name:'resume.pdf',size_bytes:bytes.length,status:'PENDING',storage_provider:'SUPABASE',storage_bucket:'career-resumes',storage_path:'candidate/upload.pdf'};
let completed=0;let stored:Uint8Array|null=null;
const server=http.createServer(async(req,res)=>{
 const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));
 const body=JSON.parse(Buffer.concat(chunks).toString());
 assert.equal(req.url,'/rest/v1/rpc/career_file_verified');
 assert.equal(req.headers.authorization,'Bearer local-test-service-key');
 assert.equal(body.p_id,id);assert.equal(body.p_size,bytes.length);assert.match(body.p_path,/^candidate\/sealed\/[0-9a-f-]+\.pdf$/);
 completed++;res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({...row,status:'READY',storage_path:body.p_path}));
});
await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
process.env.SUPABASE_URL=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
process.env.SUPABASE_ANON_KEY='local-test-anon-key';process.env.SUPABASE_SERVICE_ROLE_KEY='local-test-service-key';
try{
 const {CareerRepository}=await import('../../server/repositories/CareerRepository');
 const {CareerService}=await import('../../server/services/CareerService');
 const {StorageRepository}=await import('../../server/repositories/StorageRepository');
 const caller={rpc:async(name:string,args:{p_id:string})=>{assert.equal(name,'career_file');return args.p_id===id?{data:row,error:null}:{data:null,error:{code:'P0001',message:'NOT_FOUND: Resume not found.'}};}} as unknown as SupabaseClient;
 const storage=new StorageRepository();
 storage.inspectFile=async()=>({exists:true,size:bytes.length,matches:true,etag:'fixture',contentType:'application/pdf'});
 storage.readStored=async()=>bytes;
 storage.driver('SUPABASE').put=async(_bucket,_path,body)=>{stored=body;};
 storage.remove=async()=>true;
 const service=new CareerService(new CareerRepository(caller),storage);
 await assert.rejects(service.completeUpload('22222222-2222-4222-8222-222222222222'),/Resume not found/);
 assert.equal(completed,0);
 const result=await service.completeUpload(id);
 assert.equal(result.status,'READY');assert.equal(completed,1);assert.deepEqual(stored,bytes);
 storage.inspectFile=async()=>({exists:true,size:bytes.length,matches:false,etag:null,contentType:'text/plain'});
 await assert.rejects(service.completeUpload(id),/content\/size is invalid/);
 assert.equal(completed,1,'invalid content must never reach privileged completion');
 console.log('Candidate upload ownership, content verification and service-only completion checks passed');
}finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
