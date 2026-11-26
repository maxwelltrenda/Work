-- Farmhand help is capped (Max, after Kingdoms at War: the smallest player hits for about 25, the biggest with
-- every ally's help about 500). Being bigger, and hiring bigger farmhands, earns more coins rather than more damage.
--   damage per hit = (25 + 3 per class level above 1) x1.5 if your class suits the attack x0.9-1.1, x(1 + help),
--   help = a quarter-tenth of the digits in each farmhand's farm value, added up, at most +300%; never above 500.
--   boss coins = the share x your own size (rewardScale) x (1 + plunder),
--   plunder = your farmhands' farms' worth / your farm's worth, at most 1 (double coins).
-- Bosses have 2.5x the health to match the stronger hits.

create or replace function public.farmhand_bonus(p_user uuid) returns numeric
language sql stable security definer set search_path = '' as $$
  select least(3, coalesce(sum(log(1 + greatest(0, coalesce(f.value, 0))::numeric)), 0) / 40)
  from public.farmhands h left join public.farms f on f.user_id = h.hand
  where h.owner = p_user;
$$;
revoke all on function public.farmhand_bonus(uuid) from public, anon, authenticated;

create or replace function public.farmhand_plunder(p_user uuid) returns numeric
language sql stable security definer set search_path = '' as $$
  select least(1, coalesce(sum(greatest(0, coalesce(f.value, 0))), 0)::numeric
                  / greatest(1, coalesce((select value from public.farms where user_id = p_user), 0)))
  from public.farmhands h left join public.farms f on f.user_id = h.hand
  where h.owner = p_user;
$$;
revoke all on function public.farmhand_plunder(uuid) from public, anon, authenticated;

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
    'bonus_max', 3,
    'plunder', public.farmhand_plunder(auth.uid()),
    'value', coalesce((select value from public.farms where user_id = auth.uid()), 0));
$$;

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
  dmg := least(500, round((25 + 3 * (greatest(1, f.lvl) - 1)) * (case when matched then 1.5 else 1 end) * (0.9 + random() * 0.2) * (1 + bonus)));
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

create or replace function public.claim_raid_reward() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v uuid; rw jsonb; gid bigint; mult numeric; c bigint;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  v := public.my_village();
  if v is not null then perform public.raid_settle(v); end if;
  select to_jsonb(x) into rw from (
    select h.raid_id, d.n as boss_name, rr.status, h.actions,
      (h.actions * d.coin_per_action * case when rr.status = 'won' then 1 else 0.5 end
        + case when rr.status = 'won' and h.actions >= 3 then d.victory_bonus else 0 end)::numeric as coins,
      (h.actions * 15 * case when rr.status = 'won' then 1 else 0.5 end)::int as xp
    from public.raid_hits h join public.village_raids rr on rr.id = h.raid_id join public.raid_boss_defs d on d.id = rr.boss
    where h.user_id = auth.uid() and not h.claimed and rr.status <> 'active'
    order by rr.done_at desc limit 1) x;
  if rw is null then raise exception 'Nothing to collect yet.'; end if;
  update public.raid_hits set claimed = true where raid_id = (rw->>'raid_id')::bigint and user_id = auth.uid() and not claimed;
  if not found then raise exception 'Already collected.'; end if;
  -- bigger earns more: your own farm's size, and farmhands worth as much as your farm double it
  select greatest(1, power(greatest(0, coalesce(f.value, 0))::numeric / 20000, 0.8)) into mult from public.farms f where f.user_id = auth.uid();
  c := round((rw->>'coins')::numeric * coalesce(mult, 1) * (1 + public.farmhand_plunder(auth.uid())));
  insert into public.farm_grants (user_id, kind, coins, xp, ref)
    values (auth.uid(), 'raid', greatest(0, c), greatest(0, (rw->>'xp')::int), rw->>'raid_id') returning id into gid;
  return rw || jsonb_build_object('coins', c, 'grant', gid);
end $$;

-- bosses take 2.5x as much to beat, to match the stronger hits
update public.raid_boss_defs d set phases = (
  select jsonb_agg(p || jsonb_build_object('might', round((p->>'might')::numeric * 2.5)::int, 'magic', round((p->>'magic')::numeric * 2.5)::int) order by o)
  from jsonb_array_elements(d.phases) with ordinality as t(p, o));
