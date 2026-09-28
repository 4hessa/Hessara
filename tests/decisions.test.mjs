import test from "node:test";
import assert from "node:assert/strict";
import {
  decisionOptions,
  layaEndpoint,
  parseDecision,
} from "../lib/decisions.ts";

test("decision routing only offers real benchmark categories", () => {
  assert.deepEqual(Object.keys(decisionOptions), [
    "coding",
    "logic",
    "analysis",
    "retrieval",
    "instruction",
    "long",
  ]);
  assert.deepEqual(
    parseDecision({
      model: "laya-multilingual",
      answers: {
        benchmark: {
          type: "choice",
          choice: "long",
          answer_confidence: 0.78,
        },
      },
    }),
    { category: "long", confidence: 0.78, model: "laya-multilingual" },
  );
  assert.equal(
    parseDecision({ answers: { benchmark: { choice: "not-a-category" } } }),
    null,
  );
});

test("Laya integration only accepts a secure, fixed-path public hostname", () => {
  assert.equal(
    layaEndpoint("https://models.example.org/v1/systemone"),
    "https://models.example.org/v1/systemone",
  );
  for (const unsafe of [
    "http://models.example.org/v1/systemone",
    "https://127.0.0.1/v1/systemone",
    "https://localhost/v1/systemone",
    "https://private.internal/v1/systemone",
    "https://user:secret@models.example.org/v1/systemone",
    "https://models.example.org:8443/v1/systemone",
    "https://models.example.org/v1/systemone?token=abc",
    "https://models.example.org/redirect",
    "https://hessara-eval.golden-lark-3350.chatgpt.site/v1/systemone",
  ]) {
    assert.equal(layaEndpoint(unsafe), null, unsafe);
  }
});
