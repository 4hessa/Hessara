import { LegalDocument } from "../legal-document";
import { serverLocale } from "@/lib/server-locale";
export const metadata = { title: "Terms of use · شروط الاستخدام — HESSARA" };
export default async function Terms({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  const locale = await serverLocale((await searchParams).lang);
  return <LegalDocument kind="terms" language={locale === "ar" ? "ar" : "en"} />;
}
