/* ---------- views: character sheet, the inn, bestiary ---------- */
function viewSheet() {
  const bg = background();
  const insp = state.insp || 0, max = inspMax();
  const checks = I.skills.filter(s => skillOn(s.id)).map(s => {
    const mod = Math.floor(lvl(s.id) / C.core.dice.levelsPerBonus) + (bgSkill() === s.id ? C.core.background_bonus.check : 0) + charmFx('check:' + s.id) + charmFx('check:all');
    return `<div class="check-row"><span>${esc(s.n)}</span><span class="muted num">Lv ${lvl(s.id)}</span><b class="num">${mod >= 0 ? '+' : ''}${mod}</b></div>`;
  }).join('');
  const slots = Array.from({ length: C.core.charmSlots }, (_, i) => {
    const id = state.charms[i];
    if (!id || !have(id)) return `<button class="charm empty" data-act="charm-pick"><span class="emo" style="--s:32px">＋</span><span><b>Empty charm slot</b><small>Wear a charm you've found</small></span></button>`;
    return `<div class="charm${rarClass(id)}">${pic(id, 32)}<span><b>${esc(itemName(id))}</b><small>${esc(I.items[id].desc)}</small></span><button class="btn small ghost" data-act="charm-off" data-id="${id}">Remove</button></div>`;
  }).join('');
  const comps = eligibleCompanions();
  const cdata = (C.companions && C.companions.companions) || {};
  return `<div class="card sheet-hero">${playerPic(80)}<div><h2>${esc(state.name || 'You')}</h2><p class="sub">Level ${charLevel()} ${esc(bg ? bg.n : 'Adventurer')}</p>
      <p class="insp" aria-label="${insp} of ${max} Inspiration">${'✦'.repeat(insp)}${'✧'.repeat(Math.max(0, max - insp))} <span class="muted">Inspiration</span></p></div></div>
    ${classCard()}
    <div class="card"><h2>Roll bonuses</h2><p class="sub">When a choice needs a dice roll, this number is added to what you roll. Bigger is better. You get +1 for every ${C.core.dice.levelsPerBonus} skill levels${bg ? `, +${C.core.background_bonus.check} on ${esc(skillName(bg.skill))} for being a ${esc(bg.n)}` : ''}, plus anything from charms.</p>${checks}</div>
    <div class="card"><div class="row between"><h2>Charms</h2><span class="chip plain">${state.charms.filter(id => have(id)).length}/${C.core.charmSlots} worn</span></div>${slots}</div>
    <div class="card"><h2>Who'll come along</h2>${comps.length ? comps.map(v => `<div class="store-item">${folk(v.id, 36)}<div class="what"><b>${esc(v.short || v.n)}</b><small>Helps with ${cdata[v.id].skills.map(skillName).join(' & ')} rolls</small></div></div>`).join('')
      : `<p class="sub">Reach ${C.core.companionHearts} hearts with someone and they'll join your adventures.</p>`}</div>
    <div class="card"><h2>Inspiration</h2><p class="sub">Inspiration (✦) is a second chance. If a roll fails, spend one to roll again. You earn it from rolling a 20, friendship scenes, finishing chapters and helping folks.</p>
      <div class="stats"><div class="stat"><b>${fmtN(state.stats.crits || 0)}</b><span>perfect 20s rolled</span></div><div class="stat"><b>${fmtN(state.stats.fumbles || 0)}</b><span>1s rolled</span></div>
      <div class="stat"><b>${Object.keys(state.bestiary || {}).length}</b><span>creatures befriended</span></div><div class="stat"><b>${Object.keys(state.delvesDone || {}).length}</b><span>delves finished</span></div></div></div>`;
}
function charmSheet() {
  const owned = Object.keys(I.items).filter(id => isCharm(id) && have(id) && !state.charms.includes(id));
  openSheet(`<h2>Wear a charm</h2>${owned.length ? owned.map(id => `<div class="store-item${rarClass(id)}">${pic(id, 32)}<div class="what"><b>${esc(itemName(id))}</b><small>${esc(rarity(id))} · ${esc(I.items[id].desc)}</small></div>
      <button class="btn small" data-act="charm-on" data-id="${id}">Wear</button></div>`).join('') : '<p class="sub">No spare charms yet. They turn up on adventures, in delves, from new creature friends, and now and then on Saffi\'s cart.</p>'}
    <div class="sheet-btns"><button class="btn small ghost" data-act="sheet-close">Close</button></div>`);
}

function questDifficulty(def) {
  let hardest = 0;
  for (const n of Object.values(def.nodes || {})) for (const c of n.ch || []) if (c.roll) hardest = Math.max(hardest, Math.round(21 - 20 * c.roll.base));
  return hardest ? hardest <= 9 ? 1 : hardest <= 13 ? 2 : 3 : 1;
}
function viewInn() {
  const inn = (C.companions && C.companions.inn) || { n: 'The Lantern & Ladle', keeper: 'Tess Marlow', greet: [], rumors: [] };
  const rnd = seeded('rumor-' + dayKey());
  const rumor = inn.rumors && inn.rumors.length ? inn.rumors[Math.floor(rnd() * inn.rumors.length)] : '';
  const open = I.advs.filter(a => !state.advDone[a.id] && reqMet(a.req));
  markInnSeen();   // the red count is for quests you haven't seen yet, not every quest on the board
  const delves = openDelves();
  const done = I.advs.filter(a => state.advDone[a.id]);
  const later = I.advs.length - open.length - done.length;
  const pips = n => '◆'.repeat(n) + '◇'.repeat(3 - n);
  const card = (a, isDone, isDelve) => `<div class="card adv${isDone ? ' done' : ''}"><div><b>${esc(a.n)}</b><p class="sub">${isDelve ? `Mine, floor ${a.floor}` : esc(placeName(a.where))} · <span class="diff" title="Difficulty">${pips(questDifficulty(a))}</span></p></div>
    ${isDone ? '<span class="chip plain">Done</span>' : `<button class="btn small" data-act="quest" data-id="${a.id}">Set out</button>`}
    <p class="sub" style="grid-column:1/-1">${esc(fill(a.blurb))}</p></div>`;
  return `<div class="card inn"><div class="row" style="gap:12px;flex-wrap:nowrap">${folk('tess', 48)}<div><h2>${esc(inn.n)}</h2><p class="sub">${esc(inn.keeper)}, ${esc(inn.role || 'innkeeper')}</p></div></div>
      <p class="quote">"${esc(fill(pickLine(inn.greet) || 'Pull up a stool. The soup is hot and the board is full.'))}"</p>
      ${rumor ? `<p class="sub"><b>Rumor of the day:</b> ${esc(fill(rumor))}</p>` : ''}</div>
    <div class="label">Quest board</div>
    ${open.length || delves.length ? open.map(a => card(a, false)).join('') + delves.map(d => card(d, false, true)).join('') : '<div class="card"><p class="muted">The board is bare today. Keep following the story and making friends.</p></div>'}
    ${later > 0 ? `<p class="sub">${plural(later, 'more quest')} will be pinned up as the valley wakes.</p>` : ''}
    ${trainingYard()}
    ${done.length ? `<div class="label">Finished</div>${done.map(a => card(a, true)).join('')}` : ''}`;
}

function viewBestiary() {
  const list = (C.bestiary && C.bestiary.creatures) || [];
  if (!list.length) return '<div class="card"><p class="muted">No creatures recorded yet.</p></div>';
  const known = list.filter(c => state.bestiary[c.id]).length;
  return `<div class="card"><div class="row between"><h2>Creatures of the valley</h2><span class="chip plain">${known}/${list.length}</span></div>
    <p class="sub">Gentle creatures turn up while you explore and dig. Win them over and they're recorded here.</p></div>
    ${list.map(c => state.bestiary[c.id]
      ? `<div class="card beast"><span class="emo" style="--s:44px">${c.i}</span><div><b>${esc(c.n)}</b><p class="sub">${esc(c.where.map(placeName).join(', '))}</p><p>${esc(fill(c.lore || c.blurb))}</p></div></div>`
      : `<div class="card beast unknown-beast"><span class="unknown" style="width:44px;height:44px;font-size:20px">?</span><div><b>Not yet met</b><p class="sub">Somewhere in ${esc(c.where.map(placeName).join(' or '))}</p><p class="muted">${esc(c.blurb)}</p></div></div>`).join('')}`;
}
