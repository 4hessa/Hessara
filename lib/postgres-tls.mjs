import { X509Certificate } from "node:crypto";

/**
 * @param {string} url
 * @param {string | undefined} caValue Public PEM CA certificate(s), never a private key.
 * @returns {false | import("node:tls").ConnectionOptions}
 */
export function databaseTls(url, caValue = process.env.DATABASE_SSL_CA) {
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname);
  if (local) return false;
  if (!caValue?.trim()) return { rejectUnauthorized: true };

  // Accept multiline environment values and escaped newlines from .env files.
  const ca = caValue.replace(/\\r\\n/g, "\n").replace(/\\n/g, "\n").replace(/\r\n/g, "\n").trim();
  const certificates = ca.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g);
  try {
    if (!certificates?.length || ca.replace(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g, "").trim()) {
      throw new Error("Invalid PEM");
    }
    for (const pem of certificates) {
      if (!new X509Certificate(pem).ca) throw new Error("Not a CA certificate");
    }
  } catch {
    // Never include environment content or connection credentials in errors.
    throw new Error("DATABASE_SSL_CA must contain valid PEM CA certificates");
  }
  return { rejectUnauthorized: true, ca };
}
