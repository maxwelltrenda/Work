/* ---------- villages: neighbours pool coins, elders raise buildings, everyone gets the perks ----------
   The server keeps the rules (one village each, member caps, who may spend, buildings no taller than the
   hall). The game keeps a copy of the village's building levels so the perks work offline too. */
const VIL_PERKS = 'bramblebrook-village-perks';
const CRESTS = ['🌾', '🍎', '🐝', '🦊', '🌙', '🍄', '🐟', '⛏️', '🌻', '🦉', '🌲', '🔔'];
const vil = { data: null, members: [], board: [], profiles: {}, defs: [], list: null, at: 0, loading: false, err: '', draft: '', perks: null, timer: 0 };
try { vil.perks = JSON.parse(localStorage.getItem(VIL_PERKS) || 'null'); } catch (e) { vil.perks = null; }

/* Perks for the player's village: the sum of per-level amounts for buildings with this effect. */
function villageFx(effect) {
  const c = vil.perks;
  if (!c || !c.levels) return 0;
  let v = 0;
  for (const [id, lv] of Object.entries(c.levels)) { const d = c.defs && c.defs[id]; if (d && d.effect === effect) v += d.per_level * lv; }
  return v;
}
function keepPerks() {
  const levels = {};
  if (vil.data) for (const b of vil.data.buildings || []) levels[b.building] = b.level;
  const defs = {};
  for (const d of vil.defs) defs[d.id] = { effect: d.effect, per_level: +d.per_level };
  vil.perks = vil.data ? { levels, defs, name: vil.data.name } : null;
  try { if (vil.perks) localStorage.setItem(VIL_PERKS, JSON.stringify(vil.perks)); else localStorage.removeItem(VIL_PERKS); } catch (e) { /* storage blocked */ }
}

const rpc = (fn, body) => onlineApi('/rest/v1/rpc/' + fn, { method: 'POST', auth: true, body: body || {} });
async function loadVillage() {
  if (!signedInWeb() || vil.loading) return;
  vil.loading = true;
  try {
    if (!vil.defs.length) vil.defs = await onlineApi('/rest/v1/village_building_defs?select=*&order=sort', { auth: true });
    const mine = await onlineApi(`/rest/v1/village_members?user_id=eq.${online.user}&select=village_id,role`, { auth: true });
    if (!mine.length) {
      vil.data = null; vil.members = []; vil.board = [];
      vil.list = await rpc('list_villages');
    } else {
      const id = mine[0].village_id;
      const [v, buildings, members, board] = await Promise.all([
        onlineApi(`/rest/v1/villages?id=eq.${id}&select=*`, { auth: true }),
        onlineApi(`/rest/v1/village_buildings?village_id=eq.${id}&select=building,level`, { auth: true }),
        onlineApi(`/rest/v1/village_members?village_id=eq.${id}&select=user_id,role,contributed,joined_at&order=contributed.desc`, { auth: true }),
        onlineApi(`/rest/v1/village_log?village_id=eq.${id}&select=id,user_id,kind,body,amount,created_at&order=created_at.desc&limit=40`, { auth: true }),
      ]);
      vil.data = Object.assign({}, v[0], { buildings, role: mine[0].role });
      vil.members = members; vil.board = board;
      const ids = [...new Set(members.map(m => m.user_id).concat(board.map(b => b.user_id)).filter(Boolean))];
      const ps = ids.length ? await rpc('get_profiles', { p_ids: ids }) : [];
      vil.profiles = {};
      for (const p of ps) vil.profiles[p.id] = p;
    }
    vil.err = ''; vil.at = Date.now();
    keepPerks();
  } catch (e) { vil.err = navigator.onLine === false ? 'Offline. The village will show when you are back.' : String(e.message || e); }
  vil.loading = false;
}
const villageOpenNow = () => state && state.tab === 'town' && sub('town') === 'village' && !sheetOpen();
async function refreshVillage(full) {
  await loadVillage();
  if (!villageOpenNow()) return;
  const typing = document.activeElement && document.activeElement.id === 'vil-say';
  if (full || !typing) renderView();
  else { const b = $('#vil-board'); if (b) b.innerHTML = boardHTML(); }
}
/* While the village screen is open, check for news every 20 seconds. */
setInterval(() => { if (villageOpenNow() && signedInWeb() && Date.now() - vil.at > 18000) refreshVillage(false); }, 5000);

const whoName = id => { const p = vil.profiles[id]; return p ? ((p.public && p.public.name) || p.username) : 'A neighbour'; };
const buildingCost = (d, lv) => Math.round(d.base_cost * Math.pow(d.growth, lv));
function boardHTML() {
  if (!vil.board.length) return '<p class="sub">Nothing on the board yet. Say hello.</p>';
  return vil.board.map(e => {
    const who = `<b>${esc(whoName(e.user_id))}</b>`;
    const what = e.kind === 'chat' ? `${who}: ${esc(e.body)}` : e.kind === 'donate' ? `${who} gave ${fmtN(e.amount)} coins to the treasury`
      : e.kind === 'build' ? `${who} raised the ${esc(e.body)}${e.amount ? ` (${fmtN(e.amount)} coins)` : ''}` : `${who} ${esc(e.body)}`;
    return `<div class="vil-post${e.kind === 'chat' ? '' : ' note'}"><span>${what}</span><small>${agoText(new Date(e.created_at).getTime())}</small></div>`;
  }).join('');
}

function viewVillage() {
  if (inClaude()) return '<div class="card"><h2>Villages</h2><p class="sub">Villages are played online, on the website version of Bramblebrook.</p></div>';
  if (!online) return `<div class="card"><h2>Villages</h2><p class="sub">Team up with other players: pool coins, raise buildings together, and every neighbour gets the perks.</p>
      <p class="sub">Villages are online, so you need an account first.</p><div class="row"><button class="btn small" data-act="online-open" data-id="signup">Create account</button><button class="btn small ghost" data-act="online-open" data-id="signin">Sign in</button></div></div>`;
  if (!vil.at && !vil.err) { refreshVillage(true); return '<div class="card"><p class="sub">Walking to the village…</p></div>'; }
  if (vil.err && !vil.data && !vil.list) return `<div class="card"><p class="sub" style="color:var(--berry)">${esc(vil.err)}</p><div class="row"><button class="btn small ghost" data-act="vil-refresh">Try again</button></div></div>`;
  return vil.data ? villageHome() : villageFinder();
}
function villageFinder() {
  const list = (vil.list || []).map(v => `<div class="card vil-card"><div class="row between"><b>${esc(v.crest)} ${esc(v.name)}</b><span class="chip plain">${v.members}/${v.cap}</span></div>
      ${v.motto ? `<p class="sub">“${esc(v.motto)}”</p>` : ''}<p class="sub">Town Hall level ${v.hall}</p>
      <div class="row"><button class="btn small" data-act="vil-join" data-id="${esc(v.id)}" ${v.open && v.members < v.cap ? '' : 'disabled'}>${!v.open ? 'Closed' : v.members >= v.cap ? 'Full' : 'Move in'}</button></div></div>`).join('');
  return `<div class="card"><h2>Find a village</h2><p class="sub">Neighbours pool coins in a treasury, elders raise buildings, and everyone who lives there gets the perks.</p>
      <div class="row"><button class="btn small" data-act="vil-found">Found a village · 500c</button></div></div>
    ${list || '<div class="card"><p class="sub">No villages yet. Found the first one.</p></div>'}`;
}
function villageHome() {
  const v = vil.data, elder = v.role === 'elder';
  const levels = {};
  for (const b of v.buildings) levels[b.building] = b.level;
  const hall = levels.hall || 0, cap = 10 + 2 * hall;
  const buildings = vil.defs.map(d => {
    const lv = levels[d.id] || 0, maxed = lv >= d.max_level, cost = buildingCost(d, lv);
    const blocked = d.id !== 'hall' && lv >= hall;
    const now = d.effect === 'members' ? `${10 + 2 * lv} neighbours` : d.effect === 'insp' ? `+${Math.floor(d.per_level * lv)} Inspiration` : `+${Math.round(d.per_level * lv)}%`;
    return `<div class="card vil-building"><div class="row between"><b>${esc(d.n)}</b><span class="chip plain">Level ${lv}/${d.max_level}</span></div>
      <p class="sub">${esc(d.blurb)}</p><p class="sub">Now: <b>${now}</b></p>
      ${maxed ? '<p class="sub">Fully built.</p>' : elder ? `<div class="row"><button class="btn small" data-act="vil-build" data-id="${esc(d.id)}" ${blocked || v.treasury < cost ? 'disabled' : ''}>${blocked ? 'Raise the Town Hall first' : `Build · ${fmtN(cost)}c from the treasury`}</button></div>`
        : `<p class="sub">Next level: ${fmtN(cost)} coins from the treasury. Elders build.</p>`}</div>`;
  }).join('');
  const members = vil.members.map(m => {
    const p = vil.profiles[m.user_id] || { username: '…', public: {} };
    return `<button class="vil-member" data-act="online-profile" data-id="${esc(m.user_id)}">${profilePic(p.public && p.public.face, 36)}
      <span class="vm-name"><b>${esc((p.public && p.public.name) || p.username)}</b><small>${m.role === 'elder' ? 'Elder · ' : ''}${fmtN(m.contributed)} coins given</small></span>${statusLine(p)}</button>`;
  }).join('');
  return `<div class="card vil-head" id="vil-head"><div class="row between"><h2>${esc(v.crest)} ${esc(v.name)}</h2><span class="chip plain">${vil.members.length}/${cap}</span></div>
      ${v.motto ? `<p class="sub">“${esc(v.motto)}”</p>` : ''}
      <p class="vil-treasury">Treasury <b class="num">${fmtN(v.treasury)}</b> coins</p>
      <div class="row">${[100, 1000, 10000].map(n => `<button class="btn small ghost" data-act="vil-give" data-n="${n}" ${state.coins >= n ? '' : 'disabled'}>Give ${fmtN(n)}</button>`).join('')}</div>
      <p class="sub">You are ${elder ? 'an elder: you decide what the treasury builds' : 'a neighbour'}. Perks below apply to everyone who lives here.</p></div>
    <div class="label">Notice board</div>
    <div class="card"><form class="vil-say-form" id="vil-say-form"><input id="vil-say" maxlength="280" placeholder="Say something to the village" value="${esc(vil.draft)}"><button class="btn small" type="submit">Post</button></form>
      <div id="vil-board" class="vil-board">${boardHTML()}</div></div>
    <div class="label">Buildings</div>${buildings}
    <div class="label">Neighbours</div><div class="card vil-members">${members}</div>
    <div class="row"><button class="btn small ghost danger" data-act="vil-leave">Move out</button></div>`;
}

/* Founding: a name, a crest and a motto. */
function foundSheet(err) {
  openSheet(`<h2>Found a village</h2><p class="sub">It costs 500 coins. You become its first elder.</p>
    <form id="vil-found-form" class="online-form">
      <label class="label" for="vf-name">Name</label><input id="vf-name" maxlength="24" required placeholder="3 to 24 characters">
      <span class="label">Crest</span><div class="crest-pick">${CRESTS.map((c, i) => `<label><input type="radio" name="crest" value="${c}" ${i ? '' : 'checked'}><span>${c}</span></label>`).join('')}</div>
      <label class="label" for="vf-motto">Motto (optional)</label><input id="vf-motto" maxlength="80" placeholder="Many hands, light work">
      <p class="sub" id="vf-err" style="color:var(--berry)">${err ? esc(err) : ''}</p>
      <div class="sheet-btns"><button class="btn small ghost" type="button" data-act="sheet-close">Cancel</button><button class="btn small" type="submit" id="vf-go" ${state.coins >= 500 ? '' : 'disabled'}>Found it · 500c</button></div>
    </form>`);
  $('#vil-found-form').addEventListener('submit', async e => {
    e.preventDefault();
    const name = $('#vf-name').value, crest = ($('input[name="crest"]:checked') || {}).value || '🌾', motto = $('#vf-motto').value;
    const go = $('#vf-go');
    go.disabled = true;
    state.coins -= 500; commit();
    try { await rpc('create_village', { p_name: name, p_crest: crest, p_motto: motto }); closeSheet(); toast(`${crest} ${name.trim()} is founded`); await refreshVillage(true); }
    catch (err2) { state.coins += 500; commit(); $('#vf-err').textContent = String(err2.message || err2); go.disabled = false; }
  });
  setTimeout(() => { const i = $('#vf-name'); if (i) i.focus(); }, 60);
}
async function villageAct(act, el) {
  try {
    if (act === 'vil-join') { await rpc('join_village', { p_village: el.dataset.id }); toast('Welcome to the village'); }
    if (act === 'vil-give') {
      const n = +el.dataset.n;
      if (state.coins < n) return;
      state.coins -= n; commit();
      try { await rpc('donate_to_village', { p_amount: n }); play('coins'); toast(`Gave ${fmtN(n)} coins to the treasury`); }
      catch (e) { state.coins += n; commit(); throw e; }
    }
    if (act === 'vil-build') { const lv = await rpc('upgrade_village_building', { p_building: el.dataset.id }); play('level'); toast(`Raised to level ${lv}`); }
    if (act === 'vil-leave') {
      if (!confirm('Move out of the village? Its perks stop for you.')) return;
      await rpc('leave_village'); toast('You moved out');
    }
  } catch (e) { toast(String(e.message || e)); }
  await refreshVillage(true);
}
document.addEventListener('submit', async e => {
  if (e.target.id !== 'vil-say-form') return;
  e.preventDefault();
  const i = $('#vil-say'), body = (i.value || '').trim();
  if (!body) return;
  i.disabled = true;
  try { await rpc('post_village_message', { p_body: body }); vil.draft = ''; i.value = ''; }
  catch (err) { toast(String(err.message || err)); }
  i.disabled = false;
  await refreshVillage(false);
  const again = $('#vil-say'); if (again) again.focus();
});
document.addEventListener('input', e => { if (e.target.id === 'vil-say') vil.draft = e.target.value; });
