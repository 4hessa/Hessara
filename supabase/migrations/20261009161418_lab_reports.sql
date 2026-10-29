-- Immutable, explicitly published snapshots. The plaintext capability is never stored.
create table public.lab_reports (
  id uuid primary key,
  run_id text not null references public.runs(id) on delete cascade,
  owner text not null check (length(owner)>0),
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  preview_hash text not null check (preview_hash ~ '^[a-f0-9]{64}$'),
  snapshot jsonb not null check (jsonb_typeof(snapshot)='object' and octet_length(snapshot::text)<=3145728),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  check (expires_at>created_at and expires_at<=created_at+interval '30 days')
);
create index lab_reports_owner_run on public.lab_reports(owner,run_id,created_at desc);
create index lab_reports_run on public.lab_reports(run_id);
alter table public.lab_reports enable row level security;
alter table public.lab_reports force row level security;
revoke all on public.lab_reports from public,anon,authenticated;
grant select,insert,delete on public.lab_reports to hessara_runtime;
grant update(revoked_at) on public.lab_reports to hessara_runtime;
create policy lab_reports_owner_select on public.lab_reports for select to hessara_runtime
using (owner=(select nullif(current_setting('hessara.owner',true),'')));
create policy lab_reports_owner_insert on public.lab_reports for insert to hessara_runtime
with check (owner=(select nullif(current_setting('hessara.owner',true),''))
  and exists(select 1 from public.runs r where r.id=lab_reports.run_id and r.owner=lab_reports.owner and r.mode='custom'));
create policy lab_reports_owner_update on public.lab_reports for update to hessara_runtime
using (owner=(select nullif(current_setting('hessara.owner',true),'')))
with check (owner=(select nullif(current_setting('hessara.owner',true),''))
  and exists(select 1 from public.runs r where r.id=lab_reports.run_id and r.owner=lab_reports.owner and r.mode='custom'));
create policy lab_reports_owner_delete on public.lab_reports for delete to hessara_runtime
using (owner=(select nullif(current_setting('hessara.owner',true),'')));
create policy lab_reports_capability_read on public.lab_reports for select to hessara_runtime
using (token_hash=(select nullif(current_setting('hessara.share_hash',true),'')) and revoked_at is null and expires_at>now());
