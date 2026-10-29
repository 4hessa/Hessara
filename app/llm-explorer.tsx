"use client";

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { Locale } from "@/lib/i18n";
import { serializeTeachingReport, TEACHING_REPORT_FILENAME } from "@/lib/llm-report";
import { createDemonstration, gradientDescentExample, tokenizeExample, type DemonstrationMode, type DemonstrationResult } from "@/lib/llm-demonstration";
import "./llm-explorer.css";
import { CinematicMedia } from "./cinematic-media";

type Copy = (ar: string, en: string) => string;
const stageNames = [
  ["tokens", "تقسيم النص", "Text pieces"], ["embedding", "التمثيل", "Embedding"],
  ["position", "الموضع", "Position"], ["attention", "الانتباه", "Attention"],
  ["block", "كتلة المحوّل", "Transformer block"], ["output", "التوقع", "Prediction"],
  ["generation", "التوليد", "Generation"], ["training", "التدريب", "Training"],
] as const;
type Stage = typeof stageNames[number][0];
const number = (value: number) => value.toFixed(3);
const vector = (values: number[] | undefined) => `[${(values || []).map(number).join(", ")}]`;

/** CSS owns animation frames; React changes only on actual interaction. */
function useVisibleMotion(paused: boolean, stage: Stage, mode: DemonstrationMode, empty: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const visible = new Set<Element>();
    const update = () => { element.dataset.running = String(visible.size > 0 && !paused && !preference.matches && !document.hidden); };
    const observer = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(entries => { for (const entry of entries) { if (entry.isIntersecting) visible.add(entry.target); else visible.delete(entry.target); } update(); }, { threshold: 0.05 });
    const diagrams = element.querySelectorAll(".llm-diagram");
    if (observer) diagrams.forEach(diagram => observer.observe(diagram)); else diagrams.forEach(diagram => visible.add(diagram));
    preference.addEventListener("change", update);
    document.addEventListener("visibilitychange", update);
    update();
    return () => { observer?.disconnect(); preference.removeEventListener("change", update); document.removeEventListener("visibilitychange", update); element.dataset.running = "false"; };
  }, [paused, stage, mode, empty]);
  return ref;
}

/** Explicit report navigation must not inherit an unfinished page-wide smooth scroll. */
function focusReportControl(element: HTMLElement | null) {
  if (!element) return;
  element.focus({ preventScroll: true });
  element.scrollIntoView({ behavior: "instant", block: "center", inline: "nearest" });
}
function PipelineDiagram({ mode, t }: { mode: DemonstrationMode; t: Copy }) {
  const row = (y: number, labels: string[], offset = 0) => labels.map((label, i) => <g key={`${y}-${label}`}>
    {i > 0 ? <><path d={`M${70 + (i - 1) * 150 + 110} ${y + 32}h40`} className="llm-wire"/><path d={`M${70 + (i - 1) * 150 + 110} ${y + 32}h40`} className="llm-flow" style={{ "--llm-delay": `${(i + offset) * -0.7}s` } as CSSProperties}/></> : null}
    <rect x={70 + i * 150} y={y} width="110" height="64" rx="10" className="llm-node"/><text x={125 + i * 150} y={y + 37} textAnchor="middle">{label}</text>
  </g>);
  return <svg className="llm-diagram" viewBox="0 0 700 300" role="img" aria-label={t("مسار المقاطع والتضمين والانتباه والتحويل والمخرجات", "Text pieces, embedding, attention, transformation and output pipeline")}>
    {mode === "encoder-decoder" ? <>
      <text x="70" y="42">{t("المصدر · مرمّز ثنائي الاتجاه", "Source · bidirectional encoder")}</text>
      {row(64, ["X + P", "Attention", "FFN", "Memory"])}
      <path d="M575 128V158H425v35" className="llm-wire"/><path d="M575 128V158H425v35" className="llm-flow"/>
      <text x="70" y="181">{t("مفكّك · استعلام البداية", "Decoder · start query")}</text>
      {row(196, ["<start>", "Masked Q", "Cross K,V", "Logits"], 4)}
    </> : <>
      <text x="70" y="70">{mode === "encoder" ? t("التمثيل ثنائي الاتجاه", "Bidirectional representation") : t("تدفق سببي · الماضي والحاضر فقط", "Causal flow · past and present only")}</text>
      {row(116, ["X + P", mode === "encoder" ? "Attention" : "Masked QKV", "FFN", mode === "encoder" ? "Hidden" : "Logits"])}
      {mode === "decoder" ? <path d="M575 184v48H125v-43" className="llm-wire llm-recurrence"/> : null}
      {mode === "decoder" ? <text x="350" y="255" textAnchor="middle">{t("أضف التوقع إلى السياق للخطوة التالية", "Append prediction to context for the next step")}</text> : null}
    </>}
  </svg>;
}

function VectorPlot({ data, selected, positional, t }: { data: DemonstrationResult; selected: number; positional: boolean; t: Copy }) {
  const values = positional ? data.inputs : data.embeddings;
  const scale = Math.max(1, ...values.flatMap(row => row.slice(0, 2).map(Math.abs)));
  return <svg className="llm-diagram" viewBox="0 0 700 300" role="img" aria-label={t("إسقاط حسابي لأول بُعدين من متجهات المثال", "Computed projection of the example vectors onto their first two dimensions")}>
    <path d="M70 150h560M350 32v236" className="llm-wire"/><text x="625" y="175">x₁</text><text x="365" y="42">x₂</text>
    {values.map((value, i) => { const x = 350 + value[0] / scale * 240, y = 150 - value[1] / scale * 100; return <g key={i}>
      <path d={`M350 150L${x} ${y}`} className={selected === i ? "llm-flow" : "llm-wire"}/>
      <circle cx={x} cy={y} r={selected === i ? 8 : 5} className={selected === i ? "llm-dot llm-dot-selected" : "llm-dot"}/>
      <text x={x + 13} y={y + 5}>{i + 1}</text>
    </g>; })}
  </svg>;
}

function AttentionView({ data, selected, cross, t }: { data: DemonstrationResult; selected: number; cross: boolean; t: Copy }) {
  const attention = cross ? data.crossAttention! : { scores: data.scores, weights: data.weights };
  const source = cross ? data.encoder!.tokens : data.tokens;
  const row = Math.min(selected, attention.weights.length - 1);
  const weights = attention.weights[row] || [];
  const x = (i: number) => source.length < 2 ? 350 : 65 + i * 570 / (source.length - 1);
  return <>
    <svg className="llm-diagram" viewBox="0 0 700 260" role="img" aria-label={t("سمك الروابط محسوب من أوزان الانتباه في المثال التعليمي", "Connection widths are computed from the teaching model's attention weights")}>
      <text x="350" y="40" textAnchor="middle">Q · {row + 1}</text><circle cx="350" cy="72" r="12" className="llm-dot-selected"/>
      {weights.map((weight, i) => <g key={i}><path d={`M350 84C350 130,${x(i)} 135,${x(i)} 195`} className={weight ? "llm-flow" : "llm-wire llm-masked-edge"} style={{ strokeWidth: weight ? 1 + weight * 12 : 1, opacity: weight ? 0.5 + weight * 0.5 : 0.25 }}/><circle cx={x(i)} cy="204" r="7" className="llm-dot"/><text x={x(i)} y="235" textAnchor="middle">{i + 1}</text></g>)}
    </svg>
    <div className="llm-weights" aria-label={t("أوزان الاستعلام المحدد", "Selected query weights")}>
      {weights.map((weight, i) => <div key={i}><bdi>{source[i]?.text}</bdi><span>{(weight * 100).toFixed(1)}%</span></div>)}
    </div>
    <details className="llm-numerical"><summary>{t("افحص مصفوفة الانتباه", "Inspect the attention matrix")}</summary><p>{t("الصف استعلام، والعمود مفتاح. — تعني حجب العلاقة المستقبلية ووزنًا يساوي صفرًا.", "Rows are queries; columns are keys. — marks a masked future relationship with zero weight.")}</p><div className="llm-table-scroll" role="region" tabIndex={0} aria-label={t("جدول أوزان الانتباه القابل للتمرير", "Scrollable attention weight table")}><table><caption>{cross ? "softmax(Qdecoder Kencoderᵀ / √4)" : "softmax(QKᵀ / √4)"}</caption><thead><tr><th scope="col">Q / K</th>{source.map((_, i) => <th scope="col" key={i}>{i + 1}</th>)}</tr></thead><tbody>{attention.weights.map((values, r) => <tr key={r}><th scope="row">{r + 1}</th>{values.map((weight, column) => <td key={column} data-masked={attention.scores[r][column] === null} style={{ backgroundColor: `color-mix(in srgb, var(--hessara-faelight) ${Math.round(weight * 70)}%, white)` }}>{attention.scores[r][column] === null ? "—" : number(weight)}</td>)}</tr>)}</tbody></table></div></details>
  </>;
}

function BlockView({ data, selected, t }: { data: DemonstrationResult; selected: number; t: Copy }) {
  const parts = [
    ["X + Attention(X)", data.residual], ["RMSNorm", data.normalized],
    [data.crossAttention ? "RMSNorm(N + CrossAttention(N, E))" : "FFN input", data.feedForwardInput],
    ["ReLU(X Wup) Wdown", data.feedForward], ["X + FFN(X)", data.hidden],
  ] as const;
  return <div className="llm-block-values"><p>{t("رأس انتباه واحد وكتلة واحدة بأبعاد مصغّرة. تستخدم نسختنا التعليمية RMSNorm؛ ترتيب التطبيع يختلف بين عائلات المحوّلات.", "One attention head and one compact block. This teaching variant uses RMSNorm; normalization order varies across transformer families.")}</p>{parts.map(([label, values]) => <div key={label}><span dir="ltr">{label}</span><code dir="ltr">{vector(values[selected])}</code></div>)}<p>{t("الرؤوس المتعددة تكرر إسقاطات Q وK وV المستقلة، ثم تدمج مخرجاتها. الرسم في Overview يوضح هذا التوازي.", "Multiple heads use independent Q, K and V projections, then concatenate and project their outputs. The Overview diagram illustrates that parallel structure.")}</p></div>;
}

function PredictionView({ data, t }: { data: DemonstrationResult; t: Copy }) {
  if (!data.candidates.length) return <p className="llm-empty">{t("المرمّز ينتج تمثيلًا ثنائي الاتجاه. لا نضيف إليه توقعًا سببيًا غير موجود.", "The encoder produces bidirectional representations. This encoder-only example has no causal prediction head.")}</p>;
  return <div className="llm-predictions"><p>{t("توزيع محسوب على مفردات تعليمية من ستة عناصر؛ لا يقيس جودة اللغة.", "Computed distribution over six teaching candidates; it does not measure language quality.")}</p>{data.candidates.map(candidate => <div key={candidate.text} className="llm-probability"><bdi>{candidate.text}</bdi><div className="llm-probability-track"><span style={{ width: `${candidate.probability * 100}%` }}/></div><output>{(candidate.probability * 100).toFixed(1)}%</output><code>{number(candidate.logit)}</code></div>)}<span className="llm-small">{t("العمود الأخير: الدرجة قبل softmax", "Last column: logit before softmax")}</span></div>;
}

function TrainingView({ t, paused }: { t: Copy; paused: boolean }) {
  const example = useMemo(() => gradientDescentExample(), []);
  const [index, setIndex] = useState(0);
  const current = example.steps[index];
  const maxLoss = Math.max(...example.steps.map(step => step.loss));
  const point = (i: number, loss: number) => `${65 + i / (example.steps.length - 1) * 570},${230 - loss / maxLoss * 165}`;
  return <div className="llm-training">
    <svg className="llm-diagram" viewBox="0 0 700 280" role="img" aria-label={t("الخسارة المحسوبة تنخفض عبر خطوات الانحدار المتدرج", "Computed loss decreases over gradient descent steps")}><path d="M65 45v185h570" className="llm-wire"/><text x="65" y="30">L</text><text x="610" y="263">step</text><polyline points={example.steps.map((step, i) => point(i, step.loss)).join(" ")} className="llm-loss-line"/>{example.steps.map((step, i) => { const [cx, cy] = point(i, step.loss).split(","); return <circle key={i} cx={cx} cy={cy} r={i === index ? 7 : 3} className={i === index ? "llm-dot-selected" : "llm-dot"}/>; })}</svg>
    <div className="llm-training-controls"><label>{t("خطوة التدريب", "Training step")} <output>{index}</output><input type="range" min="0" max={example.steps.length - 1} value={index} onChange={event => setIndex(Number(event.target.value))}/></label><button type="button" className="secondary" disabled={index === example.steps.length - 1} onClick={() => setIndex(value => value + 1)}>{t("خطوة تالية", "Next step")}</button><button type="button" className="text-button" onClick={() => setIndex(0)}>{t("إعادة الضبط", "Reset")}</button></div>
    <code className="llm-formula" dir="ltr">ŷ = w × 2; L = ½(ŷ − 3)²; ∂L/∂w = (2w − 3) × 2; w ← w − 0.1 × ∂L/∂w</code>
    <dl className="llm-training-metrics"><div><dt>w</dt><dd>{number(current.weight)}</dd></div><div><dt>ŷ</dt><dd>{number(current.prediction)}</dd></div><div><dt>L</dt><dd>{current.loss.toFixed(6)}</dd></div><div><dt>∂L/∂w</dt><dd>{number(current.gradient)}</dd></div></dl>
    <figure className="llm-training-film"><CinematicMedia className="cinematic-science" src="/science/gradient-descent.mp4" poster="/science/gradient-descent-poster.webp" width={1280} height={720} motionPaused={paused}/><figcaption>{t("رسم Manim أصلي لمثال آخر: L(x)=0.8x²+0.12، بسبع خطوات محسوبة. حركة العودة انتقال توضيحي لتكرار المقطع.", "Original Manim rendering of another example: L(x)=0.8x²+0.12, with seven computed steps. The return motion is an illustrative loop reset.")}</figcaption></figure>
    <p>{t("تجربة انحدار عددي بمتغير واحد؛ الخطأ ينتشر عبر قاعدة السلسلة إلى الوزن. لا يحدث تدريب لأي نموذج متصل.", "A scalar optimization experiment: the chain rule propagates the prediction error to the weight. Connected provider models are not trained here.")}</p>
  </div>;
}

export default function LLMExplorer({ locale }: { locale: Locale }) {
  const ar = locale === "ar";
  const t: Copy = (arabic, english) => ar ? arabic : english;
  const id = useId();
  const [input, setInput] = useState(ar ? "الذكاء يتعلم من الأمثلة" : "Learning starts with a question");
  const [mode, setMode] = useState<DemonstrationMode>("decoder");
  const [stage, setStage] = useState<Stage>("tokens");
  const [selected, setSelected] = useState(0);
  const [windowSize, setWindowSize] = useState(16);
  const [paused, setPaused] = useState(false);
  const [generated, setGenerated] = useState<string[]>([]);
  const [reportOpen, setReportOpen] = useState(false);
  const [downloadError, setDownloadError] = useState(false);
  const reportField = useRef<HTMLTextAreaElement>(null);
  const reportToggle = useRef<HTMLButtonElement>(null);
  const reportWasOpen = useRef(false);
  const source = useMemo(() => tokenizeExample(input), [input]);
  const context = useMemo(() => { const pieces = source.pieces.slice(-windowSize); return pieces.length ? input.slice(pieces[0].start, pieces[pieces.length - 1].end) : ""; }, [input, source, windowSize]);
  const data = useMemo(() => createDemonstration(context, mode), [context, mode]);
  const root = useVisibleMotion(paused, stage, mode, data.tokens.length === 0);
  const reportText = useMemo(() => reportOpen ? serializeTeachingReport(data, windowSize, source.truncated) : "", [reportOpen, data, windowSize, source.truncated]);
  useLayoutEffect(() => {
    const previousOpen = reportWasOpen.current;
    reportWasOpen.current = reportOpen;
    if (reportOpen) focusReportControl(reportField.current);
    else if (previousOpen) focusReportControl(reportToggle.current);
  }, [reportOpen, downloadError]);
  const closeReport = () => { setReportOpen(false); setDownloadError(false); };
  const index = Math.min(selected, Math.max(0, data.tokens.length - 1));
  const active = stageNames.find(value => value[0] === stage)!;
  const changeText = (text: string) => { setInput(text); setSelected(0); setGenerated([]); };
  const proposedInput = data.nextToken ? `${input.trimEnd()} ${data.nextToken}` : input;
  const appendAvailable = mode === "decoder" && !!data.nextToken && generated.length < 8 && !source.truncated && !tokenizeExample(proposedInput).truncated;
  const append = () => {
    if (!appendAvailable) return;
    setInput(proposedInput);
    setGenerated(values => [...values, data.nextToken!]);
    setSelected(data.tokens.length);
  };
  const download = () => {
    setDownloadError(false);
    const link = document.createElement("a");
    let url: string | undefined;
    try {
      const blob = new Blob([serializeTeachingReport(data, windowSize, source.truncated)], { type: "application/json;charset=utf-8" });
      url = URL.createObjectURL(blob);
      link.href = url; link.download = TEACHING_REPORT_FILENAME;
      document.body.appendChild(link); link.click();
    } catch {
      setDownloadError(true); setReportOpen(true);
    } finally {
      link.remove();
      if (url) { const activeURL = url; window.setTimeout(() => URL.revokeObjectURL(activeURL), 1000); }
    }
  };
  return <div ref={root} className="llm-explorer" data-running="false" data-stage={stage} data-mode={mode}>
    <div className="llm-toolbar"><span className="llm-badge">{t("مثال تعليمي · حسابات محلية", "Teaching model · local arithmetic")}</span><button type="button" className="text-button" aria-pressed={paused} onClick={() => setPaused(value => !value)}>{paused ? t("السماح بحركة الإشارات", "Allow signal motion") : t("تقليل حركة الإشارات", "Reduce signal motion")}</button></div>
    <p className="llm-provenance" id={`${id}-provenance`}>{t("مقاطع نصية ومتجهات وأوزان مصغّرة مصممة للتعليم، وليست مُرمّز مزوّد أو بياناته الداخلية. لا يُرسل النص إلى خادم ولا يُحفظ تلقائيًا.", "Text chunks, vectors and compact weights are authored for teaching, not a provider tokenizer or internal data. Text stays in this component; it is neither sent nor automatically saved.")}</p>
    <div className="llm-input-grid"><label htmlFor={`${id}-input`}>{t("النص التجريبي", "Example text")}<textarea id={`${id}-input`} value={input} maxLength={480} rows={2} dir="auto" aria-describedby={`${id}-provenance ${id}-limits`} onChange={event => changeText(event.target.value)}/></label><div className="llm-settings"><label htmlFor={`${id}-mode`}>{t("البنية", "Architecture")}<select id={`${id}-mode`} value={mode} onChange={event => { setMode(event.target.value as DemonstrationMode); setSelected(0); setGenerated([]); }}><option value="decoder">{t("مفكّك سببي", "Causal decoder")}</option><option value="encoder">{t("مرمّز ثنائي الاتجاه", "Bidirectional encoder")}</option><option value="encoder-decoder">{t("مرمّز ومفكّك", "Encoder–decoder")}</option></select></label><label htmlFor={`${id}-window`}>{t("نافذة السياق المصغرة", "Teaching context window")} <output>{windowSize}</output><input id={`${id}-window`} type="range" min="1" max="16" value={windowSize} onChange={event => { setWindowSize(Number(event.target.value)); setSelected(0); }}/></label></div></div>
    <p id={`${id}-limits`} className="llm-small">{t("حتى 240 محرف Unicode و16 مقطعًا. النافذة تختار آخر المقاطع المعروضة.", "Up to 240 Unicode code points and 16 chunks. The window selects the last displayed chunks.")} {source.truncated ? t("اقتُصر العرض على الحد الآمن.", "The display is truncated at its safe limit.") : null}</p>
    <nav className="llm-stage-nav" aria-label={t("مراحل استكشاف النموذج", "Model exploration stages")}>{stageNames.map(([key, arabic, english], i) => <button type="button" key={key} aria-pressed={stage === key} aria-controls={`${id}-stage`} onClick={() => setStage(key)}><span>{String(i + 1).padStart(2, "0")}</span>{ar ? arabic : english}</button>)}</nav>
    <section id={`${id}-stage`} className="llm-stage" aria-labelledby={`${id}-stage-title`}>
      <div className="llm-stage-header"><h4 id={`${id}-stage-title`}>{ar ? active[1] : active[2]}</h4><span>{data.dimension}D · {data.tokens.length} {t("مقطع", "pieces")}</span></div>
      {stage !== "training" && data.tokens.length === 0 ? <p className="llm-empty">{t("أدخل نصًا لاستكشاف المعالجة.", "Enter text to explore the processing stages.")}</p> : <>
        {!["training", "output", "generation"].includes(stage) ? <div className="llm-token-selector" aria-label={t("اختيار مقطع لفحصه", "Choose a piece to inspect")}>{data.tokens.map((token, i) => <button type="button" key={i} aria-pressed={index === i} onClick={() => setSelected(i)}><span>{i + 1}</span><bdi>{token.text}</bdi></button>)}</div> : null}
        {stage === "tokens" ? <><PipelineDiagram mode={mode} t={t}/><p>{t("تقسيم مرئي حسب الكلمات وعلامات الترقيم. الأعداد أدناه بايتات UTF-8 حقيقية للمقطع المحدد، وليست معرّفات رموز نموذج.", "Visible word and punctuation segmentation. The numbers below are the selected piece's actual UTF-8 bytes, not model token IDs.")}</p><code className="llm-formula" dir="ltr">UTF-8: [{data.tokens[index]?.bytes.join(", ")}]</code>{data.encoder ? <p>{t("نصك مصدر المرمّز. يفحص المفكّك استعلام <start> واحدًا عبر انتباه متقاطع للمصدر.", "Your text is the encoder source. The decoder inspects one <start> query through cross-attention to that source.")}</p> : null}</> : null}
        {stage === "embedding" || stage === "position" ? <><VectorPlot data={data} selected={index} positional={stage === "position"} t={t}/><p>{stage === "embedding" ? t("تمثيل من أربعة أبعاد مشتق حتميًا من البايتات للتعليم؛ تقارب النقاط لا يعني تشابهًا دلاليًا. الإسقاط يعرض أول بُعدين فقط.", "A deterministic four-dimensional byte-derived teaching representation. Nearby points do not imply semantic similarity. The projection shows only its first two dimensions.") : t("نضيف ترميز الموضع الجيبي إلى المتجه. تغيير الترتيب يغيّر الموضع حتى عندما يتكرر النص نفسه.", "Sinusoidal position encoding is added to the vector. Reordering changes position even when the same text repeats.")}</p><dl className="llm-vector-readout"><div><dt>E</dt><dd><code dir="ltr">{vector(data.embeddings[index])}</code></dd></div>{stage === "position" ? <><div><dt>P</dt><dd><code dir="ltr">{vector(data.positions[index])}</code></dd></div><div><dt>E + P</dt><dd><code dir="ltr">{vector(data.inputs[index])}</code></dd></div></> : null}</dl>{stage === "position" ? <code className="llm-formula" dir="ltr">P(pos,2i) = sin(pos / 10000^(2i/4)); P(pos,2i+1) = cos(pos / 10000^(2i/4))</code> : null}</> : null}
        {stage === "attention" ? <><AttentionView data={data} selected={index} cross={false} t={t}/><p>{mode === "encoder" ? t("المرمّز يسمح لجميع مواضع المصدر بالانتباه لبعضها. هذه أوزان محسوبة لمثالنا فقط.", "Encoder source positions can attend to each other. These computed weights belong only to this example.") : t("الحجب السببي يمنع الاستعلام من رؤية مواضع المستقبل. مجموع كل صف غير فارغ يساوي 1.", "A causal mask prevents queries from seeing future positions. Every nonempty row sums to 1.")}</p><details className="llm-numerical"><summary>{t("متجهات الاستعلام والمفتاح والقيمة", "Query, key and value vectors")}</summary><code className="llm-formula" dir="ltr">Q = {vector(data.q[index])}<br/>K = {vector(data.k[index])}<br/>V = {vector(data.v[index])}</code></details>{data.crossAttention ? <><h5>{t("الانتباه المتقاطع إلى المصدر", "Cross-attention to source")}</h5><AttentionView data={data} selected={0} cross t={t}/></> : null}</> : null}
        {stage === "block" ? <><PipelineDiagram mode={mode} t={t}/><BlockView data={data} selected={index} t={t}/></> : null}
        {stage === "output" || stage === "generation" ? <><PredictionView data={data} t={t}/>{stage === "generation" ? <div className="llm-generation"><p>{t("خطوة جشعة تختار أعلى احتمال من مفردات المثال، ثم تعيد الحساب على السياق الجديد. لا تمثل استجابة ذكاء اصطناعي حقيقية.", "One greedy step selects the highest-probability teaching candidate, then recomputes the extended context. This is not a real AI response.")}</p><button type="button" className="secondary" disabled={!appendAvailable} onClick={append}>{t("أضف توقعًا إلى السياق", "Append a prediction to context")}</button><div className="llm-generated" aria-live="polite" aria-label={t("الخطوات المضافة", "Appended steps")}>{generated.map((value, i) => <bdi key={i}>{value}</bdi>)}</div>{mode !== "decoder" ? <p className="llm-small">{t("التكرار التوليدي متاح في مثال المفكّك السببي فقط. المرمّز/المفكّك يعرض استعلام البداية الواحد.", "Iterative generation is available only in the causal decoder example. Encoder–decoder displays a single start query.")}</p> : null}</div> : null}</> : null}
        {stage === "training" ? <TrainingView t={t} paused={paused}/> : null}
      </>}
    </section>
    <footer className="llm-explorer-footer"><a href="https://arxiv.org/abs/1706.03762" target="_blank" rel="noopener noreferrer">{t("المرجع العلمي: Attention Is All You Need", "Scientific reference: Attention Is All You Need")}</a><div className="llm-export-actions"><button type="button" className="text-button" onClick={download} disabled={!data.tokens.length}>{t("تنزيل حسابات المثال · JSON", "Download example arithmetic · JSON")}</button><button ref={reportToggle} type="button" className="text-button" aria-expanded={reportOpen} aria-controls={`${id}-report-panel`} onClick={() => reportOpen ? closeReport() : setReportOpen(true)}>{reportOpen ? t("إغلاق عرض JSON", "Close JSON view") : t("عرض JSON ونسخه", "View and copy JSON")}</button></div></footer>
    {downloadError ? <p className="llm-small llm-export-error" role="alert">{t("تعذر بدء التنزيل. يمكنك تحديد بيانات JSON أدناه ونسخها يدويًا.", "The download could not be started. Select the JSON below to copy it manually.")}</p> : null}
    {reportOpen ? <section id={`${id}-report-panel`} className="llm-report-panel" aria-labelledby={`${id}-report-title`} onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeReport(); } }}>
      <div className="llm-report-header"><h4 id={`${id}-report-title`}>{t("بيانات مثال المحوّل · JSON", "Transformer example data · JSON")}</h4><button type="button" className="text-button" onClick={closeReport}>{t("إغلاق عرض التقرير", "Close report view")}</button></div>
      <p id={`${id}-report-help`} className="llm-small">{t("البيانات تتبع المثال الحالي. إذا منع المتصفح حفظ الملف، حدّد النص وانسخه إلى محرّر نصوص لحفظه بامتداد .json. مثال التدريب والمقطع مستقلان عن هذه الحسابات.", "This report follows the current example. If your browser blocks the file download, select and copy the text into a text editor and save it as .json. The scalar training example and film are separate from these calculations.")}</p>
      <label htmlFor={`${id}-report-text`}>{t("بيانات التقرير بصيغة JSON", "Report data as JSON")}</label><textarea ref={reportField} id={`${id}-report-text`} className="llm-report-text" value={reportText} readOnly dir="ltr" rows={12} wrap="off" spellCheck={false} aria-describedby={`${id}-report-help`}/>
      <button type="button" className="secondary" onClick={() => { focusReportControl(reportField.current); reportField.current?.select(); }}>{t("تحديد النص بالكامل", "Select all text")}</button>
    </section> : null}
  </div>;
}












