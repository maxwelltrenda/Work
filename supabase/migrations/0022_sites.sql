-- Three sites on one database: Facilities, Events and Media.
--   * team_members.role stays the Facilities role ('none' = no Facilities access).
--   * media_role: null (no Media access), 'member' (sign gear out/in, reserve)
--     or 'lead' (also add and edit gear). Admins are leads everywhere.
--   * events_role: null or 'member' (plan and run events).
--   * Media gear lives in the tools table with site = 'media' and MED- codes.

alter table team_members drop constraint if exists team_members_role_check;
alter table team_members add constraint team_members_role_check
  check (role in ('admin', 'member', 'kiosk', 'maintenance', 'custodian', 'oversight', 'none'));
alter table team_members add column if not exists media_role text check (media_role is null or media_role in ('member', 'lead'));
alter table team_members add column if not exists events_role text check (events_role is null or events_role in ('member'));

alter table tools add column if not exists site text not null default 'facilities' check (site in ('facilities', 'media'));
create index if not exists tools_site_idx on tools (site);

create sequence if not exists med_code_seq;
create or replace function set_tool_code() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.site = 'media' and (new.code is null or new.code like 'TL-%') then
    new.code := 'MED-' || lpad(nextval('med_code_seq')::text, 4, '0');
  end if;
  return new;
end $$;
create trigger tools_code before insert on tools for each row execute function set_tool_code();

-- ---- who can do what -------------------------------------------------------

create or replace function my_media_role() returns text
language sql stable security definer set search_path = public as $$
  select case when my_role() = 'admin' then 'lead'
              else (select media_role from team_members where id = current_member_id()) end
$$;

create or replace function can_see_tool(p_site text) returns boolean
language sql stable security definer set search_path = public as $$
  select case when p_site = 'media'
              then coalesce(my_media_role() is not null or my_role() = 'oversight', false)
              else can_see_tools() end
$$;

create or replace function can_scan_tool(p_site text) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when auth.jwt() ->> 'email' is null then true
    when p_site = 'media' then my_media_role() is not null
    else can_scan_tools()
  end
$$;

create or replace function can_edit_tool(p_site text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(is_team_admin() or (p_site = 'media' and my_media_role() = 'lead'), false)
$$;

create or replace function can_manage_events() returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when auth.jwt() ->> 'email' is null then true
    else coalesce(my_role() in ('admin', 'kiosk')
                  or (select events_role from team_members where id = current_member_id()) is not null, false)
  end
$$;

alter policy team_read on tools using (can_see_tool(site));
alter policy team_read on tool_checkouts using (exists (select 1 from tools t where t.id = tool_id and can_see_tool(t.site)));
create policy media_insert on tools for insert to authenticated with check (site = 'media' and can_edit_tool('media'));
create policy media_update on tools for update to authenticated
  using (site = 'media' and can_edit_tool('media')) with check (site = 'media' and can_edit_tool('media'));

alter policy team_insert on events     with check (can_manage_events());
alter policy team_update on events     using (can_manage_events()) with check (can_manage_events());
alter policy team_insert on event_crew with check (can_manage_events());
alter policy team_delete on event_crew using (can_manage_events());

-- Scans write to tools / tool_checkouts: check the area of the tool involved.
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
  else
    v_ok := can_act();
  end if;
  if not v_ok then
    raise exception 'That isn''t in your area — you can only scan your own things';
  end if;
  return new;
end $$;

-- Tool / gear photos follow the same rules.
alter policy tool_photos_read on storage.objects
  using (bucket_id = 'tool-photos' and exists (
    select 1 from public.tools t where t.id::text = (storage.foldername(name))[1] and public.can_see_tool(t.site)));
create policy tool_photos_media on storage.objects for all to authenticated
  using (bucket_id = 'tool-photos' and public.can_edit_tool('media') and exists (
    select 1 from public.tools t where t.id::text = (storage.foldername(name))[1] and t.site = 'media'))
  with check (bucket_id = 'tool-photos' and public.can_edit_tool('media') and exists (
    select 1 from public.tools t where t.id::text = (storage.foldername(name))[1] and t.site = 'media'));

-- Barcode look-up: tools are visible per site.
create or replace function lookup_code(p_code text) returns json
language plpgsql stable security definer set search_path = public as $$
declare
  v_code text := upper(trim(p_code));
  v json;
begin
  if not is_team_member() then raise exception 'Not on the team list'; end if;
  select case when can_see_stock(i.category)
              then json_build_object('kind', 'item', 'record', row_to_json(i))
              else json_build_object('kind', 'hidden') end
    into v from items i where upper(code) = v_code;
  if v is not null then return v; end if;
  select case when can_see_tool(t.site)
              then json_build_object('kind', 'tool', 'record', row_to_json(t),
                     'out_qty', tool_out_qty(t.id),
                     'checkouts', coalesce((select json_agg(c order by c.checked_out_at) from (
                        select tc.*, m.name as borrower_name from tool_checkouts tc
                        join team_members m on m.id = tc.borrower_id
                        where tc.tool_id = t.id and tc.returned_at is null) c), '[]'::json),
                     'checkout', (select row_to_json(c) from (
                        select tc.*, m.name as borrower_name from tool_checkouts tc
                        join team_members m on m.id = tc.borrower_id
                        where tc.tool_id = t.id and tc.returned_at is null
                        order by tc.checked_out_at limit 1) c))
              else json_build_object('kind', 'hidden') end
    into v from tools t where upper(code) = v_code;
  if v is not null then return v; end if;
  select json_build_object('kind', 'person', 'record', json_build_object('id', id, 'name', name, 'code', code, 'active', active))
    into v from team_members where upper(code) = v_code;
  return coalesce(v, json_build_object('kind', 'none'));
end $$;

-- ---- media categories ------------------------------------------------------

alter table categories drop constraint if exists categories_kind_check;
alter table categories add constraint categories_kind_check check (kind in ('tool', 'maintenance', 'media'));
insert into categories (kind, name)
select 'media', unnest(array['Cameras', 'Lenses', 'Audio', 'Lighting', 'Tripods & Support', 'Batteries & Power',
                             'Cables & Adapters', 'Cards & Storage'])
on conflict do nothing;
create policy media_insert on categories for insert to authenticated with check (kind = 'media' and can_edit_tool('media'));
create policy media_update on categories for update to authenticated
  using (kind = 'media' and can_edit_tool('media')) with check (kind = 'media' and can_edit_tool('media'));

create or replace function can_edit_category(p_kind text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(is_team_admin() or (p_kind = 'media' and can_edit_tool('media')), false)
$$;

create or replace function add_category(p_kind text, p_name text) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_name text := trim(p_name);
begin
  if p_kind not in ('tool', 'maintenance', 'media') then raise exception 'Bad category type'; end if;
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
  if p_kind not in ('tool', 'maintenance', 'media') then raise exception 'Bad category type'; end if;
  if not can_edit_category(p_kind) then raise exception 'Admins only'; end if;
  if v_new = '' then raise exception 'Enter a name'; end if;
  insert into categories (kind, name) values (p_kind, v_new) on conflict (kind, name) do update set active = true;
  if v_new <> p_old then
    update categories set active = false where kind = p_kind and name = p_old;
  end if;
  if p_kind = 'maintenance' then
    update items set subcategory = v_new where subcategory = p_old and category = 'maintenance';
  else
    update tools set category = v_new where category = p_old and site = case when p_kind = 'media' then 'media' else 'facilities' end;
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
    update tools set category = null where category = p_name and site = case when p_kind = 'media' then 'media' else 'facilities' end;
  end if;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- ---- battery & card checks on return ----------------------------------------

alter table tool_checkouts add column if not exists batteries_ok boolean;
alter table tool_checkouts add column if not exists cards_offloaded boolean;

-- Record the checks on the most recent return of a piece of gear.
create or replace function record_gear_checks(p_tool uuid, p_batteries boolean, p_cards boolean) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_last bigint;
begin
  if current_member_id() is null then raise exception 'Not on the team list'; end if;
  if not can_scan_tool((select site from tools where id = p_tool)) then raise exception 'That isn''t in your area'; end if;
  select id into v_last from tool_checkouts where tool_id = p_tool and returned_at is not null order by returned_at desc limit 1;
  if v_last is null then raise exception 'Nothing has been returned yet'; end if;
  update tool_checkouts set batteries_ok = p_batteries, cards_offloaded = p_cards where id = v_last;
end $$;

-- ---- reservations ------------------------------------------------------------

create table if not exists gear_reservations (
  id            bigint generated always as identity primary key,
  tool_id       uuid not null references tools(id),
  member_id     uuid not null references team_members(id),
  starts_on     date not null,
  ends_on       date not null,
  qty           integer not null default 1 check (qty >= 1),
  note          text,
  created_by    uuid references team_members(id),
  created_at    timestamptz not null default now(),
  cancelled_at  timestamptz,
  check (ends_on >= starts_on)
);
create index if not exists gear_reservations_tool_idx on gear_reservations (tool_id, starts_on) where cancelled_at is null;
alter table gear_reservations enable row level security;
create policy team_read on gear_reservations for select to authenticated
  using (exists (select 1 from tools t where t.id = tool_id and can_see_tool(t.site)));
-- No insert/update policies: reservations change through the functions below.

create or replace function reserve_gear(p_tool uuid, p_member uuid, p_start date, p_end date,
                                        p_qty integer default 1, p_note text default null)
returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_login uuid := current_member_id();
  v_tool tools;
  v_member uuid := coalesce(p_member, v_login);
  v_busy integer;
  v_id bigint;
begin
  if v_login is null then raise exception 'Not on the team list'; end if;
  if p_start is null or p_end is null or p_end < p_start then raise exception 'Pick a start and end date'; end if;
  if coalesce(p_qty, 0) < 1 then raise exception 'Quantity must be at least 1'; end if;
  select * into v_tool from tools where id = p_tool and active for update;
  if not found then raise exception 'No such gear'; end if;
  if not can_scan_tool(v_tool.site) then raise exception 'That isn''t in your area'; end if;
  if v_member <> v_login and not can_edit_tool(v_tool.site) then
    raise exception 'Only a media lead can reserve for someone else';
  end if;
  -- The busiest day in the range decides whether there are enough.
  select coalesce(max(busy), 0) into v_busy from (
    select d, sum(r.qty) as busy
      from generate_series(p_start, p_end, interval '1 day') d
      join gear_reservations r on r.tool_id = v_tool.id and r.cancelled_at is null
                              and d::date between r.starts_on and r.ends_on
     group by d) x;
  if v_busy + p_qty > v_tool.quantity then
    raise exception 'Only % of % free on those dates', greatest(v_tool.quantity - v_busy, 0), v_tool.name;
  end if;
  insert into gear_reservations (tool_id, member_id, starts_on, ends_on, qty, note, created_by)
  values (v_tool.id, v_member, p_start, p_end, p_qty, nullif(trim(p_note), ''), v_login)
  returning id into v_id;
  return v_id;
end $$;

create or replace function cancel_reservation(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_login uuid := current_member_id();
  v_r gear_reservations;
begin
  if v_login is null then raise exception 'Not on the team list'; end if;
  select * into v_r from gear_reservations where id = p_id and cancelled_at is null for update;
  if not found then raise exception 'That reservation is already cancelled'; end if;
  if v_login not in (v_r.member_id, coalesce(v_r.created_by, v_r.member_id))
     and not can_edit_tool((select site from tools where id = v_r.tool_id)) then
    raise exception 'Only the person who reserved it or a media lead can cancel it';
  end if;
  update gear_reservations set cancelled_at = now() where id = p_id;
end $$;

revoke execute on function my_media_role(), can_see_tool(text), can_scan_tool(text), can_edit_tool(text), can_manage_events(),
  can_edit_category(text), record_gear_checks(uuid, boolean, boolean), reserve_gear(uuid, uuid, date, date, integer, text),
  cancel_reservation(bigint) from public, anon;
grant execute on function my_media_role(), can_see_tool(text), can_scan_tool(text), can_edit_tool(text), can_manage_events(),
  can_edit_category(text), record_gear_checks(uuid, boolean, boolean), reserve_gear(uuid, uuid, date, date, integer, text),
  cancel_reservation(bigint) to authenticated;
revoke execute on function set_tool_code() from public, anon, authenticated;
