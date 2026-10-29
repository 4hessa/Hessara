type Environment = Record<string, string | undefined>;
export type AuthMutationIssue = "database_missing" | "database_invalid" | "encryption_key_missing" | "encryption_key_invalid";

/** Configuration prerequisites for durable, rate-limited auth writes.
 * This does not claim that a database or external provider passed a live test.
 * Reading an existing session and signing out deliberately do not use this gate.
 */
export function authMutationReadiness(env: Environment = process.env) {
  const issues: AuthMutationIssue[] = [];
  const connection = env.DATABASE_URL || env.POSTGRES_URL;
  if (!connection) issues.push("database_missing");
  else {
    try {
      const url = new URL(connection);
      if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname) issues.push("database_invalid");
    } catch { issues.push("database_invalid"); }
  }
  const key = env.HESSARA_ENCRYPTION_KEY;
  if (!key) issues.push("encryption_key_missing");
  else {
    try { if (atob(key).length !== 32) issues.push("encryption_key_invalid"); }
    catch { issues.push("encryption_key_invalid"); }
  }
  return { configured: issues.length === 0, issues };
}
