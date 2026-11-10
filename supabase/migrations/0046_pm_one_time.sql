-- One-time maintenance tasks: frequency 'once' with a due date (once_due) and
-- an optional date it first shows on the list (once_start; default: now).
-- One round only. It stays on the list (overdue if late) until it's done or
-- skipped; it is never marked Missed.

alter table pm_tasks add column if not exists once_start date;
alter table pm_tasks add column if not exists once_due date;
alter table pm_tasks drop constraint if exists pm_tasks_frequency_check;
alter table pm_tasks add constraint pm_tasks_frequency_check check (frequency in ('once', 'weekly', 'biweekly', 'monthly', 'quarterly', 'yearly'));

create or replace function pm_refresh() returns date
language plpgsql security definer set search_path = public as $$
declare
  v_today date := pm_today();
begin
  if not can_use_pm() then raise exception 'Only maintenance managers and admins can use the schedule'; end if;
  update pm_runs r set status = 'missed' from pm_tasks t
   where t.id = r.task_id and t.frequency <> 'once' and r.status = 'open' and r.period_end < v_today;
  -- Repeating tasks.
  insert into pm_runs (task_id, period_start, period_end, due_on, status)
  select t.id, p.ps, p.pe, p.win,
         case when p.pe < v_today then 'missed' else 'open' end
    from pm_tasks t
    cross join lateral (select greatest(pm_period_start(t.frequency, t.active_since, t.start_month, t.start_day),
                                        coalesce(pm_period_start(t.frequency, (select max(r.period_end) from pm_runs r where r.task_id = t.id) + 1,
                                                                 t.start_month, t.start_day), '-infinity'::date)) as first) f
    cross join lateral generate_series(f.first, pm_period_start(t.frequency, v_today, t.start_month, t.start_day), pm_step_interval(t.frequency)) g(d)
    cross join lateral (select g.d::date as ps, pm_period_end(t.frequency, g.d::date) as pe,
                               least(pm_period_end(t.frequency, g.d::date),
                                     case when t.due_days is null then pm_period_end(t.frequency, g.d::date) else g.d::date + t.due_days - 1 end) as win) p
   where t.active and t.parent_id is null and t.frequency <> 'once'
     and not (p.ps = pm_period_start(t.frequency, t.active_since, t.start_month, t.start_day) and p.win < t.active_since)
     and not (t.frequency = 'biweekly' and p.ps < t.active_since)
  on conflict (task_id, period_start) do nothing;
  -- One-time tasks: a single round from its start date.
  insert into pm_runs (task_id, period_start, period_end, due_on, status)
  select t.id, least(coalesce(t.once_start, t.active_since), t.once_due), t.once_due, t.once_due, 'open'
    from pm_tasks t
   where t.active and t.parent_id is null and t.frequency = 'once' and t.once_due is not null
     and not exists (select 1 from pm_runs r where r.task_id = t.id)
  on conflict (task_id, period_start) do nothing;
  -- Get-ready steps (repeating tasks): open when the next round is within lead_days.
  insert into pm_runs (task_id, period_start, period_end, due_on, status)
  select c.id, n.ps - c.lead_days, n.ps - 1, n.ps - 1, 'open'
    from pm_tasks c
    join pm_tasks t on t.id = c.parent_id
    cross join lateral (select pm_period_start(t.frequency, v_today + c.lead_days, t.start_month, t.start_day) as ps) n
   where c.active and t.active and c.lead_days is not null and t.frequency <> 'once'
     and n.ps > v_today
  on conflict (task_id, period_start) do nothing;
  return v_today;
end $$;

-- Set a one-time task's dates. Moves its open round to the new dates.
create or replace function pm_set_once(p_task bigint, p_start date, p_due date) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not can_use_pm() then raise exception 'Only maintenance managers and admins can change the schedule'; end if;
  if p_due is null then raise exception 'Pick the date it is due'; end if;
  update pm_tasks set frequency = 'once', once_start = p_start, once_due = p_due, due_days = null, start_month = null, start_day = null
   where id = p_task and parent_id is null;
  delete from pm_runs where task_id = p_task and status = 'open';
  perform pm_refresh();
end $$;
revoke execute on function pm_set_once(bigint, date, date) from public, anon;
grant execute on function pm_set_once(bigint, date, date) to authenticated;

-- Saving accepts 'once' (its dates are set with pm_set_once).
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
  if p_frequency not in ('once', 'weekly', 'biweekly', 'monthly', 'quarterly', 'yearly') then raise exception 'Pick how often'; end if;
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
