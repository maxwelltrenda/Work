-- Maintenance schedule: a task's window can start partway through the year.
--   start_month / start_day set where each period begins, e.g. AC filters:
--   quarterly, start December 1, due within 14 days -> due Dec 1-14, Mar 1-14,
--   Jun 1-14, Sep 1-14. Each period then runs until the next one starts
--   (Dec 1 - Feb 28), so it's overdue after the 14th and Missed only once the
--   next round begins.
--   Monthly tasks can use start_day (e.g. the 15th of every month).
--   Leaving them empty keeps the plain calendar periods (Jan / Apr / Jul / Oct,
--   the 1st of the month, Jan 1).

alter table pm_tasks add column if not exists start_month integer check (start_month is null or start_month between 1 and 12);
alter table pm_tasks add column if not exists start_day integer check (start_day is null or start_day between 1 and 28);

create or replace function pm_period_start(p_freq text, p_day date, p_month integer, p_dom integer) returns date
language plpgsql immutable as $$
declare
  sd integer := coalesce(p_dom, 1);
  sm integer := coalesce(p_month, 1);
  d date;
  k integer;
begin
  if p_freq = 'weekly' then
    return p_day - extract(dow from p_day)::int;
  elsif p_freq = 'monthly' then
    d := date_trunc('month', p_day)::date + (sd - 1);
    return case when d > p_day then (d - interval '1 month')::date else d end;
  elsif p_freq = 'quarterly' then
    k := ((extract(month from p_day)::int - sm) % 3 + 3) % 3;
    d := (date_trunc('month', p_day) - make_interval(months => k))::date + (sd - 1);
    return case when d > p_day then (d - interval '3 months')::date else d end;
  else
    d := make_date(extract(year from p_day)::int, sm, sd);
    return case when d > p_day then (d - interval '1 year')::date else d end;
  end if;
end $$;

-- The old two-argument form stays for anything that still calls it.
create or replace function pm_period_start(p_freq text, p_day date) returns date
language sql immutable as $$ select pm_period_start(p_freq, p_day, null, null) $$;

create or replace function pm_refresh() returns date
language plpgsql security definer set search_path = public as $$
declare
  v_today date := pm_today();
begin
  if not can_use_pm() then raise exception 'Only maintenance managers and admins can use the schedule'; end if;
  update pm_runs set status = 'missed' where status = 'open' and period_end < v_today;
  insert into pm_runs (task_id, period_start, period_end, due_on, status)
  select t.id, p.ps, p.pe,
         case when p.ps = pm_period_start(t.frequency, t.active_since, t.start_month, t.start_day) and p.win < t.active_since then p.pe else p.win end,
         case when p.pe < v_today then 'missed' else 'open' end
    from pm_tasks t
    -- Start from the period after the last round on record (lined up with the
    -- task's current start month, even if that changed), or when it went live.
    cross join lateral (select greatest(pm_period_start(t.frequency, t.active_since, t.start_month, t.start_day),
                                        coalesce(pm_period_start(t.frequency, (select max(r.period_end) from pm_runs r where r.task_id = t.id) + 1,
                                                                 t.start_month, t.start_day), '-infinity'::date)) as first) f
    cross join lateral generate_series(f.first, pm_period_start(t.frequency, v_today, t.start_month, t.start_day), pm_step_interval(t.frequency)) g(d)
    cross join lateral (select g.d::date as ps, pm_period_end(t.frequency, g.d::date) as pe,
                               least(pm_period_end(t.frequency, g.d::date),
                                     case when t.due_days is null then pm_period_end(t.frequency, g.d::date) else g.d::date + t.due_days - 1 end) as win) p
   where t.active
  on conflict (task_id, period_start) do nothing;
  return v_today;
end $$;

-- Save a task with its start month / day. Changing when it starts clears this
-- period's open round so the new dates take over.
create or replace function pm_save_task(p_id bigint, p_name text, p_frequency text, p_due_days integer,
                                        p_location text, p_notes text, p_steps text[],
                                        p_start_month integer, p_start_day integer) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_id bigint := p_id;
  v_sm integer := case when p_frequency in ('quarterly', 'yearly') then p_start_month end;
  v_sd integer := case when p_frequency in ('monthly', 'quarterly', 'yearly') then nullif(p_start_day, 1) end;
begin
  if not can_use_pm() then raise exception 'Only maintenance managers and admins can change the schedule'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Give the task a name'; end if;
  if p_frequency not in ('weekly', 'monthly', 'quarterly', 'yearly') then raise exception 'Pick how often'; end if;
  if v_id is null then
    insert into pm_tasks (name, frequency, due_days, location, notes, steps, created_by, sort, active_since, start_month, start_day)
    values (trim(p_name), p_frequency, p_due_days, nullif(trim(p_location), ''), nullif(trim(p_notes), ''),
            coalesce(array_remove(array(select trim(x) from unnest(p_steps) x), ''), '{}'), current_member_id(),
            coalesce((select max(sort) + 1 from pm_tasks), 0), pm_today(), v_sm, v_sd)
    returning id into v_id;
  else
    update pm_tasks set name = trim(p_name), frequency = p_frequency, due_days = p_due_days,
           location = nullif(trim(p_location), ''), notes = nullif(trim(p_notes), ''),
           steps = coalesce(array_remove(array(select trim(x) from unnest(p_steps) x), ''), '{}'),
           start_month = v_sm, start_day = v_sd,
           -- New timing: this round gets until the end of its period, like a new task.
           active_since = case when (frequency, due_days, start_month, start_day) is distinct from (p_frequency, p_due_days, v_sm, v_sd)
                               then pm_today() else active_since end
     where id = v_id;
    if not found then raise exception 'No such task'; end if;
    delete from pm_runs where task_id = v_id and status = 'open' and period_end >= pm_today();
  end if;
  perform pm_refresh();
  return v_id;
end $$;

revoke execute on function pm_save_task(bigint, text, text, integer, text, text, text[], integer, integer) from public, anon;
grant execute on function pm_save_task(bigint, text, text, integer, text, text, text[], integer, integer) to authenticated;
