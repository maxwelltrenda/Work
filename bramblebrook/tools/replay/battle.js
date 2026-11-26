// Fights every training-yard battle on a fake clock with moves recorded, then writes a record for check.js.
const fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const PUB = path.join(__dirname, '../../public'), OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });
const SEED = +(process.argv[2] || 3);
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce', timezoneId: 'UTC' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await page.route('http://bb.local/**', route => {
    const f = path.join(PUB, new URL(route.request().url()).pathname.replace(/^\//, '') || 'index.html');
    if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) return route.fulfill({ status: 404, body: '' });
    const type = f.endsWith('.html') ? 'text/html' : f.endsWith('.json') ? 'application/json' : f.endsWith('.js') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : 'application/octet-stream';
    let body = fs.readFileSync(f);
    if (f.endsWith('game.js')) { const t = body.toString(); const at = t.lastIndexOf('})();'); body = t.slice(0, at) + 'window.__ev = s => eval(s);\n' + t.slice(at); }
    route.fulfill({ status: 200, body, contentType: type });
  });
  await page.route(/supabase\.co/, r => r.abort());
  await page.addInitScript(({ t0, seed }) => {
    window.__fake = { t: t0, id: 1, timers: [] };
    Date.now = () => window.__fake.t;
    let h = seed >>> 0 || 1;
    Math.random = () => { h += 0x6D2B79F5; let t = h; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    window.setTimeout = function (fn, ms) { const id = window.__fake.id++; window.__fake.timers.push({ id, at: window.__fake.t + (+ms || 0), fn, args: [].slice.call(arguments, 2) }); return id; };
    window.clearTimeout = id => { const T = window.__fake.timers, i = T.findIndex(x => x.id === id); if (i >= 0) T.splice(i, 1); };
    window.setInterval = () => 0; window.clearInterval = () => {};
    window.__step = ms => {   // let ms pass, firing timers in order
      const end = window.__fake.t + ms;
      for (let g = 0; g < 20000; g++) {
        const T = window.__fake.timers; let b = -1;
        for (let i = 0; i < T.length; i++) if (T[i].at <= end && (b < 0 || T[i].at < T[b].at)) b = i;
        if (b < 0) break;
        const x = T.splice(b, 1)[0];
        window.__fake.t = Math.max(window.__fake.t, x.at);
        try { if (typeof x.fn === 'function') x.fn(...x.args); } catch (e) { (window.__errs = window.__errs || []).push(String(e && e.stack || e)); }
      }
      window.__fake.t = end;
    };
  }, { t0: Date.parse('2026-03-02T08:00:00Z'), seed: SEED });
  await page.goto('http://bb.local/index.html');
  await page.waitForSelector('#name-in, [data-act="play-offline"]');
  if (await page.locator('[data-act="play-offline"]').count()) await page.click('[data-act="play-offline"]');
  await page.waitForSelector('#name-in');
  await page.fill('#name-in', 'Robin');
  await page.click('#name-form button');
  await page.evaluate(() => { __step(2000); document.querySelector('#scene-root [data-bg]').click(); __step(1500); document.querySelector('#scene-root [data-face]').click(); __step(1000); const c = document.querySelector('#scene-root [data-cls]'); if (c) { c.click(); __step(1000); } __step(5000); });
  const res = await page.evaluate(code => __ev(code), '(' + (() => {
    state.opts.tipsOff = true; state.opts.soundOff = true;
    if (typeof tour !== 'undefined') tour = null;
    if (!state.combat.cls) state.combat.cls = 'fighter';
    state.combat.xp = 999999; state.tz = 0; state.rng = { s: 4242, n: 0 };
    closeSheet(); $('#scene-root').innerHTML = ''; sceneOpen = false; sceneQ.length = 0; state.story.queue = [];
    mv.on = true; mv.log.length = 0; window.__s0 = JSON.parse(JSON.stringify(state));
    const el = d => ({ dataset: d, closest: () => null, classList: { add() {}, remove() {}, toggle() {}, contains: () => false } });
    const out = [];
    for (let round = 0; round < 3; round++) for (const f of FIGHTS()) {
      if (!fightUnlocked(f)) continue;
      handle('fight', el({ id: f.id })); __step(400);
      handle('fight-go', el({})); __step(300);
      let guard = 0;
      while (bt && guard++ < 400) {
        __step(900);
        if (!bt) break;
        if (bt.ended) { __step(1200); leaveBattle(); __step(500); break; }
        if (bt.phase === 'choose') {
          const u = bt.units.you;
          const ids = u.moves.filter(id => usesLeft(u, id) > 0 && (moveTargets(u, id) === null || moveTargets(u, id).length));
          battleChoose(ids[Math.floor(Math.random() * ids.length)]);
        } else if (bt.phase === 'target') {
          const ts = moveTargets(bt.units.you, bt.pick) || [];
          if (ts.length) battleTarget(ts[Math.floor(Math.random() * ts.length)].id); else battleBack();
        }
      }
      out.push(f.id + ':' + (state.combat.wins[f.id] || 0));
      __step(60000);
    }
    const t = __fake.t, kc = engineClock; engineClock = t;
    try { engineTick(); syncStamina(); engineSettle(); } finally { engineClock = kc; }
    return { out, rec: { s0: window.__s0, log: mv.log, at: t, hash: hashState(state), st: JSON.parse(JSON.stringify(state)) }, errs: window.__errs || [] };
  }).toString() + ')()');
  fs.writeFileSync(path.join(OUT, 'battle-rec.json'), JSON.stringify(res.rec));
  console.log('fights', res.out.join(' '), 'moves', res.rec.log.length, 'bt moves', res.rec.log.filter(m => m.n === 'bt').length, 'errors', errors.concat(res.errs).slice(0, 5));
  await browser.close();
})();
