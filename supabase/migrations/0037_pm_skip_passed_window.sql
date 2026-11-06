-- A task added (or re-timed) after this period's window has already passed
-- waits for its next real window instead of getting a round "due by the end of
-- the period". e.g. AC filters due Dec 1–14, Mar 1–14, ..., added Nov 6: the
-- Sep 1–14 window is over, so the first round is Dec 1–14, not "due Nov 30".
-- Tasks with no window (any time in the period) still start in the current period.

create or replace function pm_refresh() returns date
language plpgsql security definer set search_path = public as $$
declare
  v_today date := pm_today();
begin
  if not can_use_pm() then raise exception 'Only maintenance managers and admins can use the schedule'; end if;
  update pm_runs set status = 'missed' where status = 'open' and period_end < v_today;
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
   where t.active
     -- Skip the first period when its window ended before the task went live.
     and not (p.ps = pm_period_start(t.frequency, t.active_since, t.start_month, t.start_day) and p.win < t.active_since)
  on conflict (task_id, period_start) do nothing;
  return v_today;
end $$;

-- Clear open rounds made the old way (window already over when the task went live).
delete from pm_runs r using pm_tasks t
 where r.task_id = t.id and r.status = 'open'
   and r.period_start = pm_period_start(t.frequency, t.active_since, t.start_month, t.start_day)
   and t.due_days is not null
   and r.period_start + t.due_days - 1 < t.active_since;
