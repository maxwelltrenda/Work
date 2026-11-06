-- Maintenance schedule: recurring upkeep on fixed calendar periods.
--   pm_tasks = the master list. Each task repeats weekly, monthly, quarterly or
--              yearly, and can have a window: "due within the first N days of
--              the period" (AC filters: quarterly, first 14 days). No window =
--              any time before the period ends.
--   pm_runs  = one row per task per period (this week / month / quarter / year).
--              Opening the page calls pm_refresh(), which adds the current
--              period's rows and marks anything left open from an ended period
--              as Missed. Missed rows stay as history.
-- Periods follow the calendar in Central time: weeks start Sunday, months on
-- the 1st, quarters Jan 1 / Apr 1 / Jul 1 / Oct 1, years Jan 1.
-- Who: Maintenance managers and admins see it, check things off and manage the
-- task list. Everything changes through the functions below.

create table if not exists pm_tasks (
  id          bigint generated always as identity primary key,
  name        text not null check (trim(name) <> ''),
  frequency   text not null check (frequency in ('weekly', 'monthly', 'quarterly', 'yearly')),
  due_days    integer check (due_days is null or due_days between 1 and 366),
  location    text,
  notes       text,
  steps       text[] not null default '{}',
  active      boolean not null default true,
  active_since date not null default ((now() at time zone 'America/Chicago')::date),
  sort        integer not null default 0,
  created_by  uuid references team_members(id),
  created_at  timestamptz not null default now()
);

create table if not exists pm_runs (
  id            bigint generated always as identity primary key,
  task_id       bigint not null references pm_tasks(id) on delete cascade,
  period_start  date not null,
  period_end    date not null,
  due_on        date not null,
  status        text not null default 'open' check (status in ('open', 'done', 'skipped', 'missed')),
  steps_done    integer[] not null default '{}',
  done_by       uuid references team_members(id),
  done_at       timestamptz,
  note          text,
  unique (task_id, period_start)
);
create index if not exists pm_runs_open_idx on pm_runs (status, period_end);

create or replace function can_use_pm() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(my_role() in ('admin', 'maintenance'), false)
$$;

alter table pm_tasks enable row level security;
alter table pm_runs enable row level security;
create policy pm_read on pm_tasks for select to authenticated using (can_use_pm());
create policy pm_read on pm_runs for select to authenticated using (can_use_pm());

create or replace function pm_today() returns date
language sql stable as $$ select (now() at time zone 'America/Chicago')::date $$;

create or replace function pm_period_start(p_freq text, p_day date) returns date
language sql immutable as $$
  select case p_freq
    when 'weekly' then p_day - extract(dow from p_day)::int
    when 'monthly' then date_trunc('month', p_day)::date
    when 'quarterly' then date_trunc('quarter', p_day)::date
    else date_trunc('year', p_day)::date end
$$;

create or replace function pm_period_end(p_freq text, p_start date) returns date
language sql immutable as $$
  select (p_start + case p_freq when 'weekly' then interval '7 days' when 'monthly' then interval '1 month'
                                when 'quarterly' then interval '3 months' else interval '1 year' end)::date - 1
$$;

create or replace function pm_step_interval(p_freq text) returns interval
language sql immutable as $$
  select case p_freq when 'weekly' then interval '7 days' when 'monthly' then interval '1 month'
                     when 'quarterly' then interval '3 months' else interval '1 year' end
$$;

-- Bring the schedule up to date: close out ended periods, open current ones,
-- and record any whole period nobody opened the page in as Missed. A task's
-- first period (when it's added or put back) is due by the end of that period
-- if its window has already gone by.
create or replace function pm_refresh() returns date
language plpgsql security definer set search_path = public as $$
declare
  v_today date := pm_today();
begin
  if not can_use_pm() then raise exception 'Only maintenance managers and admins can use the schedule'; end if;
  update pm_runs set status = 'missed' where status = 'open' and period_end < v_today;
  insert into pm_runs (task_id, period_start, period_end, due_on, status)
  select t.id, p.ps, p.pe,
         case when p.ps = pm_period_start(t.frequency, t.active_since) and p.win < t.active_since then p.pe else p.win end,
         case when p.pe < v_today then 'missed' else 'open' end
    from pm_tasks t
    cross join lateral (select greatest(pm_period_start(t.frequency, t.active_since),
                                        coalesce((select max(r.period_start) from pm_runs r where r.task_id = t.id), '-infinity'::date)) as first) f
    cross join lateral generate_series(f.first, pm_period_start(t.frequency, v_today), pm_step_interval(t.frequency)) g(d)
    cross join lateral (select g.d::date as ps, pm_period_end(t.frequency, g.d::date) as pe,
                               least(pm_period_end(t.frequency, g.d::date),
                                     case when t.due_days is null then pm_period_end(t.frequency, g.d::date) else g.d::date + t.due_days - 1 end) as win) p
   where t.active
  on conflict (task_id, period_start) do nothing;
  return v_today;
end $$;

-- Add (p_id null) or change a task. The current period's row follows the change
-- unless it's already been done.
create or replace function pm_save_task(p_id bigint, p_name text, p_frequency text, p_due_days integer,
                                        p_location text, p_notes text, p_steps text[]) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_id bigint := p_id;
begin
  if not can_use_pm() then raise exception 'Only maintenance managers and admins can change the schedule'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Give the task a name'; end if;
  if p_frequency not in ('weekly', 'monthly', 'quarterly', 'yearly') then raise exception 'Pick how often'; end if;
  if v_id is null then
    insert into pm_tasks (name, frequency, due_days, location, notes, steps, created_by, sort, active_since)
    values (trim(p_name), p_frequency, p_due_days, nullif(trim(p_location), ''), nullif(trim(p_notes), ''),
            coalesce(array_remove(array(select trim(x) from unnest(p_steps) x), ''), '{}'), current_member_id(),
            coalesce((select max(sort) + 1 from pm_tasks), 0), pm_today())
    returning id into v_id;
  else
    update pm_tasks set name = trim(p_name), frequency = p_frequency, due_days = p_due_days,
           location = nullif(trim(p_location), ''), notes = nullif(trim(p_notes), ''),
           steps = coalesce(array_remove(array(select trim(x) from unnest(p_steps) x), ''), '{}')
     where id = v_id;
    if not found then raise exception 'No such task'; end if;
    delete from pm_runs where task_id = v_id and status = 'open' and period_end >= pm_today();
  end if;
  perform pm_refresh();
  return v_id;
end $$;

-- Take a task off the schedule (its history stays), or put it back.
create or replace function pm_set_active(p_id bigint, p_active boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not can_use_pm() then raise exception 'Only maintenance managers and admins can change the schedule'; end if;
  update pm_tasks set active = p_active,
         active_since = case when p_active and not active then pm_today() else active_since end
   where id = p_id;
  if not p_active then
    delete from pm_runs where task_id = p_id and status = 'open' and period_end >= pm_today();
  end if;
  perform pm_refresh();
end $$;

-- Mark this period's task done, skipped, or back to open. A missed task can
-- still be marked done late.
create or replace function pm_mark(p_run bigint, p_status text, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  r pm_runs;
begin
  if not can_use_pm() then raise exception 'Only maintenance managers and admins can check off the schedule'; end if;
  if p_status not in ('done', 'skipped', 'open') then raise exception 'Bad status'; end if;
  select * into r from pm_runs where id = p_run for update;
  if not found then raise exception 'No such task'; end if;
  update pm_runs set
    status  = case when p_status = 'open' and r.period_end < pm_today() then 'missed' else p_status end,
    done_by = case when p_status = 'open' then null else current_member_id() end,
    done_at = case when p_status = 'open' then null else now() end,
    note    = coalesce(nullif(trim(p_note), ''), case when p_status = 'open' then null else r.note end)
  where id = p_run;
end $$;

-- Tick one step of a task on or off.
create or replace function pm_step(p_run bigint, p_index integer, p_done boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not can_use_pm() then raise exception 'Only maintenance managers and admins can check off the schedule'; end if;
  update pm_runs set steps_done = case when p_done then array(select distinct x from unnest(array_append(steps_done, p_index)) x order by x)
                                       else array_remove(steps_done, p_index) end
   where id = p_run;
end $$;

revoke execute on function can_use_pm(), pm_refresh(), pm_save_task(bigint, text, text, integer, text, text, text[]),
  pm_set_active(bigint, boolean), pm_mark(bigint, text, text), pm_step(bigint, integer, boolean) from public, anon;
grant execute on function can_use_pm(), pm_refresh(), pm_save_task(bigint, text, text, integer, text, text, text[]),
  pm_set_active(bigint, boolean), pm_mark(bigint, text, text), pm_step(bigint, integer, boolean) to authenticated;
