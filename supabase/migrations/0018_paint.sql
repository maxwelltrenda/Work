-- Paint: one item per color (barcode PNT-0001). Each physical can is a row in
-- paint_cans with its size (1 or 5 gallons) and how full it is (full, 3/4,
-- 1/2, 1/4), so a color's total gallons adds up full and used cans together.
--   sees it:  admin, kiosk, oversight, maintenance, member (Facilities & Maintenance)
--   scans it: admin, kiosk, maintenance, member
-- items.quantity for paint is the number of cans on hand.

alter table items drop constraint if exists items_category_check;
alter table items add constraint items_category_check check (category in ('facilities', 'events', 'maintenance', 'paint'));

create sequence if not exists pnt_code_seq;

create or replace function set_item_code() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.code is null or new.code = '' then
    new.code := case new.category
      when 'events' then 'EVS-' || lpad(nextval('evs_code_seq')::text, 4, '0')
      when 'maintenance' then 'MNT-' || lpad(nextval('mnt_code_seq')::text, 4, '0')
      when 'paint' then 'PNT-' || lpad(nextval('pnt_code_seq')::text, 4, '0')
      else 'FAC-' || lpad(nextval('fac_code_seq')::text, 4, '0')
    end;
  end if;
  return new;
end $$;

create or replace function can_see_stock(p_category text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(my_role() in ('admin', 'kiosk', 'oversight')
                  or (my_role() in ('member', 'custodian') and p_category = 'facilities')
                  or (my_role() in ('member', 'maintenance') and p_category in ('maintenance', 'paint')), false)
$$;

create or replace function can_scan_stock(p_category text) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when auth.jwt() ->> 'email' is null then true
    else coalesce(my_role() in ('admin', 'kiosk')
                  or (my_role() in ('member', 'custodian') and p_category = 'facilities')
                  or (my_role() in ('member', 'maintenance') and p_category in ('maintenance', 'paint')), false)
  end
$$;

create table if not exists paint_cans (
  id          bigint generated always as identity primary key,
  item_id     uuid not null references items(id),
  size        numeric(3, 1) not null check (size in (1, 5)),
  fill        numeric(3, 2) not null check (fill in (1, 0.75, 0.5, 0.25)),
  added_at    timestamptz not null default now(),
  removed_at  timestamptz
);
create index if not exists paint_cans_item_idx on paint_cans (item_id) where removed_at is null;
alter table paint_cans enable row level security;
create policy team_read on paint_cans for select to authenticated
  using (exists (select 1 from items i where i.id = item_id and can_see_stock(i.category)));
-- No insert/update policies: cans only change through paint_move().

-- Take or put back paint cans of one size and fill level.
create or replace function paint_move(p_code text, p_dir text, p_size numeric, p_fill numeric, p_qty integer default 1,
                                      p_member uuid default null, p_event uuid default null,
                                      p_destination text default null, p_note text default null)
returns json
language plpgsql security definer set search_path = public as $$
declare
  v_login uuid := current_member_id();
  v_actor uuid;
  v_item items;
  v_have integer;
  v_cans integer;
  v_label text;
begin
  if v_login is null then raise exception 'Not on the team list'; end if;
  if p_dir not in ('in', 'out') then raise exception 'Bad direction'; end if;
  if p_size not in (1, 5) or p_fill not in (1, 0.75, 0.5, 0.25) then raise exception 'Bad can size or fill'; end if;
  if coalesce(p_qty, 0) < 1 then raise exception 'Quantity must be at least 1'; end if;
  v_actor := resolve_actor(p_member);

  select * into v_item from items where upper(code) = upper(trim(p_code)) and active for update;
  if not found then raise exception 'No item with code %', trim(p_code); end if;
  if v_item.category <> 'paint' then raise exception '% isn''t paint', v_item.name; end if;
  if not can_scan_stock('paint') then raise exception 'That isn''t in your area — you can only scan your own things'; end if;
  perform use_event(p_event);

  v_label := case when p_size = 5 then '5 gal' else '1 gal' end || ' ' ||
             case p_fill when 1 then 'full' when 0.75 then '3/4 full' when 0.5 then '1/2 full' else '1/4 full' end;

  if p_dir = 'out' then
    select count(*) into v_have from paint_cans
     where item_id = v_item.id and removed_at is null and size = p_size and fill = p_fill;
    if v_have < p_qty then
      raise exception 'Only % × % of % on hand', v_have, v_label, v_item.name;
    end if;
    update paint_cans set removed_at = now()
     where id in (select id from paint_cans
                   where item_id = v_item.id and removed_at is null and size = p_size and fill = p_fill
                   order by added_at limit p_qty);
  else
    insert into paint_cans (item_id, size, fill) select v_item.id, p_size, p_fill from generate_series(1, p_qty);
  end if;

  select count(*) into v_cans from paint_cans where item_id = v_item.id and removed_at is null;
  perform set_config('app.via_scan', 'on', true);
  update items set quantity = v_cans where id = v_item.id returning * into v_item;
  insert into item_transactions (item_id, type, qty, qty_after, note, member_id, recorded_by, event_id, destination)
  values (v_item.id, p_dir, case when p_dir = 'in' then p_qty else -p_qty end, v_cans,
          concat_ws(' · ', v_label, nullif(trim(p_note), '')), v_actor, v_login, p_event,
          case when p_dir = 'out' then nullif(p_destination, '') end);

  return json_build_object('item', row_to_json(v_item),
    'gallons', (select coalesce(sum(size * fill), 0) from paint_cans where item_id = v_item.id and removed_at is null));
end $$;

revoke execute on function paint_move(text, text, numeric, numeric, integer, uuid, uuid, text, text) from public, anon;
grant execute on function paint_move(text, text, numeric, numeric, integer, uuid, uuid, text, text) to authenticated;

-- Paint cans can't be changed with an ordinary stock scan.
create or replace function scan_item(p_code text, p_type text, p_qty integer, p_note text default null,
                                     p_member uuid default null, p_event uuid default null,
                                     p_destination text default null, p_in_packs boolean default false)
returns json
language plpgsql security definer set search_path = public as $$
declare
  v_login uuid := current_member_id();
  v_actor uuid;
  v_item items;
  v_qty integer;
  v_change integer;
begin
  if v_login is null then raise exception 'Not on the team list'; end if;
  if p_type not in ('in', 'out', 'adjust') then raise exception 'Bad scan type'; end if;
  if p_qty is null or p_qty < 0 or (p_type <> 'adjust' and p_qty = 0) then
    raise exception 'Quantity must be more than 0';
  end if;
  if p_type = 'adjust' and not is_team_admin() then
    raise exception 'Only admins can set an exact count';
  end if;
  v_actor := resolve_actor(p_member);

  select * into v_item from items where upper(code) = upper(trim(p_code)) and active for update;
  if not found then raise exception 'No item with code %', trim(p_code); end if;
  if v_item.category = 'paint' then
    raise exception '% is paint — scan it on Check In / Out to pick the can size', v_item.name;
  end if;

  v_qty := case when coalesce(p_in_packs, false) then p_qty * greatest(v_item.pack_size, 1) else p_qty end;
  v_change := case p_type when 'in' then v_qty when 'out' then -v_qty else v_qty - v_item.quantity end;
  if v_item.quantity + v_change < 0 then
    raise exception 'Only % of % on hand', v_item.quantity, v_item.name;
  end if;
  perform use_event(p_event);

  perform set_config('app.via_scan', 'on', true);
  update items set quantity = quantity + v_change where id = v_item.id returning * into v_item;
  insert into item_transactions (item_id, type, qty, qty_after, note, member_id, recorded_by, event_id, destination)
  values (v_item.id, p_type, v_change, v_item.quantity, nullif(trim(p_note), ''), v_actor, v_login, p_event, nullif(p_destination, ''));

  return json_build_object('item', row_to_json(v_item), 'change', v_change);
end $$;
