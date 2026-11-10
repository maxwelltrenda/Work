-- Alerts when work is checked off: a Maintenance round or a Custodial task.
-- They go in notifications (kind 'done', site 'facilities'), so Facilities
-- admins see them under the bell and get a push on devices that turned it on.

alter table notifications drop constraint if exists notifications_kind_check;
alter table notifications add constraint notifications_kind_check check (kind in ('out', 'in', 'low', 'done'));
alter table notifications add column if not exists link text;   -- page to open, e.g. '#/schedule'

create or replace function notify_pm_done() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  t pm_tasks;
  p pm_tasks;
  v_by text;
begin
  if new.status = 'done' and old.status is distinct from 'done' then
    select * into t from pm_tasks where id = new.task_id;
    if t.parent_id is not null then select * into p from pm_tasks where id = t.parent_id; end if;
    v_by := coalesce((select name from team_members where id = new.done_by), my_name());
    insert into notifications (site, kind, title, body, link)
    values ('facilities', 'done',
            'Maintenance done: ' || coalesce(t.name, 'a task'),
            'By ' || v_by
              || case when p.id is not null then ' · before ' || p.name else '' end
              || case when new.due_on < (now() at time zone 'America/Chicago')::date then ' · late (was due ' || to_char(new.due_on, 'Mon FMDD') || ')' else '' end,
            '#/schedule');
  end if;
  return new;
end $$;
drop trigger if exists pm_runs_notify_done on pm_runs;
create trigger pm_runs_notify_done after update on pm_runs for each row execute function notify_pm_done();

create or replace function notify_checklist_done() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.week_of is not null and new.status = 'Done' and old.status is distinct from 'Done' then
    insert into notifications (site, kind, title, body, link)
    values ('facilities', 'done', 'Custodial done: ' || new.name,
            'By ' || coalesce(nullif(my_name(), 'System'), nullif(new.who, ''), 'someone') || coalesce(' · ' || new.day, ''),
            '#/checklist');
  end if;
  return new;
end $$;
drop trigger if exists checklist_tasks_notify_done on checklist_tasks;
create trigger checklist_tasks_notify_done after update on checklist_tasks for each row execute function notify_checklist_done();
