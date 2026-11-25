/* ---------- the rules engine ----------
   replay() runs recorded moves (15-moves.js) on a copy of a farm, with each move's own time and the farm's own
   dice, and returns the farm they lead to. The server runs it on the real farm (supabase/functions/sync); the
   page uses it to check its own moves in tests.
   On the server (ENGINE) there is no page: drawing, sounds and saving are switched off below, and anything the
   page would do a moment later (the foes' turn, the end of a scene) runs straight after the move that caused
   it, in the same order. */
function engineQueue() { return (typeof globalThis !== 'undefined' && globalThis.__engineQueue) || null; }
function engineDrain(notes) {
  const q = engineQueue();
  if (!q) return;
  for (let guard = 0; guard < 20000 && q.length; guard++) {
    const f = q.shift();
    try { f(); } catch (e) { notes.push('later: ' + ((e && e.message) || e)); }
  }
  q.length = 0;
}
// what the page does every 30 seconds, and after every action (commit), minus the drawing
function engineTick() { checkMail(); ensureChores(); checkLogin(); }
function engineSettle() { storyCheck(); checkMail(); checkAchievements(); checkReveals(ENGINE || mv.replaying > 0); }

// opt: { from: time of the last move already applied, notAfter: latest allowed move time, at: the moment to settle at,
//        server: { grants: {id: {coins, xp}}, vperks, canGift } — the server's own records (see MOVES.vperks, pay, grant) }
function replay(s0, moves, opt = {}) {
  const keep = state, notes = [], toasts = [];
  const keepToast = toast;
  if (!ENGINE) toast = m => { toasts.push(String(m)); };   // in the page, a replay stays silent
  state = migrate(JSON.parse(JSON.stringify(s0)));
  resetTransient();
  mv.replaying++;
  let last = +opt.from || 0, applied = 0;
  srv = opt.server ? { grants: opt.server.grants || {}, vperks: opt.server.vperks || null, canGift: !!opt.server.canGift, effects: [] } : null;
  if (srv && moves && moves.length) state.vperks = srv.vperks;   // the village's real perks, from the first move on
  try {
    for (const m of moves || []) {
      const t = +m.t;
      if (!m || !Number.isFinite(t) || t < last - 2000 || (opt.notAfter && t > opt.notAfter)) { notes.push(`refused ${m && m.n}: time ${t}`); continue; }
      last = Math.max(last, t);
      engineClock = t;
      engineTick();
      const f = MOVES[m.n];
      if (!f) { notes.push('unknown move ' + m.n); continue; }
      try { f(m.a || {}); } catch (e) { notes.push(`${m.n}: ${(e && e.message) || e}`); }
      engineDrain(notes);
      engineSettle();
      applied++;
    }
    if (opt.at) {
      engineClock = Math.max(last, +opt.at); engineTick();
      if (srv) {   // rewards the phone never asked for (it closed first) are paid now, so nothing is lost
        for (const x of Object.values(srv.grants)) if (!x.used) { x.used = true; giveGrant({ c: x.coins, xp: x.xp }); }
        state.vperks = srv.vperks;
      }
      syncStamina(); engineSettle();
    }
    const out = state;
    const used = srv ? Object.keys(srv.grants).filter(k => srv.grants[k].used) : [];
    return { state: out, hash: hashState(out), notes, toasts, last, applied, effects: srv ? srv.effects : [], used };
  } finally {
    mv.replaying--; engineClock = 0; srv = null;
    if (!ENGINE) { state = keep; toast = keepToast; }
  }
}

/* A farm brought into an account from somewhere the server never saw: played before signing up, or a save code.
   Nothing offline can be checked, so it comes in within limits. */
const START_CAPS = { coins: 5000, stack: 50, level: 12 };
function clampStart(s0) {
  const s = migrate(JSON.parse(JSON.stringify(s0 || {})));
  const trimmed = [];
  const cap = (v, m) => { const n = Math.max(0, Math.floor(+v || 0)); if (n > m) trimmed.push(m); return Math.min(n, m); };
  s.coins = cap(s.coins, START_CAPS.coins);
  for (const k of Object.keys(s.inv)) s.inv[k] = cap(s.inv[k], START_CAPS.stack);
  let maxXp = 0; for (let l = 1; l < START_CAPS.level; l++) maxXp += xpToNext(l);
  for (const k of Object.keys(s.xp)) s.xp[k] = cap(s.xp[k], maxXp);
  s.tokens = cap(s.tokens, 50);
  if (s.combat) s.combat.xp = cap(s.combat.xp, maxXp);
  return { state: s, trimmed: trimmed.length > 0 };
}
/* "Start over" online: a truly fresh farm (the phone's own new farm, keeping only its name-free basics). */
function freshFrom(s0) {
  state = null;
  const s = freshState();
  if (s0 && s0.rng && typeof s0.rng.s === 'number') s.rng = { s: s0.rng.s >>> 0, n: 0 };
  if (s0 && Number.isFinite(+s0.created)) s.created = +s0.created;
  if (s0 && typeof s0.tz === 'number') s.tz = s0.tz;
  return s;
}
// The page's own copy, brought to the same point as a replay's: what the phone hashes before a sync.

if (ENGINE) {
  const nop = () => {};
  // no page on the server: nothing to draw, sound, save or tour
  renderView = nop; renderTabs = nop; renderAll = nop; updateHeader = nop; updateBadges = nop;
  openSheet = nop; closeSheet = nop; flushToasts = nop; holdToasts = nop; placeToasts = nop; itemSheet = nop; perkSheet = nop;
  play = nop; bloom = nop; pulse = nop; floatAt = nop; ripple = nop; fxAfter = nop; fxSnap = () => null;
  drawBattle = nop; drawAdventure = nop; renderScene = () => false; mountStage = nop; stageLine = nop; typeLine = nop; stopTyping = nop; finishTyping = () => false; focusScene = nop;
  syncFishDom = nop; updateBaitCounts = nop; animateNeedle = nop; tickFarm = nop;
  saveLocal = nop; saveCloud = nop; onlineChanged = nop; onlineFlush = nop; refreshOnlineCard = nop; maybeTourNow = nop;
  toast = nop;
  commit = engineSettle;
  // a scene on the server keeps what it does at the end until the player's 'scene-done' move arrives
  playScene = (lines, opts) => { if (opts && typeof opts.onDone === 'function') sceneEnds.push(opts.onDone); };
  nextScene = nop;
  globalThis.__engine = {
    load: content => { indexContent(content); },
    fresh: () => { state = null; const s = freshState(); return s; },
    replay, hashState, fieldHash, clampStart, freshFrom,
  };
}
