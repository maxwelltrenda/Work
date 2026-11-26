/* ---------- four pages: Home, Profile, Village, Market ----------
   The bottom bar has four pages. Home is the front page: every place in the game is a tile you tap to go there
   (fields, the woods, the mine, fishing, the kitchen, the inn, chores, the village boss...), each saying what's
   waiting. Profile is you (character and gear, bag, feats, settings), Market is selling, shops and perks, Village is other players and the
   townsfolk (your village, farmhands, chat, people), Market is buying and selling.
   Under the bar, state.tab is still the place on screen (farm, wilds, fish, make, town, bag, home, market) and
   state.sub the part of it; state.nav is which of the four pages it belongs to. All of it is the screen's own. */
const NAV_DEFS = [
  { id: 'home', n: 'Home', tab: 'home', svg: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-5h4v5"/>' },
  { id: 'profile', n: 'Profile', tab: 'bag', svg: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/>' },
  { id: 'village', n: 'Village', tab: 'town', svg: '<path d="M2 20h20"/><path d="M4 20v-9l5-4 5 4v9"/><path d="M14 20v-6l4-3 4 3v6"/><path d="M8 20v-4h2v4"/>' },
  { id: 'market', n: 'Market', tab: 'market', svg: '<path d="M4 9h16l-1.5-5h-13z"/><path d="M5 9v11h14V9"/><path d="M9.5 20v-6h5v6"/>' },
];
const VILLAGE_SUBS = ['village', 'hands', 'chat', 'people'];
// which page a place belongs to
function navOf(tab, s) {
  if (tab === 'bag') return 'profile';
  if (tab === 'market') return 'market';
  if (tab === 'town') return VILLAGE_SUBS.includes(s) ? 'village' : 'home';
  return 'home';
}
const curNav = () => state.nav || navOf(state.tab, state.sub && state.sub[state.tab]);
function leaveFishing(to) { if (state.tab === 'fish' && to !== 'fish' && typeof fishing !== 'undefined') { clearFishTimers(); fishing.phase = 'idle'; fishing.msg = ''; } }
// a bottom-bar page
function goNav(id) {
  const d = NAV_DEFS.find(x => x.id === id);
  if (!d) return;
  leaveFishing(d.tab);
  state.nav = id; state.tab = d.tab;
  if (id === 'village' && !VILLAGE_SUBS.includes(state.sub.town)) state.sub.town = VILLAGE_SUBS.find(s => subOn('town', s)) || 'people';
  renderTabs(); renderView(); updateBadges(); window.scrollTo(0, 0);
}
// a place, from a Home tile (or anywhere): its page lights up in the bar
function goPlace(tab, s) {
  leaveFishing(tab);
  state.tab = tab;
  if (s) state.sub[tab] = s;
  state.nav = navOf(tab, s || state.sub[tab]);
  renderTabs(); renderView(); updateBadges(); window.scrollTo(0, 0);
}
const navFresh = id => (id === 'home' ? ['farm', 'wilds', 'fish', 'make'].some(t => tabOn(t) && tabFresh(t)) || ['board', 'mail', 'inn'].some(s => isNew('town:' + s) && subOn('town', s))
  : id === 'village' ? VILLAGE_SUBS.some(s => isNew('town:' + s) && subOn('town', s)) : id === 'profile' ? tabFresh('bag') : id === 'market' ? tabFresh('market') : false);

/* Home: the story, then every place as a tile */
function viewHome() {
  const t = now(), w = weather();
  const ready = state.plots.filter(p => p.crop && p.ready <= t).length, growing = state.plots.filter(p => p.crop && p.ready > t).length;
  const tile = (tab, s, icon, name, line, dot, key) => (key && !featureOn(key)) ? '' :
    `<button class="hub-tile${dot ? ' ready' : ''}" data-act="go" data-tab="${tab}" data-sub="${s || ''}">${icon}<span><b>${esc(name)}</b><small>${line}</small></span>${dot ? `<i class="hub-dot">${dot === true ? '' : dot}</i>` : (key && isNew(key)) || (!key && isNew('tab:' + tab)) ? '<i class="hub-new">New</i>' : ''}</button>`;
  const emo = e => `<span class="emo" style="--s:30px">${e}</span>`;
  ensureChores();
  const chores = state.chores.list.filter(c => !c.claimed && choreProgress(c) >= c.n).length + (featureOn('daily') && loginReady() ? 1 : 0) + (featureOn('festival') ? festivalOpenCount() : 0);
  const unread = state.mail.filter(m => !m.read).length;
  const R = typeof vil !== 'undefined' ? vil.raid : null, raid = R && R.raid;
  const bossLine = !socialOn() ? 'Sign in to fight bosses with a village' : !R || !R.in_village ? 'Join a village to fight bosses together'
    : raid && raid.status === 'active' && raidDef(raid.boss) ? `${esc(raidDef(raid.boss).n)} · ${pctText(raidNumbers(raid, raidDef(raid.boss)).total)} beaten` : R.reward ? 'Your share is waiting' : 'No boss right now';
  const groups = [
    ['Your farm', [
      tile('farm', 'fields', emo('🌾'), 'Fields', ready ? `${ready} ready to harvest${growing ? `, ${growing} growing` : ''}` : growing ? `${growing} growing` : 'Ready to sow', ready),
      tile('farm', 'orchard', emo('🍎'), 'Orchard', orchardReady() ? `${orchardReady()} ready to pick` : 'Fruit trees', orchardReady(), 'farm:orchard'),
      tile('farm', 'animals', emo('🐔'), 'Animals', animalsReady() ? `${animalsReady()} ready to collect` : 'Coops and pens', animalsReady(), 'farm:animals'),
      tile('farm', 'pets', emo('🐕'), 'Pets', petsReady() ? `${petsReady()} brought something home` : 'Your companions', petsReady(), 'farm:pets'),
    ]],
    ['Out and about', [
      tile('wilds', 'explore', emo('🧭'), 'Explore', `${fmtN(staminaLeft())} stamina · ${esc((I.area[state.area] || I.areas[0]).n)}`, 0),
      tile('fish', '', emo('🎣'), 'Fishing', netsReady() ? `${netsReady()} net${netsReady() > 1 ? 's' : ''} to haul in` : esc((I.spot[state.spot] || I.spots[0]).n), netsReady(), 'tab:fish'),
      tile('wilds', 'mine', emo('⛏️'), 'The Mine', `Floor ${state.mine.floor} · deepest ${state.mine.deepest}`, 0, 'wilds:mine'),
      tile('wilds', 'stair', emo('🏮'), 'Lantern Stair', `${state.stair || 0} lanterns lit`, 0, 'wilds:stair'),
    ]],
    ['Make', [
      tile('make', 'workshop', emo('🔨'), 'Workshop', 'Craft goods worth more', 0, 'tab:make'),
      tile('make', 'kitchen', emo('🍲'), 'Kitchen', 'Meals and drinks', 0, 'make:kitchen'),
      tile('make', 'bench', emo('🪚'), 'Workbench', benchReady() ? `${benchReady()} ready` : 'Crafts while you are away', benchReady(), 'make:bench'),
      tile('make', 'cellar', emo('🛢️'), 'Cellar', casksReady() ? `${casksReady()} ready` : 'Age goods into vintages', casksReady(), 'make:cellar'),
    ]],
    ['Battles and adventures', [
      tile('town', 'village', emo('🐉'), 'Village boss', bossLine, !!(R && (R.reward || (raid && raid.status === 'active'))), 'town:village'),
      tile('town', 'inn', emo('🍺'), 'The inn', `Adventures, delves and the training yard${innNew() ? ` · ${innNew()} new` : ''}`, innNew(), 'town:inn'),
    ]],
    ['Every day', [
      tile('town', 'board', emo('📋'), 'Chores', chores ? `${chores} to claim` : "Today's chores and gifts", chores, 'town:board'),
      tile('town', 'mail', emo('✉️'), 'Mail', unread ? `${unread} unread` : 'Letters from the valley', unread, 'town:mail'),
    ]],
  ];
  return `<div class="view-head"><h1>${esc(state.name ? `${state.name}'s valley` : 'Your valley')}</h1><p>Where to today?</p></div>
    ${storyBanner()}
    ${groups.map(([n, tiles]) => { const html = tiles.join(''); return html ? `<div class="label">${esc(n)}</div><div class="hub-grid">${html}</div>` : ''; }).join('')}`;
}

/* Market: sell anything you own, the shops, and perks.
   Raw goods (crops, fruit, fish, forage, ore, animal goods) also sell a whole group at once; meals, crafted goods,
   charms and gear only one at a time, so nobody sells their dinner or their sword by accident. */
const BULK_SELL = ['crop', 'fruit', 'fish', 'forage', 'ore', 'animal'];
function marketSlot(id) {
  const t = masteryTier(id), worn = (I.items[id].t === 'gear' && gearWorn().includes(id)) || (I.items[id].t === 'charm' && state.charms.includes(id));
  return `<button class="slot sell-slot${rarClass(id)}" data-act="item" data-id="${id}">${t ? `<span class="stars">${'★'.repeat(t)}</span>` : ''}${state.locked[id] ? '<span class="lock" aria-label="Locked">🔒</span>' : ''}${pic(id, 32)}<span class="nm">${esc(itemName(id))}</span><span class="q">${fmtN(have(id))}</span><span class="pr">${worn ? 'Worn' : `${fmtN(priceOf(id))}c each`}</span></button>`;
}
function viewMarketSell() {
  const ids = Object.keys(I.items).filter(id => have(id) > 0 && I.items[id].t !== 'key');
  let total = 0;
  const groups = Object.keys(C.core.types).filter(t => t !== 'key').map(t => {
    const list = ids.filter(id => I.items[id].t === t);
    if (!list.length) return '';
    const open = list.filter(id => !state.locked[id]);
    const v = open.reduce((a, id) => a + have(id) * priceOf(id), 0);
    const bulk = BULK_SELL.includes(t) && open.length;
    if (BULK_SELL.includes(t)) total += v;
    return `<div class="card"><div class="row between"><h2>${esc(C.core.types[t])}</h2>${bulk ? `<button class="btn small" data-act="sell-type" data-t="${t}">Sell all · ${fmtC(v)}</button>` : ''}</div>
      <div class="inv">${list.map(marketSlot).join('')}</div></div>`;
  }).join('');
  return `<div class="card"><h2>Sell your goods</h2><p class="sub">Tap anything to sell one or all of it, or lock it so it's kept back. Raw goods can go a whole group at a time${total ? `: ${fmtC(total)} for everything unlocked` : ''}.</p></div>
    ${groups || '<div class="card"><p class="muted">Nothing to sell yet. Harvest, explore or fish to fill your bag.</p></div>'}`;
}
function viewMarket() {
  const s = sub('market');
  const head = `<div class="view-head"><h1>Market</h1><p>${s === 'perks' ? 'Bonuses you learn with points' : s === 'shops' ? 'Seeds, upgrades and traders' : 'Sell anything you own'}</p></div>${subtabs('market', { perks: perkPointsFree() > 0 })}`;
  if (s === 'perks') return head + viewPerks();
  if (s === 'shops') return head + viewShops()
    + (featureOn('town:hands') ? `<div class="card"><h2>Farmhands</h2><p class="sub">Hire other players to hit village bosses harder.</p><button class="btn wide ghost" data-act="go" data-tab="town" data-sub="hands">Hire farmhands ›</button></div>` : '');
  return head + viewMarketSell();
}
