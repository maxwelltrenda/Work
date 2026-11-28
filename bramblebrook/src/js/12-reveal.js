/* ---------- gradual reveal: tabs, sub-tabs, skills and systems appear as they become useful ----------
   After the prologue, the town opens up over the first week: board on day 2, almanac day 3, inn day 5, bestiary day 7. */
const FEATURES = {
  'tab:fish': () => chapterDone('prologue') || lvl('fishing') > 1,
  'tab:make': () => chapterDone('prologue') || lvl('crafting') > 1,
  'farm:orchard': () => unlocked('orchard'),
  'farm:animals': () => unlocked('coop'),
  'farm:pets': () => (C.core.pets || []).some(p => unlocked(p.unlock)),
  'wilds:mine': () => unlocked('mine'),
  'wilds:stair': () => stairOpen(),
  'town:inn': () => chapterDone('prologue') && dayNumber() >= 5 && (I.advs.some(a => state.advDone[a.id] || reqMet(a.req)) || openDelves().length > 0),
  'bag:bestiary': () => (chapterDone('prologue') && dayNumber() >= 7) || Object.keys(state.bestiary || {}).length > 0,
  'make:kitchen': () => unlocked('kitchen'),
  'make:bench': () => unlocked(C.core.workbench.unlock),
  'make:cellar': () => unlocked(C.core.cellar.unlock),
  'town:board': () => chapterDone('prologue') && dayNumber() >= 2,
  'town:village': () => ONLINE.social && chapterDone('prologue'),
  'town:war': () => ONLINE.social && chapterDone('prologue'),
  'town:hands': () => ONLINE.social && chapterDone('prologue'),
  'chatbar': () => ONLINE.social && chapterDone('prologue'),
  'town:mail': () => state.mail.length > 0,
  'bag:almanac': () => chapterDone('prologue') && dayNumber() >= 3,
  'bag:feats': () => chapterDone('prologue') || Object.keys(state.ach).length > 0,
  'market:perks': () => chapterDone('prologue') || Object.keys(state.perks || {}).length > 0,
  'skill:fishing': () => featureOn('tab:fish'),
  'skill:crafting': () => featureOn('tab:make'),
  'skill:mining': () => unlocked('mine'),
  'skill:cooking': () => unlocked('kitchen'),
  'daily': () => chapterDone('prologue'),
  'festival': () => chapterDone('fair'),
  'exchange': () => unlocked('merchant'),
  'upgrades': () => unlocked('forge'),
};
const FEATURE_NAMES = {
  'tab:fish': 'Fishing, on your Home page.', 'tab:make': 'The workshop, on your Home page: craft goods worth more.',
  'farm:orchard': 'The orchard, on your Home page.', 'farm:animals': 'Animals, on your Home page.', 'farm:pets': 'Pets, on your Home page.',
  'wilds:mine': 'The Mine, on your Home page.', 'wilds:stair': 'The Lantern Stair, on your Home page: light lanterns to make everything sell for more.', 'town:inn': 'The Lantern & Ladle inn, on your Home page.', 'bag:bestiary': 'The bestiary, on your Profile.',
  'make:kitchen': 'Cooking, on your Home page.', 'make:bench': 'The workbench, on your Home page.', 'make:cellar': 'The cellar, on your Home page.',
  'town:war': 'Village wars, on the Village page: raid other villages with your neighbours for coins and War Spoils.',
  'town:board': 'Chores and daily gifts, on your Home page.', 'town:village': 'Villages, on the Village page: team up with other players.', 'town:hands': 'Farmhands, on the Village page: hire other players to hit bosses harder.', 'chatbar': 'Chat, just above the page buttons: the newest from the world, your village and your messages. Tap one to talk.', 'market:perks': 'Perks, in the Market: spend points on bonuses.',
  'festival': 'Seasonal festivals, under Chores on your Home page.', 'exchange': 'The Valley Exchange, in the Market.',
};
const featureOn = k => !FEATURES[k] || !!FEATURES[k]();
const tabOn = t => featureOn('tab:' + t);
const subOn = (t, s) => featureOn(`${t}:${s}`);
const skillOn = sk => featureOn('skill:' + sk);
/* Announces each feature the first time it becomes available. Existing saves learn the current set silently. */
function checkReveals(silent) {
  if (!state.revealed) state.revealed = {};
  const fresh = !Object.keys(state.revealed).length;
  const news = [];
  for (const k of Object.keys(FEATURES)) {
    if (state.revealed[k] || !featureOn(k)) continue;
    state.revealed[k] = now();
    if (!silent && !fresh && FEATURE_NAMES[k]) news.push(FEATURE_NAMES[k]);
  }
  // several at once arrive as one notification, not a pile
  if (news.length === 1) toast(`New: ${news[0]}`, 'lvl', 5000);
  else if (news.length) toast(`New in the valley\n${news.join('\n')}`, 'lvl', 4500 + news.length * 1200);
  if (fresh) state.revealed._init = now();
}
const isNew = key => !!(state.revealed && state.revealed[key] && state.revealed._init && state.revealed[key] > state.revealed._init && !(state.visited || {})[key]);
function markVisited(key) { if (!state.visited) state.visited = {}; state.visited[key] = now(); }
