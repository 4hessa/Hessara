import test from "node:test";
import assert from "node:assert/strict";
import { authenticationOptions, describeProbe, formatSafeError, listSandboxes, parseArguments, runProbe, TARGET } from "./bridge.mjs";

test("probe is dry-run unless explicitly enabled for verified Hobby", () => {
  assert.equal(parseArguments([]).run, false);
  assert.throws(() => parseArguments(["probe", "--run"]), /verified_hobby/);
  assert.throws(() => parseArguments(["probe", "--run", "--confirmed-plan", "pro"]), /verified_hobby/);
  assert.throws(() => parseArguments(["probe", "--image", "untrusted"]), /unknown_option/);
  assert.equal(parseArguments(["probe", "--run", "--confirmed-plan", "hobby"]).run, true);
  const { options } = describeProbe();
  assert.equal(options.resources.vcpus, 1);
  assert.equal(options.timeout, 300000);
  assert.equal(options.networkPolicy, "deny-all");
  assert.equal(options.persistent, false);
  assert.deepEqual(options.ports, []);
  assert.deepEqual(options.env, {});
});

test("auth fails closed and never forwards controller environment", () => {
  assert.throws(() => authenticationOptions({}), /credentials_required/);
  assert.throws(() => authenticationOptions({ VERCEL_OIDC_TOKEN: "private", VERCEL_PROJECT_ID: "wrong" }), /scope_mismatch/);
  assert.deepEqual(authenticationOptions({ VERCEL_OIDC_TOKEN: "private" }), {});
  assert.deepEqual(authenticationOptions({ VERCEL_TOKEN: "private", VERCEL_TEAM_ID: TARGET.teamId, VERCEL_PROJECT_ID: TARGET.projectId }),
    { token: "private", ...TARGET });
});

test("fixed probe stops VM after success and after execution failure", async () => {
  for (const shouldFail of [false, true]) {
    let stopped = 0;
    let creates = 0;
    const Sandbox = { create: async options => {
      creates++;
      assert.equal(options.networkPolicy, "deny-all");
      assert.deepEqual(options.env, {});
      return { name: "mock-test-only", vcpus: 1, memory: 2048,
        writeFiles: async files => assert.equal(files[0].path, "/vercel/sandbox/hessara-inspect-host.py"),
        runCommand: async params => {
          assert.equal(params.cmd, "python3");
          assert.equal(params.timeoutMs, 30000);
          if (shouldFail) throw new Error("mock_failure");
          return { exitCode: 0, stdout: async () => JSON.stringify({ schemaVersion: 1,
            controllerCredentialsPresent: false, engineExecutionPerformed: false, docker: { daemonReachable: false } }) };
        }, stop: async () => { stopped++; } };
    } };
    const operation = runProbe({ Sandbox, environment: { VERCEL_OIDC_TOKEN: "test-only" }, readProbe: async () => Buffer.from("# own fixed diagnostic") });
    if (shouldFail) await assert.rejects(operation, error => {
      assert.equal(error.cause.message, "mock_failure");
      assert.equal(error.probeContext.stage, "run_diagnostic");
      assert.equal(error.probeContext.stopped, true);
      return true;
    });
    else {
      const report = await operation;
      assert.equal(report.stopped, true);
      assert.equal(report.readyForAnalysis, false);
      assert.equal(report.nextGate, "docker_runtime_unavailable_in_default_image");
    }
    assert.equal(creates, 1);
    assert.equal(stopped, 1);
  }
});

test("safe errors classify API validation without exposing messages or request secrets", () => {
  const source = new TypeError("Invalid image parameter https://secret.example/?token=never-print");
  source.response = { status: 400, headers: { Authorization: "Bearer never-print" } };
  source.json = { error: { code: "invalid_image", message: "never-print" } };
  const error = new Error("sandbox_probe_failed", { cause: source });
  error.probeContext = { stage: "create_sandbox", sandboxCreated: false, stopped: false, cleanupFailed: false };
  const report = formatSafeError(error);
  assert.equal(report.status, 400);
  assert.equal(report.code, "invalid_image");
  assert.equal(report.category, "image_or_runtime");
  assert.equal(report.stage, "create_sandbox");
  assert.equal(report.retryable, false);
  assert.equal(JSON.stringify(report).includes("never-print"), false);
  assert.equal(JSON.stringify(report).includes("secret.example"), false);
  assert.match(report.messageHash, /^[a-f0-9]{16}$/);
});

test("safe errors distinguish OIDC, response.status, DNS, and unknown codes", () => {
  const auth = new Error("Could not get credentials from OIDC context");
  auth.response = { status: 403 };
  assert.equal(formatSafeError(auth).category, "authentication_or_scope");
  const network = new TypeError("fetch failed", { cause: Object.assign(new Error("private-host-name"), { code: "ENOTFOUND" }) });
  assert.equal(formatSafeError(network).causeCode, "ENOTFOUND");
  assert.equal(formatSafeError(network).retryable, true);
  const unknown = Object.assign(new Error("private-secret"), { code: "private-secret" });
  assert.equal(formatSafeError(unknown).code, undefined);
  assert.equal(JSON.stringify(formatSafeError(unknown)).includes("private-secret"), false);
});

test("list uses one page and exposes only selected metadata", async () => {
  const report = await listSandboxes({ environment: { VERCEL_OIDC_TOKEN: "test-only" }, Sandbox: { list: async options => {
    assert.equal(options.limit, 5);
    return { sandboxes: [{ name: "test-only", status: "stopped", persistent: false, env: { secret: "never-print" } }], pagination: { next: "cursor" } };
  } } });
  assert.equal(report.createsResources, false);
  assert.equal(report.hasMore, true);
  assert.equal(JSON.stringify(report).includes("never-print"), false);
});
