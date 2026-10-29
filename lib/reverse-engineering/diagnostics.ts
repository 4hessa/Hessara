import { ReError } from "./types.ts";

export type RePhase = "request" | "authentication" | "rate-limit" | "overview.summary" | "overview.recent-jobs" | "engines.discovery" | "settings.read";
class ReOperationError extends Error {
  readonly phase: RePhase;
  constructor(phase: RePhase, cause: unknown) { super("Reverse engineering operation failed", { cause }); this.phase = phase; }
}
export async function rePhase<T>(phase: RePhase, work: () => Promise<T>): Promise<T> {
  try { return await work(); } catch (error) {
    if (error instanceof ReError || error instanceof ReOperationError) throw error;
    throw new ReOperationError(phase, error);
  }
}
/** Do not log message/query/parameters, stack, URLs, request bodies or credentials. */
export function reDiagnostics(error: unknown, fallback: RePhase = "request") {
  let phase = fallback, code: string | null = null;
  const transportCodes = new Set(["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "CONNECT_TIMEOUT", "CONNECTION_CLOSED"]);
  for (let current = error, depth = 0; current && typeof current === "object" && depth < 5; depth++) {
    if (current instanceof ReOperationError) phase = current.phase;
    const item = current as { code?: unknown; cause?: unknown };
    if (typeof item.code === "string" && (/^[0-9A-Z]{5}$/.test(item.code) || transportCodes.has(item.code))) code ??= item.code;
    current = item.cause;
  }
  return { phase, code, category: code ? transportCodes.has(code) ? "connection" : "database" : "unexpected" };
}
