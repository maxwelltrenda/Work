-- Personal task lists: each person's own to-dos. People see and change their
-- own list; Facilities admins can see and add to anyone's.

create table if not exists personal_tasks (
  id          bigint generated always as identity primary key,
  member_id   uuid not null references team_members(id) on delete cascade,
  title       text not null check (trim(title) <> ''),
  notes       text,
  due_on      date,
  done_at     timestamptz,
  created_by  text,
  created_at  timestamptz not null default now()
);
create index if not exists personal_tasks_member_idx on personal_tasks (member_id, done_at);

alter table personal_tasks enable row level security;
drop policy if exists personal_tasks_rw on personal_tasks;
create policy personal_tasks_rw on personal_tasks for all to authenticated
  using (member_id = current_member_id() or is_team_admin())
  with check (member_id = current_member_id() or is_team_admin());
grant select, insert, update, delete on personal_tasks to authenticated;

create or replace function personal_tasks_stamp() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.created_by := coalesce(new.created_by, nullif(my_name(), 'System'));
  return new;
end $$;
drop trigger if exists personal_tasks_stamp on personal_tasks;
create trigger personal_tasks_stamp before insert on personal_tasks for each row execute function personal_tasks_stamp();
