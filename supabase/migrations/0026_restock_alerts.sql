-- Restock alerts. When an item drops to its reorder level (or below), once per
-- drop:
--   * a "Low stock" notification goes under the admins' bell (and push), and
--   * an email is queued for admins and the area's managers:
--       Facilities stock  -> admins + Custodian managers
--       Maintenance/Paint -> admins + Maintenance managers
--       Event stock       -> admins + Events admins
-- The flag resets once the item is back above its reorder level.
-- Emails go out through the send-restock Edge Function (Resend) once
-- email_config has a key and sender; until then they wait in restock_emails.
-- Paint is measured in gallons (full + partly used cans), like its reorder level.

alter table items add column if not exists restock_alerted_at timestamptz;

alter table notifications drop constraint if exists notifications_kind_check;
alter table notifications add constraint notifications_kind_check check (kind in ('out', 'in', 'low'));
alter table notifications add column if not exists item_id uuid references items(id);

create table if not exists restock_emails (
  id          bigint generated always as identity primary key,
  item_id     uuid not null references items(id),
  level       numeric not null,          -- on hand when it tripped (pieces, or gallons for paint)
  created_at  timestamptz not null default now(),
  sent_at     timestamptz,
  error       text
);
create index if not exists restock_emails_unsent_idx on restock_emails (id) where sent_at is null;
alter table restock_emails enable row level security;   -- no policies: only the sender reads it

create table if not exists email_config (
  id            boolean primary key default true check (id),
  resend_key    text not null,
  from_address  text not null,           -- e.g. 'Mercy Culture Inventory <inventory@example.org>'
  enabled       boolean not null default true
);
alter table email_config enable row level security;
revoke all on email_config from public, anon, authenticated;

create or replace function stock_level(p_item items) returns numeric
language sql stable security definer set search_path = public as $$
  select case when p_item.category = 'paint'
              then (select coalesce(sum(size * fill), 0) from paint_cans where item_id = p_item.id and removed_at is null)
              else p_item.quantity end
$$;

create or replace function check_restock() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_level numeric;
  v_unit text;
  v_area text;
begin
  if not new.active or coalesce(new.reorder_level, 0) <= 0 then
    new.restock_alerted_at := null;
    return new;
  end if;
  v_level := stock_level(new);
  if v_level > new.reorder_level then
    new.restock_alerted_at := null;
  elsif new.restock_alerted_at is null then
    new.restock_alerted_at := now();
    v_unit := case when new.category = 'paint' then ' gal' else '' end;
    v_area := case new.category when 'facilities' then 'Facilities stock' when 'maintenance' then 'Maintenance stock'
                                when 'paint' then 'Paint' else 'Event stock' end;
    insert into notifications (site, kind, item_id, title, body)
    values (case when new.category = 'events' then 'events' else 'facilities' end, 'low', new.id,
            'Low stock: ' || new.name,
            concat_ws(' · ', trim(to_char(v_level, 'FM999990.##'), '.') || v_unit || ' left',
                      'reorder at ' || new.reorder_level || v_unit, v_area, new.location));
    insert into restock_emails (item_id, level) values (new.id, v_level);
  end if;
  return new;
end $$;

create or replace trigger items_restock before update of quantity, reorder_level, active on items
  for each row execute function check_restock();

-- Who gets the email for each kind of stock.
create or replace function restock_recipients(p_category text) returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct lower(email)), '{}') from team_members
   where active and email is not null and (
     role = 'admin'
     or (p_category = 'facilities' and role = 'custodian')
     or (p_category in ('maintenance', 'paint') and role = 'maintenance')
     or (p_category = 'events' and events_role = 'admin'))
$$;

-- Called by the send-restock Edge Function (service role only).
create or replace function claim_restock_batch() returns json
language plpgsql security definer set search_path = public as $$
declare
  v_cfg email_config;
  v json;
begin
  select * into v_cfg from email_config where enabled;
  if not found then return json_build_object('config', null, 'emails', '[]'::json); end if;
  with claimed as (
    update restock_emails set sent_at = now()
     where id in (select id from restock_emails where sent_at is null and created_at > now() - interval '3 days'
                   order by id limit 50 for update skip locked)
    returning *
  )
  select coalesce(json_agg(json_build_object(
           'id', c.id, 'level', c.level, 'name', i.name, 'code', i.code, 'category', i.category,
           'reorder', i.reorder_level, 'location', i.location, 'item_id', i.id,
           'to', restock_recipients(i.category)) order by c.id), '[]'::json)
    into v from claimed c join items i on i.id = c.item_id;
  return json_build_object('config', json_build_object('key', v_cfg.resend_key, 'from', v_cfg.from_address), 'emails', v);
end $$;

create or replace function restock_email_failed(p_id bigint, p_error text) returns void
language sql security definer set search_path = public as $$
  update restock_emails set error = left(p_error, 500) where id = p_id
$$;

revoke execute on function claim_restock_batch(), restock_email_failed(bigint, text), restock_recipients(text)
  from public, anon, authenticated;
grant execute on function claim_restock_batch(), restock_email_failed(bigint, text), restock_recipients(text) to service_role;
revoke execute on function stock_level(items) from public, anon;

-- Wake the email sender after each new alert.
create or replace function poke_restock_sender() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform net.http_post(
    url := 'https://cwuzlpgicxymezvghqgn.supabase.co/functions/v1/send-restock',
    body := '{}'::jsonb,
    headers := '{"Content-Type": "application/json"}'::jsonb);
  return null;
exception when others then
  return null;
end $$;

create or replace trigger restock_emails_send after insert on restock_emails
  for each statement execute function poke_restock_sender();

-- Items already at or below their level when this goes in are marked as
-- alerted, so turning this on doesn't send a flood of emails.
update items i set restock_alerted_at = now()
 where active and coalesce(reorder_level, 0) > 0 and stock_level(i) <= reorder_level;
