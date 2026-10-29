import { createHash, randomUUID } from "node:crypto";
import { database } from "../postgres-database.ts";
import { engineCatalog, engineDefinition, recommendEngines } from "./catalog.ts";
import { ReError, type AnalysisOptions, type EvidenceKind, type Pagination, type WorkerEngine } from "./types.ts";
import { engineAvailability, requiredCapabilities, workerEnginesSql, workerReadySql, WORKER_FRESHNESS_MS, type WorkerCapacity } from "./availability.ts";
import { identifier, json, pagination, text, validateEngine, validateFormat, validateOptions } from "./validation.ts";
import { rePhase } from "./diagnostics.ts";
export { ReError } from "./types.ts";
export type ReDatabase = ReturnType<typeof database>;
type Row = Record<string, unknown>;
export function camelRow(row: Row): Row {
  return Object.fromEntries(Object.entries(row).filter(([key]) => !["lease_token", "validation_token"].includes(key)).map(([key, value]) => {
    if (key === "metadata" && value && typeof value === "object" && !Array.isArray(value)) {
      const metadata = value as Row, original = metadata.executionIdentity;
      if (original && typeof original === "object" && !Array.isArray(original)) {
        const identity = { ...original } as Row; delete identity.imageDigest;
        value = { ...metadata, executionIdentity: identity };
      }
    }
    return [key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()), value];
  }));
}
const mapRows = (rows: Row[]) => rows.map(camelRow);
const present = (row: Row | undefined) => { if (!row) throw new ReError("NOT_FOUND", 404); return camelRow(row); };

export function createReverseEngineeringService(injected?: ReDatabase) {
  const db = () => injected ?? database();
  const q = (sql: string, ...values: unknown[]) => db().prepare(sql).bind(...values);
  const scoped = async (owner: string, statements: ReturnType<typeof q>[]) => { identifier(owner); return db().scopedBatch(owner, statements); };
  const audit = (owner: string, action: string, id: string, details: unknown = {}) => q("INSERT INTO re_audit(id,owner,action,entity_id,details,created_at) VALUES(?,?,?,?,?::jsonb,?)", randomUUID(), owner, action, id, json(details, 8192), Date.now());
  // Consume RETURNING rows directly: a rejected/no-op mutation must not create
  // a success event. PostgreSQL executes the data-modifying CTE atomically.
  const audited = (owner: string, action: string, id: string, mutation: ReturnType<typeof q>, details: unknown = {}) => q(`WITH changed AS (${mutation.sql}), logged AS (
    INSERT INTO re_audit(id,owner,action,entity_id,details,created_at)
    SELECT ?,?,?,?,?::jsonb,? FROM changed RETURNING id
  ) SELECT * FROM changed`, ...mutation.values, randomUUID(), owner, action, id, json(details, 8192), Date.now());
  async function getSettings(owner: string) { return rePhase("settings.read", async () => present((await scoped(owner, [q("SELECT * FROM re_settings WHERE id=1")]))[0].results[0])); }
  async function engines(owner: string) {
    const now = Date.now();
    const requirements = engineCatalog.map(({ id, cpuCount, memoryMb, diskMb }) => ({ id, cpuCount, memoryMb, diskMb, baselineCapabilities: requiredCapabilities(id) }));
    // Only aggregate active counts cross owner boundaries. Never return another
    // user's job identifiers, artifacts, logs or results through engine health.
    const rows = (await rePhase("engines.discovery", () => scoped(owner, [q("SELECT set_config('hessara.re_worker','true',true)"), q(`SELECT e.*,s.accepting_jobs,w.id worker_id,w.heartbeat_at,w.worker_engine,w.capacity,
      (SELECT count(*)::int FROM re_jobs j JOIN re_workers running_worker ON running_worker.id=j.worker_id
       WHERE j.engine_id=e.id AND j.status IN ('validating','running') AND j.lease_until>? AND j.deadline_at>? AND running_worker.heartbeat_at>?) active_jobs
      FROM re_engines e JOIN re_settings s ON s.id=1
      JOIN jsonb_to_recordset(?::jsonb) AS d(id text,"cpuCount" int,"memoryMb" int,"diskMb" int,"baselineCapabilities" jsonb) ON d.id=e.id
      LEFT JOIN LATERAL (SELECT w.id,w.heartbeat_at,w.capacity,x worker_engine FROM re_workers w,jsonb_array_elements(${workerEnginesSql("w")}) x
       WHERE x->>'id'=e.id ORDER BY (w.heartbeat_at>? AND ${workerReadySql("w", "x", "d")}) DESC NULLS LAST,w.heartbeat_at DESC,w.id LIMIT 1) w ON true
      ORDER BY e.id`, now, now, now - WORKER_FRESHNESS_MS, json(requirements), now - WORKER_FRESHNESS_MS)])))[1].results;
    return engineCatalog.map(definition => { const row = rows.find(item => item.id === definition.id);
      return { ...definition, ...engineAvailability(definition, {
        platformEnabled: row?.enabled === true, acceptingJobs: row?.accepting_jobs === true, circuitUntil: Number(row?.circuit_until) || 0,
        workerId: typeof row?.worker_id === "string" ? row.worker_id : null, heartbeatAt: Number(row?.heartbeat_at) || 0,
        workerEngine: row?.worker_engine as Partial<WorkerEngine> | null, capacity: row?.capacity as WorkerCapacity | null,
        activeJobs: Number(row?.active_jobs) || 0,
      }, now) };
    });
  }
  async function overview(owner: string) {
    const result = await rePhase("overview.summary", () => scoped(owner, [q(`SELECT (SELECT count(*)::int FROM re_projects WHERE owner=? AND deleted_at IS NULL) projects,
      count(*) FILTER(WHERE status IN ('running','validating'))::int active_jobs,count(*) FILTER(WHERE status='queued')::int queued_jobs,
      count(*) FILTER(WHERE status='completed')::int completed_jobs,count(*) FILTER(WHERE status IN ('failed','timed_out'))::int failed_jobs FROM re_jobs WHERE owner=?`, owner, owner),
      q("SELECT coalesce(sum(size_bytes) FILTER(WHERE sha256 IS NOT NULL),0)::float8 storage_bytes,coalesce(sum(reserved_bytes) FILTER(WHERE sha256 IS NULL),0)::float8 reserved_storage_bytes,coalesce(sum(CASE WHEN sha256 IS NULL THEN reserved_bytes ELSE size_bytes END),0)::float8 charged_storage_bytes FROM re_artifacts WHERE owner=? AND status<>'purged'", owner),
      q("SELECT * FROM re_audit WHERE owner=? ORDER BY created_at DESC LIMIT 10", owner),
      q("SELECT f.*,j.project_id,j.artifact_id FROM re_findings f JOIN re_jobs j ON j.id=f.job_id WHERE f.owner=? ORDER BY f.created_at DESC LIMIT 10", owner),
      q("SELECT event,unit,sum(quantity)::float8 quantity FROM re_usage WHERE owner=? GROUP BY event,unit", owner)]));
    const health = await engines(owner);
    return { ...camelRow(result[0].results[0]), ...camelRow(result[1].results[0]), availableEngines: health.filter(item => item.available).length, engines: health, recentActivity: mapRows(result[2].results), recentFindings: mapRows(result[3].results), usage: mapRows(result[4].results), settings: await getSettings(owner) };
  }
  async function listProjects(owner: string, page: Pagination = {}) { const p = pagination(page); const r = await scoped(owner, [q("SELECT p.*,(SELECT count(*)::int FROM re_jobs j WHERE j.project_id=p.id AND j.owner=p.owner) job_count FROM re_projects p WHERE p.owner=? AND p.deleted_at IS NULL AND (p.name ILIKE ? OR p.description ILIKE ?) ORDER BY p.created_at DESC,p.id LIMIT ? OFFSET ?", owner, `%${p.search}%`, `%${p.search}%`, p.limit, p.offset)]); return mapRows(r[0].results); }
  async function createProject(owner: string, input: { name: string; description?: string }) { const id = randomUUID(), now = Date.now(), name = text(input.name), description = text(input.description ?? "", 2000, true); const r = await scoped(owner, [audited(owner, "project.create", id, q("INSERT INTO re_projects(id,owner,name,description,created_at,updated_at) SELECT ?,?,?,?,?,? WHERE (SELECT count(*) FROM re_projects WHERE owner=? AND deleted_at IS NULL)<(SELECT max_projects FROM re_settings WHERE id=1) RETURNING *", id, owner, name, description, now, now, owner))]); if (!r[0].results[0]) throw new ReError("PROJECT_QUOTA", 429); return camelRow(r[0].results[0]); }
  async function renameProject(owner: string, id: string, input: { name: string; description?: string }) { identifier(id); const r = await scoped(owner, [audited(owner, "project.rename", id, q("UPDATE re_projects SET name=?,description=coalesce(?,description),updated_at=? WHERE id=? AND owner=? AND deleted_at IS NULL RETURNING *", text(input.name), input.description === undefined ? null : text(input.description, 2000, true), Date.now(), id, owner))]); return present(r[0].results[0]); }
  async function deleteProject(owner: string, id: string) {
    identifier(id); const now = Date.now();
    const r = await scoped(owner, [
      audited(owner, "project.delete_requested", id, q("UPDATE re_projects SET deleted_at=?,updated_at=?,retention_until=?+(SELECT retention_days*86400000::bigint FROM re_settings WHERE id=1) WHERE id=? AND owner=? AND deleted_at IS NULL RETURNING *", now, now, now, id, owner)),
      q("UPDATE re_jobs SET cancel_requested=true,status=CASE WHEN status='queued' THEN 'cancelled' ELSE status END,finished_at=CASE WHEN status='queued' THEN ? ELSE finished_at END WHERE project_id=? AND owner=? AND status IN ('queued','validating','running')", now, id, owner),
    ]);
    return present(r[0].results[0]);
  }
  async function reserveArtifact(owner: string, input: { projectId: string; name: string; sizeBytes: number; storageKey: string }) {
    const projectId = identifier(input.projectId), name = text(input.name, 240); if (/[\\/]/.test(name) || name === "." || name === "..") throw new ReError("INVALID_FILE_NAME");
    if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes < 1) throw new ReError("INVALID_SIZE");
    const storageKey = text(input.storageKey, 500); if (!storageKey.startsWith(`${owner}/`) || storageKey.includes("..") || storageKey.includes("\\")) throw new ReError("INVALID_STORAGE_KEY");
    const id = randomUUID(), now = Date.now(); const r = await scoped(owner, [q("SELECT set_config('hessara.re_worker','true',true)"), q("SELECT pg_advisory_xact_lock(hashtextextended('hessara-re-queue',0))"), audited(owner, "artifact.reserve", id, q(`INSERT INTO re_artifacts(id,owner,project_id,name,size_bytes,reserved_bytes,storage_key,status,created_at,retention_until)
      SELECT ?,?,?,?,?,s.max_upload_bytes,?,'reserved',?,?+s.retention_days*86400000::bigint FROM re_settings s WHERE s.id=1 AND ?<=s.max_upload_bytes
      AND coalesce((SELECT sum(CASE WHEN sha256 IS NULL THEN reserved_bytes ELSE size_bytes END) FROM re_artifacts WHERE owner=? AND status<>'purged'),0)+s.max_upload_bytes<=s.max_user_storage_bytes
      AND coalesce((SELECT sum(CASE WHEN sha256 IS NULL THEN reserved_bytes ELSE size_bytes END) FROM re_artifacts WHERE status<>'purged'),0)+s.max_upload_bytes<=s.max_global_storage_bytes
      AND (SELECT count(*) FROM re_artifacts WHERE owner=? AND status<>'purged' AND sha256 IS NULL)<2
      AND EXISTS(SELECT 1 FROM re_projects WHERE id=? AND owner=? AND deleted_at IS NULL) RETURNING *`, id, owner, projectId, name, input.sizeBytes, storageKey, now, now, input.sizeBytes, owner, owner, projectId, owner), { sizeBytes: input.sizeBytes })]);
    if (!r[2].results[0]) throw new ReError("STORAGE_QUOTA_OR_PROJECT_UNAVAILABLE", 409); return camelRow(r[2].results[0]);
  }
  async function getArtifact(owner: string, id: string) { identifier(id); return present((await scoped(owner, [q("SELECT * FROM re_artifacts WHERE id=? AND owner=? AND status NOT IN ('deleted','purged')", id, owner)]))[0].results[0]); }
  async function claimArtifactVerification(owner: string, id: string) { identifier(id); const now = Date.now(), token = randomUUID(); const r = await scoped(owner, [q("SELECT set_config('hessara.re_worker','true',true)"), q("SELECT pg_advisory_xact_lock(hashtextextended('hessara-re-queue',0))"), q("UPDATE re_artifacts SET validation_token=?,validation_until=? WHERE id=? AND owner=? AND status='reserved' AND validation_until<=? AND (SELECT count(*) FROM re_artifacts WHERE status='reserved' AND validation_until>?)<1 RETURNING *", token, now + 45000, id, owner, now, now)]); if (!r[2].results[0]) throw new ReError("ARTIFACT_BUSY", 409); return { verificationToken: token, artifact: camelRow(r[2].results[0]) }; }
  async function releaseArtifactVerification(owner: string, id: string, token: string) { identifier(id); identifier(token); await scoped(owner, [q("UPDATE re_artifacts SET validation_token=NULL,validation_until=0 WHERE id=? AND owner=? AND validation_token=?", id, owner, token)]); return { ok: true }; }
  async function completeArtifact(owner: string, id: string, input: { sha256: string; format: string; metadata?: Record<string, unknown>; scanStatus?: string; verificationToken?: string }) { identifier(id); if (!/^[a-f0-9]{64}$/.test(input.sha256)) throw new ReError("INVALID_HASH"); const format = validateFormat(input.format), token = input.verificationToken ?? ""; if (token) identifier(token); const scan = input.scanStatus ?? "unavailable"; if (!["clean", "unavailable"].includes(scan)) throw new ReError("SCAN_REJECTED"); const r = await scoped(owner, [audited(owner, "artifact.validated", id, q("UPDATE re_artifacts SET status='ready',sha256=?,format=?,metadata=?::jsonb,scan_status=?,validation_token=NULL,validation_until=0 WHERE id=? AND owner=? AND status='reserved' AND ((?='' AND validation_token IS NULL) OR (validation_token=? AND validation_until>?)) RETURNING *", input.sha256, format, json(input.metadata), scan, id, owner, token, token, Date.now()), { format })]); return present(r[0].results[0]); }
  async function rejectArtifact(owner: string, id: string, code: string, verificationToken?: string) { identifier(id); const token = verificationToken ?? ""; if (token) identifier(token); const r = await scoped(owner, [audited(owner, "artifact.rejected", id, q("UPDATE re_artifacts SET status='rejected',error_code=?,validation_token=NULL,validation_until=0 WHERE id=? AND owner=? AND status='reserved' AND ((?='' AND validation_token IS NULL) OR (validation_token=? AND validation_until>?)) RETURNING *", text(code, 100), id, owner, token, token, Date.now()), { code: text(code, 100) })]); return present(r[0].results[0]); }
  async function deleteArtifact(owner: string, id: string) { identifier(id); const r = await scoped(owner, [audited(owner, "artifact.delete_requested", id, q("UPDATE re_artifacts SET status='deleted',deleted_at=? WHERE id=? AND owner=? AND status NOT IN ('deleted','purged') AND NOT EXISTS(SELECT 1 FROM re_jobs WHERE artifact_id=? AND owner=? AND status IN ('queued','validating','running')) RETURNING *", Date.now(), id, owner, id, owner))]); if (!r[0].results[0]) throw new ReError("ARTIFACT_BUSY_OR_NOT_FOUND", 409); return camelRow(r[0].results[0]); }
  async function listArtifacts(owner: string, projectId: string, page: Pagination = {}) { identifier(projectId); const p = pagination(page); return mapRows((await scoped(owner, [q("SELECT * FROM re_artifacts WHERE owner=? AND project_id=? AND status NOT IN ('deleted','purged') ORDER BY created_at DESC,id LIMIT ? OFFSET ?", owner, projectId, p.limit, p.offset)]))[0].results); }
  async function createJob(owner: string, input: { projectId: string; artifactId: string; engineId: string; options?: AnalysisOptions; authorizationConfirmed: boolean; idempotencyKey: string }) {
    if (input.authorizationConfirmed !== true) throw new ReError("AUTHORIZATION_REQUIRED", 403);
    const projectId = identifier(input.projectId), artifactId = identifier(input.artifactId), engineId = validateEngine(input.engineId), key = identifier(input.idempotencyKey), options = validateOptions(input.options);
    if (options.decompile && !["ghidra", "jadx"].includes(engineId)) throw new ReError("UNSUPPORTED_ENGINE_OPTION");
    if (options.symbols && !["rizin", "radare2"].includes(engineId)) throw new ReError("UNSUPPORTED_ENGINE_OPTION");
    if (engineId !== "angr" && (options.symbolicExecution || options.maxPaths !== undefined || options.maxSteps !== undefined)) throw new ReError("UNSUPPORTED_ENGINE_OPTION");
    if (options.strings && !["ghidra", "rizin", "radare2"].includes(engineId)) throw new ReError("UNSUPPORTED_ENGINE_OPTION");
    const definition = engineDefinition(engineId), timeout = Math.min(definition.timeoutSeconds, options.timeoutSeconds ?? definition.timeoutSeconds), now = Date.now(), id = randomUUID();
    const requestHash = createHash("sha256").update(json({ projectId, artifactId, engineId, options })).digest("hex");
    // Global queue counts must see all tenants. This trusted transaction enables
    // the internal queue context, and every target/lookup below still binds owner.
    const r = await scoped(owner, [q("SELECT set_config('hessara.re_worker','true',true)"), q("SELECT pg_advisory_xact_lock(hashtextextended('hessara-re-queue',0))"), q(`INSERT INTO re_jobs(id,owner,project_id,artifact_id,engine_id,status,stage,options,created_at,available_at,timeout_seconds,idempotency_key,request_hash,authorization_at)
      SELECT ?,?,?,?,?,'queued','queued',?::jsonb,?,?,?,?,?,? FROM re_settings s JOIN re_engines e ON e.id=?
      JOIN jsonb_to_recordset(?::jsonb) AS d(id text,"cpuCount" int,"memoryMb" int,"diskMb" int,"baselineCapabilities" jsonb) ON d.id=e.id
      JOIN re_artifacts a ON a.id=? AND a.owner=? AND a.project_id=?
      JOIN re_projects p ON p.id=a.project_id AND p.owner=a.owner
      WHERE s.id=1 AND s.accepting_jobs AND e.enabled AND e.circuit_until<=? AND a.status='ready' AND a.retention_until>? AND a.format=ANY(?::text[]) AND p.deleted_at IS NULL
      AND (SELECT count(*) FROM re_jobs WHERE status='queued')<s.max_global_queued
      AND (SELECT count(*) FROM re_jobs WHERE owner=? AND status='queued')<s.max_user_queued
      AND (SELECT count(*) FROM re_jobs WHERE owner=? AND created_at>=?)<s.max_jobs_per_day
      AND EXISTS(SELECT 1 FROM re_workers w,jsonb_array_elements(${workerEnginesSql("w")}) x WHERE w.heartbeat_at>? AND x->>'id'=e.id AND ${workerReadySql("w", "x", "d")})
      ON CONFLICT(owner,idempotency_key) DO NOTHING RETURNING *`, id, owner, projectId, artifactId, engineId, json(options), now, now, timeout, key, requestHash, now, engineId, json([{ id: engineId, cpuCount: definition.cpuCount, memoryMb: definition.memoryMb, diskMb: definition.diskMb, baselineCapabilities: requiredCapabilities(engineId) }]), artifactId, owner, projectId, now, now, `{${definition.formats.join(",")}}`, owner, owner, now - 86400000, now - WORKER_FRESHNESS_MS),
      q("SELECT * FROM re_jobs WHERE owner=? AND idempotency_key=?", owner, key)]);
    const row = r[2].results[0] ?? r[3].results[0]; if (!row) throw new ReError("ENGINE_UNAVAILABLE_OR_QUEUE_CAPACITY", 409);
    if (row.request_hash !== requestHash) throw new ReError("IDEMPOTENCY_CONFLICT", 409);
    if (r[2].results.length) await scoped(owner, [audit(owner, "job.queued", String(row.id), { engineId, artifactId })]);
    return camelRow(row);
  }
  async function listJobs(owner: string, page: Pagination & { projectId?: string; status?: string } = {}) { const p = pagination(page); const r = await scoped(owner, [q("SELECT j.*,a.name artifact_name FROM re_jobs j JOIN re_artifacts a ON a.id=j.artifact_id WHERE j.owner=? AND (?='' OR j.project_id=?) AND (?='' OR j.status=?) ORDER BY j.created_at DESC,j.id LIMIT ? OFFSET ?", owner, page.projectId ?? "", page.projectId ?? "", page.status ?? "", page.status ?? "", p.limit, p.offset)]); return mapRows(r[0].results); }
  async function getJob(owner: string, id: string) { identifier(id); return present((await scoped(owner, [q("SELECT j.*,a.name artifact_name,a.format artifact_format,a.sha256 artifact_sha256,a.size_bytes artifact_size_bytes,p.name project_name FROM re_jobs j JOIN re_artifacts a ON a.id=j.artifact_id JOIN re_projects p ON p.id=j.project_id WHERE j.id=? AND j.owner=?", id, owner)]))[0].results[0]); }
  async function cancelJob(owner: string, id: string) { identifier(id); const r = await scoped(owner, [audited(owner, "job.cancel_requested", id, q("UPDATE re_jobs SET cancel_requested=true,status=CASE WHEN status='queued' THEN 'cancelled' ELSE status END,stage=CASE WHEN status='queued' THEN 'cancelled' ELSE stage END,finished_at=CASE WHEN status='queued' THEN ? ELSE finished_at END WHERE id=? AND owner=? AND status IN ('queued','validating','running') RETURNING *", Date.now(), id, owner))]); return present(r[0].results[0]); }
  async function findings(owner: string, jobId: string, page: Pagination = {}) { identifier(jobId); const p = pagination(page); return mapRows((await scoped(owner, [q("SELECT * FROM re_findings WHERE owner=? AND job_id=? AND (title ILIKE ? OR description ILIKE ?) ORDER BY created_at,id LIMIT ? OFFSET ?", owner, jobId, `%${p.search}%`, `%${p.search}%`, p.limit, p.offset)]))[0].results); }
  async function evidence(owner: string, jobId: string, page: Pagination & { kind?: EvidenceKind } = {}) { identifier(jobId); const p = pagination(page); return mapRows((await scoped(owner, [q("SELECT id,owner,job_id,kind,name,CASE WHEN kind='code' THEN '' ELSE content END content,location,metadata,storage_key,created_at FROM re_evidence WHERE owner=? AND job_id=? AND (?='' OR kind=?) AND (name ILIKE ? OR content ILIKE ?) ORDER BY created_at,id LIMIT ? OFFSET ?", owner, jobId, page.kind ?? "", page.kind ?? "", `%${p.search}%`, `%${p.search}%`, p.limit, p.offset)]))[0].results); }
  async function evidenceById(owner: string, jobId: string, id: string) { identifier(jobId); identifier(id); return present((await scoped(owner, [q("SELECT * FROM re_evidence WHERE owner=? AND job_id=? AND id=?", owner, jobId, id)]))[0].results[0]); }
  async function reports(owner: string, page: Pagination = {}) { const p = pagination(page); return mapRows((await scoped(owner, [q("SELECT r.*,j.engine_id,p.name project_name FROM re_reports r JOIN re_jobs j ON j.id=r.job_id JOIN re_projects p ON p.id=j.project_id WHERE r.owner=? ORDER BY r.created_at DESC,r.id LIMIT ? OFFSET ?", owner, p.limit, p.offset)]))[0].results); }
  async function getReport(owner: string, id: string) { identifier(id); return present((await scoped(owner, [q("SELECT * FROM re_reports WHERE id=? AND owner=?", id, owner)]))[0].results[0]); }
  async function executions(owner: string, jobId: string, page: Pagination = {}) { identifier(jobId); const p = pagination(page); return mapRows((await scoped(owner, [q("SELECT * FROM re_executions WHERE owner=? AND job_id=? ORDER BY attempt DESC LIMIT ? OFFSET ?", owner, jobId, p.limit, p.offset)]))[0].results); }
  async function count(owner: string, kind: "projects" | "jobs" | "artifacts" | "findings" | "evidence" | "reports", filters: { projectId?: string; jobId?: string; kind?: string; search?: string; status?: string } = {}) {
    const tables = { projects: "re_projects", jobs: "re_jobs", artifacts: "re_artifacts", findings: "re_findings", evidence: "re_evidence", reports: "re_reports" } as const;
    if (!Object.hasOwn(tables, kind)) throw new ReError("INVALID_COLLECTION");
    const where = ["owner=?"], values: unknown[] = [owner];
    if (kind === "projects") where.push("deleted_at IS NULL");
    if (kind === "artifacts") where.push("status NOT IN ('deleted','purged')");
    for (const [key, column, allowed] of [["projectId", "project_id", ["jobs", "artifacts"]], ["jobId", "job_id", ["findings", "evidence", "reports"]], ["kind", "kind", ["evidence"]], ["status", "status", ["jobs", "artifacts"]]] as const) if (filters[key] && (allowed as readonly string[]).includes(kind)) { where.push(`${column}=?`); values.push(filters[key]); }
    const search = typeof filters.search === "string" ? filters.search.slice(0, 160) : "";
    if (search && kind !== "jobs" && kind !== "artifacts" && kind !== "reports") { const columns = kind === "projects" ? ["name", "description"] : kind === "findings" ? ["title", "description"] : ["name", "content"]; where.push(`(${columns[0]} ILIKE ? OR ${columns[1]} ILIKE ?)`); values.push(`%${search}%`, `%${search}%`); }
    const r = await scoped(owner, [q(`SELECT count(*)::int total FROM ${tables[kind]} WHERE ${where.join(" AND ")}`, ...values)]); return Number(r[0].results[0].total);
  }
  async function createReport(owner: string, jobId: string, input: { format: string; storageKey?: string; sha256?: string; sizeBytes?: number }) { identifier(jobId); if (!["json", "pdf"].includes(input.format)) throw new ReError("INVALID_REPORT_FORMAT"); const id = randomUUID(); const r = await scoped(owner, [audited(owner, "report.create", id, q("INSERT INTO re_reports(id,owner,job_id,format,storage_key,sha256,size_bytes,created_at) SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM re_jobs WHERE id=? AND owner=? AND status='completed') RETURNING *", id, owner, jobId, input.format, input.storageKey ?? null, input.sha256 ?? null, input.sizeBytes ?? 0, Date.now(), jobId, owner), { jobId, format: input.format })]); return present(r[0].results[0]); }
  async function adminOverview(owner: string, isAdmin: boolean) { if (!isAdmin) throw new ReError("ADMIN_REQUIRED", 403); const r = await db().batch([q("SELECT set_config('hessara.re_worker','true',true)"), q("SELECT * FROM re_workers ORDER BY heartbeat_at DESC LIMIT 100"), q("SELECT status,count(*)::int count FROM re_jobs GROUP BY status"), q("SELECT count(*)::int total_jobs,count(*) FILTER(WHERE status IN ('failed','timed_out'))::int failed_jobs,avg(finished_at-started_at) FILTER(WHERE status='completed')::float8 average_duration_ms FROM re_jobs WHERE created_at>?", Date.now() - 86400000), q("SELECT coalesce(sum(size_bytes) FILTER(WHERE sha256 IS NOT NULL),0)::float8 storage_bytes,coalesce(sum(reserved_bytes) FILTER(WHERE sha256 IS NULL),0)::float8 reserved_storage_bytes,coalesce(sum(CASE WHEN sha256 IS NULL THEN reserved_bytes ELSE size_bytes END),0)::float8 charged_storage_bytes FROM re_artifacts WHERE status<>'purged'"), q("SELECT * FROM re_settings WHERE id=1"), q("SELECT * FROM re_jobs WHERE status IN ('failed','timed_out') ORDER BY finished_at DESC LIMIT 25")]); return { workers: mapRows(r[1].results), jobs: mapRows(r[2].results), metrics: camelRow(r[3].results[0]), storage: camelRow(r[4].results[0]), settings: camelRow(r[5].results[0]), failures: mapRows(r[6].results), engines: await engines(owner), measuredCapacity: "Worker-reported observations; not an infrastructure benchmark" }; }
  async function configure(owner: string, isAdmin: boolean, input: { acceptingJobs?: boolean; engineId?: string; enabled?: boolean }) { if (!isAdmin) throw new ReError("ADMIN_REQUIRED", 403); const statements = [q("SELECT set_config('hessara.re_worker','true',true)")]; if (typeof input.acceptingJobs === "boolean") statements.push(q("UPDATE re_settings SET accepting_jobs=?,updated_at=? WHERE id=1", input.acceptingJobs, Date.now())); if (input.engineId) { validateEngine(input.engineId); if (typeof input.enabled !== "boolean") throw new ReError("INVALID_INPUT"); statements.push(q("UPDATE re_engines SET enabled=?,updated_at=?,updated_by=?,failures=0,circuit_until=0 WHERE id=?", input.enabled, Date.now(), owner, input.engineId)); } statements.push(audit(owner, "admin.configure", input.engineId ?? "settings", input)); await db().batch(statements); return { ok: true }; }
  return { overview, engines, getSettings, listProjects, createProject, renameProject, deleteProject, reserveArtifact, claimArtifactVerification, releaseArtifactVerification, completeArtifact, rejectArtifact, deleteArtifact, getArtifact, listArtifacts, createJob, listJobs, getJob, cancelJob, findings, evidence, evidenceById, reports, getReport, createReport, executions, count, adminOverview, configure, recommendEngines };
}
export const reService = createReverseEngineeringService();
