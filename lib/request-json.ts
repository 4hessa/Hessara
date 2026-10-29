/** Bounded JSON request reader shared by authenticated model connection endpoints. */
export const JSON_REQUEST_LIMITS = { requestBytes: 40_000, requestTimeoutMs: 10_000 } as const;

export class RequestJsonError extends Error {
  readonly status: number;

  constructor(code: string, status = 400) {
    super(code);
    this.name = "RequestJsonError";
    this.status = status;
  }
}

export async function readJsonRequest(request: Request): Promise<unknown> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json"))
    throw new RequestJsonError("INVALID_INPUT", 415);
  const size = request.headers.get("content-length");
  if (size && (!/^\d+$/.test(size) || +size > JSON_REQUEST_LIMITS.requestBytes))
    throw new RequestJsonError("INVALID_INPUT", 413);
  if (!request.body) throw new RequestJsonError("INVALID_INPUT");

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  let rejectRead: (error: RequestJsonError) => void = () => {};
  const stopped = new Promise<never>((_, reject) => { rejectRead = reject; });
  const stop = (error: RequestJsonError) => {
    rejectRead(error);
    // Do not await a caller-controlled stream cancellation callback.
    void reader.cancel().catch(() => {});
  };
  const abort = () => stop(new RequestJsonError("REQUEST_ABORTED", 499));
  const timer = setTimeout(() => stop(new RequestJsonError("REQUEST_TIMEOUT", 408)), JSON_REQUEST_LIMITS.requestTimeoutMs);
  request.signal.addEventListener("abort", abort, { once: true });
  try {
    if (request.signal.aborted) throw new RequestJsonError("REQUEST_ABORTED", 499);
    while (true) {
      const value = await Promise.race([reader.read(), stopped]);
      if (request.signal.aborted) throw new RequestJsonError("REQUEST_ABORTED", 499);
      if (value.done) break;
      bytes += value.value.byteLength;
      if (bytes > JSON_REQUEST_LIMITS.requestBytes) {
        void reader.cancel().catch(() => {});
        throw new RequestJsonError("INVALID_INPUT", 413);
      }
      chunks.push(value.value);
    }
  } finally {
    clearTimeout(timer);
    request.signal.removeEventListener("abort", abort);
    reader.releaseLock();
  }

  const content = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) { content.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(content)); }
  catch { throw new RequestJsonError("INVALID_INPUT"); }
}
