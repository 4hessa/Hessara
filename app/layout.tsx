import type { Metadata } from "next";
import { serverLocale } from "@/lib/server-locale";
import { isRTL, translate } from "@/lib/i18n";
import { coreLanguage } from "@/lib/core-ui-locales";
import "./globals.css";
import "./discover.css";
import "./identity.css";
import "./surfaces.css";
import "./design-system.css";
import "./brand.css";
export async function generateMetadata(): Promise<Metadata> {
  const locale = await serverLocale();
  return {
    title: `Hessara — ${translate(locale, "lab")}`,
    description: coreLanguage(locale)("قارن جودة النماذج وسرعتها وثباتها باستخدام المهام نفسها.", "Measure model quality, speed and consistency on the same tasks."),
    icons: {
      icon: [
        { url: "/brand/hessara-monogram.svg", type: "image/svg+xml", sizes: "any" },
        { url: "/brand/hessara-monogram-64.png", type: "image/png", sizes: "64x64" },
      ],
      apple: { url: "/brand/hessara-monogram-192.png", type: "image/png", sizes: "192x192" },
    },
  };
}
export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = await serverLocale();
  return (
    <html lang={locale} dir={isRTL(locale) ? "rtl" : "ltr"}>
      <body>{children}</body>
    </html>
  );
}
