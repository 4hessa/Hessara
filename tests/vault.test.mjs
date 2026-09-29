import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { encryptSecret, decryptSecret, vaultReady } from "../lib/vault.ts";

test("stored credentials require both the encryption key and matching owner/profile context", async () => {
  const previous = process.env.HESSARA_ENCRYPTION_KEY;
  try {
    process.env.HESSARA_ENCRYPTION_KEY = randomBytes(32).toString("base64");
    assert.equal(vaultReady(), true);
    const cipher = await encryptSecret("test-only-key", "alice:profile-a");
    assert.ok(!cipher.includes("test-only-key"));
    assert.equal(await decryptSecret(cipher, "alice:profile-a"), "test-only-key");
    await assert.rejects(decryptSecret(cipher, "bob:profile-a"));
    await assert.rejects(decryptSecret(cipher, "alice:profile-b"));
    process.env.HESSARA_ENCRYPTION_KEY = randomBytes(32).toString("base64");
    await assert.rejects(decryptSecret(cipher, "alice:profile-a"));
  } finally {
    if (previous === undefined) delete process.env.HESSARA_ENCRYPTION_KEY;
    else process.env.HESSARA_ENCRYPTION_KEY = previous;
  }
});
