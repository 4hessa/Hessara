import type { createDatabase } from "./postgres-database";
import type { LabManualReview } from "./lab-evaluation";
import { createManualLabReview, evaluateLabTrial } from "./lab-evaluation.ts";
import { LabError, type LabRunDetail } from "./custom-lab.ts";
import { buildJudgePrompt, parseJudgement, type LabJudgement } from "./lab-judge.ts";
import type { ModelConfig, invokeModel } from "./server";

type Database = ReturnType<typeof createDatabase>;
export type SavedJudgement = {id:string;trial_id:string;status:"running"|"completed"|"failed";model_snapshot:ModelConfig;result:LabJudgement|null;metadata:Record<string,unknown>;error:string|null;created_at:string;finished_at:string|null};
export type LabReviews = {reviews:Record<string,LabManualReview>;judgements:SavedJudgement[]};
type Dependencies = {db:Database;getRun(owner:string,id:string):Promise<LabRunDetail>;modelConfig(id:string,owner:string):Promise<ModelConfig>;availableModels(owner:string):Promise<{id:string;ready:boolean;provider:string}[]>;invoke:typeof invokeModel;now?:()=>Date};

export function createLabReviewService(deps:Dependencies) {
  const {db}=deps;
  const now=()=> (deps.now?.() ?? new Date()).toISOString();
  async function read(owner:string, runId:string):Promise<LabReviews> {
    await deps.getRun(owner,runId);
    const [reviews,judgements]=await db.scopedBatch(owner,[
      db.prepare("SELECT trial_id,review FROM lab_reviews WHERE owner=? AND run_id=?").bind(owner,runId),
      db.prepare("SELECT id,trial_id,status,model_snapshot,result,metadata,error,created_at,finished_at FROM lab_judgements WHERE owner=? AND run_id=? ORDER BY created_at DESC LIMIT 96").bind(owner,runId),
    ]);
    return {reviews:Object.fromEntries(reviews.results.map(row=>[row.trial_id,row.review as LabManualReview])),judgements:judgements.results as SavedJudgement[]};
  }
  async function review(owner:string,runId:string,trialId:string,input:unknown) {
    const detail=await deps.getRun(owner,runId);
    const trial=detail.trials.find(x=>x.id===trialId);
    if (!trial || trial.status==="running") throw new LabError("NOT_EVALUABLE",409);
    const saved=createManualLabReview(input,now());
    if (saved.criteria.some(x=>x.evidence && !trial.output?.includes(x.evidence))) throw new LabError("UNSUPPORTED_EVIDENCE");
    await db.scopedBatch(owner,[db.prepare("INSERT INTO lab_reviews(trial_id,run_id,owner,review,updated_at) VALUES(?,?,?,?::text::jsonb,?::timestamptz) ON CONFLICT(trial_id) DO UPDATE SET review=excluded.review,updated_at=excluded.updated_at WHERE lab_reviews.owner=excluded.owner AND lab_reviews.run_id=excluded.run_id")
      .bind(trialId,runId,owner,JSON.stringify(saved),saved.reviewedAt)]);
    return saved;
  }
  async function judge(owner:string,runId:string,trialId:string,modelId:string,requestId:string) {
    const detail=await deps.getRun(owner,runId);
    const trial=detail.trials.find(x=>x.id===trialId);
    const item=detail.run.configData.cases.find(x=>x.id===trial?.task_id);
    if (!trial || !item || trial.status!=="done" || trial.error || trial.metadataData.truncated) throw new LabError("NOT_EVALUABLE",409);
    const [old]=await db.scopedBatch(owner,[db.prepare("SELECT * FROM lab_judgements WHERE owner=? AND id=?::uuid").bind(owner,requestId)]);
    if(old.results[0]) {
      const row=old.results[0];
      if(row.trial_id!==trialId || row.run_id!==runId || (row.model_snapshot as ModelConfig).id!==modelId) throw new LabError("ID_CONFLICT",409);
      return row as SavedJudgement;
    }
    const available=await deps.availableModels(owner);
    if(!available.some(x=>x.id===modelId && x.ready && x.provider!=="simulation")) throw new LabError("NOT_READY",409);
    const model=await deps.modelConfig(modelId,owner);
    // Same provider/model cannot independently judge its own answer.
    const author=detail.run.configData.modelSnapshots.find(x=>x.id===trial.model);
    if(author?.provider===model.provider && author.model===model.model) throw new LabError("SAME_EVALUATOR",409);
    const prompt=buildJudgePrompt(item,trial,detail.run.configData.locale);
    const [reserved]=await db.scopedBatch(owner,[db.prepare("INSERT INTO lab_judgements(id,trial_id,run_id,owner,status,model_snapshot,created_at) SELECT ?::uuid,?,?,?,'running',?::text::jsonb,?::timestamptz WHERE (SELECT count(*) FROM lab_judgements WHERE owner=? AND created_at>now()-interval '24 hours')<40 AND (SELECT count(*) FROM lab_judgements WHERE owner=? AND trial_id=?)<3 AND NOT EXISTS(SELECT 1 FROM lab_judgements WHERE owner=? AND status='running' AND created_at>now()-interval '3 minutes') ON CONFLICT(id) DO NOTHING RETURNING id")
      .bind(requestId,trialId,runId,owner,JSON.stringify(model),now(),owner,owner,trialId,owner)]);
    if(reserved.meta.changes!==1) throw new LabError("LIMIT_OR_CONFLICT",409);
    let result:LabJudgement|null=null, error:string|null=null;
    let metadata:Record<string,unknown>={requested_model:model.model,max_output_tokens:4096,retries:0,version:"hessara-visible-answer/1",fact_verification:false};
    try {
      const response=await deps.invoke({prompt},model,owner,{maxOutputTokens:4096});
      const providerMetadata:unknown=JSON.parse(response.metadata || "{}");
      metadata={...metadata,provider:providerMetadata,latency:response.latency,input_tokens:response.input_tokens,output_tokens:response.output_tokens,cost:response.cost};
      if(response.error || response.truncated) error=response.error || "incomplete_response";
      else {
        try { result=parseJudgement(response.output,trial,!!item.reference?.trim(),now()); }
        catch { error="INVALID_EVALUATION"; }
      }
    } catch { error="interrupted_unknown_outcome"; }
    const [saved]=await db.scopedBatch(owner,[db.prepare("UPDATE lab_judgements SET status=?,result=?::text::jsonb,metadata=?::text::jsonb,error=?,finished_at=?::timestamptz WHERE id=?::uuid AND owner=? AND status='running' RETURNING id,trial_id,status,model_snapshot,result,metadata,error,created_at,finished_at")
      .bind(error?"failed":"completed",result?JSON.stringify(result):null,JSON.stringify(metadata),error,now(),requestId,owner)]);
    if(!saved.results[0]) throw new LabError("NOT_FOUND",404);
    return saved.results[0] as SavedJudgement;
  }
  async function remove(owner:string,runId:string,trialId:string) {
    await deps.getRun(owner,runId);
    await db.scopedBatch(owner,[db.prepare("DELETE FROM lab_reviews WHERE owner=? AND run_id=? AND trial_id=?").bind(owner,runId,trialId)]);
  }
  return {read,review,judge,remove};
}

export async function labReviewService() {
  const {database,modelConfig,availableModels,invokeModel}=await import("./server");
  const {getLabRun}=await import("./lab-service");
  return createLabReviewService({db:database(),getRun:getLabRun,modelConfig,availableModels,invoke:invokeModel});
}
export { evaluateLabTrial };
