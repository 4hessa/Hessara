"use client";

import { useEffect, useRef, useState, type MouseEvent } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUpRight, Pause, Play } from "lucide-react";
import { isRTL, translate, type Locale } from "@/lib/i18n";
import { isPlainNavigation, workspaceHref, type WorkspaceView } from "@/lib/workspace-location";
import { workspaceStartCopy } from "@/lib/workspace-start-copy";
import { heroCopy } from "./hero-copy";
import { WorkspaceStart } from "./workspace-start";
import { ScientificVisual } from "./scientific-visual";
import "./editions.css";

export function LandingHero({ locale, disabled, onExplore, onHow, onNavigate }: {
  locale: Locale; disabled: boolean; onExplore: () => void; onHow: () => void;
  onNavigate?: (section: WorkspaceView) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [motionPaused, setMotionPaused] = useState(false);
  const [activeChapter, setActiveChapter] = useState("");
  const copy = heroCopy[locale], paths = workspaceStartCopy(locale), arabic = locale === "ar";
  const c = (ar: string, en: string) => arabic ? ar : en;
  const Arrow = isRTL(locale) ? ArrowLeft : ArrowRight;
  const chapters = [
    { id: "llms", hash: "chapter-models", number: "01", label: c("النماذج اللغوية", "Language models"), title: c("فكرتك، من أكثر من منظور.", "One idea. More perspectives."), description: copy.description, kind: "attention" as const },
    { id: "agents", hash: "chapter-agents", number: "02", label: translate(locale, "agents"), title: c("أدوات تتكامل.\nومهام تتقدّم.", "Connected tools.\nConsidered workflows."), description: c("استكشف الوكلاء، تعرّف على متطلبات تشغيلهم، واختر مساحة العمل المناسبة لمهمتك.", "Explore agents, understand their setup requirements, and choose the right workspace for your task."), kind: "embedding" as const },
    { id: "personal-lab", hash: "chapter-lab", number: "03", label: paths.workflows["personal-lab"].title, title: c("مساحة للتجربة.\nودليل لقرارك.", "Room to experiment.\nEvidence to decide."), description: paths.workflows["personal-lab"].description, kind: "language" as const },
  ];
  const destinations: {id: WorkspaceView; label: string}[] = [
    {id:"overview",label:translate(locale,"overview")},{id:"llms",label:c("النماذج اللغوية","Language models")},
    {id:"agents",label:translate(locale,"agents")},{id:"personal-lab",label:paths.workflows["personal-lab"].title},
    {id:"code-workspace",label:paths.workflows["code-workspace"].title},{id:"runs",label:translate(locale,"runs")},
    {id:"tools",label:c("أدوات الذكاء الاصطناعي","AI tools")},{id:"benchmarks",label:translate(locale,"benchmarks")},
    {id:"models",label:translate(locale,"models")},{id:"how",label:copy.how},{id:"method",label:translate(locale,"method")},
  ];
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) (entry.target as HTMLElement).dataset.inView = String(entry.isIntersecting);
      const visible = [...element.querySelectorAll<HTMLElement>('.edition-story[data-in-view="true"]')]
        .sort((a, b) => Math.abs(a.getBoundingClientRect().top - window.innerHeight / 3) - Math.abs(b.getBoundingClientRect().top - window.innerHeight / 3));
      setActiveChapter(visible[0]?.id ?? "");
    }, { threshold: .12 });
    element.querySelectorAll(".edition-story").forEach(section => observer.observe(section));
    return () => observer.disconnect();
  }, []);
  const open = (id: WorkspaceView, event: MouseEvent<HTMLAnchorElement>) => {
    if (!onNavigate || !isPlainNavigation(event)) return;
    event.preventDefault(); onNavigate(id);
  };
  return <div ref={root} className="editions-experience" data-motion-paused={motionPaused} dir={isRTL(locale) ? "rtl" : "ltr"}>
    <section className="edition-hero" aria-labelledby="landing-title">
      <div className="edition-hero-meta"><span lang="en" dir="ltr">HESSARA — FIELD NOTES / 01</span><span>{copy.eyebrow}</span></div>
      <div className="edition-hero-grid">
        <div className="edition-hero-copy">
          <p className="edition-kicker">{c("فضولك، نقطة البداية.", "Curiosity is the starting point.")}</p>
          <h1 id="landing-title">{arabic ? <>ذكاء تختبره.<br/><em>وآفاق تكتشفها.</em></> : <>Intelligence,<br/><em>in a new light.</em></>}</h1>
          <p className="edition-description">{copy.description}</p>
          <div className="edition-actions"><button className="edition-primary" type="button" disabled={disabled} onClick={onExplore}>{copy.explore}<Arrow size={18} aria-hidden="true"/></button><button className="edition-secondary" type="button" onClick={onHow}>{copy.how}</button></div>
          <a className="edition-scroll" href="#chapter-models"><ArrowDown size={16} aria-hidden="true"/>{c("اكتشف الاحتمالات", "Explore the possibilities")}</a>
        </div>
        <div className="edition-hero-art"><ScientificVisual kind="network" locale={locale} motionPaused={motionPaused}/></div>
      </div>
    </section>
    <nav className="edition-chapters" aria-label={c("فصول التجربة", "Experience chapters")}>
      <span className="edition-chapters-label">{c("داخل هِسّارة", "Inside HESSARA")}</span>
      {chapters.map(chapter=><a key={chapter.hash} href={`#${chapter.hash}`} aria-current={activeChapter === chapter.hash ? "location" : undefined}><span aria-hidden="true">{chapter.number}</span>{chapter.label}</a>)}
      <a href="#all-sections">{c("جميع الأقسام", "All sections")}<ArrowDown size={14} aria-hidden="true"/></a>
      <button className="edition-motion-toggle" type="button" aria-pressed={motionPaused} onClick={()=>setMotionPaused(value=>!value)}>{motionPaused?<Play size={14} aria-hidden="true"/>:<Pause size={14} aria-hidden="true"/>}{c(motionPaused?"تشغيل الحركة":"إيقاف الحركة",motionPaused?"Play motion":"Pause motion")}</button>
    </nav>
    <div className="edition-stories">
      {chapters.map(chapter=><section key={chapter.id} id={chapter.hash} className="edition-story" data-in-view="false" aria-labelledby={`${chapter.hash}-title`}>
        <div className="edition-story-copy"><p className="edition-kicker"><span>{chapter.number} /</span>{chapter.label}</p><h2 id={`${chapter.hash}-title`}>{chapter.title}</h2><p>{chapter.description}</p><a className="edition-text-link" href={workspaceHref(chapter.id,`lang=${locale}`)} onClick={event=>open(chapter.id as WorkspaceView,event)}>{chapter.label}<Arrow size={18} aria-hidden="true"/></a></div>
        <ScientificVisual kind={chapter.kind} locale={locale} motionPaused={motionPaused}/>
      </section>)}
    </div>
    <div className="edition-workflows"><WorkspaceStart locale={locale} onNavigate={onNavigate}/></div>
    <section className="edition-directory" id="all-sections" aria-labelledby="edition-directory-title">
      <div><p className="edition-kicker" lang="en" dir="ltr">THE COMPLETE WORKSPACE</p><h2 id="edition-directory-title">{c("كل أدواتك.\nفي مكان واحد.", "Your whole workspace.\nIn one place.")}</h2></div>
      <nav aria-label={c("جميع أقسام المنصة", "All platform sections")}><ol>{destinations.map((item,index)=><li key={item.id}><a href={workspaceHref(item.id,`lang=${locale}`)} onClick={event=>open(item.id,event)}><span className="edition-directory-number" aria-hidden="true">{String(index+1).padStart(2,"0")}</span>{item.label}<ArrowUpRight size={16} aria-hidden="true"/></a></li>)}<li><a href={`/reverse-engineering?lang=${locale}`}><span className="edition-directory-number" aria-hidden="true">12</span>{paths.workflows["reverse-engineering"].title}<ArrowUpRight size={16} aria-hidden="true"/></a></li></ol></nav>
    </section>
  </div>;
}

