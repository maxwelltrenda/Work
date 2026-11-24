/* ---------- classes: D&D-style characters for battles ----------
   A class sets your ability scores, hit points, armour, weapon and moves. Class levels come from battle
   experience only, never from farming, so fights stay fair when they go online. */
const abilityMod = s => Math.floor((s - 10) / 2);
const signed = n => (n >= 0 ? '+' : '') + n;
const clsDef = id => (id && I.cls[id]) || null;
function classLevel(xp) {
  const L = C.classes.levels;
  let l = 1, spent = 0;
  while (l < L.cap) {
    const step = Math.round(L.xpBase * Math.pow(l, L.xpExp));
    if ((xp || 0) < spent + step) return { lvl: l, into: (xp || 0) - spent, need: step };
    spent += step; l++;
  }
  return { lvl: L.cap, into: 0, need: 0 };
}
const profBonus = lvl => 2 + Math.floor((lvl - 1) / 4);
function scoresAt(c, lvl) {
  const s = Object.assign({}, c.scores);
  for (const at of C.classes.levels.scoreUpAt || []) if (lvl >= at) s[c.primary] = Math.min(20, s[c.primary] + 2);
  return s;
}
function maxHpOf(c, lvl, s) { const con = abilityMod(s.con); return Math.max(1, c.hitDie + con + (lvl - 1) * (Math.floor(c.hitDie / 2) + 1 + con)); }

/* One stat block for anyone who fights: you, a villager friend, or (later) a snapshot sent to the server. */
function statBlock(clsId, lvl, extra = {}) {
  const c = clsDef(clsId);
  if (!c) return null;
  const s = scoresAt(c, lvl), prof = profBonus(lvl), w = c.weapon;
  return {
    cls: c.id, lvl, scores: s, hp: maxHpOf(c, lvl, s), ac: c.armor + (extra.ac || 0), prof,
    init: abilityMod(s.dex), attack: abilityMod(s[w.stat]) + prof + (extra.hit || 0), damage: w.dice, damageMod: abilityMod(s[w.stat]),
    power: abilityMod(s[c.primary]), saveDc: 8 + prof + abilityMod(s[c.primary]), moves: c.moves.slice(), weapon: w, role: c.role,
  };
}
const myClass = () => clsDef(state.combat && state.combat.cls);
const myClassLevel = () => classLevel((state.combat && state.combat.xp) || 0).lvl;
function myBlock() { const c = myClass(); return c ? statBlock(c.id, myClassLevel(), { ac: charmFx('ac'), hit: charmFx('hit') }) : null; }
/* Villagers who come along fight with their own class, a level behind you, catching up as you grow closer. */
function folkBlock(vid) {
  const cid = (C.classes.folk || {})[vid];
  if (!cid) return null;
  const mine = myClass() ? myClassLevel() : 1;
  // Tess trains everyone, so she fights at your level
  return statBlock(cid, vid === 'tess' ? mine : Math.max(1, mine - 1 + Math.min(2, Math.floor(hearts(vid) / 4))));
}
function chooseClass(id) {
  const c = clsDef(id);
  if (!c) return false;
  const had = state.combat.cls;
  state.combat.cls = id;
  play('level');
  toast(had && had !== id ? `You're a ${c.n} now` : `${c.icon} You're a ${c.n}`);
  return true;
}
function addCombatXP(n) {
  if (!myClass() || !(n > 0)) return;
  const before = myClassLevel();
  state.combat.xp = (state.combat.xp || 0) + Math.round(n);
  const after = myClassLevel();
  if (after > before) { play('level'); toast(`${myClass().n} level ${after}! More hit points${(C.classes.levels.scoreUpAt || []).some(a => a > before && a <= after) ? ` and +2 ${C.classes.abilities[myClass().primary].short}` : ''}.`, 'lvl', 4500); }
}

/* The class card on the character sheet. */
function moveLine(id) {
  const m = C.classes.moves[id];
  if (!m) return '';
  const uses = m.uses ? (m.uses === 1 ? 'Once per battle' : `${m.uses} times per battle`) : 'Any turn';
  return `<div class="move"><b>${esc(m.n)}</b><small>${esc(uses)}</small><p>${esc(m.desc)}</p></div>`;
}
function classCard() {
  const c = myClass();
  if (!c) return `<div class="card class-card"><h2>Class</h2><p class="sub">Your class decides how you fight in battles: what you're good at and which moves you have. You can change it whenever you like for now.</p>
      <div class="row"><button class="btn small" data-act="class-pick">Choose a class</button></div></div>`;
  const b = myBlock(), lv = classLevel(state.combat.xp || 0), ab = C.classes.abilities;
  const scores = Object.keys(ab).map(k => `<div class="score${k === c.primary ? ' main' : ''}"><small>${esc(ab[k].short)}</small><b>${b.scores[k]}</b><span>${signed(abilityMod(b.scores[k]))}</span></div>`).join('');
  return `<div class="card class-card"><div class="row between"><h2>${c.icon} Level ${b.lvl} ${esc(c.n)}</h2><button class="btn small ghost" data-act="class-pick">Change</button></div>
      <p class="sub">${esc(c.blurb)}</p>
      ${lv.need ? `<div class="bar"><i style="width:${Math.round(lv.into / lv.need * 100)}%"></i></div><p class="sub" style="font-size:12px">${fmtN(lv.into)} / ${fmtN(lv.need)} battle experience to level ${b.lvl + 1}</p>` : ''}
      <div class="stats"><div class="stat"><b>${b.hp}</b><span>hit points</span></div><div class="stat"><b>${b.ac}</b><span>armour</span></div>
        <div class="stat"><b>${signed(b.attack)}</b><span>to hit</span></div><div class="stat"><b>${signed(b.init)}</b><span>speed (initiative)</span></div></div>
      <div class="scores">${scores}</div>
      <p class="sub"><b>${esc(c.weapon.n)}</b>: ${c.weapon.dice}${b.damageMod ? ' ' + signed(b.damageMod) : ''} damage${c.weapon.reach === 'any' ? ', reaches the back row' : ', front row only'}. Wears ${esc(c.armorName)}.</p>
      <div class="label">Moves</div><div class="moves">${c.moves.map(moveLine).join('')}</div>
      <details class="plain"><summary>What do these numbers mean?</summary>
        ${['hp', 'ac', 'prof', 'mod'].map(k => `<p class="sub">${esc(C.classes.terms[k] || '')}</p>`).join('')}
        ${Object.keys(ab).map(k => `<p class="sub"><b>${esc(ab[k].short)}</b> ${esc(ab[k].n)}: ${esc(ab[k].plain)}</p>`).join('')}</details></div>`;
}
function classPickSheet() {
  const cur = state.combat && state.combat.cls;
  openSheet(`<h2>Choose a class</h2><p class="sub">No wrong answer. You can switch later, and villagers with other classes can fight beside you.</p>
    ${C.classes.classes.map(c => {
      const b = statBlock(c.id, 1);
      return `<div class="card class-pick${c.id === cur ? ' current' : ''}"><div class="row between"><b>${c.icon} ${esc(c.n)}</b><span class="chip plain">${c.role === 'front' ? 'Front row' : 'Back row'}</span></div>
        <p class="sub">${esc(c.blurb)}</p>
        <p class="sub">${b.hp} hit points · armour ${b.ac} · best at ${esc(C.classes.abilities[c.primary].n)}</p>
        <p class="sub">Moves: ${c.moves.map(m => esc(C.classes.moves[m].n)).join(', ')}</p>
        <div class="row"><button class="btn small" data-act="class-choose" data-id="${c.id}" ${c.id === cur ? 'disabled' : ''}>${c.id === cur ? 'Your class' : `Be a ${esc(c.n)}`}</button></div></div>`;
    }).join('')}
    <div class="sheet-btns"><button class="btn small ghost" data-act="sheet-close">Close</button></div>`);
}
