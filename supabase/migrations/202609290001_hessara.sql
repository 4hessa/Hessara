-- Run once in the new Supabase project. Existing Sites data stays in its original database.
CREATE TABLE IF NOT EXISTS public.runs (
  id text PRIMARY KEY, owner text NOT NULL, name text NOT NULL, mode text NOT NULL,
  status text NOT NULL, created_at text NOT NULL, config text NOT NULL, total integer NOT NULL,
  next_index integer NOT NULL DEFAULT 0, lock_token text, locked_until bigint NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_runs_owner_created ON public.runs(owner, created_at);
CREATE TABLE IF NOT EXISTS public.trials (
  rowid bigint GENERATED ALWAYS AS IDENTITY,
  id text PRIMARY KEY, run_id text NOT NULL REFERENCES public.runs(id), model text NOT NULL,
  task_id text NOT NULL, repeat integer NOT NULL, status text NOT NULL,
  score double precision, output text, latency double precision, input_tokens integer,
  output_tokens integer, cost double precision, error text, metadata text,
  UNIQUE(run_id, model, task_id, repeat)
);
CREATE INDEX IF NOT EXISTS idx_trials_run_order ON public.trials(run_id, rowid);
CREATE TABLE IF NOT EXISTS public.model_profiles (
  id text PRIMARY KEY, owner text NOT NULL, name text NOT NULL, provider text NOT NULL,
  model text NOT NULL, key_cipher text NOT NULL, input_price double precision,
  output_price double precision, created_at text NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_model_profiles_owner ON public.model_profiles(owner);
CREATE TABLE IF NOT EXISTS public.integration_exports (
  id text PRIMARY KEY, owner text NOT NULL, run_id text NOT NULL REFERENCES public.runs(id),
  destination text NOT NULL, status text NOT NULL, external_id text, created_at text NOT NULL,
  UNIQUE(owner, run_id, destination)
);
CREATE TABLE IF NOT EXISTS public.decision_usage (
  owner text PRIMARY KEY, day text NOT NULL, used integer NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS public.auth_limits (
  bucket text PRIMARY KEY, expires_at bigint NOT NULL, used integer NOT NULL
);
-- Access goes through the server, which verifies Supabase identity and owner on every request.
-- Deny all access through public/anonymous Data API credentials, including encrypted secrets.
ALTER TABLE public.runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.model_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_exports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.decision_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auth_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.runs, public.trials, public.model_profiles, public.integration_exports,
  public.decision_usage, public.auth_limits FROM PUBLIC, anon, authenticated;
