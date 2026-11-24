-- Applied to the Bramblebrook project on 2026-11-24 as migration "raid_bosses_in_order".
-- Village bosses unlock in order, smallest to largest (raid_boss_defs.sort): a village must beat boss 1 before it
-- can summon boss 2, and so on. start_raid refuses a locked boss; raid_status lists what the village has beaten
-- ("beaten") so the game can show the ladder. Beaten bosses can be summoned again.
create or replace function public.raid_beaten(p_village uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(distinct r.boss), '[]'::jsonb) from public.village_raids r where r.village_id = p_village and r.status = 'won';
$$;
revoke all on function public.raid_beaten(uuid) from public, anon, authenticated;

-- start_raid: after "Unknown boss", before taking the village lock:
--   select * into prev from public.raid_boss_defs where sort < d.sort order by sort desc limit 1;
--   if prev.id is not null and not exists (select 1 from public.village_raids where village_id = v and boss = prev.id and status = 'won') then
--     raise exception 'Beat % first. Bosses unlock one at a time.', prev.n;
--   end if;
-- raid_status: adds 'beaten', public.raid_beaten(v) to its answer.
-- (Full function bodies as applied are in the migration; the rest of both is unchanged from village_raids.sql.)
