/* ---------- automation, cellar, exchange, pets, perks, festivals, daily gift ---------- */

/* Perks: a point for every few skill levels, spent on small permanent bonuses. */
const perkRank = id => (state.perks && state.perks[id]) || 0;
function perkVal(id) { const p = (C.core.perks || []).find(x => x.id === id); return p ? perkRank(id) * p.per : 0; }
const totalLevels = () => I.skills.reduce((a, s) => a + lvl(s.id), 0);
const perkPointsEarned = () => Math.floor(totalLevels() / (C.core.perkLevels || 4));
const perkPointsSpent = () => Object.values(state.perks || {}).reduce((a, n) => a + n, 0);
const perkPointsFree = () => Math.max(0, perkPointsEarned() - perkPointsSpent());
const perkText = (p, r) => (p.ranks ? p.ranks[Math.max(0, r - 1)] : p.desc.replace('{v}', Math.max(1, r) * p.per));
function buyPerk(id) {
  const p = C.core.perks.find(x => x.id === id);
  if (!p || perkRank(id) >= p.max || perkPointsFree() < 1) return false;
  state.perks[id] = perkRank(id) + 1;
  toast(`${p.n}${p.max > 1 ? ` rank ${state.perks[id]}` : ''}: ${perkText(p, state.perks[id])}`, 'lvl');
  return true;
}
/* Doing things in one tap is learned: a locked button explains the perk and offers it right there. */
// how many a one-tap perk handles at its current level: 1 without it, every one at its last level
function perkCount(id) {
  const p = (C.core.perks || []).find(x => x.id === id), r = perkRank(id);
  if (!p || !r) return 1;
  const n = (p.counts || [])[r - 1];
  return n === 0 || n == null ? Infinity : n;
}
const tripsMax = () => perkCount('trips');
function perkSheet(id) {
  const p = C.core.perks.find(x => x.id === id);
  if (!p) return;
  const r = perkRank(id), free = perkPointsFree(), next = (perkPointsEarned() + 1) * C.core.perkLevels;
  openSheet(`<h2>🔒 ${esc(p.n)}${p.max > 1 ? ` rank ${r + 1}` : ''}</h2><p class="sub">${esc(perkText(p, r + 1))}. It's a perk: you earn a perk point for every ${C.core.perkLevels} skill levels.</p>
    <p class="sub">${free ? `You have ${plural(free, 'point')} to spend.` : `Your next point comes at ${next} total skill levels (you have ${totalLevels()}).`}</p>
    <div class="sheet-btns"><button class="btn small ghost" data-act="sheet-close">Not now</button>${free ? `<button class="btn small" data-act="perk-learn" data-id="${id}">Learn it · 1 point</button>` : ''}</div>`);
}
function resetPerks() {
  if (!perkPointsSpent() || state.coins < C.core.perkReset) return false;
  state.coins -= C.core.perkReset; state.perks = {};
  toast('Perk points refunded. Spend them again any way you like.');
  return true;
}

/* The inn's red count: quests and passages pinned up since you last looked at the board. */
const innIds = () => I.advs.filter(a => !state.advDone[a.id] && reqMet(a.req)).map(a => a.id).concat(openDelves().map(d => d.id));
const innNew = () => { const seen = new Set(state.innSeen || []); return innIds().filter(id => !seen.has(id)).length; };
function markInnSeen() { const ids = innIds(); if (innNew()) { state.innSeen = Array.from(new Set((state.innSeen || []).concat(ids))); saveLocal(); } }

/* Workbench: queue a recipe and it makes one item at a time while you're away. */
const benchOpen = () => unlocked(C.core.workbench.unlock);
const benchSecs = r => C.core.workbench.secs.base + r.lvl * C.core.workbench.secs.perLvl;
function benchState(slot) {
  const r = I.recipe[slot.rid], per = benchSecs(r) * 1000;
  const made = Math.min(slot.n, Math.floor((now() - slot.at) / per));
  return { r, made, ready: made - slot.taken, left: slot.n - made, next: made >= slot.n ? 0 : (per - ((now() - slot.at) % per)) / 1000 };
}
function benchQueue(i, rid, n) {
  const r = I.recipe[rid];
  if (!benchOpen() || !r || !recipeOpen(r) || state.bench[i]) return false;
  let m = Infinity;
  for (const [id, q] of Object.entries(r.need)) m = Math.min(m, Math.floor(have(id) / q));
  const times = Math.min(n === 'max' ? m : +n, m, C.core.workbench.maxQueue);
  if (times <= 0) { toast('Not enough materials for that.'); return false; }
  for (const [id, q] of Object.entries(r.need)) takeItem(id, q * times);
  state.bench[i] = { rid, n: times, at: now(), taken: 0 };
  toast(`The workbench will make ${times}× ${itemName(rid)}`);
  return true;
}
function benchCollect(i) {
  const slot = state.bench[i];
  if (!slot) return 0;
  const s = benchState(slot);
  if (s.ready <= 0) return 0;
  const got = addItem(s.r.id, s.ready * s.r.out);
  if (!got) return -1;
  const units = Math.ceil(got / s.r.out);
  slot.taken += units;
  addXP('crafting', s.r.xp * units * 0.5);
  state.stats.benched = (state.stats.benched || 0) + got;
  state.stats.crafted += got;
  if (slot.taken >= slot.n) state.bench[i] = null;
  return got;
}
function benchCancel(i) {
  const slot = state.bench[i];
  if (!slot) return false;
  benchCollect(i);
  const cur = state.bench[i];
  if (cur) {
    const s = benchState(cur), left = cur.n - s.made;
    for (const [id, q] of Object.entries(s.r.need)) addItem(id, q * left);
    state.bench[i] = null;
    toast(`Stopped. ${left ? `Materials for ${left} returned.` : ''}`);
  }
  return true;
}
const benchReady = () => (state.bench || []).filter(s => s && benchState(s).ready > 0).length;

/* Fishing nets: one per open fishing spot, filling slowly with common catches. */
const netsOpen = () => unlocked(C.core.nets.unlock);
function netState(spotId) {
  const n = state.nets[spotId];
  if (!n) return null;
  const per = C.core.nets.every * 1000;
  const caught = Math.min(C.core.nets.cap, Math.floor((now() - n.at) / per));
  return { caught, next: caught >= C.core.nets.cap ? 0 : (per - ((now() - n.at) % per)) / 1000 };
}
function setNet(spotId) {
  if (!netsOpen() || state.nets[spotId] || !have('net') || !spotOpen(I.spot[spotId])) return false;
  takeItem('net', 1);
  state.nets[spotId] = { at: now() };
  toast(`Net set in ${I.spot[spotId].n}`);
  return true;
}
function collectNet(spotId) {
  const s = netState(spotId);
  if (!s || !s.caught) return 0;
  const pool = I.spot[spotId].fish.filter(f => f[2] <= C.core.nets.maxRarity);
  const got = {};
  for (let k = 0; k < s.caught; k++) { const [id] = pickWeighted(pool); got[id] = (got[id] || 0) + 1; }
  let total = 0;
  for (const [id, n] of Object.entries(got)) { addOrStash(id, n); total += n; }
  const per = C.core.nets.every * 1000, el = now() - state.nets[spotId].at;
  state.nets[spotId].at = s.caught >= C.core.nets.cap ? now() : now() - (el % per);
  addXP('fishing', total * C.core.nets.xp);
  state.stats.netted = (state.stats.netted || 0) + total;
  notePlace(spotId, total, got);
  const fishOnly = Object.entries(got).filter(([id]) => id !== 'boot').reduce((a, [, n]) => a + n, 0);
  state.stats.fish += fishOnly;
  return total;
}
const netsReady = () => Object.keys(state.nets || {}).filter(id => (netState(id) || {}).caught > 0).length;

/* Cellar: casks age goods; leave them longer for the vintage version. */
const cellarOpen = () => unlocked(C.core.cellar.unlock);
const agingRecipe = id => C.core.cellar.aging.find(a => a.id === id);
function caskState(c) {
  const a = agingRecipe(c.id), mins = (now() - c.at) / 60000;
  const tier = a.vintage && mins >= a.vmins ? 2 : mins >= a.mins ? 1 : 0;
  const nextAt = tier === 0 ? a.mins : tier === 1 && a.vintage ? a.vmins : 0;
  return { a, tier, out: tier === 2 ? a.vintage : a.id, left: nextAt ? (nextAt - mins) * 60 : 0 };
}
function fillCask(i, id) {
  const a = agingRecipe(id);
  if (!cellarOpen() || !a || state.casks[i] || !hasAll(a.need)) return false;
  takeAll(a.need);
  state.casks[i] = { id, at: now() };
  toast(`Cask filled: ${itemName(id)} is aging`);
  return true;
}
function bottleCask(i) {
  const c = state.casks[i];
  if (!c) return 0;
  const s = caskState(c);
  if (!s.tier) { toast(`Still aging. Ready in ${fmtT(s.left)}.`); return 0; }
  if (!addItem(s.out, 1)) return -1;
  state.casks[i] = null;
  state.stats.bottled = (state.stats.bottled || 0) + 1;
  addXP('cooking', s.tier === 2 ? 60 : 25);
  toast(`Bottled: ${itemName(s.out)}${s.tier === 2 ? ' (vintage!)' : ''}`, s.tier === 2 ? 'lvl' : '');
  return 1;
}
function buyCask() {
  const k = C.core.cellar;
  if (state.casks.length >= k.maxSlots) return false;
  const cost = caskCost();
  if (state.coins < cost) return false;
  state.coins -= cost; state.casks.push(null);
  toast('A new cask rolls into the cellar');
  return true;
}
const caskCost = () => { const k = C.core.cellar; return Math.round(k.caskCost * Math.pow(k.caskGrow || 1, state.casks.length - k.slots) / 10) * 10; };
const benchSlotCost = () => { const k = C.core.workbench; return Math.round(k.slotCost * Math.pow(k.slotGrow || 1, state.bench.length - k.slots)); };
const casksReady = () => (state.casks || []).filter(c => c && caskState(c).tier > 0).length;

/* Valley Exchange: a handful of goods with prices that move every few hours. */
function exchangeWindow() { return Math.floor(now() / (C.core.exchange.hours * 3600000)); }
function exchangeBoard() {
  const k = C.core.exchange, w = exchangeWindow();
  const rnd = seeded('exchange-' + w);
  let pool = Object.keys(I.items).filter(id => k.types.includes(I.items[id].t) && state.seen[id] && I.items[id].s > 2 && id !== 'boot');
  if (pool.length < k.count) pool = Object.keys(I.items).filter(id => k.types.includes(I.items[id].t) && I.items[id].s > 2 && (I.crop[id] ? I.crop[id].lvl <= 4 : I.items[id].s < 30));
  pool.sort();
  const picks = [];
  while (picks.length < k.count && pool.length) picks.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]);
  return picks.map(id => ({ id, mult: pickWeighted(k.mults, rnd)[0] }));
}
function exchangeSold(id) { const ex = state.exchange; return ex && ex.w === exchangeWindow() ? ex.sold[id] || 0 : 0; }
function exchangeSell(id) {
  const row = exchangeBoard().find(r => r.id === id);
  if (!row) return 0;
  if (!state.exchange || state.exchange.w !== exchangeWindow()) state.exchange = { w: exchangeWindow(), sold: {} };
  const n = Math.min(have(id), C.core.exchange.cap - exchangeSold(id));
  if (n <= 0 || state.locked[id]) return 0;
  takeItem(id, n);
  const c = Math.round(n * priceOf(id) * row.mult);
  state.exchange.sold[id] = exchangeSold(id) + n;
  state.coins += c; state.stats.earned += c;
  return c;
}

/* Pets: each brings home finds over time; their favourite snack doubles the pace for a day. */
const petOpen = p => unlocked(p.unlock);
function petState(p) {
  const rec = state.pets[p.id];
  if (!rec) return null;
  const per = p.every * 1000 / (rec.fed === dayKey() ? 2 : 1);
  const finds = Math.min(p.cap, Math.floor((now() - rec.at) / per));
  return { rec, finds, next: finds >= p.cap ? 0 : (per - ((now() - rec.at) % per)) / 1000, fed: rec.fed === dayKey() };
}
function adoptPet(id) {
  const p = C.core.pets.find(x => x.id === id);
  if (!p || state.pets[id] || !petOpen(p) || state.coins < p.cost) return false;
  state.coins -= p.cost;
  state.pets[id] = { at: now(), fed: '' };
  toast(`${p.name} the ${p.n.toLowerCase()} has come home with you`, 'lvl');
  return true;
}
function feedPet(id) {
  const p = C.core.pets.find(x => x.id === id), s = p && petState(p);
  if (!s || s.fed || !have(p.fav)) return false;
  takeItem(p.fav, 1);
  s.rec.fed = dayKey();
  toast(`${p.name} loved the ${itemName(p.fav).toLowerCase()}. Finds come twice as fast today.`);
  return true;
}
function collectPet(id) {
  const p = C.core.pets.find(x => x.id === id), s = p && petState(p);
  if (!s || !s.finds) return 0;
  const lucky = 1 + perkVal('keeneye') / 100;
  const table = Object.entries(p.finds).map(([k, w]) => [k, w < 3 ? w * lucky : w]);
  const got = {};
  for (let k = 0; k < s.finds; k++) { const [iid] = pickWeighted(table); got[iid] = (got[iid] || 0) + 1; }
  let total = 0;
  for (const [iid, n] of Object.entries(got)) { addOrStash(iid, n); total += n; }
  const per = p.every * 1000 / (s.fed ? 2 : 1);
  s.rec.at = s.finds >= p.cap ? now() : now() - ((now() - s.rec.at) % per);
  state.stats.petfinds = (state.stats.petfinds || 0) + total;
  toast(`${p.name} brought: ${Object.entries(got).map(([iid, n]) => `${n}× ${itemName(iid)}`).join(', ')}`);
  return total;
}
const petsReady = () => (C.core.pets || []).filter(p => (petState(p) || {}).finds > 0).length;

/* Seasonal festivals: a new board each season, paid in ribbons, with a keepsake to collect. */
function festival() {
  const f = C.core.festivals[season()];
  return f ? Object.assign({ season: season(), cycle: Math.floor((dayNumber() - 1) / 7) }, f) : null;
}
function festivalDone(i) { const f = festival(); return !!(state.festival && state.festival.cycle === f.cycle && state.festival.done[i]); }
function festivalDeliver(i) {
  const f = festival(), r = f && f.reqs[i];
  if (!r || festivalDone(i) || !reqMet(r.req) || !hasAll(r.want)) return false;
  if (!state.festival || state.festival.cycle !== f.cycle) state.festival = { cycle: f.cycle, done: {} };
  takeAll(r.want);
  state.festival.done[i] = 1;
  state.tokens = (state.tokens || 0) + r.tokens;
  state.stats.tokens = (state.stats.tokens || 0) + r.tokens;
  toast(`${f.n}: +${r.tokens} ribbons`, 'lvl');
  return true;
}
function festivalBuy(i) {
  const f = festival(), s = C.core.festivals.shop[i];
  if (!f || !s || (state.tokens || 0) < s.cost) return false;
  if (s.keepsake) {
    if (have(f.keepsake)) return false;
    addItem(f.keepsake, 1);
  } else if (!addItem(s.item, s.qty)) { toast('No room in the barn for that.'); return false; }
  state.tokens -= s.cost;
  toast(`Traded ${s.cost} ribbons for ${s.keepsake ? itemName(f.keepsake) : `${s.qty}× ${itemName(s.item)}`}`);
  return true;
}
const festivalOpenCount = () => { const f = festival(); return f ? f.reqs.filter((r, i) => !festivalDone(i) && reqMet(r.req) && hasAll(r.want)).length : 0; };

/* Daily visit gift: a seven-day cycle that grows as the streak continues. */
function checkLogin() {
  const today = dayKey();
  if (!state.login) state.login = { last: '', streak: 0, claimed: '' };
  if (state.login.last === today) return;
  // one missed day is forgiven; two in a row starts the streak over
  const y = dayKey(now() - 86400000), y2 = dayKey(now() - 2 * 86400000);
  state.login.streak = state.login.last === y || state.login.last === y2 ? state.login.streak + 1 : 1;
  state.login.last = today;
  state.stats.streak = Math.max(state.stats.streak || 0, state.login.streak);
}
const loginReward = () => C.core.login[(Math.max(1, state.login.streak) - 1) % C.core.login.length];
const loginReady = () => state.login && state.login.claimed !== dayKey();
function claimLogin() {
  if (!loginReady()) return false;
  state.login.claimed = dayKey();
  const g = loginReward();
  const lines = applyGive(g.coins ? Object.assign({}, g, { coins: Math.round(g.coins * rewardScale()) }) : g);
  toast(`Day ${state.login.streak} gift: ${lines.join(', ')}`, 'lvl');
  return true;
}
