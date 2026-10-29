export const NVIDIA_MODELS = [
  {
    id: "z-ai/glm-5.3-flash",
    name: "جي إل إم ٥٫٣ فلاش",
    url: "https://build.nvidia.com/z-ai/glm-5-3-flash",
  },
  {
    id: "deepseek-ai/deepseek-v4.1-flash",
    name: "ديب سيك ٤٫١ فلاش",
    url: "https://build.nvidia.com/deepseek-ai/deepseek-v4.1-flash",
  },
  {
    id: "moonshotai/kimi-k3",
    name: "كيمي كيه ٣",
    url: "https://build.nvidia.com/moonshotai/kimi-k3",
  },
  {
    id: "z-ai/glm-5.3",
    name: "جي إل إم ٥٫٣",
    url: "https://build.nvidia.com/z-ai/glm-5-3",
  },
] as const;
export const NVIDIA_ENDPOINT =
  "https://integrate.api.nvidia.com/v1/chat/completions";
export const NVIDIA_POLICY = {
  max_output_tokens: 4096,
  timeout_ms: 90000,
  kimi_reasoning_effort: "low",
} as const;

export type InvocationOptions = { maxOutputTokens?: number };
export const PROVIDER_RESPONSE_BYTES = 1_000_000;
export class ProviderResponseError extends Error {
  constructor(code: string) { super(code); this.name = "ProviderResponseError"; }
}
export async function readProviderJson(response: Response): Promise<unknown> {
  if (Number(response.headers.get("content-length") || 0) > PROVIDER_RESPONSE_BYTES) {
    void response.body?.cancel().catch(() => {});
    throw new ProviderResponseError("provider_response_too_large");
  }
  const reader = response.body?.getReader();
  if (!reader) return {};
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > PROVIDER_RESPONSE_BYTES) throw new ProviderResponseError("provider_response_too_large");
      chunks.push(chunk.value);
    }
  } finally { void reader.cancel().catch(() => {}); reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try {
    const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid object");
    return value;
  } catch { throw new ProviderResponseError("provider_response_invalid"); }
}
export const NVIDIA_CATALOG_ENDPOINT = "https://integrate.api.nvidia.com/v1/models";
/** Public catalog discovery is not proof that an account can run a model. */
export async function readNvidiaAvailability(fetcher: typeof fetch = fetch) {
  const response = await fetcher(NVIDIA_CATALOG_ENDPOINT, {
    cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) { void response.body?.cancel().catch(() => {}); throw new ProviderResponseError("provider_catalog_unavailable"); }
  const data = await readProviderJson(response) as { data?: unknown };
  if (!Array.isArray(data.data) || data.data.some(row => !row || typeof row !== "object" || typeof row.id !== "string" || !row.id || row.id.length > 200))
    throw new ProviderResponseError("provider_catalog_invalid");
  return { ids: new Set<string>(data.data.map(row => row.id)), checkedAt: new Date().toISOString() };
}
export function outputTokenLimit(options: InvocationOptions | undefined, fallback: number) {
  const limit = options?.maxOutputTokens ?? fallback;
  if (!Number.isInteger(limit) || limit < 1 || limit > 4096) throw new RangeError("Invalid output token limit");
  return limit;
}

export async function invokeNvidia(
  prompt: string,
  model: {
    model: string;
    inputPrice: number | null;
    outputPrice: number | null;
  },
  apiKey: string,
  fetcher: typeof fetch = fetch,
  options?: InvocationOptions,
) {
  const maxOutputTokens = outputTokenLimit(options, NVIDIA_POLICY.max_output_tokens);
  const started = performance.now();
  const response = await fetcher(NVIDIA_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      model: model.model,
      messages: [{ role: "user", content: prompt }],
      max_tokens: maxOutputTokens,
      stream: false,
      ...(model.model === "moonshotai/kimi-k3"
        ? { reasoning_effort: "low" }
        : {}),
    }),
    signal: AbortSignal.timeout(NVIDIA_POLICY.timeout_ms),
    redirect: "error",
  });
  let bodyError: string | null = null;
  const data = (await readProviderJson(response).catch(error => {
    if (!(error instanceof ProviderResponseError)) throw error;
    bodyError = error.message;
    return {};
  })) as {
    id?: string;
    requestId?: string;
    model?: string;
    choices?: { message?: { content?: string }; finish_reason?: string }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const latency = Math.round(performance.now() - started);
  const choice = data.choices?.[0];
  const output =
    typeof choice?.message?.content === "string" ? choice.message.content : "";
  const tokens = (value: unknown) =>
    typeof value === "number" && Number.isFinite(value) && value >= 0
      ? value
      : null;
  const input_tokens = tokens(data.usage?.prompt_tokens);
  const output_tokens = tokens(data.usage?.completion_tokens);
  const truncated = output.length > 24000;
  const error =
    response.status === 202
      ? "provider_pending"
      : !response.ok
        ? `provider_http_${response.status}`
        : bodyError
          ? bodyError
          : truncated || choice?.finish_reason !== "stop"
          ? "incomplete_response"
          : !output
            ? "empty_response"
            : null;
  return {
    output: output.slice(0, 24000),
    truncated,
    latency,
    input_tokens,
    output_tokens,
    cost:
      input_tokens !== null &&
      output_tokens !== null &&
      model.inputPrice !== null &&
      model.outputPrice !== null
        ? (input_tokens * model.inputPrice +
            output_tokens * model.outputPrice) /
          1e6
        : null,
    error,
    httpStatus: response.status,
    metadata: JSON.stringify({
      requested_model: model.model,
      resolved_model: typeof data.model === "string" ? data.model : null,
      request_id:
        data.id ?? data.requestId ?? response.headers.get("nvcf-reqid"),
      http_status: response.status,
      finish_reason: choice?.finish_reason,
      usage: data.usage,
      retry_after: response.headers.get("retry-after"),
      max_output_tokens: maxOutputTokens,
      truncated,
      timeout_ms: NVIDIA_POLICY.timeout_ms,
      reasoning_effort:
        model.model === "moonshotai/kimi-k3" ? "low" : "provider default",
      cost_basis: "configured NVIDIA evaluation endpoint price",
    }),
  };
}

