-- Notes on tasks: anyone on the team can leave a note on this week's
-- Custodial task or a Maintenance round ("out of mopheads", "paint is low").
-- Kept with who wrote it and when.

create table if not exists task_notes (
  id          bigint generated always as identity primary key,
  kind        text not null check (kind in ('custodial', 'maintenance')),
  task_id     bigint not null,          -- checklist_tasks.id or pm_runs.id
  member_id   uuid references team_members(id) default current_member_id(),
  author      text,
  body        text not null check (trim(body) <> ''),
  created_at  timestamptz not null default now()
);
create index if not exists task_notes_task_idx on task_notes (kind, task_id);

alter table task_notes enable row level security;
drop policy if exists task_notes_read on task_notes;
create policy task_notes_read on task_notes for select to authenticated
  using (case kind when 'custodial' then can_see_boards() else can_work_pm() end);
drop policy if exists task_notes_add on task_notes;
create policy task_notes_add on task_notes for insert to authenticated
  with check (member_id = current_member_id() and case kind when 'custodial' then can_edit_boards() else can_work_pm() end);
drop policy if exists task_notes_remove on task_notes;
create policy task_notes_remove on task_notes for delete to authenticated
  using (member_id = current_member_id() or is_team_admin());
grant select, insert, delete on task_notes to authenticated;

create or replace function task_notes_stamp() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.author := coalesce(nullif(my_name(), 'System'), new.author);
  new.body := trim(new.body);
  return new;
end $$;
drop trigger if exists task_notes_stamp on task_notes;
create trigger task_notes_stamp before insert on task_notes for each row execute function task_notes_stamp();
