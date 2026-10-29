import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { createDatabase } from "../lib/postgres-database.ts";
import { createReverseEngineeringService } from "../lib/reverse-engineering/service.ts";
import { createReverseEngineeringQueue } from "../lib/reverse-engineering/queue.ts";
import { validateOptions, validateResult } from "../lib/reverse-engineering/validation.ts";
import { compatibleEngines, recommendEngines } from "../lib/reverse-engineering/catalog.ts";

test("reverse engineering database persists jobs and enforces isolation, leases, quotas and recovery", async () => {
  const pg = new PGlite();
  const execute = client => async (sql, values) => { const result = await client.query(sql, values); return { rows: result.rows, count: result.affectedRows ?? result.rows.length }; };
  try {
    await pg.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE hessara_runtime NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS; GRANT USAGE ON SCHEMA public TO hessara_runtime;");
    const migration = await readFile(new URL("../supabase/reverse-engineering-draft.sql", import.meta.url), "utf8");
    await pg.exec(migration); await pg.exec(migration);
    await pg.exec(await readFile(new URL("../supabase/migrations/20261018053252_reverse_engineering_intake_closed.sql", import.meta.url), "utf8"));
    await pg.exec("SET ROLE hessara_runtime");
    const db = createDatabase(execute(pg), work => pg.transaction(tx => work(execute(tx))));
    const service = createReverseEngineeringService(db), queue = createReverseEngineeringQueue(db);
    const owner = "alice", other = "bob";
    const alice = await service.createProject(owner, { name: "Authorized sample" });
    const bob = await service.createProject(other, { name: "Private sample" });
    assert.equal((await service.listProjects(owner)).length, 1);
    assert.equal((await service.listProjects(other))[0].id, bob.id);
    await assert.rejects(service.renameProject(other, alice.id, { name: "No" }), /NOT_FOUND/);
    assert.equal((await db.scopedBatch(other, [db.prepare("SELECT * FROM re_projects WHERE id=?").bind(alice.id)]))[0].results.length, 0, "RLS blocks a missing SQL owner predicate as well");
    assert.equal((await db.prepare("SELECT * FROM re_projects").all()).results.length, 0, "Transaction-local identity cannot leak into the pooled connection");
    const empty = await service.overview(owner);
    assert.equal(empty.projects, 1); assert.equal(empty.activeJobs, 0); assert.equal(empty.availableEngines, 0);
    assert.equal(empty.engines.length, 7); assert.ok(empty.engines.every(engine => !engine.available));
    await assert.rejects(service.reserveArtifact(owner, { projectId: alice.id, name: "../bad", sizeBytes: 12, storageKey: "alice/bad" }), /INVALID_FILE_NAME/);
    await assert.rejects(service.reserveArtifact(owner, { projectId: bob.id, name: "safe.elf", sizeBytes: 20, storageKey: "alice/no" }), /STORAGE_QUOTA/);
    const artifact = await service.reserveArtifact(owner, { projectId: alice.id, name: "safe.elf", sizeBytes: 128, storageKey: "alice/safe" });
    await service.completeArtifact(owner, artifact.id, { format: "elf", sha256: "a".repeat(64), metadata: { safeTest: true } });
    await assert.rejects(service.getArtifact(other, artifact.id), /NOT_FOUND/);
    const request = (key = "job-one") => ({ projectId: alice.id, artifactId: artifact.id, engineId: "rizin", options: { strings: true }, authorizationConfirmed: true, idempotencyKey: key });
    await assert.rejects(service.createJob(owner, { ...request(), authorizationConfirmed: false }), /AUTHORIZATION_REQUIRED/);
    await assert.rejects(service.createJob(owner, request()), /ENGINE_UNAVAILABLE/);
    await assert.rejects(service.configure(owner, false, { engineId: "rizin", enabled: true }), /ADMIN_REQUIRED/);
    await service.configure(owner, true, { engineId: "rizin", enabled: true });
    assert.equal((await service.engines(owner)).find(x => x.id === "rizin").available, false, "A flag does not imply a running tool");
    // Contract fixture only, not proof that a real engine was run by this test.
    const workerVerification = { passed: true, imageDigest: `registry.example/test@sha256:${"a".repeat(64)}`, engineVersion: "test-version", artifactSha256: "b".repeat(64), verifiedAt: Date.now() - 1000 };
    const worker = { workerId: "worker-one", engines: [{ id: "rizin", version: "test-version", healthy: true, enabled: true, capacity: 1, capabilities: ["functions", "symbols", "strings", "dependencies"], verification: workerVerification }], capacity: { slots: 1, cpuCount: 1, availableMemoryMb: 4096, diskFreeMb: 4096 } };
    await queue.registerWorker(worker);
    assert.equal((await service.engines(owner)).find(x => x.id === "rizin").operationalStatus, "maintenance", "Closed intake cannot advertise availability");
    await service.configure(owner, true, { acceptingJobs: true });
    assert.equal((await service.engines(owner)).find(x => x.id === "rizin").available, true);
    const lowWorker = { ...worker, workerId: "worker-low", capacity: { ...worker.capacity, availableMemoryMb: 0 } };
    await queue.registerWorker(lowWorker);
    assert.equal((await service.engines(owner)).find(x => x.id === "rizin").available, true, "A newer resource-starved worker cannot mask an older viable worker");
    for (const [label, engine, capacity] of [
      ["missing-version", { ...worker.engines[0], version: null, verification: null }, worker.capacity],
      ["blank-version", { ...worker.engines[0], version: "   ", verification: null }, worker.capacity],
      ["worker-disabled", { ...worker.engines[0], enabled: false }, worker.capacity],
      ["worker-unspecified", { ...worker.engines[0], enabled: undefined }, worker.capacity],
      ["engine-capacity", { ...worker.engines[0], capacity: 0 }, worker.capacity],
      ["missing-proof", { ...worker.engines[0], verification: null }, worker.capacity],
      ["missing-capabilities", { ...worker.engines[0], capabilities: [] }, worker.capacity],
      ["missing-cpu", worker.engines[0], { ...worker.capacity, cpuCount: 0 }],
    ]) {
      await queue.registerWorker({ ...worker, engines: [engine], capacity });
      assert.equal((await service.engines(owner)).find(x => x.id === "rizin").available, false, label);
      await assert.rejects(service.createJob(owner, request(`rejected-${label}`)), /ENGINE_UNAVAILABLE/, label);
    }
    for (const [label, engines, capacity] of [
      ["old-engine-map", {}, worker.capacity],
      ["old-engine-scalar", "broken", worker.capacity],
      ["old-bad-capacity", [{ ...worker.engines[0], capacity: {} }], worker.capacity],
      ["old-string-capacity", [{ ...worker.engines[0], capacity: "1" }], worker.capacity],
      ["old-string-healthy", [{ ...worker.engines[0], healthy: "true" }], worker.capacity],
      ["old-bad-slots", worker.engines, { ...worker.capacity, slots: "unknown" }],
      ["old-large-cpu", worker.engines, { ...worker.capacity, cpuCount: 1e100 }],
      ["old-object-memory", worker.engines, { ...worker.capacity, availableMemoryMb: {} }],
      ["old-string-memory", worker.engines, { ...worker.capacity, availableMemoryMb: "4096" }],
    ]) {
      await db.batch([db.prepare("SELECT set_config('hessara.re_worker','true',true)"), db.prepare("UPDATE re_workers SET engines=?::jsonb,capacity=?::jsonb,heartbeat_at=? WHERE id=?").bind(JSON.stringify(engines), JSON.stringify(capacity), Date.now(), worker.workerId)]);
      assert.equal((await service.engines(owner)).find(x => x.id === "rizin").available, false, `${label}: malformed legacy data must not crash discovery`);
      await assert.rejects(service.createJob(owner, request(label)), /ENGINE_UNAVAILABLE/, `${label}: malformed legacy data must not crash admission`);
    }
    await assert.rejects(queue.registerWorker({ ...worker, engines: [{ ...worker.engines[0], verification: { ...workerVerification, engineVersion: "different" } }] }), /INVALID_WORKER_VERIFICATION/);
    await queue.registerWorker(worker);
    const first = await service.createJob(owner, request());
    assert.equal(first.status, "queued"); assert.equal(first.leaseToken, undefined);
    assert.equal((await service.createJob(owner, request())).id, first.id);
    await assert.rejects(service.createJob(owner, { ...request(), options: { symbols: true } }), /IDEMPOTENCY_CONFLICT/);
    const second = await service.createJob(owner, request("job-two"));
    await assert.rejects(service.createJob(owner, request("job-three")), /QUEUE_CAPACITY/);
    assert.equal((await queue.claim({ ...worker, workerId: "worker-disabled-claim", engines: [{ ...worker.engines[0], enabled: false }] })).job, null, "A disabled worker cannot lease already queued work");
    assert.equal((await queue.claim({ ...worker, workerId: "worker-unverified-claim", engines: [{ ...worker.engines[0], verification: null }] })).job, null, "An unverified worker cannot lease already queued work");
    assert.equal((await queue.claim({ ...worker, workerId: "worker-no-cpu-claim", capacity: { ...worker.capacity, cpuCount: 0 } })).job, null, "A worker without measured CPU cannot lease work");
    const lease = await queue.claim(worker);
    assert.equal(lease.job.id, first.id); assert.equal(lease.job.artifact.sha256, "a".repeat(64));
    assert.equal(lease.job.expectedEngineVersion, "test-version"); assert.equal(lease.job.expectedImageDigest, workerVerification.imageDigest);
    assert.equal((await service.getJob(owner, first.id)).metadata.executionIdentity.engineVersion, "test-version");
    assert.equal(JSON.stringify((await service.getJob(owner, first.id)).metadata).includes(workerVerification.imageDigest), false, "Private registry identity is retained internally but never returned in owner metadata");
    const processing = (await service.engines(other)).find(x => x.id === "rizin");
    assert.equal(processing.operationalStatus, "processing"); assert.equal(processing.activeJobs, 1);
    assert.equal(JSON.stringify(processing).includes(first.id), false, "Shared engine status exposes only aggregate counts, not another owner's job identifiers");
    await service.configure(owner, true, { acceptingJobs: false });
    assert.equal((await service.engines(owner)).find(x => x.id === "rizin").available, false);
    await assert.rejects(service.createJob(owner, request("intake-paused")), /ENGINE_UNAVAILABLE/);
    await service.configure(owner, true, { acceptingJobs: true });
    assert.equal((await queue.claim(worker)).job, null, "Per-worker and per-user concurrency are enforced");
    const heartbeat = { workerId: worker.workerId, jobId: first.id, leaseToken: lease.leaseToken, stage: "strings", capacity: worker.capacity, metrics: { memoryMb: 100 }, logs: [{ level: "info", message: "Safe static test" }] };
    assert.equal((await queue.heartbeat(heartbeat)).cancelRequested, false);
    assert.equal((await service.evidence(owner, first.id, { kind: "log" })).length, 1);
    await queue.heartbeat({ ...heartbeat, capacity: undefined, logs: [] });
    const unmeasuredBusy = (await service.engines(owner)).find(x => x.id === "rizin");
    assert.equal(unmeasuredBusy.operationalStatus, "processing"); assert.equal(unmeasuredBusy.available, false, "A busy lease heartbeat cannot make old host capacity current");
    await assert.rejects(queue.heartbeat({ ...heartbeat, capacity: { ...worker.capacity, availableMemoryMb: "unknown" } }), /INVALID_WORKER_CAPACITY/);
    await queue.heartbeat({ ...heartbeat, logs: [] });
    assert.equal((await service.evidence(other, first.id)).length, 0);
    await assert.rejects(queue.heartbeat({ ...heartbeat, leaseToken: "wrong-token" }), /LEASE_LOST/);
    const result = { engineId: "rizin", engineVersion: "test-version", summary: "Structured safe sample", evidence: [{ id: "e-1", kind: "string", name: "greeting", content: "Hello" }], findings: [{ title: "Greeting", description: "A string was found", confidence: "confirmed", evidenceIds: ["e-1"] }], functions: [{ name: "main", address: "0x1000" }], strings: [{ value: "Hello" }], files: [{ path: "main.c", language: "c", content: "int main() { return 0; }" }], metrics: { cpuSeconds: 0.01, durationMs: 10 } };
    await queue.registerWorker({ ...worker, engines: [{ ...worker.engines[0], version: "next-version", verification: { ...workerVerification, engineVersion: "next-version" } }] });
    await assert.rejects(queue.complete({ ...heartbeat, result: { ...result, engineVersion: "next-version" } }), /LEASE_LOST/, "A fresh registration cannot change the engine version fenced into an active lease");
    assert.equal((await service.findings(owner, first.id)).length, 0, "Version mismatch cannot publish partial results");
    await assert.rejects(queue.complete({ ...heartbeat, result: { ...result, findings: [{ title: "Unsupported claim", description: "No evidence", evidenceIds: ["missing"] }] } }), /MISSING_EVIDENCE/);
    assert.equal((await service.findings(owner, first.id)).length, 0, "Invalid result publication is atomic");
    assert.equal((await queue.complete({ ...heartbeat, result })).status, "completed");
    await queue.registerWorker(worker);
    assert.equal((await service.getJob(owner, first.id)).status, "completed");
    assert.equal((await service.findings(owner, first.id))[0].evidenceIds[0], "e-1");
    assert.equal((await service.evidence(owner, first.id, { kind: "code", limit: 1 }))[0].name, "main.c");
    await assert.rejects(queue.complete({ ...heartbeat, result }), /LEASE_LOST/);
    const report = await service.createReport(owner, first.id, { format: "json" });
    assert.equal((await service.getReport(owner, report.id)).jobId, first.id);
    await assert.rejects(service.getReport(other, report.id), /NOT_FOUND/);
    const nextLease = await queue.claim(worker); assert.equal(nextLease.job.id, second.id);
    await service.cancelJob(owner, second.id);
    assert.equal((await queue.heartbeat({ ...heartbeat, jobId: second.id, leaseToken: nextLease.leaseToken })).cancelRequested, true);
    assert.equal((await queue.fail({ workerId: worker.workerId, jobId: second.id, leaseToken: nextLease.leaseToken, code: "CANCELLED" })).status, "cancelled");
    const third = await service.createJob(owner, request("job-recover"));
    const lost = await queue.claim(worker); assert.equal(lost.job.id, third.id);
    await db.scopedBatch(owner, [db.prepare("UPDATE re_jobs SET lease_until=? WHERE id=?").bind(Date.now() - 1000, third.id)]);
    await queue.recover();
    assert.equal((await service.getJob(owner, third.id)).status, "queued");
    await assert.rejects(queue.complete({ workerId: worker.workerId, jobId: third.id, leaseToken: lost.leaseToken, result }), /LEASE_LOST/);
    await db.scopedBatch(owner, [db.prepare("UPDATE re_jobs SET available_at=? WHERE id=?").bind(0, third.id)]);
    const retryLease = await queue.claim(worker); assert.equal(retryLease.job.id, third.id);
    await db.scopedBatch(owner, [db.prepare("UPDATE re_jobs SET deadline_at=?,lease_until=? WHERE id=?").bind(Date.now() - 100, Date.now() - 100, third.id)]);
    await queue.recover(); assert.equal((await service.getJob(owner, third.id)).status, "timed_out");
    const fourth = await service.createJob(owner, request("job-failure")); const failed = await queue.claim(worker);
    await queue.fail({ workerId: worker.workerId, jobId: fourth.id, leaseToken: failed.leaseToken, code: "INVALID_ARTIFACT", message: "Malformed", retryable: true });
    assert.equal((await service.getJob(owner, fourth.id)).status, "failed", "Deterministic failures cannot retry even if a worker requests one");
    await service.configure(owner, true, { acceptingJobs: false });
    await assert.rejects(service.createJob(owner, request("kill-switch")), /QUEUE_CAPACITY/);
    assert.equal((await queue.claim(worker)).job, null);
    const usage = await service.overview(owner); assert.equal(usage.completedJobs, 1); assert.equal(usage.usage.find(x => x.event === "analysis").quantity, 1);
    assert.ok((await service.adminOverview(owner, true)).workers.length);
    await service.configure(owner, true, { acceptingJobs: true });
    const bobArtifact = await service.reserveArtifact(other, { projectId: bob.id, name: "bob.elf", sizeBytes: 128, storageKey: "bob/static" });
    await service.completeArtifact(other, bobArtifact.id, { sha256: "b".repeat(64), format: "elf" });
    await db.batch([db.prepare("SELECT set_config('hessara.re_worker','true',true)"), db.prepare("UPDATE re_settings SET max_upload_bytes=128,max_global_storage_bytes=256 WHERE id=1")]);
    await assert.rejects(service.reserveArtifact(owner, { projectId: alice.id, name: "over-global.elf", sizeBytes: 1, storageKey: "alice/over-global" }), /STORAGE_QUOTA/, "Global storage reservations include another owner's private artifacts through RLS");
    await db.batch([db.prepare("SELECT set_config('hessara.re_worker','true',true)"), db.prepare("UPDATE re_settings SET max_upload_bytes=52428800,max_global_storage_bytes=524288000 WHERE id=1")]);
    const tinyOne = await service.reserveArtifact(owner, { projectId: alice.id, name: "tiny-one.elf", sizeBytes: 1, storageKey: "alice/tiny-one" });
    const tinyTwo = await service.reserveArtifact(owner, { projectId: alice.id, name: "tiny-two.elf", sizeBytes: 1, storageKey: "alice/tiny-two" });
    assert.equal(tinyOne.reservedBytes, 52428800, "A signed token reserves the actual maximum upload rather than the claimed one-byte size");
    assert.equal((await service.overview(owner)).reservedStorageBytes, 104857600);
    assert.equal((await service.overview(owner)).chargedStorageBytes, 104857728);
    await assert.rejects(service.reserveArtifact(owner, { projectId: alice.id, name: "tiny-three.elf", sizeBytes: 1, storageKey: "alice/tiny-three" }), /STORAGE_QUOTA/, "At most two outstanding unverified signed tokens per owner");
    const validations = await Promise.allSettled([service.claimArtifactVerification(owner, tinyOne.id), service.claimArtifactVerification(owner, tinyOne.id)]);
    assert.equal(validations.filter(item => item.status === "fulfilled").length, 1, "Only one request acquires the validation lease");
    const verification = validations.find(item => item.status === "fulfilled").value;
    assert.equal((await service.getArtifact(owner, tinyOne.id)).validationToken, undefined, "The private validation capability is never returned in artifact DTOs");
    const bobTiny = await service.reserveArtifact(other, { projectId: bob.id, name: "bob-tiny.elf", sizeBytes: 1, storageKey: "bob/tiny" });
    await assert.rejects(service.claimArtifactVerification(other, bobTiny.id), /ARTIFACT_BUSY/, "The global validation slot includes another owner's active lease");
    await assert.rejects(service.completeArtifact(owner, tinyOne.id, { sha256: "c".repeat(64), format: "elf", verificationToken: "wrong-token" }), /NOT_FOUND/);
    await service.releaseArtifactVerification(owner, tinyOne.id, verification.verificationToken);
    const replacementVerification = await service.claimArtifactVerification(owner, tinyOne.id);
    await assert.rejects(service.completeArtifact(owner, tinyOne.id, { sha256: "c".repeat(64), format: "elf", verificationToken: verification.verificationToken }), /NOT_FOUND/, "An old validation token cannot publish after reassignment");
    await service.rejectArtifact(owner, tinyOne.id, "ARTIFACT_SIZE_MISMATCH", replacementVerification.verificationToken);
    await service.rejectArtifact(owner, tinyTwo.id, "INVALID_ARTIFACT");
    await service.rejectArtifact(other, bobTiny.id, "INVALID_ARTIFACT");
    assert.equal((await service.overview(owner)).reservedStorageBytes, 104857600, "Rejected uploads retain their signed-token charge until expiry and physical purge");
    await assert.rejects(service.reserveArtifact(owner, { projectId: alice.id, name: "tiny-four.elf", sizeBytes: 1, storageKey: "alice/tiny-four" }), /STORAGE_QUOTA/);
    const bobRequest = { ...request("bob-one"), projectId: bob.id, artifactId: bobArtifact.id };
    await db.batch([db.prepare("SELECT set_config('hessara.re_worker','true',true)"), db.prepare("UPDATE re_settings SET max_global_queued=1 WHERE id=1")]);
    const globalQueued = await service.createJob(owner, request("global-one"));
    await assert.rejects(service.createJob(other, bobRequest), /QUEUE_CAPACITY/, "Global backpressure must see jobs owned by other users through RLS");
    await service.cancelJob(owner, globalQueued.id);
    const bobQueued = await service.createJob(other, bobRequest);
    const bobLease = await queue.claim(worker); assert.equal(bobLease.job.id, bobQueued.id);
    const alicePending = await service.createJob(owner, request("global-active"));
    const secondWorker = { ...worker, workerId: "worker-two" };
    assert.equal((await queue.claim(secondWorker)).job, null, "The measured initial global capacity is one even with two healthy workers");
    await queue.fail({ jobId: bobQueued.id, workerId: worker.workerId, leaseToken: bobLease.leaseToken, code: "CANCELLED" });
    await service.cancelJob(owner, alicePending.id);
    await db.batch([db.prepare("SELECT set_config('hessara.re_worker','true',true)"), db.prepare("UPDATE re_workers SET heartbeat_at=0")]);
    assert.equal((await service.engines(owner)).find(x => x.id === "rizin").available, false, "Expired heartbeats cannot advertise a tool as operational");
    await assert.rejects(service.createJob(owner, request("offline")), /ENGINE_UNAVAILABLE/);
    assert.equal(await service.count(owner, "projects"), 1); assert.equal(await service.count(other, "projects"), 1);
    assert.equal((await service.evidenceById(owner, first.id, "e-1")).content, "Hello");
    await assert.rejects(service.evidenceById(other, first.id, "e-1"), /NOT_FOUND/);
    assert.equal((await service.executions(owner, third.id)).length, 2);
    await service.deleteArtifact(owner, artifact.id); await assert.rejects(service.getArtifact(owner, artifact.id), /NOT_FOUND/);
    assert.equal((await service.overview(owner)).storageBytes, 128, "Soft deletion does not release storage quota before actual purge");
    await service.deleteProject(owner, alice.id); assert.equal((await service.listProjects(owner)).length, 0);
    const privileges = await pg.query("SELECT has_table_privilege('anon','re_artifacts','SELECT') guest,has_table_privilege('authenticated','re_jobs','SELECT') member");
    assert.deepEqual(privileges.rows[0], { guest: false, member: false });
  } finally { await pg.close(); }
});

test("reverse engineering options are bounded and engine capabilities are distinct", async () => {
  assert.deepEqual(validateOptions({ maxPaths: 8, maxSteps: 50 }), { maxPaths: 8, maxSteps: 50 });
  for (const options of [{ command: "shell" }, { maxPaths: 9 }, { maxSteps: 51 }, { timeoutSeconds: 301 }, { decompile: "true" }]) assert.throws(() => validateOptions(options));
  assert.deepEqual(compatibleEngines("apk").map(x => x.id).sort(), ["jadx", "mobsf"]);
  assert.deepEqual(recommendEngines("elf", ["rizin", "radare2"]).map(x => x.id), ["rizin"]);
  assert.deepEqual(recommendEngines("apk", ["jadx", "mobsf"]).map(x => x.id), ["jadx", "mobsf"]);
  assert.equal(compatibleEngines("elf").find(engine => engine.id === "ghidra").capabilities.includes("symbols"), false);
  await assert.rejects(createReverseEngineeringService().createJob("alice", { projectId: "project", artifactId: "artifact", engineId: "ghidra", options: { symbols: true }, authorizationConfirmed: true, idempotencyKey: "unsupported-symbol-export" }), /UNSUPPORTED_ENGINE_OPTION/);
  assert.throws(() => validateResult({ engineId: "rea", engineVersion: "1", summary: "", evidence: [{ name: "A", kind: "shell", content: "" }] }));
});
