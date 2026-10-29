import { createHmac } from "node:crypto";
import { readProviderJson, outputTokenLimit, type InvocationOptions } from "./nvidia.ts";
import type { database } from "./postgres-database.ts";

export const CLOUDFLARE_MODELS = [
  { id: "cf-llama33", name: "Llama 3.3 70B · Cloudflare", model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast", color: "#586251" },
  { id: "cf-qwen3", name: "Qwen3 30B · Cloudflare", model: "@cf/qwen/qwen3-30b-a3b-fp8", color: "#788473" },
  { id: "cf-mistral", name: "Mistral Small 3.1 · Cloudflare", model: "@cf/mistralai/mistral-small-3.1-24b-instruct", color: "#6d7868" },
] as const;
export const FREE_MODEL_LIMITS = { ownerDaily: 12, globalDaily: 80, promptCharacters: 32_000, requestBytes: 65_536, maxOutputTokens: 512 } as const;
type Environment = Record<string, string | undefined>;
type Database = ReturnType<typeof database>;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function cloudflareConnection(env: Environment = process.env) {
  if (env.HESSARA_FREE_MODELS_ENABLED !== "true" || !env.HESSARA_INFERENCE_SECRET || env.HESSARA_INFERENCE_SECRET.length < 32) return null;
  try {
    const url = new URL(env.HESSARA_INFERENCE_URL ?? "");
    if (url.origin !== "https://hessara-model-gateway.hessa-alzahrani-sa.workers.dev" || url.pathname !== "/" || url.search || url.hash || url.username || url.password) return null;
    return { url, secret: env.HESSARA_INFERENCE_SECRET };
  } catch { return null; }
}

/** Serialized, persistent counters also bound concurrent serverless invocations.
 * Failed/ambiguous calls are not refunded or automatically retried. */
export async function reserveFreeModelCall(db: Database, owner: string, now = new Date()) {
  if (!uuid.test(owner)) return false;
  const day = now.toISOString().slice(0, 10);
  // Both reservations succeed together. A caller already at their limit cannot
  // consume everybody else's remaining allowance through rejected requests.
  const reserve = `WITH permitted AS (
    SELECT 1 WHERE NOT EXISTS(SELECT 1 FROM decision_usage WHERE owner=? AND day=? AND used>=?)
      AND NOT EXISTS(SELECT 1 FROM decision_usage WHERE owner=? AND day=? AND used>=?)
    ) INSERT INTO decision_usage(owner,day,used)
      SELECT ?,?,1 FROM permitted UNION ALL SELECT ?,?,1 FROM permitted
      ON CONFLICT(owner) DO UPDATE SET day=excluded.day,
      used=CASE WHEN decision_usage.day=excluded.day THEN decision_usage.used+1 ELSE 1 END RETURNING used`;
  const result = await db.ownerQuotaBatch("cloudflare-free-global", [db.prepare(reserve).bind(
    "cloudflare-free:global", day, FREE_MODEL_LIMITS.globalDaily, `cloudflare-free:${owner}`, day, FREE_MODEL_LIMITS.ownerDaily,
    "cloudflare-free:global", day, `cloudflare-free:${owner}`, day,
  )]);
  return result[0].results.length === 2;
}

export async function invokeCloudflare(prompt: string, model: string, owner: string, db: Database, options?: InvocationOptions,
  env: Environment = process.env, fetcher: typeof fetch = fetch) {
  const started = performance.now();
  const maxTokens = Math.min(outputTokenLimit(options, FREE_MODEL_LIMITS.maxOutputTokens), FREE_MODEL_LIMITS.maxOutputTokens);
  const empty = (error: string) => ({ output: "", truncated: false, latency: Math.round(performance.now() - started), input_tokens: null, output_tokens: null, cost: null,
    error, metadata: JSON.stringify({ provider: "cloudflare", requested_model: model, max_output_tokens: maxTokens, retries: 0, billing_basis: "shared free daily allowance" }) });
  const connection = cloudflareConnection(env);
  if (!connection || !uuid.test(owner) || !CLOUDFLARE_MODELS.some(item => item.model === model)) return empty("provider_not_configured");
  const body = JSON.stringify({ model, prompt, max_tokens: maxTokens });
  if (!prompt.trim() || prompt.length > FREE_MODEL_LIMITS.promptCharacters || Buffer.byteLength(body) > FREE_MODEL_LIMITS.requestBytes) return empty("provider_input_too_large");
  if (!await reserveFreeModelCall(db, owner)) return empty("provider_http_429");
  const timestamp = String(Date.now());
  const signature = createHmac("sha256", connection.secret).update(`${timestamp}\n${owner}\n${body}`).digest("hex");
  let response: Response;
  try {
    response = await fetcher(new URL("/v1/infer", connection.url), { method: "POST", headers: { "content-type": "application/json", "x-hessara-timestamp": timestamp, "x-hessara-owner": owner, "x-hessara-signature": signature },
      body, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(55_000) });
  } catch { return empty("provider_unavailable"); }
  let data: Record<string, unknown>;
  try { data = await readProviderJson(response) as Record<string, unknown>; }
  catch { return empty("provider_response_invalid"); }
  if (!response.ok) return empty(`provider_http_${response.status}`);
  if (data.provider !== "cloudflare" || data.model !== model || typeof data.output !== "string" || !data.output.trim()) return empty("provider_response_invalid");
  const tokens = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
  const truncated = data.truncated === true || data.output.length > 24_000;
  return { output: data.output.slice(0, 24_000), truncated, latency: Math.round(performance.now() - started), input_tokens: tokens(data.input_tokens), output_tokens: tokens(data.output_tokens), cost: null,
    // The bridge echoes the selected binding identifier; it does not resolve a
    // provider revision. Keep the unavailable revision explicit in saved reports.
    error: truncated ? "incomplete_response" : null, metadata: JSON.stringify({ provider: "cloudflare", requested_model: model, resolved_model: null, binding_model: data.model, max_output_tokens: maxTokens, timeout_ms: 55_000,
      request_id: typeof data.requestId === "string" ? data.requestId.slice(0, 200) : null, http_status: response.status, retries: 0, billing_basis: "shared free daily allowance", owner_daily_requests: FREE_MODEL_LIMITS.ownerDaily }) };
}
