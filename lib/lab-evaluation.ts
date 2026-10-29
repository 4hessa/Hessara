import { z } from "zod";
import type { LabCase, LabCheck, LabTrial } from "./custom-lab";

export const LAB_EVALUATION_VERSION = "hessara-lab-checks/1";
export const LAB_MANUAL_REVIEW_VERSION = "hessara-lab-manual/1";
export const LAB_REVIEW_CRITERIA = ["relevance", "instruction", "completeness", "visible_reasoning", "source_quality", "accuracy"] as const;
export type LabReviewCriterion = typeof LAB_REVIEW_CRITERIA[number];
export type LabCheckStatus = "passed" | "failed" | "not_measured";
export type LabEvaluationReason = "literal_found" | "literal_missing" | "excluded_absent" | "excluded_present" | "exact_match" | "exact_difference" | "valid_json" | "invalid_json" | "invalid_check" | "attempt_incomplete" | "no_reference" | "reference_match" | "reference_difference";
export type LabEvaluationWarning = "attempt_running" | "attempt_error" | "output_missing" | "output_truncated" | "no_configured_checks" | "invalid_checks" | "reference_not_verified";
export type LabOutputEvidence = {
  source: "output";
  /** Offsets are UTF-16 indices into the original response, never normalized text. */
  start: number; end: number; excerpt: string; clipped: boolean;
};
export type LabCheckResult = {
  id: string;
  kind: LabCheck["kind"];
  status: LabCheckStatus;
  reason: LabEvaluationReason;
  comparison: "literal_case_sensitive" | "whole_output_json_syntax";
  expected: string | null;
  evidence: LabOutputEvidence | null;
};
export type LabEvaluation = {
  version: typeof LAB_EVALUATION_VERSION;
  provenance: "deterministic_user_checks";
  caseId: string; trialId: string;
  criteria: LabCheckResult[];
  coverage: { configured: number; measured: number; passed: number; failed: number; notMeasured: number; fraction: number | null };
  /** Percentage of measured, equally weighted checks passed. Not a quality or accuracy score. */
  score: number | null;
  scoreBasis: "passed_configured_checks_only";
  scoreScale: { min: 0; max: 100 };
  reference: {
    status: LabCheckStatus; reason: LabEvaluationReason;
    normalization: "unicode_nfc_line_endings_outer_trim";
    provenance: "user_supplied_unverified_reference";
    includedInScore: false;
    evidence: LabOutputEvidence | null;
  };
  unmeasuredQualityCriteria: readonly LabReviewCriterion[];
  automatedFactVerification: false;
  warnings: LabEvaluationWarning[];
};

const EXCERPT_LIMIT = 280;
function evidence(output: string, at = 0, length = EXCERPT_LIMIT): LabOutputEvidence {
  const start = Math.max(0, Math.min(at, output.length));
  const end = Math.min(output.length, start + Math.min(length, EXCERPT_LIMIT));
  return { source: "output", start, end, excerpt: output.slice(start, end), clipped: start > 0 || end < output.length };
}
function firstDifference(left: string, right: string): number {
  let index = 0;
  while (index < left.length && index < right.length && left[index] === right[index]) index++;
  return index;
}
/** Only reference comparison normalizes; explicit text checks are always literal. */
export function normalizeLabReference(value: string): string {
  return value.normalize("NFC").replace(/\r\n?/g, "\n").trim();
}
function validCheck(check: LabCheck): boolean {
  return ["contains", "excludes", "exact", "json"].includes(check.kind) && typeof check.value === "string" && check.value.length <= 1000 && (check.kind === "json" || check.value.trim().length > 0);
}
function evaluateCheck(check: LabCheck, index: number, output: string | null): LabCheckResult {
  const base = {
    id: `check-${index + 1}`, kind: check.kind,
    comparison: check.kind === "json" ? "whole_output_json_syntax" as const : "literal_case_sensitive" as const,
    expected: check.kind === "json" ? null : check.value,
  };
  if (!validCheck(check)) return { ...base, status: "not_measured", reason: "invalid_check", evidence: null };
  if (output === null) return { ...base, status: "not_measured", reason: "attempt_incomplete", evidence: null };
  if (check.kind === "json") {
    // Parse the complete response, including rejecting Markdown fences and trailing prose.
    // The value field is unused: this checks syntax, not a schema or factual content.
    try {
      JSON.parse(output);
      return { ...base, status: "passed", reason: "valid_json", evidence: evidence(output) };
    } catch {
      return { ...base, status: "failed", reason: "invalid_json", evidence: evidence(output) };
    }
  }
  const found = output.indexOf(check.value);
  if (check.kind === "contains") return { ...base, status: found >= 0 ? "passed" : "failed", reason: found >= 0 ? "literal_found" : "literal_missing", evidence: evidence(output, Math.max(0, found), found >= 0 ? check.value.length : EXCERPT_LIMIT) };
  if (check.kind === "excludes") return { ...base, status: found < 0 ? "passed" : "failed", reason: found < 0 ? "excluded_absent" : "excluded_present", evidence: evidence(output, Math.max(0, found), found >= 0 ? check.value.length : EXCERPT_LIMIT) };
  const matches = output === check.value;
  return { ...base, status: matches ? "passed" : "failed", reason: matches ? "exact_match" : "exact_difference", evidence: evidence(output, matches ? 0 : Math.max(0, firstDifference(output, check.value) - 40)) };
}

type EvaluationTrial = Pick<LabTrial, "id" | "task_id" | "status" | "output" | "error" | "metadataData">;
/** Pure, reproducible evaluation. Never executes response text or accesses the network. */
export function evaluateLabTrial(testCase: Pick<LabCase, "id" | "checks" | "reference">, trial: EvaluationTrial): LabEvaluation {
  if (trial.task_id !== testCase.id) throw new RangeError("Evaluation case does not match trial");
  const warnings: LabEvaluationWarning[] = [];
  if (trial.status === "running") warnings.push("attempt_running");
  if (trial.status === "error" || trial.error) warnings.push("attempt_error");
  if (typeof trial.output !== "string") warnings.push("output_missing");
  const finishReason = trial.metadataData?.finish_reason;
  const truncated = trial.metadataData?.truncated === true || ["length", "max_tokens", "MAX_TOKENS"].includes(typeof finishReason === "string" ? finishReason : "");
  if (truncated) warnings.push("output_truncated");
  // Even an apparently correct prefix must not receive a score when the attempt failed.
  const output = trial.status === "done" && !trial.error && !truncated && typeof trial.output === "string" ? trial.output : null;
  const criteria = (testCase.checks ?? []).map((check, index) => evaluateCheck(check, index, output));
  if (!criteria.length) warnings.push("no_configured_checks");
  if (criteria.some(check => check.reason === "invalid_check")) warnings.push("invalid_checks");
  const passed = criteria.filter(check => check.status === "passed").length;
  const failed = criteria.filter(check => check.status === "failed").length;
  const measured = passed + failed;
  const referenceText = typeof testCase.reference === "string" && testCase.reference.trim() ? testCase.reference : null;
  if (referenceText !== null) warnings.push("reference_not_verified");
  const referenceMatch = referenceText !== null && output !== null && normalizeLabReference(output) === normalizeLabReference(referenceText);
  return {
    version: LAB_EVALUATION_VERSION, provenance: "deterministic_user_checks", caseId: testCase.id, trialId: trial.id,
    criteria,
    coverage: { configured: criteria.length, measured, passed, failed, notMeasured: criteria.length - measured, fraction: criteria.length ? measured / criteria.length : null },
    score: measured ? Math.round(passed / measured * 10000) / 100 : null,
    scoreBasis: "passed_configured_checks_only", scoreScale: { min: 0, max: 100 },
    reference: {
      status: referenceText === null || output === null ? "not_measured" : referenceMatch ? "passed" : "failed",
      reason: referenceText === null ? "no_reference" : output === null ? "attempt_incomplete" : referenceMatch ? "reference_match" : "reference_difference",
      normalization: "unicode_nfc_line_endings_outer_trim", provenance: "user_supplied_unverified_reference", includedInScore: false,
      evidence: referenceText !== null && output !== null ? evidence(output) : null,
    },
    unmeasuredQualityCriteria: [...LAB_REVIEW_CRITERIA], automatedFactVerification: false, warnings,
  };
}

/** Syntax-only link gate. URLs are not fetched; DNS/public reachability is not verified. */
export function isLabEvidenceURL(value: string): boolean {
  if (value.length > 2048 || /[\u0000-\u0020\u007f]/.test(value)) return false;
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return false;
    // Citations use public DNS names; exclude IP literals and local-only hostnames.
    // This is deliberately not an SSRF defence for a future fetcher.
    if (!hostname.includes(".") || hostname.includes(":") || /^\d+(\.\d+){3}$/.test(hostname)) return false;
    if (/(^|\.)(localhost|local|internal|invalid|test)$/.test(hostname)) return false;
    return true;
  } catch { return false; }
}
const rationaleSchema = z.string().trim().min(1).max(2000);
const criterionReviewSchema = z.object({
  criterion: z.enum(LAB_REVIEW_CRITERIA),
  rating: z.number().int().min(1).max(5).nullable(),
  rationale: rationaleSchema,
  evidence: z.string().max(2000).optional(),
}).strict();
export const labClaimReviewSchema = z.object({
  claim: z.string().trim().min(1).max(2000),
  status: z.enum(["verified", "contradicted", "unverified", "opinion"]),
  rationale: rationaleSchema,
  sourceURL: z.string().trim().refine(isLabEvidenceURL, "A public HTTP(S) source URL is required").optional(),
  sourceTitle: z.string().trim().min(1).max(240).optional(),
  quote: z.string().trim().min(1).max(4000).optional(),
}).strict().superRefine((claim, context) => {
  if (claim.status === "verified" || claim.status === "contradicted") {
    if (!claim.sourceURL) context.addIssue({ code: z.ZodIssueCode.custom, path: ["sourceURL"], message: "A source is required for this claim status" });
    if (!claim.quote) context.addIssue({ code: z.ZodIssueCode.custom, path: ["quote"], message: "An exact source quote is required for this claim status" });
  }
});
export const labManualReviewSchema = z.object({
  criteria: z.array(criterionReviewSchema).max(LAB_REVIEW_CRITERIA.length),
  claims: z.array(labClaimReviewSchema).max(20),
  notes: z.string().max(4000).optional(),
}).strict().superRefine((review, context) => {
  if (new Set(review.criteria.map(item => item.criterion)).size !== review.criteria.length)
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["criteria"], message: "Duplicate review criterion" });
});
export type LabManualReviewInput = z.infer<typeof labManualReviewSchema>;
export type LabManualReview = LabManualReviewInput & {
  version: typeof LAB_MANUAL_REVIEW_VERSION;
  provenance: "manual_user";
  automatedVerification: false;
  reviewedAt: string;
  ratingScale: { min: 1; max: 5; unmeasured: null };
};
/** The caller must supply server time and enforce ownership; identity is never accepted from input. */
export function createManualLabReview(input: unknown, reviewedAt: string): LabManualReview {
  const parsed = labManualReviewSchema.parse(input);
  const timestamp = z.string().datetime({ offset: true }).parse(reviewedAt);
  return { ...parsed, version: LAB_MANUAL_REVIEW_VERSION, provenance: "manual_user", automatedVerification: false, reviewedAt: timestamp, ratingScale: { min: 1, max: 5, unmeasured: null } };
}
