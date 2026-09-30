import { NextResponse } from "next/server";
import { safeReturnPath } from "@/lib/auth";
export function GET(request: Request) {
  const url = new URL(request.url);
  const target = new URL("/signin", url.origin);
  target.searchParams.set("next", safeReturnPath(url.searchParams.get("return_to")));
  return NextResponse.redirect(target);
}
