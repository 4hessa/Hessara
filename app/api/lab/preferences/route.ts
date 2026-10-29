import { identity, fail, HttpError } from "@/lib/server";
import { LAB_TASK_TYPES, LabError, readLabJson } from "@/lib/custom-lab";
import { deleteLabPreferences, readLabPreferences, saveLabPreferences, type LabTaskType } from "@/lib/lab-preferences";

export const runtime = "nodejs";
export const maxDuration = 30;
const headers = { "cache-control": "no-store" };
const failure = (error: unknown) => fail(error instanceof LabError ? new HttpError(error.message, error.status) : error);
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    if ([...params.keys()].some(key => key !== "taskType") || params.getAll("taskType").length > 1) throw new LabError("INVALID_INPUT");
    const taskType = params.get("taskType");
    if (taskType !== null && !LAB_TASK_TYPES.includes(taskType as LabTaskType)) throw new LabError("INVALID_INPUT");
    return Response.json(await readLabPreferences(await identity(), taskType === null ? undefined : taskType as LabTaskType), { headers });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  try { return Response.json(await saveLabPreferences(await identity(request), await readLabJson(request)), { headers }); }
  catch (error) { return failure(error); }
}
export async function DELETE(request: Request) {
  try { return Response.json(await deleteLabPreferences(await identity(request), await readLabJson(request)), { headers }); }
  catch (error) { return failure(error); }
}
