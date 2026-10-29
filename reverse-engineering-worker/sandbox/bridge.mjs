import { readFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createHash } from "node:crypto";

export const TARGET = Object.freeze({
  teamId: "team_KWMzPo9tlEHDHXf9GtDWMHjb",
  projectId: "prj_0BKAEr63mDG1XO2r5vtZP2bcT0tZ",
});
export const PROBE_OPTIONS = Object.freeze({
  image: "vercel/sandbox/universal",
  resources: Object.freeze({ vcpus: 1 }),
  timeout: 300_000,
  persistent: false,
  networkPolicy: "deny-all",
  ports: Object.freeze([]),
  env: Object.freeze({}),
  tags: Object.freeze({ application: "hessara-re", purpose: "host-preflight" }),
});
const ownDirectory = path.dirname(fileURLToPath(import.meta.url));
const ownCodes = new Set(["unknown_command", "unknown_option", "list_accepts_no_mutation_options", "verified_hobby_plan_required",
  "target_scope_mismatch", "oidc_or_explicit_server_credentials_required", "host_probe_command_failed",
  "host_probe_output_too_large", "unsafe_or_invalid_probe_response", "sandbox_stop_failed_bounded_timeout_remains"]);
const sdkCodes = new Set(["unauthorized", "forbidden", "not_found", "bad_request", "invalid_request", "invalid_request_body",
  "image_not_ready", "image_not_found", "invalid_image", "unsupported_runtime", "invalid_runtime", "quota_exceeded",
  "rate_limited", "too_many_requests", "resource_limit_exceeded", "sandbox_limit_reached", "plan_limit_exceeded",
  "insufficient_resources", "payment_required", "timeout", "sandbox_stopped", "session_stopped"]);
const networkCodes = new Set(["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT",
  "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_SOCKET", "CERT_HAS_EXPIRED", "UNABLE_TO_VERIFY_LEAF_SIGNATURE"]);

/** Never returns raw messages, request URLs, headers, payloads, stack traces, or tokens. */
export function formatSafeError(error) {
  const chain = [];
  let current = error;
  while (current && typeof current === "object" && chain.length < 5 && !chain.includes(current)) {
    chain.push(current);
    current = current.cause;
  }
  const status = chain.flatMap(item => [item.status, item.statusCode, item.response?.status])
    .find(value => Number.isInteger(value) && value >= 100 && value <= 599);
  const messages = chain.map(item => typeof item.message === "string" ? item.message : "");
  const codeCandidates = chain.flatMap(item => [item.code, item.json?.error?.code, item.json?.code]);
  const code = codeCandidates.find(value => sdkCodes.has(String(value).toLowerCase()));
  const causeCode = codeCandidates.find(value => networkCodes.has(value));
  const ownCode = messages.find(message => ownCodes.has(message));
  const combined = messages.join(" ").toLowerCase();
  const indicators = [
    ["oidc", /oidc|jwt|credentials|authentication/], ["expired", /expired|expiration/],
    ["network", /fetch failed|network|dns|socket|connect/], ["image", /image/],
    ["runtime", /runtime/], ["quota", /quota|rate.limit|too many|capacity/],
    ["billing", /billing|payment|credit|plan/], ["invalid_parameter", /invalid|validation|parameter|cannot be used/],
  ].filter(([, expression]) => expression.test(combined)).map(([label]) => label);
  const errorName = chain.map(item => item.constructor?.name || item.name)
    .find(name => ["APIError", "StreamError", "TypeError", "SyntaxError", "LocalOidcContextError", "VercelOidcContextError", "AbortError"].includes(name)) ?? "Error";
  const category = status === 401 || status === 403 || indicators.includes("oidc") ? "authentication_or_scope"
    : status === 402 || indicators.includes("billing") ? "billing_or_plan"
    : status === 429 || indicators.includes("quota") ? "quota_or_capacity"
    : causeCode || indicators.includes("network") ? "network_or_tls"
    : indicators.includes("image") || indicators.includes("runtime") ? "image_or_runtime"
    : indicators.includes("invalid_parameter") || status === 400 || status === 422 ? "request_validation"
    : "unclassified";
  const retryable = Boolean(causeCode && !["CERT_HAS_EXPIRED", "UNABLE_TO_VERIFY_LEAF_SIGNATURE"].includes(causeCode)) ||
    [408, 429, 500, 502, 503, 504].includes(status) || code === "image_not_ready";
  return { error: ownCode ?? "sandbox_operation_failed", errorName, status,
    code: code ? String(code).toLowerCase() : undefined, causeCode, category, indicators,
    messageHash: createHash("sha256").update(messages.join("\n")).digest("hex").slice(0, 16),
    retryable, automaticRetryPerformed: false,
    stage: error?.probeContext?.stage,
    sandboxCreated: error?.probeContext?.sandboxCreated,
    stopped: error?.probeContext?.stopped,
    cleanupFailed: error?.probeContext?.cleanupFailed,
    engineActivationPerformed: false };
}

export function describeProbe() {
  return {
    schemaVersion: 1,
    action: "host-preflight",
    target: TARGET,
    sdkVersion: "3.8.0",
    createsResources: true,
    maximumSandboxes: 1,
    requestedMemoryMb: 2048,
    options: PROBE_OPTIONS,
    installsPackages: false,
    startsDockerDaemon: false,
    executesArtifacts: false,
    enablesEngines: false,
  };
}

/** Private controller credentials stay in this process; never in sandbox env. */
export function authenticationOptions(environment = process.env) {
  for (const [key, expected] of [["VERCEL_TEAM_ID", TARGET.teamId], ["VERCEL_PROJECT_ID", TARGET.projectId]]) {
    if (environment[key] && environment[key] !== expected) throw new Error("target_scope_mismatch");
  }
  if (environment.VERCEL_OIDC_TOKEN) return {};
  if (environment.VERCEL_TOKEN && environment.VERCEL_TEAM_ID && environment.VERCEL_PROJECT_ID) {
    return { token: environment.VERCEL_TOKEN, teamId: TARGET.teamId, projectId: TARGET.projectId };
  }
  throw new Error("oidc_or_explicit_server_credentials_required");
}

export function parseArguments(args) {
  const command = args[0] ?? "probe";
  if (!["probe", "list"].includes(command)) throw new Error("unknown_command");
  let run = false;
  let save = false;
  let confirmedPlan;
  for (let index = 1; index < args.length; index++) {
    const argument = args[index];
    if (argument === "--run") run = true;
    else if (argument === "--save") save = true;
    else if (argument === "--confirmed-plan") confirmedPlan = args[++index];
    else throw new Error("unknown_option");
  }
  if (command === "list" && (run || save || confirmedPlan)) throw new Error("list_accepts_no_mutation_options");
  if (run && confirmedPlan !== "hobby") throw new Error("verified_hobby_plan_required");
  return { command, run, save, confirmedPlan };
}

export async function runProbe({ Sandbox, environment = process.env, readProbe = () => readFile(path.join(ownDirectory, "inspect-host.py")) }) {
  const authentication = authenticationOptions(environment);
  let sandbox;
  let failure;
  let diagnostic;
  let stopped = false;
  let cleanupFailed = false;
  let stage = "load_diagnostic";
  try {
    const source = await readProbe();
    stage = "create_sandbox";
    sandbox = await Sandbox.create({ ...PROBE_OPTIONS, ...authentication });
    stage = "write_diagnostic";
    await sandbox.writeFiles([{ path: "/vercel/sandbox/hessara-inspect-host.py", content: source, mode: 0o400 }]);
    stage = "run_diagnostic";
    const result = await sandbox.runCommand({
      cmd: "python3",
      args: ["/vercel/sandbox/hessara-inspect-host.py"],
      cwd: "/vercel/sandbox",
      env: {},
      timeoutMs: 30_000,
    });
    if (result.exitCode !== 0) throw new Error("host_probe_command_failed");
    stage = "read_diagnostic";
    const output = await result.stdout();
    if (Buffer.byteLength(output) > 32_768) throw new Error("host_probe_output_too_large");
    diagnostic = JSON.parse(output);
    if (diagnostic.schemaVersion !== 1 || diagnostic.controllerCredentialsPresent !== false || diagnostic.engineExecutionPerformed !== false) {
      throw new Error("unsafe_or_invalid_probe_response");
    }
  } catch (error) {
    failure = error;
  } finally {
    if (sandbox) {
      try {
        await sandbox.stop({ signal: AbortSignal.timeout(20_000) });
        stopped = true;
      } catch {
        // Do not hide cleanup failure: the session's fixed five-minute limit remains.
        cleanupFailed = true;
        if (!failure) failure = new Error("sandbox_stop_failed_bounded_timeout_remains");
      }
    }
  }
  if (failure) {
    const wrapped = new Error("sandbox_probe_failed", { cause: failure });
    wrapped.probeContext = { stage, sandboxCreated: Boolean(sandbox), stopped, cleanupFailed };
    throw wrapped;
  }
  return {
    schemaVersion: 1,
    recordedAt: new Date().toISOString(),
    name: sandbox.name,
    requested: describeProbe(),
    allocated: { vcpus: sandbox.vcpus, memoryMb: sandbox.memory },
    stopped,
    diagnostic,
    readyForAnalysis: false,
    nextGate: diagnostic.docker?.daemonReachable
      ? "verify_hardening_and_build_one_pinned_engine"
      : "docker_runtime_unavailable_in_default_image",
  };
}

export async function listSandboxes({ Sandbox, environment = process.env }) {
  const page = await Sandbox.list({ ...authenticationOptions(environment), limit: 5 });
  // First page only; no auto-pagination, environment dumps, or session resumes.
  return { schemaVersion: 1, createsResources: false,
    items: page.sandboxes.map(item => ({ name: item.name, status: item.status,
      persistent: item.persistent, vcpus: item.vcpus, memoryMb: item.memory })),
    hasMore: Boolean(page.pagination?.next) };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.command === "probe" && !options.run) {
    console.log(JSON.stringify({ dryRun: true, request: describeProbe() }, null, 2));
    return;
  }
  authenticationOptions();
  process.env.CI = "1";
  const { Sandbox } = await import("@vercel/sandbox");
  const report = options.command === "list" ? await listSandboxes({ Sandbox }) : await runProbe({ Sandbox });
  if (options.save) {
    const reports = path.join(ownDirectory, "reports");
    await mkdir(reports, { recursive: true });
    const filename = `host-preflight-${new Date().toISOString().replaceAll(/[:.]/g, "-")}.json`;
    await writeFile(path.join(reports, filename), JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
  }
  console.log(JSON.stringify(report, null, 2));
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch(error => {
    console.error(JSON.stringify(formatSafeError(error)));
    process.exitCode = 1;
  });
}
