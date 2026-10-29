"use client";
import { coreLanguage as language } from "@/lib/core-ui-locales";
import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import Link from "next/link";
import { BrandLockup } from "./brand-mark";
import { legalCopy } from "@/lib/legal-copy";
import { useRouter, useSearchParams } from "next/navigation";
import { isPlainNavigation, workspaceHref, workspaceLocation } from "@/lib/workspace-location";
import { useLocale } from "@/hooks/use-locale";
import {
  ArrowDownToLine,
  Check,
  ChevronLeft,
  ChevronRight,
  FlaskConical,
  Globe2,
  Plus,
  Play,
  Search,
  ShieldCheck,
  UserRound,
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
import { DirectionProvider } from "@/components/ui/direction";
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
import { WorkspaceNavigation } from "./workspace-navigation";
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
import { LANGUAGES, LOCALE_COOKIE, isRTL, translate, type Locale } from "@/lib/i18n";
import {
  LLMDirectory,
  ToolsDirectory,
  HowWork,
  PaperclipPanel,
} from "./discover";
import { NvidiaStart } from "./nvidia-start";
import { SectionMotion } from "./section-motion";
import { MotionFeedback } from "./motion-feedback";
import { LandingHero } from "./landing-hero";
import { LandingHeader } from "./landing-header";
import { ThinkingOrb } from "./thinking-orb";
import { AgentsPanel } from "./agents";
import { labCopy } from "@/lib/lab-copy";
import { LabPanel } from "./lab-panel";
import { CodeWorkspacePanel } from "./code-workspace-panel";
import { codeWorkspaceCopy } from "@/lib/code-workspace-copy";
import "./workspace-grid.css";
import { workspaceStartCopy } from "@/lib/workspace-start-copy";
import { ModelConnectionStatus, type ConnectionProvider } from "./model-connection-status";
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
async function api(path: string, body?: unknown, signal?: AbortSignal): Promise<ApiData> {
  const response = await fetch(
    "/api/" + path,
    {
      signal,
      ...(body ? {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        } : {}),
    },
  );
  const data = (await response.json()) as ApiData;
  if (!response.ok) throw new Error(data.error ?? "UNAVAILABLE");
  return data;
}
async function readRun(id: string, signal?: AbortSignal) {
  let page = await api("runs/" + id, undefined, signal);
  const rows = [...page.trials];
  while (page.pagination?.nextOffset != null) {
    page = await api(`runs/${id}?offset=${page.pagination.nextOffset}&limit=250`, undefined, signal);
    rows.push(...page.trials);
  }
  return { run: page.run, trials: rows };
}
const providerColors: Record<string, string> = {
  simulation: "#4a5156",
  nvidia: "#536b58",
  openrouter: "#7d898c",
  openai: "#24292e",
  anthropic: "#596e80",
  gemini: "#536b58",
};
const comparisonColors = [
  "#121212", "#425f7e", "#6c849e", "#8b8886",
  "#344659", "#526174", "#7b6f67", "#63707c",
];
function focusNvidiaConnection() {
  const field = document.getElementById('nvidia-key');
  field?.closest('section')?.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  field?.focus({ preventScroll: true });
}
export default function Workspace({ sessionMode = "none", initialLocale = "ar" }: { sessionMode?: "guest" | "account" | "none"; initialLocale?: Locale }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { view, runId } = workspaceLocation(searchParams);
  const [locale, setLocale] = useLocale(initialLocale);
  const [verifyingModel, setVerifyingModel] = useState<string | null>(null);
  const agentTarget = useRef<string | null>(null);
  useEffect(() => {
    if (view !== "agents" || !agentTarget.current) return;
    const targetId = agentTarget.current;
    const frame = requestAnimationFrame(() => {
      const card = document.querySelector<HTMLElement>(`[data-agent-id="${CSS.escape(targetId)}"]`);
      if (card) {
        card.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
        card.focus({ preventScroll: true });
      }
      agentTarget.current = null;
    });
    return () => cancelAnimationFrame(frame);
  }, [view]);
  const [labPreselected,setLabPreselected]=useState<string[]>([]);
  const [runs, setRuns] = useState<Run[]>([]),
    [models, setModels] = useState<Model[]>(DEMO_MODELS),
    [trials, setTrials] = useState<Trial[]>([]),
    [storedRun, setSelected] = useState<Run | null>(null),
    [loading, setLoading] = useState(sessionMode !== "none"),
    [error, setError] = useState(sessionMode === "none" ? "AUTH_REQUIRED" : ""),
    [vaultReady, setVaultReady] = useState<boolean | null>(null);
  const selected = storedRun?.id === runId ? storedRun : null;
  const [runLoadError, setRunLoadError] = useState<{ id: string; code: string } | null>(null);
  const [runRefresh, setRunRefresh] = useState(0);
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
    trialsCache = useRef<Trial[]>([]);
  useEffect(() => {
    // Back/Forward must not replace the evidence context of a live execution.
    // Preserve its report while still allowing movement between workspace views.
    if (execution.current && current.current !== runId) {
      window.history.replaceState(null, "", workspaceHref(view, window.location.search, current.current));
      return;
    }
    if (!runId || storedRun?.id === runId) return;
    const controller = new AbortController();
    // A link or browser refresh retrieves saved evidence only; execution still
    // requires the existing explicit Resume action and server authorization.
    readRun(runId, controller.signal).then(result => {
      if (controller.signal.aborted) return;
      current.current = result.run.id;
      trialsCache.current = result.trials;
      setTrials(result.trials);
      setSelected(result.run);
    }).catch(error => {
      if (!controller.signal.aborted) setRunLoadError({ id: runId, code: error instanceof Error ? error.message : "UNAVAILABLE" });
    });
    return () => controller.abort();
  }, [runId, storedRun?.id, runRefresh, view]);
  const c = language(locale);
  const t = (key: string) => translate(locale, key),
    dir = isRTL(locale) ? "rtl" : "ltr",
    format = (n: number, d = 1) =>
      new Intl.NumberFormat(locale, { maximumFractionDigits: d }).format(n);
  const signInHref = `/signin?lang=${locale}&next=${encodeURIComponent(workspaceHref(view, searchParams.toString()))}`;
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
        : m.ready || m.configured
          ? m.label
          : t("notConnected"),
    color:
      m.provider === "simulation"
        ? (
            {
              "sim-atlas": "#4a5156",
              "sim-swift": "#536b58",
              "sim-prism": "#596e80",
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
      color: providerColors[m.provider] ?? "#7d898c",
      label: m.model ?? m.name,
      ready: true,
    })),
    ...visibleModels.filter(
      (m) => !snapshotModels.some((x: { id: string }) => x.id === m.id),
    ),
  ].map((model, index) => ({
    ...model,
    color: comparisonColors[index % comparisonColors.length],
  }));
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
  async function readNewTrials(id: string, total: number) {
    const rows = [...trialsCache.current];
    while (rows.length < total) {
      const page = await api(`runs/${id}?offset=${rows.length}&limit=250`);
      if (!page.trials.length) break;
      rows.push(...page.trials);
    }
    return rows;
  }
  const load = useCallback(async () => {
    if (sessionMode === "none") {
      setError("AUTH_REQUIRED");
      setLoading(false);
      return;
    }
    try {
      const [r, m] = await Promise.all([api("runs"), api("models")]);
      setRuns(r.runs);
      setModels(m.models);
      setVaultReady(!!m.vaultReady);
      setError("");
      // The root remains the landing page; reports open through explicit selection.
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [sessionMode]);
  useEffect(() => {
    // Public browsing does not request private records. Account data is loaded
    // after async I/O and refreshed if the authenticated session mode changes.
    if (sessionMode === "none") return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    return () => {
      stop.current = true;
    };
  }, [load, sessionMode]);
  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = isRTL(locale) ? "rtl" : "ltr";
    document.title =
      translate(locale, "brand") + " — " + translate(locale, "lab");
    document.cookie = `${LOCALE_COOKIE}=${locale}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
  }, [locale]);
  const pendingViewFocus = useRef(false);
  const pendingNvidiaFocus = useRef(false);
  function navigateTo(next: string, reportId?: string | null) {
    pendingViewFocus.current = true;
    const href = workspaceHref(next, window.location.search, reportId);
    if (href !== window.location.pathname + window.location.search) window.history.pushState(null, "", href);
  }
  function openModelConnection(provider: ConnectionProvider = 'openai') {
    if (sessionMode === 'none') { router.push(signInHref); return; }
    if (provider === 'nvidia') {
      if (view === 'personal-lab') focusNvidiaConnection();
      else { pendingNvidiaFocus.current = true; navigateTo('personal-lab'); }
      return;
    }
    setConnection({ provider, name: '', model: '', apiKey: '', inputPrice: '', outputPrice: '' });
    setModelDialog(true);
  }
  useEffect(() => {
    if (view === 'personal-lab' && pendingNvidiaFocus.current) {
      pendingViewFocus.current = false;
      const frame = requestAnimationFrame(() => {
        focusNvidiaConnection();
        pendingNvidiaFocus.current = false;
      });
      return () => cancelAnimationFrame(frame);
    }
    if (!pendingViewFocus.current) return;
    pendingViewFocus.current = false;
    document
      .querySelector<HTMLElement>(view === "overview" ? "#main-content" : '.main-tabs [data-state="active"]')
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
      navigateTo("overview", d.run.id);
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
            c("أُوقف التنفيذ مؤقتًا لأن المزوّد يحتاج إلى مراجعة المفتاح أو الحصة أو الطلب المعلّق. راجع نتيجة المحاولة قبل الاستئناف.", "Paused: check provider credentials, quota or pending request before resuming."),
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
      navigateTo("overview", d.run.id);
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
        : view === "personal-lab"
          ? labCopy(locale).title
        : view === "code-workspace"
          ? codeWorkspaceCopy(locale).title
        : view === "llms"
          ? c("النماذج اللغوية", "LLMs")
          : view === "agents"
            ? t("agents")
            : view === "tools"
              ? c("أدوات الذكاء الاصطناعي", "Tools")
              : view === "how"
                ? c("كيف تعمل المنصة", "How it works")
                : t(view),
    description =
      view === "overview"
        ? t("mainDescription")
        : view === "personal-lab" ? labCopy(locale).intro
        : view === "code-workspace" ? codeWorkspaceCopy(locale).intro
        : ["llms", "agents", "tools", "how"].includes(view)
          ? ({llms: c("اختر نماذجك على أساس واضح.", "Choose your models with evidence."),agents: c("محركات قرار ووكلاء ومشاريع عملية تدعم ما بعد التقييم.", "Decision engines and agents for work beyond evaluation."),tools: c("دليل عملي لأدوات الذكاء الاصطناعي.", "A practical directory of AI tools."),how: c("من السؤال الأول إلى القرار المبني على الدليل.", "From a first question to an evidence-based decision.")} as Record<string,string>)[view]
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
          c("مقارنة نماذج إنفيديا", "NVIDIA model comparison"),
        );
        setCount("4");
        setRepeats("1");
        setCats(["logic"]);
        setRunDialog(true);
      }}
    />
  );
  const isLanding = view === "overview" && !runId;
  function showOverview(event: MouseEvent<HTMLAnchorElement>) {
    if (!isPlainNavigation(event)) return;
    event.preventDefault();
    if (execution.current) { toast.info(t("runningNotice")); return; }
    setSelected(null);
    navigateTo("overview", null);
  }
  return (
    <DirectionProvider dir={dir}>
    <div className="app workspace-shell" dir={dir} data-view={view} data-report={!!runId}>
      <a className="skip-link" href="#main-content">
        {t("skipContent")}
      </a>
      {!isLanding && <SectionMotion section={view} />}
      <Toaster position="bottom-center" dir={dir} />
      {isLanding ? <LandingHeader
        locale={locale}
        primary={[
          { id: "overview", label: t("overview") },
          { id: "llms", label: c("النماذج اللغوية", "LLMs") },
          { id: "agents", label: c("دليل الوكلاء", "Agent directory") },
          { id: "personal-lab", label: labCopy(locale).title },
        ]}
        secondary={[
          { id: "code-workspace", label: c("مساعدة عمل الوكلاء", "Agent workspace") },
          { id: "runs", label: t("runs") },
          { id: "tools", label: c("أدوات الذكاء الاصطناعي", "AI tools") },
          { id: "benchmarks", label: t("benchmarks") },
          { id: "models", label: t("models") },
          { id: "how", label: c("كيف تعمل المنصة", "How it works") },
          { id: "method", label: t("method") },
        ]}
        moreLabel={c("المزيد", "More")} menuLabel={c("أقسام المنصة", "Platform sections")}
        onNavigate={navigateTo} onHome={showOverview}>
        <div className="header-tools">
          <a href={signInHref} className="session-link" aria-label={sessionMode === "account" ? c("حسابي", "My account") : t("signIn")}><UserRound size={14} aria-hidden="true" />
            <span className="landing-account-label">{sessionMode === "guest" ? c("جلسة ضيف", "Guest session") : sessionMode === "account" ? c("حسابي", "My account") : t("signIn")}</span>
          </a>
          <button type="button" className="landing-private" onClick={() => navigateTo("personal-lab")}><FlaskConical size={14} aria-hidden="true" />{c("تجارب خاصة", "Private experiments")}</button>
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
      </LandingHeader> : <header className="masthead">
        <Link
          className="wordmark"
          href="/"
          aria-label={t("brand")}
          onClick={showOverview}
        >
          <BrandLockup />
        </Link>
        <nav className="top-level-sections" aria-label={c("أقسام المنصة", "Platform sections")}>
          <Link href="/" className="top-level-section-link" aria-current="page" onClick={showOverview}>{workspaceStartCopy(locale).topNavWorkspace}</Link>
          <Link href="/reverse-engineering" className="top-level-section-link" lang="en" dir="ltr">Reverse Engineering <span aria-hidden="true">↗</span></Link>
        </nav>
        <div className="header-tools">
          <a href={signInHref} className="session-link">
            {sessionMode === "guest" ? c("جلسة ضيف", "Guest session") : sessionMode === "account" ? c("حسابي", "My account") : t("signIn")}
          </a>
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
      </header>}
      <Tabs value={view} onValueChange={navigateTo} dir={dir}>
        <div className={isLanding ? "landing-hidden-tabs" : undefined}><WorkspaceNavigation locale={locale} value={view} label={t("workspace")}>
            {[
              "overview",
              "llms",
              "personal-lab",
              "agents",
              "code-workspace",
              "runs",
              "tools",
              "benchmarks",
              "models",
              "how",
              "method",
            ].map((v) => (
              <TabsTrigger key={v} value={v}>
                {v === "code-workspace" ? codeWorkspaceCopy(locale).title : v === "personal-lab" ? labCopy(locale).title : v === "llms"
                  ? c("النماذج اللغوية", "LLMs")
                  : v === "tools"
                    ? c("أدوات الذكاء الاصطناعي", "Tools")
                    : v === "how"
                      ? c("كيف تعمل المنصة", "How it works")
                      : t(v)}
              </TabsTrigger>
            ))}
        </WorkspaceNavigation></div>
        <main id="main-content" className="content" tabIndex={-1}>
          {!isLanding && !["personal-lab", "code-workspace", "llms"].includes(view) && <div className="intro">
            <div>
              <p className="kicker">{t("lab")}</p>
              <h1>{title}</h1>
              <p className="intro-description">{description}</p>
            </div>
            <button className="primary" onClick={newRun} disabled={active}>
              <Plus size={17} />
              {t("newRun")}
            </button>
          </div>}
          {error && view !== "code-workspace" &&
            !(
              error === "AUTH_REQUIRED" &&
              (isLanding || ["llms", "agents", "tools", "how"].includes(view))
            ) && (
              <div
                className={
                  error === "AUTH_REQUIRED" ? "notice" : "notice error"
                }
                role="alert"
              >
                <span>{message(error)}</span>
                {error === "AUTH_REQUIRED" ? (
                  <a href={signInHref} target="_top">
                    {t("signIn")}
                  </a>
                ) : (
                  <button onClick={() => load()}>{t("retry")}</button>
                )}
              </div>
            )}
          <TabsContent value="personal-lab" className="view-content">
            <LabPanel key={labPreselected.join('|')+sessionMode} initialModels={labPreselected} locale={locale} sessionMode={sessionMode} onConnect={() => navigateTo("models")} connectionPanel={nvidiaPanel} />
          </TabsContent>
          <TabsContent value="code-workspace" className="view-content">
            <CodeWorkspacePanel locale={locale} sessionMode={sessionMode} />
          </TabsContent>
          <TabsContent value="llms" className="view-content">
            <LLMDirectory
              locale={locale}
              connections={models}
              onUse={(id) => { setLabPreselected([id]); navigateTo("personal-lab"); }}
              onRequireAuth={sessionMode === "none" ? () => router.push(signInHref) : undefined}
              onCustom={() => {
                if (sessionMode === "none") { router.push(signInHref); return; }
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
                setLabPreselected(ids);
                navigateTo('personal-lab');
              }}
            />
          </TabsContent>
          <TabsContent value="agents" className="view-content">
            <AgentsPanel
              locale={locale}
              sessionMode={sessionMode}
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
          <TabsContent value="overview" className="view-content" aria-labelledby={isLanding ? "landing-title" : undefined}>
            {!runId && (
              <>
                <LandingHero locale={locale} disabled={active} onExplore={() => navigateTo("llms")} onHow={() => navigateTo("how")} onNavigate={navigateTo} />
              </>
            )}
            {runId && !selected && <div className="notice" role={runLoadError?.id === runId ? "alert" : "status"}>
              <span>{runLoadError?.id === runId ? message(runLoadError.code) : c("جارٍ فتح التجربة المحفوظة…", "Opening the saved run…")}</span>
              {runLoadError?.id === runId && <button type="button" onClick={() => { setRunLoadError(null); setRunRefresh(value => value + 1); }}>{t("retry")}</button>}
              <button type="button" onClick={() => navigateTo("runs", null)}>{t("runs")}</button>
            </div>}
            {selected && (
              <div className="evaluation-dashboard">
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
                  <div className="workspace-comparison-heading">
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
                  </div>
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
                  {!data.length && <p className="empty-line"><ThinkingOrb />{t("loading")}</p>}
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
              </div>
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
              <p className="empty-line"><ThinkingOrb />{t("loading")}</p>
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
            <ModelConnectionStatus locale={locale} connectedCount={visibleModels.filter(model => model.provider !== "cloudflare" && model.configured).length} platformCount={visibleModels.filter(model => model.provider === "cloudflare" && model.configured).length} loading={loading}
              onConnect={openModelConnection} onRefresh={() => { setLoading(true); void load(); }} />
            <section>
              <Heading
                title={t("connections")}
                note={t("keyHelp")}
                aside={
                  <button
                    className="primary"
                    onClick={() => openModelConnection()}
                  >
                    <Plus size={17} />
                    {t("addModel")}
                  </button>
                }
              />
              {vaultReady === false && <p className="notice">{t("vaultUnavailable")}</p>}
              <div className="connection-list">
                {visibleModels
                  .filter((m) => m.provider !== "simulation" && (m.configured || m.ready))
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
                        <small>{m.label}</small>
                      </div>
                      <span className="provider-name">
                        {displayName(m.provider, locale)}
                      </span>
                      <span className={m.ready ? "live-label" : "quiet"}>
                        {c(m.ready ? "تم التحقق من التشغيل" : m.verification === "failed" ? "فشل فحص الاتصال" : "اتصال مُعدّ — لم يُتحقق من التشغيل", m.ready ? "Operation verified" : m.verification === "failed" ? "Verification failed" : "Configured — unverified")}
                        {m.verifiedAt && <small>{new Date(m.verifiedAt).toLocaleTimeString(locale)}</small>}
                      </span>
                      <button type="button" disabled={verifyingModel !== null} onClick={async () => {
                        setVerifyingModel(m.id); setError("");
                        try { const result = await api("models/verify", {modelId:m.id}); setModels(result.models); }
                        catch (e) { setError(e instanceof Error ? e.message : "UNAVAILABLE"); }
                        finally { setVerifyingModel(null); }
                      }}>{c(verifyingModel === m.id ? "جارٍ التحقق…" : "اختبار اتصال فعلي", verifyingModel === m.id ? "Verifying…" : "Verify with a real request")}</button>
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
            <nav style={{display:"flex",gap:18,flexWrap:"wrap"}}><Link href={`/privacy?lang=${locale}`}>{legalCopy(locale).privacy}</Link><Link href={`/terms?lang=${locale}`}>{legalCopy(locale).terms}</Link></nav>
            <span>
              {t("brand")} <i>/</i> {t("footer")}
            </span>
            <span className="numeric">{VERSION}</span>
            <p className="developer-credit" lang="en" dir="ltr">This platform was developed by Engineer Hessa Ahmed Alzahrani.</p>
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
                navigateTo("models");
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
          <MotionFeedback
            className="run-budget"
            role="status"
            eventKey={`${mode}:${[...chosen].sort().join(",")}:${[...cats].sort().join(",")}:${count}:${repeats}`}
          >
            <span>{t("requests")}</span>
            <strong className="numeric">
              {format(cats.length * chosen.length * +count * +repeats, 0)}
            </strong>
            <p>{t(mode === "demo" ? "noApiCost" : "paidNote")}</p>
          </MotionFeedback>
          <button
            className="primary full"
            onClick={create}
            aria-busy={busy}
            disabled={busy || !name.trim() || !chosen.length || !cats.length}
          >
            {busy ? (
              <ThinkingOrb />
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
          {vaultReady === false && <p className="notice">{t("vaultUnavailable")}</p>}
          <label className="field">
            {t("provider")}
            <Select
              value={connection.provider}
              onValueChange={(provider) => setConnection({ provider, name: '', model: '', apiKey: '', inputPrice: '', outputPrice: '' })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="openai">
                  {c("أوبن إيه آي", "OpenAI")}
                </SelectItem>
                <SelectItem value="anthropic">
                  {c("أنثروبيك", "Anthropic")}
                </SelectItem>
                <SelectItem value="gemini">
                  {c("غوغل جيميني", "Google Gemini")}
                </SelectItem>
                <SelectItem value="nvidia">
                  {c("إنفيديا", "NVIDIA")}
                </SelectItem>
                <SelectItem value="openrouter">
                  {c("أوبن راوتر", "OpenRouter")}
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
            aria-busy={busy}
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
    </DirectionProvider>
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


