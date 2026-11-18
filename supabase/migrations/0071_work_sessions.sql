-- Each person's own time on a task. A row opens when someone is added to a
-- task's "clocked in" list and closes when they leave it (Stop, Done, pulled
-- away...). Works for Custodial tasks (clocked = names) and Maintenance
-- rounds (clocked = member ids) without changing any of the buttons.
create table if not exists work_sessions (
  id          bigint generated always as identity primary key,
  kind        text not null check (kind in ('custodial', 'maintenance')),
  task_id     bigint not null,          -- checklist_tasks.id or pm_runs.id
  member_id   uuid not null references team_members(id) on delete cascade,
  started_at  timestamptz not null default now(),
  ended_at    timestamptz,
  check (ended_at is null or ended_at >= started_at)
);
create index if not exists work_sessions_task_idx on work_sessions (kind, task_id);
create index if not exists work_sessions_member_idx on work_sessions (member_id, started_at);
create unique index if not exists work_sessions_one_open on work_sessions (kind, task_id, member_id) where ended_at is null;

alter table work_sessions enable row level security;
drop policy if exists work_sessions_read on work_sessions;
create policy work_sessions_read on work_sessions for select to authenticated
  using (case kind when 'custodial' then can_see_boards() else can_work_pm() end);
grant select on work_sessions to authenticated;

create or replace function sessions_sync(p_kind text, p_task bigint, p_old uuid[], p_new uuid[]) returns void
language plpgsql security definer set search_path = public as $$
begin
  update work_sessions set ended_at = now()
   where kind = p_kind and task_id = p_task and ended_at is null
     and not (member_id = any (coalesce(p_new, '{}')));
  insert into work_sessions (kind, task_id, member_id)
  select p_kind, p_task, x from unnest(coalesce(p_new, '{}')) x
   where x is not null and not exists (select 1 from work_sessions s where s.kind = p_kind and s.task_id = p_task and s.member_id = x and s.ended_at is null)
  on conflict do nothing;
end $$;
revoke execute on function sessions_sync(text, bigint, uuid[], uuid[]) from public, anon, authenticated;

create or replace function names_to_ids(p_names text[]) returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct m.id), '{}') from team_members m
   where lower(m.name) in (select lower(trim(x)) from unnest(coalesce(p_names, '{}')) x)
$$;

create or replace function checklist_sessions() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.week_of is null then return new; end if;
  if tg_op = 'INSERT' or new.clocked is distinct from old.clocked then
    perform sessions_sync('custodial', new.id, null, names_to_ids(new.clocked));
  end if;
  return new;
end $$;
drop trigger if exists checklist_sessions on checklist_tasks;
create trigger checklist_sessions after insert or update of clocked on checklist_tasks
  for each row execute function checklist_sessions();

create or replace function pm_sessions() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.clocked is distinct from old.clocked then
    perform sessions_sync('maintenance', new.id, null, new.clocked);
  end if;
  return new;
end $$;
drop trigger if exists pm_sessions on pm_runs;
create trigger pm_sessions after insert or update of clocked on pm_runs
  for each row execute function pm_sessions();

-- Who's clocked in right now gets an open session from when the timer started.
insert into work_sessions (kind, task_id, member_id, started_at)
select 'maintenance', r.id, x, coalesce(r.timer_started_at, now()) from pm_runs r, unnest(r.clocked) x
 where cardinality(r.clocked) > 0
on conflict do nothing;
insert into work_sessions (kind, task_id, member_id, started_at)
select 'custodial', t.id, x, coalesce(t.timer_started_at, now()) from checklist_tasks t, unnest(names_to_ids(t.clocked)) x
 where t.week_of is not null and not t.archived and cardinality(t.clocked) > 0
on conflict do nothing;
