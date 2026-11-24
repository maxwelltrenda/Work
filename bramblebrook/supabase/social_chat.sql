-- Applied to the Bramblebrook project on 2026-11-24 as migration "social_chat".
-- Social: follows, world chat, direct messages (only between players who follow each other) and a
-- notification feed that the server fills on its own when something happens in your village, at your
-- village's boss, or when someone follows you. Everything goes through the functions below.
create table public.follows (
  follower uuid not null references auth.users (id) on delete cascade,
  followee uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower, followee),
  check (follower <> followee)
);
create index follows_followee on public.follows (followee);

create table public.world_chat (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 280),
  created_at timestamptz not null default now()
);

create table public.direct_messages (
  id bigint generated always as identity primary key,
  from_user uuid not null references auth.users (id) on delete cascade,
  to_user uuid not null references auth.users (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 500),
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index dm_pair on public.direct_messages (least(from_user, to_user), greatest(from_user, to_user), id desc);
create index dm_unread on public.direct_messages (to_user) where read_at is null;

create table public.notifications (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null,
  icon text not null default '🔔',
  body text not null,
  link jsonb not null default '{}'::jsonb,       -- where a tap goes: {"to":"village"}, {"to":"boss"}, {"to":"profile","id":...}
  actor uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index notifications_user on public.notifications (user_id, id desc);

alter table public.follows enable row level security;
alter table public.world_chat enable row level security;
alter table public.direct_messages enable row level security;
alter table public.notifications enable row level security;
create policy "players see their own follows" on public.follows for select to authenticated using ((select auth.uid()) in (follower, followee));
create policy "world chat is public" on public.world_chat for select to authenticated using (true);
create policy "players read their own messages" on public.direct_messages for select to authenticated using ((select auth.uid()) in (from_user, to_user));
create policy "players read their own notifications" on public.notifications for select to authenticated using (user_id = (select auth.uid()));

-- the name another player sees: their farmer's name, else their username
create or replace function public.player_name(p_user uuid) returns text
language sql security definer set search_path = '' stable as $$
  select coalesce(nullif(p.public->>'name', ''), p.username, 'Someone') from public.profiles p where p.id = p_user;
$$;
create or replace function public.notify_village(p_village uuid, p_actor uuid, p_kind text, p_icon text, p_body text, p_link jsonb) returns void
language sql security definer set search_path = '' as $$
  insert into public.notifications (user_id, kind, icon, body, link, actor)
  select m.user_id, p_kind, p_icon, p_body, coalesce(p_link, '{}'::jsonb), p_actor
  from public.village_members m where m.village_id = p_village and m.user_id is distinct from p_actor;
$$;

-- village news (chat stays in chat)
create or replace function public.on_village_log() returns trigger
language plpgsql security definer set search_path = '' as $$
declare who text := coalesce(public.player_name(new.user_id), 'Someone');
begin
  if new.kind = 'join' then perform public.notify_village(new.village_id, new.user_id, 'village', '🏡', who || ' moved into the village', '{"to":"village"}');
  elsif new.kind = 'leave' then perform public.notify_village(new.village_id, new.user_id, 'village', '👋', who || ' moved away', '{"to":"village"}');
  elsif new.kind = 'build' then perform public.notify_village(new.village_id, new.user_id, 'village', '🏗️', who || ' raised the ' || new.body, '{"to":"village"}');
  elsif new.kind = 'donate' then perform public.notify_village(new.village_id, new.user_id, 'village', '🪙', who || ' gave ' || to_char(new.amount, 'FM999,999,999') || ' coins to the treasury', '{"to":"village"}');
  elsif new.kind = 'promote' then perform public.notify_village(new.village_id, null, 'village', '⭐', who || ' became an elder', '{"to":"village"}');
  end if;
  return null;
end $$;
create trigger village_log_notify after insert on public.village_log for each row execute function public.on_village_log();

-- the village boss: summoned, a phase cleared, beaten or gone
create or replace function public.on_village_raid() returns trigger
language plpgsql security definer set search_path = '' as $$
declare d public.raid_boss_defs; ph text;
begin
  select * into d from public.raid_boss_defs where id = new.boss;
  if tg_op = 'INSERT' then
    perform public.notify_village(new.village_id, new.started_by, 'boss', '⚔️', coalesce(public.player_name(new.started_by), 'An elder') || ' summoned ' || d.n || '! Every attack helps.', '{"to":"boss"}');
  elsif new.status = 'won' and old.status = 'active' then
    perform public.notify_village(new.village_id, null, 'boss', '🏆', d.n || ' is beaten! Collect your share in the village.', '{"to":"boss"}');
  elsif new.status = 'lost' and old.status = 'active' then
    perform public.notify_village(new.village_id, null, 'boss', '💨', d.n || ' got away. Everyone who fought still gets half a share.', '{"to":"boss"}');
  elsif new.phase > old.phase then
    ph := d.phases -> new.phase ->> 'n';
    perform public.notify_village(new.village_id, null, 'boss', '⚔️', 'Phase ' || (new.phase + 1) || ' of ' || d.n || ': ' || coalesce(ph, 'it fights on') || '.', '{"to":"boss"}');
  end if;
  return null;
end $$;
create trigger village_raid_notify after insert or update on public.village_raids for each row execute function public.on_village_raid();

-- a new follower, and the moment two players follow each other
create or replace function public.on_follow() returns trigger
language plpgsql security definer set search_path = '' as $$
declare who text := coalesce(public.player_name(new.follower), 'Someone');
begin
  if exists (select 1 from public.follows f where f.follower = new.followee and f.followee = new.follower) then
    insert into public.notifications (user_id, kind, icon, body, link, actor)
      values (new.followee, 'follow', '💬', who || ' followed you back. You can message each other now.', jsonb_build_object('to', 'dm', 'id', new.follower), new.follower);
  else
    insert into public.notifications (user_id, kind, icon, body, link, actor)
      values (new.followee, 'follow', '👋', who || ' followed you. Follow them back to message each other.', jsonb_build_object('to', 'profile', 'id', new.follower), new.follower);
  end if;
  return null;
end $$;
create trigger follows_notify after insert on public.follows for each row execute function public.on_follow();

-- the little numbers on the bell and the chat, checked every minute or so; also marks you online
create or replace function public.social_ping() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'Sign in first'; end if;
  update public.profiles set last_seen = now() where id = me;
  return jsonb_build_object(
    'notes', (select count(*) from public.notifications where user_id = me and read_at is null),
    'dms', (select count(*) from public.direct_messages where to_user = me and read_at is null),
    'world', (select coalesce(max(id), 0) from public.world_chat),
    'village', (select coalesce(max(l.id), 0) from public.village_log l where l.village_id = public.my_village() and l.kind = 'chat'));
end $$;

create or replace function public.notifications_list() returns jsonb
language sql security definer set search_path = '' stable as $$
  select jsonb_build_object('items', coalesce((select jsonb_agg(to_jsonb(n) order by n.id desc) from (
      select id, kind, icon, body, link, actor, created_at, read_at is null as unread from public.notifications
      where user_id = auth.uid() order by id desc limit 40) n), '[]'::jsonb));
$$;
create or replace function public.notifications_seen() returns jsonb
language sql security definer set search_path = '' as $$
  update public.notifications set read_at = now() where user_id = auth.uid() and read_at is null;
  select jsonb_build_object('ok', true);
$$;

-- a profile as another player sees it, with who follows whom
create or replace function public.social_profile(p_user uuid) returns jsonb
language sql security definer set search_path = '' stable as $$
  select to_jsonb(g) || jsonb_build_object(
    'i_follow', exists (select 1 from public.follows f where f.follower = auth.uid() and f.followee = p_user),
    'follows_me', exists (select 1 from public.follows f where f.follower = p_user and f.followee = auth.uid()),
    'followers', (select count(*) from public.follows f where f.followee = p_user),
    'following', (select count(*) from public.follows f where f.follower = p_user),
    'me', p_user = auth.uid())
  from public.get_profiles(array[p_user]) g;
$$;
create or replace function public.find_player(p_username text) returns jsonb
language sql security definer set search_path = '' stable as $$
  select public.social_profile(p.id) from public.profiles p where p.username = lower(btrim(p_username)) and auth.uid() is not null;
$$;
create or replace function public.follow_player(p_user uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if p_user = auth.uid() then raise exception 'You cannot follow yourself.'; end if;
  if not exists (select 1 from public.profiles where id = p_user) then raise exception 'That player could not be found.'; end if;
  insert into public.follows (follower, followee) values (auth.uid(), p_user) on conflict do nothing;
  return public.social_profile(p_user);
end $$;
create or replace function public.unfollow_player(p_user uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.follows where follower = auth.uid() and followee = p_user;
  return public.social_profile(p_user);
end $$;

-- world chat: the latest 50, or what came after a message you already have
create or replace function public.world_chat_recent(p_after bigint default 0) returns jsonb
language sql security definer set search_path = '' stable as $$
  select jsonb_build_object('messages', coalesce((select jsonb_agg(to_jsonb(m) order by m.id) from (
      select w.id, w.user_id, w.body, w.created_at, coalesce(nullif(p.public->>'name', ''), p.username) as name, p.public->>'face' as face
      from public.world_chat w left join public.profiles p on p.id = w.user_id
      where w.id > coalesce(p_after, 0) and auth.uid() is not null
      order by w.id desc limit 50) m), '[]'::jsonb));
$$;
create or replace function public.post_world_message(p_body text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare b text := btrim(p_body);
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if char_length(b) < 1 or char_length(b) > 280 then raise exception 'Messages are 1 to 280 characters.'; end if;
  if exists (select 1 from public.world_chat where user_id = auth.uid() and created_at > now() - interval '3 seconds') then raise exception 'Slow down a little.'; end if;
  insert into public.world_chat (user_id, body) values (auth.uid(), b);
  return jsonb_build_object('ok', true);
end $$;

-- direct messages: only between two players who follow each other
create or replace function public.dm_mutual(p_a uuid, p_b uuid) returns boolean
language sql security definer set search_path = '' stable as $$
  select exists (select 1 from public.follows where follower = p_a and followee = p_b)
     and exists (select 1 from public.follows where follower = p_b and followee = p_a);
$$;
create or replace function public.dm_threads() returns jsonb
language sql security definer set search_path = '' stable as $$
  with me as (select auth.uid() as id),
  mutual as (select f.followee as uid from public.follows f, me where f.follower = me.id and public.dm_mutual(me.id, f.followee)),
  convo as (select case when d.from_user = me.id then d.to_user else d.from_user end as uid, max(d.id) as last_id,
                   count(*) filter (where d.to_user = me.id and d.read_at is null) as unread
            from public.direct_messages d, me where me.id in (d.from_user, d.to_user) group by 1),
  ids as (select uid from mutual union select uid from convo)
  select jsonb_build_object('threads', coalesce(jsonb_agg(jsonb_build_object(
      'user_id', ids.uid, 'name', coalesce(nullif(p.public->>'name', ''), p.username), 'face', p.public->>'face',
      'mutual', public.dm_mutual((select id from me), ids.uid),
      'last_body', d.body, 'last_mine', d.from_user = (select id from me), 'last_at', d.created_at, 'unread', coalesce(c.unread, 0))
      order by c.last_id desc nulls last, p.username), '[]'::jsonb))
  from ids left join public.profiles p on p.id = ids.uid left join convo c on c.uid = ids.uid left join public.direct_messages d on d.id = c.last_id;
$$;
create or replace function public.dm_thread(p_with uuid, p_after bigint default 0) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); res jsonb;
begin
  if me is null then raise exception 'Sign in first'; end if;
  update public.direct_messages set read_at = now() where to_user = me and from_user = p_with and read_at is null;
  select jsonb_build_object(
    'with', p_with, 'mutual', public.dm_mutual(me, p_with),
    'name', (select coalesce(nullif(p.public->>'name', ''), p.username) from public.profiles p where p.id = p_with),
    'face', (select p.public->>'face' from public.profiles p where p.id = p_with),
    'messages', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'mine', m.from_user = me, 'body', m.body, 'created_at', m.created_at) order by m.id) from (
        select * from public.direct_messages d
        where ((d.from_user = me and d.to_user = p_with) or (d.from_user = p_with and d.to_user = me)) and d.id > coalesce(p_after, 0)
        order by d.id desc limit 60) m), '[]'::jsonb))
    into res;
  return res;
end $$;
create or replace function public.send_dm(p_to uuid, p_body text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare b text := btrim(p_body);
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if not public.dm_mutual(auth.uid(), p_to) then raise exception 'You can message each other once you both follow each other.'; end if;
  if char_length(b) < 1 or char_length(b) > 500 then raise exception 'Messages are 1 to 500 characters.'; end if;
  if exists (select 1 from public.direct_messages where from_user = auth.uid() and created_at > now() - interval '1 second') then raise exception 'Slow down a little.'; end if;
  insert into public.direct_messages (from_user, to_user, body) values (auth.uid(), p_to, b);
  return jsonb_build_object('ok', true);
end $$;

do $$
declare f text;
begin
  foreach f in array array['player_name(uuid)', 'notify_village(uuid, uuid, text, text, text, jsonb)', 'on_village_log()', 'on_village_raid()', 'on_follow()', 'dm_mutual(uuid, uuid)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
  foreach f in array array['social_ping()', 'notifications_list()', 'notifications_seen()', 'social_profile(uuid)', 'find_player(text)', 'follow_player(uuid)',
    'unfollow_player(uuid)', 'world_chat_recent(bigint)', 'post_world_message(text)', 'dm_threads()', 'dm_thread(uuid, bigint)', 'send_dm(uuid, text)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- the connector plays all of these too
create or replace function public.svc_act(p_user uuid, p_action text, p_args jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r jsonb;
begin
  if p_user is null then raise exception 'No player'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  p_args := coalesce(p_args, '{}'::jsonb);
  case p_action
    when 'create_village' then r := to_jsonb(public.create_village(p_args->>'p_name', p_args->>'p_crest', p_args->>'p_motto'));
    when 'join_village' then perform public.join_village((p_args->>'p_village')::uuid);
    when 'leave_village' then perform public.leave_village();
    when 'donate_to_village' then r := to_jsonb(public.donate_to_village((p_args->>'p_amount')::bigint));
    when 'upgrade_village_building' then r := to_jsonb(public.upgrade_village_building(p_args->>'p_building'));
    when 'post_village_message' then perform public.post_village_message(p_args->>'p_body');
    when 'promote_village_member' then perform public.promote_village_member((p_args->>'p_user')::uuid);
    when 'set_village_details' then perform public.set_village_details(p_args->>'p_motto', (p_args->>'p_open')::boolean);
    when 'list_villages' then select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into r from public.list_villages() x;
    when 'touch_presence' then r := to_jsonb(public.touch_presence());
    when 'get_profiles' then
      select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into r
      from public.get_profiles(array(select jsonb_array_elements_text(coalesce(p_args->'p_ids', '[]'::jsonb))::uuid)) x;
    when 'raid_status' then r := public.raid_status();
    when 'start_raid' then r := public.start_raid(p_args->>'p_boss');
    when 'raid_hit' then r := public.raid_hit(p_args->>'p_kind');
    when 'claim_raid_reward' then r := public.claim_raid_reward();
    when 'social_ping' then r := public.social_ping();
    when 'notifications_list' then r := public.notifications_list();
    when 'notifications_seen' then r := public.notifications_seen();
    when 'social_profile' then r := public.social_profile((p_args->>'p_user')::uuid);
    when 'find_player' then r := public.find_player(p_args->>'p_username');
    when 'follow_player' then r := public.follow_player((p_args->>'p_user')::uuid);
    when 'unfollow_player' then r := public.unfollow_player((p_args->>'p_user')::uuid);
    when 'world_chat_recent' then r := public.world_chat_recent(coalesce((p_args->>'p_after')::bigint, 0));
    when 'post_world_message' then r := public.post_world_message(p_args->>'p_body');
    when 'dm_threads' then r := public.dm_threads();
    when 'dm_thread' then r := public.dm_thread((p_args->>'p_with')::uuid, coalesce((p_args->>'p_after')::bigint, 0));
    when 'send_dm' then r := public.send_dm((p_args->>'p_to')::uuid, p_args->>'p_body');
    else raise exception 'Unknown action';
  end case;
  return coalesce(r, 'null'::jsonb);
end $$;
