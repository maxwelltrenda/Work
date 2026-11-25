# Bramblebrook security list (November 2026)

## Fixed in this pass

| # | What | Why it mattered |
|---|---|---|
| 1 | The browser can only write its own farm save and three profile columns (name card, online status, farm name). Everything else goes through the game's server functions. | Before, the database relied on row rules alone; table-level rights were wide open (insert, update, delete, truncate). |
| 2 | Size limits: farm save 1 MB, profile card 4 KB (name 30, title 60 characters), village name 3-24, crest 8, motto 80. | A player could have stored huge data in their profile card, which every other player downloads. |
| 3 | Village gifts come out of the coins the server has saved for you. | Anyone signed in could give a village 100 million coins they didn't have, with one request. |
| 4 | Word filter on world chat, village posts, direct messages, mottos, farmer names and titles; usernames and village names with slurs or profanity are refused. Look-alike letters (sh!t, @ss, fuuuck) are caught. | App Store guideline 1.2, and players' safety. |
| 5 | Report (message or player) and Block, on every message and profile. Reports go straight to the owner's bell and inbox, with Remove message, Mute 7 days, Ban, Dismiss. Muted or banned players can't post, message or found villages. | App Store guideline 1.2. |
| 6 | Delete my account, in the app. Removes the account, save, profile, messages, follows and village place. | App Store guideline 5.1.1(v), and privacy law. |
| 7 | Sign-up: at most 5 new accounts an hour from one network (the address is stored only as a salted one-way code, deleted after a day) and 300 an hour overall; offensive usernames refused; passwords equal to the username or "password…/12345678…" refused. | Mass fake accounts were the easiest way to spam chat. |
| 8 | Chat speed limits: world chat one message per 3 seconds and 40 per 10 minutes; village posts one per 3 seconds; direct messages one per second. | Flooding. |
| 9 | Website security headers: a strict Content-Security-Policy (only the game's own files and its database server; no inline scripts), no framing (stops clickjacking), no MIME sniffing, a strict referrer policy, camera/microphone/location turned off, HTTPS forced. | Limits what an injected script could ever do. |
| 10 | Fonts are served from the game's own site instead of Google's. | Visitors' addresses no longer go to Google. |
| 11 | The iPhone app uses Capacitor 8.6.2. Versions 8.0 to 8.3.4 have a critical flaw (GHSA-rvm3-566m-v7fv: remote content could load at the app's origin). | Apps built on the old version are exposed. |

## Checked and fine

- Row-level security is on for every table, and every server function checks who is signed in. Functions run
  with an empty search path (no hijacking by look-alike tables).
- The game only holds the public "anon" key. The service key exists only inside server functions.
- Every piece of text another player wrote is escaped before it is shown, so a message or name can't run code
  in someone else's game.
- Direct messages are readable only by the two players. Feedback, reports and the admin list are not readable
  from the browser at all.
- Claude connector links are random 192-bit codes, stored only as hashes, and can be turned off.
- Passwords are hashed by Supabase Auth; every connection is HTTPS.
- Supabase's remaining warnings ("signed-in users can run SECURITY DEFINER functions") are the game's own API,
  by design; each function checks the player.

## Still open (owner decisions or actions)

1. **Leaked password protection**: Supabase › Authentication › Policies › turn on "Prevent use of leaked
   passwords" (checks HaveIBeenPwned). It may need the Pro plan.
2. **Make the GitHub repository private.** It holds the bought art packs, which their licences don't allow to be
   shared, and all the game's code.
3. **Players can still cheat their own farm**, because the farm is saved from the device. That can't reach anyone
   else's account. The shared parts are now checked (village gifts) or limited by courage (boss fights), but a
   player who edits their save to a high class level would hit village bosses harder. Moving the economy to the
   server is a big job, worth doing before leaderboards or real-money purchases, not before.
4. **No password recovery**: accounts have no email, so a lost password can't be reset (the help page says so).
5. **Reports need answering within 24 hours** once the app is on the App Store.
6. **Trenda RS** (separate project): its iPhone app is on @capacitor/ios 8.3.1, which has the critical flaw in
   item 11. Updating it to 8.6 or later is worth doing before its next App Store build.
