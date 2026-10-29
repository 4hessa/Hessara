export const REQUEST_BODY_TIMEOUT_MS = 10_000;

/** Request receive deadlines must never shorten provider response/inference budgets. */
export function requestBodyDeadline(
  message: Request | Response,
  reader: ReadableStreamDefaultReader<Uint8Array>,
  failure: (reason: "timeout" | "aborted") => Error,
) {
  if (!(message instanceof Request)) return { read: () => reader.read(), dispose() {} };
  let stoppedError: Error | undefined;
  let rejectRead: (error: Error) => void = () => {};
  const stopped = new Promise<never>((_, reject) => { rejectRead = reject; });
  // Disposal or validation may happen before a caller starts another read.
  void stopped.catch(() => {});
  const stop = (reason: "timeout" | "aborted") => {
    if (stoppedError) return;
    stoppedError = failure(reason); rejectRead(stoppedError);
    void reader.cancel().catch(() => {});
  };
  const abort = () => stop("aborted");
  const timer = setTimeout(() => stop("timeout"), REQUEST_BODY_TIMEOUT_MS);
  message.signal.addEventListener("abort", abort, { once: true });
  return {
    async read() {
      if (message.signal.aborted) stop("aborted");
      if (stoppedError) throw stoppedError;
      const part = await Promise.race([reader.read(), stopped]);
      if (message.signal.aborted) stop("aborted");
      if (stoppedError) throw stoppedError;
      return part;
    },
    dispose() { clearTimeout(timer); message.signal.removeEventListener("abort", abort); },
  };
}
