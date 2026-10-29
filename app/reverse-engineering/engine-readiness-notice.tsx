import Link from "next/link";
import { engineDiagnosticCode, engineReason, engineRemediation } from "@/lib/reverse-engineering/engine-messages";
import type { Engine } from "./client";

/** Surface existing engine blockers before users create or upload an artifact. */
export function EngineReadinessNotice({ engines, locale }: { engines: readonly Engine[]; locale: string }) {
  if (!engines.length || engines.some(engine => engine.operational === true)) return null;
  const arabic = locale === "ar";
  const groups = new Map<string, string[]>();
  for (const engine of engines) {
    const code = engineDiagnosticCode(engine.reasonCode);
    groups.set(code, [...(groups.get(code) ?? []), engine.name]);
  }
  return <section className="re-notice" aria-label={arabic ? "جاهزية التحليل" : "Analysis readiness"}>
    <div>
    <strong>{arabic ? "لا يوجد محرك جاهز لبدء التحليل حاليًا." : "No engine is ready to start analysis right now."}</strong>
    <p>{arabic ? "لا يمكن إرسال مهمة تحليل قبل اكتمال متطلبات التشغيل. يُفحص توفر حفظ الملفات ورفعها بشكل مستقل." : "An analysis job cannot be submitted until runtime requirements are met. Artifact storage and upload availability are checked separately."}</p>
    <details>
      <summary>{arabic ? "سبب التعذر وخطوة المعالجة" : "Blockers and corrective actions"}</summary>
      <ul>{[...groups].map(([code, names]) => <li key={code}>
        <code dir="ltr">{code}</code><span> · {names.join(" · ")}</span>
        <p>{engineReason(code, locale)}</p>
        {engineRemediation(code, locale) && <p>{engineRemediation(code, locale)}</p>}
      </li>)}</ul>
    </details>
    <Link href="/reverse-engineering/tools">{arabic ? "فحص حالة المحركات ومتطلباتها" : "Review engine health and requirements"}</Link>
    </div>
  </section>;
}
