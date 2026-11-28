-- Village wars, brought over from Jarldoms' Hird War Mode (migration 019 there) and its open PvP.
-- An elder declares war on another village (or on a raider camp the game sizes to match); for 48 hours every
-- neighbour raids the other side's players and scouts them first. A raid's chance comes from attack against
-- defence, never below 15% or above 85% (Jarldoms' rule). A won raid scores points (the boss damage rule, 25-500)
-- and pays coins at once; a failed one scores half that for the defenders, so gear defends you while you sleep.
-- Scores are divided by each side's head count (at least 3), so a big village doesn't win by size alone.
-- At the end: War Spoils for everyone who fought, a bonus for the winners, Blood Apples, a trophy, 5% of the
-- loser's treasury (capped) and a 3-day rest for the loser. Blood Apples refill raids, scouts or boss courage.
-- Nothing here is touched directly by players: every change goes through these functions (security definer),
-- the same functions svc_act plays for the Claude connector. No pg_cron here, so a war settles the first time
-- anyone on either side looks at it after it ends.

create table if not exists public.village_wars (
  id bigint generated always as identity primary key,
  attacker uuid not null references public.villages (id) on delete cascade,
  defender uuid references public.villages (id) on delete cascade,     -- null: a raider camp
  camp jsonb,                                                             -- {name, crest, rate, fighters: [{id, name, cls, lvl}]}
  attacker_size int not null,                                             -- heads when declared, at least 3
  defender_size int not null,
  attacker_score bigint not null default 0,
  defender_score bigint not null default 0,
  declared_by uuid references auth.users (id) on delete set null,
  started_at timestamptz not null default now(),
  ends_at timestamptz not null,
  status text not null default 'active' check (status in ('active', 'done')),
  winner text check (winner in ('attacker', 'defender', 'draw')),
  loot bigint not null default 0,
  done_at timestamptz
);
create index if not exists village_wars_attacker on public.village_wars (attacker, started_at desc);
create index if not exists village_wars_defender on public.village_wars (defender, started_at desc);
create index if not exists village_wars_active on public.village_wars (status) where status = 'active';

create table if not exists public.war_fighters (
  war_id bigint not null references public.village_wars (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  side text not null check (side in ('attacker', 'defender')),
  raids int not null default 0,
  wins int not null default 0,
  points bigint not null default 0,
  coins bigint not null default 0,
  scouts int not null default 0,
  primary key (war_id, user_id)
);

create table if not exists public.war_hits (
  id bigint generated always as identity primary key,
  war_id bigint not null references public.village_wars (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  side text not null check (side in ('attacker', 'defender')),
  target text not null,                     -- a player's id, or a camp fighter's id
  won boolean not null,
  points int not null,                      -- to the raider's side on a win, to the target's side on a loss
  coins bigint not null default 0,
  scouted boolean not null default false,
  at timestamptz not null default now()
);
create index if not exists war_hits_war on public.war_hits (war_id, at desc);
create index if not exists war_hits_user on public.war_hits (user_id, at desc);

create table if not exists public.war_scouts (
  war_id bigint not null references public.village_wars (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  target text not null,
  used boolean not null default false,
  at timestamptz not null default now(),
  primary key (war_id, user_id, target)
);

create table if not exists public.war_energy (
  user_id uuid primary key references auth.users (id) on delete cascade,
  raids numeric not null default 10,
  raids_at timestamptz not null default now(),
  scouts numeric not null default 5,
  scouts_at timestamptz not null default now()
);

create table if not exists public.war_purse (
  user_id uuid primary key references auth.users (id) on delete cascade,
  spoils bigint not null default 0 check (spoils >= 0),
  apples int not null default 0 check (apples >= 0)
);

create table if not exists public.war_shop (
  item text primary key,
  price int not null check (price > 0),
  sort int not null
);

alter table public.villages
  add column if not exists war_wins int not null default 0,
  add column if not exists war_losses int not null default 0,
  add column if not exists camps_beaten int not null default 0,
  add column if not exists war_shield timestamptz;

alter table public.village_wars enable row level security;
alter table public.war_fighters enable row level security;
alter table public.war_hits enable row level security;
alter table public.war_scouts enable row level security;
alter table public.war_energy enable row level security;
alter table public.war_purse enable row level security;
alter table public.war_shop enable row level security;

-- the Blood Moon Warband: war-only gear, bought with War Spoils. Tier 11 so its three-piece set bonus counts on
-- its own; it helps on bosses too, like every other set.
insert into public.raid_gear_defs (id, tier, slot, bar, raid) values
  ('war_reaver', 11, 'weapon', 'might', 58),
  ('war_grimoire', 11, 'weapon', 'magic', 58),
  ('war_helm', 11, 'head', 'both', 24),
  ('war_hauberk', 11, 'body', 'both', 24),
  ('war_greaves', 11, 'feet', 'both', 24),
  ('war_banner', 11, 'cloak', 'both', 24)
on conflict (id) do update set tier = excluded.tier, slot = excluded.slot, bar = excluded.bar, raid = excluded.raid;

insert into public.war_shop (item, price, sort) values
  ('apple', 20, 1), ('war_reaver', 400, 2), ('war_grimoire', 400, 3), ('war_helm', 250, 4),
  ('war_hauberk', 250, 5), ('war_greaves', 250, 6), ('war_banner', 250, 7)
on conflict (item) do update set price = excluded.price, sort = excluded.sort;

-- ---------- small helpers ----------
create or replace function public.war_base(p_lvl int) returns numeric
language sql immutable set search_path = '' as $$ select (25 + 3 * (greatest(1, coalesce(p_lvl, 1)) - 1))::numeric $$;

create or replace function public.war_energy_now(p_user uuid, out raids numeric, out scouts numeric)
language sql stable security definer set search_path = '' as $$
  select coalesce((select least(10, e.raids + extract(epoch from (now() - e.raids_at)) / 360) from public.war_energy e where e.user_id = p_user), 10),
         coalesce((select least(5, e.scouts + extract(epoch from (now() - e.scouts_at)) / 720) from public.war_energy e where e.user_id = p_user), 5);
$$;

-- points a raider camp has scored by itself so far (its rate is set when the war is declared)
create or replace function public.war_camp_points(w public.village_wars) returns bigint
language sql stable set search_path = '' as $$
  select case when w.camp is null then 0 else floor(coalesce((w.camp->>'rate')::numeric, 0) * w.defender_size
    * greatest(0, least(48, extract(epoch from (least(now(), w.ends_at) - w.started_at)) / 3600)))::bigint end;
$$;

create or replace function public.war_give(p_user uuid, p_spoils bigint, p_apples int) returns void
language sql security definer set search_path = '' as $$
  insert into public.war_purse (user_id, spoils, apples) values (p_user, greatest(0, p_spoils), greatest(0, p_apples))
  on conflict (user_id) do update set spoils = public.war_purse.spoils + greatest(0, p_spoils), apples = public.war_purse.apples + greatest(0, p_apples);
$$;

-- a war is over once its time is up: count the camp's own points in, pick the winner per head, move the loot,
-- hand out spoils and apples, give the loser a rest, tell both villages
create or replace function public.war_settle(p_war bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare w public.village_wars; a_head numeric; d_head numeric; win text; loser uuid; winv uuid; tr bigint; lt bigint;
        aname text; dname text; f record; body_a text; body_d text;
begin
  select * into w from public.village_wars where id = p_war for update;
  if not found or w.status <> 'active' or w.ends_at > now() then return; end if;
  w.defender_score := w.defender_score + public.war_camp_points(w);
  a_head := w.attacker_score::numeric / greatest(3, w.attacker_size);
  d_head := w.defender_score::numeric / greatest(3, w.defender_size);
  win := case when a_head > d_head then 'attacker' when d_head > a_head then 'defender' else 'draw' end;
  select name into aname from public.villages where id = w.attacker;
  dname := coalesce((select name from public.villages where id = w.defender), w.camp->>'name', 'the raiders');
  lt := 0;
  if w.defender is not null and win <> 'draw' then
    loser := case when win = 'attacker' then w.defender else w.attacker end;
    winv := case when win = 'attacker' then w.attacker else w.defender end;
    select treasury into tr from public.villages where id = loser for update;
    lt := least(50000, floor(coalesce(tr, 0) * 0.05))::bigint;
    if lt > 0 then
      update public.villages set treasury = treasury - lt where id = loser;
      update public.villages set treasury = treasury + lt where id = winv;
    end if;
    update public.villages set war_wins = war_wins + 1 where id = winv;
    update public.villages set war_losses = war_losses + 1, war_shield = now() + interval '3 days' where id = loser;
  elsif w.defender is null and win = 'attacker' then
    update public.villages set camps_beaten = camps_beaten + 1 where id = w.attacker;
  end if;
  update public.village_wars set status = 'done', winner = win, loot = lt, done_at = now(), defender_score = w.defender_score where id = w.id;
  for f in select * from public.war_fighters where war_id = w.id and raids >= 1 loop
    perform public.war_give(f.user_id, 25 + case when f.side = win then 75 else 0 end,
      case when f.raids < 3 then 0 when f.side = win then 2 else 1 end);
  end loop;
  body_a := case win when 'attacker' then format('Your village beat %s in the war!%s', dname, case when lt > 0 then format(' %s coins taken for the treasury.', lt) else '' end)
                     when 'defender' then format('%s won the war against your village.', dname)
                     else format('The war with %s ended in a draw.', dname) end;
  perform public.notify_village(w.attacker, null, 'war', '⚔️', body_a, jsonb_build_object('to', 'war'));
  if w.defender is not null then
    body_d := case win when 'defender' then format('Your village held off %s and won the war!%s', aname, case when lt > 0 then format(' %s coins taken for the treasury.', lt) else '' end)
                       when 'attacker' then format('%s won the war against your village. You rest for 3 days.', aname)
                       else format('The war with %s ended in a draw.', aname) end;
    perform public.notify_village(w.defender, null, 'war', '⚔️', body_d, jsonb_build_object('to', 'war'));
  end if;
end $$;

create or replace function public.war_settle_village(p_village uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  for r in select id from public.village_wars where status = 'active' and ends_at <= now() and (attacker = p_village or defender = p_village) loop
    perform public.war_settle(r.id);
  end loop;
end $$;

-- the war this village is fighting now, if any
create or replace function public.war_current(p_village uuid) returns public.village_wars
language sql stable security definer set search_path = '' as $$
  select * from public.village_wars where status = 'active' and (attacker = p_village or defender = p_village) order by id desc limit 1;
$$;

-- one enemy as seen by a raider: level, class and the two powers
create or replace function public.war_target(w public.village_wars, p_side text, p_target text,
  out ok boolean, out name text, out cls text, out lvl int, out defence numeric, out gear jsonb)
language plpgsql stable security definer set search_path = '' as $$
declare enemy uuid; t uuid; fj jsonb; fr record;
begin
  ok := false;
  if p_side = 'attacker' and w.defender is null then
    select x into fj from jsonb_array_elements(coalesce(w.camp->'fighters', '[]'::jsonb)) x where x->>'id' = p_target limit 1;
    if fj is null then return; end if;
    ok := true; name := fj->>'name'; cls := fj->>'cls'; lvl := greatest(1, (fj->>'lvl')::int);
    defence := public.war_base(lvl) * (1 + lvl * 0.02); gear := '[]'::jsonb;
    return;
  end if;
  enemy := case when p_side = 'attacker' then w.defender else w.attacker end;
  if p_target !~ '^[0-9a-f-]{36}$' then return; end if;
  t := p_target::uuid;
  if not exists (select 1 from public.village_members m where m.village_id = enemy and m.user_id = t) then return; end if;
  select * into fr from public.raid_fighter(t);
  ok := true; name := public.player_name(t); cls := nullif(fr.cls, ''); lvl := greatest(1, fr.lvl);
  defence := public.war_base(lvl) * (1 + (public.raid_gear_bonus(t, 'might') + public.raid_gear_bonus(t, 'magic')) / 2);
  select coalesce(jsonb_agg(w2.item), '[]'::jsonb) into gear
    from public.farms fm cross join lateral jsonb_each_text(case when jsonb_typeof(fm.state->'gear') = 'object' then fm.state->'gear' else '{}'::jsonb end) w2(slot, item)
    where fm.user_id = t and coalesce(w2.item, '') <> '' and jsonb_typeof(fm.state->'inv'->w2.item) = 'number' and (fm.state->'inv'->>w2.item)::numeric > 0;
end $$;

-- your attack: the boss damage base, your class's bar of gear, farmhands, and +25% on someone you scouted
create or replace function public.war_attack(p_user uuid, out lvl int, out kind text, out bonus numeric)
language plpgsql stable security definer set search_path = '' as $$
declare f record;
begin
  select * into f from public.raid_fighter(p_user);
  lvl := greatest(1, f.lvl);
  kind := case when f.cls in ('wizard', 'cleric', 'bard') then 'magic' else 'might' end;
  bonus := public.farmhand_bonus(p_user) + public.raid_gear_bonus(p_user, kind);
end $$;

-- ---------- what the war page shows ----------
create or replace function public.war_status() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); v uuid; vr public.villages; w public.village_wars; myside text; role text; en record;
        res jsonb; ev public.villages; roster jsonb; logj jsonb; mine jsonb; board jsonb; lastw jsonb; targets jsonb; a_members int;
        my_score bigint; their_score bigint; my_size int; their_size int; camp_pts bigint;
begin
  if me is null then raise exception 'Sign in first'; end if;
  select * into en from public.war_energy_now(me);
  res := jsonb_build_object(
    'now', now(),
    'energy', jsonb_build_object('raids', round(en.raids, 3), 'raids_max', 10, 'raids_secs', 360, 'scouts', round(en.scouts, 3), 'scouts_max', 5, 'scouts_secs', 720,
      'courage', round(public.raid_courage(me), 3), 'courage_max', 12),
    'purse', coalesce((select jsonb_build_object('spoils', p.spoils, 'apples', p.apples) from public.war_purse p where p.user_id = me), jsonb_build_object('spoils', 0, 'apples', 0)),
    'shop', coalesce((select jsonb_agg(jsonb_build_object('item', s.item, 'price', s.price,
        'owned', s.item <> 'apple' and exists (select 1 from public.farms fm where fm.user_id = me and jsonb_typeof(fm.state->'inv'->s.item) = 'number' and (fm.state->'inv'->>s.item)::numeric > 0))
        order by s.sort) from public.war_shop s), '[]'::jsonb),
    'rules', jsonb_build_object('hours', 48, 'cooldown_secs', 300, 'per_hour', 30, 'loot_pct', 5, 'loot_cap', 50000, 'shield_days', 3, 'scout_bonus', 25));
  v := public.my_village();
  if v is null then return res || jsonb_build_object('in_village', false); end if;
  perform public.war_settle_village(v);
  select * into vr from public.villages where id = v;
  select m.role into role from public.village_members m where m.user_id = me;
  res := res || jsonb_build_object('in_village', true, 'role', role,
    'village', jsonb_build_object('id', vr.id, 'name', vr.name, 'crest', vr.crest, 'treasury', vr.treasury, 'war_wins', vr.war_wins,
      'war_losses', vr.war_losses, 'camps_beaten', vr.camps_beaten, 'shield', vr.war_shield));
  w := public.war_current(v);
  if w.id is not null then
    myside := case when w.attacker = v then 'attacker' else 'defender' end;
    camp_pts := public.war_camp_points(w);
    if myside = 'attacker' then my_score := w.attacker_score; their_score := w.defender_score + camp_pts; my_size := w.attacker_size; their_size := w.defender_size;
    else my_score := w.defender_score; their_score := w.attacker_score; my_size := w.defender_size; their_size := w.attacker_size; end if;
    if myside = 'attacker' and w.defender is null then
      select coalesce(jsonb_agg(jsonb_build_object('id', x->>'id', 'name', x->>'name', 'cls', x->>'cls', 'lvl', (x->>'lvl')::int,
          'cooldown', coalesce((select greatest(0, 300 - extract(epoch from (now() - max(h.at))))::int from public.war_hits h where h.war_id = w.id and h.user_id = me and h.target = x->>'id'), 0),
          'scouted', exists (select 1 from public.war_scouts s where s.war_id = w.id and s.user_id = me and s.target = x->>'id' and not s.used),
          'mine', (select count(*) from public.war_hits h where h.war_id = w.id and h.user_id = me and h.target = x->>'id'))), '[]'::jsonb)
        into roster from jsonb_array_elements(w.camp->'fighters') x;
      ev := null;
    else
      select * into ev from public.villages where id = case when myside = 'attacker' then w.defender else w.attacker end;
      select coalesce(jsonb_agg(jsonb_build_object('id', m.user_id, 'name', public.player_name(m.user_id), 'cls', nullif(f.cls, ''), 'lvl', greatest(1, f.lvl),
          'cooldown', coalesce((select greatest(0, 300 - extract(epoch from (now() - max(h.at))))::int from public.war_hits h where h.war_id = w.id and h.user_id = me and h.target = m.user_id::text), 0),
          'scouted', exists (select 1 from public.war_scouts s where s.war_id = w.id and s.user_id = me and s.target = m.user_id::text and not s.used),
          'mine', (select count(*) from public.war_hits h where h.war_id = w.id and h.user_id = me and h.target = m.user_id::text)) order by f.lvl desc), '[]'::jsonb)
        into roster from public.village_members m cross join lateral public.raid_fighter(m.user_id) f where m.village_id = ev.id;
    end if;
    select coalesce(jsonb_agg(jsonb_build_object('who', public.player_name(h.user_id), 'mine', h.user_id = me, 'ours', h.side = myside, 'won', h.won, 'points', h.points,
        'coins', case when h.user_id = me then h.coins else 0 end, 'scouted', h.scouted, 'at', h.at,
        'target', case when w.defender is null then (select x->>'name' from jsonb_array_elements(w.camp->'fighters') x where x->>'id' = h.target limit 1)
                       when h.target ~ '^[0-9a-f-]{36}$' then public.player_name(h.target::uuid) else '?' end) order by h.at desc), '[]'::jsonb)
      into logj from (select * from public.war_hits where war_id = w.id order by at desc limit 25) h;
    select coalesce(jsonb_agg(jsonb_build_object('name', public.player_name(f.user_id), 'me', f.user_id = me, 'raids', f.raids, 'wins', f.wins, 'points', f.points) order by f.points desc), '[]'::jsonb)
      into board from (select * from public.war_fighters where war_id = w.id and side = myside order by points desc limit 12) f;
    mine := coalesce((select jsonb_build_object('raids', f.raids, 'wins', f.wins, 'points', f.points, 'coins', f.coins, 'scouts', f.scouts) from public.war_fighters f where f.war_id = w.id and f.user_id = me),
      jsonb_build_object('raids', 0, 'wins', 0, 'points', 0, 'coins', 0, 'scouts', 0));
    res := res || jsonb_build_object('war', jsonb_build_object('id', w.id, 'side', myside, 'camp', w.defender is null,
      'enemy', case when ev.id is not null then jsonb_build_object('name', ev.name, 'crest', ev.crest, 'treasury', ev.treasury)
                    else jsonb_build_object('name', w.camp->>'name', 'crest', w.camp->>'crest') end,
      'started_at', w.started_at, 'ends_at', w.ends_at,
      'score', jsonb_build_object('mine', my_score, 'theirs', their_score, 'my_size', greatest(3, my_size), 'their_size', greatest(3, their_size),
        'my_head', round(my_score::numeric / greatest(3, my_size), 1), 'their_head', round(their_score::numeric / greatest(3, their_size), 1)),
      'camp_rate', case when w.defender is null then round(coalesce((w.camp->>'rate')::numeric, 0) * w.defender_size, 1) else null end,
      'roster', roster, 'log', logj, 'board', board, 'me', mine));
  else
    select jsonb_build_object('id', x.id, 'camp', x.defender is null,
        'enemy', coalesce((select jsonb_build_object('name', e.name, 'crest', e.crest) from public.villages e where e.id = case when x.attacker = v then x.defender else x.attacker end),
                          jsonb_build_object('name', x.camp->>'name', 'crest', x.camp->>'crest')),
        'result', case when x.winner = 'draw' then 'draw' when (x.winner = 'attacker') = (x.attacker = v) then 'won' else 'lost' end,
        'my_head', round((case when x.attacker = v then x.attacker_score else x.defender_score end)::numeric / greatest(3, case when x.attacker = v then x.attacker_size else x.defender_size end), 1),
        'their_head', round((case when x.attacker = v then x.defender_score else x.attacker_score end)::numeric / greatest(3, case when x.attacker = v then x.defender_size else x.attacker_size end), 1),
        'loot', x.loot, 'done_at', x.done_at,
        'me', (select jsonb_build_object('raids', f.raids, 'wins', f.wins, 'points', f.points, 'coins', f.coins) from public.war_fighters f where f.war_id = x.id and f.user_id = me))
      into lastw from public.village_wars x where x.status = 'done' and (x.attacker = v or x.defender = v) and x.done_at > now() - interval '7 days' order by x.done_at desc limit 1;
    select count(*) into a_members from public.village_members where village_id = v;
    select coalesce(jsonb_agg(t order by (t->>'ok')::boolean desc, t->>'name'), '[]'::jsonb) into targets from (
      select jsonb_build_object('id', o.id, 'name', o.name, 'crest', o.crest, 'members', n.c, 'wins', o.war_wins,
        'loot', least(50000, floor(o.treasury * 0.05))::bigint,
        'ok', (q.why is null), 'why', q.why) t
      from public.villages o
      cross join lateral (select count(*)::int c from public.village_members mm where mm.village_id = o.id) n
      cross join lateral (select case
          when exists (select 1 from public.village_wars aw where aw.status = 'active' and (aw.attacker = o.id or aw.defender = o.id)) then 'At war already'
          when o.war_shield > now() then 'Resting after a war'
          when o.created_at > now() - interval '3 days' then 'Too new to attack'
          when n.c = 0 then 'Empty'
          when greatest(3, n.c) > 3 * greatest(3, a_members) then 'Too big for you'
          when greatest(3, a_members) > 3 * greatest(3, n.c) then 'Too small for you'
          else null end as why) q
      where o.id <> v) s;
    res := res || jsonb_build_object('war', null, 'last', lastw, 'targets', targets,
      'shielded', vr.war_shield > now(), 'too_new', vr.created_at > now() - interval '3 days');
  end if;
  return res;
end $$;

-- ---------- declaring ----------
create or replace function public.war_declare(p_target uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); v uuid; vr public.villages; tv public.villages; a_n int; d_n int; avg_lvl int; camp jsonb; nm text; cr text;
        names text[] := array['Grisk', 'Old Morra', 'Two-Knives Tam', 'Brannoc', 'Vesk the Pale', 'Hollow Jory', 'Ma Keel', 'Red Ulla', 'Dunmar', 'Skarl', 'Wren of the Ditch', 'One-Eye Hask'];
        clss text[] := array['fighter', 'rogue', 'ranger', 'wizard', 'cleric', 'bard'];
        camps text[] := array['The Ashen Raiders', 'Red Hand Camp', 'The Wolfsbane Reavers', 'The Thornback Band', 'Mire Cutthroats', 'The Gravewind Marauders'];
        crests text[] := array['💀', '🐺', '🔥', '🗡️', '🦇', '🪓'];
        k int;
begin
  if me is null then raise exception 'Sign in first'; end if;
  v := public.my_village();
  if v is null then raise exception 'Join a village first.'; end if;
  if (select role from public.village_members where user_id = me) <> 'elder' then raise exception 'Only elders can declare war.'; end if;
  -- lock both villages in id order, so two elders declaring on each other at once can't deadlock
  if p_target is not null and p_target < v then perform 1 from public.villages where id = p_target for update; end if;
  select * into vr from public.villages where id = v for update;
  if p_target is not null and p_target > v then perform 1 from public.villages where id = p_target for update; end if;
  perform public.war_settle_village(v);
  if (public.war_current(v)).id is not null then raise exception 'Your village is already at war.'; end if;
  select count(*) into a_n from public.village_members where village_id = v;
  if p_target is null then
    select greatest(1, round(avg(f.lvl)))::int into avg_lvl from public.village_members m cross join lateral public.raid_fighter(m.user_id) f where m.village_id = v;
    avg_lvl := coalesce(avg_lvl, 1);
    k := 1 + floor(random() * array_length(camps, 1))::int;
    nm := camps[k]; cr := crests[k];
    select jsonb_agg(jsonb_build_object('id', 'c' || i, 'name', names[1 + ((i * 5 + k) % array_length(names, 1))],
        'cls', clss[1 + floor(random() * 6)::int], 'lvl', greatest(1, avg_lvl + floor(random() * 3)::int - 1)))
      into camp from generate_series(1, greatest(3, a_n)) i;
    -- the camp scores by itself about what a neighbour playing a full bar of raids every 12 hours nets, one camp
    -- fighter per real neighbour (not the floor of 3), so a village of one can still beat it
    camp := jsonb_build_object('name', nm, 'crest', cr, 'rate', round(0.31 * public.war_base(avg_lvl), 2), 'fighters', camp);
    insert into public.village_wars (attacker, defender, camp, attacker_size, defender_size, declared_by, ends_at)
      values (v, null, camp, greatest(1, a_n), greatest(1, a_n), me, now() + interval '48 hours');
    perform public.notify_village(v, me, 'war', '⚔️', format('%s led your village out against %s. 48 hours to beat them!', public.player_name(me), nm), jsonb_build_object('to', 'war'));
  else
    if p_target = v then raise exception 'That''s your own village.'; end if;
    select * into tv from public.villages where id = p_target;
    if not found then raise exception 'That village is gone.'; end if;
    perform public.war_settle_village(p_target);
    if (public.war_current(p_target)).id is not null then raise exception '% is already at war.', tv.name; end if;
    if tv.war_shield > now() then raise exception '% is resting after a war until %.', tv.name, to_char(tv.war_shield at time zone 'UTC', 'Mon DD HH24:MI "UTC"'); end if;
    if tv.created_at > now() - interval '3 days' then raise exception '% is too new to attack. Villages are safe for their first 3 days.', tv.name; end if;
    select count(*) into d_n from public.village_members where village_id = p_target;
    if d_n = 0 then raise exception '% has nobody in it.', tv.name; end if;
    if greatest(3, d_n) > 3 * greatest(3, a_n) or greatest(3, a_n) > 3 * greatest(3, d_n) then raise exception '% is too far from your size for a fair war.', tv.name; end if;
    insert into public.village_wars (attacker, defender, attacker_size, defender_size, declared_by, ends_at)
      values (v, p_target, greatest(3, a_n), greatest(3, d_n), me, now() + interval '48 hours');
    perform public.notify_village(p_target, me, 'war', '⚔️', format('%s declared war on your village! 48 hours to fight back.', vr.name), jsonb_build_object('to', 'war'));
    perform public.notify_village(v, me, 'war', '⚔️', format('%s declared war on %s. 48 hours to win it!', public.player_name(me), tv.name), jsonb_build_object('to', 'war'));
  end if;
  return public.war_status();
end $$;

-- ---------- raiding and scouting ----------
create or replace function public.war_raid(p_target text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); v uuid; w public.village_wars; myside text; t record; a record; en record; scouted boolean; atk numeric; def numeric;
        chance numeric; dmg int; won boolean; pts int; coins bigint := 0; mult numeric; last_at timestamptz; gid bigint;
begin
  if me is null then raise exception 'Sign in first'; end if;
  v := public.my_village();
  if v is null then raise exception 'Join a village first.'; end if;
  perform public.war_settle_village(v);
  select * into w from public.village_wars where status = 'active' and (attacker = v or defender = v) order by id desc limit 1 for update;
  if not found then raise exception 'Your village isn''t at war right now.'; end if;
  myside := case when w.attacker = v then 'attacker' else 'defender' end;
  select * into t from public.war_target(w, myside, p_target);
  if not t.ok then raise exception 'They aren''t on the other side.'; end if;
  insert into public.war_energy (user_id) values (me) on conflict (user_id) do nothing;
  perform 1 from public.war_energy where user_id = me for update;
  select * into en from public.war_energy_now(me);
  if en.raids < 1 then raise exception 'Out of raids. One comes back every 6 minutes, or eat a Blood Apple.'; end if;
  select max(at) into last_at from public.war_hits where war_id = w.id and user_id = me and target = p_target;
  if last_at > now() - interval '5 minutes' then
    raise exception 'You just raided %. Try someone else, or wait %.', t.name, to_char((last_at + interval '5 minutes') - now(), 'FMMI:SS');
  end if;
  if (select count(*) from public.war_hits where user_id = me and at > now() - interval '1 hour') >= 30 then
    raise exception 'That''s 30 raids this hour. Rest your arm for a bit.';
  end if;
  select * into a from public.war_attack(me);
  scouted := exists (select 1 from public.war_scouts where war_id = w.id and user_id = me and target = p_target and not used);
  atk := public.war_base(a.lvl) * (1 + a.bonus) * case when scouted then 1.25 else 1 end;
  def := t.defence;
  chance := least(0.85, greatest(0.15, atk / greatest(1, atk + def)));
  dmg := least(500, round(public.war_base(a.lvl) * 1.5 * (0.9 + random() * 0.2) * (1 + a.bonus) * case when scouted then 1.25 else 1 end))::int;
  won := random() < chance;
  update public.war_energy set raids = en.raids - 1, raids_at = now() where user_id = me;
  if scouted then update public.war_scouts set used = true where war_id = w.id and user_id = me and target = p_target; end if;
  if won then
    pts := dmg;
    select greatest(1, power(greatest(0, coalesce(fm.value, 0))::numeric / 20000, 0.8)) into mult from public.farms fm where fm.user_id = me;
    coins := round(dmg * 0.6 * coalesce(mult, 1) * (1 + public.farmhand_plunder(me)));
    insert into public.farm_grants (user_id, kind, coins, xp, ref, items) values (me, 'war', greatest(0, coins), 20, 'war:' || w.id, '{}'::jsonb) returning id into gid;
    perform public.war_give(me, 2, 0);
    if myside = 'attacker' then update public.village_wars set attacker_score = attacker_score + pts where id = w.id;
    else update public.village_wars set defender_score = defender_score + pts where id = w.id; end if;
  else
    pts := greatest(1, round(dmg / 2.0))::int;
    if myside = 'attacker' then update public.village_wars set defender_score = defender_score + pts where id = w.id;
    else update public.village_wars set attacker_score = attacker_score + pts where id = w.id; end if;
  end if;
  insert into public.war_hits (war_id, user_id, side, target, won, points, coins, scouted) values (w.id, me, myside, p_target, won, pts, coins, scouted);
  insert into public.war_fighters (war_id, user_id, side, raids, wins, points, coins) values (w.id, me, myside, 1, case when won then 1 else 0 end, case when won then pts else 0 end, coins)
    on conflict (war_id, user_id) do update set raids = public.war_fighters.raids + 1, wins = public.war_fighters.wins + excluded.wins,
      points = public.war_fighters.points + excluded.points, coins = public.war_fighters.coins + excluded.coins;
  return public.war_status() || jsonb_build_object('hit', jsonb_build_object('won', won, 'chance', round(chance * 100), 'points', pts, 'coins', coins,
    'spoils', case when won then 2 else 0 end, 'scouted', scouted, 'target', t.name, 'grant', gid, 'xp', case when won then 20 else 0 end));
end $$;

create or replace function public.war_scout(p_target text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); v uuid; w public.village_wars; myside text; t record; a record; en record; atk numeric;
begin
  if me is null then raise exception 'Sign in first'; end if;
  v := public.my_village();
  if v is null then raise exception 'Join a village first.'; end if;
  perform public.war_settle_village(v);
  w := public.war_current(v);
  if w.id is null then raise exception 'Your village isn''t at war right now.'; end if;
  myside := case when w.attacker = v then 'attacker' else 'defender' end;
  select * into t from public.war_target(w, myside, p_target);
  if not t.ok then raise exception 'They aren''t on the other side.'; end if;
  insert into public.war_energy (user_id) values (me) on conflict (user_id) do nothing;
  perform 1 from public.war_energy where user_id = me for update;
  select * into en from public.war_energy_now(me);
  if en.scouts < 1 then raise exception 'Out of scouts. One comes back every 12 minutes, or eat a Blood Apple.'; end if;
  update public.war_energy set scouts = en.scouts - 1, scouts_at = now() where user_id = me;
  insert into public.war_scouts (war_id, user_id, target) values (w.id, me, p_target)
    on conflict (war_id, user_id, target) do update set used = false, at = now();
  insert into public.war_fighters (war_id, user_id, side, scouts) values (w.id, me, myside, 1)
    on conflict (war_id, user_id) do update set scouts = public.war_fighters.scouts + 1;
  select * into a from public.war_attack(me);
  atk := public.war_base(a.lvl) * (1 + a.bonus) * 1.25;
  return public.war_status() || jsonb_build_object('scout', jsonb_build_object('target', p_target, 'name', t.name, 'cls', t.cls, 'lvl', t.lvl,
    'defence', round(t.defence), 'attack', round(atk), 'gear', t.gear, 'chance', round(least(0.85, greatest(0.15, atk / greatest(1, atk + t.defence))) * 100)));
end $$;

-- ---------- Blood Apples and the war shop ----------
create or replace function public.war_apple(p_kind text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); n int;
begin
  if me is null then raise exception 'Sign in first'; end if;
  if p_kind not in ('raids', 'scouts', 'courage') then raise exception 'Unknown refill.'; end if;
  select apples into n from public.war_purse where user_id = me for update;
  if coalesce(n, 0) < 1 then raise exception 'No Blood Apples. Win wars and bosses, or buy them with War Spoils in the Market.'; end if;
  update public.war_purse set apples = apples - 1 where user_id = me;
  if p_kind = 'raids' then
    insert into public.war_energy (user_id, raids, raids_at) values (me, 10, now()) on conflict (user_id) do update set raids = 10, raids_at = now();
  elsif p_kind = 'scouts' then
    insert into public.war_energy (user_id, scouts, scouts_at) values (me, 5, now()) on conflict (user_id) do update set scouts = 5, scouts_at = now();
  else
    insert into public.raid_energy (user_id, energy, at) values (me, 12, now()) on conflict (user_id) do update set energy = 12, at = now();
  end if;
  return public.war_status() || jsonb_build_object('ate', p_kind);
end $$;

create or replace function public.war_buy(p_item text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); s public.war_shop; have bigint; gid bigint;
begin
  if me is null then raise exception 'Sign in first'; end if;
  select * into s from public.war_shop where item = p_item;
  if not found then raise exception 'The war shop doesn''t sell that.'; end if;
  insert into public.war_purse (user_id) values (me) on conflict (user_id) do nothing;
  select spoils into have from public.war_purse where user_id = me for update;
  if have < s.price then raise exception 'That costs % War Spoils and you have %.', s.price, have; end if;
  if p_item <> 'apple' and exists (select 1 from public.farms fm where fm.user_id = me and jsonb_typeof(fm.state->'inv'->p_item) = 'number' and (fm.state->'inv'->>p_item)::numeric > 0) then
    raise exception 'You already have that.';
  end if;
  update public.war_purse set spoils = spoils - s.price, apples = apples + case when p_item = 'apple' then 1 else 0 end where user_id = me;
  if p_item <> 'apple' then
    insert into public.farm_grants (user_id, kind, coins, xp, ref, items) values (me, 'warshop', 0, 0, p_item, jsonb_build_object(p_item, 1)) returning id into gid;
  end if;
  return public.war_status() || jsonb_build_object('bought', p_item, 'grant', gid, 'items', case when gid is null then null else jsonb_build_object(p_item, 1) end);
end $$;

revoke all on function public.war_settle(bigint), public.war_settle_village(uuid), public.war_current(uuid), public.war_target(public.village_wars, text, text),
  public.war_attack(uuid), public.war_give(uuid, bigint, int), public.war_energy_now(uuid), public.war_camp_points(public.village_wars) from public, anon, authenticated;
revoke all on function public.war_status(), public.war_declare(uuid), public.war_raid(text), public.war_scout(text), public.war_apple(text), public.war_buy(text) from public, anon;
grant execute on function public.war_status(), public.war_declare(uuid), public.war_raid(text), public.war_scout(text), public.war_apple(text), public.war_buy(text) to authenticated;

-- a won boss now also drops a Blood Apple (the rest of claim_raid_reward is unchanged)
create or replace function public.claim_raid_reward()
 returns jsonb language plpgsql security definer set search_path to '' as $function$
declare v uuid; rw jsonb; gid bigint; mult numeric; c bigint; tr int; tt public.raid_tiers; m int; piece text; items jsonb; f record; mybar text; ap int := 0;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  v := public.my_village();
  if v is not null then perform public.raid_settle(v); end if;
  select to_jsonb(x) into rw from (
    select h.raid_id, d.n as boss_name, rr.status, h.actions, d.tier,
      (h.actions * d.coin_per_action * case when rr.status = 'won' then 1 else 0.5 end
        + case when rr.status = 'won' and h.actions >= 3 then d.victory_bonus else 0 end)::numeric as coins,
      (h.actions * (15 + 4 * (d.tier - 1)) * case when rr.status = 'won' then 1 else 0.5 end)::int as xp
    from public.raid_hits h join public.village_raids rr on rr.id = h.raid_id join public.raid_boss_defs d on d.id = rr.boss
    where h.user_id = auth.uid() and not h.claimed and rr.status <> 'active'
    order by rr.done_at desc limit 1) x;
  if rw is null then raise exception 'Nothing to collect yet.'; end if;
  update public.raid_hits set claimed = true where raid_id = (rw->>'raid_id')::bigint and user_id = auth.uid() and not claimed;
  if not found then raise exception 'Already collected.'; end if;
  select greatest(1, power(greatest(0, coalesce(fm.value, 0))::numeric / 20000, 0.8)) into mult from public.farms fm where fm.user_id = auth.uid();
  c := round((rw->>'coins')::numeric * coalesce(mult, 1) * (1 + public.farmhand_plunder(auth.uid())));
  tr := greatest(1, coalesce((rw->>'tier')::int, 1));
  items := jsonb_build_object('boss_rune', case when rw->>'status' = 'won' then 2 * tr else tr end);
  select * into tt from public.raid_tiers where tier = tr;
  if tt.tier is not null and rw->>'status' = 'won' and (rw->>'actions')::int >= 3 then
    insert into public.raid_gear_pity (user_id, tier) values (auth.uid(), tr) on conflict (user_id, tier) do nothing;
    select misses into m from public.raid_gear_pity where user_id = auth.uid() and tier = tr for update;
    if m + 1 >= tt.pity or random() < tt.drop_chance then
      select * into f from public.raid_fighter(auth.uid());
      mybar := case when f.cls in ('fighter', 'rogue', 'ranger') then 'might' when f.cls in ('wizard', 'cleric', 'bard') then 'magic' else null end;
      select g.id into piece from public.raid_gear_defs g left join public.farms fm on fm.user_id = auth.uid()
        where g.tier = tr
        order by (jsonb_typeof(fm.state->'inv'->g.id) = 'number' and (fm.state->'inv'->>g.id)::numeric > 0) nulls first,
                 (g.bar = 'both' or g.bar = mybar or mybar is null) desc, random()
        limit 1;
      update public.raid_gear_pity set misses = 0 where user_id = auth.uid() and tier = tr;
      if piece is not null then items := items || jsonb_build_object(piece, 1); end if;
    else
      update public.raid_gear_pity set misses = m + 1 where user_id = auth.uid() and tier = tr;
    end if;
  end if;
  if rw->>'status' = 'won' and (rw->>'actions')::int >= 3 then ap := 1; perform public.war_give(auth.uid(), 0, 1); end if;
  insert into public.farm_grants (user_id, kind, coins, xp, ref, items)
    values (auth.uid(), 'raid', greatest(0, c), greatest(0, (rw->>'xp')::int), rw->>'raid_id', items) returning id into gid;
  return rw || jsonb_build_object('coins', c, 'grant', gid, 'items', items, 'gear', piece, 'apples', ap);
end $function$;

-- the Claude connector plays the same functions, as this player
create or replace function public.svc_act(p_user uuid, p_action text, p_args jsonb default '{}'::jsonb)
 returns jsonb language plpgsql security definer set search_path to '' as $function$
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
    when 'war_status' then r := public.war_status();
    when 'war_declare' then r := public.war_declare(nullif(p_args->>'p_target', '')::uuid);
    when 'war_raid' then r := public.war_raid(p_args->>'p_target');
    when 'war_scout' then r := public.war_scout(p_args->>'p_target');
    when 'war_apple' then r := public.war_apple(p_args->>'p_kind');
    when 'war_buy' then r := public.war_buy(p_args->>'p_item');
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
    when 'farmhand_market' then
      if p_args ? 'p_max' or p_args ? 'p_min' then
        r := public.farmhand_market(coalesce(p_args->>'p_q', ''), (p_args->>'p_min')::bigint, (p_args->>'p_max')::bigint);
      else
        r := public.farmhand_market(coalesce(p_args->>'p_q', ''));
      end if;
    when 'my_farmhands' then r := public.my_farmhands();
    when 'drop_farmhand' then r := public.drop_farmhand((p_args->>'p_hand')::uuid);
    else raise exception 'Unknown action';
  end case;
  return coalesce(r, 'null'::jsonb);
end $function$;
