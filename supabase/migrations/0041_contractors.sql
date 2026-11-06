-- Contractors: outside companies we hire (grease trap cleaning, fire
-- inspections, elevator service...), with contacts ready to go. Facilities
-- admins keep the list; anyone on the maintenance schedule can see it, and a
-- maintenance task can name the contractor who does it.

create table if not exists contractors (
  id          bigint generated always as identity primary key,
  name        text not null check (trim(name) <> ''),   -- company or person
  trade       text,                                     -- what they do
  contact     text,                                     -- who to ask for
  phone       text,
  email       text,
  website     text,
  notes       text,                                     -- account #, pricing, how to schedule
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

alter table contractors enable row level security;
drop policy if exists contractors_read on contractors;
create policy contractors_read on contractors for select to authenticated using (can_use_pm() or can_see_boards());
drop policy if exists contractors_write on contractors;
create policy contractors_write on contractors for all to authenticated using (is_team_admin()) with check (is_team_admin());
grant select, insert, update on contractors to authenticated;

alter table pm_tasks add column if not exists contractor_id bigint references contractors(id) on delete set null;

-- Set (or clear) who does a maintenance task.
create or replace function pm_set_contractor(p_task bigint, p_contractor bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not can_use_pm() then raise exception 'Only maintenance managers and admins can change the schedule'; end if;
  update pm_tasks set contractor_id = p_contractor where id = p_task and parent_id is null;
end $$;

revoke execute on function pm_set_contractor(bigint, bigint) from public, anon;
grant execute on function pm_set_contractor(bigint, bigint) to authenticated;
