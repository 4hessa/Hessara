-- One explicit, revocable preference record per server-authenticated owner.
-- Saving a run alone never creates this record or opts the user into history.
create table public.lab_preferences (
  owner text primary key check (length(owner) > 0),
  preferences jsonb not null check (jsonb_typeof(preferences) = 'object' and octet_length(preferences::text) <= 4096),
  consent_version text not null check (consent_version = 'hessara-preferences/1'),
  consented_at timestamptz not null,
  updated_at timestamptz not null
);
alter table public.lab_preferences enable row level security;
alter table public.lab_preferences force row level security;
revoke all on public.lab_preferences from public, anon, authenticated;
grant select, insert, update, delete on public.lab_preferences to hessara_runtime;
create policy lab_preferences_owner on public.lab_preferences for all to hessara_runtime
using (owner = (select nullif(current_setting('hessara.owner', true), '')))
with check (owner = (select nullif(current_setting('hessara.owner', true), '')));
