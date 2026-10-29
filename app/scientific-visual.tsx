"use client";

import { useEffect, useId, useRef, type CSSProperties } from "react";
import type { Locale } from "@/lib/i18n";
import "./scientific-visual.css";

export type ScientificVisualKind = "network" | "attention" | "language" | "embedding";
type Point = { x: number; y: number };
const layers = [3, 5, 6, 5, 3].map((count, layer) =>
  Array.from({ length: count }, (_, node) => ({
    x: 94 + layer * 126,
    y: 230 + (node - (count - 1) / 2) * 35 - layer * 9,
  })),
);
const captions = {
  attention: {
    ar: ["بنية الانتباه", "سياق واحد، من زوايا متعددة.", "تمثيلات الرموز تتوزع على ثلاثة رؤوس انتباه متوازية، ثم تتكامل في تمثيل سياقي. درجات التظليل توضيحية وليست أوزان نموذج حقيقي.", "تمثيلات الرموز", "رؤوس الانتباه", "دمج السياق"],
    en: ["Attention architecture", "One context. Multiple perspectives.", "Token representations feed three parallel attention heads and combine into a contextual representation. Shading is illustrative, not measured model weights.", "Token representations", "Attention heads", "Context merge"],
  },
  language: {
    ar: ["رحلة اللغة", "من الكلمات إلى التمثيل والسياق.", "مسار مفاهيمي من النص إلى الرموز والتضمينات ومعالجة السياق ثم توليد المخرجات. تقسيم الكلمات لا يمثّل مُرمّزًا بعينه.", "نص", "رموز · تضمينات · سياق", "مخرجات"],
    en: ["Language processing", "From language to representation.", "A conceptual path from text through tokens, embeddings and context to generated output. Word segments do not depict a specific tokenizer.", "Language", "Tokens · embeddings · context", "Output"],
  },
  embedding: {
    ar: ["فضاء التضمينات", "تقارب في المعنى، وعلاقات قابلة للاستكشاف.", "إسقاط تصوّري لمجموعات من التمثيلات وعلاقات الجوار بينها. المواقع والمسافات توضيحية، وليست تضمينات مستخرجة من نموذج.", "تمثيلات", "مجموعات · علاقات", "جوار"],
    en: ["Embedding space", "Related meanings. Structured neighborhoods.", "A conceptual projection of representation clusters and their nearest relationships. Positions and distances are illustrative, not embeddings measured from a model.", "Representations", "Clusters · relations", "Neighbors"],
  },
} as const;
const stageStyle = (stage: number): CSSProperties => ({ "--science-stage": stage } as CSSProperties);
const connector = (a: Point, b: Point) => `M${a.x} ${a.y}C${a.x + 58} ${a.y},${b.x - 58} ${b.y},${b.x} ${b.y}`;

function NeuralNetwork({ id }: { id: string }) {
  return <>
    <path d="M48 329 528 376 654 289 175 244Z" fill={`url(#${id}-floor)`} stroke="var(--overview-wire)" strokeOpacity=".14"/>
    {/* Parallel projected planes make the topology legible without a GPU canvas. */}
    {layers.map((nodes, layer) => <g key={layer}>
      <path d={`M${nodes[0].x - 18} ${nodes[0].y - 27}l38-30h36v${(nodes.length - 1) * 35 + 54}l-38 30h-36Z`} fill="var(--overview-plane)" fillOpacity=".25" stroke="var(--overview-wire)" strokeOpacity=".16"/>
      <g className="science-depth-detail">
        {nodes.map((a, index) => <g key={index}>
          <path d={`M${a.x} ${a.y}l38-30`} stroke="var(--overview-wire)" strokeOpacity=".18" strokeDasharray="2 4"/>
          <circle cx={a.x + 38} cy={a.y - 30} r="3.5" fill="var(--overview-wire)" opacity=".32"/>
        </g>)}
      </g>
    </g>)}
    {layers.slice(0, -1).flatMap((nodes, layer) => nodes.flatMap((a, node) =>
      layers[layer + 1].map((b, next) => <path key={`${layer}-${node}-${next}`} d={connector(a, b)} stroke="var(--overview-wire)" strokeOpacity={node === next ? .32 : .12} strokeWidth={node === next ? 1.1 : .7}/>),
    ))}
    {layers.slice(0, -1).flatMap((nodes, layer) => [-1, 0, 1].map(branch => {
      const a = nodes[Math.floor(nodes.length / 2) + branch];
      const next = layers[layer + 1];
      const b = next[Math.floor(next.length / 2) + branch];
      return <path key={`${layer}-${branch}`} className={`science-transmission${branch ? " science-depth-detail" : ""}`} style={stageStyle(layer)} d={connector(a, b)} pathLength="1" stroke="var(--overview-signal)" strokeWidth="2.2" strokeLinecap="round"/>;
    }))}
    {layers.map((nodes, layer) => <g key={layer} className="science-neural-layer" style={stageStyle(layer)}>
      {nodes.map((node, index) => <g key={index}>
        <circle cx={node.x + 1} cy={node.y + 2} r="12" fill="var(--overview-node-shadow)" opacity=".15"/>
        <circle cx={node.x} cy={node.y} r="10" fill={`url(#${id}-node)`} stroke="var(--overview-wire)" strokeOpacity=".7"/>
        <circle cx={node.x - 2} cy={node.y - 3} r="2" fill="var(--overview-node-light)" opacity=".8"/>
        <circle className="science-node-activation" cx={node.x} cy={node.y} r="14" stroke="var(--overview-signal)" strokeWidth="1.4"/>
      </g>)}
    </g>)}
  </>;
}

function Attention({ id }: { id: string }) {
  return <>
    {[0, 1, 2, 3].map(row => <g key={row}>
      <rect x="58" y={116 + row * 53} width="59" height="32" rx="7" fill="var(--overview-wire)" fillOpacity=".08" stroke="var(--overview-wire)" strokeOpacity=".28"/>
      {[0,1,2,3].map(column => <rect key={column} x={69 + column * 10} y={125 + row * 53} width="4" height={8 + (column + row) % 3 * 4} rx="2" fill="var(--overview-wire)" opacity={.4 + column * .15}/>)}
      <path d={`M117 ${132 + row * 53}C174 ${132 + row * 53},180 205,235 205`} stroke="var(--overview-wire)" strokeOpacity=".24"/>
      <path d={`M464 205C520 205,510 ${132 + row * 53},558 ${132 + row * 53}`} stroke="var(--overview-wire)" strokeOpacity=".24"/>
      <rect x="558" y={116 + row * 53} width="59" height="32" rx="7" fill="var(--overview-wire)" fillOpacity=".1" stroke="var(--overview-wire)" strokeOpacity=".35"/>
      <path d={`M571 ${128 + row * 53}h33m-33 8h21`} stroke="var(--overview-wire)" strokeOpacity=".65" strokeWidth="2"/>
    </g>)}
    {[0, 1, 2].map(head => {
      const x = 215 + head * 53, y = 116 + head * 38;
      return <g key={head} className="science-attention-head" style={stageStyle(1)}>
        <path d={`M${x} ${y}h144v144H${x}Z`} fill="var(--overview-plane)" stroke="var(--overview-wire)" strokeOpacity=".5"/>
        {Array.from({ length: 16 }, (_, cell) => {
          const row = Math.floor(cell / 4), column = cell % 4;
          const strength = row === column ? .82 : ((row * 3 + column * 2 + head) % 6 + 1) / 12;
          return <rect key={cell} x={x + 13 + column * 30} y={y + 13 + row * 30} width="23" height="23" rx="3" fill={`url(#${id}-matrix)`} opacity={strength}/>;
        })}
        <path d={`M${x + 12} ${y - 8}h31`} stroke="var(--overview-signal)" strokeOpacity=".65" strokeWidth="2"/>
      </g>;
    })}
    <path className="science-transmission" style={stageStyle(0)} d="M117 185C174 185 180 205 235 205" pathLength="1" stroke="var(--overview-signal)" strokeWidth="2"/>
    <path className="science-transmission" style={stageStyle(3)} d="M464 205C520 205 510 238 558 238" pathLength="1" stroke="var(--overview-signal)" strokeWidth="2"/>
    <path d="M213 327h251m-251-7v14m251-14v14" stroke="var(--overview-wire)" strokeOpacity=".4"/>
  </>;
}

function Language() {
  return <>
    <path d="M64 310h572" stroke="var(--overview-wire)" strokeOpacity=".12"/>
    {Array.from({ length: 4 }, (_, index) => <g key={index}>
      <path d={`M${122 + index * 123} 220h45`} stroke="var(--overview-wire)" strokeOpacity=".4"/>
      <path className="science-transmission" style={stageStyle(index)} d={`M${122 + index * 123} 220h45`} pathLength="1" stroke="var(--overview-signal)" strokeWidth="2"/>
      <path d={`m${161 + index * 123} 216 5 4-5 4`} stroke="var(--overview-wire)" strokeOpacity=".6"/>
    </g>)}
    {["01", "02", "03", "04", "05"].map((stage, index) => <g key={stage} className="science-language-stage" style={stageStyle(index)}>
      <rect x={46 + index * 123} y="159" width="76" height="122" rx="12" fill="var(--overview-plane)" stroke="var(--overview-wire)" strokeOpacity=".35"/>
      <path d={`M${59 + index * 123} 145h19`} stroke="var(--overview-wire)" strokeOpacity=".6"/>
      {index === 0 || index === 4 ? [0,1,2,3].map(line => <path key={line} d={`M${59 + index * 123} ${191 + line * 18}h${line % 2 ? 34 : 48}`} stroke="var(--overview-wire)" strokeWidth={index === 4 ? "3" : "2"} strokeOpacity={.85 - line * .12} strokeLinecap="round"/>) : null}
      {index === 1 ? [0,1,2,3,4,5].map(token => <rect key={token} x={58 + index * 123 + token % 2 * 29} y={185 + Math.floor(token / 2) * 25} width="23" height="18" rx="4" fill="var(--overview-wire)" fillOpacity={.25 + token * .06}/>) : null}
      {index === 2 ? [0,1,2,3,4,5].map(bar => <rect key={bar} x={58 + index * 123 + bar * 9} y={244 - [35,55,29,68,42,51][bar]} width="5" height={[35,55,29,68,42,51][bar]} rx="2" fill="var(--overview-wire)" opacity={.45 + bar * .09}/>) : null}
      {index === 3 ? <g stroke="var(--overview-wire)" strokeOpacity=".55"><path d="m430 191 32 13-34 35 31 10m-29-58-2 48m34-35-3 45m-31-10 34-35"/>{[[430,191],[462,204],[428,239],[459,249]].map(([x,y]) => <circle key={x} cx={x} cy={y} r="5" fill="var(--overview-node-mid)"/>)}</g> : null}
    </g>)}
  </>;
}

const clusterCenters = [{ x: 212, y: 183 }, { x: 449, y: 160 }, { x: 365, y: 308 }];
// Deterministic illustrative coordinates: no random data and no claimed model output.
const clusters = clusterCenters.map((center, cluster) => Array.from({ length: 24 }, (_, index) => {
  const angle = index * 2.399963 + cluster * .7;
  const radius = 13 + Math.sqrt(index / 23) * 70;
  return { x: +(center.x + Math.cos(angle) * radius).toFixed(2), y: +(center.y + Math.sin(angle) * radius * .56).toFixed(2), depth: (index % 5) / 4 };
}));
function Embedding({ id }: { id: string }) {
  return <>
    <path d="m72 298 276 110 282-147-278-99Z" fill={`url(#${id}-floor)`} stroke="var(--overview-wire)" strokeOpacity=".18"/>
    <path d="M212 183 449 160 365 308 212 183" stroke="var(--overview-wire)" strokeOpacity=".35" strokeDasharray="3 7"/>
    {clusters.map((points, cluster) => <g key={cluster} className="science-embedding-cluster" style={stageStyle(cluster)}>
      <ellipse cx={clusterCenters[cluster].x} cy={clusterCenters[cluster].y} rx="88" ry="51" stroke="var(--overview-wire)" strokeOpacity=".18"/>
      {points.map((point, index) => <g key={index} className={index > 11 ? "science-depth-detail" : undefined}>
        {index < 6 ? <path d={`M${point.x} ${point.y}L${clusterCenters[cluster].x} ${clusterCenters[cluster].y}`} stroke="var(--overview-wire)" strokeOpacity=".35"/> : null}
        <circle cx={point.x} cy={point.y} r={2.2 + point.depth * 2.4} fill="var(--overview-wire)" opacity={.4 + point.depth * .6}/>
      </g>)}
      <circle cx={clusterCenters[cluster].x} cy={clusterCenters[cluster].y} r="8" fill={`url(#${id}-node)`} stroke="var(--overview-wire)"/>
      <circle className="science-node-activation" cx={clusterCenters[cluster].x} cy={clusterCenters[cluster].y} r="15" stroke="var(--overview-signal)"/>
    </g>)}
    {clusterCenters.map((point, index) => <path key={index} className="science-transmission" style={stageStyle(index)} d={`M${point.x} ${point.y}L${clusterCenters[(index + 1) % 3].x} ${clusterCenters[(index + 1) % 3].y}`} pathLength="1" stroke="var(--overview-signal)" strokeWidth="2"/>)}
  </>;
}

/** Conceptual educational plates, never presented as live platform telemetry. */
export function ScientificVisual({ kind, locale, motionPaused = false }: {
  kind: ScientificVisualKind; locale: Locale; motionPaused?: boolean;
}) {
  const element = useRef<HTMLElement>(null);
  const id = `science-${useId().replace(/:/g, "")}`;
  const copy = kind === "network" ? null : captions[kind][locale === "ar" ? "ar" : "en"];
  useEffect(() => {
    const node = element.current;
    if (!node) return;
    let visible = false;
    let mounted = true;
    const compact = window.matchMedia("(max-width: 600px), (pointer: coarse)");
    const quality = () => { node.dataset.quality = compact.matches ? "compact" : "full"; };
    compact.addEventListener("change", quality);
    quality();
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => { node.dataset.running = String(mounted && visible && !document.hidden && !reduced.matches && !motionPaused); };
    const observer = new IntersectionObserver(entries => {
      visible = entries.some(entry => entry.isIntersecting);
      sync();
    }, { threshold: .08 });
    observer.observe(node);
    document.addEventListener("visibilitychange", sync);
    reduced.addEventListener("change", sync);
    sync();
    return () => {
      mounted = false;
      sync();
      observer.disconnect();
      compact.removeEventListener("change", quality);
      document.removeEventListener("visibilitychange", sync);
      reduced.removeEventListener("change", sync);
    };
  }, [motionPaused]);
  return <figure ref={element} className={`scientific-visual scientific-visual--${kind}`} data-running="false" data-quality="compact" aria-label={kind === "network" ? (locale === "ar" ? "تصوّر تعليمي لانتقال الإشارات بين طبقات حسابية، وليس نشاط نموذج حقيقي" : "Conceptual signal propagation between computational layers; not live model activity") : undefined}>
    <div className="scientific-canvas" aria-hidden="true">
      <svg viewBox="0 0 700 460" fill="none" focusable="false">
        <defs>
          <radialGradient id={`${id}-node`} cx=".3" cy=".25" r=".8"><stop stopColor="var(--overview-node-light)"/><stop offset=".45" stopColor="var(--overview-node-mid)"/><stop offset="1" stopColor="var(--overview-node-shadow)"/></radialGradient>
          <linearGradient id={`${id}-floor`} x1="150" y1="100" x2="520" y2="420" gradientUnits="userSpaceOnUse"><stop stopColor="var(--overview-wire)" stopOpacity=".1"/><stop offset="1" stopColor="var(--overview-wire)" stopOpacity="0"/></linearGradient>
          <pattern id={`${id}-grid`} width="36" height="36" patternUnits="userSpaceOnUse"><path d="M36 0H0v36" stroke="var(--overview-wire)" strokeOpacity=".035"/></pattern><linearGradient id={`${id}-matrix`}><stop stopColor="var(--overview-signal)"/><stop offset="1" stopColor="var(--overview-wire)"/></linearGradient>
        </defs>
        <rect width="700" height="460" fill="var(--overview-art)"/><rect width="700" height="460" fill={`url(#${id}-grid)`}/><path d="M35 54h35M35 54v35m630-35h-35m35 0v35M35 406h35m-35 0v-35m630 35h-35m35 0v-35" stroke="var(--overview-wire)" strokeOpacity=".25"/>
        {kind === "network" ? <NeuralNetwork id={id}/> : kind === "attention" ? <Attention id={id}/> : kind === "language" ? <Language/> : <Embedding id={id}/>}
      </svg>
      {copy ? <div className="science-stage-key" dir={locale === "ar" ? "rtl" : "ltr"}>{(kind === "language" ? (locale === "ar" ? ["نص", "رموز", "تضمينات", "سياق", "مخرجات"] : ["Language", "Tokens", "Embeddings", "Context", "Output"]) : [copy[3], copy[4], copy[5]]).map(label => <span key={label}>{label}</span>)}</div> : null}
    </div>
    {copy ? <figcaption className="science-caption">
      <div><span className="science-figure-index" aria-hidden="true">{({ network: "01", attention: "02", language: "03", embedding: "04" })[kind]}</span><strong>{copy[0]}</strong></div>
      <p>{copy[1]}</p>
      <small>{copy[2]}</small>
      <span className="science-concept-label">{locale === "ar" ? "تصوّر مفاهيمي · ليس بيانات تشغيل" : "Conceptual illustration · not live telemetry"}</span>
    </figcaption> : null}
  </figure>;
}





