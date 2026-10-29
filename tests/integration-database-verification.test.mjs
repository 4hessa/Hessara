import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm}from'node:fs/promises';import{resolve,join,sep}from'node:path';
import{PGlite}from'@electric-sql/pglite';
import{prepareIntegrationRuntime}from'../scripts/prepare-integration-runtime.mjs';
import{runDatabaseVerificationCli,verifyIntegrationDatabase}from'../scripts/verify-integration-database.mjs';
import{readPrivateProfile}from'../scripts/provision-integration-runtime.mjs';
const root=resolve('.vercel');
async function profileFixture(t){const dir=await mkdtemp(join(root,'runtime-proof-'));t.after(async()=>{assert.ok(resolve(dir).startsWith(root+sep));await rm(dir,{recursive:true,force:true});});const profilePath=join(dir,'.env.integration.local');const values={HESSARA_TEST_PROJECT_REF:'lmhnyqtcfvgrcygsgqjg',NEXT_PUBLIC_SUPABASE_URL:'https://lmhnyqtcfvgrcygsgqjg.supabase.co',HESSARA_TEST_ISOLATED:'true',HESSARA_INTEGRATION_TEST:'true',HESSARA_TEST_URL:'http://127.0.0.1:5174',HESSARA_SITE_URL:'http://127.0.0.1:5174',HESSARA_ENCRYPTION_KEY:Buffer.alloc(32,7).toString('base64'),HESSARA_TEST_ATTESTATION_KEY:'fixture-attestation-key-not-used-live-123456789',DATABASE_URL:'',POSTGRES_URL:'',DATABASE_SSL_CA:'',HESSARA_TEST_EMAIL_A:'',HESSARA_TEST_PASSWORD_A:'',HESSARA_TEST_EMAIL_B:'',HESSARA_TEST_PASSWORD_B:''};await writeFile(profilePath,Object.entries(values).map(([key,value])=>key+'='+JSON.stringify(value)).join('\n'));assert.equal((await prepareIntegrationRuntime({profilePath,environment:{}})).prepared,true);return{profilePath,environment:{}};}
test('default runtime verification performs no network and does not imply Auth readiness',async t=>{const options=await profileFixture(t);let connected=0;const out=await runDatabaseVerificationCli({...options,args:[],connect(){connected++;throw Error('No connection expected');}});assert.equal(connected,0);assert.equal(out.exitCode,0);assert.equal(out.result.verified,false);assert.equal(out.result.networkAttempted,false);assert.equal(out.result.missingAuthFields.length,4);});
test('connection diagnostics are actionable and redact credentials and raw errors',async t=>{const options=await profileFixture(t);for(const[code,expected]of [['ENOTFOUND','DATABASE_HOST_UNRESOLVED'],['SELF_SIGNED_CERT_IN_CHAIN','DATABASE_TLS_VERIFICATION_FAILED'],['28P01','RUNTIME_AUTHENTICATION_FAILED'],['EACCES','NETWORK_ACCESS_DENIED']]){let closed=false;const result=await verifyIntegrationDatabase({...options,connect(){return{unsafe:async()=>{throw Object.assign(Error('private URL and password must not leak'),{code});},end:async()=>{closed=true;}};}});assert.equal(result.error,expected);assert.equal(result.diagnosticCode,code);assert.equal(result.verified,false);assert.equal(closed,true);assert.ok(!JSON.stringify(result).includes('private URL'));}});
test('actual SQL probe uses runtime ownership policies and rolls every fixture back',async t=>{
 const options=await profileFixture(t),pg=new PGlite();t.after(()=>pg.close());
 await pg.exec('CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE hessara_runtime LOGIN NOINHERIT NOBYPASSRLS;GRANT USAGE ON SCHEMA public TO hessara_runtime;CREATE TABLE public.runs(id text);GRANT SELECT ON public.runs TO hessara_runtime;');
 await pg.exec(await readFile(new URL('../supabase/reverse-engineering-draft.sql',import.meta.url),'utf8'));
 await pg.exec('SET SESSION AUTHORIZATION hessara_runtime');let closed=false;
 function adapter(client){return{unsafe:async(sql,values=[])=>{const r=await client.query(sql,values);return r.rows;},begin:work=>pg.transaction(tx=>work(adapter(tx))),savepoint:async work=>{await client.query('SAVEPOINT owned_probe');try{const value=await work(adapter(client));await client.query('RELEASE SAVEPOINT owned_probe');return value;}catch(error){await client.query('ROLLBACK TO SAVEPOINT owned_probe');await client.query('RELEASE SAVEPOINT owned_probe');throw error;}},end:async()=>{closed=true;}};}
 const result=await verifyIntegrationDatabase({...options,connect(_url,config){assert.equal(config.ssl.rejectUnauthorized,true);assert.equal(config.prepare,false);return adapter(pg);}});
 assert.equal(result.verified,true,JSON.stringify(result));assert.equal(result.authVerified,false);assert.equal(result.rollbackVerified,true);assert.equal(result.persistedFixtureRows,0);assert.equal(result.role,'hessara_runtime');assert.deepEqual(result.selectedOwnerPolicies,['re_projects']);assert.equal(closed,true);
 await pg.exec('RESET SESSION AUTHORIZATION');assert.equal((await pg.query('SELECT count(*)::int AS total FROM re_projects')).rows[0].total,0);
});

// Models an edit between the independent preflight and the connection snapshot.
test('the exact post-preflight profile snapshot is pinned again before any network connection',async t=>{
 const options=await profileFixture(t),valid=await readPrivateProfile(options.profilePath);
 const changes=[
  {DATABASE_URL:valid.DATABASE_URL.replace('aws-1-eu-central-1.pooler.supabase.com','unapproved.example.test')},
  {DATABASE_URL:valid.DATABASE_URL.replace('hessara_runtime.lmhnyqtcfvgrcygsgqjg','postgres.waaaxdjymuauknbcxskn')},
  {DATABASE_URL:valid.DATABASE_URL.replace(':6543/',':5432/')},
  {DATABASE_URL:valid.DATABASE_URL+'?sslmode=disable'},
  {DATABASE_URL:valid.DATABASE_URL.replace('/postgres','/other')},
  {HESSARA_TEST_PROJECT_REF:'waaaxdjymuauknbcxskn'},
  {NEXT_PUBLIC_SUPABASE_URL:'https://waaaxdjymuauknbcxskn.supabase.co'},
  {HESSARA_TEST_ISOLATED:'false'},
  {HESSARA_INTEGRATION_TEST:'false'},
  {POSTGRES_URL:'postgresql://forbidden.example.test/postgres'},
  {VERCEL:'1'},
 ];
 for(const changed of changes){let connected=0;const result=await verifyIntegrationDatabase({...options,readProfile:async()=>({...valid,...changed}),connect(){connected++;throw Error('must not connect');}});
  assert.equal(connected,0);assert.equal(result.error,'RUNTIME_PROFILE_TARGET_INVALID',JSON.stringify(Object.keys(changed)));assert.equal(result.networkAttempted,false);assert.equal(result.verified,false);
 }
});
