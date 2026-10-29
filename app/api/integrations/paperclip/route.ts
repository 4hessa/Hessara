import { z } from "zod";
import { identity, database, settings, fail, HttpError } from "@/lib/server";
import { paperclipIssue } from "@/lib/paperclip";
import type { Trial } from "@/lib/benchmarks";
function destination(owner: string) {
  const e = settings();
  if (
    !e.PAPERCLIP_BASE_URL ||
    !e.PAPERCLIP_API_KEY ||
    !e.PAPERCLIP_COMPANY_ID ||
    e.PAPERCLIP_OWNER_ID !== owner
  )
    return null;
  try {
    const u = new URL(e.PAPERCLIP_BASE_URL);
    if (
      u.protocol !== "https:" ||
      u.username ||
      u.password ||
      u.search ||
      u.hash
    )
      return null;
    return {
      url: u,
      token: e.PAPERCLIP_API_KEY,
      company: e.PAPERCLIP_COMPANY_ID,
    };
  } catch {
    return null;
  }
}
export async function GET() {
  try {
    const owner = await identity(),
      d = destination(owner);
    return Response.json(
      { ready: !!d, host: d?.url.origin ?? null },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (e) {
    return fail(e);
  }
}
export async function POST(request: Request) {
  try {
    const owner = await identity(request),
      v = z
        .object({
          runId: z.string().uuid(),
          action: z.enum(["download", "send"]),
        })
        .strict()
        .safeParse(await request.json());
    if (!v.success) throw new HttpError("INVALID_INPUT");
    const db = database(),
      run = await db
        .prepare("SELECT * FROM runs WHERE id=? AND owner=?")
        .bind(v.data.runId, owner)
        .first<{
          id: string;
          name: string;
          mode: string;
          status: string;
          config: string;
          total: number;
        }>();
    if (!run) throw new HttpError("NOT_FOUND", 404);
    const trials = await db
      .prepare(
        "SELECT model,task_id,status,score,latency,cost FROM trials WHERE run_id=?",
      )
      .bind(run.id)
      .all<
        Pick<
          Trial,
          "model" | "task_id" | "status" | "score" | "latency" | "cost"
        >
      >();
    const issue = paperclipIssue(run, trials.results);
    if (v.data.action === "download")
      return Response.json(
        { issue },
        { headers: { "cache-control": "no-store" } },
      );
    const d = destination(owner);
    if (!d) throw new HttpError("NOT_READY", 409);
    const id = crypto.randomUUID();
    const inserted = await db
      .prepare(
        "INSERT INTO integration_exports(id,owner,run_id,destination,status,created_at) VALUES(?,?,?,'paperclip','pending',?) ON CONFLICT(owner,run_id,destination) DO NOTHING",
      )
      .bind(id, owner, run.id, new Date().toISOString())
      .run();
    if (inserted.meta.changes !== 1) {
      const previous = await db
        .prepare(
          "SELECT status,external_id FROM integration_exports WHERE owner=? AND run_id=? AND destination='paperclip'",
        )
        .bind(owner, run.id)
        .first();
      return Response.json({ previous }, { status: 409 });
    }
    try {
      const response = await fetch(
        new URL(
          `/api/companies/${encodeURIComponent(d.company)}/issues`,
          d.url,
        ),
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${d.token}`,
          },
          body: JSON.stringify(issue),
          redirect: "error",
          signal: AbortSignal.timeout(25000),
        },
      );
      if (!response.ok) throw new Error("Paperclip rejected request");
      const created = (await response.json()) as { id: string };
      if (!created.id) throw new Error("Missing receipt");
      await db
        .prepare(
          "UPDATE integration_exports SET status='sent',external_id=? WHERE id=?",
        )
        .bind(created.id, id)
        .run();
      return Response.json({ id: created.id, status: "sent" });
    } catch {
      await db
        .prepare("UPDATE integration_exports SET status='unknown' WHERE id=?")
        .bind(id)
        .run();
      throw new HttpError("INTEGRATION_UNKNOWN", 502);
    }
  } catch (e) {
    return fail(e instanceof SyntaxError ? new HttpError("INVALID_INPUT") : e);
  }
}
