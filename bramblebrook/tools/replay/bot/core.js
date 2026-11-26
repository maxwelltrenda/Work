// In-page player bot for Bramblebrook. Evaluated INSIDE the game's IIFE via __bb.ev(source), so every
// engine function and `state` is in scope. It never edits state directly to gain anything: every action
// goes through the same handle()/engine call a tap would, and costs simulated seconds of the player's time.
// The only shortcut: fishing reels are always perfect (reel() is called with the needle in the zone).
(function () {
  const F = window.__fake;
  const CFG = window.__botCfg || {};
  const TIME = Object.assign({ open: 8, tap: 2, explore: 2.5, dig1: 1.3, dig10: 2.5, craft: 3, sell: 2.5, buy: 3, line: 3, choice: 5, dice: 4, cast: 5, eat: 1.5, claim: 4 }, CFG.time || {});
  const LOG = [];
  let S = null;                       // the current session
  const tot = { prod: 0, filler: 0, wait: 0, sessions: 0, staminaSpent: 0, casts: 0, fillerCasts: 0, explores: 0, digs: 0, advLosses: 0, encounters: 0 };
  const stepLog = {};                 // "ci.si" -> { t0, t1, sessions, stamina, reasons:{} }
  const log = (...a) => LOG.push(`[d${dayNumber()} ${new Date(F.t).toISOString().slice(11, 16)}] ` + a.join(' '));

  /* ---------- time ---------- */
  let VER = 0;   // bumped whenever time passes or the player acts, so plans can be cached in between
  function T(sec, kind = 'prod') {
    VER++;
    F.t += Math.round(sec * 1000);
    window.__runTimers();
    if (S) { S[kind] = (S[kind] || 0) + sec; tot[kind] = (tot[kind] || 0) + sec; }
    drain();
  }
  const left = () => (S.end - F.t) / 1000;

  /* ---------- UI taps ---------- */
  // where coins come from (feats and mastery are split out of whatever tap triggered them)
  const ledger = {};
  const credit = (tag, d) => { if (d) ledger[tag] = (ledger[tag] || 0) + d; };
  const _ca = checkAchievements, _cm = checkMastery;
  let inner = 0;
  checkAchievements = function () { const c = state.coins; _ca(); const d = state.coins - c; credit('feats', d); inner += d; };
  checkMastery = function (id) { const c = state.coins; _cm(id); const d = state.coins - c; credit('mastery', d); inner += d; };
  function tap(a, data = {}, sec = TIME.tap) {
    const c0 = state.coins; inner = 0;
    if (S) S.taps = (S.taps || 0) + 1;
    VER++;
    const r = handle(a, { dataset: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])) });
    VER++;
    if (r) commit();
    const tag = a === 'sell' ? 'sell:' + (I.items[data.id] ? I.items[data.id].t : '?') : a;
    credit(tag, state.coins - c0 - inner);
    T(sec);
    return r;
  }

  /* ---------- scenes, adventures, encounters ---------- */
  let draining = false;
  function drain() {
    if (draining) return;
    draining = true;
    try {
      for (let g = 0; g < 3000; g++) {
        const root = document.querySelector('#scene-root');
        let b;
        const sheet = document.querySelector('#sheet-root');
        const picks = sheet ? [...sheet.querySelectorAll('.party-pick')] : [];
        if (picks.length) { pickParty(picks); T(TIME.choice); continue; }
        if ((b = root.querySelector('[data-dice="go"]'))) { b.click(); T(TIME.dice); continue; }
        if ((b = root.querySelector('[data-scene-next].btn'))) { b.click(); T(TIME.line); continue; }
        const sc = root.querySelectorAll('[data-scene-choice]');
        if (sc.length) { sc[0].click(); T(TIME.line); continue; }
        if ((b = root.querySelector('[data-adv-done]'))) {
          const n = advRun && advRun.def.nodes[advRun.cur];
          if (n && n.end !== 'win') { if (!advRun.isEnc) { if (I.adv[advRun.def.id] && I.chapters.some(c => c.steps.some(st => st.type === 'adventure' && st.id === advRun.def.id))) tot.advLosses++; else tot.otherLosses = (tot.otherLosses || 0) + 1; } log('adventure ended', n.end, advRun.def.id); }
          b.click(); T(TIME.line); continue;
        }
        if (advRun && root.querySelector('[data-adv-choice]')) { if (!advChoose()) break; T(TIME.choice); continue; }
        break;
      }
      if (document.querySelector('#sheet-root').innerHTML && !document.querySelector('#sheet-root .party-pick')) closeSheet();
    } finally { draining = false; }
  }
  function pickParty(picks) {
    // a companion who helps with foraging rolls (most story rolls), else go alone
    const comps = C.companions.companions;
    let best = picks.find(p => p.dataset.c && (comps[p.dataset.c].skills || []).includes('foraging'));
    if (!best) best = picks.find(p => !p.dataset.c) || picks[0];
    best.click();
  }
  function advChoose() {
    const def = advRun.def, n = def.nodes[advRun.cur];
    const btns = [...document.querySelectorAll('#scene-root [data-adv-choice]')];
    let best = null, bs = -1e9;
    btns.forEach(btn => {
      if (btn.disabled) return;
      const i = +btn.dataset.advChoice, c = n.ch[i];
      const nx = def.nodes[c.go];
      let s = 10;
      if (nx && nx.end === 'lose') s -= 100;
      if (c.roll) { s = 10 * chanceOf(checkFor(c.roll)) - 2; if (c.fail && def.nodes[c.fail] && def.nodes[c.fail].end === 'lose') s -= 6; }
      if (c.cost) s -= c.cost.coins ? 1.5 : c.cost.stamina ? 1 : 0.5;
      if (c.req) s += 0.5;
      if (s > bs) { bs = s; best = btn; }
    });
    if (!best) {
      const l = document.querySelector('#scene-root [data-adv-leave]');
      if (l) { l.click(); log('left adventure, no enabled choice', def.id); }
      return false;
    }
    best.click();
    return true;
  }
  // encounters are started by a 350 ms timer after explore/dig; count them
  const _pa = playAdventure;

  if (CFG.fast) {
    const noop = () => {};
    renderView = noop; updateHeader = noop; updateBadges = noop; renderTabs = noop; saveLocal = noop; play = noop; toast = noop;
    try { maybeTour = noop; } catch (e) {}
  }

  /* ---------- knowledge a player builds up: where things come from ---------- */
  const SRC = {};   // item -> [{kind, ...}]
  const addSrc = (id, s) => (SRC[id] = SRC[id] || []).push(s);
  I.areas.forEach(a => { const tot = Object.values(a.drops).reduce((x, y) => x + y, 0); for (const [id, w] of Object.entries(a.drops)) if (id !== 'none') addSrc(id, { kind: 'area', id: a.id, w, tot, rare: w < 3 }); });
  C.core.mine.bands.forEach(b => { const tot = Object.values(b.drops).reduce((x, y) => x + y, 0); for (const [id, w] of Object.entries(b.drops)) if (id !== 'none') addSrc(id, { kind: 'mine', from: b.from, to: b.to, w, tot, rare: w < 3 }); });
  C.core.mine.rare.forEach(r => addSrc(r.item, { kind: 'mine', from: r.from, to: 999, w: r.w, tot: 90, rare: true, pity: 70 }));
  I.crops.forEach(c => addSrc(c.id, { kind: 'crop', id: c.id }));
  I.trees.forEach(t => addSrc(t.id, { kind: 'tree', id: t.id }));
  I.animals.forEach(a => addSrc(a.produce, { kind: 'animal', id: a.id }));
  I.spots.forEach(sp => { const tot = sp.fish.reduce((x, f) => x + f[1], 0); sp.fish.forEach(([id, w, r]) => addSrc(id, { kind: 'fish', spot: sp.id, w, tot, r })); });

  function areaP(src) {
    const a = I.area[src.id];
    let w = src.w;
    if (src.rare) w *= (1 + lvl('foraging') * 0.03) * (buffOn('lucky') ? 2 : 1) * (1 + perkVal('keeneye') / 100) * (1 + charmFx('luck') / 100);
    const p = w / src.tot;
    return src.rare ? Math.max(p, 1 / 90) : p;   // the pity timer guarantees one rare per 90 trips
  }
  function mineP(src) {
    let w = src.w;
    if (src.rare) w *= (buffOn('lucky') ? 2 : 1) * (1 + perkVal('keeneye') / 100) * (1 + charmFx('luck') / 100);
    const p = w / src.tot;
    return src.pity ? Math.max(p, 1 / src.pity) : p;
  }
  const mineReach = () => mineGateMaxFloor();
  function mineGateMaxFloor() { let f = 1; while (f < 60 && lvl('mining') >= mineGate(f + 1)) f++; return f; }
  // best stamina source for an item that is open now (or reachable by digging deeper)
  function staminaSource(id) {
    let best = null;
    for (const s of SRC[id] || []) {
      if (s.kind === 'area') {
        const a = I.area[s.id];
        if (!areaOpen(a) || !featureOn('wilds:' + s.id) && false) continue;
        const p = areaP(s);
        if (!best || p > best.p) best = { kind: 'explore', area: s.id, p };
      } else if (s.kind === 'mine' && unlocked('mine')) {
        const reach = Math.min(mineReach(), s.to);
        if (s.from > mineReach()) continue;
        const p = mineP(s) * (s.from > state.mine.deepest ? 0.5 : 1);   // still has to dig down to it
        if (!best || p > best.p) best = { kind: 'dig', from: s.from, to: s.to, p, deeper: s.from > state.mine.deepest };
      }
    }
    return best;
  }

  /* ---------- what the player is working towards ---------- */
  const isCraft = id => !!I.recipe[id];
  const isMeal = id => !!I.meal[id];
  const NOT_MADE = new Set(['lure', 'glowbait', 'tonic']);   // bought or found more easily than made
  function expand(want, virt, out, tag) {
    const need = (id, n, depth) => {
      const h = virt[id] || 0, use = Math.min(h, n);
      virt[id] = h - use;
      const d = n - use;
      if (d <= 0 || depth > 8) return;
      const r = I.recipe[id] || I.meal[id];
      if (r && !NOT_MADE.has(id)) {
        const outN = r.out || 1, times = Math.ceil(d / outN);
        out.makes.push({ id, times, kind: I.recipe[id] ? 'craft' : 'cook', lvl: r.lvl, tag });
        const sk = I.recipe[id] ? 'crafting' : 'cooking';
        out.skills[sk] = Math.max(out.skills[sk] || 0, r.lvl);
        virt[id] = (virt[id] || 0) + times * outN - d;
        for (const [ing, q] of Object.entries(r.need)) need(ing, q * times, depth + 1);
      } else out.raw[id] = (out.raw[id] || 0) + d;
    };
    for (const [id, n] of Object.entries(want)) need(id, n, 0);
  }
  let snC = null, snV = -1, rnC = null, rnV = -1;
  function storyNeeds() { if (snV !== VER || !snC) { snC = storyNeeds0(); snV = VER; } return snC; }
  function requestNeeds(story) { if (rnV !== VER || !rnC || story !== snC) { rnC = requestNeeds0(story); rnV = VER; } return rnC; }
  function storyNeeds0() {
    const out = { hold: {}, raw: {}, acquire: {}, makes: [], skills: {}, floor: 0, explores: 0, cooked: 0, adventure: null, step: null };
    const s = curStep();
    out.step = s;
    if (!s) return out;
    const virt = Object.assign({}, state.inv);
    if (s.type === 'deliver') { for (const [id, n] of Object.entries(s.want)) out.hold[id] = n; expand(s.want, virt, out, 'story'); }
    if (s.type === 'gather') { const [a, b] = stepProgress(s); const d = b - a; if (d > 0) { out.acquire[s.item] = d; const r = I.recipe[s.item] || I.meal[s.item]; if (r) expand({ [s.item]: d + (virt[s.item] || 0) }, virt, out, 'story'); else out.raw[s.item] = d; } }
    if (s.type === 'stat' && s.stat === 'explores') { const [a, b] = stepProgress(s); out.explores = b - a; }
    if (s.type === 'stat' && s.stat === 'cooked') { const [a, b] = stepProgress(s); out.cooked = b - a; if (b - a > 0) expand({ bread: (virt.bread || 0) + (b - a) }, virt, out, 'story'); }
    if (s.type === 'stat' && !['explores', 'cooked'].includes(s.stat)) { const [a, b] = stepProgress(s); out.other = s.stat; out.otherLeft = b - a; }
    if (s.type === 'level') out.skills[s.skill] = Math.max(out.skills[s.skill] || 0, s.lvl);
    if (s.type === 'mine') out.floor = s.floor;
    if (s.type === 'adventure') out.adventure = s.id;
    // what the next move needs in skills: a mine floor behind a gate
    if (out.floor) { for (let f = state.mine.deepest + 1; f <= out.floor; f++) if (mineGate(f)) out.skills.mining = Math.max(out.skills.mining || 0, mineGate(f)); }
    // crops behind a flag or level
    for (const id of Object.keys(out.raw)) { const c = I.crop[id]; if (c) out.skills.farming = Math.max(out.skills.farming || 0, c.lvl); }
    // mine items behind a gate
    for (const id of Object.keys(out.raw)) {
      const ms = (SRC[id] || []).filter(x => x.kind === 'mine');
      const as = (SRC[id] || []).filter(x => x.kind === 'area' && areaOpen(I.area[x.id]));
      if (ms.length && !as.length) { const f = Math.min(...ms.map(x => x.from)); for (let g = 2; g <= f; g++) if (mineGate(g)) out.skills.mining = Math.max(out.skills.mining || 0, mineGate(g)); out.floorFor = Math.max(out.floorFor || 0, f); }
    }
    out.virt = virt;
    return out;
  }
  function openRequests() {
    const list = [];
    for (const v of I.vils) {
      if (!vilAvailable(v)) continue;
      const q = curRequest(v.id);
      if (!q || !reqMet(q.req)) continue;
      list.push({ vid: v.id, q });
    }
    return list;
  }
  function requestNeeds0(story) {
    const out = { hold: {}, raw: {}, makes: [], skills: {} };
    const virt = Object.assign({}, story.virt || state.inv);
    for (const { q } of openRequests()) {
      // skip requests that need crafts above our level: those are for later
      const probe = { hold: {}, raw: {}, makes: [], skills: {} };
      expand(q.want, Object.assign({}, virt), probe, 'req');
      if ((probe.skills.crafting || 0) > lvl('crafting') || (probe.skills.cooking || 0) > lvl('cooking')) continue;
      if (Object.keys(probe.raw).some(id => !rawObtainable(id))) continue;
      for (const [id, n] of Object.entries(q.want)) out.hold[id] = (out.hold[id] || 0) + n;
      expand(q.want, virt, out, 'req');
    }
    return out;
  }
  function rawObtainable(id) {
    for (const s of SRC[id] || []) {
      if (s.kind === 'crop' && cropOpen(I.crop[s.id])) return true;
      if (s.kind === 'area' && areaOpen(I.area[s.id])) return true;
      if (s.kind === 'mine' && unlocked('mine') && s.from <= mineReach()) return true;
      if (s.kind === 'animal' && (animalRec(s.id).n || unlocked(I.animal[s.id].unlock))) return true;
      if (s.kind === 'fish' && tabOn('fish') && spotOpen(I.spot[s.spot]) && s.r <= 2) return true;
      if (s.kind === 'tree' && state.orchard.some(o => o && o.tree === s.id)) return true;
    }
    return false;
  }

  /* ---------- keep / sell ---------- */
  const RESERVE_IDS = new Set(['wheat', 'wood', 'pebble', 'copper', 'coal', 'iron', 'silver', 'gold', 'clay', 'honeycomb', 'egg', 'milk', 'wool', 'berries', 'wildflower', 'twine', 'rope', 'plank', 'block', 'copperbar', 'ironbar', 'silverbar', 'goldbar', 'candle', 'crystal', 'starshard', 'glowcap', 'feather', 'clover', 'sap', 'acorn', 'mushroom', 'fern']);
  const NEVER_SELL = new Set(['worm', 'lure', 'glowbait', 'tonic', 'crystal', 'starshard', 'moonbloom']);
  function keepOf(id, story, req) {
    const it = I.items[id];
    if (!it || it.t === 'key' || it.t === 'charm' || NEVER_SELL.has(id)) return Infinity;
    if (I.recipe[id] && I.recipe[id].upgrade) return Infinity;
    if (isMeal(id) && (I.meal[id].stamina || I.meal[id].buff)) return Infinity;   // food is for eating
    let k = (story.hold[id] || 0) + (story.raw[id] || 0) + (req.hold[id] || 0) + (req.raw[id] || 0);
    for (const m of story.makes.concat(req.makes)) { const r = I.recipe[m.id] || I.meal[m.id]; if (r.need[id]) k += r.need[id] * m.times; }
    if (RESERVE_IDS.has(id)) k = Math.max(k, Math.min(cap(), 30));
    return k;
  }
  function sellSurplus(force) {
    const story = storyNeeds(), req = requestNeeds(story);
    let earned = 0, kinds = 0;
    for (const id of Object.keys(state.inv)) {
      const k = keepOf(id, story, req);
      if (!isFinite(k)) continue;
      const extra = have(id) - k;
      if (extra <= 0) continue;
      // sell everything surplus when we want coins or the barn is near full of it
      if (!force && have(id) < cap() * 0.8 && I.items[id].s * extra < 40) continue;
      const before = state.coins;
      if (extra >= have(id)) tap('sell', { id, n: 'all' }, TIME.sell);
      else tap('sell', { id, n: extra }, TIME.sell);
      earned += state.coins - before; kinds++;
    }
    return earned;
  }

  /* ---------- farm ---------- */
  const cropVal = id => priceOf(id) - seedCost(I.crop[id]);
  // seconds a crop takes as the engine will plant it: growFactor(), plus the global growScale unless growFactor already applies it
  const effGrow = c => c.grow * growFactor() * (/growScale/.test(String(growFactor)) ? 1 : (C.core.growScale || 1));
  function harvestAll() {
    const ready = state.plots.some(p => p.crop && p.ready <= now());
    if (!ready) return false;
    const anyReady = () => state.plots.some(p => p.crop && p.ready <= now());
    if (perkRank('harvestall') || !C.core.perks.some(p => p.id === 'harvestall')) { for (let k = 0; k < 12 && anyReady(); k++) tap('harvest-all'); }   // each tap takes as many as Big Basket's level allows
    state.plots.forEach((p, i) => { if (p.crop && p.ready <= now()) tap('plot', { i }, 1); });   // the rest, one tap a plot
    return true;
  }
  function chooseSeeds(emptyN, inSession) {
    // story / request crop needs first, then the best crop for how long we will be away
    const story = storyNeeds(), req = requestNeeds(story);
    const plan = [];
    const growing = {};
    state.plots.forEach(p => { if (p.crop) growing[p.crop] = (growing[p.crop] || 0) + 1; });
    const wantCrop = {};
    const addWant = (raw, mult) => { for (const [id, n] of Object.entries(raw)) if (I.crop[id] && cropOpen(I.crop[id])) wantCrop[id] = (wantCrop[id] || 0) + n * mult; };
    addWant(story.raw, 1); addWant(req.raw, 1);
    // crafting xp grind wants wheat (twine, rope)
    if ((story.skills.crafting || 0) > lvl('crafting') && tabOn('make')) wantCrop.wheat = Math.max(wantCrop.wheat || 0, 12);
    for (const [id, n] of Object.entries(wantCrop).sort((a, b) => (story.raw[b[0]] ? 1 : 0) - (story.raw[a[0]] ? 1 : 0))) {
      let k = Math.max(0, Math.ceil(n) - (growing[id] || 0));
      while (k-- > 0 && plan.length < emptyN) plan.push(id);
    }
    const open = I.crops.filter(c => cropOpen(c) && state.coins >= seedCost(c));
    if (!open.length) return plan;
    let filler;
    const tl = inSession ? left() : 1e9;
    const g = effGrow;
    if (inSession && CFG.cycle !== false) {
      // the best coins per second we can still harvest before leaving
      const fits = open.filter(c => g(c) + 10 < tl);
      if (fits.length) filler = fits.sort((a, b) => cropVal(b.id) / (g(b) + 25) - cropVal(a.id) / (g(a) + 25))[0];
    }
    if (!filler && !inSession && S && S.away) {
      // leaving: the most valuable crop that will be ready when we are back (a person picks a crop for the time away)
      const fits = open.filter(c => g(c) <= S.away + 120);
      if (fits.length) filler = fits.sort((a, b) => cropVal(b.id) - cropVal(a.id))[0];
    }
    if (!filler) filler = open.slice().sort((a, b) => g(a) - g(b))[0];
    while (plan.length < emptyN) plan.push(filler.id);
    return plan;
  }
  function plantEmpty(inSession) {
    const empty = state.plots.map((p, i) => (!p.crop ? i : -1)).filter(i => i >= 0);
    if (!empty.length) return false;
    const plan = chooseSeeds(empty.length, inSession);
    if (!plan.length) return false;
    let did = false;
    const groups = {};
    plan.forEach((id, k) => (groups[id] = groups[id] || []).push(empty[k]));
    for (const [id, idxs] of Object.entries(groups)) {
      if (state.seed !== id) tap('seed', { id }, 1);
      if ((perkRank('sowall') || !C.core.perks.some(p => p.id === 'sowall')) && idxs.length === empty.length && Object.keys(groups).length === 1) {
        for (let k = 0; k < 12 && state.plots.some(p => !p.crop); k++) { const before = state.plots.filter(p => !p.crop).length; if (tap('sow-all', {}, TIME.tap)) did = true; if (state.plots.filter(p => !p.crop).length === before) break; }
      }
      else for (const i of idxs) { if (tap('plot', { i }, 1)) did = true; }
    }
    return did;
  }
  function animalsAndTrees() {
    let did = false;
    if (I.animals.some(a => animalState(a).ready > 0)) { tap('collect-all'); did = true; }
    if (state.orchard.some(s => s && treeState(s).ready > 0)) { tap('harvest-trees'); did = true; }
    if (featureOn('farm:animals') && typeof pettedToday === 'function') {
      const pens = I.animals.filter(a => animalRec(a.id).n && !pettedToday(a.id));
      if (pens.length) { const r = perkRank('petall'); if (r >= 2) tap('pet'); else for (const a of pens) { if (r) tap('pet-pen', { id: a.id }, 1); else for (let i = 0; i < animalRec(a.id).n; i++) if (!pettedIdx(a.id).includes(i)) tap('pet-one', { id: a.id, i }, 1); } did = true; }   // each animal, then each pen, then everyone
    } else if (featureOn('farm:animals') && state.petDay !== dayKey() && I.animals.some(a => animalRec(a.id).n)) { tap('pet'); did = true; }
    return did;
  }

  /* ---------- making ---------- */
  function doMakes(makes) {
    // innermost first; craft as much of each as the chain needs and we can make now
    let did = false;
    for (let pass = 0; pass < 4; pass++) {
      let any = false;
      for (const m of makes.slice().reverse()) {
        if (m.kind === 'craft' && (!tabOn('make') || !recipeOpen(I.recipe[m.id]))) continue;
        if (m.kind === 'cook' && (!subOn('make', 'kitchen') || !unlocked('kitchen') || !mealOpen(I.meal[m.id]))) continue;
        const r = I.recipe[m.id] || I.meal[m.id];
        const can = maxMake(r);
        const n = Math.min(m.times - (m.done || 0), can);
        if (n <= 0) continue;
        tap(m.kind, { id: m.id, n: n === can && n > 1 ? 'max' : (n === 1 ? 1 : n) }, TIME.craft + (n > 1 && n !== can ? Math.min(n - 1, 5) * 1 : 0));
        m.done = (m.done || 0) + n;
        any = did = true;
      }
      if (!any) break;
    }
    return did;
  }
  function makeStory() {
    const story = storyNeeds();
    let did = doMakes(story.makes);
    return did;
  }
  function makeRequests() {
    const story = storyNeeds(), req = requestNeeds(story);
    return doMakes(req.makes);
  }
  // levelling a craft skill the story asks for: make anything worthwhile from what is spare
  function xpCraft(sk, force) {
    const story = storyNeeds(), req = requestNeeds(story);
    const want = story.skills[sk] || 0;
    if (!force && lvl(sk) >= want) return false;
    if (sk === 'crafting' && !tabOn('make')) return false;
    if (sk === 'cooking' && !(unlocked('kitchen') && subOn('make', 'kitchen'))) return false;
    const list = (sk === 'crafting' ? I.recipes.filter(r => recipeOpen(r)) : I.meals.filter(m => mealOpen(m)));
    const spare = id => have(id) - ((story.hold[id] || 0) + (story.raw[id] || 0) + (req.hold[id] || 0));
    const val = r => Object.entries(r.need).reduce((x, [i, q]) => x + q * I.items[i].s, 0) || 1;
    const sorted = list.filter(r => !r.upgrade).sort((a, b) => b.xp / val(b) - a.xp / val(a));
    let did = false;
    for (const r of sorted) {
      let n = Infinity;
      for (const [i, q] of Object.entries(r.need)) n = Math.min(n, Math.floor(Math.max(0, spare(i)) / q));
      n = Math.min(n, maxMake(r));
      if (n <= 0) continue;
      tap(sk === 'crafting' ? 'craft' : 'cook', { id: r.id, n: n === maxMake(r) && n > 1 ? 'max' : n }, TIME.craft);
      did = true;
    }
    return did;
  }
  function benchWork() {
    if (!subOn('make', 'bench') || !benchOpen()) return false;
    let did = false;
    state.bench.forEach((slot, i) => { if (slot && benchState(slot).ready > 0) { tap('bench-collect', { i }); did = true; } });
    const story = storyNeeds(), req = requestNeeds(story);
    const spare = id => have(id) - ((story.hold[id] || 0) + (story.raw[id] || 0) + (req.hold[id] || 0) + (RESERVE_IDS.has(id) ? 0 : 0));
    const val = r => Object.entries(r.need).reduce((x, [i, q]) => x + q * I.items[i].s, 0) || 1;
    state.bench.forEach((slot, i) => {
      if (slot) return;
      // something the story chain needs first, else the best xp per value we have spare
      const chainIds = story.makes.filter(m => m.kind === 'craft').map(m => m.id);
      const cands = I.recipes.filter(r => recipeOpen(r) && !r.upgrade).sort((a, b) => (chainIds.includes(b.id) - chainIds.includes(a.id)) || (b.xp / val(b) - a.xp / val(a)));
      for (const r of cands) {
        let n = Infinity;
        for (const [id, q] of Object.entries(r.need)) n = Math.min(n, Math.floor(Math.max(0, spare(id)) / q));
        n = Math.min(n, C.core.workbench.maxQueue);
        if (n < 3 && !chainIds.includes(r.id)) continue;
        if (n <= 0) continue;
        if (tap('bench-queue', { i, id: r.id, n: 'max' })) { did = true; break; }
      }
    });
    return did;
  }

  function upgradesWork() {
    if (!featureOn('upgrades') || !tabOn('make')) return false;
    const story = storyNeeds();
    for (const kind of ['sprinkler', 'scarecrow']) {
      const nx = C.core.upgrades[kind].tiers[state.upgrades[kind]];
      if (!nx || have(nx.item)) continue;
      const r = I.recipe[nx.item];
      if (!recipeOpen(r)) continue;
      const spareOk = Object.entries(r.need).every(([id, q]) => have(id) - q >= (story.hold[id] || 0) + (story.raw[id] || 0));
      if (!spareOk || maxMake(r) < 1) continue;
      tap('craft', { id: r.id, n: 1 }, TIME.craft);
      tap('install', { id: kind });
      log('installed', r.id);
      return true;
    }
    return false;
  }

  /* ---------- buying ---------- */
  function reserveCoins() {
    const story = storyNeeds();
    let r = 120;
    if (story.raw.moonbloom) r += 220;
    return r;
  }
  function shop() {
    let did = false;
    const R = reserveCoins();
    // perks, charms, upgrades: free things a player does as soon as they see them
    if (featureOn('bag:perks')) {
      const order = ['harvestall', 'sowall', 'trips', 'petall', 'rest', 'trail', 'prospector', 'greenthumb', 'keeneye', 'thrifty', 'haggler', 'bumper', 'deep', 'kind', 'steady', 'luckyhook'];
      for (const id of order) while (C.core.perks.some(p => p.id === id) && perkPointsFree() > 0 && perkRank(id) < C.core.perks.find(p => p.id === id).max) { if (!tap('perk', { id })) break; did = true; }
    }
    for (const id of Object.keys(state.inv)) if (isCharm(id) && !state.charms.includes(id) && state.charms.length < C.core.charmSlots) { tap('charm-on', { id }); did = true; }
    if (featureOn('upgrades')) for (const kind of ['sprinkler', 'scarecrow']) { const nx = C.core.upgrades[kind].tiers[state.upgrades[kind]]; if (nx && have(nx.item)) { tap('install', { id: kind }); did = true; } }
    // merchant: anything the story needs that is on the cart
    if (unlocked('merchant')) {
      ensureMerchant();
      const story = storyNeeds();
      state.merchant.stock.forEach((s, i) => {
        if (s.sold) return;
        const need = (story.raw[s.item] || 0) + (story.acquire[s.item] || 0);
        if (need > 0 && state.coins >= s.price + 50) { if (tap('saffi-buy', { i }, TIME.buy)) { did = true; log('bought from Saffi', s.qty, s.item, s.price); } }
      });
    }
    // plots
    while (typeof stairOpen === 'function' && stairOpen() && (state.stair || 0) < C.core.stair.max && starsHave() >= stairStarsNeed((state.stair || 0) + 1) && state.coins >= stairCost((state.stair || 0) + 1) + R) { tap('stair-light', {}, TIME.buy); did = true; log('lantern', state.stair); }
    while (state.plots.length < C.core.plots.max && (state.plots.length < 16 ? state.coins >= plotCost() + R : state.coins >= 2 * plotCost() + R)) { tap('buy-plot', {}, TIME.buy); did = true; log('bought plot', state.plots.length); }
    // animals the player needs or that pay for themselves quickly
    const wantAnimals = { chicken: 4, cow: 2, bee: 2, sheep: 0 };
    const story = storyNeeds(), req = requestNeeds(story);
    if ((story.raw.wool || 0) + (story.raw.yarn || 0) > 0) wantAnimals.sheep = 2;
    for (const a of I.animals) {
      if (!unlocked(a.unlock) || !featureOn('farm:animals')) continue;
      while (animalRec(a.id).n < wantAnimals[a.id] && state.coins >= a.cost + R) { if (!tap('buy-animal', { id: a.id }, TIME.buy)) break; did = true; log('bought', a.id); }
    }
    // barn: when something we keep is at the cap
    const nb = C.core.barn[state.barn + 1];
    const holdOver = Object.values(storyNeeds().hold).some(n => n > cap());
    if (nb && state.coins >= nb.cost + (holdOver ? 0 : R) && (holdOver || Object.keys(state.inv).some(id => have(id) >= cap() && RESERVE_IDS.has(id) || overflowCount() > 0))) { tap('buy-barn', {}, TIME.buy); did = true; log('barn upgrade', nb.n); }
    // orchard trees
    if (featureOn('farm:orchard')) {
      const i = state.orchard.findIndex(s => !s);
      const best = I.trees.filter(t => lvl('farming') >= t.lvl).sort((a, b) => b.cost - a.cost)[0];
      if (i >= 0 && best && state.coins >= best.cost + R + 200) { tap('plant-tree', { i, id: best.id }, TIME.buy); did = true; log('planted', best.id); }
    }
    return did;
  }

  /* ---------- stamina ---------- */
  function eatIfUseful() {
    if (!CFG.eat) return false;
    syncStamina();
    if (state.stamina >= 10) return false;
    if (!/^story/.test(staminaPlan().why)) return false;
    const foods = Object.keys(state.inv).filter(id => isMeal(id) && I.meal[id].stamina && have(id) > 0).sort((a, b) => I.items[a].s / I.meal[a].stamina - I.items[b].s / I.meal[b].stamina);
    let did = false;
    for (const id of foods) {
      while (have(id) > 0 && state.stamina + I.meal[id].stamina <= maxStamina() * 2 && state.stamina < maxStamina()) { if (!tap('eat', { id }, TIME.eat)) break; did = true; }
    }
    if (CFG.eat === 'cook' && subOn('make', 'kitchen') && have('wheat') >= 8 && state.stamina < 10) {
      const n = Math.min(Math.floor((have('wheat') - 4) / 4), 6);
      if (n > 0) { tap('cook', { id: 'bread', n }, TIME.craft); while (have('bread') > 0 && state.stamina < maxStamina()) { if (!tap('eat', { id: 'bread' }, TIME.eat)) break; } did = true; }
    }
    return did;
  }
  function bestValueArea() {
    let best = null, bv = -1;
    for (const a of I.areas) {
      if (!areaOpen(a)) continue;
      const tot = Object.values(a.drops).reduce((x, y) => x + y, 0);
      const v = Object.entries(a.drops).reduce((x, [id, w]) => x + (id === 'none' ? 0 : w / tot * I.items[id].s), 0) + a.xp * 0.5;
      if (v > bv) { bv = v; best = a.id; }
    }
    return best;
  }
  function bestXpArea() { return I.areas.filter(areaOpen).sort((a, b) => b.xp - a.xp)[0].id; }
  const storyOver = () => !curChapter() && !state.story.queue.length;
  function staminaPlan() {
    const story = storyNeeds(), req = requestNeeds(story);
    // 1. the story's own items: the hardest one sets the destination
    let best = null;
    for (const [id, d] of Object.entries(Object.assign({}, story.raw, story.acquire))) {
      const src = staminaSource(id);
      if (!src) continue;
      const cost = d / src.p;
      if (!best || cost > best.cost) best = Object.assign({ cost, why: 'story:' + id }, src);
    }
    if (best) return best;
    if (story.floor > state.mine.deepest || (story.floorFor || 0) > state.mine.deepest) return { kind: 'dig', deep: true, why: 'story:floor' };
    if ((story.skills.mining || 0) > lvl('mining')) return { kind: 'dig', deep: true, why: 'story:mining' };
    if ((story.skills.foraging || 0) > lvl('foraging')) return { kind: 'explore', area: bestXpArea(), why: 'story:foraging' };
    if (story.explores > 0) return { kind: 'explore', area: bestValueArea(), why: 'story:explores' };
    if (story.other === 'digs' && unlocked('mine')) return { kind: 'dig', deep: true, why: 'story:digs' };
    // 2. townsfolk requests
    for (const [id, d] of Object.entries(req.raw)) {
      const src = staminaSource(id);
      if (!src) continue;
      const cost = d / src.p;
      if (cost > 200) continue;
      if (!best || cost > best.cost) best = Object.assign({ cost, why: 'request:' + id }, src);
    }
    if (best) return best;
    // 3. nothing asked for: dig deeper if there is a mine, otherwise forage for the best-paying finds
    if (storyOver()) {
      if (unlocked('mine') && lvl('mining') < lvl('foraging')) return { kind: 'dig', deep: true, why: 'after story' };
      return { kind: 'explore', area: bestXpArea(), why: 'after story' };
    }
    if (unlocked('mine') && featureOn('wilds:mine') && !CFG.noDefaultMine) return { kind: 'dig', deep: true, why: 'default' };
    return { kind: 'explore', area: bestValueArea(), why: 'default' };
  }
  function goToFloor(plan) {
    const m = state.mine;
    if (plan.deep || plan.deeper) {
      if (m.floor < m.deepest) { const cps = mineCheckpoints().filter(f => f <= m.deepest && f > m.floor); if (cps.length) tap('lift', { n: Math.max(...cps) }); }
      return;
    }
    if (m.floor >= plan.from && m.floor <= plan.to) return;
    const cps = mineCheckpoints().filter(f => f >= plan.from && f <= Math.min(plan.to, m.deepest));
    if (cps.length) tap('lift', { n: Math.max(...cps) });
    else if (m.floor > plan.to) { const lower = mineCheckpoints().filter(f => f <= plan.to); tap('lift', { n: Math.max(...lower) }); }
  }
  function spendStamina(final) {
    syncStamina();
    if (state.stamina < (final ? 1 : 10)) return false;
    const plan = staminaPlan();
    const before = state.stamina, acts0 = state.stats.digs + state.stats.explores;
    const stepKeyAtSpend = trackSteps();
    if (plan.kind === 'explore') {
      if (state.area !== plan.area) tap('area', { id: plan.area }, 1);
      const cap = typeof tripsMax === 'function' ? tripsMax() : Infinity;
      let n = final ? 'all' : (state.stamina >= 10 ? 10 : 1);
      if (n === 'all' && cap < Infinity) n = cap;
      if (n !== 'all' && n > cap) n = cap;
      tap('explore', { n }, TIME.explore);
      // without Long Trips, leaving means tapping Explore until the stamina is gone
      for (let g = 0; final && n !== 'all' && state.stamina >= 1 && g < 300; g++) tap('explore', { n: Math.max(1, Math.min(n, state.stamina, cap)) }, TIME.explore);
      tot.explores += before - state.stamina;
    } else {
      goToFloor(plan);
      const m = state.mine;
      const canGo = () => m.stairs && m.floor < mineMax() && lvl('mining') >= mineGate(m.floor + 1) && (plan.deep || plan.deeper || m.floor + 1 <= plan.to);
      if (canGo()) { tap('descend', {}, TIME.tap); }
      const hunting = (plan.deep || plan.deeper) && !m.stairs && lvl('mining') >= mineGate(m.floor + 1);
      const n = hunting ? 1 : Math.max(1, Math.min(state.stamina >= 10 ? 10 : 1, typeof tripsMax === 'function' ? tripsMax() : 10));
      tap('dig', { n }, n === 1 ? TIME.dig1 : TIME.dig10);
      tot.digs += Math.min(n, before);
      if (canGo()) tap('descend', {}, TIME.tap);
    }
    syncStamina();
    const used = state.stats.digs + state.stats.explores - acts0;
    S.stam += used; tot.staminaSpent += used;
    S.stamWhy[plan.why] = (S.stamWhy[plan.why] || 0) + used;
    const st = stepLog[stepKeyAtSpend];
    if (st) { st.stam += used; st.stamWhy[plan.why] = (st.stamWhy[plan.why] || 0) + used; }
    return used > 0;
  }

  /* ---------- fishing (engine calls; every reel lands) ---------- */
  function fishSpotFor(needs) {
    for (const [id] of Object.entries(needs)) for (const s of SRC[id] || []) if (s.kind === 'fish' && spotOpen(I.spot[s.spot])) return s.spot;
    return null;
  }
  function bestCoinSpot() {
    let best = 'pond', bv = 0;
    for (const sp of I.spots) {
      if (!spotOpen(sp)) continue;
      const tot = sp.fish.reduce((x, f) => x + f[1], 0);
      const v = sp.fish.reduce((x, [id, w]) => x + w / tot * I.items[id].s, 0);
      if (v > bv) { bv = v; best = sp.id; }
    }
    return best;
  }
  function bestXpSpot() {
    let best = 'pond', bv = 0;
    const fl = lvl('fishing');
    for (const sp of I.spots) {
      if (!spotOpen(sp)) continue;
      const tot = sp.fish.reduce((x, f) => x + f[1] * (f[2] >= 2 ? 1 + fl * 0.02 : 1), 0);
      // expected XP a cast, counting rare fish as harder to land
      const v = sp.fish.reduce((x, [id, w, r]) => x + w * (r >= 2 ? 1 + fl * 0.02 : 1) / tot * (id === 'boot' ? 1 : C.core.rarity[r].xp) * (r >= 4 ? 0.6 : 1), 0);
      if (v > bv) { bv = v; best = sp.id; }
    }
    return best;
  }
  function fishOnce(spot, kind) {
    if (!tabOn('fish')) return false;
    if (!BAITS.some(b => have(b))) { const pack = state.coins >= 60 ? 'worm25' : 'worm5'; if (state.coins < 10 || !tap('buy', { id: pack }, TIME.buy)) return false; }
    if (state.spot !== spot) tap('spot', { id: spot }, 1);
    if (have('worm') && state.bait !== 'worm') tap('bait', { id: 'worm' }, 1);
    const caughtBefore = state.stats.fish;
    cast();
    F.t += 1500; window.__runTimers();
    if (fishing.phase === 'bite') {
      // aim for the middle of the zone; a person's tap lands with a timing error (CFG.reelSigma seconds, 0 = perfect)
      const sig = CFG.reelSigma || 0;
      let err = 0;
      if (sig) { const u = Math.random() || 1e-9, v = Math.random(); err = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) * sig * fishing.speed; }
      fishing.start = performance.now();
      fishing.offset = clamp((fishing.zone[0] + fishing.zone[1] / 2) / 100 + err, 0, 0.999);
      const c0 = state.coins; inner = 0;
      reel();
      credit('fish', state.coins - c0 - inner);
      if (fishing.fish && fishing.fish.r === 5) { tot.legendBites = (tot.legendBites || 0) + 1; if (/Caught/.test(fishing.msg)) tot.legendCaught = (tot.legendCaught || 0) + 1; }
      if (!/Caught/.test(fishing.msg)) tot.missed = (tot.missed || 0) + 1;
    }
    T(TIME.cast - 1.5, kind);
    tot.casts++; if (kind === 'filler') tot.fillerCasts++;
    return true;
  }

  /* ---------- town ---------- */
  function townChores() {
    let did = false;
    // daily visit gift
    checkLogin();
    if (featureOn('daily') && loginReady()) { tap('login-claim', {}, TIME.claim); did = true; }
    if (featureOn('town:board')) {
      ensureChores();
      state.chores.list.forEach((c, i) => { if (!c.claimed && choreProgress(c) >= c.n) { tap('chore', { i }, TIME.claim); did = true; } });
      if (!state.chores.bonus && state.chores.list.every(c => c.claimed)) { tap('chore-bonus', {}, TIME.claim); did = true; }
    }
    // letters
    checkMail();
    for (const m of state.mail) {
      if (!m.read) { tap('letter', { id: m.id }, TIME.claim); did = true; }
      const l = I.letters.find(x => x.id === m.id);
      if (l && l.give && !m.claimed) { tap('letter-gift', { id: m.id }, TIME.claim); did = true; }
    }
    // requests that do not eat into story items
    const story = storyNeeds();
    for (const { vid, q } of openRequests()) {
      if (!canDeliver(vid)) continue;
      if (Object.entries(q.want).some(([id, n]) => have(id) - n < (story.hold[id] || 0) + (story.raw[id] || 0))) continue;
      tap('deliver', { id: vid }, TIME.claim); did = true; log('request', vid, JSON.stringify(q.want));
    }
    for (const v of I.vils) if (vilAvailable(v) && heartSceneReady(v.id)) { tap('heart', { id: v.id }, TIME.claim); did = true; }
    if (overflowCount() > 0 && Object.keys(state.overflow).some(id => have(id) < cap())) { tap('take-overflow'); did = true; }
    return did;
  }

  /* ---------- the story ---------- */
  let advTries = 0;
  function doStory() {
    let did = false;
    for (let g = 0; g < 12; g++) {
      const st = storyStatus();
      const go = st.kind === 'queue' || st.kind === 'begin' || st.kind === 'talk' || (st.kind === 'deliver' && st.ready) || (st.kind === 'adventure' && st.ready && advTries < 3);
      if (!go) break;
      const key = state.story.ci + '.' + state.story.si;
      if (st.kind === 'adventure') { advTries++; log('adventure attempt', curStep().id); }
      tap('story', {}, 0);
      T(TIME.tap);
      drain();
      did = true;
      if (state.story.ci + '.' + state.story.si === key && st.kind === 'adventure' && !state.advDone[curStep() && curStep().id]) break;
    }
    return did;
  }
  function trackSteps() {
    const key = state.story.ci + '.' + (state.story.started ? state.story.si : 'b');
    if (S) S.touched.add(key);
    if (!stepLog[key]) {
      const ch = curChapter(), s = curStep();
      stepLog[key] = { t0: F.t, ch: ch ? ch.id : 'end', step: s ? `${s.type}: ${fill(s.t)}` : (ch ? 'begin' : 'end'), sessions: 0, stam: 0, reasons: {}, stamWhy: {} };
      log('STEP', key, stepLog[key].step);
    }
    return key;
  }

  /* ---------- session ---------- */
  function nextEventIn() {
    let t = Infinity;
    state.plots.forEach(p => { if (p.crop) t = Math.min(t, (p.ready - now()) / 1000); });
    syncStamina();
    if (state.stamina < 10) t = Math.min(t, (10 - state.stamina) * regenMs() / 1000);
    return Math.max(0, t);
  }
  function diagnose() {
    const story = storyNeeds(), s = story.step, out = [];
    if (!s) return ['no step'];
    for (const [sk, L] of Object.entries(story.skills)) if (lvl(sk) < L) out.push(`level:${sk} ${lvl(sk)}/${L}`);
    if (story.floor > state.mine.deepest) out.push(`depth ${state.mine.deepest}/${story.floor}`);
    for (const [id, n] of Object.entries(story.raw)) out.push(`raw:${id} x${n}`);
    for (const [id, n] of Object.entries(story.acquire)) if (!story.raw[id]) out.push(`get:${id} x${n}`);
    if (story.explores) out.push(`explores x${story.explores}`);
    if (story.cooked) out.push(`cooked x${story.cooked}`);
    if (s.type === 'adventure' && !state.advDone[s.id]) out.push('adventure');
    const blockedMakes = story.makes.filter(m => m.kind === 'craft' && !recipeOpen(I.recipe[m.id])).map(m => `${m.id}(craft ${I.recipe[m.id].lvl})`);
    if (blockedMakes.length) out.push('recipe:' + blockedMakes.join(','));
    return out;
  }
  // what stopped progress on the story step at the moment the visit ran out of useful things to do
  function classify() {
    const story = storyNeeds(), s = story.step;
    if (!s) return 'between chapters';
    syncStamina();
    const plan = staminaPlan();
    const growing = state.plots.filter(p => p.crop && p.ready > now()).map(p => p.crop);
    const cropNeed = Object.keys(Object.assign({}, story.raw, story.acquire)).filter(id => I.crop[id]);
    if (/^story/.test(plan.why) && state.stamina < 10) return 'stamina (' + plan.why.slice(6) + ')';
    if (cropNeed.length && cropNeed.some(id => growing.includes(id))) return 'crop timer (' + cropNeed.join(',') + ')';
    for (const sk of ['crafting', 'cooking', 'farming', 'mining', 'foraging', 'fishing']) if ((story.skills[sk] || 0) > lvl(sk)) return `${sk} level ${lvl(sk)}/${story.skills[sk]}`;
    const animalNeed = Object.keys(story.raw).filter(id => (SRC[id] || []).some(x => x.kind === 'animal'));
    if (animalNeed.length) return 'animal timer (' + animalNeed.join(',') + ')';
    const d = diagnose();
    return 'other: ' + (d[0] || '?');
  }
  function act1() {
    if (doStory()) return true;
    if (townChores()) return true;
    if (harvestAll()) return true;
    if (animalsAndTrees()) return true;
    if (benchWork()) return true;
    if (makeStory()) return true;
    if (makeRequests()) return true;
    const story = storyNeeds();
    for (const sk of ['crafting', 'cooking']) if ((story.skills[sk] || 0) > lvl(sk) && xpCraft(sk)) return true;
    // after the story: turn what is spare into things worth more, once a visit per skill
    if (storyOver() && !S.postCraft) { S.postCraft = true; let d = xpCraft('crafting', true); d = xpCraft('cooking', true) || d; if (d) return true; }
    if (S.sold < 2) { S.sold++; if (sellSurplus(true) > 0) return true; }
    if (shop()) return true;
    if (plantEmpty(true)) return true;
    if (eatIfUseful()) return true;
    if (spendStamina(false)) return true;
    // fish the story or a request asks for
    const isFish = id => (SRC[id] || []).some(s => s.kind === 'fish');
    const storyFish = Object.fromEntries(Object.entries(Object.assign({}, story.raw, story.acquire)).filter(([id]) => isFish(id) && !staminaSource(id)));
    let sp = fishSpotFor(storyFish);
    if (sp && fishOnce(sp, 'prod')) return true;
    if (S.reqCasts < 40) {
      const req = requestNeeds(story);
      sp = fishSpotFor(Object.fromEntries(Object.entries(req.raw).filter(([id]) => isFish(id))));
      if (sp) { S.reqCasts++; if (fishOnce(sp, 'prod')) return true; }
    }
    if (upgradesWork()) return true;
    // other "do N of something" steps
    if (story.other === 'fish' && tabOn('fish')) { if (fishOnce(bestCoinSpot(), 'prod')) return true; }
    if (story.other === 'crafted' && xpCraft('crafting', true)) return true;
    // the story wants a fishing level: fish where a cast pays the most XP
    if ((story.skills.fishing || 0) > lvl('fishing') && tabOn('fish')) { if (fishOnce(bestXpSpot(), 'prod')) return true; }
    return false;
  }
  function runSession(budgetSec, awaySec) {
    S = { away: awaySec, start: F.t, end: F.t + budgetSec * 1000, prod: 0, filler: 0, wait: 0, stam: 0, stamWhy: {}, sold: 0, reqCasts: 0, touched: new Set() };
    tot.sessions++;
    advTries = 0;
    const key0 = trackSteps();
    // opening the app
    syncStamina(); checkLogin(); ensureChores(); checkMail(); commit();
    T(TIME.open);
    let guard = 0, lastKey = key0;
    while (F.t < S.end && guard++ < 4000) {
      const k = trackSteps();
      if (k !== lastKey) { stepLog[lastKey].t1 = F.t; lastKey = k; }
      if (!CFG.keepPlaying && storyStatus().kind === 'end' && !state.story.queue.length) break;
      if (act1()) continue;
      if (!S.block) { S.block = classify(); S.blockAt = (F.t - S.start) / 60000; S.blockKey = trackSteps(); }
      const wait = nextEventIn();
      if (wait <= 20 && F.t + wait * 1000 < S.end) { T(Math.max(1, wait), 'wait'); continue; }
      if (CFG.filler === 'fish' && tabOn('fish') && left() > 6) {
        // fish until something else needs doing (a crop comes ready or the stamina bar is worth spending)
        const until = Math.min(S.end - 6000, F.t + Math.max(5, wait) * 1000), spot = bestCoinSpot();
        let n = 0;
        while (F.t < until && fishOnce(spot, 'filler')) n++;
        if (n) continue;
      }
      if (F.t + wait * 1000 < S.end) { T(Math.max(1, wait), 'wait'); continue; }
      break;
    }
    if (!S.block) { S.block = 'visit too short (still busy at ' + (budgetSec / 60) + ' min): ' + classify(); S.blockKey = trackSteps(); S.blockAt = budgetSec / 60; }
    // leaving: spend what stamina is left, sow for the time away, set the bench going
    for (let g = 0; g < 200 && spendStamina(true); g++);
    harvestAll(); animalsAndTrees(); benchWork();
    sellSurplus(true); shop();
    plantEmpty(false);
    doStory();
    const k = trackSteps();
    if (k !== lastKey && stepLog[lastKey]) stepLog[lastKey].t1 = F.t;
    // what is holding the current step up
    const st = stepLog[k];
    for (const key of S.touched) stepLog[key].sessions++;
    for (const r of diagnose()) st.reasons[r] = (st.reasons[r] || 0) + 1;
    if (stepLog[S.blockKey]) { const b = stepLog[S.blockKey]; b.block = b.block || {}; b.block[S.block] = (b.block[S.block] || 0) + 1; }
    // steps passed during this session get the session counted too
    const sum = { day: dayNumber(), ci: state.story.ci, si: state.story.si, step: st.step, minutes: +((F.t - S.start) / 60000).toFixed(1), prod: +(S.prod / 60).toFixed(1), filler: +(S.filler / 60).toFixed(1), wait: +(S.wait / 60).toFixed(1), stam: S.stam, stamWhy: S.stamWhy, coins: state.coins, plots: state.plots.length, lv: Object.fromEntries(I.skills.map(s => [s.id, lvl(s.id)])), deepest: state.mine.deepest, why: diagnose(), block: S.block, blockAt: +(S.blockAt || 0).toFixed(1), taps: S.taps };
    S = null;
    return sum;
  }
  function snapshot() {
    return {
      created: state.created, now: F.t, day: dayNumber(),
      done: state.story.done, revealed: state.revealed, unlocks: state.unlocks, advDone: state.advDone,
      lv: Object.fromEntries(I.skills.map(s => [s.id, lvl(s.id)])), coins: state.coins, plots: state.plots.length, barn: state.barn,
      animals: state.animals, deepest: state.mine.deepest, tot, stepLog, ledger, status: storyStatus(), stats: state.stats, perks: state.perks,
    };
  }
  return { runSession, snapshot, LOG, tot, stepLog, drain, T };
})()
