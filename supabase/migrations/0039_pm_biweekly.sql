-- Every-2-weeks maintenance tasks. Rounds start on a Sunday and run 14 days.
-- start_day picks which Sunday: 1 = the fortnight lined up with Sun Jan 4 2026
-- (empty means 1), 2 = the other week.

alter table pm_tasks drop constraint if exists pm_tasks_frequency_check;
alter table pm_tasks add constraint pm_tasks_frequency_check check (frequency in ('weekly', 'biweekly', 'monthly', 'quarterly', 'yearly'));

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
  elsif p_freq = 'biweekly' then
    d := p_day - extract(dow from p_day)::int;
    k := (((d - date '2026-01-04') / 7 - (sd - 1)) % 2 + 2) % 2;
    return d - 7 * k;
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

create or replace function pm_period_end(p_freq text, p_start date) returns date
language sql immutable as $$
  select (p_start + case p_freq when 'weekly' then interval '7 days' when 'biweekly' then interval '14 days'
                                when 'monthly' then interval '1 month' when 'quarterly' then interval '3 months'
                                else interval '1 year' end)::date - 1
$$;

create or replace function pm_step_interval(p_freq text) returns interval
language sql immutable as $$
  select case p_freq when 'weekly' then interval '7 days' when 'biweekly' then interval '14 days'
                     when 'monthly' then interval '1 month' when 'quarterly' then interval '3 months'
                     else interval '1 year' end
$$;

create or replace function pm_save_task(p_id bigint, p_name text, p_frequency text, p_due_days integer,
                                        p_location text, p_notes text, p_steps text[],
                                        p_start_month integer, p_start_day integer) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_id bigint := p_id;
  v_sm integer := case when p_frequency in ('quarterly', 'yearly') then p_start_month end;
  v_sd integer := case when p_frequency in ('monthly', 'quarterly', 'yearly') then nullif(p_start_day, 1)
                       when p_frequency = 'biweekly' then nullif(least(2, greatest(1, coalesce(p_start_day, 1))), 1) end;
begin
  if not can_use_pm() then raise exception 'Only maintenance managers and admins can change the schedule'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Give the task a name'; end if;
  if p_frequency not in ('weekly', 'biweekly', 'monthly', 'quarterly', 'yearly') then raise exception 'Pick how often'; end if;
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
           active_since = case when (frequency, due_days, start_month, start_day) is distinct from (p_frequency, p_due_days, v_sm, v_sd)
                               then pm_today() else active_since end
     where id = v_id and parent_id is null;
    if not found then raise exception 'No such task'; end if;
    delete from pm_runs where task_id = v_id and status = 'open' and period_end >= pm_today();
    -- Get-ready steps follow the task's timing.
    update pm_tasks set frequency = p_frequency, location = nullif(trim(p_location), '') where parent_id = v_id;
    delete from pm_runs r using pm_tasks c where r.task_id = c.id and c.parent_id = v_id and r.status = 'open' and r.period_end >= pm_today();
  end if;
  perform pm_refresh();
  return v_id;
end $$;
