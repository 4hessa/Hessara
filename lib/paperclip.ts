import { CATEGORIES, type Trial } from "./benchmarks.ts";

type ReviewTrial = Pick<
  Trial,
  "model" | "task_id" | "status" | "score" | "latency" | "cost"
>;

function reviewMetrics(trials: ReviewTrial[], modelId: string) {
  const rows = trials.filter(
    (trial) =>
      trial.model === modelId && ["done", "error"].includes(trial.status),
  );
  const categoryScores = CATEGORIES.map((category) => {
    const categoryRows = rows.filter((trial) =>
      trial.task_id.startsWith(category.id + "-"),
    );
    return categoryRows.length
      ? (100 *
          categoryRows.reduce((sum, trial) => sum + (trial.score ?? 0), 0)) /
          categoryRows.length
      : null;
  }).filter((score): score is number => score !== null);
  const latencies = rows
    .flatMap((trial) => (trial.latency === null ? [] : [trial.latency]))
    .sort((a, b) => a - b);
  return {
    score: categoryScores.length
      ? categoryScores.reduce((sum, score) => sum + score, 0) /
        categoryScores.length
      : 0,
    p50: latencies.length
      ? latencies[Math.ceil(latencies.length * 0.5) - 1]
      : null,
    p95: latencies.length
      ? latencies[Math.ceil(latencies.length * 0.95) - 1]
      : null,
    errors: rows.filter((trial) => trial.status === "error").length,
    cost:
      rows.length && rows.every((trial) => trial.cost !== null)
        ? rows.reduce((sum, trial) => sum + trial.cost!, 0)
        : null,
  };
}
export function paperclipIssue(
  run: {
    id: string;
    name: string;
    mode: string;
    status: string;
    config: string;
    total: number;
  },
  trials: ReviewTrial[],
) {
  const config = JSON.parse(run.config);
  const rows: ({ name: string } & ReturnType<typeof reviewMetrics>)[] = (
    config.modelSnapshots ?? []
  ).map((model: { id: string; name: string }) => ({
    name: model.name,
    ...reviewMetrics(trials, model.id),
  }));
  const summary = rows
    .map(
      (m) =>
        `| ${String(m.name).replace(/[|\r\n]/g, " ")} | ${m.score.toFixed(1)}% | ${m.p50 ?? "unknown"} | ${m.p95 ?? "unknown"} | ${m.errors} | ${m.cost === null ? "unknown" : m.cost.toFixed(6)} |`,
    )
    .join("\n");
  return {
    title: `Hessara: review ${run.name}`.slice(0, 180),
    status: "backlog",
    priority: "medium",
    description: `## Evaluation review\nRun: ${run.id}\nSuite: ${config.suite_version}\nMode: ${run.mode}\nState: ${run.status}\nCompleted attempts: ${trials.filter((t) => ["done", "error"].includes(t.status)).length}/${run.total}\n\n| Model | Quality | p50 ms | p95 ms | Errors | Estimated USD |\n|---|---|---|---|---|---|\n${summary}\n\n## Work requested\n1. Review failures and category coverage in Hessara.\n2. Compare quality, latency and cost for the intended use case.\n3. Propose a follow-up experiment with the same prompts and explicit budget.\n4. Have a human review the recommendation before changing any production model.\n\nSimulation is synthetic and is not evidence of a commercial model's performance. Partial runs do not establish a final ranking. This issue includes aggregate metrics only; no API keys or model response bodies. No agent is assigned automatically.`,
  };
}
