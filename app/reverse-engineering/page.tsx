"use client";
import Link from "next/link";
import { ArrowUpRight, Plus } from "lucide-react";
import { bytes, date, Empty, ErrorNotice, JobTable, Loading, PageHeading, type Row, text, useResource } from "./client";
import { useReverseEngineering } from "./shell";
type Overview = { stats: Record<string, number>; recentJobs: Row[]; recentFindings: Row[]; recentActivity: Row[]; capacity: Record<string, unknown> };
export default function OverviewPage() {
  const { t, locale } = useReverseEngineering(); const resource = useResource<Overview>("overview", true);
  return <><PageHeading title="Reverse Engineering" description={t("مشاريعك وأدلتك ومسارات التحليل في مساحة واحدة.", "Your projects, evidence, and analysis workflows in one workspace.")} action={<Link className="re-button re-primary" href="/reverse-engineering/new"><Plus size={17} />{t("تحليل جديد", "New analysis")}</Link>} />
    {!!resource.error && <ErrorNotice error={resource.error} retry={resource.refresh} />}{resource.loading && !resource.data ? <Loading /> : resource.data && <>
      <div className="re-stats">{[["projects", "المشاريع", "Projects"], ["active", "تحليلات نشطة", "Active jobs"], ["completed", "مكتملة", "Completed"], ["failed", "غير ناجحة", "Failed"], ["availableEngines", "محركات متاحة", "Available engines"]].map(([key, ar, en]) => <div key={key}><span>{t(ar, en)}</span><strong>{resource.data!.stats[key] ?? "—"}</strong></div>)}</div>
      <div className="re-section-heading"><h2>{t("التحليلات الأخيرة", "Recent analyses")}</h2><Link href="/reverse-engineering/projects">{t("المشاريع", "Projects")}<ArrowUpRight size={15} /></Link></div><section className="re-panel"><JobTable jobs={resource.data.recentJobs ?? []} /></section>
      <div className="re-two-column"><section className="re-panel"><h2>{t("آخر النتائج", "Recent findings")}</h2>{resource.data.recentFindings?.length ? <ul className="re-records">{resource.data.recentFindings.map((finding) => <li key={text(finding.id)}><strong>{text(finding.title)}</strong><span>{text(finding.summary ?? finding.description)}</span><code>{text(finding.id)}</code></li>)}</ul> : <Empty>{t("ستظهر هنا النتائج المستخرجة من تحليلاتك.", "Findings from your analyses will appear here.")}</Empty>}</section>
      <section className="re-panel"><h2>{t("النشاط والاستخدام", "Activity & usage")}</h2><dl className="re-metadata"><div><dt>{t("مساحة الملفات", "Artifact storage")}</dt><dd>{bytes(resource.data.stats.storageBytes)}</dd></div><div><dt>{t("استقبال التحليلات", "Job intake")}</dt><dd>{resource.data.capacity?.acceptingJobs === true ? t("متاح", "Open") : t("متوقف حاليًا", "Currently paused")}</dd></div></dl>{resource.data.recentActivity?.length ? <ul className="re-records">{resource.data.recentActivity.map((event) => <li key={text(event.id)}><span>{text(event.action ?? event.event)}</span><small>{date(event.createdAt, locale)}</small></li>)}</ul> : <p className="re-muted">{t("لا يوجد نشاط مسجل بعد.", "No activity has been recorded yet.")}</p>}<Link className="re-text-link" href="/reverse-engineering/tools">{t("حالة المحركات وحدود الموارد", "Engine health & resource limits")}<ArrowUpRight size={15} /></Link></section></div>
    </> }</>;
}
