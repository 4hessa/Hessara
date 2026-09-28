export const VERSION = "hessara-core/1.1.0";
export const CATEGORIES = [
  {
    id: "coding",
    name: "فهم البرمجة",
    en: "Code reasoning",
    description: "تتبّع المخرجات، المصفوفات، التكرار والمنطق البرمجي.",
    color: "#48cba0",
  },
  {
    id: "logic",
    name: "الاستدلال المنطقي",
    en: "Logical reasoning",
    description: "تسلسلات عددية، علاقات وترتيب وعمليات متعددة.",
    color: "#8c9bfa",
  },
  {
    id: "analysis",
    name: "تحليل البيانات",
    en: "Data analysis",
    description: "حساب المجاميع والمتوسطات والفروق من بيانات ثابتة.",
    color: "#5fbddd",
  },
  {
    id: "retrieval",
    name: "استرجاع المعلومات",
    en: "Information retrieval",
    description: "استخراج حقائق من سجلات مغلقة ذات إجابة مرجعية.",
    color: "#eab65f",
  },
  {
    id: "instruction",
    name: "اتباع التعليمات",
    en: "Instruction following",
    description: "الالتزام بمفاتيح JSON وصيغ وقيم محددة بدقة.",
    color: "#d48ccb",
  },
  {
    id: "long",
    name: "السياق الطويل",
    en: "Long-context retrieval",
    description: "استخراج معلومة من 400 إلى 1,600 سجل داخل السياق.",
    color: "#ed9380",
  },
] as const;
export type Category = (typeof CATEGORIES)[number]["id"];
export type Task = {
  id: string;
  category: Category;
  title: string;
  prompt: string;
  expected: string;
  grader: "exact" | "json";
  variant: number;
};
export function taskAt(category: Category, i: number): Task {
  const a = i + 3,
    b = (i % 7) + 2,
    v = i % 4;
  let prompt = "",
    expected = "",
    grader: Task["grader"] = "exact";
  if (category === "coding") {
    const x = [a, b, a + 2, b + 3];
    const fact = (n: number): number => (n <= 1 ? 1 : n * fact(n - 1));
    const codes = [
      `const x=${JSON.stringify(x)}; console.log(x.filter(n=>n%2===0).reduce((s,n)=>s+n,0));`,
      `let s=0; for(let i=1;i<=${a};i++) s+=i; console.log(s);`,
      `const x=${JSON.stringify(x)}; console.log(x.map(n=>n*2)[${i % 4}]);`,
      `function f(n){return n<=1?1:n*f(n-1)} console.log(f(${b})+${a});`,
    ];
    expected = String(
      [
        x.filter((n) => n % 2 === 0).reduce((s, n) => s + n, 0),
        (a * (a + 1)) / 2,
        x[i % 4] * 2,
        fact(b) + a,
      ][v],
    );
    prompt = `What does this JavaScript print? Return only the integer.\n${codes[v]}`;
  } else if (category === "logic") {
    const q = [
      `Continue: ${a}, ${a + b}, ${a + 2 * b}, ${a + 3 * b}, ?`,
      `A box has ${a} red and ${b} blue balls. Remove ${b} red balls. How many balls remain?`,
      `A is ${a} years old. B is ${b} years older. C is twice B's age. How old is C?`,
      `Each of ${b} machines produces ${a} parts per hour. How many parts in 3 hours?`,
    ];
    expected = String([a + 4 * b, a, (a + b) * 2, a * b * 3][v]);
    prompt = q[v] + " Return only the integer.";
  } else if (category === "analysis") {
    const x = [a * 2, a * 4, a * 6, a * 8];
    expected = String([a * 20, a * 5, a * 6, a * 8][v]);
    prompt = `Dataset: ${JSON.stringify(x)}. Calculate the ${["sum", "arithmetic mean", "difference between maximum and minimum", "maximum"][v]}. Return only the integer.`;
  } else if (category === "retrieval" || category === "long") {
    const count = category === "long" ? [400, 800, 1200, 1600][v] : 20,
      target = (i * 137 + 17) % count;
    const records = Array.from(
      { length: count },
      (_, j) =>
        `record-${j}: ${(((j + 11) * (a + 19) * 7919) % 900000) + 100000}`,
    );
    const value = (j: number) =>
      String((((j + 11) * (a + 19) * 7919) % 900000) + 100000);
    const second = (target + 13) % count;
    let question: string;
    if (v === 0) {
      expected = value(target);
      question = `What is the value of record-${target}? Return only its six-digit value.`;
    } else if (v === 1) {
      expected = `record-${target}`;
      question = `Which record has the value ${value(target)}? Return only its identifier in the form record-N.`;
    } else if (v === 2) {
      expected = value(target);
      question = `The selected-record pointer refers to record-${target}. Follow the pointer and return only the six-digit value of the selected record.`;
    } else {
      grader = "json";
      expected = JSON.stringify({
        first: value(target),
        second: value(second),
      });
      question = `Return a JSON object with exactly two string fields: first is the value of record-${target}, and second is the value of record-${second}. No extra text.`;
    }
    prompt = `Use only these records. ${question}\n${records.join("\n")}\n${question}`;
  } else {
    grader = "json";
    expected = JSON.stringify(
      [
        { answer: a + b },
        { label: `item-${a}`, count: b },
        { valid: (a + Math.floor(i / 4)) % 2 === 0 },
        { values: [b, a] },
      ][v],
    );
    prompt = `Return exactly one JSON object matching this value: ${expected}. Do not add keys, markdown, or explanation. Key order does not matter.`;
    if (v === 2)
      prompt = `For the integer ${a + Math.floor(i / 4)}, return exactly one JSON object with the sole key valid. Its boolean value must be true if the integer is even and false otherwise. No markdown or explanation.`;
  }
  return {
    id: `${category}-${String(i + 1).padStart(3, "0")}`,
    category,
    title: `${CATEGORIES.find((c) => c.id === category)!.name} · ${String(i + 1).padStart(2, "0")}`,
    prompt,
    expected,
    grader,
    variant: v,
  };
}
export function getTask(id: string) {
  const [c, n] = id.split("-");
  if (
    !CATEGORIES.some((x) => x.id === c) ||
    !Number.isInteger(+n) ||
    +n < 1 ||
    +n > 40
  )
    throw new Error("Unknown task");
  return taskAt(c as Category, +n - 1);
}
export const TASKS = CATEGORIES.flatMap((c) =>
  Array.from({ length: 40 }, (_, i) => taskAt(c.id, i)),
);
function canonical(x: unknown): string {
  if (Array.isArray(x)) return "[" + x.map(canonical).join(",") + "]";
  if (x !== null && typeof x === "object")
    return (
      "{" +
      Object.entries(x)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => JSON.stringify(k) + ":" + canonical(v))
        .join(",") +
      "}"
    );
  return JSON.stringify(x);
}
export function grade(task: Task, output: string): number {
  if (task.grader === "exact") return output.trim() === task.expected ? 1 : 0;
  try {
    return canonical(JSON.parse(output)) ===
      canonical(JSON.parse(task.expected))
      ? 1
      : 0;
  } catch {
    return 0;
  }
}
export const DEMO_MODELS = [
  {
    id: "sim-atlas",
    name: "Atlas",
    label: "محاكي متوازن",
    color: "#43bc94",
    provider: "simulation",
    ready: true,
  },
  {
    id: "sim-swift",
    name: "Swift",
    label: "محاكي سريع",
    color: "#8392e9",
    provider: "simulation",
    ready: true,
  },
  {
    id: "sim-prism",
    name: "Prism",
    label: "محاكي تحليلي",
    color: "#e3ad56",
    provider: "simulation",
    ready: true,
  },
];
export type Model = {
  id: string;
  name: string;
  label: string;
  color: string;
  provider: string;
  ready: boolean;
};
export type Trial = {
  id: string;
  run_id: string;
  model: string;
  task_id: string;
  repeat: number;
  status: string;
  score: number | null;
  output: string | null;
  latency: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cost: number | null;
  error: string | null;
};
export function simulate(task: Task, model: string, repeat: number) {
  let h = 2166136261;
  for (const c of task.id + model + repeat)
    h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  h = h >>> 0;
  const thresholds: Record<string, number> = {
    "sim-atlas": 89,
    "sim-swift": 78,
    "sim-prism": 84,
  };
  return {
    output: h % 100 < (thresholds[model] ?? 85) ? task.expected : "incorrect",
    latency:
      (model === "sim-swift" ? 220 : model === "sim-prism" ? 800 : 1050) +
      (h % 450),
    input_tokens: Math.ceil(task.prompt.length / 4),
    output_tokens: 10,
    cost: 0,
  };
}
export function metrics(trials: Trial[], models: Model[]) {
  return models
    .map((m) => {
      const rows = trials.filter(
          (t) => t.model === m.id && ["done", "error"].includes(t.status),
        ),
        lat = rows
          .filter((t) => t.latency !== null)
          .map((t) => t.latency!)
          .sort((a, b) => a - b);
      const groups = new Map<string, Trial[]>();
      rows.forEach((t) =>
        groups.set(t.task_id, [...(groups.get(t.task_id) ?? []), t]),
      );
      const repeated = [...groups.values()].filter((x) => x.length > 1);
      const cats = CATEGORIES.map((c) => {
        const rs = rows.filter((t) => t.task_id.startsWith(c.id + "-"));
        return {
          id: c.id,
          score: rs.length
            ? (100 * rs.reduce((s, t) => s + (t.score ?? 0), 0)) / rs.length
            : null,
          n: rs.length,
        };
      });
      const present = cats.filter((c) => c.score !== null);
      return {
        ...m,
        n: rows.length,
        score: present.length
          ? present.reduce((s, c) => s + c.score!, 0) / present.length
          : 0,
        categories: cats,
        p50: lat.length ? lat[Math.ceil(lat.length * 0.5) - 1] : null,
        p95: lat.length ? lat[Math.ceil(lat.length * 0.95) - 1] : null,
        errors: rows.filter((t) => t.status === "error").length,
        stability: repeated.length
          ? (100 *
              repeated.filter((g) =>
                g.every(
                  (t) =>
                    t.status === "done" &&
                    t.output?.trim() === g[0].output?.trim(),
                ),
              ).length) /
            repeated.length
          : null,
        tokens:
          rows.length > 0 &&
          rows.every((t) => t.input_tokens !== null && t.output_tokens !== null)
            ? rows.reduce(
                (s, t) => s + (t.input_tokens ?? 0) + (t.output_tokens ?? 0),
                0,
              )
            : null,
        cost:
          rows.length > 0 && rows.every((t) => t.cost !== null)
            ? rows.reduce((s, t) => s + t.cost!, 0)
            : null,
      };
    })
    .filter((m) => m.n)
    .sort((a, b) => b.score - a.score);
}
