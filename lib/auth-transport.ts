import { isIP } from "node:net";
import { createServerClient, type CookieMethodsServer } from "@supabase/ssr";
import { SESSION_PREFERENCE_COOKIE, sessionCookieWrites, sessionPreference } from "./signin-session.ts";

type Environment = Record<string, string | undefined>;
type RequestHeaders = Pick<Headers, "get">;

// Only Vercel's own header is trusted. Other hosts need an explicit trust model.
export function trustedClientIp(headers: RequestHeaders, env: Environment = process.env) {
  if (env.VERCEL !== "1") return null;
  const ip = headers.get("x-vercel-forwarded-for")?.trim();
  return ip && isIP(ip) ? ip : null;
}

export function authTransportOptions(headers: RequestHeaders, env: Environment = process.env) {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const publicKey = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publicKey?.trim()) return null;
  try {
    const endpoint = new URL(url);
    const local = env.NODE_ENV !== "production" && ["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname);
    if ((endpoint.protocol !== "https:" && !(local && endpoint.protocol === "http:")) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname !== "/") return null;
  } catch { return null; }
  if (env.VERCEL !== "1") return { url, key: publicKey, headers: {} as Record<string, string> };

  const secret = env.SUPABASE_AUTH_SECRET_KEY;
  const ip = trustedClientIp(headers, env);
  // Set the flag only after enabling security_sb_forwarded_for_enabled in Supabase.
  if (env.HESSARA_AUTH_IP_FORWARDING !== "true" || !secret?.startsWith("sb_secret_") || secret.length <= 10 || !ip) return null;
  return { url, key: secret, headers: { "sb-forwarded-for": ip } };
}

export function authTransportConfigured(headers: RequestHeaders, env: Environment = process.env) {
  return authTransportOptions(headers, env) !== null;
}

// One deadline per request-scoped client also bounds consecutive token/user calls.
// Keep the caller's cancellation signal and refuse redirects carrying auth headers.
export function authRequestFetch(fetcher: typeof fetch = fetch, deadline: AbortSignal = AbortSignal.timeout(12000)): typeof fetch {
  return (input, init) => {
    const signals = [deadline];
    if (input instanceof Request) signals.push(input.signal);
    if (init?.signal) signals.push(init.signal);
    return fetcher(input, { ...init, signal: AbortSignal.any(signals), redirect: "error" });
  };
}

// Imported only by server entry points. Node's IP validator also prevents a browser bundle.
// Do not expose the privileged Supabase client, Data API, or admin methods to callers.
export function createAuthTransport(headers: RequestHeaders, cookies: CookieMethodsServer, env: Environment = process.env, remember?: boolean) {
  const options = authTransportOptions(headers, env);
  if (!options) throw new Error("Authentication transport is not configured");
  const client = createServerClient(options.url, options.key, {
    global: { headers: options.headers, fetch: authRequestFetch() },
    cookieOptions: { httpOnly: true, sameSite: "lax", secure: env.NODE_ENV === "production", path: "/" },
    cookies: { ...cookies, setAll: cookies.setAll ? async (values, responseHeaders) => {
      const selected = remember ?? sessionPreference((await cookies.getAll())?.find(cookie => cookie.name === SESSION_PREFERENCE_COOKIE)?.value);
      await cookies.setAll!(sessionCookieWrites(values, selected), responseHeaders);
    } : undefined },
  });
  return { auth: {
    getUser: client.auth.getUser.bind(client.auth),
    getClaims: client.auth.getClaims.bind(client.auth),
    signInAnonymously: client.auth.signInAnonymously.bind(client.auth),
    signInWithOtp: client.auth.signInWithOtp.bind(client.auth),
    resetPasswordForEmail: client.auth.resetPasswordForEmail.bind(client.auth),
    signUp: client.auth.signUp.bind(client.auth),
    signInWithPassword: client.auth.signInWithPassword.bind(client.auth),
    signInWithOAuth: client.auth.signInWithOAuth.bind(client.auth),
    linkIdentity: client.auth.linkIdentity.bind(client.auth),
    updateUser: client.auth.updateUser.bind(client.auth),
    exchangeCodeForSession: client.auth.exchangeCodeForSession.bind(client.auth),
    signOut: client.auth.signOut.bind(client.auth),
  } };
}

