/* ---------- village wars (Jarldoms' Hird War Mode, brought to the valley) ----------
   An elder declares war on another village, or leads it out against a raider camp the game sizes to match. For 48
   hours every neighbour raids the other side's players and scouts them first. A raid's chance is your attack against
   their defence, between 15% and 85%; a win scores points and pays coins at once, a loss scores half for them.
   Scores are per head, so size alone doesn't win. At the end: War Spoils, Blood Apples, a trophy and 5% of the
   loser's treasury. Blood Apples refill raids, scouts or boss courage; War Spoils buy apples and the Blood Moon
   Warband in the Market. The server keeps all of it (supabase/village_wars.sql); inside Claude the same calls go
   through the player's connector (rpc() in 74-villages.js routes them). */
const wv = { data: null, at: 0, skew: 0, loading: false, busy: false, last: '' };
const warOpenNow = () => !!(state && state.tab === 'town' && sub('town') === 'war' && !sheetOpen());
const warNow = () => Date.now() + wv.skew;

function takeWar(r) {
  if (!r) return null;
  const { hit, scout, bought, grant, items, ate, ...status } = r;
  wv.data = status;
  wv.at = Date.now();
  wv.skew = status.now ? Date.parse(status.now) - Date.now() : 0;
  return { hit, scout, bought, grant, items, ate };
}
async function loadWar() {
  if (!socialOn() || wv.loading) return;
  wv.loading = true;
  try { takeWar(await rpc('war_status')); } catch (e) { /* offline: keep what we had */ }
  wv.loading = false;
  if (warOpenNow()) renderView();
  updateBadges();
}
// raids and scouts refill on the clock between answers from the server
function warEnergy(k) {
  const E = wv.data && wv.data.energy;
  if (!E) return 0;
  return Math.min(E[k + '_max'], E[k] + (Date.now() - wv.at) / 1000 / E[k + '_secs']);
}
const warNext = k => { const E = wv.data.energy, v = warEnergy(k); return v >= E[k + '_max'] ? 'Full' : `+1 in ${mmss((1 - (v % 1)) * E[k + '_secs'] * 1000)}`; };
const warFighting = () => !!(wv.data && wv.data.war);
const warReady = () => warFighting() && warEnergy('raids') >= 1;
const warApples = () => (wv.data && wv.data.purse && wv.data.purse.apples) || 0;
const clsLabel = id => (id && I.cls[id]) ? `${I.cls[id].icon || ''} ${I.cls[id].n}` : 'No class yet';

async function warCall(fn, args) {
  if (wv.busy) return null;
  wv.busy = true;
  if (warOpenNow()) renderView();
  try { return takeWar(await rpc(fn, args)); }
  catch (e) { toast(String(e.message || e)); return null; }
  finally { wv.busy = false; if (warOpenNow()) renderView(); updateBadges(); }
}
// a won raid's coins and battle experience, and a bought piece of gear, are the server's grants: play them as a move
function warGrant(g, coins, xp, items, why) {
  if (!g) return;
  doMove('grant', { g: String(g), c: coins || 0, xp: xp || 0, items: items || null, why });
  commit();
}
async function warRaid(id) {
  const x = await warCall('war_raid', { p_target: id });
  if (!x || !x.hit) return;
  const h = x.hit;
  if (h.won) {
    warGrant(h.grant, h.coins, h.xp, null, 'war');
    play('crit');
    toast(`You beat ${h.target}! +${fmtN(h.points)} points · +${fmtN(h.coins)} coins · +${h.spoils} War Spoils${h.scouted ? ' (scouted, +25%)' : ''}`, 'lvl', 4500);
  } else {
    play('thud');
    toast(`${h.target} drove you off (${h.chance}% chance). Their side scores ${fmtN(h.points)}.`, '', 4000);
  }
}
async function warScout(id) {
  const x = await warCall('war_scout', { p_target: id });
  if (!x || !x.scout) return;
  const s = x.scout;
  play('tick');
  openSheet(`<h2>Scouted: ${esc(s.name)}</h2>
    <p class="sub">${esc(clsLabel(s.cls))} · level ${s.lvl}</p>
    <div class="stats"><div class="stat"><b>${fmtN(s.attack)}</b><span>your attack (+25% from scouting)</span></div><div class="stat"><b>${fmtN(s.defence)}</b><span>their defence</span></div>
      <div class="stat"><b>${s.chance}%</b><span>your chance to win the next raid on them</span></div></div>
    ${s.gear && s.gear.length ? `<div class="label">Wearing</div><div class="row">${s.gear.filter(id => I.items[id]).map(id => `<span class="chip plain">${pic(id, 20)} ${esc(itemName(id))}</span>`).join('')}</div>` : '<p class="sub">No battle gear on.</p>'}
    <p class="sub">The +25% lasts until you raid them once.</p>
    <div class="sheet-btns"><button class="btn small" data-act="war-raid" data-id="${esc(s.target)}">Raid now</button><button class="btn small ghost" data-act="sheet-close">Later</button></div>`);
}
async function warDeclare(id) {
  closeSheet();
  const x = await warCall('war_declare', id ? { p_target: id } : {});
  if (!x || !wv.data.war) return;
  play('feat');
  toast(`War! 48 hours against ${wv.data.war.enemy.name}.`, 'lvl', 4500);
}
function warDeclareSheet(id) {
  const W = wv.data, t = id ? (W.targets || []).find(x => x.id === id) : null;
  if (id && !t) return;
  openSheet(`<h2>${t ? `Declare war on ${esc(t.crest)} ${esc(t.name)}?` : 'Fight a raider camp?'}</h2>
    <p>${t ? `For 48 hours your neighbours and theirs raid each other. Scores are counted per head. The winner takes up to ${fmtN(t.loot)} coins from the loser's treasury, and the loser rests for 3 days.`
      : 'The game sends a camp of raiders sized to your village. They score points by themselves over the 48 hours, so you need to keep raiding to beat them. No treasury is at stake.'}</p>
    <p class="sub">Everyone who fights earns War Spoils and coins for every raid they win. Your whole village gets a message.</p>
    <div class="sheet-btns"><button class="btn small sun" data-act="war-declare-go" data-id="${id || ''}">Sound the horn</button><button class="btn small ghost" data-act="sheet-close">Not yet</button></div>`);
}
async function warApple(kind) {
  const x = await warCall('war_apple', { p_kind: kind });
  if (!x) return;
  play('chime');
  toast(kind === 'courage' ? 'Blood Apple eaten: courage full.' : `Blood Apple eaten: ${kind} full.`, 'lvl', 3000);
}
async function warBuy(item) {
  const x = await warCall('war_buy', { p_item: item });
  if (!x || !x.bought) return;
  if (x.grant) warGrant(x.grant, 0, 0, x.items, 'warshop');
  play('coins');
  toast(item === 'apple' ? 'Bought a Blood Apple.' : `Bought ${itemName(item)}. Wear it from your Profile.`, 'lvl', 4000);
  if (state.tab === 'market') renderView();
}

/* ---------- the War tab on the Village page ---------- */
function warSidesHTML(Wr, V) {
  const s = Wr.score, tot = s.my_head + s.their_head, share = tot > 0 ? s.my_head / tot : 0.5;
  const lead = s.my_head > s.their_head ? 'You lead' : s.my_head < s.their_head ? 'They lead' : 'All square';
  return `<div class="card war-head">
    <div class="war-sides"><div class="war-side"><span class="war-crest">${esc(V.crest || '🏡')}</span><b>${esc(V.name)}</b><small>${fmtN(s.my_head)} a head</small></div>
      <span class="war-vs">vs</span>
      <div class="war-side theirs"><span class="war-crest">${esc(Wr.enemy.crest || '⚔️')}</span><b>${esc(Wr.enemy.name)}</b><small>${fmtN(s.their_head)} a head</small></div></div>
    <div class="war-bar" role="img" aria-label="${lead}"><i style="--p:${share.toFixed(3)}"></i></div>
    <p class="sub"><b>${lead}.</b> Ends in <b id="war-ends">${hms(Date.parse(Wr.ends_at) - warNow())}</b>. ${Wr.camp ? `The camp scores about ${fmtN(Math.round(Wr.camp_rate))} points an hour by itself, so keep raiding.` : `Scores are points per head (you count as ${s.my_size}, they count as ${s.their_size}).`}</p></div>`;
}
function warEnergyHTML(W) {
  const r = warEnergy('raids'), sc = warEnergy('scouts'), ap = warApples(), E = W.energy, me = W.war ? W.war.me : null;
  return `<div class="card war-energy">
    <div class="war-meters">
      <div><small>Raids</small><b>${Math.floor(r)}/${E.raids_max}</b><span id="war-next-raids">${warNext('raids')}</span></div>
      <div><small>Scouts</small><b>${Math.floor(sc)}/${E.scouts_max}</b><span id="war-next-scouts">${warNext('scouts')}</span></div>
      <div><small>Blood Apples</small><b>🍎 ${ap}</b><span>${fmtN(W.purse.spoils)} War Spoils</span></div></div>
    <div class="row"><button class="btn small ghost" data-act="war-apple" data-id="raids" ${!ap || r >= E.raids_max || wv.busy ? 'disabled' : ''}>🍎 Refill raids</button>
      <button class="btn small ghost" data-act="war-apple" data-id="scouts" ${!ap || sc >= E.scouts_max || wv.busy ? 'disabled' : ''}>🍎 Refill scouts</button></div>
    ${me ? `<p class="sub">Your war so far: ${plural(me.raids, 'raid')}, ${plural(me.wins, 'win')}, ${fmtN(me.points)} points, ${fmtN(me.coins)} coins.</p>` : ''}</div>`;
}
function warRosterHTML(Wr) {
  const r = warEnergy('raids'), sc = warEnergy('scouts');
  const left = f => Math.max(0, f.cooldown - Math.floor((Date.now() - wv.at) / 1000));
  const rows = (Wr.roster || []).map(f => {
    const cd = left(f);
    return `<div class="war-foe"><span class="war-foe-ic">${(f.cls && I.cls[f.cls] && I.cls[f.cls].icon) || '🛡️'}</span>
      <div class="war-foe-txt"><b>${esc(f.name)}</b><small>Level ${f.lvl} ${esc(f.cls && I.cls[f.cls] ? I.cls[f.cls].n.toLowerCase() : '')}${f.scouted ? ' · <span class="war-scouted">scouted +25%</span>' : ''}${f.mine ? ` · you raided ${f.mine}×` : ''}</small></div>
      <div class="war-foe-btns"><button class="btn small ghost" data-act="war-scout" data-id="${esc(f.id)}" ${sc < 1 || wv.busy ? 'disabled' : ''}>Scout</button>
        <button class="btn small" data-act="war-raid" data-id="${esc(f.id)}" ${r < 1 || cd > 0 || wv.busy ? 'disabled' : ''} data-cd="${cd}">${cd > 0 ? mmss(cd * 1000) : 'Raid'}</button></div></div>`;
  }).join('');
  return `<div class="card"><h2>Raid the other side</h2>
    <p class="sub">Scout someone first to see their class and gear: your next raid on them hits 25% harder. You can raid the same person again after 5 minutes.</p>
    ${rows || '<p class="sub">Nobody is on the other side right now.</p>'}</div>`;
}
function warLogHTML(Wr) {
  const board = (Wr.board || []).map((b, i) => `<li><span>${i + 1}. ${esc(b.name)}${b.me ? ' (you)' : ''}</span><span>${fmtN(b.points)} pts · ${b.wins}/${b.raids}</span></li>`).join('');
  const log = (Wr.log || []).map(h => {
    const good = h.ours === h.won;   // a win of ours, or a raid of theirs we drove off
    return `<div class="war-log-row ${good ? 'good' : 'bad'}"><span>${h.ours ? `${h.mine ? 'You' : esc(h.who)} ${h.won ? 'beat' : h.mine ? 'were driven off by' : 'was driven off by'} ${esc(h.target)}` : `${esc(h.who)} ${h.won ? 'beat' : 'was driven off by'} ${esc(h.target)}`}</span>
      <b>${good ? '+' : '−'}${fmtN(h.points)}</b><small>${agoText(Date.parse(h.at))}</small></div>`;
  }).join('');
  return `${board ? `<div class="card"><h2>Your side</h2><ol class="raid-top-list">${board}</ol></div>` : ''}
    <div class="card"><h2>War log</h2>${log || '<p class="sub">No raids yet. Be the first!</p>'}</div>`;
}
function warLastHTML(L) {
  if (!L) return '';
  const head = L.result === 'won' ? `Victory over ${esc(L.enemy.crest)} ${esc(L.enemy.name)}` : L.result === 'lost' ? `Defeat by ${esc(L.enemy.crest)} ${esc(L.enemy.name)}` : `A draw with ${esc(L.enemy.crest)} ${esc(L.enemy.name)}`;
  return `<div class="card war-last ${L.result}"><small class="label">Last war</small><h2>${head}</h2>
    <p class="sub">${fmtN(L.my_head)} to ${fmtN(L.their_head)} points a head${L.loot ? ` · ${L.result === 'won' ? '+' : '−'}${fmtN(L.loot)} coins for the treasury` : ''}.</p>
    ${L.me ? `<p class="sub">You: ${plural(L.me.raids, 'raid')}, ${plural(L.me.wins, 'win')}, ${fmtN(L.me.coins)} coins.${L.me.raids ? ` War Spoils: ${L.result === 'won' ? 100 : 25}${L.me.raids >= 3 ? `, Blood Apples: ${L.result === 'won' ? 2 : 1}` : ''}.` : ''}</p>` : ''}</div>`;
}
function warPeaceHTML(W) {
  const V = W.village, elder = W.role === 'elder';
  const trophies = `<p class="sub">🏆 ${plural(V.war_wins, 'war')} won · ${fmtN(V.war_losses)} lost · ${plural(V.camps_beaten, 'raider camp')} beaten</p>`;
  const targets = (W.targets || []).map(t => `<div class="war-foe"><span class="war-foe-ic">${esc(t.crest || '🏡')}</span>
      <div class="war-foe-txt"><b>${esc(t.name)}</b><small>${plural(t.members, 'neighbour')}${t.wins ? ` · ${plural(t.wins, 'war')} won` : ''}${t.ok ? ` · loot up to ${fmtN(t.loot)}` : ` · ${esc(t.why)}`}</small></div>
      ${elder ? `<div class="war-foe-btns"><button class="btn small" data-act="war-declare" data-id="${esc(t.id)}" ${t.ok && !wv.busy ? '' : 'disabled'}>Declare</button></div>` : ''}</div>`).join('');
  return `${warLastHTML(W.last)}
    <div class="card"><h2>${esc(V.crest || '')} ${esc(V.name)} is at peace</h2>${trophies}
      ${W.shielded ? '<p class="sub">Your village is resting after a war, so nobody can attack it for now. You can still declare one.</p>' : ''}
      ${elder ? '<p>Pick a village to fight, or lead your neighbours out against a raider camp.</p><button class="btn sun wide" data-act="war-declare" data-id="">Fight a raider camp</button>'
        : '<p class="sub">Only elders can declare war. Ask one to sound the horn, then raid and scout with everyone.</p>'}</div>
    <div class="card"><h2>Villages</h2>${targets || '<p class="sub">No other villages yet.</p>'}</div>
    <div class="card"><h2>How wars work</h2>
      <p class="sub">A war lasts 48 hours. Raid players on the other side: your attack against their defence sets the chance, between 15% and 85%. A win scores points and pays coins right away; a loss scores half for them. Class, level, battle gear and farmhands all count, and your gear defends you while you're away.</p>
      <p class="sub">Scores are per head, so a bigger village doesn't win by size alone. At the end everyone who fought gets War Spoils (100 for winners, 25 otherwise) and Blood Apples, the winner takes 5% of the loser's treasury (up to 50,000), and the loser rests for 3 days. Spend War Spoils in the Market.</p></div>`;
}
function viewWar() {
  if (!socialOn()) return '<div class="card"><h2>Village wars</h2><p class="sub">Wars are online. Sign in or create an account from your Profile\'s settings, then join a village.</p></div>';
  const W = wv.data;
  if (!W) { loadWar(); return '<div class="card"><p class="sub">Sounding the horn…</p></div>'; }
  if (!W.in_village) return '<div class="card"><h2>Village wars</h2><p class="sub">Join a village to go to war with your neighbours.</p><button class="btn small" data-act="sub" data-tab="town" data-sub="village">Find a village</button></div>';
  if (!W.war) return warEnergyHTML(W) + warPeaceHTML(W);
  return warSidesHTML(W.war, W.village) + warEnergyHTML(W) + warRosterHTML(W.war) + warLogHTML(W.war);
}

/* ---------- the war shop, in the Market ---------- */
function warShopHTML() {
  if (!socialOn()) return '';
  const W = wv.data;
  if (!W) { loadWar(); return ''; }
  const sp = W.purse.spoils;
  const rows = (W.shop || []).map(s => {
    const apple = s.item === 'apple', it = I.items[s.item];
    if (!apple && !it) return '';
    const what = apple ? '<b>Blood Apple</b><small>Refills your raids, scouts or boss courage in one bite</small>'
      : `<b>${esc(it.n)}</b><small>${esc(gearSlotName(it.slot))} · +${it.raid}% ${it.bar === 'both' ? 'on both' : it.bar === 'might' ? 'Strike' : 'Cast'} · ${esc(it.desc)}</small>`;
    return `<div class="store-item${apple ? '' : rarClass(s.item)}">${apple ? '<span class="emo" style="--s:32px">🍎</span>' : pic(s.item, 32)}<div class="what">${what}</div>
      <button class="btn small" data-act="war-buy" data-id="${s.item}" ${s.owned ? 'disabled' : sp < s.price || wv.busy ? 'disabled' : ''}>${s.owned ? 'Owned' : `${fmtN(s.price)} ⚔`}</button></div>`;
  }).join('');
  return `<div class="card"><div class="row between"><h2>War shop</h2><span class="chip plain">${fmtN(sp)} War Spoils · 🍎 ${W.purse.apples}</span></div>
    <p class="sub">War Spoils come from village wars: 2 for every raid you win, and 25 or 100 more when a war ends. Three pieces of the Blood Moon Warband worn together add a set bonus.</p>${rows}</div>`;
}

// while the War tab is open: the clock, the refills and the raid cooldowns tick every second; news every 15
setInterval(() => {
  if (!warOpenNow() || !warFighting()) return;
  const el = $('#war-ends');
  if (el) el.textContent = hms(Date.parse(wv.data.war.ends_at) - warNow());
  for (const k of ['raids', 'scouts']) { const n = $(`#war-next-${k}`); if (n) n.textContent = warNext(k); }
  const cds = [];
  for (const b of document.querySelectorAll('.war-foe-btns [data-cd]')) {
    const left = Math.max(0, +b.dataset.cd - Math.floor((Date.now() - wv.at) / 1000));
    cds.push(left > 0 ? 1 : 0);
    if (left > 0) b.textContent = mmss(left * 1000);
  }
  // redraw only when something becomes possible: a raid or scout refilled, or a cooldown ran out
  const sig = Math.floor(warEnergy('raids')) + ':' + Math.floor(warEnergy('scouts')) + ':' + cds.join('');
  if (sig !== wv.last && !wv.busy) { wv.last = sig; renderView(); }
}, 1000);
setInterval(() => { if (warOpenNow() && !wv.busy && socialOn()) loadWar(); }, 15000);
