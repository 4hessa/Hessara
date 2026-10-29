import { artifactFormats, engineIds, ReError, type AnalysisOptions, type AnalysisResult, type EvidenceKind, type Pagination } from "./types.ts";
export function text(value: unknown, max = 120, allowEmpty = false) { if (typeof value !== "string" || (!allowEmpty && !value.trim()) || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw new ReError("INVALID_INPUT"); return value.trim(); }
export function identifier(value: unknown) { const id = text(value, 160); if (!/^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/.test(id)) throw new ReError("INVALID_ID"); return id; }
export function pagination(value: Pagination = {}) { return { limit: Math.min(100, Math.max(1, Math.floor(Number(value.limit) || 30))), offset: Math.min(100000, Math.max(0, Math.floor(Number(value.offset) || 0))), search: typeof value.search === "string" ? value.search.slice(0, 160) : "" }; }
export function validateOptions(value: unknown): AnalysisOptions {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ReError("INVALID_OPTIONS");
  const input = value as Record<string, unknown>; const output: AnalysisOptions = {};
  for (const key of Object.keys(input)) if (!["decompile", "strings", "symbols", "symbolicExecution", "maxPaths", "maxSteps", "timeoutSeconds"].includes(key)) throw new ReError("UNSUPPORTED_OPTION");
  for (const key of ["decompile", "strings", "symbols", "symbolicExecution"] as const) if (input[key] !== undefined) { if (typeof input[key] !== "boolean") throw new ReError("INVALID_OPTIONS"); output[key] = input[key]; }
  for (const [key, maximum] of [["maxPaths", 8], ["maxSteps", 50], ["timeoutSeconds", 300]] as const) if (input[key] !== undefined) { const number = input[key]; if (typeof number !== "number" || !Number.isInteger(number) || number < 1 || number > maximum) throw new ReError("INVALID_OPTIONS"); output[key] = number; }
  return output;
}
export function validateFormat(value: unknown) { if (!artifactFormats.includes(value as never)) throw new ReError("UNSUPPORTED_FORMAT"); return value as typeof artifactFormats[number]; }
export function validateEngine(value: unknown) { if (!engineIds.includes(value as never)) throw new ReError("UNKNOWN_ENGINE"); return value as typeof engineIds[number]; }
export function json(value: unknown, maxBytes = 65536) { const data = JSON.stringify(value ?? {}); if (Buffer.byteLength(data) > maxBytes) throw new ReError("RESULT_TOO_LARGE", 413); return data; }
export function validateResult(result: AnalysisResult) {
  if (!result || typeof result !== "object") throw new ReError("INVALID_RESULT");
  validateEngine(result.engineId); text(result.engineVersion, 100); text(result.summary, 16000, true);
  for (const key of ["findings", "evidence", "functions", "strings", "dependencies", "files", "limitations"] as const) if (result[key] !== undefined && (!Array.isArray(result[key]) || result[key]!.length > 1000)) throw new ReError("RESULT_TOO_LARGE", 413);
  json(result, 2 * 1024 * 1024);
  const kinds: EvidenceKind[] = ["finding", "code", "function", "symbol", "string", "dependency", "metadata", "log", "path"];
  for (const evidence of result.evidence ?? []) { if (!kinds.includes(evidence.kind)) throw new ReError("INVALID_EVIDENCE"); text(evidence.name, 300); if (evidence.id) identifier(evidence.id); if (evidence.content !== undefined) { text(evidence.content, 65536, true); if (Buffer.byteLength(evidence.content) > 65536) throw new ReError("RESULT_TOO_LARGE", 413); } }
  for (const finding of result.findings ?? []) { text(finding.title, 500); text(finding.description, 16000, true); if (finding.id) identifier(finding.id); if (finding.severity && !["info", "low", "medium", "high", "critical"].includes(finding.severity)) throw new ReError("INVALID_FINDING"); if (finding.confidence && !["confirmed", "inference", "unknown"].includes(finding.confidence)) throw new ReError("INVALID_FINDING"); if (finding.evidenceIds !== undefined && (!Array.isArray(finding.evidenceIds) || finding.evidenceIds.length > 1000 || finding.evidenceIds.some(id => typeof id !== "string" || id.length > 160))) throw new ReError("INVALID_EVIDENCE_REFERENCE"); }
  for (const file of result.files ?? []) if (typeof file.content !== "string" || Buffer.byteLength(file.content) > 65536) throw new ReError("RESULT_TOO_LARGE", 413);
  return result;
}
