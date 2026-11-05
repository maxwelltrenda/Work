-- Events gets its own decor and stock, like Media has gear.
--   * Decor lives in the tools table with site = 'events' and EVD- codes, and is
--     signed out and returned like tools (with quantities, photos, categories).
--   * Event stock (items.category = 'events') is now used by the Events team.
--   * events_role 'member' signs decor out/in and takes stock; 'admin' also adds
--     and edits decor, stock and decor categories. Org admins can do it all.
--   * Sign-outs and returns of decor show up in Events admins' notifications.

alter table tools drop constraint if exists tools_site_check;
alter table tools add constraint tools_site_check check (site in ('facilities', 'media', 'events'));

create sequence if not exists evd_code_seq;
create or replace function set_tool_code() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.site = 'media' and (new.code is null or new.code like 'TL-%') then
    new.code := 'MED-' || lpad(nextval('med_code_seq')::text, 4, '0');
  elsif new.site = 'events' and (new.code is null or new.code like 'TL-%') then
    new.code := 'EVD-' || lpad(nextval('evd_code_seq')::text, 4, '0');
  end if;
  return new;
end $$;

create or replace function my_events_role() returns text
language sql stable security definer set search_path = public as $$
  select case when my_role() = 'admin' then 'admin'
              else (select events_role from team_members where id = current_member_id()) end
$$;

-- ---- who can do what -------------------------------------------------------

create or replace function can_see_tool(p_site text) returns boolean
language sql stable security definer set search_path = public as $$
  select case p_site
    when 'media' then coalesce(my_media_role() is not null or my_role() = 'oversight', false)
    when 'events' then coalesce(my_events_role() is not null or my_role() in ('oversight', 'kiosk'), false)
    else can_see_tools() end
$$;

create or replace function can_scan_tool(p_site text) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when auth.jwt() ->> 'email' is null then true
    when p_site = 'media' then my_media_role() is not null
    when p_site = 'events' then coalesce(my_events_role() is not null or my_role() = 'kiosk', false)
    else can_scan_tools()
  end
$$;

create or replace function can_edit_tool(p_site text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(is_team_admin()
    or (p_site = 'media' and my_media_role() = 'lead')
    or (p_site = 'events' and my_events_role() = 'admin'), false)
$$;

create or replace function can_see_stock(p_category text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(my_role() in ('admin', 'kiosk', 'oversight')
                  or (my_role() in ('member', 'custodian') and p_category = 'facilities')
                  or (my_role() in ('member', 'maintenance') and p_category in ('maintenance', 'paint'))
                  or (p_category = 'events' and my_events_role() is not null), false)
$$;

create or replace function can_scan_stock(p_category text) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when auth.jwt() ->> 'email' is null then true
    else coalesce(my_role() in ('admin', 'kiosk')
                  or (my_role() in ('member', 'custodian') and p_category = 'facilities')
                  or (my_role() in ('member', 'maintenance') and p_category in ('maintenance', 'paint'))
                  or (p_category = 'events' and my_events_role() is not null), false)
  end
$$;

-- Events admins add and edit decor and event stock.
create policy events_insert on tools for insert to authenticated with check (site = 'events' and can_edit_tool('events'));
create policy events_update on tools for update to authenticated
  using (site = 'events' and can_edit_tool('events')) with check (site = 'events' and can_edit_tool('events'));
create policy events_insert on items for insert to authenticated with check (category = 'events' and can_edit_tool('events'));
create policy events_update on items for update to authenticated
  using (category = 'events' and can_edit_tool('events')) with check (category = 'events' and can_edit_tool('events'));

create policy tool_photos_events on storage.objects for all to authenticated
  using (bucket_id = 'tool-photos' and public.can_edit_tool('events') and exists (
    select 1 from public.tools t where t.id::text = (storage.foldername(name))[1] and t.site = 'events'))
  with check (bucket_id = 'tool-photos' and public.can_edit_tool('events') and exists (
    select 1 from public.tools t where t.id::text = (storage.foldername(name))[1] and t.site = 'events'));
create policy item_photos_events on storage.objects for all to authenticated
  using (bucket_id = 'item-photos' and public.can_edit_tool('events') and exists (
    select 1 from public.items i where i.id::text = (storage.foldername(name))[1] and i.category = 'events'))
  with check (bucket_id = 'item-photos' and public.can_edit_tool('events') and exists (
    select 1 from public.items i where i.id::text = (storage.foldername(name))[1] and i.category = 'events'));

-- ---- decor categories --------------------------------------------------------

alter table categories drop constraint if exists categories_kind_check;
alter table categories add constraint categories_kind_check check (kind in ('tool', 'maintenance', 'media', 'decor'));
insert into categories (kind, name)
select 'decor', unnest(array['Backdrops', 'Centerpieces', 'Florals', 'Furniture', 'Lighting', 'Linens', 'Signage', 'Tableware'])
on conflict do nothing;
create policy events_insert on categories for insert to authenticated with check (kind = 'decor' and can_edit_tool('events'));
create policy events_update on categories for update to authenticated
  using (kind = 'decor' and can_edit_tool('events')) with check (kind = 'decor' and can_edit_tool('events'));

create or replace function can_edit_category(p_kind text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(is_team_admin()
    or (p_kind = 'media' and can_edit_tool('media'))
    or (p_kind = 'decor' and can_edit_tool('events')), false)
$$;

create or replace function category_site(p_kind text) returns text
language sql immutable as $$
  select case p_kind when 'media' then 'media' when 'decor' then 'events' else 'facilities' end
$$;

create or replace function add_category(p_kind text, p_name text) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_name text := trim(p_name);
begin
  if p_kind not in ('tool', 'maintenance', 'media', 'decor') then raise exception 'Bad category type'; end if;
  if not can_edit_category(p_kind) then raise exception 'Admins only'; end if;
  if v_name = '' then raise exception 'Enter a name'; end if;
  insert into categories (kind, name) values (p_kind, v_name)
  on conflict (kind, name) do update set active = true;
  return v_name;
end $$;

create or replace function rename_category(p_kind text, p_old text, p_new text) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_new text := trim(p_new);
  v_n integer;
begin
  if p_kind not in ('tool', 'maintenance', 'media', 'decor') then raise exception 'Bad category type'; end if;
  if not can_edit_category(p_kind) then raise exception 'Admins only'; end if;
  if v_new = '' then raise exception 'Enter a name'; end if;
  insert into categories (kind, name) values (p_kind, v_new) on conflict (kind, name) do update set active = true;
  if v_new <> p_old then
    update categories set active = false where kind = p_kind and name = p_old;
  end if;
  if p_kind = 'maintenance' then
    update items set subcategory = v_new where subcategory = p_old and category = 'maintenance';
  else
    update tools set category = v_new where category = p_old and site = category_site(p_kind);
  end if;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

create or replace function remove_category(p_kind text, p_name text) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_n integer;
begin
  if not can_edit_category(p_kind) then raise exception 'Admins only'; end if;
  update categories set active = false where kind = p_kind and name = p_name;
  if p_kind = 'maintenance' then
    update items set subcategory = null where subcategory = p_name and category = 'maintenance';
  else
    update tools set category = null where category = p_name and site = category_site(p_kind);
  end if;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- ---- notifications: Events admins get decor sign-outs and returns -------------

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
                       or (c.site = 'media' and m.media_role = 'lead')
                       or (c.site = 'events' and m.events_role = 'admin')))
         ) order by c.id), '[]'::json)
    into v from claimed c;
  update notifications set pushed_at = now() where pushed_at is null and created_at <= now() - interval '15 minutes';
  return v;
end $$;
revoke execute on function claim_push_batch() from public, anon, authenticated;
grant execute on function claim_push_batch() to service_role;

revoke execute on function my_events_role(), category_site(text) from public, anon;
grant execute on function my_events_role(), category_site(text) to authenticated;
