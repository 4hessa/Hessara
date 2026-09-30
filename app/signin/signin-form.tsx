"use client";
import { useState } from "react";

export function SignInForm({ configured, guestEnabled, emailEnabled, session, next, expired }: {
  configured: boolean; guestEnabled: boolean; emailEnabled: boolean;
  session: "guest" | "account" | "none"; next: string; expired: boolean;
}) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(expired ? "انتهت صلاحية رابط الدخول أو تعذّر التحقق منه. اطلب رابطًا جديدًا." : "");
  const [failed, setFailed] = useState(expired);
  async function submit(action: "guest" | "email" | "signout") {
    setBusy(true); setMessage(""); setFailed(false);
    try {
      const response = await fetch("/api/auth", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, next, ...(action === "email" ? { email } : {}) }) });
      const result = await response.json() as { error?: string; redirect?: string; message?: string };
      if (!response.ok) throw new Error(result.error || "تعذّر إكمال الطلب.");
      if (result.redirect) { window.location.assign(result.redirect); return; }
      setMessage(result.message || "تم إرسال الطلب.");
    } catch (error) { setFailed(true); setMessage(error instanceof Error ? error.message : "تعذّر الاتصال. حاول مجددًا."); }
    finally { setBusy(false); }
  }
  if (!configured || (!guestEnabled && !emailEnabled && session === "none")) return <p role="status">خدمة الدخول قيد التهيئة. يمكنك استكشاف النماذج والأدوات ومكتبة الاختبارات الآن.</p>;
  return <div className="signin-options">
    {session !== "none" && <><p className="session-status">{session === "guest" ? "أنت تستخدم جلسة ضيف خاصة بهذا المتصفح." : "أنت مسجّل الدخول إلى حسابك."}</p><a className="primary signin-button" href={next}>الانتقال إلى تجاربك</a></>}
    {session === "none" && guestEnabled && <><button className="primary signin-button" disabled={busy} onClick={() => submit("guest")}>{busy ? "جارٍ الاتصال…" : "ابدأ جلسة ضيف"}</button><p className="signin-note">لا تحتاج إلى إنشاء حساب للبدء. تُحفظ التجارب لهذه الجلسة؛ قد تفقد الوصول إليها عند مسح بيانات المتصفح أو إنهاء الجلسة. صدّر تقاريرك للاحتفاظ بها.</p></>}
    {session !== "account" && emailEnabled && <form onSubmit={(event) => { event.preventDefault(); void submit("email"); }}>
      <label htmlFor="signin-email">{session === "guest" ? "اربط جلستك ببريدك للاحتفاظ بالوصول إليها" : "الدخول برابط يُرسل إلى بريدك"}</label>
      <input id="signin-email" type="email" autoComplete="email" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@example.com" dir="ltr" />
      <button className="secondary signin-button" type="submit" disabled={busy}>{busy ? "جارٍ الإرسال…" : "أرسل رابط الدخول"}</button>
    </form>}
    {message && <p className={failed ? "signin-error" : "signin-status"} role={failed ? "alert" : "status"}>{message}</p>}
    {session !== "none" && <div className="signin-signout">{session === "guest" && <p className="signin-note">قبل إنهاء جلسة الضيف، صدّر النتائج أو اربط الجلسة ببريدك إن كان الخيار متاحًا. لا يمكن استعادة الجلسة بعد الخروج منها.</p>}<button className="secondary" disabled={busy} onClick={() => submit("signout")}>تسجيل الخروج من هذا المتصفح</button></div>}
  </div>;
}
