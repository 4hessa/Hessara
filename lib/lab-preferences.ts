import { z } from "zod";
import { LAB_TASK_TYPES, LAB_VERSION, LabError, type LabConfig, type LabCheck, type LabTrialMetadata } from "./custom-lab.ts";
import { LAB_EVALUATION_VERSION, evaluateLabTrial } from "./lab-evaluation.ts";
import type { createDatabase } from "./postgres-database";

export const LAB_PREFERENCES_VERSION = "hessara-preferences/1";
export type LabTaskType = typeof LAB_TASK_TYPES[number];
export const labPreferencesSchema = z.object({
  taskTypes: z.array(z.enum(LAB_TASK_TYPES)).max(LAB_TASK_TYPES.length)
    .refine(items => new Set(items).size === items.length, "Duplicate task type"),
  priority: z.enum(["balanced", "cost", "speed"]),
  audience: z.enum(["beginner", "student", "technical"]),
  allowHistory: z.boolean().default(false),
}).strict();
export const labPreferencesSaveSchema = z.object({ consent: z.literal(true), preferences: labPreferencesSchema }).strict();
export const labPreferencesDeleteSchema = z.object({ consent: z.literal(true) }).strict();
export type LabPreferences = z.infer<typeof labPreferencesSchema>;
export type SavedLabPreferences = LabPreferences & {
  version: typeof LAB_PREFERENCES_VERSION; consentedAt: string; updatedAt: string;
};
export type LabHistoryModel = {
  id: string; name: string; provider: string; requestedModel: string; versions: string[];
  successfulTrials: number; attemptedTrials: number;
  passedChecks: number; measuredChecks: number; configuredChecks: number;
};
export type LabHistoryEvidence = {
  runId: string; name: string; createdAt: string; taskType: LabTaskType; caseCount: number;
  models: LabHistoryModel[];
  cases: { id: string; title: string; prompt: string; checks: LabCheck[] }[];
  settings: Pick<LabConfig, "maxOutputTokens" | "providerPolicies">;
  provenance: "personal_deterministic_checks"; scope: "within_run_only";
  evaluationVersion: typeof LAB_EVALUATION_VERSION;
};
export type LabPreferencesResponse = {
  preferences: SavedLabPreferences | null; evidence: LabHistoryEvidence[]; historyEnabled: boolean;
};
type Database = ReturnType<typeof createDatabase>;
type PreferenceRow = { preferences: unknown; consented_at: string | Date; updated_at: string | Date };
type HistoryTrial = { id: string; model: string; task_id: string; status: "done" | "error" | "running"; output: string | null; error: string | null; metadata: string | null };
type HistoryRow = { id: string; name: string; created_at: string; config: string; trials: HistoryTrial[] };

const timestamp = (value: string | Date) => new Date(value).toISOString();
function storedPreferences(row: PreferenceRow | undefined): SavedLabPreferences | null {
  if (!row) return null;
  const parsed = labPreferencesSchema.safeParse(row.preferences);
  if (!parsed.success) throw new LabError("VERSION", 409);
  return { ...parsed.data, version: LAB_PREFERENCES_VERSION, consentedAt: timestamp(row.consented_at), updatedAt: timestamp(row.updated_at) };
}
function metadata(value: string | null): LabTrialMetadata {
  try { const parsed: unknown = JSON.parse(value || "{}"); if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as LabTrialMetadata; }
  catch { /* An unavailable metadata field is never invented. */ }
  return {} as LabTrialMetadata;
}
function historyEvidence(row: HistoryRow): LabHistoryEvidence | null {
  let config: LabConfig;
  try { config = JSON.parse(row.config) as LabConfig; } catch { return null; }
  if (config.kind !== "custom" || config.version !== LAB_VERSION || !Array.isArray(config.modelSnapshots) || !Array.isArray(config.cases)) return null;
  // Only compare measurements within their original run. Failed, omitted, or
  // truncated responses are not measured and must not become a zero-quality score.
  const models = config.modelSnapshots.filter(model => model.provider !== "simulation").map(model => {
    const trials = row.trials.filter(trial => trial.model === model.id);
    const versions = new Set<string>();
    let passedChecks = 0, measuredChecks = 0, successfulTrials = 0;
    for (const trial of trials) {
      const item = config.cases.find(item => item.id === trial.task_id);
      if (!item) continue;
      const metadataData = metadata(trial.metadata);
      if (typeof metadataData.resolved_model === "string" && metadataData.resolved_model) versions.add(metadataData.resolved_model);
      const evaluation = evaluateLabTrial(item, { ...trial, metadataData });
      passedChecks += evaluation.coverage.passed;
      measuredChecks += evaluation.coverage.measured;
      if (!evaluation.warnings.some(warning => ["attempt_running", "attempt_error", "output_missing", "output_truncated"].includes(warning))) successfulTrials++;
    }
    return {
      id: model.id, name: model.name, provider: model.provider, requestedModel: model.model,
      versions: [...versions], successfulTrials,
      attemptedTrials: trials.length, passedChecks, measuredChecks,
      configuredChecks: config.cases.reduce((sum, item) => sum + (item.checks?.length ?? 0), 0),
    };
  });
  if (!models.some(model => model.attemptedTrials > 0)) return null;
  return {
    runId: row.id, name: row.name, createdAt: row.created_at, taskType: config.taskType, caseCount: config.cases.length, models,
    cases: config.cases.map(({ id, title, prompt, checks }) => ({ id, title, prompt, checks: checks ?? [] })),
    settings: { maxOutputTokens: config.maxOutputTokens, providerPolicies: config.providerPolicies },
    provenance: "personal_deterministic_checks", scope: "within_run_only", evaluationVersion: LAB_EVALUATION_VERSION,
  };
}

/** Server identity is the only owner argument. This service never calls an AI provider. */
export function createLabPreferencesService({ db, now = Date.now }: { db: Database; now?: () => number }) {
  const preferenceQuery = (owner: string) => db.prepare("SELECT preferences,consented_at,updated_at FROM lab_preferences WHERE owner=?").bind(owner);
  async function read(owner: string, taskType?: LabTaskType): Promise<LabPreferencesResponse> {
    if (!owner) throw new LabError("UNAUTHENTICATED", 401);
    if (taskType !== undefined && !LAB_TASK_TYPES.includes(taskType)) throw new LabError("INVALID_INPUT");
    const queries = [preferenceQuery(owner)];
    if (taskType) queries.push(db.prepare(`
      WITH eligible_runs AS (
        SELECT r.id,r.name,r.created_at,r.config FROM runs r
        WHERE r.owner=? AND r.mode='custom' AND r.status IN ('completed','paused','cancelled','failed')
          AND r.config::jsonb->>'taskType'=? AND r.config::jsonb->>'version'=?
          AND EXISTS (SELECT 1 FROM lab_preferences p WHERE p.owner=r.owner AND p.preferences->>'allowHistory'='true')
        ORDER BY r.created_at DESC,r.id LIMIT 20
      )
      SELECT r.*,COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id',t.id,'model',t.model,'task_id',t.task_id,'status',t.status,
        'output',CASE WHEN octet_length(t.output)<=32768 THEN t.output ELSE NULL END,
        'error',t.error,'metadata',t.metadata) ORDER BY t.rowid)
        FROM (SELECT id,model,task_id,status,output,error,metadata,rowid FROM trials
          WHERE run_id=r.id ORDER BY rowid LIMIT 32) t),'[]'::jsonb) AS trials
      FROM eligible_runs r ORDER BY r.created_at DESC,r.id
    `).bind(owner, taskType, LAB_VERSION));
    // Consent and evidence are read under the same per-owner lock used for
    // saves and withdrawals. A concurrent withdrawal cannot leak later history.
    const result = await db.scopedBatch(owner, queries);
    const preferences = storedPreferences(result[0].results[0] as PreferenceRow | undefined);
    return {
      preferences, historyEnabled: preferences?.allowHistory === true,
      evidence: preferences?.allowHistory && taskType
        ? (result[1].results as unknown as HistoryRow[]).map(historyEvidence).filter((item): item is LabHistoryEvidence => item !== null) : [],
    };
  }
  async function save(owner: string, input: unknown): Promise<LabPreferencesResponse> {
    if (!owner) throw new LabError("UNAUTHENTICATED", 401);
    const parsed = labPreferencesSaveSchema.safeParse(input);
    if (!parsed.success) throw new LabError("INVALID_INPUT");
    const at = new Date(now()).toISOString();
    const [result] = await db.scopedBatch(owner, [db.prepare(`
      INSERT INTO lab_preferences(owner,preferences,consent_version,consented_at,updated_at)
      VALUES(?,?::text::jsonb,?,?::timestamptz,?::timestamptz)
      ON CONFLICT(owner) DO UPDATE SET preferences=EXCLUDED.preferences,
        consent_version=EXCLUDED.consent_version,consented_at=EXCLUDED.consented_at,updated_at=EXCLUDED.updated_at
      RETURNING preferences,consented_at,updated_at
    `).bind(owner, JSON.stringify(parsed.data.preferences), LAB_PREFERENCES_VERSION, at, at)]);
    const preferences = storedPreferences(result.results[0] as PreferenceRow | undefined);
    return { preferences, evidence: [], historyEnabled: preferences?.allowHistory === true };
  }
  async function remove(owner: string, input: unknown): Promise<LabPreferencesResponse> {
    if (!owner) throw new LabError("UNAUTHENTICATED", 401);
    if (!labPreferencesDeleteSchema.safeParse(input).success) throw new LabError("INVALID_INPUT");
    // Withdrawal removes the stored preferences and consent; it does not delete
    // experiments. Deleting experiments is a separate explicit user action.
    await db.scopedBatch(owner, [db.prepare("DELETE FROM lab_preferences WHERE owner=?").bind(owner)]);
    return { preferences: null, evidence: [], historyEnabled: false };
  }
  return { read, save, remove };
}
async function service() {
  const { database } = await import("./postgres-database");
  return createLabPreferencesService({ db: database() });
}
export async function readLabPreferences(owner: string, taskType?: LabTaskType) { return (await service()).read(owner, taskType); }
export async function saveLabPreferences(owner: string, input: unknown) { return (await service()).save(owner, input); }
export async function deleteLabPreferences(owner: string, input: unknown) { return (await service()).remove(owner, input); }
