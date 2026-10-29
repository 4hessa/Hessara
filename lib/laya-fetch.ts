import dns from "node:dns/promises";
import https from "node:https";
import { isIP, type LookupFunction } from "node:net";
import type { IncomingMessage } from "node:http";
import { layaEndpoint } from "./decisions.ts";

const MAX_RESPONSE_BYTES = 128_000;
const MAX_REQUEST_BYTES = 32_000;
const DEADLINE_MS = 20_000;

export class LayaTransportError extends Error {
  readonly code: "PROVIDER_UNAVAILABLE" | "PROVIDER_RESPONSE";
  constructor(code: "PROVIDER_UNAVAILABLE" | "PROVIDER_RESPONSE" = "PROVIDER_UNAVAILABLE") {
    super(code);
    this.code = code;
  }
}

/** Deliberately IPv4-only. Reject the IANA special-purpose ranges as a whole,
 * including their few publicly routed exceptions, plus Azure's platform VIP.
 * IPv6-only servers are unsupported; no alternate address family is attempted. */
export function isPublicLayaIPv4(address: string): boolean {
  if (isIP(address) !== 4) return false;
  const [a, b, c] = address.split(".").map(Number);
  return !(
    a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)) ||
      (b === 31 && c === 196) || (b === 52 && c === 193) ||
      (b === 88 && c === 99) || (b === 175 && c === 48))) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113) || address === "168.63.129.16"
  );
}

function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new LayaTransportError());
    if (signal.aborted) { abort(); return; }
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, () => reject(new LayaTransportError())).finally(() => signal.removeEventListener("abort", abort));
  });
}

/** POST only to the fixed Laya API path. DNS is validated once and the chosen
 * address is pinned into this request's fresh TLS connection. Native HTTPS does
 * not follow redirects or use fetch's global dispatcher/proxy connection pool. */
export async function fetchLayaDecision(endpoint: string, body: string, apiKey?: string): Promise<Response> {
  const safeEndpoint = layaEndpoint(endpoint);
  if (!safeEndpoint || Buffer.byteLength(body, "utf8") > MAX_REQUEST_BYTES) throw new LayaTransportError();
  const url = new URL(safeEndpoint);
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), DEADLINE_MS);
  try {
    const addresses = await untilAborted(dns.lookup(url.hostname, { family: 4, all: true, verbatim: true }), controller.signal);
    if (controller.signal.aborted || !addresses.length || addresses.length > 64 ||
      addresses.some(entry => entry.family !== 4 || !isPublicLayaIPv4(entry.address))) throw new LayaTransportError();
    const address = addresses[0].address;
    const pinnedLookup: LookupFunction = (hostname, options, callback) => {
      if (hostname !== url.hostname || controller.signal.aborted) {
        callback(new LayaTransportError(), "", 4);
      } else if (options.all) {
        callback(null, [{ address, family: 4 }]);
      } else callback(null, address, 4);
    };
    return await new Promise<Response>((resolve, reject) => {
      let settled = false;
      let incoming: IncomingMessage | undefined;
      const requestOptions: https.RequestOptions & { autoSelectFamily: false } = {
        method: "POST", family: 4, autoSelectFamily: false,
        lookup: pinnedLookup, agent: false, servername: url.hostname,
        rejectUnauthorized: true, maxHeaderSize: 16_384,
        signal: controller.signal,
        headers: {
          "content-type": "application/json", "accept": "application/json",
          "accept-encoding": "identity", "content-length": Buffer.byteLength(body, "utf8"),
          ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
        },
      };
      const request = https.request(url, requestOptions);
      const abort = () => fail(new LayaTransportError());
      function fail(error: LayaTransportError) {
        if (settled) return;
        settled = true;
        controller.signal.removeEventListener("abort", abort);
        incoming?.destroy(); request.destroy(); reject(error);
      }
      controller.signal.addEventListener("abort", abort, { once: true });
      request.on("error", () => fail(new LayaTransportError()));
      request.on("response", response => {
        incoming = response;
        response.on("error", () => fail(new LayaTransportError()));
        response.on("aborted", () => fail(new LayaTransportError()));
        const status = response.statusCode ?? 0;
        const encoding = response.headers["content-encoding"];
        const declaredLength = response.headers["content-length"];
        if (status < 200 || status >= 600 || (status >= 300 && status < 400) ||
          (encoding && encoding !== "identity") ||
          (declaredLength && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > MAX_RESPONSE_BYTES))) {
          fail(new LayaTransportError("PROVIDER_RESPONSE")); return;
        }
        let size = 0;
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => {
          if (settled) return;
          size += chunk.length;
          if (size > MAX_RESPONSE_BYTES) { fail(new LayaTransportError("PROVIDER_RESPONSE")); return; }
          chunks.push(chunk);
        });
        response.on("end", () => {
          if (settled) return;
          if (!response.complete) { fail(new LayaTransportError()); return; }
          settled = true;
          controller.signal.removeEventListener("abort", abort);
          // Error bodies are discarded; upstream diagnostics never reach users.
          const payload = status >= 200 && status < 300 ? Buffer.concat(chunks) : null;
          resolve(new Response(status === 204 || status === 205 ? null : payload, { status, headers: { "content-type": "application/json" } }));
        });
        response.on("close", () => { if (!response.complete) fail(new LayaTransportError()); });
      });
      request.end(body);
    });
  } catch (error) {
    throw error instanceof LayaTransportError ? error : new LayaTransportError();
  } finally { clearTimeout(deadline); }
}
