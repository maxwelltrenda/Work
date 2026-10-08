-- Maintenance stock: supplies for maintenance work (degreaser, caulk, filters…).
-- Works like facilities stock, with its own barcode prefix MNT-0001.
--   sees it:  admin, kiosk, oversight, maintenance, member (Facilities & Maintenance)
--   scans it: admin, kiosk, maintenance, member

alter table items drop constraint if exists items_category_check;
alter table items add constraint items_category_check check (category in ('facilities', 'events', 'maintenance'));

create sequence if not exists mnt_code_seq;

create or replace function set_item_code() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.code is null or new.code = '' then
    new.code := case new.category
      when 'events' then 'EVS-' || lpad(nextval('evs_code_seq')::text, 4, '0')
      when 'maintenance' then 'MNT-' || lpad(nextval('mnt_code_seq')::text, 4, '0')
      else 'FAC-' || lpad(nextval('fac_code_seq')::text, 4, '0')
    end;
  end if;
  return new;
end $$;

create or replace function can_see_stock(p_category text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(my_role() in ('admin', 'kiosk', 'oversight')
                  or (my_role() in ('member', 'custodian') and p_category = 'facilities')
                  or (my_role() in ('member', 'maintenance') and p_category = 'maintenance'), false)
$$;

create or replace function can_scan_stock(p_category text) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when auth.jwt() ->> 'email' is null then true
    else coalesce(my_role() in ('admin', 'kiosk')
                  or (my_role() in ('member', 'custodian') and p_category = 'facilities')
                  or (my_role() in ('member', 'maintenance') and p_category = 'maintenance'), false)
  end
$$;
