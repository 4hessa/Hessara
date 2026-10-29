import {z} from "zod";
import {identity,fail,HttpError} from "@/lib/server";
import {LabError,readLabJson} from "@/lib/custom-lab";
import {labManualReviewSchema} from "@/lib/lab-evaluation";
import {labReviewService} from "@/lib/lab-reviews";

export const runtime="nodejs";
export const maxDuration=120;
type Context={params:Promise<{id:string}>};
const headers={"cache-control":"private, no-store"};
const input=z.discriminatedUnion("action",[
  z.object({action:z.literal("review"),trialId:z.string().min(1).max(500),review:labManualReviewSchema}).strict(),
  z.object({action:z.literal("remove"),trialId:z.string().min(1).max(500)}).strict(),
  z.object({action:z.literal("judge"),trialId:z.string().min(1).max(500),modelId:z.string().min(1).max(200),requestId:z.string().uuid(),consent:z.literal(true)}).strict(),
]);
const failure=(error:unknown)=>fail(error instanceof LabError?new HttpError(error.message,error.status):error instanceof z.ZodError?new HttpError("INVALID_INPUT"):error);
async function id(context:Context){const value=z.string().uuid().safeParse((await context.params).id);if(!value.success)throw new LabError("NOT_FOUND",404);return value.data;}
export async function GET(_request:Request,context:Context){
  try{return Response.json(await (await labReviewService()).read(await identity(),await id(context)),{headers});}
  catch(error){return failure(error);}
}
export async function POST(request:Request,context:Context){
  try{
    const owner=await identity(request),runId=await id(context),body=input.parse(await readLabJson(request)),service=await labReviewService();
    if(body.action==="review") return Response.json({review:await service.review(owner,runId,body.trialId,body.review)},{headers});
    if(body.action==="remove"){await service.remove(owner,runId,body.trialId);return Response.json({removed:true},{headers});}
    return Response.json({judgement:await service.judge(owner,runId,body.trialId,body.modelId,body.requestId)},{headers});
  }catch(error){return failure(error);}
}
