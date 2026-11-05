-- Team admins for the Media and Events sites. A team admin has full access on
-- their own site (like an admin, but only there) and manages their own team's
-- people: they can add people to the team, change their team access, and take
-- them off the team. They can't change Facilities access or other teams.
--   media_role:  'member' (Media team) or 'lead' (Media admin)
--   events_role: 'member' (Events team) or 'admin' (Events admin)

alter table team_members drop constraint if exists team_members_events_role_check;
alter table team_members add constraint team_members_events_role_check
  check (events_role is null or events_role in ('member', 'admin'));

create or replace function is_site_admin(p_site text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(is_team_admin() or case p_site
    when 'media' then my_media_role() = 'lead'
    when 'events' then (select events_role from team_members where id = current_member_id()) = 'admin'
    else false end, false)
$$;

-- Media admins can change gear status (repair, lost, retired…) too.
create or replace function set_tool_status(p_tool uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_tool tools;
begin
  select * into v_tool from tools where id = p_tool for update;
  if not found then raise exception 'No such tool'; end if;
  if not (is_team_admin() or can_edit_tool(v_tool.site)) then raise exception 'Admins only'; end if;
  if p_status not in ('available', 'repair', 'lost', 'retired') then raise exception 'Bad status'; end if;
  if v_tool.quantity = 1 and exists (select 1 from tool_checkouts where tool_id = p_tool and returned_at is null) then
    raise exception 'Return the tool before changing its status';
  end if;
  perform set_config('app.via_scan', 'on', true);
  if p_status in ('lost', 'retired') then
    update tools set status = p_status where id = p_tool;
  else
    update tools set status = 'available', repair_qty = case when p_status = 'repair' then quantity - tool_out_qty(p_tool) else 0 end
     where id = p_tool;
    perform refresh_tool_status(p_tool);
  end if;
end $$;

-- The view-only guard on team_members lets the two team functions below through.
create or replace function guard_view_only() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_ok boolean;
begin
  if tg_table_name = 'tools' then
    v_ok := can_scan_tool(new.site);
  elsif tg_table_name = 'tool_checkouts' then
    v_ok := can_scan_tool((select site from tools where id = new.tool_id));
  elsif tg_table_name = 'items' then
    v_ok := can_scan_stock(new.category);
  elsif tg_table_name = 'item_transactions' then
    v_ok := can_scan_stock((select category from items where id = new.item_id));
  elsif tg_table_name = 'team_members' and coalesce(current_setting('app.team_edit', true), '') = 'on' then
    v_ok := true;
  else
    v_ok := can_act();
  end if;
  if not v_ok then
    raise exception 'That isn''t in your area — you can only scan your own things';
  end if;
  return new;
end $$;

-- Add someone to a team. If their email is already on the list, they're
-- simply added to the team; otherwise a new person is created with no
-- Facilities access.
create or replace function team_add_person(p_site text, p_name text, p_email text, p_role text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_email text := nullif(lower(trim(p_email)), '');
  v_id uuid;
begin
  if p_site not in ('media', 'events') then raise exception 'Unknown team'; end if;
  if not is_site_admin(p_site) then raise exception 'Only a team admin can add people'; end if;
  if (p_site = 'media' and p_role not in ('member', 'lead')) or (p_site = 'events' and p_role not in ('member', 'admin')) then
    raise exception 'Bad team role';
  end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Enter a name'; end if;
  perform set_config('app.team_edit', 'on', true);
  if v_email is not null then
    select id into v_id from team_members where lower(email) = v_email;
  end if;
  if v_id is null then
    insert into team_members (name, email, role, media_role, events_role)
    values (trim(p_name), v_email, 'none',
            case when p_site = 'media' then p_role end, case when p_site = 'events' then p_role end)
    returning id into v_id;
  elsif p_site = 'media' then
    update team_members set media_role = p_role, active = true where id = v_id and role <> 'admin';
  else
    update team_members set events_role = p_role, active = true where id = v_id and role <> 'admin';
  end if;
  return v_id;
end $$;

-- Change a team member: their team role (null takes them off the team), and
-- their name / email / label code only if this team is the only place they
-- have access (so a team admin can't change someone the rest of the org uses).
create or replace function team_update_person(p_site text, p_id uuid, p_role text,
                                              p_name text default null, p_email text default null, p_code text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v team_members;
  v_only_here boolean;
begin
  if p_site not in ('media', 'events') then raise exception 'Unknown team'; end if;
  if not is_site_admin(p_site) then raise exception 'Only a team admin can change people'; end if;
  select * into v from team_members where id = p_id for update;
  if not found then raise exception 'No such person'; end if;
  if v.role = 'admin' then raise exception 'Admins can only be changed by another admin'; end if;
  if (p_site = 'media' and v.media_role is null) or (p_site = 'events' and v.events_role is null) then
    raise exception '% isn''t on this team', v.name;
  end if;
  if p_role is not null and ((p_site = 'media' and p_role not in ('member', 'lead')) or (p_site = 'events' and p_role not in ('member', 'admin'))) then
    raise exception 'Bad team role';
  end if;
  if p_id = current_member_id() and (p_role is null or p_role not in ('lead', 'admin')) and not is_team_admin() then
    raise exception 'You can''t remove your own team admin access; ask another admin';
  end if;
  perform set_config('app.team_edit', 'on', true);
  v_only_here := v.role = 'none' and (case when p_site = 'media' then v.events_role else v.media_role end) is null;
  update team_members set
    media_role  = case when p_site = 'media'  then p_role else media_role end,
    events_role = case when p_site = 'events' then p_role else events_role end,
    name  = case when v_only_here and coalesce(trim(p_name), '') <> '' then trim(p_name) else name end,
    email = case when v_only_here and p_email is not null then nullif(lower(trim(p_email)), '') else email end,
    code  = case when v_only_here and coalesce(trim(p_code), '') <> '' then upper(trim(p_code)) else code end,
    label_printed_at = case when v_only_here and coalesce(trim(p_code), '') <> '' and upper(trim(p_code)) <> code then null else label_printed_at end
  where id = p_id;
end $$;

revoke execute on function is_site_admin(text), team_add_person(text, text, text, text),
  team_update_person(text, uuid, text, text, text, text) from public, anon;
grant execute on function is_site_admin(text), team_add_person(text, text, text, text),
  team_update_person(text, uuid, text, text, text, text) to authenticated;
