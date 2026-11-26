/* ---------- battle gear (Jarldoms' wargear, brought to the valley) ----------
   Six slots: weapon, off-hand, head, body, feet, cloak (core.json gear). Every piece comes from village bosses:
   each of the ten tiers has its own set of four, a Strike weapon, a Cast weapon and two pieces of armour, and the
   higher the tier the rarer the drop (raid_tiers on the server). Gear makes boss hits harder, up to the same
   500 cap as everything else: a weapon on its own bar (Strike for swords and axes, Cast for staffs and books)
   and half on the other, armour on both. Three pieces of one tier's set worn together add a set bonus.
   Enchant a piece at the Forge with Battle Runes, which every boss win gives you: each level +10% of the piece.
   It also helps in training-yard fights (to hit, damage, spell power, armour). The server works out the boss
   damage from the same farm (raid_gear_bonus in supabase/boss_ladder.sql), so the numbers here are for show. */
const GEARC = () => C.core.gear;
const GEAR_SLOTS = () => GEARC().slots.map(s => s[0]);
const isGear = id => !!I.items[id] && I.items[id].t === 'gear';
const gearLv = id => Math.max(0, Math.min(GEARC().enchant.costs.length, ((state.gearLv || {})[id] | 0)));
const gearSlotName = slot => (GEARC().slots.find(s => s[0] === slot) || [slot, slot])[1];
const gearWorn = () => GEAR_SLOTS().map(s => (state.gear || {})[s]).filter(id => isGear(id) && have(id) > 0);
const gearOf = slot => { const id = (state.gear || {})[slot]; return isGear(id) && have(id) > 0 ? id : ''; };
// the tiers whose set is worn (setSize pieces or more)
function gearSets() {
  const n = {};
  for (const id of gearWorn()) n[I.items[id].tier] = (n[I.items[id].tier] || 0) + 1;
  return Object.keys(n).filter(t => n[t] >= GEARC().setSize).map(Number);
}
const gearPieceRaid = (id, kind) => { const it = I.items[id]; return it.raid * (it.bar === 'both' || it.bar === kind ? 1 : 0.5) * (1 + gearLv(id) * GEARC().enchant.step / 100); };
// % more damage on a village boss with this attack ('might' = Strike, 'magic' = Cast)
function gearRaid(kind) { return Math.round(gearWorn().reduce((a, id) => a + gearPieceRaid(id, kind), 0) + gearSets().length * GEARC().setBonus); }
// what worn gear adds to a training-yard stat (hit, dmg, power, ac)
const gearFx = key => gearWorn().reduce((a, id) => a + ((I.items[id].fx || {})[key] || 0), 0);
const enchantCap = () => Math.min(GEARC().enchant.costs.length, 1 + Math.floor(lvl('crafting') / GEARC().enchant.perCrafting));
const enchantCost = id => GEARC().enchant.costs[gearLv(id)];

function gearOn(id) {
  if (!isGear(id) || !have(id)) return false;
  if (!state.gear) state.gear = {};
  const slot = I.items[id].slot;
  if (state.gear[slot] === id) return false;
  state.gear[slot] = id;
  toast(`Wearing ${itemName(id)} (${gearSlotName(slot).toLowerCase()})`);
  return true;
}
function gearOff(slot) {
  if (!state.gear || !state.gear[slot]) return false;
  state.gear[slot] = '';
  return true;
}
function enchantGear(id) {
  if (!isGear(id) || !have(id)) return false;
  const lv = gearLv(id), cost = enchantCost(id);
  if (lv >= enchantCap()) { toast(lv >= GEARC().enchant.costs.length ? `${itemName(id)} is enchanted as far as it goes.` : `Your Crafting level allows enchanting to level ${enchantCap()}. Level up Crafting to go further.`); return false; }
  if (have('boss_rune') < cost) { toast(`Enchanting needs ${cost} Battle Runes. You have ${have('boss_rune')}. Village bosses give them.`); return false; }
  takeItem('boss_rune', cost);
  if (!state.gearLv) state.gearLv = {};
  state.gearLv[id] = lv + 1;
  toast(`${itemName(id)} is now enchanted to level ${lv + 1}`, 'lvl');
  return true;
}

/* how a piece reads: what it does on a boss and in the training yard */
function gearLines(id) {
  const it = I.items[id], lv = gearLv(id);
  const on = it.bar === 'both' ? `+${Math.round(gearPieceRaid(id, 'might'))}% boss damage` : it.bar === 'might'
    ? `+${Math.round(gearPieceRaid(id, 'might'))}% Strike, +${Math.round(gearPieceRaid(id, 'magic'))}% Cast on bosses`
    : `+${Math.round(gearPieceRaid(id, 'magic'))}% Cast, +${Math.round(gearPieceRaid(id, 'might'))}% Strike on bosses`;
  const fx = Object.entries(it.fx || {}).map(([k, v]) => `+${v} ${{ hit: 'to hit', dmg: 'damage', power: 'spell power', ac: 'armour' }[k] || k}`).join(', ');
  return { on, fx, lv, slot: gearSlotName(it.slot) };
}

/* Bag > Sheet: the six slots, the set bonus and what it all adds up to */
function gearCard() {
  const owned = Object.keys(I.items).filter(id => isGear(id) && have(id) > 0);
  const slots = GEARC().slots.map(([slot, label]) => {
    const id = gearOf(slot);
    return id ? `<button class="gear-slot${rarClass(id)}" data-act="item" data-id="${id}">${pic(id, 32)}<span><small>${esc(label)}</small><b>${esc(itemName(id))}</b>${gearLv(id) ? `<i class="gear-lv">+${gearLv(id)}</i>` : ''}</span></button>`
      : `<button class="gear-slot empty" data-act="gear-pick" data-slot="${slot}"><span class="emo" style="--s:28px">＋</span><span><small>${esc(label)}</small><b>${owned.some(x => I.items[x].slot === slot) ? 'Choose' : 'Empty'}</b></span></button>`;
  }).join('');
  const sets = gearSets(), worn = gearWorn();
  const tiers = {};
  for (const id of worn) tiers[I.items[id].tier] = (tiers[I.items[id].tier] || 0) + 1;
  const setLine = Object.entries(tiers).sort((a, b) => b[1] - a[1]).map(([t, n]) => `${esc(C.core.raidTiers[t - 1].n)} ${n}/${GEARC().setSize}${n >= GEARC().setSize ? ' ✓' : ''}`).join(' · ');
  const m = gearRaid('might'), g = gearRaid('magic');
  return `<div class="card"><div class="row between"><h2>Battle gear</h2><span class="chip plain">${worn.length}/6 worn</span></div>
    <p class="sub">${worn.length ? `On village bosses: ⚔️ Strike +${m}% · ✨ Cast +${g}%${sets.length ? ` (with a +${GEARC().setBonus * sets.length}% set bonus)` : ''}.` : 'Village bosses drop battle gear. Each tier has its own set; wear three pieces of one set for a bonus.'}${setLine ? ` Sets: ${setLine}.` : ''}</p>
    <div class="gear-grid">${slots}</div>
    ${have('boss_rune') || owned.length ? `<p class="sub">🔷 ${fmtN(have('boss_rune'))} Battle Runes for enchanting (tap a piece). Enchanting goes up to level ${enchantCap()} at your Crafting level.</p>` : ''}</div>`;
}
function gearSheet(slot) {
  const owned = Object.keys(I.items).filter(id => isGear(id) && have(id) > 0 && I.items[id].slot === slot);
  openSheet(`<h2>${esc(gearSlotName(slot))}</h2>${owned.length ? owned.sort((a, b) => I.items[b].tier - I.items[a].tier).map(id => `<div class="store-item${rarClass(id)}">${pic(id, 32)}<div class="what"><b>${esc(itemName(id))}${gearLv(id) ? ` +${gearLv(id)}` : ''}</b><small>Tier ${I.items[id].tier} · ${esc(gearLines(id).on)}</small></div>
      ${gearOf(slot) === id ? '<span class="chip plain">Worn</span>' : `<button class="btn small" data-act="gear-on" data-id="${id}">Wear</button>`}</div>`).join('')
    : `<p class="sub">Nothing for this slot yet. Every village boss tier drops its own set of gear.</p>`}
    <div class="sheet-btns"><button class="btn small ghost" data-act="sheet-close">Close</button></div>`);
}
