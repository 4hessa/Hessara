import { z } from "zod";
import { requestBodyDeadline } from "./request-body-deadline.ts";
import type { ModelConfig } from "./server";

export const LAB_VERSION = "hessara-custom/1";
export const LAB_LOCALES = ["ar", "en", "fr", "es", "zh", "ko", "ur", "fa", "pt", "it", "ru", "de", "nl"] as const;
export const LAB_TASK_TYPES = ["general", "study", "research", "coding", "writing", "analysis", "images", "reasoning"] as const;
export const LAB_LIMITS = { requestBytes: 120_000, history: 200, open: 5, leaseMs: 120_000 } as const;
const checkSchema = z.object({ kind: z.enum(["contains", "excludes", "exact", "json"]), value: z.string().max(1000) }).strict()
  .refine(check => check.kind === "json" || check.value.trim().length > 0, "A text check needs a nonblank value");
export const customLabInputSchema = z.object({
  requestId: z.string().uuid(),
  name: z.string().trim().min(1).max(80),
  taskType: z.enum(LAB_TASK_TYPES),
  locale: z.enum(LAB_LOCALES),
  models: z.array(z.string().min(1).max(200)).min(2).max(4),
  cases: z.array(z.object({
    id: z.string().uuid(),
    title: z.string().max(100),
    // Validate whitespace without transforming the submitted prompt.
    prompt: z.string().min(1).max(8000).refine(value => value.trim().length > 0),
    reference: z.string().max(4000).optional(),
    checks: z.array(checkSchema).max(8).optional(),
  }).strict()).min(1).max(8),
  maxOutputTokens: z.union([z.literal(512), z.literal(1024), z.literal(2048)]),
}).strict().superRefine((input, context) => {
  if (new Set(input.models).size !== input.models.length || new Set(input.cases.map(item => item.id)).size !== input.cases.length || input.models.length * input.cases.length > 32)
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Duplicate models or cases, or too many calls" });
});
export type CustomLabInput = z.infer<typeof customLabInputSchema>;
export type LabCase = CustomLabInput["cases"][number];
export type LabCheck = NonNullable<LabCase["checks"]>[number];
export type LabStatus = "draft" | "running" | "paused" | "completed" | "cancelled" | "failed";
export type LabProviderPolicy = { max_output_tokens: number; timeout_ms: number; sampling: "provider defaults"; reasoning_effort: "low" | "provider default"; retries: 0 };
export type LabConfig = CustomLabInput & {
  kind: "custom";
  version: typeof LAB_VERSION;
  created_at: string;
  pricing_recorded_at: string;
  modelSnapshots: ModelConfig[];
  providerPolicies: Record<string, LabProviderPolicy>;
  concurrency: 1;
  retries: 0;
};
export type LabRun = {
  id: string; name: string; mode: "custom"; status: LabStatus; created_at: string;
  config: string; configData: LabConfig; total: number; next_index: number; done: number;
  recoverable_at: string | null;
};
export type LabTrialMetadata = {
  started_at: string | null;
  finished_at: string | null;
  requested_model: string;
  resolved_model: string | null;
  settings: LabProviderPolicy;
  truncated?: boolean;
  [key: string]: unknown;
};
export type LabRunSummary=Pick<LabRun,'id'|'name'|'status'|'created_at'|'total'|'done'>;
export type LabTrial = {
  id: string; run_id: string; model: string; task_id: string; repeat: number;
  status: "running" | "done" | "error"; score: null; output: string | null;
  latency: number | null; input_tokens: number | null; output_tokens: number | null;
  cost: number | null; error: string | null; metadata: string; metadataData: LabTrialMetadata;
};
export type LabRunDetail = { run: LabRun; trials: LabTrial[] };
export type LabStepResult = { hasMore: boolean; paused: boolean; busy?: boolean };
export class LabError extends Error {
  readonly status: number;
  constructor(code: string, status = 400) { super(code); this.name = "LabError"; this.status = status; }
}

export async function readLabJson(request: Request): Promise<unknown> {
  if (Number(request.headers.get("content-length") || 0) > LAB_LIMITS.requestBytes) { void request.body?.cancel().catch(() => {}); throw new LabError("INVALID_INPUT", 413); }
  const reader = request.body?.getReader();
  if (!reader) throw new LabError("INVALID_INPUT");
  const deadline = requestBodyDeadline(request, reader, reason => new LabError("INVALID_INPUT", reason === "timeout" ? 408 : 499));
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const next = await deadline.read();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > LAB_LIMITS.requestBytes) throw new LabError("INVALID_INPUT", 413);
      chunks.push(next.value);
    }
  } finally { deadline.dispose(); void reader.cancel().catch(() => {}); reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new LabError("INVALID_INPUT"); }
}
