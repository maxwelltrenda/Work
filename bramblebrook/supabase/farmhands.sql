-- Farmhands, borrowed from Jarldoms' bondsmen: hire other players to help you. A player's hire price is their
-- farm's value (everything bought for it that stays, worked out by the game's rules on the server's copy). The
-- person hired is paid a tenth of the price. Farmhands make your hits on village bosses stronger.
-- Hiring spends coins, so it is a move the sync function plays (MOVES.hire); svc_farm_save records it in the
-- same transaction as the farm. Dropping costs nothing and refunds nothing (drop_farmhand).

alter table public.farms add column if not exists value bigint not null default 0;
create index if not exists farms_value on public.farms (value desc);
alter table public.farm_grants alter column coins type bigint;

create table if not exists public.farmhands (
  owner uuid not null references auth.users(id) on delete cascade,
  hand uuid not null references auth.users(id) on delete cascade,
  price bigint not null check (price >= 0),
  hired_at timestamptz not null default now(),
  primary key (owner, hand),
  check (owner <> hand)
);
create index if not exists farmhands_hand on public.farmhands (hand);
alter table public.farmhands enable row level security;
revoke all on public.farmhands from anon, authenticated;

-- how much stronger a player's farmhands make them: each adds a tenth of the number of digits in its farm's value
create or replace function public.farmhand_bonus(p_user uuid) returns numeric
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(log(1 + greatest(0, coalesce(f.value, 0))::numeric)), 0) / 10
  from public.farmhands h left join public.farms f on f.user_id = h.hand
  where h.owner = p_user;
$$;
revoke all on function public.farmhand_bonus(uuid) from public, anon, authenticated;

create or replace function public.svc_farm_save(p_user uuid, p_v int, p_state jsonb, p_hash text, p_last bigint, p_seqs jsonb,
  p_build text, p_origin text, p_grants bigint[], p_gift bigint, p_summary jsonb, p_device text, p_value bigint, p_hires jsonb)
returns int language plpgsql security definer set search_path = '' as $$
declare nv int; n int; vill uuid; h record; pay bigint; who text;
begin
  if p_v = 0 then
    insert into public.farms (user_id, state, hash, last_t, v, seqs, build, origin, value)
      values (p_user, p_state, p_hash, p_last, 1, coalesce(p_seqs, '{}'::jsonb), p_build, p_origin, greatest(0, coalesce(p_value, 0)))
      on conflict (user_id) do nothing;
    if not found then return 0; end if;
    nv := 1;
  else
    update public.farms set state = p_state, hash = p_hash, last_t = p_last, v = v + 1, seqs = coalesce(p_seqs, '{}'::jsonb),
      build = p_build, origin = coalesce(p_origin, origin), value = greatest(0, coalesce(p_value, 0)), updated_at = now()
      where user_id = p_user and v = p_v returning v into nv;
    if nv is null then return 0; end if;
  end if;
  if coalesce(array_length(p_grants, 1), 0) > 0 then
    update public.farm_grants set applied_at = now() where user_id = p_user and id = any(p_grants) and applied_at is null;
    get diagnostics n = row_count;
    if n <> array_length(p_grants, 1) then raise exception 'farm_grant_taken'; end if;   -- undoes the farm write too
  end if;
  if coalesce(p_gift, 0) > 0 then
    select village_id into vill from public.village_members where user_id = p_user;
    if vill is null then raise exception 'farm_no_village'; end if;
    update public.villages set treasury = treasury + p_gift where id = vill;
    update public.village_members set contributed = contributed + p_gift where user_id = p_user;
    insert into public.village_log (village_id, user_id, kind, body, amount) values (vill, p_user, 'donate', 'gave coins', p_gift);
  end if;
  if jsonb_typeof(p_hires) = 'array' and jsonb_array_length(p_hires) > 0 then
    select coalesce(nullif(p_state->>'name', ''), (select username from public.profiles where id = p_user), 'A neighbour') into who;
    for h in select * from jsonb_to_recordset(p_hires) as x(u uuid, c bigint) loop
      if h.u is null or h.u = p_user or h.c is null or h.c < 0 then raise exception 'farm_hire_bad'; end if;
      if exists (select 1 from public.blocks b where (b.blocker = p_user and b.blocked = h.u) or (b.blocker = h.u and b.blocked = p_user)) then raise exception 'farm_hire_bad'; end if;
      insert into public.farmhands (owner, hand, price) values (p_user, h.u, h.c);   -- already hired: the whole save is retried
      pay := floor(h.c * 0.1);
      if pay > 0 then insert into public.farm_grants (user_id, kind, coins, xp, ref) values (h.u, 'hired', pay, 0, p_user::text); end if;
      insert into public.notifications (user_id, kind, icon, body, link, actor)
        values (h.u, 'hired', '🧑‍🌾', left(who, 40) || ' hired you as a farmhand' || case when pay > 0 then ': +' || to_char(pay, 'FM999,999,999,999,999') || ' coins' else '' end,
                jsonb_build_object('to', 'hands'), p_user);
    end loop;
    if (select count(*) from public.farmhands where owner = p_user) > 20 then raise exception 'farm_hire_full'; end if;
  end if;
  insert into public.saves (user_id, data, summary, device) values (p_user, p_state, coalesce(p_summary, '{}'::jsonb), left(coalesce(p_device, ''), 60))
    on conflict (user_id) do update set data = excluded.data, summary = excluded.summary, device = excluded.device;
  return nv;
end $$;
revoke all on function public.svc_farm_save(uuid, int, jsonb, text, bigint, jsonb, text, text, bigint[], bigint, jsonb, text, bigint, jsonb) from public, anon, authenticated;

-- players to hire: most valuable first, never yourself or anyone either of you has blocked
create or replace function public.farmhand_market(p_q text default '') returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(x) order by x.value desc), '[]'::jsonb) from (
    select f.user_id as id, p.username, coalesce(nullif(f.state->>'name', ''), p.username) as name, f.value, greatest(100, f.value) as price,
      exists (select 1 from public.farmhands h where h.owner = auth.uid() and h.hand = f.user_id) as hired,
      (select count(*) from public.farmhands h where h.hand = f.user_id) as hired_by,
      (p.show_online and p.last_seen > now() - interval '5 minutes') as online
    from public.farms f join public.profiles p on p.id = f.user_id
    where auth.uid() is not null and f.user_id <> auth.uid() and coalesce(f.state->>'name', '') <> ''
      and not exists (select 1 from public.blocks b where (b.blocker = auth.uid() and b.blocked = f.user_id) or (b.blocker = f.user_id and b.blocked = auth.uid()))
      and (coalesce(btrim(p_q), '') = '' or p.username ilike '%' || replace(replace(btrim(p_q), '%', ''), '_', '') || '%'
           or (f.state->>'name') ilike '%' || replace(replace(btrim(p_q), '%', ''), '_', '') || '%')
    order by f.value desc limit 60) x;
$$;

-- your farmhands, who has hired you, what being hired has earned you, and how much stronger your hands make you
create or replace function public.my_farmhands() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'hands', coalesce((select jsonb_agg(jsonb_build_object('id', h.hand, 'username', p.username, 'name', coalesce(nullif(f.state->>'name', ''), p.username),
        'value', coalesce(f.value, 0), 'price', h.price, 'hired_at', h.hired_at) order by coalesce(f.value, 0) desc)
      from public.farmhands h join public.profiles p on p.id = h.hand left join public.farms f on f.user_id = h.hand where h.owner = auth.uid()), '[]'::jsonb),
    'hired_by', coalesce((select jsonb_agg(jsonb_build_object('id', h.owner, 'username', p.username, 'name', coalesce(nullif(f.state->>'name', ''), p.username),
        'price', h.price, 'hired_at', h.hired_at) order by h.hired_at desc)
      from public.farmhands h join public.profiles p on p.id = h.owner left join public.farms f on f.user_id = h.owner where h.hand = auth.uid()), '[]'::jsonb),
    'earned', coalesce((select sum(coins) from public.farm_grants where user_id = auth.uid() and kind = 'hired'), 0),
    'bonus', public.farmhand_bonus(auth.uid()),
    'value', coalesce((select value from public.farms where user_id = auth.uid()), 0));
$$;

create or replace function public.drop_farmhand(p_hand uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  delete from public.farmhands where owner = auth.uid() and hand = p_hand;
  return public.my_farmhands();
end $$;

revoke all on function public.farmhand_market(text), public.my_farmhands(), public.drop_farmhand(uuid) from public, anon;
grant execute on function public.farmhand_market(text), public.my_farmhands(), public.drop_farmhand(uuid) to authenticated;

-- village bosses: your farmhands make every hit stronger
create or replace function public.raid_hit(p_kind text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v uuid; r public.village_raids; d public.raid_boss_defs; ph jsonb; need int; cur int; e numeric;
        f record; matched boolean; dmg int; done_phase boolean := false; won boolean := false; bonus numeric;
begin
  v := public.my_village();
  if v is null then raise exception 'Join a village first.'; end if;
  if p_kind not in ('might', 'magic') then raise exception 'Unknown attack.'; end if;
  perform public.raid_settle(v);
  select * into r from public.village_raids where village_id = v and status = 'active' for update;
  if not found then raise exception 'There is no boss to fight right now.'; end if;
  select * into d from public.raid_boss_defs where id = r.boss;
  ph := d.phases -> r.phase;
  need := (ph->>p_kind)::int * r.scale;
  cur := case when p_kind = 'might' then r.might else r.magic end;
  if cur >= need then raise exception 'That bar is full for this phase. Use the other attack.'; end if;
  insert into public.raid_energy (user_id) values (auth.uid()) on conflict (user_id) do nothing;
  perform 1 from public.raid_energy where user_id = auth.uid() for update;
  e := public.raid_courage(auth.uid());
  if e < 1 then raise exception 'Out of courage. It refills over the hour.'; end if;
  update public.raid_energy set energy = e - 1, at = now() where user_id = auth.uid();
  select * into f from public.raid_fighter(auth.uid());
  bonus := public.farmhand_bonus(auth.uid());
  matched := (p_kind = 'might' and f.cls in ('fighter', 'rogue', 'ranger')) or (p_kind = 'magic' and f.cls in ('wizard', 'cleric', 'bard'));
  dmg := round((10 + 2 * f.lvl) * (case when matched then 1.6 else 1 end) * (0.85 + random() * 0.3) * (1 + bonus));
  if p_kind = 'might' then r.might := least(need, r.might + dmg); else r.magic := least(need, r.magic + dmg); end if;
  insert into public.raid_hits (raid_id, user_id, actions, might, magic)
    values (r.id, auth.uid(), 1, case when p_kind = 'might' then dmg else 0 end, case when p_kind = 'magic' then dmg else 0 end)
    on conflict (raid_id, user_id) do update set actions = public.raid_hits.actions + 1,
      might = public.raid_hits.might + excluded.might, magic = public.raid_hits.magic + excluded.magic;
  if r.might >= (ph->>'might')::int * r.scale and r.magic >= (ph->>'magic')::int * r.scale then
    done_phase := true;
    if r.phase + 1 >= jsonb_array_length(d.phases) then
      won := true;
      update public.village_raids set might = r.might, magic = r.magic, status = 'won', done_at = now() where id = r.id;
    else
      update public.village_raids set phase = r.phase + 1, might = 0, magic = 0 where id = r.id;
    end if;
  else
    update public.village_raids set might = r.might, magic = r.magic where id = r.id;
  end if;
  return public.raid_status() || jsonb_build_object('hit', jsonb_build_object('dmg', dmg, 'matched', matched, 'kind', p_kind, 'phase_done', done_phase, 'won', won, 'bonus', round(bonus * 100)));
end $$;

-- the Claude connector can look up and drop farmhands too (hiring is a farm move, through save_farm)
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
    when 'send_feedback' then r := public.send_feedback(p_args->>'p_kind', p_args->>'p_body', p_args->'p_context');
    when 'feedback_inbox' then r := public.feedback_inbox();
    when 'feedback_mark' then r := public.feedback_mark((p_args->>'p_id')::bigint, p_args->>'p_status', p_args->>'p_reply');
    when 'block_player' then r := public.block_player((p_args->>'p_user')::uuid);
    when 'unblock_player' then r := public.unblock_player((p_args->>'p_user')::uuid);
    when 'blocked_list' then r := public.blocked_list();
    when 'report_content' then r := public.report_content(p_args->>'p_kind', (p_args->>'p_ref')::bigint, (p_args->>'p_user')::uuid, p_args->>'p_reason');
    when 'mod_action' then r := public.mod_action((p_args->>'p_report')::bigint, p_args->>'p_action');
    when 'delete_my_account' then r := public.delete_my_account(p_args->>'p_confirm');
    when 'farmhand_market' then r := public.farmhand_market(coalesce(p_args->>'p_q', ''));
    when 'my_farmhands' then r := public.my_farmhands();
    when 'drop_farmhand' then r := public.drop_farmhand((p_args->>'p_hand')::uuid);
    else raise exception 'Unknown action';
  end case;
  return coalesce(r, 'null'::jsonb);
end $$;
revoke all on function public.svc_act(uuid, text, jsonb) from public, anon, authenticated;
