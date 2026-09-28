import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {
  TASKS,
  CATEGORIES,
  getTask,
  grade,
  simulate,
  metrics,
  DEMO_MODELS,
} from "../lib/benchmarks.ts";

test("suite has 240 unique versioned cases and four variants per category", () => {
  assert.equal(TASKS.length, 240);
  assert.equal(new Set(TASKS.map((t) => t.id)).size, 240);
  assert.equal(new Set(TASKS.map((t) => t.prompt)).size, 240);
  for (const c of CATEGORIES) {
    const tasks = TASKS.filter((t) => t.category === c.id);
    assert.equal(tasks.length, 40);
    for (let i = 0; i < 4; i++)
      assert.equal(tasks.filter((t) => t.variant === i).length, 10);
  }
  for (const task of TASKS) {
    assert.equal(grade(task, task.expected), 1);
    assert.equal(grade(task, "wrong"), 0);
  }
  assert.throws(() => getTask("logic-000"));
  assert.throws(() => getTask("unknown-001"));
});
test("coding references match execution of trusted benchmark templates", () => {
  for (const t of TASKS.filter((t) => t.category === "coding")) {
    let value;
    vm.runInNewContext(
      t.prompt.split("\n").slice(1).join("\n"),
      { console: { log: (x) => (value = String(x)) } },
      { timeout: 1000 },
    );
    assert.equal(t.expected, value, t.id);
  }
});
test("strict graders reject decorations, extra keys and wrong value types", () => {
  const exact = getTask("logic-001");
  assert.equal(grade(exact, "  " + exact.expected + "\n"), 1);
  assert.equal(grade(exact, `Answer: ${exact.expected}`), 0);
  const json = getTask("instruction-002");
  assert.equal(grade(json, '{"count":3,"label":"item-4"}'), 1);
  assert.equal(grade(json, "```json\n" + json.expected + "\n```"), 0);
  assert.equal(grade(json, '{"count":"3","label":"item-4"}'), 0);
  assert.equal(grade(json, '{"count":3,"label":"item-4","extra":1}'), 0);
});
test("retrieval references exist exactly in supplied contexts", () => {
  for (const t of TASKS.filter((t) =>
    ["retrieval", "long"].includes(t.category),
  )) {
    const records = new Map(
      t.prompt
        .split("\n")
        .filter((line) => /^record-\d+:/.test(line))
        .map((line) => line.split(": ")),
    );
    if (t.variant === 1) {
      const value = t.prompt.match(/has the value (\d+)/)[1];
      assert.equal(records.get(t.expected), value);
    } else if (t.variant === 3) {
      const ids = [
        ...t.prompt.split("\n")[0].matchAll(/value of (record-\d+)/g),
      ].map((m) => m[1]);
      assert.deepEqual(JSON.parse(t.expected), {
        first: records.get(ids[0]),
        second: records.get(ids[1]),
      });
    } else {
      const target = t.prompt.match(/(?:value of|refers to) (record-\d+)/)[1];
      assert.equal(records.get(target), t.expected);
    }
  }
});
const base = {
  id: "a",
  run_id: "r",
  model: "sim-atlas",
  task_id: "logic-001",
  repeat: 0,
  status: "done",
  score: 1,
  output: "11",
  latency: 100,
  input_tokens: 10,
  output_tokens: 2,
  cost: 0,
  error: null,
};
test("metrics preserve missing usage and latency; one repeat has no stability", () => {
  const m = metrics(
    [
      {
        ...base,
        status: "error",
        score: 0,
        output: null,
        latency: null,
        input_tokens: null,
        output_tokens: null,
        cost: null,
      },
    ],
    DEMO_MODELS,
  )[0];
  assert.equal(m.p50, null);
  assert.equal(m.p95, null);
  assert.equal(m.tokens, null);
  assert.equal(m.cost, null);
  assert.equal(m.stability, null);
  assert.equal(m.score, 0);
  const mixed = metrics(
    [
      base,
      {
        ...base,
        id: "b",
        task_id: "logic-002",
        input_tokens: null,
        output_tokens: null,
      },
    ],
    DEMO_MODELS,
  )[0];
  assert.equal(mixed.tokens, null);
});
test("quality weights categories equally and counts errors as zero", () => {
  const m = metrics(
    [
      base,
      { ...base, id: "b", task_id: "logic-002" },
      { ...base, id: "c", task_id: "analysis-001", status: "error", score: 0 },
    ],
    DEMO_MODELS,
  )[0];
  assert.equal(m.score, 50);
  assert.equal(m.errors, 1);
  assert.equal(m.p50, 100);
});
test("demo is deterministic; full three-model three-repeat run has 2160 records", () => {
  const rows = DEMO_MODELS.flatMap((m) =>
    TASKS.flatMap((t) =>
      [0, 1, 2].map((r) => {
        const s = simulate(t, m.id, r);
        assert.deepEqual(s, simulate(t, m.id, r));
        return {
          ...base,
          ...s,
          id: `${m.id}/${t.id}/${r}`,
          model: m.id,
          task_id: t.id,
          repeat: r,
          score: grade(t, s.output),
        };
      }),
    ),
  );
  assert.equal(rows.length, 2160);
  const results = metrics(rows, DEMO_MODELS);
  assert.equal(results.length, 3);
  for (const m of results) {
    assert.equal(m.n, 720);
    assert.ok(m.score > 0 && m.score < 100);
    assert.ok(m.stability !== null);
    assert.equal(m.cost, 0);
  }
});
