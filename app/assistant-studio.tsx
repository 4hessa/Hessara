"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Check, Copy, KeyRound, ArrowLeft, RefreshCw } from "lucide-react";
import { type AssistantProvider } from "@/lib/featured-assistants";
import { SuperAgentMascot } from "./super-agent-mascot";
import type { MascotActivity } from "@/lib/agent-mascot-config";
import { agentLanguage } from "@/lib/agent-locales";
import { ThinkingOrb } from "./thinking-orb";
import { scrollToSection } from "./section-motion";
import "./assistant-studio.css";
import { featuredAssistants } from '@/lib/featured-assistant-copy';
import { assistantMessage } from '@/lib/assistant-locales';
import { isRTL, type Locale } from '@/lib/i18n';

type Result = {
  provider: AssistantProvider;
  status: "completed" | "incomplete" | "running" | "waiting" | "unknown" | "error";
  text: string;
  model?: string;
  taskToken?: string;
  taskUrl?: string;
};
const statuses = { completed: "اكتملت المهمة", incomplete: "رد جزئي؛ وصل إلى حد الإخراج", running: "المهمة قيد التنفيذ", waiting: "المهمة تحتاج إلى تدخّلك", unknown: "الحالة لم تتضح بعد", error: "تعذّر إكمال المهمة لدى الخدمة" };
const errors: Record<string, string> = {
  AUTH_REQUIRED: "سجّل الدخول أو ابدأ جلسة ضيف لتشغيل المساعد.",
  INVALID_INPUT: "راجع المهمة والمفتاح. ينبغي أن يكون وصف المهمة بين ١٠ و٨٠٠٠ حرف.",
  ORIGIN: "تعذّر التحقق من الطلب. حدّث الصفحة وحاول مجددًا.",
  LIMIT: "بلغت حد الاستخدام اليومي لهذه الخدمة في Hessara. يمكنك المتابعة غدًا.",
  NOT_READY: "خدمة الربط غير جاهزة الآن. يمكنك استخدام الموقع الرسمي.",
  PROVIDER_AUTH: "رفضت الخدمة المفتاح أو صلاحياته. تحقّق من حسابك لدى مزوّد الخدمة.",
  PROVIDER_RATE_LIMIT: "بلغ حسابك حد الطلبات أو الرصيد لدى مزوّد الخدمة. راجع لوحة حسابك.",
  PROVIDER_UNAVAILABLE: "الخدمة غير متاحة الآن. راجع حسابك أو حاول لاحقًا.",
  PROVIDER_TIMEOUT: "استغرق الرد وقتًا طويلًا. إذا أرسلت مهمة إلى مانوس، راجع حسابك قبل تكرارها حتى لا تنشئ مهمة إضافية.",
  PROVIDER_RESPONSE: "لم نتمكن من قراءة رد الخدمة. راجع حسابك الرسمي قبل إعادة إرسال المهمة.",
  TASK_TOKEN_INVALID: "انتهت صلاحية المتابعة أو تغيّرت الجلسة. يمكنك متابعة المهمة من رابطها الرسمي.",
};

export function AssistantStudio({ locale, motionPaused = false }: { locale: Locale; motionPaused?: boolean }) {
  const c = (arabic: string) => assistantMessage(locale, arabic);
  const assistants = featuredAssistants(locale);
  const [selected, setSelected] = useState<AssistantProvider>("grok");
  const [prompt, setPrompt] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");
  const controller = useRef<AbortController | null>(null);
  const requestActive = useRef(false);
  const studio = useRef<HTMLElement>(null);
  const service = assistants.find((item) => item.id === selected)!;
  const mascotActivity: MascotActivity = busy || result?.status === "running" ? "loading" : error || result?.status === "error" ? "error" : result?.status === "completed" ? "success" : "idle";
  useEffect(() => () => controller.current?.abort(), []);

  function select(id: AssistantProvider) {
    if (requestActive.current) return;
    setSelected(id); setApiKey(""); setResult(null); setError(""); setCopied("");
    if (studio.current) scrollToSection(studio.current);
    studio.current?.focus({ preventScroll: true });
  }

  async function copy(text: string, label: string) {
    try { await navigator.clipboard.writeText(text); setCopied(label); }
    catch { setError("تعذّر النسخ التلقائي. يمكنك تحديد النص ونسخه يدويًا."); }
  }

  async function execute(action: "run" | "status") {
    if (requestActive.current) return;
    setError(""); setCopied("");
    if (!apiKey.trim()) { setError("أضف مفتاح الاتصال الخاص بالخدمة المختارة أولًا."); return; }
    if (action === "run" && prompt.trim().length < 10) { setError("اكتب وصفًا للمهمة لا يقل عن ١٠ أحرف."); return; }
    const previous = result;
    if (action === "run") setResult(null);
    requestActive.current = true;
    setBusy(true);
    const abort = new AbortController(); controller.current = abort;
    const timer = setTimeout(() => abort.abort(), 110_000);
    try {
      const response = await fetch("/api/assistants", {
        method: "POST", headers: { "content-type": "application/json" }, signal: abort.signal,
        body: JSON.stringify({ provider: selected, action, apiKey, ...(action === "run" ? { prompt } : { taskToken: previous?.taskToken }) }),
      });
      const data = await response.json() as Result & { error?: string };
      if (!response.ok) throw new Error(errors[data.error || ""] || "تعذّر إتمام الطلب. حاول لاحقًا.");
      if (typeof data.text !== "string" || !(data.status in statuses) || data.provider !== selected) throw new Error(errors.PROVIDER_RESPONSE);
      setResult(action === "status" ? { ...previous, ...data, taskToken: data.taskToken || previous?.taskToken, taskUrl: data.taskUrl || previous?.taskUrl } : data);
    } catch (reason) {
      if (abort.signal.aborted) setError(errors.PROVIDER_TIMEOUT);
      else setError(reason instanceof Error && !(reason instanceof TypeError) ? reason.message : "تعذّر الاتصال. إذا أرسلت مهمة إلى مانوس، تحقّق من حسابك قبل إعادة المحاولة.");
    } finally { clearTimeout(timer); setBusy(false); requestActive.current = false; }
  }

  return <section className="assistant-gallery" aria-labelledby="assistant-gallery-title" lang={locale} dir={isRTL(locale) ? "rtl" : "ltr"}>
    <div className="assistant-gallery-heading">
      <div><p className="kicker">{c("مساعدتك، بطريقتك")} </p><h2 id="assistant-gallery-title">{c("أربعة أبواب لأفكارك")} </h2></div>
      <p>{agentLanguage(locale)("اختر الخدمة، جهّز مهمتك، ثم استخدم واجهتها البرمجية هنا أو انتقل إلى وكيلها الرسمي.", "Choose a service, prepare your task, then use its API here or open its official workspace.")} </p>
    </div>
    <div className="assistant-cards">
      {assistants.map((item) => <article className="assistant-card" key={item.id} data-agent-id={item.id} tabIndex={-1} data-selected={selected === item.id}>
        <SuperAgentMascot agentId={item.id} motionPaused={motionPaused} selected={selected === item.id} activity={selected === item.id ? mascotActivity : "idle"} />
        <div className="assistant-card-copy"><span className="assistant-provider" lang="en">{item.provider}</span>
          <h4 lang="en" dir="ltr">{item.name}</h4><p className="assistant-card-title">{item.title}</p><p>{item.description}</p>
          <button type="button" aria-pressed={selected === item.id} disabled={busy} onClick={() => select(item.id)}>{c("اختر المساعد")} <ArrowLeft size={16} aria-hidden="true" /></button>
        </div>
      </article>)}
    </div>

    <section className="assistant-workbench" ref={studio} tabIndex={-1} aria-labelledby="assistant-workbench-title">
      <div className="assistant-setup">
        <span className="kicker">{c("مساحة العمل")} </span>
        <h3 id="assistant-workbench-title">{c("لنبدأ مع")} <bdi>{service.name}</bdi></h3>
        <p className="assistant-capability">{service.capability}</p>
        <p>{service.distinction}</p>
        <details className="assistant-guide" open key={service.id}>
          <summary>{c("طريقة التفعيل والاستخدام")} </summary>
          <ol>{service.steps.map((step) => <li key={step}>{step}</li>)}</ol>
          <div className="assistant-links"><a href={service.keys} target="_blank" rel="noopener noreferrer">{c("إعداد مفتاح الاتصال")} <KeyRound size={15} aria-hidden="true" /></a><a href={service.docs} target="_blank" rel="noopener noreferrer">{c("التوثيق الرسمي")} <ArrowUpRight size={15} aria-hidden="true" /></a></div>
        </details>
        <a className="assistant-official" href={service.official} target="_blank" rel="noopener noreferrer">{c("الوكيل الرسمي وطريقة الوصول")} <ArrowUpRight size={17} aria-hidden="true" /></a>
      </div>
      <div className="assistant-console">
        <form onSubmit={(event) => { event.preventDefault(); void execute("run"); }}>
          <label htmlFor="assistant-prompt">{c("ما الذي تريد إنجازه؟")} </label>
          <textarea id="assistant-prompt" rows={5} maxLength={8000} value={prompt} disabled={busy} onChange={(event) => setPrompt(event.target.value)} placeholder={service.example} />
          <div className="assistant-task-tools"><button type="button" disabled={busy} onClick={() => { setPrompt(service.example); setCopied(""); }}>{c("استخدم مثالًا جاهزًا")} </button><span>{new Intl.NumberFormat(locale).format(prompt.length)} / {new Intl.NumberFormat(locale).format(8000)}</span></div>
          <label htmlFor="assistant-api-key">{c("مفتاح اتصالك الخاص")} </label>
          <input id="assistant-api-key" type="password" autoComplete="off" spellCheck={false} dir="ltr" maxLength={4096} value={apiKey} disabled={busy} onChange={(event) => setApiKey(event.target.value)} aria-describedby="assistant-privacy" />
          <p id="assistant-privacy" className="assistant-privacy">{c("عند التشغيل، نرسل المهمة إلى الخدمة المختارة عبر اتصال آمن. يبقى المفتاح في هذه الصفحة ولا يُحفظ في حسابك أو جهازك. قد تُحتسب تكلفة من رصيدك لدى الخدمة.")} </p>
          <div className="assistant-actions"><button className="primary" type="submit" disabled={busy}>{busy ? c("جارٍ التواصل مع الخدمة…") : selected === "manus" ? c("إرسال المهمة إلى مانوس") : c("تشغيل المساعد")}</button>
            <button type="button" disabled={!prompt.trim() || busy} onClick={() => copy(prompt, "task")}><Copy size={15} aria-hidden="true" /> {copied === "task" ? c("نُسخت المهمة") : c("نسخ المهمة للخدمة الرسمية")}</button>
          </div>
          {busy && <p className="assistant-pending" role="status"><ThinkingOrb />{c("قد يستغرق الرد قليلًا. إرسال المهمة مرة واحدة يكفي.")} </p>}
          {error && <p className="assistant-error" role="alert">{c(error)} {error === errors.AUTH_REQUIRED && <a href={`/signin?next=%2F&lang=${locale}`}>{c("تسجيل الدخول")} </a>}</p>}
        </form>
        {result && <section className="assistant-result" aria-labelledby="assistant-result-title" aria-live="polite">
          <div className="assistant-result-heading"><h4 id="assistant-result-title">{c(statuses[result.status] || statuses.unknown)}</h4>{result.model && <bdi>{result.model}</bdi>}</div>
          {result.text ? <p className="assistant-output" dir="auto">{result.text}</p> : <p>{c("ستظهر النتيجة عند تحديث حالة المهمة. يمكنك أيضًا فتحها من موقع الخدمة.")} </p>}
          {result.status === "waiting" && <p>{c("أكمل الإجابة أو الموافقة المطلوبة داخل الموقع الرسمي؛ لا توافق Hessara على إجراءات الوكيل نيابةً عنك.")} </p>}
          <div className="assistant-actions">
            {result.text && <button type="button" onClick={() => copy(result.text, "result")}>{copied === "result" ? <Check size={16} /> : <Copy size={16} />} {copied === "result" ? c("نُسخت النتيجة") : c("نسخ النتيجة")}</button>}
            {result.taskToken && <button type="button" disabled={busy} onClick={() => execute("status")}><RefreshCw size={16} aria-hidden="true" /> {c("تحديث حالة المهمة")} </button>}
            {result.taskUrl && <a href={result.taskUrl} target="_blank" rel="noopener noreferrer">{c("افتح المهمة")} <ArrowUpRight size={15} aria-hidden="true" /></a>}
          </div>
          <p className="assistant-privacy">{c("راجع النتيجة قبل الاعتماد عليها. لا تحتفظ Hessara بنسخة من هذه المحادثة؛ انسخ ما تحتاجه قبل مغادرة القسم.")} </p>
        </section>}
      </div>
    </section>
  </section>;
}

