import type { Metadata } from "next";
import "./globals.css";
import "./discover.css";
import "./identity.css";
export const metadata: Metadata = {
  title: "Hessara — مختبر تقييم النماذج",
  description:
    "تجارب قابلة للتكرار ومقارنة منهجية لجودة النماذج وسرعتها واستقرارها.",
  icons: { icon: "/hessara-mark.png" },
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ar" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
