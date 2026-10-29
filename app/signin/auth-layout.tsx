import type { ReactNode } from "react";
import Link from "next/link";
import { BrandMark } from "../brand-mark";
import { isRTL, type Locale } from "@/lib/i18n";

/** One quiet, shared canvas for sign-in, registration and account recovery. */
export function AuthLayout({ locale, backLabel, children }: {
  locale: Locale;
  backLabel: string;
  children: ReactNode;
}) {
  return <main className="signin-page" lang={locale} dir={isRTL(locale) ? "rtl" : "ltr"}>
    <div className="signin-art" aria-hidden="true">
      <BrandMark className="signin-art-mark" tone="inverse" />
    </div>
    <section className="signin-panel" aria-labelledby="signin-title">
      {children}
      <Link className="signin-back" href="/">{backLabel}</Link>
    </section>
  </main>;
}
