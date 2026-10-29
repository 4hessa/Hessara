import { createHash, createHmac, randomUUID } from "node:crypto";
import { z } from "zod";
import { requestBodyDeadline } from "./request-body-deadline.ts";
import type { CodeFile, CodeWorkspaceAction, CodeWorkspaceReadiness, CodeWorkspaceState } from "./code-workspace-types.ts";

export const CODE_WORKSPACE_LIMITS = {
  projects: 5, tasks: 12, dependencies: 11, allowedPaths: 16, files: 128,
  fileBytes: 32 * 1024, totalBytes: 512 * 1024,
  requestBytes: 600 * 1024, responseBytes: 12 * 1024 * 1024, concurrency: 3,
} as const;

const errorStatuses = {
  NOT_READY: 503, AUTH_REQUIRED: 401, ORIGIN: 403, INVALID_INPUT: 400,
  NOT_FOUND: 404, BUSY: 409, CONFLICT: 409, TESTS_FAILED: 409,
  STALE_REVIEW: 409, LIMIT: 429, DEPENDENCIES: 409, INTERRUPTED: 409, UNAVAILABLE: 503,
} as const;
type ErrorCode = keyof typeof errorStatuses;
export class CodeWorkspaceBridgeError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  constructor(code: ErrorCode) {
    super(code);
    this.code = code;
    this.status = errorStatuses[code];
  }
}

type Environment = Record<string, string | undefined>;
export type CodeWorkerConfiguration = { origin: string; secret: string };
export type CodeWorkerFetch = (url: string, init: RequestInit) => Promise<Response>;
const encoder = new TextEncoder();
const byteSize = (value: string) => encoder.encode(value).byteLength;
const id = z.string().uuid();
const sha = z.string().regex(/^[a-f0-9]{40}$/);
const text = (max: number, min = 0, trim = false) => (trim ? z.string().trim() : z.string()).min(min).max(max).refine(value => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value));

// Only server environment values choose the upstream. A request cannot choose a URL.
export function codeWorkerConfiguration(environment: Environment = process.env): CodeWorkerConfiguration | null {
  const source = environment.HESSARA_CODE_WORKER_URL;
  const secret = environment.HESSARA_CODE_WORKER_SECRET;
  if (!source || !secret || secret.length < 32 || secret.length > 4096 || secret.trim() !== secret || /[\r\n\0]/.test(secret)) return null;
  try {
    const url = new URL(source);
    if (source.trim() !== source || url.protocol !== "https:" || url.username || url.password || url.port || url.pathname !== "/" || url.search || url.hash
      || !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+workers\.dev$/.test(url.hostname)) return null;
    return { origin: url.origin, secret };
  } catch { return null; }
}

export function validCodePath(path: string): boolean {
  return path.length <= 200 && /^[a-zA-Z0-9][a-zA-Z0-9_.\/-]*$/.test(path)
    && !path.split("/").some(part => !part || part === "." || part === ".." || part.startsWith("."))
    && !/(?:^|\/)(?:node_modules|vendor|secrets?|credentials|private)(?:\/|\.|$)/i.test(path)
    && !/\.(?:pem|key|p12|pfx)$/i.test(path)
    && /\.(?:mjs|cjs|js|jsx|ts|tsx|json|md|css|html|txt)$/.test(path);
}

export function validCodeBranch(branch: string, internal = false): boolean {
  return branch.length <= 100 && /^[a-zA-Z0-9][a-zA-Z0-9_\/-]*$/.test(branch)
    && !branch.split("/").some(part => !part) && branch !== "HEAD"
    && (internal || !branch.startsWith("review/"));
}

const path = z.string().refine(validCodePath);
const branch = z.string().refine(value => validCodeBranch(value));
const name = text(80, 1, true);
const file = z.object({ path, content: text(CODE_WORKSPACE_LIMITS.fileBytes) }).strict();
const files = z.array(file).min(1);
const project = { projectId: id };
const task = { ...project, taskId: id };
const unique = (values: string[]) => new Set(values).size === values.length;
const taskDefinition = { title: text(120, 1, true), instruction: text(4000, 1, true), priority: z.number().int().min(1).max(3),
  dependencies: z.array(id).max(CODE_WORKSPACE_LIMITS.dependencies).refine(unique), allowedPaths: z.array(path).min(1).max(CODE_WORKSPACE_LIMITS.allowedPaths).refine(unique) };
const source = z.string().refine(value => {
  // Reject encoded paths, credentials, query parameters and nested GitHub routes.
  const match = /^https:\/\/github\.com\/([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_.-]+)\/?$/.exec(value);
  return !!match && match[2] !== "." && match[2] !== "..";
}).transform(value => value.replace(/\/$/, ""));
const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), name, files }).strict(),
  z.object({ action: z.literal("import"), name, source, branch: branch.optional() }).strict(),
  z.object({ action: z.literal("task"), ...project, ...taskDefinition }).strict(),
  z.object({ action: z.literal("update-task"), ...task, expectedVersion: z.number().int().min(0).max(1000), ...taskDefinition }).strict(),
  z.object({ action: z.literal("start"), ...project, consent: z.literal(true) }).strict(),
  ...(["cancel", "review", "merge", "reject"] as const).map(action => z.object({ action: z.literal(action), ...task }).strict()),
  z.object({ action: z.literal("edit"), ...project, expectedHead: sha, files }).strict(),
  z.object({ action: z.literal("history"), ...project, expectedHead: sha }).strict(),
  z.object({ action: z.literal("revision"), ...project, expectedHead: sha, commit: sha }).strict(),
  ...(["branch", "switch"] as const).map(action => z.object({ action: z.literal(action), ...project, expectedHead: sha, name: branch }).strict()),
]);

function checkFiles(values: CodeFile[], code: ErrorCode = "LIMIT") {
  if (values.length > CODE_WORKSPACE_LIMITS.files || values.some(value => byteSize(value.content) > CODE_WORKSPACE_LIMITS.fileBytes)
    || values.reduce((total, value) => total + byteSize(value.content), 0) > CODE_WORKSPACE_LIMITS.totalBytes) throw new CodeWorkspaceBridgeError(code);
  if (!unique(values.map(value => value.path))) throw new CodeWorkspaceBridgeError(code === "UNAVAILABLE" ? code : "INVALID_INPUT");
}

export function parseCodeWorkspaceAction(input: unknown): CodeWorkspaceAction {
  // Reject collection cardinality before Zod visits or accumulates issues for its elements.
  if (input && typeof input === "object" && "files" in input && Array.isArray(input.files) && input.files.length > CODE_WORKSPACE_LIMITS.files) throw new CodeWorkspaceBridgeError("LIMIT");
  const parsed = actionSchema.safeParse(input);
  if (!parsed.success) throw new CodeWorkspaceBridgeError("INVALID_INPUT");
  if ("files" in parsed.data) checkFiles(parsed.data.files);
  return parsed.data;
}

const testsSchema = z.object({
  passed: z.boolean(), exitCode: z.number().int().nullable(), stdout: text(262144), stderr: text(262144),
  startedAt: z.string().datetime(), endedAt: z.string().datetime(), runner: text(200, 1),
}).strict();
// API state carries Artifact names, never a credential-bearing Git remote.
const repository = z.string().min(2).max(100).regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/);
const changeSchema = z.object({ path, before: file.shape.content.nullable(), after: file.shape.content.nullable() }).strict();
const commitSchema = z.object({ commit: sha, parents: z.array(sha).max(32).refine(unique), author: text(160), message: text(500), at: z.string().datetime().nullable() }).strict();
const status = z.enum(["queued", "blocked", "running", "review", "failed", "conflict", "merged", "rejected", "cancelled", "interrupted"]);
const taskSchema = z.object({
  id, title: text(120, 1), instruction: text(4000, 1), priority: z.number().int().min(1).max(3),
  dependencies: z.array(id).max(CODE_WORKSPACE_LIMITS.dependencies).refine(unique), allowedPaths: z.array(path).min(1).max(CODE_WORKSPACE_LIMITS.allowedPaths).refine(unique),
  version: z.number().int().min(0).max(1000).default(0),
  status, createdAt: z.string().datetime(), startedAt: z.string().datetime().optional(), endedAt: z.string().datetime().optional(),
  generationStartedAt: z.string().datetime().optional(), generationEndedAt: z.string().datetime().optional(),
  base: sha.optional(), commit: sha.optional(), repository: repository.optional(), model: text(160).optional(),
  usage: z.record(z.string(), z.number().finite().nonnegative()).refine(value => Object.keys(value).length <= 32).optional(),
  changes: z.array(changeSchema).max(CODE_WORKSPACE_LIMITS.files).optional(), decision: text(2000).optional(), tests: testsSchema.optional(),
  error: z.string().refine(value => Object.hasOwn(errorStatuses, value)).optional(),
  review: z.object({ main: sha, candidate: sha, tests: testsSchema, conflicts: z.array(path).max(CODE_WORKSPACE_LIMITS.files), at: z.string().datetime(), changes: z.array(changeSchema).max(CODE_WORKSPACE_LIMITS.files) }).strict().optional(),
}).strict();
const projectSchema = z.object({
  id, name: text(80, 1), repository, branch: z.string().refine(value => validCodeBranch(value, true)), head: sha, createdAt: z.string().datetime(),
  files: z.array(file).max(CODE_WORKSPACE_LIMITS.files), branches: z.array(z.string().refine(value => validCodeBranch(value, true))).max(64).refine(unique),
  tasks: z.array(taskSchema).max(CODE_WORKSPACE_LIMITS.tasks),
  history: z.array(commitSchema).max(30).optional(),
  revision: z.object({ commit: sha, files: z.array(file).min(1).max(CODE_WORKSPACE_LIMITS.files) }).strict().optional(),
  events: z.array(z.object({ id, at: z.string().datetime(), taskId: id.optional(), kind: text(64, 1), message: text(4096) }).strict()).max(1000),
}).strict();
const stateSchema = z.object({ projects: z.array(projectSchema).max(CODE_WORKSPACE_LIMITS.projects), model: text(160, 1), concurrency: z.literal(CODE_WORKSPACE_LIMITS.concurrency) }).strict();

export function parseCodeWorkspaceState(input: unknown): CodeWorkspaceState {
  const parsed = stateSchema.safeParse(input);
  if (!parsed.success || !unique(parsed.data.projects.map(value => value.id))) throw new CodeWorkspaceBridgeError("UNAVAILABLE");
  for (const value of parsed.data.projects) {
    checkFiles(value.files, "UNAVAILABLE");
    if (!unique(value.tasks.map(task => task.id))) throw new CodeWorkspaceBridgeError("UNAVAILABLE");
    if (value.history && (!unique(value.history.map(commit => commit.commit)) || !value.history.length || value.history[0].commit !== value.head)) throw new CodeWorkspaceBridgeError("UNAVAILABLE");
    if (value.revision) {
      checkFiles(value.revision.files, "UNAVAILABLE");
      if (!value.history?.some(commit => commit.commit === value.revision!.commit)) throw new CodeWorkspaceBridgeError("UNAVAILABLE");
    }
  }
  return parsed.data;
}

export function signedCodeWorkerHeaders(
  method: "GET" | "POST", pathname: "/health" | "/workspace", owner: string, secret: string, body = "", time = Date.now(), nonce: string = randomUUID(),
): Record<string, string> {
  if (!id.safeParse(owner).success || !id.safeParse(nonce).success || !Number.isSafeInteger(time) || time < 0) throw new CodeWorkspaceBridgeError("AUTH_REQUIRED");
  const digest = createHash("sha256").update(body, "utf8").digest("hex");
  const signature = createHmac("sha256", secret).update(`${method}\n${pathname}\n${owner}\n${time}\n${nonce}\n${digest}`, "utf8").digest("hex");
  return { "content-type": "application/json", "x-hessara-owner": owner, "x-hessara-time": String(time), "x-hessara-nonce": nonce, "x-hessara-signature": signature };
}

async function boundedJson(message: Request | Response, limit: number, code: ErrorCode): Promise<unknown> {
  const length = message.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > limit)) { void message.body?.cancel().catch(() => {}); throw new CodeWorkspaceBridgeError(code); }
  const reader = message.body?.getReader();
  if (!reader) throw new CodeWorkspaceBridgeError(code === "LIMIT" ? "INVALID_INPUT" : code);
  const deadline = requestBodyDeadline(message, reader, () => new CodeWorkspaceBridgeError("INTERRUPTED"));
  let total = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await deadline.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) throw new CodeWorkspaceBridgeError(code);
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch (cause) {
    // Cleanup runs in finally without awaiting a caller-controlled cancellation.
    if (cause instanceof CodeWorkspaceBridgeError) throw cause;
    throw new CodeWorkspaceBridgeError(code === "LIMIT" ? "INVALID_INPUT" : code);
  } finally { deadline.dispose(); void reader.cancel().catch(() => {}); reader.releaseLock(); }
}

function knownError(value: unknown): ErrorCode | null {
  return typeof value === "string" && Object.hasOwn(errorStatuses, value) ? value as ErrorCode : null;
}
export function codeWorkspaceFailure(cause: unknown): Response {
  const code = cause instanceof Error ? knownError(cause.message) ?? "UNAVAILABLE" : "UNAVAILABLE";
  return Response.json({ error: code }, { status: errorStatuses[code], headers: { "cache-control": "no-store" } });
}

async function workerRequest(configuration: CodeWorkerConfiguration, owner: string, method: "GET" | "POST", pathname: "/health" | "/workspace", fetcher: CodeWorkerFetch, signal: AbortSignal, action?: CodeWorkspaceAction): Promise<unknown> {
  const body = action ? JSON.stringify(action) : "";
  try {
    const response = await fetcher(`${configuration.origin}${pathname}`, {
      method, headers: signedCodeWorkerHeaders(method, pathname, owner, configuration.secret, body),
      ...(method === "POST" ? { body } : {}), cache: "no-store", redirect: "error",
      signal: AbortSignal.any([signal, AbortSignal.timeout(pathname === "/health" ? 60000 : 180000)]),
    });
    if (!(response.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) { void response.body?.cancel().catch(() => {}); throw new CodeWorkspaceBridgeError("UNAVAILABLE"); }
    const payload = await boundedJson(response, response.ok ? CODE_WORKSPACE_LIMITS.responseBytes : 4096, "UNAVAILABLE");
    if (!response.ok) {
      const code = payload && typeof payload === "object" && "error" in payload ? knownError(payload.error) : null;
      throw new CodeWorkspaceBridgeError(code ?? "UNAVAILABLE");
    }
    return payload;
  } catch (cause) {
    if (cause instanceof CodeWorkspaceBridgeError) throw cause;
    throw new CodeWorkspaceBridgeError("UNAVAILABLE");
  }
}

async function probe(configuration: CodeWorkerConfiguration, owner: string, fetcher: CodeWorkerFetch, signal: AbortSignal): Promise<CodeWorkspaceReadiness> {
  const health = z.object({ connected: z.literal(true), model: text(160, 1), concurrency: z.literal(CODE_WORKSPACE_LIMITS.concurrency), artifacts: z.literal(true), runner: z.literal(true), aiConfigured: z.literal(true) }).safeParse(
    await workerRequest(configuration, owner, "GET", "/health", fetcher, signal),
  );
  if (!health.success) throw new CodeWorkspaceBridgeError("NOT_READY");
  return { configured: true, connected: true, model: health.data.model, concurrency: health.data.concurrency };
}

// Injectable dependencies keep transport, authorization order and size limits testable.
export function createCodeWorkspaceHandlers(dependencies: {
  identity: (request: Request) => Promise<string>;
  environment?: () => Environment;
  fetcher?: CodeWorkerFetch;
}) {
  const environment = dependencies.environment ?? (() => process.env);
  const fetcher = dependencies.fetcher ?? fetch;
  const json = (value: unknown) => Response.json(value, { headers: { "cache-control": "no-store" } });
  return {
    async GET(request: Request) {
      const configuration = codeWorkerConfiguration(environment());
      if (!configuration) return json({ readiness: { configured: false, connected: false, reason: "NOT_READY" } });
      try {
        const owner = await dependencies.identity(request);
        if (!id.safeParse(owner).success) throw new CodeWorkspaceBridgeError("AUTH_REQUIRED");
        // Authentication stays outside the readiness fallback, preserving 401/403.
        try {
          const readiness = await probe(configuration, owner, fetcher, request.signal);
          const state = parseCodeWorkspaceState(await workerRequest(configuration, owner, "GET", "/workspace", fetcher, request.signal));
          if (state.model !== readiness.model || state.concurrency !== readiness.concurrency) throw new CodeWorkspaceBridgeError("NOT_READY");
          return json({ readiness, state });
        } catch (cause) {
          return json({ readiness: { configured: true, connected: false, reason: cause instanceof CodeWorkspaceBridgeError ? cause.code : "UNAVAILABLE" } });
        }
      } catch (cause) { return codeWorkspaceFailure(cause); }
    },
    async POST(request: Request) {
      try {
        const owner = await dependencies.identity(request);
        if (!id.safeParse(owner).success) throw new CodeWorkspaceBridgeError("AUTH_REQUIRED");
        const configuration = codeWorkerConfiguration(environment());
        if (!configuration) throw new CodeWorkspaceBridgeError("NOT_READY");
        if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "")) throw new CodeWorkspaceBridgeError("INVALID_INPUT");
        const action = parseCodeWorkspaceAction(await boundedJson(request, CODE_WORKSPACE_LIMITS.requestBytes, "LIMIT"));
        const readiness = await probe(configuration, owner, fetcher, request.signal);
        const state = parseCodeWorkspaceState(await workerRequest(configuration, owner, "POST", "/workspace", fetcher, request.signal, action));
        if (state.model !== readiness.model || state.concurrency !== readiness.concurrency) throw new CodeWorkspaceBridgeError("NOT_READY");
        return json(state);
      } catch (cause) { return codeWorkspaceFailure(cause); }
    },
  };
}
