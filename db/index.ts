import { drizzle } from "drizzle-orm/postgres-js";
import { postgresConnection } from "../lib/postgres-database";
import * as schema from "./schema";

export function getDb() {
  return drizzle(postgresConnection(), { schema });
}
