-- Private, owner-scoped reviews. The runtime role is not a table owner and has
-- no BYPASSRLS. Context is installed only inside server-owned transactions.
create table public.lab_reviews (
  trial_id text primary key references public.trials(id) on delete cascade,
  run_id text not null references public.runs(id) on delete cascade,
  owner text not null check (length(owner) > 0),
  review jsonb not null check (jsonb_typeof(review) = 'object'),
  updated_at timestamptz not null default now()
);
create index lab_reviews_owner_run on public.lab_reviews(owner, run_id);
alter table public.lab_reviews enable row level security;
alter table public.lab_reviews force row level security;
revoke all on public.lab_reviews from public, anon, authenticated;
grant select, insert, update, delete on public.lab_reviews to hessara_runtime;
create policy lab_reviews_owner on public.lab_reviews for all to hessara_runtime
using (owner = (select nullif(current_setting('hessara.owner', true), '')))
with check (owner = (select nullif(current_setting('hessara.owner', true), ''))
  and exists (select 1 from public.runs r join public.trials t on t.run_id = r.id
    where r.id = lab_reviews.run_id and t.id = lab_reviews.trial_id
      and r.owner = lab_reviews.owner and r.mode = 'custom'));

create table public.lab_judgements (
  id uuid primary key,
  trial_id text not null references public.trials(id) on delete cascade,
  run_id text not null references public.runs(id) on delete cascade,
  owner text not null check (length(owner) > 0),
  status text not null check (status in ('running','completed','failed')),
  model_snapshot jsonb not null,
  result jsonb,
  metadata jsonb not null default '{}'::jsonb,
  error text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index lab_judgements_owner_run on public.lab_judgements(owner,run_id,created_at desc);
create index lab_judgements_trial on public.lab_judgements(trial_id);
alter table public.lab_judgements enable row level security;
alter table public.lab_judgements force row level security;
revoke all on public.lab_judgements from public, anon, authenticated;
grant select, insert, update, delete on public.lab_judgements to hessara_runtime;
create policy lab_judgements_owner on public.lab_judgements for all to hessara_runtime
using (owner = (select nullif(current_setting('hessara.owner', true), '')))
with check (owner = (select nullif(current_setting('hessara.owner', true), ''))
  and exists (select 1 from public.runs r join public.trials t on t.run_id = r.id
    where r.id = lab_judgements.run_id and t.id = lab_judgements.trial_id
      and r.owner = lab_judgements.owner and r.mode = 'custom'));
