import { randomUUID } from "node:crypto";
import { z } from "zod";
import { authenticatedUser } from "@/lib/auth";
import { availableModels, invokeModel, modelConfig } from "@/lib/server";
import { database } from "@/lib/postgres-database";
import { reService, ReError } from "@/lib/reverse-engineering/service";
import { reQueue } from "@/lib/reverse-engineering/queue";
import { engineCatalog } from "@/lib/reverse-engineering/catalog";
import { ArtifactError } from "@/lib/reverse-engineering/content";
import { isReverseAdmin, pagination, readReJson, requireWorker } from "@/lib/reverse-engineering/security";
import { signArtifactUpload, signWorkerArtifact, storageHealth, verifyStoredArtifact } from "@/lib/reverse-engineering/storage";
import { evidencePrompt, groundedAnswer, realAssistantModels, type CitedEvidence } from "@/lib/reverse-engineering/assistant";
import type { AnalysisArtifact, AnalysisResult, EvidenceKind, WorkerHeartbeat, WorkerRegistration } from "@/lib/reverse-engineering/types";
import { reDiagnostics, rePhase, type RePhase } from "@/lib/reverse-engineering/diagnostics";
import { regeneratedReport } from "@/lib/reverse-engineering/report-export";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";
const noStore = { "cache-control": "no-store", "x-content-type-options": "nosniff" };
const reply = (value: unknown, status = 200) => Response.json(value, { status, headers: noStore });
const uuid = z.string().uuid();
const name = z.string().trim().min(1).max(120);
const projectInput = z.object({ name, description: z.string().max(2000).optional() }).strict();
const safeArtifact = (artifact: Record<string, unknown>) => { const { storageKey: _key, owner: _owner, ...safe } = artifact; void _key; void _owner; return safe; };
async function rateLimit(owner: string, group: string, maximum: number) {
  const now = Date.now();
  const row = await database().prepare(`INSERT INTO auth_limits(bucket,expires_at,used) VALUES(?,?,1) ON CONFLICT(bucket) DO UPDATE SET expires_at=CASE WHEN auth_limits.expires_at<=? THEN excluded.expires_at ELSE auth_limits.expires_at END,used=CASE WHEN auth_limits.expires_at<=? THEN 1 ELSE auth_limits.used+1 END WHERE auth_limits.expires_at<=? OR auth_limits.used<? RETURNING used`).bind(`re:${group}:${owner}`, now + 60000, now, now, now, maximum).first();
  if (!row) throw new ReError("RATE_LIMIT", 429);
}
async function worker(request: Request) {
  requireWorker(request);
  const body = await readReJson(request, 2300000);
  const action = body.action;
  if (action === "claim" || action === "register") {
    const registration = (body.registration ?? body) as WorkerRegistration;
    await rateLimit(registration.workerId || "invalid", "worker", 60);
    if (action === "register") return reply(await reQueue.registerWorker(registration));
    const claimed = await reQueue.claim(registration);
    if (!claimed.job) return reply(claimed);
    try {
      const downloadUrl = await signWorkerArtifact(claimed.job.artifact.storageKey);
      return reply({ ...claimed, job: { ...claimed.job, artifact: { ...claimed.job.artifact, downloadUrl } } });
    } catch (error) {
      try {
        await reQueue.releaseClaim({ workerId: registration.workerId, jobId: claimed.job.id, leaseToken: claimed.leaseToken!, code: error instanceof ArtifactError ? error.code : "ARTIFACT_SIGN_FAILED" });
      } catch (releaseError) {
        console.error("Reverse engineering dispatch release failed", reDiagnostics(releaseError));
      }
      throw error;
    }
  }
  const lease = { workerId: String(body.workerId || ""), jobId: String(body.jobId || ""), leaseToken: String(body.leaseToken || "") };
  if (action === "heartbeat") return reply(await reQueue.heartbeat({ ...body, ...lease } as WorkerHeartbeat));
  if (action === "complete") return reply(await reQueue.complete({ ...lease, result: body.result as AnalysisResult }));
  if (action === "fail") return reply(await reQueue.fail({ ...lease, code: String(body.code || "TOOL_FAILED"), message: typeof body.message === "string" ? body.message.slice(0, 1000) : "Analysis worker failed", retryable: body.retryable === true }));
  if (action === "recover") return reply({ recovered: await reQueue.recover() });
  if (action === "maintenance") { const { maintainRetention } = await import("@/lib/reverse-engineering/retention"); return reply(await maintainRetention()); }
  throw new ReError("INVALID_ACTION");
}
async function paged<T>(items: T[], total: Promise<number> | number) { return { items, total: await total }; }
async function exportReport(owner: string, reportId: string) {
  return regeneratedReport(reService, owner, reportId);
}
async function handle(request: Request, context: { params: Promise<{ path: string[] }> }) {
  let phase: RePhase = "request";
  const requestId = randomUUID();
  try {
    const path = (await context.params).path, key = path.join("/"), method = request.method, url = new URL(request.url);
    if (key === "worker" && method === "POST") return await worker(request);
    if (key === "maintenance" && method === "GET") {
      requireWorker(request, process.env.CRON_SECRET || "");
      const { maintainRetention } = await import("@/lib/reverse-engineering/retention");
      return reply({ recovered: await reQueue.recover(), ...await maintainRetention() });
    }
    phase = "authentication";
    const user = await authenticatedUser();
    if (!user || user.is_anonymous) throw new ReError("AUTH_REQUIRED", 401);
    if (!["GET", "HEAD"].includes(method) && request.headers.get("origin") !== url.origin) throw new ReError("ORIGIN", 403);
    const owner = user.id, admin = isReverseAdmin(user);
    phase = "rate-limit";
    await rateLimit(owner, method === "GET" ? "read" : key === "assistant" ? "assistant" : "write", key === "assistant" && method !== "GET" ? 5 : method === "GET" ? 120 : 30);
    phase = "request";
    const page = pagination(url.searchParams);
    const count = (kind: string, filters: Record<string, unknown> = {}) => reService.count(owner, kind as "projects", { ...page, ...filters });
    if (method === "GET") {
      if (key === "overview") {
        const overview = await reService.overview(owner);
        const recentJobs = await rePhase("overview.recent-jobs", () => reService.listJobs(owner, { limit: 8 }));
        const observed = overview as Record<string, unknown>, stats: Record<string, number> = {};
        for (const [label, column] of Object.entries({ projects: "projects", active: "activeJobs", queued: "queuedJobs", completed: "completedJobs", failed: "failedJobs", availableEngines: "availableEngines", storageBytes: "storageBytes" })) {
          const value = Number(observed[column]); if (!Number.isFinite(value) || value < 0) throw new ReError("UNAVAILABLE", 503); stats[label] = value;
        }
        return reply({ ...overview, stats, recentJobs, capacity: overview.settings });
      }
      if (key === "tools") return reply({ items: (await reService.engines(owner)).map(engine => ({ ...engine, resources: { memoryMb: engine.memoryMb, cpuCount: engine.cpuCount, diskMb: engine.diskMb, timeoutSeconds: engine.timeoutSeconds } })) });
      if (key === "projects") return reply(await paged(await reService.listProjects(owner, page), count("projects")));
      if (path[0] === "projects" && path[2] === "artifacts" && path.length === 3) return reply(await paged((await reService.listArtifacts(owner, path[1], page)).map(safeArtifact), count("artifacts", { projectId: path[1] })));
      if (key === "jobs") { const filters = { ...page, projectId: url.searchParams.get("projectId") || undefined, status: url.searchParams.get("status") || undefined }; return reply(await paged(await reService.listJobs(owner, filters), count("jobs", filters))); }
      if (path[0] === "artifacts" && path[2] === "recommendations") {
        const artifact = await reService.getArtifact(owner, path[1]); const engines = await reService.engines(owner);
        const supported = engineCatalog.filter(engine => engine.formats.includes(artifact.format as never));
        return reply({ artifact: safeArtifact(artifact), unsupportedFormat: supported.length === 0, items: supported.map(engine => { const health = engines.find(item => item.id === engine.id); return { engineId: engine.id, name: engine.name, operational: health?.operational === true, operationalStatus: health?.operationalStatus ?? "unavailable", reasonCode: health?.reasonCode ?? "NO_WORKER", reason: `${String(artifact.format).toUpperCase()}: ${engine.description}` }; }), recommended: artifact.format ? reService.recommendEngines(artifact.format as never, engines.filter(e => e.operational).map(e => e.id)) : [] });
      }
      if (path[0] === "jobs" && path.length >= 2) {
        const job = await reService.getJob(owner, path[1]);
        if (path.length === 2) return reply({ job, artifact: { id: job.artifactId, name: job.artifactName, format: job.artifactFormat, sha256: job.artifactSha256, sizeBytes: job.artifactSizeBytes }, execution: (await reService.executions(owner, path[1], { limit: 1 }))[0] ?? null });
        if (path[2] === "findings") return reply(await paged(await reService.findings(owner, path[1], page), count("findings", { jobId: path[1] })));
        const kinds: Record<string, EvidenceKind | undefined> = { evidence: undefined, logs: "log", code: "code", functions: "function", symbols: "symbol", strings: "string", dependencies: "dependency" };
        if (Object.hasOwn(kinds, path[2])) {
          const kind = kinds[path[2]], fileId = url.searchParams.get("fileId");
          if (path[2] === "code" && fileId) {
            const item = await reService.evidenceById(owner, path[1], fileId);
            if (item.kind !== "code") throw new ReError("NOT_FOUND", 404);
            return reply({ id: item.id, content: item.content, path: item.name, language: (item.metadata as Record<string, unknown>)?.language || "text", truncated: !!(item.metadata as Record<string, unknown>)?.truncated });
          }
          const items = await reService.evidence(owner, path[1], { ...page, kind });
          return reply(await paged(items.map(item => ({ id: item.id, name: item.name, path: item.name, kind: item.kind, location: item.location, language: (item.metadata as Record<string, unknown>)?.language || "text", content: path[2] === "code" ? undefined : String(item.content || "").slice(0, 2000) })), count("evidence", { jobId: path[1], kind })));
        }
      }
      if (key === "reports") return reply(await paged(await reService.reports(owner, page), count("reports")));
      if (key === "reports/compare") {
        const ids = (url.searchParams.get("ids") || "").split(","); if (ids.length !== 2 || ids[0] === ids[1]) throw new ReError("INVALID_INPUT");
        const reports = await Promise.all(ids.map(id => exportReport(owner, uuid.parse(id))));
        if (!reports[0].job.artifactSha256 || reports[0].job.artifactSha256 !== reports[1].job.artifactSha256) throw new ReError("INCOMPARABLE_REPORTS", 409);
        return reply({ reports, comparison: { sameArtifact: true, engines: reports.map(r => r.job.engineId), limitation: "Different engine capabilities and configurations are not equivalent measurements." } });
      }
      if (path[0] === "reports" && path.length === 2) {
        const data = await exportReport(owner, path[1]);
        if (url.searchParams.get("format") === "pdf") { const { reportPdf } = await import("@/lib/reverse-engineering/pdf"); const pdf = await reportPdf({ id: String(data.report.id), createdAt: Number(data.report.createdAt), generatedAt: data.report.generatedAt, exportMode: data.report.exportMode }, data.job, data.findings, data.evidence); return new Response(new Uint8Array(pdf), { headers: { ...noStore, "content-type": "application/pdf", "content-disposition": `attachment; filename="hessara-analysis-${uuid.parse(data.report.id)}.pdf"` } }); }
        return new Response(JSON.stringify(data, null, 2), { headers: { ...noStore, "content-type": "application/json", "content-disposition": `attachment; filename="hessara-analysis-${uuid.parse(data.report.id)}.json"` } });
      }
      if (key === "assistant") return reply({ models: realAssistantModels(await availableModels(owner)) });
      if (key === "storage") return reply(await storageHealth());
      if (key === "admin") { const dashboard = await reService.adminOverview(owner, admin); return reply({ ...dashboard, queue: dashboard.jobs, usage: dashboard.metrics, acceptingJobs: dashboard.settings.acceptingJobs }); }
    }
    if (method === "POST") {
      const input = await readReJson(request);
      if (key === "projects") return reply({ project: await reService.createProject(owner, projectInput.parse(input)) }, 201);
      if (key === "artifacts/reserve") {
        const parsed = z.object({ projectId: uuid, name: z.string().min(1).max(240), size: z.number().int().positive() }).strict().parse(input);
        const health = await storageHealth(); if (parsed.size > health.maxUploadBytes) throw new ReError("ARTIFACT_TOO_LARGE", 413);
        const storageKey = `${owner}/${parsed.projectId}/${randomUUID()}`;
        const artifact = await reService.reserveArtifact(owner, { projectId: parsed.projectId, name: parsed.name, sizeBytes: parsed.size, storageKey });
        try { return reply({ artifact: safeArtifact(artifact), upload: await signArtifactUpload(owner, storageKey) }, 201); }
        catch (error) { await reService.rejectArtifact(owner, String(artifact.id), "STORAGE_UNAVAILABLE"); throw error; }
      }
      if (path[0] === "artifacts" && path[2] === "complete" && path.length === 3) {
        const artifact = await reService.getArtifact(owner, path[1]);
        if (artifact.status === "ready") return reply({ artifact: safeArtifact(artifact) });
        if (artifact.status !== "reserved") throw new ReError("UPLOAD_NOT_RESERVED", 409);
        const claim = await reService.claimArtifactVerification(owner, path[1]);
        try { return reply({ artifact: safeArtifact(await reService.completeArtifact(owner, path[1], { ...await verifyStoredArtifact(owner, artifact as unknown as AnalysisArtifact), verificationToken: claim.verificationToken })) }); }
        catch (error) {
          if (error instanceof ArtifactError && error.status < 500 && error.code !== "UPLOAD_NOT_FOUND") await reService.rejectArtifact(owner, path[1], error.code, claim.verificationToken);
          else await reService.releaseArtifactVerification(owner, path[1], claim.verificationToken);
          throw error;
        }
      }
      if (key === "jobs") return reply({ job: await reService.createJob(owner, input as never) }, 201);
      if (path[0] === "jobs" && path[2] === "cancel" && path.length === 3) return reply({ job: await reService.cancelJob(owner, path[1]) });
      if (key === "reports") { const data = z.object({ jobId: uuid, format: z.enum(["json", "pdf"]).default("json") }).strict().parse(input); return reply({ report: await reService.createReport(owner, data.jobId, { format: data.format }) }, 201); }
      if (key === "admin") { const data = z.object({ acceptingJobs: z.boolean().optional(), engineId: z.string().optional(), enabled: z.boolean().optional() }).strict().parse(input); return reply(await reService.configure(owner, admin, data)); }
      if (key === "assistant") {
        const data = z.object({ projectId: uuid, jobId: uuid.optional(), question: z.string().trim().min(1).max(3000), modelId: z.string().min(1).max(200).optional(), locale: z.enum(["ar", "en"]).default("ar"), providerConsent: z.boolean().optional() }).strict().parse(input);
        if (data.providerConsent !== true) throw new ReError("PROVIDER_CONSENT_REQUIRED", 403);
        const jobs = (await reService.listJobs(owner, { projectId: data.projectId, status: "completed", limit: 20 })).filter(j => !data.jobId || j.id === data.jobId);
        const evidence: CitedEvidence[] = []; let budget = 0;
        for (const job of jobs.slice(0, 4)) for (const item of await reService.evidence(owner, String(job.id), { limit: 12 })) {
          if (item.kind === "log") continue;
          const content = String(item.content || "").slice(0, 1500); if (budget + content.length > 12000) break; budget += content.length;
          evidence.push({ id: `${job.id}:${item.id}`, jobId: String(job.id), artifactId: String(job.artifactId), name: String(item.name), kind: String(item.kind), content });
        }
        if (!evidence.length) throw new ReError("NO_EVIDENCE", 409);
        const models = realAssistantModels(await availableModels(owner)), selected = models.find(m => m.id === data.modelId) || (!data.modelId ? models[0] : undefined);
        if (!selected) throw new ReError("MODEL_NOT_CONNECTED", 409);
        const config = await modelConfig(selected.id, owner);
        const result = await invokeModel({ prompt: evidencePrompt(data.question, data.locale, evidence) }, config, owner, { maxOutputTokens: config.provider === "cloudflare" ? 512 : 1800 });
        if (result.error || !result.output) throw new ReError("ASSISTANT_UNAVAILABLE", 502);
        return reply({ ...groundedAnswer(result.output, evidence), model: config.model });
      }
    }
    if (path[0] === "projects" && path.length === 2 && method === "PATCH") return reply({ project: await reService.renameProject(owner, path[1], projectInput.parse(await readReJson(request))) });
    if (path[0] === "projects" && path.length === 2 && method === "DELETE") return reply({ project: await reService.deleteProject(owner, path[1]) });
    if (path[0] === "artifacts" && path.length === 2 && method === "DELETE") return reply({ artifact: safeArtifact(await reService.deleteArtifact(owner, path[1])) });
    throw new ReError("NOT_FOUND", 404);
  } catch (error) {
    if (error instanceof ReError || error instanceof ArtifactError) return reply({ error: error.code }, error.status);
    if (error instanceof z.ZodError) return reply({ error: "INVALID_INPUT" }, 400);
    console.error("Reverse engineering API unavailable", { requestId, ...reDiagnostics(error, phase) });
    return reply({ error: "UNAVAILABLE", requestId }, 503);
  }
}
export { handle as GET, handle as POST, handle as PATCH, handle as DELETE };
