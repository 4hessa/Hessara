import {APPROVED_PROFILE_PROJECT} from './configure-integration-profile.mjs';
export const INITIAL_RUNTIME_PROJECT=APPROVED_PROFILE_PROJECT;
const verifierPattern=/^SCRAM-SHA-256\$4096:[A-Za-z0-9+/]{22}==\$[A-Za-z0-9+/]{43}=:[A-Za-z0-9+/]{43}=$/;
/** Initial nonhuman test credential only. No plaintext password or privilege grants. */
export function initialRuntimeLoginSql(verifier,projectRef){
 if(projectRef!==INITIAL_RUNTIME_PROJECT||typeof verifier!=='string'||verifier.trim()!==verifier||!verifierPattern.test(verifier))throw Error('INITIAL_RUNTIME_INPUT_INVALID');
 return `DO $hessara_initial_runtime$
 DECLARE runtime_record record;
 BEGIN
  IF current_user<>'postgres' OR current_database()<>'postgres' THEN RAISE EXCEPTION 'INITIAL_RUNTIME_ADMINISTRATOR_INVALID'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('hessara:isolated-runtime-provision',0));
  SELECT * INTO runtime_record FROM pg_authid WHERE rolname='hessara_runtime';
  IF NOT FOUND THEN RAISE EXCEPTION 'INITIAL_RUNTIME_ROLE_MISSING'; END IF;
  IF runtime_record.rolcanlogin OR runtime_record.rolpassword IS NOT NULL THEN RAISE EXCEPTION 'INITIAL_RUNTIME_ALREADY_CONFIGURED'; END IF;
  IF runtime_record.rolinherit OR runtime_record.rolsuper OR runtime_record.rolcreatedb OR runtime_record.rolcreaterole OR runtime_record.rolreplication OR runtime_record.rolbypassrls THEN RAISE EXCEPTION 'INITIAL_RUNTIME_ROLE_PRIVILEGED'; END IF;
  IF EXISTS(SELECT 1 FROM pg_auth_members m JOIN pg_roles granted ON granted.oid=m.roleid JOIN pg_roles member_role ON member_role.oid=m.member
   WHERE (granted.rolname='hessara_runtime' OR member_role.rolname='hessara_runtime')
    AND NOT(granted.rolname='hessara_runtime' AND member_role.rolname='postgres' AND m.admin_option AND NOT m.inherit_option AND NOT m.set_option)) THEN RAISE EXCEPTION 'INITIAL_RUNTIME_MEMBERSHIP_INVALID'; END IF;
  IF has_schema_privilege('hessara_runtime','supabase_migrations','USAGE') OR has_schema_privilege('anon','supabase_migrations','USAGE') OR has_schema_privilege('authenticated','supabase_migrations','USAGE')
   OR EXISTS(SELECT 1 FROM information_schema.role_table_grants WHERE table_schema='supabase_migrations' AND grantee IN('PUBLIC','anon','authenticated','hessara_runtime')) THEN RAISE EXCEPTION 'INITIAL_RUNTIME_MIGRATION_EXPOSED'; END IF;
  ALTER ROLE hessara_runtime LOGIN PASSWORD '${verifier}';
 END
 $hessara_initial_runtime$;`;
}
