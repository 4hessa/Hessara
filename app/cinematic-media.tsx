"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import "./cinematic-media.css";

const query = "(prefers-reduced-motion: reduce)";
function subscribe(listener: () => void) {
  const media = window.matchMedia(query);
  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
}

/** Decorative silent film. Playback controls belong to the surrounding page. */
export function CinematicMedia({ className = "", motionPaused = false, src = "/media/neural-field.mp4", poster = "/media/neural-field-poster.webp", width = 960, height = 600 }: { className?: string; motionPaused?: boolean; src?: string; poster?: string; width?: number; height?: number }) {
  const video = useRef<HTMLVideoElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const reduced = useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => true);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const element = video.current, frame = container.current;
    if (!element || !frame) return;
    if (typeof IntersectionObserver === "undefined") { element.pause(); return; }
    let visible = false, live = true;
    const update = () => {
      if (!live) return;
      element.muted = true;
      element.autoplay = visible && !document.hidden && !reduced && !motionPaused;
      if (element.autoplay) void element.play().catch(() => { /* Retain the poster if autoplay is blocked. */ });
      else element.pause();
    };
    const observer = new IntersectionObserver(entries => { visible = entries[0].isIntersecting; update(); }, { threshold: .05 });
    observer.observe(frame); document.addEventListener("visibilitychange", update);
    return () => { live = false; observer.disconnect(); document.removeEventListener("visibilitychange", update); element.pause(); };
  }, [reduced, motionPaused]);
  return <div className={`cinematic-media ${className}`.trim()} ref={container} style={{ aspectRatio: `${width} / ${height}` }}>
    {/* A local poster reserves the ratio and prevents an empty/black loading frame. */}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img className="cinematic-poster" src={poster} alt="" width={width} height={height} />
    <video ref={video} className="cinematic-film" data-ready={ready && !reduced} src={src} poster={poster} autoPlay={false} muted loop playsInline preload="none" controls={false} disablePictureInPicture disableRemotePlayback tabIndex={-1} aria-hidden="true" onLoadedData={() => setReady(true)} onError={() => setReady(false)} />
  </div>;
}


