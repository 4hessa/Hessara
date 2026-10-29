import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { APPROVED_TEST_PROJECT_REF } from './integration-target.mjs';

// Explicitly reviewed order: later policies require the runtime role to exist.
// A new source migration must be reviewed and added here rather than silently run.
export const DATABASE_BOOTSTRAP_FILES = Object.freeze([
  'supabase/migrations/202609290001_hessara.sql',
  'supabase/runtime-role.sql',
  'supabase/migrations/20261009104943_lab_evaluations.sql',
  'supabase/migrations/20261009161418_lab_reports.sql',
  'supabase/migrations/20261011181222_lab_preferences.sql',
  'supabase/migrations/20261018011133_reverse_engineering_workspace.sql',
  'supabase/migrations/20261018053252_reverse_engineering_intake_closed.sql',
  'supabase/migrations/202610290001_shared_model_verifications_and_assistant_archive.sql',
]);
export const DATABASE_BOOTSTRAP_TABLES = Object.freeze([
  'runs', 'trials', 'model_profiles', 'integration_exports', 'decision_usage', 'auth_limits',
  'lab_reviews', 'lab_judgements', 'lab_reports', 'lab_preferences',
  're_projects', 're_artifacts', 're_engines', 're_settings', 're_workers', 're_jobs',
  're_executions', 're_findings', 're_evidence', 're_reports', 're_usage', 're_audit',
  'model_verifications',
]);

/** Offline metadata only: no database client, dotenv loader, SQL execution, or credential values. */
export async function databaseBootstrapPlan() {
  const steps = [];
  for (const [index, file] of DATABASE_BOOTSTRAP_FILES.entries()) {
    const source = await readFile(new URL('../' + file, import.meta.url));
    steps.push({ order: index + 1, file, purpose: file.endsWith('/runtime-role.sql') ? 'runtime-role' : 'schema-migration', bytes: source.byteLength, sha256: createHash('sha256').update(source).digest('hex') });
  }
  return {
    format: 'hessara-database-bootstrap-plan/1', mode: 'offline-plan', status: 'plan_only',
    databaseConnectionAttempted: false, databaseWrites: false,
    approvedTestProjectRef: APPROVED_TEST_PROJECT_REF,
    steps,
    expectedSchema: { applicationTableCount: DATABASE_BOOTSTRAP_TABLES.length, allTablesRequireRls: true, runtimeRoleHasLogin: false, reverseEngineeringIntakeOpen: false, enabledEngineCount: 0 },
    limitations: [
      'This command prints a plan and never applies SQL or certifies a database connection.',
      'Fresh bootstrap requires schema administrator access to the intended isolated project; application runtime credentials cannot provision the schema.',
      'Existing tables, an existing runtime role, or a migration ledger require review before any application of this plan.',
      'The approved test project was already provisioned through MCP with different ledger versions. Reconcile recorded source hashes and remote history before any CLI migration push; do not replay or auto-adopt it.',
      'Runtime LOGIN/password, confirmed test accounts and live application integration remain separate prerequisites.',
    ],
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 1 || args[0] !== '--plan')) {
    console.error(JSON.stringify({ error: 'UNSUPPORTED_ARGUMENT', usage: 'node scripts/database-bootstrap-plan.mjs [--plan]', databaseWrites: false }));
    process.exitCode = 2;
  } else {
    try { console.log(JSON.stringify(await databaseBootstrapPlan(), null, 2)); }
    catch { console.error(JSON.stringify({ error: 'BOOTSTRAP_PLAN_UNAVAILABLE', databaseWrites: false })); process.exitCode = 1; }
  }
}
