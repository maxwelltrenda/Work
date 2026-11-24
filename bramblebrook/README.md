# Bramblebrook Farm

A cozy, menu-based farming RPG for phone and browser. You inherit your great-aunt Wren's overgrown farm, restore the valley's landmarks chapter by chapter, and ring the silent Bramble Bell again.

**Play:** https://bramblebrook-farm.vercel.app

## What's in the game
- **Main story**: nine chapters (prologue to epilogue) with scenes, eight of Wren's journal pages and letters in the mailbox.
- **Farm**: 27 crops with growth stages, seed packets, sprinklers and a scarecrow, an orchard of fruit trees, chickens, cows, bees and sheep.
- **Wilds**: six places to explore with random encounters, a 30-floor mine with lift landings, and branching adventures with skill checks.
- **Fishing**: four waters, timing minigame, three baits, four legendary fish.
- **Make**: a workshop (bars, tools, story items, farm upgrades) and a kitchen (meals restore stamina or give boosts).
- **Town**: nine villagers with request chains, gifts, friendship hearts and heart scenes; the general store; Saffi's traveling cart; daily chores; weather and seasons.
- **Bag**: items, an almanac with mastery stars, feats (achievements) and save codes.

## Layout
- `src/content/` holds the game's data as JSON. `SCHEMA.md` there documents the format and the world.
  - `core.json`: items, crops, trees, animals, areas, mine, fish, recipes, meals, store, chores, weather, achievements.
  - `story.json`, `people.json`, `adventures.json`: chapters, pages, letters, villagers, adventures and encounters.
  - `art.json`: where each picture sits in `assets/atlas.png`.
- `src/js/*.js` is the engine (concatenated in name order), `src/style.css` the styles, `src/shell.html` the page.
- `tools/validate.js` checks every content file against `core.json`. `build.sh` runs it first.
- `tools/build_atlas.py` builds `assets/atlas.png` from the Hearthhold art packs (`python3 tools/build_atlas.py /path/to/hearthhold/art/packs`). Items not in its table fall back to emoji.
- `build.sh` writes `game.html` (the Claude Artifact page) and `public/` (the live site). Vercel runs it on deploy.

## Two versions, one game
Every feature ships to **both** the website and the Claude Artifact, the same day. The Artifact cannot reach outside servers, so anything online (accounts, saves, villages, profiles) goes through the player's own **Bramblebrook Farm** connector (`supabase/functions/farm-mcp`), which calls the same database functions the website does. Adding an online feature means adding it to the website path, the connector, and the Artifact's declared connector tools.

## Saves
Progress is saved in the browser. With an account (website) or a linked connector (Artifact) it also saves online and follows the player between the two. **Bag → Settings** has a save code and Start over.

## Art credits
Crops, icons and villagers come from CraftPix packs and Nine Realms Midgard Villagers (via the Hearthhold art library). Check each pack's licence before a public store release.
