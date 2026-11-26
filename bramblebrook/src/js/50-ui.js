/* ---------- header, tabs, sheets, input ---------- */
const TAB_DEFS = [
  { id: 'farm', n: 'Farm', svg: '<path d="M12 21v-9"/><path d="M12 13c0-4.5-3-7-7.5-7 0 4.5 3 7 7.5 7z"/><path d="M12 11c0-3.6 2.4-6 6.5-6 0 3.6-2.4 6-6.5 6z"/>' },
  { id: 'wilds', n: 'Wilds', svg: '<path d="M3 20l6-11 4 7 3-4 5 8z"/><circle cx="17" cy="6" r="2"/>' },
  { id: 'fish', n: 'Fish', svg: '<path d="M15 3v11a4.5 4.5 0 1 1-9 0v-1.5"/><path d="M6 12.5l-2 2"/><path d="M13 3h4"/>' },
  { id: 'make', n: 'Make', svg: '<path d="M4 20l8.5-8.5"/><path d="M11 6l3-3 7 7-3 3z"/><path d="M14.5 9.5l-2 2"/>' },
  { id: 'town', n: 'Town', svg: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-5h4v5"/>' },
  { id: 'bag', n: 'Bag', svg: '<path d="M5 8h14l-1.2 12H6.2z"/><path d="M9 8V6.5a3 3 0 0 1 6 0V8"/>' },
];
const VIEWS = { farm: viewFarm, wilds: viewWilds, fish: viewFish, make: viewMake, town: viewTown, bag: viewBag };

function renderTabs() {
  const tabs = TAB_DEFS.filter(t => tabOn(t.id));
  if (!tabOn(state.tab)) state.tab = 'farm';
  $('#tabs').style.gridTemplateColumns = `repeat(${tabs.length}, minmax(0, 1fr))`;
  $('#tabs').innerHTML = tabs.map(t => `<button class="tab" data-act="tab" data-tab="${t.id}" ${t.id === state.tab ? 'aria-current="page"' : ''}>
    <svg viewBox="0 0 24 24" aria-hidden="true">${t.svg}</svg><span>${t.n}</span>${tabFresh(t.id) ? '<span class="newdot" aria-label="New"></span>' : ''}<span class="badge" id="badge-${t.id}" hidden></span></button>`).join('');
}
const tabFresh = t => isNew('tab:' + t) || (SUBS[t] || []).some(([s]) => isNew(`${t}:${s}`) && subOn(t, s));
function renderView() {
  if (!state) return;
  if (state.tab === 'fish' && (fishing.phase === 'waiting' || fishing.phase === 'bite')) { updateBaitCounts(); return; }
  if (!tabOn(state.tab)) state.tab = 'farm';
  const vkey = state.tab + ':' + sub(state.tab);
  $('#view').innerHTML = (VIEWS[state.tab] || viewFarm)();
  $('#view').classList.toggle('fx-in', vkey !== renderView.last);
  renderView.last = vkey;
  if (state.tab === 'fish') syncFishDom();
  // a ? button on every screen that has a tour
  const head = $('#view .view-head');
  if (head && tourReady(screenKey())) head.insertAdjacentHTML('beforeend', '<button class="help" data-act="help" aria-label="Show the tour for this screen">?</button>');
  const vk = state.tab === 'fish' ? 'tab:fish' : `${state.tab}:${sub(state.tab)}`;
  if (isNew(vk) || isNew('tab:' + state.tab)) { markVisited(vk); markVisited('tab:' + state.tab); setTimeout(() => { renderTabs(); updateBadges(); }, 0); }
  if (tour) requestAnimationFrame(() => placeTour(tourTarget(tour.steps[tour.i].target)));
  else setTimeout(maybeTour, 60);
}
function renderAll() { renderTabs(); updateHeader(true); renderView(); updateBadges(); }

function updateBadges() {
  if (!state) return;
  const set = (id, n) => { const el = $('#badge-' + id); if (el) { el.hidden = !n; el.textContent = n > 99 ? '99+' : n; } };
  set('farm', state.plots.filter(p => p.crop && p.ready <= now()).length + orchardReady() + animalsReady() + petsReady());
  set('make', benchReady() + casksReady());
  set('fish', netsReady());
  set('bag', (featureOn('bag:perks') ? perkPointsFree() : 0) + (overflowCount() ? 1 : 0));
  set('wilds', 0);
  ensureChores();
  set('town', I.vils.filter(v => vilAvailable(v) && (canDeliver(v.id) || heartSceneReady(v.id))).length + (featureOn('town:inn') ? innNew() : 0)
    + (featureOn('town:board') ? state.chores.list.filter(c => !c.claimed && choreProgress(c) >= c.n).length : 0) + state.mail.filter(m => !m.read).length
    + (featureOn('daily') && loginReady() ? 1 : 0) + (featureOn('festival') ? festivalOpenCount() : 0) + (socialOn() ? soc.dms : 0));
  updateSocialBadges();
  placeFeedbackTab();
  const st = storyStatus();
  const jb = $('#badge-journal');
  if (jb) { jb.hidden = !st.ready; jb.textContent = '!'; }
}
let lastSkillSig = '';
function updateHeader(force) {
  syncStamina();
  showCoins(state.coins);
  const max = maxStamina();
  $('#stam-now').textContent = state.stamina;
  $('#stam-max').textContent = max;
  $('#stam-bar').style.setProperty('--p', Math.min(1, state.stamina / max));
  const bankEl = $('#stam-bank');
  if (bankEl) { bankEl.hidden = !bankCap(); bankEl.textContent = ` +${fmtShort(state.bank || 0)}`; bankEl.title = `${fmtN(state.bank || 0)} stamina saved in your bed`; }
  $('#almanac').textContent = `Day ${dayNumber()} · ${season()} · ${weather().n}`;
  const buffs = Object.keys(I.buffs).filter(buffOn).map(b => `<span class="buff">${esc(I.buffs[b].n)} ${fmtT((state.buffs[b] - now()) / 1000)}</span>`).join('');
  const bEl = $('#buffs');
  bEl.innerHTML = buffs; bEl.hidden = !buffs;
  const sig = I.skills.map(s => (skillOn(s.id) ? '' : '-') + state.xp[s.id]).join(',');
  if (sig === lastSkillSig && !force) return;
  lastSkillSig = sig;
  const shown = I.skills.filter(s => skillOn(s.id));
  $('#skills').style.gridTemplateColumns = `repeat(${shown.length}, minmax(0, 1fr))`;
  $('#skills').innerHTML = shown.map(s => {
    const L = levelInfo(state.xp[s.id] || 0);
    return `<button class="skill" data-act="skill" data-id="${s.id}" aria-label="${esc(s.n)} level ${L.lvl}"><span>${esc(s.short)}</span><b>${L.lvl}</b>${progressBar(L.into, L.need || 1)}</button>`;
  }).join('');
}

/* toasts */
/* Notifications drop in from just under the header, two at most. While a story scene, an adventure or a
   guided tour is on screen they wait their turn, so nothing is ever drawn over what you are reading. */
const toastQ = [];
const toastBusy = () => sceneOpen || !!advRun || !!tour || !!$('#scene-root .scene-wrap');
function toast(msg, kind = '', ms = 2800) {
  fbNote('toasts', msg);
  if (toastQ.some(t => t.msg === msg) || $$('#toasts .toast').some(el => el.dataset.msg === msg)) return;
  toastQ.push({ msg, kind, ms, born: Date.now() });
  flushToasts();
}
function flushToasts() {
  const box = $('#toasts');
  if (!box || toastBusy()) return;
  placeToasts();
  const fresh = t => Date.now() - t.born < (t.kind === 'lvl' ? 120000 : 10000);
  for (let i = toastQ.length - 1; i >= 0; i--) if (!fresh(toastQ[i])) toastQ.splice(i, 1);
  while (toastQ.length && box.children.length < 2) {
    const { msg, kind, ms, born } = toastQ.shift();
    const el = document.createElement('div');
    const [head, ...rest] = msg.split('\n');
    el.className = 'toast ' + kind + (rest.length ? ' multi' : '');
    el.dataset.msg = msg;
    el.dataset.born = born;
    if (rest.length) el.innerHTML = `<b>${esc(head)}</b>${rest.map(r => `<span>${esc(r)}</span>`).join('')}`;
    else el.textContent = msg;
    const gone = () => { if (!el.isConnected) return; el.remove(); flushToasts(); };
    el.addEventListener('click', gone);
    box.appendChild(el);
    setTimeout(gone, ms);
  }
}
/* Something to read has opened: anything showing goes back to the front of the line and waits. */
function holdToasts() {
  const box = $('#toasts');
  if (!box) return;
  const back = $$('#toasts .toast').map(el => ({ msg: el.dataset.msg, kind: el.className.replace(/\btoast\b|\bmulti\b/g, '').trim(), ms: 2800, born: +el.dataset.born || Date.now() }));
  box.innerHTML = '';
  toastQ.unshift(...back);
}
function placeToasts() {
  const sk = $('#skills'), top = $('.top');
  // over the skill bars normally; with a sheet up, at the very top, above the sheet
  const y = $('#sheet-root .sheet') ? 8 : sk && sk.offsetHeight ? sk.getBoundingClientRect().top : top ? top.getBoundingClientRect().bottom : 0;
  document.documentElement.style.setProperty('--toast-top', Math.max(0, Math.round(y)) + 'px');
}

/* sheets */
let sheetFn = null;
function openSheet(html, refresh) {
  sheetFn = refresh || null;
  $('#sheet-root').innerHTML = `<div class="sheet-wrap" data-act="sheet-close"><div class="sheet" role="dialog" aria-modal="true">${html}</div></div>`;
  placeToasts();
  const first = $('#sheet-root .sheet button');
  if (first) first.focus({ preventScroll: true });
}
function closeSheet() { sheetFn = null; $('#sheet-root').innerHTML = ''; $('#sheet-root').classList.remove('over-scene'); placeToasts(); }
const sheetOpen = () => !!$('#sheet-root').innerHTML;

function itemSheet(id) {
  const it = I.items[id];
  if (!state.seen[id]) return;
  const where = [];
  const crop = I.crop[id];
  if (crop) where.push(crop.flag ? 'Heirloom seeds' : `Grow it (Farming ${crop.lvl})`);
  if (I.tree[id]) where.push(`Orchard (${I.tree[id].n})`);
  I.animals.forEach(a => { if (a.produce === id) where.push(a.n); });
  const odds = (w, table) => { const tot = Object.values(table).reduce((x, y) => x + y, 0); const p = w / tot; return p >= 0.1 ? `${Math.round(p * 100)}%` : `about 1 in ${Math.round(1 / p)}`; };
  I.areas.forEach(a => { if (a.drops[id]) where.push(`${a.n} (${odds(a.drops[id], a.drops)} of trips)`); });
  C.core.mine.bands.forEach(b => { if (b.drops[id]) where.push(`Mine floors ${b.from}-${b.to === 30 ? '30+' : b.to} (${odds(b.drops[id], b.drops)} of digs)`); });
  C.core.mine.rare.forEach(r => { if (r.item === id) where.push(`Mine floor ${r.from}+`); });
  I.spots.forEach(s => { const f = s.fish.find(x => x[0] === id); if (f) where.push(`${s.n} (${odds(f[1], Object.fromEntries(s.fish.map(x => [x[0], x[1]])))} of bites${f[2] === 5 ? ', guaranteed within ' + PITY.legendary + ' bites' : ''})`); });
  if (I.recipe[id]) where.push(`Workshop (Crafting ${I.recipe[id].lvl})`);
  if (I.meal[id]) where.push(`Kitchen (Cooking ${I.meal[id].lvl})`);
  if (C.core.store.some(s => s.item === id)) where.push('General store');
  if (it.t === 'gear') { const T = C.core.raidTiers[it.tier - 1]; where.push(`Village bosses in tier ${it.tier}, ${T.n} (about 1 win in ${Math.round(1 / T.drop)}, sure by your ${ordinal(T.pity)} win)`); }
  if (id === 'boss_rune') where.push('Every village boss you fight (more from higher tiers)');
  const uses = [];
  I.recipes.concat(I.meals).forEach(r => { if (r.need[id]) uses.push(itemName(r.id)); });
  I.vils.forEach(v => { const q = curRequest(v.id); if (q && q.want[id] && vilAvailable(v)) uses.push(`${vilShort(v.id)} wants ${q.want[id]}`); });
  const lovers = I.vils.filter(v => (v.loves || []).includes(id) && vilAvailable(v)).map(v => vilShort(v.id));
  const n = have(id), key = it.t === 'key', t = masteryTier(id);
  const meal = I.meal[id], netRec = I.recipes.find(x => x.id === id && x.catch);
  openSheet(`
    <div class="sheet-head">${pic(id, 56)}<div><h2>${esc(it.n)}</h2><p class="muted">${rarity(id) ? `<span class="rar${rarClass(id)}">${esc(rarity(id))}</span> · ` : ''}${esc(C.core.types[it.t])} · you have ${n}${key ? '' : `/${fmtN(cap())}`}</p></div></div>
    ${it.t === 'charm' ? `<p>${esc(it.desc)}</p>` : ''}
    <dl>${key ? '' : `<dt>Sells for</dt><dd class="num">${priceOf(id)} coins${t ? ` (${'★'.repeat(t)} mastery)` : ''}</dd>`}
      ${meal && edible(id) ? `<dt>${isDrink(id) ? 'Drink it' : 'Eat it'}</dt><dd>${esc(meal.use || [meal.stamina ? `+${meal.stamina} stamina` : '', meal.buff ? `${I.buffs[meal.buff].n}: ${I.buffs[meal.buff].desc} (${meal.mins} min)` : ''].filter(Boolean).join(' · '))}</dd>` : ''}
      ${netRec ? `<dt>Cast it</dt><dd>${esc(netRec.use)}</dd>` : ''}
      ${it.t === 'gear' ? (() => { const g = gearLines(id); return `<dt>Wear it</dt><dd>${esc(g.slot)} · ${esc(g.on)}${g.fx ? ` · ${esc(g.fx)} in the training yard` : ''}</dd>
        <dt>Enchanted</dt><dd>${g.lv ? `Level ${g.lv} of ${GEARC().enchant.costs.length}` : 'Not yet'}${g.lv < enchantCap() ? ` · next level ${enchantCost(id)} Battle Runes (you have ${have('boss_rune')})` : g.lv < GEARC().enchant.costs.length ? ` · Crafting ${(g.lv) * GEARC().enchant.perCrafting} allows the next level` : ''}</dd>`; })() : ''}
      <dt>Found</dt><dd>${esc([...new Set(where)].join(', ') || (key ? 'A keepsake from the story' : 'Rewards'))}</dd>
      <dt>Used for</dt><dd>${esc(uses.join(', ') || (key ? 'Remembering' : 'Selling'))}</dd>
      ${lovers.length ? `<dt>Loved by</dt><dd>${esc(lovers.join(', '))}</dd>` : ''}
      <dt>Gathered</dt><dd class="num">${fmtN(state.got[id] || 0)} in all</dd></dl>
    <div class="sheet-btns">
      ${meal && edible(id) && n ? `<button class="btn small sun" data-act="eat" data-id="${id}">${isDrink(id) ? 'Drink one' : 'Eat one'}</button>` : ''}
      ${netRec && n ? `<button class="btn small sun" data-act="use-net" data-id="${id}">Cast where you fish</button>` : ''}
      ${it.t === 'gear' && n ? (gearOf(it.slot) === id ? `<button class="btn small ghost" data-act="gear-off" data-slot="${it.slot}">Take it off</button>` : `<button class="btn small sun" data-act="gear-on" data-id="${id}">Wear it</button>`) : ''}
      ${it.t === 'gear' && n && gearLv(id) < enchantCap() ? `<button class="btn small" data-act="gear-enchant" data-id="${id}" ${have('boss_rune') >= enchantCost(id) ? '' : 'disabled'}>Enchant · ${enchantCost(id)} 🔷</button>` : ''}
      ${id === 'tonic' && n ? '<button class="btn small sun" data-act="tonic">Use on the farm</button>' : ''}
      ${it.t === 'charm' && n ? (state.charms.includes(id) ? `<button class="btn small ghost" data-act="charm-off" data-id="${id}">Take it off</button>` : `<button class="btn small sun" data-act="charm-on" data-id="${id}">Wear it</button>`) : ''}
      ${key || !n ? '' : `<button class="btn small" data-act="sell" data-id="${id}" data-n="1">Sell 1 · ${priceOf(id)}c</button>
      <button class="btn small" data-act="sell" data-id="${id}" data-n="all" ${n > 1 && !state.locked[id] ? '' : 'disabled'}>Sell all ${n} · ${fmtN(priceOf(id) * n)}c</button>
      <button class="btn small ghost" data-act="lock" data-id="${id}">${state.locked[id] ? 'Unlock' : 'Lock (keep from Sell all)'}</button>`}
      <button class="btn small ghost" data-act="sheet-close">Close</button>
    </div>`);
}
function giftSheet(vid) {
  const ids = Object.keys(I.items).filter(id => have(id) > 0 && I.items[id].t !== 'key');
  const v = I.vil[vid];
  openSheet(`<div class="sheet-head">${folk(vid, 48)}<div><h2>A gift for ${esc(v.short || v.n)}</h2><p class="muted">One gift a day. Find out what they love.</p></div></div>
    ${ids.length ? `<div class="gift-grid">${ids.map(id => slotHTML(id, 'gift-pick').replace('data-id=', `data-v="${vid}" data-id=`)).join('')}</div>` : '<p class="muted">Your bag is empty.</p>'}
    <div class="sheet-btns"><button class="btn small ghost" data-act="sheet-close">Close</button></div>`);
}
function letterSheet(mid) {
  const m = state.mail.find(x => x.id === mid), l = I.letters.find(x => x.id === mid);
  if (!m || !l) return;
  m.read = true;
  openSheet(`<div class="sheet-head">${folk(l.from, 48)}<div><h2>${esc(fill(l.subject))}</h2><p class="muted">From ${esc(vilName(l.from))}</p></div></div>
    <div class="page-text">${esc(fill(l.body))}</div>
    <div class="sheet-btns">${l.give && !m.claimed ? `<button class="btn small sun" data-act="letter-gift" data-id="${mid}">Take the gift: ${esc(giveSummary(l.give))}</button>` : ''}
    <button class="btn small ghost" data-act="sheet-close">Close</button></div>`);
  commit();
}
function journalHTML() {
  const ch = curChapter(), st = storyStatus();
  let current = '';
  if (ch) {
    const steps = ch.steps.map((s, i) => {
      const done = state.story.started && i < state.story.si, nowStep = state.story.started && i === state.story.si;
      if (!done && !nowStep) return `<div class="step"><i>${i + 1}</i><span class="muted">…</span></div>`;
      let extra = '';
      if (nowStep) {
        const [a, b] = stepProgress(s);
        if (s.type === 'deliver') {
          extra = `<div class="needs" style="margin-top:4px">${Object.entries(s.want).map(([id, n]) => chip(id, `${Math.min(have(id), n)}/${n}`, have(id) >= n ? '' : 'short')).join('')}</div>`;
          // a delivery bigger than the barn holds is a hidden wall unless we say so
          const most = Math.max(...Object.values(s.want));
          if (most > cap()) { const fit = C.core.barn.find(b => b.cap >= most); extra += `<p class="sub barn-note">Your barn holds ${fmtN(cap())} of each item. ${fit ? `Upgrade to the ${esc(fit.n)} in Town › Shops to carry ${fmtN(most)}.` : 'Upgrade it in Town › Shops.'}</p>`; }
        }
        else if (autoStep(s) && s.type !== 'adventure') extra = `<div class="row" style="margin-top:4px"><span class="num sub">${fmtN(Math.min(a, b))}/${fmtN(b)}</span><span style="flex:1">${progressBar(a, b)}</span></div>`;
        else if (s.type === 'adventure') { const adv = I.adv[s.id]; extra = `<p class="sub">${adv ? (reqMet(adv.req) ? `Ready: ${esc(adv.n)}` : esc(reqProblems(adv.req).join(', '))) : ''}</p>`; }
      }
      return `<div class="step ${done ? 'done' : 'now'}"><i>${done ? '✓' : i + 1}</i><div style="flex:1">${esc(fill(s.t))}${extra}</div></div>`;
    }).join('');
    current = `<div class="card"><span class="label">${chapterLabel(state.story.ci)} of ${I.chapters.length - 2}</span><h2>${esc(ch.n)}</h2><p class="sub">${esc(fill(ch.blurb))}</p>
      ${state.story.started ? `<div class="steps">${steps}</div>` : ''}
      ${st.kind === 'queue' ? '' : `<button class="btn" data-act="story" ${st.kind === 'progress' ? 'disabled' : ''}>${esc(st.kind === 'progress' ? 'Keep going: ' + st.text : st.btn)}</button>`}</div>`;
  } else current = '<div class="card"><h2>The Bell rings on</h2><p class="sub">You\'ve finished the main story. There is always more to grow, catch and find.</p></div>';
  const pages = I.pages.map(p => state.pages[p.n] ? `<button class="slot" data-act="page" data-n="${p.n}"><span class="emo" style="--s:28px">📜</span><span class="nm">${esc(p.title)}</span><span class="q">Page ${p.n}</span></button>`
    : `<div class="slot unseen"><span class="unknown">?</span><span class="nm">Missing</span><span class="q">Page ${p.n}</span></div>`).join('');
  const past = I.chapters.filter(c => chapterDone(c.id)).map(c => `<div class="store-item"><div class="what"><b>${esc(c.n)}</b><small>${esc(fill(c.blurb))}</small></div><button class="btn small ghost" data-act="replay" data-id="${c.id}">Replay</button></div>`).join('');
  return `<div class="sheet-head"><span class="emo" style="--s:44px">📖</span><div><h2>${esc(state.name || 'Your')}'s journal</h2><p class="muted">The story of Bramblebrook</p></div></div>
    ${state.story.queue.length ? `<button class="btn sun wide" data-act="story">Read what happened (${state.story.queue.length})</button>` : ''}
    ${current}
    <div class="card"><div class="row between"><h2>Wren's journal pages</h2><span class="chip plain">${Object.keys(state.pages).length}/${I.pages.length}</span></div><div class="inv">${pages}</div></div>
    ${past ? `<div class="card"><h2>Chapters so far</h2>${past}</div>` : ''}
    <div class="sheet-btns"><button class="btn small ghost" data-act="sheet-close">Close</button></div>`;
}
function openJournal() { openSheet(journalHTML(), journalHTML); maybeSheetTour('journal'); }
function pageSheet(n) {
  const p = I.pages.find(x => x.n === n);
  if (!p) return;
  openSheet(`<div class="sheet-head"><span class="emo" style="--s:40px">📜</span><div><h2>${esc(p.title)}</h2><p class="muted">Wren's journal, page ${p.n}</p></div></div>
    <div class="page-text">${esc(fill(p.text))}</div><div class="sheet-btns"><button class="btn small ghost" data-act="journal">Back to journal</button><button class="btn small ghost" data-act="sheet-close">Close</button></div>`);
}

/* actions */
function handle(act, el, e) {
  const id = el.dataset.id;
  if (FARM_ACTS.has(act)) recordMove('h', { act, d: Object.assign({}, el.dataset) });
  switch (act) {
    case 'tab':
      if (state.tab === 'fish' && el.dataset.tab !== 'fish') { clearFishTimers(); fishing.phase = 'idle'; fishing.msg = ''; }
      state.tab = el.dataset.tab; renderTabs(); renderView(); updateBadges(); window.scrollTo(0, 0); return false;
    case 'sub': state.sub[el.dataset.tab] = el.dataset.sub; renderView(); return false;
    case 'skill': {
      const L = levelInfo(state.xp[id] || 0);
      toast(L.need ? `${skillName(id)} ${L.lvl}: ${fmtN(L.need - L.into)} XP to level ${L.lvl + 1}` : `${skillName(id)} is maxed`);
      return false;
    }
    case 'journal': openJournal(); return false;
    case 'story': storyAction(); return false;
    case 'page': pageSheet(+el.dataset.n); return false;
    case 'replay': { const c = I.chapter[id]; closeSheet(); playScene(c.intro, { title: c.n }); playScene(c.outro, { title: c.n + ' · ending' }); return false; }
    case 'seed': state.seed = id; break;
    case 'plot': {
      const i = +el.dataset.i, p = state.plots[i];
      if (!p.crop) { if (!plant(i)) return false; }
      else if (p.ready <= now()) { if (harvest(i) === -1) { toast(`Barn is full of ${itemName(p.crop)}. Sell some first.`); return false; } }
      else { toast(`${itemName(p.crop)} is ready in ${fmtT((p.ready - now()) / 1000)}`); return false; }
      break;
    }
    case 'harvest-all': {
      if (!perkRank('harvestall')) { perkSheet('harvestall'); return false; }
      let n = 0, full = false, done = 0;
      const max = perkCount('harvestall');
      state.plots.forEach((p, i) => { if (done >= max || !p.crop || p.ready > now()) return; const g = harvest(i); if (g > 0) { n += g; done++; } if (g === -1) full = true; });
      if (n) toast(`Harvested ${plural(n, 'crop')}`);
      if (full) toast('Some crops are waiting: your barn is full of them.');
      break;
    }
    case 'sow-all': {
      if (!perkRank('sowall')) { perkSheet('sowall'); return false; }
      let n = 0;
      const max = perkCount('sowall');
      state.plots.forEach((p, i) => { if (n < max && !p.crop && plant(i, true)) n++; });
      if (!n) { toast(`You need ${I.crop[state.seed].seed} coins per ${itemName(state.seed)} seed.`); return false; }
      toast(`Sowed ${n} ${itemName(state.seed)}`);
      break;
    }
    case 'tonic': if (!useTonic()) return false; closeSheet(); break;
    case 'install': if (!installUpgrade(id)) return false; break;
    case 'tree-slot': {
      const i = +el.dataset.i;
      openSheet(`<h2>Plant a tree</h2><p class="sub">Trees fruit forever once planted.</p>${I.trees.map(t => `<div class="store-item">${pic(t.id, 32)}<div class="what"><b>${esc(t.n)}</b><small>${t.yield} ${esc(itemName(t.id))} every ${fmtT(t.grow)} · Farming ${t.lvl}</small></div>
        <button class="btn small" data-act="plant-tree" data-i="${i}" data-id="${t.id}" ${lvl('farming') >= t.lvl && state.coins >= t.cost ? '' : 'disabled'}>${fmtN(t.cost)}c</button></div>`).join('')}
        <div class="sheet-btns"><button class="btn small ghost" data-act="sheet-close">Close</button></div>`);
      return false;
    }
    case 'plant-tree': if (!plantTree(+el.dataset.i, id)) return false; closeSheet(); break;
    case 'tree': { const g = harvestTree(+el.dataset.i); if (g === -1) { toast('Your barn is full of that fruit.'); return false; } if (!g) { toast('Not ready yet.'); return false; } toast(`Picked ${g} fruit`); break; }
    case 'harvest-trees': { let n = 0; state.orchard.forEach((s, i) => { const g = harvestTree(i); if (g > 0) n += g; }); if (n) toast(`Picked ${n} fruit`); break; }
    case 'collect': { const g = collectAnimal(I.animal[id]); if (g === -1) { toast(`Your barn is full of ${itemName(I.animal[id].produce)}.`); return false; } if (g) toast(`Collected ${g} ${itemName(I.animal[id].produce)}`); break; }
    case 'collect-all': { let n = 0; I.animals.forEach(a => { const g = collectAnimal(a); if (g > 0) n += g; }); if (n) toast(`Collected ${n} goods`); break; }
    case 'buy-animal': if (!buyAnimal(I.animal[id])) return false; break;
    case 'pet': if (perkRank('petall') < 2) { perkSheet('petall'); return false; } if (!petAnimals()) return false; break;
    case 'pet-pen': {   // Animal Whisperer rank 1: a whole pen in one tap
      if (perkRank('petall') < 1) { perkSheet('petall'); return false; }
      const a = I.animal[id], n = a ? petPen(id) : 0;
      if (!n) return false;
      toast(`The ${a.n.toLowerCase()} loved the attention: +${n} ${itemName(a.produce)}`);
      break;
    }
    case 'pet-one': if (!petOne(id, el.dataset.i)) return false; break;
    case 'area': state.area = id; state.sub.place = id; window.scrollTo(0, 0); break;
    case 'place-back': state.sub.place = ''; renderView(); window.scrollTo(0, 0); return false;
    case 'water-back':
      if (fishing.phase === 'waiting' || fishing.phase === 'bite') { clearFishTimers(); fishing.phase = 'idle'; fishing.msg = ''; }
      state.sub.water = ''; renderView(); window.scrollTo(0, 0); return false;
    case 'explore': case 'dig': {
      const n = el.dataset.n === 'all' ? Infinity : +el.dataset.n || 1;
      if (n > tripsMax()) { perkSheet('trips'); return false; }
      (act === 'explore' ? explore : dig)(el.dataset.n);
      break;
    }
    case 'need-perk': perkSheet(id); return false;
    case 'perk-learn': if (!buyPerk(id)) return false; closeSheet(); break;
    case 'descend': descend(); break;
    case 'lift': elevator(+el.dataset.n); break;
    case 'adventure': case 'quest': { const a = findQuest(id); if (a && (a.floor || reqMet(a.req))) startQuest(a); return false; }
    case 'quest-go': { const a = findQuest(id); closeSheet(); if (a) playAdventure(a, false, el.dataset.c); return false; }
    case 'charm-pick': charmSheet(); return false;
    case 'charm-on': if (!wearCharm(id)) return false; closeSheet(); break;
    case 'charm-off': if (!removeCharm(id)) return false; closeSheet(); toast(`Took off ${itemName(id)}`); break;
    case 'spot': state.spot = id; state.sub.water = id; window.scrollTo(0, 0); break;
    case 'bait': state.bait = id; break;
    case 'craft': craft(id, el.dataset.n); break;
    case 'cook': cook(id, el.dataset.n); break;
    case 'eat': if (!eat(id)) return false; if (sheetOpen()) closeSheet(); break;
    case 'item': itemSheet(id); return false;
    case 'noop': return false;
    case 'sell': { const c = sell(id, el.dataset.n); if (c) toast(`Sold for ${fmtN(c)} coins`); closeSheet(); break; }
    case 'sell-type': {
      let c = 0;
      Object.keys(state.inv).forEach(iid => { if (I.items[iid].t === el.dataset.t && !state.locked[iid]) c += sell(iid, 'all'); });
      toast(c ? `Sold for ${fmtN(c)} coins` : 'Nothing to sell (locked items are kept)');
      break;
    }
    case 'lock': if (state.locked[id]) delete state.locked[id]; else state.locked[id] = true; commit(); itemSheet(id); return false;
    case 'buy': if (!buyStore(id)) return false; break;
    case 'buy-plot': { const c = plotCost(); if (state.coins < c || state.plots.length >= C.core.plots.max) return false; state.coins -= c; state.plots.push({ crop: null, at: 0, ready: 0 }); toast('New plot tilled'); break; }
    case 'buy-barn': { const nb = C.core.barn[state.barn + 1]; if (!nb || state.coins < nb.cost) return false; state.coins -= nb.cost; state.barn++; toast(`Your ${nb.n} holds ${fmtN(nb.cap)} of each item`); break; }
    case 'saffi-buy': if (!merchantBuy(+el.dataset.i)) return false; break;
    case 'saffi-sell': if (!merchantSell()) return false; break;
    case 'chore': if (!claimChore(+el.dataset.i)) return false; break;
    case 'chore-bonus': if (state.chores.bonus || !state.chores.list.every(c => c.claimed)) return false; state.chores.bonus = true; addItem('tonic', 2); toast('Bonus: 2 Grow Tonic'); break;
    case 'deliver': {
      const r = deliverRequest(id);
      if (!r) return false;
      commit();
      playScene([{ who: id, say: pickLine([I.vil[id].thanks && I.vil[id].thanks.loved].filter(Boolean)) || 'Thank you, {name}!' }], { title: 'Request filled', rewards: r.lines });
      return 'done';
    }
    case 'chat': {
      const first = state.chatted[id] !== dayKey();
      if (first) { state.chatted[id] = dayKey(); addFriend(id, 5); }
      commit();
      playScene([{ who: id, say: pickLineFor(id) }]);
      return false;
    }
    case 'gift': giftSheet(id); return false;
    case 'gift-pick': {
      const vid = el.dataset.v, kind = giveGift(vid, id);
      if (!kind) return false;
      closeSheet(); commit();
      const v = I.vil[vid];
      playScene([{ who: vid, say: (v.thanks && v.thanks[kind]) || 'Thank you!' }], { title: `${itemName(id)} for ${v.short || v.n}` });
      return 'done';
    }
    case 'heart': {
      const h = heartSceneReady(id);
      if (!h) return false;
      state.heartSeen[id] = Object.assign({}, state.heartSeen[id], { [h.at]: now() });
      gainInsp(1, `time with ${vilShort(id)}`);
      const rewards = applyGive(h.give);
      commit();
      playScene(h.scene, { title: `${h.at} ♥ · ${h.title}`, rewards });
      return 'done';
    }
    case 'letter': letterSheet(id); return false;
    case 'letter-gift': {
      const m = state.mail.find(x => x.id === id), l = I.letters.find(x => x.id === id);
      if (!m || m.claimed || !l || !l.give) return false;
      m.claimed = true; const lines = applyGive(l.give); toast(lines.join(' · ')); closeSheet(); break;
    }
    case 'online-open': onlineSheet(id === 'signin' ? 'signin' : 'signup'); return false;
    case 'play-offline': askName.skip = true; askName(); return false;
    case 'start-over': openSheet(`<h2>Start a new farm?</h2><p class="sub">This throws away ${esc(state.name || 'this')}'s farm and starts again from the letter.${online ? ' Your online copy is reset too, on every device.' : ''} It can't be undone.</p>
      <div class="sheet-btns"><button class="btn small ghost" data-act="sheet-close">Keep my farm</button><button class="btn small danger" data-act="start-over-yes">Start over</button></div>`); return false;
    case 'start-over-yes': startOver(); return false;
    case 'online-link-make': makeLink(); return false;
    case 'vil-found': foundSheet(); return false;
    case 'notes': notesSheet(); return false;
    case 'feedback': openFeedback(); return false;
    case 'msg-menu': msgMenu(el); return false;
    case 'report-open': safe.reason = ''; reportSheet(el.dataset); return false;
    case 'report-reason': safe.reason = id; reportSheet({ kind: safe.report.kind, id: safe.report.ref || '', user: safe.report.user, name: safe.report.name }); return false;
    case 'report-send': sendReport(); return false;
    case 'block': blockPlayer(el.dataset.user, el.dataset.name); return false;
    case 'unblock': unblockPlayer(el.dataset.user).then(() => { if (soc.profile && soc.profile.id === el.dataset.user) showProfile(soc.profile); }); return false;
    case 'blocked-list': blockedSheet(); return false;
    case 'delete-account': deleteAccountSheet(); return false;
    case 'delete-account-go': deleteAccount(); return false;
    case 'mod': modAction(+id, el.dataset.to); return false;
    case 'fb-kind': fb.kind = id; feedbackSheet(); return false;
    case 'fb-send': sendFeedback(); return false;
    case 'fb-inbox': feedbackInbox(); return false;
    case 'fb-filter': fb.filter = id; fb.replyTo = 0; drawInbox(); return false;
    case 'fb-reply': fb.replyTo = +id; fb.reply = ''; drawInbox(); return false;
    case 'fb-mark': markFeedback(+id, el.dataset.to); return false;
    case 'note-go': noteGo(el.dataset.to, id); return false;
    case 'follow': toggleFollow(id); return false;
    case 'dm-open': openDm(id); return false;
    case 'dm-back': soc.thread = null; soc.threads = null; renderView(); return false;
    case 'chat-tab': soc.tab = id; soc.thread = null; socKeep(); renderView(); return false;
    case 'raid-open': openRaid(); return false;
    case 'raid-start': raidStart(id); return false;
    case 'raid-claim': raidClaim(); return false;
    case 'class-pick': classPickSheet(); return false;
    case 'fight': fightSheet(id); return false;
    case 'fight-pal': { const w = fightPick.with; if (w.includes(id)) fightPick.with = w.filter(x => x !== id); else if (w.length < 2) w.push(id); else { w.shift(); w.push(id); } return true; }
    case 'fight-go': startFight(fightPick.id, fightPick.with.slice()); return false;
    case 'class-choose': if (chooseClass(id)) { closeSheet(); return true; } return false;
    case 'vil-join': case 'vil-give': case 'vil-build': case 'vil-leave': villageAct(act, el); return false;
    case 'vil-refresh': vil.at = 0; vil.err = ''; refreshVillage(true); return false;
    case 'online-profile': openProfile(id || online.user); return false;
    case 'online-show': setShowOnline(!(prof.me && prof.me.show_online === false) ? false : true).then(() => openProfile(online.user)); return false;
    case 'online-link-off': unLink(); return false;
    case 'online-link-copy': { const i = $('#link-addr'); if (i) { i.select(); (navigator.clipboard ? navigator.clipboard.writeText(i.value) : Promise.reject()).then(() => toast('Copied'), () => { try { document.execCommand('copy'); toast('Copied'); } catch (e) { toast('Select the address and copy it'); } }); } return false; }
    case 'online-link-allow': onl.link = ''; renderView(); initLink(); return false;
    case 'online-link-stop': online = null; storeOnline(); onl.link = 'missing'; toast('Stopped syncing here. Remove the connector in Claude to turn it off fully.'); break;
    case 'online-sync': pushCloud().then(() => { renderView(); toast(onl.err ? onl.err : 'Saved online'); }); renderView(); return false;
    case 'online-signout': onlineSignOut(); break;
    case 'export': {
      let code = '';
      try { code = btoa(unescape(encodeURIComponent(JSON.stringify(state)))); } catch (err) { code = ''; }
      $('#save-box').innerHTML = `<label class="label" for="save-out">Your save code</label><textarea id="save-out" readonly>${esc(code)}</textarea><div class="row"><button class="btn small" data-act="copy">Copy code</button></div>`;
      return false;
    }
    case 'copy': {
      const ta = $('#save-out');
      const fallback = () => { ta.focus(); ta.select(); toast('Code selected. Copy it from here.'); };
      try { navigator.clipboard.writeText(ta.value).then(() => toast('Save code copied'), fallback); } catch (err) { fallback(); }
      return false;
    }
    case 'import-open':
      $('#save-box').innerHTML = '<label class="label" for="save-in">Paste a save code</label><textarea id="save-in" placeholder="Paste the code from your other device"></textarea><div class="row"><button class="btn small" data-act="import">Load this farm</button></div>';
      $('#save-in').focus();
      return false;
    case 'import':
      if (mv.on) { toast('Save codes are for farms without an account. Your farm is already saved to your account.'); return false; }
      try {
        const s = JSON.parse(decodeURIComponent(escape(atob($('#save-in').value.trim()))));
        if (!s || s.v !== 2) throw new Error('bad');
        state = migrate(s); state.savedAt = now();
        toast('Farm loaded');
        renderAll();
        break;
      } catch (err) { toast("That code didn't work. Copy the whole code and try again."); return false; }
    case 'perk': if (!buyPerk(id)) return false; break;
    case 'perk-reset': if (!resetPerks()) return false; break;
    case 'bench-slot': benchSheet(+el.dataset.i); return false;
    case 'bench-queue': if (!benchQueue(+el.dataset.i, id, el.dataset.n)) return false; closeSheet(); break;
    case 'bench-collect': { const g = benchCollect(+el.dataset.i); if (g === -1) { toast('Your barn is full of that.'); return false; } if (g) toast(`Took ${g} from the workbench`); break; }
    case 'bench-cancel': benchCancel(+el.dataset.i); break;
    case 'bench-buy': { const c = benchSlotCost(); if (state.bench.length >= C.core.workbench.maxSlots || state.coins < c) return false; state.coins -= c; state.bench.push(null); toast('Another pair of hands at the workbench'); break; }
    case 'orchard-buy': if (!buyOrchardSpot()) return false; break;
    case 'bunk-buy': if (!buyBunk()) return false; break;
    case 'bed-buy': if (!buyBed()) return false; break;
    case 'gear-on': if (!gearOn(id)) return false; if (sheetOpen()) closeSheet(); break;
    case 'gear-off': if (!gearOff(el.dataset.slot || (I.items[id] && I.items[id].slot))) return false; if (sheetOpen()) closeSheet(); break;
    case 'gear-enchant': if (!enchantGear(id)) return false; if (sheetOpen()) itemSheet(id); break;
    case 'gear-pick': gearSheet(el.dataset.slot); return false;
    case 'use-net': if (!useNet(id)) return false; if (sheetOpen()) closeSheet(); break;
    case 'stair-light': if (!lightLantern()) return false; break;
    case 'hire-hand': hireHand(el.dataset); return false;
    case 'drop-hand': dropHand(el.dataset); return false;
    case 'hand-search': handSearch(); return false;
    case 'hands-hire': hf.page = 'hire'; hf.market = null; loadHands(true); renderView(); window.scrollTo(0, 0); return false;
    case 'hands-back': hf.page = ''; renderView(); window.scrollTo(0, 0); return false;
    case 'hand-budget': handBudgetSet(el.dataset.b); return false;
    case 'net-set': if (!setNet(id)) return false; break;
    case 'net-collect': { const g = collectNet(id); if (g) toast(`Hauled in ${g} from the net`); else return false; break; }
    case 'cask-slot': caskSheet(+el.dataset.i); return false;
    case 'cask-fill': if (!fillCask(+el.dataset.i, id)) return false; closeSheet(); break;
    case 'cask-bottle': if (bottleCask(+el.dataset.i) === -1) { toast('No room in the barn for that bottle.'); return false; } break;
    case 'cask-buy': if (!buyCask()) return false; break;
    case 'ex-sell': { const c = exchangeSell(id); if (!c) return false; toast(`Sold on the Exchange for ${fmtN(c)} coins`); break; }
    case 'pet-adopt': if (!adoptPet(id)) return false; break;
    case 'pet-feed': if (!feedPet(id)) return false; break;
    case 'pet-collect': if (!collectPet(id)) return false; break;
    case 'fest-deliver': if (!festivalDeliver(+el.dataset.i)) return false; break;
    case 'fest-buy': if (!festivalBuy(+el.dataset.i)) return false; break;
    case 'login-claim': if (!claimLogin()) return false; break;
    case 'help': replayTour(); return false;
    case 'opt': state.opts[id] = !state.opts[id]; toast({ tipsOff: state.opts.tipsOff ? 'Tutorials off' : 'Tutorials on', relaxedFish: state.opts.relaxedFish ? 'Relaxed fishing on' : 'Relaxed fishing off', soundOff: state.opts.soundOff ? 'Sound off' : 'Sound on', fbTabOff: state.opts.fbTabOff ? 'Feedback tab hidden. Send feedback from Settings any time.' : 'Feedback tab on' }[id] || 'Saved'); if (id === 'soundOff' && !state.opts.soundOff) play('chime'); break;
    case 'replay-tours': state.toursSeen = {}; state.opts.tipsOff = false; toast('Tutorials will show again as you visit each screen'); break;
    case 'take-overflow': { const n = takeOverflow(); toast(n ? `Moved ${n} into your barn` : 'Still no room. Sell something or upgrade the barn first.'); if (!n) return false; break; }
    default: return false;
  }
  return true;
}

document.addEventListener('input', e => {
  if (e.target.id !== 'vol' || !state) return;
  state.opts.volume = +e.target.value / 100;
  setVolume(state.opts.volume);
});
document.addEventListener('change', e => { if (e.target.id === 'vol' && state) { play('pick'); commit(); } });
/* Only the cast button fishes (the water is just a picture, so scrolling past it never casts). Casting waits for a
   full tap, so starting a scroll on the button doesn't cast either; reeling in reacts on press, for tight timing. */
let fishPressed = 0;
document.addEventListener('pointerdown', e => {
  const b = e.target.closest('[data-act="fish-btn"]');
  if (!b || e.button > 0 || !state || fishing.phase !== 'bite') return;
  fishPressed = performance.now();
  fishButton();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target && e.target.id === 'hand-budget') { e.preventDefault(); handBudgetSet('set'); return; }
  if (e.key === 'Enter' && e.target && e.target.id === 'hand-q') { e.preventDefault(); handSearch(); return; }
  if (tour) return;
  if (e.key === 'Escape' && sheetOpen()) { closeSheet(); return; }
  if (state && state.tab === 'fish' && $('#pond') && e.key === ' ' && !e.target.closest('button, input, textarea') && !sceneOpen && !advRun) { e.preventDefault(); fishButton(); }
});
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el || !state) return;
  const act = el.dataset.act;
  if (act === 'fish-btn') { if (performance.now() - fishPressed > 800) fishButton(); return; }   // a reel already handled on press
  if (act === 'sheet-close') { if (e.target === el || el.tagName === 'BUTTON') closeSheet(); return; }
  const snap = fxSnap(el);
  if (handle(act, el, e)) { commit(); fxAfter(act, el, snap); }
});
