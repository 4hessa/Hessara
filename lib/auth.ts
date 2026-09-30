import "server-only";
import { cookies, headers } from "next/headers";
import { authTransportConfigured, createAuthTransport } from "./auth-transport";
export { safeReturnPath } from "./return-path";

export async function authConfigured(requestHeaders?: Pick<Headers, "get">) {
  return authTransportConfigured(requestHeaders ?? await headers());
}
export async function authClient() {
  const store = await cookies();
  return createAuthTransport(await headers(), {
    getAll: () => store.getAll(),
    setAll: (values) => {
      // Proxy refreshes cookies for Server Components; route handlers can write directly.
      try { values.forEach(({ name, value, options }) => store.set(name, value, options)); } catch {}
    },
  });
}
export async function authenticatedUser() {
  if (!await authConfigured()) return null;
  const client = await authClient();
  const { data, error } = await client.auth.getUser();
  return error ? null : data.user;
}
