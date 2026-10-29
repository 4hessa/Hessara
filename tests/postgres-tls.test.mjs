import test from "node:test";
import assert from "node:assert/strict";
import { createSecureContext, rootCertificates } from "node:tls";
import postgres from "postgres";
import { databaseTls } from "../lib/postgres-tls.mjs";

test("database TLS accepts verified CA bundles without allowing URL downgrades", async () => {
  const pem = rootCertificates[0].trim();
  for (const value of [pem, pem.replace(/\n/g, "\\n"), pem.replace(/\n/g, "\r\n"), pem.replace(/\n/g, "\\r\\n")]) {
    const options = databaseTls("postgresql://runtime:dummy@database.example/postgres", value);
    assert.equal(options.rejectUnauthorized, true);
    assert.equal(options.ca, pem);
    assert.doesNotThrow(() => createSecureContext(options), "Node TLS must accept the parsed certificate");
    const client = postgres("postgresql://runtime:dummy@database.example/postgres?sslmode=disable", { ssl: options });
    try {
      assert.equal(client.options.ssl.rejectUnauthorized, true, "URL parameters must not disable verification");
      assert.equal(client.options.ssl.ca, pem);
    } finally { await client.end(); }
  }
  const bundle = `${pem}\n${rootCertificates[1].trim()}`;
  assert.doesNotThrow(() => createSecureContext(databaseTls("postgresql://database.example/postgres", bundle)));
});

test("database TLS rejects malformed CA input without echoing it and requires remote verification", () => {
  for (const value of ["not-a-certificate", "-----BEGIN CERTIFICATE-----\ninvalid\n-----END CERTIFICATE-----", "-----BEGIN PRIVATE KEY-----\nprivate-material\n-----END PRIVATE KEY-----", `${rootCertificates[0]}\nunexpected-content`]) {
    assert.throws(() => databaseTls("postgresql://database.example/postgres", value), {
      message: "DATABASE_SSL_CA must contain valid PEM CA certificates",
    });
  }
  for (const hostname of ["database.example", "localhost.example", "127.0.0.1.example"]) {
    for (const value of ["", "   "]) {
      assert.deepEqual(databaseTls(`postgresql://${hostname}/postgres`, value), { rejectUnauthorized: true });
    }
  }
  for (const hostname of ["localhost", "127.0.0.1", "[::1]"]) {
    assert.equal(databaseTls(`postgresql://${hostname}/postgres`, ""), false);
  }
});
