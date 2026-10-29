import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,copyFile,access,link,symlink,unlink,rm} from 'node:fs/promises';
import {resolve,join,sep} from 'node:path';
import {tmpdir} from 'node:os';
import {parseEnv} from 'node:util';
import {spawnSync} from 'node:child_process';
import {configureIntegrationStorageKey,APPROVED_PROFILE_PROJECT,VERIFIED_PROFILE_POOLER} from '../scripts/configure-integration-profile.mjs';

const root=resolve('.vercel'),backupName='.env.integration.storage.backup.local';
const key='sb_secret_storage-fixture-not-a-real-key-123456789';
const base={HESSARA_TEST_PROJECT_REF:APPROVED_PROFILE_PROJECT,NEXT_PUBLIC_SUPABASE_URL:`https://${APPROVED_PROFILE_PROJECT}.supabase.co`,NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fixture_only',HESSARA_TEST_ISOLATED:'true',HESSARA_INTEGRATION_TEST:'true',HESSARA_TEST_URL:'http://127.0.0.1:5174',HESSARA_SITE_URL:'http://127.0.0.1:5174',HESSARA_ENCRYPTION_KEY:Buffer.alloc(32,17).toString('base64'),HESSARA_TEST_ATTESTATION_KEY:'private-storage-fixture-attestation-1234567890',DATABASE_URL:`postgresql://hessara_runtime.${APPROVED_PROFILE_PROJECT}:Fixture-runtime-password-123@${VERIFIED_PROFILE_POOLER}:6543/postgres`,POSTGRES_URL:'',DATABASE_SSL_CA:'fixture-public-CA-unchanged',HESSARA_TEST_EMAIL_A:'storage-a@example.test',HESSARA_TEST_PASSWORD_A:'Fixture password A 123!',HESSARA_TEST_EMAIL_B:'storage-b@example.test',HESSARA_TEST_PASSWORD_B:'Fixture password B 456!',SUPABASE_AUTH_SECRET_KEY:'',OTHER_SETTING:'preserve-this-setting',MULTILINE:'first\nsecond',LITERAL_SLASH:'literal\\n\\r'};
const content=values=>Object.entries(values).map(([name,value])=>`${name}='${value}'`).join('\n')+'\n';
async function fixture(t,updates={}){const folder=await mkdtemp(join(root,'storage-profile-'));t.after(async()=>{assert.ok(resolve(folder).startsWith(root+sep));await rm(folder,{recursive:true,force:true});});const profilePath=join(folder,'.env.integration.local'),original=content({...base,...updates});await writeFile(profilePath,original,{mode:0o600});return{folder,profilePath,original};}
async function unchanged(f){assert.equal(await readFile(f.profilePath,'utf8'),f.original);await assert.rejects(access(join(f.folder,backupName)));}
function redacted(value){const text=JSON.stringify(value);for(const secret of [key,base.DATABASE_URL,base.HESSARA_ENCRYPTION_KEY,base.HESSARA_TEST_ATTESTATION_KEY,base.HESSARA_TEST_PASSWORD_A,base.HESSARA_TEST_PASSWORD_B])assert.ok(!text.includes(secret),'Only allowlisted readiness metadata may be returned');}
const token=claims=>[Buffer.from('{"alg":"HS256"}').toString('base64url'),Buffer.from(JSON.stringify(claims)).toString('base64url'),'fixtureSignatureOnly'].join('.');

test('Storage configuration stores one canonical server-only key, preserves all fields and keeps verification false without network',async t=>{
 const f=await fixture(t),previousFetch=globalThis.fetch;let requests=0;
 globalThis.fetch=async()=>{requests++;throw Error('No network allowed');};
 try{
  const result=await configureIntegrationStorageKey({adminKey:' \r\n'+key+'\r\n '},{profilePath:f.profilePath,environment:{}});
  assert.deepEqual(result,{status:'configured',configured:true,storageKeyConfigured:true,configurationOnly:true,verified:false,networkTested:false,changedFields:['SUPABASE_AUTH_SECRET_KEY'],backup:backupName});redacted(result);assert.equal(requests,0);
  const saved=parseEnv(await readFile(f.profilePath,'utf8'));assert.equal(saved.SUPABASE_AUTH_SECRET_KEY,key);
  for(const[name,value]of Object.entries(base))if(name!=='SUPABASE_AUTH_SECRET_KEY')assert.equal(saved[name],value,name);
  assert.equal(Object.keys(saved).length,Object.keys(base).length);assert.ok(!Object.entries(saved).some(([name,value])=>name.startsWith('NEXT_PUBLIC_')&&value===key));
  assert.equal(await readFile(join(f.folder,backupName),'utf8'),f.original);
 }finally{globalThis.fetch=previousFetch;}
});

test('Storage configuration accepts only supported administrative key input and rejects wrong-project/public/masked/wrapped values without writes',async t=>{
 const candidates=[null,[],{}, {adminKey:key,extra:true},{adminKey:''},{adminKey:'sb_publishable_fixture_public_only'}, {adminKey:'sb_secret_fixture…masked'},{adminKey:'Bearer '+key},{adminKey:'"'+key+'"'}, {adminKey:key+'\nwrapped'}, {adminKey:token({role:'anon',ref:APPROVED_PROFILE_PROJECT})},{adminKey:token({role:'authenticated',ref:APPROVED_PROFILE_PROJECT})},{adminKey:token({role:'service_role',ref:'waaaxdjymuauknbcxskn'})},{adminKey:'x'.repeat(4097)}];
 for(const input of candidates){const f=await fixture(t);await assert.rejects(configureIntegrationStorageKey(input,{profilePath:f.profilePath,environment:{}}),error=>typeof error.code==='string'&&/^(ADMIN_KEY_|CONFIGURATION_)/.test(error.code));await unchanged(f);}
 const f=await fixture(t),legacy=token({role:'service_role',ref:APPROVED_PROFILE_PROJECT});
 const result=await configureIntegrationStorageKey({adminKey:legacy},{profilePath:f.profilePath,environment:{}});assert.equal(result.verified,false);assert.equal(parseEnv(await readFile(f.profilePath,'utf8')).SUPABASE_AUTH_SECRET_KEY,legacy);
});

test('Storage configuration refuses rotation, existing backup, missing Auth accounts and unapproved profile or database targets',async t=>{
 for(const updates of [
  {SUPABASE_AUTH_SECRET_KEY:'existing-private-fixture-key'}, {SUPABASE_AUTH_SECRET_KEY:'   '},
  {HESSARA_TEST_EMAIL_A:''},{HESSARA_TEST_PASSWORD_B:''},{HESSARA_TEST_EMAIL_B:base.HESSARA_TEST_EMAIL_A},{HESSARA_TEST_PASSWORD_A:'short'},
  {DATABASE_URL:''},{DATABASE_URL:base.DATABASE_URL.replace(VERIFIED_PROFILE_POOLER,'unapproved.example.test')},{DATABASE_URL:base.DATABASE_URL+'?sslmode=disable'},
  {POSTGRES_URL:'postgresql://forbidden.example.test/postgres'}, {HESSARA_TEST_PROJECT_REF:'waaaxdjymuauknbcxskn'}, {NEXT_PUBLIC_SUPABASE_URL:'https://waaaxdjymuauknbcxskn.supabase.co'},
  {HESSARA_TEST_ISOLATED:'false'}, {HESSARA_INTEGRATION_TEST:'false'},{HESSARA_SITE_URL:'https://production.example.test'},{VERCEL:'1'},
 ]){const f=await fixture(t,updates);await assert.rejects(configureIntegrationStorageKey({adminKey:key},{profilePath:f.profilePath,environment:{}}),error=>/^(PROFILE_|LOCAL_)/.test(error.code));await unchanged(f);}
 const f=await fixture(t);await writeFile(join(f.folder,backupName),'earlier-storage-fixture-backup');
 await assert.rejects(configureIntegrationStorageKey({adminKey:key},{profilePath:f.profilePath,environment:{}}),/PRIVATE_BACKUP_ALREADY_EXISTS/);assert.equal(await readFile(f.profilePath,'utf8'),f.original);assert.equal(await readFile(join(f.folder,backupName),'utf8'),'earlier-storage-fixture-backup');
 const deployed=await fixture(t);await assert.rejects(configureIntegrationStorageKey({adminKey:key},{profilePath:deployed.profilePath,environment:{VERCEL:'1'}}),/LOCAL_CONFIGURATION_ONLY/);await unchanged(deployed);
});

test('Storage configuration rejects paths outside the checkout and unexpected profile filenames',async t=>{
 const outside=await mkdtemp(join(tmpdir(),'hessara-storage-outside-'));t.after(async()=>{assert.ok(resolve(outside).startsWith(resolve(tmpdir())+sep));await rm(outside,{recursive:true,force:true});});
 const outsideProfile=join(outside,'.env.integration.local');await writeFile(outsideProfile,content(base));
 await assert.rejects(configureIntegrationStorageKey({adminKey:key},{profilePath:outsideProfile,environment:{}}),/PRIVATE_PROFILE_PATH_INVALID/);assert.equal(await readFile(outsideProfile,'utf8'),content(base));await assert.rejects(access(join(outside,backupName)));
 const f=await fixture(t);await assert.rejects(configureIntegrationStorageKey({adminKey:key},{profilePath:join(f.folder,'wrong-profile.env'),environment:{}}),/PRIVATE_PROFILE_PATH_INVALID/);
});

for(const kind of ['hard','symbolic'])test('Storage configuration rejects '+kind+' linked private profiles',async t=>{
 const f=await fixture(t),linked=join(f.folder,'linked-profile');
 try{
  if(kind==='hard')await link(f.profilePath,linked);
  else{await copyFile(f.profilePath,linked);await unlink(f.profilePath);await symlink(linked,f.profilePath,'file');}
 }catch(error){
  if(['EPERM','EACCES','ENOTSUP'].includes(error.code)){t.skip('Sandbox forbids creating '+kind+' links; runtime checks remain enabled');return;}
  throw error;
 }
 await assert.rejects(configureIntegrationStorageKey({adminKey:key},{profilePath:f.profilePath,environment:{}}),/PRIVATE_PROFILE_UNSAFE/);await unchanged(f);
});

async function wrapperFixture(t){const folder=await mkdtemp(join(root,'storage-wrapper-'));t.after(async()=>{assert.ok(resolve(folder).startsWith(root+sep));await rm(folder,{recursive:true,force:true});});const scripts=join(folder,'scripts');await mkdir(scripts);await copyFile('scripts/configure-integration-profile.ps1',join(scripts,'configure-integration-profile.ps1'));return{folder,scripts};}
const verified={status:'verified',verified:true,storageVerified:true,keySavedServerOnly:true,profileCommit:'committed',projectRef:APPROVED_PROFILE_PROJECT,bucket:{id:'hessara-re-artifacts',public:false,fileSizeLimit:52428800}};
async function runWrapper(f,result,{exitCode=0,input=key,args=['-ConfigureStorage']}={}){
 await writeFile(join(f.scripts,'provision-integration-storage.mjs'),`import{writeFileSync}from'node:fs';let text='';for await(const chunk of process.stdin)text+=chunk;const input=JSON.parse(text);if(Object.keys(input).join(',')!=='adminKey')process.exit(3);writeFileSync('received-fixture.json',JSON.stringify({key:input.adminKey,args:process.argv.slice(2),cwd:process.cwd()}));console.error(input.adminKey);console.log(JSON.stringify({...${JSON.stringify(result)},debugSecret:input.adminKey}));process.exitCode=${exitCode};`);
 const encoded=Buffer.from(input,'utf8').toString('base64');
 await writeFile(join(f.folder,'harness.ps1'),`$script:taskPromptCount=0\nfunction Read-Host {param([string]$Prompt,[switch]$AsSecureString) $script:taskPromptCount++;if(-not $AsSecureString -or $script:taskPromptCount -ne1){throw 'UNSAFE_PROMPT'};if('${encoded}' -eq ''){return [Security.SecureString]::new()};return ConvertTo-SecureString -String ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}'))) -AsPlainText -Force}\n& (Join-Path $PSScriptRoot 'scripts/configure-integration-profile.ps1') ${args.join(' ')}\nexit $LASTEXITCODE`);
 const env={...process.env};delete env.VERCEL;
 return spawnSync('pwsh.exe',['-NoLogo','-NoProfile','-NonInteractive','-File',join(f.folder,'harness.ps1')],{cwd:join(process.env.SystemRoot||'C:/Windows','System32'),env,encoding:'utf8',timeout:30000});
}

test('PowerShell Storage mode sends a single hidden key through stdin and reports only verified private bucket storage',{skip:process.platform!=='win32'},async t=>{
 const f=await wrapperFixture(t),child=await runWrapper(f,verified);
 if(child.error?.code==='ENOENT'){t.skip('PowerShell7 unavailable');return;}
 assert.equal(child.status,0,child.stdout+' '+child.stderr);assert.ok(!child.stdout.includes(key)&&!child.stderr.includes(key));
 assert.match(child.stdout,/WILL be saved server-only/);assert.match(child.stdout,/private test bucket was verified/);assert.ok(!/Both dedicated Auth|runtime identity/.test(child.stdout));
 const receipt=JSON.parse(await readFile(join(f.folder,'received-fixture.json'),'utf8'));assert.equal(receipt.key,key);assert.equal(receipt.cwd,f.folder);assert.deepEqual(receipt.args,['--apply']);
});

test('PowerShell Storage verified status rejects missing, false, string and wrong-target proof flags',{skip:process.platform!=='win32'},async t=>{
 const f=await wrapperFixture(t);
 for(const [result,exitCode]of [
  [{status:'verified',verified:true},0], [{...verified,storageVerified:false},0],[{...verified,storageVerified:'true'},0],[{...verified,verified:'true'},0], [{...verified,keySavedServerOnly:false},0],
  [{...verified,profileCommit:'unknown'},0],[{...verified,projectRef:'waaaxdjymuauknbcxskn'},0], [{...verified,bucket:{...verified.bucket,id:'different-bucket'}},0],
  [{...verified,bucket:{...verified.bucket,public:true}},0],[{...verified,bucket:{...verified.bucket,public:'false'}},0],
  [{...verified,bucket:{...verified.bucket,fileSizeLimit:52428801}},0],[{...verified,bucket:{...verified.bucket,fileSizeLimit:0}},0], [{...verified,bucket:{...verified.bucket,fileSizeLimit:'52428800'}},0],
  [{...verified,status:'configured'},0],[{...verified,status:'failed'},2],[verified,2],
 ]){const child=await runWrapper(f,result,{exitCode});if(child.error?.code==='ENOENT'){t.skip('PowerShell7 unavailable');return;}
  assert.equal(child.status,2,JSON.stringify(result));assert.match(child.stdout,/INTEGRATION_CONFIGURATION_FAILED/);assert.ok(!/private test bucket was verified|Both dedicated Auth|runtime identity/.test(child.stdout));assert.ok(!child.stdout.includes(key)&&!child.stderr.includes(key));}
});

test('PowerShell Storage mode is mutually exclusive with every existing mode and keeps safe key repair hints',{skip:process.platform!=='win32'},async t=>{
 const f=await wrapperFixture(t);
 for(const mode of ['Check','Configure','ConfigureAccounts','ProvisionUsers','ProvisionRuntime']){
  const child=await runWrapper(f,{status:'blocked',verified:false},{exitCode:2,args:['-ConfigureStorage','-'+mode]});if(child.error?.code==='ENOENT'){t.skip('PowerShell7 unavailable');return;}
  assert.equal(child.status,2);assert.match(child.stdout,/INTEGRATION_CONFIGURATION_FAILED/);assert.ok(!child.stdout.includes(key)&&!child.stderr.includes(key));
 }
 for(const error of ['ADMIN_KEY_INPUT_REQUIRED','ADMIN_KEY_PUBLIC_NOT_ALLOWED','ADMIN_KEY_MASKED_INPUT','ADMIN_KEY_WRAPPED_INPUT','ADMIN_KEY_PROJECT_MISMATCH','ADMIN_KEY_NOT_ADMINISTRATIVE','ADMIN_KEY_FORMAT_INVALID','ADMIN_KEY_INPUT_TOO_LARGE']){
  const child=await runWrapper(f,{status:'blocked',verified:false,error},{exitCode:2});assert.equal(child.status,2);assert.match(child.stdout,new RegExp('Reason: '+error));assert.match(child.stdout,/Next step:/);assert.ok(!child.stdout.includes(key)&&!child.stderr.includes(key));
 }
});
