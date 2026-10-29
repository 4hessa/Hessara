"use client";
import { useEffect, useRef } from "react";
import type { AuthFluidRenderer } from "@/lib/auth-fluid-renderer";
import "./auth-fluid-visual.css";

export function AuthFluidVisual({ paused }: { paused: boolean }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<AuthFluidRenderer | null>(null);
  const pausedRef = useRef(paused);
  useEffect(() => { pausedRef.current = paused; rendererRef.current?.setPaused(paused); }, [paused]);
  useEffect(() => {
    const host = hostRef.current, canvas = canvasRef.current;
    if (!host || !canvas) return;
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    const contrast = matchMedia("(forced-colors: active)");
    let cancelled = false, starting = false;
    function start() {
      if (motion.matches || contrast.matches || cancelled || starting || rendererRef.current) return;
      starting = true;
      void import("@/lib/auth-fluid-renderer").then(({ createAuthFluidRenderer }) => {
        if (cancelled) return;
        try {
          rendererRef.current = createAuthFluidRenderer(canvas!, host!);
          rendererRef.current?.setPaused(pausedRef.current);
        } catch { host!.dataset.renderer = "fallback"; }
      }).catch(() => { if (!cancelled) host!.dataset.renderer = "fallback"; });
    }
    // Initial/reduced-motion artwork is visible before the solver's first frame.
    motion.addEventListener("change", start);
    contrast.addEventListener("change", start);
    start();
    return () => { cancelled = true; motion.removeEventListener("change", start); contrast.removeEventListener("change", start); rendererRef.current?.dispose(); rendererRef.current = null; };
  }, []);
  return <div id="signin-fluid-art" ref={hostRef} className="auth-fluid-visual" aria-hidden="true">
    <svg className="auth-fluid-visual__fallback" viewBox="0 0 600 760" preserveAspectRatio="xMidYMid slice" focusable="false">
      <defs>
        <linearGradient id="auth-silk" x1="0" x2="1" y1="0" y2=".7"><stop stopColor="#BFD7EA"/><stop offset=".45" stopColor="#F7F9FC"/><stop offset=".7" stopColor="#5F7FA6"/><stop offset="1" stopColor="#BFD7EA"/></linearGradient>
        <linearGradient id="auth-veil" x1="0" x2="1"><stop stopColor="#F7F9FC"/><stop offset=".5" stopColor="#BFD7EA"/><stop offset="1" stopColor="#F7F9FC"/></linearGradient>
      </defs>
      <path d="M244 92C473 126 130 263 321 357S454 581 273 670C427 524 175 488 219 362S403 197 244 92Z" fill="url(#auth-silk)"/>
      <path d="M332 78C113 181 459 244 296 398S137 536 329 692C210 527 444 483 380 349S208 189 332 78Z" fill="url(#auth-veil)" opacity=".73"/>
      <path d="M244 92C473 126 130 263 321 357S454 581 273 670M332 78C113 181 459 244 296 398S137 536 329 692" fill="none" stroke="#5F7FA6" strokeOpacity=".3" strokeWidth="1"/>
    </svg>
    <canvas ref={canvasRef} className="auth-fluid-visual__canvas" />
  </div>;
}
