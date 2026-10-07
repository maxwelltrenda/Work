-- Record where things go when checked out: a location from the shared list
-- (e.g. "Main Building"), separate from the rarer offsite events.
alter table tool_checkouts    add column if not exists destination text references locations(name) on update cascade;
alter table item_transactions add column if not exists destination text references locations(name) on update cascade;

drop function if exists scan_item(text, text, integer, text, uuid, uuid);
create or replace function scan_item(p_code text, p_type text, p_qty integer, p_note text default null,
                                     p_member uuid default null, p_event uuid default null,
                                     p_destination text default null)
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
  insert into item_transactions (item_id, type, qty, qty_after, note, member_id, recorded_by, event_id, destination)
  values (v_item.id, p_type, v_change, v_item.quantity, nullif(trim(p_note), ''), v_actor, v_login, p_event, nullif(p_destination, ''));

  return json_build_object('item', row_to_json(v_item), 'change', v_change);
end $$;

drop function if exists checkout_tool(text, uuid, timestamptz, text, uuid);
create or replace function checkout_tool(p_code text, p_borrower uuid, p_due timestamptz default null,
                                         p_note text default null, p_event uuid default null,
                                         p_destination text default null)
returns json
language plpgsql security definer set search_path = public as $$
declare
  v_login uuid := current_member_id();
  v_borrower uuid;
  v_tool tools;
  v_due timestamptz := p_due;
begin
  if v_login is null then raise exception 'Not on the team list'; end if;
  select * into v_tool from tools where upper(code) = upper(trim(p_code)) and active for update;
  if not found then raise exception 'No tool with code %', trim(p_code); end if;
  if v_tool.status = 'out' then raise exception '% is already signed out', v_tool.name; end if;
  if v_tool.status <> 'available' then raise exception '% is marked %', v_tool.name, v_tool.status; end if;
  v_borrower := resolve_actor(p_borrower);
  perform use_event(p_event);
  -- Event gear is due back the day after the event ends.
  if v_due is null and p_event is not null then
    select (ends_on + 1)::timestamptz into v_due from events where id = p_event;
  end if;

  insert into tool_checkouts (tool_id, borrower_id, due_at, out_note, out_by, event_id, destination)
  values (v_tool.id, v_borrower, v_due, nullif(trim(p_note), ''), v_login, p_event, nullif(p_destination, ''));
  perform set_config('app.via_scan', 'on', true);
  update tools set status = 'out' where id = v_tool.id;
  return json_build_object('tool', v_tool.name, 'borrower', (select name from team_members where id = v_borrower));
end $$;

revoke execute on function scan_item(text, text, integer, text, uuid, uuid, text), checkout_tool(text, uuid, timestamptz, text, uuid, text) from public, anon;
grant execute on function scan_item(text, text, integer, text, uuid, uuid, text), checkout_tool(text, uuid, timestamptz, text, uuid, text) to authenticated;
