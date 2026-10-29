"use client";

/*!
 * HESSARA adaptation of the breathing/ribbon geometry in Thinking Orbs.
 * Upstream: https://github.com/Jakubantalik/thinking-orbs
 * Files: src/engine/ribbon.ts, src/engine/core.ts, src/presets.ts
 * Accessed 2026-10-15. Only the breathing state is included here.
 * HESSARA changes: matte brand colors, low-density 20/48 px presets,
 * 30 fps ceiling, accessible optional status, and a self-contained lifecycle.
 *
 * MIT License
 * Copyright (c) 2026 Jakub Antalik
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

import { useEffect, useRef } from "react";
import "./thinking-orb.css";

type ThinkingOrbProps = {
  size?: "small" | "medium";
  /** Omit beside existing status text to avoid duplicate announcements. */
  label?: string;
  className?: string;
};

type OrbDot = { x: number; y: number; z: number; radius: number; depth: number };

/** The face-on two-wave breathing state from Thinking Orbs, without other modes. */
function paintBreathingOrb(context: CanvasRenderingContext2D, pixels: number, time: number) {
  const small = pixels === 20;
  const radius = pixels * 0.34;
  const lanes = small ? 3 : 5;
  const segments = small ? 26 : 54;
  const wobble = 0.25;
  const baseRadius = radius / (1 + 0.85 * 0.23 * wobble);
  const dots: OrbDot[] = [];

  for (let lane = 0; lane < lanes; lane++) {
    const offset = (lane - (lanes - 1) / 2) * 0.075;
    const edge = Math.abs(lane - (lanes - 1) / 2) / Math.max(1, (lanes - 1) / 2);
    for (let segment = 0; segment < segments; segment++) {
      const angle = (segment / segments) * Math.PI * 2;
      const wave = (0.16 * Math.sin(angle * 3 - time * 1.7 + lane * 0.22)
        + 0.07 * Math.sin(angle * 5 + time * 1.1)) * wobble;
      const x = Math.cos(angle);
      const y = Math.sin(angle);
      const length = Math.sqrt(x * x + y * y + offset * offset);
      const ringRadius = baseRadius * (1 + wave);
      const z = (offset / length) * ringRadius;
      const depth = (z / radius + 1) / 2;
      dots.push({
        x: pixels / 2 + (x / length) * ringRadius,
        y: pixels / 2 - (y / length) * ringRadius,
        z,
        radius: (small ? 0.56 : 0.76) * (1 - 0.25 * edge),
        depth,
      });
    }
  }

  dots.sort((a, b) => a.z - b.z);
  context.clearRect(0, 0, pixels, pixels);
  for (const dot of dots) {
    // Onyx/Steel interpolation keeps the small dots readable on pale surfaces.
    const shade = Math.max(0, Math.min(1, dot.depth * 0.7 + Math.sin(time * 0.25) * 0.08));
    const red = Math.round(18 + (137 - 18) * shade);
    const green = Math.round(18 + (161 - 18) * shade);
    const blue = Math.round(18 + (188 - 18) * shade);
    context.fillStyle = `rgba(${red},${green},${blue},${0.62 + dot.depth * 0.3})`;
    context.beginPath();
    context.arc(dot.x, dot.y, dot.radius, 0, Math.PI * 2);
    context.fill();
  }
}

export function ThinkingOrb({ size = "small", label, className = "" }: ThinkingOrbProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pixels = size === "medium" ? 48 : 20;

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;

    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(pixels * ratio);
    canvas.height = Math.round(pixels * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let visible = typeof IntersectionObserver === "undefined";
    let animation = 0;
    let lastFrame = -Infinity;
    let disposed = false;
    const draw = (milliseconds: number) => paintBreathingOrb(context, pixels, milliseconds / 1000 * 0.65);
    const tick = (now: number) => {
      animation = 0;
      if (disposed || !visible || document.hidden || motion.matches) return;
      if (now - lastFrame >= 1000 / 30) {
        draw(now);
        lastFrame = now;
      }
      animation = window.requestAnimationFrame(tick);
    };
    const synchronize = () => {
      window.cancelAnimationFrame(animation);
      animation = 0;
      if (motion.matches) {
        draw(600);
      } else if (!disposed && visible && !document.hidden) {
        animation = window.requestAnimationFrame(tick);
      }
    };
    const observer = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      synchronize();
    });

    draw(600);
    canvas.dataset.ready = "true";
    observer?.observe(canvas);
    document.addEventListener("visibilitychange", synchronize);
    motion.addEventListener("change", synchronize);
    synchronize();
    return () => {
      disposed = true;
      window.cancelAnimationFrame(animation);
      observer?.disconnect();
      document.removeEventListener("visibilitychange", synchronize);
      motion.removeEventListener("change", synchronize);
    };
  }, [pixels]);

  return <span
    className={`hessara-thinking-orb hessara-thinking-orb--${size} ${className}`.trim()}
    role={label ? "status" : undefined}
    aria-label={label || undefined}
    aria-hidden={label ? undefined : true}
  >
    <canvas ref={canvasRef} width={pixels} height={pixels} aria-hidden="true" />
    <span className="hessara-thinking-orb__fallback" aria-hidden="true" />
  </span>;
}
