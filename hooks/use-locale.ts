"use client";
import { useCallback, useState, useSyncExternalStore } from "react";
import { isLocale, LOCALE_KEY, type Locale } from "@/lib/i18n";

const changeEvent = "hessara:locale-change";
function subscribe(listener: () => void) {
  window.addEventListener("storage", listener);
  window.addEventListener("popstate", listener);
  window.addEventListener(changeEvent, listener);
  return () => {
    window.removeEventListener("storage", listener);
    window.removeEventListener("popstate", listener);
    window.removeEventListener(changeEvent, listener);
  };
}

/** An explicit link locale wins over an older saved browser preference. */
export function useLocale(initialLocale: Locale) {
  const [fallback, setFallback] = useState(initialLocale);
  const [storageEnabled, setStorageEnabled] = useState(true);
  const snapshot = useCallback(() => {
    const requested = new URLSearchParams(window.location.search).get("lang");
    if (isLocale(requested)) return requested;
    try {
      const saved = storageEnabled ? localStorage.getItem(LOCALE_KEY) : null;
      if (isLocale(saved)) return saved;
    } catch { /* Private browsers may disable storage; state remains usable. */ }
    return fallback;
  }, [fallback, storageEnabled]);
  const locale = useSyncExternalStore(subscribe, snapshot, () => initialLocale);
  const setLocale = useCallback((next: Locale) => {
    if (!isLocale(next)) return;
    const url = new URL(window.location.href);
    url.searchParams.set("lang", next);
    // Next's native-history integration retains the route, run and fragment.
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    try { localStorage.setItem(LOCALE_KEY, next); } catch { setStorageEnabled(false); }
    setFallback(next);
    window.dispatchEvent(new Event(changeEvent));
  }, []);
  return [locale, setLocale] as const;
}
