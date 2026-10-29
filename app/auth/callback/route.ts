import { NextResponse } from "next/server";
import { authClient, safeReturnPath } from "@/lib/auth";
import { cookies } from "next/headers";
import type { CookieOptions } from "@supabase/ssr";
import { PASSWORD_RECOVERY_COOKIE, PASSWORD_RECOVERY_SECONDS, PASSWORD_SETUP_COOKIE, passwordSetupToken, readPasswordRecovery, validPasswordRecovery, validPasswordSetup } from "@/lib/signin-security";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
function redirectTo(url: URL) {
  const response = NextResponse.redirect(url);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const recovery = url.searchParams.get("intent") === "recovery";
  if (code && code.length <= 2048 && !url.searchParams.has("error")) {
    try {
      const store = await cookies();
      const recoveryToken = store.get(PASSWORD_RECOVERY_COOKIE)?.value;
      if (recovery && !readPasswordRecovery(recoveryToken, process.env.HESSARA_ENCRYPTION_KEY)) throw new Error("INVALID_RECOVERY");
      // Recovery exchanges are staged: a wrong-account code cannot replace the
      // browser's current owner or session before the verified email matches.
      const pending = new Map<string, { name: string; value: string; options: CookieOptions }>();
      const staged = recovery ? new Map(store.getAll().map(cookie => [cookie.name, cookie.value])) : null;
      const client = await authClient(undefined, staged ? {
        getAll: () => [...staged].map(([name, value]) => ({ name, value })),
        setAll: values => { for (const cookie of values) { staged.set(cookie.name, cookie.value); pending.set(cookie.name, cookie); } },
      } : undefined);
      let priorOwner: string | undefined;
      if (recovery) {
        const { data } = await client.auth.getUser();
        if (data.user?.is_anonymous || (data.user && !validPasswordRecovery(recoveryToken, data.user.email, process.env.HESSARA_ENCRYPTION_KEY))) throw new Error("RECOVERY_OWNER_MISMATCH");
        priorOwner = data.user?.id;
      }
      const { error } = await client.auth.exchangeCodeForSession(code);
      if (!error) {
        const { data } = await client.auth.getUser();
        if (recovery) {
          if (!data.user || data.user.is_anonymous || !data.user.email_confirmed_at || (priorOwner && priorOwner !== data.user.id) || !validPasswordRecovery(recoveryToken, data.user.email, process.env.HESSARA_ENCRYPTION_KEY)) throw new Error("INVALID_RECOVERY_OWNER");
          for (const cookie of pending.values()) store.set(cookie.name, cookie.value, cookie.options);
          store.delete(PASSWORD_RECOVERY_COOKIE);
          store.set(PASSWORD_SETUP_COOKIE, passwordSetupToken(data.user.id, process.env.HESSARA_ENCRYPTION_KEY!, Date.now(), PASSWORD_RECOVERY_SECONDS * 1000), {
            httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: PASSWORD_RECOVERY_SECONDS,
          });
          const setup = new URL("/signin", url.origin);
          setup.searchParams.set("next", safeReturnPath(url.searchParams.get("next")));
          return redirectTo(setup);
        }
        if (data.user && !data.user.is_anonymous && data.user.email_confirmed_at && validPasswordSetup(store.get(PASSWORD_SETUP_COOKIE)?.value, data.user.id, process.env.HESSARA_ENCRYPTION_KEY)) {
          const setup = new URL("/signin", url.origin);
          setup.searchParams.set("next", safeReturnPath(url.searchParams.get("next")));
          return redirectTo(setup);
        }
        return redirectTo(new URL(safeReturnPath(url.searchParams.get("next")), url.origin));
      }
    } catch { /* Recovery authorization fails closed without committing staged cookies. */ }
  }
  const failed = new URL("/signin", url.origin);
  failed.searchParams.set("error", "expired");
  failed.searchParams.set("next", safeReturnPath(url.searchParams.get("next")));
  return redirectTo(failed);
}
