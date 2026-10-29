alter table public.re_settings alter column accepting_jobs set default false;
update public.re_settings set accepting_jobs=false,updated_at=(extract(epoch from now())*1000)::bigint where id=1;
