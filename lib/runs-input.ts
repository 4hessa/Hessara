export const RUN_INPUT_LIMITS = { requestBytes: 64 * 1024, timeoutMs: 10_000, models: 30, categories: 6 } as const;

export class RunInputError extends Error {
  readonly status: number;
  constructor(message = "INVALID_INPUT", status = 400) { super(message); this.status = status; }
}

/** Bound transport bytes before JSON or Zod allocates per-element validation issues. */
export async function readRunJson(request: Request): Promise<unknown> {
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") throw new RunInputError("INVALID_INPUT", 415);
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || !Number.isSafeInteger(Number(declared)) || Number(declared) > RUN_INPUT_LIMITS.requestBytes)) throw new RunInputError("INVALID_INPUT", 413);
  if (!request.body) throw new RunInputError();
  const reader = request.body.getReader(), chunks: Uint8Array[] = [];
  let bytes = 0;
  let rejectRead: (error: RunInputError) => void = () => {};
  const interrupted = new Promise<never>((_, reject) => { rejectRead = reject; });
  const cancel = () => { void reader.cancel().catch(() => {}); };
  const stop = (error: RunInputError) => { rejectRead(error); cancel(); };
  const abort = () => stop(new RunInputError("REQUEST_ABORTED", 499));
  const timer = setTimeout(() => stop(new RunInputError("REQUEST_TIMEOUT", 408)), RUN_INPUT_LIMITS.timeoutMs);
  request.signal.addEventListener("abort", abort, { once: true });
  try {
    if (request.signal.aborted) throw new RunInputError("REQUEST_ABORTED", 499);
    for (;;) {
      const next = await Promise.race([reader.read(), interrupted]);
      if (request.signal.aborted) throw new RunInputError("REQUEST_ABORTED", 499);
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > RUN_INPUT_LIMITS.requestBytes) throw new RunInputError("INVALID_INPUT", 413);
      chunks.push(next.value);
    }
  } catch (error) {
    cancel();
    if (error instanceof RunInputError) throw error;
    throw new RunInputError();
  } finally { clearTimeout(timer); request.signal.removeEventListener("abort", abort); reader.releaseLock(); }
  const content = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) { content.set(chunk, offset); offset += chunk.byteLength; }
  let value: unknown;
  try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(content)); }
  catch { throw new RunInputError(); }
  if (value && typeof value === "object") {
    const candidate = value as Record<string, unknown>;
    if ((Array.isArray(candidate.models) && candidate.models.length > RUN_INPUT_LIMITS.models)
      || (Array.isArray(candidate.categories) && candidate.categories.length > RUN_INPUT_LIMITS.categories)) throw new RunInputError();
  }
  return value;
}
