import { LegalDocument } from "../legal-document";
import { serverLocale } from "@/lib/server-locale";
export const metadata = { title: "Privacy policy · سياسة الخصوصية — HESSARA" };
export default async function Privacy({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  const locale = await serverLocale((await searchParams).lang);
  return <LegalDocument kind="privacy" language={locale === "ar" ? "ar" : "en"} />;
}
