import { createHmac, timingSafeEqual } from "node:crypto";

type Environment = Record<string, string | undefined>;
export type DatabaseTarget = Readonly<{ host: string; port: string; user: string; database: string }>;
export const INTEGRATION_PROJECT_REF = "lmhnyqtcfvgrcygsgqjg";
const loopback = new Set(["localhost", "127.0.0.1", "[::1]"]);
const digest = (key: string, value: string) => createHmac("sha256", key).update(value).digest("hex");
function matches(actual: string | null, expected: string) {
  return !!actual && /^[a-f0-9]{64}$/.test(actual) && timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"));
}
export function databaseTarget(url: string): DatabaseTarget {
  const parsed = new URL(url);
  return Object.freeze({ host: parsed.hostname, port: parsed.port || "5432", user: decodeURIComponent(parsed.username), database: parsed.pathname.slice(1) });
}
function approvedDatabase(url: string) {
  const parsed = new URL(url);
  const target = databaseTarget(url);
  const direct = target.host === `db.${INTEGRATION_PROJECT_REF}.supabase.co` && target.port === "5432" && target.user === "hessara_runtime";
  const pooled = /^[a-z0-9-]+\.pooler\.supabase\.com$/.test(target.host) && target.port === "6543" && target.user === `hessara_runtime.${INTEGRATION_PROJECT_REF}`;
  return ["postgres:", "postgresql:"].includes(parsed.protocol) && !!parsed.password && !parsed.search && !parsed.hash && target.database === "postgres" && (direct || pooled);
}
export function integrationChallenge(request: Request, env: Environment = process.env) {
  try {
    if (env.HESSARA_INTEGRATION_TEST !== "true" || env.VERCEL || env.HESSARA_TEST_ISOLATED !== "true" || env.HESSARA_TEST_PROJECT_REF !== INTEGRATION_PROJECT_REF) return null;
    const url = new URL(request.url);
    if (!loopback.has(url.hostname) || url.protocol !== "http:" || url.username || url.password || url.pathname !== "/api/health" || url.search || url.hash) return null;
    if (env.HESSARA_SITE_URL !== url.origin || env.HESSARA_TEST_URL !== url.origin) return null;
    if (env.NEXT_PUBLIC_SUPABASE_URL !== `https://${INTEGRATION_PROJECT_REF}.supabase.co`) return null;
    const databaseUrl = env.DATABASE_URL || env.POSTGRES_URL || "";
    if (!approvedDatabase(databaseUrl)) return null;
    const key = env.HESSARA_TEST_ATTESTATION_KEY;
    const nonce = request.headers.get("x-hessara-test-nonce");
    if (!key || key.length < 32 || !nonce || !/^[a-f0-9]{64}$/.test(nonce)) return null;
    const origin = url.origin;
    if (!matches(request.headers.get("x-hessara-test-auth"), digest(key, `hessara-integration-request-v1\n${nonce}\n${origin}\n${INTEGRATION_PROJECT_REF}`))) return null;
    return { nonce, origin, projectRef: INTEGRATION_PROJECT_REF, target: databaseTarget(databaseUrl) };
  } catch { return null; }
}
export function integrationProof(
  challenge: NonNullable<ReturnType<typeof integrationChallenge>>,
  connectionTarget: DatabaseTarget | undefined,
  identity: { role: string; session_role: string; database: string },
  passwordReady: boolean,
  env: Environment = process.env,
  now = new Date(),
) {
  if (!passwordReady || !connectionTarget || identity.role !== "hessara_runtime" || identity.session_role !== "hessara_runtime" || identity.database !== "postgres") return null;
  if ((Object.keys(challenge.target) as (keyof DatabaseTarget)[]).some(key => challenge.target[key] !== connectionTarget[key])) return null;
  const key = env.HESSARA_TEST_ATTESTATION_KEY;
  if (!key || key.length < 32) return null;
  const issuedAt = now.toISOString();
  const { nonce, origin, projectRef } = challenge;
  return { version: 1, nonce, origin, projectRef, issuedAt, proof: digest(key, `hessara-integration-response-v1\n${nonce}\n${origin}\n${projectRef}\n${issuedAt}`) };
}
