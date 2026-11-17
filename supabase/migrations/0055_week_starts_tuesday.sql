-- The Facilities week runs Tuesday to Monday (the team works Tue-Fri, a few
-- on Saturday, the rest on Sunday, nobody on Monday). The Custodial list,
-- weekly and every-2-weeks Maintenance rounds all start on Tuesday now.

create or replace function fac_week_start(p_day date) returns date
language sql immutable as $$ select p_day - ((extract(dow from p_day)::int + 5) % 7) $$;

-- Weekly / every 2 weeks: Tuesday-based. Every 2 weeks lines up with Tue Jan 6 2026.
create or replace function pm_period_start(p_freq text, p_day date, p_month integer, p_dom integer) returns date
language plpgsql immutable as $$
declare
  sd integer := coalesce(p_dom, 1);
  sm integer := coalesce(p_month, 1);
  d date;
  k integer;
begin
  if p_freq = 'weekly' then
    return fac_week_start(p_day);
  elsif p_freq = 'biweekly' then
    d := fac_week_start(p_day);
    k := (((d - date '2026-01-06') / 7 - (sd - 1)) % 2 + 2) % 2;
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
    return case when d > p_day then make_date(extract(year from p_day)::int - 1, sm, sd) else d end;
  end if;
end $$;

-- Monthly Custodial task: the week of the first <its day> of the month (Tuesday-based weeks).
create or replace function checklist_month_week(p_week date, p_day text) returns boolean
language sql immutable as $$
  select extract(day from p_week + coalesce((array_position(array['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'], p_day) - 1 + 5) % 7, 4)) <= 7
$$;

create or replace function start_checklist_week() returns date
language plpgsql security definer set search_path = public as $$
declare
  v_today date := (now() at time zone 'America/Chicago')::date;
  v_week date := fac_week_start(v_today);
  t record;
  v_new bigint;
begin
  if not can_see_boards() and auth.jwt() ->> 'email' is not null then
    raise exception 'No access to the checklist';
  end if;
  if exists (select 1 from checklist_tasks where week_of = v_week) then
    return v_week;
  end if;
  perform pg_advisory_xact_lock(hashtext('start_checklist_week'));
  if exists (select 1 from checklist_tasks where week_of = v_week) then
    return v_week;
  end if;

  update checklist_tasks
     set status = 'Missed', timer_started_at = null
   where week_of < v_week and not archived and status in ('Not started', 'Working on it');
  update checklist_tasks set archived = true where week_of < v_week and not archived;

  for t in select * from checklist_tasks
            where week_of is null and (repeat = 'weekly' or checklist_month_week(v_week, day))
            order by sort, id loop
    insert into checklist_tasks (week_of, template_id, name, area, status, day, includes, who, clear_on, sort)
    values (v_week, t.id, t.name, t.area, 'Not started', t.day, t.includes, nullif(trim(t.who), ''), v_week + 6, t.sort)
    returning id into v_new;
    insert into checklist_subtasks (task_id, name, sort)
    select v_new, name, sort from checklist_subtasks where task_id = t.id order by sort, id;
  end loop;
  return v_week;
end $$;

-- Move the list in progress over to the Tuesday week it belongs to (once).
update checklist_tasks set week_of = fac_week_start(week_of + 2), clear_on = fac_week_start(week_of + 2) + 6
 where week_of is not null and not archived and week_of <> fac_week_start(week_of);

-- Weekly Maintenance "by <day>" counts days from Tuesday now: keep the same weekday.
update pm_tasks set due_days = ((due_days - 1) - 2 + 7) % 7 + 1
 where frequency = 'weekly' and due_days between 1 and 6;
-- Rounds not started yet under the old Sunday weeks are made again on Tuesday weeks.
delete from pm_runs r using pm_tasks t
 where r.task_id = t.id and t.frequency in ('weekly', 'biweekly') and r.status = 'open'
   and coalesce(cardinality(r.steps_done), 0) = 0 and r.period_end >= (now() at time zone 'America/Chicago')::date;
