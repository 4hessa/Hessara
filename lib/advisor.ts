/**
 * A local, deterministic guide over a dated catalogue, not an LLM or a quality
 * benchmark. No input is transmitted or persisted by this module.
 */
export const ADVISOR_POLICY_VERSION = "hessara-advisor/1.0.1";
export const ADVISOR_TASKS = ["general", "study", "research", "coding", "writing", "analysis", "images", "reasoning"] as const;
export type AdvisorTask = (typeof ADVISOR_TASKS)[number];
export type AdvisorAudience = "beginner" | "student" | "technical";
export type AdvisorPriority = "balanced" | "cost" | "context" | "speed";
export type TaskIntent = {
  text: string;
  task: AdvisorTask;
  audience: AdvisorAudience;
  priority: AdvisorPriority;
  imageInput: boolean;
  fileInput: boolean;
  toolUse: boolean;
  minContext: number;
  stage?: string;
  subject?: string;
};
export type AdvisorReason = "text_input" | "image_input" | "file_input" | "tool_support" | "reasoning_setting" | "context_requirement" | "lower_listed_cost" | "larger_context" | "similar_documented_fit";
export type AdvisorLimitation = "quality_unmeasured" | "speed_unmeasured" | "provider_snapshot" | "price_unknown" | "capability_unknown" | "connector_text_only" | "reasoning_not_quality" | "tools_not_search" | "stale_snapshot";
export type AdvisorNotice = "guided_analysis" | "review_requirements" | "no_match" | "speed_not_ranked" | "no_quality_ranking" | "cost_estimate_only" | "app_text_only";
export type AdvisorEvidenceField = "context" | "inputPrice" | "outputPrice" | "inputModalities" | "reasoning" | "tools";
export type AdvisorEvidence = {
  readonly id: string;
  readonly value: number | boolean | readonly string[] | null;
  readonly sourceKind: "access_provider";
  readonly sourceUrl: string | null;
  readonly observedAt: string | null;
  readonly status: "documented" | "unknown";
};
export type CatalogModelInput = {
  id: string;
  name: string;
  publisher: string;
  context?: number | null;
  inputPrice?: number | null;
  outputPrice?: number | null;
  inputModalities?: readonly string[] | null;
  reasoning?: boolean | null;
  tools?: boolean | null;
  url?: string | null;
  checkedAt?: string | null;
  source?: string | null;
};
export type AdvisorModel = {
  readonly id: string;
  readonly name: string;
  readonly publisher: string;
  readonly context: number | null;
  readonly inputPrice: number | null;
  readonly outputPrice: number | null;
  readonly inputModalities: readonly string[] | null;
  readonly reasoning: boolean | null;
  readonly tools: boolean | null;
  readonly url: string | null;
  readonly checkedAt: string | null;
  readonly source: string | null;
  readonly sourceKind: "access_provider";
  readonly accessProvider: "OpenRouter";
  readonly evidence: Readonly<Record<AdvisorEvidenceField, AdvisorEvidence>>;
  /** No task-specific measurements have been attached to this snapshot. */
  readonly measurements: { readonly quality: null; readonly speedMs: null };
};
export type AdvisorCatalogSnapshot = {
  readonly id: string;
  readonly version: "hessara-catalog-evidence/1";
  readonly models: readonly AdvisorModel[];
};
export type AdvisorCandidate = {
  model: AdvisorModel;
  reasons: AdvisorReason[];
  limitations: AdvisorLimitation[];
  evidenceStrength: "limited" | "moderate";
  evidenceIds: string[];
  matchedRequirements: AdvisorEvidenceField[];
  tied: boolean;
};
export type AdvisorRecommendation = {
  candidates: AdvisorCandidate[];
  excludedCount: number;
  notices: AdvisorNotice[];
  policyVersion: string;
  snapshotId: string;
};

const finite = (value: unknown, minimum = 0): number | null =>
  typeof value === "number" && Number.isFinite(value) && value >= minimum ? value : null;
const bool = (value: unknown): boolean | null => typeof value === "boolean" ? value : null;
const dated = (value: unknown): string | null => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value ? value : null;
};
const providerUrl = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "openrouter.ai" && !url.username && !url.password ? url.href : null;
  } catch { return null; }
};
function freeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}
/** Stable content fingerprint for reproducibility, never used as a security hash. */
function fingerprint(text: string): string {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16).padStart(8, "0");
}
export function createCatalogSnapshot(input: readonly CatalogModelInput[]): AdvisorCatalogSnapshot {
  const ids = new Set<string>();
  const models = input.map((raw): AdvisorModel => {
    if (!raw.id || ids.has(raw.id)) throw new Error("Duplicate or missing catalogue model ID");
    ids.add(raw.id);
    const source = providerUrl(raw.source);
    const checkedAt = dated(raw.checkedAt);
    const documented = Boolean(source && checkedAt);
    const inputModalities = documented && Array.isArray(raw.inputModalities)
      ? [...new Set(raw.inputModalities.filter((item) => typeof item === "string" && item.length < 40))].sort() : null;
    const values = {
      context: documented ? finite(raw.context, 1) : null,
      inputPrice: documented ? finite(raw.inputPrice) : null,
      outputPrice: documented ? finite(raw.outputPrice) : null,
      inputModalities,
      reasoning: documented ? bool(raw.reasoning) : null,
      tools: documented ? bool(raw.tools) : null,
    };
    const evidence = Object.fromEntries(Object.entries(values).map(([field, value]) => [field, {
      id: `${raw.id}:${field}:${checkedAt ?? "undated"}`,
      value,
      sourceKind: "access_provider" as const,
      sourceUrl: source,
      observedAt: checkedAt,
      status: value === null ? "unknown" as const : "documented" as const,
    }])) as Record<AdvisorEvidenceField, AdvisorEvidence>;
    return {
      id: raw.id, name: raw.name, publisher: raw.publisher, ...values,
      url: providerUrl(raw.url), checkedAt, source, sourceKind: "access_provider",
      accessProvider: "OpenRouter", evidence, measurements: { quality: null, speedMs: null },
    };
  }).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  return freeze({ id: `catalog-${fingerprint(JSON.stringify(models))}`, version: "hessara-catalog-evidence/1" as const, models });
}

// Small, visible keyword hints complement explicit controls in every UI locale.
// They are suggestions only: negation, ambiguity and nuanced requests require review.
const hints: Record<Exclude<AdvisorTask, "general">, readonly string[]> = {
  study: ["جامع", "دراس", "طالب", "شرح", "student", "study", "university", "learn", "étud", "université", "estudi", "universidad", "学习", "大学", "학생", "공부", "대학교", "طالب", "پڑھ", "تعلیم", "دانش", "تحصیل", "estud", "universidade", "studio", "studente", "università", "учеб", "студент", "университет", "studium", "lernen", "universität", "studeren", "student", "universiteit"],
  research: ["بحث", "مصادر", "research", "sources", "recherche", "investigación", "fuentes", "研究", "来源", "연구", "출처", "تحقیق", "پژوهش", "pesquisa", "fontes", "ricerca", "fonti", "исследован", "источник", "forschung", "quellen", "onderzoek", "bronnen"],
  coding: ["برمج", "كود", "تطبيق", "code", "coding", "program", "debug", "programm", "código", "编程", "代码", "코딩", "프로그래밍", "پروگرام", "کد", "برنامه", "código", "codice", "программ", "код", "programmier", "programm", "coderen"],
  writing: ["كتاب", "مقال", "نص", "write", "writing", "essay", "écri", "rédig", "escrib", "redact", "写作", "写文章", "글쓰기", "작성", "لکھ", "نوشت", "escrev", "redação", "scriv", "письм", "напис", "schreib", "schrijv"],
  analysis: ["تحليل", "بيانات", "analyse", "analyz", "analysis", "data", "análisis", "datos", "分析", "数据", "분석", "데이터", "تجزی", "داده", "anális", "dados", "analisi", "dati", "анализ", "данных", "analyse", "daten", "gegevens"],
  images: ["صور", "صورة", "image", "photo", "imagen", "图片", "图像", "이미지", "사진", "تصویر", "imagem", "immagin", "изображен", "фото", "bild", "afbeeld", "foto"],
  reasoning: ["استدلال", "منطق", "reasoning", "logic", "raisonnement", "lógica", "razonamiento", "推理", "逻辑", "추론", "논리", "استدلال", "منطق", "raciocínio", "ragionamento", "логик", "рассужд", "schlussfolg", "logik", "redener", "logica"],
};
const normalize = (text: string) => text.normalize("NFKC").toLocaleLowerCase().replace(/[\u064B-\u065F\u0670]/g, "");
// Only explicit phrases suggest a priority. Multiple priorities stay balanced;
// the review form remains authoritative, including for unsupported phrasing.
const priorityHints: Record<Exclude<AdvisorPriority, "balanced">, readonly string[]> = {
  cost: [
    "ميزانية محدودة", "ميزانية قليلة", "تكلفة منخفضة", "أقل تكلفة", "سعر منخفض",
    "limited budget", "tight budget", "low cost", "low-cost", "lower cost", "cheapest",
    "budget limité", "faible coût", "presupuesto limitado", "bajo costo", "bajo coste",
    "预算有限", "低成本", "예산이 제한", "저렴한 비용", "محدود بجٹ", "کم لاگت", "بودجه محدود", "هزینه کم",
    "orçamento limitado", "baixo custo", "budget limitato", "basso costo", "ограниченный бюджет", "низкая стоимость",
    "begrenztes budget", "niedrige kosten", "beperkt budget", "lage kosten",
  ],
  speed: [
    "استجابة سريعة", "إجابة سريعة", "السرعة مهمة", "أسرع استجابة",
    "fast response", "quick response", "low latency", "speed matters", "faster responses",
    "réponse rapide", "faible latence", "respuesta rápida", "baja latencia", "快速响应", "低延迟",
    "빠른 응답", "낮은 지연", "تیز جواب", "فوری جواب", "پاسخ سریع", "تأخیر کم",
    "resposta rápida", "baixa latência", "risposta rapida", "bassa latenza", "быстрый ответ", "низкая задержка",
    "schnelle antwort", "geringe latenz", "snel antwoord", "lage latentie",
  ],
  context: [
    "سياق طويل", "سياق كبير", "مستندات طويلة", "سياق أكبر",
    "long context", "large context", "more context", "long documents",
    "contexte long", "documents longs", "contexto largo", "documentos largos", "长上下文", "长文档",
    "긴 컨텍스트", "긴 문서", "طویل سیاق", "طویل دستاویزات", "زمینه طولانی", "اسناد طولانی",
    "contexto longo", "documentos longos", "contesto lungo", "documenti lunghi", "длинный контекст", "длинные документы",
    "langer kontext", "lange dokumente", "lange context", "lange documenten",
  ],
};
// A conservative guard, not a general negation parser. Keep cues within their
// clause and ignore them when nearby negation could reverse their meaning.
const priorityClauseBreak = /[.!?;,:،؛。！？\n]|\b(?:but|however|mais|pero|mas|ma|aber|maar|но)\b|(?:ولكن|لكن)/u;
const priorityNegation = /(?:^|[^\p{L}\p{N}])(?:no|not|never|without|don't|doesn't|isn't|aren't|won't|can't|ne|n'|pas|sans|sin|não|sem|non|senza|не|нет|без|nicht|kein(?:e|en|er|es)?|ohne|niet|geen|zonder|لا|ولا|ليس|ليست|لست|بدون|غير|مش|مو|نہیں|نہ|مت|نه|نیست|نمی)(?=$|[^\p{L}\p{N}])|不|没|无需|않|필요\s*없|중요하지/u;
function hintedPriority(text: string): AdvisorPriority {
  const clauses = text.replace(/[‘’]/g, "'").split(priorityClauseBreak);
  const matches = (Object.entries(priorityHints) as [Exclude<AdvisorPriority, "balanced">, readonly string[]][])
    .filter(([, phrases]) => phrases.some((rawPhrase) => {
      const phrase = normalize(rawPhrase);
      return clauses.some((clause) => {
        let start = clause.indexOf(phrase);
        while (start !== -1) {
          const end = start + phrase.length;
          // Space-separated Latin/Cyrillic cues must not match inside a word.
          const partialWord = /[\p{Script=Latin}\p{Script=Cyrillic}]/u.test(phrase)
            && ((start > 0 && /\p{L}/u.test(clause[start - 1])) || (end < clause.length && /\p{L}/u.test(clause[end])));
          const nearby = clause.slice(Math.max(0, start - 60), Math.min(clause.length, end + 45));
          if (!partialWord && !priorityNegation.test(nearby)) return true;
          start = clause.indexOf(phrase, end);
        }
        return false;
      });
    })).map(([priority]) => priority);
  return matches.length === 1 ? matches[0] : "balanced";
}
export function analyzeTask(text: string, overrides: Partial<Omit<TaskIntent, "text">> = {}): {
  intent: TaskIntent;
  needsClarification: boolean;
  suggestedTasks: AdvisorTask[];
} {
  const safeText = text.trim().slice(0, 4000);
  const normal = normalize(safeText);
  const matches = (Object.entries(hints) as [Exclude<AdvisorTask, "general">, readonly string[]][])
    .map(([task, words]) => ({ task, count: words.filter((word) => normal.includes(normalize(word))).length }))
    .filter(({ count }) => count > 0)
    .sort((a, b) => b.count - a.count || ADVISOR_TASKS.indexOf(a.task) - ADVISOR_TASKS.indexOf(b.task));
  const explicitTask = overrides.task && ADVISOR_TASKS.includes(overrides.task) ? overrides.task : null;
  const task = explicitTask ?? matches[0]?.task ?? "general";
  const audience = ["beginner", "student", "technical"].includes(overrides.audience ?? "")
    ? overrides.audience! : task === "study" ? "student" : "beginner";
  const priority = ["balanced", "cost", "context", "speed"].includes(overrides.priority ?? "") ? overrides.priority! : hintedPriority(normal);
  const intent: TaskIntent = {
    text: safeText, task, audience, priority,
    imageInput: overrides.imageInput ?? false,
    fileInput: overrides.fileInput ?? false,
    toolUse: overrides.toolUse ?? false,
    minContext: Math.min(10_000_000, Math.floor(finite(overrides.minContext) ?? 0)),
    ...(overrides.stage ? { stage: overrides.stage.trim().slice(0, 120) } : {}),
    ...(overrides.subject ? { subject: overrides.subject.trim().slice(0, 200) } : {}),
  };
  return {
    intent,
    needsClarification: !explicitTask && (matches.length === 0 || (matches.length > 1 && matches[0].count === matches[1].count)),
    suggestedTasks: matches.map(({ task: suggestion }) => suggestion),
  };
}

function stale(model: AdvisorModel, now: string): boolean {
  if (!model.checkedAt) return true;
  const age = Date.parse(now) - Date.parse(`${model.checkedAt}T00:00:00Z`);
  return !Number.isFinite(age) || age < 0 || age > 30 * 86400000;
}
function combinedPrice(model: AdvisorModel): number | null {
  // Equal token units is only a transparent sorting convention, not a bill estimate.
  return model.inputPrice === null || model.outputPrice === null ? null : model.inputPrice + model.outputPrice;
}
function capabilityFit(intent: TaskIntent, model: AdvisorModel): number {
  let value = 0;
  if (["coding", "research", "analysis"].includes(intent.task) && model.tools === true) value++;
  if (["coding", "reasoning"].includes(intent.task) && model.reasoning === true) value++;
  return value;
}
export function recommendModels(intent: TaskIntent, snapshot: AdvisorCatalogSnapshot, options: { limit?: number; now?: string } = {}): AdvisorRecommendation {
  const now = options.now ?? new Date().toISOString();
  const limit = Math.max(2, Math.min(4, Math.floor(finite(options.limit, 1) ?? 3)));
  const needsImage = intent.imageInput || intent.task === "images";
  const eligible = snapshot.models.filter((model) => {
    if (!model.inputModalities?.includes("text")) return false;
    if (needsImage && !model.inputModalities.includes("image")) return false;
    if (intent.fileInput && !model.inputModalities.includes("file")) return false;
    if (intent.toolUse && model.tools !== true) return false;
    if (intent.minContext > 0 && (model.context === null || model.context < intent.minContext)) return false;
    return true;
  });
  const priorityValue = (model: AdvisorModel): number => {
    if (intent.priority === "cost") return combinedPrice(model) ?? Number.POSITIVE_INFINITY;
    if (intent.priority === "context") return -(model.context ?? 0);
    return 0;
  };
  const equivalent = (a: AdvisorModel, b: AdvisorModel) => priorityValue(a) === priorityValue(b) && capabilityFit(intent, a) === capabilityFit(intent, b);
  const sorted = [...eligible].sort((a, b) => priorityValue(a) - priorityValue(b) || capabilityFit(intent, b) - capabilityFit(intent, a) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const notices: AdvisorNotice[] = ["guided_analysis", "review_requirements", "no_quality_ranking"];
  if (!sorted.length) notices.push("no_match");
  if (intent.priority === "speed") notices.push("speed_not_ranked");
  if (intent.priority === "cost") notices.push("cost_estimate_only");
  if (needsImage || intent.fileInput || intent.toolUse) notices.push("app_text_only");
  const candidates = sorted.slice(0, limit).map((model): AdvisorCandidate => {
    const reasons: AdvisorReason[] = ["text_input"];
    const matched = new Set<AdvisorEvidenceField>(["inputModalities"]);
    const limitations: AdvisorLimitation[] = ["quality_unmeasured", "speed_unmeasured", "provider_snapshot"];
    if (needsImage) reasons.push("image_input");
    if (intent.fileInput) reasons.push("file_input");
    if (model.tools === true && (intent.toolUse || ["coding", "research", "analysis"].includes(intent.task))) {
      reasons.push("tool_support"); matched.add("tools"); limitations.push("tools_not_search");
    }
    if (model.reasoning === true && ["coding", "reasoning"].includes(intent.task)) {
      reasons.push("reasoning_setting"); matched.add("reasoning"); limitations.push("reasoning_not_quality");
    }
    if (intent.minContext > 0) { reasons.push("context_requirement"); matched.add("context"); }
    if (intent.priority === "context" && model.context !== null) {
      if (eligible.some(other => other.context !== null && other.context < model.context!)) reasons.push("larger_context");
      matched.add("context");
    }
    if (intent.priority === "cost" && combinedPrice(model) !== null) {
      if (eligible.some(other => combinedPrice(other) !== null && combinedPrice(other)! > combinedPrice(model)!)) reasons.push("lower_listed_cost");
      matched.add("inputPrice"); matched.add("outputPrice");
    }
    const tied = eligible.some((other) => other.id !== model.id && equivalent(model, other));
    if (tied) reasons.push("similar_documented_fit");
    if (model.inputPrice === null || model.outputPrice === null) limitations.push("price_unknown");
    if (Object.values(model.evidence).some((field) => field.status === "unknown")) limitations.push("capability_unknown");
    if (needsImage || intent.fileInput || intent.toolUse) limitations.push("connector_text_only");
    const outdated = stale(model, now);
    if (outdated) limitations.push("stale_snapshot");
    // "Moderate" covers dated catalogue evidence only, never confidence in quality.
    const complete = Object.values(model.evidence).every((field) => field.status === "documented");
    return { model, reasons, limitations, evidenceStrength: complete && !outdated ? "moderate" : "limited", evidenceIds: [...matched].map((field) => model.evidence[field].id), matchedRequirements: [...matched], tied };
  });
  return { candidates, excludedCount: snapshot.models.length - eligible.length, notices, policyVersion: ADVISOR_POLICY_VERSION, snapshotId: snapshot.id };
}

/** Comparison preserves the user's ordering and refuses silent fallback models. */
export function compareModels(ids: readonly string[], snapshot: AdvisorCatalogSnapshot): AdvisorModel[] {
  if (ids.length < 2 || ids.length > 4 || new Set(ids).size !== ids.length) throw new Error("Select 2–4 distinct models");
  return ids.map((id) => {
    const model = snapshot.models.find((candidate) => candidate.id === id);
    if (!model) throw new Error("Model absent from this catalogue snapshot");
    return model;
  });
}
