import test from "node:test";
import assert from "node:assert/strict";
import { JSON_REQUEST_LIMITS, readJsonRequest } from "../lib/request-json.ts";

const request = (body, { headers = { "content-type": "application/json" }, signal } = {}) =>
  new Request("https://hessara.test/api/models", { method: "POST", headers, body, ...(signal ? { signal } : {}) });

test("bounded JSON reader validates media type and declared size before parsing", async () => {
  await assert.rejects(readJsonRequest(request("{}", { headers: { "content-type": "text/plain" } })), error => error.status === 415);
  await assert.rejects(readJsonRequest(request("{}", { headers: { "content-type": "application/json", "content-length": String(JSON_REQUEST_LIMITS.requestBytes + 1) } })), error => error.status === 413);
  assert.deepEqual(await readJsonRequest(request('{"ok":true}')), { ok: true });
});

test("bounded JSON reader enforces the streamed size and rejects malformed UTF-8 or JSON", async () => {
  await assert.rejects(readJsonRequest(request("x".repeat(JSON_REQUEST_LIMITS.requestBytes + 1))), error => error.status === 413);
  await assert.rejects(readJsonRequest(request("{")), error => error.status === 400);
  const malformed = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([0xff])); controller.close(); } });
  await assert.rejects(readJsonRequest(new Request("https://hessara.test/api/models", { method: "POST", headers: { "content-type": "application/json" }, body: malformed, duplex: "half" })), error => error.status === 400);
});

test("bounded JSON reader stops a stalled body at its timeout and releases the stream", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const requestBody = new ReadableStream({ pull() {} });
  const pending = readJsonRequest(new Request("https://hessara.test/api/models", { method: "POST", headers: { "content-type": "application/json" }, body: requestBody, duplex: "half" }));
  await Promise.resolve();
  t.mock.timers.tick(JSON_REQUEST_LIMITS.requestTimeoutMs);
  await assert.rejects(pending, error => error.status === 408);
});
