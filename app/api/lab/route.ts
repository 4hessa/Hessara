import { identity, fail, HttpError } from "@/lib/server";
import { customLabInputSchema, LabError, readLabJson } from "@/lib/custom-lab";
import { createLabRun, listLabRuns } from "@/lib/lab-service";

export const runtime = "nodejs";
export const maxDuration = 30;
const headers = { "cache-control": "no-store" };
const failure = (error: unknown) => fail(error instanceof LabError ? new HttpError(error.message, error.status) : error);

export async function GET() {
  try { return Response.json(await listLabRuns(await identity()), { headers }); }
  catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  try {
    const owner = await identity(request);
    const parsed = customLabInputSchema.safeParse(await readLabJson(request));
    if (!parsed.success) throw new LabError("INVALID_INPUT");
    return Response.json(await createLabRun(owner, parsed.data), { status: 201, headers });
  } catch (error) { return failure(error); }
}
