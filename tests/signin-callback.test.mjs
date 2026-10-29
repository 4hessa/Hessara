import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, unlink, rmdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { PASSWORD_SETUP_COOKIE, PASSWORD_RECOVERY_COOKIE, passwordSetupToken, passwordRecoveryToken, validPasswordSetup } from "../lib/signin-security.ts";
import { SESSION_PREFERENCE_COOKIE } from "../lib/signin-session.ts";

const origin = "https://hessara.example";
const secret = "fixture-only-callback-signing-key";
const sessionCookie = "sb-auth-fixture-auth-token";
const verifierCookie = `${sessionCookie}-code-verifier`;
const environment = {
  NEXT_PUBLIC_SUPABASE_URL: "https://auth-fixture.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_fixture_only",
  SUPABASE_AUTH_SECRET_KEY: "sb_secret_fixture_only",
  HESSARA_AUTH_IP_FORWARDING: "true",
  HESSARA_ENCRYPTION_KEY: secret,
  VERCEL: "1",
  NODE_ENV: "production",
};

// Keep the route and the real auth/cookie adapters; replace only framework
// request context and Supabase's network client. All environment values are
// compiled-in fixtures, so this suite never reads deployment credentials.
const harness = `
  export const state = {};
  export function reset() {
    Object.assign(state, {
      user: { id: "email-owner", email: "person@example.org", is_anonymous: false, email_confirmed_at: "2026-01-01" }, priorUser: null,
      cookie: new Map([[${JSON.stringify(verifierCookie)}, "fixture-verifier"]]),
      writes: [], calls: [], clients: 0, error: null, throws: false, refresh: false,
    });
  }
  reset();
  export async function headers() {
    return new Headers({ "x-vercel-forwarded-for": "192.0.2.42" });
  }
  export async function cookies() {
    return {
      get: name => state.cookie.has(name) ? { name, value: state.cookie.get(name) } : undefined,
      getAll: () => [...state.cookie].map(([name, value]) => ({ name, value })),
      set: (name, value, options) => {
        state.cookie.set(name, value);
        state.writes.push({ name, value, options });
      },
      delete: name => state.cookie.delete(name),
    };
  }
  export function createServerClient(_url, _key, options) {
    state.clients++;
    const auth = {};
    for (const name of ["getClaims", "signInAnonymously", "signInWithOtp", "resetPasswordForEmail", "signUp",
      "signInWithPassword", "signInWithOAuth", "linkIdentity", "updateUser", "signOut"])
      auth[name] = async () => { throw new Error("Unexpected auth method: " + name); };
    auth.exchangeCodeForSession = async code => {
      const incoming = options.cookies.getAll();
      state.calls.push({ name: "exchangeCodeForSession", code, incoming });
      if (state.throws) throw new Error("fixture-provider-detail");
      if (state.error) return { error: state.error };
      if (!incoming.some(cookie => cookie.name === ${JSON.stringify(verifierCookie)} && cookie.value === "fixture-verifier"))
        return { error: { message: "Missing fixture verifier" } };
      await options.cookies.setAll([{
        name: ${JSON.stringify(sessionCookie)}, value: "fixture-session",
        options: { ...options.cookieOptions, maxAge: 3600 },
      }], {});
      return { error: null };
    };
    auth.getUser = async () => {
      const incoming = options.cookies.getAll();
      state.calls.push({ name: "getUser", incoming });
      if (state.refresh) await options.cookies.setAll([{
        name: ${JSON.stringify(sessionCookie)}, value: "fixture-session",
        options: { ...options.cookieOptions, maxAge: 3600, expires: new Date("2030-01-01") },
      }], {});
      return {
        data: { user: incoming.some(cookie => cookie.name === ${JSON.stringify(sessionCookie)} && cookie.value === "fixture-session") ? state.user : state.priorUser },
        error: null,
      };
    };
    return { auth };
  }
`;

const directory = await mkdtemp(resolve(".signin-callback-test-"));
const output = join(directory, "callback.mjs");
let callback;
try {
  const result = await build({
    absWorkingDir: process.cwd(),
    stdin: {
      contents: "export { GET } from './app/auth/callback/route'; export { authenticatedUser } from './lib/auth'; export { state, reset } from 'callback-test-harness';",
      resolveDir: process.cwd(), loader: "ts",
    },
    bundle: true, platform: "node", format: "esm", write: false,
    packages: "external", tsconfig: resolve("tsconfig.json"),
    define: { "process.env": JSON.stringify(environment) },
    plugins: [{
      name: "callback-without-external-services",
      setup(builder) {
        builder.onResolve({ filter: /^(callback-test-harness|next\/headers|@supabase\/ssr)$/ }, () => ({ path: "callback-harness", namespace: "test" }));
        builder.onLoad({ filter: /.*/, namespace: "test" }, () => ({ contents: harness, loader: "ts" }));
        builder.onResolve({ filter: /^server-only$/ }, () => ({ path: "server-only", namespace: "empty" }));
        builder.onLoad({ filter: /.*/, namespace: "empty" }, () => ({ contents: "", loader: "js" }));
        builder.onResolve({ filter: /^next\/server$/ }, () => ({ path: "next/server.js", external: true }));
      },
    }],
  });
  await writeFile(output, result.outputFiles[0].text);
  callback = await import(pathToFileURL(output).href);
} finally {
  await unlink(output).catch(error => { if (error.code !== "ENOENT") throw error; });
  await rmdir(directory);
}

function request(parameters = { code: "fixture-code", next: "/lab?lang=ar" }) {
  const url = new URL("/auth/callback", origin);
  for (const [name, value] of Object.entries(parameters)) url.searchParams.set(name, value);
  return new Request(url);
}

function destination(response) {
  assert.equal(response.status, 307);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  return new URL(response.headers.get("location"));
}

test.beforeEach(() => callback.reset());

test("email confirmation exchanges the code and persists protected session cookies across the redirect", async () => {
  const response = await callback.GET(request());
  assert.equal(destination(response).href, `${origin}/lab?lang=ar`);
  assert.deepEqual(callback.state.calls.map(call => call.name), ["exchangeCodeForSession", "getUser"]);
  assert.equal(callback.state.calls[0].code, "fixture-code");
  assert.equal(callback.state.cookie.get(sessionCookie), "fixture-session");
  assert.deepEqual(callback.state.writes, [{
    name: sessionCookie, value: "fixture-session",
    options: { httpOnly: true, sameSite: "lax", secure: true, path: "/", maxAge: 3600 },
  }]);
  assert.equal((await callback.authenticatedUser()).id, "email-owner");
  assert.equal(callback.state.clients, 2, "a later request reads the persisted session through a new client");
  assert.ok(callback.state.calls.at(-1).incoming.some(cookie => cookie.name === sessionCookie));
});

test("confirmed guest conversion with the same owner ticket returns to password setup", async () => {
  callback.state.user = { id: "guest-owner", is_anonymous: false, email_confirmed_at: "2026-01-01" };
  const ticket = passwordSetupToken("guest-owner", secret);
  callback.state.cookie.set(PASSWORD_SETUP_COOKIE, ticket);
  const url = destination(await callback.GET(request()));
  assert.equal(url.origin, origin);
  assert.equal(url.pathname, "/signin");
  assert.equal(url.searchParams.get("next"), "/lab?lang=ar");
  assert.equal(url.searchParams.has("error"), false);
  assert.equal(callback.state.cookie.get(PASSWORD_SETUP_COOKIE), ticket);
  assert.equal((await callback.authenticatedUser()).id, "guest-owner");
});

test("mismatched, unconfirmed, or anonymous users cannot enter guest password setup", async () => {
  for (const user of [
    { id: "different-owner", is_anonymous: false, email_confirmed_at: "2026-01-01" },
    { id: "guest-owner", is_anonymous: false },
    { id: "guest-owner", is_anonymous: true, email_confirmed_at: "2026-01-01" },
    null,
  ]) {
    callback.reset();
    callback.state.user = user;
    callback.state.cookie.set(PASSWORD_SETUP_COOKIE, passwordSetupToken("guest-owner", secret));
    assert.equal(destination(await callback.GET(request())).href, `${origin}/lab?lang=ar`);
    assert.deepEqual(callback.state.writes.map(cookie => cookie.name), [sessionCookie]);
  }
});

test("a confirmed owner still needs a valid unexpired setup ticket", async () => {
  for (const ticket of [
    undefined,
    `${passwordSetupToken("email-owner", secret)}tampered`,
    passwordSetupToken("email-owner", secret, Date.now() - 86400001),
  ]) {
    callback.reset();
    if (ticket) callback.state.cookie.set(PASSWORD_SETUP_COOKIE, ticket);
    assert.equal(destination(await callback.GET(request())).href, `${origin}/lab?lang=ar`);
  }
});

test("failed or throwing exchanges preserve the current cookies and return a safe generic error", async () => {
  for (const throws of [false, true]) {
    callback.reset();
    callback.state.throws = throws;
    callback.state.error = { message: "fixture-provider-detail" };
    callback.state.cookie.set(sessionCookie, "existing-session");
    callback.state.cookie.set(PASSWORD_SETUP_COOKIE, "existing-ticket");
    const before = [...callback.state.cookie];
    const response = await callback.GET(request({ code: "fixture-code", next: "https://untrusted.example" }));
    const url = destination(response);
    assert.equal(url.origin, origin);
    assert.equal(url.pathname, "/signin");
    assert.deepEqual([...url.searchParams], [["error", "expired"], ["next", "/"]]);
    assert.deepEqual(callback.state.calls.map(call => call.name), ["exchangeCodeForSession"]);
    assert.deepEqual([...callback.state.cookie], before);
    assert.deepEqual(callback.state.writes, []);
    assert.ok(!response.headers.get("location").includes("fixture-provider-detail"));
  }
});

test("missing, oversized, or provider-error codes fail before creating an auth client", async () => {
  for (const parameters of [
    { next: "/lab" },
    { code: "", next: "/lab" },
    { code: "x".repeat(2049), next: "/lab" },
    { code: "fixture-code", error: "access_denied", error_description: "fixture-provider-detail", next: "/lab" },
  ]) {
    callback.reset();
    const url = destination(await callback.GET(request(parameters)));
    assert.equal(url.pathname, "/signin");
    assert.deepEqual([...url.searchParams], [["error", "expired"], ["next", "/lab"]]);
    assert.equal(callback.state.clients, 0);
    assert.deepEqual(callback.state.calls, []);
    assert.deepEqual(callback.state.writes, []);
  }
});

test("successful exchanges cannot redirect outside the app or back into auth routes", async () => {
  for (const next of ["//untrusted.example", "https://untrusted.example", "/signin", "/auth/callback?code=other"]) {
    callback.reset();
    assert.equal(destination(await callback.GET(request({ code: "fixture-code", next }))).href, `${origin}/`);
  }
});

test("remember=false remains session-only through callback exchange and later server-client refresh writes", async () => {
  callback.state.cookie.set(SESSION_PREFERENCE_COOKIE, "session");
  const response = await callback.GET(request());
  assert.equal(destination(response).pathname, "/lab");
  const cookie = callback.state.writes.find(value => value.name === sessionCookie);
  assert.ok(cookie); assert.equal(Object.hasOwn(cookie.options, "maxAge"), false); assert.equal(Object.hasOwn(cookie.options, "expires"), false);
  assert.equal(cookie.options.httpOnly, true); assert.equal(cookie.options.secure, true);
  callback.state.writes = []; callback.state.refresh = true;
  assert.equal((await callback.authenticatedUser()).id, "email-owner");
  assert.equal(callback.state.writes.length, 1, "the new request exercises a refreshed-cookie write through the shared adapter");
  assert.equal(Object.hasOwn(callback.state.writes[0].options, "maxAge"), false);
  assert.equal(Object.hasOwn(callback.state.writes[0].options, "expires"), false);
});

test("a signed recovery intent and matching confirmed email exchange into short-lived owner-bound password setup", async () => {
  callback.state.cookie.set(PASSWORD_RECOVERY_COOKIE, passwordRecoveryToken("person@example.org", secret));
  const response = await callback.GET(request({ code: "fixture-code", intent: "recovery", next: "/lab?lang=ar" }));
  const target = destination(response); assert.equal(target.pathname, "/signin"); assert.equal(target.searchParams.get("next"), "/lab?lang=ar"); assert.equal(target.searchParams.has("error"), false);
  assert.equal(callback.state.cookie.has(PASSWORD_RECOVERY_COOKIE), false);
  const ticket = callback.state.writes.find(cookie => cookie.name === PASSWORD_SETUP_COOKIE);
  assert.ok(ticket); assert.equal(validPasswordSetup(ticket.value, "email-owner", secret), true); assert.equal(ticket.options.maxAge, 900); assert.equal(ticket.options.httpOnly, true); assert.equal(ticket.options.secure, true);
  assert.equal(callback.state.cookie.get(sessionCookie), "fixture-session");
  assert.deepEqual(callback.state.calls.map(call => call.name), ["getUser", "exchangeCodeForSession", "getUser"]);
});

test("a query parameter alone, forged marker, or expired marker cannot authorize recovery or exchange a code", async () => {
  for (const marker of [undefined, `${passwordRecoveryToken("person@example.org", secret)}tampered`, passwordRecoveryToken("person@example.org", secret, Date.now() - 900001)]) {
    callback.reset(); if (marker) callback.state.cookie.set(PASSWORD_RECOVERY_COOKIE, marker);
    const response = await callback.GET(request({ code: "fixture-code", intent: "recovery", next: "/" }));
    assert.equal(destination(response).searchParams.get("error"), "expired");
    assert.equal(callback.state.clients, 0); assert.equal(callback.state.cookie.has(PASSWORD_SETUP_COOKIE), false); assert.deepEqual(callback.state.writes, []);
  }
});

test("wrong-email, unconfirmed and anonymous recovery results do not commit staged sessions or password authorization", async () => {
  for (const user of [
    { id: "wrong-owner", email: "other@example.org", email_confirmed_at: "2026-01-01", is_anonymous: false },
    { id: "email-owner", email: "person@example.org", is_anonymous: false },
    { id: "guest-owner", email: "person@example.org", email_confirmed_at: "2026-01-01", is_anonymous: true },
    null,
  ]) {
    callback.reset(); callback.state.user = user;
    callback.state.cookie.set(PASSWORD_RECOVERY_COOKIE, passwordRecoveryToken("person@example.org", secret));
    const before = [...callback.state.cookie];
    const response = await callback.GET(request({ code: "fixture-code", intent: "recovery", next: "/lab" }));
    assert.equal(destination(response).searchParams.get("error"), "expired");
    assert.deepEqual([...callback.state.cookie], before); assert.deepEqual(callback.state.writes, []);
  }
});

test("recovery cannot overwrite a guest or a different currently authenticated owner", async () => {
  for (const priorUser of [
    { id: "guest-owner", is_anonymous: true },
    { id: "other-owner", email: "other@example.org", is_anonymous: false },
  ]) {
    callback.reset(); callback.state.priorUser = priorUser;
    callback.state.cookie.set(PASSWORD_RECOVERY_COOKIE, passwordRecoveryToken("person@example.org", secret));
    const response = await callback.GET(request({ code: "fixture-code", intent: "recovery", next: "/" }));
    assert.equal(destination(response).searchParams.get("error"), "expired");
    assert.deepEqual(callback.state.calls.map(call => call.name), ["getUser"]); assert.deepEqual(callback.state.writes, []);
  }
});
