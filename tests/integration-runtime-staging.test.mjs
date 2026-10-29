import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,readdir,lstat,link,symlink,rm,mkdir} from 'node:fs/promises';
import {resolve,join,dirname,sep} from 'node:path';
import {tmpdir} from 'node:os';
import {parseEnv} from 'node:util';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {configureIntegrationDatabase,configureIntegrationAccounts,checkIntegrationDatabase,checkIntegrationProfile,APPROVED_PROFILE_PROJECT,VERIFIED_PROFILE_POOLER} from '../scripts/configure-integration-profile.mjs';
import {checkPreparedIntegrationRuntime,prepareIntegrationRuntime,runPrepareRuntimeCli,RUNTIME_PLAN_FILE} from '../scripts/prepare-integration-runtime.mjs';

const root=resolve('.'),script=fileURLToPath(new URL('../scripts/prepare-integration-runtime.mjs',import.meta.url));
const accounts={emailA:'staged-a@example.test',emailB:'staged-b@example.test',passwordA:'staged-account-a-password-24',passwordB:'staged-account-b-password-24'};
const password='staged-database-password-48-characters-or-more-!@#-0123456789';
const base={HESSARA_TEST_PROJECT_REF:APPROVED_PROFILE_PROJECT,NEXT_PUBLIC_SUPABASE_URL:`https://${APPROVED_PROFILE_PROJECT}.supabase.co`,HESSARA_TEST_ISOLATED:'true',HESSARA_INTEGRATION_TEST:'true',HESSARA_TEST_URL:'http://127.0.0.1:5174',HESSARA_SITE_URL:'http://127.0.0.1:5174',HESSARA_ENCRYPTION_KEY:Buffer.alloc(32,7).toString('base64'),HESSARA_TEST_ATTESTATION_KEY:'fixture-attestation-key-'.repeat(3),NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fixture',DATABASE_URL:'',POSTGRES_URL:'',DATABASE_SSL_CA:'',HESSARA_TEST_EMAIL_A:'',HESSARA_TEST_PASSWORD_A:'',HESSARA_TEST_EMAIL_B:'',HESSARA_TEST_PASSWORD_B:'',OTHER_SETTING:'preserved-fixture',MULTILINE_SETTING:'line one\nline two'};
const serialize=values=>Object.entries(values).map(([key,value])=>`${key}='${value}'`).join('\n')+'\n';
async function fixture(t,changes={}){
 const directory=await mkdtemp(resolve('.integration-runtime-stage-test-'));assert.ok(directory.startsWith(root+sep));
 t.after(async()=>{assert.ok(resolve(directory).startsWith(root+sep));assert.ok(dirname(resolve(directory))===root);await rm(directory,{recursive:true,force:true});});
 const profilePath=join(directory,'.env.integration.local'),content=serialize({...base,...changes});await writeFile(profilePath,content,{mode:0o600});return{directory,profilePath,content};
}
const privateValues=async f=>parseEnv(await readFile(f.profilePath,'utf8'));
function redacted(result,secrets=[]){const text=JSON.stringify(result);for(const secret of [password,...Object.values(accounts),base.HESSARA_ENCRYPTION_KEY,base.HESSARA_TEST_ATTESTATION_KEY,...secrets])assert.ok(!text.includes(secret),'Output reflected a fixture secret');assert.ok(!text.includes('SCRAM-SHA-256$'));}
async function noSidecars(f){assert.deepEqual((await readdir(f.directory)).sort(),['.env.integration.local']);}

test('database-only stage preserves Auth blanks and keys with a distinct exact backup',async t=>{
 const f=await fixture(t);const result=await configureIntegrationDatabase({databasePassword:password},{profilePath:f.profilePath,environment:{}});redacted(result);
 assert.equal(result.configured,false);assert.equal(result.databaseConfigured,true);assert.equal(result.verified,false);assert.deepEqual(result.changedFields,['DATABASE_URL']);
 const values=await privateValues(f),url=new URL(values.DATABASE_URL);assert.equal(url.hostname,VERIFIED_PROFILE_POOLER);assert.equal(url.port,'6543');assert.equal(decodeURIComponent(url.username),'hessara_runtime.'+APPROVED_PROFILE_PROJECT);assert.equal(decodeURIComponent(url.password),password);
 for(const[key,value]of Object.entries(base))if(key!=='DATABASE_URL')assert.equal(values[key],value,key);
 assert.equal(await readFile(join(f.directory,'.env.integration.database.backup.local'),'utf8'),f.content);
 const check=await checkIntegrationDatabase({profilePath:f.profilePath,environment:{}});assert.equal(check.databaseConfigured,true);assert.equal(check.configured,false);assert.equal(check.missingAuthFields.length,4);
 const full=await checkIntegrationProfile({profilePath:f.profilePath,environment:{}});assert.equal(full.configured,false);assert.equal(full.missingFields.length,4);
 const saved=await readFile(f.profilePath,'utf8');await assert.rejects(configureIntegrationDatabase({databasePassword:password},{profilePath:f.profilePath,environment:{}}),/PROFILE_DATABASE_ALREADY_CONFIGURED/);assert.equal(await readFile(f.profilePath,'utf8'),saved);
});

test('account-only stage requires all four values and preserves the configured database',async t=>{
 const f=await fixture(t);await configureIntegrationDatabase({databasePassword:password},{profilePath:f.profilePath,environment:{}});const before=await readFile(f.profilePath,'utf8'),old=await privateValues(f);
 const result=await configureIntegrationAccounts(accounts,{profilePath:f.profilePath,environment:{}});redacted(result);assert.equal(result.configurationOnly,true);assert.equal(result.configured,true);assert.equal(result.verified,false);assert.equal(result.networkTested,false);
 const values=await privateValues(f);assert.equal(values.DATABASE_URL,old.DATABASE_URL);assert.equal(values.HESSARA_TEST_EMAIL_A,accounts.emailA);assert.equal(values.HESSARA_TEST_PASSWORD_B,accounts.passwordB);
 for(const[key,value]of Object.entries(old))if(!['HESSARA_TEST_EMAIL_A','HESSARA_TEST_PASSWORD_A','HESSARA_TEST_EMAIL_B','HESSARA_TEST_PASSWORD_B'].includes(key))assert.equal(values[key],value);
 assert.equal(await readFile(join(f.directory,'.env.integration.accounts.backup.local'),'utf8'),before);
 const saved=await readFile(f.profilePath,'utf8');await assert.rejects(configureIntegrationAccounts(accounts,{profilePath:f.profilePath,environment:{}}),/PROFILE_AUTH_FIELDS_ALREADY_CONFIGURED/);assert.equal(await readFile(f.profilePath,'utf8'),saved);
});

test('staged account validation rejects partial, invalid, duplicate and preexisting values without byte changes',async t=>{
 const f=await fixture(t);await assert.rejects(configureIntegrationAccounts(accounts,{profilePath:f.profilePath,environment:{}}),/PROFILE_DATABASE_REQUIRED/);assert.equal(await readFile(f.profilePath,'utf8'),f.content);
 await configureIntegrationDatabase({databasePassword:password},{profilePath:f.profilePath,environment:{}});const before=await readFile(f.profilePath,'utf8');
 for(const input of [{emailA:accounts.emailA},{...accounts,passwordA:'short'},{...accounts,emailB:accounts.emailA.toUpperCase()},{...accounts,emailA:'invalid'},{...accounts,extra:password}]){await assert.rejects(configureIntegrationAccounts(input,{profilePath:f.profilePath,environment:{}}));assert.equal(await readFile(f.profilePath,'utf8'),before);}
 for(const name of ['HESSARA_TEST_EMAIL_A','HESSARA_TEST_PASSWORD_A','HESSARA_TEST_EMAIL_B','HESSARA_TEST_PASSWORD_B']){
  const values={...await privateValues(f),[name]:'existing-fixture'};const modified=serialize(values);await writeFile(f.profilePath,modified);await assert.rejects(configureIntegrationAccounts(accounts,{profilePath:f.profilePath,environment:{}}),/PROFILE_AUTH_FIELDS_ALREADY_CONFIGURED/);assert.equal(await readFile(f.profilePath,'utf8'),modified);await writeFile(f.profilePath,before);
 }
 await assert.rejects(lstat(join(f.directory,'.env.integration.accounts.backup.local')));
});

test('default prepare check is read-only, redacted and makes no network calls',async t=>{
 const f=await fixture(t);const previous=globalThis.fetch;globalThis.fetch=()=>assert.fail('No network permitted');
 try{for(const args of [[],['--check']]){const {result,exitCode}=await runPrepareRuntimeCli({args,profilePath:f.profilePath,environment:{}});assert.equal(exitCode,2);assert.equal(result.prepared,false);assert.equal(result.configured,false);assert.equal(result.verified,false);assert.equal(result.networkTested,false);redacted(result);}}
 finally{globalThis.fetch=previous;}assert.equal(await readFile(f.profilePath,'utf8'),f.content);await noSidecars(f);
});

test('explicit preparation generates a long private ASCII secret and a matching verifier-only plan',async t=>{
 const f=await fixture(t);const result=await prepareIntegrationRuntime({profilePath:f.profilePath,environment:{}});assert.equal(result.status,'prepared');assert.equal(result.prepared,true);assert.equal(result.configured,false);assert.equal(result.verified,false);assert.equal(result.networkTested,false);assert.equal(result.databaseProfile,'updated');
 const values=await privateValues(f),generated=decodeURIComponent(new URL(values.DATABASE_URL).password);assert.ok(generated.length>=48);assert.match(generated,/^[A-Za-z0-9_-]+$/);assert.notEqual(generated,password);
 const planText=await readFile(join(f.directory,RUNTIME_PLAN_FILE),'utf8'),plan=parseEnv(planText);assert.deepEqual(Object.keys(plan).sort(),['HESSARA_RUNTIME_SCRAM_VERIFIER','HESSARA_TEST_PROJECT_REF']);assert.equal(plan.HESSARA_TEST_PROJECT_REF,APPROVED_PROFILE_PROJECT);assert.match(plan.HESSARA_RUNTIME_SCRAM_VERIFIER,/^SCRAM-SHA-256\$4096:/);assert.ok(!planText.includes(generated));redacted(result,[generated,plan.HESSARA_RUNTIME_SCRAM_VERIFIER]);
 for(const[key,value]of Object.entries(base))if(key!=='DATABASE_URL')assert.equal(values[key],value);
 const checked=await checkPreparedIntegrationRuntime({profilePath:f.profilePath,environment:{}});assert.equal(checked.prepared,true);assert.equal(checked.configured,false);assert.equal(checked.missingAuthFields.length,4);redacted(checked,[generated,plan.HESSARA_RUNTIME_SCRAM_VERIFIER]);
 const saved=await readFile(f.profilePath,'utf8');const refused=await prepareIntegrationRuntime({profilePath:f.profilePath,environment:{}});assert.equal(refused.prepared,false);assert.equal(refused.error,'PRIVATE_RUNTIME_PLAN_ALREADY_EXISTS');assert.equal(await readFile(f.profilePath,'utf8'),saved);assert.equal(await readFile(join(f.directory,RUNTIME_PLAN_FILE),'utf8'),planText);
});

test('plan conflicts and backup conflicts occur before any profile change or new plan generation',async t=>{
 for(const filename of [RUNTIME_PLAN_FILE,'.env.integration.database.backup.local']){const f=await fixture(t);await writeFile(join(f.directory,filename),'existing-private-content');const result=await prepareIntegrationRuntime({profilePath:f.profilePath,environment:{}});assert.equal(result.prepared,false);assert.equal(await readFile(f.profilePath,'utf8'),f.content);assert.equal(await readFile(join(f.directory,filename),'utf8'),'existing-private-content');if(filename!==RUNTIME_PLAN_FILE)await assert.rejects(lstat(join(f.directory,RUNTIME_PLAN_FILE)));redacted(result);}
});

test('failure after plan creation is reported incomplete and never overwrites it during retry',async t=>{
 const f=await fixture(t);let called=0;const result=await prepareIntegrationRuntime({profilePath:f.profilePath,environment:{},configureDatabase:async()=>{called++;await lstat(join(f.directory,RUNTIME_PLAN_FILE));throw Error('private credential '+password);}});
 assert.equal(called,1);assert.equal(result.status,'incomplete');assert.equal(result.prepared,false);assert.equal(result.databaseProfile,'unknown');assert.equal(result.recoveryRequired,true);redacted(result);assert.equal(await readFile(f.profilePath,'utf8'),f.content);
 const check=await checkPreparedIntegrationRuntime({profilePath:f.profilePath,environment:{}});assert.equal(check.prepared,false);assert.equal(check.error,'PRIVATE_RUNTIME_PLAN_ORPHANED');assert.equal(check.recoveryRequired,true);
 const plan=await readFile(join(f.directory,RUNTIME_PLAN_FILE),'utf8');assert.equal((await prepareIntegrationRuntime({profilePath:f.profilePath,environment:{}})).error,'PRIVATE_RUNTIME_PLAN_ALREADY_EXISTS');assert.equal(await readFile(join(f.directory,RUNTIME_PLAN_FILE),'utf8'),plan);
});

test('read-only check detects a verifier mismatch and extra plan fields',async t=>{
 const f=await fixture(t);await prepareIntegrationRuntime({profilePath:f.profilePath,environment:{}});const planPath=join(f.directory,RUNTIME_PLAN_FILE),original=await readFile(planPath,'utf8');
 const values=await privateValues(f);values.DATABASE_URL=values.DATABASE_URL.replace(/:[^:@]+@/,':different-fixture-password-24@');await writeFile(f.profilePath,serialize(values));let checked=await checkPreparedIntegrationRuntime({profilePath:f.profilePath,environment:{}});assert.equal(checked.error,'PRIVATE_RUNTIME_PLAN_MISMATCH');assert.equal(checked.prepared,false);
 await writeFile(planPath,original+"EXTRA='untrusted'\n");checked=await checkPreparedIntegrationRuntime({profilePath:f.profilePath,environment:{}});assert.equal(checked.error,'PRIVATE_RUNTIME_PLAN_INVALID');
 await writeFile(planPath,original+"HESSARA_TEST_PROJECT_REF='"+APPROVED_PROFILE_PROJECT+"'\n");checked=await checkPreparedIntegrationRuntime({profilePath:f.profilePath,environment:{}});assert.equal(checked.error,'PRIVATE_RUNTIME_PLAN_INVALID');
 
});

test('staged writes reject wrong projects, URLs, origins, hosted context and unsafe profile files',async t=>{
 for(const changes of [{HESSARA_TEST_PROJECT_REF:'production-ref'},{NEXT_PUBLIC_SUPABASE_URL:'https://waaaxdjymuauknbcxskn.supabase.co'},{HESSARA_TEST_URL:'http://192.168.0.1:5174'},{HESSARA_SITE_URL:'https://production.invalid'},{HESSARA_TEST_ISOLATED:'false'},{VERCEL:'1'}]){const f=await fixture(t,changes);const result=await prepareIntegrationRuntime({profilePath:f.profilePath,environment:{}});assert.equal(result.prepared,false);assert.equal(result.status,'blocked');assert.equal(await readFile(f.profilePath,'utf8'),f.content);await noSidecars(f);}
 const f=await fixture(t);await assert.rejects(configureIntegrationDatabase({databasePassword:password},{profilePath:f.profilePath,environment:{VERCEL:'1'}}),/LOCAL_CONFIGURATION_ONLY/);await noSidecars(f);
 
});

test('new staged APIs reject profiles outside the checkout and symlinked profile targets',async t=>{
 const outside=await mkdtemp(join(tmpdir(),'hessara-stage-outside-'));t.after(async()=>{assert.ok(resolve(outside).startsWith(resolve(tmpdir())+sep));await rm(outside,{recursive:true,force:true});});const path=join(outside,'.env.integration.local');await writeFile(path,serialize(base));await assert.rejects(configureIntegrationDatabase({databasePassword:password},{profilePath:path,environment:{}}),/PRIVATE_PROFILE_PATH_INVALID/);assert.equal((await readdir(outside)).length,1);
 const f=await fixture(t),target=join(f.directory,'target');await writeFile(target,f.content);await rm(f.profilePath);try{await symlink(target,f.profilePath,'file');}catch(error){if(['EPERM','EACCES'].includes(error.code)){t.diagnostic('Windows native file-symlink creation unavailable; no bypass attempted');return;}throw error;}
 await assert.rejects(configureIntegrationDatabase({databasePassword:password},{profilePath:f.profilePath,environment:{}}),/PRIVATE_PROFILE_UNSAFE/);assert.equal(await readFile(target,'utf8'),f.content);
});

test('CLI defaults and unsupported arguments cannot prepare credentials; explicit prepare remains redacted',async t=>{
 const f=await fixture(t),environment={...process.env};delete environment.VERCEL;
 for(const args of [[],['--check'],['--prepare','--check'],['--apply']]){const child=spawnSync(process.execPath,[script,...args],{cwd:f.directory,env:environment,encoding:'utf8',timeout:20000});assert.equal(child.status,2);redacted(child.stdout+child.stderr);assert.equal(await readFile(f.profilePath,'utf8'),f.content);await noSidecars(f);}
 const child=spawnSync(process.execPath,[script,'--prepare'],{cwd:f.directory,env:environment,encoding:'utf8',timeout:20000});assert.equal(child.status,0,child.stderr);assert.equal(JSON.parse(child.stdout).prepared,true);const generated=decodeURIComponent(new URL((await privateValues(f)).DATABASE_URL).password);redacted(child.stdout+child.stderr,[generated]);assert.equal(child.stderr,'');
});

for(const kind of ['plan','profile'])test(kind+' hardlink is refused when the filesystem permits a native fixture',async t=>{
 const f=await fixture(t);if(kind==='plan')await prepareIntegrationRuntime({profilePath:f.profilePath,environment:{}});
 const target=kind==='plan'?join(f.directory,RUNTIME_PLAN_FILE):f.profilePath;
 try{await link(target,join(f.directory,'another-hardlink'));}catch(error){if(['EPERM','EACCES','ENOTSUP'].includes(error.code)){t.skip('Native hardlink creation blocked by this execution environment; no bypass attempted');return;}throw error;}
 if(kind==='plan')assert.equal((await checkPreparedIntegrationRuntime({profilePath:f.profilePath,environment:{}})).error,'PRIVATE_RUNTIME_PLAN_UNSAFE');
 else await assert.rejects(configureIntegrationDatabase({databasePassword:password},{profilePath:f.profilePath,environment:{}}),/PRIVATE_PROFILE_UNSAFE/);
});

test('nonregular plan/profile paths are rejected without changing adjacent private files',async t=>{
 const f=await fixture(t);await mkdir(join(f.directory,RUNTIME_PLAN_FILE));let result=await checkPreparedIntegrationRuntime({profilePath:f.profilePath,environment:{}});assert.equal(result.error,'PRIVATE_RUNTIME_PLAN_UNSAFE');assert.equal(await readFile(f.profilePath,'utf8'),f.content);
 const other=await fixture(t);await rm(other.profilePath);await mkdir(other.profilePath);result=await prepareIntegrationRuntime({profilePath:other.profilePath,environment:{}});assert.equal(result.error,'PRIVATE_PROFILE_UNSAFE');assert.equal((await readdir(other.directory)).length,1);
});

test('database validation, legacy connections and account backup conflicts refuse before mutation',async t=>{
 const f=await fixture(t);
 for(const value of [{databasePassword:'short'},{databasePassword:'كلمة مرور عربية طويلة جدًا للاختبار'},[],{databasePassword:password,extra:password}]){await assert.rejects(configureIntegrationDatabase(value,{profilePath:f.profilePath,environment:{}}));assert.equal(await readFile(f.profilePath,'utf8'),f.content);await noSidecars(f);}
 await configureIntegrationDatabase({databasePassword:password},{profilePath:f.profilePath,environment:{}});const before=await readFile(f.profilePath,'utf8');await writeFile(join(f.directory,'.env.integration.accounts.backup.local'),'existing account backup');await assert.rejects(configureIntegrationAccounts(accounts,{profilePath:f.profilePath,environment:{}}),/PRIVATE_BACKUP_ALREADY_EXISTS/);assert.equal(await readFile(f.profilePath,'utf8'),before);
 const legacy=await fixture(t,{POSTGRES_URL:'postgresql://production.invalid/postgres'});const result=await prepareIntegrationRuntime({profilePath:legacy.profilePath,environment:{}});assert.equal(result.prepared,false);assert.equal(result.status,'blocked');assert.equal(await readFile(legacy.profilePath,'utf8'),legacy.content);await noSidecars(legacy);
});
