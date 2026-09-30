import { authConfigured } from "@/lib/auth";
import { database } from "@/lib/postgres-database";
import { vaultReady } from "@/lib/vault";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  let storage = false;
  try { await database().prepare("SELECT id FROM runs LIMIT 0").all(); storage = true; } catch {}
  const ready = storage && await authConfigured(request.headers) && vaultReady() && (process.env.HESSARA_ALLOW_GUESTS === "true" || process.env.HESSARA_EMAIL_AUTH_ENABLED === "true");
  return Response.json({ status: ready ? "ready" : "setup_required" }, { status: ready ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
