import { z } from "zod";
import { CATEGORIES, VERSION } from "@/lib/benchmarks";
import { NVIDIA_POLICY } from "@/lib/nvidia";
import {
  identity,
  database,
  availableModels,
  modelConfig,
  fail,
  HttpError,
} from "@/lib/server";
const input = z
  .object({
    name: z.string().trim().min(1).max(80),
    mode: z.enum(["demo", "live"]),
    models: z.array(z.string()).min(1).max(30),
    categories: z
      .array(
        z.enum([
          "coding",
          "logic",
          "analysis",
          "retrieval",
          "instruction",
          "long",
        ]),
      )
      .min(1)
      .max(6),
    count: z.union([z.literal(4), z.literal(12), z.literal(40)]),
    repeats: z.union([z.literal(1), z.literal(3)]),
  })
  .strict();
export async function GET() {
  try {
    const owner = await identity();
    const rows = await database()
      .prepare(
        "SELECT r.*, (SELECT count(*) FROM trials t WHERE t.run_id=r.id AND t.status IN ('done','error')) AS done FROM runs r WHERE owner=? ORDER BY created_at DESC LIMIT 100",
      )
      .bind(owner)
      .all();
    return Response.json(
      { runs: rows.results, models: await availableModels(owner) },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (e) {
    return fail(e);
  }
}
export async function POST(request: Request) {
  try {
    const owner = await identity(request);
    const result = input.safeParse(await request.json());
    if (!result.success) throw new HttpError("INVALID_INPUT");
    const c = result.data;
    if (
      new Set(c.models).size !== c.models.length ||
      new Set(c.categories).size !== c.categories.length
    )
      throw new HttpError("INVALID_INPUT");
    const models = await availableModels(owner);
    if (
      c.models.some(
        (id) =>
          !models.some(
            (m) =>
              m.id === id &&
              m.ready &&
              (c.mode === "demo"
                ? m.provider === "simulation"
                : m.provider !== "simulation"),
          ),
      )
    )
      throw new HttpError("NOT_READY");
    const db = database();
    const open = await db
      .prepare(
        "SELECT count(*) AS n FROM runs WHERE owner=? AND status='running'",
      )
      .bind(owner)
      .first<{ n: number }>();
    if ((open?.n ?? 0) >= 10) throw new HttpError("LIMIT", 429);
    const id = crypto.randomUUID(),
      created_at = new Date().toISOString();
    const modelSnapshots = await Promise.all(
      c.models.map((id) => modelConfig(id, owner)),
    );
    const config = JSON.stringify({
      ...c,
      categories: CATEGORIES.filter((x) => c.categories.includes(x.id)).map(
        (x) => x.id,
      ),
      modelSnapshots,
      suite_version: VERSION,
      // A mixed-provider run has no single output or timeout policy.
      max_output_tokens: modelSnapshots.every((m) => m.provider !== "nvidia")
        ? 512
        : modelSnapshots.every((m) => m.provider === "nvidia")
          ? NVIDIA_POLICY.max_output_tokens
          : null,
      timeout_ms: modelSnapshots.every((m) => m.provider !== "nvidia")
        ? 55000
        : modelSnapshots.every((m) => m.provider === "nvidia")
          ? NVIDIA_POLICY.timeout_ms
          : null,
      providerPolicies: Object.fromEntries(
        modelSnapshots.map((m) => [
          m.id,
          m.provider === "nvidia"
            ? NVIDIA_POLICY
            : { max_output_tokens: 512, timeout_ms: 55000 },
        ]),
      ),
      retries: 0,
      concurrency:
        c.mode === "demo"
          ? 24
          : modelSnapshots.some((m) => m.provider === "nvidia")
            ? 1
            : 3,
      sampling: "provider defaults",
      pricing_recorded_at: created_at,
    });
    const total = c.models.length * c.categories.length * c.count * c.repeats;
    const inserted = await db
      .prepare(
        "INSERT INTO runs(id,owner,name,mode,status,created_at,config,total) SELECT ?,?,?,?,?,?,?,? WHERE (SELECT count(*) FROM runs WHERE owner=? AND status='running')<10",
      )
      .bind(
        id,
        owner,
        c.name,
        c.mode,
        "running",
        created_at,
        config,
        total,
        owner,
      )
      .run();
    if (inserted.meta.changes !== 1) throw new HttpError("LIMIT", 429);
    return Response.json(
      {
        run: {
          id,
          name: c.name,
          mode: c.mode,
          status: "running",
          created_at,
          config,
          total,
          done: 0,
        },
      },
      { status: 201 },
    );
  } catch (e) {
    if (e instanceof SyntaxError) return fail(new HttpError("INVALID_INPUT"));
    return fail(e);
  }
}
