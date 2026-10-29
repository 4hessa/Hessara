import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { Readable } from 'node:stream';
import { spawnSync } from 'node:child_process';
import { checkIntegrationProfile, configureIntegrationProfile, readConfigurationInput, runConfigurationCli, APPROVED_PROFILE_PROJECT, VERIFIED_PROFILE_POOLER, PROFILE_FIELDS } from '../scripts/configure-integration-profile.mjs';

const scriptPath = fileURLToPath(new URL('../scripts/configure-integration-profile.mjs', import.meta.url));
const base = {
 HESSARA_TEST_PROJECT_REF: APPROVED_PROFILE_PROJECT,
 NEXT_PUBLIC_SUPABASE_URL: `https://${APPROVED_PROFILE_PROJECT}.supabase.co`,
 HESSARA_TEST_ISOLATED: 'true', HESSARA_INTEGRATION_TEST: 'true',
 HESSARA_TEST_URL: 'http://127.0.0.1:5174', HESSARA_SITE_URL: 'http://127.0.0.1:5174',
 HESSARA_ENCRYPTION_KEY: Buffer.alloc(32, 11).toString('base64'), HESSARA_TEST_ATTESTATION_KEY: 'private-fixture-attestation-'.repeat(2),
 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_fixture_only',
 DATABASE_URL: '', POSTGRES_URL: '', DATABASE_SSL_CA: '',
 HESSARA_TEST_EMAIL_A: '', HESSARA_TEST_PASSWORD_A: '', HESSARA_TEST_EMAIL_B: '', HESSARA_TEST_PASSWORD_B: '',
 OTHER_SETTING: 'preserve-this-fixture', MULTILINE_SETTING: 'line one\nline two', LITERAL_SLASH_SETTING: 'literal\\n\\rfixture',
};
const input = { databasePassword: 'DB fixture %/@/# quote\' space عربيةΩ password', emailA: 'profile-test-a@example.test', passwordA: 'Account A %/@/# password', emailB: 'profile-test-b@example.test', passwordB: 'Account B secure password' };
function fixtureContent(values) { return Object.entries(values).map(([name, value]) => `${name}='${value}'`).join('\n') + '\n'; }
async function fixture(t, updates = {}) {
 const folder = await mkdtemp(join(tmpdir(), 'hessara-profile-config-'));
 t.after(async () => { const exact = resolve(folder); assert.equal(dirname(exact), resolve(tmpdir())); assert.ok(basename(exact).startsWith('hessara-profile-config-')); await rm(exact, { recursive: true, force: true }); });
 const profilePath = join(folder, '.env.integration.local'), content = fixtureContent({ ...base, ...updates });
 await writeFile(profilePath, content, { mode: 0o600 }); return { folder, profilePath, content };
}
function assertRedacted(value) {
 const text = typeof value === 'string' ? value : JSON.stringify(value);
 for (const secret of [...Object.values(input), base.HESSARA_ENCRYPTION_KEY, base.HESSARA_TEST_ATTESTATION_KEY]) assert.ok(!text.includes(secret), 'Output must exclude fixture credentials');
}
async function noBackup(folder) { await assert.rejects(access(join(folder, '.env.integration.backup.local'))); }

test('default configuration check reports only missing field names and never mutates the private profile', async t => {
 const f = await fixture(t); const result = await checkIntegrationProfile({ profilePath: f.profilePath, environment: {} });
 assert.deepEqual(result, { status: 'needs_configuration', configured: false, networkTested: false, issues: [], missingFields: PROFILE_FIELDS });
 assertRedacted(result); assert.equal(await readFile(f.profilePath, 'utf8'), f.content); await noBackup(f.folder);
 const cli = await runConfigurationCli({ args: [], input: Readable.from(['must not be consumed']), profilePath: f.profilePath, environment: {} });
 assert.equal(cli.exitCode, 2); assert.equal(cli.result.status, 'needs_configuration');
});

test('configuration constructs the verified runtime pooler URL, preserves existing values and saves an exact backup', async t => {
 const f = await fixture(t); const result = await configureIntegrationProfile(input, { profilePath: f.profilePath, environment: {} });
 assert.equal(result.configured, true); assert.equal(result.networkTested, false); assertRedacted(result);
 const profile = parseEnv(await readFile(f.profilePath, 'utf8')), url = new URL(profile.DATABASE_URL);
 assert.equal(url.protocol, 'postgresql:'); assert.equal(url.hostname, VERIFIED_PROFILE_POOLER); assert.equal(url.port, '6543'); assert.equal(url.pathname, '/postgres');
 assert.equal(decodeURIComponent(url.username), `hessara_runtime.${APPROVED_PROFILE_PROJECT}`); assert.equal(decodeURIComponent(url.password), input.databasePassword);
 assert.equal(url.search, ''); assert.equal(url.hash, '');
 for (const [name, value] of Object.entries(base)) if (!PROFILE_FIELDS.includes(name)) assert.equal(profile[name], value, name);
 assert.equal(profile.HESSARA_TEST_EMAIL_A, input.emailA); assert.equal(profile.HESSARA_TEST_PASSWORD_B, input.passwordB);
 assert.equal(await readFile(join(f.folder, '.env.integration.backup.local'), 'utf8'), f.content);
 assert.equal((await checkIntegrationProfile({ profilePath: f.profilePath, environment: {} })).status, 'configured');
});

test('existing credentials or a backup are never overwritten, and failed validation leaves the profile unchanged', async t => {
 for (const name of [...PROFILE_FIELDS, 'POSTGRES_URL']) {
  const f = await fixture(t, { [name]: 'already-present-fixture' });
  await assert.rejects(configureIntegrationProfile(input, { profilePath: f.profilePath, environment: {} }), /PROFILE_FIELDS_ALREADY_CONFIGURED/);
  assert.equal(await readFile(f.profilePath, 'utf8'), f.content); await noBackup(f.folder);
 }
 const f = await fixture(t); await writeFile(join(f.folder, '.env.integration.backup.local'), 'earlier private backup');
 await assert.rejects(configureIntegrationProfile(input, { profilePath: f.profilePath, environment: {} }), /PRIVATE_BACKUP_ALREADY_EXISTS/);
 assert.equal(await readFile(f.profilePath, 'utf8'), f.content); assert.equal(await readFile(join(f.folder, '.env.integration.backup.local'), 'utf8'), 'earlier private backup');
});

test('production, mismatched Auth targets, unsafe origins and missing private keys block before any file write', async t => {
 for (const change of [
  { HESSARA_TEST_PROJECT_REF: 'waaaxdjymuauknbcxskn' }, { NEXT_PUBLIC_SUPABASE_URL: 'https://waaaxdjymuauknbcxskn.supabase.co' },
  { HESSARA_TEST_ISOLATED: 'false' }, { HESSARA_INTEGRATION_TEST: 'false' }, { HESSARA_TEST_URL: 'http://192.168.0.1:5174' },
  { HESSARA_SITE_URL: 'https://production.example' }, { HESSARA_ENCRYPTION_KEY: 'bad' }, { HESSARA_TEST_ATTESTATION_KEY: 'short' }, { VERCEL: '1' },
 ]) {
  const f = await fixture(t, change); const checked = await checkIntegrationProfile({ profilePath: f.profilePath, environment: {} });
  assert.equal(checked.status, 'blocked'); assertRedacted(checked);
  await assert.rejects(configureIntegrationProfile(input, { profilePath: f.profilePath, environment: {} }), /PROFILE_BASE_INVALID/);
  assert.equal(await readFile(f.profilePath, 'utf8'), f.content); await noBackup(f.folder);
 }
 const f = await fixture(t); await assert.rejects(configureIntegrationProfile(input, { profilePath: f.profilePath, environment: { VERCEL: '1' } }), /LOCAL_CONFIGURATION_ONLY/);
 assert.equal(await readFile(f.profilePath, 'utf8'), f.content); await noBackup(f.folder);
});

test('strict input validation refuses weak passwords, duplicate accounts, extra fields and malformed values', async t => {
 const f = await fixture(t);
 for (const value of [null, [], {}, { ...input, extra: 'private' }, { ...input, databasePassword: 'short' }, { ...input, databasePassword: ' '.repeat(30) }, { ...input, passwordA: 'short' }, { ...input, passwordB: 'long enough\ninvalid' }, { ...input, emailA: 'not-an-email' }, { ...input, emailB: input.emailA.toUpperCase() }, { ...input, emailA: 'x'.repeat(255) + '@example.test' }]) {
  await assert.rejects(configureIntegrationProfile(value, { profilePath: f.profilePath, environment: {} }));
  assert.equal(await readFile(f.profilePath, 'utf8'), f.content); await noBackup(f.folder);
 }
});

test('encoding supports reserved characters and Unicode while preserving account password whitespace and quotes', async t => {
 const f = await fixture(t); const changed = { ...input, databasePassword: 'Abcd1234%/@/#Ω汉字 full password', passwordA: '  Password A \'quote\' $ value  ', passwordB: 'Password B "double" value' };
 await configureIntegrationProfile(changed, { profilePath: f.profilePath, environment: {} }); const saved = parseEnv(await readFile(f.profilePath, 'utf8'));
 assert.equal(decodeURIComponent(new URL(saved.DATABASE_URL).password), changed.databasePassword); assert.equal(saved.HESSARA_TEST_PASSWORD_A, changed.passwordA); assert.equal(saved.HESSARA_TEST_PASSWORD_B, changed.passwordB);
});

test('unrepresentable dotenv values fail safely before backup or mutation instead of corrupting secrets', async t => {
 const f = await fixture(t); const changed = { ...input, passwordA: 'Includes all quote forms \' " ` password' };
 await assert.rejects(configureIntegrationProfile(changed, { profilePath: f.profilePath, environment: {} }), /PROFILE_SERIALIZATION_UNSUPPORTED/);
 assert.equal(await readFile(f.profilePath, 'utf8'), f.content); await noBackup(f.folder);
});

test('bounded stdin parsing rejects malformed UTF-8, oversized input and empty input without reflecting content', async () => {
 assert.deepEqual(await readConfigurationInput(Readable.from([JSON.stringify(input)])), input);
 for (const stream of [Readable.from([]), Readable.from(['{invalid ' + input.databasePassword]), Readable.from([Buffer.from([0xff])]), Readable.from(['x'.repeat(8193)])]) await assert.rejects(readConfigurationInput(stream), /CONFIGURATION_INPUT_(?:REQUIRED|INVALID|TOO_LARGE)/);
});

test('CLI requires explicit configure, redacts errors, and receives credentials only through stdin', async t => {
 const f = await fixture(t), childEnv = { ...process.env }; delete childEnv.VERCEL;
 let child = spawnSync(process.execPath, [scriptPath, '--check'], { cwd: f.folder, env: childEnv, encoding: 'utf8', timeout: 20000 });
 assert.equal(child.status, 2); assert.equal(JSON.parse(child.stdout).status, 'needs_configuration'); assertRedacted(child.stdout + child.stderr); await noBackup(f.folder);
 child = spawnSync(process.execPath, [scriptPath, '--configure'], { cwd: f.folder, env: childEnv, input: JSON.stringify(input), encoding: 'utf8', timeout: 20000 });
 assert.equal(child.status, 0, child.stderr); const result = JSON.parse(child.stdout); assert.equal(result.configured, true); assert.equal(result.networkTested, false); assert.equal(child.stderr, ''); assertRedacted(child.stdout);
 child = spawnSync(process.execPath, [scriptPath, '--configure'], { cwd: f.folder, env: childEnv, input: JSON.stringify(input), encoding: 'utf8', timeout: 20000 });
 assert.equal(child.status, 2); assert.equal(JSON.parse(child.stdout).error, 'PROFILE_FIELDS_ALREADY_CONFIGURED'); assertRedacted(child.stdout + child.stderr);
});

test('CLI input failures, Vercel context and unsupported arguments cannot create a profile backup', async t => {
 const f = await fixture(t), childEnv = { ...process.env }; delete childEnv.VERCEL;
 for (const options of [
  { args: ['--configure'], input: '{' + input.databasePassword }, { args: ['--configure'], input: JSON.stringify({ ...input, emailA: '<private invalid>' }) },
  { args: ['--configure'], input: 'x'.repeat(8193) }, { args: ['--configure'], input: JSON.stringify(input), env: { ...childEnv, VERCEL: '1' } },
  { args: ['--configure', '--check'], input: JSON.stringify(input) },
 ]) {
  const child = spawnSync(process.execPath, [scriptPath, ...options.args], { cwd: f.folder, env: options.env || childEnv, input: options.input, encoding: 'utf8', timeout: 20000 });
  assert.equal(child.status, 2); const result = JSON.parse(child.stdout); assert.equal(result.status, 'blocked'); assert.equal(result.configured, false); assertRedacted(child.stdout + child.stderr);
  assert.equal(await readFile(f.profilePath, 'utf8'), f.content); await noBackup(f.folder);
 }
});

test('configured checks reject administrative, wrong-project or unexpected pooler connection URLs', async t => {
 for (const database of [
  `postgresql://postgres:runtime-password-fixture@${VERIFIED_PROFILE_POOLER}:6543/postgres`,
  `postgresql://hessara_runtime.waaaxdjymuauknbcxskn:runtime-password-fixture@${VERIFIED_PROFILE_POOLER}:6543/postgres`,
  `postgresql://hessara_runtime.${APPROVED_PROFILE_PROJECT}:runtime-password-fixture@other.pooler.supabase.com:6543/postgres`,
  `postgresql://hessara_runtime.${APPROVED_PROFILE_PROJECT}:runtime-password-fixture@${VERIFIED_PROFILE_POOLER}:6543/postgres?sslmode=disable`,
 ]) {
  const f = await fixture(t, { DATABASE_URL: database, HESSARA_TEST_EMAIL_A: input.emailA, HESSARA_TEST_PASSWORD_A: input.passwordA, HESSARA_TEST_EMAIL_B: input.emailB, HESSARA_TEST_PASSWORD_B: input.passwordB });
  const checked = await checkIntegrationProfile({ profilePath: f.profilePath, environment: {} }); assert.equal(checked.configured, false); assert.ok(checked.issues.includes('PROFILE_DATABASE_INVALID')); assertRedacted(checked);
 }
});

test('PowerShell entry uses hidden prompts, redirected stdin and finally disposal without secret CLI arguments', async () => {
 const source = await readFile(new URL('../scripts/configure-integration-profile.ps1', import.meta.url), 'utf8');
 assert.match(source, /Read-Host -Prompt \$taskPrompt -AsSecureString/); assert.match(source, /StandardInput\.Write\(\$taskPayload\)/); assert.match(source, /RedirectStandardInput = \$true/);
 assert.match(source, /ZeroFreeBSTR/); assert.match(source, /finally/); assert.match(source, /\.Dispose\(\)/); assert.match(source, /\$taskCredentials\.Clear\(\)/);
 const argumentLine = source.split(/\r?\n/).find(line => line.includes('$taskStart.Arguments =')); assert.ok(argumentLine); assert.ok(!/Payload|Credentials|SecureValue|Password/.test(argumentLine));
 assert.ok(!/Start-Transcript|Set-Item\s+Env:|\$env:\w+\s*=/.test(source));
});

for (const executableName of ['powershell.exe', 'pwsh.exe']) test(executableName + ' wrapper configures only a copied fixture using hidden prompt values and UTF-8 stdin', { skip: process.platform !== 'win32' }, async t => {
 const f = await fixture(t), { mkdir, copyFile } = await import('node:fs/promises');
 const scripts = join(f.folder, 'scripts'); await mkdir(scripts);
 for (const name of ['configure-integration-profile.mjs', 'configure-integration-profile.ps1']) await copyFile(new URL('../scripts/' + name, import.meta.url), join(scripts, name));
 await writeFile(join(f.folder, 'fixture-input.json'), JSON.stringify(input), { mode: 0o600 });
 const psCopy=join(scripts,'configure-integration-profile.ps1'); const psText=await readFile(psCopy,'utf8'); await writeFile(psCopy,psText.replace("Write-Host 'INTEGRATION_CONFIGURATION_FAILED'","Write-Host ('FIXTURE_DIAGNOSTIC_' + $_.Exception.GetType().Name + '_LINE_' + $_.InvocationInfo.ScriptLineNumber)"));
 const harness = join(f.folder, 'fixture-harness.ps1');
 await writeFile(harness, [
  "$ErrorActionPreference = 'Stop'",
  "$global:HessaraFixtureValues = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'fixture-input.json') -Raw -Encoding UTF8 | ConvertFrom-Json",
  "$global:HessaraFixtureIndex = 0",
  'function Read-Host { param([string]$Prompt, [switch]$AsSecureString) $values = @($global:HessaraFixtureValues.databasePassword, $global:HessaraFixtureValues.emailA, $global:HessaraFixtureValues.passwordA, $global:HessaraFixtureValues.emailB, $global:HessaraFixtureValues.passwordB); $value = $values[$global:HessaraFixtureIndex]; $global:HessaraFixtureIndex++; return ConvertTo-SecureString -String $value -AsPlainText -Force }',
  "& (Join-Path $PSScriptRoot 'scripts/configure-integration-profile.ps1') -Configure",
  'exit $LASTEXITCODE',
 ].join('\r\n'), 'utf8');
 const childEnv = { ...process.env }; delete childEnv.VERCEL;
 const executable = executableName === 'powershell.exe' ? join(process.env.SystemRoot || 'C:/Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe') : executableName;
 const child = spawnSync(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', harness], { cwd: f.folder, env: childEnv, encoding: 'utf8', timeout: 30000 });
 if (child.error?.code === 'ENOENT') { t.skip('PowerShell runtime is not installed'); return; }
 if (/running scripts is disabled|cannot be loaded.*execution policies/is.test(child.stdout + child.stderr)) { t.skip('System execution policy blocks script files; no policy change or bypass attempted'); return; }
 assert.equal(child.error, undefined); assert.equal(child.status, 0, child.stdout + child.stderr); assertRedacted(child.stdout + child.stderr); assert.match(child.stdout, /Configuration status: configured/);
 const configured = parseEnv(await readFile(f.profilePath, 'utf8')); assert.equal(decodeURIComponent(new URL(configured.DATABASE_URL).password), input.databasePassword); assert.equal(configured.HESSARA_TEST_EMAIL_B, input.emailB);
 assert.equal(await readFile(join(f.folder, '.env.integration.backup.local'), 'utf8'), f.content);
});

test('PowerShell runtime mode passes only a hidden administrator value to a fixture process without a real connection', {skip:process.platform!=='win32'}, async t=>{
 const f=await fixture(t),{mkdir,copyFile}=await import('node:fs/promises');const scripts=join(f.folder,'scripts');await mkdir(scripts);await copyFile(new URL('../scripts/configure-integration-profile.ps1',import.meta.url),join(scripts,'configure-integration-profile.ps1'));
 const adminFixture='Administrator fixture %/@/# 123456';
 await writeFile(join(scripts,'provision-integration-runtime.mjs'),`import assert from 'node:assert/strict';let data='';for await(const c of process.stdin)data+=c;assert.deepEqual(process.argv.slice(2),['--apply']);const parsed=JSON.parse(data);assert.deepEqual(Object.keys(parsed),['administratorPassword']);assert.equal(parsed.administratorPassword,${JSON.stringify(adminFixture)});console.log(JSON.stringify({status:'verified',verified:true,networkAttempted:false}));`);
 const harness=join(f.folder,'runtime-harness.ps1');await writeFile(harness,["$ErrorActionPreference='Stop'",`function Read-Host { param([string]$Prompt,[switch]$AsSecureString) return ConvertTo-SecureString -String '${adminFixture}' -AsPlainText -Force }`,"& (Join-Path $PSScriptRoot 'scripts/configure-integration-profile.ps1') -ProvisionRuntime",'exit $LASTEXITCODE'].join('\r\n'));
 const childEnv={...process.env};delete childEnv.VERCEL;const child=spawnSync('pwsh.exe',['-NoLogo','-NoProfile','-NonInteractive','-File',harness],{cwd:f.folder,env:childEnv,encoding:'utf8',timeout:30000});if(child.error?.code==='ENOENT'){t.skip('PowerShell7 not installed');return;}
 assert.equal(child.error,undefined);assert.equal(child.status,0,child.stdout+child.stderr);assert.match(child.stdout,/Configuration status: verified/);assert.ok(!(child.stdout+child.stderr).includes(adminFixture));assert.equal(await readFile(f.profilePath,'utf8'),f.content);await noBackup(f.folder);
});
