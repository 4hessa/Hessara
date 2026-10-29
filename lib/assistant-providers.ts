import { z } from "zod";
import { requestBodyDeadline } from "./request-body-deadline.ts";
import { createHash } from "node:crypto";
import { decryptSecret, encryptSecret, vaultReady } from "./vault.ts";

export const assistantLimits = { requestBytes: 40_000, responseBytes: 256_000, textCharacters: 24_000, timeoutMs: 55_000, taskLifetimeMs: 86_400_000 } as const;
const apiKey = z.string().trim().min(8).max(4096).regex(/^[\x21-\x7e]+$/);
export const assistantInput = z.discriminatedUnion("action", [
  z.object({ provider: z.enum(["grok", "meta", "openai", "manus"]), action: z.literal("run"), apiKey, prompt: z.string().trim().min(10).max(8000) }).strict(),
  z.object({ provider: z.literal("manus"), action: z.literal("status"), apiKey, taskToken: z.string().min(20).max(2048) }).strict(),
]);
export type AssistantInput = z.infer<typeof assistantInput>;
export type AssistantProvider = AssistantInput["provider"];
export type AssistantResult = {
  provider: AssistantProvider;
  status: "completed" | "incomplete" | "running" | "waiting" | "unknown" | "error";
  text: string;
  model?: string;
  taskToken?: string;
  taskUrl?: string;
};
export class AssistantError extends Error {
  readonly status: number;
  constructor(code: string, status = 502) { super(code); this.name = "AssistantError"; this.status = status; }
}
export const assistantModels = { grok: "grok-4.7", meta: "muse-spark-1.3", openai: "gpt-6.1-sol" } as const;
const endpoints = {
  grok: "https://api.x.ai/v1/chat/completions",
  meta: "https://api.meta.ai/v1/chat/completions",
  openai: "https://api.openai.com/v1/responses",
  manus: "https://api.manus.ai/v2/task.create",
} as const;
const taskIdSchema = z.string().regex(/^[A-Za-z0-9]{22}$/);
const taskSchema = z.object({ purpose: z.literal("hessara-manus-task-v1"), taskId: taskIdSchema, expiresAt: z.number().int().positive() }).strict();
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown) => typeof value === "string" ? value : "";
const safeText = (value: string, key: string) => value.split(key).join("[محجوب]").slice(0, assistantLimits.textCharacters);

export function safeManusUrl(value: unknown) {
  if (typeof value !== "string" || value.length > 2048) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash) return undefined;
    if (!["manus.im", "manus.ai"].some(host => url.hostname === host || url.hostname.endsWith(`.${host}`))) return undefined;
    return url.href;
  } catch { return undefined; }
}

// The key fingerprint is authenticated additional data, never a stored credential.
function taskContext(owner: string, key: string) {
  return `hessara:assistant-task:v1:${owner}:${createHash("sha256").update(key).digest("hex")}`;
}
export async function createTaskToken(taskId: string, owner: string, key: string, now = Date.now()) {
  if (!vaultReady()) throw new AssistantError("NOT_READY", 503);
  if (!taskIdSchema.safeParse(taskId).success) throw new AssistantError("PROVIDER_RESPONSE");
  return encryptSecret(JSON.stringify({ purpose: "hessara-manus-task-v1", taskId, expiresAt: now + assistantLimits.taskLifetimeMs }), taskContext(owner, key));
}
export async function readTaskToken(token: string, owner: string, key: string, now = Date.now()) {
  if (!vaultReady()) throw new AssistantError("NOT_READY", 503);
  try {
    if (token.length > 2048 || token.split(".").length !== 3) throw new Error("Invalid token");
    const parsed = taskSchema.parse(JSON.parse(await decryptSecret(token, taskContext(owner, key))));
    if (parsed.expiresAt <= now || parsed.expiresAt > now + assistantLimits.taskLifetimeMs) throw new Error("Expired token");
    return parsed.taskId;
  } catch { throw new AssistantError("TASK_TOKEN_INVALID", 403); }
}

export async function readAssistantJson(response: Request | Response, input = false) {
  const limit = input ? assistantLimits.requestBytes : assistantLimits.responseBytes;
  const code = input ? "INVALID_INPUT" : "PROVIDER_RESPONSE";
  const tooLarge = () => new AssistantError(code, input ? 413 : 502);
  if (Number(response.headers.get("content-length") || 0) > limit) { void response.body?.cancel().catch(() => {}); throw tooLarge(); }
  const reader = response.body?.getReader();
  if (!reader) throw new AssistantError(code, input ? 400 : 502);
  const deadline = requestBodyDeadline(response, reader, reason => new AssistantError(code, reason === "timeout" ? 408 : 499));
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await deadline.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > limit) throw tooLarge();
      chunks.push(part.value);
    }
  } finally { deadline.dispose(); void reader.cancel().catch(() => {}); reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown; }
  catch { throw new AssistantError(code, input ? 400 : 502); }
}

export function assistantRequest(input: Extract<AssistantInput, { action: "run" }>) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (input.provider === "manus") {
    headers["x-manus-api-key"] = input.apiKey;
    return { url: endpoints.manus, headers, body: { message: { content: [{ type: "text", text: input.prompt }], connectors: [] }, locale: "ar", share_visibility: "private", interactive_mode: true, agent_profile: "standard" } };
  }
  headers.authorization = `Bearer ${input.apiKey}`;
  const model = assistantModels[input.provider];
  const body = input.provider === "openai"
    ? { model, input: input.prompt, max_output_tokens: 1800, store: false }
    : { model, messages: [{ role: "user", content: input.prompt }], ...(input.provider === "grok" ? { max_tokens: 1800 } : { max_completion_tokens: 1800 }), stream: false };
  return { url: endpoints[input.provider], headers, body };
}

export function parseAssistantText(provider: Exclude<AssistantProvider, "manus">, value: unknown, key: string): AssistantResult {
  const data = object(value);
  let output = "";
  let complete = false;
  if (provider === "openai") {
    output = (Array.isArray(data.output) ? data.output : []).flatMap(item => {
      const content = object(item).content;
      return Array.isArray(content) ? content : [];
    }).filter(item => object(item).type === "output_text").map(item => text(object(item).text)).join("\n");
    complete = data.status === "completed";
  } else {
    const choice = object(Array.isArray(data.choices) ? data.choices[0] : undefined);
    output = text(object(choice.message).content);
    complete = choice.finish_reason === "stop";
  }
  if (!output.trim()) throw new AssistantError("PROVIDER_RESPONSE");
  return { provider, model: assistantModels[provider], status: complete && output.length <= assistantLimits.textCharacters ? "completed" : "incomplete", text: safeText(output, key) };
}

export function parseManusStatus(detailValue: unknown, messagesValue: unknown, key: string, expectedTaskId?: string): Omit<AssistantResult, "taskToken"> {
  const detail = object(detailValue), messages = object(messagesValue);
  if (detail.ok !== true || messages.ok !== true) throw new AssistantError("PROVIDER_RESPONSE");
  const task = object(detail.task);
  if (expectedTaskId && (task.id !== expectedTaskId || messages.task_id !== expectedTaskId)) throw new AssistantError("PROVIDER_RESPONSE");
  const status = task.status === "stopped" ? task.has_running_background_jobs === false ? "completed" : task.has_running_background_jobs === true ? "running" : "unknown"
    : ["running", "waiting", "error"].includes(text(task.status)) ? task.status as "running" | "waiting" | "error" : "unknown";
  const events = Array.isArray(messages.messages) ? messages.messages : [];
  // The page arrives newest first. Prefer the final result over older progress updates.
  const visible = events.filter(event => object(event).type === "assistant_message").map(event => object(object(event).assistant_message)).filter(message => text(message.content).trim());
  const output = text((visible.find(message => message.delivery_kind === "result") || visible[0])?.content);
  return { provider: "manus", status, text: safeText(output, key), taskUrl: safeManusUrl(task.task_url) };
}

export async function invokeAssistant(input: AssistantInput, owner: string, fetcher: typeof fetch = fetch): Promise<AssistantResult> {
  const signal = AbortSignal.timeout(assistantLimits.timeoutMs);
  const send = async (url: string, init: RequestInit) => {
    try {
      const response = await fetcher(url, { ...init, cache: "no-store", redirect: "error", signal });
      if (!response.ok) {
        void response.body?.cancel().catch(() => {});
        throw new AssistantError(response.status === 401 || response.status === 403 ? "PROVIDER_AUTH" : response.status === 429 ? "PROVIDER_RATE_LIMIT" : "PROVIDER_UNAVAILABLE", response.status === 429 ? 429 : 502);
      }
      return await readAssistantJson(response);
    } catch (error) {
      if (error instanceof AssistantError) throw error;
      throw new AssistantError(signal.aborted ? "PROVIDER_TIMEOUT" : "PROVIDER_UNAVAILABLE", signal.aborted ? 504 : 502);
    }
  };
  if (input.action === "status") {
    const id = await readTaskToken(input.taskToken, owner, input.apiKey);
    const headers = { "x-manus-api-key": input.apiKey };
    const [detail, messages] = await Promise.all([
      send(`https://api.manus.ai/v2/task.detail?task_id=${id}`, { headers }),
      send(`https://api.manus.ai/v2/task.listMessages?task_id=${id}&order=desc&limit=30`, { headers }),
    ]);
    return { ...parseManusStatus(detail, messages, input.apiKey, id), taskToken: input.taskToken, taskUrl: `https://manus.im/app/${id}` };
  }
  if (input.provider === "manus" && !vaultReady()) throw new AssistantError("NOT_READY", 503);
  const request = assistantRequest(input);
  const data = await send(request.url, { method: "POST", headers: request.headers, body: JSON.stringify(request.body) });
  if (input.provider !== "manus") return parseAssistantText(input.provider, data, input.apiKey);
  const created = object(data);
  if (created.ok !== true || !taskIdSchema.safeParse(created.task_id).success) throw new AssistantError("PROVIDER_RESPONSE");
  const id = created.task_id as string;
  return { provider: "manus", status: "running", text: "", taskToken: await createTaskToken(id, owner, input.apiKey), taskUrl: safeManusUrl(created.task_url) || `https://manus.im/app/${id}` };
}
