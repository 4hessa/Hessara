import {z} from "zod";
import {identity,fail,HttpError} from "@/lib/server";
import {LabError,readLabJson} from "@/lib/custom-lab";
import {labReportActionSchema,labReportService} from "@/lib/lab-reports";

export const runtime="nodejs";
export const maxDuration=30;
type Context={params:Promise<{id:string}>};
const headers={"cache-control":"private, no-store","referrer-policy":"no-referrer","x-robots-tag":"noindex, nofollow, noarchive"};
function failure(error:unknown){
  const response=fail(error instanceof LabError?new HttpError(error.message,error.status):error instanceof z.ZodError?new HttpError("INVALID_INPUT"):error);
  for(const [key,value] of Object.entries(headers)) response.headers.set(key,value);
  return response;
}
async function id(context:Context){const parsed=z.string().uuid().safeParse((await context.params).id);if(!parsed.success)throw new LabError("NOT_FOUND",404);return parsed.data;}
export async function GET(_request:Request,context:Context){
  try{return Response.json(await (await labReportService()).read(await identity(),await id(context)),{headers});}
  catch(error){return failure(error);}
}
export async function POST(request:Request,context:Context){
  try{
    const owner=await identity(request),runId=await id(context),body=labReportActionSchema.parse(await readLabJson(request)),service=await labReportService();
    if(body.action==="publish")return Response.json(await service.publish(owner,runId,body.previewHash,body.consent),{headers});
    await service.revoke(owner,runId,body.shareId);return Response.json({revoked:true},{headers});
  }catch(error){return failure(error);}
}
