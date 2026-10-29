"use client";

import { memo, useEffect, useRef, type CSSProperties } from "react";
import Image from "next/image";
import { agentMascotFor, type MascotActivity, type MascotPersonality } from "@/lib/agent-mascot-config";
import "./super-agent-mascot.css";

const reducedMotionQuery = "(prefers-reduced-motion: reduce)";
const environmentListeners = new Set<() => void>();
let releaseEnvironment: (() => void) | undefined;
// One document/media listener pair serves the complete gallery, including filters.
function subscribeEnvironment(listener: () => void) {
  environmentListeners.add(listener);
  if (!releaseEnvironment) {
    const media = window.matchMedia(reducedMotionQuery);
    const update = () => environmentListeners.forEach(notify => notify());
    media.addEventListener("change", update);
    document.addEventListener("visibilitychange", update);
    releaseEnvironment = () => {
      media.removeEventListener("change", update);
      document.removeEventListener("visibilitychange", update);
      releaseEnvironment = undefined;
    };
  }
  listener();
  return () => {
    environmentListeners.delete(listener);
    if (!environmentListeners.size) releaseEnvironment?.();
  };
}

const dances: Record<MascotPersonality, Keyframe[]> = {
  curious: [{ transform: "rotate(0) translateY(0)" }, { transform: "rotate(-3deg) translateY(-3px)", offset: .3 }, { transform: "rotate(2deg) translateY(-1px)", offset: .68 }, { transform: "rotate(-.45deg) translateY(.5px)", offset: .86 }, { transform: "rotate(0) translateY(0)" }],
  buoyant: [{ transform: "translateY(0) scale(1)" }, { transform: "translateY(1px) scale(1.025,.975)", offset: .2 }, { transform: "translateY(-7px) scale(.99,1.015)", offset: .5 }, { transform: "translateY(.8px) scale(1.008,.992)", offset: .78 }, { transform: "translateY(-.3px)", offset: .9 }, { transform: "translateY(0) scale(1)" }],
  thoughtful: [{ transform: "rotate(0)" }, { transform: "rotate(2.5deg) translateX(2px)", offset: .35 }, { transform: "rotate(-1deg)", offset: .72 }, { transform: "rotate(.25deg)", offset: .89 }, { transform: "rotate(0)" }],
  spirited: [{ transform: "translateX(0) rotate(0)" }, { transform: "translateX(-3px) rotate(-3deg)", offset: .25 }, { transform: "translateX(3px) rotate(3deg)", offset: .65 }, { transform: "translateX(-.5px) rotate(-.5deg)", offset: .87 }, { transform: "translateX(0) rotate(0)" }],
  composed: [{ transform: "translateY(0) rotate(0)" }, { transform: "translateY(-3px) rotate(1.4deg)", offset: .4 }, { transform: "translateY(-1px) rotate(-1deg)", offset: .75 }, { transform: "translateY(.25px) rotate(.2deg)", offset: .9 }, { transform: "translateY(0) rotate(0)" }],
};

/** Whole-character raster gestures preserve the supplied art; no facial rig is implied. */
export const SuperAgentMascot = memo(function SuperAgentMascot({ agentId, motionPaused = false, selected = false, activity = "idle", compact = false }: {
  agentId: string; motionPaused?: boolean; selected?: boolean; activity?: MascotActivity; compact?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const activityReaction = useRef<((state: MascotActivity) => void) | undefined>(undefined);
  const config = agentMascotFor(agentId);
  useEffect(() => {
    const element = host.current;
    const card = element?.closest<HTMLElement>("[data-agent-id]");
    const character = element?.querySelector<HTMLElement>(".mascot-reaction");
    if (!element || !card || !character || !config) return;
    let visible = false, live = true, running = false;
    let danceTimer: ReturnType<typeof setTimeout> | undefined;
    let recoveryTimer: ReturnType<typeof setTimeout> | undefined;
    let gesture: Animation | undefined;
    let raf = 0, x = 0, y = 0, targetX = 0, targetY = 0;
    let bounds: DOMRect | undefined;
    const resetPointer = () => {
      x = 0; y = 0; targetX = 0; targetY = 0;
      element.style.setProperty("--mascot-pointer-x", "0");
      element.style.setProperty("--mascot-pointer-y", "0");
    };
    const stop = () => {
      clearTimeout(danceTimer); danceTimer = undefined;
      clearTimeout(recoveryTimer); recoveryTimer = undefined;
      gesture?.cancel(); gesture = undefined;
      cancelAnimationFrame(raf); raf = 0;
      element.dataset.reaction = "rest";
      resetPointer();
    };
    function react(kind: "notice" | "dance" | "celebrate") {
      if (!live || !running || typeof character!.animate !== "function") return;
      if (gesture?.playState === "running" && kind !== "celebrate") return;
      clearTimeout(recoveryTimer); gesture?.cancel();
      const frames = kind === "celebrate"
        ? [{ transform: "translateY(0) scale(1)" }, { transform: "translateY(1px) scale(1.025,.98)", offset: .2 }, { transform: "translateY(-8px) rotate(-2deg)", offset: .48 }, { transform: "translateY(-2px) rotate(1deg)", offset: .7 }, { transform: "translateY(.75px) rotate(-.25deg)", offset: .86 }, { transform: "translateY(0) scale(1)" }]
        : dances[config!.personality];
      const duration = kind === "notice" ? config!.danceDuration * .85 : config!.danceDuration;
      element!.dataset.reaction = kind;
      const individualFrames = frames.map(frame => ({ ...frame, transform: String(frame.transform).replace(/(-?\d*\.?\d+)(px|deg)/g, (_value, amount: string, unit: string) => (Number(amount) * config!.gestureStrength).toFixed(3) + unit) }));
      gesture = character!.animate(individualFrames, { duration, easing: "cubic-bezier(.22,.65,.32,1)", iterations: 1 });
      recoveryTimer = setTimeout(() => {
        if (live) element!.dataset.reaction = "rest";
        gesture?.cancel(); gesture = undefined; recoveryTimer = undefined;
      }, duration + 60);
    }
    activityReaction.current = state => {
      if (state === "success") react("celebrate");
      else if (state === "error") react("notice");
    };
    function scheduleDance() {
      clearTimeout(danceTimer);
      danceTimer = setTimeout(() => {
        if (!live || !running) return;
        if (!card!.matches(":hover,:focus-within")) react("dance");
        scheduleDance();
      }, config!.danceDelay);
    }
    function updateRunning() {
      const next = live && visible && !document.hidden && !motionPaused && !window.matchMedia(reducedMotionQuery).matches;
      element!.dataset.running = String(next);
      if (next === running) return;
      running = next;
      if (running) scheduleDance(); else stop();
    }
    function pointerFrame() {
      raf = 0;
      if (!running || !live) return;
      x += (targetX - x) * .16; y += (targetY - y) * .16;
      element!.style.setProperty("--mascot-pointer-x", x.toFixed(3));
      element!.style.setProperty("--mascot-pointer-y", y.toFixed(3));
      if (Math.abs(targetX - x) + Math.abs(targetY - y) > .015) raf = requestAnimationFrame(pointerFrame);
    }
    const requestPointerFrame = () => { if (!raf && running) raf = requestAnimationFrame(pointerFrame); };
    const enter = (event: PointerEvent) => {
      if (event.pointerType !== "mouse" || !running) return;
      bounds = card.getBoundingClientRect(); react("notice");
    };
    const move = (event: PointerEvent) => {
      if (!running || event.pointerType !== "mouse" || !bounds) return;
      targetX = Math.max(-1, Math.min(1, (event.clientX - bounds.left) / bounds.width * 2 - 1));
      targetY = Math.max(-1, Math.min(1, (event.clientY - bounds.top) / bounds.height * 2 - 1));
      requestPointerFrame();
    };
    const leave = () => { bounds = undefined; targetX = 0; targetY = 0; requestPointerFrame(); };
    const focus = () => react("notice");
    const click = (event: MouseEvent) => {
      if (event.target instanceof Element && event.target.closest("input,textarea,select,[disabled]")) return;
      react("celebrate");
    };
    card.addEventListener("pointerenter", enter, { passive: true });
    card.addEventListener("pointermove", move, { passive: true });
    card.addEventListener("pointerleave", leave, { passive: true });
    card.addEventListener("focusin", focus); card.addEventListener("focusout", leave);
    card.addEventListener("click", click, { passive: true });
    const unsubscribe = subscribeEnvironment(updateRunning);
    const observer = typeof IntersectionObserver === "undefined" ? undefined : new IntersectionObserver(entries => {
      visible = entries[0].isIntersecting; updateRunning();
    }, { threshold: .1 });
    if (observer) observer.observe(element); else { visible = true; updateRunning(); }
    return () => {
      live = false; running = false; activityReaction.current = undefined;
      stop(); observer?.disconnect(); unsubscribe();
      card.removeEventListener("pointerenter", enter); card.removeEventListener("pointermove", move);
      card.removeEventListener("pointerleave", leave); card.removeEventListener("focusin", focus);
      card.removeEventListener("focusout", leave); card.removeEventListener("click", click);
    };
  }, [config, motionPaused]);
  // Status gestures run once on a real state transition, through the same animation channel.
  useEffect(() => { activityReaction.current?.(activity); }, [activity]);
  if (!config) return null;
  const style = {
    "--mascot-idle-duration": config.idleDuration + "s", "--mascot-phase": config.phase + "s",
    "--mascot-amplitude": config.amplitude + "px", "--mascot-tilt": config.tilt + "deg",
  } as CSSProperties;
  return <div ref={host} className={"super-agent-mascot" + (compact ? " super-agent-mascot--compact" : "")} data-mascot={agentId} data-personality={config.personality} data-source-index={config.sourceIndex} data-running="false" data-reaction="rest" data-selected={selected} data-activity={activity} style={style} aria-hidden="true">
    <span className="mascot-atmosphere" /><span className="mascot-shadow" />
    <div className="mascot-follow"><div className="mascot-idle"><div className="mascot-reaction">
      <Image className="mascot-image" src={config.asset} alt="" width={512} height={640} sizes="(max-width:500px) 140px, 160px" loading="lazy" draggable={false} />
    </div></div></div>
    <span className="mascot-sparks"><i /><i /><i /></span>
  </div>;
});



