-- Big growth, part 3: shared rewards and village buildings keep up with farms worth millions and billions.
-- Village buildings go to level 20 (the Moon Shrine stays at 9), each level ~2.2x the last, so the top levels cost
-- billions and a village has something to build towards for a long time.
update public.village_building_defs set max_level = 20, growth = 2.2 where id <> 'shrine';
update public.village_building_defs set growth = 2.2 where id = 'shrine';

-- a boss share grows with what your farm is worth (the same rule as chores and daily gifts: x max(1, (value/20000)^0.8))
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
  select greatest(1, power(greatest(0, coalesce(f.value, 0))::numeric / 20000, 0.8)) into mult from public.farms f where f.user_id = auth.uid();
  c := round((rw->>'coins')::numeric * coalesce(mult, 1));
  insert into public.farm_grants (user_id, kind, coins, xp, ref)
    values (auth.uid(), 'raid', greatest(0, c), greatest(0, (rw->>'xp')::int), rw->>'raid_id') returning id into gid;
  return rw || jsonb_build_object('coins', c, 'grant', gid);
end $$;
