// PostgreSQL schema for the Vercel deployment. RLS and grants live in supabase/migrations.
import {
  pgTable,
  text,
  integer,
  bigint,
  doublePrecision as real,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
export const runs = pgTable(
  "runs",
  {
    id: text("id").primaryKey(),
    owner: text("owner").notNull(),
    name: text("name").notNull(),
    mode: text("mode").notNull(),
    status: text("status").notNull(),
    createdAt: text("created_at").notNull(),
    config: text("config").notNull(),
    total: integer("total").notNull(),
    nextIndex: integer("next_index").notNull().default(0),
    lockToken: text("lock_token"),
    lockedUntil: bigint("locked_until", { mode: "number" }).notNull().default(0),
  },
  (t) => [index("idx_runs_owner_created").on(t.owner, t.createdAt)],
);
export const trials = pgTable(
  "trials",
  {
    rowid: bigint("rowid", { mode: "number" }).generatedAlwaysAsIdentity(),
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => runs.id),
    model: text("model").notNull(),
    taskId: text("task_id").notNull(),
    repeat: integer("repeat").notNull(),
    status: text("status").notNull(),
    score: real("score"),
    output: text("output"),
    latency: real("latency"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    cost: real("cost"),
    error: text("error"),
    metadata: text("metadata"),
  },
  (t) => [
    uniqueIndex("idx_trials_run_model_task_repeat").on(
      t.runId,
      t.model,
      t.taskId,
      t.repeat,
    ),
  ],
);
export const modelProfiles = pgTable(
  "model_profiles",
  {
    id: text("id").primaryKey(),
    owner: text("owner").notNull(),
    name: text("name").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    keyCipher: text("key_cipher").notNull(),
    inputPrice: real("input_price"),
    outputPrice: real("output_price"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("idx_model_profiles_owner").on(t.owner)],
);
export const integrationExports = pgTable(
  "integration_exports",
  {
    id: text("id").primaryKey(),
    owner: text("owner").notNull(),
    runId: text("run_id")
      .notNull()
      .references(() => runs.id),
    destination: text("destination").notNull(),
    status: text("status").notNull(),
    externalId: text("external_id"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("idx_export_run_destination").on(
      t.owner,
      t.runId,
      t.destination,
    ),
  ],
);

export const decisionUsage = pgTable("decision_usage", {
  owner: text("owner").primaryKey(),
  day: text("day").notNull(),
  used: integer("used").notNull().default(0),
});

export const authLimits = pgTable("auth_limits", {
  bucket: text("bucket").primaryKey(),
  expiresAt: bigint("expires_at", { mode: "number" }).notNull(),
  used: integer("used").notNull(),
});
