import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { databaseTarget, INTEGRATION_PROJECT_REF, integrationChallenge, integrationProof } from "../lib/integration-attestation.ts";
const key = "unit-test-attestation-key-".repeat(3);
const origin = "http://127.0.0.1:5173";
const nonce = "a".repeat(64);
const env = {
 HESSARA_INTEGRATION_TEST: "true", HESSARA_TEST_ISOLATED: "true", HESSARA_TEST_PROJECT_REF: INTEGRATION_PROJECT_REF,
 HESSARA_SITE_URL: origin, HESSARA_TEST_URL: origin, NEXT_PUBLIC_SUPABASE_URL: `https://${INTEGRATION_PROJECT_REF}.supabase.co`,
 DATABASE_URL: `postgresql://hessara_runtime:unit-test-password@db.${INTEGRATION_PROJECT_REF}.supabase.co:5432/postgres`, HESSARA_TEST_ATTESTATION_KEY: key,
};
function request(url = `${origin}/api/health`, signature = createHmac("sha256", key).update(`hessara-integration-request-v1\n${nonce}\n${origin}\n${INTEGRATION_PROJECT_REF}`).digest("hex")) {
 return new Request(url, { headers: { "x-hessara-test-nonce": nonce, "x-hessara-test-auth": signature } });
}
const identity = { role: "hessara_runtime", session_role: "hessara_runtime", database: "postgres" };
test("integration proof authenticates exact approved runtime target and fresh nonce", () => {
 const challenge = integrationChallenge(request(), env); assert.ok(challenge);
 const issuedAt = new Date("2026-10-26T12:00:00.000Z");
 const proof = integrationProof(challenge, databaseTarget(env.DATABASE_URL), identity, true, env, issuedAt); assert.ok(proof);
 assert.equal(proof.proof, createHmac("sha256", key).update(`hessara-integration-response-v1\n${nonce}\n${origin}\n${INTEGRATION_PROJECT_REF}\n${issuedAt.toISOString()}`).digest("hex"));
 assert.equal(JSON.stringify(proof).includes("password"), false); assert.equal(JSON.stringify(proof).includes(key), false);
});
test("ordinary public health requests and invalid signatures obtain no attestation", () => {
 assert.equal(integrationChallenge(new Request(`${origin}/api/health`), env), null);
 for (const signature of ["bad", "0".repeat(64), "G".repeat(64)]) assert.equal(integrationChallenge(request(undefined, signature), env), null);
});
test("integration gate rejects hosted deployments, disabled isolation and unapproved project refs", () => {
 for (const change of [{VERCEL:"1"},{HESSARA_INTEGRATION_TEST:"false"},{HESSARA_TEST_ISOLATED:"false"},{HESSARA_TEST_PROJECT_REF:"waaaxdjymuauknbcxskn"},{HESSARA_TEST_ATTESTATION_KEY:"short"}]) assert.equal(integrationChallenge(request(), {...env,...change}), null);
});
test("integration gate binds loopback URL, site origin and server Supabase target", () => {
 for (const url of ["https://example.com/api/health",`${origin}/api/health?target=test`,`${origin}/api/health#hash`,"http://localhost:5173/api/health"]) assert.equal(integrationChallenge(request(url), env), null);
 for (const change of [{HESSARA_SITE_URL:"https://example.com"},{NEXT_PUBLIC_SUPABASE_URL:"https://waaaxdjymuauknbcxskn.supabase.co"},{HESSARA_TEST_URL:"http://localhost:5173"}]) assert.equal(integrationChallenge(request(), {...env,...change}), null);
});
test("database target accepts approved Supavisor transaction pooler without guessing its hostname", () => {
 const DATABASE_URL = `postgresql://hessara_runtime.${INTEGRATION_PROJECT_REF}:unit-test-password@aws-0-eu-central-1.pooler.supabase.com:6543/postgres`;
 assert.ok(integrationChallenge(request(), {...env,DATABASE_URL}));
});
test("database target rejects admin credentials, production, spoofed host, invalid database and missing password", () => {
 const invalid = [env.DATABASE_URL.replace("hessara_runtime:","postgres:"),env.DATABASE_URL.replace(INTEGRATION_PROJECT_REF,"waaaxdjymuauknbcxskn"),env.DATABASE_URL.replace(".supabase.co", ".supabase.co.evil.example"),env.DATABASE_URL.replace("/postgres","/other"),env.DATABASE_URL.replace(":unit-test-password", ""),env.DATABASE_URL+"?sslmode=disable"];
 for (const DATABASE_URL of invalid) assert.equal(integrationChallenge(request(), {...env,DATABASE_URL}),null);
});
test("proof rejects stale cached pools, Google-only readiness, and privileged database sessions", () => {
 const challenge=integrationChallenge(request(),env); assert.ok(challenge); const target=databaseTarget(env.DATABASE_URL);
 assert.equal(integrationProof(challenge,undefined,identity,true,env),null);
 assert.equal(integrationProof(challenge,{...target,host:"db.waaaxdjymuauknbcxskn.supabase.co"},identity,true,env),null);
 assert.equal(integrationProof(challenge,target,identity,false,env),null);
 for (const change of [{role:"postgres"},{session_role:"postgres"},{database:"other"}]) assert.equal(integrationProof(challenge,target,{...identity,...change},true,env),null);
});
