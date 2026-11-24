/* ---------- gradual reveal: tabs, sub-tabs, skills and systems appear as they become useful ----------
   After the prologue, the town opens up over the first week: board on day 2, almanac day 3, inn day 5, bestiary day 7. */
const FEATURES = {
  'tab:fish': () => chapterDone('prologue') || lvl('fishing') > 1,
  'tab:make': () => chapterDone('prologue') || lvl('crafting') > 1,
  'farm:orchard': () => unlocked('orchard'),
  'farm:animals': () => unlocked('coop'),
  'farm:pets': () => (C.core.pets || []).some(p => unlocked(p.unlock)),
  'wilds:mine': () => unlocked('mine'),
  'town:inn': () => chapterDone('prologue') && dayNumber() >= 5 && (I.advs.some(a => state.advDone[a.id] || reqMet(a.req)) || openDelves().length > 0),
  'bag:bestiary': () => (chapterDone('prologue') && dayNumber() >= 7) || Object.keys(state.bestiary || {}).length > 0,
  'make:kitchen': () => unlocked('kitchen'),
  'make:bench': () => unlocked(C.core.workbench.unlock),
  'make:cellar': () => unlocked(C.core.cellar.unlock),
  'town:board': () => chapterDone('prologue') && dayNumber() >= 2,
  'town:village': () => ONLINE.social && chapterDone('prologue'),
  'town:chat': () => ONLINE.social && chapterDone('prologue'),
  'town:mail': () => state.mail.length > 0,
  'bag:almanac': () => chapterDone('prologue') && dayNumber() >= 3,
  'bag:feats': () => chapterDone('prologue') || Object.keys(state.ach).length > 0,
  'bag:perks': () => chapterDone('prologue') || Object.keys(state.perks || {}).length > 0,
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
  'tab:fish': 'Fishing, in the new Fish tab.', 'tab:make': 'Crafting, in the new Make tab.',
  'farm:orchard': 'The orchard, on the Farm tab.', 'farm:animals': 'Animals, on the Farm tab.', 'farm:pets': 'Pets, on the Farm tab.',
  'wilds:mine': 'The Mine, in the Wilds.', 'town:inn': 'The Lantern & Ladle inn, in Town.', 'bag:bestiary': 'The bestiary, in your Bag.',
  'make:kitchen': 'Cooking, in the Make tab.', 'make:bench': 'The workbench, in the Make tab.', 'make:cellar': 'The cellar, in the Make tab.',
  'town:board': 'The town board: chores and daily gifts.', 'town:village': 'Villages, in Town: team up with other players.', 'town:chat': 'Chat, in Town: talk with everyone and message friends.', 'bag:perks': 'Perks, in your Bag.',
  'festival': 'Seasonal festivals, on the town board.', 'exchange': 'The Valley Exchange, in Shops.',
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
