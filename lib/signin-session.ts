import type { CookieOptions } from "@supabase/ssr";

export const SESSION_PREFERENCE_COOKIE = "hessara_session_mode";
const persistentSeconds = 400 * 24 * 60 * 60;
type CookieWrite = { name: string; value: string; options: CookieOptions };

export function sessionPreference(value: string | undefined): boolean | undefined {
  return value === "session" ? false : value === "persistent" ? true : undefined;
}

export function sessionPreferenceCookie(remember: boolean, secure: boolean): CookieWrite {
  return { name: SESSION_PREFERENCE_COOKIE, value: remember ? "persistent" : "session", options: {
    httpOnly: true, secure, sameSite: "lax", path: "/", ...(remember ? { maxAge: persistentSeconds } : {}),
  } };
}

// Supabase SSR supplies its own persistent maxAge on every write, including
// refreshes. Strip it at the final adapter boundary for session-only sign-in.
// Keep explicit deletions intact and leave unrelated application cookies alone.
export function sessionCookieWrites(values: CookieWrite[], remember: boolean | undefined): CookieWrite[] {
  if (remember !== false) return values;
  return values.map(cookie => {
    if (!/^sb-.+-auth-token(?:-code-verifier)?(?:\.\d+)?$/.test(cookie.name) || cookie.value === "" || cookie.options.maxAge === 0) return cookie;
    const options = { ...cookie.options };
    delete options.maxAge; delete options.expires;
    return { ...cookie, options };
  });
}
