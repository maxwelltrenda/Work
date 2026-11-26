/* ---------- the Lantern Stair: the climb that never quite ends ----------
   A stone stair up Bramble Hill with a lantern on every landing. Lighting the next one costs coins (each far
   more than the last) and needs enough mastery stars: any stars count, from any crop, fish or ore, so every
   player's own way of playing gets them there (Farm RPG's players hated being told which item to grind).
   Every lantern makes everything you sell worth 4% more, and that compounds; every fifth also gives one of a
   few bigger gifts in turn. All the numbers are in core.json "stair". */
const stairK = () => C.core.stair;
const stairCost = n => Math.round(stairK().cost * Math.pow(stairK().grow, n - 1));
const stairStarsNeed = n => stairK().stars * n;
const starsHave = () => Object.values(state.mastery || {}).reduce((a, t) => a + (+t || 0), 0);
const stairSell = () => (C.core.stair ? Math.pow(1 + stairK().sell / 100, state.stair || 0) : 1);
// the milestone lantern n gives (every fifth), or null
function stairMilestone(n) {
  const k = stairK();
  if (!k || n % k.every) return null;
  return k.milestones[(n / k.every - 1) % k.milestones.length];
}
// the total of one kind of milestone gift so far: 'grow', 'stamina' or 'barn'
function stairBonus(kind) {
  if (!C.core.stair || !state.stair) return 0;
  let v = 0;
  for (let n = stairK().every; n <= state.stair; n += stairK().every) { const m = stairMilestone(n); if (m && m[kind]) v += m[kind]; }
  return v;
}
const stairOpen = () => !!C.core.stair && ((state.stair || 0) > 0 || farmValue() >= stairK().unlockValue);
// fixed coin rewards (chores, daily gifts) grow with what the farm is worth, so they never turn into crumbs
function rewardScale() { const r = C.core.rewardScale; return r ? Math.max(1, Math.pow(farmValue() / r.from, r.k)) : 1; }

function lightLantern() {
  const n = (state.stair || 0) + 1;
  if (!stairOpen() || n > stairK().max) return false;
  if (starsHave() < stairStarsNeed(n)) { toast(`Lantern ${n} needs ${stairStarsNeed(n)} mastery stars. You have ${starsHave()}.`); return false; }
  const c = stairCost(n);
  if (state.coins < c) { toast(`Lantern ${n} costs ${fmtN(c)} coins.`); return false; }
  state.coins -= c; state.stair = n;
  const m = stairMilestone(n);
  toast(`Lantern ${n} is lit. Everything sells for ${stairK().sell}% more${m ? ` · ${m.text}` : ''}`, 'lvl', 4500);
  return true;
}

function viewStair() {
  const k = stairK(), lit = state.stair || 0, n = lit + 1, done = lit >= k.max;
  const sell = Math.round((stairSell() - 1) * 100);
  const gifts = [['grow', 'Crops grow ', '% faster'], ['stamina', '+', ' max stamina'], ['barn', 'Barn holds ', '% more']]
    .filter(([g]) => stairBonus(g)).map(([g, a, b]) => `<li>${a}${stairBonus(g)}${b}</li>`).join('');
  const steps = Array.from({ length: Math.min(k.max, Math.max(10, n + 4)) }, (_, i) => i + 1).slice(-10).reverse()
    .map(i => `<div class="stair-step${i <= lit ? ' lit' : i === n ? ' next' : ''}"><span class="lantern">${i <= lit ? '🏮' : '🕯️'}</span><b>${i}</b><small>${stairMilestone(i) ? esc(stairMilestone(i).text) : `+${k.sell}% sale prices`}</small></div>`).join('');
  const need = stairStarsNeed(n), stars = starsHave(), cost = done ? 0 : stairCost(n);
  return `<div class="card"><h2>The Lantern Stair</h2>
      <p class="sub">A stone stair up Bramble Hill, with a lantern on every landing. Light the next one with coins and mastery stars (any crop, fish or ore you've mastered counts). Every lantern makes everything you sell worth more, for good.</p>
      <div class="row between"><span class="chip plain">🏮 ${lit} of ${k.max} lit</span><span class="chip plain">Everything sells for +${fmtN(sell)}%</span></div>
      ${gifts ? `<ul class="sub stair-gifts">${gifts}</ul>` : ''}</div>
    ${done ? '<div class="card"><h2>The top of the hill</h2><p class="sub">Every lantern on the stair is lit. The whole valley can see it from the fields.</p></div>' : `<div class="card stair-next">
      <div class="row between"><h2>Lantern ${n}</h2>${stairMilestone(n) ? `<span class="chip">${esc(stairMilestone(n).text)}</span>` : ''}</div>
      <p class="sub">Everything sells for ${k.sell}% more${stairMilestone(n) ? `, and ${esc(stairMilestone(n).text.toLowerCase())}` : ''}.</p>
      <div class="row between"><span class="sub">Mastery stars <b class="${stars >= need ? '' : 'short-txt'}">${fmtN(stars)} / ${fmtN(need)}</b></span><span class="sub">Cost <b>${fmtCoins(cost)}</b></span></div>
      <button class="btn wide ${stars >= need && state.coins >= cost ? 'sun' : ''}" data-act="stair-light" ${stars >= need && state.coins >= cost ? '' : 'disabled'}>Light lantern ${n}</button>
      ${stars < need ? '<p class="sub">Mastery stars come from selling, catching and digging up the same thing many times: Bag › Almanac shows how close each one is.</p>' : ''}</div>`}
    <div class="card"><div class="stair">${steps}</div></div>`;
}
