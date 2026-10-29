import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { analyzeTask, createCatalogSnapshot, recommendModels, compareModels, ADVISOR_POLICY_VERSION } from "../lib/advisor.ts";

const base = { name: "Example", publisher: "Provider", context: 32000, inputPrice: 2, outputPrice: 4, inputModalities: ["text"], tools: false, reasoning: false, checkedAt: "2026-10-01", source: "https://openrouter.ai/api/v1/models", url: "https://openrouter.ai/provider/example" };
const row = (id, changes = {}) => ({ ...base, id, ...changes });
const now = "2026-10-08T00:00:00Z";
const intent = (changes = {}) => analyzeTask("", { task: "general", ...changes }).intent;

test("clear budget and speed requirements are suggested, and explicit review always wins", () => {
  assert.equal(analyzeTask("أحتاج مساعدة في الدراسة وفهم ملاحظاتي الجامعية بشرح بسيط وميزانية محدودة").intent.priority, "cost");
  assert.equal(analyzeTask("Help me understand my university notes with a limited budget").intent.priority, "cost");
  assert.equal(analyzeTask("I need a fast response").intent.priority, "speed");
  assert.equal(analyzeTask("long documents", { priority: "balanced" }).intent.priority, "balanced");
  assert.equal(analyzeTask("limited budget", { priority: "context" }).intent.priority, "context");
});

test("conflicting and negated priority hints remain neutral", () => {
  for (const text of ["limited budget and fast response", "I do not need a fast response", "لا أحتاج استجابة سريعة", "I do not have a limited budget"]) {
    assert.equal(analyzeTask(text).intent.priority, "balanced", text);
  }
});

test("priority hints cover all thirteen interface languages", () => {
  for (const text of ["ميزانية محدودة", "limited budget", "budget limité", "presupuesto limitado", "预算有限", "예산이 제한", "محدود بجٹ", "بودجه محدود", "orçamento limitado", "budget limitato", "ограниченный бюджет", "begrenztes Budget", "beperkt budget"]) {
    assert.equal(analyzeTask(text).intent.priority, "cost", text);
  }
});

test("catalogue snapshot is detached, deeply frozen, dated, reproducible and provider-attributed", () => {
  const input = [row("b"), row("a")];
  const snapshot = createCatalogSnapshot(input);
  const reordered = createCatalogSnapshot([...input].reverse());
  assert.equal(snapshot.id, reordered.id);
  assert.equal(snapshot.models[0].evidence.context.sourceKind, "access_provider");
  assert.equal(snapshot.models[0].evidence.context.observedAt, "2026-10-01");
  assert.equal(snapshot.models[0].measurements.quality, null);
  assert.equal(snapshot.models[0].measurements.speedMs, null);
  input[0].context = 1;
  assert.equal(snapshot.models[1].context, 32000);
  assert.throws(() => snapshot.models[0].inputModalities.push("image"), TypeError);
  assert.notEqual(snapshot.id, createCatalogSnapshot(input).id);
  assert.throws(() => createCatalogSnapshot([row("a"), row("a")]));
});

test("unknown, invalid and untraceable fields never become zero price or supported capability", () => {
  const snapshot = createCatalogSnapshot([
    row("unknown", { inputPrice: null, outputPrice: NaN, tools: null, context: -1 }),
    row("unsafe", { source: "javascript:alert(1)" }),
    row("undated", { checkedAt: "2026-02-31" }),
    row("known", { inputPrice: 0, outputPrice: 0, tools: true }),
  ]);
  const model = snapshot.models.find((model) => model.id === "unknown");
  assert.equal(model.inputPrice, null);
  assert.equal(model.outputPrice, null);
  assert.equal(model.context, null);
  assert.equal(model.tools, null);
  assert.deepEqual(recommendModels(intent({ toolUse: true }), snapshot, { now }).candidates.map((c) => c.model.id), ["known"]);
  const cost = recommendModels(intent({ priority: "cost" }), snapshot, { now });
  assert.equal(cost.candidates[0].model.id, "known");
  assert.equal(cost.candidates[0].model.inputPrice, 0);
  assert.ok(cost.candidates[1].limitations.includes("price_unknown"));
});

test("requirements are conjunctive; absent documented modalities and context do not pass", () => {
  const snapshot = createCatalogSnapshot([
    row("good", { inputModalities: ["text", "image", "file"], tools: true, context: 100000 }),
    row("no-file", { inputModalities: ["text", "image"], tools: true, context: 100000 }),
    row("small", { inputModalities: ["text", "image", "file"], tools: true, context: 1000 }),
    row("unknown", { inputModalities: null }),
  ]);
  const result = recommendModels(intent({ imageInput: true, fileInput: true, toolUse: true, minContext: 50000 }), snapshot, { now });
  assert.deepEqual(result.candidates.map((c) => c.model.id), ["good"]);
  assert.equal(result.excludedCount, 3);
  assert.ok(result.notices.includes("app_text_only"));
  assert.ok(result.candidates[0].limitations.includes("connector_text_only"));
  assert.ok(result.candidates[0].reasons.includes("context_requirement"));
  const none = recommendModels(intent({ minContext: 100001 }), snapshot, { now });
  assert.equal(none.candidates.length, 0);
  assert.ok(none.notices.includes("no_match"));
});

test("task and priority alter documented fit without inventing quality or latency", () => {
  const snapshot = createCatalogSnapshot([
    row("a-cheap", { inputPrice: 0.1, outputPrice: 0.2 }),
    row("b-context", { context: 1000000, inputPrice: 10, outputPrice: 20 }),
    row("c-tools", { tools: true, reasoning: true }),
  ]);
  const general = recommendModels(intent(), snapshot, { now });
  const code = recommendModels(intent({ task: "coding" }), snapshot, { now });
  assert.equal(general.candidates[0].model.id, "a-cheap");
  assert.equal(code.candidates[0].model.id, "c-tools");
  assert.ok(code.candidates[0].limitations.includes("reasoning_not_quality"));
  assert.ok(code.candidates[0].limitations.includes("tools_not_search"));
  assert.equal(recommendModels(intent({ priority: "cost" }), snapshot, { now }).candidates[0].model.id, "a-cheap");
  assert.equal(recommendModels(intent({ priority: "context" }), snapshot, { now }).candidates[0].model.id, "b-context");
  const speed = recommendModels(intent({ priority: "speed" }), snapshot, { now });
  assert.deepEqual(speed.candidates.map((c) => c.model.id), general.candidates.map((c) => c.model.id));
  assert.ok(speed.notices.includes("speed_not_ranked"));
  assert.ok(general.candidates.every((c) => c.tied));
  assert.ok(general.candidates.every((c) => c.limitations.includes("quality_unmeasured")));
});

test("evidence identifiers resolve to the same immutable snapshot and stale sources lower coverage", () => {
  const snapshot = createCatalogSnapshot([row("fresh"), row("old", { checkedAt: "2026-01-01" })]);
  const result = recommendModels(intent({ priority: "cost", minContext: 10 }), snapshot, { now });
  assert.equal(result.policyVersion, ADVISOR_POLICY_VERSION);
  assert.equal(result.snapshotId, snapshot.id);
  for (const candidate of result.candidates) {
    const ids = Object.values(candidate.model.evidence).map((field) => field.id);
    assert.ok(candidate.evidenceIds.every((id) => ids.includes(id)));
  }
  assert.equal(result.candidates.find((c) => c.model.id === "fresh").evidenceStrength, "moderate");
  assert.equal(result.candidates.find((c) => c.model.id === "old").evidenceStrength, "limited");
  assert.ok(result.candidates.find((c) => c.model.id === "old").limitations.includes("stale_snapshot"));
});

test("guided recognition works across UI languages while explicit controls override hints", () => {
  for (const text of ["أحتاج شرحًا لدراستي في الجامعة", "I need university study help", "aide pour étudier", "estudiar en la universidad", "大学学习", "대학교 공부", "تعلیم حاصل کرنا", "تحصیل در دانشگاه", "estudar na universidade", "studio all'università", "учеба в университете", "lernen im Studium", "studeren aan de universiteit"]) {
    assert.equal(analyzeTask(text).intent.task, "study", text);
  }
  const explicit = analyzeTask("images code reasoning", { task: "writing", audience: "technical", priority: "cost", imageInput: false, toolUse: false });
  assert.equal(explicit.intent.task, "writing");
  assert.equal(explicit.intent.imageInput, false);
  assert.equal(explicit.intent.toolUse, false);
  assert.equal(explicit.needsClarification, false);
  assert.equal(analyzeTask("help me").needsClarification, true);
  assert.equal(analyzeTask("code research").needsClarification, true);
  assert.equal(analyzeTask("x".repeat(9000)).intent.text.length, 4000);
  assert.equal(analyzeTask("", { minContext: Infinity }).intent.minContext, 0);
});

test("comparison refuses invalid IDs, duplicates and silent fallback, preserves ordering", () => {
  const snapshot = createCatalogSnapshot([row("a"), row("b"), row("c"), row("d"), row("e")]);
  assert.deepEqual(compareModels(["c", "a"], snapshot).map((m) => m.id), ["c", "a"]);
  for (const invalid of [["a"], ["a", "a"], ["a", "missing"], ["a", "b", "c", "d", "e"]]) assert.throws(() => compareModels(invalid, snapshot));
  assert.equal(recommendModels(intent(), snapshot, { limit: 999, now }).candidates.length, 4);
  assert.equal(recommendModels(intent(), snapshot, { limit: -10, now }).candidates.length, 3);
});

test("production catalogue retains dated evidence and no invented HESSARA evaluation", () => {
  const data = JSON.parse(fs.readFileSync(new URL("../lib/catalog/models.json", import.meta.url), "utf8"));
  const snapshot = createCatalogSnapshot(data);
  const result = recommendModels(intent({ task: "research" }), snapshot, { now });
  assert.equal(snapshot.models.length, data.length);
  assert.equal(result.candidates.length, 3);
  for (const model of snapshot.models) {
    assert.equal(model.checkedAt, data.find((item) => item.id === model.id).checkedAt);
    assert.equal(model.measurements.quality, null);
    assert.equal(model.evidence.tools.sourceUrl, "https://openrouter.ai/api/v1/models");
  }
});
