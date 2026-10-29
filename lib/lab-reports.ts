import { createHash, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import type { createDatabase } from "./postgres-database";
import { LabError, type LabRunDetail } from "./custom-lab.ts";
import { createManualLabReview, evaluateLabTrial } from "./lab-evaluation.ts";
import { parseJudgement } from "./lab-judge.ts";
import type { LabReviews } from "./lab-reviews";
import type { ModelConfig } from "./server";

export const LAB_REPORT_VERSION = "hessara-report/1";
export const LAB_REPORT_LIMITS = { bytes: 3 * 1024 * 1024 - 65536, activeShares: 20, lifetimeDays: 30 } as const;
export const labReportActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("publish"), previewHash: z.string().regex(/^[a-f0-9]{64}$/), consent: z.literal(true) }).strict(),
  z.object({ action: z.literal("revoke"), shareId: z.string().uuid() }).strict(),
]);
const numberOrNull = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
const dateOrNull = (value: unknown) => (typeof value === "string" || value instanceof Date) && Number.isFinite(new Date(value).getTime()) ? new Date(value).toISOString() : null;
const textOrNull = (value: unknown) => typeof value === "string" ? value : null;
function publicModel(model: ModelConfig) {
  return { id: model.id, name: model.name, provider: model.provider, requestedModel: model.model,
    pricing: { inputUSDPerMillion: numberOrNull(model.inputPrice), outputUSDPerMillion: numberOrNull(model.outputPrice), provenance: "configured_not_independently_verified" as const } };
}
function policy(value: LabRunDetail["run"]["configData"]["providerPolicies"][string]) {
  return { maxOutputTokens: value?.max_output_tokens ?? null, timeoutMs: value?.timeout_ms ?? null,
    sampling: value?.sampling ?? "provider defaults", reasoningEffort: value?.reasoning_effort ?? "provider default", retries: 0 as const };
}
/** Explicit allowlists keep raw provider metadata, credentials and ownership out of exports. */
export function buildLabReport(detail: LabRunDetail, reviews: LabReviews) {
  const { run, trials } = detail;
  const config = run.configData;
  const cases = config.cases.map(item => ({ id: item.id, title: item.title, prompt: item.prompt, reference: item.reference || null,
    referenceProvenance: "user_supplied_unverified_reference" as const, checks: (item.checks ?? []).map(check => ({kind: check.kind, value: check.value})) }));
  const results = [...trials].sort((a,b) => a.id.localeCompare(b.id)).map(trial => {
    const item = config.cases.find(candidate => candidate.id === trial.task_id);
    if (!item) throw new LabError("INVALID_REPORT", 409);
    const saved = reviews.reviews[trial.id];
    const manualReview = saved ? createManualLabReview({criteria: saved.criteria, claims: saved.claims, notes: saved.notes}, saved.reviewedAt) : null;
    const judgements = reviews.judgements.filter(judge => judge.trial_id === trial.id).sort((a,b) => a.id.localeCompare(b.id)).map(judge => {
      const raw = judge.result;
      const result = raw ? parseJudgement(JSON.stringify({criteria:raw.criteria,strengths:raw.strengths,weaknesses:raw.weaknesses,claims:raw.claims,referenceAlignment:raw.referenceAlignment}),trial,!!item.reference?.trim(),raw.evaluatedAt) : null;
      return {id:judge.id,status:judge.status,evaluator:publicModel(judge.model_snapshot),result,
        createdAt:dateOrNull(judge.created_at),finishedAt:dateOrNull(judge.finished_at),
        measurements:{latencyMs:numberOrNull(judge.metadata.latency),inputTokens:numberOrNull(judge.metadata.input_tokens),outputTokens:numberOrNull(judge.metadata.output_tokens),estimatedUSD:numberOrNull(judge.metadata.cost)},
        error:judge.error ? "evaluation_unavailable" as const : null};
    });
    return {id:trial.id,caseId:trial.task_id,modelId:trial.model,status:trial.status,output:trial.output,
      startedAt:dateOrNull(trial.metadataData.started_at),finishedAt:dateOrNull(trial.metadataData.finished_at),
      requestedModel:textOrNull(trial.metadataData.requested_model),resolvedModel:textOrNull(trial.metadataData.resolved_model),
      settings:policy(config.providerPolicies[trial.model]),truncated:trial.metadataData.truncated === true,
      measurements:{latencyMs:numberOrNull(trial.latency),inputTokens:numberOrNull(trial.input_tokens),outputTokens:numberOrNull(trial.output_tokens),estimatedUSD:numberOrNull(trial.cost)},
      error:trial.error ? (trial.error === "interrupted_unknown_outcome" ? "interrupted_unknown_outcome" as const : "request_failed" as const) : null,
      evaluation:evaluateLabTrial(item,trial),manualReview,judgements};
  });
  const sources = results.flatMap(trial => (trial.manualReview?.claims ?? []).filter(claim => claim.sourceURL).map(claim => ({trialId:trial.id,
    url:claim.sourceURL!,title:claim.sourceTitle || null,quote:claim.quote || null,claim:claim.claim,status:claim.status,
    provenance:"user_supplied_source" as const,independentlyVerified:false as const})));
  const report = {
    version:LAB_REPORT_VERSION,
    experiment:{id:run.id,name:run.name,taskType:config.taskType,locale:config.locale,status:run.status,createdAt:run.created_at},
    methodology:{executionVersion:config.version,evaluationVersion:"hessara-lab-checks/1",samePromptPerCase:true,modality:"text_only",maxOutputTokens:config.maxOutputTokens,
      concurrency:1,retries:0,plannedCalls:run.total,recordedAttempts:trials.length,pricingRecordedAt:config.pricing_recorded_at,
      scoreBasis:"passed_configured_checks_only",automatedFactVerification:false},
    models:config.modelSnapshots.map(publicModel),cases,trials:results,sources,
    limitations:["not_an_absolute_model_ranking","configured_checks_are_not_factual_accuracy","manual_reviews_are_user_opinions","model_assessments_are_fallible","facts_not_automatically_verified","references_not_independently_verified","configured_prices_may_differ_from_billing","provider_defaults_may_differ","unknown_values_remain_null","snapshot_does_not_update"] as const,
  };
  if (Buffer.byteLength(JSON.stringify(report),"utf8") > LAB_REPORT_LIMITS.bytes) throw new LabError("REPORT_TOO_LARGE",413);
  return report;
}
export type LabReport = ReturnType<typeof buildLabReport>;
export type LabReportShare = {id:string;createdAt:string;expiresAt:string;revokedAt:string|null;previewHash:string};
type ShareRow = {id:string;created_at:string;expires_at:string;revoked_at:string|null;preview_hash:string};
const publicShare = (row:ShareRow):LabReportShare => ({id:row.id,createdAt:dateOrNull(row.created_at)!,expiresAt:dateOrNull(row.expires_at)!,revokedAt:dateOrNull(row.revoked_at),previewHash:row.preview_hash});
const hash = (value:string) => createHash("sha256").update(value).digest("hex");
export const reportPreviewHash = (report:LabReport) => hash(JSON.stringify(report));
type Dependencies = {db:ReturnType<typeof createDatabase>;getRun(owner:string,id:string):Promise<LabRunDetail>;getReviews(owner:string,id:string):Promise<LabReviews>;now?:()=>Date};

export function createLabReportService(deps:Dependencies) {
  const {db}=deps;
  const now=()=>deps.now?.() ?? new Date();
  async function snapshot(owner:string,runId:string) {
    const detail=await deps.getRun(owner,runId);
    const review=await deps.getReviews(owner,runId);
    return buildLabReport(detail,review);
  }
  async function read(owner:string,runId:string) {
    const report=await snapshot(owner,runId);
    const [shares]=await db.scopedBatch(owner,[db.prepare("SELECT id,created_at,expires_at,revoked_at,preview_hash FROM lab_reports WHERE owner=? AND run_id=? ORDER BY created_at DESC LIMIT 100").bind(owner,runId)]);
    return {report,previewHash:reportPreviewHash(report),shares:(shares.results as ShareRow[]).map(publicShare)};
  }
  async function publish(owner:string,runId:string,previewHash:string,consent:boolean) {
    const parsed=labReportActionSchema.parse({action:"publish",previewHash,consent});
    if(parsed.action!=="publish") throw new LabError("INVALID_INPUT");
    const report=await snapshot(owner,runId);
    if(!report.trials.length || report.trials.some(trial=>trial.status==="running") || report.experiment.status==="running") throw new LabError("REPORT_NOT_READY",409);
    if(reportPreviewHash(report)!==previewHash) throw new LabError("REPORT_CHANGED",409);
    const token=randomBytes(32).toString("base64url"),id=randomUUID(),created=now();
    const expires=new Date(created.getTime()+LAB_REPORT_LIMITS.lifetimeDays*86400000);
    const [,insert]=await db.scopedBatch(owner,[
      // Expired and revoked shares are no longer usable; remove only this owner's old snapshots.
      db.prepare("DELETE FROM lab_reports WHERE owner=? AND (revoked_at IS NOT NULL OR expires_at<=?::timestamptz)").bind(owner,created.toISOString()),
      db.prepare("INSERT INTO lab_reports(id,run_id,owner,token_hash,preview_hash,snapshot,created_at,expires_at) SELECT ?::uuid,?,?,?,?,?::text::jsonb,?::timestamptz,?::timestamptz WHERE (SELECT count(*) FROM lab_reports WHERE owner=?)<20 RETURNING id,created_at,expires_at,revoked_at,preview_hash")
        .bind(id,runId,owner,hash(token),previewHash,JSON.stringify(report),created.toISOString(),expires.toISOString(),owner),
    ]);
    if(insert.meta.changes!==1) throw new LabError("SHARE_LIMIT",409);
    return {share:publicShare(insert.results[0] as ShareRow),token,path:`/reports/${token}`};
  }
  async function revoke(owner:string,runId:string,id:string) {
    await deps.getRun(owner,runId);
    const [updated]=await db.scopedBatch(owner,[db.prepare("UPDATE lab_reports SET revoked_at=COALESCE(revoked_at,?::timestamptz) WHERE id=?::uuid AND owner=? AND run_id=? RETURNING id").bind(now().toISOString(),id,owner,runId)]);
    if(updated.meta.changes!==1) throw new LabError("NOT_FOUND",404);
  }
  async function shared(token:string) {
    if(!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new LabError("NOT_FOUND",404);
    const tokenHash=hash(token);
    const [rows]=await db.scopedBatch("",[db.prepare("SELECT snapshot,created_at,expires_at FROM lab_reports WHERE token_hash=? AND revoked_at IS NULL AND expires_at>now() LIMIT 1").bind(tokenHash)],tokenHash);
    const row=rows.results[0];
    if(!row) throw new LabError("NOT_FOUND",404);
    return {report:row.snapshot as LabReport,publishedAt:dateOrNull(row.created_at)!,expiresAt:dateOrNull(row.expires_at)!};
  }
  return {read,publish,revoke,shared};
}
export async function labReportService() {
  const {database}=await import("./server");
  const {getLabRun}=await import("./lab-service");
  const {labReviewService}=await import("./lab-reviews");
  const reviews=await labReviewService();
  return createLabReportService({db:database(),getRun:getLabRun,getReviews:reviews.read});
}
