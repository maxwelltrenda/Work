-- One-time Custodial tasks, like Maintenance's: any date (a later week too) and
-- an optional time slot. A future one waits as a template row (repeat = 'once')
-- and lands on the list the week its day falls in, then is never added again.
alter table checklist_tasks add column if not exists once_on date;
alter table checklist_tasks add column if not exists once_from time;
alter table checklist_tasks add column if not exists once_to time;
alter table checklist_tasks drop constraint if exists checklist_tasks_repeat_check;
alter table checklist_tasks add constraint checklist_tasks_repeat_check check (repeat in ('weekly', 'monthly', 'once'));

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
            where week_of is null
              and (repeat = 'weekly'
                   or (repeat = 'monthly' and checklist_month_week(v_week, day, month_week))
                   or (repeat = 'once' and once_on is not null and fac_week_start(once_on) <= v_week
                       and not exists (select 1 from checklist_tasks c where c.template_id = checklist_tasks.id)))
            order by sort, id loop
    insert into checklist_tasks (week_of, template_id, name, area, status, day, includes, who, clear_on, sort, once_on, once_from, once_to)
    values (v_week, t.id, t.name, t.area, 'Not started', t.day, t.includes, nullif(trim(t.who), ''), v_week + 6, t.sort,
            case when t.repeat = 'once' then t.once_on end, case when t.repeat = 'once' then t.once_from end, case when t.repeat = 'once' then t.once_to end)
    returning id into v_new;
    insert into checklist_subtasks (task_id, name, sort)
    select v_new, name, sort from checklist_subtasks where task_id = t.id order by sort, id;
  end loop;
  return v_week;
end $$;
