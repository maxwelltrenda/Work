/* ---------- battles: turn-based fights on the story stage ----------
   Your party (you plus up to two villager friends) on the left in front and back rows, foes on the right.
   Initiative sets the order; on your turn you pick a move and tap a target; the d20 decides. Friends and
   foes act on their own. A loss costs nothing but pride: everyone limps home. */
let bt = null;
const FOES = () => (C.foes && C.foes.foes) || {};
const FIGHTS = () => (C.foes && C.foes.fights) || [];

/* "2d6" rolled, with crits doubling the dice. */
function rollDice(spec, crit) {
  const m = /^(\d+)d(\d+)$/.exec(spec || '');
  if (!m) return 0;
  let n = +m[1] * (crit ? 2 : 1), t = 0;
  while (n-- > 0) t += 1 + Math.floor(rand() * +m[2]);
  return t;
}
const d20roll = () => 1 + Math.floor(rand() * 20);
const alive = side => Object.values(bt.units).filter(u => u.side === side && !u.down);
const unitPic = u => u.kind === 'monster' ? `<span class="emo" style="--s:40px">${u.icon}</span>` : u.kind === 'you' ? playerPic(48) : folk(u.ref, 48);

function partyUnit(kind, ref, block, name) {
  return {
    id: kind === 'you' ? 'you' : 'f_' + ref, side: 'party', kind, ref, name, cls: block.cls, lvl: block.lvl, row: block.role === 'front' ? 'front' : 'back',
    hp: block.hp, max: block.hp, ac: block.ac, hit: block.attack, dice: block.weapon.dice, dmg: block.damageMod, reach: block.weapon.reach,
    power: block.power, prof: block.prof, saveDc: block.saveDc, moves: ['strike'].concat(block.moves), uses: {}, init: block.init, fx: {}, hitBy: new Set(),
  };
}
function foeUnit(id, n) {
  const f = FOES()[id];
  return {
    id: 'm' + n + '_' + id, side: 'foe', kind: 'monster', ref: id, name: f.n, short: f.s || f.n, icon: f.i, row: f.row, hp: f.hp, max: f.hp, ac: f.ac, hit: f.hit,
    dice: f.dice, dmg: f.dmg || 0, reach: f.reach || 'melee', saves: f.saves || {}, spell: !!f.spell, wards: !!f.wards, warded: !!(f.wards && f.boss), wardHits: f.wards && f.boss ? 6 : 0,
    regen: f.regen || 0, multi: f.multi || 1, poison: !!f.poison, boss: !!f.boss, init: f.saves && f.saves.dex || 0, fx: {}, hitBy: new Set(), xp: f.xp || 0,
  };
}

/* Starting a fight: who's coming along? */
function fightUnlocked(f) { return myClass() && myClassLevel() >= f.lvl; }
function fightSheet(id) {
  const f = FIGHTS().find(x => x.id === id);
  if (!f) return;
  if (!myClass()) { classPickSheet(); return; }
  const pals = eligibleCompanions().filter(v => (C.classes.folk || {})[v.id]).concat([{ id: 'tess', short: 'Tess', n: 'Tess Marlow' }]);
  bt = null;
  fightPick.id = id; fightPick.with = pals.slice(0, 2).map(v => v.id);
  const html = () => `<h2>${esc(f.n)}</h2><p class="sub">${esc(f.blurb)}</p>
    <p class="sub">Foes: ${f.foes.map(x => `${FOES()[x].i} ${esc(FOES()[x].n)}`).join(', ')}</p>
    <div class="label">Bring up to two friends</div>
    ${pals.length ? pals.map(v => { const c = clsDef(C.classes.folk[v.id]), on = fightPick.with.includes(v.id);
      return `<button class="party-pick${on ? ' on' : ''}" data-act="fight-pal" data-id="${v.id}">${folk(v.id, 36)}<span><b>${esc(v.short || v.n)}</b><small>${c.icon} ${esc(c.n)} · ${on ? 'coming' : 'tap to bring'}</small></span></button>`; }).join('')
      : ''}
    <p class="sub">Friends with three hearts or more can fight beside you. Tess will always come along if you ask.</p>
    <div class="sheet-btns"><button class="btn small ghost" data-act="sheet-close">Not now</button><button class="btn small" data-act="fight-go">Fight!</button></div>`;
  openSheet(html(), html);
}
const fightPick = { id: '', with: [] };

function startFight(fightId, pals, quiet) {
  const f = FIGHTS().find(x => x.id === fightId);
  const me = myBlock();
  if (!f || !me) return;
  closeSheet();
  const units = {};
  const you = partyUnit('you', 'you', me, state.name || 'You');
  units[you.id] = you;
  for (const vid of pals || []) { const b = folkBlock(vid); if (b) { const u = partyUnit('folk', vid, b, vid === 'tess' ? 'Tess' : vilShort(vid)); units[u.id] = u; } }
  f.foes.forEach((id, n) => { const u = foeUnit(id, n); if (f.foes.filter(x => x === id).length > 1) { const tag = ' ' + 'ABC'[f.foes.slice(0, n).filter(x => x === id).length]; u.name += tag; u.short += tag; } units[u.id] = u; });
  bt = { fight: f, units, round: 1, order: [], turn: 0, phase: 'busy', pick: null, log: [], stage: newStage(STAGE_PLACE[f.where] || 'meadow:'), ended: false };
  for (const u of Object.values(units)) u.roll = d20roll() + (u.init || 0);
  bt.order = Object.values(units).sort((a, b) => b.roll - a.roll).map(u => u.id);
  say(`Initiative: ${bt.order.map(id => units[id].name).join(', ')}.`);
  holdToasts();
  play('dice');
  drawBattle(true);
  setTimeout(() => maybeTourNow('battle'), 500);
  setTimeout(nextTurn, 700);
}
/* the log keeps the newest line first; knock-outs wait for the line that caused them */
function say(line) { bt.log.unshift(line); for (const l of bt.after || []) bt.log.unshift(l); bt.after = []; bt.log = bt.log.slice(0, 6); }

/* ---- the turn loop ---- */
function nextTurn() {
  if (!bt || bt.ended) return;
  if (typeof tour !== 'undefined' && tour) return setTimeout(nextTurn, 400);
  if (!alive('foe').length) return endFight(true);
  if (!alive('party').length) return endFight(false);
  const id = bt.order[bt.turn % bt.order.length];
  const u = bt.units[id];
  if (bt.turn > 0 && bt.turn % bt.order.length === 0) newRound();
  bt.turn++;
  if (!u || u.down) return nextTurn();
  startOfTurn(u);
  if (u.down) { drawBattle(); return setTimeout(nextTurn, 500); }
  if (u.id === 'you') { bt.phase = 'choose'; bt.pick = null; drawBattle(); return; }
  bt.phase = 'busy';
  drawBattle();
  setTimeout(() => { if (!bt || bt.ended) return; u.side === 'foe' ? foeAct(u) : palAct(u); drawBattle(); setTimeout(nextTurn, 750); }, 650);
}
function newRound() {
  bt.round++;
  for (const u of Object.values(bt.units)) {
    if (u.fx.exposed) u.fx.exposed--;
    if (u.fx.bless) u.fx.bless--;
  }
  // slowed units act last this round
  const slow = bt.order.filter(id => bt.units[id].fx.slowed);
  if (slow.length) { bt.order = bt.order.filter(id => !bt.units[id].fx.slowed).concat(slow); slow.forEach(id => { bt.units[id].fx.slowed = false; }); }
  bt.turn = 0;
}
function startOfTurn(u) {
  if (u.fx.guarding) { const w = bt.units[u.fx.guarding]; if (w && w.fx.guardBy === u.id) w.fx.guardBy = null; u.fx.guarding = null; u.fx.guardAc = 0; }
  if (u.fx.poisoned) { const d = rollDice('1d4'); hurt(u, d, null, true); say(`${u.name} takes ${d} from poison.`); u.fx.poisoned--; }
  if (u.regen && u.warded && !u.down && u.hp < u.max) { u.hp = Math.min(u.max, u.hp + u.regen); say(`${u.name} mends itself (+${u.regen}). Its ward holds.`); }
}

/* ---- rolls ---- */
function attackRoll(a, t, opt = {}) {
  let adv = a.fx.adv > 0, dis = a.fx.rattled;
  if (adv) a.fx.adv = 0;
  if (dis) a.fx.rattled = false;
  const r1 = d20roll(), r2 = d20roll();
  const nat = adv && !dis ? Math.max(r1, r2) : dis && !adv ? Math.min(r1, r2) : r1;
  let bonus = a.hit + (opt.toHit || 0) + (t.fx.exposed ? 2 : 0);
  let bless = 0;
  if (a.fx.bless) { bless = rollDice('1d4'); bonus += bless; }
  const ac = t.ac + (t.fx.guardAc || 0);
  const total = nat + bonus;
  const hit = nat === 20 || (nat !== 1 && total >= ac);
  return { nat, total, hit, crit: nat === 20, ac, mode: adv && !dis ? 'best' : dis && !adv ? 'worse' : '', bless };
}
const rollText = r => `${r.mode ? `rolled two dice, kept the ${r.mode} ` : 'rolled '}${r.nat}${r.total - r.nat ? ` ${signed(r.total - r.nat)}` : ''} = ${r.total} vs armour ${r.ac}`;
function hurt(t, dmg, by, quiet) {
  if (t.warded && by) {
    dmg = Math.max(1, Math.floor(dmg / 2));
    // every blow wears a ward down: a wizard breaks it at once, anyone else by hitting it enough
    if (--t.wardHits <= 0) { t.warded = false; (bt.after = bt.after || []).push(`${t.name}'s ward cracks and falls away.`); }
  }
  t.hp = Math.max(0, t.hp - dmg);
  if (by) t.hitBy.add(by.id);
  fxUnit(t, `-${dmg}`, 'hurt');
  if (!quiet) play('thud');
  if (t.hp <= 0 && !t.down) { t.down = true; (bt.after = bt.after || []).push(`${t.name} ${t.side === 'foe' ? 'is defeated' : 'is knocked out'}.`); }
  return dmg;
}
function heal(t, n) { if (t.down) return 0; const before = t.hp; t.hp = Math.min(t.max, t.hp + n); fxUnit(t, `+${t.hp - before}`, 'heal'); play('sparkle'); return t.hp - before; }
/* who an attack can reach: melee only reaches the front row while anyone stands in it */
function reachable(a, side, reach) {
  const list = alive(side);
  if ((reach || a.reach) === 'any') return list;
  const front = list.filter(u => u.row === 'front');
  return front.length ? front : list;
}
function weaponHit(a, t, opt = {}) {
  // a guard steps in front
  if (t.fx.guardBy && bt.units[t.fx.guardBy] && !bt.units[t.fx.guardBy].down) { const g = bt.units[t.fx.guardBy]; say(`${g.name} steps in front of ${t.name}!`); t.fx.guardBy = null; t = g; }
  const r = attackRoll(a, t, opt);
  if (t.fx.guardAc) t.fx.guardAc = 0;
  if (!r.hit) { say(`${a.name} ${opt.verb || 'attacks'} ${t.name}: ${rollText(r)}. ${r.nat === 1 ? 'A 1: a clumsy miss.' : 'Miss.'}`); play('miss'); return false; }
  let dmg = rollDice(opt.dice || a.dice, r.crit) + (opt.noMod ? 0 : a.dmg) + (opt.extra ? rollDice(opt.extra, r.crit) : 0);
  if (a.fx.mark && a.fx.mark === t.id) dmg += rollDice('1d6', r.crit);
  dmg = hurt(t, Math.max(1, dmg), a);
  say(`${a.name} ${opt.verb || 'hits'} ${t.name}: ${rollText(r)}. ${r.crit ? 'A 20! Critical hit, ' : 'Hit, '}${dmg} damage${t.warded ? ' (halved by its ward)' : ''}.`);
  if (r.crit) play('crit');
  if (t.side === 'foe' && opt.slow) { t.fx.slowed = true; say(`${t.name} is slowed and will act last next round.`); }
  return true;
}
function saveRoll(a, t, save, dice, opt = {}) {
  const roll = d20roll() + ((t.saves && t.saves[save]) || 0);
  if (roll >= a.saveDc) { say(`${t.name} ${save === 'dex' ? 'dodges' : 'shrugs it off'} (${roll} vs ${a.saveDc}).`); play('miss'); return false; }
  const dmg = hurt(t, rollDice(dice) + (opt.addPower ? a.power : 0), a);
  say(`${t.name} fails to ${save === 'dex' ? 'dodge' : 'keep its nerve'} (${roll} vs ${a.saveDc}): ${dmg} damage.`);
  if (opt.rattle) { t.fx.rattled = true; say(`${t.name} is rattled: its next attack rolls worse.`); }
  return true;
}

/* ---- moves ---- */
const MOVE_TARGET = { strike: 'foe', power_strike: 'foe', sneak_attack: 'foe', weak_spot: 'foe', frost_ray: 'foe', magic_missile: 'foe', dispel: 'warded', sacred_flame: 'foe', hunters_mark: 'foe', vicious_mockery: 'foe', guard: 'ally', healing_word: 'hurt', inspire: 'ally' };
function moveDef(id) { return id === 'strike' ? { n: 'Attack', desc: 'A plain attack with your weapon.' } : C.classes.moves[id]; }
function usesLeft(u, id) { const m = moveDef(id); return m.uses ? m.uses - (u.uses[id] || 0) : Infinity; }
function moveTargets(u, id) {
  const kind = MOVE_TARGET[id];
  const reach = ['frost_ray', 'magic_missile', 'sacred_flame', 'vicious_mockery', 'hunters_mark', 'weak_spot', 'dispel'].includes(id) ? 'any' : u.reach;
  if (kind === 'foe') return reachable(u, 'foe', reach);
  if (kind === 'warded') return alive('foe').filter(f => f.warded);
  if (kind === 'ally') return alive('party').filter(p => p.id !== u.id);
  if (kind === 'hurt') return alive('party').filter(p => p.hp < p.max);
  return null;   // no target needed
}
function useMove(u, id, t) {
  const m = moveDef(id);
  if (m.uses) u.uses[id] = (u.uses[id] || 0) + 1;
  switch (id) {
    case 'strike': weaponHit(u, t); break;
    case 'power_strike': weaponHit(u, t, { toHit: -2, extra: '1d8', verb: 'swings hard at' }); break;
    case 'second_wind': say(`${u.name} catches a second wind: +${heal(u, rollDice('1d10') + u.lvl)} HP.`); break;
    case 'guard': t.fx.guardBy = u.id; u.fx.guarding = t.id; u.fx.guardAc = 2; say(`${u.name} stands guard over ${t.name}.`); break;
    case 'sneak_attack': { const helped = u.fx.adv > 0 || [...t.hitBy].some(x => x !== u.id) || t.fx.exposed; weaponHit(u, t, { extra: helped ? '2d6' : null, verb: helped ? 'slips in on' : 'attacks' }); if (!helped) say('Nobody else had hit that foe yet, so no sneak attack bonus.'); break; }
    case 'hide': u.fx.adv = 1; say(`${u.name} melts into the shadows. Next attack rolls two dice.`); break;
    case 'weak_spot': t.fx.exposed = 2; say(`${u.name} spots a gap in ${t.name}'s guard: everyone gets +2 to hit it for two rounds.`); break;
    case 'magic_missile': { const d = hurt(t, rollDice('3d4') + 3, u); say(`${u.name}'s magic missiles never miss: ${d} damage to ${t.name}${t.warded ? ' (halved by its ward)' : ''}.`); play('sparkle'); break; }
    case 'frost_ray': weaponHit(u, t, { dice: '1d8', noMod: true, slow: true, verb: 'freezes' }); break;
    case 'dispel': t.warded = false; say(`${u.name} unravels ${t.name}'s ward. Blows land in full again.`); play('chime'); break;
    case 'healing_word': say(`${u.name}'s healing word: +${heal(t, rollDice('1d4') + u.power)} HP for ${t.name}.`); break;
    case 'sacred_flame': saveRoll(u, t, 'dex', '1d8', { addPower: true }); break;
    case 'bless': alive('party').forEach(p => { p.fx.bless = 3; }); say(`${u.name} blesses the party: +1d4 to attacks for three rounds.`); play('chime'); break;
    case 'hunters_mark': u.fx.mark = t.id; say(`${u.name} marks ${t.name}.`); weaponHit(u, t); break;
    case 'volley': { let total = 0; alive('foe').forEach(f => { total += hurt(f, rollDice('1d6') + u.dmg, u, true); }); play('thud'); say(`${u.name}'s volley rains on every foe: ${total} damage in all.`); break; }
    case 'track': alive('party').forEach(p => { p.fx.adv = 1; }); say(`${u.name} reads the field: everyone's next attack rolls two dice.`); break;
    case 'vicious_mockery': saveRoll(u, t, 'wis', '1d6', { rattle: true, addPower: true }); break;
    case 'inspire': t.fx.adv = 1; say(`${u.name} plays a rousing tune for ${t.name}: next roll uses two dice.`); play('chime'); break;
    case 'soothing_song': { let total = 0; alive('party').forEach(p => { total += heal(p, rollDice('1d4') + u.power); }); say(`${u.name}'s soothing song heals the party for ${total} in all.`); break; }
    default: weaponHit(u, t);
  }
}

/* ---- friends and foes act on their own ---- */
function palAct(u) {
  const usable = id => u.moves.includes(id) && usesLeft(u, id) > 0 && (moveTargets(u, id) === null || moveTargets(u, id).length);
  const foes = reachable(u, 'foe'), weakest = list => list.slice().sort((a, b) => a.hp - b.hp)[0];
  const hurtAlly = alive('party').filter(p => p.hp / p.max < 0.45).sort((a, b) => a.hp / a.max - b.hp / b.max)[0];
  if (hurtAlly && usable('healing_word')) return useMove(u, 'healing_word', hurtAlly);
  if (hurtAlly && usable('soothing_song')) return useMove(u, 'soothing_song');
  if (u.hp / u.max < 0.4 && usable('second_wind')) return useMove(u, 'second_wind');
  if (alive('foe').some(f => f.warded) && usable('dispel')) return useMove(u, 'dispel', alive('foe').find(f => f.warded));
  if (bt.round === 1 && usable('bless')) return useMove(u, 'bless');
  if (alive('foe').length >= 3 && usable('volley')) return useMove(u, 'volley');
  const you = bt.units.you;
  if (you && !you.down && you.hp / you.max < 0.5 && usable('guard') && u.id !== 'you') return useMove(u, 'guard', you);
  if (usable('magic_missile')) return useMove(u, 'magic_missile', weakest(alive('foe')));
  if (usable('hunters_mark') && (!u.fx.mark || !bt.units[u.fx.mark] || bt.units[u.fx.mark].down)) return useMove(u, 'hunters_mark', weakest(foes));
  const marked = u.fx.mark && foes.find(f => f.id === u.fx.mark);
  if (marked) return useMove(u, 'strike', marked);
  if (usable('sneak_attack')) return useMove(u, 'sneak_attack', foes.find(f => [...f.hitBy].length) || weakest(foes));
  if (usable('vicious_mockery') && rand() < 0.5) return useMove(u, 'vicious_mockery', weakest(alive('foe')));
  if (usable('sacred_flame')) return useMove(u, 'sacred_flame', weakest(alive('foe')));
  if (usable('power_strike') && rand() < 0.5) return useMove(u, 'power_strike', weakest(foes));
  return useMove(u, 'strike', weakest(foes));
}
function foeAct(f) {
  // a hexer wraps an unprotected friend in a ward
  if (f.wards && !f.boss && rand() < 0.5) {
    const bare = alive('foe').filter(x => !x.warded && x.id !== f.id);
    if (bare.length) { const w = bare[Math.floor(rand() * bare.length)]; w.warded = true; w.wardHits = 3; say(`${f.name} wraps ${w.name} in a ward: blows on it are halved until it cracks or someone dispels it.`); play('chime'); return; }
  }
  for (let k = 0; k < f.multi && alive('party').length; k++) {
    const targets = reachable(f, 'party', f.reach);
    const t = f.reach === 'any' ? targets.slice().sort((a, b) => a.hp - b.hp)[0] : targets[Math.floor(rand() * targets.length)];
    const hit = weaponHit(f, t, { verb: f.spell ? 'hexes' : 'attacks' });
    if (hit && f.poison && !t.down) { t.fx.poisoned = 2; say(`${t.name} is poisoned.`); }
  }
}

/* ---- the player's turn ---- */
function battleChoose(id) {
  recordMove('bt', { k: 'move', id });
  if (!bt || bt.phase !== 'choose') return;
  const u = bt.units.you;
  if (usesLeft(u, id) <= 0) return;
  const targets = moveTargets(u, id);
  if (targets === null) { finishPlayerMove(id, null); return; }
  if (!targets.length) { toast('Nobody to use that on right now.'); return; }
  if (targets.length === 1) { finishPlayerMove(id, targets[0]); return; }
  bt.phase = 'target'; bt.pick = id; play('tick');
  drawBattle();
}
function battleTarget(uid) {
  recordMove('bt', { k: 'target', id: uid });
  if (!bt || bt.phase !== 'target') return;
  const t = bt.units[uid];
  if (!t || !moveTargets(bt.units.you, bt.pick).includes(t)) return;
  finishPlayerMove(bt.pick, t);
}
function finishPlayerMove(id, t) {
  bt.phase = 'busy'; bt.pick = null;
  play('dice');
  useMove(bt.units.you, id, t);
  drawBattle();
  setTimeout(nextTurn, 800);
}

/* ---- the end ---- */
function endFight(won) {
  bt.ended = true; bt.phase = won ? 'won' : 'lost';
  const f = bt.fight, rewards = [];
  if (won) {
    const firstWin = !(state.combat.wins || {})[f.id];
    const xp = Object.values(bt.units).filter(u => u.side === 'foe').reduce((a, u) => a + u.xp, 0);
    addCombatXP(xp); rewards.push(`+${fmtN(xp)} battle experience`);
    const coins = Math.round(f.coins * (firstWin ? 1 : 0.5));
    state.coins += coins; rewards.push(`+${fmtN(coins)} coins`);
    if (firstWin && f.item && addItem(f.item, 1)) rewards.push(`${itemName(f.item)}`);
    state.combat.wins = Object.assign({}, state.combat.wins, { [f.id]: ((state.combat.wins || {})[f.id] || 0) + 1 });
    for (const u of Object.values(bt.units)) if (u.kind === 'folk') addFriend(u.ref, 10);
    play('feat');
  } else play('miss');
  bt.rewards = rewards;
  drawBattle();
  saveLocal();
}
function leaveBattle() {
  recordMove('bt', { k: 'leave' });
  bt = null;
  $('#scene-root').innerHTML = '';
  commit();
  flushToasts();
}

/* ---- drawing ---- */
function fxUnit(u, text, kind) {
  u.fx.flash = { text, kind, at: Date.now() };
}
function drawBattle(fresh) {
  if (!bt) return;
  const units = Object.values(bt.units);
  const col = u => u.side === 'party' ? (u.row === 'front' ? 33 : 12) : (u.row === 'front' ? 66 : 88);
  const byCol = {};
  const pos = {};
  for (const u of units) { const c = col(u); byCol[c] = byCol[c] || []; byCol[c].push(u); }
  for (const list of Object.values(byCol)) list.forEach((u, i) => { pos[u.id] = { x: col(u) + (i % 2 ? (u.side === 'party' ? 4 : -4) : 0), y: 18 + i * 68 }; });
  const cur = bt.turn > 0 ? bt.order[(bt.turn - 1) % bt.order.length] : null;
  const targets = bt.phase === 'target' ? new Set(moveTargets(bt.units.you, bt.pick).map(t => t.id)) : new Set();
  const field = units.map(u => {
    const p = pos[u.id], fl = u.fx.flash && Date.now() - u.fx.flash.at < 1200 ? u.fx.flash : null;
    u.fx.flash = null;
    return `<button class="bunit ${u.side}${u.down ? ' down' : ''}${u.id === cur && !bt.ended ? ' turn' : ''}${targets.has(u.id) ? ' can' : ''}${u.warded ? ' warded' : ''}${fl ? ' ' + fl.kind : ''}" style="left:${p.x}%;bottom:${p.y}px" data-unit="${u.id}" aria-label="${esc(u.name)}, ${u.hp} of ${u.max} hit points">
      <span class="bpic">${unitPic(u)}</span><span class="bhp"><i style="width:${Math.round(u.hp / u.max * 100)}%"></i></span><span class="bname">${esc(u.short || u.name)}</span>
      ${fl ? `<span class="bfloat">${esc(fl.text)}</span>` : ''}${u.fx.guardBy ? '<span class="btag">🛡️</span>' : ''}${u.fx.mark ? '' : ''}</button>`;
  }).join('');
  const you = bt.units.you;
  let panel;
  if (bt.ended) {
    panel = `<div class="say">${bt.phase === 'won' ? 'Victory!' : 'Your party is knocked out. Friends carry everyone home, sore but fine.'}</div>
      ${bt.rewards.length ? `<div class="row">${bt.rewards.map(r => `<span class="chip plain gold">${esc(r)}</span>`).join('')}</div>` : ''}
      <button class="btn big" data-bt="leave">${bt.phase === 'won' ? 'Done' : 'Head home'}</button>`;
  } else if (bt.phase === 'choose') {
    panel = `<div class="say you">Your turn. You have ${you.hp} of ${you.max} hit points.</div>
      <div class="bmoves">${you.moves.map(id => { const m = moveDef(id), left = usesLeft(you, id), ok = left > 0 && (moveTargets(you, id) === null || moveTargets(you, id).length);
        return `<button class="bmove" data-bt="move" data-id="${id}" ${ok ? '' : 'disabled'}><b>${esc(m.n)}</b><small>${left === Infinity ? esc(m.desc) : `${left} left · ${esc(m.desc)}`}</small></button>`; }).join('')}</div>`;
  } else if (bt.phase === 'target') {
    panel = `<div class="say you">${esc(moveDef(bt.pick).n)}: tap ${MOVE_TARGET[bt.pick] === 'foe' || MOVE_TARGET[bt.pick] === 'warded' ? 'a foe' : 'a friend'} on the field.</div>
      <div class="row">${moveTargets(you, bt.pick).map(t => `<button class="btn small ghost" data-bt="target" data-id="${t.id}">${esc(t.name)} · ${t.hp}/${t.max}</button>`).join('')}<button class="btn small ghost" data-bt="back">Back</button></div>`;
  } else {
    const u = bt.units[cur];
    panel = `<div class="say narration">${u ? `${esc(u.name)} is acting…` : 'Rolling to see who goes first…'}</div>`;
  }
  const body = `<div class="blog">${bt.log.slice(0, 3).reverse().map((l, i, a) => `<p${i < a.length - 1 ? ' class="old"' : ''}>${esc(l)}</p>`).join('')}</div>${panel}`;
  const title = `${bt.fight.n} · Round ${bt.round}`;
  const wrap = $('#scene-root .scene-wrap');
  if (!fresh && wrap && wrap.dataset.stage === bt.stage.key) {
    $('#bfield').innerHTML = field;
    wrap.querySelector('.scene-body').innerHTML = `<div class="scene-title">${esc(title)}</div>${body}`;
  } else {
    $('#scene-root').innerHTML = `<div class="scene-wrap" data-stage="${bt.stage.key}"><div class="scene staged battle" role="dialog" aria-modal="true" aria-label="${esc(bt.fight.n)}">
      ${stageHTML(bt.stage.place).replace('<div class="st-cast"></div>', `<div class="bfield" id="bfield">${field}</div>`)}
      <div class="scene-body"><div class="scene-title">${esc(title)}</div>${body}</div></div></div>`;
  }
}
document.addEventListener('click', e => {
  if (!bt) return;
  const b = e.target.closest('[data-bt]');
  const unit = e.target.closest('[data-unit]');
  if (b) {
    const k = b.dataset.bt;
    if (k === 'move') battleChoose(b.dataset.id);
    else if (k === 'target') battleTarget(b.dataset.id);
    else if (k === 'back') battleBack();
    else if (k === 'leave') leaveBattle();
  } else if (unit && bt.phase === 'target') battleTarget(unit.dataset.unit);
});

function battleBack() { recordMove('bt', { k: 'back' }); if (!bt) return; bt.phase = 'choose'; bt.pick = null; drawBattle(); }
function battleAct(k, id) { if (k === 'move') battleChoose(id); else if (k === 'target') battleTarget(id); else if (k === 'back') battleBack(); else if (k === 'leave') leaveBattle(); }

/* The training yard at the inn: fights to learn your class. */
function trainingYard() {
  const list = FIGHTS();
  if (!list.length) return '';
  if (!myClass()) return `<div class="label">Training yard</div><div class="card"><p class="sub">Tess keeps a yard out back for anyone who wants to learn to fight. First, pick how you fight.</p>
    <div class="row"><button class="btn small" data-act="class-pick">Choose a class</button></div></div>`;
  return `<div class="label">Training yard</div>${list.map(f => {
    const wins = (state.combat.wins || {})[f.id] || 0, open = fightUnlocked(f);
    return `<div class="card adv${f.boss ? ' boss' : ''}"><div><b>${f.boss ? '☠️ ' : ''}${esc(f.n)}</b><p class="sub">${f.foes.map(x => FOES()[x].i).join(' ')} · ${open ? (wins ? `won ${wins}×` : 'not yet beaten') : `${esc(myClass().n)} level ${f.lvl}`}</p></div>
      <button class="btn small" data-act="fight" data-id="${f.id}" ${open ? '' : 'disabled'}>${open ? 'Fight' : 'Locked'}</button>
      <p class="sub" style="grid-column:1/-1">${esc(f.blurb)}</p></div>`;
  }).join('')}`;
}
