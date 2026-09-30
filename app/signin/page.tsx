import { authConfigured, authenticatedUser, safeReturnPath } from "@/lib/auth";
import { SignInForm } from "./signin-form";
import "./signin.css";

export const dynamic = "force-dynamic";
export default async function SignIn({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const query = await searchParams;
  const configured = await authConfigured();
  const user = await authenticatedUser();
  return <main className="signin-page">
    <a className="wordmark" href="/" aria-label="Hessara"><img src="/hessara-mark.png" alt="" width="45" height="32" /><span lang="en" dir="ltr">Hessara</span></a>
    <section className="signin-panel" aria-labelledby="signin-title">
      <span className="overline">مساحتك للتجربة والمقارنة</span>
      <h1 id="signin-title">{user ? "مساحتك الخاصة" : "ابدأ باختيار أوضح"}</h1>
      <p>قارن النماذج، احفظ نتائجك، وارجع إلى تجاربك متى احتجت إليها.</p>
      <SignInForm configured={configured} guestEnabled={process.env.HESSARA_ALLOW_GUESTS === "true"} emailEnabled={process.env.HESSARA_EMAIL_AUTH_ENABLED === "true"}
        session={user ? user.is_anonymous ? "guest" : "account" : "none"} next={safeReturnPath(query.next)} expired={!!query.error} />
    </section>
    <a className="signin-back" href="/">العودة إلى المنصة</a>
  </main>;
}
