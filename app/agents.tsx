"use client";
import { agentLanguage as language } from "@/lib/agent-locales";

import { useMemo, useState } from "react";
import { ArrowUpRight, ArrowLeft, Search } from "lucide-react";
import { CATEGORIES, type Category } from "@/lib/benchmarks";
import { AGENTS, type AgentCategory } from "@/lib/agent-catalog";
import { agentDescription } from "@/lib/agent-catalog-locales";
import { translate, type Locale } from "@/lib/i18n";
import { AssistantStudio } from "./assistant-studio";
import { PersonalAgents } from "./personal-agents";
import { SuperAgentMascot } from "./super-agent-mascot";
import { mascotMotionLabel } from "@/lib/agent-mascot-config";
import './agent-directory-cards.css';

const categories: { id: AgentCategory | "all"; ar: string; en: string }[] = [
  { id: "all", ar: "الكل", en: "All" },
  { id: "decision", ar: "القرار", en: "Decisions" },
  { id: "personal", ar: "المساعدون الشخصيون", en: "Personal assistants" },
  { id: "orchestration", ar: "بناء الوكلاء", en: "Agent building" },
  { id: "specialist", ar: "وكلاء متخصصون", en: "Specialists" },
];

type Decision = {
  engine: "jev" | "laya";
  category: Category;
  confidence: number | null;
  model: string | null;
};

export function AgentsPanel({
  locale,
  onCreate,
  onPaperclip,
  onTools,
  sessionMode='none',
}: {
  locale: Locale;
  onCreate: (category: Category) => void;
  onPaperclip: () => void;
  onTools: () => void;
  sessionMode?:'guest'|'account'|'none';
}) {

  const c = language(locale);
  const [filter, setFilter] = useState<AgentCategory | "all">("all");
  const [search, setSearch] = useState("");
  const [engine, setEngine] = useState<"jev" | "laya">("jev");
  const [state, setState] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<[string, string] | null>(null);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [mascotMotionPaused, setMascotMotionPaused] = useState(false);
  const shown = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    return AGENTS.filter(
      (item) =>
        !["openclaw", "letta"].includes(item.id) &&
        (filter === "all" || item.category === filter) &&
        (!needle ||
          [item.name, item.summaryAr, item.summaryEn, agentDescription(item, locale)]
            .join(" ")
            .toLocaleLowerCase()
            .includes(needle)),
    );
  }, [filter, search, locale]);

  async function decide(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setDecision(null);
    if (state.trim().length < 12) {
      setError(
        ["اكتب وصفًا لا يقل عن ١٢ حرفًا.", "Write at least 12 characters."],
      );
      return;
    }
    if (engine === "jev" && !apiKey.trim()) {
      setError(["أضف مفتاح خدمة jev أولًا.", "Add your jev API key first."]);
      return;
    }
    if (engine === "laya" && !endpoint.trim()) {
      setError(
        ["أضف رابط خادم Laya الآمن أولًا.", "Add your secure Laya server URL first."],
      );
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/decisions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ engine, state, apiKey, endpoint }),
      });
      const payload = (await response.json()) as Decision & { error?: string };
      if (!response.ok) {
        const messages: Record<string, [string, string]> = {
          AUTH_REQUIRED: [
            "سجّل الدخول لتجربة محرك القرار.",
            "Sign in to use the decision engine.",
          ],
          NOT_READY: [
            "الربط غير مكتمل. تحقق من المفتاح أو رابط الخادم.",
            "Check the key or server URL.",
          ],
          INVALID_INPUT: [
            "راجع الوصف والرابط المُدخل ثم حاول مجددًا.",
            "Check the description and URL.",
          ],
          PROVIDER_AUTH: [
            "رفضت الخدمة مفتاح الاتصال.",
            "The service rejected the API key.",
          ],
          PROVIDER_UNAVAILABLE: [
            "الخدمة الخارجية غير متاحة الآن.",
            "The external service is unavailable.",
          ],
          PROVIDER_RESPONSE: [
            "أعادت الخدمة ردًا غير متوقع.",
            "The service returned an unexpected response.",
          ],
        };
        const message = messages[payload.error || ""];
        setError(message ?? ["تعذّر إتمام الطلب.", "Unable to complete the request."]);
        return;
      }
      setDecision(payload);
    } catch {
      setError(["تعذّر إتمام الطلب.", "Unable to complete the request."]);
    } finally {
      setBusy(false);
    }
  }

  const selectedCategory = decision
    ? CATEGORIES.find((category) => category.id === decision.category)
    : null;

  return (
    <div className="agents-page" lang={locale}>


      <div className="agent-mascot-motion-controls"><button type="button" aria-pressed={mascotMotionPaused} onClick={() => setMascotMotionPaused(value => !value)}>{mascotMotionLabel(locale, mascotMotionPaused)}</button></div>
      <AssistantStudio locale={locale} motionPaused={mascotMotionPaused} />
      <PersonalAgents locale={locale} sessionMode={sessionMode} motionPaused={mascotMotionPaused} />

      <section className="decision-studio" aria-labelledby="decision-title">
        <div className="decision-heading">
          <span className="decision-kicker">
            {c("خطوة عملية", "A PRACTICAL STEP")}
          </span>
          <h3 id="decision-title">
            {c(
              "ما الذي ينبغي اختباره أولًا؟",
              "What should you evaluate first?",
            )}
          </h3>
          <p>
            {c(
              "صف المهمة التي تهمّك. يقترح jev أو Laya فئةً من مكتبة اختبارات Hessara؛ راجع الاقتراح قبل بدء التجربة.",
              "Describe your task. Jev or Laya suggests a category from Hessara’s benchmark library; review it before starting a run.",
            )}
          </p>
          <div className="decision-provenance">
            <span>
              {c(
                "مدخلاتك تُرسل إلى الخدمة التي تختارها فقط عند الضغط على زر الاقتراح.",
                "Your input is sent to your chosen service only when you request a suggestion.",
              )}
            </span>
          </div>
        </div>
        <form className="decision-form" onSubmit={decide}>
          <div
            className="decision-engine"
            role="group"
            aria-label={c("محرك القرار", "Decision engine")}
          >
            {(["jev", "laya"] as const).map((item) => (
              <button
                key={item}
                type="button"
                aria-pressed={engine === item}
                onClick={() => {
                  setEngine(item);
                  setDecision(null);
                  setError(null);
                  setApiKey("");
                }}
              >
                {item === "jev" ? "jev" : "Laya Decision"}
              </button>
            ))}
          </div>
          <label htmlFor="decision-state">
            {c("صف ما تريد قياسه", "Describe what you need to measure")}
          </label>
          <textarea
            id="decision-state"
            value={state}
            onChange={(event) => setState(event.target.value)}
            maxLength={4000}
            rows={4}
            placeholder={c(
              "مثال: أحتاج نموذجًا يستخرج معلومة محددة من مستند طويل دون أن يختلقها.",
              "For example: I need a model that reliably finds facts in a long document.",
            )}
          />
          {engine === "laya" && (
            <>
              <label htmlFor="laya-endpoint">
                {c("رابط خادم Laya الخاص بك", "Your Laya server URL")}
              </label>
              <input
                id="laya-endpoint"
                type="url"
                value={endpoint}
                onChange={(event) => setEndpoint(event.target.value)}
                placeholder="https://example.com/v1/systemone"
                autoComplete="off"
                spellCheck={false}
              />
              <p className="decision-hint">
                {c(
                  "يلزم خادم Laya منشور عبر اتصال آمن. التشغيل المحلي وحده لا يتصل بهذا الموقع.",
                  "Laya needs a server reachable over HTTPS. A local-only server cannot be reached from this site.",
                )}
              </p>
            </>
          )}
          <label htmlFor="decision-key">
            {engine === "jev"
              ? c("مفتاح خدمة jev", "Jev API key")
              : c("مفتاح خادم Laya، إن وُجد", "Laya server key, if configured")}
          </label>
          <input
            id="decision-key"
            type="password"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            placeholder={c(
              "لا يُحفظ المفتاح في حسابك",
              "Not saved to your account",
            )}
          />
          <div className="decision-form-foot">
            <span>
              {c(
                "لا تُحفظ هذه البيانات أو المفاتيح في Hessara.",
                "Hessara does not store this input or key.",
              )}
            </span>
            <button className="primary" type="submit" disabled={busy}>
              {busy
                ? c("جارٍ التحليل…", "Analyzing…")
                : c("اقترح فئة اختبار", "Suggest a category")}
            </button>
          </div>
          {error && (
            <p className="decision-error" role="alert">
              {c(...error)}
            </p>
          )}
          {decision && selectedCategory && (
            <div className="decision-result" role="status">
              <span>{c("الفئة المقترحة", "SUGGESTED CATEGORY")}</span>
              <strong>
                {translate(locale, selectedCategory.id)}
              </strong>
              <p>{translate(locale, selectedCategory.id + "Description")}</p>
              {decision.confidence !== null && (
                <small>
                  {c("مؤشر ثقة المحرك", "Engine confidence")}:{" "}
                  {Math.round(decision.confidence * 100)}% ·{" "}
                  {c(
                    "لا يصلح للمقارنة بين المحركين",
                    "Do not compare across engines",
                  )}
                </small>
              )}
              <button
                type="button"
                onClick={() => onCreate(selectedCategory.id)}
              >
                {c("أنشئ تجربة لهذه الفئة", "Create a run for this category")}{" "}
                <ArrowLeft size={16} aria-hidden="true" />
              </button>
            </div>
          )}
        </form>
      </section>

      <section
        className="agent-directory"
        aria-labelledby="agent-directory-title"
      >
        <div className="agent-directory-head">
          <div>
            <p className="kicker">{c("دليل عملي", "A PRACTICAL DIRECTORY")}</p>
            <h3 id="agent-directory-title">
              {c(
                "اختر الوكيل المناسب لعملك",
                "Find the right agent for your work",
              )}
            </h3>
            <p>
              {c(
                "كل اسم يقود مباشرة إلى مشروعه الأصلي. يشير الوصف إلى ما يمكن ربطه داخل Hessara وما يحتاج تشغيلًا مستقلًا.",
                "Each name links to its source project. Labels show what connects here and what needs separate setup.",
              )}
            </p>
          </div>
          <label className="agent-search">
            <Search size={18} aria-hidden="true" />
            <span className="sr-only">
              {c("ابحث في الوكلاء", "Search agents")}
            </span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={c(
                "ابحث عن وكيل أو استخدام…",
                "Search agents or uses…",
              )}
            />
          </label>
        </div>
        <div
          className="agent-filters"
          role="group"
          aria-label={c("تصفية الوكلاء", "Filter agents")}
        >
          {categories.map((item) => (
            <button
              key={item.id}
              aria-pressed={filter === item.id}
              onClick={() => setFilter(item.id)}
            >
              {c(item.ar, item.en)}
            </button>
          ))}
        </div>
        <div className="agent-list">
          {shown.map((item, index) => (
            <article className="agent-row" key={item.id} data-agent-id={item.id} tabIndex={-1}>
              <span className="agent-index" aria-hidden="true">
                {String(index + 1).padStart(2, "0")}
              </span>
              <div className="agent-directory-symbol">
                <SuperAgentMascot agentId={item.id} compact motionPaused={mascotMotionPaused} />
              </div>
              <div className="agent-description">
                <div className="agent-name-line">
                  <h4 lang="en" dir="ltr">
                    {item.name}
                  </h4>
                  <span>
                    {item.mode === "connected"
                      ? c("تكامل يحتاج إعدادًا", "Integration requires setup")
                      : item.mode === "selfhost"
                        ? c("تشغيل مستقل", "Separate setup")
                        : item.mode === "framework"
                          ? c("إطار تطوير", "Developer framework")
                          : c("External product · not integrated with HESSARA", "External product · not integrated with HESSARA")}
                  </span>
                </div>
                <p>{agentDescription(item, locale)}</p>
                {item.releaseDate && <small className="agent-release-date">{c("First released: ", "First released: ")}{new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${item.releaseDate}T00:00:00Z`))}</small>}
              </div>
              <div className="agent-row-actions">
                {item.id === "paperclip" && (
                  <button onClick={onPaperclip}>
                    {c("تكامل Hessara", "Hessara integration")}
                  </button>
                )}
                {(item.id === "jev" || item.id === "laya") && (
                  <button
                    onClick={() =>
                      document
                        .getElementById("decision-title")
                        ?.scrollIntoView({
                          behavior: window.matchMedia(
                            "(prefers-reduced-motion: reduce)",
                          ).matches
                            ? "auto"
                            : "smooth",
                        })
                    }
                  >
                    {c("إعداد الاتصال", "Configure connection")}
                  </button>
                )}
                <a href={item.url} target="_blank" rel="noopener noreferrer">
                  {item.mode === "external" ? c("المنتج الرسمي", "Official product") : c("المشروع الأصلي", "Source project")}{" "}
                  <ArrowUpRight size={16} aria-hidden="true" />
                </a>
              </div>
              <details className="agent-activation">
                <summary>{c("طريقة التفعيل", "Activation guide")}</summary>
                <p>{item.mode === "external" ? c("This product requires an eligible provider account and runs outside HESSARA. Access, pricing, regions and limits are controlled by the provider.", "This product requires an eligible provider account and runs outside HESSARA. Access, pricing, regions and limits are controlled by the provider.") : item.id === "jev" ? c("أنشئ مفتاحًا من خدمة jev، ثم اختر jev في مساحة القرار أعلاه وأدخل وصف المهمة والمفتاح.", "Create a jev key, select jev in the decision workspace above, and enter your task description and key.") : item.id === "laya" ? c("شغّل Laya باتباع توثيق المشروع، وانشره عبر اتصال آمن. اختر Laya في مساحة القرار وأدخل رابط خادمك ومفتاحه إن وجد.", "Set up Laya using its documentation and publish it over HTTPS. Select Laya above and enter your server URL and key, if configured.") : item.id === "paperclip" ? c("أعدّ خادم بيبركليب وحسابك، ثم افتح تكامل Hessara من الزر أعلاه لإرسال مسودة مراجعة لتجربة مكتملة.", "Set up your Paperclip server and account, then open the Hessara integration above to send a review draft for a completed run.") : item.mode === "framework" ? c("افتح المشروع الأصلي، واتبع دليل البدء السريع لتثبيت الإطار في بيئة تطويرك. أضف مفاتيح النماذج والأدوات التي تحتاجها ثم شغّل المثال الأول. هذا الإطار يعمل في تطبيقك، وليس داخل حساب Hessara.", "Open the source project and follow its quickstart in your development environment. Add the model and tool keys you need, then run the first example. This framework runs in your application, not inside your Hessara account.") : c("افتح توثيق المشروع الأصلي وثبّت المتطلبات المناسبة لنظامك. شغّل الوكيل في بيئة منفصلة، وأضف مفاتيح الخدمات والصلاحيات التي تحتاجها مهمتك فقط. التشغيل وإدارة الملفات يتمان في بيئتك الخاصة.", "Follow the source project documentation and install the requirements for your system. Run the agent separately, granting only the service keys and permissions your task needs. Execution and file management happen in your own environment.")}</p>
                <a href={item.url} target="_blank" rel="noopener noreferrer">{c("افتح التوثيق وخطوات الإعداد", "Open setup documentation")}</a>
              </details>
            </article>
          ))}
          {!shown.length && (
            <p className="agent-empty">
              {c(
                "لا توجد نتائج مطابقة. جرّب كلمة أخرى.",
                "No matching agents. Try another search.",
              )}
            </p>
          )}
        </div>
        <p className="agent-availability">
          {c(
            "الوكلاء الخارجيون مشاريع مستقلة؛ لا يعني إدراجها أن Hessara تشغّلها أو تدير حساباتها. يتطلّب OpenClaw وأمثاله إعدادًا شخصيًا معزولًا.",
            "External agents are independent projects. Listing does not mean Hessara runs them or manages their accounts. OpenClaw and similar tools need personal, isolated setup.",
          )}
        </p>
        <button className="agent-more" onClick={onTools}>
          {c(
            "استعرض مزيدًا من الوكلاء ضمن دليل الأدوات",
            "Browse more agents in the tools directory",
          )}{" "}
          <ArrowUpRight size={16} aria-hidden="true" />
        </button>
      </section>

      <aside className="security-note">
        <span>{c("أمان التكاملات", "INTEGRATION SECURITY")}</span>
        <p>
          {c(
            "راجعنا ربط خدمات القرار وفق إرشادات Cloudflare: عنوان آمن، طلبات محدودة، ومنع إعادة التوجيه. مهارة المراجعة نفسها أداة للمطورين وليست خدمة تنفيذ داخل الموقع.",
            "Decision integrations follow Cloudflare audit guidance: secure URLs, bounded requests and no redirects. The audit skill is a developer resource, not a runtime service.",
          )}
        </p>
        <a
          href="https://github.com/cloudflare/security-audit-skill"
          target="_blank"
          rel="noopener noreferrer"
        >
          {c("افتح مهارة مراجعة الأمان", "Open security audit skill")}{" "}
          <ArrowUpRight size={16} aria-hidden="true" />
        </a>
      </aside>
    </div>
  );
}

