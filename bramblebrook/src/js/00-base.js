/* ---------- base helpers, content index, art ---------- */
// true when this code runs on the server as the rules engine (supabase/functions/_shared/engine.js), not in a page
const ENGINE = typeof globalThis !== 'undefined' && !!globalThis.__ENGINE__;
let C = null;          // all content (core, story, people, adventures, art)
const I = {};          // lookups built from C
let state = null;      // the save

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
// Game time. On the server the engine sets engineClock to each move's time while it replays; online, the
// device's clock is nudged by clockSkew to agree with the server's.
let engineClock = 0, clockSkew = 0;
const now = () => engineClock || (Date.now() + clockSkew);
/* Every roll that changes the farm comes from rand(), never Math.random(): it draws from a seed the server hands
   out (state.rng), so the server can replay the same moves and get the same rolls. Math.random() is only for
   things that change nothing (which line of chatter, where a ripple goes). */
function mix32(x) { x = Math.imul(x ^ (x >>> 16), 0x21f0aaad); x = Math.imul(x ^ (x >>> 15), 0x735a2d97); return (x ^ (x >>> 15)) >>> 0; }
function rand() {
  if (!state.rng || typeof state.rng.s !== 'number') state.rng = { s: (Math.random() * 4294967296) >>> 0, n: 0 };
  const r = state.rng;
  return mix32((r.s + Math.imul(r.n++ + 1, 0x9E3779B9)) >>> 0) / 4294967296;
}
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtN = n => Math.floor(n).toLocaleString('en-US');
// big numbers where space is tight: 98,765 · 1.23M · 45.6B · 789T
const fmtShort = n => {
  n = Math.floor(n); const a = Math.abs(n);
  if (a < 1e6) return fmtN(n);
  const [v, u] = [[1e15, 'Qa'], [1e12, 'T'], [1e9, 'B'], [1e6, 'M']].find(([x]) => a >= x);
  return String(+(n / v).toPrecision(3)) + u;
};
const fmtC = n => fmtShort(n) + (Math.abs(n) < 1e6 ? 'c' : '');
const ordinal = n => { const x = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (x[(v - 20) % 10] || x[v] || x[0]); };
const fmtCoins = n => fmtShort(n) + ' coins';
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const byId = list => Object.fromEntries((list || []).map(x => [x.id, x]));
const plural = (n, w) => `${fmtN(n)} ${w}${n === 1 ? '' : 's'}`;

function fmtT(sec) {
  sec = Math.max(0, Math.ceil(sec));
  if (sec < 60) return sec + 's';
  const m = Math.floor(sec / 60), s = sec % 60;
  if (m < 60) return s ? `${m}m ${s}s` : `${m}m`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
}
/* A clock time for when something finishes, e.g. "6:40am". */
function clockAt(t) {
  const d = new Date(t);
  let h = d.getHours();
  const ap = h < 12 ? 'am' : 'pm';
  h = h % 12 || 12;
  return `${h}:${String(d.getMinutes()).padStart(2, '0')}${ap}`;
}
// The farm's calendar day. It follows the player's time zone, kept in the save (state.tz, minutes east of UTC),
// so the server sees the same day as the phone; before that is set, the device's own zone.
function dayKey(t = now()) {
  const off = state && typeof state.tz === 'number' ? state.tz : -new Date(t).getTimezoneOffset();
  const d = new Date(t + off * 60000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}
// midnight at the start of the farm's day, in ms
function dayStart(t = now()) { const off = state && typeof state.tz === 'number' ? state.tz : -new Date(t).getTimezoneOffset(); const m = off * 60000; return Math.floor((t + m) / 86400000) * 86400000 - m; }
function seeded(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return () => { h += 0x6D2B79F5; let t = h; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
// A fair shuffle that comes out the same on every browser and on the server. (Sorting with a random
// comparator does not: Chrome, Safari and the server each sort differently, so they picked different chores.)
function shuffled(list, rnd = rand) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
function pickWeighted(entries, rnd = rand) {
  const total = entries.reduce((a, e) => a + e[1], 0);
  let r = rnd() * total;
  for (const e of entries) { r -= e[1]; if (r <= 0) return e; }
  return entries[entries.length - 1];
}
// XP from level l to l+1. The curve lives in core.json (xpCurve) so pacing can be tuned without code.
// early levels cost a fraction of the curve (a quarter at level 1), rising to the full price by xpCurve.early.until
const xpToNext = l => {
  const k = (C && C.core && C.core.xpCurve) || { base: 12, exp: 1.45 }, e = k.early;
  const f = e ? Math.min(1, e.min + (1 - e.min) * Math.pow(Math.max(0, l - 1) / (e.until - 1), e.pow)) : 1;
  return Math.max(1, Math.floor(k.base * Math.pow(l, k.exp) * f));
};
const MAX_LVL = 60;
function levelInfo(xp) {
  let l = 1, rest = xp || 0;
  while (l < MAX_LVL && rest >= xpToNext(l)) { rest -= xpToNext(l); l++; }
  return { lvl: l, into: rest, need: l < MAX_LVL ? xpToNext(l) : 0 };
}
function fill(s) { return String(s == null ? '' : s).replace(/\{name\}/g, (state && state.name) || 'friend'); }
function paras(s) { return fill(s).split(/\n\n+/).map(p => `<p>${esc(p)}</p>`).join(''); }

function indexContent(data) {
  C = data;
  const k = data.core;
  Object.assign(I, {
    items: k.items, skills: k.skills, skill: byId(k.skills),
    crops: k.crops, crop: byId(k.crops), trees: k.trees, tree: byId(k.trees),
    animals: k.animals, animal: byId(k.animals), areas: k.areas, area: byId(k.areas),
    spots: k.spots, spot: byId(k.spots), recipes: k.recipes, recipe: byId(k.recipes),
    meals: k.meals, meal: byId(k.meals), buffs: k.buffs, ach: k.achievements,
    vils: data.people.villagers, vil: byId(data.people.villagers), merchant: data.people.merchant || {},
    chapters: data.story.chapters, chapter: byId(data.story.chapters), pages: data.story.pages || [], letters: data.story.letters || [],
    advs: data.adventures.adventures || [], adv: byId(data.adventures.adventures), encs: data.adventures.encounters || [],
    art: (data.art && data.art.map) || {},
  });
  C.tours = data.tours || { tours: {} };
  C.bestiary = data.bestiary || { creatures: [], encounters: [] };
  C.bestiary.byId = byId(C.bestiary.creatures);
  I.encs = I.encs.concat(C.bestiary.encounters || []);
  I.enc = byId(I.encs);
  C.delves = { list: (data.delves && data.delves.delves) || [] };
  C.delves.byId = byId(C.delves.list);
  C.companions = data.companions || { companions: {}, inn: null, crit: {}, fumble: {} };
  C.classes = data.classes || { abilities: {}, classes: [], moves: {}, folk: {}, terms: {}, levels: { cap: 20, xpBase: 100, xpExp: 1.8, scoreUpAt: [] } };
  I.cls = {}; for (const c of C.classes.classes) I.cls[c.id] = c;
  C.foes = data.foes || { foes: {}, fights: [] };
  I.legendary = new Set(k.spots.flatMap(s => s.fish.filter(f => f[2] === 5).map(f => f[0])));
  I.fishKinds = Object.keys(k.items).filter(id => k.items[id].t === 'fish');
  // which chapter unlocks what (for "unlocks in chapter N" hints)
  I.unlockAt = {};
  I.chapters.forEach((ch, ci) => {
    const note = u => [].concat(u || []).forEach(x => { if (!(x in I.unlockAt)) I.unlockAt[x] = ci; });
    (ch.steps || []).forEach(s => note(s.give && s.give.unlock));
    note(ch.give && ch.give.unlock);
  });
}
const itemName = id => (I.items[id] ? I.items[id].n : id);
const skillName = id => (I.skill[id] ? I.skill[id].n : id);
const vilName = id => (id === 'you' ? ((state && state.name) || 'You') : I.vil[id] ? I.vil[id].n : id);
const vilShort = id => (I.vil[id] ? I.vil[id].short || I.vil[id].n : id);

/* Pixel art from the atlas, or the item's emoji when there is no art yet. */
function artCell(key, size, extra = '') {
  const a = I.art[key];
  if (!a) return '';
  const [c, r, h, f] = a;
  return `<i class="px ${extra}" aria-hidden="true" style="--s:${size}px;--c:${c};--r:${r};--h:${h}${f ? `;filter:${f}` : ''}"></i>`;
}
function pic(id, size = 32, extra = '') {
  const art = artCell('item:' + id, size, extra);
  if (art) return art;
  const it = I.items[id];
  if (!it) return '';
  return `<span class="emo ${extra}" aria-hidden="true" style="--s:${size}px${it.f ? `;filter:${it.f}` : ''}">${it.i}</span>`;
}
function stagePic(crop, stage, size) {
  return artCell(`stage:${crop}:${stage}`, size, 'sprout') || `<span class="emo sprout" style="--s:${size}px">${stage < 3 ? '🌱' : stage < 4 ? '🌿' : I.items[crop].i}</span>`;
}
function folk(id, size = 48) {
  if (id === 'saffi' || id === 'tess') return `<span class="mono" style="--h:${id === 'tess' ? 30 : 20}">${artCell('folk:' + id, size) || id[0].toUpperCase()}</span>`;
  const v = I.vil[id];
  if (!v) return '';
  return `<span class="mono" style="--h:${v.h}">${artCell('folk:' + id, size) || esc(v.mono || v.n[0])}</span>`;
}
const chip = (id, n, cls = '') => `<span class="chip ${cls}">${pic(id, 20)} ${n != null ? `${n} ` : ''}${esc(itemName(id))}</span>`;
