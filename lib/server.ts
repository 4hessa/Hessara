import { env } from "cloudflare:workers";
import { decryptSecret } from "./vault";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { DEMO_MODELS, type Model, type Task } from "./benchmarks";
import { invokeNvidia } from "./nvidia";
export const settings = () => env as unknown as Record<string, string>;
export function database() {
  if (!env.DB) throw new Error("قاعدة النتائج غير متاحة حاليًا.");
  return env.DB;
}
export class HttpError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export async function identity(request?: Request) {
  const u = await getChatGPTUser();
  if (!u) throw new HttpError("AUTH_REQUIRED", 401);
  if (request && request.method !== "GET") {
    const origin = request.headers.get("origin");
    if (origin !== new URL(request.url).origin)
      throw new HttpError("ORIGIN", 403);
  }
  return u.userId;
}
export async function availableModels(owner: string): Promise<Model[]> {
  const e = settings();
  const rows = await database()
    .prepare(
      "SELECT id,name,provider,model FROM model_profiles WHERE owner=? ORDER BY created_at",
    )
    .bind(owner)
    .all<{ id: string; name: string; provider: string; model: string }>();
  return [
    ...DEMO_MODELS,
    ...rows.results.map((m) => ({
      id: m.id,
      name: m.name,
      label: m.model,
      provider: m.provider,
      color: (
        {
          openai: "#648956",
          anthropic: "#b28b64",
          gemini: "#798b9d",
          openrouter: "#4d7858",
          nvidia: "#6f5345",
        } as Record<string, string>
      )[m.provider],
      ready: true,
    })),
    ...[
      { id: "openai", name: "OpenAI", color: "#3b9874", key: "OPENAI" },
      {
        id: "anthropic",
        name: "Anthropic",
        color: "#cc9769",
        key: "ANTHROPIC",
      },
      { id: "gemini", name: "Gemini", color: "#7899d4", key: "GEMINI" },
    ].map((m) => ({
      id: m.id,
      name: m.name,
      label: e[m.key + "_MODEL"] || "لم يُحدد نموذج",
      color: m.color,
      provider: m.id,
      ready: !!(e[m.key + "_API_KEY"] && e[m.key + "_MODEL"]),
    })),
  ];
}
export function fail(e: unknown) {
  if (e instanceof HttpError)
    return Response.json(
      { error: e.message },
      { status: e.status, headers: { "cache-control": "no-store" } },
    );
  console.error(
    "Hessara request failed",
    e instanceof Error ? e.name : "unknown",
  );
  return Response.json(
    { error: "UNAVAILABLE" },
    { status: 503, headers: { "cache-control": "no-store" } },
  );
}
export type ModelConfig = {
  id: string;
  provider: string;
  name: string;
  model: string;
  inputPrice: number | null;
  outputPrice: number | null;
};
const price = (value: string | undefined) =>
  value?.trim() && Number.isFinite(+value) && +value >= 0 ? +value : null;
export async function modelConfig(
  id: string,
  owner: string,
): Promise<ModelConfig> {
  const simulation = DEMO_MODELS.find((model) => model.id === id);
  if (simulation)
    return {
      id,
      provider: "simulation",
      name: simulation.name,
      model: id,
      inputPrice: null,
      outputPrice: null,
    };
  const row = await database()
    .prepare(
      "SELECT id,name,provider,model,input_price,output_price FROM model_profiles WHERE id=? AND owner=?",
    )
    .bind(id, owner)
    .first<{
      id: string;
      name: string;
      provider: string;
      model: string;
      input_price: number | null;
      output_price: number | null;
    }>();
  if (row)
    return {
      id: row.id,
      provider: row.provider,
      name: row.name,
      model: row.model,
      inputPrice: row.input_price,
      outputPrice: row.output_price,
    };
  const e = settings(),
    key = id.toUpperCase();
  return {
    id,
    provider: id,
    name: id,
    model: id.startsWith("sim-") ? id : e[key + "_MODEL"],
    inputPrice: price(e[key + "_INPUT_USD_PER_MILLION"]),
    outputPrice: price(e[key + "_OUTPUT_USD_PER_MILLION"]),
  };
}
export async function invokeModel(
  task: Task,
  model: ModelConfig,
  owner: string,
) {
  const e = settings();
  const profile = await database()
    .prepare("SELECT key_cipher FROM model_profiles WHERE id=? AND owner=?")
    .bind(model.id, owner)
    .first<{ key_cipher: string }>();
  const key = profile
    ? await decryptSecret(profile.key_cipher, `${owner}:${model.id}`)
    : e[model.provider.toUpperCase() + "_API_KEY"];
  if (!key) throw new Error("المفتاح غير مهيأ");
  if (model.provider === "nvidia") return invokeNvidia(task.prompt, model, key);
  let url = "",
    headers: Record<string, string> = { "content-type": "application/json" },
    body: unknown;
  if (model.provider === "openai") {
    url = "https://api.openai.com/v1/responses";
    headers.Authorization = `Bearer ${key}`;
    body = {
      model: model.model,
      input: task.prompt,
      max_output_tokens: 512,
      store: false,
    };
  } else if (model.provider === "anthropic") {
    url = "https://api.anthropic.com/v1/messages";
    headers["x-api-key"] = key;
    headers["anthropic-version"] = "2023-06-01";
    if (e.ANTHROPIC_WORKSPACE_ID)
      headers["anthropic-workspace-id"] = e.ANTHROPIC_WORKSPACE_ID;
    body = {
      model: model.model,
      max_tokens: 512,
      messages: [{ role: "user", content: task.prompt }],
    };
  } else if (model.provider === "gemini") {
    url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model.model)}:generateContent`;
    headers["x-goog-api-key"] = key;
    body = {
      contents: [{ role: "user", parts: [{ text: task.prompt }] }],
      generationConfig: { maxOutputTokens: 512 },
    };
  } else if (model.provider === "openrouter") {
    url = "https://openrouter.ai/api/v1/chat/completions";
    headers.Authorization = `Bearer ${key}`;
    headers["X-Title"] = "Hessara";
    body = {
      model: model.model,
      messages: [{ role: "user", content: task.prompt }],
      max_tokens: 512,
      stream: false,
      provider: { allow_fallbacks: false },
    };
  } else throw new Error("مزود غير مدعوم");
  const start = performance.now();
  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(55000),
  });
  const d = (await response.json()) as any;
  const latency = Math.round(performance.now() - start);
  if (!response.ok)
    return {
      output: "",
      latency,
      input_tokens: null,
      output_tokens: null,
      cost: null,
      error: `provider_http_${response.status}`,
      metadata: JSON.stringify({
        http_status: response.status,
        request_id:
          response.headers.get("request-id") ||
          response.headers.get("x-request-id"),
      }),
    };
  let output = "",
    input_tokens: number | null = null,
    output_tokens: number | null = null,
    error: string | null = null;
  let reason = "";
  if (model.provider === "openai") {
    output = (d.output ?? [])
      .flatMap((x: any) => x.content ?? [])
      .filter((x: any) => x.type === "output_text")
      .map((x: any) => x.text)
      .join("");
    input_tokens = d.usage?.input_tokens ?? null;
    output_tokens = d.usage?.output_tokens ?? null;
    reason = d.status;
    if (d.status !== "completed") error = "incomplete_response";
  }
  if (model.provider === "anthropic") {
    output = (d.content ?? [])
      .filter((x: any) => x.type === "text")
      .map((x: any) => x.text)
      .join("");
    input_tokens =
      typeof d.usage?.input_tokens === "number"
        ? d.usage.input_tokens +
          (d.usage.cache_read_input_tokens ?? 0) +
          (d.usage.cache_creation_input_tokens ?? 0)
        : null;
    output_tokens = d.usage?.output_tokens ?? null;
    reason = d.stop_reason;
    if (reason !== "end_turn" && reason !== "stop_sequence")
      error = "incomplete_response";
  }
  if (model.provider === "gemini") {
    const c = d.candidates?.[0];
    output = (c?.content?.parts ?? [])
      .filter((x: any) => !x.thought && typeof x.text === "string")
      .map((x: any) => x.text)
      .join("");
    input_tokens = d.usageMetadata?.promptTokenCount ?? null;
    output_tokens =
      typeof d.usageMetadata?.candidatesTokenCount === "number"
        ? d.usageMetadata.candidatesTokenCount +
          (d.usageMetadata.thoughtsTokenCount ?? 0)
        : null;
    reason = c?.finishReason;
    if (reason !== "STOP") error = "incomplete_response";
  }
  if (model.provider === "openrouter") {
    const choice = d.choices?.[0];
    output =
      typeof choice?.message?.content === "string"
        ? choice.message.content
        : "";
    input_tokens = d.usage?.prompt_tokens ?? null;
    output_tokens = d.usage?.completion_tokens ?? null;
    reason = choice?.finish_reason;
    if (reason !== "stop") error = "incomplete_response";
  }
  if (!output && !error) error = "empty_response";
  const cached =
    (d.usage?.input_tokens_details?.cached_tokens ?? 0) +
    (d.usage?.prompt_tokens_details?.cached_tokens ?? 0) +
    (d.usage?.cache_read_input_tokens ?? 0) +
    (d.usage?.cache_creation_input_tokens ?? 0) +
    (d.usageMetadata?.cachedContentTokenCount ?? 0);
  const cost =
    cached === 0 &&
    input_tokens !== null &&
    output_tokens !== null &&
    model.inputPrice !== null &&
    model.outputPrice !== null
      ? (input_tokens * model.inputPrice + output_tokens * model.outputPrice) /
        1e6
      : null;
  return {
    output: output.slice(0, 24000),
    latency,
    input_tokens,
    output_tokens,
    cost,
    error,
    metadata: JSON.stringify({
      requested_model: model.model,
      resolved_model: d.model ?? d.modelVersion ?? model.model,
      request_id: d.id ?? d.responseId,
      finish_reason: reason,
      usage: d.usage ?? d.usageMetadata,
      cost_basis: "configured uncached price per million tokens",
      max_output_tokens: 512,
    }),
  };
}
