"use client";
import { useEffect, useRef, useState } from "react";
import { Eye, EyeOff, ArrowRight, Mail, LockKeyhole } from "lucide-react";
import Link from "next/link";
import { BrandLockup } from "../brand-mark";
import { isRTL, LANGUAGES, LOCALE_COOKIE, LOCALE_KEY, type Locale } from "@/lib/i18n";
import { signinExperienceCopy, signInNotice, type SignInNotice } from "@/lib/signin-experience-copy";
import { signinLayoutCopy } from "@/lib/signin-layout-copy";
import { type SignInAvailability, type SignInProvider } from "@/lib/signin-config";
import { ThinkingOrb } from "../thinking-orb";
import { legalCopy } from "@/lib/legal-copy";


type Action = "signup" | "signin" | "email" | "oauth" | "signout" | "set-password" | "recover";
type Notice = SignInNotice | "recoverySent";
function GoogleIcon() { return <svg width="19" height="19" viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285f4" d="M21.6 12.2c0-.7-.1-1.4-.2-2.1H12v4h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.4Z"/><path fill="#34a853" d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2.1 1-3.4 1-2.6 0-4.8-1.8-5.6-4.2H3.1v2.6A10 10 0 0 0 12 22Z"/><path fill="#fbbc05" d="M6.4 13.9a6 6 0 0 1 0-3.8V7.5H3.1a10 10 0 0 0 0 9l3.3-2.6Z"/><path fill="#ea4335" d="M12 5.9c1.5 0 2.8.5 3.8 1.5l2.8-2.8A9.5 9.5 0 0 0 12 2a10 10 0 0 0-8.9 5.5l3.3 2.6C7.2 7.7 9.4 5.9 12 5.9Z"/></svg>; }
export function SignInForm({ locale, configured, availability, session, next, expired, initialMode = "signin", passwordSetup = false }: {
  locale: Locale; configured: boolean; availability: SignInAvailability;
  session: "guest" | "account" | "none"; next: string; expired: boolean;
  initialMode?: "signin" | "signup"; passwordSetup?: boolean;
}) {
  const c = signinExperienceCopy(locale), layout = signinLayoutCopy(locale);
  const [mode, setMode] = useState(initialMode);
  const [recovering, setRecovering] = useState(false);
  const [remember, setRemember] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(expired ? "expired" : null);
  const requestController = useRef<AbortController | null>(null);
  useEffect(() => { document.documentElement.lang = locale; document.documentElement.dir = isRTL(locale) ? "rtl" : "ltr"; }, [locale]);
  useEffect(() => () => { requestController.current?.abort(); requestController.current = null; }, []);
  const signup = mode === "signup" && !recovering;
  const convertingGuest = signup && session === "guest" && !passwordSetup;
  const emailAvailable = configured && (passwordSetup || (signup ? availability.email && (session !== "guest" || availability.linking) : availability.password));
  const accountComplete = session === "account" && !passwordSetup;
  const googleReady = configured && availability.providers.google && (session !== "guest" || availability.linking);
  const googleVisible = !passwordSetup && !recovering && googleReady;
  const heading = passwordSetup ? c.setPassword : recovering ? layout.resetTitle : signup ? c.signUp : c.signIn;
  const credentialsInvalid = notice === "credentialsFailed" || notice === "invalid";

  async function submit(action: Action, provider?: SignInProvider) {
    if (busy) return;
    if ((action === "signup" || action === "set-password") && password !== confirmation) { setNotice("mismatch"); return; }
    setBusy(true); setNotice(null);
    const controller = new AbortController(); requestController.current = controller;
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch("/api/auth", { method: "POST", headers: { "content-type": "application/json" }, signal: controller.signal, body: JSON.stringify({
        action, next, ...(["signup","signin","email","recover"].includes(action) ? { email } : {}), ...(["signup","signin","set-password"].includes(action) ? { password } : {}), ...(provider ? { provider } : {}), ...(["signin","signup","oauth"].includes(action) ? { remember } : {}),
      }) });
      const result = await response.json() as { code?: unknown; redirect?: string };
      if (!response.ok) { setNotice(signInNotice(result.code)); return; }
      if (result.redirect) { window.location.assign(result.redirect); return; }
      setPassword(""); setConfirmation(""); setNotice(result.code === "recoverySent" ? "recoverySent" : signInNotice(result.code));
    } catch { if (requestController.current === controller) setNotice("failed"); }
    finally { clearTimeout(timeout); if (requestController.current === controller) { requestController.current = null; setBusy(false); } }
  }
  function changeMode(value: "signin" | "signup", recovery = false) { setMode(value); setRecovering(recovery); setNotice(null); setPassword(""); setConfirmation(""); setVisible(false); }
  function changeLanguage(value: string) {
    const selected = LANGUAGES.find(([code]) => code === value)?.[0]; if (!selected) return;
    try { localStorage.setItem(LOCALE_KEY, selected); } catch {}
    document.cookie = `${LOCALE_COOKIE}=${selected}; path=/; max-age=31536000; SameSite=Lax`;
    const target = new URL(window.location.href); target.searchParams.set("lang", selected); target.searchParams.set("mode", mode); window.location.assign(target.toString());
  }
  return <>
    <div className="signin-language"><label htmlFor="signin-language">{c.language}</label><select id="signin-language" value={locale} onChange={event => changeLanguage(event.target.value)} disabled={busy}>{LANGUAGES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}</select></div>
      <div className="signin-content">
        <header className="signin-identity">
          <Link className="signin-brand" href="/" aria-label="HESSARA"><BrandLockup tone="inverse" markClassName="signin-new-emblem" /></Link>
          <h1 id="signin-title" className="signin-title">{heading}</h1>
        </header>
        {accountComplete ? <div className="signin-options"><p role="status">{c.sessionAccount}</p><a className="signin-submit" href={next}>{c.back}<ArrowRight size={17} aria-hidden="true" /></a><button className="signin-text-button" onClick={() => void submit("signout")} disabled={busy}>{c.signOut}</button></div> : <div className="signin-options" aria-busy={busy}>
          {session === "guest" && <p className="signin-session">{c.sessionGuest}</p>}
          <form onSubmit={event => { event.preventDefault(); void submit(passwordSetup ? "set-password" : recovering ? "recover" : convertingGuest ? "email" : signup ? "signup" : "signin"); }} aria-describedby={notice ? "signin-message" : undefined}>
            <fieldset disabled={busy || !emailAvailable}>
              {!passwordSetup && <div className="signin-field"><label className="signin-field-label" htmlFor="signin-email">{c.email}</label><div className="signin-input-wrap"><Mail size={18} aria-hidden="true"/><input id="signin-email" name="email" type="email" inputMode="email" autoComplete="email" required maxLength={254} value={email} onChange={event => setEmail(event.target.value)} placeholder="name@example.com" dir="ltr" autoCapitalize="none" spellCheck={false} aria-invalid={credentialsInvalid || undefined} aria-describedby={credentialsInvalid ? "signin-message" : undefined} /></div></div>}
              {!recovering && !convertingGuest && <div className="signin-field"><label className="signin-field-label" htmlFor="signin-password">{c.password}</label><div className="signin-input-wrap signin-password-field"><LockKeyhole size={18} aria-hidden="true"/><input id="signin-password" name="password" type={visible ? "text" : "password"} autoComplete={signup || passwordSetup ? "new-password" : "current-password"} required minLength={signup || passwordSetup ? 12 : 1} maxLength={128} value={password} onChange={event => setPassword(event.target.value)} placeholder={c.password} aria-invalid={credentialsInvalid || notice === "mismatch" || undefined} aria-describedby={[signup || passwordSetup ? "signin-password-hint" : "", credentialsInvalid || notice === "mismatch" ? "signin-message" : ""].filter(Boolean).join(" ") || undefined} dir="ltr" /><button type="button" className="signin-eye" aria-label={visible ? c.hidePassword : c.showPassword} aria-pressed={visible} onClick={() => setVisible(value => !value)}>{visible ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}</button></div></div>}
              {!recovering && !convertingGuest && (signup || passwordSetup) && <><p id="signin-password-hint" className="signin-note">{c.passwordHint}</p><div className="signin-field"><label className="signin-field-label" htmlFor="signin-confirmation">{c.confirmPassword}</label><div className="signin-input-wrap"><LockKeyhole size={18} aria-hidden="true"/><input id="signin-confirmation" name="password-confirmation" type={visible ? "text" : "password"} autoComplete="new-password" required minLength={12} maxLength={128} value={confirmation} onChange={event => setConfirmation(event.target.value)} placeholder={c.confirmPassword} aria-invalid={notice === "mismatch" || undefined} aria-describedby={notice === "mismatch" ? "signin-message" : undefined} dir="ltr" /></div></div></>}
              {!signup && !passwordSetup && !recovering && <div className="signin-utilities"><label className="signin-remember"><input name="remember" type="checkbox" checked={remember} onChange={event => setRemember(event.target.checked)}/><span>{layout.remember}</span></label>{session !== "guest" && <button type="button" className="signin-forgot" onClick={() => changeMode("signin", true)}>{layout.forgot}</button>}</div>}
              {convertingGuest && <p className="signin-note">{c.guestLinkNotice}</p>}
              {session === "guest" && !signup && <p className="signin-note">{c.guestAccountWarning}</p>}
              <button className="signin-submit" type="submit">{busy && <ThinkingOrb />}{busy ? c.waiting : passwordSetup ? c.setPassword : recovering ? layout.sendReset : signup ? c.signUp : c.signIn}<ArrowRight size={17} aria-hidden="true" /></button>
            </fieldset>
          </form>
          {!emailAvailable && <p className="signin-note" role="status">{!googleVisible ? c.methodsUnavailable : signup ? c.emailSetup : c.unavailable}</p>}
          {googleVisible && <><div className="signin-divider"><span>{c.or}</span></div><button type="button" className="signin-provider" disabled={busy} onClick={() => void submit("oauth", "google")}><GoogleIcon /><span>{c.continueGoogle}</span></button></>}
          {!passwordSetup && <p className="signin-switch">{recovering ? null : signup ? layout.haveAccount : layout.noAccount}<button type="button" disabled={busy} onClick={() => changeMode(signup || recovering ? "signin" : "signup")}>{signup || recovering ? c.signIn : c.signUp}</button></p>}
          {session === "guest" && <details className="signin-guest-details"><summary>{c.signOut}</summary><p className="signin-note">{c.guestWarning}</p><button className="signin-text-button" onClick={() => void submit("signout")} disabled={busy}>{c.signOut}</button></details>}
        </div>}
        {notice && <p id="signin-message" className="signin-message" role={notice === "confirmation" || notice === "recoverySent" ? "status" : "alert"}>{notice === "recoverySent" ? layout.recoverySent : c[notice]}</p>}
        <nav className="signin-legal"><Link href={`/privacy?lang=${locale}`}>{legalCopy(locale).privacy}</Link><Link href={`/terms?lang=${locale}`}>{legalCopy(locale).terms}</Link></nav>
      </div>
  </>;
}


