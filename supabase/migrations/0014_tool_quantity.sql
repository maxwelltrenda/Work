-- Tool quantities: one tool record (one barcode) can stand for several of the
-- same thing, e.g. "Hammer x6". Each sign-out records how many were taken, a
-- tool can have several open sign-outs at once, and returns can be partial.
--
--   available = quantity - (signed out) - repair_qty
--   status    = available when any are in, out when none are in but some are
--               signed out, repair when the rest are all flagged for repair.
--               lost / retired are set by hand and left alone.

alter table tools add column if not exists quantity integer not null default 1 check (quantity >= 1);
alter table tools add column if not exists repair_qty integer not null default 0 check (repair_qty >= 0);
alter table tool_checkouts add column if not exists qty integer not null default 1 check (qty >= 1);

-- Several people can each have some of the same tool now.
drop index if exists tool_checkouts_one_open;
create index if not exists tool_checkouts_open_idx on tool_checkouts (tool_id) where returned_at is null;

-- Single tools already flagged for repair keep that state.
update tools set repair_qty = quantity where status = 'repair' and repair_qty = 0;

create or replace function tool_out_qty(p_tool uuid) returns integer
language sql stable security definer set search_path = public as $$
  select coalesce(sum(qty), 0)::integer from tool_checkouts where tool_id = p_tool and returned_at is null
$$;

create or replace function refresh_tool_status(p_tool uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v tools;
  v_out integer := tool_out_qty(p_tool);
begin
  select * into v from tools where id = p_tool;
  if v.status in ('lost', 'retired') then return; end if;
  perform set_config('app.via_scan', 'on', true);
  update tools set status = case
      when v.quantity - v_out - v.repair_qty > 0 then 'available'
      when v_out > 0 then 'out'
      else 'repair' end
   where id = p_tool;
end $$;

-- Editing a tool's quantity: can't go below what's signed out, and the status
-- follows the new count.
create or replace function tools_quantity_check() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_out integer;
begin
  if new.quantity is distinct from old.quantity or new.repair_qty is distinct from old.repair_qty then
    v_out := tool_out_qty(new.id);
    if new.quantity < v_out then
      raise exception '% of % are signed out right now, so the quantity can''t go below %', v_out, new.name, v_out;
    end if;
    new.repair_qty := least(new.repair_qty, new.quantity - v_out);
    if new.status in ('available', 'out', 'repair') then
      new.status := case
        when new.quantity - v_out - new.repair_qty > 0 then 'available'
        when v_out > 0 then 'out'
        else 'repair' end;
    end if;
  end if;
  return new;
end $$;

-- Runs after the scan-column guard (triggers fire alphabetically), so the
-- recomputed status isn't mistaken for a hand edit.
create trigger tools_zz_quantity before update on tools for each row execute function tools_quantity_check();

-- Sign out N of a tool.
alter function checkout_tool(text, uuid, timestamptz, text, uuid, text) rename to checkout_tool_v3_retired;
revoke execute on function checkout_tool_v3_retired(text, uuid, timestamptz, text, uuid, text) from public, anon, authenticated;

create or replace function checkout_tool(p_code text, p_borrower uuid, p_due timestamptz default null,
                                         p_note text default null, p_event uuid default null,
                                         p_destination text default null, p_qty integer default 1)
returns json
language plpgsql security definer set search_path = public as $$
declare
  v_login uuid := current_member_id();
  v_borrower uuid;
  v_tool tools;
  v_due timestamptz := p_due;
  v_qty integer := coalesce(p_qty, 1);
  v_avail integer;
begin
  if v_login is null then raise exception 'Not on the team list'; end if;
  if v_qty < 1 then raise exception 'Quantity must be at least 1'; end if;
  select * into v_tool from tools where upper(code) = upper(trim(p_code)) and active for update;
  if not found then raise exception 'No tool with code %', trim(p_code); end if;
  if v_tool.status in ('lost', 'retired') then raise exception '% is marked %', v_tool.name, v_tool.status; end if;
  v_avail := v_tool.quantity - tool_out_qty(v_tool.id) - v_tool.repair_qty;
  if v_avail < v_qty then
    if v_tool.quantity = 1 then
      if v_tool.status = 'out' then raise exception '% is already signed out', v_tool.name; end if;
      raise exception '% is marked %', v_tool.name, v_tool.status;
    end if;
    raise exception 'Only % of % available', greatest(v_avail, 0), v_tool.name;
  end if;
  v_borrower := resolve_actor(p_borrower);
  perform use_event(p_event);
  -- Event gear is due back the day after the event ends.
  if v_due is null and p_event is not null then
    select (ends_on + 1)::timestamptz into v_due from events where id = p_event;
  end if;

  insert into tool_checkouts (tool_id, borrower_id, due_at, out_note, out_by, event_id, destination, qty)
  values (v_tool.id, v_borrower, v_due, nullif(trim(p_note), ''), v_login, p_event, nullif(p_destination, ''), v_qty);
  perform refresh_tool_status(v_tool.id);
  return json_build_object('tool', v_tool.name, 'qty', v_qty, 'borrower', (select name from team_members where id = v_borrower));
end $$;

-- Return a single tool by scanning it (unchanged for one-of-a-kind tools).
create or replace function return_tool(p_code text, p_condition text default 'good', p_note text default null)
returns json
language plpgsql security definer set search_path = public as $$
declare
  v_member uuid := current_member_id();
  v_tool tools;
  v_checkout tool_checkouts;
  v_condition text := coalesce(p_condition, 'good');
begin
  if v_member is null then raise exception 'Not on the team list'; end if;
  if v_condition not in ('good', 'damaged', 'needs_repair') then raise exception 'Bad condition'; end if;
  select * into v_tool from tools where upper(code) = upper(trim(p_code)) and active for update;
  if not found then raise exception 'No tool with code %', trim(p_code); end if;
  if (select count(*) from tool_checkouts where tool_id = v_tool.id and returned_at is null) > 1 then
    raise exception 'Several people have % — pick whose to return', v_tool.name;
  end if;
  update tool_checkouts
     set returned_at = now(), return_note = nullif(trim(p_note), ''), return_condition = v_condition, in_by = v_member
   where tool_id = v_tool.id and returned_at is null
  returning * into v_checkout;
  if not found then raise exception '% is not signed out', v_tool.name; end if;
  if v_condition <> 'good' then
    perform set_config('app.via_scan', 'on', true);
    update tools set repair_qty = least(quantity, repair_qty + v_checkout.qty) where id = v_tool.id;
  end if;
  perform refresh_tool_status(v_tool.id);
  return json_build_object('tool', v_tool.name, 'condition', v_condition, 'qty', v_checkout.qty);
end $$;

-- Return some or all of one sign-out (used for tools with a quantity).
create or replace function return_tool_checkout(p_checkout bigint, p_qty integer default null)
returns json
language plpgsql security definer set search_path = public as $$
declare
  v_member uuid := current_member_id();
  v_c tool_checkouts;
  v_n integer;
begin
  if v_member is null then raise exception 'Not on the team list'; end if;
  select * into v_c from tool_checkouts where id = p_checkout and returned_at is null for update;
  if not found then raise exception 'That sign-out is already returned'; end if;
  perform 1 from tools where id = v_c.tool_id for update;
  v_n := coalesce(p_qty, v_c.qty);
  if v_n < 1 or v_n > v_c.qty then raise exception 'Return between 1 and %', v_c.qty; end if;
  if v_n < v_c.qty then
    -- Partial return: the rest stays signed out on the original record.
    update tool_checkouts set qty = qty - v_n where id = v_c.id;
    insert into tool_checkouts (tool_id, borrower_id, checked_out_at, due_at, out_note, out_by, event_id, destination, qty,
                                returned_at, return_condition, in_by)
    values (v_c.tool_id, v_c.borrower_id, v_c.checked_out_at, v_c.due_at, v_c.out_note, v_c.out_by, v_c.event_id, v_c.destination, v_n,
            now(), 'good', v_member);
  else
    update tool_checkouts set returned_at = now(), return_condition = 'good', in_by = v_member where id = v_c.id;
  end if;
  perform refresh_tool_status(v_c.tool_id);
  return json_build_object('tool', (select name from tools where id = v_c.tool_id), 'qty', v_n, 'left', v_c.qty - v_n);
end $$;

-- Flag returned tools as damaged / needing repair (N of them for a quantity tool).
alter function report_tool_problem(uuid, text, text) rename to report_tool_problem_v1_retired;
revoke execute on function report_tool_problem_v1_retired(uuid, text, text) from public, anon, authenticated;

create or replace function report_tool_problem(p_tool uuid, p_condition text, p_note text default null, p_qty integer default 1)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_login uuid := current_member_id();
  v_tool tools;
  v_last bigint;
begin
  if v_login is null then raise exception 'Not on the team list'; end if;
  if p_condition not in ('damaged', 'needs_repair') then raise exception 'Bad condition'; end if;
  select * into v_tool from tools where id = p_tool for update;
  if not found then raise exception 'No such tool'; end if;
  if v_tool.quantity = 1 and exists (select 1 from tool_checkouts where tool_id = p_tool and returned_at is null) then
    raise exception 'Return the tool first';
  end if;
  select id into v_last from tool_checkouts where tool_id = p_tool and returned_at is not null order by returned_at desc limit 1;
  if v_last is not null then
    update tool_checkouts
       set return_condition = p_condition,
           return_note = concat_ws(' / ', return_note, nullif(trim(p_note), ''))
     where id = v_last;
  end if;
  perform set_config('app.via_scan', 'on', true);
  update tools set repair_qty = least(quantity - tool_out_qty(p_tool), repair_qty + greatest(coalesce(p_qty, 1), 1)) where id = p_tool;
  perform refresh_tool_status(p_tool);
end $$;

-- Admin: change a tool's status by hand. "available" clears repairs;
-- "repair" flags every one that's in.
create or replace function set_tool_status(p_tool uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_tool tools;
begin
  if not is_team_admin() then raise exception 'Admins only'; end if;
  if p_status not in ('available', 'repair', 'lost', 'retired') then raise exception 'Bad status'; end if;
  select * into v_tool from tools where id = p_tool for update;
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

-- Mark one sign-out as lost (e.g. didn't come back from an event). For a
-- quantity tool that many are written off; a single tool is marked lost.
create or replace function mark_checkout_lost(p_checkout bigint, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_login uuid := current_member_id();
  v_c tool_checkouts;
  v_tool tools;
begin
  if v_login is null then raise exception 'Not on the team list'; end if;
  if not can_act() then raise exception 'Your role is view-only'; end if;
  select * into v_c from tool_checkouts where id = p_checkout and returned_at is null for update;
  if not found then raise exception 'That sign-out is already closed'; end if;
  select * into v_tool from tools where id = v_c.tool_id for update;
  update tool_checkouts
     set returned_at = now(), return_condition = 'damaged', return_note = coalesce(nullif(trim(p_note), ''), 'Marked lost'), in_by = v_login
   where id = v_c.id;
  perform set_config('app.via_scan', 'on', true);
  if v_tool.quantity - v_c.qty >= 1 then
    update tools set quantity = quantity - v_c.qty where id = v_tool.id;
    perform refresh_tool_status(v_tool.id);
  else
    update tools set status = 'lost' where id = v_tool.id;
  end if;
end $$;

-- Barcode look-up: a tool now comes back with every open sign-out and how many are in.
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
  select case when can_see_tools()
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

revoke execute on function tool_out_qty(uuid), refresh_tool_status(uuid), tools_quantity_check() from public, anon, authenticated;
revoke execute on function checkout_tool(text, uuid, timestamptz, text, uuid, text, integer), return_tool_checkout(bigint, integer),
  report_tool_problem(uuid, text, text, integer), mark_checkout_lost(bigint, text) from public, anon;
grant execute on function checkout_tool(text, uuid, timestamptz, text, uuid, text, integer), return_tool_checkout(bigint, integer),
  report_tool_problem(uuid, text, text, integer), mark_checkout_lost(bigint, text) to authenticated;
