-- "Get ready" steps on a maintenance task: things that have to happen before
-- each round, e.g. "Order filters" 7 days before AC filters (due Dec 1–14)
-- comes up Nov 24–30. A get-ready step is a pm_tasks row with parent_id and
-- lead_days. Each of its rounds is a pm_runs row whose period is the lead-up:
-- period_start = round start - lead_days, period_end = due_on = round start - 1.

alter table pm_tasks add column if not exists parent_id bigint references pm_tasks(id) on delete cascade;
alter table pm_tasks add column if not exists lead_days integer check (lead_days is null or lead_days between 1 and 60);
create index if not exists pm_tasks_parent_idx on pm_tasks (parent_id);

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

-- Replace a task's get-ready steps: [{id?, name, lead_days}]. Steps left out are
-- taken off (history kept). Open lead-up rounds are rebuilt with the new timing.
create or replace function pm_set_preps(p_parent bigint, p_preps jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  t pm_tasks;
  e jsonb;
  v_keep bigint[] := '{}';
  v_id bigint;
  v_lead integer;
begin
  if not can_use_pm() then raise exception 'Only maintenance managers and admins can change the schedule'; end if;
  select * into t from pm_tasks where id = p_parent and parent_id is null;
  if not found then raise exception 'No such task'; end if;
  for e in select * from jsonb_array_elements(coalesce(p_preps, '[]'::jsonb)) loop
    continue when coalesce(trim(e->>'name'), '') = '';
    v_lead := least(60, greatest(1, coalesce((e->>'lead_days')::int, 7)));
    v_id := nullif(e->>'id', '')::bigint;
    if v_id is not null and exists (select 1 from pm_tasks where id = v_id and parent_id = p_parent) then
      update pm_tasks set name = trim(e->>'name'), lead_days = v_lead, frequency = t.frequency,
             location = t.location, active = true
       where id = v_id;
    else
      insert into pm_tasks (name, frequency, parent_id, lead_days, location, created_by, sort, active_since)
      values (trim(e->>'name'), t.frequency, p_parent, v_lead, t.location, current_member_id(), 0, pm_today())
      returning id into v_id;
    end if;
    v_keep := v_keep || v_id;
  end loop;
  update pm_tasks set active = false where parent_id = p_parent and not (id = any(v_keep));
  delete from pm_runs r using pm_tasks c
   where r.task_id = c.id and c.parent_id = p_parent and r.status = 'open' and r.period_end >= pm_today();
  perform pm_refresh();
end $$;

-- Taking a task off the schedule takes its open get-ready rounds with it.
create or replace function pm_set_active(p_id bigint, p_active boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not can_use_pm() then raise exception 'Only maintenance managers and admins can change the schedule'; end if;
  update pm_tasks set active = p_active,
         active_since = case when p_active and not active then pm_today() else active_since end
   where id = p_id;
  if not p_active then
    delete from pm_runs r using pm_tasks c
     where r.task_id = c.id and (c.id = p_id or c.parent_id = p_id) and r.status = 'open' and r.period_end >= pm_today();
  end if;
  perform pm_refresh();
end $$;

revoke execute on function pm_set_preps(bigint, jsonb) from public, anon;
grant execute on function pm_set_preps(bigint, jsonb) to authenticated;
