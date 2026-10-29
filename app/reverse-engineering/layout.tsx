import { redirect } from "next/navigation";
import { authenticatedUser } from "@/lib/auth";
import { serverLocale } from "@/lib/server-locale";
import { ReverseEngineeringShell } from "./shell";
import "./reverse-engineering.css";
import "../workspace-grid.css";

export const metadata = { title: "Reverse Engineering · HESSARA" };
export default async function Layout({ children }: { children: React.ReactNode }) {
  const [user, locale] = await Promise.all([authenticatedUser(), serverLocale()]);
  if (!user || user.is_anonymous) redirect("/signin?next=%2Freverse-engineering");
  const isAdmin = user.app_metadata?.role === "admin" || (Array.isArray(user.app_metadata?.roles) && user.app_metadata.roles.includes("admin"));
  return <ReverseEngineeringShell initialLocale={locale === "ar" ? "ar" : "en"} isAdmin={isAdmin}>{children}</ReverseEngineeringShell>;
}
