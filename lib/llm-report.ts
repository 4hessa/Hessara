import type { DemonstrationResult } from "./llm-demonstration";

/** One stable format for the native download and the accessible in-page alternative. */
export const TEACHING_REPORT_FILENAME = "hessara-teaching-model.json";
export function serializeTeachingReport(data: DemonstrationResult, contextWindow: number, sourceTruncated: boolean): string {
  return JSON.stringify({
    format: "hessara-teaching-transformer/1",
    provenance: "Local deterministic teaching arithmetic. Not a provider tokenizer, learned weights or inference telemetry.",
    contextWindow,
    sourceTruncated,
    data,
  }, null, 2);
}
