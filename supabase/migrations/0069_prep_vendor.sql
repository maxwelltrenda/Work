-- Get-ready steps can say where we get the parts ("Order filters" from
-- Filtration Plus): the step's contractor_id points at a place on the
-- Contractors list. Our team still does the work.
create or replace function pm_set_preps(p_parent bigint, p_preps jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  t pm_tasks;
  e jsonb;
  v_keep bigint[] := '{}';
  v_id bigint;
  v_lead integer;
  v_vendor bigint;
begin
  if not can_use_pm() then raise exception 'Only maintenance managers and admins can change the schedule'; end if;
  select * into t from pm_tasks where id = p_parent and parent_id is null;
  if not found then raise exception 'No such task'; end if;
  for e in select * from jsonb_array_elements(coalesce(p_preps, '[]'::jsonb)) loop
    continue when coalesce(trim(e->>'name'), '') = '';
    v_lead := least(60, greatest(1, coalesce((e->>'lead_days')::int, 7)));
    v_id := nullif(e->>'id', '')::bigint;
    v_vendor := (select id from contractors where id = nullif(e->>'vendor_id', '')::bigint);
    if v_id is not null and exists (select 1 from pm_tasks where id = v_id and parent_id = p_parent) then
      update pm_tasks set name = trim(e->>'name'), lead_days = v_lead, frequency = t.frequency,
             location = t.location, active = true, contractor_id = v_vendor
       where id = v_id;
    else
      insert into pm_tasks (name, frequency, parent_id, lead_days, location, created_by, sort, active_since, contractor_id)
      values (trim(e->>'name'), t.frequency, p_parent, v_lead, t.location, current_member_id(), 0, pm_today(), v_vendor)
      returning id into v_id;
    end if;
    v_keep := v_keep || v_id;
  end loop;
  update pm_tasks set active = false where parent_id = p_parent and not (id = any(v_keep));
  delete from pm_runs r using pm_tasks c
   where r.task_id = c.id and c.parent_id = p_parent and r.status = 'open' and r.period_end >= pm_today();
  perform pm_refresh();
end $$;
