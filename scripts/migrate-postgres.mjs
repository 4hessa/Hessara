import fs from "node:fs/promises";
import postgres from "postgres";
import { databaseTls } from "../lib/postgres-tls.mjs";

const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!url) throw new Error("Set DATABASE_URL before applying migrations.");
const sql = postgres(url, { max: 1, max_pipeline: 1, prepare: false, ssl: databaseTls(url) });
try {
  const migration = await fs.readFile(new URL("../supabase/migrations/202609290001_hessara.sql", import.meta.url), "utf8");
  await sql.begin(async tx => {
    await tx`SELECT pg_advisory_xact_lock(682629001)`;
    await tx.unsafe(migration);
  });
  console.log("Base Hessara schema applied only. Apply runtime-role.sql and the remaining ordered migrations as an administrator; see docs/VERCEL.md.");
} finally { await sql.end(); }
