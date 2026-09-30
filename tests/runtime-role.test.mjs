import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

test("runtime role supports application writes while denying public access and schema changes", async () => {
  const pg = new PGlite();
  const tables = ["runs", "trials", "model_profiles", "integration_exports", "decision_usage", "auth_limits"];
  const denied = sql => assert.rejects(pg.exec(sql), error => error.code === "42501");
  try {
    await pg.exec("CREATE ROLE anon; CREATE ROLE authenticated;");
    await pg.exec(await readFile(new URL("../supabase/migrations/202609290001_hessara.sql", import.meta.url), "utf8"));
    const provisioning = await readFile(new URL("../supabase/runtime-role.sql", import.meta.url), "utf8");
    await pg.exec(provisioning);
    await assert.rejects(pg.exec(provisioning), error => error.code === "42710", "Existing roles must be reviewed before reprovisioning");

    const role = await pg.query("SELECT rolcanlogin, rolinherit, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls FROM pg_roles WHERE rolname='hessara_runtime'");
    assert.deepEqual(role.rows, [{ rolcanlogin: false, rolinherit: false, rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolreplication: false, rolbypassrls: false }]);
    assert.equal((await pg.query("SELECT count(*)::integer AS n FROM pg_auth_members WHERE roleid='hessara_runtime'::regrole OR member='hessara_runtime'::regrole")).rows[0].n, 0);
    for (const table of tables) {
      const security = await pg.query("SELECT relrowsecurity, relowner='hessara_runtime'::regrole AS runtime_owner FROM pg_class WHERE oid=$1::regclass", [`public.${table}`]);
      assert.deepEqual(security.rows, [{ relrowsecurity: true, runtime_owner: false }]);
      for (const publicRole of ["anon", "authenticated"]) {
        for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
          assert.equal((await pg.query("SELECT has_table_privilege($1,$2,$3) AS allowed", [publicRole, `public.${table}`, privilege])).rows[0].allowed, false);
        }
      }
    }

    await pg.exec("SET ROLE hessara_runtime;");
    assert.equal((await pg.query("SELECT current_user")).rows[0].current_user, "hessara_runtime");
    await pg.transaction(async tx => {
      await tx.query("SELECT pg_advisory_xact_lock(hashtextextended('hessara-owner-quota:test-owner',0))");
      await tx.exec("INSERT INTO runs(id,owner,name,mode,status,created_at,config,total) VALUES('run','test-owner','permission test','demo','running','2026-09-30','{}',1)");
      const trial = await tx.query("INSERT INTO trials(id,run_id,model,task_id,repeat,status) VALUES('trial','run','simulation','task',0,'running') RETURNING rowid");
      assert.equal(Number(trial.rows[0].rowid), 1, "The runtime can generate a trial identity");
      await tx.exec("INSERT INTO model_profiles(id,owner,name,provider,model,key_cipher,created_at) VALUES('profile','test-owner','test','test','test','not-a-secret','2026-09-30')");
      await tx.exec("INSERT INTO integration_exports(id,owner,run_id,destination,status,created_at) VALUES('export','test-owner','run','test','pending','2026-09-30')");
      for (let n = 1; n <= 2; n++) {
        const usage = await tx.query("INSERT INTO decision_usage(owner,day,used) VALUES('test-owner','2026-09-30',1) ON CONFLICT(owner) DO UPDATE SET used=decision_usage.used+1 RETURNING used");
        const limiter = await tx.query("INSERT INTO auth_limits(bucket,expires_at,used) VALUES('test-bucket',1,1) ON CONFLICT(bucket) DO UPDATE SET used=auth_limits.used+1 RETURNING used");
        assert.equal(usage.rows[0].used, n);
        assert.equal(limiter.rows[0].used, n);
      }
      await tx.exec("UPDATE runs SET status='completed' WHERE id='run'; UPDATE trials SET status='done' WHERE id='trial'; UPDATE model_profiles SET name='updated' WHERE id='profile'; UPDATE integration_exports SET status='done' WHERE id='export';");
      for (const table of tables) {
        assert.equal((await tx.query(`SELECT count(*)::integer AS n FROM public.${table}`)).rows[0].n, 1);
      }
      for (const table of ["trials", "integration_exports", "runs", "model_profiles", "decision_usage", "auth_limits"]) {
        assert.equal((await tx.query(`DELETE FROM public.${table} RETURNING *`)).rows.length, 1);
      }
    });

    await denied("ALTER TABLE public.runs ADD COLUMN unauthorized text");
    await denied("CREATE TABLE public.unauthorized(id integer)");
    await denied("TRUNCATE public.runs");
    await denied("CREATE ROLE unauthorized");
    await pg.exec("RESET ROLE; SET ROLE anon;");
    for (const table of tables) await denied(`SELECT * FROM public.${table}`);
    await denied("INSERT INTO decision_usage(owner,day,used) VALUES('intruder','2026-09-30',1)");
    await pg.exec("RESET ROLE; SET ROLE authenticated;");
    for (const table of tables) await denied(`SELECT * FROM public.${table}`);
  } finally { await pg.close(); }
});
