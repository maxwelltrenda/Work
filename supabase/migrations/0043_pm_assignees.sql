-- People on a maintenance task: who's responsible each round. Shown on the
-- task; whoever checks it off is still recorded as done_by on the round.

alter table pm_tasks add column if not exists assignees uuid[] not null default '{}';

create or replace function pm_set_assignees(p_task bigint, p_people uuid[]) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not can_use_pm() then raise exception 'Only maintenance managers and admins can change the schedule'; end if;
  update pm_tasks
     set assignees = coalesce(array(select distinct x from unnest(p_people) x
                                     where x in (select id from team_members where active)), '{}')
   where id = p_task and parent_id is null;
end $$;

revoke execute on function pm_set_assignees(bigint, uuid[]) from public, anon;
grant execute on function pm_set_assignees(bigint, uuid[]) to authenticated;
