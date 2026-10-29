"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { TabsList } from "@/components/ui/tabs";
import { isRTL, type Locale } from "@/lib/i18n";

const scrollCopy: Record<Locale, readonly [string, string]> = {
  ar: ["عرض الأقسام السابقة", "عرض الأقسام التالية"],
  en: ["Show previous sections", "Show next sections"],
  fr: ["Afficher les sections précédentes", "Afficher les sections suivantes"],
  es: ["Mostrar secciones anteriores", "Mostrar secciones siguientes"],
  zh: ["显示前面的栏目", "显示后面的栏目"],
  ko: ["이전 섹션 보기", "다음 섹션 보기"],
  ur: ["پچھلے حصے دکھائیں", "اگلے حصے دکھائیں"],
  fa: ["نمایش بخش‌های قبلی", "نمایش بخش‌های بعدی"],
  pt: ["Mostrar secções anteriores", "Mostrar secções seguintes"],
  it: ["Mostra sezioni precedenti", "Mostra sezioni successive"],
  ru: ["Показать предыдущие разделы", "Показать следующие разделы"],
  de: ["Vorherige Bereiche anzeigen", "Weitere Bereiche anzeigen"],
  nl: ["Vorige onderdelen tonen", "Volgende onderdelen tonen"],
};

/** Native scrolling and Radix keyboard navigation remain available at every width. */
export function WorkspaceNavigation({ children, locale, value, label }: {
  children: ReactNode;
  locale: Locale;
  value: string;
  label: string;
}) {
  const list = useRef<HTMLDivElement>(null);
  const id = useId();
  const rtl = isRTL(locale);
  const [edges, setEdges] = useState({ overflow: false, start: true, end: false });

  useEffect(() => {
    const node = list.current;
    if (!node) return;
    const measure = () => {
      const extent = Math.max(0, node.scrollWidth - node.clientWidth);
      const distance = Math.abs(node.scrollLeft);
      const next = { overflow: extent > 2, start: distance < 2, end: distance >= extent - 2 };
      setEdges(previous => previous.overflow === next.overflow && previous.start === next.start && previous.end === next.end ? previous : next);
    };
    const reveal = () => {
      node.querySelector<HTMLElement>('[data-state="active"]')?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
      measure();
    };
    const frame = requestAnimationFrame(reveal);
    const observer = new ResizeObserver(reveal);
    observer.observe(node);
    node.querySelectorAll('[role="tab"]').forEach(tab => observer.observe(tab));
    node.addEventListener("scroll", measure, { passive: true });
    return () => { cancelAnimationFrame(frame); observer.disconnect(); node.removeEventListener("scroll", measure); };
  }, [value, locale]);

  function scroll(direction: -1 | 1) {
    const node = list.current;
    if (!node) return;
    node.scrollBy({
      left: direction * (rtl ? -1 : 1) * node.clientWidth * .72,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
    });
  }

  return <nav className="nav-shell workspace-navigation" aria-label={label} data-overflow={edges.overflow}>
    <button className="nav-scroll-button" type="button" aria-label={scrollCopy[locale][0]} aria-controls={id} disabled={edges.start} onClick={() => scroll(-1)}>
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d={rtl ? "m9 6 6 6-6 6" : "m15 6-6 6 6 6"} /></svg>
    </button>
    <TabsList id={id} ref={list} className="main-tabs">{children}</TabsList>
    <button className="nav-scroll-button" type="button" aria-label={scrollCopy[locale][1]} aria-controls={id} disabled={edges.end} onClick={() => scroll(1)}>
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d={rtl ? "m15 6-6 6 6 6" : "m9 6 6 6-6 6"} /></svg>
    </button>
  </nav>;
}
