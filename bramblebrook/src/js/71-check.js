/* ---------- your farm, kept by the server ----------
   While you play online, the moves you make (15-moves.js) go to the server, which plays them through the game's
   own rules (supabase/functions/sync, and the same code behind the Claude connector) and keeps the result: that
   copy is your real farm. The phone plays the same moves at once, so nothing waits on the network; if the two
   ever differ, the phone takes the server's copy. Coins and items can only come from moves the server played.
   This replaces saving the whole farm: a farm is never uploaded, except once, within limits, when an account
   that has no farm yet takes the one this device was playing. */
const chk = { busy: false, timer: 0, base: '', fails: 0, last: null, start: null };
const CHECK_STORE = (u = mv.user) => 'bramblebrook-check-' + (u || 'local');
const DEVICE_KEY = 'bramblebrook-device';
function deviceId() {
  try {
    let d = localStorage.getItem(DEVICE_KEY);
    if (!d) { d = Math.random().toString(36).slice(2, 12) + Date.now().toString(36); localStorage.setItem(DEVICE_KEY, d); }
    return d;
  } catch (e) { return 'nostore'; }
}
function readCheck() { try { return JSON.parse(localStorage.getItem(CHECK_STORE()) || '{}') || {}; } catch (e) { return {}; } }
function storeCheck() { try { localStorage.setItem(CHECK_STORE(), JSON.stringify({ base: chk.base, start: chk.start })); } catch (e) { /* storage blocked: the next sync starts over from the server's farm */ } }
function readMoves() { try { const l = JSON.parse(localStorage.getItem(MOVES_KEY()) || '[]'); return Array.isArray(l) ? l : []; } catch (e) { return []; } }
function readSeq() { try { return +localStorage.getItem(MOVES_KEY() + '-seq') || 0; } catch (e) { return 0; } }
function forgetChecks(u) { try { localStorage.removeItem(MOVES_KEY(u)); localStorage.removeItem(CHECK_STORE(u)); } catch (e) { /* storage blocked */ } }
const tzNow = () => ({ m: -new Date().getTimezoneOffset() });

// signed in: the website and the app reach the server directly, the Claude copy through the player's connector
const checkingOn = () => !!(online && online.user && state && (online.via === 'mcp' ? onl.link === 'ready' : onl.reach === 'ok'));

/* Start recording. 'early' is the page opening with a saved sign-in: record from the very first tap, before the
   server has answered (initOnline then confirms the account or stops it). */
function startChecking(early) {
  let user = '';
  if (early) { const o = inClaude() ? null : readOnline(); user = o && o.via !== 'mcp' && o.user; }
  else user = checkingOn() && online.user;
  if (!user) { if (!early) stopChecking(); return; }
  if (mv.on && mv.user === user) return;
  mv.user = user;
  const kept = readCheck();
  chk.base = kept.base || ''; chk.start = kept.start || null;
  mv.seq = Math.max(mv.seq, readSeq());
  mv.log = chk.base || chk.start ? readMoves() : [];
  // nothing to build on yet: the server starts from this account's own farm, or (a new account) from this one
  if (!chk.base && !chk.start) chk.start = { kind: 'device', state: JSON.parse(JSON.stringify(state)) };
  mv.on = true;
  storeCheck();
  recordMove('boot');                     // a fresh page: no fight, cast or scene carries over (the server forgets them too)
  doMove('tz', tzNow());
}
function stopChecking() { mv.on = false; mv.log = []; mv.user = ''; clearTimeout(chk.timer); }
/* The farm on this device was replaced on purpose ("start over"): the server starts again from it. */
function restartChecking(kind) {
  if (!mv.on) { if (online && online.user) forgetChecks(online.user); return; }
  mv.log = []; keepMoves();
  chk.start = { kind: kind || 'device', state: JSON.parse(JSON.stringify(state)) }; chk.base = ''; storeCheck();
  recordMove('boot');
  doMove('tz', tzNow());
  checkSoon(1500);
}
function checkSoon(ms) { if (!mv.on) return; clearTimeout(chk.timer); chk.timer = setTimeout(() => pushCloud(), ms || 3000); }

/* Send the moves, and take the server's farm if it differs. why: 'open' always asks (another device may have
   played since), 'save' only when there is something to send. Returns true when the server answered. */
async function checkNow(why) {
  if (!mv.on || !checkingOn() || online.user !== mv.user) return false;
  if (!mv.log.length && chk.base && !chk.start && why !== 'open') { online.dirty = false; return true; }
  if (busyNow()) { checkSoon(8000); return false; }   // mid-fight, mid-cast, mid-scene: wait for a quiet moment
  if (chk.busy) return false;
  chk.busy = true;
  try {
    const at = settleOnOwn(true);
    const n = Math.min(mv.log.length, 4000);
    const body = { v: 2, device: deviceId(), build: BUILD, base_hash: chk.base, moves: mv.log.slice(0, n), at, clock: Date.now() };
    if (n === mv.log.length) { body.hash = hashState(state); body.fields = fieldHashes(state); }   // more to come: nothing to compare yet
    if (chk.start) { body.start = chk.start.state; if (chk.start.kind === 'reset') body.reset = true; }
    const r = online.via === 'mcp' ? await linkCall('save_farm', { sync: body }) : await onlineApi('/functions/v1/sync', { method: 'POST', auth: true, body });
    if (!r || r.reload) throw new Error((r && r.error) || 'The server did not answer.');
    if (r.error) throw new Error(r.error);
    mv.log.splice(0, n); keepMoves();
    chk.start = null; chk.base = r.hash; storeCheck();
    chk.last = { at: Date.now(), match: !!r.match, sent: n }; chk.fails = 0; onl.err = '';
    if (!r.match && r.state) takeServerFarm(r.state, r.hash, r.trimmed);
    online.dirty = mv.log.length > 0; online.syncedAt = Date.now(); storeOnline();
    if (mv.log.length) checkSoon(1500);
    return true;
  } catch (e) {
    chk.fails++;
    onl.err = navigator.onLine === false ? 'Offline. Your moves will be saved when you are back.' : String((e && e.message) || e).slice(0, 160);
    chk.last = { at: Date.now(), err: onl.err };
    checkSoon(Math.min(300000, 10000 * chk.fails));
    return false;
  } finally { chk.busy = false; }
}

/* The server's farm is the real one. Take it, keeping only this screen's own settings (which tab, sound, tours). */
function takeServerFarm(s, hash, trimmed) {
  if (mv.log.length || busyNow()) { checkSoon(1500); return; }   // more moves since: send them first, the answer comes back with the farm
  const ui = {};
  for (const k of UI_FIELDS) if (state && state[k] !== undefined) ui[k] = state[k];
  const hadName = state && state.name;
  state = migrate(s);
  Object.assign(state, ui);
  chk.base = hash; storeCheck();
  saveLocal();
  if (!sceneOpen && !advRun && !bt) $('#scene-root').innerHTML = '';
  closeSheet();
  renderAll();
  if (!state.name) askName();
  else if (!state.bg) createCharacter(false);
  if (trimmed) toast('Your farm is now saved to your account. Very large amounts were trimmed to keep things fair.', 'lvl', 6000);
  else if (!hadName && state.name) toast(`Loaded ${state.name}'s farm from your account`);
}
