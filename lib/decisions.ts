import { CATEGORIES, type Category } from "./benchmarks.ts";

export const decisionOptions = Object.fromEntries(
  CATEGORIES.map((category) => [category.id, category.description]),
) as Record<Category, string>;

export const decisionQuestion = {
  benchmark: {
    type: "choice",
    instructions:
      "Choose the single most useful evaluation category for this requirement. Prefer the primary skill the user needs to measure.",
    criteria: decisionOptions,
  },
} as const;

const blockedHosts = [
  "localhost",
  "local",
  "internal",
  "localhost.localdomain",
  "home.arpa",
  "test",
  "invalid",
  "chatgpt.site",
];

export function layaEndpoint(input: string): string | null {
  try {
    const url = new URL(input);
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    if (
      url.protocol !== "https:" ||
      url.port ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/v1/systemone" ||
      host.length > 253 ||
      !host.includes(".") ||
      !/^[a-z0-9.-]+$/.test(host) ||
      /^\d+(?:\.\d+){3}$/.test(host) ||
      blockedHosts.some(
        (blocked) => host === blocked || host.endsWith(`.${blocked}`),
      )
    )
      return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function parseDecision(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const payload = value as Record<string, unknown>;
  const answers = payload.answers;
  if (!answers || typeof answers !== "object") return null;
  const benchmark = (answers as Record<string, unknown>).benchmark;
  if (!benchmark || typeof benchmark !== "object") return null;
  const answer = benchmark as Record<string, unknown>;
  if (typeof answer.choice !== "string") return null;
  const category = CATEGORIES.find((item) => item.id === answer.choice);
  if (!category) return null;
  const rawConfidence =
    typeof answer.answer_confidence === "number"
      ? answer.answer_confidence
      : answer.confidence;
  return {
    category: category.id,
    confidence:
      typeof rawConfidence === "number" &&
      Number.isFinite(rawConfidence) &&
      rawConfidence >= 0 &&
      rawConfidence <= 1
        ? rawConfidence
        : null,
    model:
      typeof payload.model === "string" ? payload.model.slice(0, 100) : null,
  };
}
