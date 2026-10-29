import { z } from "zod";
import { identity, database, availableModels, modelConfig, invokeModel, fail, HttpError } from "@/lib/server";
import { readJsonRequest, RequestJsonError } from "@/lib/request-json";
const input = z.object({ modelId: z.string().min(1).max(200) }).strict();
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: Request) {
  try {
    const owner = await identity(request), parsed = input.safeParse(await readJsonRequest(request));
    if (!parsed.success) throw new HttpError("INVALID_INPUT");
    const model = (await availableModels(owner)).find(model => model.id === parsed.data.modelId && model.configured && model.provider !== "simulation");
    if (!model) throw new HttpError("MODEL_NOT_CONFIGURED", 409);
    const db = database(), now = Date.now();
    const counter = (suffix: string, period: string, maximum: number) => db.prepare("INSERT INTO decision_usage(owner,day,used) VALUES(?,?,1) ON CONFLICT(owner) DO UPDATE SET day=excluded.day,used=CASE WHEN decision_usage.day=excluded.day THEN decision_usage.used+1 ELSE 1 END WHERE decision_usage.day<>excluded.day OR decision_usage.used<? RETURNING used")
      .bind(`model-probe:${suffix}:${owner}`, period, maximum);
    const checks = await db.ownerQuotaBatch(owner, [counter("day", new Date(now).toISOString().slice(0,10), 12), counter("minute", String(Math.floor(now/60000)), 3)]);
    if (checks.some(check => !check.results.length)) throw new HttpError("LIMIT", 429);
    const result = await invokeModel({ prompt: "Connection verification only. Reply with OK." }, await modelConfig(model.id, owner), owner, { maxOutputTokens: 128 });
    if (!result.output || result.error && result.error !== "incomplete_response") throw new HttpError("PROVIDER_CHECK_FAILED", 502);
    return Response.json({ verified: true, models: await availableModels(owner) }, { headers: { "cache-control": "no-store" } });
  } catch (error) { return fail(error instanceof RequestJsonError ? new HttpError(error.message, error.status) : error); }
}
