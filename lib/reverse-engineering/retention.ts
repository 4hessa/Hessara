import "server-only";
import { database } from "../postgres-database";
import { removeStoredArtifact } from "./storage";

/** One bounded sweep, used by authenticated worker maintenance or daily Cron.
 * Object deletion happens before its DB receipt; a retry is safe and idempotent.
 */
export async function maintainRetention() {
  const db = database(), now = Date.now();
  const results = await db.batch([
    db.prepare("SELECT set_config('hessara.re_worker','true',true)"),
    db.prepare(`SELECT a.id,a.owner,a.storage_key FROM re_artifacts a JOIN re_projects p ON p.id=a.project_id AND p.owner=a.owner
      WHERE a.status<>'purged' AND (a.error_code='RETENTION_PENDING' OR a.retention_until<? OR (a.sha256 IS NULL AND a.created_at<?) OR (p.deleted_at IS NOT NULL AND p.retention_until<?))
      AND a.validation_until<? AND NOT EXISTS(SELECT 1 FROM re_jobs j WHERE j.artifact_id=a.id AND j.status IN ('queued','validating','running')) ORDER BY a.retention_until LIMIT 20`).bind(now, now - 10800000, now, now),
  ]);
  let purged = 0, failed = 0;
  for (const row of results[1].results) {
    try {
      const claimed = await db.batch([
        db.prepare("SELECT set_config('hessara.re_worker','true',true)"),
        db.prepare(`UPDATE re_artifacts a SET status='deleted',error_code='RETENTION_PENDING' WHERE id=? AND owner=?
          AND (error_code='RETENTION_PENDING' OR retention_until<? OR (sha256 IS NULL AND created_at<?) OR EXISTS(SELECT 1 FROM re_projects p WHERE p.id=a.project_id AND p.deleted_at IS NOT NULL AND p.retention_until<?))
          AND validation_until<? AND NOT EXISTS(SELECT 1 FROM re_jobs WHERE artifact_id=a.id AND status IN ('queued','validating','running')) RETURNING id`).bind(row.id, row.owner, now, now - 10800000, now, now),
      ]);
      if (!claimed[1].results.length) continue;
      await removeStoredArtifact(String(row.owner), String(row.storage_key));
      await db.batch([
        db.prepare("SELECT set_config('hessara.re_worker','true',true)"),
        db.prepare("UPDATE re_artifacts SET status='purged',name='Expired artifact',metadata='{}'::jsonb WHERE id=? AND owner=? AND NOT EXISTS(SELECT 1 FROM re_jobs WHERE artifact_id=? AND status IN ('queued','validating','running'))").bind(row.id, row.owner, row.id),
        db.prepare("DELETE FROM re_evidence WHERE job_id IN (SELECT id FROM re_jobs WHERE artifact_id=? AND owner=?) AND kind IN ('code','log')").bind(row.id, row.owner),
        db.prepare("INSERT INTO re_audit(id,owner,action,entity_id,details,created_at) VALUES(?,?,'artifact.purged',?,'{}'::jsonb,?)").bind(crypto.randomUUID(), row.owner, row.id, now),
      ]);
      purged++;
    } catch (error) { failed++; console.error("RE retention retry required", error instanceof Error ? error.name : "unknown"); }
  }
  // Deleted projects retain recoverable data for the configured interval. After
  // that interval remove analysis content, retaining only opaque audit records.
  await db.batch([
    db.prepare("SELECT set_config('hessara.re_worker','true',true)"),
    ...["re_reports", "re_findings", "re_evidence"].map(table => db.prepare(`DELETE FROM ${table} WHERE job_id IN (SELECT j.id FROM re_jobs j JOIN re_projects p ON p.id=j.project_id AND p.owner=j.owner WHERE p.deleted_at IS NOT NULL AND p.retention_until<? AND j.status NOT IN ('queued','validating','running') AND EXISTS(SELECT 1 FROM ${table} child WHERE child.job_id=j.id) ORDER BY j.id LIMIT 20)`).bind(now)),
  ]);
  return { purged, failed, batchLimit: 20 };
}
