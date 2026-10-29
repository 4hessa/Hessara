import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,lstat,unlink,mkdir} from 'node:fs/promises';
import {resolve,join,relative,isAbsolute} from 'node:path';
import {parseEnv} from 'node:util';
import {Readable} from 'node:stream';
import {createClient as officialClient} from '@supabase/supabase-js';
import {APPROVED_PROFILE_PROJECT,VERIFIED_PROFILE_POOLER} from '../scripts/configure-integration-profile.mjs';
import {provisionIntegrationStorage,runStorageProvisionCli,readStorageProvisionInput,STORAGE_JOURNAL_NAME,STORAGE_BACKUP_NAME,INTEGRATION_STORAGE_BUCKET,INTEGRATION_STORAGE_LIMIT,APPROVED_STORAGE_URL} from '../scripts/provision-integration-storage.mjs';

const root=resolve('.'),adminKey='sb_secret_'+'s'.repeat(40),input={adminKey};
const base={HESSARA_TEST_PROJECT_REF:APPROVED_PROFILE_PROJECT,NEXT_PUBLIC_SUPABASE_URL:APPROVED_STORAGE_URL,NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fixture_only_storage_key',HESSARA_TEST_ISOLATED:'true',HESSARA_INTEGRATION_TEST:'true',HESSARA_TEST_URL:'http://127.0.0.1:5174',HESSARA_SITE_URL:'http://127.0.0.1:5174',HESSARA_ENCRYPTION_KEY:Buffer.alloc(32,17).toString('base64'),HESSARA_TEST_ATTESTATION_KEY:'storage-fixture-only-attestation-'.repeat(2),DATABASE_URL:'postgresql://hessara_runtime.'+APPROVED_PROFILE_PROJECT+':fixture-db-password-not-real@'+VERIFIED_PROFILE_POOLER+':6543/postgres',POSTGRES_URL:'',DATABASE_SSL_CA:'preserve-public-ca-fixture',HESSARA_TEST_EMAIL_A:'storage-fixture-a@example.test',HESSARA_TEST_PASSWORD_A:'fixture-password-account-A',HESSARA_TEST_EMAIL_B:'storage-fixture-b@example.test',HESSARA_TEST_PASSWORD_B:'fixture-password-account-B',SUPABASE_AUTH_SECRET_KEY:'',OTHER_SETTING:'preserve storage fixture'};
const content=values=>Object.entries(values).map(([key,value])=>key+"='"+value+"'").join('\n')+'\n';
async function fixture(t,updates={}){
 const folder=await mkdtemp(join(root,'.integration-storage-test-'));
 t.after(async()=>{const path=resolve(folder),inside=relative(root,path);assert.ok(inside&&!inside.startsWith('..')&&!isAbsolute(inside));await rm(path,{recursive:true,force:true});});
 const profilePath=join(folder,'.env.integration.local'),initial=content({...base,...updates});await writeFile(profilePath,initial,{mode:0o600});return{folder,profilePath,initial,environment:{}};
}
const bucket=(changes={})=>({id:INTEGRATION_STORAGE_BUCKET,name:INTEGRATION_STORAGE_BUCKET,public:false,file_size_limit:INTEGRATION_STORAGE_LIMIT,allowed_mime_types:null,type:'STANDARD',versioning_status:'DISABLED',...changes});
const missing=()=>({data:null,error:{status:404,statusCode:'404',message:'fixture missing'}});
async function journal(f){return(await readFile(join(f.folder,STORAGE_JOURNAL_NAME),'utf8')).trim().split('\n').map(line=>JSON.parse(line));}
function driver({absent=false,initialBucket=bucket(),afterBucket=bucket(),onCreate,onRead,constructorHook}={}){
 const calls=[];let reads=0,created=false,constructors=0;
 function createClient(url,key,options){
  constructors++;assert.equal(url,APPROVED_STORAGE_URL);assert.equal(key,adminKey);assert.equal(options.auth.persistSession,false);assert.equal(options.auth.autoRefreshToken,false);assert.equal(options.auth.detectSessionInUrl,false);constructorHook?.(options);
  return{storage:{
   async getBucket(id){assert.equal(id,INTEGRATION_STORAGE_BUCKET);calls.push('get');reads++;if(onRead)return onRead({reads,created});return absent&&!created?missing():{data:created?afterBucket:initialBucket,error:null};},
   async createBucket(id,config){calls.push('create');assert.equal(id,INTEGRATION_STORAGE_BUCKET);assert.deepEqual(config,{public:false,fileSizeLimit:INTEGRATION_STORAGE_LIMIT});created=true;return onCreate?onCreate():{data:{name:id},error:null};},
  }};
 }
 return{createClient,calls,constructors:()=>constructors};
}
function redacted(result){const text=JSON.stringify(result);for(const value of [adminKey,base.DATABASE_URL,base.HESSARA_ENCRYPTION_KEY,base.HESSARA_TEST_PASSWORD_A,base.HESSARA_TEST_PASSWORD_B,base.HESSARA_TEST_EMAIL_A,base.HESSARA_TEST_EMAIL_B,'fixture-private-token'])assert.ok(!text.includes(value));}
async function unchanged(f){assert.equal(await readFile(f.profilePath,'utf8'),f.initial);}
async function noJournal(f){await assert.rejects(lstat(join(f.folder,STORAGE_JOURNAL_NAME)),error=>error.code==='ENOENT');}

test('default and explicit checks are offline and never consume a secret or create a journal',async t=>{
 const f=await fixture(t);let constructors=0;const stream=Readable.from((function*(){throw Error('No secret input should be consumed');})());
 for(const args of [[],['--check']]){
  const checked=await runStorageProvisionCli({...f,args,input:stream,createClient:()=>{constructors++;throw Error();}});
  assert.equal(checked.exitCode,0);assert.equal(checked.result.status,'ready_for_explicit_apply');assert.equal(checked.result.verified,false);assert.equal(checked.result.storageVerified,false);assert.equal(checked.result.networkAttempted,false);redacted(checked);
 }
 assert.equal(constructors,0);await unchanged(f);await noJournal(f);
});
test('profile guards reject production, wrong URL/database, missing accounts, hosted context and existing key before SDK calls',async t=>{
 for(const updates of [{HESSARA_TEST_PROJECT_REF:'waaaxdjymuauknbcxskn'},{NEXT_PUBLIC_SUPABASE_URL:'https://waaaxdjymuauknbcxskn.supabase.co'},{DATABASE_URL:''},{DATABASE_URL:base.DATABASE_URL.replace(VERIFIED_PROFILE_POOLER,'private.invalid')},{HESSARA_TEST_PASSWORD_B:''},{HESSARA_TEST_EMAIL_B:base.HESSARA_TEST_EMAIL_A},{VERCEL:'1'},{SUPABASE_AUTH_SECRET_KEY:' '},{SUPABASE_AUTH_SECRET_KEY:'previous-secret-do-not-rotate'}]){
  const f=await fixture(t,updates),d=driver();const result=await provisionIntegrationStorage(input,{...f,createClient:d.createClient});
  assert.equal(result.verified,false);assert.equal(result.networkAttempted,false);assert.equal(d.constructors(),0);await unchanged(f);await noJournal(f);redacted(result);
 }
 const f=await fixture(t),d=driver();const result=await provisionIntegrationStorage(input,{...f,environment:{VERCEL:'1'},createClient:d.createClient});assert.equal(result.error,'LOCAL_CONFIGURATION_ONLY');assert.equal(d.constructors(),0);
});
test('unsafe/outside/nonregular private profile paths are rejected before any request',async t=>{
 const f=await fixture(t),d=driver();let result=await provisionIntegrationStorage(input,{...f,profilePath:resolve('..','.env.integration.local'),createClient:d.createClient});
 assert.equal(result.error,'PRIVATE_PROFILE_PATH_INVALID');assert.equal(d.constructors(),0);
 await unlink(f.profilePath);await mkdir(f.profilePath);result=await provisionIntegrationStorage(input,{...f,createClient:d.createClient});assert.equal(result.error,'PRIVATE_PROFILE_UNSAFE');assert.equal(d.constructors(),0);
});
test('public, masked, wrong-project and decorated administrator input cannot reach Storage or files',async t=>{
 const f=await fixture(t),d=driver(),legacy=claims=>['e30',Buffer.from(JSON.stringify(claims)).toString('base64url'),'fixture'].join('.');
 for(const value of [null,{},[],{adminKey:'sb_publishable_fixture_public'},{adminKey:'sb_secret_************'},{adminKey:'Bearer '+adminKey},{adminKey:adminKey+'\u200b'},{adminKey:legacy({role:'service_role',ref:'waaaxdjymuauknbcxskn'})},{...input,extra:true}]){
  const result=await provisionIntegrationStorage(value,{...f,createClient:d.createClient});assert.equal(result.verified,false);assert.equal(result.networkAttempted,false);redacted(result);
 }
 assert.equal(d.constructors(),0);await unchanged(f);await noJournal(f);
});
test('prior journal or backup blocks without overwrite or remote inspection',async t=>{
 for(const name of [STORAGE_JOURNAL_NAME,STORAGE_BACKUP_NAME]){
  const f=await fixture(t),d=driver();await writeFile(join(f.folder,name),'prior private metadata');const result=await provisionIntegrationStorage(input,{...f,createClient:d.createClient});
  assert.equal(result.error,name===STORAGE_JOURNAL_NAME?'STORAGE_JOURNAL_ALREADY_EXISTS':'PRIVATE_BACKUP_ALREADY_EXISTS');assert.equal(d.constructors(),0);assert.equal(await readFile(join(f.folder,name),'utf8'),'prior private metadata');await unchanged(f);
 }
});
test('existing verified private bucket saves only server key with exclusive backup and never creates/updates a bucket',async t=>{
 const f=await fixture(t),d=driver({initialBucket:bucket({file_size_limit:1024})});const result=await provisionIntegrationStorage({adminKey:' \r\n'+adminKey+'\r\n '},{...f,createClient:d.createClient});
 assert.equal(result.status,'verified',JSON.stringify(result));assert.equal(result.verified,true);assert.equal(result.storageVerified,true);assert.equal(result.keySavedServerOnly,true);assert.equal(result.profileCommit,'committed');assert.equal(result.creation.state,'preexisting');
 assert.deepEqual(result.bucket,{id:INTEGRATION_STORAGE_BUCKET,public:false,fileSizeLimit:1024});assert.deepEqual(d.calls,['get']);
 const saved=parseEnv(await readFile(f.profilePath,'utf8'));assert.equal(saved.SUPABASE_AUTH_SECRET_KEY,adminKey);for(const[key,value]of Object.entries(base))if(key!=='SUPABASE_AUTH_SECRET_KEY')assert.equal(saved[key],value);
 assert.equal(await readFile(join(f.folder,STORAGE_BACKUP_NAME),'utf8'),f.initial);const entries=await journal(f);assert.equal(entries[0].initialState,'private_verified');assert.equal(entries.at(-1).kind,'complete');redacted(result);
 const text=JSON.stringify(entries);assert.ok(!text.includes(adminKey));assert.ok(!text.includes(base.DATABASE_URL));assert.ok(!text.includes(base.HESSARA_TEST_EMAIL_A));
});
test('public or unknown bucket configuration is rejected without changing it or saving credentials',async t=>{
 for(const changes of [{public:true},{public:undefined},{file_size_limit:null},{file_size_limit:INTEGRATION_STORAGE_LIMIT+1},{file_size_limit:'1024'},{allowed_mime_types:undefined},{allowed_mime_types:['image/png']},{type:'ANALYTICS'},{versioning_status:'ENABLED'},{id:'other-bucket'}]){
  const f=await fixture(t),d=driver({initialBucket:bucket(changes)});const result=await provisionIntegrationStorage(input,{...f,createClient:d.createClient});assert.equal(result.verified,false);assert.equal(result.profileCommit,'not_attempted');assert.deepEqual(d.calls,['get']);await unchanged(f);await noJournal(f);redacted(result);
 }
});
test('creation is dispatched once only after durable pending metadata and verified again before commit',async t=>{
 const f=await fixture(t);const d=driver({absent:true,onCreate:async()=>{const entries=await journal(f);assert.equal(entries[0].initialState,'absent');assert.equal(entries.at(-1).kind,'create_pending');assert.ok(!JSON.stringify(entries).includes(adminKey));return{data:{name:INTEGRATION_STORAGE_BUCKET},error:null};}});
 const result=await provisionIntegrationStorage(input,{...f,createClient:d.createClient});assert.equal(result.verified,true);assert.equal(result.creation.state,'created');assert.deepEqual(d.calls,['get','create','get']);assert.equal((await journal(f)).at(-1).kind,'complete');redacted(result);
});
test('ambiguous creation is observed once but never retried or used to save the key',async t=>{
 const f=await fixture(t),d=driver({absent:true,onCreate:()=>{throw Error(adminKey+' fixture-private-token');}});
 const result=await provisionIntegrationStorage(input,{...f,createClient:d.createClient});assert.equal(result.verified,false);assert.equal(result.storageVerified,false);assert.equal(result.keySavedServerOnly,false);assert.equal(result.error,'STORAGE_CREATE_UNCERTAIN');assert.equal(result.creation.state,'unknown');assert.equal(result.creation.observation,'private_bucket_present');assert.equal(result.recoveryRequired,true);assert.deepEqual(d.calls,['get','create','get']);await unchanged(f);
 const count=d.constructors();const again=await provisionIntegrationStorage(input,{...f,createClient:d.createClient});assert.equal(again.error,'STORAGE_JOURNAL_ALREADY_EXISTS');assert.equal(d.constructors(),count);redacted(result);assert.ok(!JSON.stringify(await journal(f)).includes(adminKey));
});
test('a bounded creation timeout preserves uncertainty and the pending recovery record',async t=>{
 const f=await fixture(t),d=driver({absent:true,onCreate:()=>new Promise(()=>{})});const result=await provisionIntegrationStorage(input,{...f,createClient:d.createClient,operationTimeoutMs:5});
 assert.equal(result.error,'STORAGE_CREATE_UNCERTAIN');assert.equal(result.recoveryRequired,true);assert.equal(result.verified,false);assert.equal(result.creation.state,'unknown');assert.equal(d.calls.filter(call=>call==='create').length,1);await unchanged(f);redacted(result);
});
test('post-create privacy/configuration verification failure never commits a server key',async t=>{
 const f=await fixture(t),d=driver({absent:true,afterBucket:bucket({public:true})});const result=await provisionIntegrationStorage(input,{...f,createClient:d.createClient});
 assert.equal(result.error,'STORAGE_BUCKET_PUBLIC');assert.equal(result.creation.state,'acknowledged');assert.equal(result.recoveryRequired,true);assert.equal(result.profileCommit,'not_attempted');await unchanged(f);redacted(result);
});
test('profile edits during remote inspection prevent commit and preserve the external change',async t=>{
 const f=await fixture(t);let changed;const d=driver({onRead:async()=>{changed=f.initial+'USER_CHANGE=preserve\n';await writeFile(f.profilePath,changed);return{data:bucket(),error:null};}});
 const result=await provisionIntegrationStorage(input,{...f,createClient:d.createClient});assert.equal(result.error,'PRIVATE_PROFILE_CHANGED');assert.equal(result.verified,false);assert.equal(result.profileCommit,'not_attempted');assert.equal(await readFile(f.profilePath,'utf8'),changed);redacted(result);
});
test('failed commit stays uncertain with recovery metadata and never produces verified output',async t=>{
 const f=await fixture(t),d=driver();const result=await provisionIntegrationStorage(input,{...f,createClient:d.createClient,commitStorage:()=>{throw Error(adminKey);}});
 assert.equal(result.verified,false);assert.equal(result.storageVerified,false);assert.equal(result.keySavedServerOnly,false);assert.equal(result.profileCommit,'unknown');assert.equal(result.recoveryRequired,true);assert.equal((await journal(f)).at(-1).kind,'stopped');await unchanged(f);redacted(result);
});
test('official SDK exercises only pinned bucket GET/POST with private50MiB options and bounded transport',async t=>{
 const f=await fixture(t),calls=[];let exists=false;
 const fetcher=async(input,options)=>{
  const url=new URL(input);assert.equal(url.origin,APPROVED_STORAGE_URL);assert.equal(options.redirect,'error');assert.equal(options.cache,'no-store');assert.ok(options.signal instanceof AbortSignal);assert.equal(new Headers(options.headers).get('apikey'),adminKey);calls.push([options.method,url.pathname]);
  if(options.method==='POST'){
   const entries=await journal(f);assert.equal(entries.at(-1).kind,'create_pending');const body=JSON.parse(options.body);assert.deepEqual(body,{id:INTEGRATION_STORAGE_BUCKET,name:INTEGRATION_STORAGE_BUCKET,public:false,file_size_limit:INTEGRATION_STORAGE_LIMIT});exists=true;return Response.json({name:INTEGRATION_STORAGE_BUCKET});
  }
  return exists?Response.json(bucket()):Response.json({statusCode:'404',error:'not_found',message:'Missing fixture bucket'},{status:404});
 };
 const result=await provisionIntegrationStorage(input,{...f,createClient:officialClient,fetcher});assert.equal(result.verified,true,JSON.stringify(result));assert.equal(result.networkRequestsAttempted,3);assert.deepEqual(calls.map(([method])=>method),['GET','POST','GET']);redacted(result);
});
test('transport denies internal URLs, wrong buckets, object access and public create before underlying fetch',async t=>{
 const f=await fixture(t),checks=[];let transport=0;
 const d=driver({constructorHook:options=>{
  for(const[url,init]of [['http://127.0.0.1/private',{}],[APPROVED_STORAGE_URL+'/storage/v1/bucket/other',{}],[APPROVED_STORAGE_URL+'/storage/v1/object/'+INTEGRATION_STORAGE_BUCKET+'/x',{}],[APPROVED_STORAGE_URL+'/storage/v1/bucket/'+INTEGRATION_STORAGE_BUCKET,{method:'DELETE'}],[APPROVED_STORAGE_URL+'/storage/v1/bucket',{method:'POST',body:JSON.stringify({id:INTEGRATION_STORAGE_BUCKET,name:INTEGRATION_STORAGE_BUCKET,public:true,file_size_limit:INTEGRATION_STORAGE_LIMIT})}]]){
   checks.push(options.global.fetch(url,init).then(()=>({allowed:true}),error=>({code:error.code})));
  }
 }});
 const result=await provisionIntegrationStorage(input,{...f,createClient:d.createClient,fetcher:()=>{transport++;throw Error();}});assert.equal(result.verified,true);assert.equal(transport,0);for(const value of await Promise.all(checks))assert.equal(value.code,'STORAGE_REQUEST_TARGET_REJECTED');redacted(result);
});
test('oversized SDK response or inspection authorization failure never creates a bucket or saves key',async t=>{
 for(const fetcher of [async()=>Response.json({oversized:'x'.repeat(70000)}),async()=>Response.json({message:adminKey+' fixture-private-token',statusCode:'401'},{status:401})]){
  const f=await fixture(t);const result=await provisionIntegrationStorage(input,{...f,createClient:officialClient,fetcher});assert.equal(result.verified,false);assert.equal(result.profileCommit,'not_attempted');assert.equal(result.networkRequestsAttempted,1);await unchanged(f);await noJournal(f);redacted(result);
 }
});
test('CLI apply consumes only a bounded hidden JSON key pipe and invalid arguments never read it',async t=>{
 const parsed=await readStorageProvisionInput(Readable.from([JSON.stringify({adminKey:' \r\n'+adminKey+'\n '})]));assert.equal(parsed.adminKey,adminKey);
 const tty=Readable.from([JSON.stringify(input)]);tty.isTTY=true;await assert.rejects(readStorageProvisionInput(tty),/ADMIN_KEY_PIPE_REQUIRED/);
 for(const text of ['',JSON.stringify({...input,extra:true}),'x'.repeat(8193)])await assert.rejects(readStorageProvisionInput(Readable.from([text])));
 const f=await fixture(t),d=driver();const result=await runStorageProvisionCli({...f,args:['--apply'],input:Readable.from([JSON.stringify(input)]),createClient:d.createClient});assert.equal(result.exitCode,0);assert.equal(result.result.verified,true);redacted(result);
 const stream=Readable.from((function*(){throw Error('No input allowed');})());const blocked=await runStorageProvisionCli({...f,args:['--apply',adminKey],input:stream});assert.equal(blocked.exitCode,2);assert.equal(blocked.result.error,'STORAGE_PROVISION_ARGUMENT_INVALID');redacted(blocked);
});
