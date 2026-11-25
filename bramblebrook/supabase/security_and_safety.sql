-- Applied to the Bramblebrook project on 2026-11-25 as migration "security_and_safety".
-- 1. Tighter table rights: the browser only writes its own save and three profile columns; everything else
--    goes through the game's functions. 2. Size limits on what players can store. 3. A word filter for chat,
--    names and mottos. 4. Report, block and moderation (App Store guideline 1.2 for apps with chat).
-- 5. Delete my account (App Store 5.1.1(v)). 6. Sign-up rate limits. 7. Village gifts come out of the coins
--    the server actually has for you.

-- ---------- tables first, so the rights below cover them too ----------
alter table public.profiles add column if not exists muted_until timestamptz;   -- set by the game's owner only

create table if not exists public.blocks (
  blocker uuid not null references auth.users (id) on delete cascade,
  blocked uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker, blocked),
  check (blocker <> blocked)
);
alter table public.blocks enable row level security;

create table if not exists public.reports (
  id bigint generated always as identity primary key,
  reporter uuid references auth.users (id) on delete set null,
  target uuid references auth.users (id) on delete set null,
  kind text not null check (kind in ('world', 'village', 'dm', 'profile')),
  ref bigint,                                   -- the message, when it is one
  snapshot text,                                -- what it said when reported, kept even if removed
  reason text check (char_length(reason) <= 500),
  status text not null default 'new' check (status in ('new', 'removed', 'muted', 'banned', 'dismissed')),
  created_at timestamptz not null default now(),
  handled_at timestamptz
);
create index if not exists reports_recent on public.reports (id desc);
alter table public.reports enable row level security;

create table if not exists public.banned_words (w text primary key, anywhere boolean not null default false);
alter table public.banned_words enable row level security;

create table if not exists public.signup_attempts (ip_hash text not null, at timestamptz not null default now());
create index if not exists signup_attempts_at on public.signup_attempts (at);
alter table public.signup_attempts enable row level security;

-- ---------- 1. rights ----------
revoke insert, update, delete, truncate, references, trigger on all tables in schema public from anon, authenticated;
revoke select on all tables in schema public from anon;
grant insert, update on public.saves to authenticated;
grant update (farm_name, public, show_online) on public.profiles to authenticated;

-- ---------- 2. size limits ----------
alter table public.profiles add constraint profiles_public_size check (public is null or (octet_length(public::text) <= 4000
  and char_length(coalesce(public->>'name', '')) <= 30 and char_length(coalesce(public->>'title', '')) <= 60));
alter table public.villages add constraint villages_text_size check (char_length(crest) <= 8 and char_length(name) between 3 and 24 and char_length(coalesce(motto, '')) <= 80);
alter table public.saves add constraint saves_size check (octet_length(data::text) <= 1000000);

-- ---------- 3. word filter ----------
-- anywhere = matched inside longer words too (stems no innocent word contains); otherwise whole words only,
-- with common endings. Letters also match look-alikes (0 for o, 3 for e, $ for s...) and repeats (fuuuck).
insert into public.banned_words (w, anywhere) values
  ('fuck', true), ('shit', true), ('cunt', true), ('bitch', true), ('whore', true), ('slut', true), ('wank', true),
  ('twat', true), ('asshole', true), ('bastard', true), ('dildo', true), ('jizz', true), ('porn', true), ('hitler', true),
  ('nigger', true), ('nigga', true), ('faggot', true), ('retard', true), ('wetback', true), ('tranny', true), ('kike', true),
  ('ass', false), ('dick', false), ('cock', false), ('pussy', false), ('penis', false), ('vagina', false), ('sex', false),
  ('sexy', false), ('boob', false), ('tits', false), ('cum', false), ('rape', false), ('pedo', false), ('nazi', false),
  ('fag', false), ('dyke', false), ('spic', false), ('chink', false), ('gook', false), ('coon', false), ('negro', false),
  ('beaner', false), ('kys', false), ('kill yourself', false)
on conflict (w) do nothing;

create or replace function public.bb_leet(p_word text) returns text
language sql immutable set search_path = '' as $$
  select string_agg(case c when 'a' then '[a@4]' when 'e' then '[e3]' when 'i' then '[i1!|]' when 'o' then '[o0]'
    when 's' then '[s$5z]' when 't' then '[t7+]' when 'g' then '[g9]' when 'b' then '[b8]' when 'l' then '[l1|]'
    when ' ' then '[^[:alnum:]]+' else c end || case when c = ' ' then '' else '+' end, '' order by i)
  from regexp_split_to_table(lower(p_word), '') with ordinality as x(c, i);
$$;
-- the whole pattern; group 1 is the character before the word, so it can be kept
create or replace function public.bb_bad_pattern() returns text
language sql stable security definer set search_path = '' as $$
  select '(^|[^[:alnum:]@$!|+])((?:[[:alnum:]@$!|+]*(?:' || (select string_agg(public.bb_leet(w), '|') from public.banned_words where anywhere)
    || ')[[:alnum:]@$!|+]*)|(?:(?:' || (select string_agg(public.bb_leet(w), '|') from public.banned_words where not anywhere)
    || ')(?:s|es|ing|ed|er|ers)?))(?=[^[:alnum:]@$!|+]|$)';
$$;
create or replace function public.bb_has_bad(p text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(p, '') ~* public.bb_bad_pattern();
$$;
create or replace function public.bb_clean(p text) returns text
language sql stable security definer set search_path = '' as $$
  select case when p is null then null else regexp_replace(p, public.bb_bad_pattern(), '\1***', 'gi') end;
$$;
revoke all on function public.bb_leet(text), public.bb_bad_pattern(), public.bb_has_bad(text), public.bb_clean(text) from public, anon, authenticated;

-- names, titles and farm names are cleaned on the way in
create or replace function public.bb_clean_profile() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.public is not null then
    if new.public ? 'name' then new.public := jsonb_set(new.public, '{name}', to_jsonb(public.bb_clean(new.public->>'name'))); end if;
    if new.public ? 'title' then new.public := jsonb_set(new.public, '{title}', to_jsonb(public.bb_clean(new.public->>'title'))); end if;
  end if;
  new.farm_name := public.bb_clean(new.farm_name);
  return new;
end $$;
create trigger profiles_clean before insert or update of public, farm_name on public.profiles for each row execute function public.bb_clean_profile();

-- ---------- 4. muted players, blocks and reports ----------
create or replace function public.bb_can_post() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if exists (select 1 from public.profiles where id = auth.uid() and muted_until > now()) then
    raise exception 'You can''t post right now: your account is muted for breaking the rules.';
  end if;
end $$;
create or replace function public.blocked_between(p_a uuid, p_b uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.blocks where (blocker = p_a and blocked = p_b) or (blocker = p_b and blocked = p_a));
$$;
revoke all on function public.bb_can_post(), public.blocked_between(uuid, uuid) from public, anon, authenticated;

create or replace function public.post_world_message(p_body text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare b text := btrim(p_body);
begin
  perform public.bb_can_post();
  if char_length(b) < 1 or char_length(b) > 280 then raise exception 'Messages are 1 to 280 characters.'; end if;
  if exists (select 1 from public.world_chat where user_id = auth.uid() and created_at > now() - interval '3 seconds') then raise exception 'Slow down a little.'; end if;
  if (select count(*) from public.world_chat where user_id = auth.uid() and created_at > now() - interval '10 minutes') >= 40 then raise exception 'Slow down a little: try again in a few minutes.'; end if;
  insert into public.world_chat (user_id, body) values (auth.uid(), public.bb_clean(b));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.post_village_message(p_body text) returns void
language plpgsql security definer set search_path = '' as $$
declare v uuid; b text := btrim(p_body);
begin
  perform public.bb_can_post();
  v := public.my_village();
  if v is null then raise exception 'Join a village first.'; end if;
  if char_length(b) < 1 or char_length(b) > 280 then raise exception 'Messages are 1 to 280 characters.'; end if;
  if exists (select 1 from public.village_log where village_id = v and user_id = auth.uid() and kind = 'chat' and created_at > now() - interval '3 seconds') then raise exception 'Slow down a little.'; end if;
  insert into public.village_log (village_id, user_id, kind, body) values (v, auth.uid(), 'chat', public.bb_clean(b));
end $$;

create or replace function public.send_dm(p_to uuid, p_body text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare b text := btrim(p_body);
begin
  perform public.bb_can_post();
  if public.blocked_between(auth.uid(), p_to) then raise exception 'You can''t message this player.'; end if;
  if not public.dm_mutual(auth.uid(), p_to) then raise exception 'You can message each other once you both follow each other.'; end if;
  if char_length(b) < 1 or char_length(b) > 500 then raise exception 'Messages are 1 to 500 characters.'; end if;
  if exists (select 1 from public.direct_messages where from_user = auth.uid() and created_at > now() - interval '1 second') then raise exception 'Slow down a little.'; end if;
  insert into public.direct_messages (from_user, to_user, body) values (auth.uid(), p_to, public.bb_clean(b));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.create_village(p_name text, p_crest text, p_motto text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v uuid; n text := btrim(p_name);
begin
  perform public.bb_can_post();
  if exists (select 1 from public.village_members where user_id = auth.uid()) then raise exception 'You already belong to a village. Leave it first.'; end if;
  if char_length(n) < 3 or char_length(n) > 24 then raise exception 'Village names are 3 to 24 characters.'; end if;
  if public.bb_has_bad(n) then raise exception 'Please pick a different name.'; end if;
  if exists (select 1 from public.villages where lower(name) = lower(n)) then raise exception 'That village name is taken.'; end if;
  insert into public.villages (name, crest, motto, created_by)
    values (n, left(coalesce(nullif(btrim(p_crest), ''), '🌾'), 8), public.bb_clean(left(coalesce(btrim(p_motto), ''), 80)), auth.uid()) returning id into v;
  insert into public.village_members (user_id, village_id, role) values (auth.uid(), v, 'elder');
  insert into public.village_buildings (village_id, building, level) select v, id, case when id = 'hall' then 1 else 0 end from public.village_building_defs;
  insert into public.village_log (village_id, user_id, kind, body) values (v, auth.uid(), 'found', 'founded the village');
  return v;
end $$;

create or replace function public.set_village_details(p_motto text, p_open boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare v uuid;
begin
  v := public.my_village();
  if v is null or (select role from public.village_members where user_id = auth.uid()) <> 'elder' then raise exception 'Only elders can do that.'; end if;
  update public.villages set motto = public.bb_clean(left(coalesce(btrim(p_motto), ''), 80)), open = coalesce(p_open, open) where id = v;
end $$;

-- world chat and DMs leave out anyone either side has blocked
create or replace function public.world_chat_recent(p_after bigint default 0) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('messages', coalesce((select jsonb_agg(to_jsonb(m) order by m.id) from (
    select w.id, w.user_id, w.body, w.created_at, coalesce(nullif(p.public->>'name', ''), p.username) as name, p.public->>'face' as face
    from public.world_chat w left join public.profiles p on p.id = w.user_id
    where w.id > coalesce(p_after, 0) and auth.uid() is not null and not public.blocked_between(auth.uid(), w.user_id)
    order by w.id desc limit 50) m), '[]'::jsonb));
$$;

create or replace function public.dm_thread(p_with uuid, p_after bigint default 0) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); res jsonb; blk boolean;
begin
  if me is null then raise exception 'Sign in first'; end if;
  blk := public.blocked_between(me, p_with);
  update public.direct_messages set read_at = now() where to_user = me and from_user = p_with and read_at is null;
  select jsonb_build_object(
    'with', p_with, 'mutual', public.dm_mutual(me, p_with) and not blk, 'blocked', blk,
    'name', (select coalesce(nullif(p.public->>'name', ''), p.username) from public.profiles p where p.id = p_with),
    'face', (select p.public->>'face' from public.profiles p where p.id = p_with),
    'messages', case when blk then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'mine', m.from_user = me, 'body', m.body, 'created_at', m.created_at) order by m.id)
      from (select * from public.direct_messages d where ((d.from_user = me and d.to_user = p_with) or (d.from_user = p_with and d.to_user = me)) and d.id > coalesce(p_after, 0) order by d.id desc limit 60) m), '[]'::jsonb) end) into res;
  return res;
end $$;

create or replace function public.dm_threads() returns jsonb
language sql stable security definer set search_path = '' as $$
  with me as (select auth.uid() as id),
  mutual as (select f.followee as uid from public.follows f, me where f.follower = me.id and public.dm_mutual(me.id, f.followee)),
  convo as (select case when d.from_user = me.id then d.to_user else d.from_user end as uid, max(d.id) as last_id,
              count(*) filter (where d.to_user = me.id and d.read_at is null) as unread
            from public.direct_messages d, me where me.id in (d.from_user, d.to_user) group by 1),
  ids as (select uid from mutual union select uid from convo)
  select jsonb_build_object('threads', coalesce(jsonb_agg(jsonb_build_object(
    'user_id', ids.uid, 'name', coalesce(nullif(p.public->>'name', ''), p.username), 'face', p.public->>'face',
    'mutual', public.dm_mutual((select id from me), ids.uid), 'last_body', d.body, 'last_mine', d.from_user = (select id from me),
    'last_at', d.created_at, 'unread', coalesce(c.unread, 0)) order by c.last_id desc nulls last, p.username), '[]'::jsonb))
  from ids left join public.profiles p on p.id = ids.uid left join convo c on c.uid = ids.uid left join public.direct_messages d on d.id = c.last_id
  where not public.blocked_between((select id from me), ids.uid);
$$;

create or replace function public.social_ping() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'Sign in first'; end if;
  update public.profiles set last_seen = now() where id = me;
  return jsonb_build_object(
    'notes', (select count(*) from public.notifications where user_id = me and read_at is null),
    'dms', (select count(*) from public.direct_messages d where d.to_user = me and d.read_at is null and not public.blocked_between(me, d.from_user)),
    'world', (select coalesce(max(id), 0) from public.world_chat),
    'village', (select coalesce(max(l.id), 0) from public.village_log l where l.village_id = public.my_village() and l.kind = 'chat'),
    'admin', public.is_game_admin(),
    'feedback_new', case when public.is_game_admin() then (select count(*) from public.feedback where status = 'new') + (select count(*) from public.reports where status = 'new') else 0 end,
    'blocked', (select coalesce(jsonb_agg(blocked), '[]'::jsonb) from public.blocks where blocker = me));
end $$;

create or replace function public.block_player(p_user uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if p_user is null or p_user = auth.uid() then raise exception 'You cannot block yourself.'; end if;
  insert into public.blocks (blocker, blocked) values (auth.uid(), p_user) on conflict do nothing;
  delete from public.follows where (follower = auth.uid() and followee = p_user) or (follower = p_user and followee = auth.uid());
  return jsonb_build_object('ok', true);
end $$;
create or replace function public.unblock_player(p_user uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  delete from public.blocks where blocker = auth.uid() and blocked = p_user;
  return jsonb_build_object('ok', true);
end $$;
create or replace function public.blocked_list() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('blocked', coalesce((select jsonb_agg(jsonb_build_object('user_id', b.blocked, 'name', coalesce(nullif(p.public->>'name', ''), p.username), 'username', p.username) order by b.created_at desc)
    from public.blocks b left join public.profiles p on p.id = b.blocked where b.blocker = auth.uid()), '[]'::jsonb));
$$;

-- a report goes straight to the owner's bell, with what was said
create or replace function public.report_content(p_kind text, p_ref bigint, p_user uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); snap text; tgt uuid := p_user; rid bigint; who text;
begin
  if me is null then raise exception 'Sign in first'; end if;
  if p_kind not in ('world', 'village', 'dm', 'profile') then raise exception 'Unknown report.'; end if;
  if (select count(*) from public.reports where reporter = me and created_at > now() - interval '1 hour') >= 20 then raise exception 'Thanks: we have your reports. Please wait a little before sending more.'; end if;
  if p_kind = 'world' then select body, user_id into snap, tgt from public.world_chat where id = p_ref;
  elsif p_kind = 'village' then select body, user_id into snap, tgt from public.village_log where id = p_ref and kind = 'chat' and village_id = public.my_village();
  elsif p_kind = 'dm' then select body, from_user into snap, tgt from public.direct_messages where id = p_ref and to_user = me;
  else select coalesce(public->>'name', username) into snap from public.profiles where id = p_user; end if;
  if tgt is null then raise exception 'That could not be found. It may already be gone.'; end if;
  if tgt = me then raise exception 'That is yours.'; end if;
  insert into public.reports (reporter, target, kind, ref, snapshot, reason) values (me, tgt, p_kind, p_ref, left(snap, 600), left(nullif(btrim(coalesce(p_reason, '')), ''), 500)) returning id into rid;
  who := coalesce(public.player_name(tgt), 'A player');
  insert into public.notifications (user_id, kind, icon, body, link, actor)
    select a.user_id, 'report', '🚩', 'Report about ' || who || ': "' || left(coalesce(snap, ''), 100) || '"', '{"to":"feedback"}'::jsonb, me
    from public.game_admins a;
  return jsonb_build_object('ok', true, 'id', rid);
end $$;

-- the owner's inbox now carries reports too
create or replace function public.feedback_inbox() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_game_admin() then raise exception 'Only the game''s owner can see the feedback inbox.'; end if;
  return jsonb_build_object(
    'items', coalesce((select jsonb_agg(to_jsonb(x) order by x.id desc) from (
      select f.id, f.user_id, f.kind, f.body, f.context, f.status, f.reply, f.created_at, f.handled_at,
             coalesce(nullif(p.public->>'name', ''), p.username, nullif(f.context->>'farmer', '')) as name, p.username
      from public.feedback f left join public.profiles p on p.id = f.user_id order by f.id desc limit 60) x), '[]'::jsonb),
    'reports', coalesce((select jsonb_agg(to_jsonb(x) order by x.id desc) from (
      select r.id, r.kind, r.ref, r.snapshot, r.reason, r.status, r.created_at, r.target,
             coalesce(nullif(t.public->>'name', ''), t.username) as target_name, t.username as target_username,
             (t.muted_until > now()) as target_muted,
             coalesce(nullif(q.public->>'name', ''), q.username) as reporter_name,
             (select count(*) from public.reports r2 where r2.target = r.target) as target_reports
      from public.reports r left join public.profiles t on t.id = r.target left join public.profiles q on q.id = r.reporter
      order by r.id desc limit 60) x), '[]'::jsonb));
end $$;

-- remove the message, mute for a week, ban, or dismiss
create or replace function public.mod_action(p_report bigint, p_action text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.reports;
begin
  if not public.is_game_admin() then raise exception 'Only the game''s owner can do that.'; end if;
  if p_action not in ('remove', 'mute', 'ban', 'unmute', 'dismiss') then raise exception 'Unknown action.'; end if;
  select * into r from public.reports where id = p_report for update;
  if not found then raise exception 'That report could not be found.'; end if;
  if p_action in ('remove', 'mute', 'ban') and r.ref is not null then
    if r.kind = 'world' then delete from public.world_chat where id = r.ref;
    elsif r.kind = 'village' then delete from public.village_log where id = r.ref and kind = 'chat';
    elsif r.kind = 'dm' then delete from public.direct_messages where id = r.ref; end if;
  end if;
  if p_action = 'mute' then update public.profiles set muted_until = now() + interval '7 days' where id = r.target; end if;
  if p_action = 'ban' then update public.profiles set muted_until = 'infinity' where id = r.target; end if;
  if p_action = 'unmute' then update public.profiles set muted_until = null where id = r.target; end if;
  update public.reports set status = case p_action when 'remove' then 'removed' when 'mute' then 'muted' when 'ban' then 'banned' when 'unmute' then status else 'dismissed' end,
    handled_at = now() where id = p_report;
  if p_action in ('remove', 'mute', 'ban') and r.reporter is not null then
    insert into public.notifications (user_id, kind, icon, body, link, actor)
      values (r.reporter, 'report', '🛡️', 'Thanks for your report. We looked at it and took action.', '{}'::jsonb, auth.uid());
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- ---------- 5. delete my account ----------
-- Everything the account owns goes with it (save, profile, messages, follows, village place, link for Claude).
create or replace function public.delete_my_account(p_confirm text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); un text;
begin
  if me is null then raise exception 'Sign in first'; end if;
  select username into un from public.profiles where id = me;
  if un is null or lower(btrim(coalesce(p_confirm, ''))) <> un then raise exception 'Type your username to confirm.'; end if;
  perform public.leave_village();
  delete from public.notifications where actor = me and kind not in ('report', 'feedback');   -- reports still reach the owner
  delete from auth.users where id = me;
  return jsonb_build_object('ok', true);
end $$;

-- ---------- 6. sign-up limits (called by the signup function with the service key) ----------
create or replace function public.signup_allowed(p_ip_hash text) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.signup_attempts where at < now() - interval '1 day';
  if (select count(*) from public.signup_attempts where ip_hash = p_ip_hash and at > now() - interval '1 hour') >= 5 then return false; end if;
  if (select count(*) from public.signup_attempts where at > now() - interval '1 hour') >= 300 then return false; end if;
  insert into public.signup_attempts (ip_hash) values (p_ip_hash);
  return true;
end $$;
create or replace function public.username_ok(p_username text) returns boolean
language sql stable security definer set search_path = '' as $$
  select not public.bb_has_bad(regexp_replace(coalesce(p_username, ''), '_', ' ', 'g'))
     and not (coalesce(p_username, '') ~* '[[:alnum:]]*(fuck|shit|cunt|bitch|whore|slut|nigg|fagg|retard|porn|hitler|rape|nazi|admin|moderator|bramblebrook)');
$$;

-- ---------- 7. village gifts come out of the coins the server has for you ----------
-- The saved farm is the record; the gift is taken from it without moving its timestamp, so the device's
-- next save (which already took the coins off) doesn't look like a clash with another device.
create or replace function public.touch_save() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and current_setting('bb.keep_stamp', true) = 'on' then new.updated_at := old.updated_at;
  else new.updated_at := now(); end if;
  return new;
end $$;
create or replace function public.donate_to_village(p_amount bigint) returns bigint
language plpgsql security definer set search_path = '' as $$
declare v uuid; t bigint; have numeric;
begin
  v := public.my_village();
  if v is null then raise exception 'Join a village first.'; end if;
  if p_amount is null or p_amount < 1 or p_amount > 100000000 then raise exception 'Give between 1 and 100,000,000 coins.'; end if;
  select case when coalesce(data->>'coins', '') ~ '^[0-9]+(\.[0-9]+)?$' then (data->>'coins')::numeric else 0 end into have
    from public.saves where user_id = auth.uid() for update;
  if coalesce(have, 0) < p_amount then raise exception 'Your coins are still saving. Try again in a moment.'; end if;
  perform set_config('bb.keep_stamp', 'on', true);
  update public.saves set data = jsonb_set(data, '{coins}', to_jsonb(have - p_amount)) where user_id = auth.uid();
  perform set_config('bb.keep_stamp', 'off', true);
  update public.villages set treasury = treasury + p_amount where id = v returning treasury into t;
  update public.village_members set contributed = contributed + p_amount where user_id = auth.uid();
  insert into public.village_log (village_id, user_id, kind, body, amount) values (v, auth.uid(), 'donate', 'gave coins', p_amount);
  return t;
end $$;

-- ---------- who may call what ----------
revoke all on function public.block_player(uuid), public.unblock_player(uuid), public.blocked_list(), public.report_content(text, bigint, uuid, text),
  public.mod_action(bigint, text), public.delete_my_account(text) from public, anon;
grant execute on function public.block_player(uuid), public.unblock_player(uuid), public.blocked_list(), public.report_content(text, bigint, uuid, text),
  public.mod_action(bigint, text), public.delete_my_account(text) to authenticated;
revoke all on function public.signup_allowed(text), public.username_ok(text), public.bb_clean_profile() from public, anon, authenticated;

-- ---------- the Claude connector's way in gains the new actions ----------
create or replace function public.svc_act(p_user uuid, p_action text, p_args jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
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
    when 'send_feedback' then r := public.send_feedback(p_args->>'p_kind', p_args->>'p_body', p_args->'p_context');
    when 'feedback_inbox' then r := public.feedback_inbox();
    when 'feedback_mark' then r := public.feedback_mark((p_args->>'p_id')::bigint, p_args->>'p_status', p_args->>'p_reply');
    when 'block_player' then r := public.block_player((p_args->>'p_user')::uuid);
    when 'unblock_player' then r := public.unblock_player((p_args->>'p_user')::uuid);
    when 'blocked_list' then r := public.blocked_list();
    when 'report_content' then r := public.report_content(p_args->>'p_kind', (p_args->>'p_ref')::bigint, (p_args->>'p_user')::uuid, p_args->>'p_reason');
    when 'mod_action' then r := public.mod_action((p_args->>'p_report')::bigint, p_args->>'p_action');
    when 'delete_my_account' then r := public.delete_my_account(p_args->>'p_confirm');
    else raise exception 'Unknown action';
  end case;
  return coalesce(r, 'null'::jsonb);
end $$;
revoke all on function public.svc_act(uuid, text, jsonb) from public, anon, authenticated;
