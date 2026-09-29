import { NextResponse } from "next/server";
import { authClient, safeReturnPath } from "@/lib/auth";
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  if (code) {
    try {
      const { error } = await (await authClient()).auth.exchangeCodeForSession(code);
      if (!error) return NextResponse.redirect(new URL(safeReturnPath(url.searchParams.get("next")), url.origin));
    } catch {}
  }
  return NextResponse.redirect(new URL("/signin?error=expired", url.origin));
}
