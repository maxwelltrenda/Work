-- Roles:
--   admin       — everything
--   kiosk       — the shared warehouse device: scans and check-ins/outs
--   member      — "Facilities & Maintenance": view facilities stock, tools and their history
--   maintenance — view tools and tool history
--   custodian   — view facilities stock and its history
--   oversight   — view everything (stock, tools, locations, check-ins/outs)
-- Only admin and kiosk can change anything.
-- Reads are limited by RLS; writes are blocked by triggers, so no path
-- (scans, edits, label marking) lets a view-only login change anything.

alter table team_members drop constraint if exists team_members_role_check;
alter table team_members add constraint team_members_role_check
  check (role in ('admin', 'member', 'kiosk', 'maintenance', 'custodian', 'oversight'));

create or replace function my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from team_members where id = current_member_id()
$$;

-- Roles that can scan, check things in/out and edit. Server-side SQL with no
-- signed-in user (migrations, dashboard) is allowed too.
create or replace function can_act() returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when auth.jwt() ->> 'email' is null then true
    else coalesce(my_role() in ('admin', 'kiosk'), false)
  end
$$;

create or replace function can_see_tools() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(my_role() in ('admin', 'member', 'kiosk', 'oversight', 'maintenance'), false)
$$;

create or replace function can_see_stock(p_category text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(my_role() in ('admin', 'kiosk', 'oversight')
                  or (my_role() in ('member', 'custodian') and p_category = 'facilities'), false)
$$;

alter policy team_read on items using (can_see_stock(category));
alter policy team_read on item_transactions using (
  exists (select 1 from items i where i.id = item_id and can_see_stock(i.category)));
alter policy team_read on tools using (can_see_tools());
alter policy team_read on tool_checkouts using (can_see_tools());

alter policy team_insert on events     with check (can_act());
alter policy team_update on events     using (can_act()) with check (can_act());
alter policy team_insert on event_crew with check (can_act());
alter policy team_delete on event_crew using (can_act());

create or replace function guard_view_only() returns trigger
language plpgsql set search_path = public as $$
begin
  if not can_act() then
    raise exception 'Your role is view-only';
  end if;
  return new;
end $$;

create trigger view_only_guard before insert or update on items             for each row execute function guard_view_only();
create trigger view_only_guard before insert or update on tools             for each row execute function guard_view_only();
create trigger view_only_guard before insert or update on item_transactions for each row execute function guard_view_only();
create trigger view_only_guard before insert or update on tool_checkouts    for each row execute function guard_view_only();
-- Updates only: the very first sign-in inserts its own admin row.
create trigger view_only_guard before update on team_members                for each row execute function guard_view_only();

revoke execute on function guard_view_only() from public, anon, authenticated;
revoke execute on function my_role(), can_act(), can_see_tools(), can_see_stock(text) from public, anon;
grant execute on function my_role(), can_act(), can_see_tools(), can_see_stock(text) to authenticated;
