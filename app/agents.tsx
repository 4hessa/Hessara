"use client";

import { useMemo, useState } from "react";
import { ArrowUpRight, ArrowLeft, Search, Sparkles } from "lucide-react";
import { CATEGORIES, type Category } from "@/lib/benchmarks";
import { AGENTS, type AgentCategory } from "@/lib/agent-catalog";
import { type Locale } from "@/lib/i18n";

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
}: {
  locale: Locale;
  onCreate: (category: Category) => void;
  onPaperclip: () => void;
  onTools: () => void;
}) {
  const ar = locale === "ar";
  const c = (arabic: string, english: string) => (ar ? arabic : english);
  const [filter, setFilter] = useState<AgentCategory | "all">("all");
  const [search, setSearch] = useState("");
  const [engine, setEngine] = useState<"jev" | "laya">("jev");
  const [state, setState] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [decision, setDecision] = useState<Decision | null>(null);
  const shown = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    return AGENTS.filter(
      (item) =>
        (filter === "all" || item.category === filter) &&
        (!needle ||
          [item.name, item.summaryAr, item.summaryEn]
            .join(" ")
            .toLocaleLowerCase()
            .includes(needle)),
    );
  }, [filter, search]);

  async function decide(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setDecision(null);
    if (state.trim().length < 12) {
      setError(
        c("اكتب وصفًا لا يقل عن ١٢ حرفًا.", "Write at least 12 characters."),
      );
      return;
    }
    if (engine === "jev" && !apiKey.trim()) {
      setError(c("أضف مفتاح خدمة jev أولًا.", "Add your jev API key first."));
      return;
    }
    if (engine === "laya" && !endpoint.trim()) {
      setError(
        c(
          "أضف رابط خادم Laya الآمن أولًا.",
          "Add your secure Laya server URL first.",
        ),
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
        throw new Error(
          message
            ? c(...message)
            : c("تعذّر إتمام الطلب.", "Unable to complete the request."),
        );
      }
      setDecision(payload);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : c("تعذّر إتمام الطلب.", "Unable to complete the request."),
      );
    } finally {
      setBusy(false);
    }
  }

  const selectedCategory = decision
    ? CATEGORIES.find((category) => category.id === decision.category)
    : null;

  return (
    <div className="agents-page" lang={ar ? "ar" : "en"}>
      <header className="agents-lead">
        <div>
          <p className="kicker">{c("أبعد من المقارنة", "BEYOND COMPARISON")}</p>
          <h2>
            {c(
              "وكلاء خارقون، وقرارات أوضح.",
              "Agents for more thoughtful work.",
            )}
          </h2>
          <p>
            {c(
              "اختر اختبارًا يلائم حاجتك بمساعدة محرك قرار، ثم اكتشف أدوات الوكلاء التي يمكنك تشغيلها وربطها بعملك.",
              "Choose an evaluation task with a decision engine, then explore agents you can run or connect to your work.",
            )}
          </p>
        </div>
        <span
          className="agents-count"
          aria-label={c(
            `${AGENTS.length} مشروعًا`,
            `${AGENTS.length} projects`,
          )}
        >
          <strong>{AGENTS.length}</strong>
          <span>{c("مشروعًا موثقًا", "documented projects")}</span>
        </span>
      </header>

      <section className="decision-studio" aria-labelledby="decision-title">
        <div className="decision-heading">
          <span className="decision-kicker">
            <Sparkles size={17} aria-hidden="true" />{" "}
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
                  setError("");
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
              {error}
            </p>
          )}
          {decision && selectedCategory && (
            <div className="decision-result" role="status">
              <span>{c("الفئة المقترحة", "SUGGESTED CATEGORY")}</span>
              <strong>
                {ar ? selectedCategory.name : selectedCategory.en}
              </strong>
              <p>{ar ? selectedCategory.description : selectedCategory.en}</p>
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
              {ar ? item.ar : item.en}
            </button>
          ))}
        </div>
        <div className="agent-list">
          {shown.map((item, index) => (
            <article className="agent-row" key={item.id}>
              <span className="agent-index" aria-hidden="true">
                {String(index + 1).padStart(2, "0")}
              </span>
              <div className="agent-description">
                <div className="agent-name-line">
                  <h4 lang="en" dir="ltr">
                    {item.name}
                  </h4>
                  <span>
                    {item.mode === "connected"
                      ? c("ربط داخل المنصة", "Connect in Hessara")
                      : item.mode === "selfhost"
                        ? c("تشغيل مستقل", "Separate setup")
                        : c("إطار تطوير", "Developer framework")}
                  </span>
                </div>
                <p>{ar ? item.summaryAr : item.summaryEn}</p>
              </div>
              <div className="agent-row-actions">
                {item.id === "paperclip" && (
                  <button onClick={onPaperclip}>
                    {c("تكامل Hessara", "Hessara integration")}
                  </button>
                )}
                {item.category === "decision" && (
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
                    {c("جرّبه هنا", "Try it here")}
                  </button>
                )}
                <a href={item.url} target="_blank" rel="noopener noreferrer">
                  {c("المشروع الأصلي", "Source project")}{" "}
                  <ArrowUpRight size={16} aria-hidden="true" />
                </a>
              </div>
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
