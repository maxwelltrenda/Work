-- Applied to the Bramblebrook project on 2026-11-24 as migration "raid_scale_small_villages".
-- Villages are 2-3 neighbours for now: a boss is sized to the village's real head count (no minimum of 3),
-- and each neighbour's share is about 40 attacks over the two days (a few visits each). Bigger, stronger
-- bosses can be added later as new rows, for bigger villages.
update public.raid_boss_defs set phases = (
  select jsonb_agg(jsonb_set(jsonb_set(p, '{might}', to_jsonb(round((p->>'might')::numeric * 2 / 3))), '{magic}', to_jsonb(round((p->>'magic')::numeric * 2 / 3))) order by i)
  from jsonb_array_elements(phases) with ordinality as e(p, i));
-- start_raid: scale = greatest(1, neighbours) instead of greatest(3, neighbours); see village_raids.sql for the rest.
