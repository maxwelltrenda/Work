-- "When you're free" items (personal_tasks with no date) live on My day now.
create or replace function notify_personal_task() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if my_name() = 'System' then return new; end if;
  perform notify_person(new.member_id, by_line() || ' added to your list: ' || new.title,
                        case when new.due_on is not null then 'Due ' || to_char(new.due_on, 'Mon FMDD') else 'When you''re free · on My day' end, '#/myday');
  return new;
end $$;

-- Timing a "when you're free" item: it runs as "Pulled to" work linked to the
-- item, so it pauses what you were on, shows on the Overview, and lands in
-- Past weeks like any other unplanned work.
alter table pulled_work add column if not exists personal_task_id bigint references personal_tasks(id) on delete set null;

create or replace function free_task_start(p_task bigint) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_title text;
  v_id bigint;
begin
  select title into v_title from personal_tasks where id = p_task and member_id = current_member_id() and done_at is null;
  if v_title is null then raise exception 'That one isn''t on your list'; end if;
  v_id := pulled_start(case when my_role() = 'custodian' then 'custodial' else 'maintenance' end, v_title, null, null);
  update pulled_work set personal_task_id = p_task where id = v_id;
  return v_id;
end $$;
revoke execute on function free_task_start(bigint) from public, anon;
grant execute on function free_task_start(bigint) to authenticated;
