# Bramblebrook Farm

A cozy, menu-based farming game for phone and browser: grow crops, explore, fish, craft and fill requests for the villagers of Bramblebrook. It is an original game in the semi-idle farming RPG genre.

- `game.html` is the whole game (HTML, CSS and JS in one file). It is published as-is as a Claude Artifact.
- `build.sh` wraps it in a full HTML document with an app manifest and icons, and writes the live site to `public/`. Vercel runs it on every deploy.
- `assets/` holds the app icon and manifest.

## Swapping in real art
Every item's picture is the `i` field in `ITEMS` near the top of the script (emoji for now). Item icons should be square, transparent PNG or WebP at 128×128.

## Saves
Progress is saved in the browser. In the Artifact it is also saved to the player's Claude account. **Bag → Save & settings** has a save code for moving a farm between devices.
