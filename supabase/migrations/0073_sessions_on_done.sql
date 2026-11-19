-- Fix: marking a Custodial task Done (or Missed/Skipped/Not started) empties
-- "clocked" inside a BEFORE trigger, which an "update of clocked" trigger
-- doesn't see. Watch every update instead, so each person's time closes too.
drop trigger if exists checklist_sessions on checklist_tasks;
create trigger checklist_sessions after insert or update on checklist_tasks
  for each row execute function checklist_sessions();
drop trigger if exists pm_sessions on pm_runs;
create trigger pm_sessions after insert or update on pm_runs
  for each row execute function pm_sessions();

-- Close any session left open on a task nobody is clocked in on anymore.
update work_sessions s set ended_at = coalesce(
    (select greatest(s.started_at, coalesce(t.done_on, now())) from checklist_tasks t where t.id = s.task_id), now())
 where s.kind = 'custodial' and s.ended_at is null
   and not exists (select 1 from checklist_tasks t, team_members m where t.id = s.task_id and m.id = s.member_id and m.name = any (t.clocked));
update work_sessions s set ended_at = coalesce(
    (select greatest(s.started_at, coalesce(r.done_at, now())) from pm_runs r where r.id = s.task_id), now())
 where s.kind = 'maintenance' and s.ended_at is null
   and not exists (select 1 from pm_runs r where r.id = s.task_id and s.member_id = any (r.clocked));
