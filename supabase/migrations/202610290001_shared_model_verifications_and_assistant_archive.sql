-- Keep the shared model connection verification store and archive the retired
-- assistant's private tables without deleting rows. Safe on both new and old DBs.
CREATE TABLE IF NOT EXISTS public.model_verifications (
 owner text NOT NULL,
 model_id text NOT NULL,
 fingerprint text NOT NULL,
 checked_at bigint NOT NULL,
 success boolean NOT NULL,
 error_code text,
 PRIMARY KEY(owner,model_id)
);

ALTER TABLE public.model_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.model_verifications FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.model_verifications FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.model_verifications TO hessara_runtime;
DROP POLICY IF EXISTS chat_owner ON public.model_verifications;
DROP POLICY IF EXISTS model_verification_owner ON public.model_verifications;
CREATE POLICY model_verification_owner ON public.model_verifications TO hessara_runtime
 USING(owner=current_setting('hessara.owner',true) OR owner='platform-models')
 WITH CHECK(owner=current_setting('hessara.owner',true));

DO $$
DECLARE
 old_name text;
 archived_name text;
BEGIN
 FOREACH old_name IN ARRAY ARRAY['chat_threads','chat_generations','chat_messages','chat_usage','chat_platform_usage'] LOOP
  archived_name := 'hessara_retired_assistant_' || old_name;
  IF to_regclass('public.' || old_name) IS NOT NULL AND to_regclass('public.' || archived_name) IS NULL THEN
   EXECUTE format('ALTER TABLE public.%I RENAME TO %I', old_name, archived_name);
   EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated,hessara_runtime', archived_name);
  END IF;
 END LOOP;
END $$;
