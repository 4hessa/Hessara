"use client";
import { useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowUpRight,
  BarChart3,
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  FlaskConical,
  Globe2,
  KeyRound,
  Plus,
  Play,
  Search,
  ShieldCheck,
  Square,
  X,
  RefreshCw,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogClose,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Toaster, toast } from "sonner";
import {
  CATEGORIES,
  TASKS,
  DEMO_MODELS,
  VERSION,
  metrics,
  getTask,
  type Model,
  type Trial,
  type Task,
} from "@/lib/benchmarks";
import { LANGUAGES, isRTL, translate, type Locale } from "@/lib/i18n";
import {
  LLMDirectory,
  ToolsDirectory,
  HowWork,
  PaperclipPanel,
} from "./discover";
import { NvidiaStart } from "./nvidia-start";
import { PointerMotion } from "./pointer-motion";
import { heroCopy } from "./hero-copy";
import { HeroArt } from "./hero-art";
import { AgentsPanel } from "./agents";
import { displayName, ARABIC_LANGUAGES } from "@/lib/display-names";
type Run = {
  id: string;
  name: string;
  mode: string;
  status: string;
  created_at: string;
  config: string;
  total: number;
  done: number;
};
type ApiData = {
  error?: string;
  pauseReason?: string | null;
  runs: Run[];
  models: Model[];
  run: Run;
  trials: Trial[];
  pagination?: {
    offset: number;
    limit: number;
    total: number;
    nextOffset: number | null;
  };
  vaultReady?: boolean;
};
async function api(path: string, body?: unknown): Promise<ApiData> {
  const response = await fetch(
    "/api/" + path,
    body
      ? {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }
      : undefined,
  );
  const data = (await response.json()) as ApiData;
  if (!response.ok) throw new Error(data.error ?? "UNAVAILABLE");
  return data;
}
const providerColors: Record<string, string> = {
  simulation: "#775b6e",
  nvidia: "#957d86",
  openrouter: "#547773",
  openai: "#775b6e",
  anthropic: "#547773",
  gemini: "#957d86",
};
export default function Workspace() {
  const [locale, setLocale] = useState<Locale>("ar"),
    [view, setView] = useState("overview");
  const [runs, setRuns] = useState<Run[]>([]),
    [models, setModels] = useState<Model[]>(DEMO_MODELS),
    [trials, setTrials] = useState<Trial[]>([]),
    [selected, setSelected] = useState<Run | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [vaultReady, setVaultReady] = useState(false);
  const [runDialog, setRunDialog] = useState(false),
    [modelDialog, setModelDialog] = useState(false),
    [busy, setBusy] = useState(false),
    [active, setActive] = useState(false);
  const [name, setName] = useState(""),
    [mode, setMode] = useState("demo"),
    [chosen, setChosen] = useState(DEMO_MODELS.map((m) => m.id)),
    [cats, setCats] = useState<string[]>(CATEGORIES.map((c) => c.id)),
    [count, setCount] = useState("40"),
    [repeats, setRepeats] = useState("3");
  const [query, setQuery] = useState(""),
    [task, setTask] = useState<Task | null>(null),
    [result, setResult] = useState<Trial | null>(null),
    [category, setCategory] = useState("all"),
    [failureOnly, setFailureOnly] = useState(false);
  const [connection, setConnection] = useState({
    name: "",
    provider: "openai",
    model: "",
    apiKey: "",
    inputPrice: "",
    outputPrice: "",
  });
  const stop = useRef(false),
    execution = useRef(false),
    current = useRef<string | null>(null),
    initialized = useRef(false),
    trialsCache = useRef<Trial[]>([]);
  const t = (key: string) => translate(locale, key),
    dir = isRTL(locale) ? "rtl" : "ltr",
    format = (n: number, d = 1) =>
      new Intl.NumberFormat(locale, { maximumFractionDigits: d }).format(n);
  const message = (code: string) =>
    t("error_" + code) === "error_" + code ? t("error") : t("error_" + code);
  const visibleModels = models.map((m) => ({
    ...m,
    name: displayName(m.name, locale),
    label:
      m.provider === "simulation"
        ? t(
            m.id === "sim-atlas"
              ? "balancedSimulator"
              : m.id === "sim-swift"
                ? "fastSimulator"
                : "analyticalSimulator",
          )
        : m.ready
          ? m.label
          : t("notConnected"),
    color:
      m.provider === "simulation"
        ? (
            {
              "sim-atlas": "#775b6e",
              "sim-swift": "#957d86",
              "sim-prism": "#547773",
            } as Record<string, string>
          )[m.id]
        : (providerColors[m.provider] ?? m.color),
  }));
  const snapshotModels = selected
    ? (JSON.parse(selected.config).modelSnapshots ?? [])
    : [];
  const measuredModels = [
    ...snapshotModels.map((m: Model & { model?: string }) => ({
      ...m,
      name: displayName(m.name, locale),
      color: providerColors[m.provider] ?? "#aaa",
      label: m.model ?? m.name,
      ready: true,
    })),
    ...visibleModels.filter(
      (m) => !snapshotModels.some((x: { id: string }) => x.id === m.id),
    ),
  ];
  const data = metrics(trials, measuredModels),
    demo = selected?.mode === "demo",
    completed = selected?.done ?? 0;
  const totalTasks = selected
    ? JSON.parse(selected.config).count *
      JSON.parse(selected.config).categories.length
    : 240;
  const available = visibleModels.filter(
    (m) => m.provider !== "simulation" && m.ready,
  );
  function showTrials(next: Trial[]) {
    trialsCache.current = next;
    setTrials(next);
  }
  async function readRun(id: string, first?: ApiData) {
    let page = first ?? (await api("runs/" + id));
    const rows = [...page.trials];
    while (page.pagination?.nextOffset != null) {
      page = await api(
        `runs/${id}?offset=${page.pagination.nextOffset}&limit=250`,
      );
      rows.push(...page.trials);
    }
    return { run: page.run, trials: rows };
  }
  async function readNewTrials(id: string, total: number) {
    const rows = [...trialsCache.current];
    while (rows.length < total) {
      const page = await api(`runs/${id}?offset=${rows.length}&limit=250`);
      if (!page.trials.length) break;
      rows.push(...page.trials);
    }
    return rows;
  }
  async function load(initial = false) {
    try {
      const [r, m] = await Promise.all([api("runs"), api("models")]);
      setRuns(r.runs);
      setModels(m.models);
      setVaultReady(!!m.vaultReady);
      setError("");
      if (initial && r.runs.length && !current.current) {
        const latest = await readRun(r.runs[0].id);
        current.current = latest.run.id;
        setSelected(latest.run);
        showTrials(latest.trials);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    try {
      const saved = localStorage.getItem("hessara:locale");
      if (LANGUAGES.some(([code]) => code === saved))
        setLocale(saved as Locale);
    } catch {}
    if (!initialized.current) {
      initialized.current = true;
      load(true);
    }
    return () => {
      stop.current = true;
    };
  }, []);
  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = isRTL(locale) ? "rtl" : "ltr";
    document.title =
      translate(locale, "brand") + " — " + translate(locale, "lab");
    try {
      localStorage.setItem("hessara:locale", locale);
    } catch {}
  }, [locale]);
  const pendingViewFocus = useRef(false);
  function navigateTo(next: string) {
    pendingViewFocus.current = true;
    setView(next);
  }
  useEffect(() => {
    if (!pendingViewFocus.current) return;
    pendingViewFocus.current = false;
    document
      .querySelector<HTMLElement>('.main-tabs [data-state="active"]')
      ?.focus();
  }, [view]);
  function newRun() {
    if (execution.current) return;
    setName(t("defaultRunName"));
    setRunDialog(true);
  }
  async function openRun(run: Run) {
    if (execution.current && current.current !== run.id) {
      toast.info(t("runningNotice"));
      return;
    }
    try {
      const d = await readRun(run.id);
      current.current = run.id;
      setSelected(d.run);
      showTrials(d.trials);
      setView("overview");
    } catch (e) {
      toast.error(message((e as Error).message));
    }
  }
  async function pump(id: string) {
    if (execution.current) return;
    execution.current = true;
    stop.current = false;
    setActive(true);
    try {
      while (!stop.current) {
        const d = await api("runs/" + id, { action: "step" });
        if (current.current === id) {
          const latest = await readNewTrials(
            id,
            d.pagination?.total ?? d.trials.length,
          );
          setSelected(d.run);
          showTrials(latest);
        }
        if (d.pauseReason) {
          toast.info(
            locale === "ar"
              ? "أُوقف التنفيذ مؤقتًا لأن المزوّد يحتاج إلى مراجعة المفتاح أو الحصة أو الطلب المعلّق. راجع نتيجة المحاولة قبل الاستئناف."
              : "Paused: check provider credentials, quota or pending request before resuming.",
          );
          break;
        }
        if (d.run.status !== "running") break;
      }
      await load();
    } catch (e) {
      toast.error(message((e as Error).message));
    } finally {
      execution.current = false;
      setActive(false);
    }
  }
  async function create() {
    setBusy(true);
    try {
      const d = await api("runs", {
        name,
        mode,
        models: chosen,
        categories: cats,
        count: +count,
        repeats: +repeats,
      });
      setRunDialog(false);
      setSelected(d.run);
      showTrials([]);
      current.current = d.run.id;
      setView("overview");
      setBusy(false);
      await pump(d.run.id);
    } catch (e) {
      toast.error(message((e as Error).message));
    } finally {
      setBusy(false);
    }
  }
  async function saveModel() {
    setBusy(true);
    try {
      const d = await api("models", {
        ...connection,
        inputPrice: connection.inputPrice.trim()
          ? Number(connection.inputPrice)
          : null,
        outputPrice: connection.outputPrice.trim()
          ? Number(connection.outputPrice)
          : null,
      });
      setModels(d.models);
      setModelDialog(false);
      setConnection({
        name: "",
        provider: "openai",
        model: "",
        apiKey: "",
        inputPrice: "",
        outputPrice: "",
      });
      toast.success(t("connectionSaved"));
    } catch (e) {
      toast.error(message((e as Error).message));
    } finally {
      setBusy(false);
    }
  }
  function exportData(format: "json" | "csv") {
    if (!selected) return;
    const payload = {
      provenance: demo ? "simulation" : "live",
      suite_version: JSON.parse(selected.config).suite_version,
      run: selected,
      metrics: data,
      tasks:
        JSON.parse(selected.config).suite_version === VERSION
          ? TASKS.filter((t) => trials.some((r) => r.task_id === t.id))
          : [],
      trials,
    };
    const text =
      format === "json"
        ? JSON.stringify(payload, null, 2)
        : "\uFEFF" +
          [
            "model,task,repeat,status,score,latency_ms,input_tokens,output_tokens,cost_usd",
            ...trials.map((r) =>
              [
                r.model,
                r.task_id,
                r.repeat,
                r.status,
                r.score ?? "",
                r.latency ?? "",
                r.input_tokens ?? "",
                r.output_tokens ?? "",
                r.cost ?? "",
              ].join(","),
            ),
          ].join("\n");
    const url = URL.createObjectURL(
      new Blob([text], {
        type: format === "json" ? "application/json" : "text/csv;charset=utf-8",
      }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `hessara-${selected.id}.${format}`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(t("downloaded"));
  }
  function chooseModel(id: string, value: boolean) {
    if (value && chosen.length >= 30) {
      toast.info(t("maxModels"));
      return;
    }
    setChosen(value ? [...chosen, id] : chosen.filter((x) => x !== id));
  }
  const title =
      view === "overview"
        ? t("mainTitle")
        : view === "llms"
          ? locale === "ar"
            ? "النماذج اللغوية"
            : "LLMs"
          : view === "agents"
            ? t("agents")
            : view === "tools"
              ? locale === "ar"
                ? "أدوات الذكاء الاصطناعي"
                : "Tools"
              : view === "how"
                ? locale === "ar"
                  ? "كيف تعمل المنصة"
                  : "How it works"
                : t(view),
    description =
      view === "overview"
        ? t("mainDescription")
        : ["llms", "agents", "tools", "how"].includes(view)
          ? locale === "ar"
            ? (
                {
                  llms: "اختر نماذجك على أساس واضح.",
                  agents:
                    "محركات قرار ووكلاء ومشاريع عملية تدعم ما بعد التقييم.",
                  tools: "دليل عملي لأدوات الذكاء الاصطناعي.",
                  how: "من السؤال الأول إلى القرار المبني على الدليل.",
                } as Record<string, string>
              )[view]
            : (
                {
                  llms: "Choose your models with evidence.",
                  agents:
                    "Decision engines and agents for work beyond evaluation.",
                  tools: "A practical directory of AI tools.",
                  how: "From a first question to an evidence-based decision.",
                } as Record<string, string>
              )[view]
          : t(
              view === "benchmarks"
                ? "libraryDescription"
                : view === "models"
                  ? "connectionDescription"
                  : view === "method"
                    ? "methodDescription"
                    : "allRuns",
            );
  const nvidiaPanel = (
    <NvidiaStart
      locale={locale}
      onLinked={(ids, linked) => {
        setModels(linked);
        setVaultReady(true);
        setChosen(ids);
        setMode("live");
        setName(
          locale === "ar" ? "مقارنة نماذج إنفيديا" : "NVIDIA model comparison",
        );
        setCount("4");
        setRepeats("1");
        setCats(["logic"]);
        setRunDialog(true);
      }}
    />
  );
  return (
    <div className="app" dir={dir} data-view={view} data-report={!!selected}>
      <a className="skip-link" href="#main-content">
        {t("skipContent")}
      </a>
      <PointerMotion />
      <Toaster position="bottom-center" dir={dir} />
      <header className="masthead">
        <a
          className="wordmark"
          href="/"
          aria-label={t("brand")}
          onClick={(event) => {
            event.preventDefault();
            if (execution.current) {
              toast.info(t("runningNotice"));
              return;
            }
            setSelected(null);
            setView("overview");
          }}
        >
          <img
            className="brand-symbol"
            src="/hessara-mark.png"
            alt=""
            width="56"
            height="56"
          />
          <strong lang="en" dir="ltr">
            Hessara
          </strong>
        </a>
        <div className="header-tools">
          <span className="privacy">
            <ShieldCheck size={15} />
            {t("private")}
          </span>
          <Globe2 size={17} />
          <Select value={locale} onValueChange={(v) => setLocale(v as Locale)}>
            <SelectTrigger
              aria-label={t("language")}
              className="language-select"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LANGUAGES.map(([code, label]) => (
                <SelectItem key={code} value={code}>
                  <span lang={locale === "ar" ? "ar" : code}>
                    {locale === "ar" ? ARABIC_LANGUAGES[code] : label}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </header>
      <Tabs value={view} onValueChange={setView} dir={dir}>
        <nav className="nav-shell" aria-label={t("workspace")}>
          <TabsList className="main-tabs">
            {[
              "overview",
              "llms",
              "agents",
              "runs",
              "tools",
              "benchmarks",
              "models",
              "how",
              "method",
            ].map((v) => (
              <TabsTrigger key={v} value={v}>
                {v === "llms"
                  ? locale === "ar"
                    ? "النماذج اللغوية"
                    : "LLMs"
                  : v === "tools"
                    ? locale === "ar"
                      ? "أدوات الذكاء الاصطناعي"
                      : "Tools"
                    : v === "how"
                      ? locale === "ar"
                        ? "كيف تعمل المنصة"
                        : "How it works"
                      : t(v)}
              </TabsTrigger>
            ))}
          </TabsList>
        </nav>
        <main id="main-content" className="content" tabIndex={-1}>
          <div className="intro">
            <div>
              <p className="kicker">{t("lab")}</p>
              <h1>{title}</h1>
              <p className="intro-description">{description}</p>
            </div>
            <button className="primary" onClick={newRun} disabled={active}>
              <Plus size={17} />
              {t("newRun")}
            </button>
          </div>
          {error &&
            !(
              error === "AUTH_REQUIRED" &&
              ["llms", "agents", "tools", "how"].includes(view)
            ) && (
              <div
                className={
                  error === "AUTH_REQUIRED" ? "notice" : "notice error"
                }
                role="alert"
              >
                <span>{message(error)}</span>
                {error === "AUTH_REQUIRED" ? (
                  <a href="/signin-with-chatgpt?return_to=/" target="_top">
                    {t("signIn")}
                  </a>
                ) : (
                  <button onClick={() => load()}>{t("retry")}</button>
                )}
              </div>
            )}
          <TabsContent value="llms" className="view-content">
            <LLMDirectory
              locale={locale}
              onCustom={() => {
                setConnection({
                  name: "",
                  provider: "openrouter",
                  model: "",
                  apiKey: "",
                  inputPrice: "",
                  outputPrice: "",
                });
                setModelDialog(true);
              }}
              onLinked={(ids, linked) => {
                setModels(linked);
                setChosen(ids);
                setMode("live");
                setName("");
                setRunDialog(true);
              }}
            />
          </TabsContent>
          <TabsContent value="agents" className="view-content">
            <AgentsPanel
              locale={locale}
              onCreate={(category) => {
                setCats([category]);
                newRun();
              }}
              onPaperclip={() => {
                navigateTo("tools");
                setTimeout(
                  () =>
                    document
                      .getElementById("paperclip")
                      ?.scrollIntoView({
                        behavior: window.matchMedia(
                          "(prefers-reduced-motion: reduce)",
                        ).matches
                          ? "auto"
                          : "smooth",
                      }),
                  80,
                );
              }}
              onTools={() => navigateTo("tools")}
            />
          </TabsContent>
          <TabsContent value="tools" className="view-content">
            <ToolsDirectory
              locale={locale}
              onPaperclip={() => {
                document.getElementById("paperclip")?.scrollIntoView({
                  behavior: window.matchMedia(
                    "(prefers-reduced-motion: reduce)",
                  ).matches
                    ? "auto"
                    : "smooth",
                });
              }}
            />
            <PaperclipPanel locale={locale} runId={selected?.id} />
          </TabsContent>
          <TabsContent value="how" className="view-content">
            <HowWork
              locale={locale}
              onStart={newRun}
              onModels={() => navigateTo("llms")}
              onTools={() => navigateTo("tools")}
              onAgents={() => navigateTo("agents")}
            />
          </TabsContent>
          <TabsContent value="overview" className="view-content">
            {!selected && (
              <>
                <section
                  className="meadow-welcome"
                  aria-labelledby="welcome-title"
                >
                  <div className="meadow-copy">
                    <span className="hero-eyebrow">{t("lab")}</span>
                    <h1 id="welcome-title">
                      {locale === "ar" ? (
                        <>
                          <span>وضوح أكثر</span>
                          <br />
                          في اختيار النموذج.
                        </>
                      ) : (
                        heroCopy[locale].headline
                      )}
                    </h1>
                    <p>{heroCopy[locale].description}</p>
                    <div className="hero-actions">
                      <button
                        className="primary"
                        onClick={newRun}
                        disabled={active}
                      >
                        {t("newRun")}
                        <ArrowUpRight size={17} />
                      </button>
                      <button
                        className="hero-secondary"
                        onClick={() => navigateTo("llms")}
                      >
                        {heroCopy[locale].explore}
                      </button>
                    </div>
                    <div className="hero-indicators">
                      <span>
                        <strong className="numeric">{format(30, 0)}</strong>
                        {heroCopy[locale].models}
                      </span>
                      <span>
                        <strong className="numeric">{format(317, 0)}</strong>
                        {heroCopy[locale].tools}
                      </span>
                      <span>
                        <strong className="numeric">{format(240, 0)}</strong>
                        {heroCopy[locale].tasks}
                      </span>
                    </div>
                  </div>
                  <HeroArt />
                </section>
                <section
                  className="agents-invitation"
                  aria-labelledby="agents-invitation-title"
                >
                  <div>
                    <p className="kicker">
                      {locale === "ar" ? "ما بعد التقييم" : "BEYOND EVALUATION"}
                    </p>
                    <h2 id="agents-invitation-title">{t("agents")}</h2>
                    <p>
                      {locale === "ar"
                        ? "من اختيار فئة الاختبار بمحرك قرار إلى اكتشاف وكلاء يمكن وصلهم بسير العمل: مساحة واحدة تقودك من القياس إلى الفعل."
                        : "Move from measurement to action with decision engines and a curated directory of agents."}
                    </p>
                  </div>
                  <button
                    className="secondary"
                    onClick={() => navigateTo("agents")}
                  >
                    {locale === "ar" ? "استكشف الوكلاء" : "Explore agents"}{" "}
                    <ArrowUpRight size={17} aria-hidden="true" />
                  </button>
                </section>
                <section
                  className="explore-section"
                  aria-labelledby="explore-title"
                >
                  <div className="explore-heading">
                    <div>
                      <p className="kicker">{t("workspace")}</p>
                      <h2 id="explore-title">{t("mainTitle")}</h2>
                    </div>
                    <p>{t("mainDescription")}</p>
                    <button
                      className="secondary"
                      onClick={() => navigateTo("how")}
                    >
                      {heroCopy[locale].how}
                      <ArrowUpRight size={16} />
                    </button>
                  </div>
                  <div className="explore-paths">
                    {[
                      {
                        title: heroCopy[locale].explore,
                        detail: t("comparison"),
                        icon: BarChart3,
                        target: "llms",
                      },
                      {
                        title: t("benchmarks"),
                        detail: t("sixCategories"),
                        icon: FlaskConical,
                        target: "benchmarks",
                      },
                      {
                        title: t("aiTools"),
                        detail: heroCopy[locale].tools,
                        icon: Search,
                        target: "tools",
                      },
                      {
                        title: t("method"),
                        detail: t("methodDescription"),
                        icon: ShieldCheck,
                        target: "method",
                      },
                    ].map(({ title, detail, icon: Icon, target }) => (
                      <button
                        className="explore-path"
                        key={target}
                        onClick={() => navigateTo(target)}
                      >
                        <span className="path-top">
                          <Icon size={23} strokeWidth={1.4} />
                          <ArrowUpRight size={17} />
                        </span>
                        <span className="path-title">{title}</span>
                        <span className="path-description">{detail}</span>
                      </button>
                    ))}
                  </div>
                </section>
                {nvidiaPanel}
              </>
            )}
            {selected && (
              <>
                <div className="experiment-toolbar">
                  <div className="experiment-name">
                    <span className="overline">{t("saved")}</span>
                    <h1>{selected.name}</h1>
                    <span className="quiet">
                      {new Date(selected.created_at).toLocaleString(locale)} ·{" "}
                      <b className={demo ? "sim-label" : "live-label"}>
                        {t(demo ? "demo" : "live")}
                      </b>
                    </span>
                  </div>
                  <div className="button-group">
                    <button
                      className="primary"
                      onClick={newRun}
                      disabled={active}
                    >
                      <Plus size={17} />
                      {t("newRun")}
                    </button>
                    <button
                      className="secondary"
                      onClick={() => exportData("json")}
                    >
                      <ArrowDownToLine size={16} />
                      {t("export")}
                    </button>
                  </div>
                </div>
                {selected.status === "running" && (
                  <div className="execution">
                    <div>
                      <span>{t(active ? "running" : "resumable")}</span>
                      <span className="numeric">
                        {format(completed, 0)} / {format(selected.total, 0)}
                      </span>
                      <button
                        className="secondary compact"
                        onClick={() =>
                          active
                            ? ((stop.current = true),
                              toast.info(t("pauseNotice")))
                            : pump(selected.id)
                        }
                      >
                        {active ? <Square size={13} /> : <Play size={13} />}{" "}
                        {t(active ? "pause" : "resume")}
                      </button>
                    </div>
                    <Progress value={(completed / selected.total) * 100} />
                    <p>{t("resumeNote")}</p>
                  </div>
                )}
                <div className="metric-strip">
                  <Metric
                    label={t("topQuality")}
                    value={data.length ? format(data[0].score) : "—"}
                    unit="/ 100"
                    note={
                      data.length
                        ? data[0].name + " · " + t("balanced")
                        : t("notAvailable")
                    }
                  />
                  <Metric
                    label={t("fastest")}
                    value={
                      data.some((m) => m.p50 !== null)
                        ? format(
                            Math.min(
                              ...data.flatMap((m) =>
                                m.p50 === null ? [] : [m.p50],
                              ),
                            ) / 1000,
                            2,
                          )
                        : "—"
                    }
                    unit={t("seconds")}
                    note={t("latencyNote")}
                  />
                  <Metric
                    label={t("tasks")}
                    value={format(totalTasks, 0)}
                    note={t("sixCategories")}
                  />
                  <Metric
                    label={t("measurements")}
                    value={format(completed, 0)}
                    note={t(demo ? "simulationNoApi" : "includesErrors")}
                  />
                </div>
                <div className="plots">
                  <section className="plot">
                    <Heading
                      title={t("performance")}
                      note={t("higherBetter")}
                    />
                    <div className="legend">
                      {data.map((m) => (
                        <span key={m.id}>
                          <i style={{ background: m.color }} />
                          {m.name}
                        </span>
                      ))}
                    </div>
                    <div className="category-chart">
                      {CATEGORIES.map((c) => (
                        <div className="category-column" key={c.id}>
                          <div className="bars">
                            {data.map((m) => {
                              const score = m.categories.find(
                                (x) => x.id === c.id,
                              )?.score;
                              return (
                                <div className="bar-track" key={m.id}>
                                  <div
                                    style={{
                                      height: `${score ?? 0}%`,
                                      background: m.color,
                                    }}
                                    className="bar"
                                    title={
                                      m.name +
                                      ": " +
                                      (score === null
                                        ? t("notAvailable")
                                        : format(score ?? 0))
                                    }
                                  />
                                </div>
                              );
                            })}
                          </div>
                          <span>{t(c.id)}</span>
                        </div>
                      ))}
                    </div>
                  </section>
                  <section className="speed-plot">
                    <Heading title={t("qualitySpeed")} note={t("tradeoff")} />
                    <div className="speed-rows">
                      {data.map((m) => (
                        <div className="speed-row" key={m.id}>
                          <strong>{m.name}</strong>
                          <div className="speed-rule">
                            <i
                              style={{
                                width: `${m.score}%`,
                                background: m.color,
                              }}
                            />
                          </div>
                          <span className="numeric">
                            {format(m.score)}
                            <small>/100</small>
                          </span>
                          <span className="numeric speed-time">
                            {m.p50 === null
                              ? "—"
                              : format(m.p50 / 1000, 2) + " " + t("seconds")}
                          </span>
                        </div>
                      ))}
                    </div>
                    <p className="plot-foot">
                      {t(demo ? "demoNotice" : "costNote")}
                    </p>
                  </section>
                </div>
                <section className="comparison">
                  <Heading
                    title={t("comparison")}
                    note={
                      selected.status === "running"
                        ? t("partial")
                        : t(demo ? "demoNotice" : "costNote")
                    }
                    aside={
                      <button
                        className="text-button"
                        onClick={() => exportData("csv")}
                      >
                        {t("csv")}
                        <ArrowDownToLine size={15} />
                      </button>
                    }
                  />
                  <Table>
                    <TableHeader>
                      <TableRow>
                        {[
                          "model",
                          "quality",
                          "p50",
                          "p95",
                          "consistency",
                          "tokens",
                          "errors",
                          "cost",
                        ].map((h) => (
                          <TableHead key={h}>{t(h)}</TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.map((m, i) => (
                        <TableRow key={m.id}>
                          <TableCell>
                            <div className="model-cell">
                              <span className="rank numeric">
                                {String(i + 1).padStart(2, "0")}
                              </span>
                              <span
                                className="model-letter"
                                style={{ color: m.color }}
                              >
                                {m.name[0]}
                              </span>
                              <div>
                                <strong>{m.name}</strong>
                                <small>{m.label}</small>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="score numeric">
                            {format(m.score)}
                          </TableCell>
                          <TableCell className="numeric">
                            {m.p50 === null
                              ? "—"
                              : format(m.p50 / 1000, 2) + " " + t("seconds")}
                          </TableCell>
                          <TableCell className="numeric">
                            {m.p95 === null
                              ? "—"
                              : format(m.p95 / 1000, 2) + " " + t("seconds")}
                          </TableCell>
                          <TableCell className="numeric">
                            {m.stability === null
                              ? "—"
                              : format(m.stability) + "%"}
                          </TableCell>
                          <TableCell className="numeric">
                            {m.tokens === null ? "—" : format(m.tokens, 0)}
                          </TableCell>
                          <TableCell className="numeric">
                            {format(m.errors, 0)}
                          </TableCell>
                          <TableCell className="numeric">
                            {m.cost === null ? "—" : "$" + format(m.cost, 4)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  {!data.length && <p className="empty-line">{t("loading")}</p>}
                </section>
                <section className="results">
                  <Heading
                    title={t("inspect")}
                    note={t("inspectNote")}
                    aside={
                      <label className="check-label">
                        <Checkbox
                          checked={failureOnly}
                          onCheckedChange={(v) => setFailureOnly(v === true)}
                        />
                        {t("failuresOnly")}
                      </label>
                    }
                  />
                  <div className="result-list">
                    {trials
                      .filter(
                        (r) =>
                          ["done", "error"].includes(r.status) &&
                          (!failureOnly || r.score !== 1),
                      )
                      .slice(0, 30)
                      .map((r) => (
                        <button
                          className="result-row"
                          key={r.id}
                          onClick={() => {
                            if (
                              selected &&
                              JSON.parse(selected.config).suite_version !==
                                VERSION
                            ) {
                              toast.error(t("error_VERSION"));
                              return;
                            }
                            setTask(getTask(r.task_id));
                            setResult(r);
                          }}
                        >
                          <span className={r.score === 1 ? "pass" : "fail"}>
                            {r.score === 1 ? (
                              <Check size={16} />
                            ) : (
                              <X size={16} />
                            )}
                          </span>
                          <span>
                            {t(getTask(r.task_id).category)} ·{" "}
                            {r.task_id.split("-")[1]}
                          </span>
                          <span className="result-model">
                            {measuredModels.find((m) => m.id === r.model)
                              ?.name ?? r.model}
                          </span>
                          <span className="numeric quiet">#{r.repeat + 1}</span>
                          {dir === "rtl" ? (
                            <ChevronLeft size={14} />
                          ) : (
                            <ChevronRight size={14} />
                          )}
                        </button>
                      ))}
                  </div>
                  <p className="footnote">{t("first30")}</p>
                </section>
              </>
            )}
          </TabsContent>
          <TabsContent value="runs">
            <Heading
              title={t("allRuns")}
              note={`${format(runs.length, 0)} ${t("runs")}`}
              aside={
                <button className="text-button" onClick={() => load()}>
                  <RefreshCw size={15} />
                  {t("refresh")}
                </button>
              }
            />
            {loading ? (
              <p className="empty-line">{t("loading")}</p>
            ) : runs.length ? (
              runs.map((r) => (
                <button
                  className="history-row"
                  key={r.id}
                  onClick={() => openRun(r)}
                >
                  <span className="history-icon">
                    <FlaskConical size={20} />
                  </span>
                  <div>
                    <strong>{r.name}</strong>
                    <small>
                      {new Date(r.created_at).toLocaleString(locale)} ·{" "}
                      {t(r.mode === "demo" ? "demo" : "live")}
                    </small>
                  </div>
                  <span className="numeric">
                    {format(r.done, 0)} / {format(r.total, 0)}
                  </span>
                  <span className="state-label">
                    {t(r.status === "completed" ? "completed" : "resumable")}
                  </span>
                  {dir === "rtl" ? (
                    <ChevronLeft size={17} />
                  ) : (
                    <ChevronRight size={17} />
                  )}
                </button>
              ))
            ) : (
              <div className="empty-state">
                <h2>{t("emptyTitle")}</h2>
                <p>{t("emptyDescription")}</p>
                <button className="primary" onClick={newRun}>
                  <Plus size={17} />
                  {t("newRun")}
                </button>
              </div>
            )}
          </TabsContent>
          <TabsContent value="benchmarks">
            <div className="library-layout">
              <div className="category-list">
                <button
                  className={category === "all" ? "selected" : ""}
                  onClick={() => setCategory("all")}
                >
                  {t("all")}
                  <span className="numeric">240</span>
                </button>
                {CATEGORIES.map((c) => (
                  <button
                    className={category === c.id ? "selected" : ""}
                    key={c.id}
                    onClick={() => setCategory(c.id)}
                  >
                    {t(c.id)}
                    <span className="numeric">40</span>
                  </button>
                ))}
                <p className="footnote">{t("promptLanguage")}</p>
              </div>
              <section className="library-main">
                <Heading
                  title={category === "all" ? t("explore") : t(category)}
                  note={
                    category === "all"
                      ? t("exploreDescription")
                      : t(category + "Description")
                  }
                />
                <div className="search-input">
                  <Search size={18} />
                  <input
                    aria-label={t("search")}
                    placeholder={t("search")}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </div>
                <div className="task-rows">
                  {TASKS.filter(
                    (r) =>
                      (category === "all" || r.category === category) &&
                      (t(r.category) + r.id)
                        .toLowerCase()
                        .includes(query.toLowerCase()),
                  ).map((r) => (
                    <button
                      key={r.id}
                      onClick={() => {
                        setTask(r);
                        setResult(null);
                      }}
                    >
                      <span className="task-id numeric">{r.id}</span>
                      <strong>
                        {t(r.category)} · {r.id.split("-")[1]}
                      </strong>
                      <span className="grader-label">
                        {t(r.grader === "json" ? "json" : "exact")}
                      </span>
                      {dir === "rtl" ? (
                        <ChevronLeft size={15} />
                      ) : (
                        <ChevronRight size={15} />
                      )}
                    </button>
                  ))}
                </div>
              </section>
            </div>
          </TabsContent>
          <TabsContent value="models">
            {nvidiaPanel}
            <section>
              <Heading
                title={t("connections")}
                note={t("keyHelp")}
                aside={
                  <button
                    className="primary"
                    onClick={() => setModelDialog(true)}
                  >
                    <Plus size={17} />
                    {t("addModel")}
                  </button>
                }
              />
              {!vaultReady && <p className="notice">{t("vaultUnavailable")}</p>}
              <div className="connection-list">
                {visibleModels
                  .filter((m) => m.provider !== "simulation")
                  .map((m) => (
                    <div className="connection-row" key={m.id}>
                      <span
                        className="model-letter"
                        style={{ color: providerColors[m.provider] }}
                      >
                        {m.name[0]}
                      </span>
                      <div>
                        <strong>{m.name}</strong>
                        <small>{m.ready ? m.label : t("notConnected")}</small>
                      </div>
                      <span className="provider-name">
                        {displayName(m.provider, locale)}
                      </span>
                      <span className={m.ready ? "live-label" : "quiet"}>
                        {t(m.ready ? "connected" : "notConnected")}
                      </span>
                    </div>
                  ))}
              </div>
            </section>
            <section className="simulators">
              <Heading
                title={t("simulators")}
                note={t("simulatorDescription")}
              />
              <div className="simulator-strip">
                {visibleModels
                  .filter((m) => m.provider === "simulation")
                  .map((m) => (
                    <div key={m.id}>
                      <span className="model-letter">{m.name[0]}</span>
                      <div>
                        <strong>{m.name}</strong>
                        <p>{m.label}</p>
                      </div>
                      <span className="sim-label">{t("demo")}</span>
                    </div>
                  ))}
              </div>
            </section>
          </TabsContent>
          <TabsContent value="method">
            <div className="method-list">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <article key={i}>
                  <span className="numeric method-number">0{i}</span>
                  <h2>{t(`method${i}Title`)}</h2>
                  <p>{t(`method${i}`)}</p>
                </article>
              ))}
            </div>
            <p className="footnote">{t("promptLanguage")}</p>
          </TabsContent>
          <footer>
            <span>
              {t("brand")} <i>/</i> {t("footer")}
            </span>
            <span className="numeric">{VERSION}</span>
          </footer>
        </main>
      </Tabs>
      <Dialog open={runDialog} onOpenChange={setRunDialog}>
        <DialogContent
          className="form-dialog"
          dir={dir}
          showCloseButton={false}
        >
          <DialogClose className="dialog-close" aria-label={t("close")}>
            <X size={19} />
          </DialogClose>
          <DialogHeader>
            <DialogTitle>{t("setup")}</DialogTitle>
            <DialogDescription>{t("setupDescription")}</DialogDescription>
          </DialogHeader>
          <label className="field">
            {t("runName")}
            <input
              value={name}
              maxLength={80}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <Tabs
            value={mode}
            dir={dir}
            onValueChange={(v) => {
              setMode(v);
              setChosen(
                v === "demo"
                  ? DEMO_MODELS.map((m) => m.id)
                  : available.slice(0, 3).map((m) => m.id),
              );
            }}
          >
            <TabsList className="mode-tabs">
              <TabsTrigger value="demo">{t("freeDemo")}</TabsTrigger>
              <TabsTrigger value="live">{t("realModels")}</TabsTrigger>
            </TabsList>
            <p className="form-help">
              {t(mode === "demo" ? "demoHelp" : "liveHelp")}
            </p>
          </Tabs>
          <div className="model-options">
            {visibleModels
              .filter((m) =>
                mode === "demo"
                  ? m.provider === "simulation"
                  : m.ready && m.provider !== "simulation",
              )
              .map((m) => (
                <label key={m.id}>
                  <Checkbox
                    checked={chosen.includes(m.id)}
                    onCheckedChange={(v) => chooseModel(m.id, v === true)}
                  />
                  <span>
                    {m.name}
                    <small>{m.label}</small>
                  </span>
                </label>
              ))}
          </div>
          {mode === "live" && !available.length && (
            <p className="form-help">
              {t("addConnectionFirst")}{" "}
              <button
                className="inline-link"
                onClick={() => {
                  setRunDialog(false);
                  setView("models");
                  setModelDialog(true);
                }}
              >
                {t("addModel")}
              </button>
            </p>
          )}
          <span className="field-label">{t("categories")}</span>
          <div className="category-options">
            {CATEGORIES.map((c) => (
              <label key={c.id}>
                <Checkbox
                  checked={cats.includes(c.id)}
                  onCheckedChange={(v) =>
                    setCats(
                      v ? [...cats, c.id] : cats.filter((x) => x !== c.id),
                    )
                  }
                />
                {t(c.id)}
              </label>
            ))}
          </div>
          <div className="form-grid">
            <label className="field">
              {t("tasksPerCategory")}
              <Select value={count} onValueChange={setCount}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {["4", "12", "40"].map((n) => (
                    <SelectItem value={n} key={n}>
                      {format(+n, 0)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <label className="field">
              {t("repeats")}
              <Select value={repeats} onValueChange={setRepeats}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">{t("once")}</SelectItem>
                  <SelectItem value="3">{t("threeTimes")}</SelectItem>
                </SelectContent>
              </Select>
            </label>
          </div>
          <div className="run-budget">
            <span>{t("requests")}</span>
            <strong className="numeric">
              {format(cats.length * chosen.length * +count * +repeats, 0)}
            </strong>
            <p>{t(mode === "demo" ? "noApiCost" : "paidNote")}</p>
          </div>
          <button
            className="primary full"
            onClick={create}
            disabled={busy || !name.trim() || !chosen.length || !cats.length}
          >
            {busy ? (
              <RefreshCw className="spin" size={17} />
            ) : (
              <Play size={17} />
            )}{" "}
            {t("start")}
          </button>
        </DialogContent>
      </Dialog>
      <Dialog
        open={modelDialog}
        onOpenChange={(v) => {
          setModelDialog(v);
          if (!v) setConnection((c) => ({ ...c, apiKey: "" }));
        }}
      >
        <DialogContent
          className="form-dialog"
          dir={dir}
          showCloseButton={false}
        >
          <DialogClose className="dialog-close" aria-label={t("close")}>
            <X size={19} />
          </DialogClose>
          <DialogHeader>
            <DialogTitle>{t("addModel")}</DialogTitle>
            <DialogDescription>{t("connectionDescription")}</DialogDescription>
          </DialogHeader>
          {!vaultReady && <p className="notice">{t("vaultUnavailable")}</p>}
          <label className="field">
            {t("provider")}
            <Select
              value={connection.provider}
              onValueChange={(provider) =>
                setConnection({ ...connection, provider })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="openai">
                  {locale === "ar" ? "أوبن إيه آي" : "OpenAI"}
                </SelectItem>
                <SelectItem value="anthropic">
                  {locale === "ar" ? "أنثروبيك" : "Anthropic"}
                </SelectItem>
                <SelectItem value="gemini">
                  {locale === "ar" ? "غوغل جيميني" : "Google Gemini"}
                </SelectItem>
                <SelectItem value="nvidia">
                  {locale === "ar" ? "إنفيديا" : "NVIDIA"}
                </SelectItem>
                <SelectItem value="openrouter">
                  {locale === "ar" ? "أوبن راوتر" : "OpenRouter"}
                </SelectItem>
              </SelectContent>
            </Select>
          </label>
          <label className="field">
            {t("displayName")}
            <input
              value={connection.name}
              maxLength={80}
              onChange={(e) =>
                setConnection({ ...connection, name: e.target.value })
              }
            />
          </label>
          <label className="field">
            {t("modelId")}
            <input
              dir="ltr"
              value={connection.model}
              maxLength={120}
              onChange={(e) =>
                setConnection({ ...connection, model: e.target.value })
              }
            />
            <small>{t("modelIdHelp")}</small>
          </label>
          <label className="field">
            {t("apiKey")}
            <input
              dir="ltr"
              type="password"
              autoComplete="off"
              value={connection.apiKey}
              maxLength={4096}
              onChange={(e) =>
                setConnection({ ...connection, apiKey: e.target.value })
              }
            />
            <small>{t("keyHelp")}</small>
          </label>
          <div className="form-grid">
            <label className="field">
              {t("inputPrice")}
              <input
                type="number"
                min="0"
                max="10000"
                step="any"
                value={connection.inputPrice}
                onChange={(e) =>
                  setConnection({ ...connection, inputPrice: e.target.value })
                }
              />
            </label>
            <label className="field">
              {t("outputPrice")}
              <input
                type="number"
                min="0"
                max="10000"
                step="any"
                value={connection.outputPrice}
                onChange={(e) =>
                  setConnection({ ...connection, outputPrice: e.target.value })
                }
              />
            </label>
          </div>
          <p className="form-help">{t("optionalPrice")}</p>
          <button
            className="primary full"
            disabled={
              !vaultReady ||
              busy ||
              !connection.name.trim() ||
              !connection.model.trim() ||
              connection.apiKey.length < 10
            }
            onClick={saveModel}
          >
            {busy ? t("saving") : t("saveModel")}
          </button>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!task}
        onOpenChange={(v) => {
          if (!v) {
            setTask(null);
            setResult(null);
          }
        }}
      >
        <DialogContent
          className="task-dialog"
          dir={dir}
          showCloseButton={false}
        >
          <DialogClose className="dialog-close" aria-label={t("close")}>
            <X size={19} />
          </DialogClose>
          <DialogHeader>
            <DialogTitle>
              {task ? t(task.category) + " · " + task.id.split("-")[1] : ""}
            </DialogTitle>
            <DialogDescription>
              {task?.id} · {VERSION}
            </DialogDescription>
          </DialogHeader>
          <span className="field-label">{t("prompt")}</span>
          <pre dir="ltr">{task?.prompt}</pre>
          <span className="field-label">{t("referenceAnswer")}</span>
          <code dir="ltr">{task?.expected}</code>
          {result && (
            <>
              {result.error && (
                <div className="notice error">
                  <strong>{t("trialFailedTitle")}</strong>
                  <p>
                    {t(
                      result.error === "timeout"
                        ? "trialTimeout"
                        : result.error === "interrupted_unknown_outcome"
                          ? "trialInterrupted"
                          : /provider_http_(401|403)/.test(result.error)
                            ? "trialCredentials"
                            : result.error === "provider_http_429"
                              ? "trialRateLimit"
                              : /incomplete|empty/.test(result.error)
                                ? "trialIncomplete"
                                : "trialProvider",
                    )}
                  </p>
                  <small dir="ltr">{result.error}</small>
                </div>
              )}
              <span className="field-label">{t("modelAnswer")}</span>
              <code className={result.score === 1 ? "pass" : "fail"} dir="ltr">
                {result.output || "—"}
              </code>
            </>
          )}
          <p className="form-help">{t("promptLanguage")}</p>
        </DialogContent>
      </Dialog>
    </div>
  );
}
function Heading({
  title,
  note,
  aside,
}: {
  title: string;
  note?: string;
  aside?: React.ReactNode;
}) {
  return (
    <div className="section-heading">
      <div>
        <h2>{title}</h2>
        {note && <p>{note}</p>}
      </div>
      {aside}
    </div>
  );
}
function Metric({
  label,
  value,
  unit,
  note,
}: {
  label: string;
  value: string;
  unit?: string;
  note: string;
}) {
  return (
    <div className="metric">
      <span>{label}</span>
      <div>
        <strong className="numeric">{value}</strong>
        {unit && <small>{unit}</small>}
      </div>
      <p>{note}</p>
    </div>
  );
}
