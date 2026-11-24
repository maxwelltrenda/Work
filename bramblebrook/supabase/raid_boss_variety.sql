-- Applied to the Bramblebrook project on 2026-11-24 as migration "raid_boss_variety".
-- The four bosses differ: easy, leans on Might, leans on Magic, hard and best paid. Numbers are per neighbour per phase.
create or replace function public.raid_set_phase_numbers(p_phases jsonb, p_might int, p_magic int) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_agg(jsonb_set(jsonb_set(p, '{might}', to_jsonb(p_might)), '{magic}', to_jsonb(p_magic)) order by i)
  from jsonb_array_elements(p_phases) with ordinality as e(p, i);
$$;
update public.raid_boss_defs set phases = public.raid_set_phase_numbers(phases, 85, 85), coin_per_action = 12, victory_bonus = 300 where id = 'bramble_wyrm';
update public.raid_boss_defs set phases = public.raid_set_phase_numbers(phases, 115, 85), coin_per_action = 12, victory_bonus = 450 where id = 'stone_colossus';
update public.raid_boss_defs set phases = public.raid_set_phase_numbers(phases, 85, 115), coin_per_action = 12, victory_bonus = 450 where id = 'frost_wolf';
update public.raid_boss_defs set phases = public.raid_set_phase_numbers(phases, 135, 135), coin_per_action = 14, victory_bonus = 800 where id = 'storm_tortoise';
revoke all on function public.raid_set_phase_numbers(jsonb, int, int) from public, anon, authenticated;
