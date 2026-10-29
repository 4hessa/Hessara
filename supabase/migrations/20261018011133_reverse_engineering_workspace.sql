-- Additive migration. Execute with the schema administrator, never from a public RPC.
-- Generated release migration must be copied from this reviewed draft by Supabase CLI.
CREATE TABLE IF NOT EXISTS public.re_projects (
 id text PRIMARY KEY, owner text NOT NULL, name text NOT NULL CHECK(length(name) BETWEEN 1 AND 120),
 description text NOT NULL DEFAULT '' CHECK(length(description)<=2000), created_at bigint NOT NULL,
 updated_at bigint NOT NULL, deleted_at bigint, retention_until bigint, UNIQUE(id,owner)
);
CREATE TABLE IF NOT EXISTS public.re_artifacts (
 id text PRIMARY KEY, owner text NOT NULL, project_id text NOT NULL, name text NOT NULL,
 size_bytes bigint NOT NULL CHECK(size_bytes BETWEEN 1 AND 104857600), reserved_bytes bigint NOT NULL CHECK(reserved_bytes>=size_bytes), storage_key text NOT NULL UNIQUE,
 sha256 text CHECK(sha256 IS NULL OR sha256 ~ '^[a-f0-9]{64}$'), format text,
 status text NOT NULL CHECK(status IN ('reserved','ready','rejected','deleted','purged')),
 scan_status text NOT NULL DEFAULT 'unavailable' CHECK(scan_status IN ('unavailable','pending','clean','rejected')),
 metadata jsonb NOT NULL DEFAULT '{}', created_at bigint NOT NULL, retention_until bigint NOT NULL,
 deleted_at bigint, error_code text, validation_token text, validation_until bigint NOT NULL DEFAULT 0,
 FOREIGN KEY(project_id,owner) REFERENCES public.re_projects(id,owner),
 UNIQUE(id,owner), UNIQUE(id,project_id,owner), CHECK(octet_length(metadata::text)<=65536)
);
CREATE TABLE IF NOT EXISTS public.re_engines (
 id text PRIMARY KEY CHECK(id IN ('rea','ghidra','mobsf','jadx','rizin','angr','radare2')),
 enabled boolean NOT NULL DEFAULT false, updated_at bigint NOT NULL DEFAULT 0, updated_by text,
 failures integer NOT NULL DEFAULT 0, circuit_until bigint NOT NULL DEFAULT 0
);
INSERT INTO public.re_engines(id) VALUES ('rea'),('ghidra'),('mobsf'),('jadx'),('rizin'),('angr'),('radare2') ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS public.re_settings (
 id integer PRIMARY KEY CHECK(id=1), accepting_jobs boolean NOT NULL DEFAULT true,
 max_global_active integer NOT NULL DEFAULT 1 CHECK(max_global_active BETWEEN 1 AND 3),
 max_global_queued integer NOT NULL DEFAULT 20 CHECK(max_global_queued BETWEEN 1 AND 1000),
 max_user_active integer NOT NULL DEFAULT 1 CHECK(max_user_active=1),
 max_user_queued integer NOT NULL DEFAULT 2 CHECK(max_user_queued BETWEEN 1 AND 2),
 max_upload_bytes bigint NOT NULL DEFAULT 52428800 CHECK(max_upload_bytes BETWEEN 1 AND 104857600),
 max_user_storage_bytes bigint NOT NULL DEFAULT 209715200 CHECK(max_user_storage_bytes>=max_upload_bytes),
 max_global_storage_bytes bigint NOT NULL DEFAULT 524288000 CHECK(max_global_storage_bytes>=max_upload_bytes),
 max_projects integer NOT NULL DEFAULT 50 CHECK(max_projects BETWEEN 1 AND 500),
 max_jobs_per_day integer NOT NULL DEFAULT 20 CHECK(max_jobs_per_day BETWEEN 1 AND 500),
 retention_days integer NOT NULL DEFAULT 7 CHECK(retention_days BETWEEN 1 AND 90),
 updated_at bigint NOT NULL DEFAULT 0
);
INSERT INTO public.re_settings(id) VALUES(1) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS public.re_workers (
 id text PRIMARY KEY, engines jsonb NOT NULL, capacity jsonb NOT NULL, heartbeat_at bigint NOT NULL,
 metrics jsonb NOT NULL DEFAULT '{}', CHECK(octet_length(engines::text)<=32768), CHECK(octet_length(capacity::text)<=4096)
);
CREATE TABLE IF NOT EXISTS public.re_jobs (
 id text PRIMARY KEY, owner text NOT NULL, project_id text NOT NULL, artifact_id text NOT NULL,
 engine_id text NOT NULL REFERENCES public.re_engines(id),
 status text NOT NULL CHECK(status IN ('queued','validating','running','completed','failed','cancelled','timed_out')),
 stage text NOT NULL DEFAULT 'queued', options jsonb NOT NULL DEFAULT '{}', priority integer NOT NULL DEFAULT 0 CHECK(priority BETWEEN 0 AND 10),
 created_at bigint NOT NULL, started_at bigint, finished_at bigint, available_at bigint NOT NULL,
 timeout_seconds integer NOT NULL CHECK(timeout_seconds BETWEEN 1 AND 300),
 worker_id text REFERENCES public.re_workers(id), lease_token text, lease_until bigint NOT NULL DEFAULT 0,
 deadline_at bigint, cancel_requested boolean NOT NULL DEFAULT false, attempt integer NOT NULL DEFAULT 0 CHECK(attempt BETWEEN 0 AND 3),
 idempotency_key text NOT NULL, request_hash text NOT NULL, authorization_at bigint NOT NULL,
 error_code text, error_message text, summary text, metadata jsonb NOT NULL DEFAULT '{}',
 FOREIGN KEY(project_id,owner) REFERENCES public.re_projects(id,owner),
 FOREIGN KEY(artifact_id,project_id,owner) REFERENCES public.re_artifacts(id,project_id,owner),
 UNIQUE(owner,idempotency_key), UNIQUE(id,owner), CHECK(octet_length(options::text)<=4096), CHECK(octet_length(metadata::text)<=65536)
);
CREATE TABLE IF NOT EXISTS public.re_executions (
 id text PRIMARY KEY, owner text NOT NULL, job_id text NOT NULL, worker_id text NOT NULL REFERENCES public.re_workers(id),
 attempt integer NOT NULL, started_at bigint NOT NULL, finished_at bigint, status text NOT NULL,
 error_code text, metrics jsonb NOT NULL DEFAULT '{}', FOREIGN KEY(job_id,owner) REFERENCES public.re_jobs(id,owner), UNIQUE(job_id,attempt)
);
CREATE TABLE IF NOT EXISTS public.re_findings (
 id text NOT NULL, owner text NOT NULL, job_id text NOT NULL, title text NOT NULL, description text NOT NULL,
 severity text NOT NULL CHECK(severity IN ('info','low','medium','high','critical')),
 confidence text NOT NULL CHECK(confidence IN ('confirmed','inference','unknown')), category text NOT NULL DEFAULT '', location text NOT NULL DEFAULT '',
 evidence_ids jsonb NOT NULL DEFAULT '[]', created_at bigint NOT NULL, PRIMARY KEY(job_id,id),
 FOREIGN KEY(job_id,owner) REFERENCES public.re_jobs(id,owner), CHECK(length(description)<=16000), CHECK(octet_length(evidence_ids::text)<=65536)
);
CREATE TABLE IF NOT EXISTS public.re_evidence (
 id text NOT NULL, owner text NOT NULL, job_id text NOT NULL,
 kind text NOT NULL CHECK(kind IN ('finding','code','function','symbol','string','dependency','metadata','log','path')),
 name text NOT NULL, content text NOT NULL DEFAULT '', location text NOT NULL DEFAULT '', metadata jsonb NOT NULL DEFAULT '{}',
 storage_key text, created_at bigint NOT NULL, PRIMARY KEY(job_id,id),
 FOREIGN KEY(job_id,owner) REFERENCES public.re_jobs(id,owner), CHECK(octet_length(content)<=65536), CHECK(octet_length(metadata::text)<=65536)
);
CREATE TABLE IF NOT EXISTS public.re_reports (
 id text PRIMARY KEY, owner text NOT NULL, job_id text NOT NULL, format text NOT NULL CHECK(format IN ('json','pdf')),
 storage_key text, sha256 text, size_bytes bigint NOT NULL DEFAULT 0, created_at bigint NOT NULL,
 FOREIGN KEY(job_id,owner) REFERENCES public.re_jobs(id,owner)
);
CREATE TABLE IF NOT EXISTS public.re_usage (
 id text PRIMARY KEY, owner text NOT NULL, job_id text, event text NOT NULL, quantity double precision NOT NULL CHECK(quantity>=0),
 unit text NOT NULL, created_at bigint NOT NULL, FOREIGN KEY(job_id,owner) REFERENCES public.re_jobs(id,owner), UNIQUE(job_id,event)
);
CREATE TABLE IF NOT EXISTS public.re_audit (
 id text PRIMARY KEY, owner text NOT NULL, action text NOT NULL, entity_id text NOT NULL,
 details jsonb NOT NULL DEFAULT '{}', created_at bigint NOT NULL, CHECK(octet_length(details::text)<=8192)
);
CREATE INDEX IF NOT EXISTS re_projects_owner_created ON public.re_projects(owner,created_at DESC);
CREATE INDEX IF NOT EXISTS re_artifacts_owner_project ON public.re_artifacts(owner,project_id,created_at DESC);
CREATE INDEX IF NOT EXISTS re_artifacts_retention ON public.re_artifacts(retention_until) WHERE status<>'purged';
CREATE INDEX IF NOT EXISTS re_jobs_owner_created ON public.re_jobs(owner,created_at DESC);
CREATE INDEX IF NOT EXISTS re_jobs_project ON public.re_jobs(owner,project_id,created_at DESC);
CREATE INDEX IF NOT EXISTS re_jobs_queue ON public.re_jobs(priority DESC,available_at,created_at) WHERE status='queued';
CREATE INDEX IF NOT EXISTS re_jobs_lease ON public.re_jobs(lease_until) WHERE status IN ('validating','running');
CREATE INDEX IF NOT EXISTS re_jobs_engine_status ON public.re_jobs(engine_id,status);
CREATE INDEX IF NOT EXISTS re_evidence_page ON public.re_evidence(owner,job_id,kind,created_at,id);
CREATE INDEX IF NOT EXISTS re_findings_page ON public.re_findings(owner,job_id,created_at,id);
CREATE INDEX IF NOT EXISTS re_reports_owner ON public.re_reports(owner,created_at DESC);
CREATE INDEX IF NOT EXISTS re_usage_owner ON public.re_usage(owner,created_at DESC);
CREATE INDEX IF NOT EXISTS re_audit_owner ON public.re_audit(owner,created_at DESC);
DO $policy$
DECLARE table_name text;
BEGIN
 FOREACH table_name IN ARRAY ARRAY['re_projects','re_artifacts','re_jobs','re_executions','re_findings','re_evidence','re_reports','re_usage','re_audit'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',table_name);
  EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',table_name);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',table_name);
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='hessara_runtime') THEN
   EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON public.%I TO hessara_runtime',table_name);
   IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=table_name AND policyname='re_owner_scope') THEN
    EXECUTE format('CREATE POLICY re_owner_scope ON public.%I FOR ALL TO hessara_runtime USING (owner=nullif(current_setting(''hessara.owner'',true),'''') OR current_setting(''hessara.re_worker'',true)=''true'') WITH CHECK (owner=nullif(current_setting(''hessara.owner'',true),'''') OR current_setting(''hessara.re_worker'',true)=''true'')',table_name);
   END IF;
  END IF;
 END LOOP;
 FOREACH table_name IN ARRAY ARRAY['re_engines','re_workers','re_settings'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',table_name);
  EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',table_name);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',table_name);
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='hessara_runtime') THEN
   EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON public.%I TO hessara_runtime',table_name);
   IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=table_name AND policyname='re_runtime_read') THEN
    EXECUTE format('CREATE POLICY re_runtime_read ON public.%I FOR SELECT TO hessara_runtime USING (true)',table_name);
    EXECUTE format('CREATE POLICY re_worker_write ON public.%I FOR ALL TO hessara_runtime USING (current_setting(''hessara.re_worker'',true)=''true'') WITH CHECK (current_setting(''hessara.re_worker'',true)=''true'')',table_name);
   END IF;
  END IF;
 END LOOP;
END $policy$;
