-- Notes become Updates: replies (parent_id), and alerts. A new update tells
-- the people on that task; a reply also tells whoever wrote or replied in
-- that thread. Nobody is alerted about their own update.

alter table task_notes add column if not exists parent_id bigint references task_notes(id) on delete cascade;

create or replace function notify_task_note() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_people uuid[] := '{}';
  v_name text;
  v_link text;
  v_title text;
  v uuid;
begin
  if new.kind = 'custodial' then
    select name, '#/checklist' into v_name, v_link from checklist_tasks where id = new.task_id;
    select coalesce(array_agg(m.id), '{}') into v_people from checklist_tasks t, team_members m
     where t.id = new.task_id and m.active
       and lower(m.name) in (select lower(trim(x)) from unnest(string_to_array(coalesce(t.who, ''), ',')) x);
  else
    select k.name, '#/schedule' into v_name, v_link from pm_runs r join pm_tasks k on k.id = r.task_id where r.id = new.task_id;
    select coalesce(array_agg(distinct x), '{}') into v_people from (
      select unnest(coalesce(k.assignees, '{}')) x from pm_runs r join pm_tasks k on k.id = r.task_id where r.id = new.task_id
      union select (jsonb_array_elements_text(e.value))::uuid from pm_runs r join pm_tasks k on k.id = r.task_id, jsonb_each(k.step_people) e where r.id = new.task_id
    ) s;
  end if;
  if new.parent_id is not null then
    v_people := v_people || coalesce((select array_agg(distinct member_id) from task_notes
                                       where (id = new.parent_id or parent_id = new.parent_id) and member_id is not null), '{}');
  end if;
  v_title := coalesce(split_part(new.author, ' ', 1), 'Someone') || case when new.parent_id is null then ' posted an update on ' else ' replied on ' end || coalesce(v_name, 'a task');
  foreach v in array coalesce((select array_agg(distinct x) from unnest(v_people) x), '{}') loop
    perform notify_person(v, v_title, left(new.body, 140), v_link);
  end loop;
  return new;
end $$;
drop trigger if exists task_notes_notify on task_notes;
create trigger task_notes_notify after insert on task_notes for each row execute function notify_task_note();
