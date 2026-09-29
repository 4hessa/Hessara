import { z } from "zod";
import { identity, database, fail, HttpError } from "@/lib/server";
import { decisionQuestion, layaEndpoint, parseDecision } from "@/lib/decisions";

export const maxDuration = 120;

const schema = z
  .object({
    engine: z.enum(["jev", "laya"]),
    state: z.string().trim().min(12).max(4000),
    apiKey: z.string().trim().max(4096).optional(),
    endpoint: z.string().trim().max(300).optional(),
  })
  .strict();

async function limitedJson(
  response: Request | Response,
  errorCode: "INVALID_INPUT" | "PROVIDER_RESPONSE" = "PROVIDER_RESPONSE",
) {
  const reader = response.body?.getReader();
  if (!reader)
    throw new HttpError(errorCode, errorCode === "INVALID_INPUT" ? 400 : 502);
  const maxBytes = errorCode === "INVALID_INPUT" ? 12_000 : 128_000;
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new HttpError(errorCode, errorCode === "INVALID_INPUT" ? 413 : 502);
    }
    chunks.push(part.value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new HttpError(errorCode, errorCode === "INVALID_INPUT" ? 400 : 502);
  }
}

export async function POST(request: Request) {
  try {
    const owner = await identity(request);
    const size = Number(request.headers.get("content-length") || 0);
    if (size > 12_000) throw new HttpError("INVALID_INPUT", 413);
    const parsed = schema.safeParse(
      await limitedJson(request, "INVALID_INPUT"),
    );
    if (!parsed.success) throw new HttpError("INVALID_INPUT");
    const { engine, state, apiKey, endpoint } = parsed.data;
    const url =
      engine === "jev"
        ? "https://api.typesafe.ai/v1/systemone"
        : layaEndpoint(endpoint || "");
    if (!url || (engine === "jev" && !apiKey))
      throw new HttpError("NOT_READY", 409);
    const today = new Date().toISOString().slice(0, 10);
    const budget = await database()
      .prepare(
        "INSERT INTO decision_usage(owner,day,used) VALUES(?,?,1) ON CONFLICT(owner) DO UPDATE SET day=excluded.day,used=CASE WHEN decision_usage.day=excluded.day THEN decision_usage.used+1 ELSE 1 END WHERE decision_usage.day<>excluded.day OR decision_usage.used<60 RETURNING used",
      )
      .bind(owner, today)
      .first<{ used: number }>();
    if (!budget) throw new HttpError("LIMIT", 429);
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        state,
        ...(engine === "jev" ? { model: "jev-latest" } : {}),
        questions: decisionQuestion,
      }),
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok)
      throw new HttpError(
        response.status === 401 || response.status === 403
          ? "PROVIDER_AUTH"
          : "PROVIDER_UNAVAILABLE",
        502,
      );
    const decision = parseDecision(await limitedJson(response));
    if (!decision) throw new HttpError("PROVIDER_RESPONSE", 502);
    return Response.json(
      { engine, ...decision },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return fail(
      error instanceof SyntaxError ? new HttpError("INVALID_INPUT") : error,
    );
  }
}
