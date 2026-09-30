-- Run once as the schema administrator, after the initial Hessara schema.
-- Intentionally fail if the role already exists so its privileges can be reviewed.
-- Provision LOGIN and a generated password separately through a secret-handling path.
CREATE ROLE hessara_runtime
  NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOREPLICATION NOBYPASSRLS;

GRANT CONNECT ON DATABASE postgres TO hessara_runtime;
GRANT USAGE ON SCHEMA public TO hessara_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.runs, public.trials, public.model_profiles,
  public.integration_exports, public.decision_usage, public.auth_limits
TO hessara_runtime;
GRANT USAGE ON SEQUENCE public.trials_rowid_seq TO hessara_runtime;

-- The trusted backend verifies identity and ownership before querying these tables.
-- These policies do not grant anon, authenticated, or the Data API any access.
CREATE POLICY hessara_runtime_access ON public.runs
  FOR ALL TO hessara_runtime USING (true) WITH CHECK (true);
CREATE POLICY hessara_runtime_access ON public.trials
  FOR ALL TO hessara_runtime USING (true) WITH CHECK (true);
CREATE POLICY hessara_runtime_access ON public.model_profiles
  FOR ALL TO hessara_runtime USING (true) WITH CHECK (true);
CREATE POLICY hessara_runtime_access ON public.integration_exports
  FOR ALL TO hessara_runtime USING (true) WITH CHECK (true);
CREATE POLICY hessara_runtime_access ON public.decision_usage
  FOR ALL TO hessara_runtime USING (true) WITH CHECK (true);
CREATE POLICY hessara_runtime_access ON public.auth_limits
  FOR ALL TO hessara_runtime USING (true) WITH CHECK (true);

ALTER ROLE hessara_runtime IN DATABASE postgres
  SET search_path = pg_catalog, public;
