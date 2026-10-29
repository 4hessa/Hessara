import test from "node:test";
import assert from "node:assert/strict";
import { engineAvailability, verifiedSample, workerEngineReady, workerReadySql } from "../lib/reverse-engineering/availability.ts";
import { engineDefinition } from "../lib/reverse-engineering/catalog.ts";
import { engineReason, engineRemediation } from "../lib/reverse-engineering/engine-messages.ts";

const now = 2_000_000_000_000;
const definition = engineDefinition("rizin");
// Shape/contract fixtures only. No test here claims real engine execution.
const verification = { passed: true, imageDigest: `test/image@sha256:${"a".repeat(64)}`, engineVersion: "1.0", artifactSha256: "b".repeat(64), verifiedAt: now - 1000 };
const engine = { id: "rizin", enabled: true, healthy: true, capacity: 1, version: "1.0", capabilities: ["functions"], verification };
const observation = { platformEnabled: true, acceptingJobs: true, circuitUntil: 0, workerId: "worker", heartbeatAt: now - 1, workerEngine: engine, capacity: { slots: 1, cpuCount: 1, availableMemoryMb: 4096, diskFreeMb: 4096 }, activeJobs: 0 };
const assess = (changes = {}) => engineAvailability(definition, { ...observation, ...changes }, now);

test("operational states require current observations and real-sample proof", () => {
  assert.equal(assess().operationalStatus, "available"); assert.equal(assess().available, true);
  assert.equal(assess({ activeJobs: 1 }).operationalStatus, "processing");
  assert.equal(assess({ workerId: null }).operationalStatus, "unavailable");
  assert.equal(assess({ heartbeatAt: now - 60_000 }).reasonCode, "WORKER_STALE");
  assert.equal(assess({ acceptingJobs: false }).operationalStatus, "maintenance");
  assert.equal(assess({ platformEnabled: false }).available, false);
  assert.equal(assess({ circuitUntil: now + 1 }).operationalStatus, "error");
  const failed = assess({ workerEngine: { ...engine, healthy: false, reason: "secret internal diagnostics" } });
  assert.equal(failed.operationalStatus, "error"); assert.equal(failed.reason.includes("secret"), false);
});

test("missing version, verification, worker activation or capacity fail closed", () => {
  for (const changes of [{ version: null }, { version: " " }, { enabled: false }, { enabled: undefined }, { healthy: false }, { capacity: 0 }, { verification: null }, { capabilities: [] }]) {
    const changed = { ...engine, ...changes };
    assert.equal(workerEngineReady(changed, now), false);
    assert.equal(assess({ workerEngine: changed }).available, false);
  }
  assert.equal(assess({ workerEngine: { ...engine, verification: null } }).reasonCode, "VERIFIED_SAMPLE_REQUIRED");
  for (const key of ["slots", "cpuCount", "availableMemoryMb", "diskFreeMb"]) assert.equal(assess({ capacity: { ...observation.capacity, [key]: 0 } }).available, false, key);
  for (const value of ["4096", {}, -1, 1.5, 1e99]) assert.equal(assess({ capacity: { ...observation.capacity, availableMemoryMb: value } }).available, false);
  assert.equal(assess({ workerEngine: { ...engine, capabilities: [] } }).reasonCode, "CAPABILITIES_UNVERIFIED");
});

test("sample proof binds the engine version and an immutable image and artifact", () => {
  assert.equal(verifiedSample(engine, now), true);
  for (const proof of [{ ...verification, passed: false }, { ...verification, imageDigest: "image:latest" }, { ...verification, artifactSha256: "invalid" }, { ...verification, engineVersion: "2.0" }, { ...verification, verifiedAt: now + 1 }, { ...verification, verifiedAt: NaN }]) assert.equal(verifiedSample({ ...engine, verification: proof }, now), false);
});

test("a busy verified engine remains Processing without advertising spare capacity", () => {
  const busy = assess({ activeJobs: 1, capacity: { ...observation.capacity, availableMemoryMb: 0 } });
  assert.equal(busy.operationalStatus, "processing"); assert.equal(busy.available, false);
  assert.equal(assess({ activeJobs: 0, capacity: { ...observation.capacity, availableMemoryMb: 0 } }).operationalStatus, "unavailable");
});

test("SQL gate accepts internal aliases only", () => {
  assert.match(workerReadySql("w", "x", "d"), /verification/);
  assert.throws(() => workerReadySql("w;drop", "x", "d"), /INVALID_SQL_ALIAS/);
});


test("known worker preflight failures retain the real blocker even before a version can be probed", () => {
  for (const reasonCode of ["IMAGE_UNPINNED", "BENCHMARK_REQUIRED", "VERIFIED_SAMPLE_REQUIRED", "INSUFFICIENT_CAPACITY", "HEALTH_CHECK_FAILED"]) {
    const failure = { ...engine, healthy: false, version: null, verification: null, capacity: 0, reasonCode, reason: "private registry and secret tool stderr" };
    const result = assess({ workerEngine: failure });
    assert.equal(result.available, false);
    assert.equal(result.reasonCode, reasonCode);
    assert.equal(result.operationalStatus, reasonCode === "HEALTH_CHECK_FAILED" ? "error" : "unavailable");
    assert.ok(!result.reason.includes("private"));
    assert.ok(!result.reason.includes("secret"));
    for (const locale of ["ar", "en"]) {
      assert.equal(typeof engineReason(reasonCode, locale), "string");
      assert.ok(engineRemediation(reasonCode, locale)?.length > 30);
    }
  }
});

test("untrusted worker reason text and unknown or inherited code names cannot replace readiness gates", () => {
  for (const reasonCode of ["private-token", "toString", "__proto__"]) {
    const result = assess({ workerEngine: { ...engine, healthy: false, version: null, verification: null, reasonCode, reason: "secret" } });
    assert.equal(result.reasonCode, "VERSION_UNVERIFIED");
    assert.equal(result.available, false);
    assert.equal(engineRemediation(reasonCode, "en"), null);
  }
  assert.equal(assess({ workerEngine: { ...engine, reasonCode: "IMAGE_UNPINNED" } }).available, true, "stale code cannot override a healthy verified observation");
  assert.equal(assess({ workerId: null, workerEngine: { ...engine, healthy: false, reasonCode: "IMAGE_UNPINNED" } }).reasonCode, "NO_WORKER");
  assert.equal(assess({ platformEnabled: false, workerEngine: { ...engine, healthy: false, reasonCode: "IMAGE_UNPINNED" } }).reasonCode, "ENGINE_DISABLED");
});
