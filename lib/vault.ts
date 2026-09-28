import { env } from "cloudflare:workers";
const encoder = new TextEncoder();
export function vaultReady() {
  try {
    const value = (env as unknown as Record<string, string>)
      .HESSARA_ENCRYPTION_KEY;
    return !!value && bytes(value).length === 32;
  } catch {
    return false;
  }
}
function bytes(value: string) {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}
function base64(value: Uint8Array) {
  return btoa(String.fromCharCode(...value));
}
async function masterKey() {
  const encoded = (env as unknown as Record<string, string>)
    .HESSARA_ENCRYPTION_KEY;
  if (!encoded || bytes(encoded).length !== 32)
    throw new Error("Vault unavailable");
  return crypto.subtle.importKey("raw", bytes(encoded), "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}
export async function encryptSecret(secret: string, context: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: encoder.encode(context) },
    await masterKey(),
    encoder.encode(secret),
  );
  return "v1." + base64(iv) + "." + base64(new Uint8Array(ciphertext));
}
export async function decryptSecret(value: string, context: string) {
  const [version, iv, cipher] = value.split(".");
  if (version !== "v1") throw new Error("Unknown key version");
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: bytes(iv), additionalData: encoder.encode(context) },
    await masterKey(),
    bytes(cipher),
  );
  return new TextDecoder().decode(plaintext);
}
