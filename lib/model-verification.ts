import { createHash } from "node:crypto";
import type { database } from "./postgres-database.ts";
type Database = ReturnType<typeof database>;
export type VerificationConfiguration = { owner: string; fingerprint: string };
export const VERIFICATION_LIFETIME_MS = 15 * 60_000;
export const PLATFORM_VERIFICATION_OWNER = "platform-models";
export const configurationHash = (provider: string, model: string, credential: string) => createHash("sha256").update(JSON.stringify([provider, model, credential])).digest("hex");
export function verificationState(row: Record<string, unknown> | undefined, fingerprint: string, now = Date.now()) {
  const checked = Number(row?.checked_at);
  const matches = row?.fingerprint === fingerprint && Number.isSafeInteger(checked) && checked <= now && now - checked < VERIFICATION_LIFETIME_MS;
  return { ready: matches && row?.success === true, verification: matches ? row?.success ? "verified" as const : "failed" as const : "unverified" as const, verifiedAt: matches ? checked : null };
}
export async function modelConfigurationHash(db: Database, owner: string, id: string, env: Record<string, string | undefined> = process.env) {
  const rows = (await db.scopedBatch(owner, [db.prepare("SELECT provider,model,key_cipher FROM model_profiles WHERE id=? AND owner=?").bind(id, owner)]))[0].results;
  if (rows[0]) return { owner, fingerprint: configurationHash(String(rows[0].provider), String(rows[0].model), String(rows[0].key_cipher)) };
  if (id.startsWith("cf-")) {
    const { CLOUDFLARE_MODELS } = await import("./cloudflare-models.ts");
    const model = CLOUDFLARE_MODELS.find(model => model.id === id);
    if (model && env.HESSARA_INFERENCE_SECRET) return { owner: PLATFORM_VERIFICATION_OWNER, fingerprint: configurationHash("cloudflare", model.model, env.HESSARA_INFERENCE_SECRET) };
  }
  const prefix = id.toUpperCase();
  if (env.HESSARA_SHARED_MODEL_OWNER_ID === owner && env[prefix + "_API_KEY"] && env[prefix + "_MODEL"]) return { owner, fingerprint: configurationHash(id, env[prefix + "_MODEL"]!, env[prefix + "_API_KEY"]!) };
  return null;
}
/** The caller supplies the configuration actually sent to the provider. Never
 * re-read a rotated profile after the response and certify different credentials. */
export async function recordVerification(db: Database, id: string, success: boolean, config: VerificationConfiguration | null) {
  if (!config) return;
  await db.scopedBatch(config.owner, [db.prepare("INSERT INTO model_verifications(owner,model_id,fingerprint,checked_at,success,error_code) VALUES(?,?,?,?,?,?) ON CONFLICT(owner,model_id) DO UPDATE SET fingerprint=excluded.fingerprint,checked_at=excluded.checked_at,success=excluded.success,error_code=excluded.error_code")
    .bind(config.owner, id, config.fingerprint, Date.now(), success, success ? null : "PROVIDER_CHECK_FAILED")]);
}
