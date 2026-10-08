-- Let each team role scan the things in its own area, from its own login:
--   maintenance            — check tools out and in
--   custodian              — take / put back facilities stock
--   member (Facilities & Maintenance) — both
-- Oversight stays view-only. Editing items, tools, people, counts and
-- settings is still admin-only (RLS policies unchanged).

-- Server-side SQL with no signed-in user (migrations, dashboard) is allowed.
create or replace function can_scan_tools() returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when auth.jwt() ->> 'email' is null then true
    else coalesce(my_role() in ('admin', 'kiosk', 'member', 'maintenance'), false)
  end
$$;

create or replace function can_scan_stock(p_category text) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when auth.jwt() ->> 'email' is null then true
    else coalesce(my_role() in ('admin', 'kiosk')
                  or (my_role() in ('member', 'custodian') and p_category = 'facilities'), false)
  end
$$;

-- One guard for every table that scans write to, checking the area involved.
create or replace function guard_view_only() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_ok boolean;
begin
  if tg_table_name in ('tools', 'tool_checkouts') then
    v_ok := can_scan_tools();
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

-- Barcode look-ups only reveal what the signed-in role is allowed to see.
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
                     'checkout', (select row_to_json(c) from (
                        select tc.*, m.name as borrower_name from tool_checkouts tc
                        join team_members m on m.id = tc.borrower_id
                        where tc.tool_id = t.id and tc.returned_at is null) c))
              else json_build_object('kind', 'hidden') end
    into v from tools t where upper(code) = v_code;
  if v is not null then return v; end if;
  select json_build_object('kind', 'person', 'record', json_build_object('id', id, 'name', name, 'code', code, 'active', active))
    into v from team_members where upper(code) = v_code;
  return coalesce(v, json_build_object('kind', 'none'));
end $$;

revoke execute on function can_scan_tools(), can_scan_stock(text) from public, anon;
grant execute on function can_scan_tools(), can_scan_stock(text) to authenticated;
revoke execute on function guard_view_only() from public, anon, authenticated;
