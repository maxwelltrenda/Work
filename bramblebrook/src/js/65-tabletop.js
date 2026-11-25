/* ---------- the tabletop layer: character, dice, companions, Inspiration, charms, bestiary, delves, the inn ---------- */

/* Rarity, in the familiar five colours. */
const RARITIES = ['common', 'uncommon', 'rare', 'very rare', 'legendary'];
function rarity(id) {
  const it = I.items[id];
  if (!it || it.t === 'key') return '';
  if (it.rar) return it.rar;
  if (I.legendary.has(id)) return 'legendary';
  const r = C.core.rarity_tiers;   // sell-price thresholds; C.core.rarity is the fishing table
  return it.s < r.common ? 'common' : it.s < r.uncommon ? 'uncommon' : it.s < r.rare ? 'rare' : it.s < r['very rare'] ? 'very rare' : 'legendary';
}
const rarClass = id => { const r = rarity(id); return r && r !== 'common' ? ' r-' + r.replace(' ', '') : ''; };

/* Charms: up to three worn at once; their effects add up. */
const isCharm = id => I.items[id] && I.items[id].t === 'charm';
function charmFx(key) {
  let v = 0;
  for (const id of state.charms || []) { if (have(id) > 0 && I.items[id] && I.items[id].fx) v += I.items[id].fx[key] || 0; }
  return v;
}
function wearCharm(id) {
  if (!isCharm(id) || !have(id) || state.charms.includes(id)) return false;
  if (state.charms.length >= C.core.charmSlots) { toast(`You can wear ${C.core.charmSlots} charms. Take one off first.`); return false; }
  state.charms.push(id);
  toast(`Wearing ${itemName(id)}: ${I.items[id].desc}`);
  return true;
}
function removeCharm(id) { const i = state.charms.indexOf(id); if (i < 0) return false; state.charms.splice(i, 1); return true; }

/* Background: a +2 on one skill's checks and a little extra experience there. */
const background = () => (C.core.backgrounds || []).find(b => b.id === state.bg) || null;
const bgSkill = () => (background() || {}).skill || '';

/* Inspiration: earned by good deeds and natural 20s, spent to reroll a check. */
const inspMax = () => C.core.dice.inspirationMax + charmFx('insp') + Math.floor(villageFx('insp'));
function gainInsp(n = 1, why = '') {
  const before = state.insp || 0;
  state.insp = Math.min(inspMax(), before + n);
  if (state.insp > before) { toast(`✦ Inspiration${why ? ': ' + why : ''}`, 'lvl'); play('sparkle', 0.1); }
}

/* Skill checks: d20 + bonus against a DC. */
function checkFor(roll) {
  const sk = roll.skill;
  const dc = clamp(Math.round(21 - 20 * (roll.base || 0.5)), 2, 22);
  const comp = advRun && advRun.companion;
  const mod = Math.floor(lvl(sk) / C.core.dice.levelsPerBonus) + (bgSkill() === sk ? C.core.background_bonus.check : 0)
    + charmFx('check:' + sk) + charmFx('check:all') + (comp ? charmFx('check:companion') : 0);
  const compInfo = comp && C.companions && C.companions.companions[comp];
  const advFrom = compInfo && (compInfo.skills || []).includes(sk) ? vilShort(comp) : buffOn('lucky') ? 'Lucky' : '';
  return { sk, dc, mod, adv: advFrom };
}
function chanceOf(ch) {
  let p = 0;
  for (let n = 1; n <= 20; n++) if (n === 20 || (n !== 1 && n + ch.mod >= ch.dc)) p += 1 / 20;
  return ch.adv ? 1 - Math.pow(1 - p, 2) : p;
}
const d20 = () => 1 + Math.floor(rand() * 20);
function rollCheck(ch) {
  let rolls = [d20()];
  if (ch.adv) rolls.push(d20());
  let kept = Math.max(...rolls), note = '';
  if (kept === 1 && charmFx('lucky1')) { const again = d20(); note = `Worry Stone: rolled a 1, rolled again (${again})`; rolls = [again]; kept = again; }
  const nat = kept;
  const ok = nat === 20 || (nat !== 1 && nat + ch.mod >= ch.dc);
  return { rolls, kept, nat, total: nat + ch.mod, ok, crit: nat === 20, fumble: nat === 1, note };
}
const D20_SVG = '<svg viewBox="0 0 100 100" aria-hidden="true"><polygon class="d20-o" points="50,4 91,27 91,73 50,96 9,73 9,27"/><polygon class="d20-i" points="50,24 75,66 25,66"/><path class="d20-l" d="M50 4L50 24M91 27L75 66M91 27L50 24M9 27L50 24M9 27L25 66M91 73L75 66M50 96L75 66M50 96L25 66M9 73L25 66"/></svg>';
function companionLine(kind) {
  const c = advRun && advRun.companion && C.companions && C.companions.companions[advRun.companion];
  return c && c[kind] && c[kind].length ? { who: advRun.companion, text: pickLine(c[kind]) } : null;
}
/* Shows the roll, then continues to the success or failure node. */
let diceCtx = null;   // the roll on screen, waiting for Continue or a reroll
function showDice(choice, ch, onDone, rerolled) {
  const res = rollCheck(ch);
  diceCtx = { choice, ch, onDone, res, rerolled: !!rerolled };
  if (res.crit) {
    const coins = Math.round(C.core.dice.critCoins * (1 + state.story.ci * 0.5));
    state.coins += coins; state.stats.crits = (state.stats.crits || 0) + 1;
    if (advRun) advRun.rewards.push(`+${coins} coins (critical)`);
    gainInsp(1, 'a natural 20');
  } else if (res.fumble) state.stats.fumbles = (state.stats.fumbles || 0) + 1;
  const body = `<div class="dice-wrap">
      <p class="dice-label">${esc(skillName(ch.sk))} roll · you need ${ch.dc} or more · your bonus ${ch.mod >= 0 ? '+' : ''}${ch.mod}${ch.adv ? ` · ${ch.adv === 'Lucky' ? 'feeling lucky' : esc(ch.adv) + ' helps'}: best of two dice` : ''}</p>
      <div class="dice-row">${res.rolls.map((r, i) => `<div class="d20 spin" data-i="${i}">${D20_SVG}<span class="d20-n">?</span></div>`).join('')}</div>
      <p class="dice-result" id="dice-result" aria-live="polite">&nbsp;</p>
      <div class="dice-btns" id="dice-btns"></div></div>`;
  stopTyping();
  if (renderScene({ title: advRun.isEnc ? 'Something happens…' : advRun.def.n, stage: advRun.stage }, `<div class="say you">${esc(fill(choice.t))}</div>${body}`)) mountStage(advRun.stage, advRun.companion ? [advRun.companion] : []);
  stageLine('you', null);
  play('dice');
  const dice = $$('#scene-root .d20');
  const settle = () => {
    dice.forEach((d, i) => {
      d.classList.remove('spin');
      d.querySelector('.d20-n').textContent = res.rolls[i];
      if (res.rolls.length > 1 && res.rolls[i] !== res.kept) d.classList.add('dropped');
      if (res.rolls[i] === res.kept && res.crit) d.classList.add('crit');
      if (res.rolls[i] === res.kept && res.fumble) d.classList.add('fumble');
    });
    let line;
    if (res.crit) {
      line = `A 20, the best roll there is! ${pickLine((C.companions.crit || {})[ch.sk]) || 'A perfect roll.'}`;
      play('crit'); bloom();
    } else if (res.fumble) {
      line = `A 1, the lowest roll. It always goes a little wrong. ${pickLine((C.companions.fumble || {})[ch.sk]) || 'Well, that happened.'}`;
      play('fumble');
    } else {
      line = `You rolled ${res.kept}${ch.mod ? `, ${ch.mod > 0 ? 'plus' : 'minus'} your bonus of ${Math.abs(ch.mod)}, makes ${res.total}` : ''}. You needed ${ch.dc}. ${res.ok ? 'Success!' : 'Not quite.'}`;
      play(res.ok ? 'chime' : 'miss');
    }
    const cl = companionLine(res.ok ? 'cheer' : 'oops');
    $('#dice-result').innerHTML = `${res.note ? `<small class="muted">${esc(res.note)}</small><br>` : ''}<b class="${res.ok ? 'ok' : 'bad'}">${esc(fill(line))}</b>${cl ? `<span class="dice-quip">${folk(cl.who, 28)}<i>“${esc(fill(cl.text))}”</i></span>` : ''}`;
    const canReroll = !res.ok && (state.insp || 0) > 0 && !rerolled;
    $('#dice-btns').innerHTML = `${canReroll ? `<button class="btn ghost" data-dice="reroll">Spend ✦ Inspiration to reroll (${state.insp})</button>` : ''}<button class="btn" data-dice="go">Continue</button>`;
    $('#dice-btns [data-dice="go"]').addEventListener('click', diceGo);
    const rr = $('#dice-btns [data-dice="reroll"]');
    if (rr) rr.addEventListener('click', () => { play('sparkle'); diceReroll(); });
    $('#dice-btns .btn:last-child').focus({ preventScroll: true });
    saveLocal();
    setTimeout(() => $('#dice-btns') && maybeTourNow(!res.ok && (state.insp || 0) > 0 && !rerolled && state.toursSeen && state.toursSeen['dice-roll'] ? 'dice-reroll' : 'dice-roll'), 200);
  };
  if (reducedMotion()) { settle(); return; }
  let t = 0;
  const flick = setInterval(() => {
    dice.forEach(d => { d.querySelector('.d20-n').textContent = 1 + Math.floor(Math.random() * 20); });   // show only: not a roll
    if (++t >= 12) { clearInterval(flick); settle(); }
  }, 55);
}

/* Companions: friends at enough hearts can join an adventure. */
function eligibleCompanions() {
  const comps = (C.companions && C.companions.companions) || {};
  return I.vils.filter(v => comps[v.id] && vilAvailable(v) && hearts(v.id) >= C.core.companionHearts);
}
function startQuest(def) {
  const list = eligibleCompanions();
  if (!list.length) { playAdventure(def, false); return; }
  const comps = C.companions.companions;
  openSheet(`<div class="sheet-head"><span class="emo" style="--s:40px">🎒</span><div><h2>${esc(def.n)}</h2><p class="muted">Who's coming along?</p></div></div>
    <p class="sub">A friend makes some rolls easier. When a roll matches what they're good at, you roll two dice and keep the better one.</p>
    <div class="party">${list.map(v => `<button class="party-pick" data-act="quest-go" data-id="${def.id}" data-c="${v.id}">${folk(v.id, 44)}<span><b>${esc(v.short || v.n)}</b><small>Helps with ${comps[v.id].skills.map(skillName).join(' & ')} rolls</small></span></button>`).join('')}
      <button class="party-pick alone" data-act="quest-go" data-id="${def.id}" data-c=""><span class="emo" style="--s:44px">🚶</span><span><b>Go alone</b><small>Just you and your wits</small></span></button></div>
    <div class="sheet-btns"><button class="btn small ghost" data-act="sheet-close">Not now</button></div>`);
}
const findQuest = id => I.adv[id] || (C.delves || {}).byId[id];

/* Bestiary */
function befriend(id) {
  if (!id || (state.bestiary || {})[id]) return '';
  state.bestiary[id] = now();
  const c = (C.bestiary.byId || {})[id];
  toast(`Befriended: ${c ? c.n : id}. Added to your bestiary.`, 'lvl', 4500);
  return c ? `Befriended ${c.n}` : '';
}

/* Delves: the first time you reach a delve floor, it opens. */
function delveAt(floor) { return ((C.delves || {}).list || []).find(d => d.floor === floor) || null; }
function maybeDelve(floor) {
  const d = delveAt(floor);
  if (d && !state.delvesDone[d.id]) setTimeout(() => { toast(`A passage opens on floor ${floor}: ${d.n}`, 'lvl', 4500); startQuest(d); }, 400);
}
const openDelves = () => ((C.delves || {}).list || []).filter(d => d.floor <= state.mine.deepest && !state.delvesDone[d.id]);

/* Character creation: name, background, look and class. Runs once; older saves get the steps after the name. */
const FACES = () => Object.keys(I.art).filter(k => k.startsWith('face:')).map(k => k.slice(5));
function createCharacter(isNew) {
  const step2 = () => {
    $('#scene-root').innerHTML = sceneShell({ title: isNew ? 'Before the valley' : 'Your character sheet' }, `
      <div class="say">${isNew ? 'Who were you, before the letter came?' : 'Every adventurer needs a character sheet. Who were you, before the valley?'}</div>
      <p class="sub">Your background makes one kind of dice roll easier (+2 to it) and gives you a starting kit. There's no wrong choice.</p>
      <div class="bg-grid">${C.core.backgrounds.map(b => `<button class="bg-card" data-bg="${b.id}"><b>${esc(b.n)}</b><small class="bg-skill">+2 to ${esc(skillName(b.skill))} rolls</small><span>${esc(b.blurb)}</span><small class="muted">Starts with ${esc(giveSummary(b.kit))}</small></button>`).join('')}</div>`);
    $$('[data-bg]').forEach(btn => btn.addEventListener('click', () => { charPick('bg', btn.dataset.bg, isNew); play('pick'); step3(); }));
  };
  const step3 = () => {
    const faces = FACES();
    $('#scene-root').innerHTML = sceneShell({ title: 'Your look' }, `
      <div class="say">And how do folks in Bramblebrook see you?</div>
      <div class="face-grid">${faces.map(f => `<button class="face" data-face="${f}" aria-label="Portrait option">${artCell('face:' + f, 48)}</button>`).join('')}</div>`);
    $$('[data-face]').forEach(btn => btn.addEventListener('click', () => { play('pick'); if (!charPick('face', btn.dataset.face, isNew)) step4(); }));
  };
  // D&D-style class: how you fight in battles later on
  const step4 = () => {
    $('#scene-root').innerHTML = sceneShell({ title: 'How you fight' }, `
      <div class="say">One more thing. When trouble finds you, how do you deal with it?</div>
      <p class="sub">Your class is how you fight in battles: your hit points, your armour and your special moves. You can change it any time on your character sheet.</p>
      <div class="bg-grid">${C.classes.classes.map(c => { const b = statBlock(c.id, 1);
        return `<button class="bg-card" data-cls="${c.id}"><b>${c.icon} ${esc(c.n)}</b><small class="bg-skill">${c.role === 'front' ? 'Front row' : 'Back row'} · ${b.hp} hit points · armour ${b.ac}</small><span>${esc(c.blurb)}</span><small class="muted">Moves: ${c.moves.map(m => esc(C.classes.moves[m].n)).join(', ')}</small></button>`; }).join('')}</div>`);
    $$('[data-cls]').forEach(btn => btn.addEventListener('click', () => charPick('cls', btn.dataset.cls, isNew)));
  };
  step2();
}
// One pick on the character sheet. Returns true when that was the last pick and the character is done.
function charPick(k, v, isNew) {
  recordMove('char', { k, v, isNew: !!isNew });
  if (k === 'bg') { if (C.core.backgrounds.some(b => b.id === v)) state.bg = v; return false; }
  if (k === 'face') { state.face = String(v || '').slice(0, 40); if (C.classes.classes.length && !state.combat.cls) return false; }
  if (k === 'cls') { if (!C.classes.classes.some(c => c.id === v)) return false; state.combat.cls = v; }
  if (state.charDone) return true;   // already finished once: a second pick never pays the kit again
  state.charDone = true;
  const bgd = background();
  if (bgd) applyGive(bgd.kit);
  play('chime');
  $('#scene-root').innerHTML = '';
  const c = myClass();
  toast(`${state.name}${bgd ? ', ' + bgd.n : ''}${c ? ` and ${c.n}` : ''}. Welcome to Bramblebrook.`, 'lvl');
  commit();
  if (isNew) beginChapter();
  return true;
}
function diceGo() {
  recordMove('dice-go');
  const d = diceCtx;
  if (!d) return;
  diceCtx = null;
  d.onDone(d.res.ok);
}
function diceReroll() {
  recordMove('dice-reroll');
  const d = diceCtx;
  if (!d || d.res.ok || d.rerolled || !((state.insp || 0) > 0)) return;
  state.insp--;
  showDice(d.choice, d.ch, d.onDone, true);
}
const playerPic = (size = 48) => `<span class="mono" style="--h:160">${state.face ? artCell('face:' + state.face, size) : esc((state.name || '?')[0])}</span>`;
const charLevel = () => Math.max(1, Math.floor(totalLevels() / I.skills.length));
