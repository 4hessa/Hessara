import test from "node:test";
import assert from "node:assert/strict";
import { createHash, createHmac, randomUUID } from "node:crypto";
import {
  CODE_WORKSPACE_LIMITS, CodeWorkspaceBridgeError, codeWorkerConfiguration,
  codeWorkspaceFailure, createCodeWorkspaceHandlers, parseCodeWorkspaceAction,
  parseCodeWorkspaceState, signedCodeWorkerHeaders, validCodeBranch, validCodePath,
  type CodeWorkerFetch,
} from "../lib/code-workspace-bridge.ts";

const owner = "5161f627-b94e-4d22-a8d2-ded54cec4d36";
const taskId = "dbd958cd-4d0c-48cf-bddc-0e6d5bf8a9d8";
const environment = {
  HESSARA_CODE_WORKER_URL: "https://hessara-code.account.workers.dev",
  HESSARA_CODE_WORKER_SECRET: "test-only-secret-".repeat(3),
};
const health = { connected: true, model: "test-model", concurrency: 3, artifacts: true, runner: true, aiConfigured: true };
const state = { projects: [], model: "test-model", concurrency: 3 };
const now = "2026-10-13T00:00:00.000Z";
const project = {
  id: owner, name: "Example", repository: "hessara-5161f627b94e4d22a8d2ded54cec4d36",
  branch: "main", head: "a".repeat(40), createdAt: now,
  files: [{ path: "src/main.ts", content: "export const answer = 42;" }], branches: ["main"], tasks: [], events: [],
};
const create = { action: "create", name: "Example", files: project.files };
const request = (body: unknown = create) => new Request("https://hessara.example/api/code-workspace", {
  method: "POST", headers: { "content-type": "application/json", origin: "https://hessara.example" }, body: JSON.stringify(body),
});
const getRequest = () => new Request("https://hessara.example/api/code-workspace");
const rejectsCode = (code: string) => (cause: unknown) => cause instanceof CodeWorkspaceBridgeError && cause.code === code;

test("only a server-configured HTTPS workers.dev origin and a long server secret enable the bridge", () => {
  assert.deepEqual(codeWorkerConfiguration(environment), { origin: environment.HESSARA_CODE_WORKER_URL, secret: environment.HESSARA_CODE_WORKER_SECRET });
  assert.equal(codeWorkerConfiguration({ ...environment, HESSARA_CODE_WORKER_URL: `${environment.HESSARA_CODE_WORKER_URL}/` })?.origin, environment.HESSARA_CODE_WORKER_URL);
  for (const url of ["http://hessara.account.workers.dev", "https://workers.dev", "https://worker.example.com", "https://worker.workers.dev.example.com", "https://worker.workers.dev/path", "https://worker.workers.dev/?token=secret", "https://worker.workers.dev/#secret", "https://user:pass@worker.workers.dev", "https://worker.workers.dev:444", "https://127.0.0.1", "https://[::1]", " https://worker.workers.dev", "not-a-url"]) {
    assert.equal(codeWorkerConfiguration({ ...environment, HESSARA_CODE_WORKER_URL: url }), null, url);
  }
  for (const secret of [undefined, "", "a".repeat(31), "\n" + "a".repeat(40), "a".repeat(40) + " "]) {
    assert.equal(codeWorkerConfiguration({ ...environment, HESSARA_CODE_WORKER_SECRET: secret }), null);
  }
  assert.equal(codeWorkerConfiguration({ NEXT_PUBLIC_HESSARA_CODE_WORKER_URL: environment.HESSARA_CODE_WORKER_URL, NEXT_PUBLIC_HESSARA_CODE_WORKER_SECRET: environment.HESSARA_CODE_WORKER_SECRET }), null);
});

test("HMAC authenticates owner, method, exact path, timestamp, nonce and UTF-8 body", () => {
  const body = JSON.stringify({ action: "create", name: "اختبار 🧪", files: [] });
  const nonce = randomUUID();
  const timestamp = 1791849600000;
  const headers = signedCodeWorkerHeaders("POST", "/workspace", owner, environment.HESSARA_CODE_WORKER_SECRET, body, timestamp, nonce);
  const message = ["POST", "/workspace", owner, String(timestamp), nonce, createHash("sha256").update(Buffer.from(body, "utf8")).digest("hex")].join("\n");
  assert.equal(headers["x-hessara-signature"], createHmac("sha256", environment.HESSARA_CODE_WORKER_SECRET).update(message).digest("hex"));
  assert.equal(headers["x-hessara-owner"], owner);
  assert.equal(headers["x-hessara-time"], String(timestamp));
  assert.equal(headers["x-hessara-nonce"], nonce);
  assert.match(headers["x-hessara-signature"], /^[a-f0-9]{64}$/);
  const changed = [
    signedCodeWorkerHeaders("GET", "/workspace", owner, environment.HESSARA_CODE_WORKER_SECRET, body, timestamp, nonce),
    signedCodeWorkerHeaders("POST", "/health", owner, environment.HESSARA_CODE_WORKER_SECRET, body, timestamp, nonce),
    signedCodeWorkerHeaders("POST", "/workspace", taskId, environment.HESSARA_CODE_WORKER_SECRET, body, timestamp, nonce),
    signedCodeWorkerHeaders("POST", "/workspace", owner, environment.HESSARA_CODE_WORKER_SECRET, body, timestamp + 1, nonce),
    signedCodeWorkerHeaders("POST", "/workspace", owner, environment.HESSARA_CODE_WORKER_SECRET, body, timestamp, randomUUID()),
    signedCodeWorkerHeaders("POST", "/workspace", owner, environment.HESSARA_CODE_WORKER_SECRET, body + " ", timestamp, nonce),
  ];
  for (const value of changed) assert.notEqual(value["x-hessara-signature"], headers["x-hessara-signature"]);
  assert.notEqual(signedCodeWorkerHeaders("GET", "/health", owner, environment.HESSARA_CODE_WORKER_SECRET)["x-hessara-nonce"], signedCodeWorkerHeaders("GET", "/health", owner, environment.HESSARA_CODE_WORKER_SECRET)["x-hessara-nonce"]);
  assert.throws(() => signedCodeWorkerHeaders("GET", "/health", "attacker\nowner", environment.HESSARA_CODE_WORKER_SECRET), rejectsCode("AUTH_REQUIRED"));
  assert.throws(() => signedCodeWorkerHeaders("GET", "/health", owner, environment.HESSARA_CODE_WORKER_SECRET, "", timestamp, "nonce\nforgery"), rejectsCode("AUTH_REQUIRED"));
});

test("path, file mode and branch constraints exclude traversal, secrets and binary inputs", () => {
  for (const value of ["src/main.ts", "README.md", "package.json", "test/example.test.mjs", "src/view.tsx", "styles/app.css", "index.html", "notes.txt"]) assert.equal(validCodePath(value), true, value);
  for (const value of ["/main.ts", "C:/main.ts", "../main.ts", "src/../main.ts", "src//main.ts", "src\\main.ts", "src/.hidden.ts", ".env", ".env.json", ".git/config.json", "credentials.json", "src/secrets.json", "private/key.txt", "node_modules/pkg/index.js", "vendor/index.js", "key.pem", "logo.png", "script.sh", "src/main.ts\0", "src/%2e%2e/main.ts", "src/é.ts"]) assert.equal(validCodePath(value), false, value);
  for (const value of ["main", "feature/fix-123", "release_2026"]) assert.equal(validCodeBranch(value), true, value);
  for (const value of ["review/" + taskId, "HEAD", "-option", "branch//name", "branch/", "branch..name", "branch.lock", "@{branch}", "branch name", "branch\nname"]) assert.equal(validCodeBranch(value), false, value);
  for (const files of [[{ path: "main.ts", content: "ok", mode: "120000" }], [{ path: "main.ts", content: "\0binary" }], [{ path: "main.ts", content: "ok" }, { path: "main.ts", content: "duplicate" }]]) assert.throws(() => parseCodeWorkspaceAction({ ...create, files }), rejectsCode("INVALID_INPUT"));
});

test("action contracts enforce explicit consent, priorities, IDs, dependencies and import sources", () => {
  const task = { action: "task", projectId: owner, title: "Fix", instruction: "Fix the bug", priority: 2, dependencies: [], allowedPaths: ["src/main.ts"] };
  assert.deepEqual(parseCodeWorkspaceAction(task), task);
  assert.deepEqual(parseCodeWorkspaceAction({ action: "import", name: "Example", source: "https://github.com/owner/repository/", branch: "main" }), { action: "import", name: "Example", source: "https://github.com/owner/repository", branch: "main" });
  for (const change of [{ priority: 50 }, { priority: 0 }, { priority: 4 }, { priority: 1.5 }, { projectId: "project" }, { dependencies: [taskId, taskId] }, { dependencies: Array.from({ length: 12 }, () => randomUUID()) }, { allowedPaths: [] }, { allowedPaths: ["src/main.ts", "src/main.ts"] }, { allowedPaths: [".env"] }, { instruction: "" }, { instruction: "a".repeat(4001) }, { title: " " }, { url: "https://attacker.example" }]) assert.throws(() => parseCodeWorkspaceAction({ ...task, ...change }), rejectsCode("INVALID_INPUT"));
  for (const consent of [undefined, false, "true", 1]) assert.throws(() => parseCodeWorkspaceAction({ action: "start", projectId: owner, consent }), rejectsCode("INVALID_INPUT"));
  assert.deepEqual(parseCodeWorkspaceAction({ action: "start", projectId: owner, consent: true }), { action: "start", projectId: owner, consent: true });
  for (const action of ["cancel", "review", "merge", "reject"]) assert.equal(parseCodeWorkspaceAction({ action, projectId: owner, taskId }).action, action);
  for (const action of ["edit", "branch", "switch"]) assert.throws(() => parseCodeWorkspaceAction({ action, projectId: owner, expectedHead: "main", name: "feature", files: project.files }), rejectsCode("INVALID_INPUT"));
  for (const source of ["http://github.com/owner/repo", "https://user:pass@github.com/owner/repo", "https://github.com/owner/repo/tree/main", "https://github.com/owner/repo?token=secret", "https://github.com/owner/repo#main", "https://github.com/owner/%2e%2e", "https://github.com/owner/..", "https://github.com.evil/owner/repo", "https://gitlab.com/owner/repo"]) assert.throws(() => parseCodeWorkspaceAction({ action: "import", name: "Example", source }), rejectsCode("INVALID_INPUT"));
});

test("task edits require bounded integer versions and cannot inject execution metadata", () => {
  const edit = { action: 'update-task', projectId: owner, taskId, expectedVersion: 0, title: 'Fix', instruction: 'Fix the bug', priority: 2, dependencies: [], allowedPaths: ['src/main.ts'] };
  assert.deepEqual(parseCodeWorkspaceAction(edit), edit);
  assert.deepEqual(parseCodeWorkspaceAction({ ...edit, expectedVersion: 1000 }), { ...edit, expectedVersion: 1000 });
  for (const change of [
    { expectedVersion: undefined }, { expectedVersion: -1 }, { expectedVersion: 1001 }, { expectedVersion: 0.5 }, { expectedVersion: '0' },
    { version: 0 }, { status: 'queued' }, { startedAt: now }, { taskId: 'task' }, { projectId: 'project' },
    { dependencies: [taskId, taskId] }, { allowedPaths: ['src/main.ts', 'src/main.ts'] }, { title: '' }, { instruction: ' ' },
  ]) assert.throws(() => parseCodeWorkspaceAction({ ...edit, ...change }), rejectsCode('INVALID_INPUT'));
});

test("task state supplies legacy revision zero and rejects invalid edit versions", () => {
  const legacy = { id: taskId, title: 'Legacy task', instruction: 'Fix code', priority: 2, dependencies: [], allowedPaths: ['src/main.ts'], status: 'queued', createdAt: now };
  const parsed = parseCodeWorkspaceState({ ...state, projects: [{ ...project, tasks: [legacy] }] });
  assert.equal(parsed.projects[0].tasks[0].version, 0);
  assert.equal(parseCodeWorkspaceState({ ...state, projects: [{ ...project, tasks: [{ ...legacy, version: 4 }] }] }).projects[0].tasks[0].version, 4);
  for (const version of [-1, 1001, 0.5, '0', null]) assert.throws(() => parseCodeWorkspaceState({ ...state, projects: [{ ...project, tasks: [{ ...legacy, version }] }] }), rejectsCode('UNAVAILABLE'));
});

test("a task edit crosses the authenticated bridge with its exact optimistic version and saved settings", async () => {
  const edit = { action: 'update-task', projectId: owner, taskId, expectedVersion: 2, title: 'Revised task', instruction: 'Fix safely', priority: 3, dependencies: [], allowedPaths: ['src/main.ts'] };
  let calls = 0;
  const editedTask = { id: taskId, title: edit.title, instruction: edit.instruction, priority: 3, dependencies: [], allowedPaths: edit.allowedPaths, version: 3, status: 'queued', createdAt: now };
  const saved = { ...state, projects: [{ ...project, tasks: [editedTask] }] };
  const handlers = createCodeWorkspaceHandlers({ identity: async () => owner, environment: () => environment, fetcher: async (url, init) => {
    calls++;
    if (url.endsWith('/health')) return Response.json(health);
    assert.equal(init.method, 'POST'); assert.deepEqual(JSON.parse(init.body as string), edit);
    return Response.json(saved);
  } });
  const response = await handlers.POST(request(edit));
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), saved); assert.equal(calls, 2);
});

test("UTF-8 file size, aggregate bytes and file counts are bounded", () => {
  const file = { path: "main.txt", content: "a".repeat(CODE_WORKSPACE_LIMITS.fileBytes) };
  assert.equal(parseCodeWorkspaceAction({ ...create, files: [file] }).action, "create");
  assert.throws(() => parseCodeWorkspaceAction({ ...create, files: [{ ...file, content: "ع".repeat(16385) }] }), rejectsCode("LIMIT"));
  const full = Array.from({ length: 16 }, (_, index) => ({ path: `file${index}.txt`, content: file.content }));
  assert.equal(parseCodeWorkspaceAction({ ...create, files: full }).action, "create");
  assert.throws(() => parseCodeWorkspaceAction({ ...create, files: [...full, { path: "extra.txt", content: "a" }] }), rejectsCode("LIMIT"));
  assert.throws(() => parseCodeWorkspaceAction({ ...create, files: Array.from({ length: 129 }, (_, index) => ({ path: `file${index}.txt`, content: "" })) }), rejectsCode("LIMIT"));
});

test("unconfigured GET is cheap; configured GET and all POSTs authenticate before upstream access", async () => {
  let authCalls = 0;
  let fetchCalls = 0;
  let configCalls = 0;
  const fetcher: CodeWorkerFetch = async () => { fetchCalls++; return Response.json(health); };
  const identity = async () => { authCalls++; throw new Error("AUTH_REQUIRED"); };
  const absent = createCodeWorkspaceHandlers({ identity, environment: () => { configCalls++; return {}; }, fetcher });
  const absentGet = await absent.GET(getRequest());
  assert.deepEqual(await absentGet.json(), { readiness: { configured: false, connected: false, reason: "NOT_READY" } });
  assert.equal(authCalls, 0);
  configCalls = 0;
  const absentPost = await absent.POST(request());
  assert.equal(absentPost.status, 401);
  assert.equal(configCalls, 0);
  const configured = createCodeWorkspaceHandlers({ identity, environment: () => environment, fetcher });
  assert.equal((await configured.GET(getRequest())).status, 401);
  assert.equal((await configured.POST(request())).status, 401);
  assert.equal(fetchCalls, 0);
  const originRejected = createCodeWorkspaceHandlers({ identity: async () => { throw new Error("ORIGIN"); }, environment: () => environment, fetcher });
  assert.equal((await originRejected.POST(request())).status, 403);
  assert.equal(fetchCalls, 0);
  const invalidOwner = createCodeWorkspaceHandlers({ identity: async () => "fake-user", environment: () => environment, fetcher });
  assert.equal((await invalidOwner.GET(getRequest())).status, 401);
  assert.equal(fetchCalls, 0);
});

test("healthy GET signs both fixed paths with fresh nonces and returns the validated state", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const handlers = createCodeWorkspaceHandlers({ identity: async () => owner, environment: () => environment, fetcher: async (url, init) => {
    calls.push({ url, init });
    return Response.json(url.endsWith("/health") ? health : state);
  } });
  const response = await handlers.GET(getRequest());
  assert.deepEqual(await response.json(), { readiness: { configured: true, connected: true, model: "test-model", concurrency: 3 }, state });
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(calls.map(call => call.url), [`${environment.HESSARA_CODE_WORKER_URL}/health`, `${environment.HESSARA_CODE_WORKER_URL}/workspace`]);
  const nonces = [];
  for (const call of calls) {
    assert.equal(call.init.method, "GET");
    assert.equal(call.init.redirect, "error");
    assert.equal(call.init.cache, "no-store");
    assert.equal(call.init.body, undefined);
    const headers = new Headers(call.init.headers);
    assert.equal(headers.get("x-hessara-owner"), owner);
    assert.equal(headers.get("authorization"), null);
    nonces.push(headers.get("x-hessara-nonce"));
    const timestamp = Number(headers.get("x-hessara-time"));
    assert.ok(Math.abs(Date.now() - timestamp) < 5000);
    assert.equal(headers.get("x-hessara-signature"), signedCodeWorkerHeaders("GET", new URL(call.url).pathname as "/health" | "/workspace", owner, environment.HESSARA_CODE_WORKER_SECRET, "", timestamp, headers.get("x-hessara-nonce")!)["x-hessara-signature"]);
  }
  assert.notEqual(nonces[0], nonces[1]);
});

test("configured never implies connected, and missing probes block workspace operations", async () => {
  for (const change of [{ artifacts: false }, { runner: false }, { aiConfigured: false }, { connected: false }, { concurrency: 1 }, { model: "" }, { artifacts: undefined }, { runner: undefined }, { aiConfigured: undefined }, { aiConfigured: undefined, ai: true }]) {
    let calls = 0;
    const handlers = createCodeWorkspaceHandlers({ identity: async () => owner, environment: () => environment, fetcher: async () => { calls++; return Response.json({ ...health, ...change }); } });
    const get = await handlers.GET(getRequest());
    assert.deepEqual(await get.json(), { readiness: { configured: true, connected: false, reason: "NOT_READY" } });
    assert.equal(calls, 1);
    const post = await handlers.POST(request());
    assert.equal(post.status, 503);
    assert.deepEqual(await post.json(), { error: "NOT_READY" });
    assert.equal(calls, 2);
  }
});

test("POST rejects input before probing and sends a signed normalized action after a successful probe", async () => {
  let calls = 0;
  const handlers = createCodeWorkspaceHandlers({ identity: async () => owner, environment: () => environment, fetcher: async (url, init) => {
    calls++;
    if (url.endsWith("/health")) return Response.json(health);
    assert.equal(init.method, "POST");
    assert.deepEqual(JSON.parse(init.body as string), create);
    const headers = new Headers(init.headers);
    assert.equal(headers.get("x-hessara-signature"), signedCodeWorkerHeaders("POST", "/workspace", owner, environment.HESSARA_CODE_WORKER_SECRET, init.body as string, Number(headers.get("x-hessara-time")), headers.get("x-hessara-nonce")!)["x-hessara-signature"]);
    return Response.json(state);
  } });
  assert.equal((await handlers.POST(request({ ...create, owner: taskId }))).status, 400);
  assert.equal(calls, 0);
  const response = await handlers.POST(request({ ...create, name: "  Example  " }));
  assert.deepEqual(await response.json(), state);
  assert.equal(calls, 2);
});

test("oversized raw file collections are rejected before inspecting elements or contacting the worker", async () => {
  let visited = false;
  const poisoned = Array.from({ length: CODE_WORKSPACE_LIMITS.files + 1 }, () => ({ get path() { visited = true; throw new Error("schema inspected an oversized collection"); }, content: "" }));
  assert.throws(() => parseCodeWorkspaceAction({ ...create, files: poisoned }), rejectsCode("LIMIT"));
  assert.equal(visited, false);
  let calls = 0;
  const handlers = createCodeWorkspaceHandlers({ identity: async () => owner, environment: () => environment, fetcher: async () => { calls++; return Response.json(health); } });
  for (const action of [{ ...create, files: Array(CODE_WORKSPACE_LIMITS.files + 1).fill(null) }, { action: "edit", projectId: owner, expectedHead: project.head, files: Array(CODE_WORKSPACE_LIMITS.files + 1).fill(null) }]) {
    const response = await handlers.POST(request(action));
    assert.equal(response.status, 429); assert.deepEqual(await response.json(), { error: "LIMIT" });
  }
  assert.equal(calls, 0);
});

test("request limits apply to declared and streamed bytes, JSON syntax and content type", async () => {
  let calls = 0;
  const handlers = createCodeWorkspaceHandlers({ identity: async () => owner, environment: () => environment, fetcher: async () => { calls++; return Response.json(health); } });
  const declared = request();
  declared.headers.set("content-length", String(CODE_WORKSPACE_LIMITS.requestBytes + 1));
  assert.deepEqual(await (await handlers.POST(declared)).json(), { error: "LIMIT" });
  const streamed = new Request("https://hessara.example/api/code-workspace", { method: "POST", headers: { "content-type": "application/json" }, body: " ".repeat(CODE_WORKSPACE_LIMITS.requestBytes + 1) });
  assert.deepEqual(await (await handlers.POST(streamed)).json(), { error: "LIMIT" });
  for (const body of ["{", "null", "[]", ""]) {
    const invalid = new Request("https://hessara.example/api/code-workspace", { method: "POST", headers: { "content-type": "application/json" }, body });
    assert.deepEqual(await (await handlers.POST(invalid)).json(), { error: "INVALID_INPUT" });
  }
  const wrongType = request();
  wrongType.headers.set("content-type", "text/plain");
  assert.deepEqual(await (await handlers.POST(wrongType)).json(), { error: "INVALID_INPUT" });
  assert.equal(calls, 0);
});

test("worker failures expose only known error codes, with no raw body, URL, secret or automatic retry", async () => {
  for (const payload of [{ error: `private failure ${environment.HESSARA_CODE_WORKER_SECRET}` }, { error: "TESTS_FAILED", detail: environment.HESSARA_CODE_WORKER_SECRET }, { error: "AUTH_REQUIRED" }, { error: "GIT_ERROR" }]) {
    let calls = 0;
    const handlers = createCodeWorkspaceHandlers({ identity: async () => owner, environment: () => environment, fetcher: async url => {
      calls++;
      return url.endsWith("/health") ? Response.json(health) : Response.json(payload, { status: 500 });
    } });
    const response = await handlers.POST(request());
    const result = await response.json();
    assert.deepEqual(result, { error: ["TESTS_FAILED", "AUTH_REQUIRED"].includes(payload.error) ? payload.error : "UNAVAILABLE" });
    assert.equal(calls, 2);
    assert.ok(!JSON.stringify(result).includes(environment.HESSARA_CODE_WORKER_SECRET));
    assert.ok(!JSON.stringify(result).includes(environment.HESSARA_CODE_WORKER_URL));
  }
  const failed = createCodeWorkspaceHandlers({ identity: async () => owner, environment: () => environment, fetcher: async () => { throw new Error(`network ${environment.HESSARA_CODE_WORKER_SECRET}`); } });
  assert.deepEqual(await (await failed.GET(getRequest())).json(), { readiness: { configured: true, connected: false, reason: "UNAVAILABLE" } });
  assert.deepEqual(await codeWorkspaceFailure(new Error(`raw ${environment.HESSARA_CODE_WORKER_SECRET}`)).json(), { error: "UNAVAILABLE" });
});

test("bounded worker JSON and a valid matching state are required before connection is reported", async () => {
  const failures = [
    () => new Response("private server error", { headers: { "content-type": "text/html" } }),
    () => new Response("{", { headers: { "content-type": "application/json" } }),
    () => new Response("{}", { headers: { "content-type": "application/json", "content-length": String(CODE_WORKSPACE_LIMITS.responseBytes + 1) } }),
    () => new Response(" ".repeat(CODE_WORKSPACE_LIMITS.responseBytes + 1), { headers: { "content-type": "application/json" } }),
    () => Response.json({ ...state, secret: environment.HESSARA_CODE_WORKER_SECRET }),
    () => Response.json({ ...state, concurrency: 1 }),
    () => Response.json({ ...state, model: "different-model" }),
  ];
  for (const failure of failures) {
    const handlers = createCodeWorkspaceHandlers({ identity: async () => owner, environment: () => environment, fetcher: async url => url.endsWith("/health") ? Response.json(health) : failure() });
    const response = await handlers.GET(getRequest());
    const result = await response.json() as { readiness: { configured: boolean; connected: boolean }; state?: unknown };
    assert.equal(result.readiness.configured, true);
    assert.equal(result.readiness.connected, false);
    assert.equal(result.state, undefined);
    assert.ok(!JSON.stringify(result).includes(environment.HESSARA_CODE_WORKER_SECRET));
  }
});

test("workspace state enforces project, task, file and safe error bounds", () => {
  assert.deepEqual(parseCodeWorkspaceState({ ...state, projects: [project] }), { ...state, projects: [project] });
  const validTask = { id: taskId, title: "Fix", instruction: "Fix", priority: 2, dependencies: [], allowedPaths: ["src/main.ts"], status: "queued", createdAt: now, generationStartedAt: now, generationEndedAt: now };
  const populated = { ...project, tasks: [validTask] };
  assert.equal(parseCodeWorkspaceState({ ...state, projects: [populated] }).projects[0].tasks.length, 1);
  const invalidStates = [
    { ...state, projects: Array.from({ length: 6 }, () => ({ ...project, id: randomUUID() })) },
    { ...state, projects: [project, project] },
    { ...state, projects: [{ ...project, tasks: Array.from({ length: 13 }, () => ({ ...validTask, id: randomUUID() })) }] },
    { ...state, projects: [{ ...project, tasks: [validTask, validTask] }] },
    { ...state, projects: [{ ...project, files: [{ path: ".env", content: "secret" }] }] },
    { ...state, projects: [{ ...project, tasks: [{ ...validTask, error: environment.HESSARA_CODE_WORKER_SECRET }] }] },
    { ...state, projects: [{ ...project, head: "main" }] },
    { ...state, projects: [{ ...project, repository: "https://secret:credential@test.artifacts.cloudflare.net/git/example" }] },
    { ...state, projects: [{ ...project, repository: "https://test.artifacts.cloudflare.net/git/example?token=secret" }] },
  ];
  for (const value of invalidStates) assert.throws(() => parseCodeWorkspaceState(value), rejectsCode("UNAVAILABLE"));
});

test("revision reads pin the branch head and return only bounded reachable snapshots", () => {
  const commit = {commit:project.head,parents:[],author:'Author',message:'Commit',at:now};
  const withHistory = {...project,history:[commit],revision:{commit:project.head,files:project.files}};
  assert.deepEqual(parseCodeWorkspaceState({...state,projects:[withHistory]}).projects[0],withHistory);
  assert.deepEqual(parseCodeWorkspaceAction({action:'history',projectId:owner,expectedHead:project.head}),{action:'history',projectId:owner,expectedHead:project.head});
  assert.throws(()=>parseCodeWorkspaceAction({action:'revision',projectId:owner,expectedHead:project.head,commit:'main'}),rejectsCode('INVALID_INPUT'));
  for(const changed of [
    {...withHistory,history:[]},
    {...withHistory,history:[commit,commit]},
    {...withHistory,history:[{...commit,commit:'b'.repeat(40)}]},
    {...withHistory,history:[{...commit,email:'private@example.test'}]},
    {...withHistory,revision:{commit:'b'.repeat(40),files:project.files}},
    {...withHistory,revision:{commit:project.head,files:[{path:'.env',content:'secret'}]}},
  ]) assert.throws(()=>parseCodeWorkspaceState({...state,projects:[changed]}),rejectsCode('UNAVAILABLE'));
});

test('workspace usage records retain bounded numeric metrics after the Zod4 migration',()=>{
  const task={id:taskId,title:'Example task',instruction:'Review the owned fixture',priority:2,dependencies:[],allowedPaths:['src/main.ts'],status:'queued',createdAt:now,usage:{inputTokens:12,outputTokens:7}};
  const withUsage=(usage:unknown)=>({...state,projects:[{...project,tasks:[{...task,usage}]}]});
  const parsed=parseCodeWorkspaceState(withUsage(task.usage));
  assert.deepEqual(parsed.projects[0].tasks[0].usage,task.usage);
  assert.equal(parsed.projects[0].tasks[0].version,0);
  for(const usage of [{tokens:-1},{tokens:Number.POSITIVE_INFINITY},{tokens:Number.NaN},{tokens:'12'},Object.fromEntries(Array.from({length:33},(_,index)=>['metric'+index,index]))]) {
    assert.throws(()=>parseCodeWorkspaceState(withUsage(usage)),rejectsCode('UNAVAILABLE'));
  }
});

