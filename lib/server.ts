import { decryptSecret } from "./vault";
import { authenticatedUser } from "@/lib/auth";
import { DEMO_MODELS, type Model, type Task } from "./benchmarks";
import { invokeNvidia, outputTokenLimit, readProviderJson, ProviderResponseError, type InvocationOptions } from "./nvidia";
export { database } from "./postgres-database";
import { database } from "./postgres-database";
import { CLOUDFLARE_MODELS, cloudflareConnection, invokeCloudflare } from "./cloudflare-models";
import { configurationHash, verificationState, recordVerification, PLATFORM_VERIFICATION_OWNER, type VerificationConfiguration } from "./model-verification";
export const settings = () => process.env as Record<string, string>;
export class HttpError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export async function identity(request?: Request) {
  const u = await authenticatedUser();
  if (!u) throw new HttpError("AUTH_REQUIRED", 401);
  if (request && request.method !== "GET") {
    const origin = request.headers.get("origin");
    if (origin !== new URL(request.url).origin)
      throw new HttpError("ORIGIN", 403);
  }
  return u.id;
}
export async function availableModels(owner: string): Promise<Model[]> {
  const e = settings(), db = database();
  const rows = await db.prepare("SELECT id,name,provider,model,key_cipher FROM model_profiles WHERE owner=? ORDER BY created_at").bind(owner).all<{id:string;name:string;provider:string;model:string;key_cipher:string}>();
  const verified = (await db.scopedBatch(owner, [db.prepare("SELECT model_id,fingerprint,checked_at,success FROM model_verifications WHERE owner=? OR owner=?").bind(owner, PLATFORM_VERIFICATION_OWNER)]))[0].results;
  const state = (id:string, provider:string, model:string, secret:string) => verificationState(verified.find(row => row.model_id === id), configurationHash(provider, model, secret));
  return [
    ...DEMO_MODELS,
    ...(cloudflareConnection(e) ? CLOUDFLARE_MODELS.map(m => ({id:m.id,name:m.name,label:m.model,color:"#5f7fa6",provider:"cloudflare",configured:true,...state(m.id,"cloudflare",m.model,e.HESSARA_INFERENCE_SECRET)})) : []),
    ...rows.results.map(m => ({id:m.id,name:m.name,label:m.model,provider:m.provider,color:"#5f7fa6",configured:true,...state(m.id,m.provider,m.model,m.key_cipher)})),
    ...["openai","anthropic","gemini"].map(provider => {
      const prefix=provider.toUpperCase(), configured=e.HESSARA_SHARED_MODEL_OWNER_ID===owner && !!(e[prefix+"_API_KEY"]&&e[prefix+"_MODEL"]);
      return {id:provider,name:prefix,label:e[prefix+"_MODEL"]||"لم يُحدد نموذج",color:"#666f75",provider,configured,...(configured?state(provider,provider,e[prefix+"_MODEL"],e[prefix+"_API_KEY"]):{ready:false,verification:"unverified" as const,verifiedAt:null})};
    }),
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
  const freeModel = CLOUDFLARE_MODELS.find(model => model.id === id);
  if (freeModel && cloudflareConnection()) return { id, provider: "cloudflare", name: freeModel.name, model: freeModel.model, inputPrice: null, outputPrice: null };
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
async function invokeConfiguredModel(
  task: Pick<Task, "prompt">,
  model: ModelConfig,
  owner: string,
  options?: InvocationOptions,
  observeConfiguration?: (config: VerificationConfiguration) => void,
) {
  const e = settings();
  if (model.provider === "cloudflare") {
    if (e.HESSARA_INFERENCE_SECRET) observeConfiguration?.({ owner: PLATFORM_VERIFICATION_OWNER, fingerprint: configurationHash("cloudflare", model.model, e.HESSARA_INFERENCE_SECRET) });
    return invokeCloudflare(task.prompt, model.model, owner, database(), options, e);
  }
  const profile = await database()
    .prepare("SELECT key_cipher FROM model_profiles WHERE id=? AND owner=?")
    .bind(model.id, owner)
    .first<{ key_cipher: string }>();
  const key = profile
    ? await decryptSecret(profile.key_cipher, `${owner}:${model.id}`)
    : e.HESSARA_SHARED_MODEL_OWNER_ID === owner
      ? e[model.provider.toUpperCase() + "_API_KEY"] : undefined;
  if (!key) throw new Error("المفتاح غير مهيأ");
  observeConfiguration?.({ owner, fingerprint: configurationHash(model.provider, model.model, profile?.key_cipher ?? key) });
  if (model.provider === "nvidia") return invokeNvidia(task.prompt, model, key, fetch, options);
  const maxOutputTokens = outputTokenLimit(options, 512);
  let url = "", body: unknown;
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (model.provider === "openai") {
    url = "https://api.openai.com/v1/responses";
    headers.Authorization = `Bearer ${key}`;
    body = {
      model: model.model,
      input: task.prompt,
      max_output_tokens: maxOutputTokens,
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
      max_tokens: maxOutputTokens,
      messages: [{ role: "user", content: task.prompt }],
    };
  } else if (model.provider === "gemini") {
    url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model.model)}:generateContent`;
    headers["x-goog-api-key"] = key;
    body = {
      contents: [{ role: "user", parts: [{ text: task.prompt }] }],
      generationConfig: { maxOutputTokens },
    };
  } else if (model.provider === "openrouter") {
    url = "https://openrouter.ai/api/v1/chat/completions";
    headers.Authorization = `Bearer ${key}`;
    headers["X-Title"] = "Hessara";
    body = {
      model: model.model,
      messages: [{ role: "user", content: task.prompt }],
      max_tokens: maxOutputTokens,
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
    redirect: "error",
  });
  let bodyError: string | null = null;
  const d = (await readProviderJson(response).catch(error => {
    if (!(error instanceof ProviderResponseError)) throw error;
    bodyError = error.message;
    return {};
  })) as ProviderReply;
  const latency = Math.round(performance.now() - start);
  if (!response.ok || bodyError || response.status === 202)
    return {
      output: "",
      truncated: false,
      latency,
      input_tokens: null,
      output_tokens: null,
      cost: null,
      error: response.status === 202 ? "provider_pending" : !response.ok ? `provider_http_${response.status}` : bodyError,
      metadata: JSON.stringify({
        requested_model: model.model,
        resolved_model: typeof d.model === "string" ? d.model : typeof d.modelVersion === "string" ? d.modelVersion : null,
        max_output_tokens: maxOutputTokens,
        timeout_ms: 55000,
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
      .flatMap((x) => x.content ?? [])
      .filter((x) => x.type === "output_text")
      .map((x) => x.text)
      .join("");
    input_tokens = d.usage?.input_tokens ?? null;
    output_tokens = d.usage?.output_tokens ?? null;
    reason = d.status ?? "";
    if (d.status !== "completed") error = "incomplete_response";
  }
  if (model.provider === "anthropic") {
    output = (d.content ?? [])
      .filter((x) => x.type === "text")
      .map((x) => x.text)
      .join("");
    input_tokens =
      typeof d.usage?.input_tokens === "number"
        ? d.usage.input_tokens +
          (d.usage.cache_read_input_tokens ?? 0) +
          (d.usage.cache_creation_input_tokens ?? 0)
        : null;
    output_tokens = d.usage?.output_tokens ?? null;
    reason = d.stop_reason ?? "";
    if (reason !== "end_turn" && reason !== "stop_sequence")
      error = "incomplete_response";
  }
  if (model.provider === "gemini") {
    const c = d.candidates?.[0];
    output = (c?.content?.parts ?? [])
      .filter((x) => !x.thought && typeof x.text === "string")
      .map((x) => x.text)
      .join("");
    input_tokens = d.usageMetadata?.promptTokenCount ?? null;
    output_tokens =
      typeof d.usageMetadata?.candidatesTokenCount === "number"
        ? d.usageMetadata.candidatesTokenCount +
          (d.usageMetadata.thoughtsTokenCount ?? 0)
        : null;
    reason = c?.finishReason ?? "";
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
    reason = choice?.finish_reason ?? "";
    if (reason !== "stop") error = "incomplete_response";
  }
  if (!output && !error) error = "empty_response";
  const truncated = output.length > 24000;
  if (truncated) error = "incomplete_response";
  const validTokens = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
  input_tokens = validTokens(input_tokens);
  output_tokens = validTokens(output_tokens);
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
    truncated,
    latency,
    input_tokens,
    output_tokens,
    cost,
    error,
    metadata: JSON.stringify({
      requested_model: model.model,
      resolved_model: typeof d.model === "string" ? d.model : typeof d.modelVersion === "string" ? d.modelVersion : null,
      request_id: d.id ?? d.responseId,
      finish_reason: reason,
      usage: d.usage ?? d.usageMetadata,
      cost_basis: "configured uncached price per million tokens",
      max_output_tokens: maxOutputTokens,
      timeout_ms: 55000,
      truncated,
    }),
  };
}

type ProviderReply = {
  model?: string; modelVersion?: string; status?: string; stop_reason?: string; id?: string; responseId?: string;
  output?: { content?: {type?:string;text?:string}[] }[];
  content?: {type?:string;text?:string}[];
  candidates?: {content?:{parts?:{thought?:boolean;text?:string}[]};finishReason?:string}[];
  choices?: {message?:{content?:string};finish_reason?:string}[];
  usage?: {input_tokens?:number;output_tokens?:number;prompt_tokens?:number;completion_tokens?:number;cache_read_input_tokens?:number;cache_creation_input_tokens?:number;input_tokens_details?:{cached_tokens?:number};prompt_tokens_details?:{cached_tokens?:number}};
  usageMetadata?: {promptTokenCount?:number;candidatesTokenCount?:number;thoughtsTokenCount?:number;cachedContentTokenCount?:number};
};
export async function invokeModel(task: Pick<Task,"prompt">, model:ModelConfig, owner:string, options?:InvocationOptions) {
  let observed: VerificationConfiguration | null = null;
  try {
    const result=await invokeConfiguredModel(task,model,owner,options, config => { observed = config; });
    try { await recordVerification(database(),model.id,!!result.output && (!result.error || result.error==="incomplete_response"),observed); }
    catch { console.error("Model verification storage unavailable"); }
    return result;
  } catch(error) {
    try { await recordVerification(database(),model.id,false,observed); } catch { console.error("Model verification storage unavailable"); }
    throw error;
  }
}
