-- Partnering with Events: a Maintenance task can be "shared with Events".
-- Shared tasks (and their rounds and updates) show on the Events site too, and
-- Events people can be put on them. Only Facilities managers change them.

alter table pm_tasks add column if not exists shared_events boolean not null default false;

create or replace function is_events_person() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select events_role is not null from team_members where id = current_member_id() and active), false)
$$;

create or replace function pm_shared_task(p_task bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select shared_events from pm_tasks where id = p_task), false)
$$;

drop policy if exists pm_read on pm_tasks;
create policy pm_read on pm_tasks for select to authenticated
  using (can_work_pm() or (shared_events and is_events_person()));
drop policy if exists pm_read on pm_runs;
create policy pm_read on pm_runs for select to authenticated
  using (can_work_pm() or (is_events_person() and pm_shared_task(task_id)));

create or replace function pm_shared_run(p_run bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select t.shared_events from pm_runs r join pm_tasks t on t.id = r.task_id where r.id = p_run), false)
$$;

-- Updates (chat) on shared tasks: Events people can read and post.
drop policy if exists task_notes_read on task_notes;
create policy task_notes_read on task_notes for select to authenticated
  using (case kind when 'custodial' then can_see_boards() when 'pulled' then can_see_boards() or can_work_pm()
                   else can_work_pm() or (is_events_person() and pm_shared_run(task_id)) end);
drop policy if exists task_notes_add on task_notes;
create policy task_notes_add on task_notes for insert to authenticated
  with check (member_id = current_member_id()
              and case kind when 'custodial' then can_edit_boards() when 'pulled' then can_edit_boards() or can_work_pm()
                            else can_work_pm() or (is_events_person() and pm_shared_run(task_id)) end);

create or replace function pm_set_shared(p_task bigint, p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not can_use_pm() then raise exception 'Only maintenance managers and admins can change the schedule'; end if;
  update pm_tasks set shared_events = coalesce(p_on, false) where id = p_task;
  if not found then raise exception 'No such task'; end if;
end $$;
revoke execute on function pm_set_shared(bigint, boolean) from public, anon;
grant execute on function pm_set_shared(bigint, boolean) to authenticated;

-- @mentions can reach Events people too (they see shared tasks on the Events page).
create or replace function notify_task_note() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_name text;
  v_link text;
  m record;
begin
  if position('@' in new.body) = 0 then return new; end if;
  if new.kind = 'custodial' then
    select name, '#/checklist' into v_name, v_link from checklist_tasks where id = new.task_id;
  elsif new.kind = 'pulled' then
    select what, case when dept = 'maintenance' then '#/schedule' else '#/checklist' end into v_name, v_link from pulled_work where id = new.task_id;
  else
    select k.name, '#/schedule' into v_name, v_link from pm_runs r join pm_tasks k on k.id = r.task_id where r.id = new.task_id;
  end if;
  for m in
    select t.id, t.role from team_members t
     where t.active and (t.role not in ('none', 'kiosk') or t.events_role is not null)
       and (lower(new.body) like '%@' || lower(t.name) || '%'
            or (lower(new.body) ~ ('@' || lower(split_part(t.name, ' ', 1)) || '([^a-z]|$)')
                and (select count(*) from team_members u where u.active and (u.role not in ('none', 'kiosk') or u.events_role is not null)
                      and lower(split_part(u.name, ' ', 1)) = lower(split_part(t.name, ' ', 1))) = 1))
  loop
    perform notify_person(m.id, coalesce(split_part(new.author, ' ', 1), 'Someone') || ' mentioned you on ' || coalesce(v_name, 'a task'),
                          left(new.body, 140), case when m.role in ('none', 'oversight') and new.kind = 'maintenance' then '#/events' else v_link end);
  end loop;
  return new;
end $$;
