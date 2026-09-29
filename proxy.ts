import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { authTransportConfigured, createAuthTransport } from "./lib/auth-transport";

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  if (!authTransportConfigured(request.headers)) return response;
  const client = createAuthTransport(request.headers, {
    getAll: () => request.cookies.getAll(),
    setAll: (values) => {
      values.forEach(({ name, value }) => request.cookies.set(name, value));
      response = NextResponse.next({ request });
      values.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
    },
  });
  await client.auth.getClaims();
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
export const config = { matcher: ["/", "/signin", "/api/:path*", "/auth/:path*"] };
