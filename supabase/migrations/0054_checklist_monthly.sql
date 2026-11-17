-- Custodial repeating tasks can be monthly: added only in the week of the
-- first <its day> of the month (e.g. the first Tuesday). Weekly stays the default.

alter table checklist_tasks add column if not exists repeat text not null default 'weekly';
alter table checklist_tasks drop constraint if exists checklist_tasks_repeat_check;
alter table checklist_tasks add constraint checklist_tasks_repeat_check check (repeat in ('weekly', 'monthly'));

-- Does a monthly task with this day land in the week starting p_week?
-- Yes when that weekday's date is the 1st-7th of its month (Detail Work: the Saturday).
create or replace function checklist_month_week(p_week date, p_day text) returns boolean
language sql immutable as $$
  select extract(day from p_week + coalesce(array_position(array['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'], p_day) - 1, 6)) <= 7
$$;

create or replace function start_checklist_week() returns date
language plpgsql security definer set search_path = public as $$
declare
  v_today date := (now() at time zone 'America/Chicago')::date;
  v_week date := v_today - extract(dow from v_today)::integer;
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
