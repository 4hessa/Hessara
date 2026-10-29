import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,copyFile,writeFile,readFile,rm} from 'node:fs/promises';
import {resolve,join,sep} from 'node:path';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
const root=resolve('.vercel');
async function fixture(t){const folder=await mkdtemp(join(root,'users-wrapper-'));t.after(async()=>{assert.ok(resolve(folder).startsWith(root+sep));await rm(folder,{recursive:true,force:true});});const scripts=join(folder,'scripts');await mkdir(scripts);await copyFile('scripts/configure-integration-profile.ps1',join(scripts,'configure-integration-profile.ps1'));return{folder,scripts};}
test('PowerShell user provisioning sends a single hidden secret through stdin and redacts arbitrary child fields',{skip:process.platform!=='win32'},async t=>{
 const f=await fixture(t),secret='sb_secret_fixture-key-that-is-not-real-123456789';
 await writeFile(join(f.scripts,'provision-integration-users.mjs'),`import{writeFileSync}from'node:fs';let raw='';for await(const chunk of process.stdin)raw+=chunk;const input=JSON.parse(raw);if(Object.keys(input).join(',')!=='adminKey')process.exit(3);writeFileSync('received-fixture.json',JSON.stringify({key:input.adminKey,args:process.argv.slice(2)}));console.log(JSON.stringify({status:'verified',verified:true,debugSecret:input.adminKey}));`);
 await writeFile(join(f.folder,'harness.ps1'),`function Read-Host {param([string]$Prompt,[switch]$AsSecureString) if(-not $AsSecureString){throw 'UNSAFE_PROMPT'};return ConvertTo-SecureString -String '${secret}' -AsPlainText -Force}\n& (Join-Path $PSScriptRoot 'scripts/configure-integration-profile.ps1') -ProvisionUsers\nexit $LASTEXITCODE`);
 const env={...process.env};delete env.VERCEL;const child=spawnSync('pwsh.exe',['-NoLogo','-NoProfile','-NonInteractive','-File',join(f.folder,'harness.ps1')],{cwd:f.folder,env,encoding:'utf8',timeout:30000});
 if(child.error?.code==='ENOENT'){t.skip('PowerShell7 is unavailable');return;}assert.equal(child.status,0,child.stdout+' '+child.stderr);assert.ok(!child.stdout.includes(secret)&&!child.stderr.includes(secret));assert.match(child.stdout,/Both dedicated Auth accounts were verified/);
 const received=JSON.parse(await readFile(join(f.folder,'received-fixture.json'),'utf8'));assert.equal(received.key,secret);assert.deepEqual(received.args,['--apply']);
});
test('PowerShell provisioning mode cannot be combined with check or legacy setup',{skip:process.platform!=='win32'},async t=>{
 const f=await fixture(t);for(const mode of ['Check','Configure','ProvisionRuntime']){
  const env={...process.env};delete env.VERCEL;const child=spawnSync('pwsh.exe',['-NoLogo','-NoProfile','-NonInteractive','-File',join(f.scripts,'configure-integration-profile.ps1'),'-ProvisionUsers','-'+mode],{cwd:f.folder,env,encoding:'utf8',timeout:30000});
  if(child.error?.code==='ENOENT'){t.skip('PowerShell7 is unavailable');return;}assert.equal(child.status,2);assert.match(child.stdout,/INTEGRATION_CONFIGURATION_FAILED/);
 }
});

test('PowerShell user input from System32 preserves hidden transport and shows only safe key diagnostics',{skip:process.platform!=='win32'},async t=>{
 const f=await fixture(t),key='sb_secret_system32-fixture-not-a-real-key-123456789';
 const helper=pathToFileURL(resolve('scripts/provision-integration-users.mjs')).href;
 const cases=[[' \r\n'+key+'\r\n ','FIXTURE_INPUT_ACCEPTED'],['','ADMIN_KEY_INPUT_REQUIRED'],['sb_publishable_wrong-fixture-key','ADMIN_KEY_PUBLIC_NOT_ALLOWED'],['sb_secret_abcd…xyz','ADMIN_KEY_MASKED_INPUT'],['Bearer '+key,'ADMIN_KEY_WRAPPED_INPUT']];
 for(const[value,expected]of cases){
  await writeFile(join(f.scripts,'provision-integration-users.mjs'),`import{readUserProvisionInput}from ${JSON.stringify(helper)};import{writeFileSync}from'node:fs';let out;try{const input=await readUserProvisionInput(process.stdin);writeFileSync('received-status.json',JSON.stringify({canonicalKeyMatched:input.adminKey===${JSON.stringify(key)},workingDirectory:process.cwd(),networkAttempted:false}));out={status:'blocked',verified:false,error:'FIXTURE_INPUT_ACCEPTED',debugSecret:input.adminKey};}catch(error){out={status:'blocked',verified:false,error:error.code};}console.log(JSON.stringify(out));process.exitCode=2;`);
  const psValue=Buffer.from(value,'utf8').toString('base64');
  await writeFile(join(f.folder,'harness.ps1'),`function Read-Host {param([string]$Prompt,[switch]$AsSecureString) if(-not $AsSecureString){throw 'UNSAFE_PROMPT'};if('${psValue}' -eq ''){return [Security.SecureString]::new()};return ConvertTo-SecureString -String ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${psValue}'))) -AsPlainText -Force}\n& (Join-Path $PSScriptRoot 'scripts/configure-integration-profile.ps1') -ProvisionUsers\nexit $LASTEXITCODE`);
  const env={...process.env};delete env.VERCEL;const child=spawnSync('pwsh.exe',['-NoLogo','-NoProfile','-NonInteractive','-File',join(f.folder,'harness.ps1')],{cwd:join(process.env.SystemRoot||'C:/Windows','System32'),env,encoding:'utf8',timeout:30000});
  if(child.error?.code==='ENOENT'){t.skip('PowerShell7 is unavailable');return;}assert.equal(child.status,2,child.stdout+' '+child.stderr);assert.match(child.stdout,new RegExp('Reason: '+expected));assert.ok(!child.stdout.includes(key)&&!child.stderr.includes(key));
  if(expected==='FIXTURE_INPUT_ACCEPTED'){const received=JSON.parse(await readFile(join(f.folder,'received-status.json'),'utf8'));assert.equal(received.canonicalKeyMatched,true);assert.equal(received.workingDirectory,f.folder);assert.equal(received.networkAttempted,false);}
  else assert.match(child.stdout,/Next step:/);
 }
});
