import type { createReverseEngineeringService } from "./service.ts";
type Service = ReturnType<typeof createReverseEngineeringService>;
// Infrastructure fields belong to database access, not the shareable analysis.
// Keep nested analysis metadata intact and never mutate service-owned rows.
function reportRow(row: Record<string, unknown>) {
  const { storageKey: _storage, owner: _owner, ...safe } = row; void _storage; void _owner;
  return safe;
}
export async function regeneratedReport(service: Pick<Service, "getReport" | "getJob" | "findings" | "evidence">, owner: string, reportId: string, generatedAt = Date.now()) {
  const record = await service.getReport(owner, reportId);
  const job = await service.getJob(owner, String(record.jobId));
  const [findings, evidence] = await Promise.all([service.findings(owner, String(job.id), { limit: 100 }), service.evidence(owner, String(job.id), { limit: 100 })]);
  return { report: { ...reportRow(record), id: String(record.id), createdAt: Number(record.createdAt), generatedAt, exportMode: "regenerated" as const }, job: reportRow(job), findings: findings.map(reportRow), evidence: evidence.map(reportRow),
    limits: { findings: 100, evidence: 100 },
    notice: "Regenerated from currently retained results at generatedAt; this is not an immutable historical snapshot. Up to 100 findings and evidence records are included. Retention may remove earlier evidence; inspect paginated workspace results for further records." };
}
