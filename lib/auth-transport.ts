import { isIP } from "node:net";
import { createServerClient, type CookieMethodsServer } from "@supabase/ssr";

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
  if (!url || !publicKey) return null;
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

// Imported only by server entry points. Node's IP validator also prevents a browser bundle.
// Do not expose the privileged Supabase client, Data API, or admin methods to callers.
export function createAuthTransport(headers: RequestHeaders, cookies: CookieMethodsServer, env: Environment = process.env) {
  const options = authTransportOptions(headers, env);
  if (!options) throw new Error("Authentication transport is not configured");
  const client = createServerClient(options.url, options.key, {
    global: { headers: options.headers },
    cookieOptions: { httpOnly: true, sameSite: "lax", secure: env.NODE_ENV === "production", path: "/" },
    cookies,
  });
  return { auth: {
    getUser: client.auth.getUser.bind(client.auth),
    getClaims: client.auth.getClaims.bind(client.auth),
    signInAnonymously: client.auth.signInAnonymously.bind(client.auth),
    signInWithOtp: client.auth.signInWithOtp.bind(client.auth),
    updateUser: client.auth.updateUser.bind(client.auth),
    exchangeCodeForSession: client.auth.exchangeCodeForSession.bind(client.auth),
    signOut: client.auth.signOut.bind(client.auth),
  } };
}
