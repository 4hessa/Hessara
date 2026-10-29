"use client";

import dynamic from "next/dynamic";
import { Component, memo, useCallback, useEffect, useId, useRef, useState, type PointerEvent, type ReactNode } from "react";
import type { Locale } from "@/lib/i18n";
import { mayRenderWorkspaceScene, ribbonSilhouette, type WorkspaceSceneMode } from "@/lib/workspace-ribbon";
import "./workspace-visual.css";

const RibbonCanvas = dynamic(() => import("./workspace-visual-canvas"), { ssr: false, loading: () => null });
const silhouettes = [0, 2.1, 4.2].map(ribbonSilhouette);

class SceneBoundary extends Component<{ children: ReactNode; onFailure: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onFailure(); }
  render() { return this.state.failed ? null : this.props.children; }
}

export const WorkspaceVisual = memo(function WorkspaceVisual({ mode, active, className = "", motionPaused = false }: {
  mode: WorkspaceSceneMode;
  active: boolean;
  locale: Locale;
  className?: string;
  /** Playback preferences are controlled by the surrounding view, never an artwork overlay. */
  motionPaused?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const pointer = useRef({ x: 0, y: 0 });
  const [environment, setEnvironment] = useState({ inView: false, pageVisible: false, reducedMotion: true, compact: true, saveData: false, forcedColors: false });
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const gradient = `ribbon-${useId().replace(/:/g, "")}`;
  const fail = useCallback(() => { setFailed(true); setReady(false); }, []);
  const rendered = useCallback((value: boolean) => setReady(value), []);

  useEffect(() => {
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const compact = window.matchMedia("(max-width: 700px), (pointer: coarse)");
    const contrast = window.matchMedia("(forced-colors: active)");
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean; addEventListener?: (name: string, listener: () => void) => void; removeEventListener?: (name: string, listener: () => void) => void } }).connection;
    let mounted = true;
    const noObserver = typeof IntersectionObserver === "undefined";
    const update = () => setEnvironment(current => ({ ...current, inView: noObserver || current.inView, pageVisible: document.visibilityState === "visible", reducedMotion: motion.matches, compact: compact.matches, saveData: connection?.saveData === true, forcedColors: contrast.matches }));
    queueMicrotask(() => { if (mounted) update(); });
    motion.addEventListener("change", update);
    compact.addEventListener("change", update);
    contrast.addEventListener("change", update);
    document.addEventListener("visibilitychange", update);
    connection?.addEventListener?.("change", update);
    const observer = noObserver ? null : new IntersectionObserver(([entry]) => {
      setEnvironment(current => ({ ...current, inView: entry.isIntersecting && entry.intersectionRatio >= .08 }));
    }, { threshold: .08 });
    if (host.current) observer?.observe(host.current);
    return () => {
      mounted = false;
      observer?.disconnect();
      motion.removeEventListener("change", update);
      compact.removeEventListener("change", update);
      contrast.removeEventListener("change", update);
      document.removeEventListener("visibilitychange", update);
      connection?.removeEventListener?.("change", update);
    };
  }, []);

  const running = mayRenderWorkspaceScene({ active, ...environment, paused: motionPaused, failed });
  const move = (event: PointerEvent<HTMLDivElement>) => {
    if (!running || environment.compact || event.pointerType === "touch") return;
    const bounds = event.currentTarget.getBoundingClientRect();
    pointer.current.x = (event.clientX - bounds.left) / bounds.width * 2 - 1;
    pointer.current.y = (event.clientY - bounds.top) / bounds.height * 2 - 1;
  };

  return (
    <div ref={host} className={`hessara-scene hessara-scene--${mode} ${className}`} data-scene-state={running ? "animated" : "static"} onPointerMove={move} onPointerLeave={() => { pointer.current.x = 0; pointer.current.y = 0; }}>
      <div className="hessara-scene-art" aria-hidden="true">
        <svg viewBox="0 0 360 240" focusable="false" className="hessara-scene-fallback" data-covered={running && ready}>
          <defs>
            <linearGradient id={gradient} x1="0" y1="0" x2="1" y2="1">
              <stop stopColor="#f7f9fc" />
              <stop offset=".43" stopColor="#bfd7ea" />
              <stop offset=".73" stopColor="#5f7fa6" />
              <stop offset="1" stopColor="#c6cdd8" />
            </linearGradient>
          </defs>
          {silhouettes.map((path, index) => <path key={index} d={path} fill={`url(#${gradient})`} stroke="#5f7fa6" strokeOpacity=".22" strokeWidth=".65" transform={`rotate(${index * 32 - 25} 180 120)`} />)}
        </svg>
        {running && <SceneBoundary onFailure={fail}><RibbonCanvas mode={mode} compact={environment.compact} pointer={pointer} onFailure={fail} onReady={rendered} /></SceneBoundary>}
      </div>
    </div>
  );
});
