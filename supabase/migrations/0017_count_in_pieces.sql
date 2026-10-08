-- Count stock in single pieces so people can take a whole box/pack or just
-- one (e.g. lights that come 3 to a pack, pulled one at a time from a closet).
-- Before this, items.quantity counted packs; now it counts pieces and
-- pack_size says how many pieces make one box. Existing counts, reorder levels
-- and history are converted (3 packs of 3 -> 9).

-- One statement, so the conversion is all-or-nothing and the scan-only guard
-- is lifted just for it.
do $$
begin
  perform set_config('app.via_scan', 'on', true);
  update item_transactions t
     set qty = t.qty * i.pack_size, qty_after = t.qty_after * i.pack_size
    from items i
   where i.id = t.item_id and i.pack_size > 1;
  update items
     set quantity = quantity * pack_size, reorder_level = reorder_level * pack_size
   where pack_size > 1;
end $$;

-- Scans take a quantity in pieces, or in boxes/packs with p_in_packs.
alter function scan_item(text, text, integer, text, uuid, uuid, text) rename to scan_item_v3_retired;
revoke execute on function scan_item_v3_retired(text, text, integer, text, uuid, uuid, text) from public, anon, authenticated;

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

revoke execute on function scan_item(text, text, integer, text, uuid, uuid, text, boolean) from public, anon;
grant execute on function scan_item(text, text, integer, text, uuid, uuid, text, boolean) to authenticated;
