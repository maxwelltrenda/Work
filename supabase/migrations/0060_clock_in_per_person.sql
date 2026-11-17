-- Clock in per person. Start clocks YOU in on a task; the task's timer runs
-- while anyone is clocked in and stops (logging the time) when the last
-- person stops. "Clocked in now" and the Overview only show the people
-- actually clocked in, not everyone on the task.
--   checklist_tasks.clocked: names (the Custodial "who" list uses names)
--   pm_runs.clocked:         member ids

alter table checklist_tasks add column if not exists clocked text[] not null default '{}';
alter table pm_runs add column if not exists clocked uuid[] not null default '{}';

-- Custodial status rules: as before, plus who's clocked in.
create or replace function checklist_task_rules() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_who text := my_name();
begin
  if tg_op = 'UPDATE' and new.status is distinct from old.status and new.week_of is not null then
    if new.status = 'Working on it' then
      new.timer_started_at := coalesce(new.timer_started_at, now());
      if coalesce(new.who, '') = '' and v_who <> 'System' then new.who := v_who; end if;
      if v_who <> 'System' and not (v_who = any (new.clocked)) then new.clocked := array_append(new.clocked, v_who); end if;
    elsif new.status in ('Done', 'Missed', 'Skipped', 'Not started') and new.timer_started_at is not null then
      insert into checklist_time (task_id, started_by, ended_by, started_at, ended_at)
      values (new.id, v_who, v_who, new.timer_started_at, now());
      new.worked_seconds := new.worked_seconds + greatest(0, extract(epoch from now() - new.timer_started_at)::integer);
      new.timer_started_at := null;
    end if;
    if new.status in ('Done', 'Missed', 'Skipped', 'Not started') then new.clocked := '{}'; end if;
    if new.status = 'Done' then
      new.done_on := now();
      if coalesce(new.who, '') = '' and v_who <> 'System' then new.who := v_who; end if;
    elsif old.status = 'Done' then
      new.done_on := null;
    end if;
  end if;
  return new;
end $$;

-- Start / Stop for ME on a Custodial task.
create or replace function checklist_timer(p_id bigint, p_run boolean) returns void
language plpgsql security definer set search_path = public as $$
declare
  r checklist_tasks;
  v_who text := my_name();
  v_left text[];
begin
  if not can_edit_boards() then raise exception 'Your role is view-only'; end if;
  select * into r from checklist_tasks where id = p_id for update;
  if not found then raise exception 'Task not found'; end if;
  if p_run then
    update checklist_tasks set
           timer_started_at = coalesce(timer_started_at, now()),
           status = case when status in ('Not started', 'Missed', 'Skipped') then 'Working on it' else status end,
           who = case when coalesce(who, '') = '' and v_who <> 'System' then v_who else who end,
           clocked = case when v_who <> 'System' and not (v_who = any (clocked)) then array_append(clocked, v_who) else clocked end
     where id = p_id;
  else
    v_left := case when v_who = 'System' then '{}' else array_remove(r.clocked, v_who) end;
    if cardinality(v_left) = 0 and r.timer_started_at is not null then
      insert into checklist_time (task_id, started_by, ended_by, started_at, ended_at)
      values (p_id, v_who, v_who, r.timer_started_at, now());
      update checklist_tasks
         set worked_seconds = worked_seconds + greatest(0, extract(epoch from now() - r.timer_started_at)::integer),
             timer_started_at = null, clocked = '{}'
       where id = p_id;
    else
      update checklist_tasks set clocked = v_left where id = p_id;
    end if;
  end if;
end $$;

-- Maintenance: stopping the clock also clears who's clocked in.
create or replace function pm_stop_clock(p_run bigint) returns void
language plpgsql security definer set search_path = public as $$
declare r pm_runs;
begin
  select * into r from pm_runs where id = p_run for update;
  if not found then return; end if;
  if r.timer_started_at is not null then
    insert into pm_time (run_id, member_id, started_at, ended_at) values (r.id, current_member_id(), r.timer_started_at, now());
    update pm_runs set worked_seconds = worked_seconds + greatest(0, extract(epoch from now() - r.timer_started_at)::integer),
                       timer_started_at = null
     where id = r.id;
  end if;
  update pm_runs set clocked = '{}' where id = r.id;
end $$;
revoke execute on function pm_stop_clock(bigint) from public, anon, authenticated;

-- Start / Stop for ME on a Maintenance round.
create or replace function pm_timer(p_run bigint, p_run_on boolean) returns void
language plpgsql security definer set search_path = public as $$
declare
  r pm_runs;
  v_me uuid := current_member_id();
begin
  if not can_work_pm() then raise exception 'Only the Facilities team can use the schedule'; end if;
  select * into r from pm_runs where id = p_run for update;
  if not found then raise exception 'No such task'; end if;
  if p_run_on then
    if r.status <> 'open' and r.status <> 'missed' then raise exception 'That one is already checked off'; end if;
    update pm_runs set timer_started_at = coalesce(timer_started_at, now()),
           clocked = case when v_me is not null and not (v_me = any (clocked)) then array_append(clocked, v_me) else clocked end
     where id = p_run;
    -- Clocking in puts you on the task, unless you already have a step on it.
    if v_me is not null then
      update pm_tasks set assignees = array_append(coalesce(assignees, '{}'), v_me)
       where id = r.task_id and not (v_me = any (coalesce(assignees, '{}')))
         and not exists (select 1 from jsonb_each(step_people) e where e.value ? v_me::text);
    end if;
  else
    if v_me is null or cardinality(array_remove(r.clocked, v_me)) = 0 then
      perform pm_stop_clock(p_run);
    else
      update pm_runs set clocked = array_remove(clocked, v_me) where id = p_run;
    end if;
  end if;
end $$;

-- Pulled away pauses only what YOU are clocked in on; back clocks you in again.
create or replace function pulled_start(p_dept text, p_what text, p_location text default null, p_request bigint default null)
returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := current_member_id();
  v_name text;
  v_id bigint;
  v_tasks bigint[] := '{}';
  v_reqs bigint[] := '{}';
  v_pm bigint[] := '{}';
  t record;
begin
  if v_me is null or not can_edit_boards() then raise exception 'Only the Facilities team can log this'; end if;
  if p_dept not in ('custodial', 'maintenance') then raise exception 'Bad department'; end if;
  if coalesce(trim(p_what), '') = '' then raise exception 'Say what you got pulled to'; end if;
  select name into v_name from team_members where id = v_me;

  select coalesce(array_agg(distinct x), '{}') into v_tasks
    from pulled_work w, unnest(w.paused_tasks) x where w.member_id = v_me and w.ended_at is null;
  select coalesce(array_agg(distinct x), '{}') into v_reqs
    from pulled_work w, unnest(w.paused_requests) x where w.member_id = v_me and w.ended_at is null;
  select coalesce(array_agg(distinct x), '{}') into v_pm
    from pulled_work w, unnest(w.paused_pm) x where w.member_id = v_me and w.ended_at is null;
  update pulled_work set ended_at = now(), paused_tasks = '{}', paused_requests = '{}', paused_pm = '{}',
         paused_seconds = paused_seconds + coalesce(greatest(0, extract(epoch from now() - paused_at)::integer), 0), paused_at = null
   where member_id = v_me and ended_at is null;

  for t in select * from checklist_tasks
            where week_of is not null and not archived and timer_started_at is not null and v_name = any (clocked)
            for update loop
    if cardinality(array_remove(t.clocked, v_name)) = 0 then
      insert into checklist_time (task_id, started_by, ended_by, started_at, ended_at)
      values (t.id, v_name, v_name, t.timer_started_at, now());
      update checklist_tasks
         set worked_seconds = worked_seconds + greatest(0, extract(epoch from now() - t.timer_started_at)::integer),
             timer_started_at = null, clocked = '{}'
       where id = t.id;
    else
      update checklist_tasks set clocked = array_remove(clocked, v_name) where id = t.id;
    end if;
    v_tasks := array_append(v_tasks, t.id);
  end loop;

  for t in select * from maint_requests
            where timer_started_at is not null and only_me_on(array_to_string(experts, ','), v_name)
            for update loop
    insert into maint_time (request_id, started_by, ended_by, started_at, ended_at)
    values (t.id, v_name, v_name, t.timer_started_at, now());
    update maint_requests
       set worked_seconds = worked_seconds + greatest(0, extract(epoch from now() - t.timer_started_at)::integer),
           timer_started_at = null
     where id = t.id;
    v_reqs := array_append(v_reqs, t.id);
  end loop;

  for t in select * from pm_runs where timer_started_at is not null and v_me = any (clocked) for update loop
    if cardinality(array_remove(t.clocked, v_me)) = 0 then
      perform pm_stop_clock(t.id);
    else
      update pm_runs set clocked = array_remove(clocked, v_me) where id = t.id;
    end if;
    v_pm := array_append(v_pm, t.id);
  end loop;

  insert into pulled_work (dept, member_id, what, location, request_id, paused_tasks, paused_requests, paused_pm)
  values (p_dept, v_me, trim(p_what), nullif(trim(p_location), ''), p_request, v_tasks, v_reqs, v_pm)
  returning id into v_id;
  return v_id;
end $$;

create or replace function pulled_end(p_id bigint, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  w pulled_work;
  v_name text;
begin
  update pulled_work set ended_at = now(), note = coalesce(nullif(trim(p_note), ''), note),
         paused_seconds = paused_seconds + coalesce(greatest(0, extract(epoch from now() - paused_at)::integer), 0), paused_at = null
   where id = p_id and ended_at is null and (member_id = current_member_id() or is_team_admin())
  returning * into w;
  if not found then raise exception 'That one is already finished, or isn''t yours'; end if;
  select name into v_name from team_members where id = w.member_id;
  update checklist_tasks set timer_started_at = coalesce(timer_started_at, now()),
         clocked = case when v_name = any (clocked) then clocked else array_append(clocked, v_name) end
   where id = any (w.paused_tasks) and status = 'Working on it' and not archived;
  update maint_requests set timer_started_at = now()
   where id = any (w.paused_requests) and timer_started_at is null and status not in ('Complete', 'Declined');
  update pm_runs set timer_started_at = coalesce(timer_started_at, now()),
         clocked = case when w.member_id = any (clocked) then clocked else array_append(clocked, w.member_id) end
   where id = any (w.paused_pm) and status in ('open', 'missed');
end $$;

-- Who's clocked in on the timers running right now: the people on them.
update checklist_tasks set clocked = array(select trim(x) from unnest(string_to_array(who, ',')) x where trim(x) <> '')
 where timer_started_at is not null and not archived and clocked = '{}';
update pm_runs r set clocked = coalesce(t.assignees, '{}') from pm_tasks t
 where t.id = r.task_id and r.timer_started_at is not null and r.clocked = '{}';
