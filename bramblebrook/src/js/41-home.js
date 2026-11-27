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
const VILLAGE_SUBS = ['village', 'hands', 'people'];
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

/* Home tile icons: gold line drawings on a 24 grid, like engravings on a coin. Stroke is the tile's gold;
   .ic-red marks the one red part some have (the lantern's flame, the wax seal). A tile without one keeps its emoji. */
const HOME_ICONS = {
  'farm:fields': '<path d="M12 22V6"/><path d="M12 9c-2.6-.2-4-1.8-4-4.2 2.6.2 4 1.8 4 4.2zM12 9c2.6-.2 4-1.8 4-4.2-2.6.2-4 1.8-4 4.2zM12 13.5c-2.6-.2-4-1.8-4-4.2 2.6.2 4 1.8 4 4.2zM12 13.5c2.6-.2 4-1.8 4-4.2-2.6.2-4 1.8-4 4.2zM12 18c-2.6-.2-4-1.8-4-4.2 2.6.2 4 1.8 4 4.2zM12 18c2.6-.2 4-1.8 4-4.2-2.6.2-4 1.8-4 4.2z"/><path d="M12 6V2.5"/>',
  'farm:orchard': '<path d="M12 7.5C9 5.6 4.8 7 4.8 11.4c0 4.4 3.4 9.6 7.2 8.6 3.8 1 7.2-4.2 7.2-8.6 0-4.4-4.2-5.8-7.2-3.9z"/><path d="M12 7.5c0-2.2.8-3.6 2-4.5"/><path d="M13.6 5.2c1.6-1.4 3.7-1.4 4.9-.6-1 1.6-3 2.1-4.9.6z"/>',
  'farm:animals': '<path d="M8 8.5h8l-.8 7.2c-.3 2.7-1.6 4.3-3.2 4.3s-2.9-1.6-3.2-4.3z"/><path d="M8 8.5C5.6 8.4 3.6 6.8 3.4 4c1.6.9 3.2 1.4 4.8 1.4M16 8.5c2.4-.1 4.4-1.7 4.6-4.5-1.6.9-3.2 1.4-4.8 1.4"/><path d="M8.6 10.6 6.4 12M15.4 10.6l2.2 1.4"/><circle cx="10.6" cy="16.6" r=".6"/><circle cx="13.4" cy="16.6" r=".6"/>',
  'farm:pets': '<path d="M12 13.2c-2.6 0-5 2.4-5 4.6 0 1.6 1.3 2.4 2.6 2.1 1-.2 1.6-.6 2.4-.6s1.4.4 2.4.6c1.3.3 2.6-.5 2.6-2.1 0-2.2-2.4-4.6-5-4.6z"/><ellipse cx="8" cy="9.4" rx="1.6" ry="2.2"/><ellipse cx="16" cy="9.4" rx="1.6" ry="2.2"/><ellipse cx="10.6" cy="5.6" rx="1.5" ry="2.1"/><ellipse cx="13.4" cy="5.6" rx="1.5" ry="2.1"/>',
  'wilds:explore': '<circle cx="12" cy="12" r="9"/><path d="M12 5.2 14.4 12 12 18.8 9.6 12z"/><path d="M12 5.2 14.4 12H9.6z" fill="currentColor"/><path d="M12 1.8v1.4M12 20.8v1.4M1.8 12h1.4M20.8 12h1.4"/>',
  'fish:': '<path d="M15 2.5v11.3a5 5 0 0 1-10 0v-1.6"/><path d="M5 12.2 3.4 14M5 12.2l2.1 1.2"/><circle cx="15" cy="2.5" r=".9"/><path d="M18.5 9.5c1.2 1 1.2 3 0 4M20.6 8c2 1.8 2 5.2 0 7"/>',
  'wilds:mine': '<path d="M3.4 9.4C6.6 4.6 17.4 4.6 20.6 9.4"/><path d="M3.4 9.4c3-1.6 6-2.2 8.6-2.2s5.6.6 8.6 2.2"/><path d="M12 7.2V22"/><path d="M10.6 12h2.8"/>',
  'wilds:stair': '<path d="M12 2v2.4"/><path d="M9.4 4.4h5.2l1.4 2H8z"/><path d="M8.6 6.4h6.8v10.4H8.6z"/><path d="M7.6 16.8h8.8l-1 2.4H8.6z"/><path d="M12 9.2c1.4 1.4 1.4 3 0 4.4-1.4-1.4-1.4-3 0-4.4z" class="ic-red"/>',
  'make:workshop': '<path d="M2.8 9.6h12.8a4 4 0 0 1-4 4h-.8v3.2h3.2v2.4H6.8v-2.4H10v-3.2H8.4c-3 0-5.6-1.8-5.6-4z"/><path d="M15.6 9.6h5.6l-5.6 3"/><path d="M14 2.4l4 4M16 4.4l3.4-2"/>',
  'make:kitchen': '<path d="M4 10.4h16"/><path d="M5.2 10.4h13.6l-.8 5.6c-.4 2.8-2.8 4-6 4s-5.6-1.2-6-4z"/><path d="M8.2 20 7 22.2M15.8 20l1.2 2.2"/><path d="M9.4 7.6c-1-1 0-2 0-3.2M12 7.6c-1-1 0-2 0-3.2M14.6 7.6c-1-1 0-2 0-3.2"/>',
  'make:bench': '<path d="M6.6 21.4 16.8 4.6"/><path d="M14.2 3.4c3.4-.4 6.4 1.8 6.6 5.2l-4.2.8-3.8-2.4z"/><path d="M5 22.2l2.6-1.6"/>',
  'make:cellar': '<path d="M7.2 2.8h9.6c1.8 3.8 1.8 14.6 0 18.4H7.2c-1.8-3.8-1.8-14.6 0-18.4z"/><path d="M5.6 7.6h12.8M5.6 16.4h12.8"/><path d="M12 10.6v2.8"/>',
  'town:village': '<path d="M4 3.6l11 11M20 3.6l-11 11"/><path d="M13 16.8l3.8-3.8M11 16.8l-3.8-3.8"/><path d="M15.6 15.6l4 4M8.4 15.6l-4 4"/><circle cx="20.2" cy="20.2" r="1"/><circle cx="3.8" cy="20.2" r="1"/>',
  'town:inn': '<path d="M5 7.6h10V19a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2z"/><path d="M15 10h2.2a2 2 0 0 1 2 2v3.2a2 2 0 0 1-2 2H15"/><path d="M5 7.6c-.4-2 1.4-3.4 3-2.4 1-2 4-2 5 0 1.4-.8 2.6.4 2 2.4"/><path d="M8.4 11.4v6M11.6 11.4v6"/>',
  'town:board': '<path d="M7 4.4h10.6a2 2 0 0 1 2 2v1H16.6"/><path d="M7 4.4a2 2 0 0 0-2 2v1h3"/><path d="M8 6.4v11.2a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-1H10"/><path d="M10.6 9.6h5.4M10.6 12.4h5.4"/>',
  'town:mail': '<path d="M3 6h18v12.4H3z"/><path d="M3 6l9 7.2L21 6"/><circle cx="12" cy="13.2" r="2.4" class="ic-red"/>',
};
const homeIcon = (tab, s, fallback) => { const d = HOME_ICONS[tab + ':' + (s || '')]; return d ? `<span class="emo hub-ic"><svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg></span>` : fallback; };

/* Home: the story, then every place as a tile */
function viewHome() {
  const t = now(), w = weather();
  const ready = state.plots.filter(p => p.crop && p.ready <= t).length, growing = state.plots.filter(p => p.crop && p.ready > t).length;
  const tile = (tab, s, icon, name, line, dot, key) => (key && !featureOn(key)) ? '' :
    `<button class="hub-tile${dot ? ' ready' : ''}" data-act="go" data-tab="${tab}" data-sub="${s || ''}">${homeIcon(tab, s, icon)}<span><b>${esc(name)}</b><small>${line}</small></span>${dot ? `<i class="hub-dot">${dot === true ? '' : dot}</i>` : (key && isNew(key)) || (!key && isNew('tab:' + tab)) ? '<i class="hub-new">New</i>' : ''}</button>`;
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
