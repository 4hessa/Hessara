import Workspace from "./workspace";
import { authenticatedUser } from "@/lib/auth";
import { serverLocale } from "@/lib/server-locale";
import { redirect } from "next/navigation";
export const dynamic = "force-dynamic";
export default async function Page({ searchParams }: { searchParams: Promise<{ error?: string; error_code?: string; lang?: string }> }) {
  const query = await searchParams;
  // Supabase can send expired/cancelled OAuth attempts to its Site URL before
  // our callback runs. Return to the existing recovery UI without echoing
  // provider descriptions, authorization state, or changing the current owner.
  if (query.error || query.error_code) redirect("/signin?error=expired");
  const user = await authenticatedUser();
  return <Workspace initialLocale={await serverLocale(query.lang)} sessionMode={user ? user.is_anonymous ? "guest" : "account" : "none"} />;
}
