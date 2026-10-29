import test from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { databaseJsonType } from "../lib/postgres-json.mjs";

test("real postgres.js JSON handlers preserve pre-serialized arrays and objects", async () => {
  const sql = postgres({ types: { serializedJson: databaseJsonType } });
  try {
    for (const oid of [114, 3802]) {
      const serialize = sql.options.serializers[oid];
      for (const value of [[{ id: "rea", capabilities: ["evidence"] }], { owner: "test", nested: [1, false] }, "Arabic العربية", null, 42]) {
        const input = JSON.stringify(value);
        assert.deepEqual(JSON.parse(serialize(input)), value);
      }
      assert.throws(() => serialize("invalid-secret-content"), { message: "Invalid serialized database JSON" });
    }
    assert.deepEqual(sql.options.parsers[3802]('{"ok":true}'), { ok: true });
  } finally { await sql.end(); }
});
