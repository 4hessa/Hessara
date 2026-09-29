"use client";

import { useEffect, useRef, useState, type ComponentType } from "react";

type Scene = ComponentType;

function canRenderWebGL() {
  try {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    context?.getExtension("WEBGL_lose_context")?.loseContext();
    return Boolean(context);
  } catch {
    return false;
  }
}

/** A quiet, non-essential comparison motif. The SVG remains when motion or WebGL is unavailable. */
export function HeroArt() {
  const host = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  const [motionAllowed, setMotionAllowed] = useState(false);
  const [wideScreen, setWideScreen] = useState(false);
  const [SceneComponent, setSceneComponent] = useState<Scene | null>(null);

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const screen = window.matchMedia("(min-width: 801px)");
    const updatePreference = () => setMotionAllowed(!preference.matches);
    const updateScreen = () => setWideScreen(screen.matches);
    updatePreference();
    updateScreen();
    preference.addEventListener("change", updatePreference);
    screen.addEventListener("change", updateScreen);

    const element = host.current;
    if (!element) {
      return () => {
        preference.removeEventListener("change", updatePreference);
        screen.removeEventListener("change", updateScreen);
      };
    }

    const observer = new IntersectionObserver(
      ([entry]) => setInView(entry.isIntersecting),
      { rootMargin: "120px" },
    );
    observer.observe(element);

    return () => {
      observer.disconnect();
      preference.removeEventListener("change", updatePreference);
      screen.removeEventListener("change", updateScreen);
    };
  }, []);

  useEffect(() => {
    if (!inView || !motionAllowed || !wideScreen || SceneComponent || !canRenderWebGL()) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      import("./hero-art-scene")
        .then(({ HeroArtScene }) => {
          if (!cancelled) setSceneComponent(() => HeroArtScene);
        })
        .catch(() => {
          // The static motif is an intentional fallback for unsupported devices.
        });
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [inView, motionAllowed, wideScreen, SceneComponent]);

  return (
    <div className="hero-art" ref={host} aria-hidden="true">
      {inView && motionAllowed && wideScreen && SceneComponent ? (
        <SceneComponent />
      ) : (
        <svg className="hero-art-still" viewBox="0 0 480 420" fill="none">
          <ellipse cx="241" cy="212" rx="150" ry="116" transform="rotate(-27 241 212)" stroke="#775b6e" strokeWidth="9" />
          <ellipse cx="241" cy="212" rx="116" ry="151" transform="rotate(34 241 212)" stroke="#89aaa6" strokeWidth="8" />
          <ellipse cx="241" cy="212" rx="136" ry="109" transform="rotate(67 241 212)" stroke="#bcaac4" strokeWidth="7" />
          <ellipse cx="241" cy="212" rx="61" ry="55" fill="#cabecb" />
          <ellipse cx="226" cy="194" rx="23" ry="21" fill="#eee4e7" />
          <circle cx="128" cy="129" r="15" fill="#7f9390" />
          <circle cx="354" cy="148" r="12" fill="#a18eaa" />
          <circle cx="294" cy="332" r="14" fill="#a17889" />
        </svg>
      )}
    </div>
  );
}
