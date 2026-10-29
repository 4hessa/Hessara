"use client";

import { lazy, Suspense, useId, useState } from "react";
import type { Locale } from "@/lib/i18n";
import "./llm-explorer.css";

const LLMExplorer = lazy(() => import("./llm-explorer"));

/** Keep the numerical explorer out of the initial Overview/model workspace bundle. */
export function LLMExplorerEntry({ locale }: { locale: Locale }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const ar = locale === "ar";
  return <section className="llm-learning" lang={ar ? "ar" : "en"} dir={ar ? "rtl" : "ltr"} aria-labelledby={`${id}-title`}>
    <div className="llm-learning-intro">
      <div><span className="llm-eyebrow">HESSARA / MODEL ANATOMY</span><h3 id={`${id}-title`}>{ar ? "افهم ما يحدث بين السؤال والإجابة." : "Explore what happens between prompt and prediction."}</h3><p>{ar ? "غيّر النص، وافحص الحسابات، وتتبع أثر السياق خطوة بخطوة." : "Change the text, inspect the arithmetic, and follow the effect of context."}</p></div>
      <button className="secondary" type="button" aria-expanded={open} aria-controls={`${id}-explorer`} onClick={() => setOpen(value => !value)}>{open ? (ar ? "إغلاق المستكشف" : "Close explorer") : (ar ? "استكشف رحلة النموذج" : "Explore the model pipeline")}</button>
    </div>
    <div id={`${id}-explorer`} hidden={!open}>{open ? <Suspense fallback={<p role="status" className="llm-load-status">{ar ? "جارٍ تجهيز المستكشف…" : "Preparing explorer…"}</p>}><LLMExplorer locale={locale} /></Suspense> : null}</div>
  </section>;
}
