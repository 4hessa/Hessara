import type { createDatabase } from "./postgres-database";
import type { Model } from "./benchmarks";
import type { ModelConfig } from "./server";
import {
  customLabInputSchema, LAB_LIMITS, LAB_VERSION, LabError,
  type CustomLabInput, type LabConfig, type LabRun, type LabRunDetail,
  type LabTrial, type LabTrialMetadata, type LabStepResult,
  type LabRunSummary,
} from "./custom-lab.ts";

type Database = ReturnType<typeof createDatabase>;
type RunRow = Omit<LabRun, "configData" | "done" | "recoverable_at"> & { owner: string; lock_token: string | null; locked_until: number; done?: number };
type TrialRow = Omit<LabTrial, "metadataData">;
type Invocation = {
  output: string; latency: number; input_tokens: number | null; output_tokens: number | null;
  cost: number | null; error: string | null; metadata: string; truncated?: boolean;
};
export type LabServiceDependencies = {
  db: Database;
  availableModels(owner: string): Promise<Model[]>;
  modelConfig(id: string, owner: string): Promise<ModelConfig>;
  invokeModel(task: { prompt: string }, model: ModelConfig, owner: string, options: { maxOutputTokens: number }): Promise<Invocation>;
  now?: () => number;
  uuid?: () => string;
};
const asObject = (value: string | null | undefined): Record<string, unknown> => {
  try { const parsed = JSON.parse(value || "{}"); return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}; }
  catch { return {}; }
};
function configuration(row: RunRow): LabConfig {
  const config = JSON.parse(row.config) as LabConfig;
  if (config.kind !== "custom" || config.version !== LAB_VERSION) throw new LabError("VERSION", 409);
  return config;
}
function publicRun(row: RunRow): LabRun {
  return { id: row.id, name: row.name, mode: "custom", status: row.status, created_at: row.created_at,
    config: row.config, configData: configuration(row), total: row.total, next_index: row.next_index, done: row.done ?? 0,
    recoverable_at: row.status === "running" || row.status === "paused" ? new Date(row.locked_until).toISOString() : null };
}
function inputFromConfig(config: LabConfig): CustomLabInput {
  return { requestId: config.requestId, name: config.name, taskType: config.taskType, locale: config.locale,
    models: config.models, cases: config.cases, maxOutputTokens: config.maxOutputTokens };
}

// Injection keeps the real persistence/lease logic testable without credentials or provider traffic.
export function createLabService(dependencies: LabServiceDependencies) {
  const { db } = dependencies;
  const now = dependencies.now ?? Date.now;
  const uuid = dependencies.uuid ?? (() => crypto.randomUUID());
  const iso = () => new Date(now()).toISOString();
  async function rowFor(owner: string, id: string) {
    const row = await db.prepare("SELECT r.*, (SELECT count(*) FROM trials t WHERE t.run_id=r.id AND t.status IN ('done','error')) AS done FROM runs r WHERE r.id=? AND r.owner=? AND r.mode='custom'")
      .bind(id, owner).first<RunRow>();
    if (!row) throw new LabError("NOT_FOUND", 404);
    return row;
  }
  async function getLabRun(owner: string, id: string): Promise<LabRunDetail> {
    const row = await rowFor(owner, id);
    const trials = await db.prepare("SELECT * FROM trials WHERE run_id=? ORDER BY rowid LIMIT 32").bind(id).all<TrialRow>();
    return { run: publicRun(row), trials: trials.results.map(trial => ({ ...trial, metadataData: asObject(trial.metadata) as LabTrialMetadata })) };
  }
  async function listLabRuns(owner: string) {
    const rows = await db.prepare("SELECT r.id,r.name,r.status,r.created_at,r.total, (SELECT count(*) FROM trials t WHERE t.run_id=r.id AND t.status IN ('done','error')) AS done FROM runs r WHERE r.owner=? AND r.mode='custom' ORDER BY created_at DESC LIMIT 200")
      .bind(owner).all<LabRunSummary>();
    return { runs: rows.results, models: (await dependencies.availableModels(owner)).filter(model => model.ready && model.provider !== "simulation") };
  }
  async function createLabRun(owner: string, raw: CustomLabInput): Promise<LabRunDetail> {
    const parsed = customLabInputSchema.safeParse(raw);
    if (!parsed.success) throw new LabError("INVALID_INPUT");
    const input = parsed.data;
    const existing = await db.prepare("SELECT * FROM runs WHERE id=? AND owner=? AND mode='custom'").bind(input.requestId, owner).first<RunRow>();
    if (existing) {
      if (JSON.stringify(inputFromConfig(configuration(existing))) !== JSON.stringify(input)) throw new LabError("ID_CONFLICT", 409);
      return getLabRun(owner, input.requestId);
    }
    const models = await dependencies.availableModels(owner);
    if (input.models.some(id => !models.some(model => model.id === id && model.ready && model.provider !== "simulation"))) throw new LabError("NOT_READY", 409);
    const modelSnapshots = await Promise.all(input.models.map(id => dependencies.modelConfig(id, owner)));
    if (modelSnapshots.some(model => model.provider === "cloudflare") && input.maxOutputTokens > 512) throw new LabError("INVALID_INPUT");
    const created_at = iso();
    const config: LabConfig = {
      ...input, kind: "custom", version: LAB_VERSION, created_at, pricing_recorded_at: created_at,
      modelSnapshots, providerPolicies: Object.fromEntries(modelSnapshots.map(model => [model.id, {
        max_output_tokens: input.maxOutputTokens, timeout_ms: model.provider === "nvidia" ? 90000 : 55000,
        sampling: "provider defaults", reasoning_effort: model.provider === "nvidia" && model.model === "moonshotai/kimi-k3" ? "low" : "provider default", retries: 0,
      }])), concurrency: 1, retries: 0,
    };
    const [insert] = await db.ownerQuotaBatch(owner, [db.prepare("INSERT INTO runs(id,owner,name,mode,status,created_at,config,total) SELECT ?,?,?,'custom','draft',?,?,? WHERE (SELECT count(*) FROM runs WHERE owner=? AND mode='custom')<200 AND (SELECT count(*) FROM runs WHERE owner=? AND mode='custom' AND status IN ('draft','running','paused'))<5 ON CONFLICT(id) DO NOTHING")
      .bind(input.requestId, owner, input.name, created_at, JSON.stringify(config), input.models.length * input.cases.length, owner, owner)]);
    if (insert.meta.changes !== 1) {
      const duplicate = await db.prepare("SELECT * FROM runs WHERE id=? AND owner=? AND mode='custom'").bind(input.requestId, owner).first<RunRow>();
      if (duplicate && JSON.stringify(inputFromConfig(configuration(duplicate))) === JSON.stringify(input)) return getLabRun(owner, input.requestId);
      if (duplicate) throw new LabError("ID_CONFLICT", 409);
      // The response discloses neither foreign ownership nor the contents of a colliding ID.
      throw new LabError("LIMIT_OR_CONFLICT", 409);
    }
    return getLabRun(owner, input.requestId);
  }
  async function claim(owner: string, id: string, expected: "draft" | "paused") {
    const existing = await rowFor(owner, id);
    configuration(existing);
    if (existing.status === "running" && expected === "draft") return false;
    if (existing.status === "running" && expected === "paused") {
      // A dispatch lease throttles explicit recovery when a workflow disappears before
      // taking its execution lease, or between attempts. It never changes the cursor.
      const recovered = await db.prepare("UPDATE runs SET lock_token=NULL,locked_until=? WHERE id=? AND owner=? AND mode='custom' AND status='running' AND locked_until<=? AND ((lock_token IS NOT NULL AND locked_until>0) OR (lock_token IS NULL AND NOT EXISTS(SELECT 1 FROM trials WHERE run_id=runs.id AND status='running'))) RETURNING id")
        .bind(now() + LAB_LIMITS.leaseMs, id, owner, now()).first();
      if (!recovered) throw new LabError("BUSY", 409);
      return true;
    }
    if (existing.status !== expected) throw new LabError("INVALID_STATE", 409);
    const changed = await db.prepare("UPDATE runs SET status='running',lock_token=NULL,locked_until=? WHERE id=? AND owner=? AND mode='custom' AND status=? AND locked_until<=? RETURNING id")
      .bind(now() + LAB_LIMITS.leaseMs, id, owner, expected, now()).first();
    if (!changed) {
      const latest = await rowFor(owner, id);
      if (latest.status === "running") return false;
      throw new LabError("BUSY", 409);
    }
    return true;
  }
  async function cancelLabRun(owner: string, id: string) {
    await rowFor(owner, id);
    // Retain an in-flight lease so that its result can still be saved after cancellation.
    await db.prepare("UPDATE runs SET status='cancelled' WHERE id=? AND owner=? AND mode='custom' AND status IN ('draft','running','paused')")
      .bind(id, owner).run();
    return getLabRun(owner, id);
  }
  async function markLabDispatchFailure(owner: string, id: string) {
    await db.prepare("UPDATE runs SET status=CASE WHEN next_index=0 AND NOT EXISTS(SELECT 1 FROM trials WHERE run_id=runs.id) THEN 'draft' ELSE 'paused' END,locked_until=0 WHERE id=? AND owner=? AND mode='custom' AND status='running' AND lock_token IS NULL")
      .bind(id, owner).run();
  }
  async function markLabWorkflowFailure(owner: string, id: string) {
    // A lease may represent an ambiguous paid call; do not reset its cursor or clear it.
    await db.prepare("UPDATE runs SET status='paused',locked_until=CASE WHEN lock_token IS NULL THEN 0 ELSE locked_until END WHERE id=? AND owner=? AND mode='custom' AND status='running'").bind(id, owner).run();
  }
  async function executeLabStep(owner: string, id: string): Promise<LabStepResult> {
    const existing = await rowFor(owner, id);
    if (existing.status !== "running") return { hasMore: false, paused: existing.status === "paused" };
    const config = configuration(existing);
    const token = uuid();
    const run = await db.prepare("UPDATE runs SET lock_token=?,locked_until=? WHERE id=? AND owner=? AND mode='custom' AND status='running' AND (lock_token IS NULL OR locked_until<=?) RETURNING *")
      .bind(token, now() + LAB_LIMITS.leaseMs, id, owner, now()).first<RunRow>();
    // Another worker owns this run. It alone may dispatch the next paid request.
    if (!run) {
      const latest = await rowFor(owner, id);
      return { hasMore: latest.status === "running", paused: latest.status === "paused", busy: latest.status === "running" };
    }
    try {
      const abandoned = await db.prepare("SELECT * FROM trials WHERE run_id=? AND status='running'").bind(id).all<TrialRow>();
      for (const trial of abandoned.results) {
        await db.prepare("UPDATE trials SET status='error',score=NULL,error='interrupted_unknown_outcome',metadata=? WHERE id=? AND status='running' AND EXISTS(SELECT 1 FROM runs WHERE id=? AND lock_token=?)")
          .bind(JSON.stringify({ ...asObject(trial.metadata), finished_at: iso(), outcome_unknown: true }), trial.id, id, token).run();
      }
      const jobs = config.cases.flatMap(item => config.models.map(model => ({ item, model })));
      const job = jobs[run.next_index];
      if (!job) {
        await db.prepare("UPDATE runs SET status=CASE WHEN status='cancelled' THEN status ELSE 'completed' END,lock_token=NULL,locked_until=0 WHERE id=? AND owner=? AND lock_token=?")
          .bind(id, owner, token).run();
        return { hasMore: false, paused: false };
      }
      const model = config.modelSnapshots.find(item => item.id === job.model);
      const policy = config.providerPolicies[job.model];
      if (!model || !policy) throw new LabError("VERSION", 409);
      const trialId = `${id}:${job.model}:${job.item.id}:0`;
      const startedAt = iso();
      const initial: LabTrialMetadata = { started_at: startedAt, finished_at: null, requested_model: model.model, resolved_model: null, settings: policy };
      // Updating the run first holds its row lock until the attempt insert commits. A cancel
      // either wins before both writes or waits until the current attempt is reserved.
      const reserved = await db.batch([
        db.prepare("UPDATE runs SET next_index=? WHERE id=? AND owner=? AND mode='custom' AND status='running' AND lock_token=? AND next_index=?")
          .bind(run.next_index + 1, id, owner, token, run.next_index),
        db.prepare("INSERT INTO trials(id,run_id,model,task_id,repeat,status,score,metadata) SELECT ?,?,?,?,0,'running',NULL,? WHERE EXISTS(SELECT 1 FROM runs WHERE id=? AND owner=? AND status='running' AND lock_token=? AND next_index=?)")
          .bind(trialId, id, job.model, job.item.id, JSON.stringify(initial), id, owner, token, run.next_index + 1),
      ]);
      if (reserved[1].meta.changes !== 1) {
        await db.prepare("UPDATE runs SET lock_token=NULL,locked_until=0 WHERE id=? AND owner=? AND lock_token=?").bind(id, owner, token).run();
        return { hasMore: false, paused: false };
      }
      const started = now();
      let result: Invocation;
      try { result = await dependencies.invokeModel({ prompt: job.item.prompt }, model, owner, { maxOutputTokens: config.maxOutputTokens }); }
      catch (error) {
        result = { output: "", latency: Math.max(0, now() - started), input_tokens: null, output_tokens: null, cost: null,
          error: error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name) ? "timeout" : "provider_transport_error", metadata: "{}" };
      }
      const providerMetadata = asObject(result.metadata);
      const metadata: LabTrialMetadata = { ...providerMetadata, ...initial, finished_at: iso(),
        resolved_model: typeof providerMetadata.resolved_model === "string" ? providerMetadata.resolved_model : null,
        truncated: result.truncated === true || providerMetadata.truncated === true };
      await db.prepare("UPDATE trials SET status=?,score=NULL,output=?,latency=?,input_tokens=?,output_tokens=?,cost=?,error=?,metadata=? WHERE id=? AND status='running' AND EXISTS(SELECT 1 FROM runs WHERE id=? AND owner=? AND lock_token=?)")
        .bind(result.error ? "error" : "done", result.output, result.latency, result.input_tokens, result.output_tokens, result.cost, result.error, JSON.stringify(metadata), trialId, id, owner, token).run();
      const attention = /^(provider_http_(401|403|429)|provider_pending)$/.test(result.error ?? "");
      const finished = await db.prepare("UPDATE runs SET status=CASE WHEN status IN ('cancelled','paused') THEN status WHEN next_index>=total THEN 'completed' WHEN ? THEN 'paused' ELSE 'running' END,lock_token=NULL,locked_until=CASE WHEN status IN ('cancelled','paused') OR next_index>=total OR ? THEN 0::bigint ELSE ?::bigint END WHERE id=? AND owner=? AND lock_token=? RETURNING *")
        .bind(attention, attention, now() + LAB_LIMITS.leaseMs, id, owner, token).first<RunRow>();
      return { hasMore: finished?.status === "running", paused: finished?.status === "paused" };
    } catch (error) {
      // Never release an ambiguous attempt for reuse. An explicit resume after the lease
      // expires records the abandoned attempt and advances only to untouched jobs.
      await db.prepare("UPDATE runs SET status='paused' WHERE id=? AND owner=? AND lock_token=? AND status='running'").bind(id, owner, token).run().catch(() => undefined);
      throw error;
    }
  }
  return { createLabRun, getLabRun, listLabRuns, cancelLabRun, claimLabStart: (owner: string, id: string) => claim(owner, id, "draft"),
    claimLabResume: (owner: string, id: string) => claim(owner, id, "paused"), markLabDispatchFailure, markLabWorkflowFailure, executeLabStep };
}

async function service() {
  const server = await import("./server");
  return createLabService({ db: server.database(), availableModels: server.availableModels, modelConfig: server.modelConfig, invokeModel: server.invokeModel });
}
export const createLabRun = async (owner: string, input: CustomLabInput) => (await service()).createLabRun(owner, input);
export const getLabRun = async (owner: string, id: string) => (await service()).getLabRun(owner, id);
export const listLabRuns = async (owner: string) => (await service()).listLabRuns(owner);
export const cancelLabRun = async (owner: string, id: string) => (await service()).cancelLabRun(owner, id);
export const claimLabStart = async (owner: string, id: string) => (await service()).claimLabStart(owner, id);
export const claimLabResume = async (owner: string, id: string) => (await service()).claimLabResume(owner, id);
export const markLabDispatchFailure = async (owner: string, id: string) => (await service()).markLabDispatchFailure(owner, id);
export const markLabWorkflowFailure = async (owner: string, id: string) => (await service()).markLabWorkflowFailure(owner, id);
export const executeLabStep = async (owner: string, id: string) => (await service()).executeLabStep(owner, id);
