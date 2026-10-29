import { cookies } from "next/headers";
import { serverLocale } from "@/lib/server-locale";
import { signinExperienceCopy } from "@/lib/signin-experience-copy";
import { authConfigured, authenticatedUser, safeReturnPath } from "@/lib/auth";
import { loadSignInAvailability } from "@/lib/signin-config";
import { authMutationReadiness } from "@/lib/signin-readiness";
import { PASSWORD_SETUP_COOKIE, validPasswordSetup } from "@/lib/signin-security";
import { SignInForm } from "./signin-form";
import { AuthLayout } from "./auth-layout";
import "./signin.css";

export const dynamic = "force-dynamic";
export async function generateMetadata({ searchParams }: { searchParams: Promise<{ lang?: string; mode?: string }> }) {
  const query = await searchParams; const locale = await serverLocale(query.lang); const copy = signinExperienceCopy(locale);
  return { title: `${query.mode === "signup" ? copy.signUp : copy.signIn} — HESSARA` };
}
export default async function SignIn({ searchParams }: { searchParams: Promise<{ next?: string; error?: string; lang?: string; mode?: string }> }) {
  const query = await searchParams; const locale = await serverLocale(query.lang); const copy = signinExperienceCopy(locale);
  const [transportConfigured, user, availability, store] = await Promise.all([authConfigured(), authenticatedUser(), loadSignInAvailability(), cookies()]);
  const configured = transportConfigured && authMutationReadiness().configured;
  const passwordSetup = !!user && !user.is_anonymous && !!user.email_confirmed_at && validPasswordSetup(store.get(PASSWORD_SETUP_COOKIE)?.value, user.id, process.env.HESSARA_ENCRYPTION_KEY);
  return <AuthLayout locale={locale} backLabel={copy.back}>
    <SignInForm locale={locale} configured={configured} availability={availability}
      session={user ? user.is_anonymous ? "guest" : "account" : "none"} next={safeReturnPath(query.next)} expired={!!query.error} initialMode={query.mode === "signup" ? "signup" : "signin"} passwordSetup={passwordSetup} />
  </AuthLayout>;
}

