/* ---------- moves: what the server replays ----------
   Every input that changes the farm is recorded as a move ({n, a, t}) while playing online, and the server
   replays the same moves through this same code (99-engine.js, supabase/functions/sync). The server's copy is
   the real farm; the phone's is a fast local copy that should always come out the same.
   Recording sits where the rules run (handle(), cast(), chooseAdv()…), so a tap, a key and the test bot are
   all recorded the same way. Rolls come from rand() (00-base.js) and times from now(), so a replay matches. */

// handle() actions that change the farm. Everything else in handle() only opens screens or talks to the
// online services, and is neither recorded nor replayed.
const FARM_ACTS = new Set(['seed', 'plot', 'harvest-all', 'sow-all', 'tonic', 'install', 'plant-tree', 'tree', 'harvest-trees',
  'collect', 'collect-all', 'buy-animal', 'pet', 'pet-pen', 'pet-one', 'area', 'explore', 'dig', 'perk-learn', 'descend', 'lift',
  'adventure', 'quest', 'quest-go', 'charm-on', 'charm-off', 'spot', 'bait', 'craft', 'cook', 'eat', 'sell', 'sell-type', 'lock',
  'buy', 'buy-plot', 'buy-barn', 'orchard-buy', 'bunk-buy', 'stair-light', 'saffi-buy', 'saffi-sell', 'chore', 'chore-bonus', 'deliver', 'chat', 'gift-pick', 'heart',
  'letter', 'letter-gift', 'story', 'class-choose', 'fight', 'fight-pal', 'fight-go', 'perk', 'perk-reset', 'bench-queue',
  'bench-collect', 'bench-cancel', 'bench-buy', 'net-set', 'net-collect', 'cask-fill', 'cask-bottle', 'cask-buy', 'ex-sell',
  'pet-adopt', 'pet-feed', 'pet-collect', 'fest-deliver', 'fest-buy', 'login-claim', 'take-overflow']);

const mv = { on: false, log: [], replaying: 0, user: '', seq: 0 };   // on: recording (signed in online, as user); replaying: inside a replay
function recordMove(n, a) {
  if (!mv.on || mv.replaying || ENGINE) return;
  const fresh = !engineClock, t = now();
  // hold the clock still for the rest of this move, so every time it stamps matches the server's replay
  if (fresh) { engineClock = t; Promise.resolve().then(() => { engineClock = 0; }); engineTick(); }   // the server catches up the day (mail, chores, login) before every move: so does the phone
  mv.log.push({ n, a: a || {}, t, q: ++mv.seq });
  keepMoves();
}
// A moment the phone tidies the farm on its own (the idle timer, a battle ending later): if that changed
// anything it becomes a 'tick' move, so the server tidies at the very same moment.
const busyNow = () => !!(bt || advRun || sceneOpen || sceneQ.length || diceCtx || (typeof fishing !== 'undefined' && fishing.phase !== 'idle' && fishing.phase !== 'result'));
function settleOnOwn(full) {
  if (full && busyNow()) return 0;   // the next move does it, on both sides
  if (!mv.on || mv.replaying || ENGINE || engineClock) { if (full) { engineTick(); syncStamina(); } engineSettle(); return now(); }
  const t = now(), before = hashState(state);
  engineClock = t;
  try { if (full) { engineTick(); syncStamina(); } engineSettle(); }
  finally { engineClock = 0; }
  if (hashState(state) !== before) { mv.log.push({ n: 'tick', a: {}, t, q: ++mv.seq }); keepMoves(); }
  return t;
}
// moves wait in storage until the server has them, so closing the app loses nothing (a long offline log is kept in memory only)
// (past 3000 unsent moves they stay in memory only, and a reload starts the server's check over from the farm)
function keepMoves() {
  try {
    if (mv.log.length > 3000) { localStorage.removeItem(MOVES_KEY()); localStorage.removeItem(CHECK_STORE()); return; }
    localStorage.setItem(MOVES_KEY(), JSON.stringify(mv.log));
    localStorage.setItem(MOVES_KEY() + '-seq', String(mv.seq));
  } catch (e) { /* storage full or blocked: the next sync still has them in memory */ }
}
const MOVES_KEY = (u = mv.user) => 'bramblebrook-moves-' + (u || 'local');

// what a recorded handle() move needs to find in "el" when it is replayed: just its data- attributes
const fakeEl = d => ({ dataset: Object.assign({}, d || {}), closest: () => null, classList: { add() {}, remove() {}, toggle() {}, contains: () => false } });

// The moves the server knows. 'h' is any button that goes through handle(); the rest are inputs that don't.
const MOVES = {
  h: a => (FARM_ACTS.has(a.act) ? handle(a.act, fakeEl(a.d)) : false),
  boot: () => resetTransient(),
  tz: a => { if (typeof a.m === 'number' && Math.abs(a.m) <= 14 * 60 && (state.tz === undefined || !state.tzAt || now() - state.tzAt > 20 * 3600e3)) { state.tz = a.m; state.tzAt = now(); } },
  name: a => setFarmerName(a.v),
  char: a => charPick(a.k, a.v, !!a.isNew),
  'fish-cast': () => cast(),
  'fish-bite': () => bite(),
  'fish-reel': a => reelResult(!!a.hit),
  adv: a => chooseAdv(+a.i),
  'adv-done': () => finishAdventure(),
  'adv-leave': () => leaveAdventure(),
  'dice-go': () => diceGo(),
  'dice-reroll': () => diceReroll(),
  'scene-done': () => sceneDone(),
  bt: a => battleAct(a.k, a.id),
  tick: () => syncStamina(),   // the tidying every move gets (engineTick before, engineSettle after), plus stamina
  // Things the online server decides. On the server (srv set by replay) they come from its own records: the
  // village's real buildings, the rewards it handed out, whether you are in a village to give to at all. The
  // phone runs the same moves with the numbers the server already told it, so both come out the same.
  vperks: a => { state.vperks = srv ? srv.vperks : (a.p && typeof a.p === 'object' ? a.p : null); },
  pay: a => {
    const c = Math.floor(+a.c || 0);
    if (!(c > 0 && c <= state.coins)) return;
    if (srv && a.why === 'gift' && !srv.canGift) return;   // no village to give to: the coins stay
    state.coins -= c;
    if (srv) srv.effects.push({ kind: String(a.why || 'pay'), c });
  },
  hire: a => {   // hire another player as a farmhand (75-farmhands.js)
    if (srv) {
      const x = srv.hire[a.u];
      if (!x || !x.ok || x.used || srv.handCount >= handCap() || srv.hireLeft <= 0 || state.coins < x.price) return;
      x.used = true; srv.handCount++; srv.hireLeft--;
      state.coins -= x.price;
      srv.effects.push({ kind: 'hire', u: String(a.u), c: x.price });
      return;
    }
    const c = Math.floor(+a.c || 0);
    if (c > 0 && c <= state.coins) state.coins -= c;
  },
  grant: a => {
    let g = { c: +a.c || 0, xp: +a.xp || 0 };
    if (srv) { const x = srv.grants[a.g]; if (!x || x.used) return; x.used = true; g = { c: x.coins, xp: x.xp }; }
    giveGrant(g);
  },
};
function giveGrant(g) { const c = Math.floor(+g.c || 0); if (c > 0) state.coins += c; if (+g.xp > 0) addCombatXP(Math.floor(+g.xp)); }
// the server's records for the replay in progress (null on the phone)
let srv = null;
// record a move and run it, for inputs that don't already pass through a recorded function
function doMove(n, a) { recordMove(n, a || {}); return MOVES[n](a || {}); }

/* Things that live only while a screen is open (a battle, an adventure, a cast line). A fresh page starts
   without them, so the server forgets them too when a session starts. */
function resetTransient() {
  bt = null; advRun = null; sceneQ.length = 0; sceneEnds.length = 0; sceneOpen = false; diceCtx = null;
  fightPick.id = ''; fightPick.with = [];
  if (typeof fishing !== 'undefined') { fishing.phase = 'idle'; fishing.fish = null; fishing.bait = null; }
}

/* The farm, reduced to what the server checks: screen-only settings (which tab is open, tutorials seen,
   sound) are the player's own and never compared. */
const UI_FIELDS = ['tab', 'sub', 'opts', 'toursSeen', 'visited', 'savedAt', 'innSeen', 'revealed'];
function checkedState(s) {
  const o = {};
  for (const k of Object.keys(s).sort()) if (!UI_FIELDS.includes(k)) o[k] = s[k];
  if (o.stamina >= maxStaminaOf(s)) delete o.staminaAt;   // a full bar's timestamp means nothing
  // when an achievement or chapter was marked is a keepsake, and the phone can mark it a moment after the server
  if (o.ach) o.ach = Object.fromEntries(Object.keys(o.ach).map(k => [k, 1]));
  if (o.story && o.story.done) o.story = Object.assign({}, o.story, { done: Object.fromEntries(Object.keys(o.story.done).map(k => [k, 1])) });
  return o;
}
function maxStaminaOf(s) { const keep = state; state = s; try { return maxStamina(); } finally { state = keep; } }
function canonical(v) {
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().filter(k => v[k] !== undefined).map(k => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
  if (typeof v === 'number') return Number.isFinite(v) ? String(Math.round(v * 1e6) / 1e6) : 'null';
  return JSON.stringify(v === undefined ? null : v);
}
function hashStr(str) {
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < str.length; i++) { const c = str.charCodeAt(i); h1 = Math.imul(h1 ^ c, 16777619); h2 = Math.imul(h2 ^ c, 2246822507); }
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
}
// one top-level part of the farm, so a mismatch can say which part parted ways
const fieldHash = (s, k) => hashStr(canonical(checkedState(s)[k]));
const fieldHashes = s => { const c = checkedState(s); return Object.fromEntries(Object.keys(c).map(k => [k, hashStr(canonical(c[k]))])); };
function hashState(s) {
  const str = canonical(checkedState(s));
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < str.length; i++) { const c = str.charCodeAt(i); h1 = Math.imul(h1 ^ c, 16777619); h2 = Math.imul(h2 ^ c, 2246822507); }
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
}
