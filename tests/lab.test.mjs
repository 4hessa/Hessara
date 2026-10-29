import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { createDatabase } from "../lib/postgres-database.ts";
import { createLabService } from "../lib/lab-service.ts";
import { customLabInputSchema, readLabJson, LAB_LIMITS } from "../lib/custom-lab.ts";
import { invokeNvidia, readProviderJson } from "../lib/nvidia.ts";

const migration = await readFile(new URL("../supabase/migrations/202609290001_hessara.sql", import.meta.url), "utf8");
const input = (overrides = {}) => ({
  requestId: randomUUID(), name: "Personal comparison", taskType: "writing", locale: "ar",
  models: ["profile-a", "profile-b"],
  cases: [{ id: randomUUID(), title: "Exact submitted text", prompt: "  اكتب سطرًا.\nKeep this whitespace.  ", reference: "A human reference", checks: [{ kind: "contains", value: "سطر" }] }],
  maxOutputTokens: 1024, ...overrides,
});
const outcome = (overrides = {}) => ({
  output: "A retained answer", latency: 123, input_tokens: 10, output_tokens: 20, cost: null, error: null,
  metadata: JSON.stringify({ resolved_model: "provider/resolved-version", request_id: "provider-request-id" }), ...overrides,
});
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
async function harness(provider = async () => outcome()) {
  const pg = new PGlite();
  await pg.exec("CREATE ROLE anon; CREATE ROLE authenticated;");
  await pg.exec(migration);
  let currentTime = Date.parse("2026-10-08T12:00:00.000Z");
  let failPersistence = false;
  const execute = client => async (sql, values) => {
    if (failPersistence && sql.startsWith("UPDATE trials SET status=$1,score=NULL,output=")) {
      failPersistence = false;
      throw new Error("Simulated persistence failure after provider response");
    }
    const result = await client.query(sql, values);
    return { rows: result.rows, count: result.affectedRows ?? result.rows.length };
  };
  const db = createDatabase(execute(pg), work => pg.transaction(tx => work(execute(tx))));
  const calls = [];
  const models = ["profile-a", "profile-b", "profile-c", "profile-d"].map((id, index) => ({
    id, name: `Model ${index}`, label: `provider/model-${index}`, provider: index === 0 ? "nvidia" : "openrouter", ready: true, color: "#111111",
  }));
  const service = createLabService({
    db, now: () => currentTime,
    availableModels: async () => [...models, { id: "sim", name: "Synthetic", provider: "simulation", ready: true, label: "sim", color: "#000" }],
    modelConfig: async id => {
      const model = models.find(item => item.id === id);
      return { id, name: model.name, provider: model.provider, model: model.label, inputPrice: 1, outputPrice: 2 };
    },
    invokeModel: async (task, model, owner, options) => {
      const call = { task, model, owner, options };
      calls.push(call);
      return provider(call, calls.length);
    },
  });
  return { service, pg, db, calls, close: () => pg.close(), advance: ms => { currentTime += ms; }, failPersistence: () => { failPersistence = true; } };
}

test("custom input bounds are strict and preserve prompt whitespace and optional evidence", async () => {
  const valid = input();
  assert.deepEqual(customLabInputSchema.parse(valid), valid);
  for (const invalid of [
    { extra: true }, { requestId: "not-a-uuid" }, { models: ["profile-a"] },
    { models: ["profile-a", "profile-a"] }, { models: ["a", "b", "c", "d", "e"] },
    { taskType: "unknown" }, { locale: "unknown" }, { maxOutputTokens: 999999 },
    { cases: [] }, { cases: [...valid.cases, ...valid.cases] },
    { cases: [{ ...valid.cases[0], prompt: " \n\t " }] },
    { cases: [{ ...valid.cases[0], prompt: "x".repeat(8001) }] },
    { cases: [{ ...valid.cases[0], reference: "x".repeat(4001) }] },
    { cases: [{ ...valid.cases[0], checks: Array(9).fill({ kind: "exact", value: "x" }) }] },
    { cases: [{ ...valid.cases[0], checks: [{ kind: "execute", value: "x" }] }] },
  ]) assert.equal(customLabInputSchema.safeParse({ ...valid, ...invalid }).success, false);
  const largest = input({ models: ["a", "b", "c", "d"], cases: Array.from({ length: 8 }, (_, index) => ({ id: randomUUID(), title: `${index}`, prompt: "Test" })) });
  assert.equal(customLabInputSchema.parse(largest).models.length * largest.cases.length, 32);
  const request = new Request("https://hessara.example/api/lab", { method: "POST", body: JSON.stringify(valid) });
  assert.deepEqual(await readLabJson(request), valid);
  await assert.rejects(readLabJson(new Request("https://hessara.example/api/lab", { method: "POST", body: "{" })), { message: "INVALID_INPUT" });
  const large = new Request("https://hessara.example/api/lab", { method: "POST", body: JSON.stringify({ prompt: "ع".repeat(LAB_LIMITS.requestBytes / 2) }) });
  await assert.rejects(readLabJson(large), error => error.message === "INVALID_INPUT" && error.status === 413);
});

test("draft creation is idempotent, owner isolated, immutable and has no provider side effects", async () => {
  const h = await harness();
  try {
    const submitted = input();
    const created = await h.service.createLabRun("alice", submitted);
    assert.equal(created.run.status, "draft");
    assert.equal(created.run.total, 2);
    assert.equal(created.run.configData.cases[0].prompt, submitted.cases[0].prompt);
    assert.equal(created.run.configData.modelSnapshots[0].model, "provider/model-0");
    assert.equal(created.run.configData.providerPolicies["profile-a"].max_output_tokens, 1024);
    assert.equal(created.run.configData.providerPolicies["profile-a"].timeout_ms, 90000);
    assert.equal(created.run.configData.providerPolicies["profile-b"].timeout_ms, 55000);
    assert.equal(h.calls.length, 0);
    const repeated = await h.service.createLabRun("alice", submitted);
    assert.equal(repeated.run.config, created.run.config);
    assert.equal((await h.pg.query("SELECT count(*)::integer AS n FROM runs")).rows[0].n, 1);
    await assert.rejects(h.service.createLabRun("alice", { ...submitted, name: "Changed" }), { message: "ID_CONFLICT" });
    await assert.rejects(h.service.createLabRun("bob", submitted), { message: "LIMIT_OR_CONFLICT" });
    for (const method of ["getLabRun", "cancelLabRun", "claimLabStart", "claimLabResume", "executeLabStep"])
      await assert.rejects(h.service[method]("bob", submitted.requestId), error => error.message === "NOT_FOUND" && error.status === 404);
    await assert.rejects(h.service.createLabRun("alice", input({ models: ["profile-a", "sim"] })), { message: "NOT_READY" });
    await assert.rejects(h.service.createLabRun("alice", input({ models: ["profile-a", "unconnected"] })), { message: "NOT_READY" });
    await h.pg.exec("INSERT INTO runs(id,owner,name,mode,status,created_at,config,total) VALUES('benchmark','alice','benchmark','demo','completed','2026-10-08','{}',1)");
    const listed = await h.service.listLabRuns("alice");
    assert.equal(listed.runs.length, 1);
    assert.equal(listed.models.some(model => model.provider === "simulation"), false);
    assert.equal("owner" in listed.runs[0], false);
    assert.equal("lock_token" in listed.runs[0], false);
    assert.equal("config" in listed.runs[0], false, "history index must not download every private prompt");
    assert.equal("configData" in listed.runs[0], false);
  } finally { await h.close(); }
});

test("custom history and open quotas hold while idempotent save still works at the limit", async () => {
  const h = await harness();
  try {
    const inputs = Array.from({ length: 5 }, () => input());
    for (const item of inputs) await h.service.createLabRun("alice", item);
    await assert.rejects(h.service.createLabRun("alice", input()), { message: "LIMIT_OR_CONFLICT" });
    assert.equal((await h.service.createLabRun("alice", inputs[0])).run.id, inputs[0].requestId);
    for (const item of inputs) await h.service.cancelLabRun("alice", item.requestId);
    const source = await h.service.getLabRun("alice", inputs[0].requestId);
    await h.pg.query("INSERT INTO runs(id,owner,name,mode,status,created_at,config,total) SELECT 'history-'||n,'alice','past','custom','cancelled','2026-10-01',$1,2 FROM generate_series(1,195) n", [source.run.config]);
    await assert.rejects(h.service.createLabRun("alice", input()), { message: "LIMIT_OR_CONFLICT" });
    assert.equal((await h.service.listLabRuns("alice")).runs.length, 200);
    assert.equal(h.calls.length, 0);
  } finally { await h.close(); }
});

test("each case reaches each model once with identical text, retained settings and ungraded outcomes", async () => {
  const h = await harness();
  try {
    const submitted = input({ cases: [...input().cases, { id: randomUUID(), title: "Second", prompt: "\n Second case with spaces \t" }] });
    await h.service.createLabRun("alice", submitted);
    assert.equal(await h.service.claimLabStart("alice", submitted.requestId), true);
    assert.equal(await h.service.claimLabStart("alice", submitted.requestId), false);
    for (let index = 0; index < 4; index++) {
      const state = await h.service.executeLabStep("alice", submitted.requestId);
      assert.equal(state.hasMore, index < 3);
    }
    await h.service.executeLabStep("alice", submitted.requestId);
    assert.equal(h.calls.length, 4);
    assert.deepEqual(h.calls.map(call => call.task.prompt), submitted.cases.flatMap(item => [item.prompt, item.prompt]));
    assert.ok(h.calls.every(call => call.options.maxOutputTokens === 1024));
    const saved = await h.service.getLabRun("alice", submitted.requestId);
    assert.equal(saved.run.status, "completed");
    assert.equal(saved.run.done, 4);
    for (const trial of saved.trials) {
      assert.equal(trial.score, null);
      assert.equal(trial.cost, null);
      assert.equal(trial.output, "A retained answer");
      assert.equal(trial.latency, 123);
      assert.equal(trial.metadataData.requested_model, trial.model === "profile-a" ? "provider/model-0" : "provider/model-1");
      assert.equal(trial.metadataData.resolved_model, "provider/resolved-version");
      assert.equal(trial.metadataData.settings.max_output_tokens, 1024);
      assert.ok(trial.metadataData.started_at && trial.metadataData.finished_at);
    }
  } finally { await h.close(); }
});

test("live lease excludes simultaneous dispatch and cancellation retains the current reply only", async () => {
  const entered = deferred(), release = deferred();
  const h = await harness(async () => { entered.resolve(); await release.promise; return outcome(); });
  try {
    const submitted = input();
    await h.service.createLabRun("alice", submitted);
    await h.service.claimLabStart("alice", submitted.requestId);
    await assert.rejects(h.service.claimLabResume("alice", submitted.requestId), { message: "BUSY" });
    const running = h.service.executeLabStep("alice", submitted.requestId);
    await entered.promise;
    const during = await h.service.getLabRun("alice", submitted.requestId);
    assert.equal(during.run.next_index, 1);
    assert.equal(during.trials[0].status, "running");
    assert.ok(during.trials[0].metadataData.started_at);
    assert.equal(during.trials[0].metadataData.finished_at, null);
    assert.deepEqual(await h.service.executeLabStep("alice", submitted.requestId), { hasMore: true, paused: false, busy: true });
    await h.service.cancelLabRun("alice", submitted.requestId);
    release.resolve();
    assert.deepEqual(await running, { hasMore: false, paused: false });
    const saved = await h.service.getLabRun("alice", submitted.requestId);
    assert.equal(saved.run.status, "cancelled");
    assert.equal(saved.trials[0].output, "A retained answer");
    assert.equal(saved.trials[0].status, "done");
    await h.service.executeLabStep("alice", submitted.requestId);
    assert.equal(h.calls.length, 1);
    await assert.rejects(h.service.claimLabResume("alice", submitted.requestId), { message: "INVALID_STATE" });
  } finally { release.resolve(); await h.close(); }
});

test("expired execution lease records unknown outcome, never resends it, and fences a late provider result", async () => {
  const entered = deferred(), release = deferred();
  const h = await harness(async (_call, number) => {
    if (number === 1) { entered.resolve(); await release.promise; return outcome({ output: "late response" }); }
    return outcome({ metadata: "{}" });
  });
  try {
    const submitted = input();
    await h.service.createLabRun("alice", submitted);
    await h.service.claimLabStart("alice", submitted.requestId);
    const original = h.service.executeLabStep("alice", submitted.requestId);
    await entered.promise;
    h.advance(LAB_LIMITS.leaseMs + 1);
    assert.equal(await h.service.claimLabResume("alice", submitted.requestId), true);
    await assert.rejects(h.service.claimLabResume("alice", submitted.requestId), { message: "BUSY" });
    await h.service.executeLabStep("alice", submitted.requestId);
    release.resolve();
    await original;
    const saved = await h.service.getLabRun("alice", submitted.requestId);
    assert.equal(saved.run.status, "completed");
    assert.equal(saved.trials[0].error, "interrupted_unknown_outcome");
    assert.equal(saved.trials[0].output, null);
    assert.ok(saved.trials[0].metadataData.started_at && saved.trials[0].metadataData.finished_at);
    assert.equal(saved.trials[1].metadataData.resolved_model, null);
    assert.deepEqual(h.calls.map(call => call.model.id), ["profile-a", "profile-b"]);
  } finally { release.resolve(); await h.close(); }
});

test("workflow retry can reclaim an expired lease without explicitly restarting an attempted paid call", async () => {
  const entered = deferred(), release = deferred();
  const h = await harness(async (_call, number) => {
    if (number === 1) { entered.resolve(); await release.promise; }
    return outcome();
  });
  try {
    const submitted = input();
    await h.service.createLabRun("alice", submitted);
    await h.service.claimLabStart("alice", submitted.requestId);
    const oldStep = h.service.executeLabStep("alice", submitted.requestId);
    await entered.promise;
    h.advance(LAB_LIMITS.leaseMs + 1);
    await h.service.executeLabStep("alice", submitted.requestId);
    release.resolve();
    await oldStep;
    assert.equal(h.calls.length, 2);
    const saved = await h.service.getLabRun("alice", submitted.requestId);
    assert.equal(saved.trials[0].error, "interrupted_unknown_outcome");
    assert.equal(saved.run.done, 2);
  } finally { release.resolve(); await h.close(); }
});

test("dispatch failure and explicit recovery preserve attempts and throttle duplicate workflow launches", async () => {
  const h = await harness();
  try {
    const submitted = input();
    await h.service.createLabRun("alice", submitted);
    await h.service.claimLabStart("alice", submitted.requestId);
    await h.service.markLabDispatchFailure("alice", submitted.requestId);
    assert.equal((await h.service.getLabRun("alice", submitted.requestId)).run.status, "draft");
    await h.service.claimLabStart("alice", submitted.requestId);
    await assert.rejects(h.service.claimLabResume("alice", submitted.requestId), { message: "BUSY" });
    h.advance(LAB_LIMITS.leaseMs + 1);
    assert.equal(await h.service.claimLabResume("alice", submitted.requestId), true);
    await assert.rejects(h.service.claimLabResume("alice", submitted.requestId), { message: "BUSY" });
    await h.service.executeLabStep("alice", submitted.requestId);
    h.advance(LAB_LIMITS.leaseMs + 1);
    await h.service.claimLabResume("alice", submitted.requestId);
    await h.service.markLabDispatchFailure("alice", submitted.requestId);
    const saved = await h.service.getLabRun("alice", submitted.requestId);
    assert.equal(saved.run.status, "paused");
    assert.equal(saved.run.next_index, 1);
    assert.equal(saved.trials.length, 1);
    await h.service.claimLabResume("alice", submitted.requestId);
    await h.service.executeLabStep("alice", submitted.requestId);
    assert.equal(h.calls.length, 2);
  } finally { await h.close(); }
});

test("persistence failure after a provider call keeps its reservation and resumes only untouched jobs", async () => {
  const h = await harness();
  try {
    const submitted = input();
    await h.service.createLabRun("alice", submitted);
    await h.service.claimLabStart("alice", submitted.requestId);
    h.failPersistence();
    await assert.rejects(h.service.executeLabStep("alice", submitted.requestId), /Simulated persistence failure/);
    await h.service.markLabWorkflowFailure("alice", submitted.requestId);
    let saved = await h.service.getLabRun("alice", submitted.requestId);
    assert.equal(saved.run.status, "paused");
    assert.equal(saved.run.next_index, 1);
    await assert.rejects(h.service.claimLabResume("alice", submitted.requestId), { message: "BUSY" });
    h.advance(LAB_LIMITS.leaseMs + 1);
    await h.service.claimLabResume("alice", submitted.requestId);
    await h.service.executeLabStep("alice", submitted.requestId);
    saved = await h.service.getLabRun("alice", submitted.requestId);
    assert.equal(saved.run.status, "completed");
    assert.equal(saved.trials[0].error, "interrupted_unknown_outcome");
    assert.equal(h.calls.length, 2);
  } finally { await h.close(); }
});

test("provider attention pauses future calls and explicit resume does not repeat a failed request", async () => {
  const h = await harness(async (_call, number) => outcome(number === 1 ? { error: "provider_http_429", output: "" } : {}));
  try {
    const submitted = input();
    await h.service.createLabRun("alice", submitted);
    await h.service.claimLabStart("alice", submitted.requestId);
    assert.deepEqual(await h.service.executeLabStep("alice", submitted.requestId), { hasMore: false, paused: true });
    assert.equal(h.calls.length, 1);
    assert.deepEqual(await h.service.executeLabStep("alice", submitted.requestId), { hasMore: false, paused: true });
    await h.service.claimLabResume("alice", submitted.requestId);
    await h.service.executeLabStep("alice", submitted.requestId);
    const saved = await h.service.getLabRun("alice", submitted.requestId);
    assert.equal(saved.run.status, "completed");
    assert.equal(saved.trials[0].status, "error");
    assert.equal(saved.trials[0].score, null);
    assert.deepEqual(h.calls.map(call => call.model.id), ["profile-a", "profile-b"]);
  } finally { await h.close(); }
});

test("provider body bounds and custom token options retain truthful truncation and unknown model identity", async () => {
  let calls = 0;
  const model = { model: "test-model", inputPrice: null, outputPrice: null };
  const result = await invokeNvidia(" exact prompt \n", model, "mock-secret", async (_url, options) => {
    calls++;
    const body = JSON.parse(options.body);
    assert.equal(body.max_tokens, 2048);
    assert.equal(body.messages[0].content, " exact prompt \n");
    return Response.json({ choices: [{ message: { content: "x".repeat(24001) }, finish_reason: "stop" }] });
  }, { maxOutputTokens: 2048 });
  assert.equal(result.output.length, 24000);
  assert.equal(result.error, "incomplete_response");
  assert.equal(result.truncated, true);
  assert.equal(JSON.parse(result.metadata).resolved_model, null);
  assert.equal(calls, 1);
  const large = await invokeNvidia("test", model, "mock-secret", async () => new Response(" ".repeat(1_000_001)));
  assert.equal(large.error, "provider_response_too_large");
  await assert.rejects(readProviderJson(new Response("{ invalid")), { message: "provider_response_invalid" });
});
