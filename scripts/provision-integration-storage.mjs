import {lstat,open} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseEnv} from 'node:util';
import {createHash,randomUUID} from 'node:crypto';
import {createClient as supabaseClient} from '@supabase/supabase-js';
import {APPROVED_PROFILE_PROJECT,integrationProfilePath,checkIntegrationProfile,configureIntegrationStorageKey} from './configure-integration-profile.mjs';
import {validateIntegrationAdminKey,readUserProvisionInput} from './provision-integration-users.mjs';

export const STORAGE_JOURNAL_NAME='.env.integration.storage.local';
export const STORAGE_BACKUP_NAME='.env.integration.storage.backup.local';
export const INTEGRATION_STORAGE_BUCKET='hessara-re-artifacts';
export const INTEGRATION_STORAGE_LIMIT=50*1024*1024;
export const APPROVED_STORAGE_URL='https://'+APPROVED_PROFILE_PROJECT+'.supabase.co';
const MAX_PROFILE_BYTES=65536,OPERATION_MS=20000;
const knownErrors=new Set(['LOCAL_CONFIGURATION_ONLY','PRIVATE_PROFILE_PATH_INVALID','PRIVATE_PROFILE_UNAVAILABLE','PRIVATE_PROFILE_UNSAFE','PRIVATE_PROFILE_INVALID','PRIVATE_PROFILE_CHANGED','PROFILE_BASE_INVALID','PROFILE_AUTH_FIELDS_REQUIRED','PROFILE_CONFIGURATION_REQUIRED','PROFILE_STORAGE_ALREADY_CONFIGURED','PROFILE_DATABASE_REQUIRED','PROFILE_DATABASE_INVALID','PRIVATE_BACKUP_ALREADY_EXISTS','PRIVATE_BACKUP_FAILED','PRIVATE_PROFILE_WRITE_FAILED','PROFILE_SERIALIZATION_UNSUPPORTED','CONFIGURATION_INPUT_INVALID','ADMIN_KEY_INPUT_INVALID','ADMIN_KEY_INPUT_TOO_LARGE','ADMIN_KEY_INPUT_REQUIRED','ADMIN_KEY_PUBLIC_NOT_ALLOWED','ADMIN_KEY_MASKED_INPUT','ADMIN_KEY_WRAPPED_INPUT','ADMIN_KEY_NOT_ADMINISTRATIVE','ADMIN_KEY_PROJECT_MISMATCH','ADMIN_KEY_FORMAT_INVALID','ADMIN_KEY_PIPE_REQUIRED','ADMIN_KEY_INPUT_TIMED_OUT']);
class StorageProvisionError extends Error{constructor(code){super(code);this.code=code;}}
const fail=code=>{throw new StorageProvisionError(code);};
const safeError=error=>error instanceof StorageProvisionError||knownErrors.has(error?.code)?error.code:'STORAGE_PROVISION_FAILED';
const digest=value=>createHash('sha256').update(value).digest('hex');
const sameFile=(a,b)=>a.isFile()&&!a.isSymbolicLink()&&a.nlink===1&&a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&a.mtimeMs===b.mtimeMs;
async function loadProfile(profilePath){
 let handle,bytes;
 try{
  profilePath=await integrationProfilePath(profilePath);
  const before=await lstat(profilePath);if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1||before.size>MAX_PROFILE_BYTES)fail('PRIVATE_PROFILE_UNSAFE');
  handle=await open(profilePath,'r');const opened=await handle.stat();if(!sameFile(opened,before))fail('PRIVATE_PROFILE_CHANGED');
  bytes=Buffer.alloc(MAX_PROFILE_BYTES+1);let size=0;
  while(size<bytes.length){const part=await handle.read(bytes,size,bytes.length-size,size);if(!part.bytesRead)break;size+=part.bytesRead;}
  if(size!==opened.size||size>MAX_PROFILE_BYTES||!sameFile(await lstat(profilePath),opened))fail('PRIVATE_PROFILE_CHANGED');
  const content=new TextDecoder('utf8',{fatal:true}).decode(bytes.subarray(0,size));
  return{profilePath,profile:parseEnv(content),fingerprint:digest(content)};
 }catch(error){if(error instanceof StorageProvisionError||knownErrors.has(error?.code))throw error;fail('PRIVATE_PROFILE_UNAVAILABLE');}
 finally{bytes?.fill(0);await handle?.close().catch(()=>{});}
}
async function entryExists(path){try{await lstat(path);return true;}catch(error){if(error.code==='ENOENT')return false;fail('STORAGE_JOURNAL_UNAVAILABLE');}}
async function unchanged(loaded){if((await loadProfile(loaded.profilePath)).fingerprint!==loaded.fingerprint)fail('PRIVATE_PROFILE_CHANGED');}
async function preflight({profilePath=resolve('.env.integration.local'),environment=process.env}={}){
 const loaded=await loadProfile(profilePath);
 const checked=await checkIntegrationProfile({profilePath:loaded.profilePath,environment});
 if(!checked.configured||checked.issues.length||checked.missingFields.length)fail('PROFILE_CONFIGURATION_REQUIRED');
 if(loaded.profile.HESSARA_TEST_PROJECT_REF!==APPROVED_PROFILE_PROJECT||loaded.profile.NEXT_PUBLIC_SUPABASE_URL!==APPROVED_STORAGE_URL)fail('PROFILE_BASE_INVALID');
 if(typeof loaded.profile.SUPABASE_AUTH_SECRET_KEY==='string'&&loaded.profile.SUPABASE_AUTH_SECRET_KEY.length)fail('PROFILE_STORAGE_ALREADY_CONFIGURED');
 const journalPath=join(dirname(loaded.profilePath),STORAGE_JOURNAL_NAME);
 if(await entryExists(journalPath))fail('STORAGE_JOURNAL_ALREADY_EXISTS');
 if(await entryExists(join(dirname(loaded.profilePath),STORAGE_BACKUP_NAME)))fail('PRIVATE_BACKUP_ALREADY_EXISTS');
 await unchanged(loaded);
 return{...loaded,journalPath};
}
/** Offline check only: it consumes no administrator key and never constructs an SDK client. */
export async function checkIntegrationStorage(options={}){
 try{
  await preflight(options);
  return{status:'ready_for_explicit_apply',prerequisitesConfigured:true,verified:false,storageVerified:false,keySavedServerOnly:false,networkAttempted:false,journalState:'not_created',projectRef:APPROVED_PROFILE_PROJECT,bucket:{id:INTEGRATION_STORAGE_BUCKET}};
 }catch(error){return{status:'blocked',prerequisitesConfigured:false,verified:false,storageVerified:false,keySavedServerOnly:false,networkAttempted:false,error:safeError(error),projectRef:APPROVED_PROFILE_PROJECT,bucket:{id:INTEGRATION_STORAGE_BUCKET}};}
}
async function createJournal(path,prepared){
 let handle;
 try{handle=await open(path,'ax',0o600);}catch(error){fail(error.code==='EEXIST'?'STORAGE_JOURNAL_ALREADY_EXISTS':'STORAGE_JOURNAL_WRITE_FAILED');}
 const original=await handle.stat();
 async function append(event){
  let bytes;
  try{
   const before=await lstat(path),current=await handle.stat();
   if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1||before.dev!==original.dev||before.ino!==original.ino||current.nlink!==1||current.size>16384)fail('STORAGE_JOURNAL_CHANGED');
   bytes=Buffer.from(JSON.stringify(event)+'\n');await handle.writeFile(bytes);await handle.sync();
   const after=await lstat(path);if(!after.isFile()||after.isSymbolicLink()||after.nlink!==1||after.dev!==original.dev||after.ino!==original.ino)fail('STORAGE_JOURNAL_CHANGED');
  }catch(error){if(error instanceof StorageProvisionError)throw error;fail('STORAGE_JOURNAL_WRITE_FAILED');}
  finally{bytes?.fill(0);}
 }
 try{await append(prepared);}catch(error){await handle.close().catch(()=>{});throw error;}
 return{append,close:()=>handle.close()};
}
async function bounded(operation,code,timeoutMs){
 let timer;
 try{return await Promise.race([Promise.resolve().then(operation),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new StorageProvisionError(code)),timeoutMs);})]);}
 finally{clearTimeout(timer);}
}
function privateBucket(data){
 if(!data||typeof data!=='object'||Array.isArray(data)||data.id!==INTEGRATION_STORAGE_BUCKET||data.name!==INTEGRATION_STORAGE_BUCKET)fail('STORAGE_BUCKET_IDENTITY_INVALID');
 if(data.public!==false)fail(data.public===true?'STORAGE_BUCKET_PUBLIC':'STORAGE_BUCKET_CONFIGURATION_UNKNOWN');
 if(!Number.isSafeInteger(data.file_size_limit)||data.file_size_limit<1||data.file_size_limit>INTEGRATION_STORAGE_LIMIT||data.allowed_mime_types!==null||(data.type!==undefined&&data.type!=='STANDARD')||(data.versioning_status!==undefined&&data.versioning_status!=='DISABLED'))fail('STORAGE_BUCKET_CONFIGURATION_UNKNOWN');
 return{id:INTEGRATION_STORAGE_BUCKET,public:false,fileSizeLimit:data.file_size_limit};
}
function missingBucket(error){
 const status=Number(error?.status),code=Number(error?.statusCode??error?.status);
 return code===404&&[400,404].includes(status);
}
async function boundedResponse(response,signal){
 const reader=response.body?.getReader();if(!reader)return response;
 const chunks=[];let size=0,combined;
 const abort=()=>{void reader.cancel().catch(()=>{});};signal.addEventListener('abort',abort,{once:true});
 try{
  while(true){if(signal.aborted)fail('STORAGE_RESPONSE_TIMED_OUT');const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>65536){part.value.fill(0);fail('STORAGE_RESPONSE_TOO_LARGE');}chunks.push(part.value);}
  if(signal.aborted)fail('STORAGE_RESPONSE_TIMED_OUT');combined=Buffer.concat(chunks);
  return new Response([204,205,304].includes(response.status)?null:combined,{status:response.status,statusText:response.statusText,headers:response.headers});
 }finally{signal.removeEventListener('abort',abort);void reader.cancel().catch(()=>{});reader.releaseLock();combined?.fill(0);for(const chunk of chunks)chunk.fill(0);}
}
function clientOptions(metrics,fetcher){
 return{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:async(input,init={})=>{
  const url=new URL(input instanceof Request?input.url:String(input)),method=(init.method??(input instanceof Request?input.method:'GET')).toUpperCase();
  const read=method==='GET'&&url.pathname==='/storage/v1/bucket/'+INTEGRATION_STORAGE_BUCKET;
  const create=method==='POST'&&url.pathname==='/storage/v1/bucket';
  if(url.origin!==APPROVED_STORAGE_URL||url.username||url.password||url.hash||url.search||(!read&&!create))fail('STORAGE_REQUEST_TARGET_REJECTED');
  if(create){
   let body;
   try{if(typeof init.body!=='string'||init.body.length>1024)throw Error();body=JSON.parse(init.body);}catch{fail('STORAGE_REQUEST_TARGET_REJECTED');}
   if(!body||Object.keys(body).sort().join(',')!=='file_size_limit,id,name,public'||body.id!==INTEGRATION_STORAGE_BUCKET||body.name!==INTEGRATION_STORAGE_BUCKET||body.public!==false||body.file_size_limit!==INTEGRATION_STORAGE_LIMIT)fail('STORAGE_REQUEST_TARGET_REJECTED');
  }
  metrics.networkAttempted=true;metrics.networkRequestsAttempted++;
  const signal=AbortSignal.any([AbortSignal.timeout(15000),...(init.signal?[init.signal]:[])]);
  return boundedResponse(await fetcher(input,{...init,redirect:'error',cache:'no-store',signal}),signal);
 }}};
}
/** Explicit --apply only. The key is committed locally only after a private bucket is actually verified. */
export async function provisionIntegrationStorage(input,{profilePath=resolve('.env.integration.local'),environment=process.env,createClient=supabaseClient,fetcher=fetch,commitStorage=configureIntegrationStorageKey,operationTimeoutMs=OPERATION_MS}={}){
 const result={status:'blocked',verified:false,storageVerified:false,keySavedServerOnly:false,projectRef:APPROVED_PROFILE_PROJECT,bucket:{id:INTEGRATION_STORAGE_BUCKET},phase:'configuration',networkAttempted:false,networkRequestsAttempted:0,storageOperationsAttempted:0,journalState:'not_created',profileCommit:'not_attempted',creation:{state:'not_attempted'},recoveryRequired:false};
 let journal,loaded,key;
 const event=async(kind,extra={})=>journal.append({kind,...extra});
 async function operation(run,code){if(loaded)await unchanged(loaded);result.networkAttempted=true;result.storageOperationsAttempted++;return bounded(run,code,operationTimeoutMs);}
 try{
  if(!Number.isInteger(operationTimeoutMs)||operationTimeoutMs<1||operationTimeoutMs>OPERATION_MS)fail('STORAGE_OPERATION_BUDGET_INVALID');
  key=validateIntegrationAdminKey(input);loaded=await preflight({profilePath,environment});
  const client=createClient(APPROVED_STORAGE_URL,key,clientOptions(result,fetcher));
  const read=()=>operation(()=>client.storage.getBucket(INTEGRATION_STORAGE_BUCKET),'STORAGE_INSPECTION_TIMED_OUT');
  phase('inspect_existing');await unchanged(loaded);
  const observed=await read();
  const absent=!!observed?.error&&observed.data===null&&missingBucket(observed.error);
  if(observed?.error&&!absent)fail('STORAGE_INSPECTION_FAILED');
  if(!absent)result.bucket=privateBucket(observed?.data);
  result.journalState='unknown';
  journal=await createJournal(loaded.journalPath,{schemaVersion:1,kind:'prepared',projectRef:APPROVED_PROFILE_PROJECT,bucket:INTEGRATION_STORAGE_BUCKET,attemptId:randomUUID(),createdAt:new Date().toISOString(),profileFingerprint:loaded.fingerprint,initialState:absent?'absent':'private_verified'});
  result.journalState='present';
  if(absent){
   phase('create');await unchanged(loaded);await event('create_pending');result.creation.state='unknown';
   let created;
   try{created=await operation(()=>client.storage.createBucket(INTEGRATION_STORAGE_BUCKET,{public:false,fileSizeLimit:INTEGRATION_STORAGE_LIMIT}),'STORAGE_CREATE_UNCERTAIN');}
   catch{created=null;}
   if(created?.error||created?.data?.name!==INTEGRATION_STORAGE_BUCKET){
    await event('create_uncertain');
    // One bounded read can observe an ambiguous creation; never retry creation or save a key here.
    let observation='unverified';
    try{const checked=await read();if(!checked?.error){privateBucket(checked.data);observation='private_bucket_present';}else if(missingBucket(checked.error))observation='absent';}catch{}
    result.creation.observation=observation;await event('uncertain_observation',{observation});fail('STORAGE_CREATE_UNCERTAIN');
   }
   result.creation.state='acknowledged';await event('create_acknowledged');
   phase('verify_created');await unchanged(loaded);const verified=await read();if(verified?.error)fail('STORAGE_VERIFICATION_FAILED');
   result.bucket=privateBucket(verified?.data);result.creation.state='created';await event('bucket_verified',{bucket:result.bucket});
  }else{result.creation.state='preexisting';await event('bucket_verified',{bucket:result.bucket});}
  phase('profile_commit');await unchanged(loaded);await event('profile_commit_pending');result.profileCommit='unknown';
  const committed=await commitStorage({adminKey:key},{profilePath:loaded.profilePath,environment});
  if(!committed?.configured||!committed.storageKeyConfigured||committed.verified!==false||committed.networkTested!==false)fail('STORAGE_PROFILE_COMMIT_FAILED');
  const saved=(await loadProfile(loaded.profilePath)).profile;
  if(saved.SUPABASE_AUTH_SECRET_KEY!==key||saved.DATABASE_URL!==loaded.profile.DATABASE_URL||Object.entries(loaded.profile).some(([name,value])=>name!=='SUPABASE_AUTH_SECRET_KEY'&&saved[name]!==value)||Object.keys(saved).some(name=>name!=='SUPABASE_AUTH_SECRET_KEY'&&!Object.hasOwn(loaded.profile,name)))fail('STORAGE_PROFILE_COMMIT_FAILED');
  result.profileCommit='committed';await event('complete',{storageVerified:true,profileCommit:'committed'});
  result.status='verified';result.verified=true;result.storageVerified=true;result.keySavedServerOnly=true;result.recoveryRequired=false;phase('complete');
 }catch(error){
  result.status=result.networkAttempted?'failed':'blocked';result.error=safeError(error);result.recoveryRequired=!!journal||result.journalState==='unknown';
  if(journal){try{await event('stopped',{phase:result.phase,error:result.error,creation:result.creation,profileCommit:result.profileCommit});}catch{result.journalState='unverified';}}
 }finally{await journal?.close().catch(()=>{});key=undefined;loaded=undefined;}
 function phase(value){result.phase=value;}
 return result;
}
export const readStorageProvisionInput=(stream,options)=>readUserProvisionInput(stream,options);
export async function runStorageProvisionCli({args=process.argv.slice(2),input=process.stdin,...options}={}){
 let payload;
 try{
  if(args.length>1||(args.length&&!['--check','--apply'].includes(args[0])))fail('STORAGE_PROVISION_ARGUMENT_INVALID');
  const checked=await checkIntegrationStorage(options);
  if(args[0]!=='--apply')return{result:checked,exitCode:checked.prerequisitesConfigured?0:2};
  if(!checked.prerequisitesConfigured)return{result:checked,exitCode:2};
  payload=await readStorageProvisionInput(input);const result=await provisionIntegrationStorage(payload,options);return{result,exitCode:result.verified?0:2};
 }catch(error){return{result:{status:'blocked',verified:false,storageVerified:false,keySavedServerOnly:false,networkAttempted:false,error:safeError(error),projectRef:APPROVED_PROFILE_PROJECT,bucket:{id:INTEGRATION_STORAGE_BUCKET}},exitCode:2};}
 finally{if(payload)payload.adminKey=undefined;}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const{result,exitCode}=await runStorageProvisionCli();process.stdout.write(JSON.stringify(result)+'\n');process.exitCode=exitCode;
}
