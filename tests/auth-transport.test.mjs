import test from "node:test";
import assert from "node:assert/strict";
import { authRequestFetch, authTransportConfigured, authTransportOptions, createAuthTransport, trustedClientIp } from "../lib/auth-transport.ts";
import { sessionCookieWrites, sessionPreference, sessionPreferenceCookie } from "../lib/signin-session.ts";

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

test("session-only cookie policy strips persistence from token chunks and refreshes while preserving deletion and unrelated cookies", () => {
  const writes = [
    { name: "sb-fixture-auth-token.0", value: "session", options: { httpOnly: true, secure: true, maxAge: 3600, expires: new Date("2030-01-01") } },
    { name: "sb-fixture-auth-token-code-verifier", value: "verifier", options: { maxAge: 3600 } },
    { name: "sb-fixture-auth-token.1", value: "", options: { maxAge: 0 } },
    { name: "unrelated", value: "preference", options: { maxAge: 3600 } },
  ];
  const result = sessionCookieWrites(writes, false);
  assert.deepEqual(result[0].options, { httpOnly: true, secure: true });
  assert.deepEqual(result[1].options, {});
  assert.equal(result[2], writes[2]); assert.equal(result[3], writes[3]);
  assert.equal(writes[0].options.maxAge, 3600, "input cookie options must not be mutated");
  assert.equal(sessionCookieWrites(writes, undefined), writes);
  assert.equal(sessionCookieWrites(writes, true), writes);
  assert.equal(sessionPreference("session"), false); assert.equal(sessionPreference("persistent"), true); assert.equal(sessionPreference("untrusted"), undefined);
  assert.equal(Object.hasOwn(sessionPreferenceCookie(false, true).options, "maxAge"), false);
  assert.ok(sessionPreferenceCookie(true, true).options.maxAge > 0);
});

test('malformed or insecure Supabase configuration fails closed before constructing an auth client',()=>{
 for(const url of ['not-a-url','http://auth-test.supabase.co','https://user:password@auth-test.supabase.co','https://auth-test.supabase.co/path','https://auth-test.supabase.co?token=bad','https://auth-test.supabase.co#fragment']){
  assert.equal(authTransportConfigured(new Headers(),{...local,NEXT_PUBLIC_SUPABASE_URL:url}),false);
 }
 assert.equal(authTransportConfigured(new Headers(),{...local,NEXT_PUBLIC_SUPABASE_URL:'http://127.0.0.1:54321',NODE_ENV:'development'}),true);
 assert.equal(authTransportConfigured(new Headers(),{...local,NEXT_PUBLIC_SUPABASE_URL:'http://127.0.0.1:54321',NODE_ENV:'production'}),false);
});

test('request-scoped auth fetch preserves caller cancellation and shares a bounded deadline without redirecting credentials',async()=>{
 const deadline=new AbortController(),caller=new AbortController(),calls=[];
 const fetcher=authRequestFetch(async(input,options)=>{calls.push({input,options});return new Response(null,{status:204});},deadline.signal);
 await fetcher(new Request('https://auth-test.supabase.co/auth/v1/user',{signal:caller.signal}));
 await fetcher('https://auth-test.supabase.co/auth/v1/token',{method:'POST'});
 assert.equal(calls[0].options.redirect,'error');assert.equal(calls[1].options.redirect,'error');
 assert.equal(calls[0].options.signal.aborted,false);assert.equal(calls[1].options.signal.aborted,false);
 caller.abort();assert.equal(calls[0].options.signal.aborted,true);assert.equal(calls[1].options.signal.aborted,false,'a caller does not cancel a separate request');
 deadline.abort();assert.equal(calls[1].options.signal.aborted,true,'the shared deadline bounds remaining requests');
});
