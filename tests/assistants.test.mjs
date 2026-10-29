import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { assistantInput, assistantRequest, assistantLimits, createTaskToken, readTaskToken, readAssistantJson, parseAssistantText, parseManusStatus, safeManusUrl, invokeAssistant } from "../lib/assistant-providers.ts";

const key = "test-only-provider-credential";
const id = "ABCDEFGHIJKLMNOP123456";
const run = (provider) => ({ provider, action: "run", prompt: "اشرح خطوات حل المسألة مع مثال", apiKey: key });
const errorCode = code => error => error.message === code;

test("assistant input rejects endpoint injection, raw task IDs and unsupported actions", () => {
  for (const provider of ["grok", "meta", "openai", "manus"]) assert.equal(assistantInput.safeParse(run(provider)).success, true);
  for (const change of [
    { endpoint: "http://127.0.0.1/" }, { model: "arbitrary-model" }, { apiKey: "abc\r\nx-injected: yes" },
    { prompt: "x".repeat(8001) }, { prompt: "short" }, { provider: "other" }, { action: "delete" },
  ]) assert.equal(assistantInput.safeParse({ ...run("grok"), ...change }).success, false);
  assert.equal(assistantInput.safeParse({ provider: "manus", action: "status", apiKey: key, taskId: id }).success, false);
  assert.equal(assistantInput.safeParse({ provider: "openai", action: "status", apiKey: key, taskToken: "x".repeat(30) }).success, false);
});

test("provider requests use fixed official origins and bounded generation", () => {
  const expected = { grok: "https://api.x.ai/v1/chat/completions", meta: "https://api.meta.ai/v1/chat/completions", openai: "https://api.openai.com/v1/responses", manus: "https://api.manus.ai/v2/task.create" };
  for (const provider of Object.keys(expected)) {
    const request = assistantRequest(run(provider));
    assert.equal(request.url, expected[provider]);
    assert.ok(!JSON.stringify(request.body).includes(key));
    assert.ok(!("tools" in request.body));
    if (provider === "manus") {
      assert.equal(request.body.share_visibility, "private");
      assert.equal(request.body.interactive_mode, true);
      assert.deepEqual(request.body.message.connectors, []);
    } else assert.equal(request.body.max_tokens || request.body.max_completion_tokens || request.body.max_output_tokens, 1800);
  }
});

test("task tokens enforce user, key, purpose, expiry and integrity before any network request", async () => {
  const previous = process.env.HESSARA_ENCRYPTION_KEY;
  process.env.HESSARA_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  try {
    const now = 1_800_000_000_000;
    const token = await createTaskToken(id, "alice", key, now);
    assert.ok(!token.includes(id) && !token.includes(key));
    assert.equal(await readTaskToken(token, "alice", key, now + 1000), id);
    await assert.rejects(readTaskToken(token, "bob", key, now), errorCode("TASK_TOKEN_INVALID"));
    await assert.rejects(readTaskToken(token, "alice", "other-key", now), errorCode("TASK_TOKEN_INVALID"));
    await assert.rejects(readTaskToken(token, "alice", key, now + assistantLimits.taskLifetimeMs), errorCode("TASK_TOKEN_INVALID"));
    await assert.rejects(readTaskToken(token + ".extra", "alice", key, now), errorCode("TASK_TOKEN_INVALID"));
    await assert.rejects(createTaskToken("../../other", "alice", key, now), errorCode("PROVIDER_RESPONSE"));
    let requests = 0;
    const current = await createTaskToken(id, "alice", key);
    await assert.rejects(invokeAssistant({ provider: "manus", action: "status", taskToken: current, apiKey: key }, "bob", async () => { requests++; return Response.json({}); }), errorCode("TASK_TOKEN_INVALID"));
    assert.equal(requests, 0);
  } finally {
    if (previous === undefined) delete process.env.HESSARA_ENCRYPTION_KEY;
    else process.env.HESSARA_ENCRYPTION_KEY = previous;
  }
});

test("provider JSON has an enforced streaming byte ceiling and invalid JSON fails closed", async () => {
  await assert.rejects(readAssistantJson(new Response("x".repeat(assistantLimits.responseBytes + 1))), errorCode("PROVIDER_RESPONSE"));
  await assert.rejects(readAssistantJson(new Request("https://hessara.test", { method: "POST", body: "x".repeat(assistantLimits.requestBytes + 1) }), true), error => error.status === 413);
  await assert.rejects(readAssistantJson(new Response("<html>provider error</html>")), errorCode("PROVIDER_RESPONSE"));
  assert.deepEqual(await readAssistantJson(Response.json({ ok: true })), { ok: true });
});

test("only visible text is returned, credentials redacted, truncated responses remain incomplete", () => {
  const value = { status: "completed", output: [{ type: "reasoning", summary: [{ text: "private reasoning" }] }, { type: "message", content: [{ type: "output_text", text: `answer ${key}` }] }] };
  const result = parseAssistantText("openai", value, key);
  assert.equal(result.status, "completed");
  assert.ok(!result.text.includes(key) && !result.text.includes("private reasoning"));
  assert.equal(parseAssistantText("meta", { choices: [{ message: { content: "partial" }, finish_reason: "length" }] }, key).status, "incomplete");
  assert.throws(() => parseAssistantText("grok", { choices: [{ message: { content: null } }] }, key), errorCode("PROVIDER_RESPONSE"));
});

test("Manus completion requires explicit end of background jobs, with unknown and waiting preserved", () => {
  const messages = { ok: true, messages: [{ type: "assistant_message", assistant_message: { content: "second" } }, { type: "tool_used", tool_used: { result: "secret" } }, { type: "assistant_message", assistant_message: { content: "first" } }] };
  const parse = task => parseManusStatus({ ok: true, task }, messages, key);
  assert.equal(parse({ status: "stopped", has_running_background_jobs: false }).status, "completed");
  assert.equal(parse({ status: "stopped", has_running_background_jobs: true }).status, "running");
  assert.equal(parse({ status: "stopped" }).status, "unknown");
  assert.equal(parse({ status: "waiting" }).status, "waiting");
  assert.equal(parse({ status: "brand-new-status" }).status, "unknown");
  assert.equal(parse({ status: "running" }).text, "second");
  assert.throws(() => parseManusStatus({ ok: false }, messages, key), errorCode("PROVIDER_RESPONSE"));
  assert.throws(() => parseManusStatus({ ok: true, task: { id: "other", status: "running" } }, { ...messages, task_id: id }, key, id), errorCode("PROVIDER_RESPONSE"));
});

test("Manus links reject lookalike hosts, insecure URLs, credentials and tracking data", () => {
  assert.equal(safeManusUrl(`https://manus.im/app/${id}`), `https://manus.im/app/${id}`);
  assert.equal(safeManusUrl(`https://www.manus.ai/app/${id}`), `https://www.manus.ai/app/${id}`);
  for (const url of ["http://manus.im/app/1", "https://manus.im.attacker.test/app/1", "https://attacker.test/?manus.im", "https://user:password@manus.im/app/1", "https://manus.im:444/app/1", "https://manus.im/app/1?key=secret", "javascript:alert(1)"]) assert.equal(safeManusUrl(url), undefined);
});

test("network call prevents redirects, uses no-store, and masks upstream authentication details", async () => {
  let options;
  const good = await invokeAssistant(run("grok"), "alice", async (url, init) => {
    assert.equal(url, "https://api.x.ai/v1/chat/completions");
    options = init;
    return Response.json({ choices: [{ message: { content: "نتيجة واضحة" }, finish_reason: "stop" }] });
  });
  assert.equal(options.redirect, "error");
  assert.equal(options.cache, "no-store");
  assert.ok(options.signal instanceof AbortSignal);
  assert.equal(good.text, "نتيجة واضحة");
  await assert.rejects(invokeAssistant(run("meta"), "alice", async () => new Response(`rejected key ${key}`, { status: 401 })), errorCode("PROVIDER_AUTH"));
  await assert.rejects(invokeAssistant(run("openai"), "alice", async () => new Response(key, { status: 429 })), error => error.message === "PROVIDER_RATE_LIMIT" && error.status === 429);
  await assert.rejects(invokeAssistant(run("grok"), "alice", async () => { throw new Error(key); }), errorCode("PROVIDER_UNAVAILABLE"));
});

test("Manus create followed by owner-authorized polling exposes no provider credentials", async () => {
  const previous = process.env.HESSARA_ENCRYPTION_KEY;
  process.env.HESSARA_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  try {
    const created = await invokeAssistant(run("manus"), "alice", async () => Response.json({ ok: true, task_id: id, task_url: "https://attacker.test/" }));
    assert.equal(created.taskUrl, `https://manus.im/app/${id}`);
    const polled = await invokeAssistant({ provider: "manus", action: "status", taskToken: created.taskToken, apiKey: key }, "alice", async url => url.includes("task.detail")
      ? Response.json({ ok: true, task: { id, status: "stopped", has_running_background_jobs: false } })
      : Response.json({ ok: true, task_id: id, messages: [{ type: "assistant_message", assistant_message: { content: "تم تجهيز الخطة" } }] }));
    assert.equal(polled.status, "completed");
    assert.equal(polled.text, "تم تجهيز الخطة");
    assert.ok(!JSON.stringify({ created, polled }).includes(key));
  } finally {
    if (previous === undefined) delete process.env.HESSARA_ENCRYPTION_KEY;
    else process.env.HESSARA_ENCRYPTION_KEY = previous;
  }
});
