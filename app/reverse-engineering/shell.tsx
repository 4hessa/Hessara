"use client";
import Link from "next/link";
import { BrandLockup } from "../brand-mark";
import { usePathname } from "next/navigation";
import { createContext, useContext, useState } from "react";
import { Activity, ArrowUpRight, Boxes, FileText, FlaskConical, Folder, LayoutDashboard, MessageSquare, ShieldCheck } from "lucide-react";
type Language = "ar" | "en";
const Context = createContext({ locale: "ar" as Language, isAdmin: false });
export function useReverseEngineering() {
  const context = useContext(Context);
  return { ...context, t: (ar: string, en: string) => context.locale === "ar" ? ar : en };
}
const navigation = [
  ["", "نظرة عامة", "Overview", LayoutDashboard],
  ["/new", "تحليل جديد", "New analysis", FlaskConical],
  ["/projects", "المشاريع", "Projects", Folder],
  ["/tools", "محركات التحليل", "Analysis engines", Boxes],
  ["/assistant", "مساعد التحليل", "AI assistant", MessageSquare],
  ["/reports", "التقارير", "Reports", FileText],
] as const;
export function ReverseEngineeringShell({ initialLocale, isAdmin, children }: { initialLocale: Language; isAdmin: boolean; children: React.ReactNode }) {
  const [locale, setLocale] = useState(initialLocale);
  const pathname = usePathname();
  const t = (ar: string, en: string) => locale === "ar" ? ar : en;
  function changeLanguage() {
    const next = locale === "ar" ? "en" : "ar";
    document.cookie = `hessara_locale=${next}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
    setLocale(next);
  }
  return <Context.Provider value={{ locale, isAdmin }}><div className="re-app" dir={locale === "ar" ? "rtl" : "ltr"} lang={locale}>
    <a className="re-skip" href="#re-main">{t("انتقل إلى المحتوى", "Skip to content")}</a>
    <header className="re-header"><Link href="/" className="re-brand" aria-label="HESSARA"><BrandLockup /></Link><div className="re-header-actions"><Link href="/">{t("العودة إلى المنصة", "Back to platform")}<ArrowUpRight size={15} /></Link><button onClick={changeLanguage} type="button" lang={locale === "ar" ? "en" : "ar"}>{locale === "ar" ? "English" : "العربية"}</button></div></header>
    <div className="re-layout"><aside className="re-sidebar"><div className="re-sidebar-title"><ShieldCheck size={21} /><strong dir="ltr">Reverse Engineering</strong></div><nav aria-label={t("أقسام الهندسة العكسية", "Reverse Engineering navigation")}>
      {navigation.map(([path, ar, en, Icon]) => <Link key={path} href={`/reverse-engineering${path}`} aria-current={pathname === `/reverse-engineering${path}` ? "page" : undefined}><Icon size={18} /><span>{t(ar, en)}</span></Link>)}
      {isAdmin && <Link href="/reverse-engineering/admin" aria-current={pathname === "/reverse-engineering/admin" ? "page" : undefined}><Activity size={18} /><span>{t("مراقبة التشغيل", "Operations")}</span></Link>}
    </nav><p className="re-sidebar-note">{t("حلّل الملفات التي تملكها أو لديك تفويض بتحليلها.", "Analyze artifacts you own or are authorized to inspect.")}</p></aside><main id="re-main" className="re-main">{children}</main></div>
  </div></Context.Provider>;
}
