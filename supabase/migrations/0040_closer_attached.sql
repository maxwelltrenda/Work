-- Whoever closes out work is attached to it.
--   Requests: starting (In Progress) or finishing (Complete) a request adds
--   that person to its people (experts), if they aren't on it already.
--   Custodial checklist: checking a task Done (or starting it) adds that
--   person to "who" alongside anyone already on it.
-- Runs after the existing *_rules triggers (triggers fire in name order).

create or replace function attach_closer_request() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_who text := my_name();
begin
  if new.status is distinct from old.status and new.status in ('In Progress', 'Complete') and v_who <> 'System'
     and not (lower(v_who) = any (select lower(x) from unnest(coalesce(new.experts, '{}')) x)) then
    new.experts := coalesce(new.experts, '{}') || v_who;
  end if;
  return new;
end $$;

drop trigger if exists maint_requests_z_closer on maint_requests;
create trigger maint_requests_z_closer before update on maint_requests
  for each row execute function attach_closer_request();

create or replace function attach_closer_checklist() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_who text := my_name();
begin
  if new.status is distinct from old.status and new.status in ('Done', 'Working on it') and v_who <> 'System' then
    if coalesce(trim(new.who), '') = '' then
      new.who := v_who;
    elsif not (lower(v_who) = any (select lower(trim(x)) from unnest(string_to_array(new.who, ',')) x)) then
      new.who := new.who || ', ' || v_who;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists checklist_tasks_z_closer on checklist_tasks;
create trigger checklist_tasks_z_closer before update on checklist_tasks
  for each row execute function attach_closer_checklist();
