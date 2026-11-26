/* ---------- village bosses: the whole village fights one big boss over two days ----------
   An elder summons a boss. Every phase has two bars, Might and Magic; fill both to move on, beat the last
   phase to win. Attacks cost courage, which refills over the hour. Your class hits its own bar harder.
   The server keeps the bars, the courage and everyone's hits (raid_* in supabase/village_raids.sql); inside
   Claude the same calls go through the player's connector (rpc() in 74-villages.js routes them). */
const BOSS_CELLS = 4;   // pictures in assets/boss.webp
const raidUI = { open: false, busy: false, at: 0, float: null };
const MIGHT_CLASSES = ['fighter', 'rogue', 'ranger'], MAGIC_CLASSES = ['wizard', 'cleric', 'bard'];
const raidDef = id => ((vil.raid && vil.raid.defs) || []).find(d => d.id === id) || null;
const bossArtHTML = (d, cls = '') => `<span class="boss-art ${cls}" style="--i:${d ? d.art : 0};--n:${BOSS_CELLS}" role="img" aria-label="${esc(d ? d.n : 'The boss')}"></span>`;

/* keep the server's answer, and when it came, so timers and courage can count on between answers */
function takeRaid(r) {
  if (!r) return;
  const { hit, ...status } = r;
  vil.raid = status;
  raidUI.at = Date.now();
  raidUI.skew = status.now ? Date.parse(status.now) - Date.now() : 0;
  return hit;
}
const serverNow = () => Date.now() + (raidUI.skew || 0);
function courageNow() {
  const R = vil.raid;
  if (!R) return 0;
  return Math.min(R.courage_max, R.courage + (Date.now() - raidUI.at) / 1000 / R.courage_secs);
}
const mmss = ms => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
function hms(ms) {
  const s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return `${h}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
function raidNumbers(r, d) {
  const ph = d.phases[Math.min(r.phase, d.phases.length - 1)];
  const needM = ph.might * r.scale, needG = ph.magic * r.scale;
  const fm = r.status === 'won' ? 1 : Math.min(1, r.might / needM), fg = r.status === 'won' ? 1 : Math.min(1, r.magic / needG);
  const done = r.status === 'won' ? d.phases.length : r.phase + (fm + fg) / 2;
  return { ph, needM, needG, fm, fg, total: done / d.phases.length };
}
const pctText = f => `${Math.floor(f * 100)}%`;

/* The card on the village screen: fight the boss, summon one, or collect a share. */
function bossCardHTML() {
  const R = vil.raid;
  if (!R || !R.in_village) return '';
  const rw = R.reward;
  const reward = rw ? `<div class="card boss-reward"><b>${rw.status === 'won' ? `🏆 ${esc(rw.boss_name)} is beaten!` : `${esc(rw.boss_name)} got away this time.`}</b>
      <p class="sub">Your share for ${plural(rw.actions, 'attack')}: ${fmtN(rw.coins)} coins${myClass() ? ` and ${fmtN(rw.xp)} battle experience` : ''}.</p>
      <div class="row"><button class="btn small sun" data-act="raid-claim">Collect</button></div></div>` : '';
  const r = R.raid, d = r && raidDef(r.boss);
  if (r && d && r.status === 'active') {
    const n = raidNumbers(r, d);
    return `${reward}<div class="label">Village boss</div>
      <button class="card boss-card" data-act="raid-open">${bossArtHTML(d)}<span class="bc-text"><b>${esc(d.n)}</b>
        <small>Phase ${r.phase + 1} of ${d.phases.length} · ${pctText(n.total)} beaten · ends in ${hms(Date.parse(r.ends_at) - serverNow())}</small>
        <span class="bar"><i style="--p:${n.total.toFixed(3)}"></i></span><span class="btn small">Fight</span></span></button>`;
  }
  const last = r && d ? `<p class="sub">${r.status === 'won' ? `The village beat ${esc(d.n)}!` : `${esc(d.n)} got away.`}</p>` : '';
  const ladder = bossLadder(), next = ladder.find(x => x.state === 'open' && !x.beaten);
  const progress = `<p class="sub">${ladder.filter(x => x.beaten).length} of ${ladder.length} bosses beaten.${next ? ` Next: <b>${esc(next.d.n)}</b>.` : ladder.length ? ' The village has beaten them all!' : ''}</p>`;
  if (R.role !== 'elder') return `${reward}<div class="label">Village boss</div><div class="card"><p class="sub">No boss right now. When an elder summons one, the whole village fights it together for two days, and everyone who joins in shares the reward.</p>${progress}${last}</div>`;
  return `${reward}<div class="label">Village boss</div><div class="card"><p class="sub">Summon a boss and the whole village fights it together for two days. Everyone who joins in shares the reward. Bosses unlock one at a time: beat each to face the next.</p>${progress}${last}</div>
    ${ladder.map(({ d: b, state, beaten, prev }) => state === 'locked'
      ? `<div class="card boss-pick locked">${bossArtHTML(b)}<div><b>🔒 ${esc(b.n)}</b><p class="sub">Beat ${esc(prev.n)} to unlock.</p></div></div>`
      : `<div class="card boss-pick">${bossArtHTML(b)}<div><b>${esc(b.n)}${beaten ? ' <span class="chip plain">Beaten ✓</span>' : ''}</b><p class="sub">${esc(b.blurb)}</p>
      ${bossFactsHTML(b)}<button class="btn small${beaten ? ' ghost' : ''}" data-act="raid-start" data-id="${esc(b.id)}">${beaten ? 'Summon again' : 'Summon'}</button></div></div>`).join('')}`;
}
/* Bosses unlock in order, smallest to largest: each one opens once the village has beaten the one before it. */
function bossLadder() {
  const R = vil.raid || {}, won = new Set(R.beaten || []);
  const defs = (R.defs || []).slice().sort((a, b) => a.sort - b.sort);
  return defs.map((d, i) => ({ d, beaten: won.has(d.id), prev: defs[i - 1] || null, state: i === 0 || won.has(defs[i - 1].id) ? 'open' : 'locked' }));
}
/* What a boss asks of each neighbour and what it pays, so the four can be told apart before summoning. */
function bossFacts(d) {
  const per = d.phases.reduce((a, p) => ({ might: a.might + p.might, magic: a.magic + p.magic }), { might: 0, magic: 0 });
  const attacks = Math.round((per.might + per.magic) / 15);   // a typical hit is about 15 (12 plain, 19 with your class's bar)
  const level = attacks <= 36 ? 'Easy' : attacks <= 46 ? 'Medium' : 'Hard';
  const lean = per.might > per.magic * 1.15 ? 'might' : per.magic > per.might * 1.15 ? 'magic' : '';
  return { attacks, level, lean };
}
function bossFactsHTML(d) {
  const f = bossFacts(d);
  return `<ul class="boss-facts">
      <li><b>${f.level}</b> · about ${f.attacks} attacks from each neighbour over ${Math.round(d.hours / 24)} days</li>
      <li>${f.lean === 'might' ? '⚔️ Needs more Might: fighters, rogues and rangers shine' : f.lean === 'magic' ? '✨ Needs more Magic: wizards, clerics and bards shine' : '⚖️ Even: every class helps the same'}</li>
      <li>🪙 ${d.coin_per_action} coins and 15 battle experience per attack, +${fmtN(d.victory_bonus)} coins each if it's beaten</li></ul>`;
}

/* The boss screen: art, phase, the two bars, courage and the attack buttons. */
function drawRaid() {
  if (!raidUI.open) return;
  const R = vil.raid, r = R && R.raid, d = r && raidDef(r.boss);
  if (!d) { closeRaid(); return; }
  const n = raidNumbers(r, d), c = courageNow(), cls = myClass();
  const fl = raidUI.float && Date.now() - raidUI.float.at < 1200 ? raidUI.float : null;
  raidUI.float = null;
  const strong = k => cls && (k === 'might' ? MIGHT_CLASSES : MAGIC_CLASSES).includes(cls.id);
  const active = r.status === 'active', fullM = n.fm >= 1, fullG = n.fg >= 1;
  const btn = (k, label) => `<button class="btn raid-${k}" data-raid="${k}" ${!active || raidUI.busy || c < 1 || (k === 'might' ? fullM : fullG) ? 'disabled' : ''}>
      <b>${label}</b><small>${(k === 'might' ? fullM : fullG) ? 'Full this phase' : `−1 courage${strong(k) ? ' · strong' : ''}`}</small></button>`;
  const top = (R.top || []).slice(0, 5).map((t, i) => `<li><span>${i + 1}. ${esc(whoName(t.user_id))}${t.user_id === (online && online.user) ? ' (you)' : ''}</span><span>${plural(t.actions, 'attack')}</span></li>`).join('');
  const banner = r.status === 'won' ? 'Beaten!' : r.status === 'lost' ? 'It got away' : `Phase ${['I', 'II', 'III', 'IV', 'V'][r.phase] || r.phase + 1} · ${n.ph.n}`;
  const ends = active ? `<small>Ends in</small><b id="raid-ends">${hms(Date.parse(r.ends_at) - serverNow())}</b>` : '<small>Over</small><b>—</b>';
  const tail = active ? `<div class="raid-courage"><span><b>${Math.floor(c)}</b>/${R.courage_max} courage</span><span id="raid-next">${c >= R.courage_max ? 'Full' : `+1 in ${mmss((1 - (c % 1)) * R.courage_secs * 1000)}`}</span></div>
      <div class="raid-btns">${btn('might', '⚔️ Strike')}${btn('magic', '✨ Cast')}</div>
      <p class="sub raid-hint">${cls ? `You're a ${esc(cls.n)}: you hit ${MIGHT_CLASSES.includes(cls.id) ? 'Might' : 'Magic'} hardest.` : 'Pick a class on your character sheet to hit one bar harder.'} Courage refills fully every hour.
        Each attack pays ${d.coin_per_action} coins, and +${fmtN(d.victory_bonus)} each if the village wins.${R.mine && R.mine.actions ? ` You've attacked ${plural(R.mine.actions, 'time')}.` : ''}</p>`
    : r.status === 'won' ? `<p class="raid-text">The village did it. ${esc(d.n)} is beaten, and everyone who fought gets a share.</p>${R.reward ? '<button class="btn sun big" data-raid="claim">Collect your share</button>' : ''}`
    : `<p class="raid-text">Time ran out and ${esc(d.n)} slipped away. Everyone who fought still gets half a share.</p>${R.reward ? '<button class="btn sun big" data-raid="claim">Collect your share</button>' : ''}`;
  const html = `<div class="raid-top"><button class="raid-back" data-raid="close" aria-label="Back to the village">‹</button>
      <div class="raid-title"><small>Village boss · 2 days</small><b>${esc(d.n)}</b></div><div class="raid-ends">${ends}</div></div>
    <div class="raid-phases">${d.phases.map((p, i) => `<i class="${r.status === 'won' || i < r.phase ? 'done' : i === r.phase ? 'now' : ''}"></i>`).join('')}</div>
    <div class="raid-stage${fl ? ' hit' : ''}">${bossArtHTML(d, 'big')}<span class="raid-banner">${esc(banner)}</span>
      ${fl ? `<span class="raid-float${fl.strong ? ' strong' : ''}">−${fmtShort(fl.dmg)}${fl.strong ? ' strong!' : ''}${fl.bonus ? `<small> farmhands +${fl.bonus}%</small>` : ''}</span>` : ''}</div>
    <div class="raid-body">
      <div class="raid-row"><b>Boss beaten</b><span>${pctText(n.total)}</span></div><div class="raid-bar gold"><i style="--p:${n.total.toFixed(3)}"></i></div>
      ${active ? `<p class="raid-text">${esc(n.ph.text)}</p>` : ''}
      <div class="raid-row"><span class="raid-k might">⚔️ Might · fighters, rogues, rangers</span><span>${pctText(n.fm)}</span></div><div class="raid-bar might"><i style="--p:${n.fm.toFixed(3)}"></i></div>
      <div class="raid-row"><span class="raid-k magic">✨ Magic · wizards, clerics, bards</span><span>${pctText(n.fg)}</span></div><div class="raid-bar magic"><i style="--p:${n.fg.toFixed(3)}"></i></div>
      ${tail}
      ${top ? `<div class="label">Fighting today</div><ol class="raid-top-list">${top}</ol>` : ''}
    </div>`;
  const box = $('#scene-root .scene.raid');
  if (box) box.innerHTML = html;
  else $('#scene-root').innerHTML = `<div class="scene-wrap"><div class="scene raid" role="dialog" aria-modal="true" aria-label="${esc(d.n)}">${html}</div></div>`;
}
function openRaid() {
  if (!vil.raid || !vil.raid.raid) return;
  raidUI.open = true;
  holdToasts();
  drawRaid();
  setTimeout(() => maybeTourNow('raid'), 400);
}
function closeRaid() {
  raidUI.open = false;
  $('#scene-root').innerHTML = '';
  flushToasts();
  if (villageOpenNow()) renderView();
}
async function raidCall(fn, args) {
  if (raidUI.busy) return null;
  raidUI.busy = true;
  if (raidUI.open) drawRaid();
  try { return await rpc(fn, args); }
  catch (e) { toast(String(e.message || e)); return null; }
  finally { raidUI.busy = false; }
}
async function raidHit(kind) {
  const res = await raidCall('raid_hit', { p_kind: kind });
  if (res) {
    const hit = takeRaid(res);
    if (hit) {
      raidUI.float = { dmg: hit.dmg, strong: hit.matched, bonus: +hit.bonus || 0, at: Date.now() };
      play(hit.matched ? 'crit' : 'thud');
      if (hit.won) { play('feat', 0.3); toast('The boss is beaten! Collect your share.', 'lvl', 5000); }
      else if (hit.phase_done) { play('level', 0.2); toast('Phase cleared! On to the next one.', 'lvl', 3500); }
    }
  }
  drawRaid();
}
async function raidStart(id) {
  const d = raidDef(id);
  const res = await raidCall('start_raid', { p_boss: id });
  if (!res) return;
  takeRaid(res);
  toast(`${d ? d.n : 'The boss'} has come to the village!`, 'lvl', 4000);
  renderView();
  openRaid();
}
async function raidClaim() {
  const rw = await raidCall('claim_raid_reward');
  if (!rw) return;
  doMove('grant', { g: String(rw.grant || ''), c: rw.coins || 0, xp: rw.xp || 0, why: 'raid' });   // the server pays it from its own record
  play('coins');
  toast(`+${fmtN(rw.coins)} coins from ${rw.boss_name}${myClass() && rw.xp ? ` · +${fmtN(rw.xp)} battle experience` : ''}`, 'lvl', 4500);
  commit();
  await loadVillage();
  if (raidUI.open) drawRaid(); else if (villageOpenNow()) renderView();
}
document.addEventListener('click', e => {
  if (!raidUI.open) return;
  const b = e.target.closest('[data-raid]');
  if (!b || b.disabled) return;
  const k = b.dataset.raid;
  if (k === 'close') closeRaid();
  else if (k === 'claim') raidClaim();
  else if (k === 'might' || k === 'magic') raidHit(k);
});
// while the boss screen is open: the clock and courage tick every second, and news comes every 15
setInterval(() => {
  if (!raidUI.open || !vil.raid || !vil.raid.raid) return;
  const r = vil.raid.raid, el = $('#raid-ends');
  if (el && r.status === 'active') el.textContent = hms(Date.parse(r.ends_at) - serverNow());
  const c = courageNow(), nx = $('#raid-next');
  if (nx) nx.textContent = c >= vil.raid.courage_max ? 'Full' : `+1 in ${mmss((1 - (c % 1)) * vil.raid.courage_secs * 1000)}`;
  if (Math.floor(c) !== Math.floor(raidUI.lastC || 0)) { raidUI.lastC = c; if (!raidUI.busy) drawRaid(); }
}, 1000);
setInterval(async () => {
  if (!raidUI.open || raidUI.busy || !socialOn()) return;
  await loadVillage();
  if (raidUI.open && !raidUI.busy) drawRaid();
}, 15000);
