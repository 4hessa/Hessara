import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { createDatabase } from "../lib/postgres-database.ts";
import { safeReturnPath } from "../lib/return-path.ts";

test("PostgreSQL migration preserves private trials, atomic batches and execution locks", async () => {
  const pg = new PGlite();
  try {
    await pg.exec("CREATE ROLE anon; CREATE ROLE authenticated;");
    const migration = await readFile(new URL("../supabase/migrations/202609290001_hessara.sql", import.meta.url), "utf8");
    await pg.exec(migration);
    await pg.exec(migration); // Redeploys must be safe.
    const execute = client => async (sql, values) => {
      const result = await client.query(sql, values);
      return { rows: result.rows, count: result.affectedRows ?? result.rows.length };
    };
    const db = createDatabase(execute(pg), work => pg.transaction(tx => work(execute(tx))));
    const insert = (id, owner) => db.prepare("INSERT INTO runs(id,owner,name,mode,status,created_at,config,total) VALUES(?,?,?,'demo','running',?,'{}',4)")
      .bind(id, owner, "A ? and ' quote", new Date().toISOString());
    await insert("run-a", "alice").run();
    await insert("run-b", "bob").run();
    const result = await db.prepare("SELECT id,name FROM runs WHERE owner=? ORDER BY id").bind("alice").all();
    assert.deepEqual(result.results, [{ id: "run-a", name: "A ? and ' quote" }]);
    assert.equal(await db.prepare("SELECT id FROM runs WHERE id=? AND owner=?").bind("run-a", "bob").first(), null);
    assert.equal((await db.prepare("SELECT id FROM runs WHERE owner=?").bind("alice' OR 1=1 --").all()).results.length, 0);
    const now = Date.now();
    const lock = token => db.prepare("UPDATE runs SET lock_token=?,locked_until=? WHERE id=? AND owner=? AND locked_until<? RETURNING id")
      .bind(token, now + 120000, "run-a", "alice", now).first();
    assert.equal((await lock("worker-a")).id, "run-a");
    assert.equal(await lock("worker-b"), null);
    assert.equal((await db.prepare("SELECT locked_until FROM runs WHERE id=?").bind("run-a").first()).locked_until, now + 120000);
    const trial = id => db.prepare("INSERT INTO trials(id,run_id,model,task_id,repeat,status) VALUES(?,'run-a','sim-atlas','logic-001',0,'running')").bind(id);
    await assert.rejects(db.batch([
      trial("trial-a"),
      db.prepare("UPDATE runs SET next_index=1 WHERE id='run-a'"),
      trial("duplicate-trial"),
    ]));
    assert.equal((await db.prepare("SELECT count(*) AS n FROM trials").first()).n, 0);
    assert.equal((await db.prepare("SELECT next_index FROM runs WHERE id='run-a'").first()).next_index, 0);
    await db.batch([trial("trial-a"), db.prepare("UPDATE runs SET next_index=1 WHERE id='run-a'")]);
    assert.equal((await db.prepare("SELECT id FROM trials ORDER BY rowid LIMIT ? OFFSET ?").bind(250, 0).all()).results.length, 1);
    const denied = await pg.query("SELECT has_table_privilege('anon','public.runs','SELECT') AS guest, has_table_privilege('authenticated','public.model_profiles','SELECT') AS member");
    assert.deepEqual(denied.rows, [{ guest: false, member: false }]);
    const rls = await pg.query("SELECT relrowsecurity FROM pg_class WHERE oid='public.model_profiles'::regclass");
    assert.equal(rls.rows[0].relrowsecurity, true);
  } finally { await pg.close(); }
});

test("login redirects remain on the site and avoid authentication loops", () => {
  for (const path of [undefined, "https://evil.example", "//evil.example", "/\\evil.example", "/signin", "/signin-with-chatgpt", "/auth/callback", "/\n/evil.example"]) {
    assert.equal(safeReturnPath(path), "/");
  }
  assert.equal(safeReturnPath("/?tab=runs#report"), "/?tab=runs#report");
});

test("owner quota transactions keep run and profile limits, rollback, and release their locks", async () => {
  const pg = new PGlite();
  try {
    await pg.exec("CREATE ROLE anon; CREATE ROLE authenticated;");
    await pg.exec(await readFile(new URL("../supabase/migrations/202609290001_hessara.sql", import.meta.url), "utf8"));
    const execute = client => async (sql, values) => {
      const result = await client.query(sql, values);
      return { rows: result.rows, count: result.affectedRows ?? result.rows.length };
    };
    const db = createDatabase(execute(pg), work => pg.transaction(tx => work(execute(tx))));
    const run = (id, owner) => db.prepare(
      "INSERT INTO runs(id,owner,name,mode,status,created_at,config,total) SELECT ?,?,'quota-test','demo','running','2026-09-29','{}',4 WHERE (SELECT count(*) FROM runs WHERE owner=? AND status='running')<10"
    ).bind(id, owner, owner);
    const inspectLock = db.prepare("SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND pid=pg_backend_pid()) AS held");
    const inserted = await db.ownerQuotaBatch("alice", [inspectLock, ...Array.from({ length: 11 }, (_, i) => run(`a-${i}`, "alice"))]);
    assert.equal(inserted[0].results[0].held, true, "The quota writes must execute while the transaction owns its advisory lock");
    assert.deepEqual(inserted.slice(1).map(x => x.meta.changes), [...Array(10).fill(1), 0]);
    assert.equal((await inspectLock.first()).held, false, "Commit releases the transaction lock");
    assert.equal((await db.ownerQuotaBatch("bob", [run("b-0", "bob")]))[0].meta.changes, 1);
    await db.prepare("UPDATE runs SET status='completed' WHERE id='a-0'").run();
    assert.equal((await db.ownerQuotaBatch("alice", [run("a-replacement", "alice")]))[0].meta.changes, 1);
    await assert.rejects(db.ownerQuotaBatch("carol", [run("c-0", "carol"), run("c-0", "carol")]));
    assert.equal((await db.prepare("SELECT count(*) AS n FROM runs WHERE owner='carol'").first()).n, 0);
    assert.equal((await inspectLock.first()).held, false, "Rollback releases the lock as well");

    await pg.exec("INSERT INTO model_profiles(id,owner,name,provider,model,key_cipher,created_at) SELECT 'seed-' || n,'alice','seed','openai','test','not-a-secret','2026-09-29' FROM generate_series(1,99) n;");
    const profile = id => db.prepare("INSERT INTO model_profiles(id,owner,name,provider,model,key_cipher,created_at) SELECT ?,'alice','test','nvidia','test','not-a-secret','2026-09-29' WHERE (SELECT count(*) FROM model_profiles WHERE owner='alice')<100").bind(id);
    const profiles = await db.ownerQuotaBatch("alice", [profile("profile-last"), profile("profile-over-limit")]);
    assert.deepEqual(profiles.map(x => x.meta.changes), [1, 0]);
    assert.equal((await db.prepare("SELECT count(*) AS n FROM model_profiles WHERE owner='alice'").first()).n, 100);
    // PGlite uses one connection; multi-instance concurrency must also be checked on deployed PostgreSQL.
  } finally { await pg.close(); }
});
