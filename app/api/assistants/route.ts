import { identity, database, fail, HttpError } from "@/lib/server";
import { assistantInput, AssistantError, invokeAssistant, readAssistantJson } from "@/lib/assistant-providers";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request) {
  try {
    const owner = await identity(request);
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new HttpError("INVALID_INPUT", 415);
    const parsed = assistantInput.safeParse(await readAssistantJson(request, true));
    if (!parsed.success) throw new HttpError("INVALID_INPUT", 400);
    const { action } = parsed.data;
    const day = new Date().toISOString().slice(0, 10);
    const dailyLimit = action === "run" ? 30 : 300;
    // One atomic, shared budget per account; every provider uses the same execution bucket.
    const budget = await database().prepare(
      "INSERT INTO decision_usage(owner,day,used) VALUES(?,?,1) ON CONFLICT(owner) DO UPDATE SET day=excluded.day,used=CASE WHEN decision_usage.day=excluded.day THEN decision_usage.used+1 ELSE 1 END WHERE decision_usage.day<>excluded.day OR decision_usage.used<? RETURNING used",
    ).bind(`assistants:${action}:${owner}`, day, dailyLimit).first<{ used: number }>();
    if (!budget) throw new HttpError("LIMIT", 429);
    const result = await invokeAssistant(parsed.data, owner);
    return Response.json(result, { headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } });
  } catch (error) {
    return fail(error instanceof AssistantError ? new HttpError(error.message, error.status) : error);
  }
}
