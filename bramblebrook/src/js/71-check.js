/* ---------- the server's check ----------
   While you play online, the moves you make (15-moves.js) also go to the server, which plays them again through
   the game's own rules (supabase/functions/sync) and compares the farm it ends up with against yours.
   Step 1, now: it only compares, and writes down any difference for the owner. Your farm is never changed by it.
   Step 2, later: the server's farm becomes the real one, so coins and items can only come from playing. */
const chk = { busy: false, timer: 0, base: '', fails: 0, last: null };
const CHECK_STORE = (u = mv.user) => 'bramblebrook-check-' + (u || 'local');
function readCheckBase() { try { return (JSON.parse(localStorage.getItem(CHECK_STORE()) || '{}') || {}).base || ''; } catch (e) { return ''; } }
function storeCheck() { try { localStorage.setItem(CHECK_STORE(), JSON.stringify({ base: chk.base })); } catch (e) { /* storage blocked: the next check sends the whole farm */ } }
function readMoves() { try { const l = JSON.parse(localStorage.getItem(MOVES_KEY()) || '[]'); return Array.isArray(l) ? l : []; } catch (e) { return []; } }
function forgetChecks(u) { try { localStorage.removeItem(MOVES_KEY(u)); localStorage.removeItem(CHECK_STORE(u)); } catch (e) { /* storage blocked */ } }
const tzNow = () => ({ m: -new Date().getTimezoneOffset() });

// the website and the app, signed in (not the Claude connector, which saves through Claude)
const checkingOn = () => !!(online && online.user && online.via !== 'mcp' && onl.reach === 'ok' && state);

/* Start recording. 'early' is the page opening with a saved sign-in: record from the very first tap, before the
   server has answered (initOnline then confirms the account or stops it). */
function startChecking(early) {
  let user = '';
  if (early) { const o = inClaude() ? null : readOnline(); user = o && o.via !== 'mcp' && o.user; }
  else user = checkingOn() && online.user;
  if (!user) { if (!early) stopChecking(); return; }
  if (mv.on && mv.user === user) { checkSoon(8000); return; }
  mv.user = user;
  chk.base = readCheckBase();
  mv.log = chk.base ? readMoves() : [];   // without the server's starting point, old moves mean nothing
  mv.on = true;
  recordMove('boot');                     // a fresh page: no fight, cast or scene carries over (the server forgets them too)
  doMove('tz', tzNow());
  if (!early) checkSoon(8000);
}
function stopChecking() { mv.on = false; mv.log = []; mv.user = ''; clearTimeout(chk.timer); }
/* The farm was replaced (loaded from another device, started over): the server starts again from this one. */
function restartChecking() {
  if (!mv.on) { if (online && online.user) forgetChecks(online.user); return; }   // startChecking picks up from here
  mv.log = []; keepMoves(); chk.base = ''; storeCheck();
  recordMove('boot');
  doMove('tz', tzNow());
  checkSoon(4000);
}
function checkSoon(ms) { if (!mv.on) return; clearTimeout(chk.timer); chk.timer = setTimeout(checkNow, ms || 3000); }

async function checkNow() {
  if (!mv.on || chk.busy || !checkingOn() || online.user !== mv.user) return;
  if (!mv.log.length && chk.base) return;   // nothing new since the last check
  if (busyNow()) { checkSoon(10000); return; }   // mid-fight, mid-cast, mid-scene: wait for a quiet moment
  chk.busy = true;
  try {
    const at = settleOnOwn(true);
    const n = mv.log.length;
    const body = { build: BUILD, hash: hashState(state), at, clock: Date.now(), fields: fieldHashes(state) };
    if (chk.base && n <= 4000) { body.base_hash = chk.base; body.moves = mv.log.slice(0, n); }
    else { body.base = JSON.parse(JSON.stringify(state)); body.moves = []; }   // the server's starting point: this farm, now
    const r = await onlineApi('/functions/v1/sync', { method: 'POST', auth: true, body });
    mv.log.splice(0, n); keepMoves();
    chk.base = r && r.match && !r.need_base ? r.hash : '';
    chk.last = { at: Date.now(), match: !!(r && r.match), sent: n };
    storeCheck(); chk.fails = 0;
  } catch (e) {
    chk.fails++;
    chk.last = { at: Date.now(), err: String((e && e.message) || e).slice(0, 120) };
  }
  chk.busy = false;
  if (mv.log.length > 400) checkSoon(chk.fails ? Math.min(300000, 15000 * chk.fails) : 5000);
}
