import { randomUUID } from "node:crypto";
import { database } from "../postgres-database.ts";
import { camelRow, type ReDatabase } from "./service.ts";
import { engineDefinition } from "./catalog.ts";
import { requiredCapabilities, verifiedSample, workerCapacitySql, workerEngineReady, workerEnginesSql, workerReadySql, WORKER_FRESHNESS_MS } from "./availability.ts";
import { ReError, type AnalysisEvidence, type AnalysisResult, type WorkerHeartbeat, type WorkerLease, type WorkerRegistration } from "./types.ts";
import { identifier, json, text, validateEngine, validateResult } from "./validation.ts";
import { analysisUsage } from "./usage.ts";

const LEASE_SECONDS = 45;
const RETRYABLE_CODES = new Set(["STORAGE_TEMPORARY", "WORKER_LOST", "NETWORK_TEMPORARY"]);
const active = "status IN ('running','validating')";
function normalizeCapacity(capacity: WorkerRegistration["capacity"]) {
  for (const value of [capacity?.slots, capacity?.availableMemoryMb, capacity?.diskFreeMb, capacity?.cpuCount]) {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1_000_000_000) throw new ReError("INVALID_WORKER_CAPACITY");
  }
  return { slots: Math.min(1, Math.floor(capacity.slots)), availableMemoryMb: Math.floor(capacity.availableMemoryMb!),
    diskFreeMb: Math.floor(capacity.diskFreeMb!), cpuCount: Math.floor(capacity.cpuCount!), observedAt: Date.now() };
}
export function createReverseEngineeringQueue(injected?: ReDatabase) {
  const db = () => injected ?? database();
  const q = (sql: string, ...values: unknown[]) => db().prepare(sql).bind(...values);
  // This function is server-only. Routes must authenticate the private worker token
  // before calling it. Context expires at commit and grants nothing to Data API roles.
  const batch = (statements: ReturnType<typeof q>[]) => db().batch([q("SELECT set_config('hessara.re_worker','true',true)"), q("SELECT pg_advisory_xact_lock(hashtextextended('hessara-re-queue',0))"), ...statements]);
  const guard = (lease: WorkerLease, now: number) => { identifier(lease.workerId); identifier(lease.jobId); identifier(lease.leaseToken); return [lease.jobId, lease.workerId, lease.leaseToken, now]; };
  async function registerWorker(registration: WorkerRegistration) {
    identifier(registration.workerId); if (!Array.isArray(registration.engines) || registration.engines.length > 7) throw new ReError("INVALID_WORKER");
    const seen = new Set();
    const engines = registration.engines.map(engine => {
      validateEngine(engine.id); if (seen.has(engine.id)) throw new ReError("INVALID_WORKER"); seen.add(engine.id);
      if (typeof engine.healthy !== "boolean" || (engine.enabled !== undefined && typeof engine.enabled !== "boolean")
        || !Number.isInteger(engine.capacity) || engine.capacity < 0 || engine.capacity > 1
        || (engine.capabilities !== undefined && !Array.isArray(engine.capabilities))) throw new ReError("INVALID_WORKER");
      const version = engine.version == null ? null : text(engine.version, 100, true) || null;
      let verification = null;
      if (engine.verification != null) {
        if (!verifiedSample({ ...engine, version })) throw new ReError("INVALID_WORKER_VERIFICATION");
        verification = { passed: true, imageDigest: text(engine.verification.imageDigest, 500), engineVersion: text(engine.verification.engineVersion, 100), artifactSha256: text(engine.verification.artifactSha256, 64), verifiedAt: engine.verification.verifiedAt };
      }
      return { id: engine.id, healthy: engine.healthy, enabled: engine.enabled === true, capacity: engine.capacity, version, verification,
        capabilities: (engine.capabilities ?? []).slice(0, 30).map(capability => text(capability, 100)),
        reason: engine.reason ? text(engine.reason, 1000) : null, reasonCode: engine.reasonCode ? text(engine.reasonCode, 100) : null };
    });
    const boundedCapacity = normalizeCapacity(registration.capacity);
    await batch([q("INSERT INTO re_workers(id,engines,capacity,heartbeat_at) VALUES(?,?::jsonb,?::jsonb,?) ON CONFLICT(id) DO UPDATE SET engines=excluded.engines,capacity=excluded.capacity,heartbeat_at=excluded.heartbeat_at", registration.workerId, json(engines, 32768), json(boundedCapacity, 4096), Date.now())]);
    return { ok: true };
  }
  async function recover() {
    const now = Date.now();
    const r = await batch([q(`WITH stale AS (SELECT id FROM re_jobs WHERE ${active} AND (lease_until<? OR deadline_at<?) FOR UPDATE SKIP LOCKED), recovered AS (
      UPDATE re_jobs j SET status=CASE WHEN cancel_requested THEN 'cancelled' WHEN deadline_at<? THEN 'timed_out' WHEN attempt<2 THEN 'queued' ELSE 'failed' END,
      stage=CASE WHEN cancel_requested THEN 'cancelled' WHEN deadline_at<? THEN 'timed_out' WHEN attempt<2 THEN 'retry_wait' ELSE 'dead_letter' END,
      error_code=CASE WHEN cancel_requested THEN 'CANCELLED' WHEN deadline_at<? THEN 'TIMEOUT' ELSE 'WORKER_LOST' END,
      error_message=CASE WHEN deadline_at<? THEN 'The bounded analysis time limit was reached' ELSE 'The worker lease expired before completion' END,
      finished_at=CASE WHEN NOT cancel_requested AND deadline_at>=? AND attempt<2 THEN NULL ELSE ?::bigint END,
      available_at=?::bigint+5000+(floor(random()*1000)::int),lease_token=NULL,lease_until=0,worker_id=NULL
      WHERE j.id IN (SELECT id FROM stale) RETURNING j.*)
      SELECT * FROM recovered`, now, now, now, now, now, now, now, now, now),
      q("UPDATE re_executions x SET finished_at=?,status=j.status,error_code=j.error_code FROM re_jobs j WHERE x.job_id=j.id AND x.finished_at IS NULL AND j.lease_token IS NULL", now)]);
    return r[2].results.map(camelRow);
  }
  async function claim(registration: WorkerRegistration) {
    await registerWorker(registration); await recover(); const now = Date.now(), token = randomUUID();
    const definitions = registration.engines.filter(item => workerEngineReady(item, now)).map(item => engineDefinition(item.id));
    if (!definitions.length) return { job: null };
    // Capacity thresholds are tied to each engine, not the caller's requested slots.
    const capacities = definitions.map(engine => ({ id: engine.id, cpuCount: engine.cpuCount, memoryMb: engine.memoryMb, diskMb: engine.diskMb, baselineCapabilities: requiredCapabilities(engine.id) }));
    const r = await batch([q(`WITH candidate AS (
      SELECT j.id,jsonb_build_object('engineVersion',x->>'version','imageDigest',x#>>'{verification,imageDigest}') execution_identity
      FROM re_jobs j JOIN re_engines e ON e.id=j.engine_id JOIN re_settings s ON s.id=1 JOIN re_workers w ON w.id=?
      JOIN jsonb_to_recordset(?::jsonb) AS c(id text,"cpuCount" int,"memoryMb" int,"diskMb" int,"baselineCapabilities" jsonb) ON c.id=e.id
      CROSS JOIN LATERAL jsonb_array_elements(${workerEnginesSql("w")}) x
      JOIN re_artifacts a ON a.id=j.artifact_id JOIN re_projects p ON p.id=j.project_id
      WHERE j.status='queued' AND j.available_at<=? AND NOT j.cancel_requested AND s.accepting_jobs AND e.enabled AND e.circuit_until<=?
      AND a.status='ready' AND a.retention_until>? AND p.deleted_at IS NULL AND w.heartbeat_at>?
      AND x->>'id'=e.id AND ${workerReadySql("w", "x", "c")}
      AND (SELECT count(*) FROM re_jobs WHERE ${active})<s.max_global_active
      AND (SELECT count(*) FROM re_jobs WHERE worker_id=w.id AND ${active})<${workerCapacitySql("w", "slots")}
      AND (SELECT count(*) FROM re_jobs WHERE worker_id=w.id AND engine_id=e.id AND ${active})<1
      AND (SELECT count(*) FROM re_jobs WHERE owner=j.owner AND ${active})<s.max_user_active
      ORDER BY j.priority DESC,j.available_at,j.created_at FOR UPDATE OF j SKIP LOCKED LIMIT 1)
      UPDATE re_jobs j SET status='validating',stage='validating',worker_id=?,lease_token=?,lease_until=?,deadline_at=?::bigint+timeout_seconds*1000,
      started_at=coalesce(started_at,?),attempt=attempt+1,error_code=NULL,error_message=NULL,
      metadata=j.metadata||jsonb_build_object('executionIdentity',c.execution_identity)
      FROM candidate c WHERE j.id=c.id RETURNING j.*`, registration.workerId, json(capacities), now, now, now, now - WORKER_FRESHNESS_MS, registration.workerId, token, now + LEASE_SECONDS * 1000, now, now),
      q("INSERT INTO re_executions(id,owner,job_id,worker_id,attempt,started_at,status) SELECT ?,owner,id,worker_id,attempt,?,'validating' FROM re_jobs WHERE worker_id=? AND lease_token=?", randomUUID(), now, registration.workerId, token),
      q("SELECT j.*,a.name artifact_name,a.storage_key,a.sha256,a.size_bytes,a.format FROM re_jobs j JOIN re_artifacts a ON a.id=j.artifact_id WHERE j.worker_id=? AND j.lease_token=?", registration.workerId, token)]);
    const row = r[4].results[0]; if (!row) return { job: null };
    const identity = (row.metadata as Record<string, unknown>).executionIdentity as Record<string, unknown>;
    return { job: { id: String(row.id), owner: String(row.owner), projectId: String(row.project_id), engineId: String(row.engine_id), expectedEngineVersion: String(identity.engineVersion), expectedImageDigest: String(identity.imageDigest), options: row.options, timeoutSeconds: Number(row.timeout_seconds), artifact: { id: String(row.artifact_id), name: String(row.artifact_name), storageKey: String(row.storage_key), sha256: String(row.sha256), sizeBytes: Number(row.size_bytes), format: String(row.format) } }, leaseToken: token, leaseSeconds: LEASE_SECONDS };
  }
  async function releaseClaim(input: WorkerLease & { code?: string }) {
    const now = Date.now(), values = guard(input, now);
    const known = new Set(["STORAGE_UNAVAILABLE", "STORAGE_NOT_CONFIGURED", "NOT_FOUND"]);
    const code = input.code && known.has(input.code) ? input.code : "ARTIFACT_SIGN_FAILED";
    // Signing happens after reservation but before the supervisor receives a lease.
    // Only that untouched reservation can be refunded; heartbeat/reassignment wins.
    const r = await batch([q(`WITH candidate AS (
      SELECT j.id,j.owner,j.attempt reserved_attempt,x.id execution_id,
        CASE WHEN NOT jsonb_exists(j.metadata,'dispatchFailures') THEN 1
          WHEN jsonb_typeof(j.metadata->'dispatchFailures')='number' AND j.metadata->>'dispatchFailures' IN ('0','1','2') THEN (j.metadata->>'dispatchFailures')::int+1 ELSE 3 END dispatch_failures
      FROM re_jobs j JOIN re_executions x ON x.job_id=j.id AND x.worker_id=j.worker_id AND x.attempt=j.attempt
      WHERE j.id=? AND j.worker_id=? AND j.lease_token=? AND j.lease_until>? AND j.deadline_at>?
        AND j.status='validating' AND j.stage='validating' AND j.attempt>0
        AND x.status='validating' AND x.finished_at IS NULL FOR UPDATE OF j,x
    ), released AS (
      UPDATE re_jobs j SET status=CASE WHEN j.cancel_requested THEN 'cancelled' WHEN c.dispatch_failures>=3 THEN 'failed' ELSE 'queued' END,
        stage=CASE WHEN j.cancel_requested THEN 'cancelled' WHEN c.dispatch_failures>=3 THEN 'dispatch_failed' ELSE 'dispatch_wait' END,
        attempt=j.attempt-1,started_at=CASE WHEN j.attempt=1 THEN NULL ELSE j.started_at END,
        finished_at=CASE WHEN j.cancel_requested OR c.dispatch_failures>=3 THEN ?::bigint ELSE NULL END,
        available_at=?::bigint+5000,deadline_at=NULL,worker_id=NULL,lease_token=NULL,lease_until=0,
        error_code=CASE WHEN j.cancel_requested THEN 'CANCELLED' ELSE ? END,
        error_message='Artifact download preparation failed before worker dispatch',
        metadata=jsonb_set(j.metadata-'executionIdentity','{dispatchFailures}',to_jsonb(c.dispatch_failures))
      FROM candidate c WHERE j.id=c.id RETURNING j.id,j.owner,j.status
    ), discarded AS (
      DELETE FROM re_executions x USING candidate c,released r WHERE x.id=c.execution_id AND r.id=c.id RETURNING x.job_id
    ), recorded AS (
      INSERT INTO re_audit(id,owner,action,entity_id,details,created_at)
      SELECT ?,r.owner,'job.dispatch_failed',r.id,
        jsonb_build_object('code',?::text,'reservedAttempt',c.reserved_attempt,'dispatchFailures',c.dispatch_failures,'analysisStarted',false),?
      FROM released r JOIN candidate c ON c.id=r.id JOIN discarded d ON d.job_id=r.id RETURNING entity_id
    ) SELECT r.status FROM released r JOIN recorded a ON a.entity_id=r.id`, ...values, now, now, now, code, randomUUID(), code, now)]);
    const row = r[2].results[0];
    return row ? { released: true, status: String(row.status) } : { released: false };
  }
  async function heartbeat(input: WorkerHeartbeat) {
    const now = Date.now(), values = guard(input, now), stage = text(input.stage ?? "running", 120), metrics = json(input.metrics ?? {}, 4096);
    // A lease heartbeat is not evidence that old free-memory/disk observations
    // remain true. Old workers may continue their lease, but cannot advertise
    // spare capacity until they submit fresh host measurements.
    const capacity = input.capacity === undefined
      ? { slots: 0, cpuCount: 0, availableMemoryMb: 0, diskFreeMb: 0, observedAt: 0 }
      : normalizeCapacity(input.capacity);
    const statements = [q(`UPDATE re_jobs SET lease_until=least(?,deadline_at),status='running',stage=? WHERE id=? AND worker_id=? AND lease_token=? AND lease_until>? AND ${active} AND deadline_at>? RETURNING cancel_requested`, now + LEASE_SECONDS * 1000, stage, ...values, now),
      q("UPDATE re_workers SET heartbeat_at=?,metrics=?::jsonb,capacity=?::jsonb WHERE id=? AND EXISTS(SELECT 1 FROM re_jobs WHERE id=? AND worker_id=? AND lease_token=? AND lease_until>?)", now, metrics, json(capacity, 4096), input.workerId, ...values)];
    if (input.logs !== undefined && (!Array.isArray(input.logs) || input.logs.length > 50)) throw new ReError("LOG_BATCH_TOO_LARGE", 413);
    for (const log of input.logs ?? []) { const message = text(log.message, 2048, true), level = text(log.level, 20); statements.push(q(`INSERT INTO re_evidence(id,owner,job_id,kind,name,content,metadata,created_at)
      SELECT ?,owner,id,'log',?, ?,?::jsonb,? FROM re_jobs WHERE id=? AND worker_id=? AND lease_token=? AND lease_until>? AND ${active}
      AND (SELECT count(*) FROM re_evidence WHERE job_id=? AND kind='log')<1000`, randomUUID(), level, message, json({ at: log.at?.slice(0, 100) ?? null }), now, ...values, input.jobId)); }
    const r = await batch(statements); const row = r[2].results[0]; if (!row) throw new ReError("LEASE_LOST", 409); return { cancelRequested: !!row.cancel_requested };
  }
  async function complete(input: WorkerLease & { result: AnalysisResult }) {
    const result = validateResult(input.result), version = text(result.engineVersion, 100), now = Date.now(), values = guard(input, now);
    // All writes use the same lease and transaction. A stale worker cannot publish
    // after recovery, cancellation, reassignment or the absolute execution deadline.
    const condition = "id=? AND worker_id=? AND lease_token=? AND lease_until>? AND status='completed'";
    const statements = [q(`UPDATE re_jobs SET status=CASE WHEN cancel_requested THEN 'cancelled' ELSE 'completed' END,
      stage=CASE WHEN cancel_requested THEN 'cancelled' ELSE 'completed' END,finished_at=?,summary=?,metadata=metadata||?::jsonb
      WHERE id=? AND worker_id=? AND lease_token=? AND lease_until>? AND ${active} AND deadline_at>? AND engine_id=?
      AND metadata#>>'{executionIdentity,engineVersion}'=? RETURNING *`, now, text(result.summary, 16000, true), json({ engineVersion: version, limitations: result.limitations ?? [], metrics: result.metrics ?? {} }), ...values, now, result.engineId, version)];
    const evidences: AnalysisEvidence[] = [...(result.evidence ?? [])];
    for (const [kind, items] of [["function", result.functions], ["string", result.strings], ["dependency", result.dependencies], ["code", result.files]] as const) for (const [index, item] of (items ?? []).entries()) {
      const object: Record<string, unknown> = typeof item === "string" ? { value: item } : item;
      const content = String(object.content ?? object.value ?? object.signature ?? "");
      evidences.push({ id: `${kind}-${index}`, kind, name: String(object.name ?? object.path ?? object.value ?? `${kind} ${index + 1}`).slice(0, 300), content: content.slice(0, 65536), location: String(object.address ?? object.path ?? "").slice(0, 1000), metadata: Object.fromEntries(Object.entries(object).filter(([key]) => !["content", "value"].includes(key))) });
    }
    const seen = new Set<string>();
    const evidenceRows = evidences.map((evidence, index) => { const id = evidence.id ?? `evidence-${index}`; if (seen.has(id)) throw new ReError("DUPLICATE_EVIDENCE_ID"); seen.add(id); json(evidence.metadata);
      return { id, kind: evidence.kind, name: text(evidence.name, 300), content: evidence.content ?? "", location: text(evidence.location ?? "", 1000, true), metadata: evidence.metadata ?? {}, storage_key: evidence.storageKey ?? null }; });
    const findingRows = (result.findings ?? []).map((finding, index) => { for (const evidenceId of finding.evidenceIds ?? []) if (!seen.has(evidenceId)) throw new ReError("MISSING_EVIDENCE_REFERENCE");
      return { id: finding.id ?? `finding-${index}`, title: finding.title, description: finding.description, severity: finding.severity ?? "info", confidence: finding.confidence ?? "unknown", category: text(finding.category ?? "", 100, true), location: text(finding.location ?? "", 1000, true), evidence_ids: finding.evidenceIds ?? [] }; });
    // Two bounded bulk writes keep publication independent of row count. Thousands
    // of round trips while holding the global queue lock would starve other jobs.
    statements.push(q(`INSERT INTO re_evidence(id,owner,job_id,kind,name,content,location,metadata,storage_key,created_at)
      SELECT d.id,j.owner,j.id,d.kind,d.name,d.content,d.location,d.metadata,d.storage_key,? FROM re_jobs j
      CROSS JOIN jsonb_to_recordset(?::jsonb) AS d(id text,kind text,name text,content text,location text,metadata jsonb,storage_key text)
      WHERE j.id=? AND j.worker_id=? AND j.lease_token=? AND j.lease_until>? AND j.status='completed'`, now, json(evidenceRows, 3 * 1024 * 1024), ...values));
    statements.push(q(`INSERT INTO re_findings(id,owner,job_id,title,description,severity,confidence,category,location,evidence_ids,created_at)
      SELECT d.id,j.owner,j.id,d.title,d.description,d.severity,d.confidence,d.category,d.location,d.evidence_ids,? FROM re_jobs j
      CROSS JOIN jsonb_to_recordset(?::jsonb) AS d(id text,title text,description text,severity text,confidence text,category text,location text,evidence_ids jsonb)
      WHERE j.id=? AND j.worker_id=? AND j.lease_token=? AND j.lease_until>? AND j.status='completed'`, now, json(findingRows, 2 * 1024 * 1024), ...values));
    statements.push(q("UPDATE re_executions x SET status=j.status,finished_at=?,metrics=?::jsonb FROM re_jobs j WHERE x.job_id=j.id AND x.attempt=j.attempt AND j.id=? AND j.worker_id=? AND j.lease_token=? AND j.lease_until>? AND j.status IN ('completed','cancelled')", now, json(result.metrics ?? {}, 4096), ...values));
    for (const [event, quantity, unit] of analysisUsage(result.metrics)) statements.push(q(`INSERT INTO re_usage(id,owner,job_id,event,quantity,unit,created_at) SELECT ?,owner,id,?,?,?,? FROM re_jobs WHERE ${condition} ON CONFLICT(job_id,event) DO NOTHING`, randomUUID(), event, quantity, unit, now, ...values));
    statements.push(q(`INSERT INTO re_audit(id,owner,action,entity_id,created_at) SELECT ?,owner,'job.finished',id,? FROM re_jobs WHERE id=? AND worker_id=? AND lease_token=? AND lease_until>? AND status IN ('completed','cancelled')`, randomUUID(), now, ...values));
    statements.push(q("UPDATE re_engines SET failures=0,circuit_until=0 WHERE id=? AND EXISTS(SELECT 1 FROM re_jobs WHERE id=? AND worker_id=? AND lease_token=? AND lease_until>? AND status='completed')", result.engineId, ...values));
    statements.push(q("UPDATE re_jobs SET lease_until=0,lease_token=NULL WHERE id=? AND worker_id=? AND lease_token=? AND status IN ('completed','cancelled')", input.jobId, input.workerId, input.leaseToken));
    const r = await batch(statements); if (!r[2].results[0]) throw new ReError("LEASE_LOST", 409); return { status: r[2].results[0].status };
  }
  async function fail(input: WorkerLease & { code: string; message?: string; retryable?: boolean }) {
    const now = Date.now(), values = guard(input, now), code = text(input.code, 100), message = text(input.message ?? "Analysis worker failed", 1000, true);
    const retry = input.retryable === true && RETRYABLE_CODES.has(code);
    const r = await batch([q(`UPDATE re_jobs SET status=CASE WHEN cancel_requested OR ?='CANCELLED' THEN 'cancelled' WHEN ?='TIMEOUT' THEN 'timed_out' WHEN ? AND attempt<2 THEN 'queued' ELSE 'failed' END,
      stage=CASE WHEN ? AND attempt<2 AND NOT cancel_requested THEN 'retry_wait' ELSE 'finished' END,error_code=?,error_message=?,
      available_at=?::bigint+least(30000,5000*power(2,attempt))::bigint+floor(random()*1000)::int,
      finished_at=CASE WHEN ? AND attempt<2 AND NOT cancel_requested THEN NULL ELSE ?::bigint END
      WHERE id=? AND worker_id=? AND lease_token=? AND lease_until>? AND ${active} RETURNING *`, code, code, retry, retry, code, message, now, retry, now, ...values),
      q("UPDATE re_executions x SET status=CASE WHEN j.status='queued' THEN 'failed' ELSE j.status END,finished_at=?,error_code=? FROM re_jobs j WHERE x.job_id=j.id AND x.attempt=j.attempt AND j.id=? AND j.worker_id=? AND j.lease_token=? AND j.lease_until>?", now, code, ...values),
      q("UPDATE re_engines e SET failures=failures+1,circuit_until=CASE WHEN failures>=2 THEN ? ELSE circuit_until END WHERE ? AND EXISTS(SELECT 1 FROM re_jobs WHERE engine_id=e.id AND id=? AND worker_id=? AND lease_token=? AND lease_until>?)", now + 60000, !["CANCELLED", "INVALID_ARTIFACT", "UNSUPPORTED_FORMAT", "INVALID_OPTIONS"].includes(code), ...values),
      q("INSERT INTO re_audit(id,owner,action,entity_id,details,created_at) SELECT ?,owner,'job.failed',id,?::jsonb,? FROM re_jobs WHERE id=? AND worker_id=? AND lease_token=? AND lease_until>?", randomUUID(), json({ code, transientRetryAllowed: retry }), now, ...values),
      q("UPDATE re_jobs SET lease_token=NULL,lease_until=0,worker_id=NULL WHERE id=? AND worker_id=? AND lease_token=? AND status IN ('queued','failed','cancelled','timed_out')", input.jobId, input.workerId, input.leaseToken)]);
    if (!r[2].results[0]) throw new ReError("LEASE_LOST", 409); return { status: r[2].results[0].status };
  }
  return { registerWorker, claim, releaseClaim, heartbeat, complete, fail, recover };
}
export const reQueue = createReverseEngineeringQueue();
