/* ---------- views ---------- */
const SUBS = {
  farm: [['fields', 'Fields'], ['orchard', 'Orchard'], ['animals', 'Animals'], ['pets', 'Pets']],
  wilds: [['explore', 'Explore'], ['mine', 'Mine'], ['adventures', 'Adventures']],
  make: [['workshop', 'Workshop'], ['kitchen', 'Kitchen'], ['bench', 'Bench'], ['cellar', 'Cellar']],
  town: [['people', 'People'], ['shops', 'Shops'], ['board', 'Board'], ['mail', 'Mail']],
  bag: [['items', 'Items'], ['almanac', 'Almanac'], ['feats', 'Feats'], ['perks', 'Perks'], ['settings', 'Settings']],
};
const visibleSubs = t => SUBS[t].filter(([id]) => subOn(t, id));
function sub(t) {
  const list = visibleSubs(t);
  const want = state.sub[t];
  return list.some(([id]) => id === want) ? want : list[0][0];
}
function subtabs(t, dots = {}) {
  const list = visibleSubs(t);
  if (list.length < 2) return '';
  return `<div class="subtabs" role="tablist">${list.map(([id, n]) => {
    const fresh = isNew(`${t}:${id}`);
    return `<button class="subtab" data-act="sub" data-tab="${t}" data-sub="${id}" aria-pressed="${sub(t) === id}">${n}${dots[id] || fresh ? `<span class="dot${fresh && !dots[id] ? ' new' : ''}"></span>` : ''}</button>`;
  }).join('')}</div>`;
}
const lockedCard = (title, unlockId) => `<div class="card locked-card"><h2>${esc(title)}</h2><p>${esc(unlockHint(unlockId))}</p></div>`;
const progressBar = (a, b) => `<span class="bar"><i style="--p:${b ? clamp(a / b, 0, 1).toFixed(3) : 0}"></i></span>`;

function storyBanner() {
  const st = storyStatus();
  if (st.kind === 'end') return '';
  const extra = st.want ? `<div class="row">${Object.entries(st.want).map(([id, n]) => chip(id, `${Math.min(have(id), n)}/${n}`, have(id) >= n ? '' : 'short')).join('')}</div>`
    : st.progress ? `<div class="row" style="gap:10px"><span class="num" style="font-size:13px">${fmtN(st.progress[0])}/${fmtN(st.progress[1])}</span><span style="flex:1">${progressBar(st.progress[0], st.progress[1])}</span></div>` : '';
  return `<button class="story" data-act="story"><span class="label">${st.kind === 'begin' ? 'Next chapter' : st.kind === 'queue' ? 'Story' : 'Main story'}</span>
    <b>${esc(st.title)}</b><p>${esc(st.text)}</p>${extra}<span class="go">${esc(st.btn)}</span></button>`;
}

/* ---- Farm ---- */
function viewFarm() {
  const s = sub('farm');
  const dots = { orchard: orchardReady() > 0, animals: animalsReady() > 0, pets: petsReady() > 0 };
  const head = `<div class="view-head"><h1>Your farm</h1><p>${esc(weather().n)} · ${esc(weather().desc)}</p></div>${subtabs('farm', dots)}`;
  if (s === 'orchard') return head + (unlocked('orchard') ? viewOrchard() : lockedCard('The orchard', 'orchard'));
  if (s === 'animals') return head + viewAnimals();
  if (s === 'pets') return head + viewPets();
  return head + storyBanner() + viewFields();
}
function plotHTML(p, i) {
  if (!p.crop) return `<button class="plot empty" data-act="plot" data-i="${i}" aria-label="Empty plot ${i + 1}. Sow ${esc(itemName(state.seed))}"><span class="plot-empty">Sow</span></button>`;
  const q = plotState(p);
  return `<button class="plot${q.ready ? ' ready' : ''}" data-act="plot" data-i="${i}" data-plot="${i}" style="--g:${q.g.toFixed(3)}" data-stage="${q.stage}" aria-label="${esc(itemName(p.crop))}: ${q.ready ? 'ready' : fmtT(q.left / 1000) + ' left'}">
    ${stagePic(p.crop, q.stage, 40)}<span class="plot-label">${q.ready ? 'Ready' : fmtT(q.left / 1000)}</span><span class="plot-bar"><i></i></span></button>`;
}
function viewFields() {
  const fl = lvl('farming');
  const ready = state.plots.filter(p => p.crop && p.ready <= now()).length;
  const empty = state.plots.filter(p => !p.crop).length;
  const seed = I.crop[state.seed];
  const open = I.crops.filter(cropOpen);
  const next = I.crops.find(c => !cropOpen(c) && !c.flag);
  const packets = open.concat(next ? [next] : []).map(c => {
    const it = I.items[c.id], locked = !cropOpen(c);
    return `<button class="packet${locked ? ' locked' : ''}" style="--h:${c.h}" ${locked ? 'disabled' : `data-act="seed" data-id="${c.id}"`} aria-pressed="${state.seed === c.id}">
      <span class="band">${esc(it.n)}</span><span class="pic">${pic(c.id, 40)}</span>
      <span class="facts">${locked ? `<span>Farming Lv ${c.lvl}</span><span>&nbsp;</span>` : `<span>Grows ${fmtT(c.grow * growFactor())}</span><span>Seed ${seedCost(c)}c · sells ${priceOf(c.id)}c</span>`}</span></button>`;
  }).join('');
  const ups = Object.entries(C.core.upgrades).map(([k, u]) => {
    const tier = state.upgrades[k], next = u.tiers[tier], cur = u.tiers[tier - 1];
    return `<div class="upgrade">${pic(next ? next.item : cur.item, 32)}<div class="what"><b>${esc(u.n)}${cur ? `: ${esc(itemName(cur.item))}` : ''}</b>
      <small>${cur ? esc(u.desc.replace('{pct}', cur.pct)) : 'None yet'}${next ? ` · next: ${esc(itemName(next.item))} (craft it in the Workshop)` : ''}</small></div>
      ${next ? `<button class="btn small" data-act="install" data-id="${k}" ${have(next.item) ? '' : 'disabled'}>Install</button>` : '<span class="chip plain">Best</span>'}</div>`;
  }).join('');
  return `
    <div><div class="label">Seed packets</div><div class="packets">${packets}</div></div>
    <div class="plots">${state.plots.map(plotHTML).join('')}</div>
    <div class="farm-actions">
      <button class="btn" data-act="harvest-all" ${ready ? '' : 'disabled'}>Harvest all${ready ? ` (${ready})` : ''}</button>
      <button class="btn ghost" data-act="sow-all" ${empty ? '' : 'disabled'}>Sow ${empty || ''} ${esc(itemName(seed.id))}${empty ? ` · ${empty * seedCost(seed)}c` : ''}</button>
    </div>
    ${have('tonic') ? `<button class="btn sun" data-act="tonic">${pic('tonic', 24)} Use Grow Tonic (${have('tonic')}) · halves growing time</button>` : ''}
    ${featureOn('upgrades') ? `<div class="card"><h2>Farm improvements</h2><div class="upgrades">${ups}</div>
      <p class="sub">${state.plots.length}/${C.core.plots.max} plots. Buy more at Pennywhistle's store in Town.</p></div>` : ''}`;
}
function tickFarm() {
  let changed = false;
  $$('[data-plot]').forEach(el => {
    const p = state.plots[+el.dataset.plot];
    if (!p || !p.crop) return;
    const q = plotState(p);
    if ((q.ready && !el.classList.contains('ready')) || String(q.stage) !== el.dataset.stage) { changed = true; return; }
    el.style.setProperty('--g', q.g.toFixed(3));
    const lb = el.querySelector('.plot-label');
    const label = q.ready ? 'Ready' : fmtT(q.left / 1000);
    if (lb.textContent !== label) lb.textContent = label;
  });
  if (changed) renderView();
}
const orchardReady = () => state.orchard.filter(s => s && treeState(s).ready).length;
const animalsReady = () => I.animals.filter(a => animalState(a).ready > 0).length;
function viewOrchard() {
  const slots = state.orchard.map((s, i) => {
    if (!s) return `<button class="tree empty" data-act="tree-slot" data-i="${i}"><span style="font-size:26px">＋</span><b>Plant a tree</b><small>Empty spot</small></button>`;
    const q = treeState(s);
    return `<button class="tree${q.ready ? ' ready' : ''}" data-act="tree" data-i="${i}">${pic(s.tree, 40)}<b>${esc(q.t.n)}</b>
      <small>${q.ready ? `${q.ready * q.t.yield} ready` : `next in ${fmtT(q.next)}`}</small></button>`;
  }).join('');
  return `<div class="card"><div class="row between"><h2>Orchard</h2><button class="btn small" data-act="harvest-trees" ${orchardReady() ? '' : 'disabled'}>Pick all</button></div>
    <p class="sub">Trees are planted once and keep fruiting. Each holds up to two harvests before you pick it.</p>
    <div class="trees">${slots}</div></div>`;
}
function viewAnimals() {
  const cards = I.animals.map(a => {
    if (!unlocked(a.unlock)) return `<div class="card locked-card pen"><span class="big" style="filter:grayscale(1)">${a.i}</span><div><b>${esc(a.n)}</b><p class="sub">${esc(unlockHint(a.unlock))}</p></div></div>`;
    const s = animalState(a);
    return `<div class="card pen"><span class="big" aria-hidden="true">${a.i}</span>
      <div class="pen-head"><b>${esc(a.home)}</b><span class="chip plain">${s.rec.n}/${a.max} ${esc(a.n.toLowerCase())}</span></div>
      <div style="display:grid;gap:8px">
        <p class="sub">Each makes ${pic(a.produce, 18)} ${esc(itemName(a.produce))} every ${fmtT(a.every)}. ${s.rec.n ? (s.ready ? `<b>${s.ready} ready.</b>` : `Next in ${fmtT(s.next)}.`) : ''}</p>
        <div class="row"><button class="btn small" data-act="collect" data-id="${a.id}" ${s.ready ? '' : 'disabled'}>Collect${s.ready ? ` ${s.ready}` : ''}</button>
        <button class="btn small ghost" data-act="buy-animal" data-id="${a.id}" ${s.rec.n < a.max && state.coins >= a.cost ? '' : 'disabled'}>Buy ${esc(a.one.toLowerCase())} · ${fmtN(a.cost)}c</button></div>
      </div></div>`;
  }).join('');
  const anyAnimals = I.animals.some(a => animalRec(a.id).n);
  return `${anyAnimals ? `<button class="btn ${state.petDay === dayKey() ? 'ghost' : 'sun'} wide" data-act="pet" ${state.petDay === dayKey() ? 'disabled' : ''}>${state.petDay === dayKey() ? 'Everyone has been petted today' : 'Pet everyone (once a day, bonus goods)'}</button>` : ''}
    ${animalsReady() > 1 ? '<button class="btn wide" data-act="collect-all">Collect everything</button>' : ''}${cards}`;
}

/* ---- Wilds ---- */
function viewWilds() {
  const s = sub('wilds');
  const newAdv = I.advs.some(a => !state.advDone[a.id] && reqMet(a.req));
  const head = `<div class="view-head"><h1>The wilds</h1><p>Stamina refills 1 every ${Math.round(regenMs() / 1000)}s</p></div>${subtabs('wilds', { adventures: newAdv })}`;
  if (s === 'mine') return head + (unlocked('mine') ? viewMine() : lockedCard('The Mine', 'mine'));
  if (s === 'adventures') return head + viewAdventures();
  return head + viewExplore();
}
function staminaLine() {
  const s = state.stamina, max = maxStamina();
  return `${s} stamina${s >= max ? '' : ` · +1 in ${fmtT((regenMs() - (now() - state.staminaAt)) / 1000)}`}`;
}
function viewExplore() {
  if (!areaOpen(I.area[state.area])) state.area = 'meadow';
  const a = I.area[state.area];
  const cards = I.areas.map(x => {
    const open = areaOpen(x);
    const lockText = !unlocked(x.unlock) ? 'Story' : `Foraging Lv ${x.lvl}`;
    const drops = Object.keys(x.drops).filter(k => k !== 'none').map(k => state.seen[k] ? `<span title="${esc(itemName(k))}">${pic(k, 24)}</span>` : '<span class="unknown" title="Not found yet">?</span>').join('');
    return `<button class="area${open ? '' : ' locked'}" ${open ? `data-act="area" data-id="${x.id}"` : 'disabled'} aria-pressed="${x.id === state.area}">
      <span class="area-top"><b>${esc(x.n)}</b><span class="chip plain">${open ? `${x.xp} XP a trip` : esc(lockText)}</span></span>
      <span class="sub">${esc(open || unlocked(x.unlock) ? x.blurb : unlockHint(x.unlock))}</span><span class="drops">${drops}</span></button>`;
  }).join('');
  const log = exploreLog.length ? exploreLog.map(l => `<div class="log-line">${l.html}<span class="t">${esc(l.when)}</span></div>`).join('') : '<p class="muted">Each trip costs 1 stamina. Sometimes something unexpected happens.</p>';
  const s = state.stamina;
  return `<div class="card trail"><div><h2>${esc(a.n)}</h2><p class="sub" data-stam-line>${staminaLine()}</p></div>
      <div class="trail-btns"><button class="btn" data-act="explore" data-n="1" data-need="1" ${s >= 1 ? '' : 'disabled'}>Explore</button>
      <button class="btn ghost" data-act="explore" data-n="10" data-need="10" ${s >= 10 ? '' : 'disabled'}>×10</button>
      <button class="btn ghost" data-act="explore" data-n="all" data-need="1" ${s >= 1 ? '' : 'disabled'}>All</button></div></div>
    <div class="card"><div class="label">Trail log</div><div class="log">${log}</div></div>
    <div class="label">Places</div><div class="areas">${cards}</div>`;
}
function viewMine() {
  const m = state.mine, k = C.core.mine;
  const need = mineGate(m.floor + 1);
  const depth = m.floor > k.floors ? `<span class="chip plain gold">The Deep · ${m.floor - k.floors} below the vault</span>` : Array.from({ length: k.floors }, (_, i) => `<i class="${i < m.floor ? 'on' : ''} ${k.checkpoints.includes(i + 1) ? 'cp' : ''}"></i>`).join('');
  const band = mineBand(m.floor);
  const drops = Object.keys(band.drops).filter(x => x !== 'none').concat(m.floor >= 25 ? ['starshard'] : []).map(x => state.seen[x] ? pic(x, 24) : '<span class="unknown">?</span>').join('');
  const s = state.stamina;
  const down = m.floor >= mineMax() ? '<span class="chip plain">The bottom</span>'
    : m.stairs ? `<button class="btn sun" data-act="descend" ${lvl('mining') >= need ? '' : 'disabled'}>Go down to floor ${m.floor + 1}${need && lvl('mining') < need ? ` (Mining ${need})` : ''}</button>`
    : '<span class="sub">Keep digging to find the way down.</span>';
  const lifts = mineCheckpoints().filter(f => f <= m.deepest && f !== m.floor).map(f => `<button class="btn small ghost" data-act="lift" data-n="${f}">Floor ${f}</button>`).join('');
  const log = mineLog.length ? mineLog.map(l => `<div class="log-line">${l.html}<span class="t">${esc(l.when)}</span></div>`).join('') : '<p class="muted">Every dig costs 1 stamina and might turn up ore, gems or the way down.</p>';
  return `<div class="card trail mine"><div class="row between"><h2>Floor ${m.floor}</h2><span class="sub">Deepest: ${m.deepest}</span></div>
      <div class="depth" aria-label="Floor ${m.floor} of ${k.floors}">${depth}</div>
      <p class="sub" data-stam-line>${staminaLine()}</p>
      <div class="trail-btns"><button class="btn" data-act="dig" data-n="1" data-need="1" ${s >= 1 ? '' : 'disabled'}>Dig</button>
      <button class="btn ghost" data-act="dig" data-n="10" data-need="10" ${s >= 10 ? '' : 'disabled'}>×10</button>
      <button class="btn ghost" data-act="dig" data-n="all" data-need="1" ${s >= 1 ? '' : 'disabled'}>All</button></div>
      <div class="row">${down}</div></div>
    <div class="card"><div class="row between"><div class="label">Found on this level</div><span class="drops">${drops}</span></div><div class="log">${log}</div></div>
    ${lifts ? `<div class="card"><h2>The old lift</h2><p class="sub">Ride down to any landing you've reached.</p><div class="row">${lifts}</div></div>` : ''}`;
}
function viewAdventures() {
  const open = I.advs.filter(a => !state.advDone[a.id] && reqMet(a.req));
  const done = I.advs.filter(a => state.advDone[a.id]);
  const later = I.advs.length - open.length - done.length;
  const card = (a, isDone) => `<div class="card adv${isDone ? ' done' : ''}"><div><b>${esc(a.n)}</b><p class="sub">${esc(placeName(a.where))}</p></div>
    ${isDone ? '<span class="chip plain">Done</span>' : `<button class="btn small" data-act="adventure" data-id="${a.id}">Set out</button>`}
    <p class="sub" style="grid-column:1/-1">${esc(fill(a.blurb))}</p></div>`;
  return `${open.length ? open.map(a => card(a, false)).join('') : '<div class="card"><p class="muted">No adventures right now. Keep following the story and making friends.</p></div>'}
    ${later > 0 ? `<p class="sub">${plural(later, 'more adventure')} will turn up as the valley wakes.</p>` : ''}
    ${done.length ? `<div class="label">Finished</div>${done.map(a => card(a, true)).join('')}` : ''}`;
}
function placeName(w) {
  if (I.area[w]) return I.area[w].n;
  if (I.spot[w]) return I.spot[w].n;
  return { mine: 'The Mine', town: 'Bramblebrook', farm: 'Your farm' }[w] || w;
}

/* ---- Fishing ---- */
function viewFish() {
  if (!spotOpen(I.spot[state.spot])) state.spot = 'pond';
  const spots = I.spots.map(s => {
    const open = spotOpen(s);
    return `<button class="spot${open ? '' : ' locked'}" ${open ? `data-act="spot" data-id="${s.id}"` : 'disabled'} aria-pressed="${state.spot === s.id}">${esc(s.n)}${open ? '' : unlocked(s.unlock) ? ` · Lv ${s.lvl}` : ' · Story'}</button>`;
  }).join('');
  const sp = I.spot[state.spot];
  const pool = sp.fish.map(([id]) => state.seen[id] ? `<span title="${esc(itemName(id))}">${pic(id, 24)}</span>` : '<span class="unknown">?</span>').join('');
  const logHTML = catchLog.length ? catchLog.map(l => `<div class="log-line">${l}</div>`).join('') : '<p class="muted">Cast, wait for the bobber to dip, then tap when the marker is in the green.</p>';
  const bait = (id, label, note) => `<button class="bait" data-act="bait" data-id="${id}" aria-pressed="${state.bait === id}">${pic(id, 28)}<span><b>${label}</b><small data-bait="${id}">${have(id)} · ${note}</small></span></button>`;
  return `<div class="view-head"><h1>Fishing</h1><p>${esc(weather().id === 'foggy' ? 'Foggy: rare fish are biting' : sp.n)}</p></div>
    <div class="spots">${spots}</div>
    <div class="pond" id="pond" data-act="fish-btn" data-phase="idle">
      <div class="bobber" aria-hidden="true"></div>
      <div class="fish-status" id="fish-status">Pick your bait and cast.</div>
      <div class="reel" id="reel" hidden><div class="zone" id="zone"></div><div class="needle" id="needle"></div></div>
    </div>
    <div class="bait-row">${bait('worm', 'Worms', 'basic')}${bait('lure', 'Lures', 'bigger zone')}${bait('glowbait', 'Glow grubs', 'legends')}</div>
    <button class="btn big" id="cast-btn" data-act="fish-btn">Cast line</button>
    <div class="card"><div class="row between"><div class="label">In these waters</div><div class="drops">${pool}</div></div><div class="log">${logHTML}</div></div>${viewNets()}`;
}
function updateBaitCounts() {
  const notes = { worm: 'basic', lure: 'bigger zone', glowbait: 'legends' };
  for (const b of BAITS) { const el = $(`[data-bait="${b}"]`); if (el) el.textContent = `${have(b)} · ${notes[b]}`; }
}
function syncFishDom() {
  const pond = $('#pond'), btn = $('#cast-btn'), st = $('#fish-status'), reelEl = $('#reel');
  if (!pond) return;
  pond.dataset.phase = fishing.phase;
  btn.textContent = { idle: 'Cast line', waiting: 'Reel in!', bite: 'Reel in!', result: 'Cast again' }[fishing.phase];
  if (fishing.msg) st.innerHTML = fishing.msg;
  reelEl.hidden = fishing.phase !== 'bite';
  if (fishing.phase === 'bite') { $('#zone').style.left = fishing.zone[0] + '%'; $('#zone').style.width = fishing.zone[1] + '%'; }
}

/* ---- Make ---- */
function viewMake() {
  const s = sub('make');
  const titles = { workshop: ['Workshop', 'Turn raw goods into things worth more'], kitchen: ["Gran's kitchen", 'Meals restore stamina or give a boost'], bench: ['Workbench', 'Crafts while you are away'], cellar: ['Cellar', 'Patience pays: age goods into vintages'] };
  const head = `<div class="view-head"><h1>${titles[s][0]}</h1><p>${titles[s][1]}</p></div>${subtabs('make', { bench: benchReady() > 0, cellar: casksReady() > 0 })}`;
  if (s === 'bench') return head + viewBench();
  if (s === 'cellar') return head + viewCellar();
  if (s === 'kitchen') return head + (unlocked('kitchen') ? recipeList(I.meals, mealOpen, 'cook', 'cooking') : lockedCard("Gran's kitchen", 'kitchen'));
  return head + recipeList(I.recipes, recipeOpen, 'craft', 'crafting');
}
function recipeList(list, isOpen, act, skill) {
  const open = list.filter(isOpen);
  const next = list.filter(r => !isOpen(r)).slice(0, 2);
  const card = (r, locked) => {
    const it = I.items[r.id], m = locked ? 0 : maxMake(r);
    const needs = Object.entries(r.need).map(([id, q]) => chip(id, `${have(id)}/${q}`, have(id) >= q ? '' : 'short')).join('');
    const effect = I.meal[r.id] ? [I.meal[r.id].stamina ? `+${I.meal[r.id].stamina} stamina` : '', I.meal[r.id].buff ? `${I.buffs[I.meal[r.id].buff].n} ${I.meal[r.id].mins}m` : ''].filter(Boolean).join(' · ') : r.upgrade ? 'Farm improvement' : '';
    const lockWhy = !unlocked(r.unlock) ? unlockHint(r.unlock) : `${skillName(skill)} Lv ${r.lvl}`;
    return `<div class="card recipe${locked ? ' locked' : ''}"><span class="big-ico">${pic(r.id, 40)}</span>
      <div class="recipe-name"><b>${(r.out || 1) > 1 ? r.out + '× ' : ''}${esc(it.n)}</b><span class="muted num" style="font-size:13px">${locked ? esc(lockWhy) : `sells ${priceOf(r.id)}c${effect ? ' · ' + esc(effect) : ''}`}</span></div>
      <div class="needs">${needs}</div>
      ${locked ? '' : `<div class="row"><button class="btn small" data-act="${act}" data-id="${r.id}" data-n="1" ${m ? '' : 'disabled'}>${act === 'cook' ? 'Cook' : 'Craft'}</button>
        <button class="btn small ghost" data-act="${act}" data-id="${r.id}" data-n="max" ${m > 1 ? '' : 'disabled'}>Make ${m > 1 ? m : 'max'}</button>
        ${act === 'cook' && edible(r.id) && have(r.id) ? `<button class="btn small sun" data-act="eat" data-id="${r.id}">Eat one</button>` : ''}
        <span class="muted num" style="font-size:13px">You have ${have(r.id)}</span></div>`}</div>`;
  };
  return `<div class="recipes">${open.map(r => card(r, false)).join('')}${next.map(r => card(r, true)).join('')}</div>`;
}

/* ---- Town ---- */
function viewTown() {
  const s = sub('town');
  ensureChores();
  const unread = state.mail.filter(m => !m.read).length;
  const choresReady = state.chores.list.some(c => !c.claimed && choreProgress(c) >= c.n) || (featureOn('daily') && loginReady()) || (featureOn('festival') && festivalOpenCount() > 0);
  const people = I.vils.some(v => vilAvailable(v) && (canDeliver(v.id) || heartSceneReady(v.id)));
  const head = `<div class="view-head"><h1>Bramblebrook</h1><p>The village down the lane</p></div>${subtabs('town', { mail: unread > 0, board: choresReady, people })}`;
  if (s === 'shops') return head + viewShops();
  if (s === 'board') return head + viewBoard();
  if (s === 'mail') return head + viewMail();
  return head + viewPeople();
}
function viewPeople() {
  const st = storyStatus();
  const cards = I.vils.filter(vilAvailable).map(v => {
    const step = (st.kind === 'talk' || st.kind === 'deliver') && st.who === v.id;
    const q = curRequest(v.id);
    const h = hearts(v.id), max = C.core.friendship.maxHearts;
    const scene = heartSceneReady(v.id);
    let reqHTML;
    if (!q) reqHTML = `<p class="quote muted">"${esc(fill(pickLineFor(v.id)))}"</p>`;
    else if (!reqMet(q.req)) reqHTML = `<p class="sub">No request right now. Check back ${esc(reqProblems(q.req).join(', '))}.</p>`;
    else reqHTML = `<p class="quote">"${esc(fill(q.say))}"</p>
      <div class="needs">${Object.entries(q.want).map(([id, n]) => chip(id, `${Math.min(have(id), n)}/${n}`, have(id) >= n ? '' : 'short')).join('')}</div>
      <p class="reward">Reward: ${esc(giveSummary(q.give))} · +friendship</p>
      <div><button class="btn small" data-act="deliver" data-id="${v.id}" ${canDeliver(v.id) ? '' : 'disabled'}>Give items</button></div>`;
    return `<div class="card npc">${folk(v.id, 48)}
      <div class="npc-body"><div class="npc-head"><b>${esc(v.n)}</b><span class="hearts" aria-label="${h} of ${max} hearts">${'♥'.repeat(h)}${'♡'.repeat(max - h)}</span></div>
      <p class="sub">${esc(v.role)}</p>
      ${step ? `<button class="story" data-act="story"><span class="label">Main story</span><p>${esc(st.text)}</p><span class="go">${esc(st.btn)}</span></button>` : ''}
      ${reqHTML}
      <div class="row">
        <button class="btn small ghost" data-act="chat" data-id="${v.id}">Chat</button>
        <button class="btn small ghost" data-act="gift" data-id="${v.id}" ${state.gifted[v.id] === dayKey() ? 'disabled' : ''}>${state.gifted[v.id] === dayKey() ? 'Gift given today' : 'Give a gift'}</button>
        ${scene ? `<button class="btn small sun" data-act="heart" data-id="${v.id}">♥ ${esc(scene.title)}</button>` : ''}
      </div></div></div>`;
  }).join('');
  return cards;
}
const pickLineFor = vid => pickLine((I.vil[vid] || {}).greet) || 'Lovely day, isn\'t it?';
function giveSummary(g) {
  if (!g) return '';
  const bits = [];
  if (g.coins) bits.push(`${fmtN(g.coins)} coins`);
  for (const [sk, x] of Object.entries(g.xp || {})) bits.push(`${x} ${skillName(sk)} XP`);
  for (const [id, n] of Object.entries(g.items || {})) bits.push(`${n}× ${itemName(id)}`);
  if (g.plots) bits.push('a new farm plot');
  return bits.join(' · ');
}
function viewShops() {
  const nextBarn = C.core.barn[state.barn + 1];
  const pc = plotCost();
  const rows = C.core.store.filter(s => unlocked(s.unlock)).map(s => `<div class="store-item">${pic(s.item, 32)}<div class="what"><b>${esc(itemName(s.item))} ×${s.qty}</b><small>You have ${have(s.item)}</small></div>
    <button class="btn small" data-act="buy" data-id="${s.id}" ${state.coins >= s.price ? '' : 'disabled'}>${fmtN(s.price)}c</button></div>`).join('');
  let saffi = '';
  if (unlocked('merchant')) {
    ensureMerchant();
    const m = state.merchant;
    const left = 10 - (m.sold || 0);
    saffi = `<div class="card"><div class="row" style="gap:12px">${folk('saffi', 48)}<div><h2>Saffi's painted cart</h2><p class="sub">"${esc(fill(pickLine(I.merchant.greet) || 'Rare things, fair prices!'))}"</p></div></div>
      ${m.stock.map((s, i) => `<div class="store-item">${pic(s.item, 32)}<div class="what"><b>${esc(itemName(s.item))} ×${s.qty}</b><small>${s.sold ? 'Sold' : 'Today only'}</small></div>
        <button class="btn small" data-act="saffi-buy" data-i="${i}" ${!s.sold && state.coins >= s.price ? '' : 'disabled'}>${fmtN(s.price)}c</button></div>`).join('')}
      <div class="store-item">${pic(m.want, 32)}<div class="what"><b>Saffi wants ${esc(itemName(m.want))}</b><small>Pays double: ${fmtN(priceOf(m.want) * 2)}c each, up to ${left} more today</small></div>
        <button class="btn small sun" data-act="saffi-sell" ${have(m.want) && left > 0 ? '' : 'disabled'}>Sell ${Math.min(have(m.want), left) || ''}</button></div></div>`;
  }
  return `<div class="card" data-tour="store"><h2>Pennywhistle's General Store</h2><p class="sub">Seeds are bought as you sow. Sell your goods from the Bag.</p>
    ${rows}
    <div class="store-item"><span class="emo" style="--s:32px">🟩</span><div class="what"><b>New farm plot</b><small>${state.plots.length}/${C.core.plots.max} plots</small></div>
      ${state.plots.length < C.core.plots.max ? `<button class="btn small" data-act="buy-plot" ${state.coins >= pc ? '' : 'disabled'}>${fmtN(pc)}c</button>` : '<span class="chip plain">All bought</span>'}</div>
    <div class="store-item"><span class="emo" style="--s:32px">🛖</span><div class="what"><b>${nextBarn ? `Upgrade to ${esc(nextBarn.n)}` : esc(C.core.barn[state.barn].n)}</b><small>Holds ${fmtN(cap())} of each item${nextBarn ? ` → ${fmtN(nextBarn.cap)}` : ''}</small></div>
      ${nextBarn ? `<button class="btn small" data-act="buy-barn" ${state.coins >= nextBarn.cost ? '' : 'disabled'}>${fmtN(nextBarn.cost)}c</button>` : '<span class="chip plain">Maxed</span>'}</div>
  </div>${featureOn('exchange') ? viewExchange() : ''}${saffi}`;
}
function viewBoard() {
  ensureChores();
  const chores = state.chores.list.map((c, i) => {
    const d = C.core.chores.find(x => x.id === c.id), p = choreProgress(c), done = p >= c.n;
    return `<div class="chore${c.claimed ? ' done' : ''}"><div class="what"><b>${esc(d.text.replace('{n}', fmtN(c.n)))}</b>${progressBar(p, c.n)}<small class="muted num">${fmtN(p)}/${fmtN(c.n)} · ${c.coins} coins${d.items ? ' + bait' : ''}</small></div>
      ${c.claimed ? '<span class="chip plain">Claimed</span>' : `<button class="btn small" data-act="chore" data-i="${i}" ${done ? '' : 'disabled'}>Claim</button>`}</div>`;
  }).join('');
  const all = state.chores.list.every(c => c.claimed);
  const w = weather();
  return `${featureOn('daily') ? viewDaily() : ''}${featureOn('festival') ? viewFestival() : ''}<div class="card" data-tour="chores"><div class="row between"><h2>Today's chores</h2><span class="chip plain">New list at midnight</span></div>${chores}
      ${all && !state.chores.bonus ? '<button class="btn sun" data-act="chore-bonus">All done! Claim bonus: 2 Grow Tonic</button>' : ''}</div>
    <div class="card"><h2>Valley almanac</h2><p>Day ${dayNumber()} · ${esc(season())}</p><p class="sub">Weather: ${esc(w.n)}. ${esc(w.desc)}</p>
      <p class="sub">Seasons turn every seven days. Weather changes at midnight.</p></div>`;
}
function viewMail() {
  if (!state.mail.length) return '<div class="card"><p class="muted">No letters yet. Folks write as they get to know you.</p></div>';
  return state.mail.map(m => {
    const l = I.letters.find(x => x.id === m.id);
    if (!l) return '';
    return `<button class="letter${m.read ? '' : ' unread'}" data-act="letter" data-id="${m.id}">${folk(l.from, 40)}<span class="what"><b>${esc(fill(l.subject))}</b><small>From ${esc(vilName(l.from))}${l.give && !m.claimed ? ' · gift inside' : ''}</small></span></button>`;
  }).join('');
}

/* ---- Bag ---- */
function viewBag() {
  const s = sub('bag');
  const head = `<div class="view-head"><h1>${{ items: 'Bag', almanac: 'Almanac', feats: 'Feats', perks: 'Perks', settings: 'Settings' }[s]}</h1><p>${s === 'items' ? `Barn holds ${fmtN(cap())} of each item` : s === 'almanac' ? `${Object.keys(state.seen).length} of ${Object.keys(I.items).length} found` : s === 'feats' ? `${Object.keys(state.ach).length} of ${I.ach.length} earned` : ''}</p></div>${subtabs('bag')}`;
  if (s === 'almanac') return head + viewAlmanac();
  if (s === 'feats') return head + viewFeats();
  if (s === 'perks') return head + viewPerks();
  if (s === 'settings') return head + viewSettings();
  return head + viewItems();
}
function viewItems() {
  const ids = Object.keys(I.items).filter(id => have(id) > 0);
  const groups = Object.keys(C.core.types).map(t => {
    const list = ids.filter(id => I.items[id].t === t);
    if (!list.length) return '';
    const sellable = ['crop', 'fruit', 'fish', 'forage', 'ore', 'animal'].includes(t);
    return `<div class="card"><div class="row between"><h2>${esc(C.core.types[t])}</h2>${sellable ? `<button class="btn small ghost" data-act="sell-type" data-t="${t}">Sell all</button>` : ''}</div>
      <div class="inv">${list.map(id => slotHTML(id)).join('')}</div></div>`;
  }).join('');
  const lost = overflowCount() ? `<div class="card" style="border-color:var(--sun)"><div class="row between"><h2>Lost &amp; found</h2><button class="btn small sun" data-act="take-overflow">Take what fits</button></div>
    <p class="sub">These didn't fit in your barn, so they're waiting here. Sell something or upgrade the barn, then take them.</p>
    <div class="row">${Object.entries(state.overflow).map(([id, n]) => chip(id, n)).join('')}</div></div>` : '';
  return lost + (groups || '<div class="card"><p class="muted">Your bag is empty. Harvest, explore or fish to fill it.</p></div>');
}
function slotHTML(id, act = 'item') {
  const t = masteryTier(id);
  return `<button class="slot${have(id) >= cap() ? ' full' : ''}" data-act="${act}" data-id="${id}">${t ? `<span class="stars">${'★'.repeat(t)}</span>` : ''}${state.locked[id] ? '<span class="lock" aria-label="Locked">🔒</span>' : ''}${pic(id, 32)}<span class="nm">${esc(itemName(id))}</span><span class="q">${have(id)}</span></button>`;
}
function viewAlmanac() {
  const groups = Object.keys(C.core.types).filter(t => t !== 'key').map(t => {
    const list = Object.keys(I.items).filter(id => I.items[id].t === t);
    const found = list.filter(id => state.seen[id]).length;
    return `<div class="card"><div class="row between"><h2>${esc(C.core.types[t])}</h2><span class="chip plain">${found}/${list.length}</span></div>
      <div class="inv">${list.map(id => state.seen[id] ? `<button class="slot" data-act="item" data-id="${id}">${masteryTier(id) ? `<span class="stars">${'★'.repeat(masteryTier(id))}</span>` : ''}${pic(id, 32)}<span class="nm">${esc(itemName(id))}</span><span class="q">${fmtN(state.got[id] || 0)}</span></button>`
        : '<div class="slot unseen"><span class="unknown">?</span><span class="nm">Not found</span></div>').join('')}</div></div>`;
  }).join('');
  return `<p class="sub">The number under each item is how many you've gathered in all. Gathering lots earns mastery stars (★), coins and a better sale price.</p>${groups}`;
}
function viewFeats() {
  return `<div class="card">${I.ach.map(a => {
    const got = state.ach[a.id], v = Math.min(statValue(a.stat), achGoal(a));
    return `<div class="feat${got ? ' got' : ''}"><span class="medal">${got ? '★' : ''}</span><div class="what"><b>${esc(a.n)}</b><small>${esc(a.desc)}${got ? '' : ` · ${fmtN(v)}/${fmtN(achGoal(a))}`}</small></div><span class="sub">${esc(giveSummary(a.give))}</span></div>`;
  }).join('')}</div>`;
}
function viewSettings() {
  const s = state.stats;
  const where = cloud.ready ? 'Saved to your Claude account and on this device.' : 'Saved on this device. Use a save code to move your farm to another device.';
  return `<div class="card"><h2>${esc(state.name || 'Your farmer')}</h2><div class="stats">
      <div class="stat"><b>${dayNumber()}</b><span>days in the valley</span></div>
      <div class="stat"><b>${fmtN(s.harvested)}</b><span>crops harvested</span></div>
      <div class="stat"><b>${fmtN(s.fish)}</b><span>fish caught</span></div>
      <div class="stat"><b>${fmtN(s.explores)}</b><span>trips explored</span></div>
      <div class="stat"><b>${fmtN(s.digs)}</b><span>digs in the mine</span></div>
      <div class="stat"><b>${fmtN(s.crafted)}</b><span>items crafted</span></div>
      <div class="stat"><b>${fmtN(s.cooked)}</b><span>meals cooked</span></div>
      <div class="stat"><b>${fmtN(s.earned)}</b><span>coins from sales</span></div>
    </div></div>
    <div class="card"><h2>Help &amp; comfort</h2>
      <div class="toggle"><div class="what"><b>Tutorials</b><small>A short guided tour the first time you open each screen</small></div><button class="switch" role="switch" aria-label="Tutorials" aria-checked="${!state.opts.tipsOff}" data-act="opt" data-id="tipsOff"></button></div>
      <div class="toggle"><div class="what"><b>Relaxed fishing</b><small>Slower marker, wider green zone, more time to react</small></div><button class="switch" role="switch" aria-label="Relaxed fishing" aria-checked="${!!state.opts.relaxedFish}" data-act="opt" data-id="relaxedFish"></button></div>
      <div class="row"><button class="btn small ghost" data-act="replay-tours">Show all tutorials again</button></div></div>
    <div class="card"><h2>Save</h2><p class="sub">${where}</p>
      <div class="row"><button class="btn small ghost" data-act="export">Show save code</button><button class="btn small ghost" data-act="import-open">Load a save code</button><button class="btn small danger" data-act="reset">Start over</button></div>
      <div id="save-box"></div></div>
    <div class="card"><h2>About</h2><p class="sub">Bramblebrook Farm. Pixel art from the CraftPix and Nine Realms packs. Everything else made for this game.</p></div>`;
}
