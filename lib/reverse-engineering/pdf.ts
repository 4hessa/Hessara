import PDFDocument from "pdfkit";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";

export async function reportPdf(report: { id: string; createdAt: number; generatedAt?: number; exportMode?: string }, job: Record<string, unknown>, findings: Record<string, unknown>[], evidence: Record<string, unknown>[]) {
  // Only bounded normalized evidence is rendered. No artifact HTML, attachments,
  // external URLs, JavaScript or executable PDF actions are ever embedded.
  const doc = new PDFDocument({ size: "A4", margin: 44, info: { Title: "HESSARA Reverse Engineering Report", Author: "HESSARA" }, autoFirstPage: true, compress: true });
  const chunks: Buffer[] = []; let size = 0;
  const result = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (chunk: Buffer) => { size += chunk.length; if (size > 4 * 1024 * 1024) { (doc as unknown as Readable).destroy(); reject(new Error("REPORT_TOO_LARGE")); } else chunks.push(chunk); });
    doc.on("error", reject); doc.on("end", () => resolve(Buffer.concat(chunks)));
  });
  const font = await readFile(path.join(process.cwd(), "public/fonts/font-2.ttf"));
  doc.font(font).fillColor("#121212").fontSize(20).text("HESSARA", { align: "left" }).fontSize(14).text("Reverse Engineering / Analysis Report").moveDown();
  const line = (label: string, value: unknown) => doc.fontSize(9).text(`${label}: ${String(value ?? "Unknown").slice(0, 2000)}`, { width: 500, lineGap: 3 }).moveDown(.35);
  line("Report ID", report.id); line("Record requested", new Date(report.createdAt).toISOString()); line("Export generated", new Date(report.generatedAt ?? Date.now()).toISOString());
  line("Export mode", "Regenerated from currently retained results; not an immutable historical snapshot. Retention may remove earlier evidence.");
  for (const key of ["id", "projectName", "artifactName", "artifactSha256", "engineId", "status", "startedAt", "finishedAt"]) line(key, job[key]);
  line("Summary", job.summary);
  doc.moveDown().fontSize(14).text("Findings / Observations").moveDown(.5);
  for (const finding of findings.slice(0, 100)) {
    if (doc.y > 700) doc.addPage();
    line("Finding", finding.id); line("Title", finding.title); line("Severity / confidence", `${finding.severity} / ${finding.confidence}`);
    line("Description", finding.description); line("Evidence IDs", JSON.stringify(finding.evidenceIds)); doc.moveDown(.5);
  }
  doc.fontSize(14).text("Evidence index").moveDown(.5);
  for (const item of evidence.slice(0, 100)) line(String(item.id), `${item.kind} / ${item.name} / ${item.location ?? ""}`);
  doc.moveDown().fontSize(9).text("This bounded report contains up to 100 findings and evidence references. Use paginated workspace results and JSON export for further review. Tool observations do not by themselves establish exploitability. No application was launched by this report generator.");
  doc.end(); return result;
}
