-- Personal alerts: tell a person when someone else gives them work.
--   * put on a Custodial task (checklist_tasks.who, names)
--   * put on a Maintenance task (pm_tasks.assignees, member ids)
--   * given a request (maint_requests.experts, names)
--   * given a to-do on their My tasks list (personal_tasks)
-- A personal alert has member_id set: only that person sees it and gets the
-- push. Alerts without member_id are the admin ones, as before.
-- Also: "Clear" empties your own list (notif_cleared_at), for everyone.

alter table notifications add column if not exists member_id uuid references team_members(id) on delete cascade;
create index if not exists notifications_member_idx on notifications (member_id, created_at desc) where member_id is not null;
alter table notifications drop constraint if exists notifications_kind_check;
alter table notifications add constraint notifications_kind_check check (kind in ('out', 'in', 'low', 'done', 'assigned'));
alter table team_members add column if not exists notif_cleared_at timestamptz;

drop policy if exists admin_read on notifications;
create policy admin_read on notifications for select to authenticated
  using (case when member_id is null then is_site_admin(site) else member_id = current_member_id() end);

-- Clear my list: hide everything up to now (for me only).
create or replace function clear_notifications() returns timestamptz
language plpgsql security definer set search_path = public as $$
declare
  v timestamptz := now();
begin
  perform set_config('app.team_edit', 'on', true);
  update team_members set notif_cleared_at = v, notif_seen_at = v where id = current_member_id();
  return v;
end $$;
revoke execute on function clear_notifications() from public, anon;
grant execute on function clear_notifications() to authenticated;

-- One alert for one person, unless they did it themselves.
create or replace function notify_person(p_member uuid, p_title text, p_body text, p_link text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_member is null or p_member = current_member_id() then return; end if;
  if not exists (select 1 from team_members where id = p_member and active) then return; end if;
  insert into notifications (site, kind, member_id, title, body, link)
  values ('facilities', 'assigned', p_member, p_title, p_body, p_link);
end $$;
revoke execute on function notify_person(uuid, text, text, text) from public, anon, authenticated;

-- Names in a "who" text ("Ann Lee, Bo Diaz") newly added, as team member ids.
create or replace function added_names(p_new text, p_old text) returns setof uuid
language sql stable security definer set search_path = public as $$
  select m.id from team_members m
   where m.active
     and lower(m.name) in (select lower(trim(x)) from unnest(string_to_array(coalesce(p_new, ''), ',')) x)
     and lower(m.name) not in (select lower(trim(x)) from unnest(string_to_array(coalesce(p_old, ''), ',')) x)
$$;
revoke execute on function added_names(text, text) from public, anon, authenticated;

create or replace function by_line() returns text
language sql stable security definer set search_path = public as $$
  select coalesce(nullif(split_part(my_name(), ' ', 1), 'System'), 'Someone')
$$;
revoke execute on function by_line() from public, anon, authenticated;

-- Custodial: someone put on this week's task.
create or replace function notify_checklist_people() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v uuid;
begin
  if new.week_of is null or my_name() = 'System' then return new; end if;
  if tg_op = 'UPDATE' and new.who is not distinct from old.who then return new; end if;
  for v in select added_names(new.who, case when tg_op = 'UPDATE' then old.who end) loop
    perform notify_person(v, by_line() || ' put you on ' || new.name,
                          'Custodial' || coalesce(' · ' || new.day, ''), '#/checklist');
  end loop;
  return new;
end $$;
drop trigger if exists checklist_tasks_notify_people on checklist_tasks;
create trigger checklist_tasks_notify_people after insert or update of who on checklist_tasks
  for each row execute function notify_checklist_people();

-- Maintenance: someone added to a task's crew.
create or replace function notify_pm_people() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v uuid;
begin
  if my_name() = 'System' then return new; end if;
  for v in select x from unnest(coalesce(new.assignees, '{}')) x
            where tg_op = 'INSERT' or not (x = any (coalesce(old.assignees, '{}'))) loop
    perform notify_person(v, by_line() || ' put you on ' || new.name, 'Maintenance', '#/schedule');
  end loop;
  return new;
end $$;
drop trigger if exists pm_tasks_notify_people on pm_tasks;
create trigger pm_tasks_notify_people after insert or update of assignees on pm_tasks
  for each row execute function notify_pm_people();

-- Requests: someone added to "Handled by".
create or replace function notify_request_people() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v uuid;
begin
  if my_name() = 'System' then return new; end if;
  for v in select added_names(array_to_string(new.experts, ','),
                              case when tg_op = 'UPDATE' then array_to_string(old.experts, ',') end) loop
    perform notify_person(v, by_line() || ' gave you a request: ' || new.subject,
                          coalesce(new.location, 'Requests'), '#/request/' || new.id);
  end loop;
  return new;
end $$;
drop trigger if exists maint_requests_notify_people on maint_requests;
create trigger maint_requests_notify_people after insert or update of experts on maint_requests
  for each row execute function notify_request_people();

-- My tasks: a to-do someone else put on your list.
create or replace function notify_personal_task() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if my_name() = 'System' then return new; end if;
  perform notify_person(new.member_id, 'New task from ' || by_line() || ': ' || new.title,
                        case when new.due_on is not null then 'Due ' || to_char(new.due_on, 'Mon FMDD') end, '#/mytasks');
  return new;
end $$;
drop trigger if exists personal_tasks_notify on personal_tasks;
create trigger personal_tasks_notify after insert on personal_tasks
  for each row execute function notify_personal_task();

-- Push: a personal alert goes to that person's devices; the rest to admins as before.
create or replace function claim_push_batch() returns json
language plpgsql security definer set search_path = public as $$
declare
  v json;
begin
  with claimed as (
    update notifications set pushed_at = now()
     where id in (select id from notifications where pushed_at is null
                   and created_at > now() - interval '15 minutes' order by id limit 50 for update skip locked)
    returning *
  )
  select coalesce(json_agg(json_build_object(
           'id', c.id, 'site', c.site, 'kind', c.kind, 'title', c.title, 'body', c.body, 'link', c.link,
           'subs', (select coalesce(json_agg(json_build_object('id', s.id, 'endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth, 'site', s.site)), '[]'::json)
                      from push_subscriptions s join team_members m on m.id = s.member_id
                     where m.active and case when c.member_id is not null then m.id = c.member_id
                       else (m.role = 'admin'
                         or (c.site = 'facilities' and m.role = 'fac_admin')
                         or (c.site = 'media' and m.media_role = 'lead')
                         or (c.site = 'events' and m.events_role = 'admin')) end)
         ) order by c.id), '[]'::json)
    into v from claimed c;
  update notifications set pushed_at = now() where pushed_at is null and created_at <= now() - interval '15 minutes';
  return v;
end $$;
revoke execute on function claim_push_batch() from public, anon, authenticated;
grant execute on function claim_push_batch() to service_role;
