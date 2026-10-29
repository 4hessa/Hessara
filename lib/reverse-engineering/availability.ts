import type { EngineDefinition, EngineId, WorkerEngine } from "./types.ts";

export const WORKER_FRESHNESS_MS = 60_000;
export type OperationalStatus = "available" | "processing" | "unavailable" | "maintenance" | "error";
export type WorkerCapacity = { slots?: number; cpuCount?: number; availableMemoryMb?: number; diskFreeMb?: number };
const baselineCapabilities: Record<EngineId, readonly string[]> = {
  rea: ["javascript-static-analysis"], ghidra: ["functions"], mobsf: ["security-findings"],
  jadx: ["decompilation"], rizin: ["functions"], angr: ["control-flow"], radare2: ["functions"],
};
export function requiredCapabilities(id: EngineId) { return baselineCapabilities[id]; }
function baselineReady(engine: Partial<WorkerEngine> | null | undefined): boolean {
  const required = engine?.id ? baselineCapabilities[engine.id] : null;
  return !!required && Array.isArray(engine?.capabilities) && required.every(capability => engine.capabilities!.includes(capability));
}
// Only stable codes from the trusted supervisor may cross the public boundary.
// An unavailable worker often cannot report a version; preserve its known
// blocker instead of replacing an image/sample/benchmark failure with a guess.
const observedWorkerFailures: Record<string, { operationalStatus: OperationalStatus; status: string; reason: string }> = {
  BENCHMARK_REQUIRED: { operationalStatus: "unavailable", status: "offline", reason: "Resource limits and bounded execution benchmarks have not been approved." },
  IMAGE_UNPINNED: { operationalStatus: "unavailable", status: "offline", reason: "The isolated engine image is not pinned to a verified immutable SHA-256 digest." },
  VERIFIED_SAMPLE_REQUIRED: { operationalStatus: "unavailable", status: "offline", reason: "A successful real sample analysis for the configured engine version and image is required." },
  INSUFFICIENT_CAPACITY: { operationalStatus: "unavailable", status: "insufficient_capacity", reason: "The isolated worker has insufficient measured free resources." },
  HEALTH_CHECK_FAILED: { operationalStatus: "error", status: "unhealthy", reason: "The isolated engine container or installation check failed." },
};
function observedWorkerFailure(engine: Partial<WorkerEngine> | null) {
  const code = engine?.reasonCode;
  return engine?.healthy !== true && typeof code === "string" && Object.hasOwn(observedWorkerFailures, code)
    ? { ...observedWorkerFailures[code], code } : null;
}
function measured(value: unknown): number { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000_000 ? value : 0; }

export function verifiedSample(engine: Partial<WorkerEngine> | null | undefined, now = Date.now()): boolean {
  const proof = engine?.verification;
  return !!proof && proof.passed === true && typeof proof.imageDigest === "string"
    && /^\S+@sha256:[a-f0-9]{64}$/.test(proof.imageDigest) && /^[a-f0-9]{64}$/.test(proof.artifactSha256)
    && typeof engine?.version === "string" && proof.engineVersion === engine.version.trim()
    && Number.isSafeInteger(proof.verifiedAt) && proof.verifiedAt > 0 && proof.verifiedAt <= now;
}
export function workerEngineReady(engine: Partial<WorkerEngine> | null | undefined, now = Date.now()): boolean {
  return engine?.healthy === true && engine.enabled === true && engine.capacity === 1
    && typeof engine.version === "string" && engine.version.trim().length > 0 && verifiedSample(engine, now) && baselineReady(engine);
}

function sqlAlias(alias: string) { if (!/^[a-z][a-z0-9_]*$/.test(alias)) throw new Error("INVALID_SQL_ALIAS"); return alias; }
export function workerEnginesSql(worker: string): string {
  sqlAlias(worker); return `CASE WHEN jsonb_typeof(${worker}.engines)='array' THEN ${worker}.engines ELSE '[]'::jsonb END`;
}
export function workerCapacitySql(worker: string, key: keyof WorkerCapacity): string {
  sqlAlias(worker); if (!["slots", "cpuCount", "availableMemoryMb", "diskFreeMb"].includes(key)) throw new Error("INVALID_SQL_ALIAS");
  const value = `${worker}.capacity->'${key}'`, number = `(${value}#>>'{}')::numeric`;
  // JSONB numbers are already valid Postgres numerics. CASE fences conversion
  // from old strings/objects; bound and integer checks fence the bigint cast.
  return `(CASE WHEN jsonb_typeof(${value})='number' THEN CASE WHEN ${number} BETWEEN 0 AND 1000000000 AND trunc(${number})=${number} THEN ${number}::bigint ELSE 0 END ELSE 0 END)`;
}

// Internal SQL aliases only. Discovery, admission and leasing share this gate.
export function workerReadySql(worker: string, engine: string, requirement: string): string {
  for (const alias of [worker, engine, requirement]) sqlAlias(alias);
  return `${engine}->'healthy'='true'::jsonb AND ${engine}->'enabled'='true'::jsonb
    AND ${engine}->'capacity'='1'::jsonb AND jsonb_typeof(${engine}->'version')='string' AND nullif(btrim(${engine}->>'version'),'') IS NOT NULL
    AND jsonb_typeof(${engine}->'capabilities')='array' AND ${engine}->'capabilities' @> ${requirement}."baselineCapabilities"
    AND ${engine}->'verification'->'passed'='true'::jsonb
    AND jsonb_typeof(${engine}->'verification'->'imageDigest')='string'
    AND jsonb_typeof(${engine}->'verification'->'artifactSha256')='string'
    AND jsonb_typeof(${engine}->'verification'->'engineVersion')='string'
    AND jsonb_typeof(${engine}->'verification'->'verifiedAt')='number'
    AND ${engine}->'verification'->>'imageDigest' ~ '^\\S+@sha256:[a-f0-9]{64}$'
    AND ${engine}->'verification'->>'artifactSha256' ~ '^[a-f0-9]{64}$'
    AND ${engine}->'verification'->>'engineVersion'=btrim(${engine}->>'version')
    AND CASE WHEN ${engine}->'verification'->>'verifiedAt' ~ '^[1-9][0-9]{0,15}$'
      THEN (${engine}->'verification'->>'verifiedAt')::bigint <= (extract(epoch FROM now())*1000)::bigint ELSE false END
    AND ${workerCapacitySql(worker, "slots")}>0
    AND ${workerCapacitySql(worker, "cpuCount")}>=${requirement}."cpuCount"
    AND ${workerCapacitySql(worker, "availableMemoryMb")}>=${requirement}."memoryMb"
    AND ${workerCapacitySql(worker, "diskFreeMb")}>=${requirement}."diskMb"`;
}

export function engineAvailability(definition: EngineDefinition, observation: {
  platformEnabled: boolean; acceptingJobs: boolean; circuitUntil: number;
  workerId: string | null; heartbeatAt: number; workerEngine: Partial<WorkerEngine> | null;
  capacity: WorkerCapacity | null; activeJobs: number;
}, now = Date.now()) {
  const { workerEngine: engine, capacity } = observation;
  const fresh = !!observation.workerId && observation.heartbeatAt > now - WORKER_FRESHNESS_MS;
  const installed = typeof engine?.version === "string" && engine.version.trim().length > 0;
  const verified = installed && verifiedSample(engine, now);
  const observedFailure = observedWorkerFailure(engine);
  const resources = !!capacity && measured(capacity.slots) > 0 && measured(capacity.cpuCount) >= definition.cpuCount
    && measured(capacity.availableMemoryMb) >= definition.memoryMb && measured(capacity.diskFreeMb) >= definition.diskMb;
  const available = fresh && observation.platformEnabled && observation.acceptingJobs
    && observation.circuitUntil <= now && workerEngineReady(engine, now) && resources;
  const activeJobs = Math.max(0, Math.floor(observation.activeJobs || 0));
  let operationalStatus: OperationalStatus;
  let reasonCode: string | null;
  let reason: string | null;
  let status: string;
  if (!fresh) {
    operationalStatus = "unavailable"; status = "offline";
    reasonCode = observation.workerId ? "WORKER_STALE" : "NO_WORKER";
    reason = observation.workerId ? "The isolated worker heartbeat has expired." : "No isolated analysis worker is connected.";
  } else if (!observation.platformEnabled || !observation.acceptingJobs || engine?.enabled !== true) {
    operationalStatus = "maintenance"; status = "disabled";
    reasonCode = !observation.platformEnabled ? "ENGINE_DISABLED" : !observation.acceptingJobs ? "INTAKE_PAUSED" : "WORKER_ENGINE_DISABLED";
    reason = !observation.platformEnabled ? "This engine is disabled by an administrator." : !observation.acceptingJobs ? "New analysis jobs are temporarily paused." : "This engine is disabled or not approved on the isolated worker.";
  } else if (observation.circuitUntil > now) {
    operationalStatus = "error"; status = observation.circuitUntil > now ? "circuit_open" : "unhealthy";
    reasonCode = "CIRCUIT_OPEN"; reason = "Repeated execution failures temporarily stopped this engine.";
  } else if (observedFailure) {
    operationalStatus = observedFailure.operationalStatus; status = observedFailure.status;
    reasonCode = observedFailure.code; reason = observedFailure.reason;
  } else if (!installed || !verified) {
    operationalStatus = "unavailable"; status = "offline";
    reasonCode = !installed ? "VERSION_UNVERIFIED" : "VERIFIED_SAMPLE_REQUIRED";
    reason = !installed ? "A successful engine installation check with a version is required." : "A successful real sample analysis for this engine version and pinned image is required.";
  } else if (!baselineReady(engine)) {
    operationalStatus = "unavailable"; status = "offline";
    reasonCode = "CAPABILITIES_UNVERIFIED"; reason = "The isolated worker has not confirmed the integration's required capabilities.";
  } else if (engine?.healthy !== true) {
    operationalStatus = "error"; status = "unhealthy";
    reasonCode = "HEALTH_CHECK_FAILED"; reason = "The isolated engine health check failed.";
  } else if (activeJobs > 0) {
    operationalStatus = "processing"; status = "operational";
    reasonCode = available ? null : "INSUFFICIENT_CAPACITY";
    reason = available ? null : "Analysis is running; additional measured worker capacity is not available.";
  } else if (engine?.capacity !== 1 || !resources) {
    operationalStatus = "unavailable"; status = !resources ? "insufficient_capacity" : "offline";
    reasonCode = engine?.capacity !== 1 ? "ENGINE_CAPACITY_UNAVAILABLE" : "INSUFFICIENT_CAPACITY";
    reason = "The isolated worker has insufficient measured capacity.";
  } else {
    operationalStatus = activeJobs > 0 ? "processing" : "available"; status = "operational";
    reasonCode = null; reason = null;
  }
  return { available, operational: available, operationalStatus, status, installed,
    enabled: observation.platformEnabled, acceptingJobs: observation.acceptingJobs,
    version: installed ? engine!.version!.trim() : null, lastHeartbeat: observation.heartbeatAt || null,
    activeJobs, verifiedSample: verified, lastVerifiedAt: verified ? engine!.verification!.verifiedAt : null,
    runtimeCapabilities: Array.isArray(engine?.capabilities) ? engine.capabilities.filter(item => definition.capabilities.includes(item)) : [], reasonCode, reason };
}
