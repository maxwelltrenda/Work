-- Admin notifications: every time a tool or piece of gear is signed out or
-- returned, a row goes into notifications. Admins see them under the bell in
-- the top bar, and devices that turned on push notifications get a push.
--   Full admins see every site; Media admins see Media gear.
-- Pushes are sent by the send-push Edge Function, which a trigger calls right
-- after each new notification (via pg_net). The function only ever sends
-- notifications that haven't been pushed yet, so calling it does nothing else.

create extension if not exists pg_net with schema extensions;

create table if not exists notifications (
  id           bigint generated always as identity primary key,
  created_at   timestamptz not null default now(),
  site         text not null,                 -- facilities | media
  kind         text not null check (kind in ('out', 'in')),
  tool_id      uuid references tools(id),
  checkout_id  bigint references tool_checkouts(id),
  title        text not null,
  body         text,
  pushed_at    timestamptz
);
create index if not exists notifications_recent_idx on notifications (created_at desc);
create index if not exists notifications_unpushed_idx on notifications (id) where pushed_at is null;
alter table notifications enable row level security;
create policy admin_read on notifications for select to authenticated using (is_site_admin(site));

alter table team_members add column if not exists notif_seen_at timestamptz;

create table if not exists push_subscriptions (
  id          bigint generated always as identity primary key,
  member_id   uuid not null references team_members(id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  site        text not null,                  -- which app turned it on (opened on tap)
  created_at  timestamptz not null default now()
);
alter table push_subscriptions enable row level security;
create policy own_read on push_subscriptions for select to authenticated using (member_id = current_member_id());
-- Changes only through the functions below.

-- Build the notification text and record it.
create or replace function notify_checkout() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_tool tools;
  v_who text;
  v_kind text;
  v_body text;
begin
  if tg_op = 'INSERT' then
    v_kind := 'out';
  elsif old.returned_at is null and new.returned_at is not null then
    v_kind := 'in';
  else
    return new;
  end if;
  select * into v_tool from tools where id = new.tool_id;
  select name into v_who from team_members where id = new.borrower_id;
  if v_kind = 'out' then
    v_body := concat_ws(' · ', coalesce(v_who, 'Someone'),
      case when coalesce(new.qty, 1) > 1 then new.qty || ' of them' end,
      case when nullif(new.destination, '') is not null then 'to ' || new.destination end,
      nullif(new.out_note, ''));
  else
    v_body := concat_ws(' · ', coalesce(v_who, 'Someone'),
      case when coalesce(new.qty, 1) > 1 then new.qty || ' of them' end,
      case when new.return_condition is not null and new.return_condition <> 'good' then 'condition: ' || new.return_condition end,
      case when new.batteries_ok is false then 'batteries not charged' end,
      case when new.cards_offloaded is false then 'cards not offloaded' end,
      nullif(new.return_note, ''));
  end if;
  insert into notifications (site, kind, tool_id, checkout_id, title, body)
  values (coalesce(v_tool.site, 'facilities'), v_kind, new.tool_id, new.id,
          case v_kind when 'out' then 'Signed out: ' else 'Returned: ' end || coalesce(v_tool.name, 'a tool'),
          v_body);
  return new;
end $$;

create or replace trigger tool_checkouts_notify after insert or update of returned_at on tool_checkouts
  for each row execute function notify_checkout();

-- Wake the push sender after each new notification.
create or replace function poke_push_sender() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform net.http_post(
    url := 'https://cwuzlpgicxymezvghqgn.supabase.co/functions/v1/send-push',
    body := '{}'::jsonb,
    headers := '{"Content-Type": "application/json"}'::jsonb);
  return null;
exception when others then
  return null;   -- never let a push problem block a checkout
end $$;

create or replace trigger notifications_push after insert on notifications
  for each statement execute function poke_push_sender();

-- Called by the Edge Function (service role only): claim the notifications
-- that haven't been pushed and list the devices each one goes to.
create or replace function claim_push_batch() returns json
language plpgsql security definer set search_path = public as $$
declare
  v json;
begin
  with claimed as (
    update notifications set pushed_at = now()
     where id in (select id from notifications where pushed_at is null
                   and created_at > now() - interval '15 minutes' order by id limit 50 for update skip locked)
    returning *
  )
  select coalesce(json_agg(json_build_object(
           'id', c.id, 'site', c.site, 'kind', c.kind, 'title', c.title, 'body', c.body,
           'subs', (select coalesce(json_agg(json_build_object('id', s.id, 'endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth, 'site', s.site)), '[]'::json)
                      from push_subscriptions s join team_members m on m.id = s.member_id
                     where m.active and (m.role = 'admin' or (c.site = 'media' and m.media_role = 'lead')))
         ) order by c.id), '[]'::json)
    into v from claimed c;
  -- Old ones that never went out (e.g. the sender was down) are just marked done.
  update notifications set pushed_at = now() where pushed_at is null and created_at <= now() - interval '15 minutes';
  return v;
end $$;

create or replace function drop_push_subscription_by_id(p_id bigint) returns void
language sql security definer set search_path = public as $$
  delete from push_subscriptions where id = p_id
$$;

revoke execute on function claim_push_batch(), drop_push_subscription_by_id(bigint) from public, anon, authenticated;
grant execute on function claim_push_batch(), drop_push_subscription_by_id(bigint) to service_role;

-- Turn push on / off for this device.
create or replace function save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_site text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := current_member_id();
begin
  if v_me is null then raise exception 'Not on the team list'; end if;
  if p_endpoint !~ '^https://' then raise exception 'Bad push address'; end if;
  insert into push_subscriptions (member_id, endpoint, p256dh, auth, site)
  values (v_me, p_endpoint, p_p256dh, p_auth, coalesce(nullif(p_site, ''), 'facilities'))
  on conflict (endpoint) do update set member_id = excluded.member_id, p256dh = excluded.p256dh,
    auth = excluded.auth, site = excluded.site;
end $$;

create or replace function delete_push_subscription(p_endpoint text) returns void
language sql security definer set search_path = public as $$
  delete from push_subscriptions where endpoint = p_endpoint and member_id = current_member_id()
$$;

-- Everything up to now has been seen.
create or replace function mark_notifications_seen() returns timestamptz
language plpgsql security definer set search_path = public as $$
declare
  v timestamptz := now();
begin
  perform set_config('app.team_edit', 'on', true);
  update team_members set notif_seen_at = v where id = current_member_id();
  return v;
end $$;

revoke execute on function save_push_subscription(text, text, text, text), delete_push_subscription(text), mark_notifications_seen() from public, anon;
grant execute on function save_push_subscription(text, text, text, text), delete_push_subscription(text), mark_notifications_seen() to authenticated;

-- The push signing keys (VAPID). The private key is put in by hand, never in
-- this repo; only the send-push function (service role) can read it.
create table if not exists push_config (
  id           boolean primary key default true check (id),
  public_key   text not null,
  private_key  text not null
);
alter table push_config enable row level security;
revoke all on push_config from public, anon, authenticated;

create or replace function push_vapid_keys() returns json
language sql stable security definer set search_path = public as $$
  select json_build_object('public', public_key, 'private', private_key) from push_config
$$;
revoke execute on function push_vapid_keys() from public, anon, authenticated;
grant execute on function push_vapid_keys() to service_role;
