/* ---------- the save, and the rules every system shares ---------- */
const SAVE_KEY = 'bramblebrook-save-v2';
const UNLOCK_NAMES = {
  coop: 'the chicken coop', river: 'fishing on Willow River', banks: 'Willow Banks', forge: 'the forge (metal bars)',
  barnyard: 'cows', mine: 'the Mine', kitchen: "Gran's kitchen (cooking)", orchard: 'the orchard', merchant: "Saffi's cart",
  cove: 'fishing in Saltspray Cove', beach: 'Saltspray Beach', apiary: 'beehives', highlands: 'the Windy Highlands',
  tarn: 'fishing in the Highland Tarn', pasture: 'sheep',
};

function freshState() {
  const t = now();
  const k = C.core;
  return {
    v: 2, created: t, savedAt: 0, name: '',
    coins: 80, barn: 0,
    plots: Array.from({ length: k.plots.start }, () => ({ crop: null, at: 0, ready: 0 })),
    inv: { worm: 6 }, locked: {}, seen: { worm: 1 }, got: {},
    xp: Object.fromEntries(k.skills.map(s => [s.id, 0])),
    stamina: k.stamina.base + k.stamina.perLevel, staminaAt: t,
    orchard: Array.from({ length: k.orchardSlots }, () => null),
    animals: {}, petDay: '',
    upgrades: { sprinkler: 0, scarecrow: 0 },
    buffs: {},
    mine: { floor: 1, deepest: 1, stairs: false },
    story: { ci: 0, si: 0, started: false, base: 0, queue: [], done: {} },
    flags: {}, unlocks: {}, pages: {},
    friends: {}, gifted: {}, chatted: {}, reqs: {}, heartSeen: {},
    advDone: {}, encDone: {},
    mail: [], chores: null, merchant: null, ach: {}, mastery: {},
    stats: { harvested: 0, fish: 0, explores: 0, crafted: 0, cooked: 0, digs: 0, collected: 0, delivered: 0, earned: 0, gifts: 0 },
    seed: 'wheat', spot: 'pond', bait: 'worm', area: 'meadow',
    tab: 'farm', sub: {},
  };
}
function migrate(s) {
  const base = freshState();
  if (!s || typeof s !== 'object' || s.v !== 2) return base;
  const out = Object.assign({}, base, s);
  for (const key of ['inv', 'locked', 'seen', 'got', 'xp', 'upgrades', 'buffs', 'mine', 'story', 'flags', 'unlocks', 'pages', 'friends', 'gifted', 'chatted', 'reqs', 'heartSeen', 'advDone', 'encDone', 'ach', 'mastery', 'stats', 'animals', 'sub']) {
    out[key] = Object.assign({}, base[key], s[key] || {});
  }
  out.story.queue = Array.isArray(out.story.queue) ? out.story.queue : [];
  for (const id of Object.keys(out.inv)) if (!I.items[id] || !(out.inv[id] > 0)) delete out.inv[id];
  if (!Array.isArray(out.plots) || !out.plots.length) out.plots = base.plots;
  if (!Array.isArray(out.orchard)) out.orchard = base.orchard;
  while (out.orchard.length < C.core.orchardSlots) out.orchard.push(null);
  if (!Array.isArray(out.mail)) out.mail = [];
  if (!I.crop[out.seed]) out.seed = 'wheat';
  if (!I.spot[out.spot]) out.spot = 'pond';
  if (!I.area[out.area]) out.area = 'meadow';
  return out;
}

/* skills */
const lvl = sk => levelInfo(state.xp[sk] || 0).lvl;
function addXP(sk, amount) {
  amount = Math.round(amount);
  if (!amount || !I.skill[sk]) return;
  const before = lvl(sk);
  state.xp[sk] = (state.xp[sk] || 0) + amount;
  const after = lvl(sk);
  if (after > before) {
    const un = unlocksAt(sk, after);
    toast(`${skillName(sk)} level ${after}!${un ? ' New: ' + un : ''}`, 'lvl', 4200);
  }
}
function unlocksAt(sk, l) {
  const list = [];
  if (sk === 'farming') { I.crops.filter(c => c.lvl === l && !c.flag).forEach(c => list.push(itemName(c.id))); I.trees.filter(t => t.lvl === l).forEach(t => list.push(t.n)); }
  if (sk === 'foraging') { I.areas.filter(a => a.lvl === l).forEach(a => list.push(a.n)); list.push('+2 stamina'); }
  if (sk === 'fishing') I.spots.filter(s => s.lvl === l).forEach(s => list.push(s.n));
  if (sk === 'crafting') I.recipes.filter(r => r.lvl === l).forEach(r => list.push(itemName(r.id)));
  if (sk === 'cooking') I.meals.filter(r => r.lvl === l).forEach(r => list.push(itemName(r.id)));
  if (sk === 'mining') Object.entries(C.core.mine.gates).forEach(([f, need]) => { if (need === l) list.push(`mine floor ${f}`); });
  return list.join(', ');
}

/* inventory */
const cap = () => C.core.barn[state.barn].cap;
const have = id => state.inv[id] || 0;
function addItem(id, n) {
  if (!I.items[id] || n <= 0) return 0;
  const room = Math.max(0, cap() - have(id));
  const got = Math.min(room, n);
  if (got > 0) {
    state.inv[id] = have(id) + got;
    state.seen[id] = 1;
    state.got[id] = (state.got[id] || 0) + got;
    checkMastery(id);
  }
  return got;
}
function takeItem(id, n) {
  const left = have(id) - n;
  if (left > 0) state.inv[id] = left; else delete state.inv[id];
}
const hasAll = want => Object.entries(want || {}).every(([id, n]) => have(id) >= n);
function takeAll(want) { for (const [id, n] of Object.entries(want || {})) takeItem(id, n); }

/* mastery: lifetime amounts of a crop, fish or ore earn stars and a better price */
function masteryTier(id) {
  const it = I.items[id];
  const tiers = it && C.core.mastery[it.t];
  if (!tiers) return 0;
  const g = state.got[id] || 0;
  return tiers.filter(t => g >= t).length;
}
function checkMastery(id) {
  const t = masteryTier(id);
  if (t > (state.mastery[id] || 0)) {
    state.mastery[id] = t;
    const reward = Math.max(50, I.items[id].s * 25 * t);
    state.coins += reward;
    toast(`Mastery: ${itemName(id)} ${'★'.repeat(t)} · +${fmtN(reward)} coins, sells for more`, 'lvl', 4200);
  }
}
const priceOf = id => Math.round(I.items[id].s * (1 + [0, 0.05, 0.1, 0.2][masteryTier(id)]));

/* stamina and buffs */
const maxStamina = () => C.core.stamina.base + lvl('foraging') * C.core.stamina.perLevel;
const buffOn = id => (state.buffs[id] || 0) > now();
function setBuff(id, mins = 15) {
  if (!I.buffs[id]) return;
  state.buffs[id] = Math.max(state.buffs[id] || 0, now()) + mins * 60000;
}
function regenMs() { return C.core.stamina.regenMs / (buffOn('refreshed') ? 2 : 1); }
function syncStamina() {
  const max = maxStamina(), t = now();
  if (state.stamina >= max) { state.staminaAt = t; return; }
  const step = regenMs();
  const gained = Math.floor((t - state.staminaAt) / step);
  if (gained > 0) {
    state.stamina = Math.min(max, state.stamina + gained);
    state.staminaAt = state.stamina >= max ? t : state.staminaAt + gained * step;
  }
}
function spendStamina(n) { syncStamina(); const wasFull = state.stamina >= maxStamina(); state.stamina -= n; if (wasFull) state.staminaAt = now(); }

/* calendar */
function dayNumber() { return Math.floor((now() - state.created) / 86400000) + 1; }
function season() { const s = C.core.seasons; return s[Math.floor((dayNumber() - 1) / 7) % s.length]; }
function weather() {
  const rnd = seeded('weather-' + dayKey());
  return pickWeighted(C.core.weather.map(w => [w, w.w]), rnd)[0];
}

/* unlocks, requirements, rewards */
const unlocked = id => !id || !!state.unlocks[id];
function unlockHint(id) {
  const ci = I.unlockAt[id];
  if (ci == null) return 'Unlocks later in the story.';
  return `Unlocks in the story: ${chapterLabel(ci)}, ${I.chapters[ci].n}.`;
}
const chapterDone = id => !!state.story.done[id];
function chapterStarted(id) {
  if (chapterDone(id)) return true;
  const ch = I.chapters[state.story.ci];
  return !!ch && ch.id === id && state.story.started;
}
function reqProblems(r) {
  const out = [];
  if (!r) return out;
  for (const [id, n] of Object.entries(r.items || {})) if (have(id) < n) out.push(`${n}× ${itemName(id)}`);
  for (const [sk, l] of Object.entries(r.skill || {})) if (lvl(sk) < l) out.push(`${skillName(sk)} ${l}`);
  if (r.flag && !state.flags[r.flag]) out.push('Not yet');
  if (r.noflag && state.flags[r.noflag]) out.push('Not now');
  if (r.chapter && !chapterDone(r.chapter)) out.push(`after "${(I.chapter[r.chapter] || {}).n || r.chapter}"`);
  if (r.started && !chapterStarted(r.started)) out.push(`in "${(I.chapter[r.started] || {}).n || r.started}"`);
  if (r.coins && state.coins < r.coins) out.push(`${fmtN(r.coins)} coins`);
  return [...new Set(out)];
}
const reqMet = r => reqProblems(r).length === 0;
function costProblems(c) {
  const out = [];
  if (!c) return out;
  if (c.coins && state.coins < c.coins) out.push(`${fmtN(c.coins)} coins`);
  if (c.stamina) { syncStamina(); if (state.stamina < c.stamina) out.push(`${c.stamina} stamina`); }
  for (const [id, n] of Object.entries(c.items || {})) if (have(id) < n) out.push(`${n}× ${itemName(id)}`);
  return out;
}
function costText(c) {
  if (!c) return '';
  const bits = [];
  if (c.stamina) bits.push(`${c.stamina} stamina`);
  if (c.coins) bits.push(`${fmtN(c.coins)} coins`);
  for (const [id, n] of Object.entries(c.items || {})) bits.push(`${n} ${itemName(id)}`);
  return bits.join(', ');
}
function payCost(c) {
  if (!c) return;
  if (c.coins) state.coins -= c.coins;
  if (c.stamina) spendStamina(c.stamina);
  takeAll(c.items);
}
/* Applies a reward and returns short lines describing it. */
function applyGive(g) {
  const out = [];
  if (!g) return out;
  if (g.coins) { state.coins += g.coins; out.push(`+${fmtN(g.coins)} coins`); }
  for (const [id, n] of Object.entries(g.items || {})) {
    const got = addItem(id, n);
    out.push(got ? `${got}× ${itemName(id)}` : `${itemName(id)} (barn full)`);
  }
  for (const [sk, x] of Object.entries(g.xp || {})) { addXP(sk, x); out.push(`+${x} ${skillName(sk)} XP`); }
  for (const [vid, p] of Object.entries(g.friend || {})) { addFriend(vid, p); out.push(`${p > 0 ? '+' : ''}${p} friendship with ${vilShort(vid)}`); }
  if (g.page && !state.pages[g.page]) { state.pages[g.page] = now(); out.push(`Journal page ${g.page}`); }
  for (const f of [].concat(g.flag || [])) state.flags[f] = 1;
  if (g.stamina) { syncStamina(); state.stamina = Math.min(maxStamina() * 2, state.stamina + g.stamina); out.push(`+${g.stamina} stamina`); }
  if (g.buff && I.buffs[g.buff]) { setBuff(g.buff, 15); out.push(`${I.buffs[g.buff].n} for 15 min`); }
  if (g.plots) {
    let n = 0;
    for (let i = 0; i < g.plots && state.plots.length < C.core.plots.max; i++) { state.plots.push({ crop: null, at: 0, ready: 0 }); n++; }
    if (n) out.push(`${n} new farm plot${n > 1 ? 's' : ''}`);
  }
  for (const [aid, n] of Object.entries(g.animals || {})) {
    const a = I.animal[aid]; if (!a) continue;
    const rec = animalRec(aid);
    const add = Math.min(n, a.max - rec.n);
    if (add > 0) { if (!rec.n) rec.at = now(); rec.n += add; out.push(`${add} ${add > 1 ? a.n.toLowerCase() : a.one.toLowerCase()}`); }
  }
  for (const u of [].concat(g.unlock || [])) {
    if (!state.unlocks[u]) { state.unlocks[u] = 1; out.push(`Unlocked ${UNLOCK_NAMES[u] || u}`); }
  }
  return out;
}

/* friendship */
const friendPts = vid => state.friends[vid] || 0;
const hearts = vid => clamp(Math.floor(friendPts(vid) / C.core.friendship.perHeart), 0, C.core.friendship.maxHearts);
function addFriend(vid, p) {
  if (!I.vil[vid]) return;
  const before = hearts(vid);
  state.friends[vid] = clamp(friendPts(vid) + p, 0, C.core.friendship.perHeart * C.core.friendship.maxHearts);
  const after = hearts(vid);
  if (after > before) toast(`${vilShort(vid)}: ${after} ♥`, 'lvl');
}
const vilAvailable = v => reqMet(v.req);
function animalRec(id) { if (!state.animals[id]) state.animals[id] = { n: 0, at: 0 }; return state.animals[id]; }
