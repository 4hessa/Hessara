"use client";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { FileText, RefreshCw, Square } from "lucide-react";
import { api, bytes, date, Empty, ErrorNotice, Loading, PageHeading, Pagination, Status, text, type List, type Row, useResource } from "../../client";
import { useReverseEngineering } from "../../shell";
const CodeViewer = dynamic(() => import("../../code-viewer"), { loading: () => <Loading /> });
type JobResponse = { job: Row; artifact?: Row; execution?: Row | null };
const terminalStatuses = new Set(["completed", "failed", "cancelled", "timed_out"]);
const pollJob = (data: JobResponse) => ["queued", "validating", "running"].includes(text(data?.job?.status));
const tabs = [["findings", "النتائج", "Findings"], ["evidence", "الأدلة", "Evidence"], ["functions", "الدوال", "Functions"], ["symbols", "الرموز", "Symbols"], ["strings", "النصوص", "Strings"], ["dependencies", "الاعتماديات", "Dependencies"], ["code", "المصدر المفكك", "Decompiled code"], ["logs", "سجل التنفيذ", "Execution logs"]] as const;
export function JobWorkspace({ jobId }: { jobId: string }) {
  const { t, locale } = useReverseEngineering(); const router = useRouter(); const [tab, setTab] = useState("findings"); const [search, setSearch] = useState(""); const [query, setQuery] = useState(""); const [offset, setOffset] = useState(0); const [file, setFile] = useState<Row | null>(null); const [error, setError] = useState<unknown>(null); const [busy, setBusy] = useState(false);
  const resource = useResource<JobResponse>(`jobs/${encodeURIComponent(jobId)}`, pollJob);
  const job = resource.data?.job; const hasJob = !!job; const status = text(job?.status); const active = ["queued", "validating", "running"].includes(status);
  const results = useResource<List>(`jobs/${encodeURIComponent(jobId)}/${tab}?limit=25&offset=${offset}&search=${encodeURIComponent(search)}`, tab === "logs" && active);
  const refreshResults = results.refresh;
  // A metadata refresh temporarily clears job data; retain the last observed status.
  const observedStatus = useRef({ jobId: "", status: "" });
  useEffect(() => {
    if (!hasJob) return;
    const previous = observedStatus.current;
    observedStatus.current = { jobId, status };
    if (terminalStatuses.has(status) && (previous.jobId !== jobId || previous.status !== status)) refreshResults();
  }, [jobId, status, hasJob, refreshResults]);
  function refreshWorkspace() { resource.refresh(); results.refresh(); }
  function navigateTabs(event: KeyboardEvent<HTMLDivElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (index < 0) return;
    event.preventDefault();
    const direction = (event.key === "ArrowRight" ? 1 : -1) * (locale === "ar" ? -1 : 1);
    const target = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + direction + buttons.length) % buttons.length;
    buttons[target].focus(); buttons[target].click();
  }
  async function action(path: string) { setBusy(true); setError(null); try { const response = await api<Row>(path, { method: "POST", body: "{}" }); if (path === "reports") void response; resource.refresh(); results.refresh(); } catch (failure) { setError(failure); } finally { setBusy(false); } }
  async function report() { setBusy(true); setError(null); try { await api("reports", { method: "POST", body: JSON.stringify({ jobId }) }); router.push("/reverse-engineering/reports"); } catch (failure) { setError(failure); } finally { setBusy(false); } }
  return <><PageHeading title={t("مساحة التحليل", "Analysis workspace")} description={t("نتائج موثقة مرتبطة بالملف والمهمة الأصلية.", "Evidence-linked results tied to the original artifact and job.")} action={<button type="button" onClick={refreshWorkspace}><RefreshCw size={16} />{t("تحديث", "Refresh")}</button>} />{!!resource.error && <ErrorNotice error={resource.error} retry={resource.refresh} />}{!!error && <ErrorNotice error={error} />}{resource.loading && !job ? <Loading /> : job && <><section className="re-panel re-job-summary"><div className="re-section-heading"><h2>{text(resource.data?.artifact?.name ?? job.artifactName ?? job.id)}</h2><Status value={job.status} /></div><dl className="re-metadata re-metadata-grid"><div><dt>{t("معرّف المهمة", "Job ID")}</dt><dd><code>{text(job.id)}</code></dd></div><div><dt>{t("المحرك", "Engine")}</dt><dd>{text(job.engineId)}</dd></div><div><dt>{t("المرحلة", "Current stage")}</dt><dd>{text(job.stage ?? resource.data?.execution?.stage ?? job.status)}</dd></div><div><dt>{t("الإنشاء", "Created")}</dt><dd>{date(job.createdAt, locale)}</dd></div><div><dt>{t("حجم الملف", "Artifact size")}</dt><dd>{bytes(resource.data?.artifact?.sizeBytes ?? resource.data?.artifact?.size)}</dd></div><div><dt>SHA-256</dt><dd className="re-hash" dir="ltr">{text(resource.data?.artifact?.sha256)}</dd></div></dl>{job.errorCode ? <div className="re-notice re-notice-error">{t("لم يكتمل التحليل. رمز التشخيص:", "Analysis did not complete. Diagnostic code:")} <code>{text(job.errorCode)}</code></div> : null}<div className="re-actions">{active && <button type="button" disabled={busy} onClick={() => void action(`jobs/${jobId}/cancel`)}><Square size={14} />{t("إلغاء التحليل", "Cancel analysis")}</button>}<Link className="re-button" href={`/reverse-engineering/assistant?project=${encodeURIComponent(text(job.projectId))}&job=${encodeURIComponent(jobId)}`}>{t("اسأل مساعد التحليل", "Ask analysis assistant")}</Link><button type="button" disabled={busy || job.status !== "completed"} onClick={() => void report()}><FileText size={16} />{t("إنشاء تقرير", "Generate report")}</button></div>{active && <p className="re-muted" role="status">{t("تُحدّث الحالة تلقائيًا. تظهر المرحلة الفعلية عندما لا يوفر المحرك نسبة تقدم قابلة للقياس.", "Status updates automatically. The actual stage is shown when the engine does not measure progress.")}</p>}</section>
      <div className="re-result-tabs" onKeyDown={navigateTabs} role="tablist" aria-label={t("مستكشف النتائج", "Results explorer")}>{tabs.map(([id, ar, en]) => <button type="button" key={id} role="tab" id={`re-tab-${id}`} aria-controls="re-result-panel" aria-selected={tab === id} tabIndex={tab === id ? 0 : -1} onClick={() => { setTab(id); setOffset(0); setSearch(""); setQuery(""); setFile(null); }}>{t(ar, en)}</button>)}</div><section className="re-panel" id="re-result-panel" role="tabpanel" aria-labelledby={`re-tab-${tab}`}><form className="re-inline-form re-result-search" onSubmit={(event) => { event.preventDefault(); setSearch(query); setOffset(0); }}><label className="re-sr-only" htmlFor="re-result-search">{t("ابحث في النتائج", "Search results")}</label><input id="re-result-search" placeholder={t("ابحث في النتائج…", "Search results…")} value={query} maxLength={150} onChange={(event) => setQuery(event.target.value)} /><button type="submit">{t("بحث", "Search")}</button></form>{!!results.error && <ErrorNotice error={results.error} retry={results.refresh} />}{results.loading && !results.data ? <Loading /> : results.data?.items.length ? tab === "code" ? <><ul className="re-code-files">{results.data.items.map((item) => <li key={text(item.id ?? item.path)}><button type="button" onClick={() => setFile(item)} aria-pressed={file?.id === item.id}>{text(item.path ?? item.name)}</button></li>)}</ul>{file && <CodeViewer key={text(file.id ?? file.path)} file={file} jobId={jobId} />}</> : <ul className={`re-records${tab === "logs" ? " re-logs" : ""}`}>{results.data.items.map((item, index) => <li key={text(item.id ?? index)}>{tab === "logs" ? <><small>{date(item.createdAt ?? item.timestamp, locale)}</small><pre dir="ltr">{text(item.message ?? item.content ?? item.text)}</pre></> : <><div className="re-section-heading"><strong>{text(item.title ?? item.name ?? item.value ?? item.address ?? item.id)}</strong>{item.severity ? <span className="re-status">{text(item.severity)}</span> : null}</div>{item.description || item.summary ? <p>{text(item.description ?? item.summary)}</p> : null}{item.content || item.text ? <pre dir="ltr">{text(item.content ?? item.text)}</pre> : null}<dl className="re-metadata">{Object.entries(item).filter(([key, value]) => !["title", "name", "value", "description", "summary", "content", "text", "severity"].includes(key) && (typeof value === "string" || typeof value === "number")).slice(0, 12).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{text(value)}</dd></div>)}</dl></>}</li>)}</ul> : <Empty>{t("لا توجد عناصر لهذا العرض. قد لا يدعم المحرك هذا النوع من المخرجات، أو لم ينتج التحليل بيانات بعد.", "No items are available in this view. The engine may not support this output, or the analysis has not produced data yet.")}</Empty>}<Pagination offset={offset} total={results.data?.total ?? 0} change={setOffset} /></section>
    </>}</>;
}



