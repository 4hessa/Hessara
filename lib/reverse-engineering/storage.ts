import "server-only";
import { createClient } from "@supabase/supabase-js";
import { ArtifactError, boundedBytes, inspectArtifact } from "./content";

export const ARTIFACT_BUCKET = "hessara-re-artifacts";
export function configuredUploadLimit() {
  const configured = Number(process.env.HESSARA_RE_MAX_UPLOAD_BYTES || 50 * 1024 * 1024);
  return Number.isSafeInteger(configured) && configured >= 1024 ? Math.min(configured, 100 * 1024 * 1024) : 50 * 1024 * 1024;
}
function storage(deadline = AbortSignal.timeout(25000)) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_AUTH_SECRET_KEY;
  if (!url || !key || !/^https:\/\/[a-z0-9]+\.supabase\.co\/?$/.test(url)) throw new ArtifactError("STORAGE_NOT_CONFIGURED", 503);
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: (input, options) => fetch(input, { ...options, signal: deadline, redirect: "error", cache: "no-store" }) } }).storage;
}
export async function storageHealth() {
  const { data, error } = await storage().getBucket(ARTIFACT_BUCKET);
  if (error || !data || data.public) throw new ArtifactError("PRIVATE_STORAGE_UNAVAILABLE", 503);
  const bucketLimit = Number(data.file_size_limit);
  return { available: true, bucket: ARTIFACT_BUCKET, maxUploadBytes: Math.min(configuredUploadLimit(), bucketLimit > 0 ? bucketLimit : configuredUploadLimit()), malwareScanning: "unavailable" };
}
function checkStorageKey(key: string, owner?: string) {
  if (!/^[a-f0-9-]{36}\/[a-f0-9-]{36}\/[a-f0-9-]{36}$/.test(key) || owner && !key.startsWith(owner + "/")) throw new ArtifactError("NOT_FOUND", 404);
}
export async function signArtifactUpload(owner: string, key: string) {
  checkStorageKey(key, owner);
  const { data, error } = await storage().from(ARTIFACT_BUCKET).createSignedUploadUrl(key, { upsert: false });
  if (error || !data) throw new ArtifactError("STORAGE_UNAVAILABLE", 503);
  return { url: data.signedUrl, token: data.token, path: data.path, bucket: ARTIFACT_BUCKET, method: "PUT", headers: { "content-type": "application/octet-stream", "x-upsert": "false" }, expiresInSeconds: 7200 };
}
export async function verifyStoredArtifact(owner: string, artifact: { storageKey: string; sizeBytes: number; name: string }) {
  checkStorageKey(artifact.storageKey, owner);
  const deadline = AbortSignal.timeout(30000);
  const client = storage(deadline).from(ARTIFACT_BUCKET);
  const info = await client.info(artifact.storageKey);
  if (info.error || !info.data) throw new ArtifactError("UPLOAD_NOT_FOUND", 409);
  const size = Number(info.data.size);
  if (size !== artifact.sizeBytes || size > configuredUploadLimit()) throw new ArtifactError("ARTIFACT_SIZE_MISMATCH", 413);
  const { data, error } = await client.createSignedUrl(artifact.storageKey, 60);
  if (error || !data) throw new ArtifactError("STORAGE_UNAVAILABLE", 503);
  const bytes = await boundedBytes(await fetch(data.signedUrl, { signal: deadline, redirect: "error", cache: "no-store" }), artifact.sizeBytes);
  if (bytes.length !== artifact.sizeBytes) throw new ArtifactError("ARTIFACT_SIZE_MISMATCH", 409);
  return { ...inspectArtifact(bytes, artifact.name), scanStatus: "unavailable" as const };
}
/** Only the trusted supervisor receives this short-lived capability after lease ownership checks. */
export async function signWorkerArtifact(key: string) {
  checkStorageKey(key);
  const { data, error } = await storage().from(ARTIFACT_BUCKET).createSignedUrl(key, 60);
  if (error || !data) throw new ArtifactError("STORAGE_UNAVAILABLE", 503);
  return data.signedUrl;
}
export async function removeStoredArtifact(owner: string, key: string) {
  checkStorageKey(key, owner);
  const { error } = await storage().from(ARTIFACT_BUCKET).remove([key]);
  if (error) throw new ArtifactError("STORAGE_UNAVAILABLE", 503);
}
