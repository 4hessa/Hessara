import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,lstat,unlink,mkdir} from 'node:fs/promises';
import {resolve,join,relative,isAbsolute} from 'node:path';
import {parseEnv} from 'node:util';
import {Readable} from 'node:stream';
import {randomUUID} from 'node:crypto';
import {createClient as realClient} from '@supabase/supabase-js';
import {provisionIntegrationUsers,runUserProvisionCli,readUserProvisionInput,ACCOUNT_JOURNAL_NAME,APPROVED_AUTH_URL} from '../scripts/provision-integration-users.mjs';
import {APPROVED_PROFILE_PROJECT,VERIFIED_PROFILE_POOLER} from '../scripts/configure-integration-profile.mjs';

const root=resolve('.'),adminKey='sb_secret_'+'k'.repeat(40),input={adminKey};
const fields=['HESSARA_TEST_EMAIL_A','HESSARA_TEST_PASSWORD_A','HESSARA_TEST_EMAIL_B','HESSARA_TEST_PASSWORD_B'];
const base={HESSARA_TEST_PROJECT_REF:APPROVED_PROFILE_PROJECT,NEXT_PUBLIC_SUPABASE_URL:APPROVED_AUTH_URL,NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fixture_key_only',HESSARA_TEST_ISOLATED:'true',HESSARA_INTEGRATION_TEST:'true',HESSARA_TEST_URL:'http://127.0.0.1:5174',HESSARA_SITE_URL:'http://127.0.0.1:5174',HESSARA_ENCRYPTION_KEY:Buffer.alloc(32,17).toString('base64'),HESSARA_TEST_ATTESTATION_KEY:'safe-fixture-only-attestation-key-'.repeat(2),DATABASE_URL:`postgresql://hessara_runtime.${APPROVED_PROFILE_PROJECT}:fixture-database-password-not-real@${VERIFIED_PROFILE_POOLER}:6543/postgres`,POSTGRES_URL:'',...Object.fromEntries(fields.map(key=>[key,''])),OTHER_SETTING:'preserve this fixture'};
const content=values=>Object.entries(values).map(([key,value])=>`${key}='${value}'`).join('\n')+'\n';
async function fixture(t,updates={}){
 const folder=await mkdtemp(join(root,'.integration-user-provision-test-'));
 t.after(async()=>{const exact=resolve(folder),inside=relative(root,exact);assert.ok(inside&&!inside.startsWith('..')&&!isAbsolute(inside));await rm(exact,{recursive:true,force:true});});
 const profilePath=join(folder,'.env.integration.local'),initial=content({...base,...updates});await writeFile(profilePath,initial,{mode:0o600});return{folder,profilePath,initial,environment:{}};
}
const user=(email,id=randomUUID())=>({id,email,email_confirmed_at:'2026-10-27T00:00:00.000Z',role:'authenticated',is_anonymous:false});
async function journal(f){return(await readFile(join(f.folder,ACCOUNT_JOURNAL_NAME),'utf8')).trim().split('\n').map(line=>JSON.parse(line));}
function driver({onCreate,onSignIn,onGetUser,onSignOut,constructorHook}={}){
 const clients=[],created=[],calls=[];let index=0;
 function createClient(url,key,options){
  assert.equal(url,APPROVED_AUTH_URL);assert.equal(options.auth.persistSession,false);assert.equal(options.auth.autoRefreshToken,false);assert.equal(options.auth.detectSessionInUrl,false);
  constructorHook?.(url,key,options);clients.push({key,options});
  if(key===adminKey)return{auth:{admin:{async createUser(value){calls.push('create');assert.deepEqual(Object.keys(value).sort(),['email','email_confirm','password']);assert.equal(value.email_confirm,true);assert.match(value.email,/^hessara-e2e-[a-f0-9]{32}-[ab]@example\.test$/);assert.ok(value.password.length>=32);const actual=user(value.email);created.push({...value,user:actual});return onCreate?onCreate(value,actual,index++):{data:{user:actual},error:null};}}}};
  assert.equal(key,base.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);let current;
  return{auth:{async signInWithPassword(value){calls.push('signin');current=created.find(row=>row.email===value.email);assert.ok(current);assert.equal(value.password,current.password);if(onSignIn)return onSignIn(value,current.user);return{data:{user:current.user,session:{user:current.user,access_token:'fixture-access-private',refresh_token:'fixture-refresh-private'}},error:null};},async getUser(){calls.push('getuser');return onGetUser?onGetUser(current.user):{data:{user:current.user},error:null};},async signOut(value){calls.push('signout');assert.deepEqual(value,{scope:'local'});return onSignOut?onSignOut(current?.user):{error:null};}}};
 }
 return{createClient,clients,created,calls};
}
function redacted(result,d){const text=JSON.stringify(result);for(const secret of [adminKey,base.DATABASE_URL,base.HESSARA_ENCRYPTION_KEY,'fixture-access-private','fixture-refresh-private',...d.created.flatMap(row=>[row.email,row.password])])assert.ok(!text.includes(secret),'Public result must contain no private value');}

test('default and explicit checks are offline, do not consume stdin, construct clients or create a journal',async t=>{
 const f=await fixture(t);let constructions=0;const stream=Readable.from((function*(){throw Error('Input must not be read');})());
 const checked=await runUserProvisionCli({...f,args:[],input:stream,createClient:()=>{constructions++;throw Error();}});
 assert.equal(checked.exitCode,0);assert.equal(checked.result.status,'ready_for_explicit_apply');assert.equal(checked.result.verified,false);assert.equal(checked.result.networkAttempted,false);assert.equal(constructions,0);
 assert.equal(await readFile(f.profilePath,'utf8'),f.initial);await assert.rejects(lstat(join(f.folder,ACCOUNT_JOURNAL_NAME)));
});
test('complete provision creates2dedicatedconfirmed accounts, verifies real identity boundaries, signsout locally and then commits4fields',async t=>{
 const f=await fixture(t),d=driver();
 const result=await provisionIntegrationUsers(input,{...f,createClient:d.createClient});
 assert.equal(result.status,'verified');assert.equal(result.verified,true);assert.equal(result.profileCommit,'committed');assert.equal(result.authOperationsAttempted,8);assert.equal(result.networkRequestsAttempted,0);
 assert.deepEqual(d.calls,['create','signin','getuser','signout','create','signin','getuser','signout']);assert.equal(d.clients.length,3);assert.equal(new Set(d.created.map(row=>row.email)).size,2);assert.equal(new Set(d.created.map(row=>row.password)).size,2);redacted(result,d);
 const saved=parseEnv(await readFile(f.profilePath,'utf8'));assert.equal(saved.DATABASE_URL,base.DATABASE_URL);assert.equal(saved.OTHER_SETTING,base.OTHER_SETTING);assert.equal(saved.HESSARA_TEST_EMAIL_A,d.created[0].email);assert.equal(saved.HESSARA_TEST_PASSWORD_B,d.created[1].password);
 assert.equal(await readFile(join(f.folder,'.env.integration.accounts.backup.local'),'utf8'),f.initial);
 const entries=await journal(f);assert.equal(entries[0].kind,'prepared');assert.equal(entries[0].accounts.length,2);assert.equal(entries.at(-1).kind,'complete');assert.equal(entries.filter(row=>row.kind==='create_pending').length,2);assert.equal(entries.filter(row=>row.kind==='identity_verified').length,2);
 const privateText=JSON.stringify(entries);assert.ok(!privateText.includes(adminKey));assert.ok(!privateText.includes('fixture-access-private'));assert.ok(!privateText.includes('fixture-refresh-private'));
});
test('profile guards reject production, missingDB, prioraccounts, unsafe paths and insecure profile links before any client or file write',async t=>{
 for(const updates of [{HESSARA_TEST_PROJECT_REF:'waaaxdjymuauknbcxskn'},{NEXT_PUBLIC_SUPABASE_URL:'https://waaaxdjymuauknbcxskn.supabase.co'},{DATABASE_URL:''},{DATABASE_URL:base.DATABASE_URL.replace(VERIFIED_PROFILE_POOLER,'production.invalid')},{HESSARA_TEST_EMAIL_A:'prior@example.test'},{NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'secret-key-must-not-be-public'},{VERCEL:'1'}]){
  const f=await fixture(t,updates);const d=driver();const result=await provisionIntegrationUsers(input,{...f,createClient:d.createClient});assert.equal(result.verified,false);assert.equal(result.networkAttempted,false);assert.equal(d.clients.length,0);assert.equal(await readFile(f.profilePath,'utf8'),f.initial);await assert.rejects(lstat(join(f.folder,ACCOUNT_JOURNAL_NAME)));redacted(result,d);
 }
 const f=await fixture(t),d=driver();let result=await provisionIntegrationUsers(input,{...f,profilePath:resolve('..','.env.integration.local'),createClient:d.createClient});assert.equal(result.error,'PRIVATE_PROFILE_PATH_INVALID');
 await unlink(f.profilePath);await mkdir(f.profilePath);result=await provisionIntegrationUsers(input,{...f,createClient:d.createClient});assert.equal(result.error,'PRIVATE_PROFILE_UNSAFE');assert.equal(d.clients.length,0);
});
test('existing private journal blocks retry and never recreates or overwrites a possibly-created account',async t=>{
 const f=await fixture(t),d=driver();const old='prior private journal and credentials';await writeFile(join(f.folder,ACCOUNT_JOURNAL_NAME),old);
 const result=await provisionIntegrationUsers(input,{...f,createClient:d.createClient});assert.equal(result.error,'ACCOUNT_JOURNAL_ALREADY_EXISTS');assert.equal(result.verified,false);assert.equal(d.clients.length,0);assert.equal(await readFile(join(f.folder,ACCOUNT_JOURNAL_NAME),'utf8'),old);assert.equal(await readFile(f.profilePath,'utf8'),f.initial);
});
test('invalidadmin/public/wrongproject credentials and extra fields are rejected without any SDK calls',async t=>{
 const f=await fixture(t),d=driver();const jwt=claims=>['e30',Buffer.from(JSON.stringify(claims)).toString('base64url'),'fixture'].join('.');
  const cases=[
  [null,'ADMIN_KEY_INPUT_INVALID'],[{},'ADMIN_KEY_INPUT_INVALID'],[[],'ADMIN_KEY_INPUT_INVALID'],
  [{adminKey:'sb_publishable_not_an_admin_key'},'ADMIN_KEY_PUBLIC_NOT_ALLOWED'],
  [{adminKey:'short'},'ADMIN_KEY_FORMAT_INVALID'],
  [{adminKey:jwt({role:'service_role',ref:'waaaxdjymuauknbcxskn'})},'ADMIN_KEY_PROJECT_MISMATCH'],
  [{adminKey:jwt({role:'anon',ref:APPROVED_PROFILE_PROJECT})},'ADMIN_KEY_PUBLIC_NOT_ALLOWED'],
  [{adminKey:jwt({role:'authenticated',ref:APPROVED_PROFILE_PROJECT})},'ADMIN_KEY_NOT_ADMINISTRATIVE'],
  [{...input,extra:'unsafe'},'ADMIN_KEY_INPUT_INVALID'],
  [{adminKey:' \t\r\n '},'ADMIN_KEY_INPUT_REQUIRED'],
  [{adminKey:'sb_secret_************'},'ADMIN_KEY_MASKED_INPUT'],
  [{adminKey:'sb_secret_abcd…wxyz'},'ADMIN_KEY_MASKED_INPUT'],
  [{adminKey:'Bearer '+adminKey},'ADMIN_KEY_WRAPPED_INPUT'],
  [{adminKey:'"'+adminKey+'"'},'ADMIN_KEY_WRAPPED_INPUT'],
  [{adminKey:'sb_secret_inner space-key-not-allowed-123456'},'ADMIN_KEY_FORMAT_INVALID'],
  [{adminKey:adminKey+'\r\ncontinued'},'ADMIN_KEY_FORMAT_INVALID'],
  [{adminKey:adminKey+'\u200b'},'ADMIN_KEY_FORMAT_INVALID'],
  [{adminKey:'x'.repeat(4097)},'ADMIN_KEY_INPUT_TOO_LARGE'],
 ];
 for(const[payload,expected]of cases){const result=await provisionIntegrationUsers(payload,{...f,createClient:d.createClient});assert.equal(result.error,expected);assert.equal(result.networkAttempted,false);redacted(result,d);}
 assert.equal(d.clients.length,0);await assert.rejects(lstat(join(f.folder,ACCOUNT_JOURNAL_NAME)));
});
test('ambiguous first creation retainsdurablecredentials/pendingstate and never writes profile, retries or deletes',async t=>{
 const f=await fixture(t);const d=driver({onCreate:()=>{throw Error('private '+adminKey);}});
 const result=await provisionIntegrationUsers(input,{...f,createClient:d.createClient});assert.equal(result.status,'failed');assert.equal(result.error,'AUTH_CREATE_UNCERTAIN');assert.equal(result.accountStates[0].create,'unknown');assert.equal(result.createdUserIds.length,0);assert.deepEqual(d.calls,['create']);redacted(result,d);
 assert.equal(await readFile(f.profilePath,'utf8'),f.initial);const entries=await journal(f);assert.equal(entries[0].accounts.length,2);assert.equal(entries[1].kind,'create_pending');assert.equal(entries.at(-1).kind,'stopped');
 const again=await provisionIntegrationUsers(input,{...f,createClient:d.createClient});assert.equal(again.error,'ACCOUNT_JOURNAL_ALREADY_EXISTS');assert.deepEqual(d.calls,['create']);
});
test('partialsecondcreation retains firstconfirmedUUID and ambiguous second state without claiming success',async t=>{
 const f=await fixture(t),d=driver({onCreate:(_value,actual,index)=>index===0?{data:{user:actual},error:null}:{data:{user:null},error:{message:'private '+adminKey}}});
 const result=await provisionIntegrationUsers(input,{...f,createClient:d.createClient});assert.equal(result.verified,false);assert.equal(result.createdUserIds.length,1);assert.equal(result.accountStates[0].verification,'verified');assert.equal(result.accountStates[0].signOut,'signed_out');assert.equal(result.accountStates[1].create,'unknown');assert.equal(result.profileCommit,'not_attempted');assert.equal(await readFile(f.profilePath,'utf8'),f.initial);redacted(result,d);
 const entries=await journal(f);assert.equal(entries.filter(entry=>entry.kind==='created').length,1);assert.equal(entries.filter(entry=>entry.kind==='create_pending').length,2);
});
test('unconfirmed/wrongemail/invalidUUID admin responses cannot pass identity verification',async t=>{
 for(const change of [{email_confirmed_at:null},{email:'different@example.test'},{id:'invalid'},{role:'service_role'},{is_anonymous:true}]){
  const f=await fixture(t),d=driver({onCreate:(_value,actual)=>({data:{user:{...actual,...change}},error:null})});const result=await provisionIntegrationUsers(input,{...f,createClient:d.createClient});assert.equal(result.error,'AUTH_CREATE_UNCERTAIN');assert.equal(result.verified,false);assert.deepEqual(d.calls,['create']);assert.equal(await readFile(f.profilePath,'utf8'),f.initial);redacted(result,d);
 }
});
test('signin/getUser/cleanup failures never commit and still attempt local signout after signin dispatch',async t=>{
 for(const hooks of [{onSignIn:()=>({data:{user:null,session:null},error:{message:'private '+adminKey}})},{onGetUser:actual=>({data:{user:{...actual,id:randomUUID()}},error:null})},{onSignOut:()=>({error:{message:'private '+adminKey}})}]){
  const f=await fixture(t),d=driver(hooks);const result=await provisionIntegrationUsers(input,{...f,createClient:d.createClient});assert.equal(result.verified,false);assert.equal(result.createdUserIds.length,1);assert.equal(result.profileCommit,'not_attempted');assert.equal(d.calls.at(-1),'signout');assert.equal(await readFile(f.profilePath,'utf8'),f.initial);redacted(result,d);assert.equal((await journal(f)).at(-1).kind,'stopped');
 }
});
test('profilechanges during remote work stop furthercreation and preserve the external edit',async t=>{
 const f=await fixture(t);let changed;
 const d=driver({onSignOut:async()=>{changed=f.initial+'USER_EDIT=preserved\n';await writeFile(f.profilePath,changed);return{error:null};}});
 const result=await provisionIntegrationUsers(input,{...f,createClient:d.createClient});assert.equal(result.error,'PRIVATE_PROFILE_CHANGED');assert.equal(result.verified,false);assert.equal(result.createdUserIds.length,1);assert.equal(await readFile(f.profilePath,'utf8'),changed);redacted(result,d);
});
test('a boundedambiguous creation timeout is journaled and cannot become automatic retries',async t=>{
 const f=await fixture(t),d=driver({onCreate:()=>new Promise(()=>{})});const result=await provisionIntegrationUsers(input,{...f,createClient:d.createClient,operationTimeoutMs:5});assert.equal(result.error,'AUTH_CREATE_UNCERTAIN');assert.equal(result.authOperationsAttempted,1);assert.equal(result.verified,false);assert.equal(result.journalState,'present');assert.equal((await journal(f)).at(-1).kind,'stopped');assert.equal(await readFile(f.profilePath,'utf8'),f.initial);
});
test('officialSDK is exercised with fixedapprovedfetch routes, separatepublishable logins and no real network',async t=>{
 const f=await fixture(t),users=new Map(),operations=[];let current;
 const jwt=claims=>[Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url'),Buffer.from(JSON.stringify(claims)).toString('base64url'),Buffer.from('fixture-not-a-signature').toString('base64url')].join('.');
 const fetcher=async(url,options)=>{
  const target=new URL(url);assert.equal(target.origin,APPROVED_AUTH_URL);assert.equal(options.redirect,'error');assert.ok(options.signal instanceof AbortSignal);operations.push([options.method,target.pathname,target.search]);
  const headers=new Headers(options.headers);
  if(target.pathname==='/auth/v1/admin/users'){assert.equal(headers.get('apikey'),adminKey);const payload=JSON.parse(options.body);assert.deepEqual(Object.keys(payload).sort(),['email','email_confirm','password']);const actual=user(payload.email);users.set(payload.email,{...payload,user:actual});return Response.json(actual);}
  assert.equal(headers.get('apikey'),base.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
  if(target.pathname==='/auth/v1/token'){const payload=JSON.parse(options.body);current=users.get(payload.email);assert.equal(payload.password,current.password);const exp=Math.floor(Date.now()/1000)+3600;return Response.json({access_token:jwt({sub:current.user.id,exp,role:'authenticated'}),refresh_token:'fixture-refresh-secret',token_type:'bearer',expires_in:3600,expires_at:exp,user:current.user});}
  if(target.pathname==='/auth/v1/user')return Response.json(current.user);
  assert.equal(target.pathname,'/auth/v1/logout');assert.equal(target.search,'?scope=local');return new Response(null,{status:204});
 };
 const result=await provisionIntegrationUsers(input,{...f,createClient:realClient,fetcher});assert.equal(result.verified,true);assert.equal(result.networkRequestsAttempted,8);assert.equal(operations.length,8);assert.equal(users.size,2);assert.equal(result.authOperationsAttempted,8);
 const privateText=JSON.stringify(await journal(f));assert.ok(!privateText.includes('fixture-refresh-secret'));assert.ok(!privateText.includes(adminKey));
});
test('fixedfetch guard rejects redirect/private/extraAuth routes before underlying transport',async t=>{
 const f=await fixture(t);let transport=0;
 const guarded=[];const d=driver({constructorHook:(_url,key,options)=>{if(key===adminKey)guarded.push(options.global.fetch('http://127.0.0.1/private',{method:'GET'}).then(()=>({allowed:true}),error=>({code:error.message})));}});
 const result=await provisionIntegrationUsers(input,{...f,createClient:d.createClient,fetcher:async()=>{transport++;throw Error('Must never fetch');}});assert.equal(result.verified,true);assert.equal(transport,0);assert.equal(result.networkRequestsAttempted,0);for(const check of await Promise.all(guarded))assert.equal(check.code,'AUTH_REQUEST_TARGET_REJECTED');
});
test('CLI accepts only a bounded nonTTY JSON key pipe and defaults to offline guards',async t=>{
 const payload=await readUserProvisionInput(Readable.from([JSON.stringify(input)]));assert.equal(payload.adminKey,adminKey);
 for(const value of ['',JSON.stringify({...input,extra:true}),'{bad}',Buffer.from([255]),'x'.repeat(8193)])await assert.rejects(readUserProvisionInput(Readable.from([value])));
 const tty=Readable.from([JSON.stringify(input)]);tty.isTTY=true;await assert.rejects(readUserProvisionInput(tty),/ADMIN_KEY_PIPE_REQUIRED/);
 const pending=new Readable({read(){}});await assert.rejects(readUserProvisionInput(pending,{timeoutMs:5}),/ADMIN_KEY_INPUT_TIMED_OUT/);
 const f=await fixture(t),d=driver();let result=await runUserProvisionCli({...f,args:['--apply'],input:Readable.from([JSON.stringify(input)]),createClient:d.createClient});assert.equal(result.exitCode,0);assert.equal(result.result.verified,true);redacted(result,d);
 result=await runUserProvisionCli({...f,args:['--apply',adminKey],input:Readable.from([]),createClient:d.createClient});assert.equal(result.exitCode,2);assert.equal(result.result.error,'AUTH_PROVISION_ARGUMENT_INVALID');redacted(result,d);
});

test('the complete private journal and pending marker are synced before each actual create dispatch',async t=>{
 const f=await fixture(t);let checked=0;
 const d=driver({onCreate:async(value,actual)=>{const entries=await journal(f);assert.equal(entries[0].kind,'prepared');assert.equal(entries[0].accounts.length,2);assert.equal(entries.at(-1).kind,'create_pending');const own=entries[0].accounts.find(account=>account.email===value.email);assert.ok(own&&own.password===value.password);checked++;return{data:{user:actual},error:null};}});
 const result=await provisionIntegrationUsers(input,{...f,createClient:d.createClient});assert.equal(result.verified,true);assert.equal(checked,2);
});
test('an existing accounts backup blocks before remote mutations instead of discovering the conflict at commit',async t=>{
 const f=await fixture(t),d=driver();const backup=join(f.folder,'.env.integration.accounts.backup.local');await writeFile(backup,'prior private backup');
 const result=await provisionIntegrationUsers(input,{...f,createClient:d.createClient});assert.equal(result.error,'PRIVATE_BACKUP_ALREADY_EXISTS');assert.equal(result.networkAttempted,false);assert.equal(d.clients.length,0);assert.equal(await readFile(backup,'utf8'),'prior private backup');assert.equal(await readFile(f.profilePath,'utf8'),f.initial);
});
test('failed profile commit stays explicitly uncertain with verified accounts retained for recovery',async t=>{
 const f=await fixture(t),d=driver();const result=await provisionIntegrationUsers(input,{...f,createClient:d.createClient,commitAccounts:async()=>{throw Error('private '+adminKey);}});
 assert.equal(result.verified,false);assert.equal(result.profileCommit,'unknown');assert.equal(result.createdUserIds.length,2);assert.equal(result.accountStates.every(account=>account.verification==='verified'&&account.signOut==='signed_out'),true);assert.equal(result.error,'AUTH_PROVISION_FAILED');assert.equal(await readFile(f.profilePath,'utf8'),f.initial);assert.equal((await journal(f)).at(-1).kind,'stopped');redacted(result,d);
});

test('a returned matching UUID is retained for manual recovery when email confirmation is missing',async t=>{
 const f=await fixture(t);let expected;
 const d=driver({onCreate:(_value,actual)=>{expected=actual.id;return{data:{user:{...actual,email_confirmed_at:null}},error:null};}});
 const result=await provisionIntegrationUsers(input,{...f,createClient:d.createClient});assert.equal(result.verified,false);assert.equal(result.error,'AUTH_CREATE_UNCERTAIN');assert.deepEqual(result.createdUserIds,[expected]);assert.equal(result.accountStates[0].create,'unknown');
 const entries=await journal(f);assert.ok(entries.some(entry=>entry.kind==='create_observed'&&entry.id===expected));assert.equal(entries.some(entry=>entry.kind==='created'),false);assert.equal(await readFile(f.profilePath,'utf8'),f.initial);redacted(result,d);
});

// Clipboard-boundary whitespace must not turn a valid copy into a generic error.
test('key input trims boundary whitespace for modern and approved legacy keys without changing internal characters',async()=>{
 const legacy=['e30',Buffer.from(JSON.stringify({role:'service_role',ref:APPROVED_PROFILE_PROJECT})).toString('base64url'),'fixture'].join('.');
 for(const key of [adminKey,legacy])for(const edges of [[' ', ' '],['\r\n','\r\n'],['\ufeff\t','\n ']]){
  const parsed=await readUserProvisionInput(Readable.from([JSON.stringify({adminKey:edges[0]+key+edges[1]})]));assert.equal(parsed.adminKey,key);
 }
 for(const value of [adminKey+'\r\nsecond-line',adminKey+'\u200b'])await assert.rejects(readUserProvisionInput(Readable.from([JSON.stringify({adminKey:value})])),/ADMIN_KEY_FORMAT_INVALID/);
});

test('clipboard formatting reaches the SDK as the canonical key and never enters journal or results',async t=>{
 const f=await fixture(t),d=driver();const result=await provisionIntegrationUsers({adminKey:' \r\n'+adminKey+'\r\n '},{...f,createClient:d.createClient});
 assert.equal(result.verified,true,JSON.stringify(result));redacted(result,d);
 assert.ok(!JSON.stringify(await journal(f)).includes(adminKey));
});
