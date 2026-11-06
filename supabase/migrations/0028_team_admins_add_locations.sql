-- Locations are one shared list (where things are kept, where they're going,
-- and where events happen). Events and Media admins can now add to it from a
-- dropdown; renaming and removing stay with org admins on the Locations page.
create or replace function add_location(p_name text) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_name text := trim(p_name);
begin
  if not (is_team_admin() or is_site_admin('events') or is_site_admin('media')) then
    raise exception 'Admins only';
  end if;
  if coalesce(v_name, '') = '' then raise exception 'Location needs a name'; end if;
  insert into locations (name) values (v_name)
  on conflict (name) do update set active = true;
  return v_name;
end $$;
