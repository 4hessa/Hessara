import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { paperclipIssue } from "../lib/paperclip.ts";
test("catalog contains 30 distinct routable models and at least 300 distinct AI tools", () => {
  const models = JSON.parse(
    fs.readFileSync(
      new URL("../lib/catalog/models.json", import.meta.url),
      "utf8",
    ),
  );
  const tools = JSON.parse(
    fs.readFileSync(
      new URL("../lib/catalog/tools.json", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(models.length, 30);
  assert.equal(new Set(models.map((m) => m.id)).size, 30);
  assert.ok(tools.length >= 300);
  assert.equal(
    new Set(tools.map((t) => t.url.toLowerCase())).size,
    tools.length,
  );
  for (const m of models) {
    assert.equal(new URL(m.url).hostname, "openrouter.ai");
    assert.ok(m.context > 0);
    assert.ok(Number.isFinite(m.inputPrice) && m.inputPrice >= 0);
    assert.ok(Number.isFinite(m.outputPrice) && m.outputPrice >= 0);
  }
  for (const t of tools) {
    assert.equal(new URL(t.url).hostname, "github.com");
    assert.ok(t.summaryAr.length > 15);
    assert.ok(t.category);
    assert.equal(t.archived, false);
  }
});
test("Paperclip exports an unassigned backlog draft with metrics and without response bodies", () => {
  const run = {
    id: "run-1",
    name: "review",
    mode: "live",
    status: "completed",
    total: 1,
    config: JSON.stringify({
      suite_version: "hessara-core/1.1.0",
      modelSnapshots: [
        {
          id: "m",
          name: "Saved model",
          model: "original-model-id",
          provider: "openrouter",
        },
      ],
    }),
  };
  const trial = {
    id: "t",
    run_id: "run-1",
    model: "m",
    task_id: "logic-001",
    repeat: 0,
    status: "done",
    score: 1,
    output: "PRIVATE RESPONSE MUST NOT LEAVE",
    latency: 80,
    input_tokens: 20,
    output_tokens: 2,
    cost: 0.002,
    error: null,
  };
  const issue = paperclipIssue(run, [trial]);
  assert.equal(issue.status, "backlog");
  assert.equal(issue.assigneeAgentId, undefined);
  assert.ok(issue.description.includes("100.0%"));
  assert.ok(issue.description.includes("hessara-core/1.1.0"));
  assert.ok(!JSON.stringify(issue).includes(trial.output));
});

test("Paperclip review uses category macro scores and preserves unknown cost", () => {
  const run = {
    id: "run-2",
    name: "uneven coverage",
    mode: "live",
    status: "completed",
    total: 10,
    config: JSON.stringify({
      suite_version: "hessara-core/1.1.0",
      modelSnapshots: [{ id: "m", name: "Model M" }],
    }),
  };
  const rows = [
    {
      model: "m",
      task_id: "coding-001",
      status: "done",
      score: 1,
      latency: 10,
      cost: 0.1,
    },
    ...Array.from({ length: 9 }, (_, index) => ({
      model: "m",
      task_id: `logic-${String(index + 1).padStart(3, "0")}`,
      status: "done",
      score: 0,
      latency: 20 + index,
      cost: index === 0 ? null : 0.1,
    })),
  ];
  const issue = paperclipIssue(run, rows);
  assert.ok(issue.description.includes("| Model M | 50.0% |"));
  assert.ok(issue.description.includes("| 23 | 28 | 0 | unknown |"));
});
