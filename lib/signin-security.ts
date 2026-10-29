import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export const PASSWORD_SETUP_COOKIE = "hessara_password_setup";
export const PASSWORD_RECOVERY_COOKIE = "hessara_password_recovery";
export const PASSWORD_RECOVERY_SECONDS = 15 * 60;
const returnPath = z.string().max(1000).optional();
const email = z.string().trim().email().max(254);
export const newPassword = z.string().min(12).max(128).refine(value => value.trim().length >= 12);
export const authInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("signout"), next: returnPath }).strict(),
  z.object({ action: z.literal("email"), email, next: returnPath }).strict(),
  z.object({ action: z.literal("signup"), email, password: newPassword, next: returnPath, remember: z.boolean().optional() }).strict(),
  z.object({ action: z.literal("signin"), email, password: z.string().min(1).max(128), next: returnPath, remember: z.boolean().optional() }).strict(),
  z.object({ action: z.literal("recover"), email, next: returnPath }).strict(),
  z.object({ action: z.literal("set-password"), password: newPassword, next: returnPath }).strict(),
  z.object({ action: z.literal("oauth"), provider: z.literal("google"), next: returnPath, remember: z.boolean().optional() }).strict(),
]);

export async function readAuthBody(request: Request) {
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") throw new Error("INVALID");
  const length = request.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > 4096)) throw new Error("INVALID");
  if (!request.body) throw new Error("INVALID");
  const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  let rejectRead: (error: Error) => void = () => {};
  const stopped = new Promise<never>((_, reject) => { rejectRead = reject; });
  const stop = () => {
    rejectRead(new Error("INVALID"));
    void reader.cancel().catch(() => {});
  };
  const timer = setTimeout(stop, 10000);
  request.signal.addEventListener("abort", stop, { once: true });
  try {
    if (request.signal.aborted) throw new Error("INVALID");
    for (;;) {
      const item = await Promise.race([reader.read(), stopped]);
      if (request.signal.aborted) throw new Error("INVALID");
      if (item.done) break;
      size += item.value.byteLength;
      if (size > 4096) throw new Error("INVALID");
      chunks.push(item.value);
    }
    return authInput.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))));
  } finally {
    clearTimeout(timer); request.signal.removeEventListener("abort", stop);
    // The source's cancel callback cannot extend the bounded request lifetime.
    void reader.cancel().catch(() => {}); reader.releaseLock();
  }
}

// This HttpOnly owner-bound token authorizes a verified guest conversion or a
// verified recovery callback. It never contains or persists a user's password.
export function passwordSetupToken(userId: string, secret: string, now = Date.now(), lifetime = 86400000) {
  const payload = Buffer.from(JSON.stringify({ userId, expires: now + Math.min(86400000, lifetime), nonce: randomUUID() })).toString("base64url");
  return `${payload}.${createHmac("sha256", secret).update(payload).digest("base64url")}`;
}

function recoveryEmailHash(email: string, secret: string) {
  return createHmac("sha256", secret).update(`password-recovery-email:${email.trim().toLowerCase()}`).digest("base64url");
}
export function passwordRecoveryToken(email: string, secret: string, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ purpose: "password-recovery", emailHash: recoveryEmailHash(email, secret), expires: now + PASSWORD_RECOVERY_SECONDS * 1000, nonce: randomUUID() })).toString("base64url");
  return `${payload}.${createHmac("sha256", secret).update(payload).digest("base64url")}`;
}
export function readPasswordRecovery(token: string | undefined, secret: string | undefined, now = Date.now()): { emailHash: string } | null {
  if (!token || token.length > 700 || !secret) return null;
  try {
    const [payload, signature, extra] = token.split(".");
    if (extra || !payload || !signature) return null;
    const expected = createHmac("sha256", secret).update(payload).digest(), supplied = Buffer.from(signature, "base64url");
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;
    const value = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (value.purpose !== "password-recovery" || typeof value.emailHash !== "string" || !/^[\w-]{43}$/.test(value.emailHash) || !Number.isSafeInteger(value.expires) || value.expires <= now || value.expires > now + PASSWORD_RECOVERY_SECONDS * 1000) return null;
    return { emailHash: value.emailHash };
  } catch { return null; }
}
export function validPasswordRecovery(token: string | undefined, email: string | undefined, secret: string | undefined, now = Date.now()) {
  const value = readPasswordRecovery(token, secret, now);
  if (!value || !email || !secret) return false;
  const expected = Buffer.from(recoveryEmailHash(email, secret)), supplied = Buffer.from(value.emailHash);
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}
export function validPasswordSetup(token: string | undefined, userId: string, secret: string | undefined, now = Date.now()) {
  if (!token || token.length > 500 || !secret) return false;
  try {
    const [payload, signature, extra] = token.split("."); if (extra || !payload || !signature) return false;
    const expected = createHmac("sha256", secret).update(payload).digest(); const supplied = Buffer.from(signature, "base64url");
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return false;
    const value = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return value.userId === userId && Number.isSafeInteger(value.expires) && value.expires > now && value.expires <= now + 86400000;
  } catch { return false; }
}
