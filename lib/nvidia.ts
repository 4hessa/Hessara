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

export async function invokeNvidia(
  prompt: string,
  model: {
    model: string;
    inputPrice: number | null;
    outputPrice: number | null;
  },
  apiKey: string,
  fetcher: typeof fetch = fetch,
) {
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
      max_tokens: NVIDIA_POLICY.max_output_tokens,
      stream: false,
      ...(model.model === "moonshotai/kimi-k3"
        ? { reasoning_effort: "low" }
        : {}),
    }),
    signal: AbortSignal.timeout(NVIDIA_POLICY.timeout_ms),
    redirect: "error",
  });
  const latency = Math.round(performance.now() - started);
  const data = (await response.json().catch(() => ({}))) as {
    id?: string;
    requestId?: string;
    model?: string;
    choices?: { message?: { content?: string }; finish_reason?: string }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const choice = data.choices?.[0];
  const output =
    typeof choice?.message?.content === "string" ? choice.message.content : "";
  const tokens = (value: unknown) =>
    typeof value === "number" && Number.isFinite(value) && value >= 0
      ? value
      : null;
  const input_tokens = tokens(data.usage?.prompt_tokens);
  const output_tokens = tokens(data.usage?.completion_tokens);
  const error =
    response.status === 202
      ? "provider_pending"
      : !response.ok
        ? `provider_http_${response.status}`
        : choice?.finish_reason !== "stop"
          ? "incomplete_response"
          : !output
            ? "empty_response"
            : null;
  return {
    output: output.slice(0, 24000),
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
      resolved_model: data.model ?? model.model,
      request_id:
        data.id ?? data.requestId ?? response.headers.get("nvcf-reqid"),
      http_status: response.status,
      finish_reason: choice?.finish_reason,
      usage: data.usage,
      retry_after: response.headers.get("retry-after"),
      max_output_tokens: NVIDIA_POLICY.max_output_tokens,
      timeout_ms: NVIDIA_POLICY.timeout_ms,
      reasoning_effort:
        model.model === "moonshotai/kimi-k3" ? "low" : "provider default",
      cost_basis: "configured NVIDIA evaluation endpoint price",
    }),
  };
}
