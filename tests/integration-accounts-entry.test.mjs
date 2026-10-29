import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,copyFile,mkdir,readdir,rm} from 'node:fs/promises';
import {resolve,join,dirname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {Readable} from 'node:stream';
import {parseEnv} from 'node:util';
import {runConfigurationCli,APPROVED_PROFILE_PROJECT,VERIFIED_PROFILE_POOLER} from '../scripts/configure-integration-profile.mjs';

const root=resolve('.'),script=fileURLToPath(new URL('../scripts/configure-integration-profile.mjs',import.meta.url));
const credentials={emailA:'local-existing-a@example.test',passwordA:'Existing account A password %/@/# عربية',emailB:'local-existing-b@example.test',passwordB:'Existing account B password %/@/# test'};
const base={HESSARA_TEST_PROJECT_REF:APPROVED_PROFILE_PROJECT,NEXT_PUBLIC_SUPABASE_URL:`https://${APPROVED_PROFILE_PROJECT}.supabase.co`,HESSARA_TEST_ISOLATED:'true',HESSARA_INTEGRATION_TEST:'true',HESSARA_TEST_URL:'http://127.0.0.1:5174',HESSARA_SITE_URL:'http://127.0.0.1:5174',HESSARA_ENCRYPTION_KEY:Buffer.alloc(32,6).toString('base64'),HESSARA_TEST_ATTESTATION_KEY:'existing-fixture-attestation-key-'.repeat(2),DATABASE_URL:`postgresql://hessara_runtime.${APPROVED_PROFILE_PROJECT}:existing-db-password-do-not-replace@${VERIFIED_PROFILE_POOLER}:6543/postgres`,POSTGRES_URL:'',DATABASE_SSL_CA:'existing-public-CA-fixture',HESSARA_TEST_EMAIL_A:'',HESSARA_TEST_PASSWORD_A:'',HESSARA_TEST_EMAIL_B:'',HESSARA_TEST_PASSWORD_B:'',OTHER_SETTING:'unchanged-fixture'};
const serialize=values=>Object.entries(values).map(([key,value])=>`${key}='${value}'`).join('\n')+'\n';
async function fixture(t,changes={}){const directory=await mkdtemp(resolve('.integration-account-entry-test-'));assert.ok(directory.startsWith(root+sep));t.after(async()=>{assert.equal(dirname(resolve(directory)),root);await rm(directory,{recursive:true,force:true});});const profilePath=join(directory,'.env.integration.local'),content=serialize({...base,...changes});await writeFile(profilePath,content,{mode:0o600});return{directory,profilePath,content};}
function redacted(output){const text=typeof output==='string'?output:JSON.stringify(output);for(const secret of [...Object.values(credentials),base.DATABASE_URL,base.HESSARA_ENCRYPTION_KEY,base.HESSARA_TEST_ATTESTATION_KEY])assert.ok(!text.includes(secret),'Output reflected private fixture value');}
function childEnv(){const env={...process.env};delete env.VERCEL;return env;}
async function preparePowerShell(f){const directory=join(f.directory,'scripts');await mkdir(directory);for(const name of ['configure-integration-profile.mjs','configure-integration-profile.ps1'])await copyFile(new URL('../scripts/'+name,import.meta.url),join(directory,name));return directory;}
const hiddenPromptFunction="function Read-Host { param([string]$Prompt,[switch]$AsSecureString) if (-not $AsSecureString) { throw 'Hidden input required' }; $names = @('emailA','passwordA','emailB','passwordB'); $value = $global:AccountEntryFixture.($names[$global:AccountEntryIndex]); $global:AccountEntryIndex++; return ConvertTo-SecureString -String $value -AsPlainText -Force }";
async function psHarness(f,suffix=''){
 const file=join(f.directory,'entry-harness.ps1');await writeFile(join(f.directory,'entry-input.json'),JSON.stringify(credentials),{mode:0o600});
 await writeFile(file,["$ErrorActionPreference = 'Stop'","$global:AccountEntryFixture = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'entry-input.json') -Raw -Encoding UTF8 | ConvertFrom-Json","$global:AccountEntryIndex = 0",hiddenPromptFunction,"& (Join-Path $PSScriptRoot 'scripts/configure-integration-profile.ps1') -ConfigureAccounts "+suffix,"$accountEntryExit = $LASTEXITCODE","if ($accountEntryExit -eq 0 -and $global:AccountEntryIndex -ne 4) { exit 99 }",'exit $accountEntryExit'].join('\r\n'));return file;
}
function executePowerShell(file,f){return spawnSync('pwsh.exe',['-NoLogo','-NoProfile','-NonInteractive','-File',file],{cwd:f.directory,env:childEnv(),encoding:'utf8',timeout:30000});}

test('accounts-only CLI requires explicit mode and reports local configuration without Auth verification',async t=>{
 const f=await fixture(t),before=globalThis.fetch;globalThis.fetch=()=>assert.fail('No network operation allowed');
 try{
  const checked=await runConfigurationCli({args:[],profilePath:f.profilePath,environment:{},input:{[Symbol.asyncIterator](){assert.fail('Default check cannot read credentials');}}});assert.equal(checked.exitCode,2);assert.equal(checked.result.status,'needs_configuration');assert.equal(await readFile(f.profilePath,'utf8'),f.content);
  const result=await runConfigurationCli({args:['--configure-accounts'],profilePath:f.profilePath,environment:{},input:Readable.from([JSON.stringify(credentials)])});assert.equal(result.exitCode,0);assert.equal(result.result.status,'accounts_configured');assert.equal(result.result.accountsConfigured,true);assert.equal(result.result.configurationOnly,true);assert.equal(result.result.verified,false);assert.equal(result.result.networkTested,false);redacted(result);
 }finally{globalThis.fetch=before;}
 const values=parseEnv(await readFile(f.profilePath,'utf8'));assert.equal(values.DATABASE_URL,base.DATABASE_URL);assert.equal(values.DATABASE_SSL_CA,base.DATABASE_SSL_CA);assert.equal(values.HESSARA_TEST_EMAIL_A,credentials.emailA);assert.equal(values.HESSARA_TEST_PASSWORD_B,credentials.passwordB);assert.equal(await readFile(join(f.directory,'.env.integration.accounts.backup.local'),'utf8'),f.content);
});

test('accounts CLI rejects malformed or partial values, extra modes and existing fields without changing the profile',async t=>{
 const f=await fixture(t);
 for(const [args,input]of [
  [['--configure-accounts'],JSON.stringify({emailA:credentials.emailA})],
  [['--configure-accounts'],JSON.stringify({...credentials,extra:credentials.passwordA})],
  [['--configure-accounts'],'{'+credentials.passwordA],
  [['--configure-accounts','--configure'],JSON.stringify(credentials)],
 ]){const child=spawnSync(process.execPath,[script,...args],{cwd:f.directory,env:childEnv(),encoding:'utf8',input,timeout:20000});assert.equal(child.status,2);assert.equal(JSON.parse(child.stdout).status,'blocked');redacted(child.stdout+child.stderr);assert.equal(await readFile(f.profilePath,'utf8'),f.content);assert.deepEqual(await readdir(f.directory),['.env.integration.local']);}
 const filled=await fixture(t,{HESSARA_TEST_EMAIL_A:'already-present@example.test'});const child=spawnSync(process.execPath,[script,'--configure-accounts'],{cwd:filled.directory,env:childEnv(),encoding:'utf8',input:JSON.stringify(credentials),timeout:20000});assert.equal(child.status,2);assert.equal(JSON.parse(child.stdout).error,'PROFILE_AUTH_FIELDS_ALREADY_CONFIGURED');assert.equal(await readFile(filled.profilePath,'utf8'),filled.content);redacted(child.stdout+child.stderr);
});

test('PowerShell account mode uses four hidden inputs and preserves runtime configuration in a copied fixture',{skip:process.platform!=='win32'},async t=>{
 const f=await fixture(t);await preparePowerShell(f);const file=await psHarness(f);const child=executePowerShell(file,f);if(child.error?.code==='ENOENT'){t.skip('PowerShell7 is not installed');return;}assert.equal(child.error,undefined);assert.equal(child.status,0,child.stdout+child.stderr);assert.match(child.stdout,/Configuration status: accounts_configured/);assert.match(child.stdout,/No sign-in, confirmation or integration test was performed/);assert.doesNotMatch(child.stdout,/were verified and signed out|runtime identity and schema read were verified/);redacted(child.stdout+child.stderr);
 const values=parseEnv(await readFile(f.profilePath,'utf8'));assert.equal(values.DATABASE_URL,base.DATABASE_URL);assert.equal(values.DATABASE_SSL_CA,base.DATABASE_SSL_CA);assert.equal(values.HESSARA_TEST_PASSWORD_A,credentials.passwordA);assert.equal(values.HESSARA_TEST_PASSWORD_B,credentials.passwordB);assert.equal(await readFile(join(f.directory,'.env.integration.accounts.backup.local'),'utf8'),f.content);
});

test('PowerShell account mode is mutually exclusive before any prompt or helper launch',{skip:process.platform!=='win32'},async t=>{
 const f=await fixture(t);await preparePowerShell(f);const file=join(f.directory,'mixed-modes.ps1');
 for(const mode of ['Configure','Check','ProvisionRuntime','ProvisionUsers']){
  await writeFile(file,["$ErrorActionPreference = 'Stop'","function Read-Host { throw 'No prompt permitted for combined modes' }","& (Join-Path $PSScriptRoot 'scripts/configure-integration-profile.ps1') -ConfigureAccounts -"+mode,'exit $LASTEXITCODE'].join('\r\n'));
  const child=executePowerShell(file,f);if(child.error?.code==='ENOENT'){t.skip('PowerShell7 is not installed');return;}assert.equal(child.status,2,child.stdout+child.stderr);assert.match(child.stdout,/INTEGRATION_CONFIGURATION_FAILED/);assert.doesNotMatch(child.stdout,/Input is hidden|Existing test account|secret API key/);redacted(child.stdout+child.stderr);assert.equal(await readFile(f.profilePath,'utf8'),f.content);
 }
 await assert.rejects(readFile(join(f.directory,'.env.integration.accounts.backup.local')));
});

test('PowerShell account mode refuses a child claiming verification or network success',{skip:process.platform!=='win32'},async t=>{
 const f=await fixture(t),scripts=await preparePowerShell(f),file=await psHarness(f);
 for(const result of [{status:'verified',verified:true},{status:'accounts_configured',configured:true,configurationOnly:true,verified:true,networkTested:false},{status:'accounts_configured',configured:true,configurationOnly:true,verified:false,networkTested:true}]){
  await writeFile(join(scripts,'configure-integration-profile.mjs'),`let input='';for await(const chunk of process.stdin)input+=chunk;JSON.parse(input);console.log(${JSON.stringify(JSON.stringify(result))});`);
  const child=executePowerShell(file,f);if(child.error?.code==='ENOENT'){t.skip('PowerShell7 is not installed');return;}assert.equal(child.status,2,child.stdout+child.stderr);assert.match(child.stdout,/INTEGRATION_CONFIGURATION_FAILED/);assert.doesNotMatch(child.stdout,/Configuration status:|were verified and signed out|runtime identity and schema read were verified/);redacted(child.stdout+child.stderr);assert.equal(await readFile(f.profilePath,'utf8'),f.content);
 }
});
