import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { createHmac } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { APPROVED_PROFILE_PROJECT, VERIFIED_PROFILE_POOLER } from '../scripts/configure-integration-profile.mjs';
import { runtimeScramVerifier, provisionIntegrationRuntime, readRuntimeProvisionInput, runRuntimeProvisionCli } from '../scripts/provision-integration-runtime.mjs';

const runtimePassword = 'fixture-runtime-password-!@#-24';
const administratorPassword = 'fixture-administrator-%/@/#-password-24';
const accountPassword = 'fixture-account-password-24';
const runtimeUrl = `postgresql://${encodeURIComponent(`hessara_runtime.${APPROVED_PROFILE_PROJECT}`)}:${encodeURIComponent(runtimePassword)}@${VERIFIED_PROFILE_POOLER}:6543/postgres`;
function profileValues() {
 return { DATABASE_URL: runtimeUrl, POSTGRES_URL: '', DATABASE_SSL_CA: '', HESSARA_TEST_PROJECT_REF: APPROVED_PROFILE_PROJECT,
  NEXT_PUBLIC_SUPABASE_URL: `https://${APPROVED_PROFILE_PROJECT}.supabase.co`, HESSARA_TEST_ISOLATED: 'true', HESSARA_INTEGRATION_TEST: 'true',
  HESSARA_TEST_URL: 'http://127.0.0.1:5174', HESSARA_SITE_URL: 'http://127.0.0.1:5174', HESSARA_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString('base64'),
  HESSARA_TEST_ATTESTATION_KEY: 'fixture-attestation-key-'.repeat(3), HESSARA_TEST_EMAIL_A: 'fixture-a@example.test', HESSARA_TEST_EMAIL_B: 'fixture-b@example.test',
  HESSARA_TEST_PASSWORD_A: accountPassword, HESSARA_TEST_PASSWORD_B: accountPassword };
}
async function fixture(t, changes = {}) {
 const directory = await mkdtemp(join(tmpdir(), 'hessara-runtime-provision-'));
 assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep));
 t.after(async () => { assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep)); await rm(directory, { recursive: true, force: true }); });
 const profilePath = join(directory, '.env.integration.local'), profile = { ...profileValues(), ...changes };
 await writeFile(profilePath, Object.entries(profile).map(([key,value]) => key + '=' + JSON.stringify(value)).join('\n') + '\n', {mode:0o600});
 return { profilePath, profile, original: await readFile(profilePath, 'utf8') };
}
function mockConnections({ administratorIdentity, runtimeIdentity, roleChanges = {}, memberships = [], failAt, failureCode, login = false, afterAlter } = {}) {
 const connections = [], events = [], queries = [];
 const identity = role => [{ role, session_role: role, database: 'postgres' }];
 const role = { rolname: 'hessara_runtime', rolcanlogin: login, rolinherit: false, rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolreplication: false, rolbypassrls: false, ...roleChanges };
 function externalError(sql) { const error = new Error(`Sensitive upstream detail ${administratorPassword} ${runtimePassword} ${sql}`); error.code = failureCode; return error; }
 const connect = (url, options) => {
  const kind = connections.length ? 'runtime' : 'administrator'; connections.push({ kind, url, options }); events.push('connect:' + kind);
  const unsafe = async sql => {
   queries.push({kind,sql});events.push('sql:' + kind + ':' + (sql.startsWith('ALTER ROLE')?'alter':sql.includes('current_user')?'identity':sql.includes('pg_roles')?'role':sql.includes('pg_auth_members')?'memberships':sql.includes('advisory')?'lock':'probe'));
   if (failAt === 'alter' && sql.startsWith('ALTER ROLE')) throw externalError(sql);
   if (failAt === 'runtime' && kind === 'runtime') throw externalError(sql);
   if (sql.includes('current_user')) return kind === 'runtime' ? (runtimeIdentity ?? identity('hessara_runtime')) : (administratorIdentity ?? identity('postgres'));
   if (sql.includes('FROM pg_roles')) return roleChanges.missing ? [] : [role];
   if (sql.includes('FROM pg_auth_members')) return memberships;
   if (sql.startsWith('ALTER ROLE')) afterAlter?.(sql);
   return [];
  };
  return { unsafe, async begin(work) { events.push('begin');try { const result = await work({unsafe});events.push('commit');return result; } catch(error) {events.push('rollback');throw error;} }, async end() {events.push('end:' + kind);} };
 };
 return { connect,connections,events,queries };
}
function assertRedacted(value, extra = []) {
 const encoded = JSON.stringify(value);
 for (const secret of [administratorPassword, runtimePassword, accountPassword, encodeURIComponent(administratorPassword), encodeURIComponent(runtimePassword), ...extra]) assert.ok(!encoded.includes(secret));
 assert.ok(!encoded.includes('SCRAM-SHA-256$'));assert.ok(!encoded.includes('Sensitive upstream'));
}

test('client-generated SCRAM verifier matches the independent RFC7677 server-signature vector', () => {
 // RFC7677 section3 public test vector, not an application credential.
 const salt = Buffer.from('W22ZaJ0SNY7soEsUEjb6gQ==', 'base64');
 const verifier = runtimeScramVerifier('pencil', salt);
 const match = /^SCRAM-SHA-256\$4096:([^$]+)\$([^:]+):(.+)$/.exec(verifier); assert.ok(match);
 assert.equal(match[1], salt.toString('base64'));assert.equal(Buffer.from(match[2],'base64').length,32);
 const serverFirst = 'r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0,s=W22ZaJ0SNY7soEsUEjb6gQ==,i=4096';
 const auth = 'n=user,r=rOprNGfwEbeRWgbNEkqO,' + serverFirst + ',c=biws,r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0';
 assert.equal(createHmac('sha256',Buffer.from(match[3],'base64')).update(auth).digest('base64'),'6rriTRBi23WpRR/wtup+mMhUZUn/dB5nLTJRsjl95G4=');
 assert.notEqual(runtimeScramVerifier(runtimePassword),runtimeScramVerifier(runtimePassword),'Each verifier uses a new random16byte salt');
 assert.throws(()=>runtimeScramVerifier('كلمة مرور عربية'),e=>e.code==='RUNTIME_PASSWORD_ASCII_REQUIRED');
 assert.throws(()=>runtimeScramVerifier('pencil',Buffer.alloc(15)),e=>e.code==='SCRAM_SALT_INVALID');
});

test('default and explicit checks never read credentials or construct a connection', async t => {
 const value=await fixture(t);let connections=0,reads=0;
 for(const args of [[],['--check']]) {
  const result=await runRuntimeProvisionCli({args,profilePath:value.profilePath,environment:{DATABASE_URL:'production-must-not-be-used'},connect(){connections++;throw Error('Unexpected network');},input:{[Symbol.asyncIterator](){reads++;throw Error('Unexpected stdin');}}});
  assert.equal(result.exitCode,0);assert.equal(result.result.configured,true);assert.equal(result.result.verified,false);assert.equal(result.result.networkTested,false);assert.equal(result.result.databaseWrites,false);assertRedacted(result);
 }
 assert.equal(connections,0);assert.equal(reads,0);assert.equal(await readFile(value.profilePath,'utf8'),value.original);
});

test('bounded stdin rejects malformed, oversized, extra-property and unsupported secrets without reflection', async () => {
 const examples=[['','ADMINISTRATOR_INPUT_REQUIRED'],['{broken','ADMINISTRATOR_INPUT_INVALID'],[Buffer.from([255]),'ADMINISTRATOR_INPUT_INVALID'],['x'.repeat(8193),'ADMINISTRATOR_INPUT_TOO_LARGE'],[JSON.stringify({administratorPassword,extra:runtimePassword}),'ADMINISTRATOR_INPUT_INVALID'],[JSON.stringify({administratorPassword:'كلمة مرور إدارة'}),'ADMINISTRATOR_PASSWORD_ASCII_REQUIRED']];
 for(const [source,code] of examples) await assert.rejects(readRuntimeProvisionInput(Readable.from(source?[source]:[])),error=>error.code===code&&!error.message.includes(administratorPassword));
 const input=await readRuntimeProvisionInput(Readable.from([JSON.stringify({administratorPassword})]));assert.equal(input.administratorPassword,administratorPassword);
});

test('stdin deadline destroys stalled input and refuses terminal password entry', async () => {
 const stalled = new Readable({read(){}}); await assert.rejects(readRuntimeProvisionInput(stalled,{timeoutMs:20}),error=>error.code==='ADMINISTRATOR_INPUT_TIMED_OUT'); assert.equal(stalled.destroyed,true);
 const terminal=Readable.from([]);terminal.isTTY=true;await assert.rejects(readRuntimeProvisionInput(terminal),error=>error.code==='ADMINISTRATOR_INPUT_PIPE_REQUIRED');
});

test('invalid profile, target, arguments and hosted context fail before connecting', async t => {
 const value=await fixture(t);let connections=0;const connect=()=>{connections++;throw Error('No connection allowed');};
 for(const args of [['--password='+administratorPassword],['--apply','--check'],['--unknown']]) {
  const result=await runRuntimeProvisionCli({args,profilePath:value.profilePath,environment:{},connect});assert.equal(result.exitCode,2);assert.equal(result.result.error,'RUNTIME_ARGUMENT_INVALID');assertRedacted(result);
 }
 assert.equal((await provisionIntegrationRuntime({administratorPassword},{profilePath:value.profilePath,environment:{VERCEL:'1'},connect})).error,'LOCAL_CONFIGURATION_ONLY');
 const missing=await fixture(t,{HESSARA_TEST_EMAIL_A:''});assert.equal((await provisionIntegrationRuntime({administratorPassword},{profilePath:missing.profilePath,environment:{},connect})).error,'PRIVATE_PROFILE_NOT_CONFIGURED');
 for(const change of [{DATABASE_URL:runtimeUrl.replace(APPROVED_PROFILE_PROJECT,'waaaxdjymuauknbcxskn')},{DATABASE_URL:runtimeUrl.replace(VERIFIED_PROFILE_POOLER,'evil.example')},{DATABASE_URL:runtimeUrl.replace(':6543',':5432')},{DATABASE_URL:runtimeUrl+'?sslmode=disable'},{VERCEL:'1'},{HESSARA_INTEGRATION_TEST:'false'},{POSTGRES_URL:'postgresql://production.invalid/postgres'}]) {
  const result=await provisionIntegrationRuntime({administratorPassword},{profilePath:value.profilePath,environment:{},readProfile:async()=>({...value.profile,...change}),connect});assert.equal(result.verified,false);assert.equal(result.networkAttempted,false);assert.equal(result.error,'PROFILE_TARGET_NOT_APPROVED');assertRedacted(result);
 }
 const unicode={...value.profile,DATABASE_URL:runtimeUrl.replace(encodeURIComponent(runtimePassword),encodeURIComponent('كلمة-مرور-طويلة-للاختبار'))};
 assert.equal((await provisionIntegrationRuntime({administratorPassword},{profilePath:value.profilePath,environment:{},readProfile:async()=>unicode,connect})).error,'RUNTIME_PASSWORD_ASCII_REQUIRED');
 const invalidCa={...value.profile,DATABASE_SSL_CA:'not-a-certificate'};
 const invalidCertificate=await provisionIntegrationRuntime({administratorPassword},{profilePath:value.profilePath,environment:{},readProfile:async()=>invalidCa,connect});assert.equal(invalidCertificate.networkAttempted,false);assert.equal(invalidCertificate.error,'PROFILE_DATABASE_CA_INVALID');
 assert.equal(connections,0);
});

test('explicit provisioning changes only LOGIN plus SCRAM verifier and verifies a separate least-privilege connection', async t => {
 const value=await fixture(t);
 for(const login of [false,true]) {
  const mock=mockConnections({login});const result=await provisionIntegrationRuntime({administratorPassword},{profilePath:value.profilePath,environment:{DATABASE_URL:'production-ignored'},connect:mock.connect});
  assert.equal(result.status,'verified');assert.equal(result.verified,true);assert.equal(result.roleChange,'committed');assert.equal(mock.connections.length,2);assertRedacted(result);
  const admin=new URL(mock.connections[0].url),runtime=new URL(mock.connections[1].url);
  assert.equal(decodeURIComponent(admin.username),'postgres.'+APPROVED_PROFILE_PROJECT);assert.equal(decodeURIComponent(admin.password),administratorPassword);assert.equal(admin.hostname,VERIFIED_PROFILE_POOLER);assert.equal(admin.port,'6543');assert.equal(admin.pathname,'/postgres');
  assert.equal(decodeURIComponent(runtime.username),'hessara_runtime.'+APPROVED_PROFILE_PROJECT);assert.equal(decodeURIComponent(runtime.password),runtimePassword);
  for(const connection of mock.connections) {assert.deepEqual(connection.options.ssl,{rejectUnauthorized:true});assert.equal(connection.options.max,1);assert.equal(connection.options.prepare,false);assert.equal(connection.options.connect_timeout,10);assert.equal(connection.options.idle_timeout,5);assert.equal(connection.options.debug,false);assert.equal(connection.options.connection.statement_timeout,'10000');}
  const changes=mock.queries.filter(query=>/^ALTER ROLE/.test(query.sql));assert.equal(changes.length,1);assert.match(changes[0].sql,/^ALTER ROLE hessara_runtime LOGIN PASSWORD 'SCRAM-SHA-256\$4096:[A-Za-z0-9+/]{22}==\$[A-Za-z0-9+/]{43}=:[A-Za-z0-9+/]{43}='$/);
  for(const query of mock.queries){assert.ok(!query.sql.includes(administratorPassword));assert.ok(!query.sql.includes(runtimePassword));assert.ok(!/^\s*(CREATE|DROP|INSERT|UPDATE|DELETE|GRANT|REVOKE)\b/i.test(query.sql));}
  assert.ok(mock.events.indexOf('commit')<mock.events.indexOf('connect:runtime'));assert.ok(mock.events.indexOf('end:administrator')<mock.events.indexOf('connect:runtime'));
  assert.equal(mock.queries.at(-1).sql,'SELECT id FROM public.runs LIMIT 0');assert.equal(mock.events.at(-1),'end:runtime');
 }
 assert.equal(await readFile(value.profilePath,'utf8'),value.original,'Provisioning never modifies the private profile');
});

test('wrong administrator identities or privileged/member runtime roles cannot reach ALTER ROLE', async t => {
 const value=await fixture(t);
 const cases=[{administratorIdentity:[{role:'postgres',session_role:'another_admin',database:'postgres'}]}, {administratorIdentity:[{role:'postgres',session_role:'postgres',database:'other'}]}, {roleChanges:{missing:true}},...['rolinherit','rolsuper','rolcreatedb','rolcreaterole','rolreplication','rolbypassrls'].map(attribute=>({roleChanges:{[attribute]:true}})),{memberships:[{granted_role:'dangerous_role',member_role:'hessara_runtime',admin_option:false,inherit_option:true,set_option:true}]}];
 for(const setup of cases){const mock=mockConnections(setup);const result=await provisionIntegrationRuntime({administratorPassword},{profilePath:value.profilePath,environment:{},connect:mock.connect});assert.equal(result.verified,false);assert.equal(result.roleChange,'not_attempted');assert.equal(mock.connections.length,1);assert.ok(!mock.queries.some(query=>query.sql.startsWith('ALTER ROLE')));assert.ok(mock.events.includes('rollback'));assert.equal(mock.events.at(-1),'end:administrator');assertRedacted(result);}
});

test('Supabase postgres ADMIN-only membership is accepted while expanded and unrelated grants are refused', async t => {
 const value=await fixture(t), expected={granted_role:'hessara_runtime',member_role:'postgres',admin_option:true,inherit_option:false,set_option:false};
 const safe=mockConnections({memberships:[expected]});const verified=await provisionIntegrationRuntime({administratorPassword},{profilePath:value.profilePath,environment:{},connect:safe.connect});assert.equal(verified.verified,true);assert.equal(safe.connections.length,2);
 const dangerous=[[{...expected,inherit_option:true}],[{...expected,set_option:true}],[{...expected,admin_option:false}],[{...expected,member_role:'authenticator'}],[{...expected,granted_role:'privileged_parent',member_role:'hessara_runtime'}],[expected,{...expected,member_role:'another_user'}],[expected,expected]];
 for(const memberships of dangerous){const mock=mockConnections({memberships});const result=await provisionIntegrationRuntime({administratorPassword},{profilePath:value.profilePath,environment:{},connect:mock.connect});assert.equal(result.verified,false);assert.equal(result.error,'RUNTIME_ROLE_MEMBERSHIPS_REQUIRE_REVIEW');assert.equal(result.roleChange,'not_attempted');assert.ok(!mock.queries.some(query=>query.sql.startsWith('ALTER ROLE')));assert.equal(mock.connections.length,1);assertRedacted(result);}
 assert.ok(safe.queries.every(query=>!/^\s*(GRANT|REVOKE)\b/i.test(query.sql)));
});

test('upstream timeout, permission and runtime verification errors never become success or reveal SQL/secrets', async t => {
 const value=await fixture(t);
 for(const [setup,expected,state] of [[{failAt:'alter',failureCode:'42501'},'RUNTIME_PROVISION_PERMISSION_DENIED','unknown'],[{failAt:'alter',failureCode:'ETIMEDOUT'},'DATABASE_OPERATION_TIMED_OUT','unknown'],[{failAt:'runtime',failureCode:'28P01'},'RUNTIME_AUTHENTICATION_FAILED','committed'],[{runtimeIdentity:[{role:'hessara_runtime',session_role:'postgres',database:'postgres'}]},'RUNTIME_DATABASE_IDENTITY_INVALID','committed']]) {
  const mock=mockConnections(setup);const result=await provisionIntegrationRuntime({administratorPassword},{profilePath:value.profilePath,environment:{},connect:mock.connect});assert.equal(result.status,'failed');assert.equal(result.verified,false);assert.equal(result.error,expected);assert.equal(result.roleChange,state);assertRedacted(result);
 }
 const result=await runRuntimeProvisionCli({args:['--apply'],profilePath:value.profilePath,environment:{},input:Readable.from([JSON.stringify({administratorPassword})]),connect(){throw Error('Sensitive upstream detail '+administratorPassword);}});assert.equal(result.exitCode,2);assert.equal(result.result.verified,false);assertRedacted(result);
});

test('PostgreSQL accepts the generated verifier as-is without storing fixture plaintext', async () => {
 const pg=new PGlite();try {
  const verifier=runtimeScramVerifier(runtimePassword);await pg.exec('CREATE ROLE runtime_fixture NOLOGIN NOINHERIT NOBYPASSRLS');
  await pg.exec(`ALTER ROLE runtime_fixture LOGIN PASSWORD '${verifier}'`);
  const rows=await pg.query("SELECT rolcanlogin,rolpassword FROM pg_authid WHERE rolname='runtime_fixture'");assert.equal(rows.rows[0].rolcanlogin,true);assert.equal(rows.rows[0].rolpassword,verifier);assert.ok(!rows.rows[0].rolpassword.includes(runtimePassword));
  // Embedded catalog test only: no hosted authentication or pooler request occurs.
 }finally{await pg.close();}
});
