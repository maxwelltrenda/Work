/* ---------- game systems ---------- */

/* Bad-luck protection: rare finds that the story or requests rely on are guaranteed within this many tries. */
const PITY = { explore: 90, starshard: 70, legendary: 160 };

/* Fields */
function growFactor() {
  let f = C.core.growScale || 1;   // the pacing knob for every crop timer
  const sp = state.upgrades.sprinkler;
  if (sp) f *= 1 - C.core.upgrades.sprinkler.tiers[sp - 1].pct / 100;
  if (buffOn('greenthumb')) f *= 0.75;
  if (weather().id === 'rainy') f *= 0.85;
  f *= 1 - perkVal('greenthumb') / 100;
  f *= 1 - charmFx('grow') / 100;
  return f;
}
const seedCost = c => Math.max(1, Math.round(c.seed * (1 - perkVal('thrifty') / 100) * (1 - villageFx('discount') / 100)));
function storePrice(s) { return Math.max(1, Math.round(s.price * (1 - villageFx('discount') / 100))); }
function cropOpen(c) { return lvl('farming') >= c.lvl && (!c.flag || state.flags[c.flag]); }
function plant(i, quiet) {
  const p = state.plots[i];
  if (!p || p.crop) return false;
  const c = I.crop[state.seed];
  if (!c || !cropOpen(c)) return false;
  if (state.coins < seedCost(c)) { if (!quiet) toast(`You need ${seedCost(c)} coins for ${itemName(c.id)} seeds.`); return false; }
  state.coins -= seedCost(c);
  const t = now();
  state.plots[i] = { crop: c.id, at: t, ready: t + Math.round(c.grow * 1000 * growFactor()) };
  return true;
}
function harvest(i) {
  const p = state.plots[i];
  if (!p || !p.crop || p.ready > now()) return 0;
  const c = I.crop[p.crop];
  const sc = state.upgrades.scarecrow ? C.core.upgrades.scarecrow.tiers[0].pct / 100 : 0;
  const bonus = Math.random() < lvl('farming') * 0.02 + sc + perkVal('bumper') / 100 ? 1 : 0;
  const got = addItem(c.id, 1 + bonus);
  if (!got) return -1;
  state.plots[i] = { crop: null, at: 0, ready: 0 };
  addXP('farming', c.xp);
  state.stats.harvested += got;
  return got;
}
function plotState(p) {
  const t = now();
  const total = Math.max(1, p.ready - p.at), left = Math.max(0, p.ready - t);
  const g = Math.min(1, 1 - left / total);
  return { g, left, ready: left <= 0, stage: left <= 0 ? 4 : g < 0.2 ? 1 : g < 0.55 ? 2 : g < 0.85 ? 3 : 4 };
}
function useTonic() {
  const t = now(); let n = 0;
  state.plots.forEach(p => { if (p.crop && p.ready > t) { p.ready = t + (p.ready - t) / 2; n++; } });
  if (!n) { toast('Nothing is growing right now. Sow something first.'); return false; }
  takeItem('tonic', 1);
  toast(`Grow Tonic sped up ${plural(n, 'plot')}`);
  return true;
}
function installUpgrade(kind) {
  const u = C.core.upgrades[kind];
  const next = u.tiers[state.upgrades[kind]];
  if (!next || !have(next.item)) return false;
  takeItem(next.item, 1);
  state.upgrades[kind]++;
  toast(`${itemName(next.item)} installed: ${u.desc.replace('{pct}', next.pct)}`, 'lvl');
  return true;
}

/* Orchard */
function treeState(slot) {
  const t = I.tree[slot.tree];
  const cycles = Math.floor((now() - slot.at) / (t.grow * 1000));
  const ready = Math.min(2, cycles);
  return { t, ready, next: ready >= 2 ? 0 : (t.grow * 1000 - ((now() - slot.at) % (t.grow * 1000))) / 1000 };
}
function harvestTree(i) {
  const slot = state.orchard[i];
  if (!slot) return 0;
  const { t, ready } = treeState(slot);
  if (!ready) return 0;
  const got = addItem(t.id, ready * t.yield);
  if (!got) return -1;
  const el = now() - slot.at, per = t.grow * 1000;
  slot.at = ready >= 2 ? now() : now() - (el % per);
  addXP('farming', t.xp * ready);
  return got;
}
function plantTree(i, id) {
  const t = I.tree[id];
  if (!t || state.orchard[i] || lvl('farming') < t.lvl || state.coins < t.cost) return false;
  state.coins -= t.cost;
  state.orchard[i] = { tree: id, at: now() };
  toast(`Planted a ${t.n.toLowerCase()}`);
  return true;
}

/* Animals */
function animalState(a) {
  const rec = animalRec(a.id);
  if (!rec.n) return { rec, ready: 0, next: 0 };
  const per = a.every * 1000;
  const cycles = Math.min(C.core.animalStore, Math.floor((now() - rec.at) / per));
  return { rec, ready: cycles * rec.n, cycles, next: cycles >= C.core.animalStore ? 0 : (per - ((now() - rec.at) % per)) / 1000 };
}
function collectAnimal(a) {
  const s = animalState(a);
  if (!s.ready) return 0;
  const got = addItem(a.produce, s.ready);
  if (!got) return -1;
  const per = a.every * 1000;
  s.rec.at = s.cycles >= C.core.animalStore ? now() : now() - ((now() - s.rec.at) % per);
  addXP('farming', a.xp * s.cycles);
  state.stats.collected += got;
  return got;
}
function buyAnimal(a) {
  const rec = animalRec(a.id);
  if (!unlocked(a.unlock) || rec.n >= a.max || state.coins < a.cost) return false;
  state.coins -= a.cost;
  if (!rec.n) rec.at = now();
  rec.n++;
  toast(`A new ${a.one.toLowerCase()} joins the farm`);
  return true;
}
function petAnimals() {
  if (state.petDay === dayKey()) return false;
  let n = 0;
  for (const a of I.animals) { const rec = animalRec(a.id); if (rec.n) n += addItem(a.produce, rec.n); }
  if (!n) { toast('No animals to pet yet.'); return false; }
  state.petDay = dayKey();
  state.stats.collected += n;
  toast(`Your animals loved the attention: +${n} goods`);
  return true;
}

/* Explore */
let exploreLog = [];
function areaOpen(a) { return lvl('foraging') >= a.lvl && unlocked(a.unlock); }
function exploreTable(drops) {
  const lucky = (buffOn('lucky') ? 2 : 1) * (1 + perkVal('keeneye') / 100) * (1 + charmFx('luck') / 100), boost = 1 + lvl('foraging') * 0.03, windy = weather().id === 'windy';
  return Object.entries(drops).map(([k, w]) => {
    if (k !== 'none' && w < 3) w *= boost * lucky;
    if (windy && (k === 'feather' || k === 'eaglefeather')) w *= 2;
    return [k, w];
  });
}
function explore(n) {
  syncStamina();
  const a = I.area[state.area];
  if (!a || !areaOpen(a)) return;
  const times = n === 'all' ? Math.max(0, state.stamina) : Math.min(+n, state.stamina);
  if (times <= 0) { toast('Out of stamina. It refills over time, or eat a meal.'); return; }
  const found = {}, full = new Set();
  let empty = 0;
  const table = exploreTable(a.drops);
  const rares = Object.entries(a.drops).filter(([k, w]) => k !== 'none' && w < 3);
  const pk = 'ex:' + a.id;
  for (let k = 0; k < times; k++) {
    let [id] = pickWeighted(table);
    // bad-luck protection: a rare find is guaranteed within PITY trips
    if (rares.length) {
      if (rares.some(([r]) => r === id)) state.pity[pk] = 0;
      else if ((state.pity[pk] = (state.pity[pk] || 0) + 1) >= PITY.explore) { id = pickWeighted(rares)[0]; state.pity[pk] = 0; }
    }
    if (id === 'none') { empty++; continue; }
    if (addItem(id, 1) === 0) { addOrStash(id, 1); full.add(id); }
    found[id] = (found[id] || 0) + 1;
  }
  spendStamina(times);
  addXP('foraging', a.xp * times);
  state.stats.explores += times;
  const parts = Object.entries(found).map(([id, q]) => chip(id, q > 1 ? q + '×' : null));
  let html;
  if (times === 1 && !parts.length) html = `<span>${esc(a.empty[Math.floor(Math.random() * a.empty.length)])}</span>`;
  else html = `${parts.join('') || '<span>Nothing this time.</span>'}${empty && times > 1 ? `<span class="muted">${empty} empty</span>` : ''}`;
  exploreLog.unshift({ html, when: times > 1 ? `${times} trips` : '1 trip' });
  exploreLog = exploreLog.slice(0, 6);
  if (full.size) toast(`Barn is full of ${[...full].map(itemName).join(', ')}. The extra went to Lost & found in your Bag.`);
  const rare = Object.keys(found).filter(id => (a.drops[id] || 99) < 3);
  if (rare.length) toast(`Rare find: ${rare.map(itemName).join(', ')}!`, 'lvl');
  maybeEncounter(a.id, times);
}
function maybeEncounter(where, tries) {
  const chance = 1 - Math.pow(1 - 0.03 * (1 + charmFx('encounter') / 100), tries);
  if (Math.random() > Math.min(0.35, chance)) return;
  const pool = I.encs.filter(e => e.where.includes(where) && reqMet(e.req) && !(e.once && state.encDone[e.id]));
  if (!pool.length) return;
  const [e] = pickWeighted(pool.map(x => [x, x.weight]));
  setTimeout(() => playAdventure(e, true), 350);
}

/* Mine */
let mineLog = [];
function mineBand(floor) { const b = C.core.mine.bands; return b.find(x => floor >= x.from && floor <= x.to) || (floor > b[b.length - 1].to ? b[b.length - 1] : b[0]); }
const mineMax = () => (C.core.mine.endless ? 999 : C.core.mine.floors);
function mineCheckpoints() { const out = C.core.mine.checkpoints.slice(); for (let f = 30; f <= state.mine.deepest; f += 10) if (!out.includes(f)) out.push(f); return out; }
function mineGate(floor) { return C.core.mine.gates[floor] || 0; }
function dig(n) {
  if (!unlocked('mine')) return;
  syncStamina();
  const times = n === 'all' ? Math.max(0, state.stamina) : Math.min(+n, state.stamina);
  if (times <= 0) { toast('Out of stamina. Rest, or eat something from the kitchen.'); return; }
  const m = state.mine, band = mineBand(m.floor);
  const lucky = (buffOn('lucky') ? 2 : 1) * (1 + perkVal('keeneye') / 100) * (1 + charmFx('luck') / 100) * (m.floor > 30 ? 1 + (m.floor - 30) * 0.05 : 1);
  const table = Object.entries(band.drops).map(([k, w]) => [k, k !== 'none' && w < 3 ? w * lucky : w]);
  for (const r of C.core.mine.rare) if (m.floor >= r.from) table.push([r.item, r.w * lucky]);
  const found = {}, full = new Set();
  let stairsAt = 0;
  for (let k = 0; k < times; k++) {
    if (!m.stairs && m.floor < mineMax()) {
      const p = Math.max(0.04, C.core.mine.stairs + lvl('mining') * 0.004 + (buffOn('miner') ? 0.08 : 0) + perkVal('prospector') / 100 + charmFx('stairs') / 100 - (m.floor > 30 ? Math.min(0.06, (m.floor - 30) * 0.002) : 0));
      if (Math.random() < p) { m.stairs = true; stairsAt = k + 1; }
    }
    let [id] = pickWeighted(table);
    if (m.floor >= 25) {
      if (id === 'starshard') state.pity['mine:star'] = 0;
      else if ((state.pity['mine:star'] = (state.pity['mine:star'] || 0) + 1) >= PITY.starshard) { id = 'starshard'; state.pity['mine:star'] = 0; }
    }
    if (id === 'none') continue;
    if (addItem(id, 1) === 0) { addOrStash(id, 1); full.add(id); }
    found[id] = (found[id] || 0) + 1;
  }
  spendStamina(times);
  addXP('mining', times * (2 + Math.min(m.floor, 30) * 0.25));   // past floor 30 digging pays no more than at 30
  state.stats.digs += times;
  const parts = Object.entries(found).map(([id, q]) => chip(id, q > 1 ? q + '×' : null));
  let html = parts.join('') || `<span>${esc(C.core.mine.empty[Math.floor(Math.random() * C.core.mine.empty.length)])}</span>`;
  if (stairsAt) html += '<span class="chip gold plain">Found the way down!</span>';
  mineLog.unshift({ html, when: `Floor ${m.floor} · ${times} dig${times > 1 ? 's' : ''}` });
  mineLog = mineLog.slice(0, 6);
  if (full.size) toast(`Barn is full of ${[...full].map(itemName).join(', ')}. The extra went to Lost & found in your Bag.`);
  if (found.starshard) toast('A Star Shard! It hums faintly in your hand.', 'lvl', 4200);
  maybeEncounter('mine', times);
}
function descend() {
  const m = state.mine;
  if (!m.stairs || m.floor >= mineMax()) return;
  const next = m.floor + 1, need = mineGate(next);
  if (lvl('mining') < need) { toast(`Hard rock blocks the way. You need Mining ${need} to reach floor ${next}.`); return; }
  m.floor = next; m.stairs = false;
  if (next > m.deepest) { m.deepest = next; addXP('mining', next <= 30 ? 8 * next : 60); toast(`New depth: floor ${next}`, 'lvl'); maybeDelve(next); }
  mineLog.unshift({ html: `<span>You climb down to floor ${next}.</span>`, when: '' });
  mineLog = mineLog.slice(0, 6);
}
function elevator(floor) {
  if (floor > state.mine.deepest || !mineCheckpoints().includes(floor)) return;
  state.mine.floor = floor; state.mine.stairs = false;
  mineLog.unshift({ html: `<span>The old lift creaks down to floor ${floor}.</span>`, when: '' });
}

/* Fishing */
const fishing = { phase: 'idle', fish: null, zone: [0, 0], speed: 1, start: 0, offset: 0, timers: [], raf: 0, msg: '', bait: 'worm' };
let catchLog = [];
const BAITS = ['worm', 'lure', 'glowbait'];
function spotOpen(s) { return lvl('fishing') >= s.lvl && unlocked(s.unlock); }
function clearFishTimers() { fishing.timers.forEach(clearTimeout); fishing.timers = []; cancelAnimationFrame(fishing.raf); }
function fishButton() {
  if (fishing.phase === 'idle' || fishing.phase === 'result') return cast();
  if (fishing.phase === 'waiting') { fishing.msg = 'Not yet. Wait for the bobber to dip…'; syncFishDom(); return; }   // an early tap costs nothing
  if (fishing.phase === 'bite') return reel();
}
function cast() {
  const sp = I.spot[state.spot];
  if (!spotOpen(sp)) return;
  let bait = state.bait;
  if (!have(bait)) {
    const other = BAITS.find(b => have(b));
    if (other) { bait = state.bait = other; renderView(); }
    else { toast("You're out of bait. Buy worms in Town, or dig them up in the Sunny Meadow."); return; }
  }
  takeItem(bait, 1);
  fishing.bait = bait;
  clearFishTimers();
  fishing.phase = 'waiting';
  fishing.msg = 'Waiting for a bite…';
  syncFishDom(); updateBaitCounts();
  play('cast'); setTimeout(() => ripple($('#pond')), 220);
  fishing.timers.push(setTimeout(bite, 500 + Math.random() * 900));
  commit();
}
function bite() {
  const sp = I.spot[state.spot], fl = lvl('fishing');
  const lure = fishing.bait === 'lure', glow = fishing.bait === 'glowbait', fog = weather().id === 'foggy';
  const table = sp.fish.map(([id, w, r]) => {
    if (r >= 2) w *= (lure ? 2 : 1) * (1 + fl * 0.02) * (fog ? 1.4 : 1);
    if (r >= 3 && glow) w *= 1.5;
    if (r === 5 && glow) w *= 4;
    if (r === 5) w *= 1 + perkVal('luckyhook') / 100;
    return [id, w, r];
  });
  let [id, , r] = pickWeighted(table);
  const legend = sp.fish.find(f => f[2] === 5), pk = 'fish:' + sp.id;
  if (legend) {
    if (r === 5) state.pity[pk] = 0;
    else if ((state.pity[pk] = (state.pity[pk] || 0) + 1) >= PITY.legendary) { [id, , r] = legend; state.pity[pk] = 0; }
  }
  const relaxed = state.opts && state.opts.relaxedFish;
  const R = C.core.rarity[r];
  const width = Math.min(relaxed ? 72 : 62, R.zone + Math.min(12, fl * 0.5) + (lure ? 8 : 0) + (buffOn('steady') ? 10 : 0) + perkVal('steady') + charmFx('zone') + (relaxed ? 14 : 0));
  Object.assign(fishing, { fish: { id, r }, zone: [5 + Math.random() * (90 - width), width], speed: R.speed * (relaxed ? 0.55 : 1), offset: Math.random() * 2, start: performance.now(), phase: 'bite' });
  fishing.msg = `<span>Bite!</span><span class="muted">${r === 5 ? 'The line screams. Something enormous!' : r >= 3 ? 'Something big is pulling hard.' : r === 2 ? 'A strong tug.' : 'A nibble.'}</span>`;
  syncFishDom();
  play('bite'); ripple($('#pond'));
  animateNeedle();
  fishing.timers.push(setTimeout(() => {
    if (fishing.phase !== 'bite') return;
    clearFishTimers(); fishing.phase = 'result'; fishing.msg = 'It got away.'; syncFishDom(); play('miss');
  }, relaxed ? 7000 : 4200));
}
function needlePos() {
  const t = (performance.now() - fishing.start) / 1000 * fishing.speed + fishing.offset;
  const x = t % 2;
  return x < 1 ? x : 2 - x;
}
function animateNeedle() {
  const n = $('#needle');
  if (!n || fishing.phase !== 'bite') return;
  n.style.left = (needlePos() * 100) + '%';
  fishing.raf = requestAnimationFrame(animateNeedle);
}
function reel() {
  const pos = needlePos() * 100;
  const [left, width] = fishing.zone;
  clearFishTimers();
  fishing.phase = 'result';
  if (pos >= left - 1 && pos <= left + width + 1) {
    const { id, r } = fishing.fish;
    const name = itemName(id);
    const firstLegend = I.legendary.has(id) && !state.got[id];
    const got = 1;
    if (addItem(id, 1) === 0) { addOrStash(id, 1); toast(`Barn is full of ${name}. It went to Lost & found in your Bag.`); }
    {
      const xp = id === 'boot' ? 1 : C.core.rarity[r].xp;
      addXP('fishing', xp);
      if (I.items[id].t === 'fish' && id !== 'boot') state.stats.fish++;
      const article = r === 5 ? 'the legendary ' : r >= 3 ? 'a rare ' : /^[AEIOU]/.test(name) ? 'an ' : 'a ';
      fishing.msg = `${pic(id, 32)}<span>Caught ${article}${esc(name)}!</span><span class="muted">+${xp} XP</span>`;
      catchLog.unshift(`${pic(id, 24)}<span>${esc(name)}</span><span class="t">${esc(I.spot[state.spot].n)}</span>`);
      catchLog = catchLog.slice(0, 5);
      if (firstLegend) toast(`Legendary catch: ${name}! Tobin will never believe this.`, 'lvl', 5000);
    }
    syncFishDom();
    play(r >= 3 ? 'bigcatch' : 'catch'); ripple($('#pond'));
    { const pond = $('#pond'); if (pond) floatAt(pond.getBoundingClientRect(), `${pic(id, 32)}`); }
    if (r === 5) bloom();
    commit();
  } else {
    fishing.msg = 'Missed. The line went slack.';
    syncFishDom();
    play('miss');
  }
}

/* Workshop and kitchen */
const recipeOpen = r => lvl('crafting') >= r.lvl && unlocked(r.unlock);
const mealOpen = m => lvl('cooking') >= m.lvl;
function maxMake(r) {
  let m = Infinity;
  for (const [id, q] of Object.entries(r.need)) m = Math.min(m, Math.floor(have(id) / q));
  const out = r.out || 1;
  const room = Math.floor((cap() - have(r.id)) / out);
  return Math.max(0, Math.min(m, room));
}
function craft(id, n) {
  const r = I.recipe[id];
  if (!r || !recipeOpen(r)) return;
  const m = maxMake(r), times = n === 'max' ? m : Math.min(+n, m);
  if (times <= 0) { toast('Not enough materials, or your barn is full of these.'); return; }
  for (const [nid, q] of Object.entries(r.need)) takeItem(nid, q * times);
  addItem(r.id, r.out * times);
  addXP('crafting', r.xp * times);
  state.stats.crafted += r.out * times;
  toast(`Made ${r.out * times}× ${itemName(r.id)}`);
}
function cook(id, n) {
  const r = I.meal[id];
  if (!r || !mealOpen(r) || !unlocked('kitchen')) return;
  const m = maxMake(r), times = n === 'max' ? m : Math.min(+n, m);
  if (times <= 0) { toast('Not enough ingredients, or your pantry is full of these.'); return; }
  for (const [nid, q] of Object.entries(r.need)) takeItem(nid, q * times);
  addItem(r.id, times);
  addXP('cooking', r.xp * times);
  state.stats.cooked += times;
  toast(`Cooked ${times}× ${itemName(r.id)}`);
}
const edible = id => { const m = I.meal[id]; return !!m && (m.stamina || m.buff); };
function eat(id) {
  const m = I.meal[id];
  if (!m || !have(id) || !edible(id)) return false;
  syncStamina();
  if (m.stamina && state.stamina >= maxStamina() * 2 && !m.buff) { toast("You're too full to eat another bite."); return false; }
  takeItem(id, 1);
  const bits = [];
  if (m.stamina) { state.stamina = Math.min(maxStamina() * 2, state.stamina + m.stamina); bits.push(`+${m.stamina} stamina`); }
  if (m.buff) { setBuff(m.buff, m.mins || 15); bits.push(`${I.buffs[m.buff].n} for ${m.mins || 15} min`); }
  toast(`${itemName(id)}: ${bits.join(', ')}`);
  return true;
}

/* Selling */
function sell(id, n) {
  if (!I.items[id] || I.items[id].t === 'key') return 0;
  const q = n === 'all' ? have(id) : Math.min(+n, have(id));
  if (q <= 0) return 0;
  takeItem(id, q);
  const c = q * priceOf(id);
  state.coins += c;
  state.stats.earned += c;
  return c;
}

/* Townsfolk */
function curRequest(vid) { const v = I.vil[vid]; return v && v.requests ? v.requests[state.reqs[vid] || 0] || null : null; }
function canDeliver(vid) { const q = curRequest(vid); return !!q && reqMet(q.req) && hasAll(q.want) && vilAvailable(I.vil[vid]); }
function deliverRequest(vid) {
  const v = I.vil[vid], q = curRequest(vid);
  if (!q || !canDeliver(vid)) return null;
  takeAll(q.want);
  const lines = applyGive(q.give);
  addFriend(vid, C.core.friendship.request);
  state.reqs[vid] = (state.reqs[vid] || 0) + 1;
  state.stats.delivered++;
  if (state.stats.delivered % 3 === 0) gainInsp(1, 'a good neighbour');
  return { v, lines };
}
function giftReaction(vid, id) {
  const v = I.vil[vid], f = C.core.friendship;
  if ((v.loves || []).includes(id)) return ['loved', f.loved];
  if ((v.likes || []).includes(id)) return ['liked', f.liked];
  if ((v.dislikes || []).includes(id)) return ['disliked', f.disliked];
  return ['neutral', f.neutral];
}
function giveGift(vid, id) {
  if (state.gifted[vid] === dayKey() || !have(id) || I.items[id].t === 'key') return null;
  takeItem(id, 1);
  const [kind, pts] = giftReaction(vid, id);
  addFriend(vid, pts);
  state.gifted[vid] = dayKey();
  state.stats.gifts++;
  return kind;
}
function heartSceneReady(vid) {
  const v = I.vil[vid];
  return (v.hearts || []).find(h => hearts(vid) >= h.at && !(state.heartSeen[vid] || {})[h.at]) || null;
}

/* Store and merchant */
function plotCost() { const p = C.core.plots; return Math.round(p.base * Math.pow(p.growth, state.plots.length - p.start) / 10) * 10; }
function buyStore(id) {
  const s = C.core.store.find(x => x.id === id);
  if (!s || !unlocked(s.unlock) || state.coins < storePrice(s)) return false;
  const got = addItem(s.item, s.qty);
  if (!got) { toast(`Your barn is full of ${itemName(s.item)}.`); return false; }
  state.coins -= storePrice(s);
  toast(`Bought ${got}× ${itemName(s.item)}`);
  return true;
}
function ensureMerchant() {
  if (!unlocked('merchant')) return;
  const key = dayKey();
  if (state.merchant && state.merchant.day === key) return;
  const rnd = seeded('saffi-' + key);
  const pool = C.core.merchant.pool.slice().sort(() => rnd() - 0.5).slice(0, 4);
  const wants = C.core.merchant.wants;
  state.merchant = { day: key, stock: pool.map(p => Object.assign({ sold: false }, p)), want: wants[Math.floor(rnd() * wants.length)], sold: 0 };
}
function merchantBuy(i) {
  ensureMerchant();
  const s = state.merchant.stock[i];
  if (!s || s.sold || state.coins < s.price) return false;
  const got = addItem(s.item, s.qty);
  if (!got) { toast('Your barn has no room for that.'); return false; }
  state.coins -= s.price; s.sold = true;
  toast(pickLine(I.merchant.sold) || 'Pleasure doing business!');
  return true;
}
function merchantSell() {
  ensureMerchant();
  const id = state.merchant.want;
  const n = Math.min(have(id), 10 - (state.merchant.sold || 0));
  if (n <= 0) return 0;
  takeItem(id, n);
  const c = n * priceOf(id) * 2;
  state.coins += c; state.stats.earned += c; state.merchant.sold = (state.merchant.sold || 0) + n;
  toast(`${pickLine(I.merchant.bought) || 'A fine trade.'} +${fmtN(c)} coins`);
  return c;
}
const pickLine = arr => (arr && arr.length ? fill(arr[Math.floor(Math.random() * arr.length)]) : '');

/* Daily chores */
function ensureChores() {
  const key = dayKey();
  if (state.chores && state.chores.day === key) return;
  const rnd = seeded('chores-' + key);
  const pool = C.core.chores.filter(c => unlocked(c.unlock)).sort(() => rnd() - 0.5).slice(0, 3);
  const scale = 1 + Math.floor(Object.values(state.xp).reduce((a, x) => a + levelInfo(x).lvl, 0) / 15) * 0.5;
  state.chores = { day: key, bonus: false, list: pool.map(c => ({ id: c.id, n: Math.ceil(c.n * (c.id === 'deliver' || c.id === 'gift' ? 1 : scale)), coins: Math.round(c.coins * scale), base: state.stats[c.stat] || 0, claimed: false })) };
}
function choreProgress(c) { const d = C.core.chores.find(x => x.id === c.id); return Math.min(c.n, (state.stats[d.stat] || 0) - c.base); }
function claimChore(i) {
  ensureChores();
  const c = state.chores.list[i], d = C.core.chores.find(x => x.id === c.id);
  if (!c || c.claimed || choreProgress(c) < c.n) return false;
  c.claimed = true; state.coins += c.coins;
  for (const [id, n] of Object.entries(d.items || {})) addItem(id, n);
  toast(`Chore done: +${c.coins} coins`);
  return true;
}

/* Mail */
function letterDue(l) {
  const w = l.when || {};
  if (w.chapter && !chapterDone(w.chapter)) return false;
  if (w.started && !chapterStarted(w.started)) return false;
  if (w.day && dayNumber() < w.day) return false;
  if (w.flag && !state.flags[w.flag]) return false;
  for (const [vid, n] of Object.entries(w.hearts || {})) if (hearts(vid) < n) return false;
  return true;
}
function checkMail() {
  const known = new Set(state.mail.map(m => m.id));
  for (const l of I.letters) {
    if (known.has(l.id) || !letterDue(l)) continue;
    state.mail.unshift({ id: l.id, read: false, claimed: false, at: now() });
    toast(`New letter from ${vilShort(l.from)}`);
  }
}

/* Achievements */
function statValue(kind) {
  switch (kind) {
    case 'deepest': return state.mine.deepest;
    case 'besthearts': return Math.max(0, ...I.vils.map(v => hearts(v.id)));
    case 'adventures': return I.advs.filter(a => state.advDone[a.id]).length;
    case 'pages': return Object.keys(state.pages).length;
    case 'bestskill': return Math.max(...I.skills.map(s => lvl(s.id)));
    case 'fishkinds': return I.fishKinds.filter(id => state.got[id]).length;
    case 'legendary': return [...I.legendary].filter(id => state.got[id]).length;
    case 'chapters': return Object.keys(state.story.done).length;
    case 'pets': return Object.keys(state.pets || {}).length;
    case 'creatures': return Object.keys(state.bestiary || {}).length;
    case 'delves': return Object.keys(state.delvesDone || {}).length;
    default: return state.stats[kind] || 0;
  }
}
function achGoal(a) {
  if (a.goal !== -1) return a.goal;
  return { adventures: I.advs.length, pages: I.pages.length, fishkinds: I.fishKinds.length, chapters: I.chapters.length, creatures: (C.bestiary.creatures || []).length }[a.stat] || 1;
}
function checkAchievements() {
  for (const a of I.ach) {
    if (state.ach[a.id] || statValue(a.stat) < achGoal(a)) continue;
    state.ach[a.id] = now();
    applyGive(a.give);
    play('feat', 0.3);
    toast(`Feat unlocked: ${a.n}`, 'lvl', 4200);
  }
}
