"use client";

import { useEffect, useRef } from 'react';
import './decision-orbit.css';

/** Original low-density point field: a quiet visual metaphor, never a progress readout. */
export function DecisionOrbit() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    const width = 270, height = 150;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = width * ratio; canvas.height = height * ratio;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const fine = window.matchMedia('(pointer: fine) and (hover: hover)');
    const region = canvas.closest('.meadow-welcome');
    const points = Array.from({length: 19 * 44}, (_, i) => {
      const latitude = Math.floor(i / 44) / 18 * Math.PI;
      const longitude = i % 44 / 44 * Math.PI * 2;
      return {x: Math.sin(latitude) * Math.cos(longitude), y: Math.cos(latitude), z: Math.sin(latitude) * Math.sin(longitude), phase: longitude};
    });
    let frame = 0, last = 0, visible = false, disposed = false, gaze = 0;
    function paint(time: number) {
      if (!context) return;
      context.clearRect(0, 0, width, height);
      const turn = time * .055 + gaze;
      context.save(); context.translate(width / 2, height / 2);
      context.rotate(-.2); context.strokeStyle = '#9aafa055'; context.lineWidth = .6;
      context.beginPath(); context.ellipse(0, 0, 116, 31, 0, 0, Math.PI * 2); context.stroke();
      context.rotate(.63); context.strokeStyle = '#9cabb644'; context.beginPath(); context.ellipse(0, 0, 102, 38, 0, 0, Math.PI * 2); context.stroke(); context.restore();
      const dots = points.map(point => {
        const breathe = 1 + .025 * Math.sin(time * .65 + point.phase * 3);
        const x = point.x * Math.cos(turn) - point.z * Math.sin(turn);
        const z = point.x * Math.sin(turn) + point.z * Math.cos(turn);
        const depth = (z + 1) / 2;
        return {x: width / 2 + x * 58 * breathe, y: height / 2 + point.y * 57 * breathe, depth};
      }).sort((a,b) => a.depth - b.depth);
      for (const dot of dots) {
        context.fillStyle = `rgba(91,119,99,${.14 + dot.depth * .48})`;
        context.beginPath(); context.arc(dot.x, dot.y, .45 + dot.depth * .48, 0, Math.PI * 2); context.fill();
      }
      for (let i = 0; i < 3; i++) {
        const angle = time * .09 + i * Math.PI * 2 / 3;
        const x = width / 2 + Math.cos(angle) * 108;
        const y = height / 2 + Math.sin(angle) * 30;
        const light = context.createRadialGradient(x - 2, y - 2, 0, x, y, 7);
        light.addColorStop(0, '#ffffff'); light.addColorStop(.5, i === 1 ? '#d4dee3' : '#d3e1d1'); light.addColorStop(1, '#9eafa8');
        context.fillStyle = light; context.beginPath(); context.arc(x, y, 5.5, 0, Math.PI * 2); context.fill();
      }
    }
    function tick(now: number) {
      frame = 0;
      if (disposed || !visible || document.hidden || motion.matches) return;
      if (now - last >= 1000 / 30) { paint(now / 1000); last = now; }
      frame = requestAnimationFrame(tick);
    }
    function synchronize() {
      cancelAnimationFrame(frame); frame = 0;
      if (motion.matches) { gaze = 0; paint(.5); }
      else if (visible && !document.hidden && !disposed) frame = requestAnimationFrame(tick);
    }
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; synchronize(); });
    const move = (event: Event) => {
      if (!fine.matches || motion.matches || !(event instanceof PointerEvent) || !region) return;
      const bounds = region.getBoundingClientRect();
      gaze = Math.max(-.13, Math.min(.13, (event.clientX - bounds.left - bounds.width / 2) / bounds.width * .26));
    };
    const leave = () => { gaze = 0; };
    paint(.5); observer.observe(canvas);
    region?.addEventListener('pointermove', move, {passive: true}); region?.addEventListener('pointerleave', leave);
    document.addEventListener('visibilitychange', synchronize); motion.addEventListener('change', synchronize);
    return () => { disposed = true; cancelAnimationFrame(frame); observer.disconnect(); region?.removeEventListener('pointermove', move); region?.removeEventListener('pointerleave', leave); document.removeEventListener('visibilitychange', synchronize); motion.removeEventListener('change', synchronize); };
  }, []);
  return <div className="hero-visual decision-orbit" aria-hidden="true"><canvas ref={canvasRef} width="270" height="150" /></div>;
}
