-- Task messages only alert the people @mentioned ("@Rick", "@Kenny Holt").
-- A first name works when only one person on the team has it; otherwise use
-- the full name. Nobody is alerted about their own message.

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
  else
    select k.name, '#/schedule' into v_name, v_link from pm_runs r join pm_tasks k on k.id = r.task_id where r.id = new.task_id;
  end if;
  for m in
    select t.id from team_members t
     where t.active and t.role not in ('none', 'kiosk')
       and (lower(new.body) like '%@' || lower(t.name) || '%'
            or (lower(new.body) ~ ('@' || lower(split_part(t.name, ' ', 1)) || '([^a-z]|$)')
                and (select count(*) from team_members u where u.active and u.role not in ('none', 'kiosk')
                      and lower(split_part(u.name, ' ', 1)) = lower(split_part(t.name, ' ', 1))) = 1))
  loop
    perform notify_person(m.id, coalesce(split_part(new.author, ' ', 1), 'Someone') || ' mentioned you on ' || coalesce(v_name, 'a task'),
                          left(new.body, 140), v_link);
  end loop;
  return new;
end $$;
