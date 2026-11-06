-- Every-2-weeks tasks begin with the next round on the Sunday picked
-- ("Next starts Sun Nov 8"), not the round already under way when the task
-- was added or re-timed.

create or replace function pm_refresh() returns date
language plpgsql security definer set search_path = public as $$
declare
  v_today date := pm_today();
begin
  if not can_use_pm() then raise exception 'Only maintenance managers and admins can use the schedule'; end if;
  update pm_runs set status = 'missed' where status = 'open' and period_end < v_today;
  -- Regular tasks.
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
   where t.active and t.parent_id is null
     and not (p.ps = pm_period_start(t.frequency, t.active_since, t.start_month, t.start_day) and p.win < t.active_since)
     -- Every-2-weeks tasks start on the Sunday picked, not partway into a round.
     and not (t.frequency = 'biweekly' and p.ps < t.active_since)
  on conflict (task_id, period_start) do nothing;
  -- Get-ready steps: open when the parent's next round is within lead_days.
  insert into pm_runs (task_id, period_start, period_end, due_on, status)
  select c.id, n.ps - c.lead_days, n.ps - 1, n.ps - 1, 'open'
    from pm_tasks c
    join pm_tasks t on t.id = c.parent_id
    cross join lateral (select pm_period_start(t.frequency, v_today + c.lead_days, t.start_month, t.start_day) as ps) n
   where c.active and t.active and c.lead_days is not null
     and n.ps > v_today
  on conflict (task_id, period_start) do nothing;
  return v_today;
end $$;


delete from pm_runs r using pm_tasks t
 where r.task_id = t.id and t.frequency = 'biweekly' and t.parent_id is null
   and r.status = 'open' and r.period_start < t.active_since;
