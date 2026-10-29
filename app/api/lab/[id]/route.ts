import { z } from "zod";
import { identity, fail, HttpError, database } from "@/lib/server";
import { removeLabExperiment } from "@/lib/lab-history";
import { LabError, readLabJson } from "@/lib/custom-lab";
import { getLabRun, cancelLabRun, claimLabStart, claimLabResume, markLabDispatchFailure } from "@/lib/lab-service";
import { startLabBackground } from "@/lib/lab-background";

export const runtime = "nodejs";
export const maxDuration = 30;
type Context = { params: Promise<{ id: string }> };
const headers = { "cache-control": "no-store" };
const actionSchema = z.object({ action: z.enum(["start", "cancel", "resume"]) }).strict();
const failure = (error: unknown) => fail(error instanceof LabError ? new HttpError(error.message, error.status) : error);
async function runId(context: Context) {
  const parsed = z.string().uuid().safeParse((await context.params).id);
  if (!parsed.success) throw new LabError("NOT_FOUND", 404);
  return parsed.data;
}
export async function GET(_request: Request, context: Context) {
  try { return Response.json(await getLabRun(await identity(), await runId(context)), { headers }); }
  catch (error) { return failure(error); }
}
export async function POST(request: Request, context: Context) {
  try {
    const owner = await identity(request);
    const id = await runId(context);
    const parsed = actionSchema.safeParse(await readLabJson(request));
    if (!parsed.success) throw new LabError("INVALID_INPUT");
    if (parsed.data.action === "cancel") return Response.json(await cancelLabRun(owner, id), { headers });
    const claimed = parsed.data.action === "start" ? await claimLabStart(owner, id) : await claimLabResume(owner, id);
    if (claimed) {
      try { await startLabBackground(owner, id); }
      catch {
        await markLabDispatchFailure(owner, id);
        throw new LabError("DISPATCH_FAILED", 503);
      }
    }
    return Response.json(await getLabRun(owner, id), { headers });
  } catch (error) { return failure(error); }
}
export async function DELETE(request:Request,context:Context) {
  try {
    const owner=await identity(request), id=await runId(context);
    if(!z.object({consent:z.literal(true)}).strict().safeParse(await readLabJson(request)).success) throw new LabError('INVALID_INPUT');
    await removeLabExperiment(database(),owner,id);
    return Response.json({removed:true},{headers});
  }catch(error){return failure(error);}
}
