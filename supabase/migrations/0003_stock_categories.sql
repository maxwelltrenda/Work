-- Split stock into Facilities stock and Event stock.
-- Each gets its own barcode prefix so a label tells you which shelf it
-- belongs to: FAC-0001 (facilities) and EVS-0001 (event stock).

alter table items add column if not exists category text not null default 'facilities';
alter table items add constraint items_category_check check (category in ('facilities', 'events'));

create sequence if not exists fac_code_seq;
create sequence if not exists evs_code_seq;

-- Codes are assigned by the trigger below from the item's category.
alter table items alter column code set default null;

create or replace function set_item_code() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.code is null or new.code = '' then
    new.code := case new.category
      when 'events' then 'EVS-' || lpad(nextval('evs_code_seq')::text, 4, '0')
      else 'FAC-' || lpad(nextval('fac_code_seq')::text, 4, '0')
    end;
  end if;
  return new;
end $$;

revoke execute on function set_item_code() from public, anon, authenticated;

create trigger items_code before insert on items for each row execute function set_item_code();
create index if not exists items_category_idx on items (category);

-- Shared list of storage locations (shelves, rooms, trailers) used by the
-- item and tool forms as a dropdown that admins can add to.
create table if not exists locations (
  name        text primary key check (length(trim(name)) > 0),
  created_at  timestamptz not null default now()
);
alter table locations enable row level security;
create policy team_read    on locations for select to authenticated using (is_team_member());
create policy admin_insert on locations for insert to authenticated with check (is_team_admin());
create policy admin_update on locations for update to authenticated using (is_team_admin()) with check (is_team_admin());

-- Renaming a location carries through to everything stored there.
alter table items add constraint items_location_fkey foreign key (location) references locations(name) on update cascade;
alter table tools add constraint tools_location_fkey foreign key (location) references locations(name) on update cascade;

-- Units are no longer shown anywhere; quantities are plain counts.
-- (The items.unit column is kept but unused.)
create or replace function scan_item(p_code text, p_type text, p_qty integer, p_note text default null,
                                     p_member uuid default null, p_event uuid default null)
returns json
language plpgsql security definer set search_path = public as $$
declare
  v_login uuid := current_member_id();
  v_actor uuid;
  v_item items;
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

  v_change := case p_type when 'in' then p_qty when 'out' then -p_qty else p_qty - v_item.quantity end;
  if v_item.quantity + v_change < 0 then
    raise exception 'Only % of % on hand', v_item.quantity, v_item.name;
  end if;
  perform use_event(p_event);

  perform set_config('app.via_scan', 'on', true);
  update items set quantity = quantity + v_change where id = v_item.id returning * into v_item;
  insert into item_transactions (item_id, type, qty, qty_after, note, member_id, recorded_by, event_id)
  values (v_item.id, p_type, v_change, v_item.quantity, nullif(trim(p_note), ''), v_actor, v_login, p_event);

  return json_build_object('item', row_to_json(v_item), 'change', v_change);
end $$;
