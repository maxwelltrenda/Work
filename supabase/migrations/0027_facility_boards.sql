-- Facility boards: Maintenance Requests and the Custodial Weekly Checklist,
-- rebuilt from the two monday.com boards (same groups, columns, status labels
-- and automations).
--
-- Who can use them (Facilities roles):
--   see:  admin, member, maintenance, custodian, oversight
--   edit: admin, member, maintenance, custodian
--   delete a request: admin
--
-- Automations from Monday, done here by triggers so every path follows them:
--   Maintenance Requests
--     * Status In Progress  -> In Progress group, start "Time to resolve"
--     * Status Executive    -> Executive Requests group
--     * Status Complete     -> Ticket solved group, stop the timer, Completion Date = today
--     * Status Declined     -> Ticket solved group, stop the timer
--     * Any other status change on a solved ticket moves it back to New ticket
--     * Every status change except New queues an email to the requester
--       (written to the request's activity; nothing is sent yet)
--   Custodial Weekly Checklist
--     * Working on it -> start Time; fill Who with the person if empty
--     * Done          -> stop Time, Done On = now; fill Who if empty
--     * Missed        -> stop Time
--     * Each week (Sunday) the template is copied into a new week; last week's
--       unfinished tasks become Missed and move to Past Weeks (start_checklist_week)

create or replace function can_see_boards() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(my_role() in ('admin', 'member', 'maintenance', 'custodian', 'oversight'), false)
$$;

create or replace function can_edit_boards() returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when auth.jwt() ->> 'email' is null then true
    else coalesce(my_role() in ('admin', 'member', 'maintenance', 'custodian'), false)
  end
$$;

create or replace function my_name() returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select name from team_members where id = current_member_id()), 'System')
$$;

-- ---------------------------------------------------------------------------
-- Maintenance Requests
-- ---------------------------------------------------------------------------

create table if not exists maint_requests (
  id                bigint generated always as identity primary key,
  monday_id         bigint unique,
  subject           text not null,
  status            text not null default 'New' check (status in (
                      'New', 'In Progress', 'Scheduled', 'Needs Scheduled', 'Needs Ordered', 'Ordered', 'Paused',
                      'Project', 'Needs Onsite Visit', 'Waiting for Approval', 'Executive', 'Complete', 'Declined')),
  board_group       text not null default 'new' check (board_group in ('new', 'in_progress', 'pending_reply', 'executive', 'solved')),
  requester_name    text,
  requester_email   text,
  requester_phone   text,
  campus            text,
  department        text,
  staff_type        text,
  oversight         text,
  support_team      text,
  priority          text,
  experts           text[] not null default '{}',   -- "Category expert"
  needs             jsonb not null default '{}',    -- {"Maintenance": "Handyman", "Custodial": ...}
  access_reason     text,
  location          text,
  details           text,
  task_description  text,
  progress_summary  text,
  notes             text,
  request_category  text,
  repeat_request    text,
  cost              numeric,
  due_date          date,
  completion_date   date,
  timer_started_at  timestamptz,
  worked_seconds    integer not null default 0,
  created_by_name   text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  extra             jsonb not null default '{}'     -- links from Monday: form, receipt, files, Zendesk
);
create index if not exists maint_requests_group_idx on maint_requests (board_group, created_at desc);

create table if not exists maint_subtasks (
  id              bigint generated always as identity primary key,
  request_id      bigint not null references maint_requests(id) on delete cascade,
  name            text not null,
  owner           text,
  status          text check (status is null or status in ('Working on it', 'Done', 'Stuck')),
  due_date        date,
  tasks_completed text,
  sort            integer not null default 0,
  created_at      timestamptz not null default now()
);
create index if not exists maint_subtasks_req_idx on maint_subtasks (request_id);

create table if not exists maint_updates (
  id          bigint generated always as identity primary key,
  request_id  bigint not null references maint_requests(id) on delete cascade,
  parent_id   bigint references maint_updates(id) on delete cascade,
  kind        text not null default 'update' check (kind in ('update', 'email', 'system')),
  author      text not null default 'System',
  body        text not null,
  monday_id   bigint unique,                       -- the update's id in Monday (imported history)
  created_at  timestamptz not null default now()
);
create index if not exists maint_updates_req_idx on maint_updates (request_id, created_at);

create table if not exists maint_time (
  id          bigint generated always as identity primary key,
  request_id  bigint not null references maint_requests(id) on delete cascade,
  started_by  text,
  ended_by    text,
  started_at  timestamptz not null,
  ended_at    timestamptz not null
);
create index if not exists maint_time_req_idx on maint_time (request_id);

create or replace function maint_request_rules() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_who text := my_name();
begin
  new.updated_at := now();
  if tg_op = 'INSERT' then
    new.created_by_name := coalesce(new.created_by_name, v_who);
    if new.status = 'Executive' then new.board_group := 'executive'; end if;
    if new.status = 'In Progress' then new.board_group := 'in_progress'; new.timer_started_at := coalesce(new.timer_started_at, now()); end if;
    if new.status in ('Complete', 'Declined') then new.board_group := 'solved'; end if;
    return new;
  end if;

  if new.status is distinct from old.status then
    if new.status = 'In Progress' then
      new.board_group := 'in_progress';
      new.timer_started_at := coalesce(new.timer_started_at, now());
    elsif new.status = 'Executive' then
      new.board_group := 'executive';
    elsif new.status in ('Complete', 'Declined') then
      new.board_group := 'solved';
      if new.status = 'Complete' then new.completion_date := coalesce(new.completion_date, current_date); end if;
    elsif old.board_group = 'solved' then
      new.board_group := 'new';
    end if;

    -- Complete or Declined stops "Time to resolve".
    if new.status in ('Complete', 'Declined') and new.timer_started_at is not null then
      insert into maint_time (request_id, started_by, ended_by, started_at, ended_at)
      values (new.id, v_who, v_who, new.timer_started_at, now());
      new.worked_seconds := new.worked_seconds + greatest(0, extract(epoch from now() - new.timer_started_at)::integer);
      new.timer_started_at := null;
    end if;

    insert into maint_updates (request_id, kind, author, body)
    values (new.id, 'system', v_who, 'Status: ' || old.status || ' → ' || new.status);

    if new.status <> 'New' and coalesce(new.requester_email, '') <> '' then
      insert into maint_updates (request_id, kind, author, body)
      values (new.id, 'email', 'Automation',
              'Email to ' || new.requester_email || ': your request "' || new.subject || '" is now ' || new.status
              || '. (Queued; email sending is not switched on yet.)');
    end if;
  end if;
  return new;
end $$;

drop trigger if exists maint_requests_rules on maint_requests;
create trigger maint_requests_rules before insert or update on maint_requests
  for each row execute function maint_request_rules();

-- Start or stop the timer by hand (the Time to resolve column's play button).
create or replace function maint_timer(p_id bigint, p_run boolean) returns void
language plpgsql security definer set search_path = public as $$
declare
  r maint_requests;
  v_who text := my_name();
begin
  if not can_edit_boards() then raise exception 'Your role is view-only'; end if;
  select * into r from maint_requests where id = p_id for update;
  if not found then raise exception 'Request not found'; end if;
  if p_run and r.timer_started_at is null then
    update maint_requests set timer_started_at = now() where id = p_id;
  elsif not p_run and r.timer_started_at is not null then
    insert into maint_time (request_id, started_by, ended_by, started_at, ended_at)
    values (p_id, v_who, v_who, r.timer_started_at, now());
    update maint_requests
       set worked_seconds = worked_seconds + greatest(0, extract(epoch from now() - r.timer_started_at)::integer),
           timer_started_at = null
     where id = p_id;
  end if;
end $$;

-- "Send reply to requester" button.
create or replace function maint_send_reply(p_id bigint, p_message text) returns void
language plpgsql security definer set search_path = public as $$
declare
  r maint_requests;
begin
  if not can_edit_boards() then raise exception 'Your role is view-only'; end if;
  select * into r from maint_requests where id = p_id;
  if not found then raise exception 'Request not found'; end if;
  if coalesce(r.requester_email, '') = '' then raise exception 'This request has no requester email'; end if;
  insert into maint_updates (request_id, kind, author, body)
  values (p_id, 'email', my_name(), 'Reply to ' || r.requester_email || ': ' || coalesce(nullif(trim(p_message), ''), '(no message)')
          || ' (Queued; email sending is not switched on yet.)');
end $$;

-- ---------------------------------------------------------------------------
-- Custodial Weekly Checklist
-- ---------------------------------------------------------------------------

create table if not exists checklist_tasks (
  id               bigint generated always as identity primary key,
  monday_id        bigint unique,
  week_of          date,                 -- the Sunday the week starts; null = TEMPLATE row
  archived         boolean not null default false,   -- Past Weeks (time log)
  template_id      bigint references checklist_tasks(id) on delete set null,
  name             text not null,
  area             text check (area is null or area in ('Building', 'Offices', 'Sign-off')),
  status           text not null default 'Not started' check (status in ('Not started', 'Working on it', 'Done', 'Skipped', 'Missed')),
  who              text,
  day              text check (day is null or day in ('Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Detail Work')),
  includes         text,
  timer_started_at timestamptz,
  worked_seconds   integer not null default 0,
  manual_hours     numeric,
  done_on          timestamptz,
  clear_on         date,
  sort             integer not null default 0,
  created_at       timestamptz not null default now()
);
create index if not exists checklist_tasks_week_idx on checklist_tasks (week_of, archived);

create table if not exists checklist_subtasks (
  id       bigint generated always as identity primary key,
  task_id  bigint not null references checklist_tasks(id) on delete cascade,
  name     text not null,
  done     boolean not null default false,
  sort     integer not null default 0
);
create index if not exists checklist_subtasks_task_idx on checklist_subtasks (task_id);

create table if not exists checklist_time (
  id          bigint generated always as identity primary key,
  task_id     bigint not null references checklist_tasks(id) on delete cascade,
  started_by  text,
  ended_by    text,
  started_at  timestamptz not null,
  ended_at    timestamptz not null
);
create index if not exists checklist_time_task_idx on checklist_time (task_id);

create or replace function checklist_task_rules() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_who text := my_name();
begin
  if tg_op = 'UPDATE' and new.status is distinct from old.status and new.week_of is not null then
    if new.status = 'Working on it' then
      new.timer_started_at := coalesce(new.timer_started_at, now());
      if coalesce(new.who, '') = '' and v_who <> 'System' then new.who := v_who; end if;
    elsif new.status in ('Done', 'Missed', 'Skipped', 'Not started') and new.timer_started_at is not null then
      insert into checklist_time (task_id, started_by, ended_by, started_at, ended_at)
      values (new.id, v_who, v_who, new.timer_started_at, now());
      new.worked_seconds := new.worked_seconds + greatest(0, extract(epoch from now() - new.timer_started_at)::integer);
      new.timer_started_at := null;
    end if;
    if new.status = 'Done' then
      new.done_on := now();
      if coalesce(new.who, '') = '' and v_who <> 'System' then new.who := v_who; end if;
    elsif old.status = 'Done' then
      new.done_on := null;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists checklist_tasks_rules on checklist_tasks;
create trigger checklist_tasks_rules before update on checklist_tasks
  for each row execute function checklist_task_rules();

-- Opening the checklist calls this. If this week (starting Sunday, Central
-- time) hasn't been made yet: last week's unfinished tasks become Missed and
-- every older week moves to Past Weeks, then the template is copied in.
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

  for t in select * from checklist_tasks where week_of is null order by sort, id loop
    insert into checklist_tasks (week_of, template_id, name, area, status, day, includes, clear_on, sort)
    values (v_week, t.id, t.name, t.area, 'Not started', t.day, t.includes, v_week + 6, t.sort)
    returning id into v_new;
    insert into checklist_subtasks (task_id, name, sort)
    select v_new, name, sort from checklist_subtasks where task_id = t.id order by sort, id;
  end loop;
  return v_week;
end $$;

create or replace function checklist_timer(p_id bigint, p_run boolean) returns void
language plpgsql security definer set search_path = public as $$
declare
  r checklist_tasks;
  v_who text := my_name();
begin
  if not can_edit_boards() then raise exception 'Your role is view-only'; end if;
  select * into r from checklist_tasks where id = p_id for update;
  if not found then raise exception 'Task not found'; end if;
  if p_run and r.timer_started_at is null then
    update checklist_tasks set timer_started_at = now(),
           who = case when coalesce(who, '') = '' and v_who <> 'System' then v_who else who end
     where id = p_id;
  elsif not p_run and r.timer_started_at is not null then
    insert into checklist_time (task_id, started_by, ended_by, started_at, ended_at)
    values (p_id, v_who, v_who, r.timer_started_at, now());
    update checklist_tasks
       set worked_seconds = worked_seconds + greatest(0, extract(epoch from now() - r.timer_started_at)::integer),
           timer_started_at = null
     where id = p_id;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------

alter table maint_requests     enable row level security;
alter table maint_subtasks     enable row level security;
alter table maint_updates      enable row level security;
alter table maint_time         enable row level security;
alter table checklist_tasks    enable row level security;
alter table checklist_subtasks enable row level security;
alter table checklist_time     enable row level security;

do $$
declare t text;
begin
  foreach t in array array['maint_requests', 'maint_subtasks', 'maint_updates', 'maint_time',
                           'checklist_tasks', 'checklist_subtasks', 'checklist_time'] loop
    execute format('drop policy if exists boards_read on %I', t);
    execute format('drop policy if exists boards_insert on %I', t);
    execute format('drop policy if exists boards_update on %I', t);
    execute format('drop policy if exists boards_delete on %I', t);
    execute format('create policy boards_read on %I for select to authenticated using (can_see_boards())', t);
  end loop;
  -- Time logs are written only by the triggers and timer functions.
  foreach t in array array['maint_requests', 'maint_subtasks', 'maint_updates', 'checklist_tasks', 'checklist_subtasks'] loop
    execute format('create policy boards_insert on %I for insert to authenticated with check (can_edit_boards())', t);
    execute format('create policy boards_update on %I for update to authenticated using (can_edit_boards()) with check (can_edit_boards())', t);
  end loop;
  foreach t in array array['maint_subtasks', 'checklist_subtasks'] loop
    execute format('create policy boards_delete on %I for delete to authenticated using (can_edit_boards())', t);
  end loop;
end $$;

create policy boards_delete on maint_requests for delete to authenticated using (is_team_admin());
create policy boards_delete on checklist_tasks for delete to authenticated using (is_team_admin());
-- Updates: anyone who can edit can remove their own note; admins any.
create policy boards_delete on maint_updates for delete to authenticated
  using (is_team_admin() or (can_edit_boards() and kind = 'update' and author = my_name()));

grant execute on function start_checklist_week() to authenticated;
grant execute on function checklist_timer(bigint, boolean) to authenticated;
grant execute on function maint_timer(bigint, boolean) to authenticated;
grant execute on function maint_send_reply(bigint, text) to authenticated;
