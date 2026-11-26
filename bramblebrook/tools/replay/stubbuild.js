// Builds a test copy into $OUT using real content where present and small stubs for missing files.
const fs = require('fs'), path = require('path');
const SRC = process.argv[2], OUT = process.argv[3];
const read = f => { const p = path.join(SRC, 'src/content', f); return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null; };
const ids = ['prologue','bridge','forge','mine','fair','lighthouse','highlands','bell','epilogue'];
const story = read('story.json') || { chapters: ids.map((id, i) => ({ id, n: 'Chapter ' + id, blurb: 'Stub chapter ' + id, intro: [{ who: 'oakley', say: 'Welcome to ' + id + ', {name}.' }, { say: 'Narration line.' }], outro: [{ say: 'The end of ' + id }],
  steps: i === 0 ? [{ type: 'talk', to: 'oakley', t: 'Talk to the mayor', scene: [{ who: 'oakley', say: 'Hello {name}' }], give: { items: { oldkey: 1 } } }, { type: 'gather', item: 'wheat', n: 3, t: 'Harvest 3 wheat' }, { type: 'deliver', to: 'hazel', want: { wheat: 1 }, t: 'Bring Hazel wheat', scene: [{ who: 'hazel', say: 'Thanks!' }] }]
  : [{ type: 'talk', to: 'oakley', t: 'Talk', scene: [{ who: 'oakley', say: 'hi' }] }], give: i === 0 ? { coins: 150, page: 1, unlock: 'coop', animals: { chicken: 2 } } : { coins: 10 } })),
  pages: [1,2,3,4,5,6,7,8].map(n => ({ n, title: 'Page ' + n, text: 'Stub page text ' + n })), letters: [{ id: 'l1', from: 'hazel', subject: 'Welcome', body: 'Hi {name}', when: { day: 1 }, give: { coins: 20 } }] };
const adventures = read('adventures.json') || { adventures: [{ id: 'fair_night', n: 'Stub adventure', where: 'town', blurb: 'A stub', req: {}, start: 'a', nodes: { a: { who: 'pip', say: 'Hi!', ch: [{ t: 'Win', go: 'w' }, { t: 'Roll', go: 'w', roll: { skill: 'foraging', base: .5, per: .02 }, fail: 'l' }, { t: 'Pay', go: 'w', cost: { stamina: 2 } }] }, w: { say: 'You win', end: 'win', give: { coins: 50 } }, l: { say: 'You lose', end: 'lose' } } }],
  encounters: [{ id: 'e1', where: ['meadow', 'mine'], weight: 10, start: 'a', nodes: { a: { say: 'A hen!', ch: [{ t: 'Catch it', go: 'w' }] }, w: { say: 'Got it', end: 'win', give: { items: { egg: 1 } } } } }] };
const content = { core: read('core.json'), story, people: read('people.json'), adventures, art: read('art.json'), tours: read('tours.json'), bestiary: read('bestiary.json'), delves: read('delves.json'), companions: read('companions.json') };
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'content.json'), JSON.stringify(content));
const css = fs.readFileSync(path.join(SRC, 'src/style.css'), 'utf8');
const js = fs.readdirSync(path.join(SRC, 'src/js')).sort().map(f => fs.readFileSync(path.join(SRC, 'src/js', f), 'utf8')).join('\n');
const dbg = process.env.DEBUG ? ' window.__bb = { get state() { return state; }, set state(v) { state = v; }, I, applyGive, commit, storyStatus, curStep, curChapter, playScene, setStepBase, playAdventure, get advRun() { return advRun; }, SOUNDS, FX, startQuest, checkFor, chanceOf, rollCheck, gainInsp, stepProgress, renderAll, addXP, levelInfo, xpToNext, tours: tourDefs, get C() { return C; }, tourId: () => tour && tour.id, ev: s => eval(s) };' : '';
const page = fs.readFileSync(path.join(SRC, 'src/shell.html'), 'utf8').replace('/*@STYLE@*/', () => css).replace('/*@SCRIPT@*/', () => js + dbg);
fs.writeFileSync(path.join(OUT, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>body{margin:0}[hidden]{display:none!important}</style></head><body>' + page + '</body></html>');
for (const f of fs.readdirSync(path.join(SRC, 'assets'))) if (/\.(png|svg|webmanifest|jpg|webp)$/.test(f)) fs.copyFileSync(path.join(SRC, 'assets', f), path.join(OUT, f));
console.log('stub build ok', !!read('story.json'), !!read('adventures.json'));
