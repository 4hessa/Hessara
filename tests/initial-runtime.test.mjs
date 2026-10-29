import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {initialRuntimeLoginSql,INITIAL_RUNTIME_PROJECT} from '../scripts/initial-integration-runtime.mjs';
import {runtimeScramVerifier} from '../scripts/provision-integration-runtime.mjs';
const verifier=runtimeScramVerifier('fixture-password-never-used-live-48-characters-1234');
async function fixture(t){const pg=new PGlite();t.after(()=>pg.close());await pg.exec('CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE hessara_runtime NOLOGIN NOINHERIT NOBYPASSRLS;CREATE SCHEMA supabase_migrations;REVOKE ALL ON SCHEMA supabase_migrations FROM PUBLIC;');return pg;}
async function state(pg){return(await pg.query("SELECT rolcanlogin,rolpassword,rolsuper,rolcreaterole,rolcreatedb,rolbypassrls,rolinherit,rolreplication FROM pg_authid WHERE rolname='hessara_runtime'")).rows[0];}
test('initial runtime SQL accepts only pinned project and an exact precomputed SCRAM shape',()=>{
 for(const value of [undefined,'',verifier+'\n',verifier+"'; SELECT 1; --",'plaintext-password'])assert.throws(()=>initialRuntimeLoginSql(value,INITIAL_RUNTIME_PROJECT),/INITIAL_RUNTIME_INPUT_INVALID/);
 for(const project of ['waaaxdjymuauknbcxskn','',undefined])assert.throws(()=>initialRuntimeLoginSql(verifier,project),/INITIAL_RUNTIME_INPUT_INVALID/);
 assert.ok(!initialRuntimeLoginSql(verifier,INITIAL_RUNTIME_PROJECT).includes('fixture-password'));
});
test('initial login stores the exact verifier without changing least-privilege flags and refuses rotation',async t=>{
 const pg=await fixture(t);const before=await state(pg);await pg.exec(initialRuntimeLoginSql(verifier,INITIAL_RUNTIME_PROJECT));const after=await state(pg);
 assert.equal(after.rolcanlogin,true);assert.equal(after.rolpassword,verifier);for(const name of ['rolsuper','rolcreaterole','rolcreatedb','rolbypassrls','rolinherit','rolreplication'])assert.equal(after[name],before[name]);
 await assert.rejects(pg.exec(initialRuntimeLoginSql(runtimeScramVerifier('another-fixture-password-long-enough-123456'),INITIAL_RUNTIME_PROJECT)),/INITIAL_RUNTIME_ALREADY_CONFIGURED/);assert.deepEqual(await state(pg),after);
});
test('preexisting nonlogin password and privileged runtime roles are left unchanged',async t=>{
 const pg=await fixture(t);await pg.exec("ALTER ROLE hessara_runtime PASSWORD 'existing-fixture-only'");let before=await state(pg);await assert.rejects(pg.exec(initialRuntimeLoginSql(verifier,INITIAL_RUNTIME_PROJECT)),/INITIAL_RUNTIME_ALREADY_CONFIGURED/);assert.deepEqual(await state(pg),before);
 await pg.exec('ALTER ROLE hessara_runtime PASSWORD NULL;ALTER ROLE hessara_runtime CREATEDB');before=await state(pg);await assert.rejects(pg.exec(initialRuntimeLoginSql(verifier,INITIAL_RUNTIME_PROJECT)),/INITIAL_RUNTIME_ROLE_PRIVILEGED/);assert.deepEqual(await state(pg),before);
});
test('unexpected parent or grantee memberships prevent login without grant changes',async t=>{
 const pg=await fixture(t);await pg.exec('CREATE ROLE fixture_parent;GRANT fixture_parent TO hessara_runtime;');const before=await state(pg);
 await assert.rejects(pg.exec(initialRuntimeLoginSql(verifier,INITIAL_RUNTIME_PROJECT)),/INITIAL_RUNTIME_MEMBERSHIP_INVALID/);assert.deepEqual(await state(pg),before);
});
test('migration schema visibility prevents persisting a verifier where runtime/public can read it',async t=>{
 const pg=await fixture(t);await pg.exec('GRANT USAGE ON SCHEMA supabase_migrations TO hessara_runtime');const before=await state(pg);
 await assert.rejects(pg.exec(initialRuntimeLoginSql(verifier,INITIAL_RUNTIME_PROJECT)),/INITIAL_RUNTIME_MIGRATION_EXPOSED/);assert.deepEqual(await state(pg),before);
});
test('existing administrator-only membership is accepted without expanding inheritance or SET',async t=>{
 const pg=await fixture(t);await pg.exec('GRANT hessara_runtime TO postgres WITH ADMIN TRUE,INHERIT FALSE,SET FALSE');
 const query="SELECT admin_option,inherit_option,set_option FROM pg_auth_members WHERE roleid=(SELECT oid FROM pg_roles WHERE rolname='hessara_runtime')";const before=(await pg.query(query)).rows;
 await pg.exec(initialRuntimeLoginSql(verifier,INITIAL_RUNTIME_PROJECT));assert.deepEqual((await pg.query(query)).rows,before);assert.equal((await state(pg)).rolcanlogin,true);
});
