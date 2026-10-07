-- Team inventory + tool sign-out schema.
-- Everything is locked behind Row Level Security: only people listed in
-- team_members (matched by login email) can see or change anything.
-- Stock changes and tool check-outs go through the functions at the bottom,
-- so every change is recorded in a history table and can't be skipped.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create sequence if not exists person_code_seq;
create sequence if not exists item_code_seq;
create sequence if not exists tool_code_seq;

create table if not exists team_members (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  email       text unique,              -- login email; null = can borrow tools but can't log in
  code        text not null unique default ('P-' || lpad(nextval('person_code_seq')::text, 3, '0')),
  role        text not null default 'member' check (role in ('admin', 'member')),
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists items (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique default ('INV-' || lpad(nextval('item_code_seq')::text, 4, '0')),
  name          text not null,
  description   text,
  location      text,
  unit          text not null default 'ea',
  quantity      integer not null default 0,
  reorder_level integer not null default 0,
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);

create table if not exists item_transactions (
  id          bigint generated always as identity primary key,
  item_id     uuid not null references items(id),
  type        text not null check (type in ('in', 'out', 'adjust')),
  qty         integer not null,           -- signed change applied to stock
  qty_after   integer not null,
  note        text,
  member_id   uuid references team_members(id),
  created_at  timestamptz not null default now()
);
create index if not exists item_transactions_item_idx on item_transactions (item_id, created_at desc);

create table if not exists tools (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique default ('TL-' || lpad(nextval('tool_code_seq')::text, 4, '0')),
  name          text not null,
  serial_number text,
  description   text,
  location      text,
  value         numeric(10, 2),
  status        text not null default 'available' check (status in ('available', 'out', 'repair', 'lost', 'retired')),
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);

create table if not exists tool_checkouts (
  id              bigint generated always as identity primary key,
  tool_id         uuid not null references tools(id),
  borrower_id     uuid not null references team_members(id),
  checked_out_at  timestamptz not null default now(),
  due_at          timestamptz,
  out_note        text,
  out_by          uuid references team_members(id),
  returned_at     timestamptz,
  return_note     text,
  return_condition text check (return_condition in ('good', 'damaged', 'needs_repair')),
  in_by           uuid references team_members(id)
);
create index if not exists tool_checkouts_tool_idx on tool_checkouts (tool_id, checked_out_at desc);
-- A tool can only have one open check-out at a time.
create unique index if not exists tool_checkouts_one_open on tool_checkouts (tool_id) where returned_at is null;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function current_member_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from team_members
  where active and email is not null
    and lower(email) = lower(auth.jwt() ->> 'email')
$$;

create or replace function is_team_member() returns boolean
language sql stable security definer set search_path = public as $$
  select current_member_id() is not null
$$;

create or replace function is_team_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from team_members
    where active and role = 'admin' and email is not null
      and lower(email) = lower(auth.jwt() ->> 'email')
  )
$$;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table team_members      enable row level security;
alter table items             enable row level security;
alter table item_transactions enable row level security;
alter table tools             enable row level security;
alter table tool_checkouts    enable row level security;

-- Everyone on the team can read everything.
create policy team_read on team_members      for select to authenticated using (is_team_member());
create policy team_read on items             for select to authenticated using (is_team_member());
create policy team_read on item_transactions for select to authenticated using (is_team_member());
create policy team_read on tools             for select to authenticated using (is_team_member());
create policy team_read on tool_checkouts    for select to authenticated using (is_team_member());

-- Only admins add/edit people, items and tools. Stock counts and check-outs
-- change only through the functions below (no direct insert/update policies).
create policy admin_write on team_members for all to authenticated using (is_team_admin()) with check (is_team_admin());
create policy admin_insert on items for insert to authenticated with check (is_team_admin());
create policy admin_update on items for update to authenticated using (is_team_admin()) with check (is_team_admin());
create policy admin_insert on tools for insert to authenticated with check (is_team_admin());
create policy admin_update on tools for update to authenticated using (is_team_admin()) with check (is_team_admin());

-- Quantity and tool status are owned by the scan functions, not by edit forms:
-- these triggers reject any change to them that doesn't come through one.
create or replace function guard_scan_columns() returns trigger
language plpgsql set search_path = public as $$
begin
  if coalesce(current_setting('app.via_scan', true), '') = 'on' then
    return new;
  end if;
  if tg_table_name = 'items' then
    if (tg_op = 'INSERT' and new.quantity <> 0) or (tg_op = 'UPDATE' and new.quantity <> old.quantity) then
      raise exception 'Change stock by scanning, not by editing the item';
    end if;
  elsif tg_table_name = 'tools' then
    if (tg_op = 'INSERT' and new.status <> 'available') or (tg_op = 'UPDATE' and new.status <> old.status) then
      raise exception 'Change tool status from the Tools page';
    end if;
  end if;
  return new;
end $$;

create trigger items_guard before insert or update on items for each row execute function guard_scan_columns();
create trigger tools_guard before insert or update on tools for each row execute function guard_scan_columns();

-- ---------------------------------------------------------------------------
-- Actions
-- ---------------------------------------------------------------------------

-- First person to sign in on a brand-new install becomes the admin.
create or replace function claim_first_admin(p_name text) returns team_members
language plpgsql security definer set search_path = public as $$
declare
  v_email text := auth.jwt() ->> 'email';
  v_row team_members;
begin
  if v_email is null then
    raise exception 'Not signed in';
  end if;
  lock table team_members in exclusive mode;
  if exists (select 1 from team_members where role = 'admin') then
    raise exception 'This app already has an admin. Ask them to add you.';
  end if;
  insert into team_members (name, email, role)
  values (coalesce(nullif(trim(p_name), ''), v_email), lower(v_email), 'admin')
  returning * into v_row;
  return v_row;
end $$;

create or replace function needs_first_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (select 1 from team_members where role = 'admin')
$$;

-- Scan stock in / out, or set an exact count ('adjust' sets qty to p_qty).
create or replace function scan_item(p_code text, p_type text, p_qty integer, p_note text default null)
returns json
language plpgsql security definer set search_path = public as $$
declare
  v_member uuid := current_member_id();
  v_item items;
  v_change integer;
begin
  if v_member is null then raise exception 'Not on the team list'; end if;
  if p_type not in ('in', 'out', 'adjust') then raise exception 'Bad scan type'; end if;
  if p_qty is null or p_qty < 0 or (p_type <> 'adjust' and p_qty = 0) then
    raise exception 'Quantity must be more than 0';
  end if;
  if p_type = 'adjust' and not is_team_admin() then
    raise exception 'Only admins can set an exact count';
  end if;

  select * into v_item from items where upper(code) = upper(trim(p_code)) and active for update;
  if not found then raise exception 'No item with code %', trim(p_code); end if;

  v_change := case p_type when 'in' then p_qty when 'out' then -p_qty else p_qty - v_item.quantity end;
  if v_item.quantity + v_change < 0 then
    raise exception 'Only % % of % on hand', v_item.quantity, v_item.unit, v_item.name;
  end if;

  perform set_config('app.via_scan', 'on', true);
  update items set quantity = quantity + v_change where id = v_item.id returning * into v_item;
  insert into item_transactions (item_id, type, qty, qty_after, note, member_id)
  values (v_item.id, p_type, v_change, v_item.quantity, nullif(trim(p_note), ''), v_member);

  return json_build_object('item', row_to_json(v_item), 'change', v_change);
end $$;

-- Look up whatever a barcode points to: item, tool or person.
create or replace function lookup_code(p_code text) returns json
language plpgsql stable security definer set search_path = public as $$
declare
  v_code text := upper(trim(p_code));
  v json;
begin
  if not is_team_member() then raise exception 'Not on the team list'; end if;
  select json_build_object('kind', 'item', 'record', row_to_json(i)) into v from items i where upper(code) = v_code;
  if v is not null then return v; end if;
  select json_build_object('kind', 'tool', 'record', row_to_json(t),
           'checkout', (select row_to_json(c) from (
              select tc.*, m.name as borrower_name from tool_checkouts tc
              join team_members m on m.id = tc.borrower_id
              where tc.tool_id = t.id and tc.returned_at is null) c))
    into v from tools t where upper(code) = v_code;
  if v is not null then return v; end if;
  select json_build_object('kind', 'person', 'record', json_build_object('id', id, 'name', name, 'code', code, 'active', active))
    into v from team_members where upper(code) = v_code;
  return coalesce(v, json_build_object('kind', 'none'));
end $$;

create or replace function checkout_tool(p_code text, p_borrower uuid, p_due timestamptz default null, p_note text default null)
returns json
language plpgsql security definer set search_path = public as $$
declare
  v_member uuid := current_member_id();
  v_tool tools;
  v_borrower team_members;
begin
  if v_member is null then raise exception 'Not on the team list'; end if;
  select * into v_tool from tools where upper(code) = upper(trim(p_code)) and active for update;
  if not found then raise exception 'No tool with code %', trim(p_code); end if;
  if v_tool.status = 'out' then raise exception '% is already signed out', v_tool.name; end if;
  if v_tool.status <> 'available' then raise exception '% is marked %', v_tool.name, v_tool.status; end if;
  select * into v_borrower from team_members where id = coalesce(p_borrower, v_member) and active;
  if not found then raise exception 'Unknown person'; end if;

  insert into tool_checkouts (tool_id, borrower_id, due_at, out_note, out_by)
  values (v_tool.id, v_borrower.id, p_due, nullif(trim(p_note), ''), v_member);
  perform set_config('app.via_scan', 'on', true);
  update tools set status = 'out' where id = v_tool.id;
  return json_build_object('tool', v_tool.name, 'borrower', v_borrower.name);
end $$;

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
  update tool_checkouts
     set returned_at = now(), return_note = nullif(trim(p_note), ''), return_condition = v_condition, in_by = v_member
   where tool_id = v_tool.id and returned_at is null
  returning * into v_checkout;
  if not found then raise exception '% is not signed out', v_tool.name; end if;
  perform set_config('app.via_scan', 'on', true);
  update tools set status = case when v_condition = 'good' then 'available' else 'repair' end where id = v_tool.id;
  return json_build_object('tool', v_tool.name, 'condition', v_condition);
end $$;

-- Admin-only: change a tool's status by hand (e.g. back from repair, lost).
create or replace function set_tool_status(p_tool uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_team_admin() then raise exception 'Admins only'; end if;
  if p_status not in ('available', 'repair', 'lost', 'retired') then raise exception 'Bad status'; end if;
  if exists (select 1 from tool_checkouts where tool_id = p_tool and returned_at is null) then
    raise exception 'Return the tool before changing its status';
  end if;
  perform set_config('app.via_scan', 'on', true);
  update tools set status = p_status where id = p_tool;
end $$;

revoke execute on all functions in schema public from public, anon;
grant execute on function current_member_id(), is_team_member(), is_team_admin(), claim_first_admin(text),
  needs_first_admin(), scan_item(text, text, integer, text), lookup_code(text),
  checkout_tool(text, uuid, timestamptz, text), return_tool(text, text, text), set_tool_status(uuid, text)
  to authenticated;
