import { createHmac } from "node:crypto";
import { cookies } from "next/headers";
import { authClient, authConfigured, safeReturnPath } from "@/lib/auth";
import { database } from "@/lib/postgres-database";
import { trustedClientIp } from "@/lib/auth-transport";
import { loadSignInAvailability } from "@/lib/signin-config";
import { authMutationReadiness } from "@/lib/signin-readiness";
import { PASSWORD_RECOVERY_COOKIE, PASSWORD_RECOVERY_SECONDS, PASSWORD_SETUP_COOKIE, passwordRecoveryToken, passwordSetupToken, readAuthBody, validPasswordSetup } from "@/lib/signin-security";
import { SESSION_PREFERENCE_COOKIE, sessionPreferenceCookie } from "@/lib/signin-session";

export const runtime = "nodejs";
const reply = (data: object, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
const failure = (code: string, status = 503) => reply({ code, error: "تعذّر إكمال الطلب. يرجى المحاولة لاحقًا." }, status);

async function limit(request: Request, action: string) {
  const secret = process.env.HESSARA_ENCRYPTION_KEY;
  if (!secret) throw new Error("Auth limiter is not configured");
  // The same platform-verified IP is used by Supabase and our own hashed limiter.
  const ip = trustedClientIp(request.headers) ?? "local";
  const bucket = createHmac("sha256", secret).update(`${action}:${ip}`).digest("hex");
  const now = Date.now();
  const result = await database().prepare(
    "INSERT INTO auth_limits(bucket,expires_at,used) VALUES(?,?,1) ON CONFLICT(bucket) DO UPDATE SET expires_at=CASE WHEN auth_limits.expires_at<? THEN excluded.expires_at ELSE auth_limits.expires_at END,used=CASE WHEN auth_limits.expires_at<? THEN 1 ELSE auth_limits.used+1 END WHERE auth_limits.expires_at<? OR auth_limits.used<? RETURNING used"
  ).bind(bucket, now + 3600000, now, now, now, ["email", "signup", "recover"].includes(action) ? 3 : action === "set-password" ? 5 : 10).first();
  await database().prepare("DELETE FROM auth_limits WHERE expires_at<?").bind(now - 86400000).run();
  return !!result;
}

export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return failure("forbidden", 403);
  let value: Awaited<ReturnType<typeof readAuthBody>>;
  try { value = await readAuthBody(request); } catch { return failure("invalid", 400); }
  if (!await authConfigured(request.headers)) return failure("unavailable");
  try {
    const { action, next } = value;
    if (action !== "signout" && !authMutationReadiness().configured) return failure("unavailable");
    const remember = "remember" in value ? value.remember : undefined;
    const client = await authClient(remember);
    const store = await cookies();
    const savePreference = () => {
      if (remember === undefined) return;
      const cookie = sessionPreferenceCookie(remember, process.env.NODE_ENV === "production");
      store.set(cookie.name, cookie.value, cookie.options);
    };
    if (action === "signout") {
      const { error } = await client.auth.signOut({ scope: "local" });
      if (error) return failure("failed");
      store.delete(PASSWORD_SETUP_COOKIE);
      store.delete(PASSWORD_RECOVERY_COOKIE);
      store.delete(SESSION_PREFERENCE_COOKIE);
      return reply({ redirect: "/" });
    }
    const { data: current } = await client.auth.getUser();
    if (!await limit(request, action)) return failure("rateLimited", 429);
    const availability = await loadSignInAvailability();
    // Always finish on the current app origin so the PKCE cookie can be read.
    // This origin must also be in Supabase's explicit redirect allowlist.
    const origin = new URL(request.url).origin;
    const redirect = new URL("/auth/callback", origin);
    redirect.searchParams.set("next", safeReturnPath(next));
    if (action === "recover") {
      if (!availability.password) return failure("unavailable", 403);
      if (current.user?.is_anonymous) return failure("invalid", 403);
      // Recovery must not replace a different already-authenticated owner.
      if (current.user && current.user.email?.trim().toLowerCase() !== value.email.trim().toLowerCase()) return reply({ code: "recoverySent" });
      redirect.searchParams.set("intent", "recovery");
      const result = await client.auth.resetPasswordForEmail(value.email, { redirectTo: redirect.toString() });
      if (result.error && !["user_not_found", "email_not_found", "identity_not_found"].includes(result.error.code ?? "")) return failure("failed");
      store.set(PASSWORD_RECOVERY_COOKIE, passwordRecoveryToken(value.email, process.env.HESSARA_ENCRYPTION_KEY!), {
        httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: PASSWORD_RECOVERY_SECONDS,
      });
      return reply({ code: "recoverySent" });
    }
    if (action === "oauth") {
      if (!availability.providers[value.provider] || (current.user?.is_anonymous && !availability.linking)) return failure("unavailable", 403);
      if (current.user && !current.user.is_anonymous) return reply({ redirect: safeReturnPath(next) });
      const credentials = { provider: value.provider, options: { redirectTo: redirect.toString(), skipBrowserRedirect: true } };
      const result = current.user?.is_anonymous ? await client.auth.linkIdentity(credentials) : await client.auth.signInWithOAuth(credentials);
      if (result.error || !result.data.url) return failure("failed");
      const destination = new URL(result.data.url);
      const authOrigin = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).origin;
      const providerHosts: Record<typeof value.provider, string[]> = { google: ["accounts.google.com"] };
      if (destination.protocol !== "https:" || destination.username || destination.password || destination.port || !(destination.origin === authOrigin || providerHosts[value.provider].includes(destination.hostname))) return failure("failed");
      savePreference();
      return reply({ redirect: destination.toString() });
    }
    if (action === "signin") {
      if (!availability.password) return failure("unavailable", 403);
      const result = await client.auth.signInWithPassword({ email: value.email, password: value.password });
      if (result.error || !result.data.user) return failure("credentialsFailed", 401);
      store.delete(PASSWORD_SETUP_COOKIE);
      savePreference();
      return reply({ redirect: safeReturnPath(next) });
    }
    if (action === "set-password") {
      if (!current.user || current.user.is_anonymous || !current.user.email_confirmed_at || !validPasswordSetup(store.get(PASSWORD_SETUP_COOKIE)?.value, current.user.id, process.env.HESSARA_ENCRYPTION_KEY)) return failure("expired", 403);
      const result = await client.auth.updateUser({ password: value.password });
      if (result.error) return failure("failed");
      store.delete(PASSWORD_SETUP_COOKIE);
      return reply({ redirect: safeReturnPath(next) });
    }
    if (!availability.email) return failure("emailSetup", 403);
    if (action === "signup") {
      // A guest must verify an email identity before adding a password. Never
      // create a replacement owner or silently lose existing guest experiments.
      if (current.user?.is_anonymous) return failure("invalid", 400);
      if (current.user) return reply({ redirect: safeReturnPath(next) });
      const result = await client.auth.signUp({ email: value.email, password: value.password, options: { emailRedirectTo: redirect.toString() } });
      // Supabase may intentionally return an obscured user for an existing email.
      // The same generic confirmation is returned for both cases.
      if (result.error) {
        if (["user_already_exists", "email_exists", "identity_already_exists"].includes(result.error.code ?? "")) return reply({ code: "confirmation" });
        return failure("failed");
      }
      savePreference();
      if (result.data.session) return reply({ redirect: safeReturnPath(next) });
      return reply({ code: "confirmation" });
    }
    if (current.user?.is_anonymous && !availability.linking) return failure("unavailable", 403);
    const result = current.user?.is_anonymous
      ? await client.auth.updateUser({ email: value.email }, { emailRedirectTo: redirect.toString() })
      : await client.auth.signInWithOtp({ email: value.email, options: { emailRedirectTo: redirect.toString(), shouldCreateUser: false } });
    if (result.error) {
      return failure("failed");
    }
    if (current.user?.is_anonymous) {
      store.set(PASSWORD_SETUP_COOKIE, passwordSetupToken(current.user.id, process.env.HESSARA_ENCRYPTION_KEY!), { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 86400 });
    }
    return reply({ code: "confirmation", message: "راجع بريدك الإلكتروني لإكمال الدخول. احتفظ بهذه الصفحة مفتوحة." });
  } catch {
    return failure("failed");
  }
}

