/* ---------- places: every explore area and fishing spot has a page of its own, and a rank ----------
   Tap a place in Explore (or a spot in Fishing) to go there: its page has its own look and mood for the season,
   what you've found there, and a rank earned by trips (explore) or catches (fishing) made there (core.json places).
   Each rank makes rare finds or rare fish a little likelier in that place and pays coins once. */
const placeRec = id => (state.places || {})[id] || { n: 0, got: {}, rank: 0 };
const placeIsArea = id => !!I.area[id];
const placeRank = id => placeRec(id).rank || 0;
const placeLuck = id => 1 + placeRank(id) * ((C.core.places && C.core.places.luck) || 0) / 100;
const placeSteps = id => (C.core.places ? C.core.places[placeIsArea(id) ? 'trips' : 'catches'] : []);
const placeStars = id => { const n = placeSteps(id).length, r = placeRank(id); return '★'.repeat(r) + '☆'.repeat(Math.max(0, n - r)); };
const placeCoins = rank => Math.round(C.core.places.coins[rank - 1] * rewardScale());
function placeMood(id) {
  const x = I.area[id] || I.spot[id], L = x && x.look;
  if (!L || !L.moods) return '';
  return L.moods[Math.max(0, C.core.seasons.indexOf(season()))] || L.moods[0];
}
// the place page open in Explore / Fishing: always the place you're at (state.area, state.spot, which the rules use);
// state.sub.place / .water only say the page is open, and are this screen's own
function placeOpenId() { const id = state.area; return state.sub && state.sub.place && I.area[id] && areaOpen(I.area[id]) ? id : ''; }
function waterOpenId() { const id = state.spot; return state.sub && state.sub.water && I.spot[id] && spotOpen(I.spot[id]) ? id : ''; }

// n trips (or catches) made in a place, and what they turned up
function notePlace(id, n, got) {
  const P = C.core.places;
  if (!P || !n || !(I.area[id] || I.spot[id])) return;
  if (!state.places) state.places = {};
  const r = state.places[id] || (state.places[id] = { n: 0, got: {}, rank: 0 });
  r.n += n;
  for (const [k, q] of Object.entries(got || {})) r.got[k] = (r.got[k] || 0) + q;
  const steps = placeSteps(id);
  while (r.rank < steps.length && r.n >= steps[r.rank]) {
    r.rank++;
    const coins = placeCoins(r.rank);
    state.coins += coins;
    toast(`${placeName(id)} rank ${r.rank}: ${P.titles[r.rank]}. Rare ${placeIsArea(id) ? 'finds' : 'fish'} +${r.rank * P.luck}% here, and ${fmtC(coins)}`, 'lvl', 5000);
  }
}
