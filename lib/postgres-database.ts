import postgres from "postgres";
import { databaseTls } from "./postgres-tls.mjs";

type Value = string | number | boolean | null;
type Row = Record<string, unknown>;
type Result = { rows: Row[]; count: number };
export type QueryExecutor = (query: string, values: Value[]) => Promise<Result>;
export type TransactionExecutor = <T>(work: (query: QueryExecutor) => Promise<T>) => Promise<T>;

// Values remain separate from SQL. Only positional placeholders are translated.
export function parameters(query: string) {
  let index = 0;
  const sql = query.replace(/'(?:''|[^'])*'|"(?:""|[^"])*"|--[^\n]*|\/\*[\s\S]*?\*\/|\?/g,
    (part) => part === "?" ? `$${++index}` : part);
  return { sql, count: index };
}

export class Statement {
  private query: QueryExecutor;
  readonly sql: string;
  readonly values: Value[];
  constructor(query: QueryExecutor, sql: string, values: Value[] = []) {
    this.query = query;
    this.sql = sql;
    this.values = values;
  }
  bind(...values: unknown[]) {
    if (values.some((v) => v !== null && !["string", "number", "boolean"].includes(typeof v))) {
      throw new TypeError("Invalid database parameter");
    }
    if (values.some((v) => typeof v === "number" && !Number.isFinite(v))) throw new TypeError("Invalid number");
    return new Statement(this.query, this.sql, values as Value[]);
  }
  async execute(executor = this.query) {
    const prepared = parameters(this.sql);
    if (prepared.count !== this.values.length) throw new Error("Database parameter count mismatch");
    return executor(prepared.sql, this.values);
  }
  async first<T = Row>(): Promise<T | null> {
    return ((await this.execute()).rows[0] as T | undefined) ?? null;
  }
  async all<T = Row>() {
    const result = await this.execute();
    return { results: result.rows as T[], meta: { changes: result.count } };
  }
  async run() { return { meta: { changes: (await this.execute()).count } }; }
}

export function createDatabase(query: QueryExecutor, transaction: TransactionExecutor) {
  const executeBatch = async (statements: Statement[], execute: QueryExecutor) => {
    const results = [];
    for (const statement of statements) {
      const result = await statement.execute(execute);
      results.push({ results: result.rows, meta: { changes: result.count } });
    }
    return results;
  };
  return {
    prepare: (sql: string) => new Statement(query, sql),
    batch: (statements: Statement[]) => transaction(execute => executeBatch(statements, execute)),
    ownerQuotaBatch: (owner: string, statements: Statement[]) => transaction(async (execute) => {
      // Separate statements matter: each quota check must see rows committed while waiting.
      await execute("SET TRANSACTION ISOLATION LEVEL READ COMMITTED", []);
      await execute("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`hessara-owner-quota:${owner}`]);
      return executeBatch(statements, execute);
    }),
  };
}

let connection: ReturnType<typeof postgres> | undefined;
export function postgresConnection() {
  if (connection) return connection;
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) throw new Error("Database is not configured");
  // postgres.js supports max_pipeline at runtime; it is absent from its current type declarations.
  const options = {
    max: 1, max_pipeline: 1, prepare: false,
    ssl: databaseTls(url),
    connect_timeout: 10, idle_timeout: 20, max_lifetime: 300,
    types: {
      safeInt8: {
        to: 20, from: [20], serialize: String,
        parse: (value: string) => {
          const n = Number(value);
          if (!Number.isSafeInteger(n)) throw new RangeError("Integer out of range");
          return n;
        },
      },
    },
  };
  connection = postgres(url, options);
  return connection;
}

export function database() {
  const sql = postgresConnection();
  const query: QueryExecutor = async (text, values) => {
    const rows = await sql.unsafe(text, values);
    return { rows: [...rows] as Row[], count: rows.count };
  };
  return createDatabase(query, (work) => sql.begin(async (tx) => work(async (text, values) => {
    const rows = await tx.unsafe(text, values);
    return { rows: [...rows] as Row[], count: rows.count };
  })) as ReturnType<typeof work>);
}
