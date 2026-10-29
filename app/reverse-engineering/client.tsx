"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { useReverseEngineering } from "./shell";
export type Row = Record<string, unknown>;
export type List<T = Row> = { items: T[]; total: number };
export type Engine = { limitation?: string; id: string; name: string; description: string; formats: string[]; capabilities: string[] | Record<string, unknown>; status: string; operationalStatus?: "available" | "processing" | "unavailable" | "maintenance" | "error"; version?: string; resources?: Record<string, unknown>; runtimeCapabilities?: string[]; reasonCode?: string | null; lastHeartbeat?: number | null; lastVerifiedAt?: number | null; verifiedSample?: boolean; operational: boolean };
export class APIError extends Error { constructor(public code: string, public status: number) { super(code); } }
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/reverse-engineering/${path}`, { cache: "no-store", credentials: "same-origin", ...options, headers: { ...(options.body ? { "content-type": "application/json" } : {}), ...options.headers } });
  const data = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new APIError(String(data.error ?? "REQUEST_FAILED"), response.status);
  return data as T;
}
export function useResource<T>(path: string | null, polling: boolean | ((data: T) => boolean) = false) {
  const [revision, setRevision] = useState(0);
  const requestKey = `${path ?? ""}:${revision}`;
  const [state, setState] = useState<{ key: string; data: T | null; error: unknown; receivedAt: number }>({ key: "", data: null, error: null, receivedAt: 0 });
  const revisionRef = useRef(0);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    const generation = ++revisionRef.current;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    if (!path) return () => controller.abort();
    async function load() {
      let repeat = !!polling;
      try { const result = await api<T>(path!, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(25000)]) }); repeat = typeof polling === "function" ? polling(result) : polling; if (generation === revisionRef.current && !controller.signal.aborted) setState({ key: requestKey, data: result, error: null, receivedAt: Date.now() }); }
      catch (failure) { if (!controller.signal.aborted && generation === revisionRef.current) setState((previous) => ({ key: requestKey, data: previous.key === requestKey ? previous.data : null, error: failure, receivedAt: previous.receivedAt })); }
      finally { if (!controller.signal.aborted && generation === revisionRef.current && repeat) timer = setTimeout(load, document.hidden ? 20000 : 5000); }
    }
    void load();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [path, polling, revision, requestKey]);
  return { data: state.key === requestKey && path ? state.data : null, error: state.key === requestKey && path ? state.error : null, loading: !!path && state.key !== requestKey, receivedAt: state.receivedAt, refresh };
}
const errors: Record<string, [string, string]> = {
  UNAUTHENTICATED: ["انتهت الجلسة. سجّل الدخول مجددًا.", "Your session expired. Sign in again."],
  AUTH_REQUIRED: ["سجّل الدخول للمتابعة.", "Sign in to continue."],
  FORBIDDEN: ["لا تملك صلاحية الوصول إلى هذا المحتوى.", "You do not have access to this content."],
  NOT_FOUND: ["تعذّر العثور على العنصر أو ليس لديك صلاحية الوصول إليه.", "The item was not found or is not accessible."],
  DATABASE_NOT_CONFIGURED: ["مساحة التحليل غير مهيأة حاليًا. حاول لاحقًا.", "The analysis workspace is not configured yet. Try again later."],
  RE_NOT_CONFIGURED: ["مساحة التحليل غير مهيأة حاليًا. حاول لاحقًا.", "The analysis workspace is not configured yet. Try again later."],
  ENGINE_UNAVAILABLE: ["محرك التحليل غير متاح حاليًا. يمكنك الاحتفاظ بالملف في المشروع.", "The analysis engine is unavailable. You can keep the artifact in your project."],
  CAPACITY_EXHAUSTED: ["طاقة التحليل ممتلئة حاليًا. حاول لاحقًا.", "Analysis capacity is currently full. Try again later."],
  QUOTA_EXCEEDED: ["تم بلوغ حد الاستخدام أو التخزين.", "Your usage or storage limit has been reached."],
  UNSUPPORTED_FORMAT: ["صيغة الملف غير مدعومة.", "This artifact format is not supported."],
  INVALID_ARTIFACT: ["تعذّر التحقق من محتوى الملف.", "The artifact content could not be validated."],
  FILE_TOO_LARGE: ["الملف أكبر من الحد المسموح.", "The artifact exceeds the upload limit."],
  RATE_LIMITED: ["طلبات كثيرة خلال وقت قصير. حاول بعد قليل.", "Too many requests. Try again shortly."],
  NO_EVIDENCE: ["لا توجد أدلة محفوظة لهذا الاختيار بعد. أكمل تحليلًا فعليًا أولًا.", "No stored evidence exists for this selection yet. Complete an actual analysis first."],
  PROVIDER_CONSENT_REQUIRED: ["وافِق على إرسال أدلة المشروع إلى مزوّد النموذج قبل المتابعة.", "Consent to send project evidence to the model provider before continuing."],
  REQUEST_TIMEOUT: ["انتهت مهلة استقبال الطلب. أعد المحاولة.", "The request body timed out. Try again."],
  MODEL_NOT_CONNECTED: ["لا يوجد نموذج ذكاء اصطناعي متصل حاليًا.", "No AI model is currently connected."],
  ARTIFACT_BUSY: ["التحقق من الملف مشغول حاليًا. أعد محاولة التحقق بعد قليل؛ لا يلزم رفع نسخة جديدة.", "Artifact verification is busy. Retry validation shortly; a new upload is not needed."],
  PENDING_UPLOAD_QUOTA: ["وصلت إلى حد الملفات المنتظرة للتحقق. أكمل التحقق أو احذف ملفًا معلقًا من المشروع.", "The pending upload limit has been reached. Complete validation or delete a pending artifact from the project."],
  UPLOAD_NOT_FOUND: ["لم يكتمل رفع هذا الملف بعد. أعد رفعه من خطوة الملف أو احذف الحجز غير المكتمل.", "This artifact has not finished uploading. Resume the artifact upload or delete the incomplete reservation."],
  ARTIFACT_BUSY_OR_NOT_FOUND: ["الملف مرتبط بتحليل نشط أو لم يعد متاحًا.", "The artifact is used by an active analysis or is no longer available."],
  ARTIFACT_TOO_LARGE: ["الملف أكبر من حد الرفع المتاح.", "The artifact exceeds the current upload limit."],
  RATE_LIMIT: ["طلبات كثيرة خلال وقت قصير. حاول بعد قليل.", "Too many requests. Try again shortly."],
  PROJECT_QUOTA: ["تم بلوغ الحد المسموح للمشاريع.", "The project limit has been reached."],
  ENGINE_UNAVAILABLE_OR_QUEUE_CAPACITY: ["المحرك غير متاح أو طابور التحليل ممتلئ. حاول لاحقًا.", "The engine is unavailable or the analysis queue is full. Try again later."],
  STORAGE_UNAVAILABLE: ["خدمة حفظ الملفات غير متاحة حاليًا. حاول لاحقًا.", "Artifact storage is currently unavailable. Try again later."],
  INCOMPARABLE_REPORTS: ["المقارنة متاحة لتقريرين عن محتوى الملف نفسه فقط.", "Reports can be compared only when they analyze the same artifact content."],
};
export function errorMessage(error: unknown, locale: string) { const code = error instanceof APIError ? error.code : ""; const match = errors[code]; return match ? match[locale === "ar" ? 0 : 1] : locale === "ar" ? "تعذّر إكمال الطلب. حاول مجددًا؛ لم تُعرض نتائج غير مؤكدة." : "The request could not be completed. Try again; no unverified results are shown."; }
export function ErrorNotice({ error, retry }: { error: unknown; retry?: () => void }) { const { locale, t } = useReverseEngineering(); return <div className="re-notice re-notice-error" role="alert"><AlertCircle size={19} /><span>{errorMessage(error, locale)}</span>{retry && <button type="button" onClick={retry}><RefreshCw size={15} />{t("إعادة المحاولة", "Retry")}</button>}</div>; }
export function Loading() { const { t } = useReverseEngineering(); return <p className="re-loading" role="status"><span className="re-loading-dot" />{t("جارٍ تحميل البيانات…", "Loading data…")}</p>; }
export function Empty({ children }: { children: React.ReactNode }) { return <div className="re-empty">{children}</div>; }
export function PageHeading({ title, description, action }: { title: string; description?: string; action?: React.ReactNode }) { return <div className="re-page-heading"><div><p className="re-eyebrow" dir="ltr">HESSARA / RE</p><h1>{title}</h1>{description && <p>{description}</p>}</div>{action}</div>; }
export function Status({ value }: { value: unknown }) { const { t } = useReverseEngineering(); const status = String(value ?? "unknown"); const names: Record<string, [string, string]> = { available: ["متاح", "Available"], processing: ["قيد المعالجة", "Processing"], maintenance: ["صيانة", "Maintenance"], error: ["خطأ تشغيلي", "Error"], queued: ["في الانتظار", "Queued"], validating: ["جارٍ التحقق", "Validating"], running: ["قيد التحليل", "Running"], completed: ["مكتمل", "Completed"], failed: ["فشل", "Failed"], cancelled: ["ملغي", "Cancelled"], timed_out: ["انتهت المهلة", "Timed out"], unavailable: ["غير متاح", "Unavailable"], offline: ["غير متصل", "Offline"], ready: ["جاهز", "Ready"], healthy: ["سليم", "Healthy"], operational: ["متاح", "Available"], disabled: ["معطّل", "Disabled"], pending: ["بانتظار التحقق", "Pending validation"], reserved: ["بانتظار الرفع", "Reserved"], rejected: ["مرفوض", "Rejected"], deleted: ["محذوف مؤقتًا", "Deleted"], purged: ["محذوف نهائيًا", "Purged"], validated: ["تم التحقق", "Validated"] }; const name = names[status]; return <span className={`re-status re-status-${status.replace(/[^a-z_]/g, "")}`}>{name ? t(...name) : status}</span>; }
export function Pagination({ offset, total, limit = 25, change }: { offset: number; total: number; limit?: number; change: (offset: number) => void }) { const { t } = useReverseEngineering(); return total > limit ? <div className="re-pagination"><button disabled={offset === 0} onClick={() => change(Math.max(0, offset - limit))} type="button"><ChevronLeft size={16} />{t("السابق", "Previous")}</button><span>{offset + 1}–{Math.min(offset + limit, total)} / {total}</span><button disabled={offset + limit >= total} onClick={() => change(offset + limit)} type="button">{t("التالي", "Next")}<ChevronRight size={16} /></button></div> : null; }
export function text(value: unknown) { return typeof value === "string" || typeof value === "number" ? String(value) : "—"; }
export function bytes(value: unknown) { const number = Number(value); if (!Number.isFinite(number)) return "—"; return number >= 1048576 ? `${(number / 1048576).toFixed(1)} MB` : `${(number / 1024).toFixed(1)} KB`; }
export function date(value: unknown, locale: string) { if (!value) return "—"; const parsed = new Date(typeof value === "number" ? value : String(value)); return Number.isNaN(parsed.getTime()) ? "—" : parsed.toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" }); }
export function JobTable({ jobs }: { jobs: Row[] }) { const { t, locale } = useReverseEngineering(); return jobs.length ? <div className="re-table-wrap"><table><thead><tr><th>{t("التحليل", "Analysis")}</th><th>{t("المحرك", "Engine")}</th><th>{t("الحالة", "Status")}</th><th>{t("التاريخ", "Created")}</th></tr></thead><tbody>{jobs.map((job) => <tr key={text(job.id)}><td><Link href={`/reverse-engineering/workspace/${encodeURIComponent(text(job.id))}`}>{text(job.artifactName ?? job.artifact_name ?? job.id)}</Link></td><td>{text(job.engineId ?? job.engine_id)}</td><td><Status value={job.status} /></td><td>{date(job.createdAt ?? job.created_at, locale)}</td></tr>)}</tbody></table></div> : <Empty>{t("لم تبدأ أي تحليلات بعد.", "No analyses have been started yet.")}</Empty>; }

