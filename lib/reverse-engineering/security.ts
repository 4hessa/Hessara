import { timingSafeEqual } from "node:crypto";
import { ArtifactError } from "./content.ts";

export function isReverseAdmin(user: { app_metadata?: Record<string, unknown> } | null) {
  return user?.app_metadata?.role === "admin" || Array.isArray(user?.app_metadata?.roles) && user.app_metadata.roles.includes("admin");
}
export function requireWorker(request: Request, secret = process.env.HESSARA_RE_WORKER_TOKEN) {
  const authorization = request.headers.get("authorization") || "";
  if (!secret || secret.length < 32 || authorization.length > 4096) throw new ArtifactError("AUTH_REQUIRED", 401);
  const supplied = Buffer.from(authorization), expected = Buffer.from(`Bearer ${secret}`);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new ArtifactError("AUTH_REQUIRED", 401);
}
export async function readReJson(request: Request, max = 65536, timeoutMs = 10000): Promise<Record<string, unknown>> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new ArtifactError("INVALID_INPUT", 415);
  const headerSize = Number(request.headers.get("content-length") || 0);
  if (!Number.isSafeInteger(headerSize) || headerSize < 0 || headerSize > max) throw new ArtifactError("REQUEST_TOO_LARGE", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new ArtifactError("INVALID_INPUT");
  const chunks: Uint8Array[] = []; let size = 0;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let abortRead: () => void = () => {};
  const interrupted = new Promise<never>((_, reject) => {
    abortRead = () => reject(new ArtifactError("REQUEST_TIMEOUT", 408));
    timeout = setTimeout(abortRead, timeoutMs);
    request.signal.addEventListener("abort", abortRead, { once: true });
  });
  try {
    if (request.signal.aborted) throw new ArtifactError("REQUEST_TIMEOUT", 408);
    while (true) {
      const { done, value } = await Promise.race([reader.read(), interrupted]); if (done) break;
      size += value.byteLength; if (size > max) throw new ArtifactError("REQUEST_TOO_LARGE", 413);
      chunks.push(value);
    }
  } catch (error) { void reader.cancel().catch(() => {}); throw error; }
  finally { clearTimeout(timeout); request.signal.removeEventListener("abort", abortRead); reader.releaseLock(); }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!value || Array.isArray(value) || typeof value !== "object") throw new Error();
    return value;
  } catch { throw new ArtifactError("INVALID_INPUT"); }
}
export function pagination(params: URLSearchParams) {
  const limit = Number(params.get("limit") || 50), offset = Number(params.get("offset") || 0);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isSafeInteger(offset) || offset < 0 || offset > 100000) throw new ArtifactError("INVALID_INPUT");
  const search = (params.get("search") || "").trim();
  if (search.length > 200) throw new ArtifactError("INVALID_INPUT");
  return { limit, offset, search };
}
