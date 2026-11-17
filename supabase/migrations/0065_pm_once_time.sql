-- One-time Maintenance tasks can have a time slot on their day ("Fri 9 AM - 12 PM"),
-- so the team can be scheduled for it. Optional; nothing else changes.
alter table pm_tasks add column if not exists once_from time;
alter table pm_tasks add column if not exists once_to time;

create or replace function pm_set_once_time(p_task bigint, p_from time, p_to time) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not can_use_pm() then raise exception 'Only maintenance managers and admins can change the schedule'; end if;
  if p_from is not null and p_to is not null and p_to <= p_from then raise exception 'The end time has to be after the start time'; end if;
  update pm_tasks set once_from = p_from, once_to = case when p_from is null then null else p_to end where id = p_task;
end $$;
revoke execute on function pm_set_once_time(bigint, time, time) from public, anon;
grant execute on function pm_set_once_time(bigint, time, time) to authenticated;
