#!/usr/bin/env node
// Checks the Bramblebrook content files against core.json and SCHEMA.md.
// Usage (from the bramblebrook/ folder): node tools/validate.js
'use strict';
const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, '..', 'src', 'content');
const errors = [];
const warn = [];
const load = f => {
  const p = path.join(dir, f);
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { errors.push(`${f}: invalid JSON (${e.message})`); return null; }
};
const core = load('core.json');
const story = load('story.json');
const people = load('people.json');
const adv = load('adventures.json');
const beasts = load('bestiary.json');
const delves = load('delves.json');
const comps = load('companions.json');
const CREATURES = new Set(((beasts || {}).creatures || []).map(c => c.id));
if (!core) { console.log('core.json missing'); process.exit(1); }

const ITEMS = new Set(Object.keys(core.items));
// core.rarity is the fishing table (one row per fish rarity, 0-5); core.rarity_tiers holds the sell-price thresholds.
if (!Array.isArray(core.rarity) || core.rarity.length < 6 || core.rarity.some(r => !(r.zone > 0 && r.speed > 0 && r.xp > 0)))
  errors.push('core.json: "rarity" must be the fishing table, six rows of {zone, speed, xp}. Item colour tiers belong in "rarity_tiers".');
if (!(core.rarity_tiers && typeof core.rarity_tiers === 'object') || !['common', 'uncommon', 'rare', 'very rare'].every(k => core.rarity_tiers[k] > 0))
  errors.push('core.json: "rarity_tiers" needs common, uncommon, rare and very rare price thresholds.');
const SKILLS = new Set(core.skills.map(s => s.id));
const VILLAGERS = new Set(['oakley', 'hazel', 'tobin', 'mira', 'clem', 'pip', 'rook', 'ingrid', 'wren']);
const SPEAKERS = new Set([...VILLAGERS, 'you']);
const CHAPTERS = ['prologue', 'bridge', 'forge', 'mine', 'fair', 'lighthouse', 'highlands', 'bell', 'epilogue'];
const CHAPTER_SET = new Set(CHAPTERS);
const BUFFS = new Set(Object.keys(core.buffs));
const ANIMALS = new Set(core.animals.map(a => a.id));
const STATS = new Set(['explores', 'harvested', 'fish', 'crafted', 'cooked', 'digs', 'collected', 'delivered', 'earned', 'gifts']);
const WHERE = new Set(['meadow', 'woods', 'banks', 'quarry', 'beach', 'highlands', 'mine', 'river', 'pond', 'cove', 'tarn', 'town', 'farm']);
const UNLOCKS = new Set(['coop', 'river', 'banks', 'forge', 'barnyard', 'mine', 'kitchen', 'orchard', 'merchant', 'cove', 'beach', 'apiary', 'highlands', 'tarn', 'pasture']);
const advIds = new Set();
const usedFlags = new Set(), setFlags = new Set();

const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
function items(where, o) {
  if (!isObj(o)) { errors.push(`${where}: expected an object of item counts`); return; }
  for (const [k, v] of Object.entries(o)) {
    if (!ITEMS.has(k)) errors.push(`${where}: unknown item "${k}"`);
    if (!(Number.isInteger(v) && v > 0)) errors.push(`${where}: count for "${k}" must be a positive integer`);
  }
}
function text(where, s, max = 260) {
  if (typeof s !== 'string' || !s.trim()) { errors.push(`${where}: missing text`); return; }
  if (s.length > max) warn.push(`${where}: ${s.length} characters (aim for under ${max})`);
  if (/\b(he|she|his|her|him)\b/i.test(s) && /\{name\}/.test(s)) warn.push(`${where}: check pronouns near {name}`);
}
function lines(where, arr) {
  if (!Array.isArray(arr) || !arr.length) { errors.push(`${where}: expected a non-empty array of lines`); return; }
  arr.forEach((l, i) => {
    const w = `${where}[${i}]`;
    if (l.choices) {
      if (i !== arr.length - 1) errors.push(`${w}: choices must be the last entry`);
      if (!Array.isArray(l.choices) || !l.choices.length) errors.push(`${w}: choices must be a non-empty array`);
      else l.choices.forEach((c, j) => { text(`${w}.choices[${j}].t`, c.t, 60); if (c.reply) lines(`${w}.choices[${j}].reply`, c.reply); });
      return;
    }
    if (l.who !== undefined && !SPEAKERS.has(l.who)) errors.push(`${w}: unknown speaker "${l.who}"`);
    text(`${w}.say`, l.say, 220);
  });
}
function give(where, g) {
  if (g === undefined) return;
  if (!isObj(g)) { errors.push(`${where}: give must be an object`); return; }
  const ok = new Set(['coins', 'items', 'xp', 'friend', 'page', 'flag', 'stamina', 'buff', 'plots', 'animals', 'unlock', 'inspiration', 'befriend']);
  if (g.befriend && beasts && !CREATURES.has(g.befriend)) errors.push(`${where}: unknown creature "${g.befriend}"`);
  if (g.items && g.items.charm_starglass) warn.push(`${where}: gives the bestiary prize charm`);
  for (const k of Object.keys(g)) if (!ok.has(k)) errors.push(`${where}: unknown give key "${k}"`);
  if (g.items) items(`${where}.items`, g.items);
  if (g.xp) for (const k of Object.keys(g.xp)) if (!SKILLS.has(k)) errors.push(`${where}.xp: unknown skill "${k}"`);
  if (g.friend) for (const k of Object.keys(g.friend)) if (!VILLAGERS.has(k)) errors.push(`${where}.friend: unknown villager "${k}"`);
  if (g.buff && !BUFFS.has(g.buff)) errors.push(`${where}: unknown buff "${g.buff}"`);
  if (g.animals) for (const k of Object.keys(g.animals)) if (!ANIMALS.has(k)) errors.push(`${where}.animals: unknown animal "${k}"`);
  for (const f of [].concat(g.flag || [])) setFlags.add(f);
  for (const u of [].concat(g.unlock || [])) if (!UNLOCKS.has(u)) errors.push(`${where}: unknown unlock "${u}"`);
  if (g.page !== undefined && !(Number.isInteger(g.page) && g.page >= 1 && g.page <= 12)) errors.push(`${where}: page must be 1-12`);
}
function req(where, r) {
  if (r === undefined) return;
  if (!isObj(r)) { errors.push(`${where}: req must be an object`); return; }
  const ok = new Set(['items', 'skill', 'flag', 'noflag', 'chapter', 'started', 'coins', 'companion']);
  if (r.companion && !VILLAGERS.has(r.companion)) errors.push(`${where}.companion: unknown villager "${r.companion}"`);
  for (const k of Object.keys(r)) if (!ok.has(k)) errors.push(`${where}: unknown req key "${k}"`);
  if (r.items) items(`${where}.items`, r.items);
  if (r.skill) for (const [k, v] of Object.entries(r.skill)) { if (!SKILLS.has(k)) errors.push(`${where}.skill: unknown skill "${k}"`); if (!(v >= 1 && v <= 60)) errors.push(`${where}.skill: bad level`); }
  for (const key of ['chapter', 'started']) if (r[key] && !CHAPTER_SET.has(r[key])) errors.push(`${where}.${key}: unknown chapter "${r[key]}"`);
  if (r.flag) usedFlags.add(r.flag);
}
function cost(where, c) {
  if (c === undefined) return;
  if (!isObj(c)) { errors.push(`${where}: cost must be an object`); return; }
  for (const k of Object.keys(c)) if (!['coins', 'items', 'stamina'].includes(k)) errors.push(`${where}: unknown cost key "${k}"`);
  if (c.items) items(`${where}.items`, c.items);
}
function graph(where, g) {
  if (!g.nodes || !isObj(g.nodes)) { errors.push(`${where}: missing nodes`); return; }
  if (!g.nodes[g.start]) errors.push(`${where}: start node "${g.start}" missing`);
  const reach = new Set(); const stack = [g.start];
  let wins = 0;
  while (stack.length) {
    const id = stack.pop(); if (reach.has(id) || !g.nodes[id]) continue; reach.add(id);
    const n = g.nodes[id];
    if (n.who !== undefined && !SPEAKERS.has(n.who)) errors.push(`${where}.${id}: unknown speaker "${n.who}"`);
    text(`${where}.${id}.say`, n.say, 700);
    give(`${where}.${id}.give`, n.give);
    if (n.end) { if (!['win', 'lose'].includes(n.end)) errors.push(`${where}.${id}: end must be win or lose`); if (n.end === 'win') wins++; if (n.ch) errors.push(`${where}.${id}: an end node can't have choices`); continue; }
    if (!Array.isArray(n.ch) || !n.ch.length) { errors.push(`${where}.${id}: needs choices or end`); continue; }
    if (n.ch.length > 4) warn.push(`${where}.${id}: more than 4 choices`);
    n.ch.forEach((c, i) => {
      const w = `${where}.${id}.ch[${i}]`;
      text(`${w}.t`, c.t, 70);
      if (!g.nodes[c.go]) errors.push(`${w}: go "${c.go}" missing`); else stack.push(c.go);
      req(`${w}.req`, c.req); cost(`${w}.cost`, c.cost); give(`${w}.give`, c.give);
      if (c.roll) {
        if (!SKILLS.has(c.roll.skill)) errors.push(`${w}.roll: unknown skill`);
        if (typeof c.roll.base !== 'number') errors.push(`${w}.roll: base must be a number`);
        if (!g.nodes[c.fail]) errors.push(`${w}: roll needs a fail node that exists`); else stack.push(c.fail);
      }
    });
  }
  for (const id of Object.keys(g.nodes)) if (!reach.has(id)) warn.push(`${where}: node "${id}" is unreachable`);
  if (!wins) errors.push(`${where}: no "win" ending`);
}

if (adv) {
  if (!Array.isArray(adv.adventures)) errors.push('adventures.json: adventures must be an array');
  (adv.adventures || []).forEach((a, i) => {
    const w = `adventures[${a.id || i}]`;
    if (advIds.has(a.id)) errors.push(`${w}: duplicate id`); advIds.add(a.id);
    text(`${w}.n`, a.n, 40); text(`${w}.blurb`, a.blurb, 200);
    if (!WHERE.has(a.where)) errors.push(`${w}: unknown where "${a.where}"`);
    req(`${w}.req`, a.req); graph(w, a);
  });
  (adv.encounters || []).forEach((e, i) => {
    const w = `encounters[${e.id || i}]`;
    if (advIds.has(e.id)) errors.push(`${w}: duplicate id`); advIds.add(e.id);
    if (!Array.isArray(e.where) || !e.where.every(x => WHERE.has(x))) errors.push(`${w}: where must be an array of area ids`);
    if (!(e.weight > 0)) errors.push(`${w}: weight must be > 0`);
    req(`${w}.req`, e.req); graph(w, e);
  });
}
if (story) {
  const ids = (story.chapters || []).map(c => c.id);
  if (JSON.stringify(ids) !== JSON.stringify(CHAPTERS)) errors.push(`story.json: chapters must be exactly ${CHAPTERS.join(', ')} in that order (got ${ids.join(', ')})`);
  (story.chapters || []).forEach(c => {
    const w = `chapter[${c.id}]`;
    text(`${w}.n`, c.n, 40); text(`${w}.blurb`, c.blurb, 200);
    lines(`${w}.intro`, c.intro); lines(`${w}.outro`, c.outro); give(`${w}.give`, c.give);
    if (!Array.isArray(c.steps) || !c.steps.length) errors.push(`${w}: needs steps`);
    (c.steps || []).forEach((s, i) => {
      const sw = `${w}.steps[${i}]`;
      text(`${sw}.t`, s.t, 90);
      if (s.scene) lines(`${sw}.scene`, s.scene);
      give(`${sw}.give`, s.give);
      switch (s.type) {
        case 'talk': if (!VILLAGERS.has(s.to)) errors.push(`${sw}: unknown villager "${s.to}"`); if (!s.scene) errors.push(`${sw}: talk needs a scene`); break;
        case 'deliver': if (!VILLAGERS.has(s.to)) errors.push(`${sw}: unknown villager "${s.to}"`); items(`${sw}.want`, s.want); break;
        case 'gather': if (!ITEMS.has(s.item)) errors.push(`${sw}: unknown item "${s.item}"`); if (!(s.n > 0)) errors.push(`${sw}: n must be > 0`); break;
        case 'stat': if (!STATS.has(s.stat)) errors.push(`${sw}: unknown stat "${s.stat}"`); if (!(s.n > 0)) errors.push(`${sw}: n must be > 0`); break;
        case 'level': if (!SKILLS.has(s.skill)) errors.push(`${sw}: unknown skill "${s.skill}"`); break;
        case 'mine': if (!(s.floor >= 1 && s.floor <= 30)) errors.push(`${sw}: floor must be 1-30`); break;
        case 'adventure': if (adv && !advIds.has(s.id)) errors.push(`${sw}: adventure "${s.id}" not found in adventures.json`); break;
        default: errors.push(`${sw}: unknown step type "${s.type}"`);
      }
    });
  });
  const pages = (story.pages || []).map(p => p.n);
  if (pages.length < 8) errors.push('story.json: needs at least 8 journal pages');
  (story.pages || []).forEach(p => { text(`page ${p.n}.title`, p.title, 60); text(`page ${p.n}.text`, p.text, 1200); });
  (story.letters || []).forEach(l => {
    const w = `letter[${l.id}]`;
    if (!VILLAGERS.has(l.from)) errors.push(`${w}: unknown sender "${l.from}"`);
    text(`${w}.subject`, l.subject, 60); text(`${w}.body`, l.body, 900); give(`${w}.give`, l.give);
    const wh = l.when || {};
    if (!Object.keys(wh).length) errors.push(`${w}: needs a when`);
    if (wh.chapter && !CHAPTER_SET.has(wh.chapter)) errors.push(`${w}: unknown chapter`);
    if (wh.started && !CHAPTER_SET.has(wh.started)) errors.push(`${w}: unknown chapter`);
    if (wh.flag) usedFlags.add(wh.flag);
  });
}
if (people) {
  const seen = new Set();
  (people.villagers || []).forEach(v => {
    const w = `villager[${v.id}]`;
    if (!VILLAGERS.has(v.id)) errors.push(`${w}: unknown villager id`);
    seen.add(v.id);
    text(`${w}.n`, v.n, 40); text(`${w}.role`, v.role, 60);
    if (typeof v.h !== 'number') errors.push(`${w}: h must be a hue number`);
    req(`${w}.req`, v.req);
    for (const k of ['loves', 'likes', 'dislikes']) (v[k] || []).forEach(id => { if (!ITEMS.has(id)) errors.push(`${w}.${k}: unknown item "${id}"`); });
    if (!(v.greet || []).length) errors.push(`${w}: needs greet lines`);
    (v.greet || []).forEach((g, i) => text(`${w}.greet[${i}]`, g, 160));
    if (!v.thanks) errors.push(`${w}: needs thanks lines`);
    (v.requests || []).forEach((r, i) => { text(`${w}.requests[${i}].say`, r.say, 200); items(`${w}.requests[${i}].want`, r.want); give(`${w}.requests[${i}].give`, r.give); req(`${w}.requests[${i}].req`, r.req); });
    (v.hearts || []).forEach((h, i) => { text(`${w}.hearts[${i}].title`, h.title, 50); lines(`${w}.hearts[${i}].scene`, h.scene); give(`${w}.hearts[${i}].give`, h.give); });
  });
  for (const id of VILLAGERS) if (!seen.has(id)) errors.push(`people.json: missing villager "${id}"`);
}
if (beasts) {
  (beasts.creatures || []).forEach(c => { const w = `creature[${c.id}]`; text(`${w}.n`, c.n, 40); text(`${w}.blurb`, c.blurb, 160); text(`${w}.lore`, c.lore, 500); if (!c.i) errors.push(`${w}: needs an emoji i`); });
  const met = new Set();
  (beasts.encounters || []).forEach((e, i) => {
    const w = `bestiary.encounters[${e.id || i}]`;
    if (advIds.has(e.id)) errors.push(`${w}: duplicate id`); advIds.add(e.id);
    if (!CREATURES.has(e.creature)) errors.push(`${w}: unknown creature`);
    met.add(e.creature);
    if (!Array.isArray(e.where) || !e.where.every(x => WHERE.has(x))) errors.push(`${w}: where must be area ids`);
    req(`${w}.req`, e.req); graph(w, e);
    const befriends = Object.values(e.nodes || {}).some(n => n.end === 'win' && n.give && n.give.befriend === e.creature);
    if (!befriends) errors.push(`${w}: a win node must give befriend "${e.creature}"`);
  });
  for (const c of CREATURES) if (!met.has(c)) errors.push(`creature ${c} has no encounter`);
}
if (delves) {
  (delves.delves || []).forEach((d, i) => {
    const w = `delve[${d.id || i}]`;
    if (advIds.has(d.id)) errors.push(`${w}: duplicate id`); advIds.add(d.id);
    if (!(d.floor >= 5 && d.floor % 5 === 0)) errors.push(`${w}: floor must be a multiple of 5`);
    text(`${w}.n`, d.n, 40); text(`${w}.blurb`, d.blurb, 200); graph(w, d);
  });
}
if (comps) {
  for (const [vid, c] of Object.entries(comps.companions || {})) {
    const w = `companion[${vid}]`;
    if (!VILLAGERS.has(vid)) errors.push(`${w}: unknown villager`);
    (c.skills || []).forEach(sk => { if (!SKILLS.has(sk)) errors.push(`${w}: unknown skill ${sk}`); });
    text(`${w}.join`, c.join, 200); text(`${w}.win`, c.win, 200);
    (c.cheer || []).concat(c.oops || []).forEach((l, i) => text(`${w}.line${i}`, l, 180));
  }
  for (const k of ['crit', 'fumble']) for (const sk of SKILLS) if (!((comps[k] || {})[sk] || []).length) errors.push(`companions.json: ${k}.${sk} needs lines`);
}
for (const f of usedFlags) if (!setFlags.has(f) && !['heirloom'].includes(f)) warn.push(`flag "${f}" is required somewhere but never given`);

// classes.json: every class names real moves and abilities; every classed villager exists
const classes = load('classes.json');
if (classes) {
  const ab = new Set(Object.keys(classes.abilities || {}));
  for (const c of classes.classes || []) {
    for (const m of c.moves || []) if (!(classes.moves || {})[m]) errors.push(`classes.json: ${c.id} uses unknown move "${m}"`);
    if (!ab.has(c.primary)) errors.push(`classes.json: ${c.id} has unknown primary "${c.primary}"`);
    for (const k of ab) if (!(c.scores || {})[k]) errors.push(`classes.json: ${c.id} is missing a ${k} score`);
    if (!/^\d+d\d+$/.test((c.weapon || {}).dice || '')) errors.push(`classes.json: ${c.id} weapon dice must look like 1d8`);
  }
  const ids = new Set((classes.classes || []).map(c => c.id));
  for (const [vid, cid] of Object.entries(classes.folk || {})) {
    if (!ids.has(cid)) errors.push(`classes.json: folk ${vid} has unknown class "${cid}"`);
    if (!VILLAGERS.has(vid) && !['saffi', 'tess'].includes(vid)) errors.push(`classes.json: unknown villager "${vid}"`);
  }
}
// foes.json: every fight names real foes, a known place and a real reward item
const foes = load('foes.json');
if (foes) {
  const F = foes.foes || {};
  for (const [id, f] of Object.entries(F)) {
    if (!/^\d+d\d+$/.test(f.dice || '')) errors.push(`foes.json: ${id} dice must look like 2d6`);
    if (!(f.hp > 0 && f.ac > 0)) errors.push(`foes.json: ${id} needs hp and ac`);
    if (!['front', 'back'].includes(f.row)) errors.push(`foes.json: ${id} row must be front or back`);
  }
  for (const f of foes.fights || []) {
    for (const x of f.foes || []) if (!F[x]) errors.push(`foes.json: fight ${f.id} has unknown foe "${x}"`);
    if (f.item && !ITEMS.has(f.item)) errors.push(`foes.json: fight ${f.id} gives unknown item "${f.item}"`);
    if (!['meadow', 'woods', 'river', 'mine', 'cove', 'beach', 'banks', 'farm', 'quarry', 'highlands', 'tarn', 'pasture', 'town'].includes(f.where)) errors.push(`foes.json: fight ${f.id} has unknown place "${f.where}"`);
  }
}
if (warn.length) console.log('Warnings:\n  ' + warn.join('\n  '));
if (errors.length) { console.log(`\n${errors.length} error(s):\n  ` + errors.join('\n  ')); process.exit(1); }
console.log(`OK  (story: ${!!story}, people: ${!!people}, adventures: ${!!adv}, bestiary: ${!!beasts}, delves: ${!!delves}, companions: ${!!comps}, classes: ${!!classes})`);
