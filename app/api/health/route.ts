import { authConfigured } from "@/lib/auth";
import { database, postgresConnectionTarget } from "@/lib/postgres-database";
import { vaultReady } from "@/lib/vault";
import { loadSignInAvailability } from "@/lib/signin-config";
import { integrationChallenge, integrationProof } from "@/lib/integration-attestation";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  let storage = false;
  try { await database().prepare("SELECT id FROM runs LIMIT 0").all(); storage = true; } catch {}
  const availability = await loadSignInAvailability();
  const ready = storage && await authConfigured(request.headers) && vaultReady() && (availability.password || availability.email || availability.providers.google);
  let integration = null;
  const challenge = integrationChallenge(request);
  if (ready && challenge) {
    try {
      const identity = await database().prepare("SELECT current_user AS role, session_user AS session_role, current_database() AS database").first<{ role: string; session_role: string; database: string }>();
      if (identity) integration = integrationProof(challenge, postgresConnectionTarget(), identity, availability.password);
    } catch { /* Missing proof blocks the integration harness before any sign-in. */ }
  }
  return Response.json({ status: ready ? "ready" : "setup_required", ...(integration ? { integration } : {}) }, { status: ready ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
