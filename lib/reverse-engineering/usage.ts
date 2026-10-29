import { ReError, type AnalysisResult } from "./types.ts";

/** Missing measurements are unknown, never zero. Zero is valid only if measured. */
export function analysisUsage(metrics: AnalysisResult["metrics"]) {
  const events: Array<readonly [string, number, string]> = [["analysis", 1, "job"]];
  for (const [event, key, unit] of [["cpu", "cpuSeconds", "seconds"], ["duration", "durationMs", "milliseconds"]] as const) {
    const quantity = metrics?.[key];
    if (quantity === undefined) continue;
    if (typeof quantity !== "number" || !Number.isFinite(quantity) || quantity < 0) throw new ReError("INVALID_METRICS");
    events.push([event, quantity, unit]);
  }
  return events;
}
