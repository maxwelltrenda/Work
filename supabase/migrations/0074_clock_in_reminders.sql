-- "Time to clock in": when a scheduled task's start time comes (a one-time
-- task with a "From" time, Maintenance or Custodial), everyone on it who
-- isn't clocked in gets an alert. Checked every 5 minutes; one alert each.
create extension if not exists pg_cron with schema pg_catalog;

create table if not exists clock_reminders (
  kind       text not null,
  task_id    bigint not null,
  member_id  uuid not null references team_members(id) on delete cascade,
  sent_at    timestamptz not null default now(),
  primary key (kind, task_id, member_id)
);
alter table clock_reminders enable row level security;   -- server only

create or replace function clock_in_reminders() returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_now timestamp := (now() at time zone 'America/Chicago');
  v_today date := v_now::date;
  v_sent integer := 0;
  r record;
  hm text;
begin
  -- Maintenance one-time tasks with a time slot today.
  for r in
    select run.id, k.name, k.once_from, k.once_to, a.member
      from pm_runs run join pm_tasks k on k.id = run.task_id,
           unnest(k.assignees) a(member)
     where k.active and k.frequency = 'once' and k.once_from is not null
       and run.status = 'open' and run.due_on = v_today
       and v_now >= v_today + k.once_from
       and v_now < v_today + coalesce(k.once_to, k.once_from + interval '2 hours')
       and not (a.member = any (run.clocked))
       and not exists (select 1 from clock_reminders c where c.kind = 'maintenance' and c.task_id = run.id and c.member_id = a.member)
  loop
    hm := to_char(r.once_from, 'FMHH12:MI AM') || coalesce('–' || to_char(r.once_to, 'FMHH12:MI AM'), '');
    perform notify_person(r.member, 'Time to clock in: ' || r.name, hm || ' · tap ▶ Start on My day', '#/myday');
    insert into clock_reminders (kind, task_id, member_id) values ('maintenance', r.id, r.member) on conflict do nothing;
    v_sent := v_sent + 1;
  end loop;

  -- Custodial one-time tasks with a time slot today.
  for r in
    select t.id, t.name, t.once_from, t.once_to, m.id member
      from checklist_tasks t
      join team_members m on m.active and lower(m.name) in (select lower(trim(x)) from unnest(string_to_array(coalesce(t.who, ''), ',')) x)
     where t.week_of is not null and not t.archived and t.once_from is not null
       and t.once_on = v_today and t.status in ('Not started', 'Working on it')
       and v_now >= v_today + t.once_from
       and v_now < v_today + coalesce(t.once_to, t.once_from + interval '2 hours')
       and not (m.name = any (t.clocked))
       and not exists (select 1 from clock_reminders c where c.kind = 'custodial' and c.task_id = t.id and c.member_id = m.id)
  loop
    hm := to_char(r.once_from, 'FMHH12:MI AM') || coalesce('–' || to_char(r.once_to, 'FMHH12:MI AM'), '');
    perform notify_person(r.member, 'Time to clock in: ' || r.name, hm || ' · tap ▶ Start on My day', '#/myday');
    insert into clock_reminders (kind, task_id, member_id) values ('custodial', r.id, r.member) on conflict do nothing;
    v_sent := v_sent + 1;
  end loop;
  return v_sent;
end $$;
revoke execute on function clock_in_reminders() from public, anon, authenticated;

select cron.unschedule('clock-in-reminders') where exists (select 1 from cron.job where jobname = 'clock-in-reminders');
select cron.schedule('clock-in-reminders', '*/5 * * * *', 'select public.clock_in_reminders()');

-- (from 0073) Marking a task Done also closes each person's own time.
drop trigger if exists checklist_sessions on checklist_tasks;
create trigger checklist_sessions after insert or update on checklist_tasks
  for each row execute function checklist_sessions();
drop trigger if exists pm_sessions on pm_runs;
create trigger pm_sessions after insert or update on pm_runs
  for each row execute function pm_sessions();
update work_sessions s set ended_at = coalesce(
    (select greatest(s.started_at, coalesce(t.done_on, now())) from checklist_tasks t where t.id = s.task_id), now())
 where s.kind = 'custodial' and s.ended_at is null
   and not exists (select 1 from checklist_tasks t, team_members m where t.id = s.task_id and m.id = s.member_id and m.name = any (t.clocked));
update work_sessions s set ended_at = coalesce(
    (select greatest(s.started_at, coalesce(r.done_at, now())) from pm_runs r where r.id = s.task_id), now())
 where s.kind = 'maintenance' and s.ended_at is null
   and not exists (select 1 from pm_runs r where r.id = s.task_id and s.member_id = any (r.clocked));
