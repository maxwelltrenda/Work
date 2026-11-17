-- Starting a Custodial task's timer also marks it "Working on it", so a task
-- can't sit at "Not started" with its clock running (the Overview would show
-- the person as busy on it).
create or replace function checklist_timer(p_id bigint, p_run boolean) returns void
language plpgsql security definer set search_path = public as $$
declare
  r checklist_tasks;
  v_who text := my_name();
begin
  if not can_edit_boards() then raise exception 'Your role is view-only'; end if;
  select * into r from checklist_tasks where id = p_id for update;
  if not found then raise exception 'Task not found'; end if;
  if p_run and r.timer_started_at is null then
    update checklist_tasks set timer_started_at = now(),
           status = case when status in ('Not started', 'Missed', 'Skipped') then 'Working on it' else status end,
           who = case when coalesce(who, '') = '' and v_who <> 'System' then v_who else who end
     where id = p_id;
  elsif not p_run and r.timer_started_at is not null then
    insert into checklist_time (task_id, started_by, ended_by, started_at, ended_at)
    values (p_id, v_who, v_who, r.timer_started_at, now());
    update checklist_tasks
       set worked_seconds = worked_seconds + greatest(0, extract(epoch from now() - r.timer_started_at)::integer),
           timer_started_at = null
     where id = p_id;
  end if;
end $$;
