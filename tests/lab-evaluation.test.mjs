import test from "node:test";
import assert from "node:assert/strict";
import { evaluateLabTrial, normalizeLabReference, LAB_EVALUATION_VERSION, LAB_REVIEW_CRITERIA, createManualLabReview, labManualReviewSchema, labClaimReviewSchema, isLabEvidenceURL } from "../lib/lab-evaluation.ts";

const caseId = "example-case";
const trial = (output, changes = {}) => ({ id: "example-trial", task_id: caseId, status: "done", output, error: null, metadataData: {}, ...changes });
const evaluate = (output, checks = [], reference, changes) => evaluateLabTrial({ id: caseId, checks, reference }, trial(output, changes));
const check = (kind, value = "") => ({ kind, value });

test("only configured measured checks contribute; reference and unmeasured quality never become a quality score", () => {
  const result = evaluate("The answer is 42", [check("contains", "42"), check("excludes", "42"), check("exact", "The answer is 42")], "The answer is 42");
  assert.equal(result.version, LAB_EVALUATION_VERSION);
  assert.equal(result.provenance, "deterministic_user_checks");
  assert.equal(result.score, 66.67);
  assert.equal(result.scoreBasis, "passed_configured_checks_only");
  assert.deepEqual(result.coverage, { configured: 3, measured: 3, passed: 2, failed: 1, notMeasured: 0, fraction: 1 });
  assert.equal(result.reference.status, "passed");
  assert.equal(result.reference.includedInScore, false);
  assert.equal(result.reference.provenance, "user_supplied_unverified_reference");
  assert.deepEqual(result.unmeasuredQualityCriteria, LAB_REVIEW_CRITERIA);
  assert.equal(result.automatedFactVerification, false);
  assert.ok(result.warnings.includes("reference_not_verified"));
  assert.equal(evaluate("42", [], "42").score, null);
  assert.equal(evaluate("42", [], "99").score, null);
  assert.equal(evaluate("anything").coverage.fraction, null);
});

test("literal checks preserve case, spaces, Arabic marks and Unicode; no regular expression or code execution", () => {
  for (const [actual, expected] of [[" A ", "A"], ["Answer", "answer"], ["وُضوح", "وضوح"], ["e\u0301", "é"]]) {
    assert.equal(evaluate(actual, [check("exact", expected)]).criteria[0].status, "failed");
  }
  const payload = '<img src=x onerror="globalThis.injected=true">';
  const result = evaluate(payload, [check("exact", payload), check("contains", ".*"), check("excludes", "(a+)+$")]);
  assert.deepEqual(result.criteria.map(item => item.status), ["passed", "failed", "passed"]);
  assert.equal(result.criteria[0].evidence.excerpt, payload);
  assert.equal(globalThis.injected, undefined);
});

test("excerpts have exact UTF-16 offsets into untouched output, including distant matches", () => {
  const output = "🦀" + "before ".repeat(70) + "دليل واضح" + " after".repeat(80);
  const result = evaluate(output, [check("contains", "دليل واضح"), check("excludes", "دليل واضح")]);
  for (const item of result.criteria) {
    assert.equal(item.evidence.excerpt, output.slice(item.evidence.start, item.evidence.end));
    assert.equal(item.evidence.start, output.indexOf("دليل واضح"));
    assert.equal(item.evidence.clipped, true);
    assert.ok(item.evidence.excerpt.length <= 280);
  }
});

test("JSON checks parse the whole output, ignore the unused value and never treat syntax as factual truth", () => {
  for (const output of ['{"answer":false}', ' [1,2] \n', 'null', '42', '{"__proto__":{"polluted":true}}']) {
    const item = evaluate(output, [check("json", 'not a JSON reference')]).criteria[0];
    assert.equal(item.status, "passed", output);
    assert.equal(item.comparison, "whole_output_json_syntax");
    assert.equal(item.expected, null);
  }
  for (const output of ['```json\n{"a":1}\n```', '{"a":1} trailing', '', '{"a":}', 'undefined']) {
    assert.equal(evaluate(output, [check("json")]).criteria[0].status, "failed", output);
  }
  assert.equal({}.polluted, undefined);
});

test("invalid blank checks cannot pass vacuously and remain outside measured score with visible coverage", () => {
  const result = evaluate("answer", [check("contains", ""), check("excludes", " \n"), check("exact", "\t"), check("exact", "answer")]);
  assert.equal(result.score, 100);
  assert.deepEqual(result.coverage, { configured: 4, measured: 1, passed: 1, failed: 0, notMeasured: 3, fraction: 0.25 });
  assert.ok(result.warnings.includes("invalid_checks"));
  assert.equal(evaluate("", [check("contains", "")]).score, null);
  assert.equal(evaluate("", [check("contains", "answer")]).score, 0);
});

test("failed, missing, running or truncated attempts never receive scores even when the prefix matches", () => {
  for (const changes of [{ status: "error" }, { error: "timeout" }, { status: "running" }, { metadataData: { truncated: true } }, { metadataData: { finish_reason: "length" } }, { metadataData: { finish_reason: "max_tokens" } }, { metadataData: { finish_reason: "MAX_TOKENS" } }]) {
    const result = evaluate("correct", [check("exact", "correct")], "correct", changes);
    assert.equal(result.score, null);
    assert.equal(result.coverage.measured, 0);
    assert.equal(result.criteria[0].reason, "attempt_incomplete");
    assert.equal(result.reference.status, "not_measured");
    assert.equal(result.criteria[0].evidence, null);
    assert.ok(result.warnings.length > 0);
  }
  assert.ok(evaluate(null, [check("json")]).warnings.includes("output_missing"));
  assert.equal(evaluate(null, [check("json")]).score, null);
});

test("reference matching is separately normalized, reproducible, not semantic and refuses the wrong case", () => {
  const original = { id: caseId, checks: [], reference: "é\nline" };
  const inputTrial = trial(" e\u0301\r\nline\r\n");
  const before = JSON.stringify([original, inputTrial]);
  const result = evaluateLabTrial(original, inputTrial);
  assert.equal(result.reference.status, "passed");
  assert.equal(result.reference.normalization, "unicode_nfc_line_endings_outer_trim");
  assert.equal(result.reference.evidence.excerpt, inputTrial.output);
  assert.equal(normalizeLabReference(" a  b "), "a  b");
  assert.equal(evaluate("a b", [], "a  b").reference.status, "failed");
  assert.equal(evaluate("42", [], " \n").reference.reason, "no_reference");
  assert.deepEqual(evaluateLabTrial(original, inputTrial), result);
  assert.equal(JSON.stringify([original, inputTrial]), before);
  assert.throws(() => evaluateLabTrial(original, trial("42", { task_id: "someone-else" })), RangeError);
});

test("manual review is clearly attributed, bounded, independent and cannot accept spoofed automated provenance", () => {
  const input = { criteria: [{ criterion: "accuracy", rating: null, rationale: "I did not check the facts" }, { criterion: "relevance", rating: 4, rationale: "Addresses the requested topic", evidence: "The answer is 42" }], claims: [] };
  const result = createManualLabReview(input, "2026-10-09T12:00:00Z");
  assert.equal(result.provenance, "manual_user");
  assert.equal(result.automatedVerification, false);
  assert.equal(result.criteria[0].rating, null);
  assert.equal("score" in result, false);
  assert.throws(() => createManualLabReview({ ...input, provenance: "automatic" }, result.reviewedAt));
  assert.throws(() => createManualLabReview(input, "not a date"));
  assert.equal(labManualReviewSchema.safeParse({ criteria: [input.criteria[0], input.criteria[0]], claims: [] }).success, false);
  for (const rating of [0, 6, 2.5, NaN, Infinity]) assert.equal(labManualReviewSchema.safeParse({ criteria: [{ ...input.criteria[1], rating }], claims: [] }).success, false);
  assert.equal(labManualReviewSchema.safeParse({ criteria: [{ ...input.criteria[1], rationale: " " }], claims: [] }).success, false);
});

test("verified or contradicted manual claims require sources and quotes; status alone never becomes automatic verification", () => {
  for (const status of ["verified", "contradicted"]) {
    const claim = { claim: "The source gives the number 42", status, rationale: "Compared the quoted passage" };
    assert.equal(labClaimReviewSchema.safeParse(claim).success, false);
    assert.equal(labClaimReviewSchema.safeParse({ ...claim, sourceURL: "https://example.com/evidence" }).success, false);
    assert.equal(labClaimReviewSchema.safeParse({ ...claim, quote: "42" }).success, false);
    const result = createManualLabReview({ criteria: [], claims: [{ ...claim, sourceURL: "https://example.com/evidence", quote: "42" }] }, "2026-10-09T12:00:00Z");
    assert.equal(result.provenance, "manual_user");
    assert.equal(result.automatedVerification, false);
  }
  for (const status of ["unverified", "opinion"]) assert.equal(labClaimReviewSchema.safeParse({ claim: "An assertion", status, rationale: "Not an established fact" }).success, true);
});

test("evidence links reject executable schemes, credentials, local hostnames and IP literals without fetching URLs", () => {
  for (const url of ["javascript:alert(1)", "data:text/html,hello", "file:///etc/passwd", "https://user:password@example.com", "http://localhost", "https://test.localhost", "https://name.internal", "http://127.0.0.1", "http://2130706433", "http://0x7f000001", "http://10.0.0.1", "http://[::1]", "http://[::ffff:127.0.0.1]", "https://example.com\njavascript:evil", "https://server"]) {
    assert.equal(isLabEvidenceURL(url), false, url);
  }
  for (const url of ["https://www.nasa.gov/evidence#result", "http://example.com/source?a=1", "https://مثال.إختبار/مصدر"]) assert.equal(isLabEvidenceURL(url), true, url);
});
