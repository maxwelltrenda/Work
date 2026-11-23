#!/usr/bin/env python3
"""Builds assets/atlas.png and src/content/art.json from the Hearthhold art packs.

Usage:  python3 tools/build_atlas.py /path/to/hearthhold/art/packs

Every picture becomes a 32x32 cell (crop growth stages are 32x64, two cells tall).
16px art is doubled and the 160px "high-res" crop files are brought down to 16px first,
all with nearest-neighbour scaling so the pixels stay crisp. Items not listed here
keep their emoji in the game. Run it again after adding art; commit both outputs.
"""
import json
import os
import sys
from PIL import Image

PACKS = sys.argv[1] if len(sys.argv) > 1 else '/home/user/hearthhold/art/packs'
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

CROP = 'crops-seeds-signs-items/high-res {} item.png'
STAGE = 'crops-seeds-signs-items/high-res {} crop stage {}.png'
FISH = 'icons-fishing-and-sea/16x16/{}.png'
ORE = 'icons-tools-and-ore/Icons/Icons_27_{:02d}.png'
MINE = 'icons-mining/PNG/Transperent/Icon{}.png'
HOUSE = 'icons-household/Icons/Icon_37_{:02d}.png'
MEAT = 'icons-meat-and-hides/Icons/Iicon_31_{:02d}.png'
WATER = 'watering-tools/high-res {}.png'
FOLK = 'nine-realms-midgard-villagers-v3/png/16x16/{}/!${}v3.png'

# game crop id -> art crop name
CROPS = {
    'wheat': 'wheat', 'carrot': 'carrot', 'potato': 'potato', 'turnip': 'turnip', 'lettuce': 'lettuce',
    'cabbage': 'red cabbage', 'beetroot': 'beetroot', 'tomato': 'tomato', 'garlic': 'garlic',
    'corn': 'corn', 'greenbeans': 'green beans', 'onion': 'red onion', 'strawberry': 'strawberry',
    'broccoli': 'broccoli', 'cucumber': 'zucchini', 'cauliflower': 'cauliflower', 'pepper': 'hot pepper',
    'leek': 'leek', 'pumpkin': 'pumpkin', 'asparagus': 'aspargus', 'sunflower': 'sunflower',
    'redpepper': 'red pepper', 'eggplant': 'eggplant', 'celery': 'celery', 'grapes': 'blackberry',
    'moonbloom': 'sunflower',
}

# item id -> (source, css filter or None)
ITEMS = {
    'berries': (CROP.format('rasberry berry'), None),
    'pebble': (ORE.format(42), None), 'wood': (ORE.format(31), None), 'driftwood': (ORE.format(34), 'grayscale(.5) brightness(1.2)'),
    'clay': (ORE.format(33), None), 'feather': (MEAT.format(97), None), 'eaglefeather': (MEAT.format(88), None),
    'sap': (HOUSE.format(89), None), 'shell': (FISH.format(58), None), 'starfish': (FISH.format(54), None),
    'seaglass': (ORE.format(82), None), 'egg': (MEAT.format(84), None), 'milk': (HOUSE.format(38), None),
    'wool': (MEAT.format(66), 'grayscale(1) brightness(1.45)'),
    'copper': (ORE.format(58), None), 'coal': (ORE.format(13), 'brightness(.55)'), 'iron': (ORE.format(43), None),
    'silver': (ORE.format(67), 'grayscale(.6) brightness(1.1)'), 'gold': (ORE.format(51), None),
    'obsidian': (ORE.format(74), 'brightness(.6)'), 'fossil': (MINE.format(24), None), 'crystal': (ORE.format(96), None),
    'amethyst': (ORE.format(71), None), 'emerald': (ORE.format(76), None), 'ruby': (ORE.format(90), None),
    'starshard': (ORE.format(99), 'brightness(1.25) saturate(1.4)'),
    'worm': (FISH.format(6), None), 'lure': (FISH.format(70), None), 'glowbait': (FISH.format(88), None),
    'minnow': (FISH.format(25), None), 'perch': (FISH.format(18), None), 'carp': (FISH.format(14), None),
    'bullfrog': (FISH.format(51), None), 'sunfish': (FISH.format(15), None),
    'whiskers': (FISH.format(29), 'sepia(.9) saturate(2.2) brightness(1.1)'),
    'trout': (FISH.format(13), None), 'salmon': (FISH.format(27), None), 'catfish': (FISH.format(29), None),
    'crayfish': (FISH.format(22), None), 'eel': (FISH.format(39), None), 'pike': (FISH.format(26), None),
    'silverjaw': (FISH.format(25), 'brightness(1.45) contrast(1.2)'), 'shrimp': (FISH.format(19), None),
    'crab': (FISH.format(24), None), 'squid': (FISH.format(42), None), 'puffer': (FISH.format(36), None),
    'octopus': (FISH.format(49), None), 'bluelobster': (FISH.format(20), None), 'oyster': (FISH.format(83), None),
    'char': (FISH.format(16), None), 'grayling': (FISH.format(30), None), 'iceperch': (FISH.format(17), None),
    'ghostminnow': (FISH.format(25), 'grayscale(1) brightness(1.9)'), 'glimmerfin': (FISH.format(31), 'hue-rotate(250deg) saturate(1.8)'),
    'twine': (MINE.format(45), None), 'plank': (ORE.format(38), None), 'block': (ORE.format(14), None),
    'rope': (MINE.format(47), None), 'tonic': (HOUSE.format(90), None), 'copperbar': (ORE.format(64), None),
    'ironbar': (ORE.format(44), None), 'silverbar': (ORE.format(69), 'grayscale(.7) brightness(1.15)'),
    'goldbar': (ORE.format(54), None), 'basket': (HOUSE.format(72), None), 'crate': (ORE.format(36), None),
    'bucket': (HOUSE.format(83), None), 'lantern': (MINE.format(44), None), 'lamp': (MINE.format(42), 'hue-rotate(160deg) brightness(1.2)'),
    'bellrope': (MINE.format(47), 'hue-rotate(160deg) saturate(1.6)'),
    'sprinkler1': (WATER.format('simple copper sprinkler'), None), 'sprinkler2': (WATER.format('simple iron sprinkler'), None),
    'sprinkler3': (WATER.format('deluxe gold sprinkler'), None),
    'soup': (HOUSE.format(85), None), 'stew': (HOUSE.format(63), None), 'chowder': (HOUSE.format(57), None),
    'platter': (FISH.format(109), None), 'tea': (HOUSE.format(40), None), 'lemonade': (HOUSE.format(46), None),
    'jam': (HOUSE.format(95), None), 'feast': (HOUSE.format(80), None),
    'oldkey': (MINE.format(32), None), 'seedpouch': ('crops-seeds-signs-items/high-res sunflower seeds 1.png', 'hue-rotate(200deg)'),
}

# villager id -> (folder, file stem)
FOLKS = {
    'oakley': ('adults', 'mascAdultHuman2'), 'hazel': ('adults', 'femAdultHuman1'), 'tobin': ('elders', 'mascElderHuman2'),
    'mira': ('adults', 'femAdultHuman5'), 'clem': ('elders', 'femElderHuman3'), 'pip': ('children', 'femChildHuman1'),
    'rook': ('elders', 'mascElderHuman1'), 'ingrid': ('heroes', 'femHeroHuman1'), 'wren': ('elders', 'femElderHuman1'),
    'saffi': ('adults', 'femAdultHuman3'),
}

COLS = 16
cells = []   # (key, image 32x(32*h), h, filter)


def load(rel):
    path = os.path.join(PACKS, rel)
    if not os.path.exists(path):
        raise SystemExit(f'missing art: {path}')
    return Image.open(path).convert('RGBA')


def to32(im):
    w, h = im.size
    if w >= 160:                      # the 10x "high-res" crop/watering art
        im = im.resize((w // 10, h // 10), Image.NEAREST)
        w, h = im.size
    if w == 16:
        im = im.resize((32, h * 2), Image.NEAREST)
    return im


for gid, name in CROPS.items():
    cells.append((f'item:{gid}', to32(load(CROP.format(name))), 1, 'hue-rotate(200deg) saturate(1.5)' if gid == 'moonbloom' else None))
    for s in range(1, 5):
        # a few packs skip a stage file (green beans has no stage 1): use the nearest later stage
        rel = next(STAGE.format(name, t) for t in range(s, 5) if os.path.exists(os.path.join(PACKS, STAGE.format(name, t))))
        cells.append((f'stage:{gid}:{s}', to32(load(rel)), 2, 'hue-rotate(200deg) saturate(1.5)' if gid == 'moonbloom' else None))
for iid, (rel, flt) in ITEMS.items():
    cells.append((f'item:{iid}', to32(load(rel)), 1, flt))
for vid, (folder, stem) in FOLKS.items():
    sheet = load(FOLK.format(folder, stem))
    cells.append((f'folk:{vid}', sheet.crop((32, 0, 64, 32)), 1, None))

# pack cells: single-height first in rows, then tall cells two rows high
singles = [c for c in cells if c[2] == 1]
talls = [c for c in cells if c[2] == 2]
rows_single = (len(singles) + COLS - 1) // COLS
rows_tall = ((len(talls) + COLS - 1) // COLS) * 2
atlas = Image.new('RGBA', (COLS * 32, (rows_single + rows_tall) * 32), (0, 0, 0, 0))
index = {}
for i, (key, im, h, flt) in enumerate(singles):
    c, r = i % COLS, i // COLS
    atlas.paste(im, (c * 32, r * 32), im)
    index[key] = [c, r, 1] + ([flt] if flt else [])
for i, (key, im, h, flt) in enumerate(talls):
    c, r = i % COLS, rows_single + (i // COLS) * 2
    atlas.paste(im, (c * 32 + (32 - im.size[0]) // 2, r * 32 + (64 - im.size[1])), im)
    index[key] = [c, r, 2] + ([flt] if flt else [])

os.makedirs(os.path.join(ROOT, 'assets'), exist_ok=True)
atlas.save(os.path.join(ROOT, 'assets', 'atlas.png'), optimize=True)
with open(os.path.join(ROOT, 'src', 'content', 'art.json'), 'w') as f:
    json.dump({'cols': COLS, 'rows': rows_single + rows_tall, 'cell': 32, 'map': index}, f, separators=(',', ':'))
print(f'atlas {atlas.size}, {len(index)} pictures')
