"""The village boss ladder: ten tiers, lowest to highest. Run it to rebuild what the ladder needs:

  python3 tools/boss_ladder.py art <dir with the Near Mint sheets>   ->  assets/boss.webp
  python3 tools/boss_ladder.py sql                                   ->  supabase/boss_ladder_seed.sql

Tier 1 is the first four bosses (already in the database; their art is kept from the existing strip). Tiers 2-10
have three bosses each, lowest first; a tier opens when the village has beaten every boss in the tier below.
Pictures are Near Mint enemy cards (Max's own card game); each Near Mint "full" sheet is 1920x1600, a 6x5 grid of
320px card arts (https://near-mint-maxwelltrendas-projects.vercel.app/art/full/<set>-f<n>.webp).

Numbers: tier t's easiest boss asks each neighbour for 2028 x 1.68^(t-1) damage in all (the Storm Tortoise asks
2028), the next two 12% and 25% more. A boss's phases grow toward the end. Coins per attack grow 1.5x a tier,
the victory bonus 1.68x. Tiers 2-5 run 48 hours, 6-8 60, 9-10 72.
"""
import json, os, sys

TIERS = [
    (1, 'The Valley', 'Trouble close to home: the mill, the quarry, the pond and the cove.', 0.30, 4),
    (2, 'The Wild Woods', 'Past the Mossy Woods the trees get older, and so do the things that live under them.', 0.26, 5),
    (3, 'The Old Forest', 'Deep in the woods the trees are older than the valley, and they remember everything.', 0.22, 6),
    (4, 'The Deep Caves', 'Below the bottom of the Mine there are caves nobody has mapped.', 0.19, 7),
    (5, 'The Fire Below', 'Deeper still, the rock gets warm, then hot, then it glows.', 0.16, 8),
    (6, 'The Far Shore', 'Out past the cove, where the rocks go down into deep water.', 0.13, 9),
    (7, 'The Open Sea', 'Beyond the last island the water is deep enough to hide anything.', 0.11, 10),
    (8, 'The Snowfields', 'Above the highlands the snow never melts and the wind never stops.', 0.09, 12),
    (9, 'The Storm Peaks', 'Where the mountains stab the clouds and the thunder lives.', 0.07, 14),
    (10, 'The Roof of the World', 'The highest place there is. Only the oldest and strongest live here.', 0.05, 16),
]  # (tier, name, blurb, chance a win drops a piece of the tier's gear, the win that is sure to)

# (id, name, tier, art sheet code, lean, blurb, [(phase name, text), ...])
B = [
 ('thornback_boar', 'The Thornback Boar', 2, 'deep1-8', 'might', 'A boar the size of a hay cart has been tearing up the orchard rows at night, and nothing will stand in its way.', [
   ('Tracks in the Orchard', 'Hoofprints as wide as buckets lead into the trees. Head it off before the orchard is ruined.'),
   ('The Charge', 'It comes crashing through the hedges. Stand firm and strike as it passes.'),
   ('Cornered in the Bracken', 'Backed into the ferns, it lowers those great tusks. Finish it!')]),
 ('hollow_oak_bear', 'The Old Bear of Hollow Oak', 2, 'deep1-0', 'even', 'The oldest bear in the woods has woken hungry, and it has found the beehives.', [
   ('Honey on the Wind', 'It sniffs out every hive in the valley. Draw it away from the bees.'),
   ('The Swipe', 'One paw flattens a fence. Keep your distance and keep hitting.'),
   ('Back to the Hollow', 'It turns for its den in the old oak. One last push before it hides.')]),
 ('moss_troll', 'The Moss Troll', 2, 'best5-12', 'magic', 'Something big and green and covered in moss has moved in under the old bridge, and it wants a toll.', [
   ('The Toll', 'It blocks the bridge and holds out a huge mossy hand. Nobody pays.'),
   ('Moss and Mud', 'It hurls clods of mud and moss. Dry it out with fire and sun.'),
   ('Regrowing', 'Every cut grows back green. Burn the moss before it heals.'),
   ('Off the Bridge', 'Knock it into the stream and the bridge is yours again!')]),
 ('weeping_willow', 'The Weeping Willow', 3, 'best5-6', 'magic', 'A willow by the black pool has started walking, and wherever it goes the flowers droop.', [
   ('The Drooping Fields', 'Its branches trail over the crops and they wilt. Cut it back.'),
   ('Tears of Sap', 'It weeps a sticky sap that holds you fast. Break free and strike.'),
   ('Roots in the Pool', 'It sinks its roots into the black pool. Pull it out before it takes hold.')]),
 ('antler_king', 'The Antler King', 3, 'best5-5', 'might', 'A great stag with a crown of antlers rules the deep forest, and it has decided the valley is part of its kingdom.', [
   ('The Herald', 'Its call echoes through the trees and every deer in the forest answers.'),
   ('The Crown of Antlers', 'It lowers its crown and charges. Catch the antlers and hold!'),
   ('The Forest Rises', 'Vines and branches rise to defend their king. Cut your way through.')]),
 ('greatwood', 'The Greatwood', 3, 'deep5-0', 'even', 'The oldest tree in the forest has pulled up its roots and is walking toward the farms, one slow step a day.', [
   ('The Ground Shakes', 'Every step it takes cracks the earth. Slow it down at the forest edge.'),
   ('Falling Leaves', 'Leaves as big as doors come spinning down. Shelter the village and strike back.'),
   ('Roots Like Rivers', 'Its roots burst up through the fields. Hack them back before they reach the farms.'),
   ('The Heartwood', 'A golden light glows deep in its trunk. Aim for the heart of the forest!')]),
 ('cave_weaver', 'The Cave Weaver', 4, 'holl0-23', 'might', 'Miners keep finding their tunnels sealed with silk as thick as rope. Something down there is weaving.', [
   ('Silk in the Tunnels', 'Every passage is webbed shut. Cut a way through.'),
   ('Eyes in the Dark', 'Eight eyes shine in the lantern light. Keep your lights high and strike.'),
   ('The Great Web', 'It waits at the heart of its web. Bring it down!')]),
 ('great_burrower', 'The Great Burrower', 4, 'holl0-9', 'magic', 'A worm as long as the village street is chewing through the rock under the fields, and the wells are running dry.', [
   ('The Rumbling', 'The ground hums and the wells go dry. Find where it is digging.'),
   ('It Surfaces', 'It bursts up through the cellar floors. Drive it back down!'),
   ('Deep Tunnel', 'Follow it into the dark and finish it at the bottom.')]),
 ('amethyst_golem', 'The Amethyst Golem', 4, 'deep1-15', 'even', 'In a cave full of purple crystal, the crystal stood up.', [
   ('A Glittering Cave', 'Every crystal hums with light. Find the one that moves.'),
   ('Shards', 'It sheds razor shards with every swing. Shield up and keep striking.'),
   ('Crystal Light', 'It flares so bright you can barely see. Strike at the glow.'),
   ('The Core', 'Its heart is one perfect gem. Crack it!')]),
 ('ember_salamander', 'The Ember Salamander', 5, 'best4-5', 'magic', 'A salamander made of living fire has climbed up from the deep, and the Mine is too hot to work.', [
   ('Heat in the Tunnels', 'The air shimmers and the walls are hot to touch. Douse the flames.'),
   ('Tail of Fire', 'It lashes a tail of flame through the dark. Dodge and strike.'),
   ('Back to the Fire', 'It flees for the lava. Cut it off before it gets home.')]),
 ('magma_golem', 'The Magma Golem', 5, 'best4-18', 'might', 'Something made of cooling lava has started pounding on the walls at the bottom of the Mine.', [
   ('Knocking', 'Deep, slow knocks from below. Then the wall breaks.'),
   ('Molten Fists', 'Its fists drip burning rock. Crack its crust while it cools.'),
   ('The Glow Rises', 'It heats up again, brighter and angrier. Keep at it!'),
   ('Stone Cold', 'Cool it down for good and the Mine is safe again.')]),
 ('hoard_dragon', 'The Hoard Dragon', 5, 'deep2-24', 'even', 'At the very bottom of the world a golden dragon sleeps on a mountain of treasure. Somebody woke it.', [
   ('A Hill of Gold', 'The treasure shifts and breathes. It is not a hill.'),
   ('Wings in the Dark', 'It spreads its wings and fills the cavern. Hold your ground.'),
   ('Dragonfire', 'Fire pours through the tunnels. Shield the miners and strike back.'),
   ('Guarding the Hoard', 'It coils around its gold and will not move. Pry it loose!'),
   ('The Last Flame', 'One last roar shakes the whole Mine. Finish it!')]),
 ('crab_king', 'The Crab King', 6, 'belo0-17', 'might', 'A crab as big as a fishing boat has claimed the beach, and it pinches anyone who comes near.', [
   ('Claws on the Sand', 'It scuttles sideways along the tideline, snapping at everything.'),
   ('The Shell', 'Its shell turns every blow. Find the gaps!'),
   ('Low Tide', 'Stranded by the tide, it is slow at last. Strike now!')]),
 ('tidecaller', 'The Tidecaller', 6, 'belo4-13', 'magic', 'A figure made of seawater walks out of the waves with a trident, and the tide follows it.', [
   ('The Sea Rises', 'The tide comes in and keeps coming. Hold back the water.'),
   ('Waves on Command', 'It raises a wave higher than the watchtower. Break it!'),
   ('The Trident', 'Lightning crackles along its trident. Disarm it.'),
   ('Back into the Sea', 'Without its trident it is only water. Drive it back into the waves!')]),
 ('sea_serpent', 'The Sea Serpent', 6, 'broo0-28', 'even', 'Fishermen have seen a long blue back rolling in the bay. Now it has coiled around the jetty.', [
   ('Coils in the Bay', 'Its long body loops through the water. Find its head.'),
   ('Squeeze', 'It tightens around the jetty and the timbers groan. Make it let go!'),
   ('The Bite', 'It strikes like lightning from the water. Stand firm.'),
   ('Rising Tide', 'It drags the tide up the beach with it. Hold the line.'),
   ('Into the Deep', 'It dives for deep water. One last strike before it goes!')]),
 ('wandering_isle', 'The Wandering Isle', 7, 'broo2-29', 'might', 'An island drifted into the bay overnight. It has a castle on it, and it is blinking.', [
   ('Land Ho', 'A new island sits in the bay. Then it moves.'),
   ('The Castle on its Back', 'Things live in the old castle, and they are not friendly. Clear them out.'),
   ('It Dives', 'It starts to sink, castle and all. Strike before it is gone!')]),
 ('leviathan', 'The Leviathan', 7, 'deep3-0', 'magic', 'A sea dragon longer than the village has surfaced off the point, and its wake swamps the boats.', [
   ('A Shadow Under the Boats', 'Something huge passes under the fishing fleet. Get the boats home.'),
   ('Rising', 'It rises out of the sea, scales streaming. Strike at its belly.'),
   ('The Whirlpool', 'It circles until the sea turns into a whirlpool. Hold on and fight.'),
   ('Back to the Depths', 'Wounded, it sinks away. Make sure it never comes back.')]),
 ('kraken', 'The Kraken', 7, 'holl0-13', 'even', 'Out at sea the water boiled, and then the arms came up. Dozens of them.', [
   ('Arms from the Deep', 'Huge arms reach out of the water and grab at the boats.'),
   ('Ink', 'The sea goes black with ink. Fight by lantern light.'),
   ('Crushing Grip', 'It drags the jetty toward the deep. Cut it free!'),
   ('The Eye', 'One great eye opens beneath the waves. Aim for it!'),
   ('Sinking Down', 'It lets go at last. Drive it back into the dark!')]),
 ('snow_yeti', 'The Snow Yeti', 8, 'broo5-20', 'might', 'Huge footprints in the snow, and the sheep keep going missing.', [
   ('Footprints', 'They lead up the mountain, and they are getting bigger.'),
   ('The Avalanche', 'It roars and the snow slides. Dig out and fight back.'),
   ('In its Cave', 'Corner it in its ice cave and finish it.'),
   ('The Long Howl', 'It howls until the mountain shakes. Hold steady!')]),
 ('ice_wyrm', 'The Ice Wyrm', 8, 'deep3-8', 'magic', 'A dragon of blue ice has frozen the mountain pass, and nobody can get through.', [
   ('The Frozen Pass', 'The road is a wall of ice. Melt a way through.'),
   ('Frost Breath', 'It breathes a blizzard. Keep the fires burning.'),
   ('Ice Armour', 'It grows armour of ice over every wound. Break it!'),
   ('The Thaw', 'Melt its heart and the pass is open again.'),
   ('Meltwater', 'It crumbles into the river. Make sure it stays there.')]),
 ('frost_giant', 'The Frost Giant', 8, 'broo5-18', 'even', 'A giant made of ice and old snow has come down from the peaks with a spear as long as a tree.', [
   ('Giant Steps', 'Each step leaves a frozen crater. Stop it before it reaches the farms.'),
   ('The Spear', 'It hurls its spear and the ground cracks. Dodge!'),
   ('Winter Comes', 'Everything it touches freezes. Warm the village and fight on.'),
   ('Kneeling Giant', 'Bring it to its knees with everything you have.'),
   ('The Melt', 'It starts to melt into the snow. One last blow!')]),
 ('storm_griffin', 'The Storm Griffin', 9, 'apex1-8', 'might', 'A griffin with feathers like storm clouds nests on the highest crag, and it hunts by lightning.', [
   ('Shadow in the Clouds', 'Something circles above the peaks. Then it dives.'),
   ('Talons', 'It swoops at anyone on the high paths. Strike as it passes.'),
   ('The Nest', 'Climb to its nest above the clouds.'),
   ('Grounded', 'Clip its wings and bring it down!')]),
 ('storm_drake', 'The Storm Drake', 9, 'best2-23', 'magic', 'A blue dragon crackling with lightning rides the storms over the peaks, and the storms are getting closer.', [
   ('Thunder on the Peaks', 'The storm rolls closer every hour. Get ready.'),
   ('Lightning', 'It calls lightning down on the valley. Ground it!'),
   ('The Eye of the Storm', 'Fight it in the calm heart of the storm.'),
   ('Sky on Fire', 'The clouds crackle from end to end. Keep your heads down and strike.'),
   ('The Storm Breaks', 'Drive it off and let the sun back in!')]),
 ('thunder_giant', 'The Thunder Giant', 9, 'belo5-17', 'even', 'A giant in armour that rings like thunder has come to claim the peaks, and the whole mountain shakes.', [
   ('The Mountain Shakes', 'Every blow of its hammer shakes loose a rockslide.'),
   ('Thunder Armour', 'Its armour sparks with every hit. Find the gaps.'),
   ('The War Cry', 'It roars and the clouds split. Hold steady.'),
   ('Hammer Down', 'It brings its hammer down on the pass. Stop it!'),
   ('Fallen Thunder', 'Bring the giant down and the storm goes with it.')]),
 ('elder_phoenix', 'The Elder Phoenix', 10, 'deep4-4', 'magic', 'A bird of living fire has lit up the sky over the peaks. Every time it falls, it rises again.', [
   ('A Second Sun', 'The sky glows red over the mountains. Something is burning up there.'),
   ('Wings of Fire', 'It sweeps over the peaks and the snow turns to steam.'),
   ('Ashes', 'It falls in a heap of ashes. Then the ashes stir.'),
   ('Reborn', 'It rises again, brighter than before. Strike faster!'),
   ('The Last Ember', 'Put out its last ember before it can rise again!')]),
 ('sky_titan', 'The Sky Titan', 10, 'broo5-17', 'might', 'On the very top of the world stands a giant so tall its head is in the clouds. It has noticed the valley.', [
   ('Above the Clouds', 'A shadow falls across the whole valley.'),
   ('The Spear of the Sky', 'It hurls a spear that splits a mountain. Shield the village!'),
   ('Climbing the Titan', 'Climb its armour and strike where it cannot reach.'),
   ('The Titan Stumbles', 'It sways on the edge of the world. Push!'),
   ('The Long Fall', 'Bring the titan down from the roof of the world!')]),
 ('white_dragon', 'The White Dragon', 10, 'holl3-0', 'even', 'The oldest dragon of all sleeps on the roof of the world. When it wakes, winter comes to every valley at once.', [
   ('The Long Winter', 'Snow falls in summer. Something old is waking.'),
   ('Wings Over the Valley', 'It flies over every farm and the fields freeze. Hold on.'),
   ('Frost and Fury', 'It lands on the peaks and the mountain shakes. Climb to meet it.'),
   ('The Dragon Speaks', 'Its voice rolls like an avalanche. Do not listen. Strike!'),
   ('Scales Like Glaciers', 'Its scales turn every blade. Find the soft places.'),
   ('The Breath of Winter', 'It breathes the whole of winter at the valley. Stand together!'),
   ('Spring Returns', 'One last push, and the sun comes back to the valley.')]),
]
SHEET = {'best': 'bestiary', 'deep': 'deepdark', 'broo': 'broodlands', 'belo': 'below', 'holl': 'hollow', 'apex': 'apex'}
KEEP = 4   # art 0-3 are the tier 1 bosses, kept from the existing strip


def numbers(tier, pos, phases, lean):
    total = 2028 * 1.68 ** (tier - 1) * (1, 1.12, 1.25)[pos]
    share = {'might': 0.57, 'magic': 0.43, 'even': 0.5}[lean]
    w = [1 + 0.3 * i for i in range(phases)]
    out = []
    for wi in w:
        part = total * wi / sum(w)
        out.append((int(round(part * share / 10) * 10), int(round(part * (1 - share) / 10) * 10)))
    coin = round(12 * 1.5 ** (tier - 1) * (1 + 0.1 * pos))
    bonus = int(round(300 * 1.68 ** (tier - 1) * (1 + 0.15 * pos) / 10) * 10)
    hours = 48 if tier <= 5 else 60 if tier <= 8 else 72
    return out, coin, bonus, hours


def art(src):
    from PIL import Image
    here = os.path.join(os.path.dirname(__file__), '..', 'assets', 'boss.webp')
    old = Image.open(here).convert('RGB')
    out = Image.new('RGB', (320 * (KEEP + len(B)), 320))
    for i in range(KEEP):
        out.paste(old.crop((i * 320, 0, i * 320 + 320, 320)), (i * 320, 0))
    for j, b in enumerate(B):
        code = b[3]; f, k = code[4:].split('-'); k = int(k)
        im = Image.open(os.path.join(src, f'{SHEET[code[:4]]}-f{f}.webp')).convert('RGB')
        c, r = k % 6, k // 6
        out.paste(im.crop((c * 320, r * 320, c * 320 + 320, r * 320 + 320)), ((KEEP + j) * 320, 0))
    out.save(here, quality=80, method=6)
    print(out.size, os.path.getsize(here))


def q(s):
    return "'" + s.replace("'", "''") + "'"


def sql():
    lines = ['-- Generated by tools/boss_ladder.py: the ten tiers and the bosses of tiers 2-10. Safe to run again.']
    lines.append('insert into public.raid_tiers (tier, n, blurb, drop_chance, pity) values')
    lines.append(',\n'.join(f'  ({t}, {q(n)}, {q(bl)}, {ch}, {p})' for t, n, bl, ch, p in TIERS))
    lines.append('on conflict (tier) do update set n = excluded.n, blurb = excluded.blurb, drop_chance = excluded.drop_chance, pity = excluded.pity;')
    rows, pos_in = [], {}
    for j, (bid, n, tier, code, lean, blurb, ph) in enumerate(B):
        pos = pos_in[tier] = pos_in.get(tier, -1) + 1
        nums, coin, bonus, hours = numbers(tier, pos, len(ph), lean)
        phases = [{'n': pn, 'text': pt, 'might': m, 'magic': g} for (pn, pt), (m, g) in zip(ph, nums)]
        rows.append(f"  ({q(bid)}, {q(n)}, {q(blurb)}, {KEEP + j}, {hours}, {coin}, {bonus}, {q(json.dumps(phases))}::jsonb, {5 + j}, {tier})")
    lines.append('insert into public.raid_boss_defs (id, n, blurb, art, hours, coin_per_action, victory_bonus, phases, sort, tier) values')
    lines.append(',\n'.join(rows))
    lines.append('on conflict (id) do update set n = excluded.n, blurb = excluded.blurb, art = excluded.art, hours = excluded.hours, coin_per_action = excluded.coin_per_action,')
    lines.append('  victory_bonus = excluded.victory_bonus, phases = excluded.phases, sort = excluded.sort, tier = excluded.tier;')
    gear = json.load(open(os.path.join(os.path.dirname(__file__), '..', 'src', 'content', 'core.json')))['items']
    g = [(k, v) for k, v in gear.items() if v.get('t') == 'gear']
    lines.append('insert into public.raid_gear_defs (id, tier, slot, bar, raid) values')
    lines.append(',\n'.join(f"  ({q(k)}, {v['tier']}, {q(v['slot'])}, {q(v['bar'])}, {v['raid']})" for k, v in g))
    lines.append('on conflict (id) do update set tier = excluded.tier, slot = excluded.slot, bar = excluded.bar, raid = excluded.raid;')
    out = os.path.join(os.path.dirname(__file__), '..', 'supabase', 'boss_ladder_seed.sql')
    open(out, 'w').write('\n'.join(lines) + '\n')
    for (bid, n, tier, *_r) in B:
        pass
    print('wrote', out)


if __name__ == '__main__':
    if sys.argv[1] == 'art': art(sys.argv[2])
    else: sql()
