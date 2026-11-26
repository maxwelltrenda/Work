// Plays Bramblebrook from a fresh save on a fake clock, as a player with a fixed check-in routine.
//   node bot/run.js --profile casual|keen [--session 10] [--bg wanderer] [--eat eat|cook|none] [--filler fish|none]
//                   [--src <folder with src/ assets/>] [--seed n] [--out <dir>] [--tag name]
//                   [--days N]      keep playing after the epilogue until game day N (farm, explore/dig, sell, craft spare)
//                   [--maxdays N]   without --days: give up if the story is not done by day N (default 400)
//                   [--fast 0]      render the whole UI every action (default skips view/header/badges/toasts/sound/saves)
//                   [--reel s] [--cycle 0]   reel timing error in seconds (0 = every reel lands); no replanting mid-visit
// Builds a debug copy of <src> into <out>/build (stubbuild.js), serves it to Playwright from disk, and
// writes <out>/<profile>.json and <out>/<profile>.txt.
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const { chromium } = require('playwright');

const HERE = __dirname, SIM = path.dirname(HERE);
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const PROFILE = arg('profile', 'casual');
const PROFILES = {
  casual: { times: ['08:00', '12:30', '18:00', '21:30'], session: 10 },
  keen: { times: Array.from({ length: 16 }, (_, i) => `${String(7 + i).padStart(2, '0')}:00`), session: 5 },
};
const prof = Object.assign({}, PROFILES[PROFILE]);
if (!prof.times) throw new Error('unknown profile ' + PROFILE);
prof.session = +arg('session', prof.session);
const BG = arg('bg', 'wanderer');
const EAT = arg('eat', 'eat');
const FILLER = arg('filler', 'fish');
const SRC = path.resolve(arg('src', path.join(SIM, '../..')));   // the game (default: this repo)
const OUT = path.resolve(arg('out', path.join(SIM, 'out')));
const DAYS = arg('days', '') ? +arg('days') : 0;          // keep playing after the epilogue until this game day
const MAXDAYS = DAYS || +arg('maxdays', 400);              // without --days: stop at the end of the story (or this many days)
const FAST = arg('fast', '1') !== '0';                    // skip main-view rendering, header, badges, toasts, sound and saves (0 = render everything)    // skip main-view rendering, header, badges, sound and saves
const SEED = +arg('seed', 1);
const TAG = arg('tag', PROFILE);
const REEL = +arg('reel', 0.07);
const CYCLE = arg('cycle', '1') !== '0';   // replant fast crops during a visit (0 = only sow long crops, harvest what is ready)   // seconds of timing error on a reel tap (0 = every reel lands)
const START = Date.parse(arg('start', '2026-03-02T00:00:00Z'));

fs.mkdirSync(OUT, { recursive: true });
const BUILD = path.join(OUT, 'build-' + TAG);
execFileSync('node', [path.join(SIM, 'stubbuild.js'), SRC, BUILD], { env: Object.assign({}, process.env, { DEBUG: '1' }), stdio: 'pipe' });
const CORE = fs.readFileSync(path.join(HERE, 'core.js'), 'utf8');

const DAY = 86400000;
const hm = s => { const [h, m] = s.split(':').map(Number); return (h * 60 + m) * 60000; };
const sessionTimes = function* () { for (let d = 0; ; d++) for (const t of prof.times) yield START + d * DAY + hm(t); };
const fmtEl = ms => { const m = Math.round(ms / 60000), d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60; return `${d}d ${String(h).padStart(2, ' ')}h ${String(mm).padStart(2, '0')}m`; };

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce', timezoneId: 'UTC' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.route('http://bb.local/**', route => {
    const f = path.join(BUILD, new URL(route.request().url()).pathname.replace(/^\//, '') || 'index.html');
    if (!fs.existsSync(f)) return route.fulfill({ status: 404, body: '' });
    const type = f.endsWith('.html') ? 'text/html' : f.endsWith('.json') ? 'application/json' : f.endsWith('.png') ? 'image/png' : 'application/octet-stream';
    route.fulfill({ status: 200, body: fs.readFileSync(f), contentType: type });
  });
  const first = sessionTimes().next().value;
  await page.addInitScript(({ t0, seed }) => {
    // fake wall clock and timers; the 1 s UI tick is dropped (the bot does what it did on each visit)
    window.__fake = { t: t0, id: 1, timers: [] };
    Date.now = () => window.__fake.t;
    // deterministic Math.random so a rerun after retuning is comparable
    let h = seed >>> 0 || 1;
    Math.random = () => { h += 0x6D2B79F5; let t = h; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    window.setTimeout = function (fn, ms) { const id = window.__fake.id++; window.__fake.timers.push({ id, at: window.__fake.t + (+ms || 0), fn, args: [].slice.call(arguments, 2) }); return id; };
    window.clearTimeout = id => { const T = window.__fake.timers, i = T.findIndex(x => x.id === id); if (i >= 0) T.splice(i, 1); };
    window.setInterval = () => 0; window.clearInterval = () => {};
    window.__runTimers = () => {
      for (let g = 0; g < 20000; g++) {
        const T = window.__fake.timers; let b = -1;
        for (let i = 0; i < T.length; i++) if (T[i].at <= window.__fake.t && (b < 0 || T[i].at < T[b].at)) b = i;
        if (b < 0) return;
        const x = T.splice(b, 1)[0];
        try { if (typeof x.fn === 'function') x.fn(...x.args); } catch (e) { (window.__errs = window.__errs || []).push(String(e && e.stack || e)); }
      }
    };
  }, { t0: first, seed: SEED });
  await page.goto('http://bb.local/index.html' + (process.env.SNAP ? '?snap=' + process.env.SNAP : ''));
  // the website opens on an account offer now: play without one, as a new player could
  await page.waitForSelector('#name-in, [data-act="play-offline"]');
  if (await page.locator('[data-act="play-offline"]').count()) await page.click('[data-act="play-offline"]');
  await page.waitForSelector('#name-in');
  await page.fill('#name-in', 'Robin');
  await page.click('#name-form button');
  await page.evaluate(({ core, cfg }) => {
    window.__botCfg = cfg;
    __bb.state.opts.tipsOff = true; __bb.state.opts.soundOff = true;
    window.__bot = __bb.ev(core);
  }, { core: CORE, cfg: { eat: EAT === 'none' ? '' : EAT, filler: FILLER, reelSigma: REEL, cycle: CYCLE, keepPlaying: !!DAYS, fast: FAST } });
  // character creation, as a player taps it
  await page.evaluate(bg => {
    __bot.T(20);
    document.querySelector(`#scene-root [data-bg="${bg}"]`).click(); __bot.T(15);
    document.querySelector('#scene-root [data-face]').click(); __bot.T(10);
    const cls = document.querySelector('#scene-root [data-cls]'); if (cls) { cls.click(); __bot.T(10); }
    __bb.state.opts.tipsOff = true; __bb.state.opts.soundOff = true;
    __bot.drain();
  }, BG);
  // determinism check: record every move from here, from a known farm
  await page.evaluate(() => __bb.ev("state.tz = 0; state.rng = { s: 777, n: 0 }; mv.on = true; mv.log.length = 0; window.__snapAt = +(new URLSearchParams(location.search).get('snap') || -1); window.__s0 = JSON.parse(JSON.stringify(state));"));
  // each move also carries a hash of the farm just before it (settled the way the server settles), to find where a replay first parts ways
  await page.evaluate(() => __bb.ev(`(function () { const orig = recordMove; recordMove = function (n, a) {
    if (!mv.on || mv.replaying) return orig(n, a);
    const keep = state, kc = engineClock, t = now(); let h;
    state = JSON.parse(JSON.stringify(keep)); engineClock = t;
    try { engineTick(); syncStamina(); engineSettle(); h = hashState(state); if (mv.log.length === window.__snapAt) window.__snap = JSON.parse(JSON.stringify(state)); } finally { state = keep; engineClock = kc; }
    orig(n, a); mv.log[mv.log.length - 1].h = h; }; })()`));

  let cdp = null;
  if (process.env.CPUPROF) { cdp = await page.context().newCDPSession(page); await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 200 }); await cdp.send('Profiler.start'); }
  const sessions = [];
  let cumActive = 0, cumProd = 0, cumFiller = 0;
  const chapterAt = {};
  const it = sessionTimes();
  const slots = []; { const g2 = sessionTimes(); for (let i = 0; i < prof.times.length * (MAXDAYS + 3); i++) slots.push(g2.next().value); }
  const created = await page.evaluate(() => __bb.state.created);
  let finished = false;
  for (let n = 0; ; n++) {
    let t = it.next().value;
    if (n === 0) t = await page.evaluate(() => window.__fake.t);
    const cur = await page.evaluate(() => window.__fake.t);
    if (t < cur) continue;                     // the last visit ran long; skip this slot
    if (t - created >= MAXDAYS * DAY) break;
    const w0 = Date.now();
    const before = await page.evaluate(() => Object.assign({}, __bb.state.story.done));
    const leaveAt = t + prof.session * 60000, nextSlot = slots.find(x => x > leaveAt + 60000) || leaveAt + 6 * 3600000;
    const res = await page.evaluate(({ t, budget, away }) => { window.__fake.t = t; window.__runTimers(); return __bot.runSession(budget, away); }, { t, budget: prof.session * 60, away: (nextSlot - leaveAt) / 1000 });
    const w1 = Date.now();
    const after = await page.evaluate(() => ({ done: __bb.state.story.done, now: window.__fake.t, end: __bb.storyStatus().kind === 'end' && !__bb.state.story.queue.length }));
    if (process.env.WALL) console.log('visit', n + 1, 'wall ms', w1 - w0, Date.now() - w1);
    for (const [id, at] of Object.entries(after.done)) if (!before[id]) chapterAt[id] = { at, active: cumActive + (at - t) / 60000, prod: cumProd + Math.min(res.prod, (at - t) / 60000), session: n + 1 };
    cumActive += res.minutes; cumProd += res.prod; cumFiller += res.filler;
    sessions.push(Object.assign({ n: n + 1, at: t, cumActive: +cumActive.toFixed(1) }, res));
    if (n % (DAYS > 30 ? 40 : 8) === 0 || (after.end && !finished)) process.stdout.write(`${TAG} s${n + 1} day ${res.day} ${fmtEl(t - created)} ch${res.ci}.${res.si} ${res.step.slice(0, 60)} | coins ${res.coins} plots ${res.plots} lv ${JSON.stringify(res.lv)} deep ${res.deepest} | ${res.why.join('; ').slice(0, 90)}\n`);
    if (after.end && !finished) { finished = true; if (!DAYS) break; }
  }
  if (cdp) {
    const { profile } = await cdp.send('Profiler.stop');
    const self = {}, byId = {};
    profile.nodes.forEach(n => (byId[n.id] = n));
    const dt = profile.timeDeltas, cnt = {};
    profile.samples.forEach((id, i) => { cnt[id] = (cnt[id] || 0) + (dt[i] || 0); });
    for (const [id, us] of Object.entries(cnt)) { const n = byId[id], k = `${n.callFrame.functionName || '(anon)'}:${n.callFrame.lineNumber}`; self[k] = (self[k] || 0) + us; }
    const tot = Object.values(self).reduce((a, b) => a + b, 0);
    console.log('CPU self time, top 30 of ' + (tot / 1e6).toFixed(1) + 's');
    Object.entries(self).sort((a, b) => b[1] - a[1]).slice(0, 30).forEach(([k, us]) => console.log(`  ${(us / 1e6).toFixed(2)}s  ${k}`));
  }
  const rec = await page.evaluate(() => __bb.ev("({ snap: window.__snap, s0: window.__s0, log: mv.log, at: window.__fake.t, hash: (function (t) { const kc = engineClock; engineClock = t; try { engineTick(); syncStamina(); engineSettle(); } finally { engineClock = kc; } return hashState(state); })(window.__fake.t), st: JSON.parse(JSON.stringify(state)) })"));
  fs.writeFileSync(path.join(OUT, TAG + '-rec.json'), JSON.stringify(rec));
  console.log('recorded', rec.log.length, 'moves; client hash', rec.hash);
  const snap = await page.evaluate(() => __bot.snapshot());
  const botLog = await page.evaluate(() => __bot.LOG);
  const errs = await page.evaluate(() => window.__errs || []);
  await browser.close();

  // ---- report ----
  const chapters = JSON.parse(fs.readFileSync(path.join(SRC, 'src/content/story.json'), 'utf8')).chapters;
  const lines = [];
  lines.push(`Bramblebrook pacing run: ${TAG} (profile ${PROFILE}: ${prof.times.length} visits a day at ${prof.times[0]}..${prof.times[prof.times.length - 1]}, ${prof.session} min each; background ${BG}; eat=${EAT}; filler=${FILLER}; reel sigma ${REEL}s; cycle ${CYCLE}; seed ${SEED}${DAYS ? `; played to day ${DAYS}` : ''})`);
  lines.push(finished ? 'Story finished.' : `Story NOT finished after ${MAXDAYS} days: stuck at ${JSON.stringify(snap.status)}`);
  lines.push('');
  lines.push('Chapter finished      game day  real elapsed   visits  active min  (productive)');
  for (const ch of chapters) {
    const c = chapterAt[ch.id];
    if (!c) { lines.push(`${ch.id.padEnd(20)}  not reached`); continue; }
    lines.push(`${(ch.id + ' ' + ch.n).slice(0, 20).padEnd(20)}  day ${String(Math.floor((c.at - created) / DAY) + 1).padStart(3)}  ${fmtEl(c.at - created)}   ${String(c.session).padStart(5)}  ${c.active.toFixed(0).padStart(9)}  (${c.prod.toFixed(0)})`);
  }
  lines.push('');
  lines.push(`Totals: ${sessions.length} visits, ${cumActive.toFixed(0)} min in the app (${cumProd.toFixed(0)} productive, ${cumFiller.toFixed(0)} filler fishing, rest waiting on crops/stamina)`);
  lines.push(`Stamina spent ${snap.tot.staminaSpent}, explores ${snap.stats.explores}, digs ${snap.stats.digs}, casts ${snap.tot.casts} (${snap.tot.fillerCasts} filler), fish caught ${snap.stats.fish}, story-adventure losses ${snap.tot.advLosses}, delve/side losses ${snap.tot.otherLosses || 0}`);
  lines.push(`Reels missed ${snap.tot.missed || 0} of ${snap.tot.casts}; legendary bites ${snap.tot.legendBites || 0}, landed ${snap.tot.legendCaught || 0}`);
  lines.push('Coins by source: ' + Object.entries(snap.ledger).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', '));
  lines.push(`End state: levels ${JSON.stringify(snap.lv)}, coins ${snap.coins}, plots ${snap.plots}, barn tier ${snap.barn}, deepest ${snap.deepest}, animals ${JSON.stringify(Object.fromEntries(Object.entries(snap.animals).map(([k, v]) => [k, v.n])))}, perks ${JSON.stringify(snap.perks)}`);
  // when the farm opens up: farming level (crops, trees) per visit
  const lvAt = (sk, L) => { const s = sessions.find(x => x.lv[sk] >= L); return s ? `day ${Math.floor((s.at - created) / DAY) + 1} (${fmtEl(s.at + s.minutes * 60000 - created)}, visit ${s.n})` : 'never'; };
  const crops = JSON.parse(fs.readFileSync(path.join(SRC, 'src/content/core.json'), 'utf8'));
  const marks = [...new Set(crops.crops.filter(c => !c.flag).map(c => c.lvl).concat(crops.trees.map(t => t.lvl)))].sort((a, b) => a - b);
  lines.push('');
  lines.push('Farming level reached (by the end of visit):');
  for (const L of marks.filter(L => L > 1)) lines.push(`  Farming ${String(L).padStart(2)} ${lvAt('farming', L).padEnd(36)} unlocks ${crops.crops.filter(c => c.lvl === L && !c.flag).map(c => c.id).concat(crops.trees.filter(t => t.lvl === L).map(t => t.id + ' tree')).join(', ')}`);
  const MILES = [7, 14, 30, 60, 90, 180, 365].filter(d => d <= MAXDAYS);
  const lvOnDay = D => { const s = sessions.filter(x => x.at - created < D * DAY); return s.length ? s[s.length - 1].lv : null; };
  const SK = sessions.length ? Object.keys(sessions[0].lv) : [];
  lines.push('');
  lines.push('Skill levels at the end of day: ' + MILES.map(d => `d${d}`).join('  '));
  for (const sk of SK) lines.push(`  ${sk.padEnd(9)} ${MILES.map(d => { const l = lvOnDay(d); return String(l ? l[sk] : '-').padStart(4); }).join('  ')}`);
  lines.push('Other skills: ' + ['foraging', 'mining', 'crafting'].map(sk => [3, 5, 10, 14].map(L => `${sk} ${L}: ${lvAt(sk, L)}`).join('; ')).join('\n              '));
  lines.push('');
  lines.push('Feature reveals (FEATURES in 12-reveal.js), time after the save was created:');
  for (const [k, at] of Object.entries(snap.revealed).filter(([k]) => k !== '_init').sort((a, b) => a[1] - b[1])) lines.push(`  ${k.padEnd(16)} day ${Math.floor((at - created) / DAY) + 1}  ${fmtEl(at - created)}`);
  lines.push('');
  lines.push('Steps: time on each, visits it spanned, stamina spent while it was current (and on what), and what was still missing at the end of each visit');
  const keys = Object.keys(snap.stepLog).sort((a, b) => snap.stepLog[a].t0 - snap.stepLog[b].t0);
  // per chapter: what the visits ran out of, and where the stamina went
  lines.push('');
  const chapSum = [];
  chapters.forEach((ch, ci) => {
    const ks = keys.filter(k => +k.split('.')[0] === ci);
    if (!ks.length) return;
    const agg = (f) => { const o = {}; for (const k of ks) for (const [r, n] of Object.entries(snap.stepLog[k][f] || {})) o[r] = (o[r] || 0) + n; return Object.entries(o).sort((a, b) => b[1] - a[1]); };
    const stam = ks.reduce((a, k) => a + snap.stepLog[k].stam, 0);
    const prev = ci ? chapterAt[chapters[ci - 1].id] : null, cur = chapterAt[ch.id];
    const el = cur ? cur.at - (prev ? prev.at : created) : null, act = cur ? cur.active - (prev ? prev.active : 0) : null;
    chapSum.push({ id: ch.id, el, act, stam, block: agg('block'), why: agg('stamWhy') });
  });
  lines.push('Per chapter: time it took, active minutes, stamina spent, what each visit ran out of first');
  for (const c of chapSum) {
    lines.push(`  ${c.id.padEnd(11)} ${c.el != null ? fmtEl(c.el) : '   --    '}  active ${c.act != null ? c.act.toFixed(0).padStart(3) : ' --'} min  stamina ${String(c.stam).padStart(4)}  | ${c.block.map(([r, n]) => `${r} x${n}`).join(', ') || 'never ran out (done inside one visit)'}`);
    lines.push(`  ${''.padEnd(11)} stamina went to: ${c.why.map(([r, n]) => `${r} ${n}`).join(', ')}`);
  }
  lines.push('');
  lines.push('Steps:');
  for (const [ki, k] of keys.entries()) {
    const s = snap.stepLog[k];
    const t1 = ki + 1 < keys.length ? snap.stepLog[keys[ki + 1]].t0 : snap.now;
    const reasons = Object.entries(s.reasons).sort((a, b) => b[1] - a[1]).map(([r, n]) => `${r} (${n})`).join(', ');
    const why = Object.entries(s.stamWhy).sort((a, b) => b[1] - a[1]).map(([r, n]) => `${r} ${n}`).join(', ');
    lines.push(`  ${k.padEnd(5)} ${fmtEl(t1 - s.t0)}  visits ${String(s.sessions).padStart(3)}  stamina ${String(s.stam).padStart(5)}  ${s.step.slice(0, 80)}`);
    if (why) lines.push(`          stamina went to: ${why}`);
    if (s.block) lines.push(`          what each visit ran out of first: ${Object.entries(s.block).sort((a, b) => b[1] - a[1]).map(([r, n]) => `${r} x${n}`).join(', ')}`);
    if (reasons) lines.push(`          left open at visit end: ${reasons}`);
  }
  if (errors.length || errs.length) { lines.push(''); lines.push('PAGE ERRORS: ' + errors.concat(errs).slice(0, 10).join('\n')); }
  const txt = lines.join('\n');
  fs.writeFileSync(path.join(OUT, TAG + '.txt'), txt + '\n');
  fs.writeFileSync(path.join(OUT, TAG + '.json'), JSON.stringify({ DAYS, MILES, chapSum, profile: PROFILE, prof, CYCLE, REEL, SEED, BG, EAT, FILLER, created, finished, chapterAt, sessions, snap, errors: errors.concat(errs) }, null, 1));
  fs.writeFileSync(path.join(OUT, TAG + '.log'), botLog.join('\n') + '\n');
  console.log('\n' + txt);
})().catch(e => { console.error(e); process.exit(1); });
