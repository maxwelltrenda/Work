/* ---------- farmhands, borrowed from Jarldoms' bondsmen ----------
   Hire other players to help you. Their hire price is what their farm is worth (farmValue(): everything bought
   for it that stays), worked out by the server from its own copy. They are paid a tenth of it. Each farmhand
   makes your hits on village bosses stronger, more so the more their farm is worth (supabase/farmhands.sql).
   Hiring spends coins, so it is a farm move (MOVES.hire) that the server checks: the price, room in your
   bunkhouse, nobody blocked, nobody hired twice. Letting one go costs nothing and refunds nothing.
   Their help is capped (supabase/farmhand_caps.sql): a hit can be at most four times as strong, and never over 500.
   Past that, bigger means more coins: farmhands worth as much as your farm double what bosses pay you. */
const hf = { data: null, market: null, q: '', at: 0, loading: false, err: '', busy: '', page: '', budget: null };   // page 'hire': the hire page; budget null: all your coins
// the most a farmhand on the hire page may cost: your coins, unless you've set something else (Infinity: any price)
const handBudget = () => (hf.budget === null ? Math.max(0, Math.floor(state.coins)) : hf.budget);
// '50k', '2.5m', '1b', '12,000' -> a number of coins
function parseCoins(t) {
  const m = String(t || '').trim().toLowerCase().replace(/[, _]/g, '').match(/^(\d+(?:\.\d+)?)([kmbt]?)$/);
  if (!m) return null;
  const v = parseFloat(m[1]) * { '': 1, k: 1e3, m: 1e6, b: 1e9, t: 1e12 }[m[2]];
  return Math.min(9e15, Math.round(v));
}
const handHelp = v => Math.round(Math.log10(1 + Math.max(0, +v || 0)) * 2.5);   // the damage one hand adds, in %, before the cap
const handCap = () => { const k = C.core.farmhands; return k.cap[Math.min(state.bunk || 0, k.cap.length - 1)]; };
const bunkMaxed = () => (state.bunk || 0) >= C.core.farmhands.cap.length - 1;
const bunkCost = () => { const k = C.core.farmhands; return Math.round(k.bunkCost * Math.pow(k.bunkGrow, state.bunk || 0)); };
function buyBunk() {
  if (bunkMaxed() || state.coins < bunkCost()) return false;
  state.coins -= bunkCost(); state.bunk = (state.bunk || 0) + 1;
  toast(`The bunkhouse now sleeps ${handCap()} farmhands`);
  return true;
}

async function loadHands(force) {
  if (!socialOn() || hf.loading || (!force && Date.now() - hf.at < 20000 && hf.data)) return;
  hf.loading = true; hf.err = '';
  try {
    const b = handBudget();
    const [mine, market] = await Promise.all([rpc('my_farmhands'), rpc('farmhand_market', { p_q: hf.q, p_min: 0, p_max: b === Infinity ? null : b })]);
    hf.data = mine; hf.market = market || []; hf.at = Date.now();
  } catch (e) { hf.err = String((e && e.message) || e); }
  hf.loading = false;
  if (state.tab === 'town' && sub('town') === 'hands' && !sheetOpen()) renderView();
}
function handSearch() { const i = $('#hand-q'); hf.q = i ? i.value.trim().slice(0, 30) : ''; loadHands(true); }
function handBudgetSet(kind) {
  const c = Math.max(0, Math.floor(state.coins));
  if (kind === 'coins') hf.budget = null;
  else if (kind === 'half') hf.budget = Math.floor(c / 2);
  else if (kind === 'tenth') hf.budget = Math.floor(c / 10);
  else if (kind === 'any') hf.budget = Infinity;
  else {
    const i = $('#hand-budget'), v = parseCoins(i && i.value);
    if (v === null) { toast('Type a number of coins, like 5000, 50k or 2.5m'); return; }
    hf.budget = v;
  }
  hf.market = null; loadHands(true); renderView();
}

async function hireHand(d) {
  const price = Math.floor(+d.price || 0), name = d.name || 'them';
  if (!online || !mv.on) { toast('Sign in to hire farmhands.'); return; }
  if ((hf.data && hf.data.hands || []).length >= handCap()) { toast('Your bunkhouse is full. Build more room first.'); return; }
  if (state.coins < price) { toast(`You need ${fmtN(price)} coins.`); return; }
  if (hf.busy) return;
  hf.busy = d.id;
  doMove('hire', { u: d.id, c: price });   // the server takes the price from its own records and pays them a tenth
  commit(); play('coins');
  clearTimeout(onl.timer);
  await pushCloud();
  hf.busy = '';
  await loadHands(true);
  const ok = (hf.data && hf.data.hands || []).some(h => h.id === d.id);
  toast(ok ? `${name} is now one of your farmhands` : onl.err || `Couldn't hire ${name} just now. Your coins are back.`, ok ? 'lvl' : '');
}
async function dropHand(d) {
  if (!confirm(`Let ${d.name || 'this farmhand'} go? You won't get the hire price back.`)) return;
  try { hf.data = await rpc('drop_farmhand', { p_hand: d.id }); toast(`${d.name || 'They'} went home`); loadHands(true); }
  catch (e) { toast(String((e && e.message) || e)); }
}

function viewHands() {
  if (!socialOn()) return '<div class="card"><h2>Farmhands</h2><p class="sub">Sign in (Bag › Settings) to hire other players as farmhands.</p></div>';
  if (!hf.data && !hf.err) { loadHands(false); return '<div class="card"><p class="sub">Asking around for farmhands…</p></div>'; }
  if (hf.err && !hf.data) return `<div class="card"><p class="sub">${esc(hf.err)}</p><button class="btn small" data-act="hand-search">Try again</button></div>`;
  loadHands(false);
  const me = hf.data, hands = me.hands || [], cap = handCap(), full = hands.length >= cap;
  const bonus = Math.round((+me.bonus || 0) * 100), bonusMax = Math.round((+me.bonus_max || 3) * 100), plunder = Math.round((+me.plunder || 0) * 100);
  const intro = `<div class="card"><h2>Farmhands</h2>
    <p class="sub">Hire other players to help you. You pay what their farm is worth, and they get a tenth of it.</p>
    <p class="sub">Farmhands make your hits on village bosses stronger, up to four times as strong. Past that, bigger pays: farmhands whose farms add up to as much as yours double the coins bosses pay you.</p>
    <p class="sub">Your farm is worth <b>${fmtCoins(+me.value || farmValue())}</b>: that's your price if someone hires you.</p>
    <div class="row"><span class="chip plain">⚔️ +${bonus}% damage${bonus >= bonusMax ? ' (the most)' : ` (up to +${bonusMax}%)`}</span><span class="chip plain">🪙 +${plunder}% boss coins${plunder >= 100 ? ' (the most)' : ''}</span></div></div>`;
  const mine = `<div class="card"><div class="row between"><h2>Your farmhands</h2><span class="chip plain">${hands.length}/${cap}</span></div>
    ${hands.length ? hands.map(h => `<div class="store-item"><span class="emo" style="--s:28px">🧑‍🌾</span><div class="what"><b>${esc(h.name)}</b><small>@${esc(h.username || '')} · farm worth ${fmtCoins(+h.value)} · +${Math.round(Math.log10(1 + Math.max(0, +h.value)) * 2.5)}% damage</small></div>
      <button class="btn small ghost" data-act="drop-hand" data-id="${esc(h.id)}" data-name="${esc(h.name)}">Let go</button></div>`).join('') : '<p class="sub">Nobody yet. Hire someone below.</p>'}
    <div class="store-item"><span class="emo" style="--s:28px">🛏️</span><div class="what"><b>Bunkhouse</b><small>Room for ${cap} farmhands${bunkMaxed() ? ' (the most there can be)' : ` → ${C.core.farmhands.cap[(state.bunk || 0) + 1]}`}</small></div>
      ${bunkMaxed() ? '<span class="chip plain">Full size</span>' : `<button class="btn small" data-act="bunk-buy" ${state.coins >= bunkCost() ? '' : 'disabled'}>${fmtC(bunkCost())}</button>`}</div></div>`;
  if (hf.page === 'hire') return viewHire(me, hands, cap, full);
  const market = `<div class="card"><h2>Hire a farmhand</h2>
    <p class="sub">See everyone you can afford, best first, and set how much you want to spend.</p>
    <button class="btn wide" data-act="hands-hire" ${full ? 'disabled' : ''}>${full ? 'Your bunkhouse is full' : 'Find farmhands to hire ›'}</button></div>`;
  const by = me.hired_by || [];
  const hired = `<div class="card"><h2>Working for others</h2>
    <p class="sub">${by.length ? `${plural(by.length, 'player')} ${by.length === 1 ? 'has' : 'have'} hired you.` : 'Nobody has hired you yet. The more your farm is worth, the more you earn when someone does.'} Being hired has earned you <b>${fmtN(+me.earned || 0)}</b> coins.</p>
    ${by.slice(0, 20).map(h => `<div class="store-item"><span class="emo" style="--s:24px">🤝</span><div class="what"><b>${esc(h.name)}</b><small>@${esc(h.username || '')} · paid ${fmtCoins(+h.price)}</small></div></div>`).join('')}</div>`;
  return intro + mine + market + hired;
}
/* The hire page: everyone whose hire price fits your budget, best first. The budget starts at all your coins. */
function viewHire(me, hands, cap, full) {
  const b = handBudget(), c = Math.max(0, Math.floor(state.coins));
  const chip = (kind, label, on) => `<button class="chip budget-chip${on ? ' on' : ''}" data-act="hand-budget" data-b="${kind}">${label}</button>`;
  const list = (hf.market || []).filter(p => !p.hired).map(p => {
    const price = Math.max(C.core.farmhands.minPrice, +p.price || 0), short = price - c;
    const btn = `<button class="btn small" data-act="hire-hand" data-id="${esc(p.id)}" data-name="${esc(p.name)}" data-price="${price}" ${!full && short <= 0 && !hf.busy ? '' : 'disabled'}>${short > 0 ? `Need ${fmtC(short)} more` : `Hire · ${fmtC(price)}`}</button>`;
    return `<div class="store-item"><span class="emo" style="--s:28px">${p.online ? '🟢' : '🧑‍🌾'}</span><div class="what"><b>${esc(p.name)}</b><small>@${esc(p.username || '')} · farm worth ${fmtCoins(+p.value)} · +${handHelp(p.value)}% damage${+p.hired_by ? ` · working for ${p.hired_by}` : ''}</small></div>${btn}</div>`;
  }).join('');
  const already = (hf.market || []).filter(p => p.hired).length;
  return `<div class="card"><button class="place-back hands-back" data-act="hands-back">‹ Farmhands</button>
      <h2>Hire a farmhand</h2>
      <p class="sub">You have <b>${fmtCoins(c)}</b> · bunkhouse ${hands.length}/${cap}${full ? ' (full: build more room to hire more)' : ''}</p></div>
    <div class="card"><div class="label">Your budget</div>
      <p class="sub">${b === Infinity ? 'Showing farmhands at <b>any price</b>.' : `Showing farmhands who cost up to <b>${fmtCoins(b)}</b>.`}</p>
      <div class="row wrap">${chip('coins', `All my coins · ${fmtC(c)}`, hf.budget === null)}${chip('half', `Half · ${fmtC(Math.floor(c / 2))}`, hf.budget !== null && hf.budget !== Infinity && hf.budget === Math.floor(c / 2))}${chip('tenth', `A tenth · ${fmtC(Math.floor(c / 10))}`, hf.budget !== null && hf.budget !== Infinity && hf.budget === Math.floor(c / 10))}${chip('any', 'Any price', hf.budget === Infinity)}</div>
      <div class="vil-say-form"><input id="hand-budget" inputmode="decimal" maxlength="20" placeholder="Or type one: 5000, 50k, 2.5m" value="${hf.budget !== null && hf.budget !== Infinity ? esc(String(hf.budget)) : ''}" autocapitalize="none" spellcheck="false"><button class="btn small ghost" data-act="hand-budget" data-b="set">Set</button></div>
      <div class="vil-say-form"><input id="hand-q" maxlength="30" placeholder="Find a player by name" value="${esc(hf.q)}" autocapitalize="none" spellcheck="false"><button class="btn small ghost" data-act="hand-search">Search</button></div></div>
    <div class="card"><div class="row between"><h2>${b === Infinity ? 'For hire' : 'In your budget'}</h2>${hf.market ? `<span class="chip plain">${(hf.market || []).length - already}</span>` : ''}</div>
      ${!hf.market ? '<p class="sub">Asking around…</p>' : list || `<p class="sub">Nobody${hf.q ? ` called "${esc(hf.q)}"` : ''} in your budget${already ? ' you haven\'t already hired' : ''}. Raise your budget${hf.q ? ' or clear the search' : ''} to see more.</p>`}</div>`;
}
