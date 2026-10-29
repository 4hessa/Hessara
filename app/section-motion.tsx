"use client";

import { useEffect } from "react";
import { animate } from "motion/mini";
import { inView } from "motion";
import { startSectionMotion } from "@/lib/section-motion-controller";

export function scrollToSection(target: HTMLElement) {
  target.scrollIntoView({
    behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    block: "start",
    inline: "nearest",
  });
}

/** Motion owns entrances; native browser scrolling owns navigation. */
export function SectionMotion({ section }: { section: string }) {
  useEffect(() => {
    const panel = document.querySelector<HTMLElement>('[role="tabpanel"][data-state="active"]');
    if (!panel) return;
    return startSectionMotion(panel, animate, inView);
  }, [section]);
  return null;
}
