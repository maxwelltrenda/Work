-- Facilities admin: everything an admin can do on the Facilities site (stock,
-- tools, requests, checklists, schedule, locations, categories, labels, people's
-- Facilities access) but nothing on the Events or Media Gear sites.
--   role 'admin'     = full admin, all three sites (is_org_admin)
--   role 'fac_admin' = Facilities admin (is_team_admin now means "admin powers
--                      on Facilities": admin or fac_admin)
-- Anything that reaches Events or Media now checks is_org_admin instead.

alter table team_members drop constraint if exists team_members_role_check;
alter table team_members add constraint team_members_role_check
  check (role in ('admin', 'fac_admin', 'member', 'kiosk', 'maintenance', 'custodian', 'oversight', 'none'));

create or replace function is_org_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from team_members
    where active and role = 'admin' and email is not null
      and lower(email) = lower(auth.jwt() ->> 'email')
  )
$$;

create or replace function is_team_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from team_members
    where active and role in ('admin', 'fac_admin') and email is not null
      and lower(email) = lower(auth.jwt() ->> 'email')
  )
$$;

-- ---- cross-site checks: full admins only ------------------------------------

create or replace function is_site_admin(p_site text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(case p_site
    when 'facilities' then is_team_admin()
    when 'media' then is_org_admin() or my_media_role() = 'lead'
    when 'events' then is_org_admin() or (select events_role from team_members where id = current_member_id()) = 'admin'
    else is_org_admin() end, false)
$$;

create or replace function can_edit_tool(p_site text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(is_org_admin()
    or (p_site = 'facilities' and is_team_admin())
    or (p_site = 'media' and my_media_role() = 'lead')
    or (p_site = 'events' and my_events_role() = 'admin'), false)
$$;

create or replace function can_edit_category(p_kind text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(is_org_admin()
    or (p_kind in ('tool', 'maintenance') and is_team_admin())
    or (p_kind = 'media' and can_edit_tool('media'))
    or (p_kind = 'decor' and can_edit_tool('events')), false)
$$;

create or replace function set_tool_status(p_tool uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_tool tools;
begin
  select * into v_tool from tools where id = p_tool for update;
  if not found then raise exception 'No such tool'; end if;
  if not can_edit_tool(v_tool.site) then raise exception 'Admins only'; end if;
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

-- Table rules that said "any admin" now keep Facilities admins to Facilities.
alter policy admin_insert on tools with check (is_org_admin() or (site = 'facilities' and is_team_admin()));
alter policy admin_update on tools using (is_org_admin() or (site = 'facilities' and is_team_admin()))
  with check (is_org_admin() or (site = 'facilities' and is_team_admin()));
alter policy admin_insert on items with check (is_org_admin() or (category <> 'events' and is_team_admin()));
alter policy admin_update on items using (is_org_admin() or (category <> 'events' and is_team_admin()))
  with check (is_org_admin() or (category <> 'events' and is_team_admin()));
alter policy admin_insert on categories with check (is_org_admin() or (kind in ('tool', 'maintenance') and is_team_admin()));
alter policy admin_update on categories using (is_org_admin() or (kind in ('tool', 'maintenance') and is_team_admin()))
  with check (is_org_admin() or (kind in ('tool', 'maintenance') and is_team_admin()));

alter policy tool_photos_admin on storage.objects
  using (bucket_id = 'tool-photos' and (public.is_org_admin() or (public.is_team_admin() and exists (
    select 1 from public.tools t where t.id::text = (storage.foldername(name))[1] and t.site = 'facilities'))))
  with check (bucket_id = 'tool-photos' and (public.is_org_admin() or (public.is_team_admin() and exists (
    select 1 from public.tools t where t.id::text = (storage.foldername(name))[1] and t.site = 'facilities'))));
alter policy item_photos_admin on storage.objects
  using (bucket_id = 'item-photos' and (public.is_org_admin() or (public.is_team_admin() and exists (
    select 1 from public.items i where i.id::text = (storage.foldername(name))[1] and i.category <> 'events'))))
  with check (bucket_id = 'item-photos' and (public.is_org_admin() or (public.is_team_admin() and exists (
    select 1 from public.items i where i.id::text = (storage.foldername(name))[1] and i.category <> 'events'))));

-- People: a Facilities admin can add people and set their Facilities access,
-- but can't touch Events / Media access, make or change full admins.
create or replace function guard_people_admin() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('app.team_edit', true), '') = 'on' or auth.jwt() ->> 'email' is null or is_org_admin()
     or not exists (select 1 from team_members where role = 'admin') then   -- the very first admin signing up
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' then
    if old.role = 'admin' then raise exception 'Only a full admin can change an admin'; end if;
    return old;
  end if;
  if new.role = 'admin' or (tg_op = 'UPDATE' and old.role = 'admin') then
    raise exception 'Only a full admin can make or change an admin';
  end if;
  if tg_op = 'INSERT' and (new.media_role is not null or new.events_role is not null) then
    raise exception 'Only a full admin can give Media or Events access';
  end if;
  if tg_op = 'UPDATE' and (new.media_role is distinct from old.media_role or new.events_role is distinct from old.events_role) then
    raise exception 'Only a full admin can change Media or Events access';
  end if;
  return new;
end $$;
create or replace trigger team_members_people_admin before insert or update or delete on team_members
  for each row execute function guard_people_admin();

-- ---- Facilities role lists: Facilities admin counts as admin --------------------

create or replace function can_act() returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when auth.jwt() ->> 'email' is null then true
    else coalesce(my_role() in ('admin', 'fac_admin', 'kiosk'), false)
  end
$$;

create or replace function can_see_tools() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(my_role() in ('admin', 'fac_admin', 'member', 'kiosk', 'oversight', 'maintenance'), false)
$$;

create or replace function can_scan_tools() returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when auth.jwt() ->> 'email' is null then true
    else coalesce(my_role() in ('admin', 'fac_admin', 'kiosk', 'member', 'maintenance'), false)
  end
$$;

create or replace function can_see_stock(p_category text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(my_role() in ('admin', 'kiosk', 'oversight')
                  or (my_role() = 'fac_admin' and p_category <> 'events')
                  or (my_role() in ('member', 'custodian') and p_category = 'facilities')
                  or (my_role() in ('member', 'maintenance') and p_category in ('maintenance', 'paint'))
                  or (p_category = 'events' and my_events_role() is not null), false)
$$;

create or replace function can_scan_stock(p_category text) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when auth.jwt() ->> 'email' is null then true
    else coalesce(my_role() in ('admin', 'kiosk')
                  or (my_role() = 'fac_admin' and p_category <> 'events')
                  or (my_role() in ('member', 'custodian') and p_category = 'facilities')
                  or (my_role() in ('member', 'maintenance') and p_category in ('maintenance', 'paint'))
                  or (p_category = 'events' and my_events_role() is not null), false)
  end
$$;

create or replace function can_see_boards() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(my_role() in ('admin', 'fac_admin', 'member', 'maintenance', 'custodian', 'oversight'), false)
$$;

create or replace function can_edit_boards() returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when auth.jwt() ->> 'email' is null then true
    else coalesce(my_role() in ('admin', 'fac_admin', 'member', 'maintenance', 'custodian'), false)
  end
$$;

create or replace function can_use_pm() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(my_role() in ('admin', 'fac_admin', 'maintenance'), false)
$$;

-- Push notifications and restock emails: Facilities admins get Facilities ones.
create or replace function claim_push_batch() returns json
language plpgsql security definer set search_path = public as $$
declare
  v json;
begin
  with claimed as (
    update notifications set pushed_at = now()
     where id in (select id from notifications where pushed_at is null
                   and created_at > now() - interval '15 minutes' order by id limit 50 for update skip locked)
    returning *
  )
  select coalesce(json_agg(json_build_object(
           'id', c.id, 'site', c.site, 'kind', c.kind, 'title', c.title, 'body', c.body,
           'subs', (select coalesce(json_agg(json_build_object('id', s.id, 'endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth, 'site', s.site)), '[]'::json)
                      from push_subscriptions s join team_members m on m.id = s.member_id
                     where m.active and (m.role = 'admin'
                       or (c.site = 'facilities' and m.role = 'fac_admin')
                       or (c.site = 'media' and m.media_role = 'lead')
                       or (c.site = 'events' and m.events_role = 'admin')))
         ) order by c.id), '[]'::json)
    into v from claimed c;
  update notifications set pushed_at = now() where pushed_at is null and created_at <= now() - interval '15 minutes';
  return v;
end $$;
revoke execute on function claim_push_batch() from public, anon, authenticated;
grant execute on function claim_push_batch() to service_role;

create or replace function restock_recipients(p_category text) returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct lower(email)), '{}') from team_members
   where active and email is not null and (
     role = 'admin'
     or (p_category <> 'events' and role = 'fac_admin')
     or (p_category = 'facilities' and role = 'custodian')
     or (p_category in ('maintenance', 'paint') and role = 'maintenance')
     or (p_category = 'events' and events_role = 'admin'))
$$;
revoke execute on function restock_recipients(text) from public, anon, authenticated;
grant execute on function restock_recipients(text) to service_role;

revoke execute on function is_org_admin() from public, anon;
grant execute on function is_org_admin() to authenticated;
revoke execute on function guard_people_admin() from public, anon, authenticated;
