-- Facilities & Maintenance team members (role 'member') can see the
-- Maintenance schedule and check rounds and steps off. Adding and changing
-- tasks stays with admins and the Maintenance manager (can_use_pm).

create or replace function can_work_pm() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(my_role() in ('admin', 'fac_admin', 'maintenance', 'member'), false)
$$;
revoke execute on function can_work_pm() from public, anon;
grant execute on function can_work_pm() to authenticated;

drop policy if exists pm_read on pm_tasks;
create policy pm_read on pm_tasks for select to authenticated using (can_work_pm());
drop policy if exists pm_read on pm_runs;
create policy pm_read on pm_runs for select to authenticated using (can_work_pm());

-- Open the list, check off, and tick steps: same functions, the wider check.
do $$
declare f text;
begin
  foreach f in array array['pm_refresh()', 'pm_mark(bigint, text, text)', 'pm_step(bigint, integer, boolean)'] loop
    execute replace(pg_get_functiondef(f::regprocedure), 'can_use_pm()', 'can_work_pm()');
  end loop;
end $$;
