"use client";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowUpRight,
  Bookmark,
  Search,
  X,
  KeyRound,
  ArrowDownToLine,
  Link2,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { isRTL, translate, type Locale } from "@/lib/i18n";
import { displayName } from "@/lib/display-names";
import type { Model } from "@/lib/benchmarks";
import catalog from "@/lib/catalog/models.json";
import directory from "@/lib/catalog/tools.json";
import { toolDescription } from "@/lib/tool-copy";
import { discoveryLanguage as language } from "@/lib/discovery-locales";
import { guideLanguage } from "@/lib/guide-locales";
import { StudentNotebook } from "./student-notebook";
import { LLMExplorerEntry } from "./llm-explorer-entry";
import { ModelAdvisor, ModelEvidenceComparison } from "./model-advisor";
import { advisorSnapshot } from "@/lib/advisor-snapshot";
import {ModelContextHelp} from './model-context-help';
import "./model-gallery.css";
const checkedDate = (date: string, locale: Locale) =>
  new Intl.DateTimeFormat(locale, {
    dateStyle: "long",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));
const categories: Record<string, [string, string]> = {
  agents: ["الوكلاء والأتمتة", "Agents & automation"],
  rag: ["الاسترجاع والذاكرة", "Retrieval & memory"],
  evaluation: ["التقييم والمراقبة", "Evaluation & observability"],
  inference: ["تشغيل النماذج", "Inference & serving"],
  training: ["التدريب والبيانات", "Training & data"],
  vision: ["الرؤية الحاسوبية", "Computer vision"],
  speech: ["الصوت والكلام", "Speech & audio"],
  images: ["التوليد المرئي", "Visual generation"],
  nlp: ["معالجة اللغة", "Language & documents"],
  mcp: ["بروتوكول سياق النموذج", "MCP tools"],
  coding: ["مساعدو البرمجة", "Coding assistants"],
};
function External({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="external-link"
    >
      {children}
      <ArrowUpRight size={16} aria-hidden="true" />
    </a>
  );
}
export function LLMDirectory({
  locale,
  onCustom,
  onLinked,
  connections = [],
  onUse,
  onRequireAuth,
}: {
  locale: Locale;
  onCustom: () => void;
  onLinked: (ids: string[], models: Model[]) => void;
  connections?: Model[];
  onUse?: (id: string) => void;
  onRequireAuth?: () => void;
}) {
  const c = language(locale),
    t = (k: string) => translate(locale, k);
  const [query, setQuery] = useState(""),
    [publisher, setPublisher] = useState("all"),
    [selected, setSelected] = useState<string[]>([]),
    [showCompare, setShowCompare] = useState(false),
    [connect, setConnect] = useState(false),
    [key, setKey] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const visible = catalog.filter(
    (m) =>
      (publisher === "all" || m.publisher === publisher) &&
      `${m.name} ${displayName(m.name, locale)} ${m.id} ${m.publisher} ${displayName(m.publisher, locale)}`
        .toLowerCase()
        .includes(query.toLowerCase().trim()),
  );

  const fmt = (n: number) =>
    new Intl.NumberFormat(locale, { maximumFractionDigits: 3 }).format(n);
  const configured = connections.filter(model => model.provider !== "simulation" && (model.configured || model.ready));
  const connectionFor = (id: string) => configured.find(model => model.provider === "openrouter" && model.label === id);
  const status = (model?: Model) => !model
    ? c("يتطلب ربط مزوّد", "Provider connection required")
    : model.ready ? c("اجتاز آخر فحص تشغيل", "Last operation verified")
    : model.verification === "failed" ? c("يحتاج مراجعة الاتصال", "Connection needs attention")
    : c("مُهيأ — بانتظار التحقق", "Configured · awaiting verification");
  async function link() {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/catalog/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: selected, apiKey: key }),
      });
      const data = (await r.json()) as {
        error?: string;
        ids: string[];
        models: Model[];
      };
      if (!r.ok) throw new Error(data.error || "UNAVAILABLE");
      setKey("");
      setConnect(false);
      onLinked(data.ids, data.models);
    } catch (e) {
      const code = (e as Error).message;
      setError(code);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="discovery model-gallery"
      lang={locale}
      dir={isRTL(locale) ? "rtl" : "ltr"}
    >
      <div className="catalog-intro">
        <div>
          <span className="eyebrow">
            {c("دليل النماذج / ٣٥", "MODEL ATLAS / 35")}
          </span>
          <h1>
            {c(
              "تعرّف إلى النموذج. ثم اختبره.",
              "Meet the model. Then measure it.",
            )}
          </h1>
          <p lang={locale} dir="auto">
            {c(
              "كتالوج منتقى لنماذج من مزودين معروفين، مع إمكانية إضافة أي معرّف آخر يدعمه مزوّدك. المواصفات من أوبن راوتر؛ نتائج الجودة تُحسب من تجاربك فقط.",
              "A curated model catalog from established providers, alongside any other model ID your provider supports. Specifications come from OpenRouter; quality scores come only from your experiments.",
            )}
          </p>
        </div>
        <button className="secondary" onClick={onCustom}>
          <Link2 size={16} />
          {c("إضافة نموذج آخر", "Add another model")}
        </button>
      </div>
      {configured.length > 0 && onUse && <section className="gallery-connections" aria-labelledby="gallery-connections-title">
        <header><h3 id="gallery-connections-title">{c("في مساحتك", "In your workspace")}</h3><p>{c("اتصالاتك المهيأة. حالة التحقق تعكس آخر اختبار مسجل، وليست ضمانًا لاستمرار الخدمة.", "Your configured connections. Verification reflects the last recorded test, not a guarantee of continued availability.")}</p></header>
        <ul>{configured.map(model => <li key={model.id}>
          <div><span className="gallery-provider" dir="auto">{model.provider}</span><strong dir="auto">{displayName(model.name, locale)}</strong><span className="gallery-status" data-verified={model.ready}>{status(model)}</span></div>
          <button type="button" onClick={() => onUse(model.id)}>{c("فتح المختبر", "Open lab")}<ArrowUpRight size={16} aria-hidden="true" /></button>
        </li>)}</ul>
      </section>}
      <details className="gallery-advisor">
        <summary>{c("لست متأكدًا من اختيارك؟ استكشف حسب المهمة", "Not sure where to start? Explore by task")}</summary>
        <ModelAdvisor locale={locale} onCompare={(ids) => {
          setSelected(ids); setShowCompare(true);
          requestAnimationFrame(() => document.getElementById("evidence-comparison-heading")?.focus());
        }} />
      </details>
      {showCompare && <ModelEvidenceComparison locale={locale} models={advisorSnapshot.models.filter(model => selected.includes(model.id))} />}
      <div className="catalog-toolbar">
        <label className="catalog-search">
          <Search size={18} />
          <input
            aria-label={c("البحث عن نموذج", "Search models")}
            placeholder={c("ابحث بالاسم أو العائلة…", "Search name or family…")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <label className="catalog-select">
          {c("المطوّر", "Publisher")}
          <select
            value={publisher}
            onChange={(e) => setPublisher(e.target.value)}
          >
            <option value="all">{t("all")}</option>
            {[...new Set(catalog.map((m) => m.publisher))].map((p) => (
              <option key={p} value={p}>
                {displayName(p, locale)}
              </option>
            ))}
          </select>
        </label>
        <span className="catalog-count" aria-live="polite">
          {fmt(visible.length)} / {fmt(catalog.length)}
        </span>
      </div>
      <div className="model-atlas">
        {visible.map((m) => (
          <article
            key={m.id}
            className={
              selected.includes(m.id) ? "atlas-entry selected" : "atlas-entry"
            }
          >
            <div className="atlas-top">
              <span className="atlas-number">
                {fmt(catalog.indexOf(m) + 1)}
              </span>
              <Checkbox
                aria-label={
                  c("اختيار ", "Select ") + displayName(m.name, locale)
                }
                checked={selected.includes(m.id)}
                onCheckedChange={(v) => {
                  setSelected(
                    v
                      ? [...selected, m.id]
                      : selected.filter((x) => x !== m.id),
                  );
                  setShowCompare(false);
                }}
              />
            </div>
            <span className="atlas-publisher" dir="auto">
              {displayName(m.publisher, locale)}
            </span>
            <h3 dir="auto">{displayName(m.name, locale)}</h3>
            <p className="gallery-status" data-verified={connectionFor(m.id)?.ready === true}>{status(connectionFor(m.id))}</p>
            <details className="atlas-details">
              <summary>{c("معرّف الربط", "Connection ID")}</summary>
              <code className="atlas-id" dir="ltr">
                {m.id}
              </code>
            </details>
            <dl>
              <div>
                <dt>{c("نافذة السياق", "Context window")}</dt>
                <dd>
                  {fmt(m.context)} {c("رمز", "tokens")}
                </dd>
              </div>
              <div>
                <dt>{c("إدخال / إخراج", "Input / output")}</dt>
                <dd dir="ltr">
                  ${fmt(m.inputPrice)} / ${fmt(m.outputPrice)}
                </dd>
              </div>
            </dl>
            <p className="atlas-pricing-note">
              {c(
                "لكل مليون رمز، سعر مرجعي",
                "per million tokens, reference price",
              )}
            </p>
            {"releaseDate" in m && typeof m.releaseDate === "string" && (
              <p className="atlas-release-meta">
                {c("الإصدار الرسمي: ", "Official release: ")}{checkedDate(m.releaseDate, locale)}
                {"apiGaDate" in m && typeof m.apiGaDate === "string" && <> · {c("إتاحة API العامة: ", "API GA: ")}{checkedDate(m.apiGaDate, locale)}</>}
                <br />{c("Paid API access; provider terms, account access and availability apply.", "Paid API access; provider terms, account access and availability apply.")}
                {"releaseUrl" in m && typeof m.releaseUrl === "string" && <> · <External href={m.releaseUrl}>{c("الإعلان الرسمي", "Official announcement")}</External></>}
              </p>
            )}
            <div className="atlas-bottom">
              <span>
                {m.reasoning
                  ? c("استدلال", "Reasoning")
                  : c("توليد نصي", "Text generation")}
                {m.tools ? " · " + c("أدوات", "Tools") : ""}
              </span>
              <External href={m.url}>{c("المصدر", "Source")}</External>
            </div>
            {advisorSnapshot.models.find(model=>model.id===m.id)&&<ModelContextHelp locale={locale} model={advisorSnapshot.models.find(model=>model.id===m.id)!}/>}
            <button type="button" className="gallery-action" onClick={() => {
              if (onRequireAuth) { onRequireAuth(); return; }
              const connection = connectionFor(m.id);
              if (connection && onUse) onUse(connection.id);
              else { setSelected([m.id]); setConnect(true); setError(""); }
            }}>{connectionFor(m.id) && onUse ? c("فتح المختبر", "Open lab") : c("ربط هذا النموذج", "Connect this model")}<ArrowUpRight size={17} aria-hidden="true" /></button>
          </article>
        ))}
      </div>
      {!visible.length && (
        <p className="catalog-empty">
          {c(
            "لا توجد نماذج تطابق بحثك. جرّب اسمًا آخر.",
            "No matching models. Try another name.",
          )}
        </p>
      )}
      {!!selected.length && (
        <div className="comparison-dock">
          <span>
            {c("عدد النماذج المحددة: ", "Models selected: ")}
            <strong>{fmt(selected.length)}</strong>
          </span>
          <button
            className="secondary"
            disabled={selected.length < 2}
            onClick={() => {
              setShowCompare((v) => !v);
              if (!showCompare) requestAnimationFrame(() => document.getElementById("evidence-comparison-heading")?.focus());
            }}
          >
            {c("مقارنة المواصفات", "Compare specifications")}
          </button>
          <button
            className="primary"
            onClick={() => {
              if (onRequireAuth) { onRequireAuth(); return; }
              setConnect(true);
              setError("");
            }}
          >
            <KeyRound size={16} />
            {c("ربط النماذج وإعداد تجربة", "Connect & prepare experiment")}
          </button>
          <button
            className="icon-button"
            aria-label={c("إلغاء التحديد", "Clear selection")}
            onClick={() => {
              setSelected([]);
              setShowCompare(false);
            }}
          >
            <X size={18} />
          </button>
        </div>
      )}
      <p
        className="catalog-footnote"
        lang={locale}
        dir="auto"
      >
        {c("آخر تحقق: ", "Checked: ")}{checkedDate(catalog[0].checkedAt, locale)}. {c(
          "تتغير الأسعار والإتاحة؛ يعاد التحقق عند الربط. قد تختلف جودة الخدمة حسب المضيف. لا تمثل هذه القائمة ترتيبًا للأفضل.",
          "Prices and availability change and are rechecked on connection. Host routing can affect service quality. This list is not a best-model ranking.",
        )}
      </p>
      <Dialog
        open={connect}
        onOpenChange={(v) => {
          setConnect(v);
          if (!v) setKey("");
        }}
      >
        <DialogContent
          className="form-dialog"
          dir={isRTL(locale) ? "rtl" : "ltr"}
          showCloseButton={false}
        >
          <DialogClose className="dialog-close" aria-label={t("close")}>
            <X size={19} />
          </DialogClose>
          <DialogHeader>
            <DialogTitle>
              {c("مفتاح واحد، نماذج متعددة", "One key, multiple models")}
            </DialogTitle>
            <DialogDescription>
              {c(
                "أضف مفتاح أوبن راوتر الخاص بك. يُحفظ مشفّرًا، وتبقى خطوة تشغيل التجربة بيدك. يُرسل محتوى الاختبارات إلى أوبن راوتر ومضيف النموذج عند التشغيل.",
                "Add your OpenRouter key. It is stored encrypted. You start the experiment separately. Test prompts are sent to OpenRouter and the model host when you run it.",
              )}
            </DialogDescription>
          </DialogHeader>
          <p>
            {c("عدد النماذج للربط: ", "Models to connect: ")}
            {fmt(selected.length)}
          </p>
          <label className="field">
            {c("مفتاح اتصال أوبن راوتر", "OpenRouter API key")}
            <input
              type="password"
              dir="ltr"
              autoComplete="off"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              maxLength={4096}
            />
          </label>
          <External href="https://openrouter.ai/settings/keys">
            {c("إدارة مفاتيح أوبن راوتر", "Manage OpenRouter keys")}
          </External>
          {error && (
            <p role="alert" className="notice error">
              {t("error_" + error).startsWith("error_") ? t("error") : t("error_" + error)}
            </p>
          )}
          <button
            className="primary full"
            aria-busy={busy}
            disabled={busy || key.trim().length < 10}
            onClick={link}
          >
            {busy
              ? t("saving")
              : c(
                  "حفظ الربط واختيار الاختبارات",
                  "Save connections & choose tests",
                )}
          </button>
          <p
            className="form-help"
            lang={locale}
            dir="auto"
          >
            {c(
              "قد تتطلب النماذج رصيدًا لدى المزوّد. لا يجري هذا الزر أي اختبار مدفوع.",
              "Models may require provider credits. This button does not run any paid evaluation.",
            )}
          </p>
        </DialogContent>
      </Dialog>
    </section>
  );
}
export function ToolsDirectory({
  locale,
  onPaperclip,
}: {
  locale: Locale;
  onPaperclip: () => void;
}) {
  const fmt = (value: number) => new Intl.NumberFormat(locale).format(value);
  const c = language(locale),
    [query, setQuery] = useState(""),
    [category, setCategory] = useState("all"),
    [saved, setSaved] = useState<string[]>([]),
    [onlySaved, setOnlySaved] = useState(false),
    [page, setPage] = useState(1);
  useEffect(() => {
    try {
      const value = JSON.parse(
        localStorage.getItem("hessara:saved-tools") || "[]",
      );
      if (Array.isArray(value))
        // Restore browser-only saved data once, after the server-rendered page hydrates.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setSaved(value.filter((v) => typeof v === "string"));
    } catch {}
  }, []);
  const visible = useMemo(
    () =>
      directory.filter(
        (tool) =>
          (category === "all" || tool.category === category) &&
          (!onlySaved || saved.includes(tool.id)) &&
          `${tool.name} ${tool.id} ${tool.summaryAr} ${tool.summaryEn} ${toolDescription(tool, locale)}`
            .toLowerCase()
            .includes(query.trim().toLowerCase()),
      ),
    [category, query, onlySaved, saved, locale],
  );
  const pages = Math.max(1, Math.ceil(visible.length / 24)),
    currentPage = Math.min(page, pages);
  function favorite(id: string) {
    const next = saved.includes(id)
      ? saved.filter((x) => x !== id)
      : [...saved, id];
    setSaved(next);
    try {
      localStorage.setItem("hessara:saved-tools", JSON.stringify(next));
    } catch {}
  }
  return (
    <section
      className="discovery tools-discovery"
      lang={locale}
      dir={isRTL(locale) ? "rtl" : "ltr"}
    >
      <div className="tools-editorial">
        <div>
          <span className="eyebrow">
            {c("دليل أدوات الذكاء الاصطناعي", "AI TOOL DIRECTORY")} /{" "}
            {new Intl.NumberFormat(locale).format(directory.length)}
          </span>
          <h2>
            {c(
              "أدوات تختصر الطريق،\nومصادر تستحق الاكتشاف.",
              "Tools to build with.\nSources worth knowing.",
            )}
          </h2>
          <p lang={locale} dir="auto">
            {c(
              "دليل منتقى لأدوات ووكلاء الذكاء الاصطناعي، مع وصف عربي ورابط إلى المصدر الرسمي. ابحث حسب حاجتك واحفظ ما يفيدك.",
              "A curated directory of AI tools and agents, each linked to its official source. Search by need and save your shortlist.",
            )}
          </p>
        </div>
        <div className="tools-editorial-note">
          <strong>{fmt(directory.length)}</strong>
          <span>
            {c("أداة ومستودع برمجي", "tools & software repositories")}
          </span>
          <span>
            {fmt(11)} {c("مجالًا متخصصًا", "focused categories")}
          </span>
        </div>
      </div>
      <StudentNotebook locale={locale} />
      <div className="paperclip-feature">
        <div>
          <span className="eyebrow">
            {c("تكامل بيبركليب", "INTEGRATION / PAPERCLIP")}
          </span>
          <h3>
            {c(
              "من نتيجة اختبار إلى مهمة لفريقك.",
              "From evaluation to a team task.",
            )}
          </h3>
          <p lang={locale} dir="auto">
            {c(
              "حوّل ملخص تجربتك إلى مسودة مراجعة في بيبركليب. يمكنك تنزيل المهمة أو إرسالها إلى خادمك بعد إعداد الربط.",
              "Turn your experiment summary into a Paperclip review draft. Download it, or send it to your server after configuration.",
            )}
          </p>
        </div>
        <div className="feature-actions">
          <button className="primary" onClick={onPaperclip}>
            {c("استخدام التكامل", "Use integration")}
          </button>
          <External href="https://github.com/paperclipai/paperclip">
            {c("بيبركليب", "Paperclip")}
          </External>
        </div>
      </div>
      <div className="catalog-toolbar">
        <label className="catalog-search">
          <Search size={18} />
          <input
            aria-label={c("البحث في الأدوات", "Search tools")}
            placeholder={c(
              "ابحث عن وكيل، صوت، استرجاع، تقييم…",
              "Search agents, speech, retrieval, evaluation…",
            )}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(1);
            }}
          />
        </label>
        <button
          className={onlySaved ? "secondary saved-active" : "secondary"}
          aria-pressed={onlySaved}
          onClick={() => {
            setOnlySaved(!onlySaved);
            setPage(1);
          }}
        >
          <Bookmark size={16} />
          {c("المفضلة", "Saved")} ({fmt(saved.length)})
        </button>
        <span className="catalog-count" aria-live="polite">
          {c("عدد النتائج: ", "Results: ")}
          {fmt(visible.length)}
        </span>
      </div>
      <div
        className="category-filters"
        aria-label={c("مجال الأداة", "Tool category")}
      >
        <button
          aria-pressed={category === "all"}
          onClick={() => {
            setCategory("all");
            setPage(1);
          }}
        >
          {c("الكل", "All")}
        </button>
        {Object.entries(categories).map(([id, labels]) => (
          <button
            key={id}
            aria-pressed={category === id}
            onClick={() => {
              setCategory(id);
              setPage(1);
            }}
          >
            {c(...labels)}
          </button>
        ))}
      </div>
      <div className="tool-list">
        {visible.slice((currentPage - 1) * 24, currentPage * 24).map((tool) => (
          <article key={tool.id} className="tool-entry">
            <div className="tool-entry-top">
              <span className="tool-category">
                {categories[tool.category] && c(...categories[tool.category])}
              </span>
              <button
                className="icon-button"
                aria-label={c("حفظ ", "Save ") + tool.name}
                aria-pressed={saved.includes(tool.id)}
                onClick={() => favorite(tool.id)}
              >
                <Bookmark
                  size={17}
                  fill={saved.includes(tool.id) ? "currentColor" : "none"}
                />
              </button>
            </div>
            <h3>
              <External href={tool.url}>
                <span dir="auto" lang={tool.id === "google/gemini-notebook" ? locale : "en"}>
                  {tool.id === "google/gemini-notebook" ? c("دفتر جيمناي · نوتبوك إل إم", "Gemini Notebook · NotebookLM") : tool.name}
                </span>
              </External>
            </h3>
            <p lang={locale}>
              {toolDescription(tool, locale)}
            </p>
            <div className="tool-meta">
              <span dir="ltr">{tool.id.split("/")[0]}</span>
              <span>
                {tool.id === "google/gemini-notebook" ? c("خدمة خارجية", "External service") : tool.license === "NOASSERTION"
                  ? c("راجع الترخيص", "Check license")
                  : tool.license}
              </span>
            </div>
            {"firstReleasedAt" in tool && typeof tool.firstReleasedAt === "string" && (
              <p className="tool-release-meta" dir="auto">
                {language(locale)("أول إصدار عام", "First public release")}: {checkedDate(tool.firstReleasedAt, locale)}
                {tool.latestRelease && <> · v{tool.latestRelease}</>}
              </p>
            )}
          </article>
        ))}
      </div>
      {!visible.length && (
        <div className="catalog-empty">
          <h3>{c("لم نجد نتيجة مطابقة", "No matching tools")}</h3>
          <p>
            {c(
              "جرّب كلمة أخرى أو أزل تصفية المفضلة.",
              "Try another keyword or turn off the saved filter.",
            )}
          </p>
        </div>
      )}
      <div className="catalog-pagination">
        <button
          className="secondary"
          disabled={currentPage === 1}
          onClick={() => setPage(currentPage - 1)}
        >
          {c("السابق", "Previous")}
        </button>
        <span aria-live="polite">
          {fmt(currentPage)} / {fmt(pages)}
        </span>
        <button
          className="secondary"
          disabled={currentPage === pages}
          onClick={() => setPage(currentPage + 1)}
        >
          {c("التالي", "Next")}
        </button>
      </div>
      <p
        className="catalog-footnote"
        lang={locale}
        dir="auto"
      >
        {c(
          "روابط إلى المصادر الرسمية والمستودعات الأصلية. الأدوات خدمات وبرمجيات خارجية؛ إضافتها إلى الدليل لا تعني تثبيتها أو تدقيقها أمنيًا. راجع الشروط والترخيص ومتطلبات التشغيل في المصدر. المفضلة محفوظة على جهازك.",
          "Links to official services and source repositories. Inclusion does not mean installation or a security audit. Review terms, licenses and setup requirements at the source. Your saved list stays on this device.",
        )}
      </p>
    </section>
  );
}
export function HowWork({
  locale,
  onStart,
  onModels,
  onTools,
  onAgents,
}: {
  locale: Locale;
  onStart: () => void;
  onModels: () => void;
  onTools: () => void;
  onAgents: () => void;
}) {
  const c = guideLanguage(locale);
  const sections = [
    [
      c("لماذا Hessara؟", "Why Hessara?"),
      c(
        "النموذج المناسب هو الذي ينجح في مهامك ضمن وقتك وميزانيتك. تساعدك Hessara على تحويل الانطباعات إلى تجارب قابلة للمراجعة، ثم مقارنة الجودة والسرعة والثبات واستهلاك الرموز والتكلفة. لا نعتمد ترتيبًا جاهزًا ولا نمنح درجات قبل الاختبار.",
        "The right model succeeds on your tasks within your time and budget. Hessara turns impressions into reviewable experiments comparing quality, latency, consistency, token usage and cost. Scores come from your runs, not a prefabricated ranking.",
      ),
    ],
    [
      c("ابدأ بالنموذج، لا بالتخمين", "Choose models, not assumptions"),
      c(
        "يضم كتالوج النماذج مجموعة منتقاة من مزوّدين معروفين. قارن المواصفات، ثم اربط اختيارك بمفتاح أوبن راوتر واحد. ويمكنك إضافة نماذج أخرى يدعمها أوبن إيه آي أو أنثروبيك أو جيميني أو أوبن راوتر باستخدام معرّفاتها. لا تثبت الشهرة ملاءمة النموذج لمهمتك.",
        "LLMs lists a curated selection of models from established providers. Compare their specifications, then connect your selection with one OpenRouter key. Add other models supported by OpenAI, Anthropic, Gemini or OpenRouter using their IDs. Popularity is not proof of suitability.",
      ),
    ],
    [
      c("حدّد تجربة قابلة للمقارنة", "Design a comparable experiment"),
      c(
        "اختر حتى 30 نموذجًا، والفئات التي تهمك، و4 أو 12 أو 40 مهمة لكل فئة، وتكرارًا واحدًا أو ثلاثة. تتلقى النماذج المدخلات نفسها. يعرض نموذج الإعداد عدد الاستدعاءات قبل التشغيل؛ قد تصل التجربة الكاملة إلى 21,600 محاولة. ابدأ بعينة صغيرة ثم وسّعها.",
        "Choose up to 30 models, your categories, 4, 12 or 40 tasks per category, and one or three repeats. Models receive identical inputs. Setup shows the request count before execution; a maximum run can reach 21,600 attempts. Start small and expand deliberately.",
      ),
    ],
    [
      c("ماذا تختبر المهام؟", "What do the tasks measure?"),
      c(
        "240 مهمة ثابتة في ست فئات: فهم مخرجات جافاسكربت، الاستدلال العددي والمنطقي، تحليل بيانات صغيرة، استرجاع حقائق من سجلات، الالتزام بصيغ البيانات المنظّمة، واستخراج معلومات من سياقات تتضمن 400 إلى 1,600 سجل. أربعة أنماط وعشر حالات لكل نمط في كل فئة.",
        "240 fixed tasks cover JavaScript output reasoning, numerical logic, small-data analysis, record retrieval, strict JSON instructions and retrieval from contexts containing 400–1,600 records. Each category has four patterns with ten cases each.",
      ),
    ],
    [
      c("كيف تُحسب الجودة؟", "How is quality scored?"),
      c(
        "نصحّح الإجابات بمقارنة مباشرة مع الإجابة المرجعية أو بمطابقة البيانات المنظّمة بعد تنظيم المفاتيح. الأخطاء والمهل تساوي صفرًا. الدرجة الإجمالية هي متوسط درجات الفئات بأوزان متساوية. يمكنك مراجعة السؤال وإجابة النموذج والمرجع. لا يوجد حكم مخفي صادر عن نموذج آخر.",
        "Answers are graded against references with exact text or canonical JSON matching. Errors and timeouts score zero. The overall quality score averages categories equally. Inspect each prompt, response and reference; no hidden model judge is used.",
      ),
    ],
    [
      c("السرعة والثبات", "Latency and consistency"),
      c(
        "نقيس مدة الطلب الكامل من الخادم، ونعرض الوسيط والمئين ٩٥؛ وهما ليسا زمن أول رمز. يُقاس الثبات عند التكرار، بنسبة المهام التي أعادت النص نفسه بعد إزالة الفراغات الطرفية. قد تكون الإجابة ثابتة وخاطئة؛ لذلك اقرأ الثبات مع الجودة.",
        "We measure complete server-side request duration and show p50 and p95, not time to first token. With repeats, consistency measures tasks returning identical trimmed text. An answer can be consistently wrong, so read this metric alongside quality.",
      ),
    ],
    [
      c("التكلفة واستهلاك الموارد", "Cost and resource usage"),
      c(
        "نستخدم أعداد الرموز التي يعيدها المزوّد، بما فيها رموز التفكير حين تتوفر. التكلفة تقدير بسعر الإدخال والإخراج لكل مليون رمز، وليست فاتورة. تظهر القيم غير المعروفة بوضوح. لا يمكن لهذه الواجهات قياس ذاكرة المعالج الرسومي أو الذاكرة العشوائية أو الطاقة.",
        "We use provider-reported token counts, including reasoning tokens when available. Cost is an estimate from per-million input and output prices, not an invoice. Unknown values remain unknown. These APIs cannot measure GPU memory, RAM or energy.",
      ),
    ],
    [
      c("الحفظ والاستئناف وخصوصية المفاتيح", "Persistence and privacy"),
      c(
        "تُحفظ النتائج في قاعدة بيانات مرتبطة بحسابك، وتُشفّر مفاتيح الاتصال قبل تخزينها. يدفع المتصفح دفعات التنفيذ؛ أبقِ الصفحة مفتوحة أو استأنف لاحقًا. لا يعاد إرسال طلب مدفوع تلقائيًا إذا انقطعت نتيجته. عند الاختبار الفعلي تُرسل المطالبات إلى المزوّد الذي اخترته.",
        "Results are stored under your account and connection keys are encrypted. The browser dispatches batches: keep the page open or resume later. Ambiguous interrupted paid requests are not automatically resent. Live evaluation sends prompts to your chosen provider.",
      ),
    ],
    [
      c("المحاكاة والتقييم الفعلي", "Simulation and live evaluation"),
      c(
        "المحاكاة مجانية وتستخدم أسماء ونتائج اصطناعية لتجربة الواجهة. تُوسم بوضوح ولا تصلح للحكم على أي نموذج تجاري. التقييم الفعلي يحتاج مفتاحًا صالحًا، وقد يتطلب رصيدًا عند المزوّد. يمكنك ربط أربعة نماذج متاحة للتقييم المجاني من إنفيديا ضمن حصة حسابك وشروط الخدمة. لا تُعرض النتائج الجزئية كترتيب نهائي.",
        "Free simulation uses fictional names and synthetic results to explore the interface. It cannot establish commercial-model quality. Live evaluation needs valid credentials and may require provider credits. Four NVIDIA models offer free evaluation access subject to account quotas and provider terms. Partial results are not a final ranking.",
      ),
    ],
    [
      c("وكلاء خارقون ومحركات قرار", "Agents and decision engines"),
      c(
        "إذا لم تعرف أي فئة تختبر أولًا، اكتب حاجتك في قسم وكلاء خارقون. يتيح محركا jev وLaya Decision اقتراح فئة من مكتبة الاختبارات؛ الأول يتطلب مفتاحك، والثاني خادمًا آمنًا تهيئه بنفسك. راجع الاقتراح ثم ابدأ التجربة. يضم القسم أيضًا روابط مباشرة إلى وكلاء مستقلين مثل OpenClaw وأطر بنائهم؛ إدراجها لا يعني تشغيلها داخل المنصة.",
        "If you are unsure which category to evaluate first, describe your need in Super agents. Jev requires your key and Laya Decision requires your own secure server. Review the suggested category before starting a run. The section also links to independent agents such as OpenClaw and to agent-building frameworks; listing does not mean they run inside Hessara.",
      ),
    ],
    [
      c("الأدوات وبيبركليب", "Tools and Paperclip"),
      c(
        "استكشف أكثر من ٣٠٠ أداة متخصصة، وابحث واحفظ المفضلة وافتح المصدر مباشرة. جهّز طلب مذاكرة لدفتر جيمناي من مساحة الطلاب. وفي تكامل بيبركليب يتحول ملخص التقييم إلى مسودة مهمة مراجعة؛ نزّلها أو أرسلها إلى خادمك بعد إعداد الربط.",
        "Explore over 300 AI tools, search, save and open each source. Prepare study prompts for Gemini Notebook in the student space. Paperclip integration turns an evaluation summary into a review draft to download or send to your configured server.",
      ),
    ],
    [
      c("تقارير قابلة للاستخدام", "Reports you can use"),
      c(
        "صدّر البيانات المنظّمة للتجربة والمقاييس والإجابات، أو جدول البيانات لتحليل المحاولات في أدواتك. يحتفظ التقرير بإصدار الاختبارات وإعدادات النماذج وقت التنفيذ، حتى لا تتغير هوية النتائج القديمة عند تعديل الربط. استخدم التقرير لتحديد تجربة تالية أو مراجعة بشرية.",
        "Export JSON with the run, metrics and responses, or CSV for further analysis. Reports preserve the suite version and model configuration at execution time. Use evidence to decide the next experiment or request a human review.",
      ),
    ],
    [
      c("ما الذي لا تثبته النتائج؟", "What results do not prove"),
      c(
        "هذه مجموعة اصطناعية أولية، وليست تقييمًا شاملًا لكل مجال. البرمجة هنا فهم كود، والاسترجاع من سياق مرفق، والسياق الطويل استخراج معلومات؛ لا ننفّذ كودًا مولّدًا ولا نقيس وكلاء يعملون لساعات. تختلف النتائج مع المطالبات والإعدادات والمزوّد. أضف تقييمًا خاصًا بمجال عملك قبل الاعتماد الإنتاجي.",
        "This initial synthetic suite is not comprehensive. Coding means code reasoning, retrieval uses supplied context, and long-context tests extract information. We do not execute generated code or benchmark agents working for hours. Results vary with prompts, settings and hosts. Validate on domain data before production decisions.",
      ),
    ],
  ];
  return (
    <section
      className="how-work"
      lang={locale}
      dir={isRTL(locale) ? "rtl" : "ltr"}
    >
      <div className="how-hero">
        <span className="eyebrow">
          {c("دليل استخدام المنصة", "HOW IT WORKS / HESSARA")}
        </span>
        <h2>
          {c(
            "اختيار مدروس،\nيبدأ بسؤال جيد.",
            "A considered choice\nstarts with a good question.",
          )}
        </h2>
        <p>
          {c(
            "دليلك لفهم المنصة، تصميم التجربة وقراءة النتائج دون مبالغة.",
            "Your guide to designing experiments and interpreting results without overclaiming.",
          )}
        </p>
        <div className="hero-actions">
          <button className="primary" onClick={onStart}>
            {c("ابدأ تجربة", "Start an experiment")}
          </button>
          <button className="text-button" onClick={onModels}>
            {c("استكشف النماذج", "Explore models")}
            <ArrowUpRight size={17} />
          </button>
        </div>
      </div>
      <LLMExplorerEntry locale={locale} />
      <div className="how-layout">
        <nav
          aria-label={c("دليل المحتوى", "Guide contents")}
          className="how-index"
        >
          {sections.map(([title], i) => (
            <a key={title} href={"#guide-" + i}>
              <span>{String(i + 1).padStart(2, "0")}</span>
              {title}
            </a>
          ))}
        </nav>
        <div className="how-articles">
          {sections.map(([title, body], i) => (
            <article id={"guide-" + i} key={title}>
              <span className="article-index">
                {String(i + 1).padStart(2, "0")}
              </span>
              <h3>{title}</h3>
              <p lang={locale} dir="auto">
                {body}
              </p>
            </article>
          ))}
          <button className="secondary" onClick={onTools}>
            {c("استكشف دليل الأدوات", "Explore the tools directory")}
            <ArrowUpRight size={17} />
          </button>
          <button className="secondary" onClick={onAgents}>
            {c("استكشف الوكلاء", "Explore agents")}
            <ArrowUpRight size={17} />
          </button>
        </div>
      </div>
    </section>
  );
}
const paperclipNotices = {
  pending: ["سبق إرسال هذه التجربة أو أن إرسالها قيد التحقق. راجع بيبركليب قبل المحاولة يدويًا.", "This run was already sent or its outcome is pending verification. Check Paperclip before manually retrying."],
  failed: ["تعذّر إكمال الإرسال. إذا بدأت محاولة إرسال، راجع بيبركليب؛ لا نكررها تلقائيًا لتجنب الازدواج.", "Unable to complete the request. Check Paperclip if a send was attempted; it is not repeated automatically."],
  downloaded: ["تم تنزيل مسودة المهمة.", "Issue draft downloaded."],
  created: ["أُنشئت مسودة المراجعة في بيبركليب.", "Review draft created in Paperclip."],
} satisfies Record<string, [string, string]>;

export function PaperclipPanel({
  locale,
  runId,
}: {
  locale: Locale;
  runId?: string;
}) {
  const c = language(locale),
    [ready, setReady] = useState(false),
    [host, setHost] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState<{ kind: keyof typeof paperclipNotices; id?: string } | null>(null);
  useEffect(() => {
    fetch("/api/integrations/paperclip")
      .then((r) => r.json())
      .then((value) => {
        const d = value as { ready?: boolean; host?: string };
        setReady(!!d.ready);
        setHost(d.host || "");
      })
      .catch(() => {});
  }, []);
  async function submit(action: "download" | "send") {
    if (!runId) return;
    setBusy(true);
    setNotice(null);
    try {
      const r = await fetch("/api/integrations/paperclip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId, action }),
      });
      const d = (await r.json()) as {
        previous?: unknown;
        issue?: unknown;
        id?: string;
      };
      if (!r.ok) {
        if (r.status === 409 && d.previous) throw new Error("PENDING");
        throw new Error("FAILED");
      }
      if (action === "download") {
        const blob = new Blob([JSON.stringify(d.issue, null, 2)], {
            type: "application/json",
          }),
          url = URL.createObjectURL(blob),
          a = document.createElement("a");
        a.href = url;
        a.download = "hessara-paperclip-issue.json";
        a.click();
        URL.revokeObjectURL(url);
        setNotice({ kind: "downloaded" });
      } else
        setNotice({ kind: "created", id: d.id });
    } catch (e) {
      setNotice({ kind: (e as Error).message === "PENDING" ? "pending" : "failed" });
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="paperclip-panel"
      id="paperclip"
      lang={locale}
      dir={isRTL(locale) ? "rtl" : "ltr"}
    >
      <span className="eyebrow">
        {c("ربط نتائج التقييم بفريقك", "CONNECTED WORK / PAPERCLIP")}
      </span>
      <h2>
        {c("اجعل نتائجك بداية لعمل أفضل.", "Let results lead to better work.")}
      </h2>
      <p>
        {c(
          "ينشئ التكامل مسودة مهمة تحتوي على مقاييس التجربة وخطوات مراجعتها، دون مفاتيح الاتصال أو نصوص إجابات النماذج، ودون إسناد تلقائي إلى وكيل.",
          "Create a draft task with experiment metrics and review steps, without API keys, response bodies or automatic agent assignment.",
        )}
      </p>
      <ol>
        <li>
          {c(
            "شغّل تجربة أو افتح تجربة محفوظة.",
            "Run or open a saved experiment.",
          )}
        </li>
        <li>
          {c(
            "نزّل مسودة البيانات المنظّمة، أو أرسلها إلى خادمك المهيّأ.",
            "Download the JSON draft, or send it to your configured server.",
          )}
        </li>
        <li>
          {c(
            "راجع المهمة في بيبركليب ثم اسندها إلى فريقك مع ميزانية واضحة.",
            "Review it in Paperclip, then assign it with an explicit budget.",
          )}
        </li>
      </ol>
      <p className="notice">
        {ready
          ? c("وجهة الإرسال: ", "Sending destination: ") + host
          : c(
              "الربط المباشر غير مهيّأ بعد. تنزيل المهمة متاح عند اختيار تجربة؛ تعليمات إعداد الخادم مرفقة مع المشروع.",
              "Direct connection is not configured. Draft download is available for a selected run; server setup instructions ship with the project.",
            )}
      </p>
      {!runId && (
        <p className="form-help">
          {c(
            "افتح تجربة من قسم التجارب لتفعيل التصدير.",
            "Open a run from Experiments to enable export.",
          )}
        </p>
      )}
      <div className="feature-actions">
        <button
          className="secondary"
          aria-busy={busy}
          disabled={!runId || busy}
          onClick={() => submit("download")}
        >
          <ArrowDownToLine size={17} />
          {c("تنزيل مهمة بيبركليب", "Download Paperclip task")}
        </button>
        <button
          className="primary"
          aria-busy={busy}
          disabled={!runId || !ready || busy}
          onClick={() => submit("send")}
        >
          {c("إرسال مسودة مراجعة", "Send review draft")}
        </button>
        <External href="https://github.com/paperclipai/paperclip">
          {c("المستودع الرسمي", "Official repository")}
        </External>
        <External href="https://docs.paperclip.ing/reference/api/issues/">
          {c("وثائق الربط", "Integration docs")}
        </External>
      </div>
      {notice && (
        <p role="status" className="notice">
          {c(...paperclipNotices[notice.kind])}{notice.id ? <> <bdi>{notice.id}</bdi></> : null}
        </p>
      )}
    </section>
  );
}


