-- Optional people on each step of a Maintenance task ("Marah: paint,
-- Maxwell: rugs, Rick: garage"). Kept on the task by step text, so it
-- carries to every round: {"Rug Realignment": ["<member id>", ...]}.

alter table pm_tasks add column if not exists step_people jsonb not null default '{}';

create or replace function pm_set_step_people(p_task bigint, p_step text, p_people uuid[]) returns void
language plpgsql security definer set search_path = public as $$
declare
  t pm_tasks;
  v_new uuid;
  v_old jsonb;
begin
  if not can_use_pm() then raise exception 'Only maintenance managers and admins can change the schedule'; end if;
  select * into t from pm_tasks where id = p_task for update;
  if not found then raise exception 'No such task'; end if;
  if not (p_step = any (coalesce(t.steps, '{}'))) then raise exception 'No such step'; end if;
  v_old := coalesce(t.step_people -> p_step, '[]'::jsonb);
  update pm_tasks set step_people = case when coalesce(cardinality(p_people), 0) = 0 then step_people - p_step
                                         else step_people || jsonb_build_object(p_step, to_jsonb(p_people)) end
   where id = p_task;
  -- Tell the people newly put on this step.
  foreach v_new in array coalesce(p_people, '{}') loop
    if not v_old ? v_new::text then
      perform notify_person(v_new, by_line() || ' gave you a step: ' || p_step, t.name, '#/schedule');
    end if;
  end loop;
end $$;
revoke execute on function pm_set_step_people(bigint, text, uuid[]) from public, anon;
grant execute on function pm_set_step_people(bigint, text, uuid[]) to authenticated;
