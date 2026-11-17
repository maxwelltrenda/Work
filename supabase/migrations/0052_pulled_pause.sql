-- Pause and continue when you get pulled away.
-- "I got pulled to something" now pauses the timers you had running: this
-- week's Custodial tasks you're on alone, and requests you're handling alone.
-- "I'm back" starts them again (if they're still in progress). Pulled to
-- something else while already away keeps them paused until you're back.

alter table pulled_work add column if not exists paused_tasks bigint[] not null default '{}';
alter table pulled_work add column if not exists paused_requests bigint[] not null default '{}';
-- Pausing the pulled-to work itself (lunch, a break): paused_at while paused,
-- paused_seconds adds up the breaks so its time only counts the work.
alter table pulled_work add column if not exists paused_at timestamptz;
alter table pulled_work add column if not exists paused_seconds integer not null default 0;

-- Is this person the only one on a "who" list ("Ann Lee, Bo Diaz")?
create or replace function only_me_on(p_who text, p_name text) returns boolean
language sql immutable as $$
  select coalesce((select bool_and(lower(trim(x)) = lower(p_name)) and count(*) >= 1
                     from unnest(string_to_array(coalesce(p_who, ''), ',')) x where trim(x) <> ''), false)
$$;

create or replace function pulled_start(p_dept text, p_what text, p_location text default null, p_request bigint default null)
returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := current_member_id();
  v_name text;
  v_id bigint;
  v_tasks bigint[] := '{}';
  v_reqs bigint[] := '{}';
  t record;
begin
  if v_me is null or not can_edit_boards() then raise exception 'Only the Facilities team can log this'; end if;
  if p_dept not in ('custodial', 'maintenance') then raise exception 'Bad department'; end if;
  if coalesce(trim(p_what), '') = '' then raise exception 'Say what you got pulled to'; end if;
  select name into v_name from team_members where id = v_me;

  -- Already away: end that one, and keep what it paused.
  select coalesce(array_agg(distinct x), '{}') into v_tasks
    from pulled_work w, unnest(w.paused_tasks) x where w.member_id = v_me and w.ended_at is null;
  select coalesce(array_agg(distinct x), '{}') into v_reqs
    from pulled_work w, unnest(w.paused_requests) x where w.member_id = v_me and w.ended_at is null;
  update pulled_work set ended_at = now(), paused_tasks = '{}', paused_requests = '{}',
         paused_seconds = paused_seconds + coalesce(greatest(0, extract(epoch from now() - paused_at)::integer), 0), paused_at = null
   where member_id = v_me and ended_at is null;

  -- Pause my running Custodial timers (only tasks I'm on alone).
  for t in select * from checklist_tasks
            where week_of is not null and not archived and timer_started_at is not null and only_me_on(who, v_name)
            for update loop
    insert into checklist_time (task_id, started_by, ended_by, started_at, ended_at)
    values (t.id, v_name, v_name, t.timer_started_at, now());
    update checklist_tasks
       set worked_seconds = worked_seconds + greatest(0, extract(epoch from now() - t.timer_started_at)::integer),
           timer_started_at = null
     where id = t.id;
    v_tasks := array_append(v_tasks, t.id);
  end loop;

  -- Pause my running request timers (only requests I handle alone).
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

  insert into pulled_work (dept, member_id, what, location, request_id, paused_tasks, paused_requests)
  values (p_dept, v_me, trim(p_what), nullif(trim(p_location), ''), p_request, v_tasks, v_reqs)
  returning id into v_id;
  return v_id;
end $$;

-- End it (yours, or anyone's if you're an admin) and continue what it paused.
create or replace function pulled_end(p_id bigint, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  w pulled_work;
begin
  update pulled_work set ended_at = now(), note = coalesce(nullif(trim(p_note), ''), note),
         paused_seconds = paused_seconds + coalesce(greatest(0, extract(epoch from now() - paused_at)::integer), 0), paused_at = null
   where id = p_id and ended_at is null and (member_id = current_member_id() or is_team_admin())
  returning * into w;
  if not found then raise exception 'That one is already finished, or isn''t yours'; end if;
  update checklist_tasks set timer_started_at = now()
   where id = any (w.paused_tasks) and timer_started_at is null and status = 'Working on it' and not archived;
  update maint_requests set timer_started_at = now()
   where id = any (w.paused_requests) and timer_started_at is null and status not in ('Complete', 'Declined');
end $$;

-- Pause (lunch, a break) or resume what you got pulled to.
create or replace function pulled_pause(p_id bigint, p_pause boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_pause then
    update pulled_work set paused_at = now()
     where id = p_id and ended_at is null and paused_at is null and (member_id = current_member_id() or is_team_admin());
  else
    update pulled_work set paused_seconds = paused_seconds + greatest(0, extract(epoch from now() - paused_at)::integer), paused_at = null
     where id = p_id and ended_at is null and paused_at is not null and (member_id = current_member_id() or is_team_admin());
  end if;
  if not found then raise exception 'That one is already finished, or isn''t yours'; end if;
end $$;

revoke execute on function pulled_start(text, text, text, bigint), pulled_end(bigint, text), pulled_pause(bigint, boolean) from public, anon;
grant execute on function pulled_start(text, text, text, bigint), pulled_end(bigint, text), pulled_pause(bigint, boolean) to authenticated;

-- People can be put on get-ready steps too (e.g. "Order filters"), not only main tasks.
create or replace function pm_set_assignees(p_task bigint, p_people uuid[]) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not can_use_pm() then raise exception 'Only maintenance managers and admins can change the schedule'; end if;
  update pm_tasks
     set assignees = coalesce(array(select distinct x from unnest(p_people) x
                                     where x in (select id from team_members where active)), '{}')
   where id = p_task;
  if not found then raise exception 'No such task'; end if;
end $$;
revoke execute on function pm_set_assignees(bigint, uuid[]) from public, anon;
grant execute on function pm_set_assignees(bigint, uuid[]) to authenticated;
