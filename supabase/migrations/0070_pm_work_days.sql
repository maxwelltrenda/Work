-- Weekly / every-2-weeks Maintenance tasks can happen on set days
-- (Lawn Care: Thu & Fri of its week). One round can be moved to other
-- days without changing the usual ones (pm_runs.work_days overrides).
alter table pm_tasks add column if not exists work_days text[] not null default '{}';
alter table pm_runs add column if not exists work_days text[];

create or replace function pm_clean_days(p_days text[]) returns text[]
language sql immutable as $$
  select coalesce(array_agg(d order by array_position(array['Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday','Monday'], d)), '{}')
    from (select distinct initcap(trim(x)) d from unnest(coalesce(p_days, '{}')) x) s
   where d in ('Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday','Monday')
$$;

create or replace function pm_set_work_days(p_task bigint, p_days text[]) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not can_use_pm() then raise exception 'Only maintenance managers and admins can change the schedule'; end if;
  update pm_tasks set work_days = pm_clean_days(p_days) where id = p_task;
  if not found then raise exception 'No such task'; end if;
end $$;
revoke execute on function pm_set_work_days(bigint, text[]) from public, anon;
grant execute on function pm_set_work_days(bigint, text[]) to authenticated;

-- Just this round: other days (null = back to the usual days).
create or replace function pm_set_run_days(p_run bigint, p_days text[]) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not can_use_pm() then raise exception 'Only maintenance managers and admins can change the schedule'; end if;
  update pm_runs set work_days = case when p_days is null then null else pm_clean_days(p_days) end where id = p_run;
  if not found then raise exception 'No such task'; end if;
end $$;
revoke execute on function pm_set_run_days(bigint, text[]) from public, anon;
grant execute on function pm_set_run_days(bigint, text[]) to authenticated;
