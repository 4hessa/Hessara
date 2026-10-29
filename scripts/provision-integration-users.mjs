import {lstat,open} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseEnv} from 'node:util';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {createClient as supabaseClient} from '@supabase/supabase-js';
import {APPROVED_PROFILE_PROJECT,PROFILE_FIELDS,integrationProfilePath,checkIntegrationDatabase,configureIntegrationAccounts} from './configure-integration-profile.mjs';

export const ACCOUNT_JOURNAL_NAME='.env.integration.accounts.local';
export const APPROVED_AUTH_URL=`https://${APPROVED_PROFILE_PROJECT}.supabase.co`;
const MAX_PROFILE_BYTES=65536,MAX_INPUT_BYTES=8192,OPERATION_MS=20000;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
class UserProvisionError extends Error{constructor(code){super(code);this.code=code;}}
const fail=code=>{throw new UserProvisionError(code);};
const digest=content=>createHash('sha256').update(content).digest('hex');
const present=value=>typeof value==='string'&&!!value.trim();
const sameFile=(a,b)=>a.isFile()&&!a.isSymbolicLink()&&a.nlink===1&&a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&a.mtimeMs===b.mtimeMs;
const profileErrors=new Set(['LOCAL_CONFIGURATION_ONLY','PRIVATE_PROFILE_PATH_INVALID','PRIVATE_PROFILE_UNAVAILABLE','PRIVATE_PROFILE_UNSAFE','PRIVATE_PROFILE_INVALID','PRIVATE_PROFILE_CHANGED','PROFILE_AUTH_FIELDS_ALREADY_CONFIGURED','PROFILE_DATABASE_REQUIRED','PROFILE_DATABASE_INVALID','PROFILE_BASE_INVALID','PRIVATE_BACKUP_ALREADY_EXISTS','PRIVATE_BACKUP_FAILED','PRIVATE_PROFILE_WRITE_FAILED']);
function safeError(error){return error instanceof UserProvisionError||profileErrors.has(error?.code)?error.code:'AUTH_PROVISION_FAILED';}
function validateKey(input){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).join(',')!=='adminKey'||typeof input.adminKey!=='string')fail('ADMIN_KEY_INPUT_INVALID');
 if(input.adminKey.length>4096)fail('ADMIN_KEY_INPUT_TOO_LARGE');
 // Clipboard formatting is not part of an API key. Only trim at the boundaries;
 // do not join wrapped lines, alter case, or strip characters within a key.
 const key=input.adminKey.trim();
 if(!key)fail('ADMIN_KEY_INPUT_REQUIRED');
 if(/^sb_publishable_/.test(key))fail('ADMIN_KEY_PUBLIC_NOT_ALLOWED');
 if(/[*•●…]|\.{3}/.test(key))fail('ADMIN_KEY_MASKED_INPUT');
 if(/^(?:Bearer|apikey)\s/i.test(key)||/^["']|["']$/.test(key))fail('ADMIN_KEY_WRAPPED_INPUT');
 if(/^sb_secret_[A-Za-z0-9_-]{16,512}$/.test(key))return key;
 try{
  const parts=key.split('.');if(parts.length!==3||parts.some(part=>!/^[A-Za-z0-9_-]+$/.test(part)))throw Error();
  const claims=JSON.parse(Buffer.from(parts[1],'base64url').toString('utf8'));
  // This only rejects wrong-project/public keys; the fixed Auth server verifies it.
  if(claims.role==='anon')fail('ADMIN_KEY_PUBLIC_NOT_ALLOWED');
  if(claims.role!=='service_role')fail('ADMIN_KEY_NOT_ADMINISTRATIVE');
  if(claims.ref!==APPROVED_PROFILE_PROJECT)fail('ADMIN_KEY_PROJECT_MISMATCH');
  return key;
 }catch(error){if(error instanceof UserProvisionError)throw error;}
 fail('ADMIN_KEY_FORMAT_INVALID');
}
// Shared local input policy; no request, persistence or key disclosure.
export {validateKey as validateIntegrationAdminKey};

async function loadProfile(profilePath){
 let handle,bytes;
 try{
  profilePath=await integrationProfilePath(profilePath);
  const before=await lstat(profilePath);if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1||before.size>MAX_PROFILE_BYTES)fail('PRIVATE_PROFILE_UNSAFE');
  handle=await open(profilePath,'r');const opened=await handle.stat();if(!sameFile(opened,before))fail('PRIVATE_PROFILE_CHANGED');
  bytes=Buffer.alloc(MAX_PROFILE_BYTES+1);let size=0;
  while(size<bytes.length){const result=await handle.read(bytes,size,bytes.length-size,size);if(!result.bytesRead)break;size+=result.bytesRead;}
  if(size!==opened.size||size>MAX_PROFILE_BYTES||!sameFile(await lstat(profilePath),opened))fail('PRIVATE_PROFILE_CHANGED');
  const content=new TextDecoder('utf8',{fatal:true}).decode(bytes.subarray(0,size));
  return{profilePath,profile:parseEnv(content),fingerprint:digest(content)};
 }catch(error){if(error instanceof UserProvisionError||profileErrors.has(error?.code))throw error;fail('PRIVATE_PROFILE_UNAVAILABLE');}
 finally{bytes?.fill(0);await handle?.close().catch(()=>{});}
}
async function journalExists(path){try{await lstat(path);return true;}catch(error){if(error.code==='ENOENT')return false;fail('ACCOUNT_JOURNAL_UNAVAILABLE');}}
async function preflight({profilePath=resolve('.env.integration.local'),environment=process.env}={}){
 const checked=await checkIntegrationDatabase({profilePath,environment});
 if(checked.issues.length)fail('PROFILE_BASE_INVALID');
 if(!checked.databaseConfigured)fail('PROFILE_DATABASE_REQUIRED');
 if(checked.missingAuthFields.length!==4)fail('PROFILE_AUTH_FIELDS_ALREADY_CONFIGURED');
 const loaded=await loadProfile(profilePath),profile=loaded.profile;
 if(profile.HESSARA_TEST_PROJECT_REF!==APPROVED_PROFILE_PROJECT||profile.NEXT_PUBLIC_SUPABASE_URL!==APPROVED_AUTH_URL)fail('PROFILE_BASE_INVALID');
 if(PROFILE_FIELDS.slice(1).some(name=>present(profile[name])))fail('PROFILE_AUTH_FIELDS_ALREADY_CONFIGURED');
 if(!/^sb_publishable_[A-Za-z0-9_-]{8,512}$/.test(profile.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY??''))fail('PUBLISHABLE_KEY_REQUIRED');
 const journalPath=join(dirname(loaded.profilePath),ACCOUNT_JOURNAL_NAME);
 if(await journalExists(journalPath))fail('ACCOUNT_JOURNAL_ALREADY_EXISTS');
 if(await journalExists(join(dirname(loaded.profilePath),'.env.integration.accounts.backup.local')))fail('PRIVATE_BACKUP_ALREADY_EXISTS');
 return{...loaded,journalPath};
}
/** Offline prerequisite inspection only. It never consumes an administrator key. */
export async function checkIntegrationUsers(options={}){
 try{
  await preflight(options);
  return{status:'ready_for_explicit_apply',prerequisitesConfigured:true,verified:false,networkAttempted:false,journalPresent:false,projectRef:APPROVED_PROFILE_PROJECT};
 }catch(error){return{status:'blocked',prerequisitesConfigured:false,verified:false,networkAttempted:false,error:safeError(error),projectRef:APPROVED_PROFILE_PROJECT};}
}
async function createJournal(path,prepared){
 let handle;
 try{handle=await open(path,'ax',0o600);}catch(error){fail(error.code==='EEXIST'?'ACCOUNT_JOURNAL_ALREADY_EXISTS':'ACCOUNT_JOURNAL_WRITE_FAILED');}
 const original=await handle.stat();
 async function append(event){
  let bytes;
  try{
   const before=await lstat(path),current=await handle.stat();
   if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1||before.dev!==original.dev||before.ino!==original.ino||current.nlink!==1)fail('ACCOUNT_JOURNAL_CHANGED');
   bytes=Buffer.from(JSON.stringify(event)+'\n');await handle.writeFile(bytes);await handle.sync();
   const after=await lstat(path);if(!after.isFile()||after.isSymbolicLink()||after.nlink!==1||after.dev!==original.dev||after.ino!==original.ino)fail('ACCOUNT_JOURNAL_CHANGED');
  }catch(error){if(error instanceof UserProvisionError)throw error;fail('ACCOUNT_JOURNAL_WRITE_FAILED');}
  finally{bytes?.fill(0);}
 }
 try{await append(prepared);}catch(error){await handle.close().catch(()=>{});throw error;}
 return{append,close:()=>handle.close()};
}
async function bounded(operation,code,timeoutMs){
 let timer;
 try{return await Promise.race([Promise.resolve().then(operation),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new UserProvisionError(code)),timeoutMs);})]);}
 finally{clearTimeout(timer);}
}
function confirmedUser(user,email,id){
 return !!user&&uuid.test(user.id??'')&&(!id||user.id===id)&&typeof user.email==='string'&&user.email.toLowerCase()===email&&user.is_anonymous===false&&user.role==='authenticated'&&typeof user.email_confirmed_at==='string'&&Number.isFinite(Date.parse(user.email_confirmed_at));
}
function clientOptions(role,metrics,fetcher){
 const allowed=role==='admin'?[['POST','/auth/v1/admin/users','']]:[['POST','/auth/v1/token','?grant_type=password'],['GET','/auth/v1/user',''],['POST','/auth/v1/logout','?scope=local']];
 return{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:async(input,init={})=>{
  const url=new URL(input instanceof Request?input.url:String(input)),method=(init.method??(input instanceof Request?input.method:'GET')).toUpperCase();
  if(url.origin!==APPROVED_AUTH_URL||url.username||url.password||url.hash||!allowed.some(([verb,path,search])=>verb===method&&url.pathname===path&&url.search===search))fail('AUTH_REQUEST_TARGET_REJECTED');
  metrics.networkAttempted=true;metrics.networkRequestsAttempted++;
  return fetcher(input,{...init,redirect:'error',cache:'no-store',signal:AbortSignal.any([AbortSignal.timeout(15000),...(init.signal?[init.signal]:[])])});
 }}};
}
/** Explicit --apply only: create two dedicated confirmed test users through official Auth APIs. */
export async function provisionIntegrationUsers(input,{profilePath=resolve('.env.integration.local'),environment=process.env,createClient=supabaseClient,fetcher=fetch,commitAccounts=configureIntegrationAccounts,operationTimeoutMs=OPERATION_MS}={}){
 const result={status:'blocked',verified:false,projectRef:APPROVED_PROFILE_PROJECT,phase:'configuration',networkAttempted:false,authOperationsAttempted:0,networkRequestsAttempted:0,journalState:'not_created',profileCommit:'not_attempted',createdUserIds:[],accountStates:[]};
 let journal,accounts,profile;
 const event=async(kind,slot,extra={})=>{await journal.append({kind,...(slot?{slot}:{}),...extra});};
 async function operation(run,timeoutCode){result.networkAttempted=true;result.authOperationsAttempted++;return bounded(run,timeoutCode,operationTimeoutMs);}
 try{
  if(!Number.isInteger(operationTimeoutMs)||operationTimeoutMs<1||operationTimeoutMs>OPERATION_MS)fail('AUTH_OPERATION_BUDGET_INVALID');
  const key=validateKey(input),loaded=await preflight({profilePath,environment});profile=loaded.profile;
  const nonce=randomBytes(16).toString('hex');
  accounts=['A','B'].map(slot=>({slot,email:`hessara-e2e-${nonce}-${slot.toLowerCase()}@example.test`,password:`Aa9!${slot}${randomBytes(32).toString('base64url')}`,id:null,create:'not_attempted',verification:'not_attempted',signOut:'not_attempted'}));
  result.accountStates=accounts.map(account=>({slot:account.slot,id:null,create:'not_attempted',verification:'not_attempted',signOut:'not_attempted'}));
  // Append-only NDJSON: the durable first line contains recovery credentials. No key/tokens.
  result.journalState='unknown';journal=await createJournal(loaded.journalPath,{schemaVersion:1,kind:'prepared',projectRef:APPROVED_PROFILE_PROJECT,attemptId:randomUUID(),createdAt:new Date().toISOString(),profileFingerprint:loaded.fingerprint,accounts:accounts.map(({slot,email,password})=>({slot,email,password}))});
  result.journalState='present';
  const administrator=createClient(APPROVED_AUTH_URL,key,clientOptions('admin',result,fetcher));
  for(let index=0;index<accounts.length;index++){
   const account=accounts[index],state=result.accountStates[index];
   const current=await loadProfile(loaded.profilePath);if(current.fingerprint!==loaded.fingerprint)fail('PRIVATE_PROFILE_CHANGED');
   result.phase='create_'+account.slot;state.create='unknown';await event('create_pending',account.slot);
   let created;
   try{created=await operation(()=>administrator.auth.admin.createUser({email:account.email,password:account.password,email_confirm:true}),'AUTH_CREATE_UNCERTAIN');}catch{fail('AUTH_CREATE_UNCERTAIN');}
   const reported=created?.data?.user;
   // Retain a matching returned UUID for manual recovery even if confirmation fails.
   if(uuid.test(reported?.id??'')&&typeof reported.email==='string'&&reported.email.toLowerCase()===account.email){
    account.id=reported.id;state.id=account.id;result.createdUserIds.push(account.id);await event('create_observed',account.slot,{id:account.id});
   }
   if(created?.error||!confirmedUser(reported,account.email))fail('AUTH_CREATE_UNCERTAIN');
   state.create='created';await event('created',account.slot,{id:account.id});
   const client=createClient(APPROVED_AUTH_URL,profile.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,clientOptions('public',result,fetcher));
   let verificationError,signInAttempted=false;
   try{
    result.phase='verify_'+account.slot;state.verification='pending';await event('verification_pending',account.slot,{id:account.id});
    signInAttempted=true;
    const signed=await operation(()=>client.auth.signInWithPassword({email:account.email,password:account.password}),'AUTH_SIGNIN_TIMED_OUT');
    if(signed?.error||!confirmedUser(signed?.data?.user,account.email,account.id)||signed?.data?.session?.user?.id!==account.id||!present(signed?.data?.session?.access_token)||!present(signed?.data?.session?.refresh_token))fail('AUTH_SIGNIN_VERIFICATION_FAILED');
    const checked=await operation(()=>client.auth.getUser(),'AUTH_IDENTITY_TIMED_OUT');
    if(checked?.error||!confirmedUser(checked?.data?.user,account.email,account.id))fail('AUTH_IDENTITY_VERIFICATION_FAILED');
    state.verification='verified';await event('identity_verified',account.slot,{id:account.id});
   }catch(error){state.verification='failed';verificationError=error instanceof UserProvisionError?error:new UserProvisionError('AUTH_VERIFICATION_FAILED');}
   finally{
    if(signInAttempted){
     state.signOut='unknown';
     try{
      await event('signout_pending',account.slot,{id:account.id});
      const signedOut=await operation(()=>client.auth.signOut({scope:'local'}),'AUTH_SIGNOUT_TIMED_OUT');
      if(signedOut?.error)fail('AUTH_SIGNOUT_FAILED');
      state.signOut='signed_out';await event('signed_out',account.slot,{id:account.id});
     }catch{state.signOut='failed';verificationError??=new UserProvisionError('AUTH_SIGNOUT_FAILED');}
    }
   }
   if(verificationError)throw verificationError;
  }
  result.phase='profile_commit';
  if((await loadProfile(loaded.profilePath)).fingerprint!==loaded.fingerprint)fail('PRIVATE_PROFILE_CHANGED');
  const credentials={emailA:accounts[0].email,passwordA:accounts[0].password,emailB:accounts[1].email,passwordB:accounts[1].password};
  await event('profile_commit_pending');result.profileCommit='unknown';
  const committed=await commitAccounts(credentials,{profilePath:loaded.profilePath,environment});
  if(!committed?.configured||!committed.accountsConfigured)fail('ACCOUNT_PROFILE_COMMIT_FAILED');
  const saved=(await loadProfile(loaded.profilePath)).profile;
  for(const[slot,account]of accounts.map(account=>[account.slot,account]))if(saved[`HESSARA_TEST_EMAIL_${slot}`]!==account.email||saved[`HESSARA_TEST_PASSWORD_${slot}`]!==account.password)fail('ACCOUNT_PROFILE_COMMIT_FAILED');
  if(saved.DATABASE_URL!==profile.DATABASE_URL)fail('ACCOUNT_PROFILE_COMMIT_FAILED');
  result.profileCommit='committed';await event('complete',undefined,{verified:true});
  result.status='verified';result.verified=true;result.phase='complete';
 }catch(error){
  result.status=result.networkAttempted?'failed':'blocked';result.error=safeError(error);
  if(journal){try{await event('stopped',undefined,{phase:result.phase,error:result.error,profileCommit:result.profileCommit,accountStates:result.accountStates});}catch{result.journalState='unverified';}}
 }finally{await journal?.close().catch(()=>{});if(accounts)for(const account of accounts)account.password=undefined;profile=undefined;}
 return result;
}
export async function readUserProvisionInput(stream,{timeoutMs=30000}={}){
 if(!stream||typeof stream[Symbol.asyncIterator]!=='function'||typeof stream.destroy!=='function'||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000)fail('ADMIN_KEY_INPUT_INVALID');
 if(stream.isTTY)fail('ADMIN_KEY_PIPE_REQUIRED');
 const chunks=[];let size=0,combined;
 const timer=setTimeout(()=>stream.destroy(new UserProvisionError('ADMIN_KEY_INPUT_TIMED_OUT')),timeoutMs);
 try{
  for await(const chunk of stream){const bytes=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);size+=bytes.length;if(size>MAX_INPUT_BYTES){bytes.fill(0);fail('ADMIN_KEY_INPUT_TOO_LARGE');}chunks.push(bytes);}
  if(!size)fail('ADMIN_KEY_INPUT_REQUIRED');combined=Buffer.concat(chunks);
  try{const input=JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(combined));input.adminKey=validateKey(input);return input;}catch(error){if(error instanceof UserProvisionError)throw error;fail('ADMIN_KEY_INPUT_INVALID');}
 }finally{clearTimeout(timer);combined?.fill(0);for(const chunk of chunks)chunk.fill(0);}
}
export async function runUserProvisionCli({args=process.argv.slice(2),input=process.stdin,...options}={}){
 let payload;
 try{
  if(args.length>1||(args.length&&!['--check','--apply'].includes(args[0])))fail('AUTH_PROVISION_ARGUMENT_INVALID');
  const checked=await checkIntegrationUsers(options);
  if(args[0]!=='--apply')return{result:checked,exitCode:checked.prerequisitesConfigured?0:2};
  if(!checked.prerequisitesConfigured)return{result:checked,exitCode:2};
  payload=await readUserProvisionInput(input);const result=await provisionIntegrationUsers(payload,options);return{result,exitCode:result.verified?0:2};
 }catch(error){return{result:{status:'blocked',verified:false,networkAttempted:false,error:safeError(error),projectRef:APPROVED_PROFILE_PROJECT},exitCode:2};}
 finally{if(payload)payload.adminKey=undefined;}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const{result,exitCode}=await runUserProvisionCli();process.stdout.write(JSON.stringify(result)+'\n');process.exitCode=exitCode;
}
