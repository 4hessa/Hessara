"use client";
import { useEffect, useRef } from "react";

/** Decorative feedback only: the native cursor, focus and text selection stay usable. */
export function PointerMotion() {
  const ring = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = ring.current;
    if (!element) return;
    const media = window.matchMedia(
      "(pointer: fine) and (hover: hover) and (prefers-reduced-motion: no-preference)",
    );
    let frame = 0,
      enabled = media.matches,
      visible = false,
      x = 0,
      y = 0,
      targetX = 0,
      targetY = 0;
    const tick = () => {
      frame = 0;
      if (!enabled || !visible || document.hidden) return;
      x += (targetX - x) * 0.22;
      y += (targetY - y) * 0.22;
      element.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      if (Math.abs(targetX - x) + Math.abs(targetY - y) > 0.2)
        frame = requestAnimationFrame(tick);
    };
    const hide = () => {
      visible = false;
      element.style.opacity = "0";
      element.dataset.pressed = "false";
      cancelAnimationFrame(frame);
      frame = 0;
    };
    const move = (event: PointerEvent) => {
      if (!enabled || event.pointerType !== "mouse") return;
      targetX = event.clientX;
      targetY = event.clientY;
      if (!visible) {
        x = targetX;
        y = targetY;
        visible = true;
      }
      const target = event.target instanceof Element ? event.target : null;
      const editing = !!target?.closest(
        "input, textarea, [contenteditable=true], pre, code",
      );
      element.style.opacity = editing ? "0" : "1";
      const control = target?.closest(
        "button, a, summary, select, [role=button], [role=tab], [role=option], [role=combobox]",
      );
      element.dataset.interactive = String(
        !!control &&
          !control.matches(":disabled, [aria-disabled=true], [data-disabled]"),
      );
      if (!frame) frame = requestAnimationFrame(tick);
    };
    const changed = () => {
      enabled = media.matches;
      if (!enabled) hide();
    };
    const press = (event: PointerEvent) => {
      if (enabled && event.pointerType === "mouse") element.dataset.pressed = "true";
    };
    const release = () => { element.dataset.pressed = "false"; };
    window.addEventListener("pointermove", move, { passive: true });
    window.addEventListener("pointerdown", press, { passive: true });
    window.addEventListener("pointerup", release, { passive: true });
    window.addEventListener("pointercancel", release, { passive: true });
    document.addEventListener("pointerleave", hide);
    window.addEventListener("blur", hide);
    document.addEventListener("visibilitychange", hide);
    media.addEventListener("change", changed);
    return () => {
      hide();
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerdown", press);
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", release);
      document.removeEventListener("pointerleave", hide);
      window.removeEventListener("blur", hide);
      document.removeEventListener("visibilitychange", hide);
      media.removeEventListener("change", changed);
    };
  }, []);
  return (
    <div ref={ring} className="pointer-halo" aria-hidden="true">
      <span />
    </div>
  );
}
