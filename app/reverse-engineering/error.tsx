"use client";
export default function Error({ reset }: { reset: () => void }) { return <section className="re-panel" role="alert"><h1>تعذّر تحميل مساحة التحليل / Unable to load workspace</h1><p>حاول مجددًا. لم تُفقد المهام المحفوظة. / Try again. Saved jobs are preserved.</p><button type="button" onClick={reset}>إعادة المحاولة / Retry</button></section>; }
