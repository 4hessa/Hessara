import {LabError} from "@/lib/custom-lab";
import {labReportService} from "@/lib/lab-reports";

export const runtime="nodejs";
export const maxDuration=30;
const headers={"cache-control":"private, no-store","referrer-policy":"no-referrer","x-robots-tag":"noindex, nofollow, noarchive","x-content-type-options":"nosniff"};
export async function GET(_request:Request,context:{params:Promise<{token:string}>}){
  try{return Response.json(await (await labReportService()).shared((await context.params).token),{headers});}
  catch(error){return Response.json({error:error instanceof LabError?error.message:"INTERNAL"},{status:error instanceof LabError?error.status:500,headers});}
}
