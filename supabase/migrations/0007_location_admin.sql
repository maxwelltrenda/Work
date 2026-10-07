-- Let admins remove locations. Removing archives the location (hidden from
-- every list and dropdown) rather than deleting the row, so history that
-- names it keeps its meaning; adding the same name again restores it. Items
-- and tools stored there are left with no location.

alter table locations add column if not exists active boolean not null default true;

create or replace function remove_location(p_name text) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_moved integer;
begin
  if not is_team_admin() then raise exception 'Admins only'; end if;
  update items set location = null where location = p_name;
  get diagnostics v_moved = row_count;
  update tools set location = null where location = p_name;
  update locations set active = false where name = p_name;
  return v_moved;
end $$;

-- Add a location, or bring back one that was removed earlier under that name.
create or replace function add_location(p_name text) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_name text := trim(p_name);
begin
  if not is_team_admin() then raise exception 'Admins only'; end if;
  if v_name = '' then raise exception 'Location needs a name'; end if;
  insert into locations (name) values (v_name)
  on conflict (name) do update set active = true;
  return v_name;
end $$;

revoke execute on function remove_location(text), add_location(text) from public, anon;
grant execute on function remove_location(text), add_location(text) to authenticated;
