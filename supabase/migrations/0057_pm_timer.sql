-- Maintenance rounds get a Start / Stop timer like Custodial tasks.
-- Starting puts you on the task; checking it off (done or skipped) stops the
-- clock and keeps the time. Getting pulled away pauses rounds you're on alone,
-- and "I'm back" starts them again.

alter table pm_runs add column if not exists timer_started_at timestamptz;
alter table pm_runs add column if not exists worked_seconds integer not null default 0;

create table if not exists pm_time (
  id          bigint generated always as identity primary key,
  run_id      bigint not null references pm_runs(id) on delete cascade,
  member_id   uuid references team_members(id),
  started_at  timestamptz not null,
  ended_at    timestamptz not null
);
create index if not exists pm_time_run_idx on pm_time (run_id);
alter table pm_time enable row level security;
drop policy if exists pm_time_read on pm_time;
create policy pm_time_read on pm_time for select to authenticated using (can_work_pm());

alter table pulled_work add column if not exists paused_pm bigint[] not null default '{}';

-- Stop a round's clock and log the time (internal).
create or replace function pm_stop_clock(p_run bigint) returns void
language plpgsql security definer set search_path = public as $$
declare r pm_runs;
begin
  select * into r from pm_runs where id = p_run for update;
  if not found or r.timer_started_at is null then return; end if;
  insert into pm_time (run_id, member_id, started_at, ended_at) values (r.id, current_member_id(), r.timer_started_at, now());
  update pm_runs set worked_seconds = worked_seconds + greatest(0, extract(epoch from now() - r.timer_started_at)::integer),
                     timer_started_at = null
   where id = r.id;
end $$;
revoke execute on function pm_stop_clock(bigint) from public, anon, authenticated;

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
    if r.timer_started_at is null then update pm_runs set timer_started_at = now() where id = p_run; end if;
    -- Starting it puts you on it.
    if v_me is not null then
      update pm_tasks set assignees = array_append(coalesce(assignees, '{}'), v_me)
       where id = r.task_id and not (v_me = any (coalesce(assignees, '{}')));
    end if;
  else
    perform pm_stop_clock(p_run);
  end if;
end $$;
revoke execute on function pm_timer(bigint, boolean) from public, anon;
grant execute on function pm_timer(bigint, boolean) to authenticated;

-- Checking off stops the clock.
create or replace function pm_mark(p_run bigint, p_status text, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  r pm_runs;
begin
  if not can_work_pm() then raise exception 'Only maintenance managers and admins can check off the schedule'; end if;
  if p_status not in ('done', 'skipped', 'open') then raise exception 'Bad status'; end if;
  select * into r from pm_runs where id = p_run for update;
  if not found then raise exception 'No such task'; end if;
  if p_status in ('done', 'skipped') then perform pm_stop_clock(p_run); end if;
  update pm_runs set
    status  = case when p_status = 'open' and r.period_end < pm_today() then 'missed' else p_status end,
    done_by = case when p_status = 'open' then null else current_member_id() end,
    done_at = case when p_status = 'open' then null else now() end,
    note    = coalesce(nullif(trim(p_note), ''), case when p_status = 'open' then null else r.note end)
  where id = p_run;
end $$;

-- Pulled away: also pause maintenance rounds you're on alone; back: start them again.
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

  for t in select r.id from pm_runs r join pm_tasks k on k.id = r.task_id
            where r.timer_started_at is not null and k.assignees = array[v_me] loop
    perform pm_stop_clock(t.id);
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
  update pm_runs set timer_started_at = now()
   where id = any (w.paused_pm) and timer_started_at is null and status in ('open', 'missed');
end $$;
