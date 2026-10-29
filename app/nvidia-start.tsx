"use client";
import { coreLanguage as language } from "@/lib/core-ui-locales";
import { useEffect, useState } from "react";
import { ArrowUpRight, KeyRound } from "lucide-react";
import { ThinkingOrb } from "./thinking-orb";
import { NVIDIA_MODELS } from "@/lib/nvidia";
import type { Model } from "@/lib/benchmarks";
import type { Locale } from "@/lib/i18n";
import "./nvidia-availability.css";

type CatalogModel = (typeof NVIDIA_MODELS)[number] & { available: boolean | null };
export function NvidiaStart({ locale, onLinked }: { locale: Locale; onLinked: (ids: string[], models: Model[]) => void }) {
  const ar = locale === "ar", c = language(locale);
  const [models, setModels] = useState<CatalogModel[]>(NVIDIA_MODELS.map(model => ({ ...model, available: null })));
  const [catalogStatus, setCatalogStatus] = useState<"loading" | "ready" | "failed">("loading");
  const [catalogVersion, setCatalogVersion] = useState(0), [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [key, setKey] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    let mounted = true;
    void (async () => {
      try {
        const response = await fetch("/api/catalog/nvidia", { cache: "no-store", signal: controller.signal });
        const data = await response.json() as { models?: { id: string; available: unknown }[]; checkedAt?: unknown; catalogStatus?: unknown };
        if (!response.ok || data.catalogStatus !== "checked" || !Array.isArray(data.models) || data.models.length !== NVIDIA_MODELS.length ||
          typeof data.checkedAt !== "string" || !Number.isFinite(Date.parse(data.checkedAt)) ||
          NVIDIA_MODELS.some(model => !data.models?.some(row => row.id === model.id && typeof row.available === "boolean"))) throw new Error("PROVIDER_CATALOG_UNAVAILABLE");
        const available = NVIDIA_MODELS.map(model => ({ ...model, available: data.models!.find(row => row.id === model.id)!.available === true }));
        if (mounted) { setModels(available); setSelected(available.filter(model => model.available).map(model => model.id)); setCheckedAt(data.checkedAt); setCatalogStatus("ready"); }
      } catch {
        if (mounted && !controller.signal.aborted) { setCatalogStatus("failed"); setError("PROVIDER_CATALOG_UNAVAILABLE"); }
      }
    })();
    return () => { mounted = false; controller.abort(); };
  }, [catalogVersion]);
  function refreshCatalog() { setCatalogStatus("loading"); setError(""); setCatalogVersion(value => value + 1); }
  async function connect(event: React.FormEvent) {
    event.preventDefault();
    if (busy || catalogStatus !== "ready" || !selected.length) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/catalog/nvidia", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: selected, apiKey: key }) });
      const data = await response.json() as { error?: string; ids: string[]; models: Model[] };
      if (!response.ok) throw new Error(data.error ?? "UNAVAILABLE");
      setKey(""); onLinked(data.ids, data.models);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "UNAVAILABLE"); }
    finally { setBusy(false); }
  }
  const errors: Record<string, string> = {
    AUTH_REQUIRED: c("سجّل الدخول أولًا لحفظ الربط والتجارب في حسابك.", "Sign in to save connections and experiments."),
    PROVIDER_AUTH: c("لم تقبل إنفيديا المفتاح. تحقّق من صلاحيته وإتاحة النموذج في حسابك.", "NVIDIA rejected this key. Check its validity and model access."),
    PROVIDER_QUOTA: c("وصل حسابك إلى حد الاستخدام لدى إنفيديا. انتظر تجدد الحصة ثم حاول مجددًا.", "Your NVIDIA usage limit was reached. Wait for your quota to reset."),
    PROVIDER_UNAVAILABLE: c("لم يكتمل التحقق من الاتصال. راجع حالة الطلب في حساب إنفيديا قبل المحاولة مجددًا.", "Connection verification did not complete. Check your NVIDIA account before retrying."),
    PROVIDER_CATALOG_UNAVAILABLE: c("تعذر التحقق من فهرس إنفيديا الآن. حدّث الإتاحة قبل اختيار النماذج؛ لم يُرسل طلب استدلال.", "The NVIDIA catalog could not be verified. Refresh availability before selecting models; no inference request was sent."),
    NOT_READY: c("تغيّرت إتاحة أحد النماذج المحددة لدى إنفيديا. اختر نموذجًا آخر.", "A selected model is no longer available. Choose another model."),
    VAULT: c("خدمة حفظ المفاتيح غير متاحة مؤقتًا.", "Key storage is temporarily unavailable."),
    LIMIT: c("وصلت إلى الحد الأقصى لروابط النماذج في حسابك.", "Your account has reached its model connection limit."),
  };
  return <section className="nvidia-start" aria-labelledby="nvidia-title">
    <div className="nvidia-story">
      <span className="eyebrow">{c("نماذج فعلية · مفتاح واحد", "REAL MODELS · ONE KEY")}</span>
      <h2 id="nvidia-title">{c("ابدأ التقييم مع إنفيديا.", "Start evaluating with NVIDIA.")}</h2>
      <p>{c("اختر النماذج المدرجة حاليًا لدى المزود، واربط مفتاح حسابك، ثم قارن النتائج الفعلية. صلاحية الحساب والحصة تُختبران بطلب حقيقي.", "Choose models currently listed by the provider, connect your account key, then compare real results. Account access and quota are checked by a real request.")}</p>
      <a className="text-link" href="https://build.nvidia.com" target="_blank" rel="noopener noreferrer">{c("إنشاء مفتاح من موقع إنفيديا", "Get a key from NVIDIA")}<ArrowUpRight size={17} aria-hidden="true" /></a>
      <p className="form-help">{c("تختلف الحصص والتكاليف والإتاحة بحسب حسابك وشروط المزود. لا نفترض تشغيلًا مجانيًا أو وصولًا مضمونًا إلى كل نموذج.", "Quotas, costs and availability depend on your account and provider terms. Free operation or access to every model is not assumed.")}</p>
      <a className="text-link" href="https://docs.api.nvidia.com/nim/docs/product" target="_blank" rel="noopener noreferrer">{c("شروط الإتاحة وحدود الاستخدام", "Access terms and usage limits")}<ArrowUpRight size={15} aria-hidden="true" /></a>
      <div className="nvidia-catalog-status">
        <p className="form-help" role="status">{catalogStatus === "loading" ? c("جارٍ التحقق من فهرس المزود…", "Checking the provider catalog…") : catalogStatus === "failed" ? c("الإتاحة غير مؤكدة حاليًا.", "Availability is currently unverified.") : <>{c("آخر تحقق من فهرس المزود: ", "Provider catalog checked: ")}<time dateTime={checkedAt!}>{new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(checkedAt!))}</time></>}</p>
        <button type="button" className="secondary" disabled={busy || catalogStatus === "loading"} onClick={refreshCatalog}>{c("تحديث الإتاحة", "Refresh availability")}</button>
      </div>
    </div>
    <form className="nvidia-connect" onSubmit={connect}>
      <fieldset disabled={busy || catalogStatus !== "ready"}>
        <legend>{c("اختر النماذج التي تريد مقارنتها", "Choose models to compare")}</legend>
        {models.map((model, index) => <div className="nvidia-model" key={model.id}>
          <div className="nvidia-model-availability">
            <label><input type="checkbox" checked={selected.includes(model.id)} disabled={model.available !== true} aria-describedby={`nvidia-availability-${index}`} onChange={event => setSelected(event.target.checked ? [...selected, model.id] : selected.filter(id => id !== model.id))} /><span>{ar ? model.name : model.id.split("/")[1]}</span></label>
            <small id={`nvidia-availability-${index}`}>{model.available === true ? c("مدرج في فهرس المزود — يتطلب مفتاحًا صالحًا", "Listed by provider · valid key required") : model.available === false ? c("غير مدرج حاليًا — لا يمكن اختياره", "Not currently listed · unavailable for selection") : c("لم تُتحقق الإتاحة بعد", "Availability not yet verified")}</small>
          </div>
          <a href={model.url} target="_blank" rel="noopener noreferrer" aria-label={c("صفحة النموذج: ", "Model page: ") + (ar ? model.name : model.id.split("/")[1])}><ArrowUpRight size={17} aria-hidden="true" /></a>
        </div>)}
      </fieldset>
      <label className="field" htmlFor="nvidia-key"><span><KeyRound size={15} aria-hidden="true" />{c("مفتاح الاتصال الخاص بك", "Your API key")}</span><input id="nvidia-key" type="password" dir="ltr" autoComplete="off" value={key} maxLength={4096} disabled={busy} onChange={event => setKey(event.target.value)} required minLength={10} /></label>
      <p className="form-help">{c("يُحفظ المفتاح مشفّرًا. يرسل زر الربط طلب تحقق واحدًا إلى إنفيديا، ثم تختار الاختبارات قبل تشغيلها. تُرسل نصوص الاختبارات إلى المزود عند التنفيذ.", "Your key is encrypted. Connecting sends one verification request to NVIDIA. You choose and start tests separately; test prompts are sent to the provider.")}</p>
      {error && <div className="notice error" role="alert">{errors[error] ?? c("تعذّر إكمال الربط. تحقّق من الاتصال وحاول مجددًا.", "Connection failed. Please try again.")}{error === "AUTH_REQUIRED" && <a href={`/signin?next=/&lang=${locale}`} target="_top">{c("تسجيل الدخول", "Sign in")}</a>}</div>}
      <button type="submit" className="primary full" disabled={busy || catalogStatus !== "ready" || !selected.length || key.trim().length < 10}>{busy && <ThinkingOrb />}{busy ? c("جارٍ التحقق والربط…", "Verifying connection…") : c("تحقّق واربط النماذج", "Verify and connect models")}</button>
    </form>
  </section>;
}
