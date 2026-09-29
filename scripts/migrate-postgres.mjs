import fs from "node:fs/promises";
import postgres from "postgres";

const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!url) throw new Error("Set DATABASE_URL before applying migrations.");
const local = ["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname);
const sql = postgres(url, { max: 1, max_pipeline: 1, prepare: false, ssl: local ? false : { rejectUnauthorized: true } });
try {
  const migration = await fs.readFile(new URL("../supabase/migrations/202609290001_hessara.sql", import.meta.url), "utf8");
  await sql.begin(async tx => {
    await tx`SELECT pg_advisory_xact_lock(682629001)`;
    await tx.unsafe(migration);
  });
  console.log("Hessara PostgreSQL schema is ready.");
} finally { await sql.end(); }
