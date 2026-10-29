import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { databaseBootstrapPlan, DATABASE_BOOTSTRAP_FILES, DATABASE_BOOTSTRAP_TABLES } from '../scripts/database-bootstrap-plan.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const script = fileURLToPath(new URL('../scripts/database-bootstrap-plan.mjs', import.meta.url));
const sentinel = 'never-public-service-credential-bootstrap-plan';
// The CLI must remain safe even if a caller already has real service configuration.
const tripwire = `import net from 'node:net';import http from 'node:http';import https from 'node:https';import fs from 'node:fs';import promises from 'node:fs/promises';
const deny=()=>{throw Error('OFFLINE_PLAN_SIDE_EFFECT');};globalThis.fetch=deny;net.Socket.prototype.connect=deny;http.request=deny;http.get=deny;https.request=deny;https.get=deny;
for(const name of ['writeFile','appendFile','mkdir','rename','unlink','rm']){fs[name]=deny;promises[name]=deny;}`;
function cli(args = []) {
  return spawnSync(process.execPath, ['--max-old-space-size=160', '--max-semi-space-size=2', '--v8-pool-size=1', '--import', 'data:text/javascript,' + encodeURIComponent(tripwire), script, ...args], {
    cwd: root, encoding: 'utf8', timeout: 15000, maxBuffer: 131072,
    env: { ...process.env, DATABASE_URL: `postgresql://postgres:${sentinel}@db.waaaxdjymuauknbcxskn.supabase.co:5432/postgres`, OPENAI_API_KEY: sentinel, SUPABASE_AUTH_SECRET_KEY: sentinel },
  });
}

test('offline bootstrap plan covers current migrations in dependency order and excludes the retired assistant migration', async () => {
  const plan = await databaseBootstrapPlan();
  assert.equal(plan.mode, 'offline-plan');assert.equal(plan.status, 'plan_only');assert.equal(plan.databaseConnectionAttempted, false);assert.equal(plan.databaseWrites, false);
  assert.equal(plan.approvedTestProjectRef, 'lmhnyqtcfvgrcygsgqjg');
  assert.deepEqual(plan.steps.map(step => step.file), [...DATABASE_BOOTSTRAP_FILES]);
  assert.deepEqual(plan.steps.map(step => step.order), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(plan.steps[1].purpose, 'runtime-role');
  const files = (await readdir(new URL('../supabase/migrations/', import.meta.url))).filter(name => name.endsWith('.sql') && name !== '20261019132915_hessara_persistent_chat.sql').sort();
  assert.deepEqual(plan.steps.filter(step => step.purpose === 'schema-migration').map(step => step.file.split('/').at(-1)), files, 'New migrations require explicit plan review');
  assert.ok(!plan.steps.some(step => step.file.endsWith('20261019132915_hessara_persistent_chat.sql')));
  for (const step of plan.steps) {
    const source = await readFile(new URL('../' + step.file, import.meta.url));
    assert.equal(step.sha256, createHash('sha256').update(source).digest('hex'));assert.equal(step.bytes, source.byteLength);
  }
});

test('default and --plan CLI stay offline and read-only despite inherited production credentials', () => {
  for (const args of [[], ['--plan']]) {
    const result = cli(args);assert.ifError(result.error);assert.equal(result.status, 0, result.stderr);
    const plan = JSON.parse(result.stdout);assert.equal(plan.mode, 'offline-plan');assert.equal(plan.steps.length, 8);assert.equal(plan.databaseWrites, false);
    assert.ok(!result.stdout.includes(sentinel));assert.ok(!result.stderr.includes(sentinel));assert.ok(!result.stdout.includes('waaaxdjymuauknbcxskn'));
    assert.ok(!('sql' in plan));assert.ok(plan.steps.every(step => !('sql' in step)));
  }
});

test('bootstrap CLI rejects apply and unknown options without side effects or credential reflection', () => {
  for (const args of [['--apply'], ['--plan', '--apply'], ['--plan', '--plan'], ['--database-url=' + sentinel]]) {
    const result = cli(args);assert.ifError(result.error);assert.equal(result.status, 2, result.stderr);assert.equal(result.stdout, '');
    const error = JSON.parse(result.stderr);assert.equal(error.error, 'UNSUPPORTED_ARGUMENT');assert.equal(error.databaseWrites, false);assert.ok(!result.stderr.includes(sentinel));
  }
});

test('current bootstrap has only protected live tables and enforces shared model-verification ownership', async () => {
  const pg = new PGlite();
  try {
    await pg.exec('CREATE ROLE anon; CREATE ROLE authenticated;');
    const plan = await databaseBootstrapPlan();
    await pg.transaction(async tx => {
      for (const step of plan.steps) await tx.exec(await readFile(new URL('../' + step.file, import.meta.url), 'utf8'));
    });
    const schema = await pg.query("SELECT c.relname AS name,c.relrowsecurity AS rls,c.relowner='hessara_runtime'::regrole AS runtime_owner FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' ORDER BY c.relname");
    assert.deepEqual(schema.rows.map(row => row.name), [...DATABASE_BOOTSTRAP_TABLES].sort());assert.equal(schema.rows.length, 23);assert.ok(schema.rows.every(row => row.rls && !row.runtime_owner));
    assert.ok(!schema.rows.some(row => row.name.startsWith('chat_')));
    const role = await pg.query("SELECT rolcanlogin,rolinherit,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls FROM pg_roles WHERE rolname='hessara_runtime'");
    assert.deepEqual(role.rows, [{ rolcanlogin: false, rolinherit: false, rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolreplication: false, rolbypassrls: false }]);
    assert.equal((await pg.query("SELECT count(*)::integer AS n FROM pg_auth_members WHERE roleid='hessara_runtime'::regrole OR member='hessara_runtime'::regrole")).rows[0].n, 0);
    const publicAccess = await pg.query("SELECT t.tablename,r.role,p.privilege,has_table_privilege(r.role,format('public.%I',t.tablename),p.privilege) AS allowed FROM pg_tables t CROSS JOIN (VALUES('anon'),('authenticated')) r(role) CROSS JOIN (VALUES('SELECT'),('INSERT'),('UPDATE'),('DELETE')) p(privilege) WHERE t.schemaname='public'");
    assert.equal(publicAccess.rows.length, 23 * 2 * 4);assert.ok(publicAccess.rows.every(row => !row.allowed));
    assert.equal((await pg.query("SELECT count(*)::integer AS n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) acl WHERE n.nspname='public' AND c.relkind='r' AND acl.grantee=0")).rows[0].n, 0);
    assert.deepEqual((await pg.query('SELECT id,enabled FROM re_engines ORDER BY id')).rows, ['angr','ghidra','jadx','mobsf','radare2','rea','rizin'].map(id => ({ id, enabled: false })));
    assert.deepEqual((await pg.query('SELECT accepting_jobs FROM re_settings WHERE id=1')).rows, [{ accepting_jobs: false }]);
    await pg.exec("BEGIN; SET LOCAL ROLE hessara_runtime; SELECT set_config('hessara.owner','bootstrap-owner-a',true);");
    try {
      assert.equal((await pg.query('SELECT current_user AS role,session_user AS session_role')).rows[0].role, 'hessara_runtime');
      await pg.query("INSERT INTO model_verifications(owner,model_id,fingerprint,checked_at,success) VALUES('bootstrap-owner-a','fixture-model','fixture',1,true)");
      assert.equal((await pg.query("SELECT count(*)::integer AS n FROM model_verifications WHERE model_id='fixture-model'")).rows[0].n, 1);
      await pg.query("SELECT set_config('hessara.owner','bootstrap-owner-b',true)");
      assert.equal((await pg.query("SELECT count(*)::integer AS n FROM model_verifications WHERE model_id='fixture-model'")).rows[0].n, 0);
      assert.deepEqual((await pg.query("UPDATE model_verifications SET success=false WHERE model_id='fixture-model' RETURNING model_id")).rows, []);
      await pg.exec('SAVEPOINT denied_owner_insert');
      await assert.rejects(pg.query("INSERT INTO model_verifications(owner,model_id,fingerprint,checked_at,success) VALUES('bootstrap-owner-a','denied','fixture',1,true)"), error => error.code === '42501');
      await pg.exec('ROLLBACK TO SAVEPOINT denied_owner_insert');
      await pg.query("SELECT set_config('hessara.owner','bootstrap-owner-a',true)");
      await pg.exec('SAVEPOINT denied_owner_reassignment');
      await assert.rejects(pg.query("UPDATE model_verifications SET owner='bootstrap-owner-b' WHERE model_id='fixture-model'"), error => error.code === '42501');
      await pg.exec('ROLLBACK TO SAVEPOINT denied_owner_reassignment');
    } finally { await pg.exec('ROLLBACK'); }
    assert.equal((await pg.query('SELECT count(*)::integer AS n FROM model_verifications')).rows[0].n, 0, 'All policy fixture writes were rolled back');
    assert.notEqual((await pg.query('SELECT current_user AS role')).rows[0].role, 'hessara_runtime', 'SET LOCAL ROLE did not escape the transaction');
    // PGlite is an embedded PostgreSQL fixture; this does not prove hosted Auth or pooler access.
  } finally { await pg.close(); }
});

test('retirement migration archives existing assistant rows without deleting them and revokes runtime access', async () => {
  const pg = new PGlite();
  try {
    await pg.exec('CREATE ROLE anon; CREATE ROLE authenticated;');
    const plan = await databaseBootstrapPlan();
    for (const step of plan.steps) await pg.exec(await readFile(new URL('../' + step.file, import.meta.url), 'utf8'));
    await pg.exec(await readFile(new URL('../supabase/migrations/20261019132915_hessara_persistent_chat.sql', import.meta.url), 'utf8'));
    await pg.exec("INSERT INTO chat_threads(id,owner,title,model_id,locale,created_at,updated_at) VALUES('archive-fixture','fixture-owner','kept','fixture-model','ar',1,1)");
    const retirement = await readFile(new URL('../supabase/migrations/202610290001_shared_model_verifications_and_assistant_archive.sql', import.meta.url), 'utf8');
    await pg.exec(retirement);
    assert.deepEqual((await pg.query("SELECT id,title FROM hessara_retired_assistant_chat_threads WHERE id='archive-fixture'")).rows, [{id: 'archive-fixture', title: 'kept'}]);
    assert.equal((await pg.query("SELECT to_regclass('public.chat_threads') AS active")).rows[0].active, null);
    assert.equal((await pg.query("SELECT to_regclass('public.model_verifications') IS NOT NULL AS present")).rows[0].present, true);
    await pg.exec('SET ROLE hessara_runtime');
    await assert.rejects(pg.query("SELECT * FROM hessara_retired_assistant_chat_threads"), error => error.code === '42501');
  } finally { await pg.close(); }
});
