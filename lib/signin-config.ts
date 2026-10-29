export const SIGNIN_PROVIDERS = ["google"] as const;
export type SignInProvider = typeof SIGNIN_PROVIDERS[number];
export type SignInAvailability = {
  email: boolean; password: boolean; linking: boolean;
  providers: Record<SignInProvider, boolean>;
};
type Environment = Record<string, string | undefined>;
export function signInAvailability(settings: unknown, env: Environment = process.env): SignInAvailability {
  const object = settings && typeof settings === "object" ? settings as Record<string, unknown> : {};
  const external = object.external && typeof object.external === "object" ? object.external as Record<string, unknown> : {};
  const email = external.email === true;
  return {
    email: email && object.disable_signup !== true && env.HESSARA_EMAIL_AUTH_ENABLED === "true",
    password: email && env.HESSARA_PASSWORD_AUTH_ENABLED === "true",
    linking: env.HESSARA_AUTH_MANUAL_LINKING === "true",
    providers: Object.fromEntries(SIGNIN_PROVIDERS.map(provider => [provider, external[provider] === true])) as Record<SignInProvider, boolean>,
  };
}

// Read only public feature booleans. No admin token, provider secret, or user data.
// Fail closed for password/OAuth whenever Supabase's current settings cannot be verified.
export async function loadSignInAvailability(env: Environment = process.env, fetcher: typeof fetch = fetch): Promise<SignInAvailability> {
  let settings: unknown = null;
  try {
    const endpoint = new URL(env.NEXT_PUBLIC_SUPABASE_URL ?? "");
    const key = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    // The isolated local Supabase stack is opt-in for explicit development/test.
    // Never expand this to private networks or infer it from a missing NODE_ENV.
    const local = (env.NODE_ENV === "development" || env.NODE_ENV === "test") && ["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname);
    const hosted = endpoint.protocol === "https:" && endpoint.hostname.endsWith(".supabase.co") && !endpoint.port;
    if ((!hosted && !(local && ["http:", "https:"].includes(endpoint.protocol))) || endpoint.username || endpoint.password || endpoint.pathname !== "/" || endpoint.search || endpoint.hash || !key?.trim()) throw new Error("Unavailable");
    endpoint.pathname = "/auth/v1/settings"; endpoint.search = ""; endpoint.hash = "";
    const controller = new AbortController();
    let rejectProbe: (error: Error) => void = () => {};
    const stopped = new Promise<never>((_, reject) => { rejectProbe = reject; });
    const timer = setTimeout(() => { rejectProbe(new Error("Unavailable")); controller.abort(); }, 5000);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const fetching = fetcher(endpoint, { headers: { apikey: key }, cache: "no-store", redirect: "error", signal: controller.signal });
      // A transport that settles after our deadline must not leave a body open.
      void fetching.then(late => { if (controller.signal.aborted) void late.body?.cancel().catch(() => {}); }).catch(() => {});
      const response = await Promise.race([fetching, stopped]);
      if (!response.ok || !response.body) { void response.body?.cancel().catch(() => {}); throw new Error("Unavailable"); }
      reader = response.body.getReader();
      let size = 0; const chunks: Uint8Array[] = [];
      for (;;) {
        const { done, value } = await Promise.race([reader.read(), stopped]);
        if (controller.signal.aborted) throw new Error("Unavailable");
        if (done) break;
        size += value.byteLength; if (size > 16384) throw new Error("Unavailable"); chunks.push(value);
      }
      settings = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
    } finally {
      clearTimeout(timer);
      if (reader) { void reader.cancel().catch(() => {}); reader.releaseLock(); }
      controller.abort();
    }
  } catch { /* Current provider availability remains disabled. */ }
  return signInAvailability(settings, env);
}

