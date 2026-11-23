/* ---------- views for automation, cellar, exchange, pets, perks, festivals ---------- */

function viewBench() {
  if (!benchOpen()) return lockedCard('The workbench', C.core.workbench.unlock);
  const k = C.core.workbench;
  const slots = state.bench.map((slot, i) => {
    if (!slot) return `<div class="card upgrade">${artCell('ui:bench', 32) || '🔨'}<div class="what"><b>Empty bench</b><small>Queue up to ${k.maxQueue} of any recipe you know. It keeps working while you're away.</small></div>
      <button class="btn small" data-act="bench-slot" data-i="${i}">Queue</button></div>`;
    const s = benchState(slot);
    return `<div class="card"><div class="upgrade">${pic(s.r.id, 32)}<div class="what"><b>${esc(itemName(s.r.id))} · ${slot.taken + s.ready}/${slot.n} ready to take</b>
      <small>${s.left ? `${s.left} still to make · next in ${fmtT(s.next)}` : 'All made'} · one every ${fmtT(benchSecs(s.r))}</small></div></div>
      ${progressBar(s.made, slot.n)}
      <div class="row"><button class="btn small" data-act="bench-collect" data-i="${i}" ${s.ready ? '' : 'disabled'}>Take ${s.ready * s.r.out || ''}</button>
      <button class="btn small ghost" data-act="bench-cancel" data-i="${i}">${s.left ? 'Stop and refund the rest' : 'Clear'}</button></div></div>`;
  }).join('');
  const more = state.bench.length < k.maxSlots ? `<div class="card upgrade"><span class="emo" style="--s:32px">➕</span><div class="what"><b>Another workbench</b><small>Run ${state.bench.length + 1} recipes at once</small></div>
    <button class="btn small" data-act="bench-buy" ${state.coins >= k.slotCost ? '' : 'disabled'}>${fmtN(k.slotCost)}c</button></div>` : '';
  return `<p class="sub">Benches use the materials up front, then make one item at a time. Crafting XP is half the usual rate.</p>${slots}${more}`;
}
function benchSheet(i) {
  const open = I.recipes.filter(recipeOpen);
  openSheet(`<h2>Queue on the workbench</h2><p class="sub">Choose a recipe. It uses the materials now.</p>
    ${open.map(r => {
      let m = Infinity;
      for (const [id, q] of Object.entries(r.need)) m = Math.min(m, Math.floor(have(id) / q));
      m = Math.min(m, C.core.workbench.maxQueue);
      return `<div class="store-item">${pic(r.id, 32)}<div class="what"><b>${esc(itemName(r.id))}</b><small>${Object.entries(r.need).map(([id, q]) => `${q} ${itemName(id)}`).join(', ')} · ${fmtT(benchSecs(r))} each · can make ${m}</small></div>
        <button class="btn small" data-act="bench-queue" data-i="${i}" data-id="${r.id}" data-n="max" ${m > 0 ? '' : 'disabled'}>Queue ${m > 0 ? m : ''}</button></div>`;
    }).join('')}
    <div class="sheet-btns"><button class="btn small ghost" data-act="sheet-close">Close</button></div>`);
}

function viewCellar() {
  if (!cellarOpen()) return lockedCard('The cellar', C.core.cellar.unlock);
  const casks = state.casks.map((c, i) => {
    if (!c) return `<div class="card upgrade">${artCell('ui:cask', 32) || '🛢️'}<div class="what"><b>Empty cask</b><small>Fill it and leave it. Longer aging makes a vintage worth far more.</small></div>
      <button class="btn small" data-act="cask-slot" data-i="${i}">Fill</button></div>`;
    const s = caskState(c);
    const label = s.tier === 0 ? `Ready to bottle in ${fmtT(s.left)}` : s.tier === 1 && s.a.vintage ? `Ready now · vintage in ${fmtT(s.left)}` : s.tier === 2 ? 'Vintage! Bottle it whenever you like' : 'Ready now';
    return `<div class="card upgrade">${pic(s.tier === 2 ? s.a.vintage : c.id, 32)}<div class="what"><b>${esc(itemName(s.out))}</b><small>${label} · sells for ${fmtN(priceOf(s.out))}c</small></div>
      <button class="btn small ${s.tier === 2 ? 'sun' : ''}" data-act="cask-bottle" data-i="${i}" ${s.tier ? '' : 'disabled'}>Bottle</button></div>`;
  }).join('');
  const k = C.core.cellar;
  const more = state.casks.length < k.maxSlots ? `<div class="card upgrade"><span class="emo" style="--s:32px">➕</span><div class="what"><b>Another cask</b><small>${state.casks.length}/${k.maxSlots} casks</small></div>
    <button class="btn small" data-act="cask-buy" ${state.coins >= caskCost() ? '' : 'disabled'}>${fmtN(caskCost())}c</button></div>` : '';
  const recipes = C.core.cellar.aging.map(a => `<div class="store-item">${pic(a.id, 28)}<div class="what"><b>${esc(itemName(a.id))}</b><small>${Object.entries(a.need).map(([id, q]) => `${q} ${itemName(id)}`).join(', ')} · ${fmtT(a.mins * 60)}${a.vintage ? ` · ${esc(itemName(a.vintage))} after ${fmtT(a.vmins * 60)}` : ''}</small></div></div>`).join('');
  return `${casks}${more}<div class="card"><h2>What ages well</h2>${recipes}</div>`;
}
function caskSheet(i) {
  openSheet(`<h2>Fill a cask</h2>${C.core.cellar.aging.map(a => `<div class="store-item">${pic(a.id, 32)}<div class="what"><b>${esc(itemName(a.id))}</b><small>${Object.entries(a.need).map(([id, q]) => `${have(id)}/${q} ${itemName(id)}`).join(', ')}</small></div>
    <button class="btn small" data-act="cask-fill" data-i="${i}" data-id="${a.id}" ${hasAll(a.need) ? '' : 'disabled'}>Fill</button></div>`).join('')}
    <div class="sheet-btns"><button class="btn small ghost" data-act="sheet-close">Close</button></div>`);
}

function viewNets() {
  if (!netsOpen()) return '';
  const rows = I.spots.filter(spotOpen).map(sp => {
    const s = netState(sp.id);
    if (!s) return `<div class="store-item">${pic('net', 28)}<div class="what"><b>${esc(sp.n)}</b><small>No net set</small></div>
      <button class="btn small ghost" data-act="net-set" data-id="${sp.id}" ${have('net') ? '' : 'disabled'}>Set a net${have('net') ? '' : ' (craft one)'}</button></div>`;
    return `<div class="store-item">${pic('net', 28)}<div class="what"><b>${esc(sp.n)}</b><small>${s.caught}/${C.core.nets.cap} caught${s.next ? ` · next in ${fmtT(s.next)}` : ' · full'}</small></div>
      <button class="btn small" data-act="net-collect" data-id="${sp.id}" ${s.caught ? '' : 'disabled'}>Haul in</button></div>`;
  }).join('');
  return `<div class="card"><div class="row between"><h2>Fishing nets</h2><span class="chip plain">${have('net')} in bag</span></div><p class="sub">A net catches common fish while you're away, one every ${fmtT(C.core.nets.every)}, up to ${C.core.nets.cap}. Craft nets in the Workshop.</p>${rows}</div>`;
}

function viewExchange() {
  const rows = exchangeBoard();
  const ends = (exchangeWindow() + 1) * C.core.exchange.hours * 3600000 - now();
  return `<div class="card"><div class="row between"><h2>Valley Exchange</h2><span class="chip plain">New prices in ${fmtT(ends / 1000)}</span></div>
    <p class="sub">Merchants from over the hills pay more for some goods and less for others. Up to ${C.core.exchange.cap} of each per price window.</p>
    ${rows.map(r => {
      const each = Math.round(priceOf(r.id) * r.mult), left = C.core.exchange.cap - exchangeSold(r.id), n = Math.min(have(r.id), left);
      const up = r.mult >= 1;
      return `<div class="store-item">${pic(r.id, 32)}<div class="what"><b>${esc(itemName(r.id))} <span style="color:${up ? 'var(--accent)' : 'var(--berry)'}">${up ? '▲' : '▼'} ${r.mult}×</span></b>
        <small>${fmtN(each)}c each (usually ${fmtN(priceOf(r.id))}c) · you have ${have(r.id)}${state.locked[r.id] ? ' · locked' : ''}</small></div>
        <button class="btn small ${up ? 'sun' : 'ghost'}" data-act="ex-sell" data-id="${r.id}" ${n > 0 && !state.locked[r.id] ? '' : 'disabled'}>Sell ${n || ''}</button></div>`;
    }).join('')}</div>`;
}

function viewPets() {
  return C.core.pets.map(p => {
    if (!petOpen(p)) return `<div class="card locked-card pen"><span class="big" style="filter:grayscale(1)">${p.i}</span><div><b>${esc(p.n)}</b><p class="sub">${esc(unlockHint(p.unlock))}</p></div></div>`;
    const s = petState(p);
    if (!s) return `<div class="card pen"><span class="big" aria-hidden="true">${p.i}</span><div class="pen-head"><b>${esc(p.n)}</b><span class="chip plain">Looking for a home</span></div>
      <div style="display:grid;gap:8px"><p class="sub">Brings home ${Object.keys(p.finds).slice(0, 4).map(id => itemName(id).toLowerCase()).join(', ')} and more, every ${fmtT(p.every)}.</p>
      <div><button class="btn small" data-act="pet-adopt" data-id="${p.id}" ${state.coins >= p.cost ? '' : 'disabled'}>Adopt · ${fmtN(p.cost)}c</button></div></div></div>`;
    return `<div class="card pen"><span class="big" aria-hidden="true">${p.i}</span><div class="pen-head"><b>${esc(p.name)}</b><span class="chip plain">${esc(p.n)}</span></div>
      <div style="display:grid;gap:8px"><p class="sub">${s.finds ? `<b>${s.finds} find${s.finds > 1 ? 's' : ''} waiting.</b>` : `Next find in ${fmtT(s.next)}.`} ${s.fed ? 'Fed today: finding twice as fast.' : `Favourite snack: ${esc(itemName(p.fav))}.`}</p>
      <div class="row"><button class="btn small" data-act="pet-collect" data-id="${p.id}" ${s.finds ? '' : 'disabled'}>See what ${esc(p.name)} found</button>
      <button class="btn small ghost" data-act="pet-feed" data-id="${p.id}" ${!s.fed && have(p.fav) ? '' : 'disabled'}>${s.fed ? 'Fed today' : `Give ${esc(itemName(p.fav).toLowerCase())}`}</button></div></div></div>`;
  }).join('');
}

function viewPerks() {
  const free = perkPointsFree(), earned = perkPointsEarned();
  return `<div class="card"><div class="row between"><h2>${free} perk point${free === 1 ? '' : 's'} to spend</h2><span class="chip plain">${earned} earned</span></div>
      <p class="sub">You earn a point for every ${C.core.perkLevels} skill levels across all six skills. Next point at ${(earned + 1) * C.core.perkLevels} total levels (you have ${totalLevels()}).</p></div>
    <div class="card">${C.core.perks.map(p => {
      const r = perkRank(p.id), maxed = r >= p.max;
      return `<div class="feat${r ? ' got' : ''}"><span class="medal">${r || ''}</span><div class="what"><b>${esc(p.n)} ${'●'.repeat(r)}${'○'.repeat(p.max - r)}</b>
        <small>${esc(p.desc.replace('{v}', r ? perkVal(p.id) : p.per))}${r && !maxed ? ` · next rank: ${p.desc.replace('{v}', (r + 1) * p.per)}` : ''}</small></div>
        ${maxed ? '<span class="chip plain">Max</span>' : `<button class="btn small" data-act="perk" data-id="${p.id}" ${free ? '' : 'disabled'}>Learn</button>`}</div>`;
    }).join('')}</div>
    ${perkPointsSpent() ? `<button class="btn ghost wide" data-act="perk-reset" ${state.coins >= C.core.perkReset ? '' : 'disabled'}>Refund all points · ${fmtN(C.core.perkReset)}c</button>` : ''}`;
}

function viewDaily() {
  if (!state.login) return '';
  const ready = loginReady(), cycle = C.core.login.length;
  const pos = (Math.max(1, state.login.streak) - 1) % cycle;
  const days = C.core.login.map((g, i) => `<span class="chip plain ${i === pos ? 'gold' : ''}" title="${esc(giveSummary(g))}">Day ${i + 1}${i < pos || (i === pos && !ready) ? ' ✓' : ''}</span>`).join('');
  return `<div class="card"><div class="row between"><h2>Daily visit gift</h2><span class="chip plain">${state.login.streak}-day streak</span></div>
    <div class="row">${days}</div>
    ${ready ? `<button class="btn sun" data-act="login-claim">Open today's gift: ${esc(giveSummary(loginReward()))}</button>` : '<p class="sub">Come back tomorrow to keep the streak going.</p>'}</div>`;
}
function viewFestival() {
  const f = festival();
  if (!f) return '';
  const reqs = f.reqs.map((r, i) => {
    const done = festivalDone(i), probs = reqProblems(r.req);
    return `<div class="chore${done ? ' done' : ''}"><div class="what"><b>${Object.entries(r.want).map(([id, n]) => `${n} ${itemName(id)}`).join(', ')}</b>
      <small class="muted">${done ? 'Delivered' : probs.length ? 'Opens ' + esc(probs.join(', ')) : `${Object.entries(r.want).map(([id, n]) => `${Math.min(have(id), n)}/${n}`).join(', ')} · ${r.tokens} ribbons`}</small></div>
      ${done ? '<span class="chip plain">Done</span>' : `<button class="btn small" data-act="fest-deliver" data-i="${i}" ${!probs.length && hasAll(r.want) ? '' : 'disabled'}>Give</button>`}</div>`;
  }).join('');
  const shop = C.core.festivals.shop.map((s, i) => {
    const id = s.keepsake ? f.keepsake : s.item, owned = s.keepsake && have(f.keepsake);
    return `<div class="store-item">${pic(id, 28)}<div class="what"><b>${s.keepsake ? esc(itemName(id)) : `${s.qty}× ${esc(itemName(id))}`}</b><small>${s.keepsake ? 'This season only' : 'Festival stall'}</small></div>
      ${owned ? '<span class="chip plain">Yours</span>' : `<button class="btn small" data-act="fest-buy" data-i="${i}" ${(state.tokens || 0) >= s.cost ? '' : 'disabled'}>${s.cost} 🎀</button>`}</div>`;
  }).join('');
  const daysLeft = 7 - ((dayNumber() - 1) % 7);
  return `<div class="card"><div class="row between"><h2>${esc(f.n)}</h2><span class="chip plain">${daysLeft} day${daysLeft > 1 ? 's' : ''} left</span></div>
    <p class="sub">${esc(f.blurb)} You have ${state.tokens || 0} ribbons.</p>${reqs}
    <div class="label" style="margin-top:6px">Festival stall</div>${shop}</div>`;
}
