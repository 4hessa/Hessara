import {
  CATEGORIES,
  getTask,
  simulate,
  grade,
  VERSION,
  type Trial,
} from "@/lib/benchmarks";
import {
  identity,
  database,
  fail,
  HttpError,
  invokeModel,
  type ModelConfig,
} from "@/lib/server";
export const maxDuration = 120;
type RecordRun = {
  id: string;
  owner: string;
  mode: string;
  status: string;
  config: string;
  total: number;
  next_index: number;
  locked_until: number;
  lock_token: string;
};
const PAGE_SIZE = 250;
function page(url: string) {
  const params = new URL(url).searchParams;
  const parse = (key: string, fallback: number, min: number, max: number) => {
    const raw = params.get(key);
    if (raw === null) return fallback;
    if (!/^(0|[1-9]\d*)$/.test(raw)) throw new HttpError("INVALID_INPUT");
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < min || value > max)
      throw new HttpError("INVALID_INPUT");
    return value;
  };
  return {
    offset: parse("offset", 0, 0, 10_000_000),
    limit: parse("limit", PAGE_SIZE, 1, PAGE_SIZE),
  };
}
async function detail(id: string, owner: string, url: string) {
  const db = database(),
    run = await db
      .prepare("SELECT * FROM runs WHERE id=? AND owner=?")
      .bind(id, owner)
      .first<RecordRun>();
  if (!run) throw new HttpError("NOT_FOUND", 404);
  const { offset, limit } = page(url);
  const counts = await db
    .prepare(
      "SELECT count(*) AS total, sum(CASE WHEN status IN ('done','error') THEN 1 ELSE 0 END) AS done FROM trials WHERE run_id=?",
    )
    .bind(id)
    .first<{ total: number; done: number | null }>();
  const rows = await db
    .prepare(
      "SELECT * FROM trials WHERE run_id=? ORDER BY rowid LIMIT ? OFFSET ?",
    )
    .bind(id, limit, offset)
    .all<Trial>();
  const total = counts?.total ?? 0;
  return {
    run: {
      ...run,
      done: counts?.done ?? 0,
    },
    trials: rows.results,
    pagination: {
      offset,
      limit,
      total,
      nextOffset:
        offset + rows.results.length < total
          ? offset + rows.results.length
          : null,
    },
  };
}
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const owner = await identity(),
      { id } = await params;
    return Response.json(await detail(id, owner, request.url), {
      headers: { "cache-control": "no-store" },
    });
  } catch (e) {
    return fail(e);
  }
}
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  let token: string | null = null,
    id = "",
    owner = "";
  try {
    owner = await identity(request);
    id = (await params).id;
    const body = await request.json();
    if (
      !body ||
      typeof body !== "object" ||
      !("action" in body) ||
      body.action !== "step"
    )
      throw new HttpError("INVALID_INPUT");
    const db = database();
    const existing = await db
      .prepare("SELECT * FROM runs WHERE id=? AND owner=?")
      .bind(id, owner)
      .first<RecordRun>();
    if (!existing) throw new HttpError("NOT_FOUND", 404);
    if (existing.status === "completed")
      return Response.json(await detail(id, owner, request.url));
    const config = JSON.parse(existing.config);
    if (config.suite_version !== VERSION) throw new HttpError("VERSION");
    token = crypto.randomUUID();
    const run = await db
      .prepare(
        "UPDATE runs SET lock_token=?,locked_until=? WHERE id=? AND owner=? AND status='running' AND locked_until<? RETURNING *",
      )
      .bind(token, Date.now() + 120000, id, owner, Date.now())
      .first<RecordRun>();
    if (!run) throw new HttpError("BUSY", 409);
    await db
      .prepare(
        "UPDATE trials SET status='error',score=0,error='interrupted_unknown_outcome' WHERE run_id=? AND status='running'",
      )
      .bind(id)
      .run();
    const jobs = config.categories
      .flatMap((c: string) =>
        Array.from({ length: config.count }, (_, i) => ({
          task_id: `${c}-${String(i + 1).padStart(3, "0")}`,
        })),
      )
      .flatMap((t: { task_id: string }) =>
        Array.from({ length: config.repeats }, (_, repeat) =>
          config.models.map((model: string) => ({ ...t, repeat, model })),
        ),
      )
      .flat();
    let pauseReason: string | null = null;
    const concurrency =
      run.mode === "demo" ? 24 : config.concurrency === 1 ? 1 : 3;
    const batch = jobs.slice(run.next_index, run.next_index + concurrency);
    if (batch.length) {
      const prepared = batch.map((j: any) =>
        db
          .prepare(
            "INSERT INTO trials(id,run_id,model,task_id,repeat,status) VALUES(?,?,?,?,?,'running')",
          )
          .bind(
            `${id}:${j.model}:${j.task_id}:${j.repeat}`,
            id,
            j.model,
            j.task_id,
            j.repeat,
          ),
      );
      prepared.push(
        db
          .prepare("UPDATE runs SET next_index=? WHERE id=? AND lock_token=?")
          .bind(run.next_index + batch.length, id, token),
      );
      await db.batch(prepared);
      const outcomes = await Promise.allSettled(
        batch.map(async (j: any) => {
          const task = getTask(j.task_id);
          const start = performance.now();
          let r: any;
          try {
            r =
              run.mode === "demo"
                ? {
                    ...simulate(task, j.model, j.repeat),
                    error: null,
                    metadata: JSON.stringify({
                      provenance: "simulation",
                      latency: "synthetic",
                      tokens: "synthetic",
                    }),
                  }
                : await invokeModel(
                    task,
                    config.modelSnapshots.find(
                      (m: ModelConfig) => m.id === j.model,
                    ),
                    owner,
                  );
          } catch (e) {
            r = {
              output: "",
              latency: Math.round(performance.now() - start),
              input_tokens: null,
              output_tokens: null,
              cost: null,
              error:
                e instanceof Error &&
                ["TimeoutError", "AbortError"].includes(e.name)
                  ? "timeout"
                  : "provider_transport_error",
              metadata: "{}",
            };
          }
          await db
            .prepare(
              "UPDATE trials SET status=?,score=?,output=?,latency=?,input_tokens=?,output_tokens=?,cost=?,error=?,metadata=? WHERE id=? AND status='running' AND EXISTS(SELECT 1 FROM runs WHERE runs.id=trials.run_id AND runs.lock_token=?)",
            )
            .bind(
              r.error ? "error" : "done",
              r.error ? 0 : grade(task, r.output),
              r.output,
              r.latency,
              r.input_tokens,
              r.output_tokens,
              r.cost,
              r.error,
              r.metadata,
              `${id}:${j.model}:${j.task_id}:${j.repeat}`,
              token,
            )
            .run();
          return r.error as string | null;
        }),
      );
      if (outcomes.some((x) => x.status === "rejected"))
        throw new Error("Failed to persist batch");
      pauseReason =
        outcomes.find(
          (x) =>
            x.status === "fulfilled" &&
            /^(provider_http_(401|403|429)|provider_pending)$/.test(
              x.value ?? "",
            ),
        )?.status === "fulfilled"
          ? "provider_attention"
          : null;
    }
    await db
      .prepare(
        "UPDATE runs SET lock_token=NULL,locked_until=0,status=CASE WHEN next_index>=total THEN 'completed' ELSE 'running' END WHERE id=? AND lock_token=?",
      )
      .bind(id, token)
      .run();
    token = null;
    return Response.json({
      ...(await detail(id, owner, request.url)),
      pauseReason,
    });
  } catch (e) {
    if (token) {
      try {
        await database()
          .prepare(
            "UPDATE runs SET locked_until=0,lock_token=NULL WHERE id=? AND owner=? AND lock_token=?",
          )
          .bind(id, owner, token)
          .run();
      } catch {}
    }
    return fail(e);
  }
}
