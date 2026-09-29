import test from "node:test";
import assert from "node:assert/strict";
import { authTransportConfigured, authTransportOptions, createAuthTransport, trustedClientIp } from "../lib/auth-transport.ts";

const local = {
  NEXT_PUBLIC_SUPABASE_URL: "https://auth-test.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test_only",
};
const production = {
  ...local, VERCEL: "1", NODE_ENV: "production",
  SUPABASE_AUTH_SECRET_KEY: "sb_secret_test_only",
  HESSARA_AUTH_IP_FORWARDING: "true",
};
const visitor = new Headers({ "x-vercel-forwarded-for": "192.0.2.42" });

test("public Vercel auth requires confirmed forwarding and a server-only secret", () => {
  assert.equal(authTransportConfigured(visitor, production), true);
  for (const change of [
    { SUPABASE_AUTH_SECRET_KEY: undefined },
    { SUPABASE_AUTH_SECRET_KEY: "legacy-service-role-token" },
    { SUPABASE_AUTH_SECRET_KEY: "sb_secret_" },
    { HESSARA_AUTH_IP_FORWARDING: undefined },
    { HESSARA_AUTH_IP_FORWARDING: "false" },
    { NEXT_PUBLIC_SUPABASE_URL: undefined },
    { NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: undefined },
  ]) assert.equal(authTransportConfigured(visitor, { ...production, ...change }), false);
});

test("only a single platform-verified visitor IP can reach Supabase", () => {
  const spoofed = new Headers({ "x-forwarded-for": "198.51.100.1", "sb-forwarded-for": "198.51.100.2" });
  assert.equal(authTransportConfigured(spoofed, production), false);
  for (const value of ["", "not-an-ip", "192.0.2.1, 192.0.2.2", "192.0.2.1:3000", "[2001:db8::1]"]) {
    assert.equal(authTransportConfigured(new Headers({ "x-vercel-forwarded-for": value }), production), false);
  }
  spoofed.set("x-vercel-forwarded-for", "2001:db8::42");
  assert.equal(trustedClientIp(spoofed, production), "2001:db8::42");
  assert.deepEqual(authTransportOptions(spoofed, production).headers, { "sb-forwarded-for": "2001:db8::42" });
  assert.equal(trustedClientIp(spoofed, local), null);
  assert.deepEqual(authTransportOptions(spoofed, local).headers, {});
  assert.equal(authTransportOptions(spoofed, local).key, local.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
});

test("the auth wrapper cannot query privileged tables or administer users", () => {
  const client = createAuthTransport(visitor, { getAll: () => [], setAll: () => {} }, production);
  assert.equal(client.from, undefined);
  assert.equal(client.rpc, undefined);
  assert.equal(client.auth.admin, undefined);
  assert.equal(client.auth.setSession, undefined);
  assert.equal(typeof client.auth.getUser, "function");
  assert.equal(typeof client.auth.signInAnonymously, "function");
});
