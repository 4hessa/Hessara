import { useRef, type MouseEvent, type ReactNode } from "react";
import Link from "next/link";
import { Menu, ChevronDown } from "lucide-react";
import { isPlainNavigation, workspaceHref } from "@/lib/workspace-location";
import type { Locale } from "@/lib/i18n";
import { BrandLockup } from "./brand-mark";

export type LandingDestination = { id: string; label: string };

/** Plain navigation preserves the existing workspace's single Radix tab list. */
export function LandingHeader({ locale, primary, secondary, moreLabel, menuLabel, onNavigate, onHome, children }: {
  locale?: Locale;
  primary: readonly LandingDestination[]; secondary: readonly LandingDestination[];
  moreLabel: string; menuLabel: string; onNavigate: (id: string) => void;
  onHome: (event: MouseEvent<HTMLAnchorElement>) => void; children: ReactNode;
}) {
  const mobile = useRef<HTMLDetailsElement>(null);
  const more = useRef<HTMLDetailsElement>(null);
  function navigate(id: string) {
    for (const menu of [mobile.current, more.current]) {
      if (!menu?.open) continue;
      menu.open = false;
      // The current destination may not trigger a view change/focus effect.
      menu.querySelector("summary")?.focus();
    }
    onNavigate(id);
  }
  function entries(items: readonly LandingDestination[]) {
    return items.map(item => <a href={workspaceHref(item.id, locale ? `lang=${locale}` : "")} key={item.id} aria-current={item.id === "overview" ? "page" : undefined} onClick={event => {
      if (!isPlainNavigation(event)) return;
      event.preventDefault();
      navigate(item.id);
    }}>{item.label}</a>);
  }
  const reverse = <Link href={`/reverse-engineering${locale ? `?lang=${locale}` : ""}`} lang="en" dir="ltr">Reverse Engineering <span aria-hidden="true">↗</span></Link>;
  return <header className="landing-header">
    <Link href={workspaceHref("overview", locale ? `lang=${locale}` : "")} onClick={onHome} className="landing-brand" aria-label="HESSARA">
      <BrandLockup markClassName="landing-emblem" />
    </Link>
    <nav className="landing-nav" aria-label={menuLabel}>
      {entries(primary)}
      <details className="landing-more" ref={more} onKeyDown={event => { if (event.key === "Escape") { event.currentTarget.open = false; event.currentTarget.querySelector("summary")?.focus(); } }}>
        <summary>{moreLabel}<ChevronDown size={12} aria-hidden="true" /></summary>
        <div className="landing-menu-items">{entries(secondary)}{reverse}</div>
      </details>
    </nav>
    <div className="landing-header-tools">{children}</div>
    <details className="landing-mobile-menu" ref={mobile} onKeyDown={event => { if (event.key === "Escape") { event.currentTarget.open = false; event.currentTarget.querySelector("summary")?.focus(); } }}>
      <summary aria-label={menuLabel}><Menu size={21} aria-hidden="true" /></summary>
      <nav className="landing-menu-items" aria-label={menuLabel}>{entries(primary)}{entries(secondary)}{reverse}</nav>
    </details>
  </header>;
}
