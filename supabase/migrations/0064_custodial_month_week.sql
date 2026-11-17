-- Monthly Custodial tasks can go in any week of the month: the week of the
-- 1st, 2nd, 3rd or 4th <its day>, or the last one (month_week 5).
-- Needs 0055 (Tuesday weeks). Existing monthly tasks keep the 1st.

alter table checklist_tasks add column if not exists month_week smallint not null default 1;
alter table checklist_tasks drop constraint if exists checklist_tasks_month_week_check;
alter table checklist_tasks add constraint checklist_tasks_month_week_check check (month_week between 1 and 5);

-- Does a monthly task (this day, this week of the month) land in the Tuesday week starting p_week?
create or replace function checklist_month_week(p_week date, p_day text, p_n integer) returns boolean
language sql immutable as $$
  with d as (select p_week + coalesce((array_position(array['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'], p_day) - 1 + 5) % 7, 4) as day)
  select case when coalesce(p_n, 1) >= 5
              then extract(day from day + 7) <= 7          -- a week later is next month: the last one
              else extract(day from day) between (coalesce(p_n, 1) - 1) * 7 + 1 and coalesce(p_n, 1) * 7 end
    from d
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
            where week_of is null and (repeat = 'weekly' or checklist_month_week(v_week, day, month_week))
            order by sort, id loop
    insert into checklist_tasks (week_of, template_id, name, area, status, day, includes, who, clear_on, sort)
    values (v_week, t.id, t.name, t.area, 'Not started', t.day, t.includes, nullif(trim(t.who), ''), v_week + 6, t.sort)
    returning id into v_new;
    insert into checklist_subtasks (task_id, name, sort)
    select v_new, name, sort from checklist_subtasks where task_id = t.id order by sort, id;
  end loop;
  return v_week;
end $$;
