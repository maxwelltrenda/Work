/* ---------- farmhands, borrowed from Jarldoms' bondsmen ----------
   Hire other players to help you. Their hire price is what their farm is worth (farmValue(): everything bought
   for it that stays), worked out by the server from its own copy. They are paid a tenth of it. Each farmhand
   makes your hits on village bosses stronger, more so the more their farm is worth (supabase/farmhands.sql).
   Hiring spends coins, so it is a farm move (MOVES.hire) that the server checks: the price, room in your
   bunkhouse, nobody blocked, nobody hired twice. Letting one go costs nothing and refunds nothing.
   Their help is capped (supabase/farmhand_caps.sql): a hit can be at most four times as strong, and never over 500.
   Past that, bigger means more coins: farmhands worth as much as your farm double what bosses pay you. */
const hf = { data: null, market: null, q: '', at: 0, loading: false, err: '', busy: '' };
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
    const [mine, market] = await Promise.all([rpc('my_farmhands'), rpc('farmhand_market', { p_q: hf.q })]);
    hf.data = mine; hf.market = market || []; hf.at = Date.now();
  } catch (e) { hf.err = String((e && e.message) || e); }
  hf.loading = false;
  if (state.tab === 'town' && sub('town') === 'hands' && !sheetOpen()) renderView();
}
function handSearch() { const i = $('#hand-q'); hf.q = i ? i.value.trim().slice(0, 30) : ''; loadHands(true); }

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
  const list = (hf.market || []).map(p => {
    const price = Math.max(C.core.farmhands.minPrice, +p.price || 0);
    const btn = p.hired ? '<span class="chip plain">Hired</span>'
      : `<button class="btn small" data-act="hire-hand" data-id="${esc(p.id)}" data-name="${esc(p.name)}" data-price="${price}" ${!full && state.coins >= price && !hf.busy ? '' : 'disabled'}>Hire · ${fmtC(price)}</button>`;
    return `<div class="store-item"><span class="emo" style="--s:28px">${p.online ? '🟢' : '🧑‍🌾'}</span><div class="what"><b>${esc(p.name)}</b><small>@${esc(p.username || '')} · farm worth ${fmtCoins(+p.value)}${+p.hired_by ? ` · working for ${p.hired_by}` : ''}</small></div>${btn}</div>`;
  }).join('');
  const market = `<div class="card"><h2>Hire a farmhand</h2>
    <div class="vil-say-form"><input id="hand-q" maxlength="30" placeholder="Find a player" value="${esc(hf.q)}" autocapitalize="none" spellcheck="false"><button class="btn small ghost" data-act="hand-search">Search</button></div>
    ${full ? '<p class="sub">Your bunkhouse is full. Build more room to hire more.</p>' : ''}
    ${list || '<p class="sub">Nobody to hire yet.</p>'}</div>`;
  const by = me.hired_by || [];
  const hired = `<div class="card"><h2>Working for others</h2>
    <p class="sub">${by.length ? `${plural(by.length, 'player')} ${by.length === 1 ? 'has' : 'have'} hired you.` : 'Nobody has hired you yet. The more your farm is worth, the more you earn when someone does.'} Being hired has earned you <b>${fmtN(+me.earned || 0)}</b> coins.</p>
    ${by.slice(0, 20).map(h => `<div class="store-item"><span class="emo" style="--s:24px">🤝</span><div class="what"><b>${esc(h.name)}</b><small>@${esc(h.username || '')} · paid ${fmtCoins(+h.price)}</small></div></div>`).join('')}</div>`;
  return intro + mine + market + hired;
}
