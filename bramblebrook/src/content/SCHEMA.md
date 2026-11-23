# Bramblebrook content guide

Bramblebrook Farm is a cozy, menu-based farming RPG played on phones. This file defines the
story/people/adventure content files the engine reads. `core.json` (same folder) holds items,
crops, areas, recipes and meals: **only use item ids that exist in `core.json` → `items`.**

Run `node tools/validate.js` from the `bramblebrook/` folder after every edit. It must print `OK`.

---

## 1. World and characters (keep everyone consistent)

**Premise.** The player (unnamed; write `{name}` where a name is needed, never a gendered pronoun
for them) inherits the overgrown farm of their great-aunt **Wren Bramble**, the valley's legendary
gardener, who left eight years ago with a note: *"Gone to listen for the bell."*

The **Bramble Bell** hangs in the town square. It was cast long ago from iron that fell from the
sky. The winter Wren left, a storm cracked its clapper and it went silent. Since then the valley
has slowly dimmed: the river footbridge rotted, the old forge went cold, the mine was sealed after
a flood, the Spring Fair stopped, the lighthouse went dark, and a rockslide closed the Highland
Road. Wren's journal pages turn up across the valley. Piece by piece the player restores each
landmark, finds the pages, and finally recasts the clapper with a Star Shard from the deep mine.

**The twist.** Wren went up to the old **observatory** in the highlands to find star-iron for a
new clapper. The rockslide trapped her up there; she stayed on as the observatory's keeper,
mapping the sky and waiting. Her letters never arrived because the road was closed. Ingrid the
shepherd knew and kept her secret (Wren asked her to, until the bell could ring again). Gran
Clementine suspected. Wren is alive, sharp, funny, and comes home at the end.

**Tone.** Warm, gently funny, a little wistful. No violence, villains or romance. Mild peril only
(storms, a slippery ledge, a lost lamb). Short lines: they're read on a phone. Keep each spoken
line under ~180 characters; split longer thoughts into several lines.

**Cast (villager ids in brackets):**
- **Mayor Oakley** [`oakley`]: earnest, slightly frazzled, loves committees, minutes and town history. Says "splendid" too often.
- **Hazel Pennywhistle** [`hazel`]: runs the General Store. Cheerful, gossipy, counts everything in a ledger. Has a cat named Ledger.
- **Old Tobin** [`tobin`]: retired river ferryman and fisherman. Few words, tall tales. Collects old boots for a "boot garden".
- **Mira Ashgrove** [`mira`]: tinker in her thirties, wants to relight her grandfather's forge. Practical, dry humor, soft heart.
- **Gran Clementine** [`clem`]: the baker, in her eighties. Warm, sharp. Wren's oldest friend; knows more than she says.
- **Pip** [`pip`]: ten-year-old aspiring explorer. Draws maps, has a toad named Sir Hopsalot. Boundless enthusiasm.
- **Captain Rook** [`rook`]: lighthouse keeper who stayed after the light went out. Gruff, poetic, lonely. Met in the lighthouse adventure.
- **Ingrid** [`ingrid`]: highland shepherd. Independent, few words, kind. Met in the Highland Pass adventure. Kept Wren's secret.
- **Wren Bramble** [`wren`]: the great-aunt. Brisk, witty, unsentimental, loves her plants. Met at the end of the story.
- **Saffi**: a traveling merchant with a painted cart (not a villager id; appears in text only). Talks in bargains.

**Places:** Sunny Meadow, Mossy Woods, Willow Banks, Willow River, Lily Pond, Old Quarry, the Mine,
the old Forge, the town square and Bell, Gran's Bakery, Pennywhistle's General Store, Saltspray
Beach/Cove, the Lighthouse on the Point, the Highland Road, Windy Highlands, Highland Tarn,
the Observatory.

---

## 2. When things become available (so requests and adventures stay reachable)

Chapters complete in this order: `prologue` → `bridge` → `forge` → `mine` → `fair` → `lighthouse` → `highlands` → `bell` → `epilogue`.

| Stage | Newly available items |
|---|---|
| Start | wheat, carrot, potato (Farming 2), cabbage (3); meadow: pebble, wildflower, clover, worm, feather, honeycomb (rare); pond fish: minnow, perch, snail, carp, bullfrog, sunfish, boot; crafts: twine, block, rope, bouquet, candle |
| Foraging 3 (early) | woods: wood, mushroom, acorn, berries, sap, fern, goldacorn (rare); crafts: plank, tonic |
| after `prologue` | egg (chickens) |
| after `bridge` | river fish: trout, salmon, catfish, crayfish, eel, pike, compass; banks: reed, clay; Foraging 5 quarry: copper, coal, iron, fossil, amethyst; crops tomato, garlic, corn |
| after `forge` | copperbar, nails, ironbar, basket, lure, sprinkler1, crate, bucket; milk (cows); crops onion, strawberry |
| during `mine` | mine floors 1-19: crystal, glowcap, silver; silverbar, lens, lantern, scarecrow |
| after `fair` | all meals (kitchen); orchard fruit: apple, pear, cherry; the merchant |
| after `lighthouse` | cove fish: shrimp, crab, squid, puffer, octopus, bluelobster, oyster; beach: shell, driftwood, seaweed, starfish, seaglass; chime, necklace; more honeycomb (bees) |
| after `highlands` | highlands: wool, thyme, heather, eaglefeather, oldcoin; tarn fish: char, grayling, iceperch, ghostminnow; mine 20+: gold, obsidian, emerald, ruby, goldbar; yarn, bellrope, ring, lamp |
| during `bell` | starshard (mine floor 25+), clapper |
| after `bell` | moonbloom |

**Pacing.** Levels follow `core.xpCurve`: the XP from level *l* to *l*+1 is `base × l^exp` (base 20, exp 2.15), capped at level 60. Each crop has its own grow time, from 1 minute (wheat) to a day (watermelon), so there is always a crop that fits the time until your next visit; XP, seed cost and sale price grow with minutes^0.8 (`core.cropCurve`, applied by the crop ladder script, and `core.growScale` stays 1). Crops unlock across Farming 1–33 (see `core.crops` for the current levels; the crop levels in the table above predate this). Targets for a player visiting 4 times a day for 10 minutes: the story in about a month (measured at about 25 days; about 9 for someone checking in hourly), the last crop around day 87 (about 44 for an hourly player), and a skill at 60 well over a year. Deep mine floors past 30 pay a flat bonus so the endless mine cannot run away with Mining. Story steps lean on grind: a level goal in most chapters and deliveries in the tens.

Legendary fish (very rare): whiskers (pond), silverjaw (river), mossback (cove), glimmerfin (tarn).
Keepsake (`t: "key"`) items for story use only: oldkey, wrenmap, locket, telescope, seedpouch, fairribbon, logbook.

---

## 3. Shared building blocks

**Line** (dialogue): `{ "who": "<villager id | you>", "say": "..." }`. Omit `who` for narration.
`{name}` is replaced with the player's name.

**Lines** = an array of Line. A scene may end with an optional flavor choice:
`{ "choices": [ { "t": "Button text", "reply": [Line, ...] } ] }` (no gameplay effect).

**Give** (rewards; every key optional):
```json
{ "coins": 100, "items": { "wool": 5 }, "xp": { "foraging": 40 }, "friend": { "pip": 30 },
  "page": 3, "flag": "met_rook", "stamina": 10, "buff": "lucky", "plots": 1,
  "animals": { "chicken": 2 }, "unlock": "mine" }
```
`flag`/`unlock` may be a string or array of strings. `buff` is one of lucky, steady, refreshed, miner, greenthumb (lasts 15 min).
Skills: farming, fishing, foraging, mining, crafting, cooking.

**Cost** (paid when a choice is taken): `{ "coins": 50, "items": { "rope": 1 }, "stamina": 5 }`.

**Req** (all keys optional, all must hold):
```json
{ "items": { "rope": 1 }, "skill": { "fishing": 8 }, "flag": "met_rook", "noflag": "x",
  "chapter": "forge", "started": "fair", "coins": 100 }
```
`chapter` = that chapter is finished. `started` = that chapter has begun (or is finished).

**Roll** (a chance check on a choice): `{ "skill": "foraging", "base": 0.5, "per": 0.02, "max": 0.95 }`
→ success chance = min(max, base + per × skill level). Success goes to `go`, failure to `fail`.

---

## 4. `story.json`

```json
{
  "chapters": [
    {
      "id": "bridge", "n": "The Footbridge", "blurb": "One sentence teaser.",
      "intro": [Line...], "outro": [Line...],
      "steps": [ Step, ... ],
      "give": Give
    }
  ],
  "pages": [ { "n": 1, "title": "...", "text": "Wren's journal entry. 60-140 words. Paragraphs split with \n\n." } ],
  "letters": [ { "id": "l_hazel_welcome", "from": "hazel", "subject": "...", "body": "...", "when": When, "give": Give } ]
}
```

**Step** (always has `type` and `t`, the objective shown to the player, e.g. "Bring 15 planks to Mayor Oakley"):
- `{ "type": "talk", "to": "oakley", "scene": [Line...] }` → player taps Talk; the scene plays.
- `{ "type": "deliver", "to": "oakley", "want": { "plank": 15 }, "scene": [Line...] }` → items are taken.
- `{ "type": "gather", "item": "minnow", "n": 3 }` → counts new items obtained after the step starts.
- `{ "type": "stat", "stat": "explores|harvested|fish|crafted|cooked|digs|collected|delivered", "n": 10 }` → counted from step start.
- `{ "type": "level", "skill": "foraging", "lvl": 3 }`
- `{ "type": "mine", "floor": 10 }` → deepest mine floor reached.
- `{ "type": "adventure", "id": "fair_night" }` → that adventure finished with a win.
Any step may carry `"scene"` (played when it completes) and `"give"`.

**When** (letters): `{ "chapter": "forge" }`, `{ "started": "fair" }`, `{ "day": 3 }` (days since the farm began),
`{ "hearts": { "pip": 4 } }` or `{ "flag": "met_rook" }`.

---

## 5. `people.json`

```json
{
  "villagers": [
    {
      "id": "hazel", "n": "Hazel Pennywhistle", "short": "Hazel", "role": "Runs the General Store",
      "mono": "HP", "h": 40, "req": {},
      "loves": ["..."], "likes": ["..."], "dislikes": ["..."],
      "greet": ["5-8 short daily greetings"],
      "thanks": { "loved": "...", "liked": "...", "neutral": "...", "disliked": "..." },
      "requests": [ { "say": "...", "want": { "wheat": 10 }, "give": Give, "req": Req } ],
      "hearts": [ { "at": 2, "title": "...", "scene": [Line...] }, { "at": 5, ... }, { "at": 8, ... } ]
    }
  ],
  "merchant": { "greet": ["Saffi lines"], "sold": ["..."], "bought": ["..."] }
}
```
`h` is a hue 0-360 for their portrait color. `req` controls when they appear in town (e.g. `{ "flag": "met_rook" }`).
Requests are shown in order; one is active at a time; `req` gates a request until reachable (use the table in section 2).

---

## 6. `adventures.json`

```json
{
  "adventures": [
    {
      "id": "fair_night", "n": "Night of the Fair", "where": "town", "blurb": "...",
      "req": Req, "start": "a",
      "nodes": {
        "a": { "who": "pip", "say": "...", "ch": [ Choice, ... ] },
        "win": { "say": "...", "end": "win", "give": Give },
        "lose": { "say": "...", "end": "lose" }
      }
    }
  ],
  "encounters": [
    { "id": "lost_hen", "where": ["meadow"], "weight": 10, "once": false, "req": Req, "start": "a", "nodes": { ... } }
  ]
}
```
**Node**: `say` (string, `\n\n` for paragraph breaks), optional `who`, then either `ch` (1-4 choices) or `end` ("win"/"lose").
Any node may have `give` (applied when the node is reached).
**Choice**: `{ "t": "Button text", "go": "nodeId", "req": Req, "cost": Cost, "roll": Roll, "fail": "nodeId", "give": Give }`.
A choice whose `req` isn't met shows as disabled with the reason. A `roll` needs a `fail` node.
`where` for adventures: an area id (meadow, woods, banks, quarry, beach, highlands), "mine", "river", "pond", "cove", "tarn", "town", "farm".
Encounters trigger at random while exploring their `where` areas (or "mine" while digging).

---

## 7. Tabletop layer (dice, companions, creatures, delves)

**Dice checks.** A choice's `roll` is now shown as a d20 skill check. `base` sets the difficulty:
DC = 21 − 20 × base (base 0.5 → DC 11, 0.35 → DC 14, 0.65 → DC 8). The player adds +1 per 3 skill
levels, +2 for their background skill, and charm bonuses. A companion whose specialty matches the
check gives **advantage** (roll twice, keep the higher). Natural 20 always succeeds (a critical:
bonus coins and an Inspiration point). Natural 1 always fails, with a gentle comic line.

New **Give** keys: `"inspiration": 1` (add Inspiration, max 3), `"befriend": "<creature id>"` (logs a
creature in the bestiary). Charm items (ids starting `charm_`, `t: "charm"` in core.json) are rare
wearable rewards: give them sparingly (crits, delve wins, befriending).
New **Req** key: `"companion": "<villager id>"` (choice only available if that villager came along).

**Charms in core.json:** charm_clover, charm_acorn, charm_compass, charm_thimble, charm_spoon,
charm_lantern, charm_ribbon, charm_hook, charm_boots, charm_whistle, charm_feather, charm_bell,
charm_trowel, charm_worry, charm_moss, charm_starglass (the last is the bestiary completion prize;
don't give it).

## 8. `bestiary.json`

```json
{ "creatures": [ { "id": "moss_sprite", "n": "Moss Sprite", "i": "🌿", "where": ["woods"],
    "blurb": "One-line almanac entry.", "lore": "2-3 sentence almanac entry, revealed once befriended." } ],
  "encounters": [ { "id": "meet_moss_sprite", "creature": "moss_sprite", "where": ["woods"], "weight": 6,
    "once": true, "req": Req, "start": "a", "nodes": { ... } } ] }
```
Gentle creatures only: no monsters to fight. Each creature gets exactly one encounter; its win node
must give `"befriend": "<id>"`. Befriending is by kindness, cleverness, gifts or patience (use
checks, item costs and companion-only choices). `where` uses area ids or "mine"; respect the unlock
timeline. `i` is an emoji used as the creature's picture.

## 9. `delves.json`

```json
{ "delves": [ { "id": "delve_5", "floor": 5, "n": "The Old Pump Room", "blurb": "...", "start": "a", "nodes": { ... } } ] }
```
A delve is a short adventure (6-10 nodes) that opens the first time the player reaches that mine
floor. Same node/choice format as adventures; mild peril, puzzles, sealed doors, sleeping animals,
old miners' stories. Use mining/foraging/crafting checks. Wins give ore, gems, coins and sometimes a charm.

## 10. `companions.json`

```json
{
  "companions": { "tobin": { "skills": ["fishing"], "join": "...", "cheer": ["..."], "oops": ["..."], "win": "..." } },
  "inn": { "n": "The Lantern & Ladle", "keeper": "Tess Marlow", "role": "...", "greet": ["..."], "rumors": ["..."] },
  "crit": { "farming": ["..."], "fishing": ["..."], "foraging": ["..."], "mining": ["..."], "crafting": ["..."], "cooking": ["..."] },
  "fumble": { "farming": ["..."], ... }
}
```
