# Replay tests

The server keeps every online farm by replaying the player's moves through the game's own code
(`src/js/15-moves.js`, `src/js/99-engine.js`, `supabase/functions/_shared/farm.ts`). These check that a replay
comes out exactly like the game did. Run them after changing anything in `src/js`. Build first: `./build.sh`.

```bash
# 4 days of play by a bot on a fake clock, every move recorded, then replayed by the server's engine
node tools/replay/bot/run.js --profile casual --days 4 --tag d4
node tools/replay/check.js tools/replay/out/d4-rec.json supabase/functions/_engine      # MATCH expected

# every training-yard fight, three times, then replayed
node tools/replay/battle.js 3
node tools/replay/check.js tools/replay/out/battle-rec.json supabase/functions/_engine

# the server's save rules (rewards, gifts, resends, new accounts, start over) against an in-memory database
node --experimental-strip-types tools/replay/server-test.mjs
```

A long run (`--profile keen --days 30`) takes about five minutes and replays about 75,000 moves.
When a check says DIFFERENT it prints the first move where the farms part ways; `diffat.js` with `SNAP=<move>`
shows the farm at that point.
