-- Shared warehouse kiosk + offsite events.
--
-- Kiosk: a 'kiosk' role for a shared device login (e.g. a wall-mounted iPad).
-- It can scan and sign tools in/out on behalf of whoever identifies at the
-- device, but can't do any admin work. Every record keeps both the person it
-- was for and the login that recorded it.
--
-- Events: offsite jobs with a crew. Tools and stock scanned out "to an event"
-- are tagged with it, so the event page shows what went, what came back and
-- what's still missing.

alter table team_members drop constraint if exists team_members_role_check;
alter table team_members add constraint team_members_role_check check (role in ('admin', 'member', 'kiosk'));

create sequence if not exists event_code_seq;

create table if not exists events (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique default ('EV-' || lpad(nextval('event_code_seq')::text, 4, '0')),
  name        text not null,
  location    text,
  starts_on   date,
  ends_on     date,
  notes       text,
  status      text not null default 'planned' check (status in ('planned', 'active', 'closed')),
  created_by  uuid references team_members(id) default current_member_id(),
  created_at  timestamptz not null default now()
);

create table if not exists event_crew (
  event_id   uuid not null references events(id) on delete cascade,
  member_id  uuid not null references team_members(id),
  primary key (event_id, member_id)
);

alter table item_transactions add column if not exists event_id uuid references events(id);
alter table item_transactions add column if not exists recorded_by uuid references team_members(id);
alter table tool_checkouts    add column if not exists event_id uuid references events(id);
create index if not exists item_transactions_event_idx on item_transactions (event_id) where event_id is not null;
create index if not exists tool_checkouts_event_idx on tool_checkouts (event_id) where event_id is not null;

alter table events     enable row level security;
alter table event_crew enable row level security;

-- Anyone on the team (kiosk included) can plan events and set the crew.
create policy team_read   on events     for select to authenticated using (is_team_member());
create policy team_insert on events     for insert to authenticated with check (is_team_member());
create policy team_update on events     for update to authenticated using (is_team_member()) with check (is_team_member());
create policy team_read   on event_crew for select to authenticated using (is_team_member());
create policy team_insert on event_crew for insert to authenticated with check (is_team_member());
create policy team_delete on event_crew for delete to authenticated using (is_team_member());

-- The person an action is for: the given person if any, otherwise the login.
-- Kiosk logins must name a real person.
create or replace function resolve_actor(p_member uuid) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if p_member is null then
    select id into v_id from team_members where id = current_member_id() and role <> 'kiosk';
    if v_id is null then raise exception 'Scan your name label first'; end if;
    return v_id;
  end if;
  select id into v_id from team_members where id = p_member and active and role <> 'kiosk';
  if v_id is null then raise exception 'Unknown person'; end if;
  return v_id;
end $$;

create or replace function use_event(p_event uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_status text;
begin
  if p_event is null then return; end if;
  select status into v_status from events where id = p_event for update;
  if v_status is null then raise exception 'Unknown event'; end if;
  if v_status = 'closed' then raise exception 'That event is closed'; end if;
  update events set status = 'active' where id = p_event and status = 'planned';
end $$;

drop function if exists scan_item(text, text, integer, text);
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
    raise exception 'Only % % of % on hand', v_item.quantity, v_item.unit, v_item.name;
  end if;
  perform use_event(p_event);

  perform set_config('app.via_scan', 'on', true);
  update items set quantity = quantity + v_change where id = v_item.id returning * into v_item;
  insert into item_transactions (item_id, type, qty, qty_after, note, member_id, recorded_by, event_id)
  values (v_item.id, p_type, v_change, v_item.quantity, nullif(trim(p_note), ''), v_actor, v_login, p_event);

  return json_build_object('item', row_to_json(v_item), 'change', v_change);
end $$;

drop function if exists checkout_tool(text, uuid, timestamptz, text);
create or replace function checkout_tool(p_code text, p_borrower uuid, p_due timestamptz default null,
                                         p_note text default null, p_event uuid default null)
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

  insert into tool_checkouts (tool_id, borrower_id, due_at, out_note, out_by, event_id)
  values (v_tool.id, v_borrower, v_due, nullif(trim(p_note), ''), v_login, p_event);
  perform set_config('app.via_scan', 'on', true);
  update tools set status = 'out' where id = v_tool.id;
  return json_build_object('tool', v_tool.name, 'borrower', (select name from team_members where id = v_borrower));
end $$;

-- Mark a tool that never came back from an event (or anywhere) as lost.
create or replace function mark_tool_lost(p_tool uuid, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_login uuid := current_member_id();
begin
  if v_login is null then raise exception 'Not on the team list'; end if;
  update tool_checkouts
     set returned_at = now(), return_condition = 'damaged', return_note = coalesce(nullif(trim(p_note), ''), 'Marked lost'), in_by = v_login
   where tool_id = p_tool and returned_at is null;
  perform set_config('app.via_scan', 'on', true);
  update tools set status = 'lost' where id = p_tool;
end $$;

revoke execute on all functions in schema public from public, anon;
-- Internal helpers: only called from inside the functions above.
revoke execute on function resolve_actor(uuid), use_event(uuid) from authenticated;
grant execute on function scan_item(text, text, integer, text, uuid, uuid),
  checkout_tool(text, uuid, timestamptz, text, uuid), mark_tool_lost(uuid, text)
  to authenticated;

-- Anyone can flag a tool that's in the crib as damaged / needing repair
-- (e.g. right after a quick return at the kiosk). Admins clear it later.
create or replace function report_tool_problem(p_tool uuid, p_condition text, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_login uuid := current_member_id();
  v_last bigint;
begin
  if v_login is null then raise exception 'Not on the team list'; end if;
  if p_condition not in ('damaged', 'needs_repair') then raise exception 'Bad condition'; end if;
  if exists (select 1 from tool_checkouts where tool_id = p_tool and returned_at is null) then
    raise exception 'Return the tool first';
  end if;
  select id into v_last from tool_checkouts where tool_id = p_tool order by returned_at desc nulls last limit 1;
  if v_last is not null then
    update tool_checkouts
       set return_condition = p_condition,
           return_note = concat_ws(' / ', return_note, nullif(trim(p_note), ''))
     where id = v_last;
  end if;
  perform set_config('app.via_scan', 'on', true);
  update tools set status = 'repair' where id = p_tool and status = 'available';
end $$;

revoke execute on function report_tool_problem(uuid, text, text) from public, anon;
grant execute on function report_tool_problem(uuid, text, text) to authenticated;
