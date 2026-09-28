import assert from "node:assert/strict";
import fs from "node:fs";

// Intentionally restricted to a local development server. Never spends API credit.
const base = process.env.HESSARA_TEST_URL || "http://localhost:5173";
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(new URL(base).hostname));
const guest = await fetch(base + "/api/runs");
assert.equal(guest.status, 401);
const nvidiaCatalog = await fetch(base + "/api/catalog/nvidia");
assert.equal(nvidiaCatalog.status, 200);
assert.equal((await nvidiaCatalog.json()).models.length, 4);
const nvidiaGuest = await fetch(base + "/api/catalog/nvidia", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    ids: ["z-ai/glm-5.3"],
    apiKey: "test-only-no-network",
  }),
});
assert.equal(nvidiaGuest.status, 401);
const signIn = await fetch(base + "/signin-with-chatgpt?return_to=/", {
  redirect: "manual",
});
const cookie = signIn.headers
  .getSetCookie()
  .map((x) => x.split(";")[0])
  .join("; ");
assert.ok(cookie, "Local sign-in must return its development cookie");
async function request(path, body, extra = {}) {
  const r = await fetch(base + "/api/" + path, {
    headers: {
      Cookie: cookie,
      ...(body ? { "Content-Type": "application/json", Origin: base } : {}),
      ...extra,
    },
    ...(body ? { method: "POST", body: JSON.stringify(body) } : {}),
  });
  const text = await r.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { message: text };
  }
  return { status: r.status, data };
}
let check = await request("models");
assert.equal(check.status, 200);
assert.equal(check.data.vaultReady, true);
const invalid = await request("runs", {
  name: "invalid",
  mode: "demo",
  models: ["sim-atlas"],
  categories: ["logic"],
  count: 999,
  repeats: 1,
});
assert.equal(invalid.status, 400);
const foreign = await request(
  "runs",
  { name: "invalid" },
  { Origin: "https://invalid.example" },
);
assert.equal(foreign.status, 403);
const decisionGuest = await fetch(base + "/api/decisions", {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: base },
  body: JSON.stringify({
    engine: "jev",
    state: "A sufficiently long test request",
  }),
});
assert.equal(decisionGuest.status, 401);
const decisionMissingOrigin = await fetch(base + "/api/decisions", {
  method: "POST",
  headers: { Cookie: cookie, "Content-Type": "application/json" },
  body: JSON.stringify({
    engine: "jev",
    state: "A sufficiently long test request",
  }),
});
assert.equal(decisionMissingOrigin.status, 403);
const privateLaya = await request("decisions", {
  engine: "laya",
  state: "I need to retrieve an item from a long document",
  endpoint: "https://127.0.0.1/v1/systemone",
});
assert.equal(privateLaya.status, 409);
const connection = await request("models", {
  name: "[LOCAL TEST] encrypted profile",
  provider: "openai",
  model: "test-only-no-provider-calls",
  apiKey: "test-only-not-a-real-api-key",
  inputPrice: null,
  outputPrice: null,
});
assert.equal(connection.status, 201);
assert.ok(
  !JSON.stringify(connection.data).includes("test-only-not-a-real-api-key"),
);
assert.ok(!JSON.stringify(connection.data).includes("key_cipher"));
const modelId = connection.data.models.find(
  (x) => x.name === "[LOCAL TEST] encrypted profile",
).id;
const created = await request("runs", {
  name: "[LOCAL TEST] 240 tasks end-to-end",
  mode: "demo",
  models: ["sim-atlas"],
  categories: [
    "coding",
    "logic",
    "analysis",
    "retrieval",
    "instruction",
    "long",
  ],
  count: 40,
  repeats: 1,
});
assert.equal(created.status, 201);
const id = created.data.run.id;
assert.equal(created.data.run.total, 240);
let step = await request("runs/" + id, { action: "step" });
assert.equal(step.status, 200);
assert.equal(step.data.trials.length, 24);
let reloaded = await request("runs/" + id);
assert.equal(
  reloaded.data.trials.length,
  24,
  "A reload must preserve completed trials",
);
const concurrent = await Promise.all([
  request("runs/" + id, { action: "step" }),
  request("runs/" + id, { action: "step" }),
]);
assert.ok(concurrent.every((x) => [200, 409].includes(x.status)));
for (let i = 0; i < 20; i++) {
  step = await request("runs/" + id, { action: "step" });
  assert.equal(step.status, 200);
  if (step.data.run.status === "completed") break;
}
assert.equal(step.data.run.status, "completed");
assert.equal(step.data.trials.length, 240);
assert.equal(step.data.pagination.total, 240);
assert.equal(step.data.pagination.nextOffset, null);
assert.equal(step.data.run.done, 240);
const firstPage = await request("runs/" + id + "?offset=0&limit=37");
const secondPage = await request("runs/" + id + "?offset=37&limit=37");
assert.equal(firstPage.status, 200);
assert.equal(firstPage.data.trials.length, 37);
assert.equal(firstPage.data.pagination.nextOffset, 37);
assert.equal(secondPage.data.trials.length, 37);
assert.equal(secondPage.data.pagination.nextOffset, 74);
assert.equal(firstPage.data.run.done, 240);
assert.equal(secondPage.data.run.done, 240);
assert.equal(
  new Set(
    [...firstPage.data.trials, ...secondPage.data.trials].map(
      (trial) => trial.id,
    ),
  ).size,
  74,
  "Pagination must preserve stable, non-overlapping ordering",
);
const badPage = await request("runs/" + id + "?offset=-1");
assert.equal(badPage.status, 400);
assert.equal(new Set(step.data.trials.map((x) => x.id)).size, 240);
const bigger = await request("runs", {
  name: "[LOCAL TEST] paginated comparison",
  mode: "demo",
  models: ["sim-atlas", "sim-prism"],
  categories: [
    "coding",
    "logic",
    "analysis",
    "retrieval",
    "instruction",
    "long",
  ],
  count: 12,
  repeats: 3,
});
assert.equal(bigger.status, 201);
assert.equal(bigger.data.run.total, 432);
let largerStep;
for (let i = 0; i < 20; i++) {
  largerStep = await request("runs/" + bigger.data.run.id, { action: "step" });
  assert.equal(largerStep.status, 200);
  if (largerStep.data.run.status === "completed") break;
}
assert.equal(largerStep.data.run.done, 432);
assert.equal(largerStep.data.trials.length, 250);
assert.equal(largerStep.data.pagination.nextOffset, 250);
const remaining = await request("runs/" + bigger.data.run.id + "?offset=250");
assert.equal(remaining.status, 200);
assert.equal(remaining.data.trials.length, 182);
assert.equal(remaining.data.pagination.nextOffset, null);
assert.equal(
  new Set(
    [...largerStep.data.trials, ...remaining.data.trials].map(
      (trial) => trial.id,
    ),
  ).size,
  432,
);
assert.ok(step.data.trials.every((x) => x.status === "done"));
assert.ok(step.data.trials.every((x) => x.metadata.includes("simulation")));
const again = await request("runs/" + id, { action: "step" });
assert.equal(
  again.data.trials.length,
  240,
  "Completed runs must not dispatch more tasks",
);
const noAccess = await fetch(base + "/api/runs/" + id);
assert.equal(noAccess.status, 401);
const paperclipStatus = await request("integrations/paperclip");
assert.equal(paperclipStatus.status, 200);
assert.equal(
  paperclipStatus.data.ready,
  false,
  "Local test does not use real Paperclip credentials",
);
const issueDraft = await request("integrations/paperclip", {
  runId: id,
  action: "download",
});
assert.equal(issueDraft.status, 200);
assert.equal(issueDraft.data.issue.status, "backlog");
assert.equal(issueDraft.data.issue.assigneeAgentId, undefined);
assert.ok(issueDraft.data.issue.description.includes(id));
assert.ok(
  !JSON.stringify(issueDraft.data).includes("test-only-not-a-real-api-key"),
);
const unsupportedSend = await request("integrations/paperclip", {
  runId: id,
  action: "send",
});
assert.equal(unsupportedSend.status, 409);
const badCatalog = await request("catalog/connect", {
  ids: ["invented/not-in-catalog"],
  apiKey: "test-only-not-a-real-api-key",
});
assert.equal(badCatalog.status, 400);
const badNvidia = await request("catalog/nvidia", {
  ids: ["invented/not-in-catalog"],
  apiKey: "test-only-not-a-real-api-key",
});
assert.equal(
  badNvidia.status,
  400,
  "Unknown NVIDIA IDs must fail before any upstream request",
);
const custom = await request("models", {
  name: "[LOCAL TEST] Custom OpenRouter",
  provider: "openrouter",
  model: "custom/unlisted-model",
  apiKey: "test-only-not-a-real-api-key",
  inputPrice: null,
  outputPrice: null,
});
assert.equal(custom.status, 201);
assert.ok(custom.data.models.some((m) => m.label === "custom/unlisted-model"));
fs.mkdirSync("work", { recursive: true });
fs.writeFileSync(
  "work/api-test-result.json",
  JSON.stringify(
    {
      passed: true,
      runId: id,
      modelId,
      total: 240,
      checks: [
        "auth",
        "validation",
        "origin",
        "encrypted-profile-response",
        "persistence",
        "resume",
        "concurrency",
        "no-duplicates",
        "idempotent-completion",
      ],
    },
    null,
    2,
  ),
);
console.log(
  "PASS: auth, validation, origin checks, private model profile, 240 real database-backed simulation trials, reload/resume, concurrent dispatch and idempotent completion.",
);
