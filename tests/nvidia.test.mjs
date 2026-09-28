import test from "node:test";
import assert from "node:assert/strict";
import {
  invokeNvidia,
  NVIDIA_MODELS,
  NVIDIA_ENDPOINT,
  NVIDIA_POLICY,
} from "../lib/nvidia.ts";

const model = { model: NVIDIA_MODELS[2].id, inputPrice: 0, outputPrice: 0 };
test("NVIDIA uses the fixed endpoint, final answer and recorded inference policy", async () => {
  const response = await invokeNvidia(
    "test prompt",
    model,
    "test-only-key",
    async (url, options) => {
      assert.equal(url, NVIDIA_ENDPOINT);
      assert.equal(options.headers.Authorization, "Bearer test-only-key");
      assert.equal(options.redirect, "error");
      const body = JSON.parse(options.body);
      assert.equal(body.reasoning_effort, "low");
      assert.equal(body.max_tokens, NVIDIA_POLICY.max_output_tokens);
      assert.equal(body.stream, false);
      return Response.json({
        id: "request-123",
        model: model.model,
        choices: [
          {
            message: { content: "42", reasoning_content: "private reasoning" },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 12, completion_tokens: 4 },
      });
    },
  );
  assert.equal(response.output, "42");
  assert.equal(response.cost, 0);
  assert.equal(response.error, null);
  assert.equal(JSON.parse(response.metadata).request_id, "request-123");
  assert.ok(!JSON.stringify(response).includes("test-only-key"));
  assert.ok(!JSON.stringify(response).includes("private reasoning"));
});
test("pending, quota and incomplete NVIDIA responses cannot become successful trials", async () => {
  for (const [status, payload, expected] of [
    [202, { requestId: "pending-123" }, "provider_pending"],
    [429, { error: "Rate limit" }, "provider_http_429"],
    [401, { error: "Invalid key" }, "provider_http_401"],
    [
      200,
      { choices: [{ message: { content: "42" }, finish_reason: "length" }] },
      "incomplete_response",
    ],
    [
      200,
      { choices: [{ message: { content: "" }, finish_reason: "stop" }] },
      "empty_response",
    ],
  ]) {
    let calls = 0;
    const result = await invokeNvidia(
      "test",
      model,
      "test-only-key",
      async () => {
        calls++;
        return Response.json(payload, { status });
      },
    );
    assert.equal(result.error, expected);
    assert.equal(
      calls,
      1,
      "Uncertain requests are never retried automatically",
    );
  }
});
test("missing and invalid usage stay unknown, and transport failures propagate", async () => {
  const result = await invokeNvidia("test", model, "test-only-key", async () =>
    Response.json({
      choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
      usage: { prompt_tokens: -1, completion_tokens: "5" },
    }),
  );
  assert.equal(result.input_tokens, null);
  assert.equal(result.output_tokens, null);
  assert.equal(result.cost, null);
  await assert.rejects(
    invokeNvidia("test", model, "test-only-key", async () => {
      throw new DOMException("Timed out", "TimeoutError");
    }),
    { name: "TimeoutError" },
  );
});
